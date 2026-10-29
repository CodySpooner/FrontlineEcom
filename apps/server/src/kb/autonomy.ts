// Self-directed research (KB-22). A workspace's research controls say whether its agents may research on their own,
// which roles, for which categories, on what triggers, on what budget and whether the owner approves each task first.
// An hourly pass looks for one trigger per store; an automation's research action asks the same gate. Loop guards: what
// self-directed research made never triggers more of it, a card and trigger cool down for 14 days, a topic open or
// researched in the last day is left alone, and a contradiction research found doesn't start research.
import { createResearchTask, engineInfo, estimateResearch, freshness, getAgent, KB_CONTROLS, kbControls, kbRoleArea } from '@frontline/agents';
import {
  AGENT_ROLES, KB_RESEARCH_DEPTHS, KB_TRIGGERS, type AgentRole, type ApprovalRequest, type AutomationAction, type KbControls, type KbControlsState, type KbResearchBrief, type KbTaskBrief,
  type KbTrigger, type KbWorkspace,
} from '@frontline/shared';
import { approvalsHook } from '../approvals';
import { ConfigError, logChanges } from '../config/write';
import type { Db } from '../db';
import { advanceKbResearch } from '../routes/agents';
import { getStore } from '../stores';
import { kbOverview } from './overview';

const DAY = 86_400_000;
const COOLDOWN_DAYS = 14;
/** How recent a performance lesson is still an anomaly worth asking why. */
const ANOMALY_DAYS = 14;
const LIVE = `status IN ('proposed', 'active')`;
const DOMAIN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const iso = (ms: number) => new Date(ms).toISOString();

export interface AutoDeps {
  /** Claude is there: self-directed research never runs on the demo engine (decision 7). */
  engineAvailable: () => boolean;
  /** Moves the research tasks on. */
  advance: () => void;
}
export const autoDeps = (db: Db): AutoDeps => ({ engineAvailable: () => engineInfo(true).provider === 'claude', advance: () => advanceKbResearch(db) });

/** What self-directed research in the store reserved in the last 24 hours: its tasks' budgets and its recommendations waiting. */
export function reservedUsd(db: Db, storeId: string, now = new Date()): number {
  const tasks = Number(db.prepare(`SELECT coalesce(sum(budget_usd), 0) AS usd FROM kb_tasks WHERE payer_id = ? AND origin = 'autonomous' AND created_at >= ?`).get(storeId, iso(now.getTime() - DAY))!.usd);
  const waiting = Number(
    db.prepare(`SELECT coalesce(sum(json_extract(action_json, '$.payload.budgetUsd')), 0) AS usd FROM approvals WHERE store_id = ? AND status = 'pending' AND json_extract(action_json, '$.kind') = 'kb.research' AND json_extract(action_json, '$.payload.origin') = 'autonomous'`)
      .get(storeId)!.usd,
  );
  return Math.round((tasks + waiting) * 100) / 100;
}

const row = (db: Db, ws: KbWorkspace) => db.prepare(`SELECT version FROM kb_controls WHERE coalesce(store_id, '') = ?`).get(ws ?? '');
/** With the row's version (0 before the first save): a PUT sends it back (settings decision 6). */
export const controlsState = (db: Db, ws: KbWorkspace): KbControlsState => ({ ...kbControls(db, ws), reservedUsd: ws === null ? 0 : reservedUsd(db, ws), version: Number(row(db, ws)?.version ?? 0) });

