import { gunzipSync } from 'node:zlib';
import { logAction } from '../actions';
import { once, tx, type Db } from '../db';
import { addDays, localDate, midnight } from '../dates';
import { getCredentials, setIntegrationStatus } from '../integrations';
import { adRate, archiveMissing, backfillRate, catalogPassDone, catalogPassDue, rebuildRevenue, setOrderItems, setStoreCurrency, stateOf, switchToReal, syncView, stillAsSynced, syncedPrice } from './common';
import { noted, noteFailed, noteRead } from './ingest';

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
  /** ERROR issues keep the listing from being bought or shown. */
  issues?: { severity?: string; message?: string }[];
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

interface AmazonOrder {
  orderId: string;
  createdTime: string;
  salesChannel?: { marketplaceId?: string };
  fulfillment?: { fulfillmentStatus?: string; fulfilledBy?: string };
  /** With includedData PROCEEDS. */
  proceeds?: { grandTotal?: { amount: string } };
  orderItems?: {
    orderItemId?: string;
    quantityOrdered: number;
    product?: { sellerSku?: string; price?: { unitPrice?: { amount: string } } };
    /** With PROCEEDS: ITEM, SHIPPING, GIFT_WRAP, COD_FEE, OTHER, TAX and DISCOUNT subtotals. */
    proceeds?: { breakdowns?: { type?: string; subtotal?: { amount: string } }[] };
  }[];
  /** Merchant-fulfilled orders only, with includedData PACKAGES. */
  packages?: { trackingNumber?: string }[];
}
/** Where the next orders read starts, for one seller account (`sellerId/marketplace`). */
type OrderRead = { account?: string; from: string; page?: string };

/**
 * Orders updated in the last 30 days, then since the last read ended (Orders API 2026-01-01, Inventory and Order Tracking
 * role): 100 a page, a page per 3 minutes after a burst of 20. A read the rate limit cuts short carries on next sync from
 * its page token (good for 24 hours); any other error drops the token, so the read starts over. Returns the orders and
 * where the next read starts.
 */
