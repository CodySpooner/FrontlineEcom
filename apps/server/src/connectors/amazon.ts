import { logAction } from '../actions';
import { tx, type Db } from '../db';
import { addDays, localDate } from '../dates';
import { getCredentials, setIntegrationStatus } from '../integrations';
import { adRate, archiveMissing, catalogPassDone, catalogPassDue, rebuildRevenue, setStoreCurrency, switchToReal } from './common';

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
  summaries?: { itemName?: string; status?: string[]; mainImage?: { link: string }; lastUpdatedDate?: string }[];
  offers?: { offerType: string; price: { amount: string } }[];
  /** Merchant-fulfilled stock has a quantity; FBA stock isn't reported here. */
  fulfillmentAvailability?: { quantity?: number }[];
}

/** A search pages through at most this many SKUs. */
const SEARCH_CAP = 1000;

/**
 * The seller's listings in one marketplace changed since `since` (all of them without it), oldest change first: 20 a
 * page, 5 pages a second. A catalog past the search cap is read in windows, each starting at the last change seen.
 * More than 1000 SKUs changed in the same instant end the windows early: the result is then marked incomplete.
 */
async function listingsOf(fetchFn: Fetch, host: string, token: string, sellerId: string, marketplace: string, since?: string) {
  const out: Listing[] = [];
  for (let from = since; ; ) {
    let [pageToken, n] = [undefined as string | undefined, 0];
    do {
      const q = new URLSearchParams({
        marketplaceIds: marketplace, includedData: 'summaries,offers,fulfillmentAvailability', pageSize: '20', sortBy: 'lastUpdatedDate', sortOrder: 'ASC',
        ...(from ? { lastUpdatedAfter: from } : {}), ...(pageToken ? { pageToken } : {}),
      });
      const res = await fetchFn(`https://${host}/listings/2021-08-01/items/${encodeURIComponent(sellerId)}?${q}`, { headers: { 'x-amz-access-token': token } });
      const body = (await res.json().catch(() => ({}))) as { items?: Listing[]; pagination?: { nextToken?: string }; errors?: { message: string }[] };
      if (!res.ok) throw new Error(`Amazon listings: ${body.errors?.[0]?.message ?? `HTTP ${res.status}`}`);
      out.push(...(body.items ?? []));
      n += body.items?.length ?? 0;
      pageToken = body.pagination?.nextToken;
    } while (pageToken);
    const last = out.at(-1)?.summaries?.[0]?.lastUpdatedDate;
    if (n < SEARCH_CAP || !last || last === from) return Object.assign(out, { complete: n < SEARCH_CAP });
    from = last;
  }
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

/** The seller's API host, marketplace and a fresh LWA access token. */
async function amazonAuth(creds: Record<string, string>, fetchFn: Fetch) {
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
  return { host, marketplace, token: auth.access_token };
}

export async function syncAmazon(db: Db, key: Buffer, storeId: string, fetchFn: Fetch = fetch, now = new Date()) {
  const id = `amazon:${storeId}`;
  const creds = getCredentials(db, key, 'amazon', storeId);
  if (!creds) return;
  try {
    const { host, marketplace, token } = await amazonAuth(creds, fetchFn);

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
    const res = await fetchFn(`https://${host}/sales/v1/orderMetrics?${params}`, { headers: { 'x-amz-access-token': token } });
    const body = (await res.json().catch(() => ({}))) as { payload?: { interval: string; orderCount: number; totalSales: { amount: number; currencyCode?: string } }[]; errors?: { message: string }[] };
    if (res.status === 403) throw new Error('Amazon refused access; the SP-API app needs the Selling Partner Insights (sales) role for this seller');
    if (!res.ok) throw new Error(`Amazon: ${body.errors?.[0]?.message ?? `HTTP ${res.status}`}`);
    // An Amazon store takes its marketplace's currency; Amazon as an extra channel is converted into the store's.
    const currency = body.payload?.find((d) => d.totalSales?.currencyCode)?.totalSales.currencyCode;
    const own = db.prepare('SELECT platform FROM stores WHERE id = ?').get(storeId)?.platform === 'amazon';
    const rate = own ? 1 : await adRate(db, storeId, currency, fetchFn, 'Amazon');
    // The whole catalog until the store has Amazon products (so adding the Product Listing role later still pulls it all)
    // and once a day after (archiving listings that are gone); otherwise what changed since two days before the last sync.
    // Without the role (or on any error) sales sync on and the catalog is left as it is.
    const have = db.prepare("SELECT 1 FROM products WHERE store_id = ? AND id GLOB 'amz-*'").get(storeId);
    const full = !have || catalogPassDue(db, id, today);
    const listings = !own ? undefined
      : await listingsOf(fetchFn, host, token, creds.sellerId!.trim(), marketplace, full ? undefined : `${addDays(cursor ?? today, -2)}T00:00:00Z`).catch(() => undefined);

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
      for (const l of listings ?? []) {
        const s = l.summaries?.[0];
        const counted = (l.fulfillmentAvailability ?? []).filter((f) => typeof f.quantity === 'number');
        const price = Number(l.offers?.find((o) => o.offerType === 'B2C')?.price.amount ?? 0);
        // BUYABLE and/or DISCOVERABLE: live (an out-of-stock listing keeps DISCOVERABLE); neither: not live yet.
        prod.run(storeId, `amz-${l.sku}`, s?.itemName ?? l.sku, s?.mainImage?.link ?? null, price, counted.reduce((a, f) => a + f.quantity!, 0), counted.length ? 1 : 0, s?.status?.length ? 'active' : 'draft');
      }
      // A read cut short by the search cap can't tell gone from unread: it archives nothing (and isn't retried until tomorrow).
      if (listings && full) {
        if (listings.complete) archiveMissing(db, id, storeId, 'amz-*', listings.map((l) => `amz-${l.sku}`), today);
        else catalogPassDone(db, id, today);
      }
      db.prepare("UPDATE integrations SET cursor = ?, synced_at = ?, status = 'connected', error = NULL WHERE id = ?").run(today, now.toISOString(), id);
    });
  } catch (e) {
    setIntegrationStatus(db, id, 'error', e instanceof Error ? e.message : 'Amazon sync failed');
  }
}

