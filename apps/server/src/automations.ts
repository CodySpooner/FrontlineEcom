import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { automationPaused, workspaceZone } from '@frontline/agents';
import type { AnalyticsRange, AutomationRule, AutomationRun, AutomationRunStatus, AutomationTrigger, MetricTotals } from '@frontline/shared';
import { loadRows, salesShares, totalsOf } from './analytics';
import { approvalsHook } from './approvals';
import { cronDueBetween, nextCronTime, parseCron } from './cron';
import { addDays, dayFraction, localDate, startOfDay } from './dates';
import { logChanges, NO_VERSION, versionOf } from './config/write';
import { once, type Db } from './db';
import { storeZone } from './stores';

type Row = Record<string, unknown>;
type Obj = Record<string, unknown>;
type Fields = Omit<AutomationRule, 'id' | 'createdAt' | 'lastFiredAt' | 'nextRunAt' | 'version'>;
/** `field`: the body key it's about (rules have no registry entries, settings decision 6). */
type Bad = { error: string; field?: keyof Fields };

/** Starts an agent run (the agents lane's run manager). Returns the run, or an error message. */
export type RunTask = (agentId: string, task: string) => { id: string } | string;
/** Starts a rule's research (kb/autonomy.ts scheduledResearch): what to log on its run. */
export type StartResearch = (ruleId: string, reason: string) => { status: 'started' | 'skipped'; detail: string };

const METRICS: (keyof MetricTotals)[] = ['revenue', 'profit', 'adSpend', 'roas', 'orders', 'aov'];
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const int = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;

/**
 * `zone` (the workspace timezone) adds nextRunAt for the API, worked out in it (an up-to-8-day minute scan, so the
 * scheduler tick skips it).
 */
const toRule = (r: Row, zone?: string): AutomationRule => {
  const trigger = JSON.parse(String(r.trigger_json)) as AutomationTrigger;
  const enabled = r.enabled === 1;
  const next = zone && enabled && trigger.type === 'schedule' ? nextCronTime(parseCron(trigger.cron), new Date(), 8, zone) : undefined;
  return {
    id: String(r.id),
    storeId: String(r.store_id),
    name: String(r.name),
    enabled,
    trigger,
    action: JSON.parse(String(r.action_json)),
    approval: r.approval as AutomationRule['approval'],
    maxRunsPerDay: Number(r.max_runs_per_day),
    cooldownHours: Number(r.cooldown_hours),
    createdAt: String(r.created_at),
    ...(r.last_fired_at ? { lastFiredAt: String(r.last_fired_at) } : {}),
    ...(next ? { nextRunAt: next.toISOString(), nextRunZone: zone } : {}),
    version: Number(r.version),
  };
};

const getRule = (db: Db, id: string) => {
  const r = db.prepare('SELECT * FROM automation_rules WHERE id = ?').get(id);
  return r ? toRule(r, workspaceZone(db)) : undefined;
};

const toRun = (r: Row): AutomationRun => ({
  id: String(r.id),
  ruleId: String(r.rule_id),
  storeId: String(r.store_id),
  firedAt: String(r.fired_at),
  status: r.status as AutomationRunStatus,
  ...(r.detail ? { detail: String(r.detail) } : {}),
  ...(r.run_id ? { runId: String(r.run_id) } : {}),
  ...(r.approval_id ? { approvalId: String(r.approval_id) } : {}),
});