/** A PUT body over the workspace's controls now: the clean controls, or what's wrong (with its registry id, `kb.<key>`). */
export function parseControls(db: Db, ws: KbWorkspace, body: unknown): KbControls | { error: string; field?: `kb.${keyof KbControls}` } {
  const bad = (error: string, field?: keyof KbControls) => (field ? { error, field: `kb.${field}` as const } : { error });
  if (!isObj(body)) return bad('body must be an object');
  const b = { ...kbControls(db, ws), ...Object.fromEntries(Object.entries(body).filter(([k]) => Object.hasOwn(KB_CONTROLS, k))) } as Obj;
  const flag = (['autonomous', 'approval', 'review'] as const).find((k) => typeof b[k] !== 'boolean');
  if (flag) return bad('autonomous, approval and review must be true or false', flag);
  if (!isObj(b.roles) || !Object.entries(b.roles).every(([r, ids]) => Object.hasOwn(AGENT_ROLES, r) && Array.isArray(ids) && ids.every((id) => typeof id === 'string')))
    return bad('roles must map agent roles to category ids', 'roles');
  const top = db.prepare(`SELECT 1 FROM kb_categories WHERE id = ? AND coalesce(store_id, '') = ? AND parent_id IS NULL`);
  if (!Object.values(b.roles as Record<string, string[]>).every((ids) => ids.every((id) => top.get(id, ws ?? '')))) return bad("roles' categories must be this workspace's top-level categories", 'roles');
  if (!Array.isArray(b.triggers) || !b.triggers.every((t) => Object.hasOwn(KB_TRIGGERS, t))) return bad(`triggers must be some of ${Object.keys(KB_TRIGGERS).join(', ')}`, 'triggers');
  if (typeof b.taskBudgetUsd !== 'number' || !(b.taskBudgetUsd >= 0.25 && b.taskBudgetUsd <= 5)) return bad('taskBudgetUsd must be between $0.25 and $5', 'taskBudgetUsd');
  if (typeof b.dailyBudgetUsd !== 'number' || !(b.dailyBudgetUsd >= b.taskBudgetUsd && b.dailyBudgetUsd <= 50)) return bad('dailyBudgetUsd must be between the task budget and $50', 'dailyBudgetUsd');
  if (!Object.hasOwn(KB_RESEARCH_DEPTHS, String(b.depth))) return bad('depth must be quick, standard or deep', 'depth');
  const domains = (v: unknown) => (Array.isArray(v) && v.length <= 50 && v.every((d) => typeof d === 'string') ? [...new Set(v.map((d: string) => d.trim().toLowerCase()))] : undefined);
  const [trusted, blocked] = [domains(b.trustedDomains), domains(b.blockedDomains)];
  if (!trusted || !blocked || ![...trusted, ...blocked].every((d) => DOMAIN.test(d)))
    return bad('trustedDomains and blockedDomains must be domain names, like example.com', !trusted || !trusted.every((d) => DOMAIN.test(d)) ? 'trustedDomains' : 'blockedDomains');
  if (!isObj(b.freshDays) || !Object.entries(b.freshDays).every(([id, d]) => Number.isInteger(d) && (d as number) >= 7 && (d as number) <= 730 && top.get(id, ws ?? '')))
    return bad("freshDays must map this workspace's top-level categories to 7-730 days", 'freshDays');
  if (b.retentionDays !== null && !(Number.isInteger(b.retentionDays) && (b.retentionDays as number) >= 30 && (b.retentionDays as number) <= 3650))
    return bad('retentionDays must be 30-3650 days, or null to keep everything', 'retentionDays');
  if (ws === null && b.autonomous) return bad('Self-directed research runs on a store: its agents and AI budget. Turn it on for a store.', 'autonomous');
  return {
    autonomous: b.autonomous as boolean, roles: Object.fromEntries(Object.entries(b.roles).map(([r, ids]) => [r, [...new Set(ids as string[])]])),
    triggers: (Object.keys(KB_TRIGGERS) as KbTrigger[]).filter((t) => (b.triggers as string[]).includes(t)), taskBudgetUsd: b.taskBudgetUsd, dailyBudgetUsd: b.dailyBudgetUsd,
    depth: b.depth as KbControls['depth'], approval: b.approval as boolean, review: b.review as boolean, trustedDomains: trusted, blockedDomains: blocked,
    freshDays: b.freshDays as Record<string, number>, retentionDays: b.retentionDays as number | null,
  };
}

