import { getPageDraft, markPublished } from '@frontline/agents';
import type { AdNetwork, ApprovalRequest, PageDraft } from '@frontline/shared';
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

/** Pushes a draft to the store's platform (core's Shopify productUpdate / pageCreate); throws a readable error. */
export type PushPage = (d: PageDraft) => Promise<unknown>;

/**
 * Publishes a Store Builder draft: connected stores get it on the platform (an error tells the owner and leaves it
 * approved); demo stores go live locally, and a draft product the page is for becomes active.
 */
export async function publishDraft(db: Db, d: PageDraft, push: PushPage) {
  const store = getStore(db, d.storeId);
  if (!store || d.publishedAt) return;
  if (store.connected) {
    try {
      await push(d);
    } catch (e) {
      notify(db, { kind: 'error', title: `Couldn't publish "${d.title}" to ${store.name}`, body: `${(e as Error).message}. It's approved and waiting in Store Builder.`, storeId: store.id });
      return;
    }
    markPublished(db, d.id);
    return;
  }
  markPublished(db, d.id);
  if (d.productId) db.prepare(`UPDATE products SET title = ?, status = 'active' WHERE store_id = ? AND id = ? AND status = 'draft'`).run(d.title, store.id, d.productId);
}

/** Writes an approved change to the store's ad account (core's connectors/ads.ts); throws a readable error. */
export type WriteAd = (storeId: string, network: AdNetwork, campaignId: string, change: 'pause' | { dailyBudget: number }) => Promise<unknown>;

/**
 * Applies an approved ad change: connected stores on the ad account first (an error tells the owner and leaves the
 * campaign as it was), then the local campaign row; demo stores locally only.
 */
export async function applyAdChange(db: Db, a: ApprovalRequest, write: WriteAd) {
  const p = (a.action.payload ?? {}) as { network?: unknown; campaignId?: unknown; to?: unknown };
  const store = getStore(db, a.storeId);
  const pause = a.action.kind === 'ads.pause_campaign';
  if (!store || typeof p.campaignId !== 'string' || (!pause && !(typeof p.to === 'number' && p.to >= 1))) return;
  const network = (typeof p.network === 'string' ? p.network : db.prepare('SELECT network FROM campaigns WHERE id = ? AND store_id = ?').get(p.campaignId, store.id)?.network) as AdNetwork;
  if (store.connected) {
    try {
      await write(store.id, network, p.campaignId, pause ? 'pause' : { dailyBudget: p.to as number });
    } catch (e) {
      notify(db, { kind: 'error', title: `Couldn't apply "${a.title}" on the ad account`, body: `${(e as Error).message}. Apply it by hand in the ad manager.`, storeId: store.id });
      return;
    }
  }
  if (pause) db.prepare(`UPDATE campaigns SET status = 'paused' WHERE id = ? AND store_id = ?`).run(p.campaignId, store.id);
  else db.prepare('UPDATE campaigns SET daily_budget = ? WHERE id = ? AND store_id = ?').run(p.to as number, p.campaignId, store.id);
}

/**
 * Applies an approved price test: demo stores change the product locally; connected stores are told to change it by hand
 * (until core has a price setter). Either way it's recorded so checkPriceOutcomes can judge it.
 */
/** Writes an approved price to the store's platform (core's Shopify `setProductPrice`, which also updates the local row); throws a readable error. */
export type SetPrice = (storeId: string, productId: string, change: { price: number; compareAt?: number }) => Promise<unknown>;

/**
 * Applies an approved `store.set_price` and starts its 14-day test: connected stores on the platform (an error tells
 * the owner and starts no test), demo stores locally.
 */
export async function applyPriceChange(db: Db, a: ApprovalRequest, setPrice: SetPrice) {
  const p = (a.action.payload ?? {}) as { productId?: unknown; title?: unknown; from?: unknown; to?: unknown; compareAt?: unknown };
  const store = getStore(db, a.storeId);
  if (!store || typeof p.productId !== 'string' || typeof p.to !== 'number' || typeof p.from !== 'number') return;
  const compareAt = typeof p.compareAt === 'number' ? p.compareAt : undefined;
  if (store.connected) {
    try {
      await setPrice(store.id, p.productId, { price: p.to, ...(compareAt !== undefined ? { compareAt } : {}) });
    } catch (e) {
      notify(db, { kind: 'error', title: `Couldn't change the price on ${store.name}: ${a.title}`, body: `${(e as Error).message}. Change it by hand if you still want the test.`, storeId: store.id });
      return;
    }
  } else {
    db.prepare('UPDATE products SET price = ?, compare_at = coalesce(?, compare_at) WHERE store_id = ? AND id = ?').run(p.to, compareAt ?? null, store.id, p.productId);
  }
  db.prepare('INSERT OR IGNORE INTO price_tests (approval_id, store_id, product_id, agent_id, title, from_price, to_price, changed_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    a.id, store.id, p.productId, a.agentId, String(p.title ?? a.title), p.from, p.to, localDate(),
  );
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
      notify(db, { kind: 'error', title: `Couldn't add products to ${store.name}`, body: `${(e as Error).message}. Approved: ${titles.join(', ')}. Add any not created yet by hand.`, storeId: store.id });
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
