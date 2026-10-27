import { INTEGRATION_KINDS, type AdNetwork, type IntegrationKind } from '@frontline/shared';
import { expireRequests } from '../approvals';
import type { Db } from '../db';
import { convertRate, historicRate } from '../fx';

/**
 * A store platform's sync takes its currency for the store, unless the store's own platform (e.g. Shopify for a Shopify
 * store) has synced and sells in another: then the sync stops with an error, as its orders would add up unconverted and
 * the two syncs would switch the store's currency back and forth (each switch re-pulls the ad accounts' history).
 * ponytail: a second platform's orders aren't converted; it can be a store of its own.
 */
export function takeCurrency(db: Db, storeId: string, kind: IntegrationKind, currency: string) {
  const store = db.prepare('SELECT name, platform, currency FROM stores WHERE id = ?').get(storeId);
  const own = String(store?.platform);
  const ownSynced = own !== kind && db.prepare('SELECT 1 FROM integrations WHERE id = ? AND synced_at IS NOT NULL').get(`${own}:${storeId}`);
  if (!ownSynced) return setStoreCurrency(db, storeId, currency);
  if (currency === store!.currency) return;
  const name = (k: string) => INTEGRATION_KINDS[k as IntegrationKind].name;
  throw new Error(`${name(kind)} sells in ${currency}, but ${store!.name} is in ${store!.currency} (its ${name(own)} sells in that). Add the ${name(kind)} as a store of its own to see its sales.`);
}

/**
 * A store platform's sync takes its timezone for the store, unless the store's own platform has synced (as with
 * takeCurrency): a second platform's zone would re-date the orders back and forth, a sync of each at a time.
 */
export function takeTimezone(db: Db, storeId: string, kind: IntegrationKind, zone: string) {
  if (!knownZone(zone)) return;
  const own = String(db.prepare('SELECT platform FROM stores WHERE id = ?').get(storeId)?.platform);
  if (own !== kind && db.prepare('SELECT 1 FROM integrations WHERE id = ? AND synced_at IS NOT NULL').get(`${own}:${storeId}`)) return;
  setStoreTimezone(db, storeId, zone);
}

/** Wipes a demo store's generated rows and marks it connected. Called by the first successful real sync of any connector. */
export function switchToReal(db: Db, storeId: string) {
  if (db.prepare('SELECT demo FROM stores WHERE id = ?').get(storeId)?.demo !== 1) return;
  for (const t of ['daily_metrics', 'products', 'orders', 'campaigns', 'events']) db.prepare(`DELETE FROM ${t} WHERE store_id = ?`).run(storeId);
  // The seeded sample requests would act on the live store if approved now (e.g. add 3 products).
  db.prepare("DELETE FROM approvals WHERE store_id = ? AND id LIKE 'demo-appr-%' AND status = 'pending'").run(storeId);
  // Their made-up prices would steer price tests on the live store (snapshots cascade).
  db.prepare("DELETE FROM competitors WHERE store_id = ? AND id LIKE 'demo-%'").run(storeId);
  db.prepare('UPDATE stores SET demo = 0, connected = 1 WHERE id = ?').run(storeId);
}

/**
 * Sets a store's currency (as its platform reports it, or from the store form). A change re-syncs the store's ad accounts
 * and Amazon from scratch: their history was converted into the old currency (e.g. an ad account that synced before the
 * platform's first sync).
 */
export function setStoreCurrency(db: Db, storeId: string, currency: string) {
  if (!db.prepare('UPDATE stores SET currency = ? WHERE id = ? AND currency != ?').run(currency, storeId, currency).changes) return;
  db.prepare('UPDATE orders SET fx_rate = NULL WHERE store_id = ?').run(storeId); // they were into the old currency
  db.prepare("UPDATE integrations SET cursor = NULL WHERE store_id = ? AND kind IN ('meta_ads', 'google_ads', 'tiktok_ads', 'amazon')").run(storeId);
  if (db.prepare('SELECT demo FROM stores WHERE id = ?').get(storeId)?.demo !== 0) return;
  // Budgets and asked amounts are in the old currency: approved, ¥12,800 → ¥16,640 a day would be written as $16,640.
  // 0 (no daily budget) refuses budget changes until the ad sync re-reads them.
  db.prepare('UPDATE campaigns SET daily_budget = 0 WHERE store_id = ?').run(storeId);
  expireRequests(db, storeId, ['ads.set_budget', 'store.set_price', 'store.add_products'], "[Expired: the store's currency changed after it was asked.]");
}

