import type { AdNetwork, IntegrationKind } from '@frontline/shared';
import type { Db } from '../db';
import { convertRate } from '../fx';

/** Wipes a demo store's generated rows and marks it connected. Called by the first successful real sync of any connector. */
export function switchToReal(db: Db, storeId: string) {
  if (db.prepare('SELECT demo FROM stores WHERE id = ?').get(storeId)?.demo !== 1) return;
  for (const t of ['daily_metrics', 'products', 'orders', 'campaigns', 'events']) db.prepare(`DELETE FROM ${t} WHERE store_id = ?`).run(storeId);
  // The seeded sample requests would act on the live store if approved now (e.g. add 3 products).
  db.prepare("DELETE FROM approvals WHERE store_id = ? AND id LIKE 'demo-appr-%' AND status = 'pending'").run(storeId);
  db.prepare('UPDATE stores SET demo = 0, connected = 1 WHERE id = ?').run(storeId);
}

/**
 * Sets a store's currency as its platform reports it. A change re-syncs the store's ad accounts and Amazon from scratch:
 * their history was converted into the old currency (e.g. an ad account that synced before the platform's first sync).
 */
export function setStoreCurrency(db: Db, storeId: string, currency: string) {
  if (!db.prepare('UPDATE stores SET currency = ? WHERE id = ? AND currency != ?').run(currency, storeId, currency).changes) return;
  db.prepare("UPDATE integrations SET cursor = NULL WHERE store_id = ? AND kind IN ('meta_ads', 'google_ads', 'tiktok_ads', 'amazon')").run(storeId);
}

/**
 * Where the next incremental sync of a platform starts: this sync's start (`now`) minus 5 minutes of clock skew. Not
 * the newest change seen: a refund made while the sync was reading would fall below that and never be fetched again.
 * Callers keep the previous cursor if it's later; re-reading the overlap is safe because upserts are idempotent.
 */
export const cursorAt = (now: Date) => new Date(now.getTime() - 5 * 60_000);

/**
 * On a full sync (the first, or after the account changed) the connected account is the source of truth for the store's
 * `network` campaigns: the ones it didn't return go, with their daily rows. An account entered by mistake then leaves
 * no spend in the store's profit and no campaign an approved change could reach. Returns the dates whose spend changed.
 * ponytail: a replaced account's history goes too; keeping it would need campaigns tagged with their account.
 */
export function pruneCampaigns(db: Db, storeId: string, network: AdNetwork, keep: Iterable<string>): string[] {
  const gone = 'SELECT id FROM campaigns WHERE store_id = ? AND network = ? AND id NOT IN (SELECT value FROM json_each(?))';
  const args = [storeId, network, JSON.stringify([...keep])];
  const dates = db.prepare(`SELECT DISTINCT date FROM campaign_daily WHERE network = ? AND campaign_id IN (${gone})`).all(network, ...args).map((r) => String(r.date));
  db.prepare(`DELETE FROM campaign_daily WHERE network = ? AND campaign_id IN (${gone})`).run(network, ...args);
  db.prepare(`DELETE FROM campaigns WHERE id IN (${gone}) AND network = ?`).run(...args, network);
  return dates;
}

/** daily_metrics.ad_spend = spend across every ad network's campaigns for that store and day. */
export function rebuildAdSpend(db: Db, storeId: string, dates: Iterable<string>) {
  const sum = db.prepare('SELECT coalesce(sum(d.spend), 0) AS spend FROM campaign_daily d JOIN campaigns c ON c.network = d.network AND c.id = d.campaign_id WHERE c.store_id = ? AND d.date = ?');
  const up = db.prepare('INSERT INTO daily_metrics (store_id, date, ad_spend) VALUES (?, ?, ?) ON CONFLICT (store_id, date) DO UPDATE SET ad_spend = excluded.ad_spend');
  for (const date of dates) up.run(storeId, date, Math.round(Number(sum.get(storeId, date)!.spend) * 100) / 100);
}

/**
 * daily_metrics revenue/cogs/orders = paid orders from every store platform that day, plus channels that only report daily
 * totals (channel_daily, e.g. Amazon). ad_spend is left to the ad connectors.
 */