async function ordersOf(read: OrderRead | undefined, fetchFn: Fetch, host: string, token: string, marketplace: string, now: Date): Promise<{ orders: AmazonOrder[]; next: OrderRead }> {
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

/**
 * Orders refunds point at that the store doesn't have (bought before its orders read began, 30 days before connecting),
 * read one by one (getOrder: 0.5 a second, bursts of 30), up to 20 a sync. Returns this marketplace's, and the ids
 * settled (found, another marketplace's, or not there) so they aren't asked for again. Stops at the first other error.
 */
async function refundedOrders(ids: string[], fetchFn: Fetch, host: string, token: string, marketplace: string) {
  const found: AmazonOrder[] = [];
  const settled: string[] = [];
  for (const id of ids.slice(0, 20)) {
    const res = await fetchFn(`https://${host}/orders/2026-01-01/orders/${encodeURIComponent(id)}?includedData=PROCEEDS,FULFILLMENT,PACKAGES`, { headers: { 'x-amz-access-token': token } });
    if (!res.ok && res.status !== 404) break;
    const body = (await res.json().catch(() => ({}))) as AmazonOrder & { order?: AmazonOrder };
    const o = body.order ?? body; // ponytail: wrapped as in the docs' searchOrders; bare taken too
    if (o.orderId === id && o.salesChannel?.marketplaceId === marketplace) found.push(o);
    settled.push(id);
  }
  return { found, settled };
}

type Money = { CurrencyCode?: string; CurrencyAmount?: number };
type Fees = { FeeType?: string; FeeAmount?: Money }[];
/** A shipment or refund event (Finances v0 ShipmentEvent): charges are what the buyer paid (negative on a refund), fees negative. */
interface RefundEvent {
  AmazonOrderId?: string;
  PostedDate?: string;
  ShipmentFeeList?: Fees;
  ShipmentFeeAdjustmentList?: Fees;
  OrderFeeList?: Fees;
  OrderFeeAdjustmentList?: Fees;
  ShipmentItemList?: { SellerSKU?: string; ItemFeeList?: Fees }[];
  ShipmentItemAdjustmentList?: {
    SellerSKU?: string;
    OrderAdjustmentItemId?: string;
    QuantityShipped?: number;
    ItemChargeAdjustmentList?: { ChargeType?: string; ChargeAmount?: Money }[];
    ItemFeeAdjustmentList?: Fees;
    PromotionAdjustmentList?: { PromotionAmount?: Money }[];
  }[];
}
/** Where the last refunds read ended (its PostedBefore), for one seller account. */
type RefundRead = { account?: string; to: string };

/**
 * Refund and shipment events (Finances API v0, Finance and Accounting role): the last 30 days at first, then from
 * SETTLE_DAYS before the last read ended (events post late, and an order's fees settle over days), at most hourly.
 * Re-read events replace their rows, never add to them. The API lists every financial event, 100 a page at 0.5 pages a
 * second, so a busy seller's read takes a while. Undefined when the last read is under an hour old.
 */
async function refundsOf(read: RefundRead | undefined, fetchFn: Fetch, host: string, token: string, now: Date) {
  if (read && now.getTime() - Date.parse(read.to) < 3_600_000) return;
  const to = new Date(now.getTime() - 5 * 60_000).toISOString(); // Amazon wants it over two minutes ago
  const back = read ? Date.parse(read.to) - SETTLE_DAYS * 86_400_000 : now.getTime() - 30 * 86_400_000;
  const from = new Date(Math.max(back, now.getTime() - 179 * 86_400_000)).toISOString(); // a window is 180 days at most
  const refunds: RefundEvent[] = [];
  const shipments: RefundEvent[] = [];
  let next: string | undefined;
  do {
    const q = new URLSearchParams({ PostedAfter: from, PostedBefore: to, MaxResultsPerPage: '100', ...(next ? { NextToken: next } : {}) });
    const res = await fetchFn(`https://${host}/finances/v0/financialEvents?${q}`, { headers: { 'x-amz-access-token': token } });
    const body = (await res.json().catch(() => ({}))) as { payload?: { NextToken?: string; FinancialEvents?: { RefundEventList?: RefundEvent[]; ShipmentEventList?: RefundEvent[] } }; errors?: { message: string }[] };
    if (!res.ok) throw new Error(`Amazon finances: ${body.errors?.[0]?.message ?? `HTTP ${res.status}`}`);
    refunds.push(...(body.payload?.FinancialEvents?.RefundEventList ?? []));
    shipments.push(...(body.payload?.FinancialEvents?.ShipmentEventList ?? []));
    next = body.payload?.NextToken;
  } while (next);
  return { refunds, shipments, next: { to } };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
/** A refunded charge's part (decision 9): the selling price and its discounts are merchandise, then shipping, taxes, other. */
const chargePart = (type = ''): 'merchandise' | 'shipping' | 'tax' | 'other' =>
  type === 'Principal' || type === 'Discount' ? 'merchandise' : type === 'ShippingCharge' ? 'shipping' : /Tax/.test(type) ? 'tax' : 'other';
/** An event's fees by type, as costs (Amazon sends them negative; a refund's give-backs come out negative here). */
function feesOf(e: RefundEvent) {
  const by = new Map<string, { amount: number; currency: string | null }>();
  const lists = [e.ShipmentFeeList, e.ShipmentFeeAdjustmentList, e.OrderFeeList, e.OrderFeeAdjustmentList, ...(e.ShipmentItemList ?? []).map((i) => i.ItemFeeList), ...(e.ShipmentItemAdjustmentList ?? []).map((i) => i.ItemFeeAdjustmentList)];
  for (const f of lists.flatMap((l) => l ?? [])) {
    if (!f.FeeType) continue;
    const b = by.get(f.FeeType) ?? { amount: 0, currency: f.FeeAmount?.CurrencyCode ?? null };
    by.set(f.FeeType, { ...b, amount: b.amount - Number(f.FeeAmount?.CurrencyAmount ?? 0) });
  }
  return by;
}

const TRAFFIC_KEY = 'amazon_traffic';
const ORDERS_KEY = 'amazon_orders';
const REFUNDS_KEY = 'amazon_refund_reads';

/**
 * Daily sessions from Amazon's Sales and Traffic report (Selling Partner Insights role), for the funnel. A report takes
 * minutes to build, so a sync asks for one a day (up to yesterday: two years the first time, then from three days before
 * the last one collected) and a later sync collects it. Undefined until one is ready; then `collected()` records it, to call
 * once the sessions are written. State is per seller account (`sellerId/marketplace`).
 */
async function trafficOf(db: Db, id: string, account: string, fetchFn: Fetch, host: string, token: string, marketplace: string, today: string) {
  type State = { account?: string; day: string; reportId?: string; got?: string };
  const state = stateOf<State>(db, TRAFFIC_KEY);
  const saved = state.get(id);
  const st: State = saved?.account === account ? saved : { account, day: '' };
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
        reportType: 'GET_SALES_AND_TRAFFIC_REPORT', marketplaceIds: [marketplace], dataStartTime: st.got ? addDays(st.got, -3) : addDays(today, -BACKFILL_DAYS), dataEndTime: addDays(today, -1),
        reportOptions: { dateGranularity: 'DAY', asinGranularity: 'PARENT' },
      }),
    });
    if (reportId) save({ day: today, reportId });
    return;
  }
  try {
    const report = await api<{ processingStatus?: string; reportDocumentId?: string }>(`/reports/${encodeURIComponent(st.reportId)}`);
    if (report.processingStatus === 'IN_QUEUE' || report.processingStatus === 'IN_PROGRESS') return;
    if (report.processingStatus !== 'DONE' || !report.reportDocumentId) return void save({ reportId: undefined }); // CANCELLED (no data) or FATAL
    const doc = await api<{ url?: string; compressionAlgorithm?: string }>(`/documents/${encodeURIComponent(report.reportDocumentId)}`);
    if (!doc.url?.startsWith('https://')) throw new Error('Amazon returned no report link');
    const res = await fetchFn(doc.url); // presigned: no token
    if (!res.ok) throw new Error(`Amazon report download: HTTP ${res.status}`);
    const raw = Buffer.from(await res.arrayBuffer());
    const data = JSON.parse((doc.compressionAlgorithm === 'GZIP' ? gunzipSync(raw) : raw).toString('utf8')) as { salesAndTrafficByDate?: { date: string; trafficByDate?: { sessions?: number } }[] };
    return {
      days: (data.salesAndTrafficByDate ?? []).map((d) => ({ date: d.date, sessions: d.trafficByDate?.sessions ?? 0 })),
      collected: () => save({ reportId: undefined, got: st.day }),
    };
  } catch (e) {
    if (st.day !== today) save({ reportId: undefined }); // still unreadable a day later: ask for a new one
    throw e;
  }
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
        marketplaceIds: marketplace, includedData: 'summaries,offers,fulfillmentAvailability,issues', pageSize: '20', sortBy: 'lastUpdatedDate', sortOrder: 'ASC',
        ...(from ? { lastUpdatedAfter: from } : {}), ...(pageToken ? { pageToken } : {}),
      });
      const res = await fetchFn(`https://${host}/listings/2021-08-01/items/${encodeURIComponent(sellerId)}?${q}`, { headers: { 'x-amz-access-token': token } });
      const body = (await res.json().catch(() => ({}))) as { items?: Listing[]; pagination?: { nextToken?: string }; errors?: { message: string }[] };
      // No items list (an error page sent as 200, say) isn't an empty catalog: the full pass would archive every listing.
      if (!res.ok || !Array.isArray(body.items)) throw new Error(`Amazon listings: ${body.errors?.[0]?.message ?? `HTTP ${res.status}`}`);
      out.push(...body.items);
      n += body.items.length;
      pageToken = body.pagination?.nextToken;
    } while (pageToken);
    const last = out.at(-1)?.summaries?.[0]?.lastUpdatedDate;
    if (n < SEARCH_CAP || !last || last === from) return Object.assign(out, { complete: n < SEARCH_CAP });
    from = last;
  }
}

