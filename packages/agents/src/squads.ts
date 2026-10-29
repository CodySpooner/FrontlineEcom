import type { DatabaseSync } from 'node:sqlite';
import { AGENT_ROLES, machineZone, startOfDay, type Agent, type AgentRole, type AgentUpdate, type Autonomy, type Store } from '@frontline/shared';
import { engineInfo } from './engine';
import { createDefaultJobs } from './jobs';

// Squads live in core's `agents` table (apps/server/src/db.ts). Agent id = `<storeId>:<role>`.

/** Every role starts at 'ask': agents propose, the owner approves (DESIGN principle 3). */
export const DEFAULT_AUTONOMY: Autonomy = 'ask';

export const agentId = (storeId: string, role: AgentRole) => `${storeId}:${role}`;

/** One agent per role for the store, plus its default jobs when the squad is new. Idempotent: existing agents keep their settings. */
export function createSquad(db: DatabaseSync, store: Pick<Store, 'id'>): Agent[] {
  const insert = db.prepare('INSERT OR IGNORE INTO agents (id, store_id, role, autonomy) VALUES (?, ?, ?, ?)');
  const roles = Object.keys(AGENT_ROLES) as AgentRole[];
  let added = 0;
  for (const role of roles) added += Number(insert.run(agentId(store.id, role), store.id, role, DEFAULT_AUTONOMY).changes);
  if (added === roles.length) {
    // A deleted store's id can come back: its once-per-store steps (default jobs, going live, theme copies) start fresh.
    db.prepare(`DELETE FROM done_once WHERE ref IN (?, ?) OR ref LIKE ? OR ref LIKE ?`).run(`activate:${store.id}`, `ads-job-wait:${store.id}`, `default-job:${store.id}:%`, `theme-copy:${store.id}:%`);
    createDefaultJobs(db, store.id);
  }
  return listAgents(db, [store.id]);
}

/** Gives every store a full squad (new stores, and roles added since a squad was made). */
export function ensureSquads(db: DatabaseSync) {
  for (const { id } of db.prepare('SELECT id FROM stores').all()) createSquad(db, { id: String(id) });
}

/** Squads of the given stores (all stores when omitted), stores in creation order, roles in AGENT_ROLES order. */
export function listAgents(db: DatabaseSync, storeIds?: string[]): Agent[] {
  const filter = storeIds?.length ? `WHERE a.store_id IN (${storeIds.map(() => '?').join(',')})` : '';
  const rows = db
    .prepare(`SELECT a.*, s.connected FROM agents a JOIN stores s ON s.id = a.store_id ${filter} ORDER BY s.created_at, s.rowid, a.rowid`)
    .all(...(storeIds?.length ? storeIds : []));
  const busy = busyAgents(db);
  return rows.map((r) => toAgent(r, busy, costToday(db, String(r.store_id), String(r.id))));
}

/**
 * The workspace timezone (settings decision 8): every "today" counter and schedule runs on it. The machine's when the
 * `workspace` row or its timezone is absent (a fresh DB, a test, a backup restored before boot), never UTC.
 */
export const workspaceZone = (db: DatabaseSync): string =>
  String(db.prepare("SELECT json_extract(value_json, '$.timezone') AS zone FROM settings WHERE key = 'workspace'").get()?.zone ?? '') || machineZone();

/**
 * What the store's runs (or one agent's) cost today: every run not over before the workspace zone's midnight, so one
 * queued or begun yesterday that spends today counts. ponytail: all of such a run's cost counts today; a cap errs high, never low.
 */
export function costToday(db: DatabaseSync, storeId: string, agentId?: string, zone = workspaceZone(db)): number {
  const midnight = new Date(startOfDay(zone)); // `zone`: Settings → General's preview of another one (ST-16)
  const row = db
    .prepare(`SELECT coalesce(sum(cost_usd), 0) AS cost FROM agent_runs WHERE store_id = ? AND coalesce(ended_at, iif(status = 'running', '~', created_at)) >= ? ${agentId ? 'AND agent_id = ?' : ''}`)
    .get(storeId, midnight.toISOString(), ...(agentId ? [agentId] : []));
  return Number(row?.cost ?? 0);
}

export function getAgent(db: DatabaseSync, id: string): Agent | undefined {
  const row = db.prepare('SELECT a.*, s.connected FROM agents a JOIN stores s ON s.id = a.store_id WHERE a.id = ?').get(id);
  return row && toAgent(row, busyAgents(db), costToday(db, String(row.store_id), id));
}

export function updateAgent(db: DatabaseSync, id: string, patch: AgentUpdate): Agent | undefined {
  if (patch.enabled !== undefined) db.prepare('UPDATE agents SET enabled = ? WHERE id = ?').run(patch.enabled ? 1 : 0, id);
  if (patch.autonomy !== undefined) db.prepare('UPDATE agents SET autonomy = ? WHERE id = ?').run(patch.autonomy, id);
  if (patch.dailyBudgetUsd !== undefined) {
    db.prepare(`UPDATE agents SET settings_json = CASE WHEN ? IS NULL THEN json_remove(settings_json, '$.dailyBudgetUsd') ELSE json_set(settings_json, '$.dailyBudgetUsd', ?) END WHERE id = ?`).run(
      patch.dailyBudgetUsd, patch.dailyBudgetUsd, id,
    );
  }
  return getAgent(db, id);
}

/**
 * agent id → title of its oldest pending approval request, → task of its oldest queued/running run, and → the error of
 * its latest finished run when that one failed (SQLite takes the bare columns from the max(created_at) row).
 */
function busyAgents(db: DatabaseSync) {
  const latestWins = (rows: Record<string, unknown>[]) => new Map(rows.map((r) => [String(r.agent_id), String(r.what)]));
  const finished = db.prepare(`SELECT agent_id, status, error AS what, max(created_at) FROM agent_runs WHERE status IN ('done', 'error', 'cancelled') GROUP BY agent_id`).all();
  return {
    waiting: latestWins(db.prepare(`SELECT agent_id, title AS what FROM approvals WHERE status = 'pending' ORDER BY created_at DESC`).all()),
    running: latestWins(db.prepare(`SELECT agent_id, task AS what FROM agent_runs WHERE status IN ('queued', 'running') ORDER BY created_at DESC`).all()),
    failed: latestWins(finished.filter((r) => r.status === 'error')),
  };
}

// Status is derived from the DB: offline > waiting for the owner > working on a run > last run failed > idle.
function toAgent(r: Record<string, unknown>, busy: ReturnType<typeof busyAgents>, costTodayUsd: number): Agent {
  const id = String(r.id);
  const enabled = r.enabled === 1;
  const request = enabled ? busy.waiting.get(id) : undefined;
  const task = enabled ? busy.running.get(id) : undefined;
  const failed = enabled ? busy.failed.get(id) : undefined;
  const currentTask = request ?? task ?? (failed && `Last run failed: ${failed}`);
  const own = (JSON.parse(String(r.settings_json ?? '{}')) as { dailyBudgetUsd?: unknown }).dailyBudgetUsd;
  return {
    id,
    storeId: String(r.store_id),
    role: r.role as AgentRole,
    status: !enabled ? 'offline' : request ? 'waiting_approval' : task ? 'running' : failed ? 'error' : 'idle',
    ...(currentTask ? { currentTask } : {}),
    enabled,
    autonomy: r.autonomy as Autonomy,
    ...(typeof own === 'number' ? { dailyBudgetUsd: own } : {}),
    costTodayUsd,
    engine: engineInfo(r.connected === 1),
  };
}
