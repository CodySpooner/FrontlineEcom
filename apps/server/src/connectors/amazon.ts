import { tx, type Db } from '../db';
import { addDays, localDate } from '../dates';
import { getCredentials, setIntegrationStatus } from '../integrations';
import { adRate, rebuildRevenue, setStoreCurrency, switchToReal } from './common';

// Amazon Selling Partner API, read-only analytics first: daily sales + order counts from the Sales API (one call covers
// two years, where the Orders API allows about one request a minute). LWA refresh token from a private SP-API app.
// An Amazon store also gets its listings as products (Listings Items API, Product Listing role).
const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const HOSTS: Record<string, string> = { na: 'sellingpartnerapi-na.amazon.com', eu: 'sellingpartnerapi-eu.amazon.com', fe: 'sellingpartnerapi-fe.amazon.com' };
/** The Sales API serves up to two years back. */
const BACKFILL_DAYS = 729;
/** Recent days still change (cancellations, late orders), so later syncs re-pull them. */
const SETTLE_DAYS = 14;

type Fetch = typeof fetch;

interface Listing {
  sku: string;
  /** One per marketplace asked for. */
  summaries?: { itemName?: string; status?: string[]; mainImage?: { link: string } }[];
  offers?: { offerType: string; price: { amount: string } }[];
  /** Merchant-fulfilled stock has a quantity; FBA stock isn't reported here. */
  fulfillmentAvailability?: { quantity?: number }[];
}

/** The seller's listings in one marketplace, changed since `since` (all of them without it). 20 a page, 5 pages a second. */
async function listingsOf(fetchFn: Fetch, host: string, token: string, sellerId: string, marketplace: string, since?: string) {
  const out: Listing[] = [];
  let pageToken: string | undefined;
  do {
    const q = new URLSearchParams({ marketplaceIds: marketplace, includedData: 'summaries,offers,fulfillmentAvailability', pageSize: '20', ...(since ? { lastUpdatedAfter: since } : {}), ...(pageToken ? { pageToken } : {}) });
    const res = await fetchFn(`https://${host}/listings/2021-08-01/items/${encodeURIComponent(sellerId)}?${q}`, { headers: { 'x-amz-access-token': token } });
    const body = (await res.json().catch(() => ({}))) as { items?: Listing[]; pagination?: { nextToken?: string }; errors?: { message: string }[] };
    if (!res.ok) throw new Error(`Amazon listings: ${body.errors?.[0]?.message ?? `HTTP ${res.status}`}`);
    out.push(...(body.items ?? []));
    pageToken = body.pagination?.nextToken;
  } while (pageToken);
  return out;
}

