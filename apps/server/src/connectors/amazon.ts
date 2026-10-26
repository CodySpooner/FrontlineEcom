import { gunzipSync } from 'node:zlib';
import { logAction } from '../actions';
import { tx, type Db } from '../db';
import { addDays, localDate } from '../dates';
import { getCredentials, setIntegrationStatus } from '../integrations';
import { adRate, archiveMissing, catalogPassDone, catalogPassDue, rebuildRevenue, setOrderItems, setStoreCurrency, switchToReal } from './common';

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
  /** Merchant-fulfilled (DEFAULT) stock has a quantity; FBA (AMAZON_NA, AMAZON_EU, …) stock comes from fbaStock. */
  fulfillmentAvailability?: { fulfillmentChannelCode?: string; quantity?: number }[];
}

/**
 * FBA units Amazon can ship now per SKU (FBA Inventory API, Amazon Fulfillment role): all of them, or those whose stock
 * changed since `since`. 50 a page, 2 pages a second.
 */
async function fbaStock(fetchFn: Fetch, host: string, token: string, marketplace: string, since?: string) {
  const out = new Map<string, number>();
  let nextToken: string | undefined;
  do {
    const q = new URLSearchParams({
      details: 'true', granularityType: 'Marketplace', granularityId: marketplace, marketplaceIds: marketplace,
      ...(since ? { startDateTime: since } : {}), ...(nextToken ? { nextToken } : {}),
    });
    const res = await fetchFn(`https://${host}/fba/inventory/v1/summaries?${q}`, { headers: { 'x-amz-access-token': token } });
    const body = (await res.json().catch(() => ({}))) as {
      payload?: { inventorySummaries?: { sellerSku?: string; inventoryDetails?: { fulfillableQuantity?: number } }[] };
      pagination?: { nextToken?: string };
      errors?: { message: string }[];
    };
    if (!res.ok) throw new Error(`Amazon FBA inventory: ${body.errors?.[0]?.message ?? `HTTP ${res.status}`}`);
    for (const s of body.payload?.inventorySummaries ?? []) if (s.sellerSku) out.set(s.sellerSku, s.inventoryDetails?.fulfillableQuantity ?? 0);
    nextToken = body.pagination?.nextToken;
  } while (nextToken);
  return out;
}

/** An integration's entry in a settings row that maps integration ids to read state. */
const stateOf = <T>(db: Db, key: string) => {
  const all = JSON.parse(String(db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key)?.value_json ?? '{}')) as Record<string, T>;
  return {
    get: (id: string) => all[id] as T | undefined,
    set: (id: string, v: T) => {
      all[id] = v;
      db.prepare('INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json').run(key, JSON.stringify(all));
    },
  };
};

interface AmazonOrder {
  orderId: string;
  createdTime: string;
  fulfillment?: { fulfillmentStatus?: string; fulfilledBy?: string };
  /** With includedData PROCEEDS. */
  proceeds?: { grandTotal?: { amount: string } };
  orderItems?: { quantityOrdered: number; product?: { sellerSku?: string; price?: { unitPrice?: { amount: string } } } }[];
  /** Merchant-fulfilled orders only, with includedData PACKAGES. */
  packages?: { trackingNumber?: string }[];
}
type OrderRead = { from: string; page?: string };

/**
 * Orders updated in the last 30 days, then since the last read ended (Orders API 2026-01-01, Inventory and Order Tracking
 * role): 100 a page, a page per 3 minutes after a burst of 20. A read the rate limit cuts short carries on next sync from
 * its page token (good for 24 hours); any other error drops the token, so the read starts over. Returns the orders and
 * where the next read starts.
 */
async function ordersOf(read: OrderRead | undefined, fetchFn: Fetch, host: string, token: string, marketplace: string, now: Date) {
  const from = read?.from ?? new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const orders: AmazonOrder[] = [];
  for (let page = read?.page; ; ) {
    const q = new URLSearchParams({
      marketplaceIds: marketplace, lastUpdatedAfter: from, includedData: 'PROCEEDS,FULFILLMENT,PACKAGES', maxResultsPerPage: '100', ...(page ? { paginationToken: page } : {}),
    });
    const res = await fetchFn(`https://${host}/orders/2026-01-01/orders?${q}`, { headers: { 'x-amz-access-token': token } });
    if (!res.ok) return { orders, next: { from, ...(res.status === 429 && page ? { page } : {}) } };
    const body = (await res.json().catch(() => ({}))) as { orders?: AmazonOrder[]; pagination?: { nextToken?: string }; lastUpdatedBefore?: string };
    orders.push(...(body.orders ?? []));
    page = body.pagination?.nextToken;
    if (!page) return { orders, next: { from: body.lastUpdatedBefore ?? from } };
  }
}

