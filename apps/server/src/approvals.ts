import { randomUUID } from 'node:crypto';
import type { ApprovalDecision, ApprovalRequest, ApprovalsHook, ApprovalStatus } from '@frontline/shared';
import type { Db } from './db';
import { publish, subscribe } from './live';
import { notify } from './settings';

type Row = Record<string, unknown>;

const toApproval = (r: Row): ApprovalRequest => ({
  id: String(r.id),
  storeId: String(r.store_id),
  agentId: String(r.agent_id),
  title: String(r.title),
  reason: String(r.reason),
  action: JSON.parse(String(r.action_json)),
  status: r.status as ApprovalStatus,
  createdAt: String(r.created_at),
  ...(r.run_id ? { runId: String(r.run_id) } : {}),
  ...(r.decided_at ? { decidedAt: String(r.decided_at) } : {}),
  ...(r.decision_note ? { decisionNote: String(r.decision_note) } : {}),
  ...(r.conversation_id ? { conversationId: String(r.conversation_id) } : {}),
});

/** With the asking run's conversation, where a question is answered. */
const SELECT = 'SELECT a.*, r.conversation_id FROM approvals a LEFT JOIN agent_runs r ON r.id = a.run_id';

export const getApproval = (db: Db, id: string) => {
  const r = db.prepare(`${SELECT} WHERE a.id = ?`).get(id);
  return r ? toApproval(r) : undefined;
};

/** Newest first; `status` omitted = all. */
export function listApprovals(db: Db, storeIds: string[], status?: ApprovalStatus): ApprovalRequest[] {
  if (!storeIds.length) return [];
  const args: string[] = [...storeIds];
  if (status) args.push(status);
  return db
    .prepare(`${SELECT} WHERE a.store_id IN (${storeIds.map(() => '?').join(',')}) ${status ? 'AND a.status = ?' : ''} ORDER BY a.created_at DESC, a.rowid DESC`)
    .all(...args)
    .map(toApproval);
}

/**
 * Approves or denies a pending request (a denial can carry the owner's `note`, an answered question its answer) and
 * broadcasts it. Returns undefined if missing, 'decided' if not pending.
 */
export function decide(db: Db, id: string, decision: ApprovalDecision, note?: string): ApprovalRequest | 'decided' | undefined {
  const status: ApprovalStatus = decision === 'approve' ? 'approved' : 'denied';
  const changed = db
    .prepare("UPDATE approvals SET status = ?, decided_at = ?, decision_note = ? WHERE id = ? AND status = 'pending'")
    .run(status, new Date().toISOString(), note ?? null, id).changes;
  const a = getApproval(db, id);
  if (!a) return undefined;
  if (!changed) return 'decided';
  publish({ type: 'approval', approval: a });
  return a;
}

/**
 * Closes a store's pending requests of `kinds` that can't be carried out as asked any more. `why` (`[Expired: …]`) ends
 * the reason, so the squad doesn't take it as the owner's no.
 */
export function expireRequests(db: Db, storeId: string, kinds: string[], why: string) {
  const ids = db
    .prepare(`SELECT id FROM approvals WHERE store_id = ? AND status = 'pending' AND action_json ->> '$.kind' IN (SELECT value FROM json_each(?))`)
    .all(storeId, JSON.stringify(kinds));
  for (const r of ids) {
    const id = String(r.id);
    db.prepare('UPDATE approvals SET reason = reason || ? WHERE id = ?').run(` ${why}`, id);
    decide(db, id, 'deny');
  }
}

/** Broadcasts the requests a restored backup closed (openDb), once: call it when the server's handlers listen. */
export function announceRestoreClosed(db: Db) {
  const r = db.prepare("SELECT value_json FROM settings WHERE key = 'restore_closed'").get();
  if (!r) return;
  db.prepare("DELETE FROM settings WHERE key = 'restore_closed'").run();
  for (const id of JSON.parse(String(r.value_json)) as string[]) {
    const a = getApproval(db, id);
    if (a) publish({ type: 'approval', approval: a });
  }
}

/** The in-process hook the agents engine uses to ask the owner and wait for the answer. */
export const approvalsHook = (db: Db): ApprovalsHook => ({
  create(input) {
    const conversation = input.runId && db.prepare('SELECT conversation_id FROM agent_runs WHERE id = ?').get(input.runId)?.conversation_id;
    const a: ApprovalRequest = { id: randomUUID(), ...input, status: 'pending', createdAt: new Date().toISOString(), ...(conversation ? { conversationId: String(conversation) } : {}) };
    db.prepare('INSERT INTO approvals (id, store_id, agent_id, run_id, title, reason, action_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      a.id, a.storeId, a.agentId, a.runId ?? null, a.title, a.reason, JSON.stringify(a.action), a.status, a.createdAt,
    );
    publish({ type: 'approval', approval: a });
    // A question is answered in its conversation (decision 5).
    const link = a.action.kind === 'question' && a.conversationId ? `/agents/c/${encodeURIComponent(a.conversationId)}?store=${encodeURIComponent(a.storeId)}` : '/';
    notify(db, { kind: 'approval', title: a.title, body: a.reason, storeId: a.storeId, link });
    return a;
  },
  decision(id) {
    return new Promise((resolve, reject) => {
      // Subscribe before reading so a decision landing in between is not missed.
      const off = subscribe((m) => {
        if (m.type === 'approval' && m.approval.id === id && m.approval.status !== 'pending') {
          off();
          resolve(m.approval);
        }
      });
      const a = getApproval(db, id);
      if (!a) {
        off();
        reject(new Error(`approval ${id} not found`));
      } else if (a.status !== 'pending') {
        off();
        resolve(a);
      }
    });
  },
});
