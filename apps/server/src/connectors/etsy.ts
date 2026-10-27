import type { ProductStatus } from '@frontline/shared';
import { logAction } from '../actions';
import { tx, type Db } from '../db';
import { getCredentials, setIntegrationStatus, updateSecrets } from '../integrations';
import type { ProductPage } from './shopify';
import { localDate } from '../dates';
import { archiveMissing, catalogPassDue, cursorAt, rebuildRevenue, setOrderItems, takeCurrency, switchToReal, syncView, stillAsSynced, syncedPrice } from './common';

// Etsy Open API v3: app keystring + shared secret, and the shop owner's OAuth tokens (scopes transactions_r listings_r, and
// listings_w for approved listing changes: setEtsyListingPrice, publishEtsyProductPage).
const API = 'https://openapi.etsy.com/v3/application';
const TOKEN_URL = 'https://api.etsy.com/v3/public/oauth/token';
/** First sync pulls this many days of receipts (1Y range + the previous year for deltas). */
const BACKFILL_DAYS = 730;
// A listing that sells out or expires leaves 'active' for its own state, so those are pulled too or it would stay in stock here.
const LISTING_STATES = ['active', 'draft', 'inactive', 'sold_out', 'expired'];

type Fetch = typeof fetch;
type Money = { amount: number; divisor: number; currency_code?: string };

interface Receipt {
  receipt_id: number;
  status: string;
  is_paid: boolean;
  is_shipped: boolean;
  create_timestamp: number;
  updated_timestamp: number;
  /** As placed: refunds don't lower it. Includes the sales tax and VAT below. */
  grandtotal: Money;
  total_tax_cost?: Money;
  total_vat_cost?: Money;
  refunds?: { amount: Money }[];
  shipments?: { tracking_code?: string | null }[];
  transactions?: { listing_id: number; quantity: number; price: Money }[];
}

interface Listing {
  listing_id: number;
  title: string;
  state: string;
  quantity: number;
  price: Money;
  /** With includes=Images; rank 1 is the listing's main photo. */
  images?: { rank?: number; url_570xN?: string }[];
  updated_timestamp: number;
}

const money = (m: Money | undefined) => (m ? m.amount / m.divisor : 0);
/** Sold out is still a live listing, at 0 stock (like a Shopify product at 0); the rest are off the shop. */
const LISTING_STATUS: Record<string, ProductStatus> = { active: 'active', sold_out: 'active', draft: 'draft' };

