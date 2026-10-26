import type { ProductStatus } from '@frontline/shared';
import { logAction } from '../actions';
import { addDays, localDate } from '../dates';
import { tx, type Db } from '../db';
import { convertRate, historicRate } from '../fx';
import { getCredentials, setIntegrationStatus } from '../integrations';
import { archiveMissing, catalogPassDue, cursorAt, rebuildRevenue, setOrderItems, takeCurrency, setStoreTimezone, switchToReal, syncView, hasTag } from './common';
import { checkNewProducts, type NewProduct, type ProductPage } from './shopify';

// WooCommerce REST API v3 with a consumer key/secret (Basic auth, so https only): Read to sync, Read/Write for the
// approved product writes below (createWooProducts, setWooProductPrice, publishWooProductPage). Store pages are
// WordPress pages, written with a WordPress application password (publishWooPage).
/** First sync pulls this many days of orders (1Y range + the previous year for deltas). */
const BACKFILL_DAYS = 730;

type Fetch = typeof fetch;

interface WooOrder {
  number: string;
  /** The REST id (`number` is what the shop shows, and a sequential-numbers plugin can make them differ). */
  id: number;
  status: string;
  currency: string;
  /** In the shop's own timezone, so its date is the shop's day. */
  date_created: string;
  date_created_gmt: string;
  date_modified_gmt: string;
  date_paid_gmt: string | null;
  /** As placed: refunds don't lower it. */
  total: string;
  /** The tax in `total`. */
  total_tax?: string;
  /** Each refund's total is negative, e.g. "-10.00". */
  refunds?: { total: string }[];
  line_items?: { product_id: number; quantity: number; total: string; cost_of_goods_sold?: { value: number } }[];
  /** Only when the store has WooCommerce's Cost of Goods Sold feature on (Settings → Advanced → Features, Woo 9.5+). */
  cost_of_goods_sold?: { total_value: number };
  meta_data?: { key: string; value: unknown }[];
}

/**
 * An order's first tracking number, from the Shipment Tracking extension's order meta (Advanced Shipment Tracking writes
 * the same key). A custom carrier's link has `%1$s` for the number; a built-in carrier's has none stored (null).
 */
function wooTracking(o: WooOrder) {
  const items = o.meta_data?.find((m) => m.key === '_wc_shipment_tracking_items')?.value;
  const t = (Array.isArray(items) ? items : []).find((i) => typeof i?.tracking_number === 'string' && i.tracking_number.trim());
  if (!t) return { number: null, url: null };
  const number = String(t.tracking_number).trim();
  const url = typeof t.custom_tracking_link === 'string' ? t.custom_tracking_link.replaceAll('%1$s', encodeURIComponent(number)) : '';
  return { number, url: url.startsWith('https://') ? url : null };
}

interface WooProduct {
  id: number;
  name: string;
  status: string;
  price: string;
  regular_price: string;
  sale_price: string;
  stock_quantity: number | null;
  /** Off: Woo doesn't count the product's own stock (a variable product may count it per variation instead). */
  manage_stock?: boolean;
  /** 'notify' or 'yes': keeps selling at 0, so it can't sell out. */
  backorders?: string;
  type?: string;
  images?: { src: string }[];
  date_modified_gmt: string;
  cost_of_goods_sold?: { total_value: number };
}

const basic = (creds: Record<string, string>) => `Basic ${Buffer.from(`${creds.consumerKey!.trim()}:${creds.consumerSecret!.trim()}`).toString('base64')}`;