/**
 * What other writes can change while a sync awaits its reads: the integration's settings (another shop or account) and
 * cursor (reset by that and by a currency switch), and the store's currency. A sync that finds it changed when it comes to
 * write writes nothing (its reads are of the old account, or priced into the old currency); the next one reads afresh.
 */
export const syncView = (db: Db, id: string) =>
  JSON.stringify(db.prepare('SELECT i.settings_json, i.cursor, s.currency FROM integrations i LEFT JOIN stores s ON s.id = i.store_id WHERE i.id = ?').get(id) ?? null);

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

/**
 * Campaigns another store holds (an ad account disconnected there and connected here) move to this one, and that store's
 * ad spend loses them on their days. Call in the sync's write, before its campaign upserts (which keep a row's store).
 */
export function claimCampaigns(db: Db, storeId: string, network: AdNetwork, ids: Iterable<string>) {
  const list = JSON.stringify([...ids]);
  const days = db
    .prepare(
      `SELECT DISTINCT c.store_id, d.date FROM campaigns c JOIN campaign_daily d ON d.network = c.network AND d.campaign_id = c.id
       WHERE c.network = ? AND c.store_id != ? AND c.id IN (SELECT value FROM json_each(?))`,
    )
    .all(network, storeId, list);
  db.prepare('UPDATE campaigns SET store_id = ? WHERE network = ? AND store_id != ? AND id IN (SELECT value FROM json_each(?))').run(storeId, network, storeId, list);
  for (const d of days) rebuildAdSpend(db, String(d.store_id), [String(d.date)]);
}

/** A store's campaigns its ad account no longer lists (deleted there) can't run or take a budget. */
export function archiveUnlisted(db: Db, storeId: string, network: AdNetwork, listed: Iterable<string>) {
  db.prepare("UPDATE campaigns SET status = 'archived', daily_budget = 0 WHERE store_id = ? AND network = ? AND id NOT IN (SELECT value FROM json_each(?))")
    .run(storeId, network, JSON.stringify([...listed]));
}

/** daily_metrics.ad_spend = spend across every ad network's campaigns for that store and day. */
export function rebuildAdSpend(db: Db, storeId: string, dates: Iterable<string>) {
  const sum = db.prepare('SELECT coalesce(sum(d.spend), 0) AS spend FROM campaign_daily d JOIN campaigns c ON c.network = d.network AND c.id = d.campaign_id WHERE c.store_id = ? AND d.date = ?');
  const up = db.prepare('INSERT INTO daily_metrics (store_id, date, ad_spend) VALUES (?, ?, ?) ON CONFLICT (store_id, date) DO UPDATE SET ad_spend = excluded.ad_spend');
  for (const date of dates) up.run(storeId, date, Math.round(Number(sum.get(storeId, date)!.spend) * 100) / 100);
}

/**
 * Sets a store's timezone. On a real store a change re-dates its orders on the new zone's days and rebuilds those days, so
 * history and "today" share one calendar, and Amazon re-reads its daily totals (dated in the store's zone). Demo stores
 * just take the zone: their days are seeded, not built from orders.
 */
export function setStoreTimezone(db: Db, storeId: string, zone: string) {
  const s = db.prepare('SELECT timezone, demo FROM stores WHERE id = ?').get(storeId);
  if (!s || s.timezone === zone) return;
  db.prepare('UPDATE stores SET timezone = ? WHERE id = ?').run(zone, storeId);
  if (s.demo) return;
  const dayOf = new Intl.DateTimeFormat('en-CA', { timeZone: zone });
  const set = db.prepare('UPDATE orders SET local_date = ? WHERE store_id = ? AND id = ?');
  const days = new Set<string>();
  for (const o of db.prepare('SELECT id, created_at, local_date FROM orders WHERE store_id = ?').all(storeId)) {
    const day = dayOf.format(new Date(String(o.created_at)));
    if (day === o.local_date) continue;
    set.run(day, storeId, String(o.id));
    days.add(day).add(String(o.local_date));
  }
  rebuildRevenue(db, storeId, days);
  db.prepare("UPDATE integrations SET cursor = NULL WHERE store_id = ? AND kind = 'amazon'").run(storeId);
}

/**
 * daily_metrics revenue/cogs/orders = paid orders from every store platform that day, plus channels that only report daily
 * totals (channel_daily, e.g. Amazon). ad_spend is left to the ad connectors.
 */