/** One price in a purchasable_offer schedule. */
type Scheduled = { schedule?: { value_with_tax?: number; start_at?: string; end_at?: string }[] }[];
interface Offer {
  marketplace_id?: string;
  audience?: string;
  currency?: string;
  discounted_price?: Scheduled;
  minimum_seller_allowed_price?: Scheduled;
  maximum_seller_allowed_price?: Scheduled;
}
const first = (p?: Scheduled) => p?.[0]?.schedule?.[0];

/**
 * Sets a live listing's price (its consumer offer's our_price in the store's marketplace), merging so the sale price,
 * min/max and B2B prices stay as they are. Call only for an approved request. Same contract as Shopify's
 * setProductPrice, except Amazon has no compare-at price. Amazon applies an accepted change within minutes.
 */
export async function setAmazonListingPrice(db: Db, key: Buffer, storeId: string, productId: string, { price, compareAt }: { price: number; compareAt?: number | null }, fetchFn: Fetch = fetch, now = new Date()) {
  if (!Number.isFinite(price) || price <= 0) throw new Error('Price must be more than 0');
  if (compareAt != null) throw new Error('Amazon has no compare-at price; set a sale price in Seller Central');
  if (!productId.startsWith('amz-')) throw new Error(`${productId} is not an Amazon listing`);
  const creds = getCredentials(db, key, 'amazon', storeId);
  if (!creds) throw new Error('Amazon is not connected for this store');
  const sku = productId.slice(4);
  await logAction(db, storeId, 'price_change', productId, { price }, async () => {
    const { host, marketplace, token } = await amazonAuth(creds, fetchFn);
    const url = `https://${host}/listings/2021-08-01/items/${encodeURIComponent(creds.sellerId!.trim())}/${encodeURIComponent(sku)}`;
    const call = async <T,>(init: RequestInit, query: Record<string, string>) => {
      const res = await fetchFn(`${url}?${new URLSearchParams({ marketplaceIds: marketplace, ...query })}`, { ...init, headers: { 'x-amz-access-token': token, 'content-type': 'application/json' } });
      const body = (await res.json().catch(() => ({}))) as T & { errors?: { message: string }[] };
      if (res.status === 403) throw new Error('Amazon refused the change; the SP-API app needs the Product Listing role for this seller');
      if (!res.ok) throw new Error(`Amazon: ${body.errors?.[0]?.message ?? `HTTP ${res.status}`}`);
      return body;
    };
    const item = await call<{ summaries?: { productType?: string }[]; attributes?: { purchasable_offer?: Offer[] } }>({}, { includedData: 'summaries,attributes' });
    const productType = item.summaries?.[0]?.productType;
    if (!productType) throw new Error(`Amazon: listing ${sku} not found in this marketplace`);
    const offer = item.attributes?.purchasable_offer?.find((o) => o.marketplace_id === marketplace && (o.audience ?? 'ALL') === 'ALL');
    if (!offer?.currency) throw new Error(`Amazon: listing ${sku} has no offer to reprice in this marketplace`);
    // A running sale is what buyers pay, so a new regular price wouldn't show; min/max outside the price deactivates the offer.
    const sale = first(offer.discounted_price);
    if (sale?.value_with_tax != null && (!sale.end_at || Date.parse(sale.end_at) > now.getTime())) throw new Error(`Amazon: listing ${sku} has a sale price running or scheduled; change it in Seller Central`);
    const [min, max] = [first(offer.minimum_seller_allowed_price)?.value_with_tax, first(offer.maximum_seller_allowed_price)?.value_with_tax];
    if ((min != null && price < min) || (max != null && price > max)) throw new Error(`Amazon: ${price} is outside the ${min ?? 0}–${max ?? '∞'} price range set for listing ${sku} in Seller Central`);
    const res = await call<{ status?: string; issues?: { message: string; severity: string }[] }>(
      {
        method: 'PATCH',
        body: JSON.stringify({
          productType,
          patches: [{ op: 'merge', path: '/attributes/purchasable_offer', value: [{ marketplace_id: marketplace, currency: offer.currency, audience: 'ALL', our_price: [{ schedule: [{ value_with_tax: price }] }] }] }],
        }),
      },
      {},
    );
    if (res.status !== 'ACCEPTED') throw new Error(`Amazon: ${res.issues?.find((i) => i.severity === 'ERROR')?.message ?? `the change was ${res.status ?? 'not accepted'}`}`);
  });
  db.prepare('UPDATE products SET price = ?, compare_at = NULL WHERE store_id = ? AND id = ?').run(price, storeId, productId);
}