/**
 * Saves a workspace's controls. `version` (as read, 0 before the first save) is checked when given: a stale one throws
 * ConfigError (409) and nothing is written (settings decision 6). Each control that moved writes a change row.
 */
export function saveControls(db: Db, ws: KbWorkspace, c: KbControls, version?: number) {
  const before = kbControls(db, ws);
  const cur = Number(row(db, ws)?.version ?? 0);
  if (version !== undefined && version !== cur)
    throw new ConfigError(409, { error: 'These controls were saved somewhere else while you were editing.', code: version === 0 ? 'exists' : 'stale', current: controlsState(db, ws) });
  const at = new Date().toISOString();
  const json = JSON.stringify(c);
  if (cur) db.prepare(`UPDATE kb_controls SET settings_json = ?, updated_at = ?, version = version + 1 WHERE coalesce(store_id, '') = ? AND version = ?`).run(json, at, ws ?? '', cur);
  else db.prepare('INSERT INTO kb_controls (store_id, settings_json, updated_at) VALUES (?, ?, ?)').run(ws, json, at);
  const moved = (Object.keys(c) as (keyof KbControls)[]).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(c[k])).map((k) => [`kb.${k}`, before[k], c[k]] as [string, unknown, unknown]);
  const store = ws === null ? undefined : getStore(db, ws);
  if (moved.length) logChanges(db, { at, actor: 'owner', store: store && { id: store.id, name: store.name } }, moved.map(([k, b, a]) => [k, b, a, store ? 'store' : 'workspace']));
}

interface Ask {
  storeId: string;
  role: AgentRole;
  objective: string;
  why: string;
  trigger: NonNullable<KbResearchBrief['trigger']>;
}
export interface Started {
  storeId: string;
  trigger: KbTrigger | 'schedule';
  task?: KbTaskBrief;
  approval?: ApprovalRequest;
}

/** Self-directed research, if the store's controls and the loop guards allow it: a task, or a recommendation. Else why not. */
function begin(db: Db, a: Ask, deps: AutoDeps): Started | string {
  const now = Date.now();
  const store = getStore(db, a.storeId)!.name;
  const c = kbControls(db, a.storeId);
  if (!c.autonomous) return `Self-directed research is off for ${store}`;
  if (!c.roles[a.role]) return `The ${AGENT_ROLES[a.role].name} doesn't research on its own in ${store}`;
  if (!deps.engineAvailable()) return 'Self-directed research needs Claude: the agents are on the demo engine here';
  const objective = a.objective.toLowerCase();
  const research = `json_extract(action_json, '$.kind') = 'kb.research'`;
  if (
    db.prepare(`SELECT 1 FROM kb_tasks WHERE store_id = ? AND lower(objective) = ? AND (status IN ('queued', 'running') OR (status = 'done' AND ended_at >= ?))`).get(a.storeId, objective, iso(now - DAY)) ||
    db.prepare(`SELECT 1 FROM approvals WHERE store_id = ? AND status = 'pending' AND ${research} AND lower(json_extract(action_json, '$.payload.objective')) = ?`).get(a.storeId, objective)
  )
    return `Already researching or just researched in ${store}: "${a.objective}"`;
  const since = iso(now - COOLDOWN_DAYS * DAY);
  if (
    a.trigger.kind !== 'schedule' &&
    (db.prepare(`SELECT 1 FROM kb_tasks WHERE payer_id = ? AND json_extract(brief_json, '$.trigger.kind') = ? AND json_extract(brief_json, '$.trigger.subject') = ? AND created_at >= ?`).get(a.storeId, a.trigger.kind, a.trigger.subject, since) ||
      db.prepare(`SELECT 1 FROM approvals WHERE store_id = ? AND ${research} AND json_extract(action_json, '$.payload.brief.trigger.kind') = ? AND json_extract(action_json, '$.payload.brief.trigger.subject') = ? AND created_at >= ?`).get(a.storeId, a.trigger.kind, a.trigger.subject, since))
  )
    return `Researched for this ${KB_TRIGGERS[a.trigger.kind].toLowerCase().replace(/s$/, '')} in the last ${COOLDOWN_DAYS} days`;
  if (reservedUsd(db, a.storeId) + c.taskBudgetUsd > c.dailyBudgetUsd + 1e-9) return `${store}'s self-directed research budget for the day ($${c.dailyBudgetUsd.toFixed(2)}) is reserved`;

  const brief: KbResearchBrief = { depth: c.depth, trigger: a.trigger };
  if (c.approval) {
    const estimateUsd = estimateResearch(db, a.storeId);
    const approval = approvalsHook(db).create({
      storeId: a.storeId, agentId: `${a.storeId}:${a.role}`, title: `Research: ${a.objective}`, reason: `${a.why}. Up to $${c.taskBudgetUsd.toFixed(2)} of AI usage.`,
      action: { kind: 'kb.research', payload: { ws: a.storeId, role: a.role, objective: a.objective, brief, budgetUsd: c.taskBudgetUsd, origin: 'autonomous', ...(estimateUsd !== undefined ? { estimateUsd } : {}) } },
    });
    return { storeId: a.storeId, trigger: a.trigger.kind, approval };
  }
  const task = createResearchTask(db, { ws: a.storeId, payerId: a.storeId, role: a.role, kind: 'topic', origin: 'autonomous', objective: a.objective, brief, budgetUsd: c.taskBudgetUsd, why: a.why });
  deps.advance();
  return { storeId: a.storeId, trigger: a.trigger.kind, task };
}

