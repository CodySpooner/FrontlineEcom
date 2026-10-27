import { cash, closedByApp, getPageDraft, IDLE_CAMPAIGN_STATUSES, markPublished, once, writeMemory } from '@frontline/agents';
import type { AdNetwork, ApprovalRequest, PageDraft } from '@frontline/shared';
import type { Db } from '../db';
import { publish, subscribe } from '../live';
import { getApproval } from '../approvals';
import { notify } from '../settings';
import { localDate } from '../dates';
import { getStore, storeZone } from '../stores';
import type { ShopifyTheme } from '../connectors/shopify';

/**
 * Calls `fn` once for each request approved (or denied) in this DB, on the next tick (after the approval message itself
 * has reached every listener). The bus is process-wide, so the handler holds the DB weakly; `fn` gets it as an argument.
 */
export function onDecision(db: Db, status: 'approved' | 'denied', fn: (db: Db, a: ApprovalRequest) => unknown) {
  const ref = new WeakRef(db);
  const done = new Set<string>(); // a repeated message (publishDraft says it again) doesn't run the action twice
  const off = subscribe((m) => {
    const db = ref.deref();
    if (!db) return off();
    if (m.type !== 'approval' || m.approval.status !== status || done.has(m.approval.id)) return;
    if (!db.prepare(`SELECT 1 FROM approvals WHERE id = ? AND status = ?`).get(m.approval.id, status)) return; // another DB's (tests)
    done.add(m.approval.id);
    const a = m.approval;
    setImmediate(async () => {
      try {
        await fn(db, a);
      } catch (e) {
        console.error(`${status} action ${a.action.kind} (${a.id}) failed:`, e);
      }
    });
  });
}

export const onApproved = (db: Db, fn: (db: Db, a: ApprovalRequest) => unknown) => onDecision(db, 'approved', fn);

/** Pushes a draft to the store's platform (core's Shopify productUpdate / pageCreate); throws a readable error. */
export type PushPage = (d: PageDraft) => Promise<unknown>;

/** Drafts on their way to a platform: a second publish (the owner's retry while the approval's push runs) would create the page twice. */
const pushing = new Set<string>();

/**
 * Publishes a Store Builder draft: connected stores get it on the platform (an error tells the owner and leaves it
 * approved); demo stores go live locally, and a draft product the page is for becomes active.
 */
