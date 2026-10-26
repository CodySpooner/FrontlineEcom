import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { OrderIssue, OrderIssueStatus } from '@frontline/shared';

// Operations issue queue: one open issue per order and kind (partial unique index), resolved by the owner.

export type NewOrderIssue = Omit<OrderIssue, 'id' | 'status' | 'resolution' | 'createdAt' | 'resolvedAt'>;

/** Returns the new issue, or the one already open for this order and kind. */
export function flagOrderIssue(db: DatabaseSync, i: NewOrderIssue, now = new Date()): { issue: OrderIssue; created: boolean } {
  const id = randomUUID();
  const created =
    db
      .prepare(
        `INSERT OR IGNORE INTO order_issues (id, store_id, order_id, agent_id, kind, severity, note, suggested_action, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      )
      .run(id, i.storeId, i.orderId, i.agentId, i.kind, i.severity, i.note, i.suggestedAction ?? null, now.toISOString()).changes > 0;
  const row = created
    ? db.prepare('SELECT * FROM order_issues WHERE id = ?').get(id)
    : db.prepare(`SELECT * FROM order_issues WHERE store_id = ? AND order_id = ? AND kind = ? AND status = 'open'`).get(i.storeId, i.orderId, i.kind);
  return { issue: toIssue(row!), created };
}

/** Open first, then newest first. */
export function listOrderIssues(db: DatabaseSync, q: { storeIds?: string[]; status?: OrderIssueStatus; limit?: number } = {}): OrderIssue[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (q.storeIds?.length) where.push(`store_id IN (${q.storeIds.map(() => '?').join(',')})`), args.push(...q.storeIds);
  if (q.status) where.push('status = ?'), args.push(q.status);
  return db
    .prepare(`SELECT * FROM order_issues ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY status = 'resolved', created_at DESC, rowid DESC LIMIT ?`)
    .all(...args, q.limit ?? 100)
    .map(toIssue);
}

export function setIssueStatus(db: DatabaseSync, id: string, status: OrderIssueStatus, resolution?: string, now = new Date()): OrderIssue | undefined {
  db.prepare('UPDATE order_issues SET status = ?, resolution = ?, resolved_at = ? WHERE id = ?').run(
    status, status === 'resolved' ? (resolution ?? null) : null, status === 'resolved' ? now.toISOString() : null, id,
  );
  const r = db.prepare('SELECT * FROM order_issues WHERE id = ?').get(id);
  return r ? toIssue(r) : undefined;
}

/** Issues the order itself has since answered: late/stuck once delivered, supplier once it has tracking. Checked on read. */
export function closeAnsweredIssues(db: DatabaseSync, now = new Date()) {
  const rows = db
    .prepare(
      `SELECT i.id, i.kind, o.fulfillment_status, o.tracking FROM order_issues i JOIN orders o ON o.store_id = i.store_id AND o.id = i.order_id
       WHERE i.status = 'open' AND ((i.kind IN ('late', 'stuck', 'supplier') AND o.fulfillment_status = 'delivered') OR (i.kind = 'supplier' AND o.tracking IS NOT NULL))`,
    )
    .all();
  for (const r of rows) {
    const why = r.fulfillment_status === 'delivered' ? 'Delivered' : `Supplier shipped (tracking ${r.tracking})`;
    setIssueStatus(db, String(r.id), 'resolved', `${why}; closed automatically.`, now);
  }
}

function toIssue(r: Record<string, unknown>): OrderIssue {
  const opt = (k: string) => (r[k] == null ? undefined : String(r[k]));
  const [suggestedAction, resolution, resolvedAt] = ['suggested_action', 'resolution', 'resolved_at'].map(opt);
  return {
    id: String(r.id),
    storeId: String(r.store_id),
    orderId: String(r.order_id),
    agentId: String(r.agent_id),
    kind: r.kind as OrderIssue['kind'],
    severity: r.severity as OrderIssue['severity'],
    note: String(r.note),
    ...(suggestedAction ? { suggestedAction } : {}),
    status: r.status as OrderIssueStatus,
    ...(resolution ? { resolution } : {}),
    createdAt: String(r.created_at),
    ...(resolvedAt ? { resolvedAt } : {}),
  };
}