/** Validates a create body, or a PATCH body merged over `base`. Returns the error (and its field) or the clean fields. */
export function parseRule(db: Db, body: unknown, base?: Fields): Bad | Fields {
  const bad = (error: string, field?: keyof Fields): Bad => (field ? { error, field } : { error });
  if (!isObj(body)) return bad('body must be a JSON object');
  const b = { enabled: true, approval: 'ask', maxRunsPerDay: 3, cooldownHours: 24, ...base, ...body } as Obj;
  if (typeof b.storeId !== 'string' || !db.prepare('SELECT 1 FROM stores WHERE id = ?').get(b.storeId)) return bad('storeId must be an existing store', 'storeId');
  if (base && b.storeId !== base.storeId) return bad('storeId cannot change', 'storeId');
  if (typeof b.name !== 'string' || !b.name.trim() || b.name.trim().length > 80) return bad('name must be 1-80 characters', 'name');
  if (typeof b.enabled !== 'boolean') return bad('enabled must be true or false', 'enabled');
  if (b.approval !== 'auto' && b.approval !== 'ask') return bad('approval must be auto or ask', 'approval');
  if (!int(b.maxRunsPerDay, 1, 100)) return bad('maxRunsPerDay must be a whole number 1-100', 'maxRunsPerDay');
  if (!int(b.cooldownHours, 0, 720)) return bad('cooldownHours must be a whole number 0-720', 'cooldownHours');

  const t = b.trigger;
  if (!isObj(t)) return bad('trigger is required', 'trigger');
  let trigger: AutomationTrigger;
  if (t.type === 'schedule') {
    if (typeof t.cron !== 'string') return bad('trigger.cron is required', 'trigger');
    try {
      parseCron(t.cron);
    } catch (e) {
      return bad((e as Error).message, 'trigger');
    }
    trigger = { type: 'schedule', cron: t.cron.trim() };
  } else if (t.type === 'metric') {
    if (!METRICS.includes(t.metric as keyof MetricTotals)) return bad(`trigger.metric must be one of ${METRICS.join(', ')}`, 'trigger');
    if (t.op !== '<' && t.op !== '>') return bad('trigger.op must be < or >', 'trigger');
    if (typeof t.value !== 'number' || !Number.isFinite(t.value)) return bad('trigger.value must be a number', 'trigger');
    if (!int(t.windowDays, 1, 90)) return bad('trigger.windowDays must be a whole number 1-90', 'trigger');
    trigger = { type: 'metric', metric: t.metric as keyof MetricTotals, op: t.op, value: t.value, windowDays: t.windowDays };
  } else return bad('trigger.type must be schedule or metric', 'trigger');

  const a = b.action;
  if (!isObj(a) || (a.type !== 'agent_task' && a.type !== 'kb_research')) return bad("action must be { type: 'agent_task', agentId, task }", 'action');
  if (typeof a.agentId !== 'string' || !db.prepare('SELECT 1 FROM agents WHERE id = ? AND store_id = ?').get(a.agentId, b.storeId)) return bad("action.agentId must be one of this store's agents", 'action');
  // Research (KB-22) is a topic, and the store's research controls decide whether it waits for approval.
  if (a.type === 'kb_research' && !(typeof a.task === 'string' && a.task.trim().length >= 3 && a.task.trim().length <= 500)) return bad('action.task must be 3-500 characters for research', 'action');
  if (typeof a.task !== 'string' || !a.task.trim() || a.task.length > 4000) return bad('action.task must be 1-4000 characters', 'action');

  return { storeId: b.storeId, name: b.name.trim(), enabled: b.enabled, trigger, action: { type: a.type, agentId: a.agentId, task: a.task.trim() }, approval: b.approval, maxRunsPerDay: b.maxRunsPerDay, cooldownHours: b.cooldownHours };
}

/**
 * The store's metric over the trailing `windowDays` x 24 h: today so far, the full days before it, and the share of the
 * oldest day today hasn't covered yet, so a sum doesn't read low early in the day. Undefined when the ratio has no
 * denominator.
 */