/** "+02:00" / "-07:00": `timeZone`'s UTC offset at local midnight starting `date`. */
export function midnightOffset(timeZone: string, date: string) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' });
  const minutes = (ms: number) => {
    const m = /GMT([+-])(\d\d):(\d\d)/.exec(fmt.formatToParts(ms).find((p) => p.type === 'timeZoneName')!.value);
    return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  };
  const utcMidnight = Date.parse(`${date}T00:00:00Z`);
  const off = minutes(utcMidnight - minutes(utcMidnight) * 60_000);
  const abs = Math.abs(off);
  return `${off < 0 ? '-' : '+'}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

export async function syncAmazon(db: Db, key: Buffer, storeId: string, fetchFn: Fetch = fetch, now = new Date()) {
  const id = `amazon:${storeId}`;
  const creds = getCredentials(db, key, 'amazon', storeId);
  if (!creds) return;
  try {
    const host = HOSTS[creds.region!.trim().toLowerCase()];
    if (!host) throw new Error('Region must be na, eu or fe');
    const marketplace = creds.marketplaceId!.trim().toUpperCase();
    if (!/^[A-Z0-9]{8,16}$/.test(marketplace)) throw new Error('Marketplace ID must look like ATVPDKIKX0DER');

    const lwa = await fetchFn(LWA_TOKEN_URL, {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: creds.refreshToken!, client_id: creds.clientId!, client_secret: creds.clientSecret! }),
    });
    const auth = (await lwa.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
    if (!lwa.ok || !auth.access_token) throw new Error(`Amazon sign-in failed: ${auth.error_description ?? auth.error ?? `HTTP ${lwa.status}`}; check the LWA client and refresh token`);

    const timeZone = String(db.prepare('SELECT timezone FROM stores WHERE id = ?').get(storeId)?.timezone ?? 'UTC');
    const today = localDate(now);
    const cursor = db.prepare('SELECT cursor FROM integrations WHERE id = ?').get(id)?.cursor as string | null;
    const start = cursor ? addDays(cursor, -SETTLE_DAYS) : addDays(today, -BACKFILL_DAYS);
    const end = addDays(today, 1);
    const params = new URLSearchParams({
      marketplaceIds: marketplace,
      interval: `${start}T00:00:00${midnightOffset(timeZone, start)}--${end}T00:00:00${midnightOffset(timeZone, end)}`,
      granularity: 'Day',
      granularityTimeZone: timeZone,
    });
    const res = await fetchFn(`https://${host}/sales/v1/orderMetrics?${params}`, { headers: { 'x-amz-access-token': auth.access_token } });
    const body = (await res.json().catch(() => ({}))) as { payload?: { interval: string; orderCount: number; totalSales: { amount: number; currencyCode?: string } }[]; errors?: { message: string }[] };
    if (res.status === 403) throw new Error('Amazon refused access; the SP-API app needs the Selling Partner Insights (sales) role for this seller');
    if (!res.ok) throw new Error(`Amazon: ${body.errors?.[0]?.message ?? `HTTP ${res.status}`}`);
    // An Amazon store takes its marketplace's currency; Amazon as an extra channel is converted into the store's.
    const currency = body.payload?.find((d) => d.totalSales?.currencyCode)?.totalSales.currencyCode;
    const own = db.prepare('SELECT platform FROM stores WHERE id = ?').get(storeId)?.platform === 'amazon';
    const rate = own ? 1 : await adRate(db, storeId, currency, fetchFn, 'Amazon');
    // Everything until the store has Amazon products (so adding the Product Listing role later still pulls the whole
    // catalog), then what changed in the last two days. Without the role, sales sync on and the catalog stays empty.
    const have = db.prepare("SELECT 1 FROM products WHERE store_id = ? AND id GLOB 'amz-*'").get(storeId);
    const listings = own ? await listingsOf(fetchFn, host, auth.access_token, creds.sellerId!.trim(), marketplace, have ? `${addDays(today, -2)}T00:00:00Z` : undefined).catch(() => []) : [];

    tx(db, () => {
      switchToReal(db, storeId);
      if (own && currency) setStoreCurrency(db, storeId, currency);
      const up = db.prepare(
        `INSERT INTO channel_daily (store_id, channel, date, revenue, orders) VALUES (?, 'amazon', ?, ?, ?)
         ON CONFLICT (store_id, channel, date) DO UPDATE SET revenue = excluded.revenue, orders = excluded.orders`,
      );
      const days = new Set<string>();
      for (const d of body.payload ?? []) {
        const date = d.interval.slice(0, 10);
        days.add(date);
        up.run(storeId, date, Math.round(Number(d.totalSales?.amount ?? 0) * rate * 100) / 100, d.orderCount ?? 0);
      }
      rebuildRevenue(db, storeId, days);
      // ponytail: Amazon has no unit costs and FBA stock isn't in this call (that's the FBA Inventory API), so an FBA-only
      // listing reads as stock not tracked.
      const prod = db.prepare(
        `INSERT INTO products (store_id, id, title, image, price, compare_at, cost, inventory, inventory_tracked, status) VALUES (?, ?, ?, ?, ?, NULL, 0, ?, ?, ?)
         ON CONFLICT (store_id, id) DO UPDATE SET title = excluded.title, image = excluded.image, price = excluded.price, inventory = excluded.inventory,
           inventory_tracked = excluded.inventory_tracked, status = excluded.status`,
      );
      for (const l of listings) {
        const s = l.summaries?.[0];
        const counted = (l.fulfillmentAvailability ?? []).filter((f) => typeof f.quantity === 'number');
        const price = Number(l.offers?.find((o) => o.offerType === 'B2C')?.price.amount ?? 0);
        // BUYABLE and/or DISCOVERABLE: live (an out-of-stock listing keeps DISCOVERABLE); neither: not live yet.
        prod.run(storeId, `amz-${l.sku}`, s?.itemName ?? l.sku, s?.mainImage?.link ?? null, price, counted.reduce((a, f) => a + f.quantity!, 0), counted.length ? 1 : 0, s?.status?.length ? 'active' : 'draft');
      }
      db.prepare("UPDATE integrations SET cursor = ?, synced_at = ?, status = 'connected', error = NULL WHERE id = ?").run(today, now.toISOString(), id);
    });
  } catch (e) {
    setIntegrationStatus(db, id, 'error', e instanceof Error ? e.message : 'Amazon sync failed');
  }
}