interface Candidate {
  trigger: KbTrigger;
  subject: string;
  category: string;
  objective: string;
  why: string;
}

/** The store's triggers, in KB_TRIGGERS order, leaving out what research made. */
function candidates(db: Db, storeId: string, c: KbControls): Candidate[] {
  const now = Date.now();
  const root = (id: string): string => {
    const p = db.prepare('SELECT parent_id FROM kb_categories WHERE id = ?').get(id)?.parent_id;
    return p ? root(String(p)) : id;
  };
  const selfMade = db.prepare(`SELECT 1 FROM kb_cards k JOIN kb_tasks t ON t.id = k.task_id WHERE k.id = ? AND t.origin = 'autonomous'`);
  const own = (rows: Record<string, unknown>[]) => rows.filter((r) => !selfMade.get(String(r.id)));
  const niche = String(db.prepare('SELECT niche FROM stores WHERE id = ?').get(storeId)!.niche);
  const found: Record<KbTrigger, () => Candidate[]> = {
    conflict: () =>
      db
        .prepare(`SELECT f.card_id, f.note, k.title, k.category_id, o.title AS other FROM kb_conflicts f JOIN kb_cards k ON k.id = f.card_id LEFT JOIN kb_cards o ON o.id = f.other_card_id
          WHERE f.store_id = ? AND f.status = 'open' AND f.task_id IS NULL AND k.${LIVE} ORDER BY f.created_at`)
        .all(storeId)
        .map((r) => ({
          trigger: 'conflict', subject: String(r.card_id), category: root(String(r.category_id)), why: `Contradiction: ${r.note}`,
          objective: r.other ? `Settle the disagreement: "${r.title}" vs "${r.other}"` : `Settle the disagreement on "${r.title}": ${r.note}`,
        })),
    anomaly: () =>
      db
        .prepare(`SELECT id, title, summary, category_id FROM kb_cards WHERE store_id = ? AND origin = 'performance' AND ${LIVE} AND updated_at >= ? ORDER BY updated_at DESC`)
        .all(storeId, iso(now - ANOMALY_DAYS * DAY))
        .map((r) => ({ trigger: 'anomaly', subject: String(r.id), category: root(String(r.category_id)), objective: `Why does this happen, and how do we use it? "${r.title}"`, why: `Performance anomaly: ${r.summary}` })),
    gap: () =>
      kbOverview(db, storeId)
        .gaps.filter((g) => g.reason === 'only hypotheses')
        .filter(
          (g) =>
            !db
              .prepare(`WITH RECURSIVE sub(id) AS (SELECT ? UNION ALL SELECT c.id FROM kb_categories c JOIN sub ON c.parent_id = sub.id)
                SELECT 1 FROM kb_cards k JOIN kb_tasks t ON t.id = k.task_id WHERE t.origin = 'autonomous' AND k.${LIVE} AND k.category_id IN (SELECT id FROM sub)`)
              .get(g.categoryId),
        )
        .map((g) => ({ trigger: 'gap', subject: g.categoryId, category: g.categoryId, objective: `${g.name} for a ${niche} store: which of its findings hold up?`, why: `Knowledge gap: everything in ${g.name} is a Hypothesis` })),
    stale: () => {
      // Past its category's age (KB-23). ponytail: the 200 least recently checked; enough for one task a pass.
      const fresh = freshness(db);
      return own(
        db
          .prepare(`SELECT id, title, category_id, coalesce(verified_at, created_at) AS seen FROM kb_cards WHERE store_id = ? AND ${LIVE} AND origin != 'performance' ORDER BY seen LIMIT 200`)
          .all(storeId)
          .filter((r) => now - Date.parse(String(r.seen)) > fresh(String(r.category_id)) * DAY)
          .slice(0, 20),
      ).map((r) => ({ trigger: 'stale', subject: String(r.id), category: root(String(r.category_id)), objective: `Is it still true? "${r.title}"`, why: `Stale card: last checked ${String(r.seen).slice(0, 10)}` }));
    },
  };
  return c.triggers.flatMap((t) => found[t]());
}

