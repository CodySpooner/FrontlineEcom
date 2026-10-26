import type { ProductStatus } from '@frontline/shared';
import { tx, type Db } from '../db';
import { getCredentials, setIntegrationStatus, updateSecrets } from '../integrations';
import { rebuildRevenue, setOrderItems, switchToReal } from './common';

// Etsy Open API v3: app keystring + shared secret, and the shop owner's OAuth tokens (scopes transactions_r listings_r).
const API = 'https://openapi.etsy.com/v3/application';
const TOKEN_URL = 'https://api.etsy.com/v3/public/oauth/token';
/** First sync pulls this many days of receipts (1Y range + the previous year for deltas). */
const BACKFILL_DAYS = 730;
const LISTING_STATES = ['active', 'draft', 'inactive'];

type Fetch = typeof fetch;
type Money = { amount: number; divisor: number };

interface Receipt {
  receipt_id: number;
  status: string;
  is_paid: boolean;
  is_shipped: boolean;
  create_timestamp: number;
  updated_timestamp: number;
  grandtotal: Money;
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

export async function syncEtsy(db: Db, key: Buffer, storeId: string, fetchFn: Fetch = fetch, now = new Date()) {
  const id = `etsy:${storeId}`;
  const creds = getCredentials(db, key, 'etsy', storeId);
  if (!creds) return;
  try {
    const shopId = creds.shopId!.trim();
    if (!/^\d+$/.test(shopId)) throw new Error('Shop ID must be the number of your Etsy shop');
    const fresh = Number(creds.accessTokenExpiresAt) * 1000 - now.getTime() > 5 * 60_000;
    const token = fresh ? creds.accessToken! : await refreshEtsy(db, key, id, creds, fetchFn, now);
    const headers = { 'x-api-key': `${creds.apiKey}:${creds.sharedSecret}`, authorization: `Bearer ${token}` };
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
        ord.run(storeId, `etsy-${r.receipt_id}`, created.toISOString(), money(r.grandtotal), refunded ? 'refunded' : 'paid', r.is_shipped ? 'fulfilled' : 'unfulfilled', r.shipments?.[0]?.tracking_code || null, day);
        setOrderItems(db, storeId, `etsy-${r.receipt_id}`, (r.transactions ?? []).map((t) => ({ productId: `etsy-${t.listing_id}`, quantity: t.quantity, revenue: money(t.price) * t.quantity, cost: 0 })));
      }
      rebuildRevenue(db, storeId, days);
      const newest = [...receipts, ...listings].reduce((m, x) => Math.max(m, x.updated_timestamp), since);
      db.prepare("UPDATE integrations SET cursor = ?, synced_at = ?, status = 'connected', error = NULL WHERE id = ?").run(String(newest), now.toISOString(), id);
    });
  } catch (e) {
    setIntegrationStatus(db, id, 'error', e instanceof Error ? e.message : 'Etsy sync failed');
  }
}