export function metricValue(db: Db, storeId: string, metric: keyof MetricTotals, windowDays: number, now = new Date()) {
  const tz = storeZone(db, storeId);
  const today = localDate(now, tz);
  const oldest = addDays(today, -windowDays);
  // The oldest day counts the share of its sales made after this time of day (by its orders' times, else the clock).
  const left = 1 - salesShares(db, [storeId], oldest, new Date(now.getTime() - windowDays * 86_400_000), dayFraction(today, now.getTime(), tz))[storeId]!;
  const rows = loadRows(db, [storeId], windowDays as AnalyticsRange, today)
    .filter((r) => r.date >= oldest)
    .map((r) => (r.date === oldest ? { ...r, revenue: r.revenue * left, adSpend: r.adSpend * left, cogs: r.cogs * left, orders: Math.round(r.orders * left) } : r));
  const t = totalsOf(rows);
  if ((metric === 'roas' && !t.adSpend) || (metric === 'aov' && !t.orders)) return undefined;
  return t[metric];
}

const LABEL: Record<keyof MetricTotals, string> = { revenue: 'Revenue', profit: 'Profit', adSpend: 'Ad spend', roas: 'ROAS', orders: 'Orders', aov: 'AOV' };

/**
 * Checks rules every `everyMs`: schedule rules fire once if their cron matched since the last check (catching up a missed
 * fire after a restart, up to 24h back); metric rules are evaluated every `metricEveryMs` and respect their cooldown.
 */