/** The role that answers for a top-level category: one the owner gave it, else one whose usual areas it is. */
function responsible(db: Db, c: KbControls, category: string): AgentRole | undefined {
  const name = String(db.prepare('SELECT name FROM kb_categories WHERE id = ?').get(category)?.name ?? '');
  return (Object.keys(AGENT_ROLES) as AgentRole[]).find((r) => c.roles[r] && (c.roles[r]!.length ? c.roles[r]!.includes(category) : kbRoleArea(r, name)));
}

/** The hourly pass: in each store that has self-directed research on, the first trigger its controls let start. */
export function autonomousResearch(db: Db, deps: AutoDeps): Started[] {
  const stores = db.prepare('SELECT store_id FROM kb_controls WHERE store_id IS NOT NULL').all().map((r) => String(r.store_id));
  return stores.flatMap((storeId) => {
    const c = kbControls(db, storeId);
    for (const k of candidates(db, storeId, c)) {
      const role = responsible(db, c, k.category);
      const r = role && begin(db, { storeId, role, objective: k.objective, why: k.why, trigger: { kind: k.trigger, subject: k.subject } }, deps);
      if (r && typeof r !== 'string') return [r];
    }
    return [];
  });
}

/** An automation's research action (automations.ts), through the same gate: what to log on the rule's run. */
export function scheduledResearch(db: Db, ruleId: string, reason: string, deps: AutoDeps): { status: 'started' | 'skipped'; detail: string } {
  const rule = db.prepare('SELECT store_id, name, action_json FROM automation_rules WHERE id = ?').get(ruleId);
  const action = rule && (JSON.parse(String(rule.action_json)) as AutomationAction);
  const agent = action && getAgent(db, action.agentId);
  if (!rule || !agent) return { status: 'skipped', detail: 'Its agent is gone' };
  const r = begin(db, { storeId: String(rule.store_id), role: agent.role, objective: action.task, why: `Automation "${rule.name}": ${reason}`, trigger: { kind: 'schedule', subject: ruleId } }, deps);
  if (typeof r === 'string') return { status: 'skipped', detail: r };
  return { status: 'started', detail: r.task ? `Research queued: ${r.task.objective}` : 'Recommended: waiting for your approval in the Research Center' };
}
