import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { PageDraft, PageDraftStatus } from '@frontline/shared';

// Store Developer drafts for the Store Builder. Status is derived from the latest `store.publish_page` approval for
// the draft, so it can't drift from the approvals table.

export type NewPageDraft = Omit<PageDraft, 'id' | 'status' | 'approvalId' | 'createdAt' | 'publishedAt'>;

const SELECT = `SELECT d.*, a.id AS approval_id, a.status AS approval_status FROM page_drafts d
  LEFT JOIN approvals a ON a.id = (
    SELECT id FROM approvals WHERE json_extract(action_json, '$.kind') = 'store.publish_page' AND json_extract(action_json, '$.payload.draftId') = d.id
    ORDER BY created_at DESC, rowid DESC LIMIT 1)`;

export function savePageDraft(db: DatabaseSync, d: NewPageDraft, now = new Date()): PageDraft {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO page_drafts (id, store_id, agent_id, run_id, kind, product_id, title, html, seo_title, seo_description, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, d.storeId, d.agentId, d.runId ?? null, d.kind, d.productId ?? null, d.title, d.html, d.seoTitle ?? null, d.seoDescription ?? null, d.notes, now.toISOString());
  return getPageDraft(db, id)!;
}

export function getPageDraft(db: DatabaseSync, id: string): PageDraft | undefined {
  const r = db.prepare(`${SELECT} WHERE d.id = ?`).get(id);
  return r ? toDraft(r) : undefined;
}

/** Newest first. */
export function listPageDrafts(db: DatabaseSync, q: { storeIds?: string[]; status?: PageDraftStatus; limit?: number } = {}): PageDraft[] {
  const ids = q.storeIds?.length ? q.storeIds : undefined;
  return db
    .prepare(`${SELECT} ${ids ? `WHERE d.store_id IN (${ids.map(() => '?').join(',')})` : ''} ORDER BY d.created_at DESC, d.rowid DESC LIMIT ?`)
    .all(...(ids ?? []), q.status ? 1000 : (q.limit ?? 100))
    .map(toDraft)
    .filter((d) => !q.status || d.status === q.status)
    .slice(0, q.limit ?? 100);
}

export const markPublished = (db: DatabaseSync, id: string, now = new Date()) =>
  db.prepare('UPDATE page_drafts SET published_at = ? WHERE id = ? AND published_at IS NULL').run(now.toISOString(), id).changes > 0;

export const deletePageDraft = (db: DatabaseSync, id: string) => db.prepare('DELETE FROM page_drafts WHERE id = ?').run(id).changes > 0;

function toDraft(r: Record<string, unknown>): PageDraft {
  const opt = (k: string) => (r[k] == null ? undefined : String(r[k]));
  const [runId, productId, seoTitle, seoDescription, approvalId, publishedAt] = ['run_id', 'product_id', 'seo_title', 'seo_description', 'approval_id', 'published_at'].map(opt);
  const status: PageDraftStatus = publishedAt
    ? 'published'
    : r.approval_status === 'pending' ? 'pending'
    : r.approval_status === 'approved' ? 'approved'
    : r.approval_status === 'denied' ? 'rejected'
    : 'draft';
  return {
    id: String(r.id),
    storeId: String(r.store_id),
    agentId: String(r.agent_id),
    ...(runId ? { runId } : {}),
    kind: r.kind as PageDraft['kind'],
    ...(productId ? { productId } : {}),
    title: String(r.title),
    html: String(r.html),
    ...(seoTitle ? { seoTitle } : {}),
    ...(seoDescription ? { seoDescription } : {}),
    notes: String(r.notes),
    status,
    ...(approvalId ? { approvalId } : {}),
    createdAt: String(r.created_at),
    ...(publishedAt ? { publishedAt } : {}),
  };
}