export function rebuildRevenue(db: Db, storeId: string, dates: Iterable<string>) {
  const agg = db.prepare(
    // An order's tax (sales tax, VAT) is in its total but owed to the tax office: it counts against profit with the costs.
    `SELECT coalesce(sum(revenue), 0) AS revenue, coalesce(sum(cogs), 0) AS cogs, coalesce(sum(n), 0) AS n FROM (
       SELECT total AS revenue, cogs + tax AS cogs, 1 AS n FROM orders WHERE store_id = ?1 AND local_date = ?2 AND status = 'paid'
       UNION ALL SELECT revenue, 0, orders FROM channel_daily WHERE store_id = ?1 AND date = ?2)`,
  );
  const up = db.prepare(
    `INSERT INTO daily_metrics (store_id, date, revenue, cogs, orders) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (store_id, date) DO UPDATE SET revenue = excluded.revenue, cogs = excluded.cogs, orders = excluded.orders`,
  );
  for (const date of dates) {
    const a = agg.get(storeId, date)!;
    up.run(storeId, date, Math.round(Number(a.revenue) * 100) / 100, Math.round(Number(a.cogs) * 100) / 100, Number(a.n));
  }
}

/** Each store platform's id prefix. Shopify's ids have none (order names, product numbers); local drafts are research-/approval-. */
const ID_PREFIX: Partial<Record<IntegrationKind, string>> = { woocommerce: 'woo-', etsy: 'etsy-', tiktok_shop: 'tt-', amazon: 'amz-' };

/**
 * Drops a platform's synced orders, products and daily channel totals (Amazon) from a real store, with the revenue they
 * made. For a reconnect to another shop: the new shop's backfill then fills the store instead of mixing with the old one.
 * ponytail: Shopify's rows are the ones without another source's prefix; give rows a source column if that gets crowded.
 */
export function forgetPlatform(db: Db, storeId: string, kind: IntegrationKind) {
  if (db.prepare('SELECT demo FROM stores WHERE id = ?').get(storeId)?.demo !== 0) return;
  const others = [...Object.values(ID_PREFIX), 'research-', 'approval-'].map((p) => `${p}*`);
  const [where, args] =
    kind === 'shopify' ? [`NOT (${others.map(() => 'id GLOB ?').join(' OR ')})`, others] : ID_PREFIX[kind] ? ['id GLOB ?', [`${ID_PREFIX[kind]}*`]] : ['0', []];
  const dates = db
    .prepare(`SELECT DISTINCT local_date AS d FROM orders WHERE store_id = ? AND ${where} UNION SELECT date FROM channel_daily WHERE store_id = ? AND channel = ?`)
    .all(storeId, ...args, storeId, kind)
    .map((r) => String(r.d));
  for (const t of ['orders', 'products']) db.prepare(`DELETE FROM ${t} WHERE store_id = ? AND ${where}`).run(storeId, ...args);
  db.prepare('DELETE FROM channel_daily WHERE store_id = ? AND channel = ?').run(storeId, kind);
  rebuildRevenue(db, storeId, dates);
}

// Once a day per integration a connector reads the platform's whole catalog and archives the synced products it no
// longer lists: a deleted product leaves no trace in "changed since" reads.
const PASS_KEY = 'catalog_pass';
const passes = (db: Db) => JSON.parse(String(db.prepare('SELECT value_json FROM settings WHERE key = ?').get(PASS_KEY)?.value_json ?? '{}')) as Record<string, string>;

/** True while integration `id` hasn't had today's catalog pass. */
export const catalogPassDue = (db: Db, id: string, today: string) => passes(db)[id] !== today;

/** Records today's catalog pass for integration `id` (archiveMissing does this itself). */
export const catalogPassDone = (db: Db, id: string, today: string) =>
  db.prepare('INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json').run(PASS_KEY, JSON.stringify({ ...passes(db), [id]: today }));

/**
 * Applies a catalog pass: the store's products matching `glob` (the platform's ids) that `listed` doesn't hold are
 * archived, and the day is recorded. `listed` must be the complete catalog; a partial read would archive live products.
 */
