import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { AnalyticsRange, AutomationRule, AutomationRun, AutomationRunStatus, AutomationTrigger, MetricTotals } from '@frontline/shared';
import { loadRows, salesShares, totalsOf } from './analytics';
import { approvalsHook } from './approvals';
import { cronDueBetween, nextCronTime, parseCron } from './cron';
import { addDays, dayFraction, localDate } from './dates';
import type { Db } from './db';
import { storeZone } from './stores';

type Row = Record<string, unknown>;
type Obj = Record<string, unknown>;
type Fields = Omit<AutomationRule, 'id' | 'createdAt' | 'lastFiredAt' | 'nextRunAt'>;

/** Starts an agent run (the agents lane's run manager). Returns the run, or an error message. */
export type RunTask = (agentId: string, task: string) => { id: string } | string;

const METRICS: (keyof MetricTotals)[] = ['revenue', 'profit', 'adSpend', 'roas', 'orders', 'aov'];
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const int = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;

/** `withNext` adds nextRunAt for the API (an up-to-8-day minute scan, so the scheduler tick skips it). */
const toRule = (r: Row, withNext = false): AutomationRule => {
  const trigger = JSON.parse(String(r.trigger_json)) as AutomationTrigger;
  const enabled = r.enabled === 1;
  const next = withNext && enabled && trigger.type === 'schedule' ? nextCronTime(parseCron(trigger.cron), new Date()) : undefined;
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
    ...(next ? { nextRunAt: next.toISOString() } : {}),
  };
};