/** Access tokens last an hour and refresh tokens rotate, so both are saved (encrypted) right away. */
async function refreshEtsy(db: Db, key: Buffer, id: string, creds: Record<string, string>, fetchFn: Fetch, now: Date) {
  const res = await fetchFn(TOKEN_URL, { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', client_id: creds.apiKey!, refresh_token: creds.refreshToken! }) });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !body.access_token || !body.refresh_token) throw new Error(`Etsy sign-in failed: ${body.error_description ?? body.error ?? `HTTP ${res.status}`}; connect the shop again`);
  updateSecrets(db, key, id, { accessToken: body.access_token, refreshToken: body.refresh_token, accessTokenExpiresAt: String(Math.floor(now.getTime() / 1000) + (body.expires_in ?? 3600)) });
  return body.access_token;
}

/** Refreshes in flight by integration id. Etsy rotates the refresh token, so a second refresh started with the old one fails. */
const refreshing = new Map<string, Promise<string>>();

/** The shop ID and request headers, renewing the access token when it has under 5 minutes left (once, for concurrent callers). */
async function etsyAuth(db: Db, key: Buffer, id: string, creds: Record<string, string>, fetchFn: Fetch, now: Date) {
  const shopId = creds.shopId!.trim();
  if (!/^\d+$/.test(shopId)) throw new Error('Shop ID must be the number of your Etsy shop');
  const fresh = Number(creds.accessTokenExpiresAt) * 1000 - now.getTime() > 5 * 60_000;
  let renew = refreshing.get(id);
  if (!fresh && !renew) refreshing.set(id, (renew = refreshEtsy(db, key, id, creds, fetchFn, now).finally(() => refreshing.delete(id))));
  const token = fresh ? creds.accessToken! : await renew!;
  return { shopId, headers: { 'x-api-key': `${creds.apiKey}:${creds.sharedSecret}`, authorization: `Bearer ${token}` } };
}

export async function syncEtsy(db: Db, key: Buffer, storeId: string, fetchFn: Fetch = fetch, now = new Date()) {
  const id = `etsy:${storeId}`;
  const creds = getCredentials(db, key, 'etsy', storeId);
  if (!creds) return;
  const view = syncView(db, id);
  try {
    const { shopId, headers } = await etsyAuth(db, key, id, creds, fetchFn, now);
    const get = async <T>(path: string, params: Record<string, string>) => {
      const res = await fetchFn(`${API}${path}?${new URLSearchParams(params)}`, { headers });
      const body = (await res.json().catch(() => ({}))) as { results?: T[]; count?: number; error?: string };
      if (res.status === 401 || res.status === 403) throw new Error(`Etsy refused access (${body.error ?? `HTTP ${res.status}`}); check the keystring, shared secret and the transactions_r listings_r scopes`);
      if (!res.ok) throw new Error(`Etsy: ${body.error ?? `HTTP ${res.status}`}`);
      return { results: body.results ?? [], count: body.count ?? 0 };
    };

    const cursor = db.prepare('SELECT cursor FROM integrations WHERE id = ?').get(id)?.cursor as string | null;
    const since = cursor ? Number(cursor) : Math.floor(now.getTime() / 1000) - BACKFILL_DAYS * 86400;
    const receipts: Receipt[] = [];
    for (let offset = 0; ; offset += 100) {
      const page = await get<Receipt>(`/shops/${shopId}/receipts`, { min_last_modified: String(since), limit: '100', offset: String(offset) });
      receipts.push(...page.results);
      if (!page.results.length || offset + 100 >= page.count) break;
    }
    // Listings can't be filtered by change time: page newest-changed first and stop at the first one older than the cursor.
    // The first sync and once a day after read them all, so a listing deleted on Etsy (in no state any more) is archived.
    // ponytail: Etsy's spec says sort_on may only apply to keyword searches; if it's ignored here, changes the early stop
    // misses still arrive with the daily full read.
    const today = localDate(now);
    const full = !cursor || catalogPassDue(db, id, today);
    const listedSince = full ? 0 : since;
    const listings: Listing[] = [];
    for (const state of LISTING_STATES) {
      for (let offset = 0; ; offset += 100) {
        const page = await get<Listing>(`/shops/${shopId}/listings`, { state, sort_on: 'updated', sort_order: 'desc', includes: 'Images', limit: '100', offset: String(offset) });
        listings.push(...page.results.filter((l) => l.updated_timestamp >= listedSince));
        if (!page.results.length || offset + 100 >= page.count || page.results.some((l) => l.updated_timestamp < listedSince)) break;
      }
    }
    // Offset pages in change order skip a listing edited (or moved to another state) while they're read: one the full read
    // missed is archived only once Etsy answers 404 for it, and kept as Etsy has it otherwise (on any other error, as is).
    const kept: string[] = [];
    if (full) {
      const seen = new Set(listings.map((l) => `etsy-${l.listing_id}`));
      for (const r of db.prepare("SELECT id FROM products WHERE store_id = ? AND id GLOB 'etsy-*' AND status != 'archived'").all(storeId)) {
        if (seen.has(String(r.id))) continue;
        const res = await fetchFn(`${API}/listings/${String(r.id).slice(5)}?includes=Images`, { headers }).catch(() => undefined);
        if (res?.status === 404) continue;
        const l = res?.ok ? ((await res.json().catch(() => undefined)) as Listing | undefined) : undefined;
        if (l && LISTING_STATES.includes(l.state)) listings.push(l);
        else if (!l) kept.push(String(r.id));
      }
    }
    const dayOf = new Intl.DateTimeFormat('en-CA', { timeZone: String(db.prepare('SELECT timezone FROM stores WHERE id = ?').get(storeId)?.timezone ?? 'UTC') });

    if (syncView(db, id) !== view) return;
    tx(db, () => {
      switchToReal(db, storeId);
      // Receipts and listings are in the shop's currency.
      const currency = receipts[0]?.grandtotal.currency_code ?? listings[0]?.price.currency_code;
      if (currency) takeCurrency(db, storeId, 'etsy', currency);
      const prod = db.prepare(
        `INSERT INTO products (store_id, id, title, image, price, compare_at, cost, inventory, status) VALUES (?, ?, ?, ?, ?, NULL, 0, ?, ?)
         ON CONFLICT (store_id, id) DO UPDATE SET title = excluded.title, image = excluded.image, price = excluded.price, inventory = excluded.inventory, status = excluded.status`,
      );
      const photo = (l: Listing) => [...(l.images ?? [])].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))[0]?.url_570xN ?? null;
      for (const l of listings) prod.run(storeId, `etsy-${l.listing_id}`, l.title, photo(l), money(l.price), l.state === 'sold_out' ? 0 : l.quantity, LISTING_STATUS[l.state] ?? 'archived');
      // Etsy has no unit costs: lines cost the owner's unit cost for the product (setOrderItems), else nothing.
      const ord = db.prepare(
        `INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, supplier, tracking, cogs, local_date, tax) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 0, ?, ?)
         ON CONFLICT (store_id, id) DO UPDATE SET total = excluded.total, status = excluded.status, fulfillment_status = excluded.fulfillment_status, tracking = coalesce(excluded.tracking, tracking), tax = excluded.tax`,
      );
      const days = new Set<string>();
      for (const r of receipts) {
        if (!r.is_paid) continue;
        const created = new Date(r.create_timestamp * 1000);
        const day = dayOf.format(created);
        days.add(day);
        const refunded = r.status === 'canceled' || r.status === 'fully refunded';
        const total = Math.max(0, money(r.grandtotal) - (r.refunds ?? []).reduce((a, x) => a + money(x.amount), 0)); // net of partial refunds
        // A refund gives back its share of the tax (pro rata: Etsy doesn't split a refund's tax out).
        const gross = money(r.grandtotal);
        const tax = gross > 0 ? ((money(r.total_tax_cost) + money(r.total_vat_cost)) * total) / gross : 0;
        ord.run(storeId, `etsy-${r.receipt_id}`, created.toISOString(), Math.round(total * 100) / 100, refunded ? 'refunded' : 'paid', r.is_shipped ? 'fulfilled' : 'unfulfilled', r.shipments?.[0]?.tracking_code || null, day, Math.round(tax * 100) / 100);
        // ponytail: a partial refund names no lines, so each keeps its share of what the buyer kept (a shipping-only refund
        // lowers them too); Woo's refunds list lines (CORE-65).
        const kept = gross > 0 ? total / gross : 1;
        setOrderItems(db, storeId, `etsy-${r.receipt_id}`, (r.transactions ?? []).map((t) => ({ productId: `etsy-${t.listing_id}`, quantity: t.quantity, revenue: money(t.price) * t.quantity * kept, cost: 0 })));
      }
      rebuildRevenue(db, storeId, days);
      if (full) archiveMissing(db, id, storeId, 'etsy-*', [...listings.map((l) => `etsy-${l.listing_id}`), ...kept], today);
      const next = Math.max(since, Math.floor(cursorAt(now).getTime() / 1000));
      db.prepare("UPDATE integrations SET cursor = ?, synced_at = ?, status = 'connected', error = NULL WHERE id = ?").run(String(next), now.toISOString(), id);
    });
  } catch (e) {
    setIntegrationStatus(db, id, 'error', e instanceof Error ? e.message : 'Etsy sync failed');
  }
}