/** "+02:00" / "-07:00": `timeZone`'s UTC offset at local midnight starting `date`. */
export function midnightOffset(timeZone: string, date: string) {
  const off = (Date.parse(`${date}T00:00:00Z`) - midnight(date, timeZone)) / 60_000;
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
  const view = syncView(db, id);
  try {
    const { host, marketplace, token } = await amazonAuth(creds, fetchFn);
    const account = `${creds.sellerId?.trim()}/${marketplace}`; // whose orders and traffic the saved read state is

    const timeZone = String(db.prepare('SELECT timezone FROM stores WHERE id = ?').get(storeId)?.timezone ?? 'UTC');
    const today = localDate(now, timeZone); // the store's day: the interval below ends at its midnight
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
    // Each read below is noted per dataset (store-analytics); a failed one still doesn't stop the sync.
    const span = { from: start, to: today };
    if (!own) noteRead(db, key, id, 'orders', { status: 'available', ...span }, now); // daily totals only
    const rate = own ? 1 : await adRate(db, storeId, currency, fetchFn, 'Amazon');
    // A first sync reads two years back: each day at that day's rate, as ad spend's backfill does.
    const dayRate = own || cursor ? () => rate : await backfillRate(db, storeId, currency, rate, fetchFn);
    // The whole catalog until the store has Amazon products (so adding the Product Listing role later still pulls it all)
    // and once a day after (archiving listings that are gone); otherwise what changed since two days before the last sync.
    // Without the role (or on any error) sales sync on and the catalog is left as it is.
    const have = db.prepare("SELECT 1 FROM products WHERE store_id = ? AND id GLOB 'amz-*'").get(storeId);
    const full = !have || catalogPassDue(db, id, today);
    const changedSince = full ? undefined : `${addDays(cursor ?? today, -2)}T00:00:00Z`;
    const listings = !own ? undefined : await noted(db, key, id, 'catalog', listingsOf(fetchFn, host, token, creds.sellerId!.trim(), marketplace, changedSince), (l) => ({ status: l.complete ? 'available' : 'partial' })).catch(() => undefined);
    for (const d of ['variants', 'channel_listings'] as const) if (listings) noteRead(db, key, id, d, { status: listings.complete ? 'available' : 'partial' }, now);
    // FBA stock the same way (without the Amazon Fulfillment role, FBA listings stay "not tracked").
    const fba = !own ? undefined : await noted(db, key, id, 'inventory', fbaStock(fetchFn, host, token, marketplace, changedSince)).catch(() => undefined);
    // Sessions for the funnel, unless GA4 is connected (it owns the funnel there).
    const traffic = !own || db.prepare('SELECT 1 FROM integrations WHERE id = ?').get(`ga4:${storeId}`) ? undefined
      : await noted(db, key, id, 'traffic', trafficOf(db, id, account, fetchFn, host, token, marketplace, today), (r) => ({ status: 'available', from: r.days[0]?.date, to: r.days.at(-1)?.date })).catch(
          () => undefined,
        );
    const reads = stateOf<OrderRead>(db, ORDERS_KEY);
    const read = reads.get(id);
    const orders = !own ? undefined : await noted(db, key, id, 'orders', ordersOf(read?.account === account ? read : undefined, fetchFn, host, token, marketplace, now), () => ({ status: 'available', ...span })).catch(() => undefined);
    // Without the Finance and Accounting role (or on any error) sales stay before refunds.
    const refundReads = stateOf<RefundRead>(db, REFUNDS_KEY);
    const refundRead = refundReads.get(id);
    const refunds = !own ? undefined : await noted(db, key, id, 'refunds', refundsOf(refundRead?.account === account ? refundRead : undefined, fetchFn, host, token, now)).catch(
      (e: unknown) => void noteRead(db, key, id, 'fees', { status: 'failed', error: e instanceof Error ? e.message : String(e) }, now),
    );
    if (refunds) noteRead(db, key, id, 'fees', { status: 'available' }, now); // the same pages' shipment events
    const looked = (orderId: string) => `amazon-order:${storeId}:${orderId}`;
    const known = db.prepare('SELECT 1 FROM orders WHERE store_id = ? AND id = ?');
    const asked = db.prepare('SELECT 1 FROM done_once WHERE ref = ?');
    // Amazon's own refund lines only: a TikTok Shop line's order (tt-) isn't Amazon's, and a malformed id stops the lookups.
    const missing = !own ? [] : [...new Set([
      ...(refunds?.refunds ?? []).flatMap((e) => (e.AmazonOrderId ? [e.AmazonOrderId] : [])),
      ...db.prepare(`SELECT DISTINCT substr(order_id, 5) AS id FROM amazon_refunds r WHERE store_id = ? AND order_id GLOB 'amz-*' AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.store_id = r.store_id AND o.id = r.order_id)`).all(storeId).map((r) => String(r.id)),
    ])].filter((o) => !known.get(storeId, `amz-${o}`) && !orders?.orders.some((x) => x.orderId === o) && !asked.get(looked(o)));
    const older = missing.length ? await refundedOrders(missing, fetchFn, host, token, marketplace) : undefined;

    if (syncView(db, id) !== view) return;
    tx(db, () => {
      // Re-zoned while Amazon was read (another sync, or the owner): these days are the old zone's. setStoreTimezone
      // cleared the cursor, so the next sync reads them again in the new one.
      if (String(db.prepare('SELECT timezone FROM stores WHERE id = ?').get(storeId)?.timezone ?? 'UTC') !== timeZone) return;
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
        up.run(storeId, date, Math.round(Number(d.totalSales?.amount ?? 0) * dayRate(date) * 100) / 100, d.orderCount ?? 0);
      }
      const visits = db.prepare('INSERT INTO daily_metrics (store_id, date, sessions) VALUES (?, ?, ?) ON CONFLICT (store_id, date) DO UPDATE SET sessions = excluded.sessions');
      for (const d of traffic?.days ?? []) visits.run(storeId, d.date, d.sessions);
      traffic?.collected();
      // Orders fill the orders page and top products, and their lines cost the owner's unit cost (Amazon has none).
      // Revenue and order counts stay the daily totals above: rebuildRevenue takes only the costs of amz- orders.
      const ord = db.prepare(
        `INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, supplier, tracking, cogs, local_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
         ON CONFLICT (store_id, id) DO UPDATE SET total = excluded.total, status = excluded.status, fulfillment_status = excluded.fulfillment_status,
           supplier = excluded.supplier, tracking = coalesce(excluded.tracking, tracking)`,
      );
      // SA-44: each item as ordered (Amazon has no unit costs: the owner's come with SA-26's backfill); a fee keeps its order's day.
      const orderLine = db.prepare(
        `INSERT INTO order_lines (store_id, order_id, line_id, product_id, variant_id, sku, quantity, gross, discount, cost, cost_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
         ON CONFLICT (store_id, order_id, line_id) DO UPDATE SET product_id = excluded.product_id, variant_id = excluded.variant_id, sku = excluded.sku, quantity = excluded.quantity,
           gross = excluded.gross, discount = excluded.discount`,
      );
      const feeDay = db.prepare('UPDATE order_fees SET local_date = ? WHERE store_id = ? AND order_id = ?');
      for (const o of [...(orders?.orders ?? []), ...(older?.found ?? [])]) {
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
        days.add(localDate(created, timeZone));
        feeDay.run(localDate(created, timeZone), storeId, `amz-${o.orderId}`);
        for (const [n, i] of (o.orderItems ?? []).entries()) {
          const sku = i.product?.sellerSku;
          const unit = i.product?.price?.unitPrice?.amount;
          if (!sku || unit == null) continue;
          const off = i.proceeds?.breakdowns?.find((b) => b.type === 'DISCOUNT')?.subtotal?.amount;
          orderLine.run(storeId, `amz-${o.orderId}`, i.orderItemId ?? String(n), `amz-${sku}`, `amz-${sku}`, sku, i.quantityOrdered, r2(Number(unit) * i.quantityOrdered),
            i.proceeds?.breakdowns ? r2(Math.abs(Number(off ?? 0))) : null);
        }
      }
      // A refunded line's selling price (Principal: what Amazon's sales total counts) comes off its order's day. It counts
      // only once its order is one of the store's: another marketplace's never is, and an order read later brings it in.
      const refund = db.prepare(
        'INSERT INTO amazon_refunds (store_id, id, order_id, amount, product_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT (store_id, id) DO UPDATE SET amount = excluded.amount, product_id = excluded.product_id',
      );
      const dayOf = db.prepare('SELECT local_date FROM orders WHERE store_id = ? AND id = ?');
      for (const e of refunds?.refunds ?? []) {
        for (const [i, item] of (e.ShipmentItemAdjustmentList ?? []).entries()) {
          const amount = -(item.ItemChargeAdjustmentList ?? []).filter((c) => c.ChargeType === 'Principal').reduce((a, c) => a + Number(c.ChargeAmount?.CurrencyAmount ?? 0), 0);
          if (!e.AmazonOrderId || !amount) continue;
          const orderId = `amz-${e.AmazonOrderId}`;
          refund.run(storeId, item.OrderAdjustmentItemId ?? `${e.AmazonOrderId}:${e.PostedDate}:${i}`, orderId, amount, item.SellerSKU ? `amz-${item.SellerSKU}` : null);
          const day = dayOf.get(storeId, orderId)?.local_date;
          if (day) days.add(String(day));
        }
      }
      // SA-44: the refunds ledger too (amazon_refunds stays for rebuildRevenue), each refunded charge in its part.
      const ledger = db.prepare(
        `INSERT INTO refunds (store_id, id, refund_id, order_id, product_id, variant_id, refunded_at, local_date, merchandise, shipping, tax, other, quantity, restocked, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'amazon')
         ON CONFLICT (store_id, id) DO UPDATE SET refunded_at = excluded.refunded_at, local_date = excluded.local_date, merchandise = excluded.merchandise, shipping = excluded.shipping,
           tax = excluded.tax, other = excluded.other, quantity = excluded.quantity`,
      );
      for (const e of refunds?.refunds ?? []) {
        if (!e.AmazonOrderId || !e.PostedDate) continue;
        for (const [i, item] of (e.ShipmentItemAdjustmentList ?? []).entries()) {
          const back = { merchandise: 0, shipping: 0, tax: 0, other: 0 };
          for (const c of item.ItemChargeAdjustmentList ?? []) back[chargePart(c.ChargeType)] -= Number(c.ChargeAmount?.CurrencyAmount ?? 0);
          for (const p of item.PromotionAdjustmentList ?? []) back.merchandise -= Number(p.PromotionAmount?.CurrencyAmount ?? 0);
          const rid = item.OrderAdjustmentItemId ?? `${e.AmazonOrderId}:${e.PostedDate}:${i}`;
          const sku = item.SellerSKU ? `amz-${item.SellerSKU}` : null;
          ledger.run(storeId, rid, rid, `amz-${e.AmazonOrderId}`, sku, sku, e.PostedDate, localDate(new Date(e.PostedDate), timeZone),
            r2(back.merchandise) || null, r2(back.shipping) || null, r2(back.tax) || null, r2(back.other) || null, item.QuantityShipped ?? null);
        }
      }
      // Decision 17: recorded fees, per order and fee type, one row per event (its posted time in the source), so a
      // re-read replaces it and an order shipped in parts keeps each part's.
      const fee = db.prepare(
        `INSERT INTO order_fees (store_id, order_id, kind, amount, currency, local_date, source) VALUES (?1, ?2, ?3, ?4, ?5, coalesce((SELECT local_date FROM orders WHERE store_id = ?1 AND id = ?2), ?6), ?7)
         ON CONFLICT (store_id, order_id, kind, source) DO UPDATE SET amount = excluded.amount, currency = excluded.currency, local_date = excluded.local_date`,
      );
      for (const [events, tag] of [[refunds?.shipments, 'amazon'], [refunds?.refunds, 'amazon-refund']] as const) {
        for (const e of events ?? []) {
          if (!e.AmazonOrderId || !e.PostedDate) continue;
          for (const [kind, f] of feesOf(e)) if (r2(f.amount)) fee.run(storeId, `amz-${e.AmazonOrderId}`, kind, r2(f.amount), f.currency, localDate(new Date(e.PostedDate), timeZone), `${tag}:${e.PostedDate}`);
        }
      }
      for (const o of older?.settled ?? []) once(db, looked(o));
      rebuildRevenue(db, storeId, days);
      if (orders) reads.set(id, { ...orders.next, account });
      if (refunds) refundReads.set(id, { ...refunds.next, account });
      // ponytail: Amazon has no unit costs. An FBA listing keeps the stock fbaStock last gave it (its listing has no count).
      const prod = db.prepare(
        `INSERT INTO products (store_id, id, title, image, price, compare_at, cost, inventory, inventory_tracked, status, merchant_stock) VALUES (?1, ?2, ?3, ?4, ?5, NULL, 0, ?6, ?7, ?8, ?10)
         ON CONFLICT (store_id, id) DO UPDATE SET title = excluded.title, image = excluded.image, price = excluded.price, status = excluded.status, merchant_stock = excluded.merchant_stock,
           inventory = CASE WHEN ?9 THEN inventory ELSE excluded.inventory END, inventory_tracked = CASE WHEN ?9 THEN inventory_tracked ELSE excluded.inventory_tracked END`,
      );
      // SA-45: each SKU is its own variant and Amazon listing. Stock Amazon fulfils is Amazon's to manage (decision 27):
      // policy 'fba', not tracked (no cover), its units kept for showing as FBA.
      const variant = db.prepare(
        `INSERT INTO product_variants (store_id, product_id, id, title, sku, price, compare_at, inventory, inventory_tracked, inventory_policy, status, synced_at) VALUES (?1, ?2, ?2, NULL, ?3, ?4, NULL, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT (store_id, id) DO UPDATE SET sku = excluded.sku, price = excluded.price, status = excluded.status, synced_at = excluded.synced_at, inventory_tracked = excluded.inventory_tracked,
           inventory = iif(excluded.inventory_policy = 'fba' AND inventory_policy = 'fba', inventory, excluded.inventory), inventory_policy = excluded.inventory_policy`,
      );
      const listing = db.prepare(
        `INSERT INTO channel_listings (store_id, channel, id, product_id, variant_id, status, error, published_at, synced_at) VALUES (?1, 'amazon', ?2, ?2, ?2, ?3, ?4, NULL, ?5)
         ON CONFLICT (store_id, channel, id) DO UPDATE SET status = excluded.status, error = excluded.error, synced_at = excluded.synced_at`,
      );
      for (const l of listings ?? []) {
        const s = l.summaries?.[0];
        const counted = (l.fulfillmentAvailability ?? []).filter((f) => typeof f.quantity === 'number');
        const price = Number(l.offers?.find((o) => o.offerType === 'B2C')?.price.amount ?? 0);
        // BUYABLE and/or DISCOVERABLE: live (an out-of-stock listing keeps DISCOVERABLE); neither: not live yet.
        const byAmazon = (l.fulfillmentAvailability ?? []).some((f) => f.fulfillmentChannelCode?.startsWith('AMAZON'));
        prod.run(storeId, `amz-${l.sku}`, s?.itemName ?? l.sku, s?.mainImage?.link ?? null, price, counted.reduce((a, f) => a + f.quantity!, 0), counted.length ? 1 : 0, s?.status?.length ? 'active' : 'draft', byAmazon && !counted.length ? 1 : 0, counted.length ? 1 : 0);
        const managed = byAmazon && !counted.length;
        variant.run(storeId, `amz-${l.sku}`, l.sku, l.offers?.some((o) => o.offerType === 'B2C') ? price : null, counted.length ? counted.reduce((a, f) => a + f.quantity!, 0) : null, counted.length ? 1 : 0,
          managed ? 'fba' : counted.length ? 'deny' : null, s?.status?.length ? 'active' : 'draft', now.toISOString());
        const errors = (l.issues ?? []).filter((i) => i.severity === 'ERROR' && i.message).map((i) => i.message);
        listing.run(storeId, `amz-${l.sku}`, s?.status?.length ? 'active' : 'unpublished', errors.join('; ') || null, now.toISOString());
      }
      // A SKU moved to merchant fulfilment can keep an FBA record (0 units): its listing's own count stands.
      const setFba = db.prepare('UPDATE products SET inventory = ?, inventory_tracked = 1 WHERE store_id = ? AND id = ? AND merchant_stock = 0');
      const fbaVariant = db.prepare("UPDATE product_variants SET inventory = ? WHERE store_id = ? AND id = ? AND inventory_policy = 'fba'");
      for (const [sku, units] of fba ?? []) {
        setFba.run(units, storeId, `amz-${sku}`);
        fbaVariant.run(units, storeId, `amz-${sku}`);
      }
      // A read cut short by the search cap can't tell gone from unread: it archives nothing (and isn't retried until tomorrow).
      if (listings && full) {
        if (listings.complete) archiveMissing(db, id, storeId, 'amz-*', listings.map((l) => `amz-${l.sku}`), today);
        else catalogPassDone(db, id, today);
      }
      db.prepare("UPDATE integrations SET cursor = ?, synced_at = ?, status = 'connected', error = NULL WHERE id = ?").run(today, now.toISOString(), id);
    });
  } catch (e) {
    noteFailed(db, key, id, ['orders'], e); // sign-in or the daily totals: nothing else was read either
    setIntegrationStatus(db, id, 'error', e instanceof Error ? e.message : 'Amazon sync failed');
  }
}

/** One price in a purchasable_offer schedule. */
type Scheduled = { schedule?: { value_with_tax?: number; start_at?: string; end_at?: string }[] }[];
interface Offer {
  marketplace_id?: string;
  audience?: string;
  currency?: string;
  our_price?: Scheduled;
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
  const synced = syncedPrice(db, storeId, productId);
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
    stillAsSynced('Amazon', `price of ${sku}`, Number(first(offer.our_price)?.value_with_tax), synced);
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