/** One call to the shop's REST API for a write; a read-only key gets told how to allow writes. */
async function wooCall<T>(db: Db, key: Buffer, storeId: string, method: 'GET' | 'POST' | 'PUT', path: string, body: object | undefined, fetchFn: Fetch): Promise<T> {
  const creds = getCredentials(db, key, 'woocommerce', storeId);
  if (!creds) throw new Error('WooCommerce is not connected for this store');
  const res = await fetchFn(`${wooSite(creds.siteUrl!)}/wp-json/wc/v3/${path}`, {
    method,
    headers: { authorization: basic(creds), 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = (await res.json().catch(() => undefined)) as (T & { message?: string }) | undefined;
  if (res.status === 401 || res.status === 403) throw new Error('WooCommerce refused the change: the key is read-only. Create a Read/Write key (WooCommerce → Settings → Advanced → REST API) and enter it in Integrations');
  if (!res.ok || !json) throw new Error(`WooCommerce: ${json?.message ?? `HTTP ${res.status}`}`);
  return json;
}

/** 'woo-123' → '123'; another platform's product id throws. */
function wooIdOf(productId: string) {
  const id = /^woo-(\d+)$/.exec(productId)?.[1];
  if (!id) throw new Error(`${productId} is not a WooCommerce product`);
  return id;
}

/** Woo's *_gmt dates have no zone suffix. */
const gmt = (s: string) => new Date(`${s}Z`);

/** "https://shop.com/" → "https://shop.com"; keys travel in a Basic header, so plain http is refused. */
export function wooSite(url: string) {
  const u = URL.canParse(url.trim()) ? new URL(url.trim()) : undefined;
  if (u?.protocol !== 'https:') throw new Error('Site URL must start with https:// (the keys are sent with every request)');
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

/** Fractional UTC offsets have no Etc/GMT name: a zone that keeps the offset all year stands in. */
const FRACTIONAL_ZONES: Record<string, string> = {
  '3.5': 'Asia/Tehran', '4.5': 'Asia/Kabul', '5.5': 'Asia/Kolkata', '5.75': 'Asia/Kathmandu', '6.5': 'Asia/Yangon',
  '8.75': 'Australia/Eucla', '9.5': 'Australia/Darwin', '-9.5': 'Pacific/Marquesas',
};

/**
 * WordPress' timezone as an IANA name: its city setting, else its UTC offset (Etc/GMT names flip the sign).
 * ponytail: an offset only DST zones use (UTC-3:30 Newfoundland) has none; the store keeps its own zone.
 */
export function wpZone(wp?: { timezone_string?: unknown; gmt_offset?: unknown }) {
  const h = Number(wp?.gmt_offset);
  const zone = typeof wp?.timezone_string === 'string' && wp.timezone_string ? wp.timezone_string
    : !Number.isInteger(h) ? FRACTIONAL_ZONES[String(h)] : h ? `Etc/GMT${h > 0 ? '-' : '+'}${Math.abs(h)}` : 'UTC';
  try {
    return zone && new Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

export async function syncWooCommerce(db: Db, key: Buffer, storeId: string, fetchFn: Fetch = fetch, now = new Date()) {
  const id = `woocommerce:${storeId}`;
  const creds = getCredentials(db, key, 'woocommerce', storeId);
  if (!creds) return;
  const view = syncView(db, id);
  try {
    const site = wooSite(creds.siteUrl!);
    const auth = basic(creds);
    const all = async <T>(path: string, params: Record<string, string>) => {
      const out: T[] = [];
      for (let page = 1, pages = 1; page <= pages; page++) {
        const res = await fetchFn(`${site}/wp-json/wc/v3/${path}?${new URLSearchParams({ ...params, per_page: '100', page: String(page) })}`, { headers: { authorization: auth } });
        const body = (await res.json().catch(() => undefined)) as T[] | { message?: string } | undefined;
        if (res.status === 401 || res.status === 403) throw new Error('WooCommerce refused the keys; create a Read key under WooCommerce → Settings → Advanced → REST API');
        if (!body) throw new Error(`No WooCommerce API at ${site}/wp-json; check the Site URL (and that permalinks are not "Plain")`);
        if (!res.ok || !Array.isArray(body)) throw new Error(`WooCommerce: ${(body as { message?: string }).message ?? `HTTP ${res.status}`}`);
        out.push(...body);
        // A proxy or security plugin may strip the header: then a full page means there's another. A short read would let
        // the daily catalog pass archive the products it missed.
        const total = Number(res.headers.get('x-wp-totalpages'));
        pages = total > 0 ? total : body.length === 100 ? page + 1 : page;
      }
      return out;
    };

    const cursor = db.prepare('SELECT cursor FROM integrations WHERE id = ?').get(id)?.cursor as string | null;
    const since = cursor ?? new Date(now.getTime() - BACKFILL_DAYS * 86_400_000).toISOString().slice(0, 19);
    // Default order (newest created first): edits don't move an order between pages, so paging can't skip it.
    const changed = { modified_after: since, dates_are_gmt: 'true' };
    // The default status (any) leaves out the trash: an order trashed after it was counted is read from there.
    const orders = [...(await all<WooOrder>('orders', changed)), ...(await all<WooOrder>('orders', { ...changed, status: 'trash' }))];
    // The order list has only each refund's total: a partly refunded order's refunds list says which lines lost what, one
    // request each. Read as amounts (signs vary between versions); a failed read leaves the lines as ordered, and the
    // rest of this sync's too (each failure costs ~30 s of retries).
    const lineRefunds = new Map<number, Map<number, { quantity: number; total: number }>>();
    let refundsDown = false;
    for (const o of orders.filter((o) => o.refunds?.length && o.status !== 'refunded' && o.date_paid_gmt)) {
      if (refundsDown) break;
      const refunds = await all<{ line_items?: { product_id: number; quantity: number; total: string }[] }>(`orders/${o.id}/refunds`, {}).catch(() => void (refundsDown = true));
      const back = new Map<number, { quantity: number; total: number }>();
      for (const li of (refunds ?? []).flatMap((r) => r.line_items ?? [])) {
        const b = back.get(li.product_id) ?? { quantity: 0, total: 0 };
        back.set(li.product_id, { quantity: b.quantity + Math.abs(li.quantity), total: b.total + Math.abs(Number(li.total)) });
      }
      lineRefunds.set(o.id, back);
    }
    // The default status (any) leaves out the trash, where a deleted product goes first; trashing it counts as a change.
    // The first sync and once a day after read every product, however long unchanged (the backfill window is for orders):
    // that refreshes variation stock an order may change without touching its product, and archives deleted products.
    const today = localDate(now);
    const full = !cursor || catalogPassDue(db, id, today);
    const productsSince = full ? { dates_are_gmt: 'true' } : changed;
    const products = [...(await all<WooProduct>('products', productsSince)), ...(await all<WooProduct>('products', { ...productsSince, status: 'trash' }))];
    // A variable product (sizes, colors) usually counts stock per variation: its stock is theirs, and it's tracked only when
    // every variation counts (an uncounted one can always be bought). A failed read leaves the product as it reads alone.
    // ponytail: one request per variable product read; batch through the Store API if big catalogs make syncs slow. A
    // parent that counts stock while some variations count their own reads as the parent's count.
    const variationStock = new Map<number, { stock: number; tracked: boolean }>();
    for (const p of products) {
      if (p.type !== 'variable' || p.manage_stock || p.status === 'trash') continue;
      const vs = await all<{ manage_stock: boolean | 'parent'; stock_quantity: number | null; backorders?: string }>(`products/${p.id}/variations`, {}).catch(() => []);
      const counted = vs.filter((v) => v.manage_stock === true);
      const tracked = counted.length === vs.length && vs.every((v) => (v.backorders ?? 'no') === 'no');
      if (counted.length) variationStock.set(p.id, { stock: counted.reduce((a, v) => a + (v.stock_quantity ?? 0), 0), tracked });
    }
    // The shop's own currency (Settings → General), else the newest order's. A multi-currency plugin's orders in another
    // currency are converted into it at today's ECB rate; one with no rate is left out rather than counted at par.
    const setting = await fetchFn(`${site}/wp-json/wc/v3/settings/general/woocommerce_currency`, { headers: { authorization: auth } })
      .then((r) => (r.ok ? (r.json() as Promise<{ value?: unknown }>) : undefined))
      .catch(() => undefined);
    // ponytail: the newest order's only on the first sync; after it a failed read keeps the store's (else a foreign
    // newest order would switch it and re-price everything).
    const store = db.prepare('SELECT demo, currency FROM stores WHERE id = ?').get(storeId);
    const base = typeof setting?.value === 'string' && /^[A-Z]{3}$/.test(setting.value) ? setting.value : store?.demo ? orders[0]?.currency : String(store?.currency);
    // Orders are dated on the site's day (date_created); the store takes its timezone so "today" is that same day.
    // _fields: the full index lists every route's schema (often megabytes), and this runs every 2 minutes.
    const zone = wpZone(await fetchFn(`${site}/wp-json/?_fields=timezone_string,gmt_offset`, { headers: { authorization: auth } }).then((r) => (r.ok ? (r.json() as Promise<Parameters<typeof wpZone>[0]>) : undefined)).catch(() => undefined));
    const rates = new Map<string, number | undefined>();
    for (const c of new Set(orders.map((o) => o.currency))) rates.set(c, !base || c === base ? 1 : await convertRate(db, c, base, fetchFn));
    // An order keeps the rate it was first converted at: re-pricing it at today's each time it's modified would move
    // its revenue with the markets and show the dips as refunds in the live feed. One first converted days after it was
    // placed (a first sync's backfill, or after the currency changed) takes its own day's ECB rate.
    // ponytail: one history download (~1 MB) per such currency and sync.
    const locked = db.prepare('SELECT fx_rate FROM orders WHERE store_id = ? AND id = ?');
    const lockedRate = (o: WooOrder) => locked.get(storeId, `woo-${o.number}`)?.fx_rate as number | null | undefined;
    const historic = new Map<string, (day: string) => number | undefined>();
    const old = orders.filter((o) => base && o.date_paid_gmt && o.currency !== base && o.date_created.slice(0, 10) < addDays(today, -3) && lockedRate(o) == null);
    for (const c of new Set(old.map((o) => o.currency))) {
      const on = await historicRate(c, base!, fetchFn).catch(() => undefined);
      if (on) historic.set(c, on);
    }

    if (syncView(db, id) !== view) return;
    tx(db, () => {
      switchToReal(db, storeId);
      if (base) takeCurrency(db, storeId, 'woocommerce', base);
      if (zone) setStoreTimezone(db, storeId, zone);
      const prod = db.prepare(
        `INSERT INTO products (store_id, id, title, image, price, compare_at, cost, inventory, inventory_tracked, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (store_id, id) DO UPDATE SET title = excluded.title, image = excluded.image, price = excluded.price, compare_at = excluded.compare_at,
           cost = CASE WHEN excluded.cost > 0 THEN excluded.cost ELSE cost END, inventory = excluded.inventory, inventory_tracked = excluded.inventory_tracked, status = excluded.status`,
      );
      for (const p of products) {
        const price = Number(p.price || p.regular_price || 0);
        const regular = Number(p.regular_price || 0);
        const status: ProductStatus = p.status === 'publish' ? 'active' : p.status === 'trash' ? 'archived' : 'draft';
        prod.run(storeId, `woo-${p.id}`, p.name, p.images?.[0]?.src ?? null, price, regular > price ? regular : null, Number(p.cost_of_goods_sold?.total_value ?? 0), variationStock.get(p.id)?.stock ?? p.stock_quantity ?? 0, (variationStock.get(p.id)?.tracked ?? (p.manage_stock !== false && (p.backorders ?? 'no') === 'no')) ? 1 : 0, status);
      }
      // Costs come from Woo's own Cost of Goods Sold feature when it's on (cogs 0 otherwise); tracking from a tracking plugin.
      const ord = db.prepare(
        `INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, supplier, tracking, cogs, local_date, tax, tracking_url, fx_rate) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (store_id, id) DO UPDATE SET total = excluded.total, status = excluded.status, fulfillment_status = excluded.fulfillment_status, cogs = excluded.cogs, tax = excluded.tax, fx_rate = excluded.fx_rate,
           tracking = coalesce(excluded.tracking, tracking), tracking_url = iif(excluded.tracking IS NULL, tracking_url, excluded.tracking_url)`,
      );
      const days = new Set<string>();
      for (const o of orders) {
        // Unpaid (pending, on-hold bank transfers, failed, drafts) never counts; cancelled or refunded after payment is a refund.
        const rate = lockedRate(o) ?? historic.get(o.currency)?.(o.date_created.slice(0, 10)) ?? rates.get(o.currency);
        if (!o.date_paid_gmt || !rate) continue;
        const created = gmt(o.date_created_gmt);
        const day = o.date_created.slice(0, 10);
        days.add(day);
        const refunded = o.status === 'refunded' || o.status === 'cancelled' || o.status === 'trash';
        const total = rate * Math.max(0, Number(o.total) + (o.refunds ?? []).reduce((a, r) => a + Number(r.total), 0)); // net of partial refunds
        // A refund gives back its share of the tax. ponytail: pro rata, Woo's order list doesn't split a refund's tax out.
        const tax = Number(o.total) > 0 ? (rate * Number(o.total_tax ?? 0) * total) / (rate * Number(o.total)) : 0;
        const tracking = wooTracking(o);
        ord.run(storeId, `woo-${o.number}`, created.toISOString(), Math.round(total * 100) / 100, refunded ? 'refunded' : 'paid', o.status === 'completed' ? 'fulfilled' : 'unfulfilled', tracking.number, Number(o.cost_of_goods_sold?.total_value ?? 0), day, Math.round(tax * 100) / 100, tracking.url, rate);
        // A product's refunds come off its first line(s); cost stays on what was ordered (a refund needn't be a return).
        const back = lineRefunds.get(o.id);
        const items = (o.line_items ?? []).filter((li) => li.product_id).map((li) => {
          const b = back?.get(li.product_id);
          const quantity = Math.min(li.quantity, b?.quantity ?? 0);
          const total = Math.min(Number(li.total), b?.total ?? 0);
          if (b) back!.set(li.product_id, { quantity: b.quantity - quantity, total: b.total - total });
          return { productId: `woo-${li.product_id}`, quantity: li.quantity - quantity, revenue: (Number(li.total) - total) * rate, cost: Number(li.cost_of_goods_sold?.value ?? 0) };
        });
        setOrderItems(db, storeId, `woo-${o.number}`, items.filter((i) => i.quantity > 0));
      }
      rebuildRevenue(db, storeId, days);
      if (full) archiveMissing(db, id, storeId, 'woo-*', products.map((p) => `woo-${p.id}`), today);
      const next = cursorAt(now).toISOString().slice(0, 19);
      db.prepare("UPDATE integrations SET cursor = ?, synced_at = ?, status = 'connected', error = NULL WHERE id = ?").run(next > since ? next : since, now.toISOString(), id);
    });
  } catch (e) {
    setIntegrationStatus(db, id, 'error', e instanceof Error ? e.message : 'WooCommerce sync failed');
  }
}

/**
 * Creates each product in WooCommerce as a simple draft and adds it to the local catalog (its cost stays local). Call only
 * for an approved request. Same contract as Shopify's createProducts: a failure part-way names the drafts already created.
 */
export async function createWooProducts(db: Db, key: Buffer, storeId: string, products: NewProduct[], fetchFn: Fetch = fetch) {
  checkNewProducts(products);
  const insert = db.prepare(`INSERT OR IGNORE INTO products (store_id, id, title, image, price, compare_at, cost, inventory, status) VALUES (?, ?, ?, NULL, ?, ?, ?, 0, 'draft')`);
  const created: { id: string; title: string }[] = [];
  for (const p of products) {
    try {
      const id = await logAction(db, storeId, 'product_create', p.title, { ...p }, async () => {
        // Woo's regular price is the compare-at and its sale price the price.
        const sale = !!p.compareAt && p.compareAt > p.price;
        const body = { name: p.title, type: 'simple', status: 'draft', regular_price: String(sale ? p.compareAt : p.price), ...(sale ? { sale_price: String(p.price) } : {}) };
        return `woo-${(await wooCall<{ id: number }>(db, key, storeId, 'POST', 'products', body, fetchFn)).id}`;
      });
      insert.run(storeId, id, p.title, p.price, p.compareAt ?? null, p.cost ?? 0);
      created.push({ id, title: p.title });
    } catch (e) {
      if (!created.length) throw e;
      throw new Error(`${(e as Error).message} (already created as drafts: ${created.map((c) => c.title).join(', ')})`);
    }
  }
  return created;
}

/**
 * Sets a live simple product's price (compareAt: a number sets it, null clears it, omitted leaves it), as Woo's sale
 * price over its regular price. Call only for an approved request. Same contract as Shopify's setProductPrice.
 */
export async function setWooProductPrice(db: Db, key: Buffer, storeId: string, productId: string, { price, compareAt }: { price: number; compareAt?: number | null }, fetchFn: Fetch = fetch) {
  if (!Number.isFinite(price) || price <= 0) throw new Error('Price must be more than 0');
  if (compareAt != null && !(Number.isFinite(compareAt) && compareAt > 0)) throw new Error('Compare-at price must be more than 0');
  const wooId = wooIdOf(productId);
  const shown = await logAction(db, storeId, 'price_change', productId, { price, ...(compareAt !== undefined ? { compareAt } : {}) }, async () => {
    const cur = await wooCall<{ type: string; regular_price: string; sale_price: string; date_on_sale_from?: string | null; date_on_sale_to?: string | null }>(
      db, key, storeId, 'GET', `products/${wooId}`, undefined, fetchFn);
    // One price for every variation would flatten e.g. S 20 / XL 25.
    if (cur.type !== 'simple') throw new Error(`WooCommerce: product ${productId} is a ${cur.type} product; change its prices in WooCommerce`);
    // A sale price only shows between its dates: the new one would be the owner's planned sale, not today's price.
    if (cur.date_on_sale_from || cur.date_on_sale_to) {
      throw new Error(`WooCommerce: product ${productId} has a scheduled sale (${cur.date_on_sale_from?.slice(0, 10) ?? '…'} to ${cur.date_on_sale_to?.slice(0, 10) ?? '…'}); change its price in WooCommerce`);
    }
    const was = compareAt === undefined ? (cur.sale_price ? Number(cur.regular_price) : 0) : (compareAt ?? 0);
    await wooCall(db, key, storeId, 'PUT', `products/${wooId}`, was > price ? { regular_price: String(was), sale_price: String(price) } : { regular_price: String(price), sale_price: '' }, fetchFn);
    return was > price ? was : null;
  });
  db.prepare('UPDATE products SET price = ?, compare_at = ? WHERE store_id = ? AND id = ?').run(price, shown, storeId, productId);
}

/**
 * Replaces a live product's title and description. Call only for an approved request. Same contract as Shopify's
 * publishProductPage. ponytail: SEO title/description are skipped, Woo has none without an SEO plugin (Yoast meta).
 */
export async function publishWooProductPage(db: Db, key: Buffer, storeId: string, productId: string, page: ProductPage, fetchFn: Fetch = fetch) {
  if ([page.title].some((t) => t && hasTag(t))) throw new Error("The title can't contain HTML: themes show it as it is");
  const wooId = wooIdOf(productId);
  await logAction(db, storeId, 'product_page_publish', productId, { title: page.title }, () =>
    wooCall(db, key, storeId, 'PUT', `products/${wooId}`, { name: page.title, description: page.descriptionHtml }, fetchFn),
  );
  db.prepare('UPDATE products SET title = ? WHERE store_id = ? AND id = ?').run(page.title, storeId, productId);
}

/** Creates a published WordPress page (about, FAQ, shipping, landing). Call only for an approved request. Same contract as Shopify's publishPage. */
export async function publishWooPage(db: Db, key: Buffer, storeId: string, page: { title: string; bodyHtml: string }, fetchFn: Fetch = fetch) {
  if ([page.title].some((t) => t && hasTag(t))) throw new Error("The title can't contain HTML: themes show it as it is");
  const creds = getCredentials(db, key, 'woocommerce', storeId);
  if (!creds) throw new Error('WooCommerce is not connected for this store');
  if (!creds.wpUser || !creds.wpAppPassword) throw new Error('To publish pages, add your WordPress username and an application password (Users → Profile → Application Passwords) to the WooCommerce integration');
  return logAction(db, storeId, 'page_publish', page.title, { title: page.title }, async () => {
    const res = await fetchFn(`${wooSite(creds.siteUrl!)}/wp-json/wp/v2/pages`, {
      method: 'POST',
      headers: { authorization: `Basic ${Buffer.from(`${creds.wpUser!.trim()}:${creds.wpAppPassword!.trim()}`).toString('base64')}`, 'content-type': 'application/json' },
      body: JSON.stringify({ title: page.title, content: page.bodyHtml, status: 'publish' }),
    });
    const json = (await res.json().catch(() => undefined)) as { id?: number; slug?: string; message?: string } | undefined;
    if (res.status === 401 || res.status === 403) throw new Error('WordPress refused the username and application password, or that user may not publish pages');
    if (!res.ok || !json?.id) throw new Error(`WordPress: ${json?.message ?? `HTTP ${res.status}`}`);
    return { id: String(json.id), handle: String(json.slug) };
  });
}