/** 'etsy-123' → '123'; another platform's product id throws. */
function listingIdOf(productId: string) {
  const id = /^etsy-(\d+)$/.exec(productId)?.[1];
  if (!id) throw new Error(`${productId} is not an Etsy listing`);
  return id;
}

/** A listing request for an approved change. Shops connected before the app asked for listings_w get a 403. */
async function etsyEdit<T>(fetchFn: Fetch, url: string, init: RequestInit) {
  const res = await fetchFn(url, init);
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (res.status === 401 || res.status === 403) throw new Error(`Etsy refused the change (${json.error ?? `HTTP ${res.status}`}); connect Etsy again so the app may edit listings`);
  if (!res.ok) throw new Error(`Etsy: ${json.error ?? `HTTP ${res.status}`}`);
  return json;
}

/** Store Builder drafts are HTML; Etsy shows descriptions as plain text. ponytail: a named entity not in `named` stays as typed. */
export function htmlToText(html: string) {
  const named = new Map(Object.entries({
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '\u2026', mdash: '\u2014', ndash: '\u2013', lsquo: '\u2018', rsquo: '\u2019',
    ldquo: '\u201c', rdquo: '\u201d', copy: '\u00a9', reg: '\u00ae', trade: '\u2122', deg: '\u00b0', times: '\u00d7', euro: '\u20ac', pound: '\u00a3',
  }));
  const char = (c: number) => (c <= 0x10ffff ? String.fromCodePoint(c) : '\ufffd'); // past Unicode: the replacement character, as browsers show it
  return html
    .replace(/>\s*\n\s*</g, '><') // source formatting between tags
    .replace(/<\s*br\b[^>]*>|<\/\s*li\s*>/gi, '\n')
    .replace(/<\/\s*(p|div|h[1-6]|ul|ol|blockquote)\s*>/gi, '\n\n')
    .replace(/<\s*li\b[^>]*>/gi, '• ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi, (m, d, h, n) => (d ? char(Number(d)) : h ? char(parseInt(h, 16)) : named.get(n.toLowerCase()) ?? m))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface Inventory {
  products: {
    sku: string;
    is_deleted?: boolean;
    property_values: { property_id: number; property_name?: string | null; scale_id?: number | null; value_ids: number[]; values: string[] }[];
    offerings: { price: Money; quantity: number; is_enabled: boolean; is_deleted?: boolean; readiness_state_id?: number | null }[];
  }[];
  price_on_property: number[];
  quantity_on_property: number[];
  sku_on_property: number[];
  readiness_state_on_property?: number[] | null;
}

/**
 * Sets a live listing's price. Call only for an approved request. Same contract as Shopify's setProductPrice, except that
 * Etsy has no compare-at price (sales are Shop Manager promotions) and a listing priced per variation is refused, not flattened.
 */
export async function setEtsyListingPrice(db: Db, key: Buffer, storeId: string, productId: string, { price, compareAt }: { price: number; compareAt?: number | null }, fetchFn: Fetch = fetch, now = new Date()) {
  if (!Number.isFinite(price) || price <= 0) throw new Error('Price must be more than 0');
  if (compareAt != null) throw new Error('Etsy has no compare-at price; put the listing on sale from Shop Manager → Marketing → Sales and discounts');
  const url = `${API}/listings/${listingIdOf(productId)}/inventory`;
  const creds = getCredentials(db, key, 'etsy', storeId);
  if (!creds) throw new Error('Etsy is not connected for this store');
  const synced = syncedPrice(db, storeId, productId);
  await logAction(db, storeId, 'price_change', productId, { price }, async () => {
    const { headers } = await etsyAuth(db, key, `etsy:${storeId}`, creds, fetchFn, now);
    const inv = await etsyEdit<Inventory>(fetchFn, url, { headers });
    if (inv.price_on_property?.length) throw new Error(`Etsy: listing ${productId} is priced per variation; change its prices in Shop Manager`);
    stillAsSynced('Etsy', `price of ${productId}`, money(inv.products.find((p) => !p.is_deleted)?.offerings.find((o) => !o.is_deleted)?.price) || NaN, synced); // none: unread
    // The PUT replaces the whole inventory: every product goes back as read, minus the read-only ids, at the new price.
    const body = {
      products: inv.products.filter((p) => !p.is_deleted).map((p) => ({
        sku: p.sku,
        property_values: p.property_values.map(({ property_id, property_name, scale_id, value_ids, values }) => ({ property_id, ...(property_name ? { property_name } : {}), scale_id: scale_id ?? null, value_ids, values })),
        offerings: p.offerings.filter((o) => !o.is_deleted).map((o) => ({ price, quantity: o.quantity, is_enabled: o.is_enabled, readiness_state_id: o.readiness_state_id ?? null })),
      })),
      price_on_property: [],
      quantity_on_property: inv.quantity_on_property,
      sku_on_property: inv.sku_on_property,
      ...(inv.readiness_state_on_property ? { readiness_state_on_property: inv.readiness_state_on_property } : {}),
    };
    await etsyEdit(fetchFn, url, { method: 'PUT', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  });
  db.prepare('UPDATE products SET price = ?, compare_at = NULL WHERE store_id = ? AND id = ?').run(price, storeId, productId);
}

/**
 * Replaces a live listing's title and description. Call only for an approved request. Same contract as Shopify's
 * publishProductPage. ponytail: SEO fields are skipped (Etsy search reads the title and tags; tags are left alone).
 */
export async function publishEtsyProductPage(db: Db, key: Buffer, storeId: string, productId: string, page: ProductPage, fetchFn: Fetch = fetch, now = new Date()) {
  const listingId = listingIdOf(productId);
  const creds = getCredentials(db, key, 'etsy', storeId);
  if (!creds) throw new Error('Etsy is not connected for this store');
  await logAction(db, storeId, 'product_page_publish', productId, { title: page.title }, async () => {
    const { shopId, headers } = await etsyAuth(db, key, `etsy:${storeId}`, creds, fetchFn, now);
    await etsyEdit(fetchFn, `${API}/shops/${shopId}/listings/${listingId}`, { method: 'PATCH', headers, body: new URLSearchParams({ title: page.title, description: htmlToText(page.descriptionHtml) }) });
  });
  db.prepare('UPDATE products SET title = ? WHERE store_id = ? AND id = ?').run(page.title, storeId, productId);
}