export function rebuildRevenue(db: Db, storeId: string, dates: Iterable<string>) {
  const agg = db.prepare(
    // An order's tax (sales tax, VAT) is in its total but owed to the tax office: it counts against profit with the costs.
    // Amazon's sales and order counts are in channel_daily already (its daily totals), so its orders add only their costs,
    // and its refunds come off their order's day. Refund lines (amazon_refunds: Amazon's and TikTok Shop's) count only
    // against a paid order: a cancelled one is out already. A line's tax comes off revenue and off the costs (the order's
    // tax is one); its amount is net of that tax, as per-product revenue is. CROSS JOIN keeps the day's orders as the outer
    // loop: driven from the refund lines, a first sync's 730 days took ~7 s on a 100k-order store (now ~0.1 s).
    `SELECT coalesce(sum(revenue), 0) AS revenue, coalesce(sum(cogs), 0) AS cogs, coalesce(sum(n), 0) AS n FROM (
       SELECT iif(id GLOB 'amz-*', 0, total) AS revenue, cogs + tax AS cogs, iif(id GLOB 'amz-*', 0, 1) AS n
       FROM orders WHERE store_id = ?1 AND local_date = ?2 AND status = 'paid'
       UNION ALL SELECT revenue, 0, orders FROM channel_daily WHERE store_id = ?1 AND date = ?2
       UNION ALL SELECT -(r.amount + r.tax), -r.tax, 0 FROM orders o CROSS JOIN amazon_refunds r ON r.store_id = o.store_id AND r.order_id = o.id
         WHERE o.store_id = ?1 AND o.local_date = ?2 AND o.status = 'paid')`,
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
  // Its refund lines, by their order's id (left, Amazon would look the old seller's orders up on the new one).
  db.prepare(`DELETE FROM amazon_refunds WHERE store_id = ? AND ${where.replaceAll('id GLOB', 'order_id GLOB')}`).run(storeId, ...args);
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
 */
export async function adRate(db: Db, storeId: string, accountCurrency: string | undefined, fetchFn: typeof fetch, network: string) {
  const store = String(db.prepare('SELECT currency FROM stores WHERE id = ?').get(storeId)?.currency);
  const rate = await convertRate(db, accountCurrency ?? store, store, fetchFn);
  if (!rate) throw new Error(`${network}: no exchange rate from the account's ${accountCurrency} to the store's ${store}`);
  return rate;
}

/**
 * The factor for each day of a first sync, which reads two years back: that day's ECB rate, so old spend isn't priced
 * at today's. `rate` (today's) for a day the history lacks, or when it can't be read.
 * ponytail: later syncs re-read only the last few days and keep today's rate for them.
 */
export async function backfillRate(db: Db, storeId: string, accountCurrency: string | undefined, rate: number, fetchFn: typeof fetch) {
  const store = String(db.prepare('SELECT currency FROM stores WHERE id = ?').get(storeId)?.currency);
  const on = accountCurrency && accountCurrency !== store ? await historicRate(accountCurrency, store, fetchFn).catch(() => undefined) : undefined;
  return (day: string) => on?.(day) ?? rate;
}

/** An integration's entry in a settings row that maps integration ids to read state. Each write re-reads the row: syncs of
 * several stores interleave. */
export const stateOf = <T>(db: Db, key: string) => {
  const all = () => JSON.parse(String(db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key)?.value_json ?? '{}')) as Record<string, T>;
  return {
    get: (id: string) => all()[id] as T | undefined,
    set: (id: string, v: T) =>
      db.prepare('INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json').run(key, JSON.stringify({ ...all(), [id]: v })),
  };
};

/** Settings row: the timezone each ad account or GA4 property reports its days in (integration id → IANA name). */
export const AD_ZONES = 'ad_timezones';

/** The zone if this machine knows it, else undefined (the machine's own): a day in an unknown zone throws, every sync. */
export function knownZone(zone?: string) {
  try {
    if (zone) new Intl.DateTimeFormat('en', { timeZone: zone });
    return zone;
  } catch {
    return undefined;
  }
}

/** An ad account's or GA4 property's zone as its last sync saw it (undefined at first, or unknown here). */
export const adZone = (db: Db, id: string) => knownZone(stateOf<string>(db, AD_ZONES).get(id));

/** A tag in text a storefront shows as is (titles): `<b`, `</`, `<!--`, `<?`. A lone "<" ("under <5 cm") isn't one. */
export const hasTag = (s: string) => /<[a-z!/?]/i.test(s);

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