const TRAFFIC_KEY = 'amazon_traffic';
const ORDERS_KEY = 'amazon_orders';

/**
 * Daily sessions from Amazon's Sales and Traffic report (Selling Partner Insights role), for the funnel. A report takes
 * minutes to build, so a sync asks for one a day (two years the first time, then from three days before the last one it
 * got) and a later sync collects it. Undefined until one is ready.
 */
async function trafficOf(db: Db, id: string, fetchFn: Fetch, host: string, token: string, marketplace: string, today: string, fresh: boolean) {
  type State = { day: string; reportId?: string; got?: string };
  const state = stateOf<State>(db, TRAFFIC_KEY);
  const st: State = (!fresh && state.get(id)) || { day: '' };
  const save = (v: Partial<State>) => state.set(id, { ...st, ...v });
  const api = async <T>(path: string, init: RequestInit = {}) => {
    const res = await fetchFn(`https://${host}/reports/2021-06-30${path}`, { ...init, headers: { 'x-amz-access-token': token, 'content-type': 'application/json' } });
    const body = (await res.json().catch(() => ({}))) as T & { errors?: { message: string }[] };
    if (!res.ok) throw new Error(`Amazon reports: ${body.errors?.[0]?.message ?? `HTTP ${res.status}`}`);
    return body;
  };
  if (!st.reportId) {
    if (st.day === today) return;
    save({ day: today }); // one ask a day, even if it fails
    const { reportId } = await api<{ reportId?: string }>('/reports', {
      method: 'POST',
      body: JSON.stringify({
        reportType: 'GET_SALES_AND_TRAFFIC_REPORT', marketplaceIds: [marketplace], dataStartTime: st.got ? addDays(st.got, -3) : addDays(today, -BACKFILL_DAYS), dataEndTime: today,
        reportOptions: { dateGranularity: 'DAY', asinGranularity: 'PARENT' },
      }),
    });
    if (reportId) save({ day: today, reportId });
    return;
  }
  const report = await api<{ processingStatus?: string; reportDocumentId?: string }>(`/reports/${encodeURIComponent(st.reportId)}`);
  if (report.processingStatus === 'IN_QUEUE' || report.processingStatus === 'IN_PROGRESS') return;
  save({ reportId: undefined }); // DONE, or CANCELLED (no data) / FATAL
  if (!report.reportDocumentId) return;
  const doc = await api<{ url?: string; compressionAlgorithm?: string }>(`/documents/${encodeURIComponent(report.reportDocumentId)}`);
  if (!doc.url?.startsWith('https://')) throw new Error('Amazon returned no report link');
  const res = await fetchFn(doc.url); // presigned: no token
  if (!res.ok) throw new Error(`Amazon report download: HTTP ${res.status}`);
  const raw = Buffer.from(await res.arrayBuffer());
  const data = JSON.parse((doc.compressionAlgorithm === 'GZIP' ? gunzipSync(raw) : raw).toString('utf8')) as { salesAndTrafficByDate?: { date: string; trafficByDate?: { sessions?: number } }[] };
  save({ reportId: undefined, got: st.day });
  return (data.salesAndTrafficByDate ?? []).map((d) => ({ date: d.date, sessions: d.trafficByDate?.sessions ?? 0 }));
}

/** A search pages through at most this many SKUs. */
const SEARCH_CAP = 1000;

