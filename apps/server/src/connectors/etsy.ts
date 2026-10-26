import type { ProductStatus } from '@frontline/shared';
import { logAction } from '../actions';
import { tx, type Db } from '../db';
import { getCredentials, setIntegrationStatus, updateSecrets } from '../integrations';
import { cursorAt, rebuildRevenue, setOrderItems, setStoreCurrency, switchToReal } from './common';

// Etsy Open API v3: app keystring + shared secret, and the shop owner's OAuth tokens (scopes transactions_r listings_r, and
// listings_w for approved price changes: setEtsyListingPrice).
const API = 'https://openapi.etsy.com/v3/application';
const TOKEN_URL = 'https://api.etsy.com/v3/public/oauth/token';
/** First sync pulls this many days of receipts (1Y range + the previous year for deltas). */
const BACKFILL_DAYS = 730;
const LISTING_STATES = ['active', 'draft', 'inactive'];

type Fetch = typeof fetch;
type Money = { amount: number; divisor: number; currency_code?: string };

interface Receipt {
  receipt_id: number;
  status: string;
  is_paid: boolean;
  is_shipped: boolean;
  create_timestamp: number;
  updated_timestamp: number;
  /** As placed: refunds don't lower it. */
  grandtotal: Money;
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
  updated_timestamp: number;
}

const money = (m: Money | undefined) => (m ? m.amount / m.divisor : 0);
const LISTING_STATUS: Record<string, ProductStatus> = { active: 'active', draft: 'draft' };