export async function publishDraft(db: Db, d: PageDraft, push: PushPage) {
  const store = getStore(db, d.storeId);
  if (!store || d.publishedAt || pushing.has(d.id)) return;
  if (store.connected) {
    pushing.add(d.id);
    try {
      await push(d);
    } catch (e) {
      notify(db, { kind: 'error', title: `Couldn't publish "${d.title}" to ${store.name}`, body: `${(e as Error).message}. It's ${d.status === 'approved' ? 'approved and ' : ''}waiting in Store Builder.`, storeId: store.id });
      return;
    } finally {
      pushing.delete(d.id);
    }
    markPublished(db, d.id);
    // The approval's own message went out while the push ran: say it again so the Store Builder reads "published".
    const a = d.approvalId ? getApproval(db, d.approvalId) : undefined;
    if (a?.status === 'approved') publish({ type: 'approval', approval: a }); // a denied one would replay the owner's no
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
/** Days an ad change stays fresh enough to apply once approved. */
const STALE_DAYS = 3;

/** A request approved after its number moved (the owner edited it, or a sync brought a change): applying it would undo that. */
const moved = (from: number, now: number) => Math.abs(now - from) > from * 0.01;

export async function applyAdChange(db: Db, a: ApprovalRequest, write: WriteAd) {
  const p = (a.action.payload ?? {}) as { network?: unknown; campaignId?: unknown; from?: unknown; to?: unknown };
  const store = getStore(db, a.storeId);
  const pause = a.action.kind === 'ads.pause_campaign';
  if (!store || typeof p.campaignId !== 'string' || (!pause && !(typeof p.to === 'number' && p.to >= 1 && typeof p.from === 'number'))) return;
  const c = db.prepare('SELECT network, daily_budget, status FROM campaigns WHERE id = ? AND store_id = ?').get(p.campaignId, store.id);
  const network = (typeof p.network === 'string' ? p.network : c?.network) as AdNetwork;
  // Nothing changes (already off, refused, failed): `not-applied` keeps checkAdOutcomes from scoring it.
  const skip = () => void once(db, `not-applied:${a.id}`);
  if (pause && c && IDLE_CAMPAIGN_STATUSES.includes(String(c.status))) return skip(); // Meta's delivering ones read in_process, with_issues…
  // A real account's results move in days: a change asked on last week's numbers is asked again, not applied.
  const days = Math.floor((Date.parse(a.decidedAt ?? new Date().toISOString()) - Date.parse(a.createdAt)) / 86_400_000);
  if (store.connected && days > STALE_DAYS) {
    notify(db, { kind: 'info', title: `Not applied: "${a.title}"`, body: `It was asked ${days} days ago, on numbers that have moved since. Ask the Ad Strategist again for a fresh read.`, storeId: store.id });
    return skip();
  }
  if (!pause && typeof p.from === 'number' && c && moved(p.from, Number(c.daily_budget))) {
    notify(db, { kind: 'info', title: `Not applied: "${a.title}"`, body: `The budget moved since this was asked (${cash(p.from, store.currency)} → now ${cash(Number(c.daily_budget), store.currency)}). Ask the Ad Strategist again if it still makes sense.`, storeId: store.id });
    return skip();
  }
  if (store.connected) {
    try {
      await write(store.id, network, p.campaignId, pause ? 'pause' : { dailyBudget: p.to as number });
    } catch (e) {
      skip();
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
  // A live store's sales and its competitors' prices move in weeks: a test asked on two-week-old numbers is asked again.
  const days = Math.floor((Date.parse(a.decidedAt ?? new Date().toISOString()) - Date.parse(a.createdAt)) / 86_400_000);
  if (store.connected && days > 14) {
    once(db, `not-applied:${a.id}`);
    notify(db, { kind: 'info', title: `Not applied: "${a.title}"`, body: `It was asked ${days} days ago, on prices that may have moved since. Ask the Market Analyst again for a fresh read.`, storeId: store.id });
    return;
  }
  const now = db.prepare('SELECT price FROM products WHERE store_id = ? AND id = ?').get(store.id, p.productId)?.price;
  if (now != null && moved(p.from, Number(now))) {
    once(db, `not-applied:${a.id}`); // squad_log: approved, not shipped
    notify(db, { kind: 'info', title: `Not applied: "${a.title}"`, body: `The price moved since this was asked (${cash(p.from, store.currency)} → now ${cash(Number(now), store.currency)}). Ask the Market Analyst again if it still makes sense.`, storeId: store.id });
    return;
  }
  const compareAt = typeof p.compareAt === 'number' ? p.compareAt : undefined;
  if (store.connected) {
    try {
      await setPrice(store.id, p.productId, { price: p.to, ...(compareAt !== undefined ? { compareAt } : {}) });
    } catch (e) {
      once(db, `not-applied:${a.id}`);
      notify(db, { kind: 'error', title: `Couldn't change the price on ${store.name}: ${a.title}`, body: `${(e as Error).message}. Change it by hand if you still want the test.`, storeId: store.id });
      return;
    }
  } else {
    db.prepare('UPDATE products SET price = ?, compare_at = coalesce(?, compare_at) WHERE store_id = ? AND id = ?').run(p.to, compareAt ?? null, store.id, p.productId);
  }
  db.prepare('INSERT OR IGNORE INTO price_tests (approval_id, store_id, product_id, agent_id, title, from_price, to_price, changed_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    a.id, store.id, p.productId, a.agentId, String(p.title ?? a.title), p.from, p.to, localDate(new Date(), storeZone(db, store.id)), // the store's day, as its orders
  );
}

interface AddProduct {
  researchProductId?: string;
  title: string;
  price: number;
  compareAt?: number;
  cost?: number;
}

/** Products being created on a platform (store + lower-cased title): a second approval in the same second skips them. */
const adding = new Set<string>();

/** Creates draft products on the store's platform (core's Shopify `createProducts`); throws a readable error. */
export type CreateProducts = (storeId: string, products: Omit<AddProduct, 'researchProductId'>[]) => Promise<{ id: string; title: string }[]>;

/**
 * `store.add_products` (from the research screen or the Product Hunter): demo stores get the products as local drafts,
 * connected stores as drafts on the platform; then their Store Developer drafts each page. Returns the titles added.
 */
export async function addProducts(db: Db, a: ApprovalRequest, startRun: (agentId: string, task: string) => unknown, createRemote: CreateProducts): Promise<string[]> {
  const store = getStore(db, a.storeId);
  const products = ((a.action.payload as { products?: unknown })?.products ?? []) as AddProduct[];
  if (!store) return [];
  // One an earlier request already added and the store still has (the same find asked twice, both approved) isn't made twice.
  const have = db.prepare(
    'SELECT 1 FROM product_tests t JOIN products p ON p.store_id = t.store_id AND p.id = t.product_id WHERE t.store_id = ? AND t.approval_id != ? AND lower(t.title) = lower(?)',
  );
  // `have` only sees one once its create returned: one still on its way is claimed here, before the network call.
  const key = (p: AddProduct) => `${store.id}:${p.title.trim().toLowerCase()}`;
  const valid = products.filter(
    (p) => typeof p?.title === 'string' && p.title.trim() && typeof p.price === 'number' && p.price > 0 && !adding.has(key(p)) && !have.get(store.id, a.id, p.title.trim()),
  );
  if (!valid.length) return [];
  const titles = valid.map((p) => p.title.trim());
  let added: { id: string; title: string }[];
  if (store.connected) {
    const claimed = valid.map(key);
    for (const k of claimed) adding.add(k);
    try {
      added = await createRemote(store.id, valid.map((p, i) => ({ title: titles[i]!, price: p.price, compareAt: p.compareAt, cost: p.cost })));
    } catch (e) {
      notify(db, { kind: 'error', title: `Couldn't add products to ${store.name}`, body: `${(e as Error).message}. Approved: ${titles.join(', ')}. Add any not created yet by hand.`, storeId: store.id });
      return [];
    } finally {
      for (const k of claimed) adding.delete(k); // product_tests (written below, before any other await) answers from here on
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
  for (const p of added) test.run(store.id, p.id, a.id, a.agentId, p.title, localDate(new Date(), storeZone(db, store.id)));
  startRun(
    `${store.id}:store_developer`,
    `New draft product(s) just added to ${store.name}: ${added.map((p) => `${p.title} (productId ${p.id})`).join(', ')}. For each, write the product page ` +
      '(benefit-led title, description with 5 bullets, SEO title and meta description; check the price against list_products and competitors), ' +
      'save it with draft_page (kind product) and ask to publish it with publish_page.',
  );
  return added.map((p) => p.title);
}

export interface ThemeApi {
  list: () => Promise<ShopifyTheme[]>;
  duplicate: (themeId: string, name: string) => Promise<ShopifyTheme>;
  upsert: (themeId: string, files: { filename: string; body: string }[]) => Promise<string[]>;
  remove: (themeId: string) => Promise<unknown>;
}

/**
 * Copies the live theme, waits for Shopify to finish the copy, and writes the files to it. A failed draft deletes its
 * copy (the library holds 20 themes, and the agent will try again).
 */
// ponytail: polls every 3 s for up to 2 minutes inside the agent's tool call; a slower copy fails the draft.
export async function draftThemeCopy(api: ThemeApi, name: string, files: { filename: string; body: string }[], wait = (ms: number) => new Promise((r) => setTimeout(r, ms))) {
  const live = (await api.list()).find((t) => t.role === 'MAIN');
  if (!live) throw new Error('Shopify: the store has no live theme');
  let copy = await api.duplicate(live.id, name);
  try {
    for (let i = 0; copy.processing; i++) {
      if (i === 40) throw new Error(`Shopify is still copying the theme ("${name}"); try again in a few minutes`);
      await wait(3000);
      copy = (await api.list()).find((t) => t.id === copy.id) ?? copy;
    }
    await api.upsert(copy.id, files);
    return copy;
  } catch (e) {
    await api.remove(copy.id).catch(() => {});
    throw e;
  }
}

/** An approved theme change: its copy becomes the live theme. */
export async function publishThemeChange(db: Db, a: ApprovalRequest, publish: (storeId: string, themeId: string) => Promise<unknown>) {
  const p = (a.action.payload ?? {}) as { themeId?: unknown; name?: unknown };
  const store = getStore(db, a.storeId);
  if (!store || typeof p.themeId !== 'string') return;
  try {
    await publish(store.id, p.themeId);
    once(db, `theme-live:${a.id}`); // when it went live: the outcome check measures from here
  } catch (e) {
    once(db, `not-applied:${a.id}`);
    notify(db, { kind: 'error', title: `Couldn't publish the theme on ${store.name}: ${a.title}`, body: `${(e as Error).message}. Publish "${String(p.name ?? p.themeId)}" by hand in Online Store > Themes.`, storeId: store.id });
  }
}

/** A denied theme draft: its copy is deleted, so drafts don't fill Shopify's 20-theme library. */
export async function discardThemeCopy(db: Db, a: ApprovalRequest, del: (storeId: string, themeId: string) => Promise<unknown>) {
  const themeId = (a.action.payload as { themeId?: unknown } | undefined)?.themeId;
  // Only a copy draft_theme_change made: never a theme of the owner's that a request merely names.
  if (typeof themeId === 'string' && db.prepare('SELECT 1 FROM done_once WHERE ref = ?').get(`theme-copy:${a.storeId}:${themeId}`)) await del(a.storeId, themeId);
}

/** The owner's no becomes a store memory, so the squad doesn't pitch it again without new evidence. An expired request isn't a no. */
/** Appended to requests closed because the store went live: asked on simulated numbers, not turned down by the owner. */
export const EXPIRED_DEMO = '[Expired: asked on demo data before the store went live.]';

export function rememberDenial(db: Db, a: ApprovalRequest) {
  if (closedByApp(a.reason)) return;
  writeMemory(db, {
    storeId: a.storeId, agentId: a.agentId, kind: 'preference', confidence: 0.6, tags: ['denied'],
    // The owner's reason, when given, is what the squad learns from: why, not just that.
    text: `The owner turned down "${a.title}"${a.decidedAt ? ` on ${a.decidedAt.slice(0, 10)}` : ''}${a.decisionNote ? `: ${a.decisionNote.slice(0, 300)}` : ''}.`,
    evidence: a.reason.slice(0, 300),
  });
}