export function archiveMissing(db: Db, id: string, storeId: string, glob: string, listed: Iterable<string>, today: string) {
  const keep = new Set(listed);
  const archive = db.prepare("UPDATE products SET status = 'archived' WHERE store_id = ? AND id = ?");
  for (const r of db.prepare("SELECT id FROM products WHERE store_id = ? AND id GLOB ? AND status != 'archived'").all(storeId, glob)) {
    if (!keep.has(String(r.id))) archive.run(storeId, String(r.id));
  }
  catalogPassDone(db, id, today);
}

export interface OrderItem {
  productId: string;
  quantity: number;
  revenue: number;
  cost: number;
}

/**
 * Replaces an order's line items, summed per product (an order can hold several variants of one product). A line the
 * platform gave no cost for (Etsy, TikTok Shop, Woo without COGS) takes the owner's unit cost, and an order with no
 * cogs of its own gets its lines' costs.
 */
export function setOrderItems(db: Db, storeId: string, orderId: string, items: OrderItem[]) {
  db.prepare('DELETE FROM order_items WHERE store_id = ? AND order_id = ?').run(storeId, orderId);
  const byProduct = new Map<string, OrderItem>();
  for (const i of items) {
    const p = byProduct.get(i.productId);
    byProduct.set(i.productId, p ? { ...p, quantity: p.quantity + i.quantity, revenue: p.revenue + i.revenue, cost: p.cost + i.cost } : i);
  }
  const ins = db.prepare('INSERT INTO order_items (store_id, order_id, product_id, quantity, revenue, cost) VALUES (?, ?, ?, ?, ?, ?)');
  const unit = db.prepare('SELECT cost FROM products WHERE store_id = ? AND id = ?');
  for (const i of byProduct.values()) {
    const cost = i.cost || i.quantity * Number(unit.get(storeId, i.productId)?.cost ?? 0);
    ins.run(storeId, orderId, i.productId, i.quantity, Math.round(i.revenue * 100) / 100, Math.round(cost * 100) / 100);
  }
  db.prepare('UPDATE orders SET cogs = (SELECT round(coalesce(sum(cost), 0), 2) FROM order_items WHERE store_id = ?1 AND order_id = ?2) WHERE store_id = ?1 AND id = ?2 AND cogs = 0').run(storeId, orderId);
}

/** An approved change to a live campaign: a new daily budget (account currency) or a pause. */
export type CampaignChange = { dailyBudget: number } | { status: 'PAUSED' };

/**
 * Ad numbers are kept in the store's currency: the factor from the ad account's currency into it (1 when they match or
 * the account's isn't known). Throws when the ECB publishes no rate for one of them.
 * ponytail: today's rate for every day; past spend isn't re-priced at its own day's rate.
 */
export async function adRate(db: Db, storeId: string, accountCurrency: string | undefined, fetchFn: typeof fetch, network: string) {
  const store = String(db.prepare('SELECT currency FROM stores WHERE id = ?').get(storeId)?.currency);
  const rate = await convertRate(db, accountCurrency ?? store, store, fetchFn);
  if (!rate) throw new Error(`${network}: no exchange rate from the account's ${accountCurrency} to the store's ${store}`);
  return rate;
}

/** Money as cents (2 decimals). */
export const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * For syncs, which only read: a rate-limited response (429) waits Retry-After (1 s if missing, at most a minute), and a
 * server error (5xx) or dropped connection waits 2, 4, 8, 16 s, then it asks again, up to 5 tries. One blip in a long
 * first sync (Etsy allows 5–10 calls a second; a WordPress host can 502 mid-backfill) then doesn't fail it and restart
 * it from scratch.
 */
export const retrying = (fetchFn: typeof fetch): typeof fetch => async (input, init) => {
  for (let attempt = 1; ; attempt++) {
    const res = await fetchFn(input, init).catch((e: unknown) => (e instanceof Error ? e : new Error(String(e))));
    const wait = res instanceof Error || res.status >= 500 ? 2 ** attempt : res.status === 429 ? Math.max(1, Number(res.headers.get('retry-after')) || 1) : 0;
    if (!wait || attempt === 5) {
      if (res instanceof Error) throw res;
      return res;
    }
    await new Promise((r) => setTimeout(r, Math.min(60, wait) * 1000));
  }
};
