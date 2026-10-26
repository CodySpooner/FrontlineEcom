import type { ApprovalRequest } from '@frontline/shared';
import type { Db } from '../db';
import { subscribe } from '../live';
import { notify } from '../settings';
import { getStore } from '../stores';

/**
 * Calls `fn` once for each request approved in this DB, on the next tick (after the approval message itself has
 * reached every listener). The bus is process-wide, so the handler holds the DB weakly; `fn` gets it as an argument.
 */
export function onApproved(db: Db, fn: (db: Db, a: ApprovalRequest) => void) {
  const ref = new WeakRef(db);
  const off = subscribe((m) => {
    const db = ref.deref();
    if (!db) return off();
    if (m.type !== 'approval' || m.approval.status !== 'approved') return;
    if (!db.prepare(`SELECT 1 FROM approvals WHERE id = ? AND status = 'approved'`).get(m.approval.id)) return; // another DB's (tests)
    const a = m.approval;
    setImmediate(() => fn(db, a));
  });
}

/** Approved `ads.set_budget` / `ads.pause_campaign` on a demo store's campaigns. Connected stores: the owner is told. */
export function applyAdChange(db: Db, a: ApprovalRequest) {
  const p = (a.action.payload ?? {}) as { campaignId?: unknown; to?: unknown };
  const store = getStore(db, a.storeId);
  if (!store || typeof p.campaignId !== 'string') return;
  if (store.connected) {
    // ponytail: real ad accounts change through the Meta MCP (the agent's own call, approved there) or by hand.
    notify(db, { kind: 'info', title: `Apply on the ad account: ${a.title}`, body: 'Approved. Ad account changes are not automated for this store yet.', storeId: store.id });
    return;
  }
  if (a.action.kind === 'ads.pause_campaign') db.prepare(`UPDATE campaigns SET status = 'paused' WHERE id = ? AND store_id = ?`).run(p.campaignId, store.id);
  if (a.action.kind === 'ads.set_budget' && typeof p.to === 'number' && p.to >= 0) {
    db.prepare('UPDATE campaigns SET daily_budget = ? WHERE id = ? AND store_id = ?').run(p.to, p.campaignId, store.id);
  }
}

interface AddProduct {
  researchProductId?: string;
  title: string;
  price: number;
  compareAt?: number;
  cost?: number;
}

/**
 * `store.add_products` (from the research screen or the Product Hunter): demo stores get the products as drafts and
 * their Store Developer drafts each page. Returns the titles added.
 */
export function addProducts(db: Db, a: ApprovalRequest, startRun: (agentId: string, task: string) => unknown): string[] {
  const store = getStore(db, a.storeId);
  const products = ((a.action.payload as { products?: unknown })?.products ?? []) as AddProduct[];
  const valid = products.filter((p) => typeof p?.title === 'string' && p.title.trim() && typeof p.price === 'number' && p.price > 0);
  if (!store || !valid.length) return [];
  const titles = valid.map((p) => p.title.trim());
  if (store.connected) {
    // ponytail: no store writes yet; needs core's Shopify productCreate (write_products scope).
    notify(db, { kind: 'info', title: `Add ${titles.length} product(s) to ${store.name} by hand`, body: `Approved: ${titles.join(', ')}. Adding products to a connected store isn't automated yet.`, storeId: store.id });
    return [];
  }
  const image = db.prepare('SELECT image FROM research_products WHERE id = ?');
  const insert = db.prepare(
    `INSERT OR IGNORE INTO products (store_id, id, title, image, price, compare_at, cost, inventory, status) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'draft')`,
  );
  for (const p of valid) {
    const id = p.researchProductId ? `research-${p.researchProductId}` : `approval-${a.id}-${titles.indexOf(p.title.trim())}`;
    const img = p.researchProductId ? image.get(p.researchProductId)?.image : undefined;
    insert.run(store.id, id, p.title.trim(), img == null ? null : String(img), p.price, p.compareAt ?? null, p.cost ?? 0);
  }
  startRun(
    `${store.id}:store_developer`,
    `New draft product(s) just added to ${store.name}: ${titles.join(', ')}. For each, draft the product page: title, benefit-led description, ` +
      '5 bullets, SEO title and meta description, and check the price against list_products and competitors. Reply with copy ready to paste.',
  );
  return titles;
}
