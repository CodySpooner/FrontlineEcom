import { getPageDraft, markPublished } from '@frontline/agents';
import type { ApprovalRequest, PageDraft } from '@frontline/shared';
import type { Db } from '../db';
import { subscribe } from '../live';
import { notify } from '../settings';
import { localDate } from '../dates';
import { getStore } from '../stores';

/**
 * Calls `fn` once for each request approved in this DB, on the next tick (after the approval message itself has
 * reached every listener). The bus is process-wide, so the handler holds the DB weakly; `fn` gets it as an argument.
 */
export function onApproved(db: Db, fn: (db: Db, a: ApprovalRequest) => unknown) {
  const ref = new WeakRef(db);
  const off = subscribe((m) => {
    const db = ref.deref();
    if (!db) return off();
    if (m.type !== 'approval' || m.approval.status !== 'approved') return;
    if (!db.prepare(`SELECT 1 FROM approvals WHERE id = ? AND status = 'approved'`).get(m.approval.id)) return; // another DB's (tests)
    const a = m.approval;
    setImmediate(async () => {
      try {
        await fn(db, a);
      } catch (e) {
        console.error(`approved action ${a.action.kind} (${a.id}) failed:`, e);
      }
    });
  });
}

/**
 * Publishes a Store Builder draft: demo stores go live locally (a draft product the page is for becomes active);
 * connected stores get a notification to apply it by hand.
 */
export function publishDraft(db: Db, d: PageDraft) {
  const store = getStore(db, d.storeId);
  if (!store || d.publishedAt) return;
  if (store.connected) {
    // ponytail: needs core's Shopify productUpdate (descriptionHtml, seo) / pageCreate to push it.
    notify(db, { kind: 'info', title: `Publish on ${store.name} by hand: ${d.title}`, body: 'Approved. The page is in Store Builder; publishing to a connected store is not automated yet.', storeId: store.id });
    return;
  }
  markPublished(db, d.id);
  if (d.productId) db.prepare(`UPDATE products SET title = ?, status = 'active' WHERE store_id = ? AND id = ? AND status = 'draft'`).run(d.title, store.id, d.productId);
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

/** Creates draft products on the store's platform (core's Shopify `createProducts`); throws a readable error. */
export type CreateProducts = (storeId: string, products: Omit<AddProduct, 'researchProductId'>[]) => Promise<{ id: string; title: string }[]>;

/**
 * `store.add_products` (from the research screen or the Product Hunter): demo stores get the products as local drafts,
 * connected stores as drafts on the platform; then their Store Developer drafts each page. Returns the titles added.
 */
export async function addProducts(db: Db, a: ApprovalRequest, startRun: (agentId: string, task: string) => unknown, createRemote: CreateProducts): Promise<string[]> {
  const store = getStore(db, a.storeId);
  const products = ((a.action.payload as { products?: unknown })?.products ?? []) as AddProduct[];
  const valid = products.filter((p) => typeof p?.title === 'string' && p.title.trim() && typeof p.price === 'number' && p.price > 0);
  if (!store || !valid.length) return [];
  const titles = valid.map((p) => p.title.trim());
  let added: { id: string; title: string }[];
  if (store.connected) {
    try {
      added = await createRemote(store.id, valid.map((p, i) => ({ title: titles[i]!, price: p.price, compareAt: p.compareAt, cost: p.cost })));
    } catch (e) {
      notify(db, { kind: 'error', title: `Couldn't add products to ${store.name}`, body: `${(e as Error).message}. Approved: ${titles.join(', ')}. Add them by hand.`, storeId: store.id });
      return [];
    }
  } else {
    const image = db.prepare('SELECT image FROM research_products WHERE id = ?');
    const insert = db.prepare(
      `INSERT OR IGNORE INTO products (store_id, id, title, image, price, compare_at, cost, inventory, status) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'draft')`,
    );
    added = valid.map((p, i) => ({ id: p.researchProductId ? `research-${p.researchProductId}` : `approval-${a.id}-${i}`, title: titles[i]! }));
    for (const [i, p] of valid.entries()) {
      const id = added[i]!.id;
      const img = p.researchProductId ? image.get(p.researchProductId)?.image : undefined;
      insert.run(store.id, id, titles[i]!, img == null ? null : String(img), p.price, p.compareAt ?? null, p.cost ?? 0);
    }
  }
  // Remembered so the product can be judged on its first 14 days of sales (checkProductOutcomes).
  const test = db.prepare('INSERT OR IGNORE INTO product_tests (store_id, product_id, approval_id, agent_id, title, added_on) VALUES (?, ?, ?, ?, ?, ?)');
  for (const p of added) test.run(store.id, p.id, a.id, a.agentId, p.title, localDate());
  startRun(
    `${store.id}:store_developer`,
    `New draft product(s) just added to ${store.name}: ${added.map((p) => `${p.title} (productId ${p.id})`).join(', ')}. For each, write the product page ` +
      '(benefit-led title, description with 5 bullets, SEO title and meta description; check the price against list_products and competitors), ' +
      'save it with draft_page (kind product) and ask to publish it with publish_page.',
  );
  return added.map((p) => p.title);
}
