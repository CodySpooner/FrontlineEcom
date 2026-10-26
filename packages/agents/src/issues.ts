import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { OrderIssue, OrderIssueStatus } from '@frontline/shared';
import { once } from './memory';

// Operations issue queue: one open issue per order and kind (partial unique index), resolved by the owner.

export type NewOrderIssue = Omit<OrderIssue, 'id' | 'status' | 'resolution' | 'createdAt' | 'resolvedAt'>;

const RANK = { low: 0, medium: 1, high: 2 };

/** Returns the new issue, or the one already open for this order and kind: raised (severity, note, next step) if this flag is more severe. */
export function flagOrderIssue(db: DatabaseSync, i: NewOrderIssue, now = new Date()): { issue: OrderIssue; created: boolean; raised?: boolean } {
  const id = randomUUID();
  const created =
    db
      .prepare(
        `INSERT OR IGNORE INTO order_issues (id, store_id, order_id, agent_id, kind, severity, note, suggested_action, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      )
      .run(id, i.storeId, i.orderId, i.agentId, i.kind, i.severity, i.note, i.suggestedAction ?? null, now.toISOString()).changes > 0;
  if (created) return { issue: toIssue(db.prepare('SELECT * FROM order_issues WHERE id = ?').get(id)!), created };
  const open = toIssue(db.prepare(`SELECT * FROM order_issues WHERE store_id = ? AND order_id = ? AND kind = ? AND status = 'open'`).get(i.storeId, i.orderId, i.kind)!);
  if (RANK[i.severity] <= RANK[open.severity]) return { issue: open, created };
  db.prepare('UPDATE order_issues SET severity = ?, note = ?, suggested_action = coalesce(?, suggested_action) WHERE id = ?').run(i.severity, i.note, i.suggestedAction ?? null, open.id);
  return { issue: toIssue(db.prepare('SELECT * FROM order_issues WHERE id = ?').get(open.id)!), created, raised: true };
}

/** Open first, then newest first; issues the order has since answered are closed first (the owner's page and the agent alike). */
export function listOrderIssues(db: DatabaseSync, q: { storeIds?: string[]; status?: OrderIssueStatus; limit?: number } = {}): OrderIssue[] {
  closeAnsweredIssues(db);
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (q.storeIds?.length) where.push(`store_id IN (${q.storeIds.map(() => '?').join(',')})`), args.push(...q.storeIds);
  if (q.status) where.push('status = ?'), args.push(q.status);
  return db
    .prepare(`SELECT * FROM order_issues ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY status = 'resolved', created_at DESC, rowid DESC LIMIT ?`)
    .all(...args, q.limit ?? 100)
    .map(toIssue);
}

/** The issue after the change; why not, if the order already has another open issue of this kind (one open per order and kind). */
export function setIssueStatus(db: DatabaseSync, id: string, status: OrderIssueStatus, resolution?: string, now = new Date()): OrderIssue | string | undefined {
  if (status === 'open') {
    const twin = db
      .prepare(`SELECT i.order_id, i.kind FROM order_issues i JOIN order_issues o ON o.store_id = i.store_id AND o.order_id = i.order_id AND o.kind = i.kind
         AND o.status = 'open' AND o.id != i.id WHERE i.id = ?`)
      .get(id);
    if (twin) return `Order ${twin.order_id} already has a newer open ${twin.kind} issue: work that one.`;
    once(db, `issue-reopened:${id}`, now); // only the owner reopens: it's theirs now, closeAnsweredIssues leaves it
  }
  db.prepare('UPDATE order_issues SET status = ?, resolution = ?, resolved_at = ? WHERE id = ?').run(
    status, status === 'resolved' ? (resolution ?? null) : null, status === 'resolved' ? now.toISOString() : null, id,
  );
  const r = db.prepare('SELECT * FROM order_issues WHERE id = ?').get(id);
  return r ? toIssue(r) : undefined;
}

/**
 * Issues the order itself has since answered: late/stuck once delivered, supplier once it has tracking, and all but
 * 'other' once it's refunded or cancelled (core syncs both as status 'refunded'). Checked on read. One the owner reopened
 * stays open (say, delivered but the customer says it never came).
 */
export function closeAnsweredIssues(db: DatabaseSync, now = new Date()) {
  const rows = db
    .prepare(
      `SELECT i.id, i.kind, o.status, o.fulfillment_status, o.tracking FROM order_issues i JOIN orders o ON o.store_id = i.store_id AND o.id = i.order_id
       WHERE i.status = 'open' AND ((i.kind IN ('late', 'stuck', 'supplier') AND o.fulfillment_status = 'delivered') OR (i.kind = 'supplier' AND o.tracking IS NOT NULL)
         OR (i.kind != 'other' AND o.status = 'refunded'))
         AND NOT EXISTS (SELECT 1 FROM done_once WHERE ref = 'issue-reopened:' || i.id)`,
    )
    .all();
  for (const r of rows) {
    const why = r.status === 'refunded' ? 'Order refunded or cancelled' : r.fulfillment_status === 'delivered' ? 'Delivered' : `Supplier shipped (tracking ${r.tracking})`;
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