/** Access tokens last an hour and refresh tokens rotate, so both are saved (encrypted) right away. */
async function refreshEtsy(db: Db, key: Buffer, id: string, creds: Record<string, string>, fetchFn: Fetch, now: Date) {
  const res = await fetchFn(TOKEN_URL, { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', client_id: creds.apiKey!, refresh_token: creds.refreshToken! }) });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !body.access_token || !body.refresh_token) throw new Error(`Etsy sign-in failed: ${body.error_description ?? body.error ?? `HTTP ${res.status}`}; connect the shop again`);
  updateSecrets(db, key, id, { accessToken: body.access_token, refreshToken: body.refresh_token, accessTokenExpiresAt: String(Math.floor(now.getTime() / 1000) + (body.expires_in ?? 3600)) });
  return body.access_token;
}

/** The shop ID and request headers, renewing the access token when it has under 5 minutes left. */
async function etsyAuth(db: Db, key: Buffer, id: string, creds: Record<string, string>, fetchFn: Fetch, now: Date) {
  const shopId = creds.shopId!.trim();
  if (!/^\d+$/.test(shopId)) throw new Error('Shop ID must be the number of your Etsy shop');
  const fresh = Number(creds.accessTokenExpiresAt) * 1000 - now.getTime() > 5 * 60_000;
  const token = fresh ? creds.accessToken! : await refreshEtsy(db, key, id, creds, fetchFn, now);
  return { shopId, headers: { 'x-api-key': `${creds.apiKey}:${creds.sharedSecret}`, authorization: `Bearer ${token}` } };
}

export async function syncEtsy(db: Db, key: Buffer, storeId: string, fetchFn: Fetch = fetch, now = new Date()) {
  const id = `etsy:${storeId}`;
  const creds = getCredentials(db, key, 'etsy', storeId);
  if (!creds) return;
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
    const listings: Listing[] = [];
    for (const state of LISTING_STATES) {
      for (let offset = 0; ; offset += 100) {
        const page = await get<Listing>(`/shops/${shopId}/listings`, { state, sort_on: 'updated', sort_order: 'desc', limit: '100', offset: String(offset) });
        listings.push(...page.results.filter((l) => l.updated_timestamp >= since));
        if (!page.results.length || offset + 100 >= page.count || page.results.some((l) => l.updated_timestamp < since)) break;
      }
    }
    const dayOf = new Intl.DateTimeFormat('en-CA', { timeZone: String(db.prepare('SELECT timezone FROM stores WHERE id = ?').get(storeId)?.timezone ?? 'UTC') });

    tx(db, () => {
      switchToReal(db, storeId);
      // Receipts and listings are in the shop's currency.
      const currency = receipts[0]?.grandtotal.currency_code ?? listings[0]?.price.currency_code;
      if (currency) setStoreCurrency(db, storeId, currency);
      const prod = db.prepare(
        `INSERT INTO products (store_id, id, title, image, price, compare_at, cost, inventory, status) VALUES (?, ?, ?, NULL, ?, NULL, 0, ?, ?)
         ON CONFLICT (store_id, id) DO UPDATE SET title = excluded.title, price = excluded.price, inventory = excluded.inventory, status = excluded.status`,
      );
      for (const l of listings) prod.run(storeId, `etsy-${l.listing_id}`, l.title, money(l.price), l.quantity, LISTING_STATUS[l.state] ?? 'archived');
      // ponytail: Etsy has no unit costs, so Etsy orders add revenue with cogs 0.
      const ord = db.prepare(
        `INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, supplier, tracking, cogs, local_date) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 0, ?)
         ON CONFLICT (store_id, id) DO UPDATE SET total = excluded.total, status = excluded.status, fulfillment_status = excluded.fulfillment_status, tracking = coalesce(excluded.tracking, tracking)`,
      );
      const days = new Set<string>();
      for (const r of receipts) {
        if (!r.is_paid) continue;
        const created = new Date(r.create_timestamp * 1000);
        const day = dayOf.format(created);
        days.add(day);
        const refunded = r.status === 'canceled' || r.status === 'fully refunded';
        const total = Math.max(0, money(r.grandtotal) - (r.refunds ?? []).reduce((a, x) => a + money(x.amount), 0)); // net of partial refunds
        ord.run(storeId, `etsy-${r.receipt_id}`, created.toISOString(), Math.round(total * 100) / 100, refunded ? 'refunded' : 'paid', r.is_shipped ? 'fulfilled' : 'unfulfilled', r.shipments?.[0]?.tracking_code || null, day);
        setOrderItems(db, storeId, `etsy-${r.receipt_id}`, (r.transactions ?? []).map((t) => ({ productId: `etsy-${t.listing_id}`, quantity: t.quantity, revenue: money(t.price) * t.quantity, cost: 0 })));
      }
      rebuildRevenue(db, storeId, days);
      const next = Math.max(since, Math.floor(cursorAt(now).getTime() / 1000));
      db.prepare("UPDATE integrations SET cursor = ?, synced_at = ?, status = 'connected', error = NULL WHERE id = ?").run(String(next), now.toISOString(), id);
    });
  } catch (e) {
    setIntegrationStatus(db, id, 'error', e instanceof Error ? e.message : 'Etsy sync failed');
  }
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
  const listingId = /^etsy-(\d+)$/.exec(productId)?.[1];
  if (!listingId) throw new Error(`${productId} is not an Etsy listing`);
  const creds = getCredentials(db, key, 'etsy', storeId);
  if (!creds) throw new Error('Etsy is not connected for this store');
  await logAction(db, storeId, 'price_change', productId, { price }, async () => {
    const { headers } = await etsyAuth(db, key, `etsy:${storeId}`, creds, fetchFn, now);
    const call = async <T>(body?: object) => {
      const res = await fetchFn(`${API}/listings/${listingId}/inventory`, body ? { method: 'PUT', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) } : { headers });
      const json = (await res.json().catch(() => ({}))) as Partial<T> & { error?: string };
      // Shops connected before listings_w was asked for get a 403 here.
      if (res.status === 401 || res.status === 403) throw new Error(`Etsy refused the change (${json.error ?? `HTTP ${res.status}`}); connect Etsy again so the app may edit listings`);
      if (!res.ok) throw new Error(`Etsy: ${json.error ?? `HTTP ${res.status}`}`);
      return json;
    };
    const inv = (await call<Inventory>()) as Inventory;
    if (inv.price_on_property?.length) throw new Error(`Etsy: listing ${productId} is priced per variation; change its prices in Shop Manager`);
    // The PUT replaces the whole inventory: every product goes back as read, minus the read-only ids, at the new price.
    await call({
      products: inv.products.filter((p) => !p.is_deleted).map((p) => ({
        sku: p.sku,
        property_values: p.property_values.map(({ property_id, property_name, scale_id, value_ids, values }) => ({ property_id, ...(property_name ? { property_name } : {}), scale_id: scale_id ?? null, value_ids, values })),
        offerings: p.offerings.filter((o) => !o.is_deleted).map((o) => ({ price, quantity: o.quantity, is_enabled: o.is_enabled, readiness_state_id: o.readiness_state_id ?? null })),
      })),
      price_on_property: [],
      quantity_on_property: inv.quantity_on_property,
      sku_on_property: inv.sku_on_property,
      ...(inv.readiness_state_on_property ? { readiness_state_on_property: inv.readiness_state_on_property } : {}),
    });
  });
  db.prepare('UPDATE products SET price = ?, compare_at = NULL WHERE store_id = ? AND id = ?').run(price, storeId, productId);
}