/**
 * The seller's listings in one marketplace changed since `since` (all of them without it), oldest change first: 20 a
 * page, 5 pages a second. A catalog past the search cap is read in windows, each starting at the last change seen.
 * More than 1000 SKUs changed in the same instant end the windows early: the result is then marked incomplete. Complete
 * reads rely on lastUpdatedAfter being inclusive ("at or after this time" in the Listings Items spec).
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
    const changedSince = full ? undefined : `${addDays(cursor ?? today, -2)}T00:00:00Z`;
    const listings = !own ? undefined : await listingsOf(fetchFn, host, token, creds.sellerId!.trim(), marketplace, changedSince).catch(() => undefined);
    // FBA stock the same way (without the Amazon Fulfillment role, FBA listings stay "not tracked").
    const fba = !own ? undefined : await fbaStock(fetchFn, host, token, marketplace, changedSince).catch(() => undefined);
    // Sessions for the funnel, unless GA4 is connected (it owns the funnel there).
    const traffic = !own || db.prepare('SELECT 1 FROM integrations WHERE id = ?').get(`ga4:${storeId}`) ? undefined
      : await trafficOf(db, id, fetchFn, host, token, marketplace, today, !cursor).catch(() => undefined);
    // Both start over with the cursor (a new connection, or another seller's account).
    const reads = stateOf<OrderRead>(db, ORDERS_KEY);
    const orders = own ? await ordersOf(cursor ? reads.get(id) : undefined, fetchFn, host, token, marketplace, now) : undefined;

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
      const visits = db.prepare('INSERT INTO daily_metrics (store_id, date, sessions) VALUES (?, ?, ?) ON CONFLICT (store_id, date) DO UPDATE SET sessions = excluded.sessions');
      for (const d of traffic ?? []) visits.run(storeId, d.date, d.sessions);
      // Orders fill the orders page and top products; revenue and order counts stay the daily totals above (rebuildRevenue
      // leaves amz- orders out). ponytail: no unit costs here either, so items cost 0.
      const ord = db.prepare(
        `INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, supplier, tracking, cogs, local_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
         ON CONFLICT (store_id, id) DO UPDATE SET total = excluded.total, status = excluded.status, fulfillment_status = excluded.fulfillment_status,
           supplier = excluded.supplier, tracking = coalesce(excluded.tracking, tracking)`,
      );
      for (const o of orders?.orders ?? []) {
        const s = o.fulfillment?.fulfillmentStatus;
        if (s === 'PENDING' || s === 'PENDING_AVAILABILITY') continue; // not paid for yet
        const created = new Date(o.createdTime);
        const items = (o.orderItems ?? []).flatMap((i) => (i.product?.sellerSku ? [{ productId: `amz-${i.product.sellerSku}`, quantity: i.quantityOrdered, revenue: Number(i.product.price?.unitPrice?.amount ?? 0) * i.quantityOrdered, cost: 0 }] : []));
        ord.run(
          storeId, `amz-${o.orderId}`, created.toISOString(), Number(o.proceeds?.grandTotal?.amount ?? items.reduce((a, i) => a + i.revenue, 0)),
          s === 'CANCELLED' || s === 'UNFULFILLABLE' ? 'refunded' : 'paid', s === 'SHIPPED' ? 'fulfilled' : 'unfulfilled', o.fulfillment?.fulfilledBy === 'AMAZON' ? 'Amazon FBA' : null,
          o.packages?.find((p) => p.trackingNumber)?.trackingNumber ?? null, localDate(created, timeZone),
        );
        setOrderItems(db, storeId, `amz-${o.orderId}`, items);
      }
      if (orders) reads.set(id, orders.next);
      // ponytail: Amazon has no unit costs. An FBA listing keeps the stock fbaStock last gave it (its listing has no count).
      const prod = db.prepare(
        `INSERT INTO products (store_id, id, title, image, price, compare_at, cost, inventory, inventory_tracked, status) VALUES (?1, ?2, ?3, ?4, ?5, NULL, 0, ?6, ?7, ?8)
         ON CONFLICT (store_id, id) DO UPDATE SET title = excluded.title, image = excluded.image, price = excluded.price, status = excluded.status,
           inventory = CASE WHEN ?9 THEN inventory ELSE excluded.inventory END, inventory_tracked = CASE WHEN ?9 THEN inventory_tracked ELSE excluded.inventory_tracked END`,
      );
      const merchant = new Set<string>(); // listings that count their own stock
      for (const l of listings ?? []) {
        const s = l.summaries?.[0];
        const counted = (l.fulfillmentAvailability ?? []).filter((f) => typeof f.quantity === 'number');
        if (counted.length) merchant.add(l.sku);
        const price = Number(l.offers?.find((o) => o.offerType === 'B2C')?.price.amount ?? 0);
        // BUYABLE and/or DISCOVERABLE: live (an out-of-stock listing keeps DISCOVERABLE); neither: not live yet.
        const byAmazon = (l.fulfillmentAvailability ?? []).some((f) => f.fulfillmentChannelCode?.startsWith('AMAZON'));
        prod.run(storeId, `amz-${l.sku}`, s?.itemName ?? l.sku, s?.mainImage?.link ?? null, price, counted.reduce((a, f) => a + f.quantity!, 0), counted.length ? 1 : 0, s?.status?.length ? 'active' : 'draft', byAmazon && !counted.length ? 1 : 0);
      }
      const setFba = db.prepare('UPDATE products SET inventory = ?, inventory_tracked = 1 WHERE store_id = ? AND id = ?');
      // A SKU moved to merchant fulfilment can keep an FBA record (0 units): its listing's own count stands.
      for (const [sku, units] of fba ?? []) if (!merchant.has(sku)) setFba.run(units, storeId, `amz-${sku}`);
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