const getRule = (db: Db, id: string) => {
  const r = db.prepare('SELECT * FROM automation_rules WHERE id = ?').get(id);
  return r ? toRule(r, true) : undefined;
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

/** Validates a create body, or a PATCH body merged over `base`. Returns an error message or the clean fields. */
export function parseRule(db: Db, body: unknown, base?: Fields): string | Fields {
  if (!isObj(body)) return 'body must be a JSON object';
  const b = { enabled: true, approval: 'ask', maxRunsPerDay: 3, cooldownHours: 24, ...base, ...body } as Obj;
  if (typeof b.storeId !== 'string' || !db.prepare('SELECT 1 FROM stores WHERE id = ?').get(b.storeId)) return 'storeId must be an existing store';
  if (base && b.storeId !== base.storeId) return 'storeId cannot change';
  if (typeof b.name !== 'string' || !b.name.trim() || b.name.trim().length > 80) return 'name must be 1-80 characters';
  if (typeof b.enabled !== 'boolean') return 'enabled must be true or false';
  if (b.approval !== 'auto' && b.approval !== 'ask') return 'approval must be auto or ask';
  if (!int(b.maxRunsPerDay, 1, 100)) return 'maxRunsPerDay must be a whole number 1-100';
  if (!int(b.cooldownHours, 0, 720)) return 'cooldownHours must be a whole number 0-720';

  const t = b.trigger;
  if (!isObj(t)) return 'trigger is required';
  let trigger: AutomationTrigger;
  if (t.type === 'schedule') {
    if (typeof t.cron !== 'string') return 'trigger.cron is required';
    try {
      parseCron(t.cron);
    } catch (e) {
      return (e as Error).message;
    }
    trigger = { type: 'schedule', cron: t.cron.trim() };
  } else if (t.type === 'metric') {
    if (!METRICS.includes(t.metric as keyof MetricTotals)) return `trigger.metric must be one of ${METRICS.join(', ')}`;
    if (t.op !== '<' && t.op !== '>') return 'trigger.op must be < or >';
    if (typeof t.value !== 'number' || !Number.isFinite(t.value)) return 'trigger.value must be a number';
    if (!int(t.windowDays, 1, 90)) return 'trigger.windowDays must be a whole number 1-90';
    trigger = { type: 'metric', metric: t.metric as keyof MetricTotals, op: t.op, value: t.value, windowDays: t.windowDays };
  } else return 'trigger.type must be schedule or metric';

  const a = b.action;
  if (!isObj(a) || a.type !== 'agent_task') return "action must be { type: 'agent_task', agentId, task }";
  if (typeof a.agentId !== 'string' || !db.prepare('SELECT 1 FROM agents WHERE id = ? AND store_id = ?').get(a.agentId, b.storeId)) return "action.agentId must be one of this store's agents";
  if (typeof a.task !== 'string' || !a.task.trim() || a.task.length > 4000) return 'action.task must be 1-4000 characters';

  return { storeId: b.storeId, name: b.name.trim(), enabled: b.enabled, trigger, action: { type: 'agent_task', agentId: a.agentId, task: a.task.trim() }, approval: b.approval, maxRunsPerDay: b.maxRunsPerDay, cooldownHours: b.cooldownHours };
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
export function startScheduler(db: Db, runTask: RunTask, { everyMs = 60_000, metricEveryMs = 15 * 60_000, now = () => new Date() } = {}) {
  const hook = approvalsHook(db);
  const setRun = db.prepare('UPDATE automation_runs SET status = ?, detail = coalesce(?, detail), run_id = ? WHERE id = ?');

  const start = (logId: string, rule: AutomationRule, task: string) => {
    const run = runTask(rule.action.agentId, task);
    if (typeof run === 'string') setRun.run('failed', run, null, logId);
    else setRun.run('started', null, run.id, logId);
  };

  const awaitDecision = (logId: string, approvalId: string, ruleId: string, task: string) =>
    hook.decision(approvalId).then(
      (a) => {
        const rule = getRule(db, ruleId);
        if (!rule) return;
        if (a.status === 'approved') start(logId, rule, task);
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

    const dayStart = new Date(t.getFullYear(), t.getMonth(), t.getDate()).toISOString();
    const today = Number(db.prepare("SELECT count(*) AS n FROM automation_runs WHERE rule_id = ? AND fired_at >= ? AND status IN ('started', 'awaiting_approval')").get(rule.id, dayStart)?.n);
    if (today >= rule.maxRunsPerDay) return log('skipped', `${reason}; daily cap of ${rule.maxRunsPerDay} reached`);

    const task = `${rule.action.task}\n\n(Automation "${rule.name}": ${reason}.)`;
    if (rule.approval === 'auto') {
      log('started', reason);
      return start(logId, rule, task);
    }
    const a = hook.create({ storeId: rule.storeId, agentId: rule.action.agentId, title: `Run automation "${rule.name}"`, reason, action: { kind: 'automation.run', payload: { ruleId: rule.id, task: rule.action.task } } });
    log('awaiting_approval', reason, a.id);
    void awaitDecision(logId, a.id, rule.id, task);
  };

  const tick = () => {
    const t = now();
    const check = db.prepare('UPDATE automation_rules SET checked_at = ? WHERE id = ?');
    for (const r of db.prepare('SELECT * FROM automation_rules WHERE enabled = 1').all()) {
      const rule = toRule(r);
      const checked = r.checked_at ? new Date(String(r.checked_at)) : new Date(rule.createdAt);
      if (rule.trigger.type === 'schedule') {
        const after = new Date(Math.max(checked.getTime(), t.getTime() - 86400000));
        check.run(t.toISOString(), rule.id);
        if (cronDueBetween(parseCron(rule.trigger.cron), after, t)) fire(rule, `scheduled (${rule.trigger.cron})`, t);
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
  for (const r of db.prepare("SELECT ar.id, ar.approval_id, ar.rule_id, ru.action_json, ru.name, ar.detail FROM automation_runs ar JOIN automation_rules ru ON ru.id = ar.rule_id WHERE ar.status = 'awaiting_approval'").all()) {
    const task = `${JSON.parse(String(r.action_json)).task}\n\n(Automation "${r.name}": ${r.detail}.)`;
    void awaitDecision(String(r.id), String(r.approval_id), String(r.rule_id), task);
  }
  tick();
  const timer = setInterval(tick, everyMs);
  return { tick, stop: () => clearInterval(timer) };
}

export function automationRoutes(db: Db, pickStores: (q?: string) => string[]) {
  const write = (id: string, f: Fields) =>
    db
      .prepare('UPDATE automation_rules SET name = ?, enabled = ?, trigger_json = ?, action_json = ?, approval = ?, max_runs_per_day = ?, cooldown_hours = ? WHERE id = ?')
      .run(f.name, f.enabled ? 1 : 0, JSON.stringify(f.trigger), JSON.stringify(f.action), f.approval, f.maxRunsPerDay, f.cooldownHours, id);
  return new Hono()
    .get('/api/automations', (c) => {
      const ids = pickStores(c.req.query('stores'));
      if (!ids.length) return c.json([]);
      return c.json(db.prepare(`SELECT * FROM automation_rules WHERE store_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at, rowid`).all(...ids).map((r) => toRule(r, true)));
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
      if (typeof f === 'string') return c.json({ error: f }, 400);
      const id = randomUUID();
      db.prepare('INSERT INTO automation_rules (id, store_id, name, enabled, trigger_json, action_json, approval, max_runs_per_day, cooldown_hours, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        id, f.storeId, f.name, f.enabled ? 1 : 0, JSON.stringify(f.trigger), JSON.stringify(f.action), f.approval, f.maxRunsPerDay, f.cooldownHours, new Date().toISOString(),
      );
      return c.json(getRule(db, id), 201);
    })
    .patch('/api/automations/:id', async (c) => {
      const cur = getRule(db, c.req.param('id'));
      if (!cur) return c.json({ error: 'automation not found' }, 404);
      const f = parseRule(db, await c.req.json().catch(() => undefined), cur);
      if (typeof f === 'string') return c.json({ error: f }, 400);
      write(cur.id, f);
      return c.json(getRule(db, cur.id));
    })
    .delete('/api/automations/:id', (c) => (db.prepare('DELETE FROM automation_rules WHERE id = ?').run(c.req.param('id')).changes ? c.body(null, 204) : c.json({ error: 'automation not found' }, 404)));
}
