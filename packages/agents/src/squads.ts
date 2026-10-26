import type { DatabaseSync } from 'node:sqlite';
import { AGENT_ROLES, type Agent, type AgentRole, type AgentUpdate, type Autonomy, type Store } from '@frontline/shared';

// Squads live in core's `agents` table (apps/server/src/db.ts). Agent id = `<storeId>:<role>`.

/** Every role starts at 'ask': agents propose, the owner approves (DESIGN principle 3). */
export const DEFAULT_AUTONOMY: Autonomy = 'ask';

export const agentId = (storeId: string, role: AgentRole) => `${storeId}:${role}`;

/** One agent per role for the store. Idempotent: existing agents keep their level, XP and settings. */
export function createSquad(db: DatabaseSync, store: Pick<Store, 'id'>): Agent[] {
  const insert = db.prepare('INSERT OR IGNORE INTO agents (id, store_id, role, autonomy) VALUES (?, ?, ?, ?)');
  for (const role of Object.keys(AGENT_ROLES) as AgentRole[]) insert.run(agentId(store.id, role), store.id, role, DEFAULT_AUTONOMY);
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
    .prepare(`SELECT a.* FROM agents a JOIN stores s ON s.id = a.store_id ${filter} ORDER BY s.created_at, s.rowid, a.rowid`)
    .all(...(storeIds?.length ? storeIds : []));
  const waiting = pendingApprovals(db);
  return rows.map((r) => toAgent(r, waiting));
}

export function getAgent(db: DatabaseSync, id: string): Agent | undefined {
  const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
  return row && toAgent(row, pendingApprovals(db));
}

export function updateAgent(db: DatabaseSync, id: string, patch: AgentUpdate): Agent | undefined {
  if (patch.enabled !== undefined) db.prepare('UPDATE agents SET enabled = ? WHERE id = ?').run(patch.enabled ? 1 : 0, id);
  if (patch.autonomy !== undefined) db.prepare('UPDATE agents SET autonomy = ? WHERE id = ?').run(patch.autonomy, id);
  if (patch.autopilotCapUsd !== undefined)
    db.prepare(`UPDATE agents SET settings_json = json_set(settings_json, '$.autopilotCapUsd', ?) WHERE id = ?`).run(patch.autopilotCapUsd, id);
  return getAgent(db, id);
}

/** agent id → title of its oldest pending approval request. */
function pendingApprovals(db: DatabaseSync) {
  const rows = db.prepare(`SELECT agent_id, title FROM approvals WHERE status = 'pending' ORDER BY created_at DESC`).all();
  return new Map(rows.map((r) => [String(r.agent_id), String(r.title)]));
}

// ponytail: status is derived from the DB; the run manager (AGT-11) adds live 'running' + current task.
function toAgent(r: Record<string, unknown>, waiting: Map<string, string>): Agent {
  const id = String(r.id);
  const enabled = r.enabled === 1;
  const request = enabled ? waiting.get(id) : undefined;
  return {
    id,
    storeId: String(r.store_id),
    role: r.role as AgentRole,
    status: !enabled ? 'offline' : request ? 'waiting_approval' : 'idle',
    level: Number(r.level),
    xp: Number(r.xp),
    ...(request ? { currentTask: request } : {}),
    enabled,
    autonomy: r.autonomy as Autonomy,
    autopilotCapUsd: Number(JSON.parse(String(r.settings_json ?? '{}')).autopilotCapUsd ?? 0),
  };
}
