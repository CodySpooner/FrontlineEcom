import type { DatabaseSync } from 'node:sqlite';
import { AGENT_ROLES, type Agent, type AgentRole, type AgentUpdate, type Autonomy, type Store } from '@frontline/shared';
import { demoXp, levelForXp, levelProgress, rankForLevel, xpForLevel } from './gamification';

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

/** The showcase stores' squads start with some history so levels and ranks vary. Only touches agents still at 0 XP. */
export function seedDemoXp(db: DatabaseSync, storeIds: string[]) {
  const set = db.prepare('UPDATE agents SET xp = ?, level = ? WHERE id = ? AND xp = 0');
  for (const a of listAgents(db, storeIds)) set.run(demoXp(a.id), levelForXp(demoXp(a.id)), a.id);
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
  const busy = busyAgents(db);
  return rows.map((r) => toAgent(r, busy));
}

export function getAgent(db: DatabaseSync, id: string): Agent | undefined {
  const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
  return row && toAgent(row, busyAgents(db));
}

export function updateAgent(db: DatabaseSync, id: string, patch: AgentUpdate): Agent | undefined {
  if (patch.enabled !== undefined) db.prepare('UPDATE agents SET enabled = ? WHERE id = ?').run(patch.enabled ? 1 : 0, id);
  if (patch.autonomy !== undefined) db.prepare('UPDATE agents SET autonomy = ? WHERE id = ?').run(patch.autonomy, id);
  return getAgent(db, id);
}

/** agent id → title of its oldest pending approval request, and → task of its oldest queued/running run. */
function busyAgents(db: DatabaseSync) {
  const latestWins = (rows: Record<string, unknown>[]) => new Map(rows.map((r) => [String(r.agent_id), String(r.what)]));
  return {
    waiting: latestWins(db.prepare(`SELECT agent_id, title AS what FROM approvals WHERE status = 'pending' ORDER BY created_at DESC`).all()),
    running: latestWins(db.prepare(`SELECT agent_id, task AS what FROM agent_runs WHERE status IN ('queued', 'running') ORDER BY created_at DESC`).all()),
  };
}

// Status is derived from the DB: offline > waiting for the owner > working on a run > idle.
function toAgent(r: Record<string, unknown>, busy: ReturnType<typeof busyAgents>): Agent {
  const id = String(r.id);
  const enabled = r.enabled === 1;
  const request = enabled ? busy.waiting.get(id) : undefined;
  const task = enabled ? busy.running.get(id) : undefined;
  const currentTask = request ?? task;
  return {
    id,
    storeId: String(r.store_id),
    role: r.role as AgentRole,
    status: !enabled ? 'offline' : request ? 'waiting_approval' : task ? 'running' : 'idle',
    level: levelForXp(Number(r.xp)),
    xp: Number(r.xp),
    rank: rankForLevel(levelForXp(Number(r.xp))),
    nextLevelXp: xpForLevel(levelForXp(Number(r.xp)) + 1),
    levelProgress: levelProgress(Number(r.xp)),
    ...(currentTask ? { currentTask } : {}),
    enabled,
    autonomy: r.autonomy as Autonomy,
  };
}
