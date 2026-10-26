import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { FlowDraft, FlowMessage } from '@frontline/shared';

// Email & SMS flows the agent designs. No sending integration yet: the owner sets them up in their email/SMS tool.

export type NewFlowDraft = Omit<FlowDraft, 'id' | 'createdAt'>;

/** Saves a flow; a newer draft of the same flow (name, per store) replaces the old one. */
export function saveFlowDraft(db: DatabaseSync, f: NewFlowDraft, now = new Date()): FlowDraft {
  const id = randomUUID();
  db.prepare('DELETE FROM flow_drafts WHERE store_id = ? AND lower(name) = lower(?)').run(f.storeId, f.name);
  db.prepare(
    'INSERT INTO flow_drafts (id, store_id, agent_id, run_id, name, trigger, messages_json, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, f.storeId, f.agentId, f.runId ?? null, f.name, f.trigger, JSON.stringify(f.messages), f.notes, now.toISOString());
  return toFlow(db.prepare('SELECT * FROM flow_drafts WHERE id = ?').get(id)!);
}

/** Newest first. */
export function listFlowDrafts(db: DatabaseSync, q: { storeIds?: string[]; limit?: number } = {}): FlowDraft[] {
  const ids = q.storeIds ?? [];
  return db
    .prepare(`SELECT * FROM flow_drafts ${ids.length ? `WHERE store_id IN (${ids.map(() => '?').join(',')})` : ''} ORDER BY created_at DESC, rowid DESC LIMIT ?`)
    .all(...ids, q.limit ?? 50)
    .map(toFlow);
}

export const deleteFlowDraft = (db: DatabaseSync, id: string) => db.prepare('DELETE FROM flow_drafts WHERE id = ?').run(id).changes > 0;

function toFlow(r: Record<string, unknown>): FlowDraft {
  return {
    id: String(r.id),
    storeId: String(r.store_id),
    agentId: String(r.agent_id),
    ...(r.run_id ? { runId: String(r.run_id) } : {}),
    name: String(r.name),
    trigger: String(r.trigger),
    messages: JSON.parse(String(r.messages_json)) as FlowMessage[],
    notes: String(r.notes),
    createdAt: String(r.created_at),
  };
}