export function startScheduler(db: Db, runTask: RunTask, { everyMs = 60_000, metricEveryMs = 15 * 60_000, now = () => new Date(), research }: { everyMs?: number; metricEveryMs?: number; now?: () => Date; research?: StartResearch } = {}) {
  const hook = approvalsHook(db);
  const setRun = db.prepare('UPDATE automation_runs SET status = ?, detail = coalesce(?, detail), run_id = ? WHERE id = ?');

  const start = (logId: string, agentId: string, task: string) => {
    const run = runTask(agentId, task);
    if (typeof run === 'string') setRun.run('failed', run, null, logId);
    else setRun.run('started', null, run.id, logId);
  };

  // The agent and task the owner approved (the request's), not the rule's now: it may have been edited since.
  const awaitDecision = (logId: string, approvalId: string, ruleId: string) =>
    hook.decision(approvalId).then(
      (a) => {
        const rule = getRule(db, ruleId);
        if (!rule) return;
        const approved = (a.action.payload as { task?: unknown }).task;
        const task = `${typeof approved === 'string' ? approved : rule.action.task}\n\n(Automation "${rule.name}": ${a.reason}.)`;
        if (a.status === 'approved') start(logId, a.agentId, task);
        else setRun.run('denied', null, null, logId);
      },
      () => setRun.run('failed', 'approval request disappeared', null, logId),
    );

  const fire = (rule: AutomationRule, reason: string, t: Date) => {
    const logId = randomUUID();
    const firedAt = t.toISOString();
    const log = (status: AutomationRunStatus, detail: string, approvalId?: string) =>
      db.prepare('INSERT INTO automation_runs (id, rule_id, store_id, fired_at, status, detail, approval_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(logId, rule.id, rule.storeId, firedAt, status, detail, approvalId ?? null);
    db.prepare('UPDATE automation_rules SET last_fired_at = ? WHERE id = ?').run(firedAt, rule.id);

    const dayStart = new Date(startOfDay(workspaceZone(db), t)).toISOString(); // the workspace zone's day (settings decision 8)
    const today = Number(db.prepare("SELECT count(*) AS n FROM automation_runs WHERE rule_id = ? AND fired_at >= ? AND status IN ('started', 'awaiting_approval')").get(rule.id, dayStart)?.n);
    if (today >= rule.maxRunsPerDay) return log('skipped', `${reason}; daily cap of ${rule.maxRunsPerDay} reached`);

    if (rule.action.type === 'kb_research') {
      const r = research?.(rule.id, reason) ?? { status: 'skipped', detail: "Research isn't available here" };
      return log(r.status, r.detail);
    }
    const task = `${rule.action.task}\n\n(Automation "${rule.name}": ${reason}.)`;
    if (rule.approval === 'auto') {
      log('started', reason);
      return start(logId, rule.action.agentId, task);
    }
    const a = hook.create({ storeId: rule.storeId, agentId: rule.action.agentId, title: `Run automation "${rule.name}"`, reason, action: { kind: 'automation.run', payload: { ruleId: rule.id, task: rule.action.task } } });
    log('awaiting_approval', reason, a.id);
    void awaitDecision(logId, a.id, rule.id);
  };

  const tick = () => {
    const t = now();
    const zone = workspaceZone(db);
    const check = db.prepare('UPDATE automation_rules SET checked_at = ? WHERE id = ?');
    // A rule that's off moves on too: switched back on, it doesn't replay the slots it was off for. So does every rule
    // while new automation is paused (settings decision 14): a slot missed then is skipped, not caught up on resume.
    if (automationPaused(db)) return void db.prepare('UPDATE automation_rules SET checked_at = ?').run(t.toISOString());
    db.prepare('UPDATE automation_rules SET checked_at = ? WHERE enabled = 0').run(t.toISOString());
    for (const r of db.prepare('SELECT * FROM automation_rules WHERE enabled = 1').all()) {
      const rule = toRule(r);
      const checked = r.checked_at ? new Date(String(r.checked_at)) : new Date(rule.createdAt);
      if (rule.trigger.type === 'schedule') {
        // Back after downtime, a missed slot runs once (cronDueBetween asks whether any was due), as far back as a month:
        // a weekly or monthly slot the app was closed through isn't dropped.
        const after = new Date(Math.max(checked.getTime(), t.getTime() - 31 * 86400000));
        check.run(t.toISOString(), rule.id);
        const cron = parseCron(rule.trigger.cron);
        if (!cronDueBetween(cron, after, t, zone)) continue;
        // A timezone set further west brings the day's times round again: a rule with fixed hours runs each of its times
        // once a day. Hourly rules keep every real hour (25 the night clocks fall back), as cron.ts has them.
        const slots = cron.sets[1]!.size === 24 ? Infinity : cron.sets[0]!.size * cron.sets[1]!.size;
        const ran = Number(db.prepare('SELECT count(*) AS n FROM automation_runs WHERE rule_id = ? AND fired_at >= ?').get(rule.id, new Date(startOfDay(zone, t)).toISOString())?.n);
        if (ran < slots) fire(rule, `scheduled (${rule.trigger.cron})`, t);
        continue;
      }
      if (r.checked_at && t.getTime() - checked.getTime() < metricEveryMs) continue;
      check.run(t.toISOString(), rule.id);
      if (rule.lastFiredAt && t.getTime() - Date.parse(rule.lastFiredAt) < rule.cooldownHours * 3600000) continue;
      const { metric, op, value, windowDays } = rule.trigger;
      const v = metricValue(db, rule.storeId, metric, windowDays, t);
      if (v === undefined || !(op === '<' ? v < value : v > value)) continue;
      fire(rule, `${LABEL[metric]} ${v} ${op} ${value} over the last ${windowDays} day${windowDays > 1 ? 's' : ''}`, t);
    }
  };

  // Requests still waiting from before a restart.
  for (const r of db.prepare("SELECT id, approval_id, rule_id FROM automation_runs WHERE status = 'awaiting_approval'").all()) {
    void awaitDecision(String(r.id), String(r.approval_id), String(r.rule_id));
  }
  tick();
  const timer = setInterval(tick, everyMs);
  return { tick, stop: () => clearInterval(timer) };
}

export function automationRoutes(db: Db, pickStores: (q?: string) => string[]) {
  // The owner's edit, on the version they read (settings decision 6): one bump, a change row per field that moved.
  const write = (cur: AutomationRule, f: Fields) => {
    const at = new Date().toISOString();
    db.prepare('UPDATE automation_rules SET name = ?, enabled = ?, trigger_json = ?, action_json = ?, approval = ?, max_runs_per_day = ?, cooldown_hours = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?')
      .run(f.name, f.enabled ? 1 : 0, JSON.stringify(f.trigger), JSON.stringify(f.action), f.approval, f.maxRunsPerDay, f.cooldownHours, at, cur.id, cur.version!);
    const moved = (Object.keys(f) as (keyof Fields)[]).filter((k) => JSON.stringify(cur[k]) !== JSON.stringify(f[k]));
    const store = db.prepare('SELECT name FROM stores WHERE id = ?').get(cur.storeId);
    logChanges(db, { at, actor: 'owner', store: { id: cur.storeId, name: String(store?.name) } }, moved.map((k) => [`automation.${k}`, cur[k], f[k], 'store', f.name]));
  };
  return new Hono()
    .get('/api/automations', (c) => {
      const ids = pickStores(c.req.query('stores'));
      if (!ids.length) return c.json([]);
      return c.json(db.prepare(`SELECT * FROM automation_rules WHERE store_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at, rowid`).all(...ids).map((r) => toRule(r, workspaceZone(db))));
    })
    .get('/api/automations/runs', (c) => {
      const ids = pickStores(c.req.query('stores'));
      const rule = c.req.query('rule');
      if (!ids.length) return c.json([]);
      const limit = Math.min(200, Math.max(1, Number(c.req.query('limit')) || 50));
      const rows = db
        .prepare(`SELECT * FROM automation_runs WHERE store_id IN (${ids.map(() => '?').join(',')}) ${rule ? 'AND rule_id = ?' : ''} ORDER BY fired_at DESC, rowid DESC LIMIT ?`)
        .all(...ids, ...(rule ? [rule] : []), limit);
      return c.json(rows.map(toRun));
    })
    .post('/api/automations', async (c) => {
      const f = parseRule(db, await c.req.json().catch(() => undefined));
      if ('error' in f) return c.json(f, 400);
      // Settings → Knowledge's Schedules shortcut (settings ST-30): the same topic, researcher and schedule twice would research it twice.
      const same = f.action.type === 'kb_research' && db.prepare('SELECT 1 FROM automation_rules WHERE store_id = ? AND trigger_json = ? AND action_json = ?').get(f.storeId, JSON.stringify(f.trigger), JSON.stringify(f.action));
      if (same) return c.json({ error: 'This research is already on that schedule.', field: 'action' }, 400);
      const id = randomUUID();
      db.prepare('INSERT INTO automation_rules (id, store_id, name, enabled, trigger_json, action_json, approval, max_runs_per_day, cooldown_hours, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        id, f.storeId, f.name, f.enabled ? 1 : 0, JSON.stringify(f.trigger), JSON.stringify(f.action), f.approval, f.maxRunsPerDay, f.cooldownHours, new Date().toISOString(),
      );
      return c.json(getRule(db, id), 201);
    })
    .patch('/api/automations/:id', async (c) => {
      const cur = getRule(db, c.req.param('id'));
      if (!cur) return c.json({ error: 'automation not found' }, 404);
      const body: unknown = await c.req.json().catch(() => undefined);
      const f = parseRule(db, body, cur);
      if ('error' in f) return c.json(f, 400);
      const version = versionOf(body);
      if (version === undefined) return c.json(NO_VERSION, 428);
      if (version !== cur.version) return c.json({ error: 'This automation was saved somewhere else while you were editing.', code: version === 0 ? 'exists' : 'stale', current: cur }, 409);
      write(cur, f);
      once(db, `rule-edited:${cur.id}`); // the owner's call now: agents switching default jobs on leave this one alone
      return c.json(getRule(db, cur.id));
    })
    .delete('/api/automations/:id', (c) => (db.prepare('DELETE FROM automation_rules WHERE id = ?').run(c.req.param('id')).changes ? c.body(null, 204) : c.json({ error: 'automation not found' }, 404)));
}
