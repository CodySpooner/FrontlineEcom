import { createHmac } from 'node:crypto';
import type { FulfillmentStatus, ProductStatus } from '@frontline/shared';
import { tx, type Db } from '../db';
import { addDays, localDate } from '../dates';
import { logAction } from '../actions';
import { getCredentials, setIntegrationStatus, updateSecrets } from '../integrations';
import { adZone, AD_ZONES, archiveUnlisted, claimCampaigns, adRate, archiveMissing, backfillRate, catalogPassDue, cents, cursorAt, pruneCampaigns, rebuildAdSpend, saveAds, rebuildRevenue, setOrderItems, takeCurrency, stateOf, switchToReal, syncView, type CampaignChange, stillAsSynced, syncedBudget, syncedPrice } from './common';

// TikTok API for Business (Marketing API). Long-lived advertiser access token with Ads Management + Reporting.
const ADS_API = 'https://business-api.tiktok.com/open_api/v1.3';
/** First sync pulls this many days; later syncs re-pull the attribution window so late conversions land. */
const BACKFILL_DAYS = 730;
const ATTRIBUTION_DAYS = 28;
/** Daily reports span at most 30 days per request. */
const CHUNK_DAYS = 30;

type Fetch = typeof fetch;
type Page<T> = { list?: T[]; page_info?: { page: number; total_page: number } };

interface CampaignRow {
  campaign_id: string;
  campaign_name: string;
  operation_status: string;
  budget?: number;
  budget_mode?: string;
}

interface ReportRow {
  dimensions: { campaign_id: string; stat_time_day: string };
  metrics: Record<string, string>;
}

/** AUCTION_AD: campaign_id, adgroup_id and ad_name come as attribute metrics. */
interface AdReportRow {
  dimensions: { ad_id: string; stat_time_day: string };
  metrics: Record<string, string>;
}

interface AdListRow {
  ad_id: string;
  ad_name: string;
  campaign_id: string;
  adgroup_id?: string;
  operation_status: string;
  ad_text?: string;
}

/** GETs every page of an Ads endpoint. TikTok answers HTTP 200 with a non-zero `code` on errors. */
async function pages<T>(path: string, params: Record<string, string>, token: string, fetchFn: Fetch): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1, total = 1; page <= total; page++) {
    const res = await fetchFn(`${ADS_API}${path}?${new URLSearchParams({ ...params, page: String(page), page_size: '1000' })}`, { headers: { 'Access-Token': token } });
    const body = (await res.json().catch(() => ({}))) as { code?: number; message?: string; data?: Page<T> };
    if (body.code !== undefined && body.code >= 40100 && body.code < 40200) throw new Error('TikTok rejected the access token; generate a new one for the advertiser account');
    if (!res.ok || body.code !== 0) throw new Error(`TikTok Ads: ${body.message ?? `HTTP ${res.status}`}`);
    out.push(...(body.data?.list ?? []));
    total = body.data?.page_info?.total_page ?? 1;
  }
  return out;
}

/** The advertiser account's currency (report and budget amounts are in it). */
/** The advertiser account's currency and the zone its reports' days are in (named, else its fixed offset). */
async function advertiserInfo(advertiser: string, token: string, fetchFn: Fetch) {
  const q = new URLSearchParams({ advertiser_ids: JSON.stringify([advertiser]), fields: JSON.stringify(['currency', 'timezone', 'display_timezone']) });
  const res = await fetchFn(`${ADS_API}/advertiser/info/?${q}`, { headers: { 'Access-Token': token } });
  const body = (await res.json().catch(() => ({}))) as { code?: number; message?: string; data?: { list?: { currency?: string; timezone?: string; display_timezone?: string }[] } };
  if (body.code !== undefined && body.code >= 40100 && body.code < 40200) throw new Error('TikTok rejected the access token; generate a new one for the advertiser account');
  if (!res.ok || body.code !== 0) throw new Error(`TikTok Ads: ${body.message ?? `HTTP ${res.status}`}`);
  const info = body.data?.list?.[0];
  return { currency: info?.currency, zone: info?.display_timezone || info?.timezone };
}

export async function syncTikTokAds(db: Db, key: Buffer, storeId: string, fetchFn: Fetch = fetch, now = new Date()) {
  const id = `tiktok_ads:${storeId}`;
  const creds = getCredentials(db, key, 'tiktok_ads', storeId);
  if (!creds) return;
  const view = syncView(db, id);
  let campaignSynced = false;
  try {
    const advertiser = creds.advertiserId!.trim();
    if (!/^\d+$/.test(advertiser)) throw new Error('Advertiser ID must be the number shown in TikTok Ads Manager');
    const token = creds.accessToken!;
    const today = localDate(now, adZone(db, id)); // the account's day (its zone as last seen; the machine's at first)
    const cursor = db.prepare('SELECT cursor FROM integrations WHERE id = ?').get(id)?.cursor as string | null;
    const start = cursor ? addDays(cursor, -ATTRIBUTION_DAYS) : addDays(today, 1 - BACKFILL_DAYS);

    const report = async <T>(data_level: string, dimensions: string[], extra: string[] = []) => {
      const out: T[] = [];
      for (let from = start; from <= today; from = addDays(from, CHUNK_DAYS)) {
        const to = addDays(from, CHUNK_DAYS - 1) < today ? addDays(from, CHUNK_DAYS - 1) : today;
        out.push(
          ...(await pages<T>(
            '/report/integrated/get/',
            {
              advertiser_id: advertiser,
              report_type: 'BASIC',
              data_level,
              dimensions: JSON.stringify(dimensions),
              // ponytail: purchase value = complete_payment_roas × spend; the direct "total value" metric is ambiguously named in TikTok's docs
              metrics: JSON.stringify([...extra, 'spend', 'impressions', 'clicks', 'complete_payment', 'complete_payment_roas']),
              start_date: from,
              end_date: to,
            },
            token,
            fetchFn,
          )),
        );
      }
      return out;
    };
    const rows = await report<ReportRow>('AUCTION_CAMPAIGN', ['campaign_id', 'stat_time_day']);
    const campaigns = await pages<CampaignRow>('/campaign/get/', { advertiser_id: advertiser }, token, fetchFn);
    const { currency, zone } = await advertiserInfo(advertiser, token, fetchFn);
    if (zone) stateOf<string>(db, AD_ZONES).set(id, zone);
    const rate = await adRate(db, storeId, currency, fetchFn, 'TikTok Ads');
    const rateOn = cursor ? () => rate : await backfillRate(db, storeId, currency, rate, fetchFn);

    const n = (v: string | undefined) => Number(v) || 0; // TikTok sends "-" for empty metrics

    if (syncView(db, id) !== view) return;
    tx(db, () => {
      switchToReal(db, storeId);
      claimCampaigns(db, storeId, 'tiktok', [...campaigns.map((c) => c.campaign_id), ...rows.map((r) => r.dimensions.campaign_id)]);
      const camp = db.prepare(
        `INSERT INTO campaigns (network, id, store_id, name, status, daily_budget) VALUES ('tiktok', ?, ?, ?, ?, ?)
         ON CONFLICT (network, id) DO UPDATE SET name = excluded.name, status = excluded.status, daily_budget = excluded.daily_budget`,
      );
      for (const c of campaigns) camp.run(c.campaign_id, storeId, c.campaign_name, c.operation_status === 'ENABLE' ? 'active' : 'paused', c.budget_mode === 'BUDGET_MODE_DAY' ? cents(Number(c.budget ?? 0) * rate) : 0);
      archiveUnlisted(db, storeId, 'tiktok', campaigns.map((c) => c.campaign_id));
      // Deleted campaigns only show up in the report but still need a row for the join.
      const seen = db.prepare("INSERT OR IGNORE INTO campaigns (network, id, store_id, name, status, daily_budget) VALUES ('tiktok', ?, ?, ?, 'archived', 0)");
      const day = db.prepare(
        `INSERT INTO campaign_daily (network, campaign_id, date, spend, revenue, purchases, clicks, impressions) VALUES ('tiktok', ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (network, campaign_id, date) DO UPDATE SET spend = excluded.spend, revenue = excluded.revenue, purchases = excluded.purchases,
           clicks = excluded.clicks, impressions = excluded.impressions`,
      );
      const dates = new Set<string>();
      for (const { dimensions: d, metrics: m } of rows) {
        const date = d.stat_time_day.slice(0, 10);
        dates.add(date);
        seen.run(d.campaign_id, storeId, `Campaign ${d.campaign_id}`);
        const k = rateOn(date);
        day.run(d.campaign_id, date, cents(n(m.spend) * k), cents(n(m.complete_payment_roas) * n(m.spend) * k), n(m.complete_payment), n(m.clicks), n(m.impressions));
      }
      if (!cursor) for (const d of pruneCampaigns(db, storeId, 'tiktok', [...campaigns.map((c) => c.campaign_id), ...rows.map((r) => r.dimensions.campaign_id)])) dates.add(d);
      rebuildAdSpend(db, storeId, dates);
    });
    campaignSynced = true;

    // Each ad's days and its text (KB-20).
    const adRows = await report<AdReportRow>('AUCTION_AD', ['ad_id', 'stat_time_day'], ['campaign_id', 'adgroup_id', 'ad_name']);
    const ads = await pages<AdListRow>('/ad/get/', { advertiser_id: advertiser, fields: JSON.stringify(['ad_id', 'ad_name', 'campaign_id', 'adgroup_id', 'operation_status', 'ad_text']) }, token, fetchFn);
    if (syncView(db, id) !== view) return;
    // Keep the cursor until both reads succeed so missing ad history is retried.
    tx(db, () => {
      saveAds(
        db, storeId, 'tiktok',
        ads.map((a) => ({ id: a.ad_id, campaignId: a.campaign_id, groupId: a.adgroup_id, name: a.ad_name, status: a.operation_status === 'ENABLE' ? 'active' : 'paused', ...(a.ad_text ? { copy: a.ad_text } : {}) })),
        adRows.map(({ dimensions: d, metrics: m }) => {
          const date = d.stat_time_day.slice(0, 10);
          const k = rateOn(date);
          return {
            adId: d.ad_id, campaignId: m.campaign_id!, groupId: m.adgroup_id, name: m.ad_name, date, spend: cents(n(m.spend) * k), revenue: cents(n(m.complete_payment_roas) * n(m.spend) * k),
            purchases: n(m.complete_payment), clicks: n(m.clicks), impressions: n(m.impressions),
          };
        }),
      );
      db.prepare("UPDATE integrations SET cursor = ?, synced_at = ?, status = 'connected', error = NULL WHERE id = ?").run(today, now.toISOString(), id);
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'TikTok Ads sync failed';
    setIntegrationStatus(db, id, 'error', campaignSynced ? `Campaign spend synced; ad-level sync failed: ${message}` : message);
  }
}

// TikTok Shop Partner API (202309): app key + secret from Partner Center, and the shop's access + refresh token.
const SHOP_API = 'https://open-api.tiktokglobalshop.com';
const SHOP_TOKEN_REFRESH = 'https://auth.tiktok-shops.com/api/v2/token/refresh';

interface ShopProduct {
  id: string;
  title: string;
  status: string;
  update_time: number;
  skus?: { price?: { sale_price?: string; tax_exclusive_price?: string }; inventory?: { quantity: number }[] }[];
}

interface ShopOrder {
  id: string;
  status: string;
  create_time: number;
  update_time: number;
  is_sample_order?: boolean;
  tracking_number?: string;
  /** total_amount includes `tax` (product + shipping tax the buyer paid). */
  payment?: { total_amount?: string; currency?: string; tax?: string };
  /** One entry per unit unless `quantity` says otherwise; `sale_price` is per unit. */
  line_items?: { product_id: string; sale_price?: string; quantity?: number }[];
}

/** A return or refund (Search Returns, Return & Refund Basic scope). */
interface ShopReturn {
  return_id: string;
  order_id: string;
  /** REFUND, RETURN_AND_REFUND or REPLACEMENT (no money back). */
  return_type?: string;
  return_status: string;
  /** Strings in the shop's currency; refund_total includes refund_tax. */
  refund_amount?: { refund_total?: string; refund_tax?: string };
}
const REFUNDED = new Set(['RETURN_OR_REFUND_REQUEST_SUCCESS', 'RETURN_OR_REFUND_REQUEST_COMPLETE']);
/** Settings row: where each TikTok Shop integration's returns read got to, and for which shop. */
const RETURNS_KEY = 'tiktok_return_reads';
/** Settings row: the oldest day each TikTok Shop integration's visitors were read back to, and for which shop. */
const VISITORS_KEY = 'tiktok_visitor_reads';
type ShopPerformance = { latest_available_date?: string; performance?: { intervals?: { start_date: string; traffic?: { avg_visitors?: number } }[] } };

/** Request signature: HMAC-SHA256 keyed by the secret over secret + path + sorted key+value params (minus sign/access_token) + body + secret, hex. */
export function signTikTokShop(secret: string, path: string, params: Record<string, string>, body = '') {
  const pairs = Object.keys(params).filter((k) => k !== 'sign' && k !== 'access_token').sort().map((k) => k + params[k]).join('');
  return createHmac('sha256', secret).update(secret + path + pairs + body + secret).digest('hex');
}

const PRODUCT_STATUS: Record<string, ProductStatus> = { ACTIVATE: 'active', DRAFT: 'draft', PENDING: 'draft', FAILED: 'draft' };

export function shopFulfillment(status: string): FulfillmentStatus {
  if (status === 'DELIVERED' || status === 'COMPLETED') return 'delivered';
  if (status === 'IN_TRANSIT') return 'in_transit';
  return status === 'AWAITING_COLLECTION' ? 'fulfilled' : 'unfulfilled';
}

/** Access tokens last about a week; this trades the refresh token for new ones and saves both (encrypted). */
async function refreshShopToken(db: Db, key: Buffer, id: string, creds: Record<string, string>, fetchFn: Fetch) {
  const params = new URLSearchParams({ app_key: creds.appKey!, app_secret: creds.appSecret!, refresh_token: creds.refreshToken!, grant_type: 'refresh_token' });
  const res = await fetchFn(`${SHOP_TOKEN_REFRESH}?${params}`);
  const body = (await res.json().catch(() => ({}))) as { code?: number; message?: string; data?: { access_token?: string; access_token_expire_in?: number; refresh_token?: string } };
  const data = body.data;
  if (body.code !== 0 || !data?.access_token || !data.refresh_token) {
    throw new Error(`TikTok Shop sign-in failed: ${body.message ?? `HTTP ${res.status}`}; authorize the shop again and paste new tokens`);
  }
  updateSecrets(db, key, id, { accessToken: data.access_token, refreshToken: data.refresh_token, accessTokenExpiresAt: String(data.access_token_expire_in ?? 0) });
  return data.access_token;
}

/** Signs in (renewing the token when due) and picks the shop: a signed `api` call and the shop's cipher. */
async function shopClient(db: Db, key: Buffer, id: string, creds: Record<string, string>, fetchFn: Fetch, now: Date) {
  // accessTokenExpiresAt (unix seconds) is only known after our first refresh, so a freshly pasted token is refreshed once.
  const fresh = Number(creds.accessTokenExpiresAt) * 1000 - now.getTime() > 86400000;
  const token = fresh ? creds.accessToken! : await refreshShopToken(db, key, id, creds, fetchFn);
  const api = async <T>(method: 'GET' | 'POST', path: string, query: Record<string, string> = {}, body?: object) => {
    const json = body ? JSON.stringify(body) : '';
    // The clock at sending: TikTok refuses a timestamp minutes old, and a first sync can page for longer than that.
    const params = { ...query, app_key: creds.appKey!, timestamp: String(Math.floor(Date.now() / 1000)) };
    const res = await fetchFn(`${SHOP_API}${path}?${new URLSearchParams({ ...params, sign: signTikTokShop(creds.appSecret!, path, params, json) })}`, {
      method,
      headers: { 'x-tts-access-token': token, 'content-type': 'application/json' },
      ...(body ? { body: json } : {}),
    });
    const b = (await res.json().catch(() => ({}))) as { code?: number; message?: string; data?: T };
    if (!res.ok || b.code !== 0) throw new Error(`TikTok Shop: ${b.message ?? `HTTP ${res.status}`}`);
    return b.data as T;
  };

  // An app several shops authorized (say a US and a UK shop) syncs the one named in the Shop field; with one, that one.
  const shops = (await api<{ shops?: { cipher: string; id?: string; name?: string; code?: string }[] }>('GET', '/authorization/202309/shops')).shops ?? [];
  const want = creds.shop?.trim().toLowerCase();
  const shop = want ? shops.find((s) => [s.id, s.name, s.code].some((v) => v?.toLowerCase() === want)) : shops.length === 1 ? shops[0] : undefined;
  if (!shops.length) throw new Error('TikTok Shop: no shop has authorized this app');
  if (!shop) {
    const why = want ? `no authorized shop is "${creds.shop!.trim()}"` : 'several shops authorized this app';
    throw new Error(`TikTok Shop: ${why}. Enter one of ${shops.map((s) => s.name ?? s.id).join(', ')} as the Shop`);
  }
  return { api, shop };
}

export async function syncTikTokShop(db: Db, key: Buffer, storeId: string, fetchFn: Fetch = fetch, now = new Date()) {
  const id = `tiktok_shop:${storeId}`;
  const creds = getCredentials(db, key, 'tiktok_shop', storeId);
  if (!creds) return;
  const view = syncView(db, id);
  try {
    const { api, shop } = await shopClient(db, key, id, creds, fetchFn, now);
    const search = async <T>(path: string, list: string, query: Record<string, string>, body: object) => {
      const out: T[] = [];
      let pageToken = '';
      do {
        const data = await api<Record<string, unknown>>('POST', path, { page_size: '100', ...query, shop_cipher: shop.cipher, ...(pageToken ? { page_token: pageToken } : {}) }, body);
        out.push(...((data[list] as T[] | undefined) ?? []));
        pageToken = String(data.next_page_token ?? '');
      } while (pageToken);
      return out;
    };
    const cursor = db.prepare('SELECT cursor FROM integrations WHERE id = ?').get(id)?.cursor as string | null;
    const since = cursor ? Number(cursor) : Math.floor(now.getTime() / 1000) - BACKFILL_DAYS * 86400;
    // The first sync and once a day after read every product, however long unchanged (the backfill window is for orders),
    // archiving those the search no longer returns.
    const today = localDate(now);
    const full = !cursor || catalogPassDue(db, id, today);
    const products = await search<ShopProduct>('/product/202309/products/search', 'products', {}, full ? {} : { update_time_ge: since });
    const orders = await search<ShopOrder>('/order/202309/orders/search', 'orders', { sort_field: 'update_time', sort_order: 'ASC' }, { update_time_ge: since });
    // Refunds and returns need the Return & Refund Basic scope. Without it (or on any error) this read is skipped and
    // tried again next sync from where it last got to; revenue then nets cancellations only.
    const returnReads = stateOf<{ shop: string; since: number }>(db, RETURNS_KEY);
    const lastReturns = returnReads.get(id);
    const returnsSince = lastReturns?.shop === shop.cipher ? lastReturns.since : Math.floor(now.getTime() / 1000) - BACKFILL_DAYS * 86400;
    const returns = await search<ShopReturn>('/return_refund/202309/returns/search', 'return_orders', { page_size: '50', sort_field: 'update_time', sort_order: 'ASC' }, { update_time_ge: returnsSince }).catch(() => undefined);
    const store = db.prepare('SELECT timezone, platform FROM stores WHERE id = ?').get(storeId);
    // Product-page visitors a day are a TikTok Shop store's funnel sessions (TikTok Shop Analytics scope), unless GA4 is
    // connected (it owns the funnel there). A TikTok Shop alongside another platform leaves that one's sessions alone.
    // TikTok has no cart or checkout counts. Without the scope (or on any error) sessions stay empty.
    // Each sync reads the last 30 days, and one older 30 (TikTok documents no longest range) back to the backfill limit;
    // a month without visitors means the shop had none before, and the backfill stops there.
    const storeDay = new Intl.DateTimeFormat('en-CA', { timeZone: String(store?.timezone ?? 'UTC') }).format(now);
    const performance = (from: string, to: string) =>
      api<ShopPerformance>('GET', '/analytics/202609/shop/performance', { shop_cipher: shop.cipher, start_date_ge: from, end_date_lt: to, granularity: '1D' }).catch(() => undefined);
    const traffic = store?.platform !== 'tiktok_shop' || db.prepare('SELECT 1 FROM integrations WHERE id = ?').get(`ga4:${storeId}`) ? undefined
      : await performance(addDays(storeDay, -30), addDays(storeDay, 1));
    const visitorReads = stateOf<{ shop: string; back: string }>(db, VISITORS_KEY);
    const lastVisitors = visitorReads.get(id);
    const back = lastVisitors?.shop === shop.cipher ? lastVisitors.back : addDays(storeDay, -30);
    const limit = addDays(storeDay, -BACKFILL_DAYS);
    const older = traffic && back > limit ? await performance(addDays(back, -30), back) : undefined;
    // Read after the awaits: another sync (or the owner) may have changed the store's timezone meanwhile.
    const dayOf = new Intl.DateTimeFormat('en-CA', { timeZone: String(db.prepare('SELECT timezone FROM stores WHERE id = ?').get(storeId)?.timezone ?? 'UTC') });

    if (syncView(db, id) !== view) return;
    tx(db, () => {
      switchToReal(db, storeId);
      // Orders are in the shop's currency.
      const currency = orders.find((o) => o.payment?.currency)?.payment!.currency;
      if (currency) takeCurrency(db, storeId, 'tiktok_shop', currency);
      // Ids get a tt- prefix so they can't collide with another platform's ids in the same store.
      const prod = db.prepare(
        `INSERT INTO products (store_id, id, title, image, price, compare_at, cost, inventory, status) VALUES (?, ?, ?, NULL, ?, NULL, 0, ?, ?)
         ON CONFLICT (store_id, id) DO UPDATE SET title = excluded.title, price = excluded.price, inventory = excluded.inventory, status = excluded.status`,
      );
      for (const p of products) {
        const price = p.skus?.[0]?.price;
        const inventory = (p.skus ?? []).flatMap((k) => k.inventory ?? []).reduce((a, i) => a + i.quantity, 0);
        prod.run(storeId, `tt-${p.id}`, p.title, Number(price?.sale_price ?? price?.tax_exclusive_price ?? 0), inventory, PRODUCT_STATUS[p.status] ?? 'archived');
      }
      // TikTok has no unit costs: lines cost the owner's unit cost for the product (setOrderItems), else nothing.
      const ord = db.prepare(
        `INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, supplier, tracking, cogs, local_date, tax) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 0, ?, ?)
         ON CONFLICT (store_id, id) DO UPDATE SET total = excluded.total, status = excluded.status, fulfillment_status = excluded.fulfillment_status, tracking = coalesce(excluded.tracking, tracking), tax = excluded.tax`,
      );
      const days = new Set<string>();
      for (const o of orders) {
        if (o.status === 'UNPAID' || o.is_sample_order) continue;
        const created = new Date(o.create_time * 1000);
        const day = dayOf.format(created);
        days.add(day);
        ord.run(storeId, `tt-${o.id}`, created.toISOString(), Number(o.payment?.total_amount ?? 0), o.status === 'CANCELLED' ? 'refunded' : 'paid', shopFulfillment(o.status), o.tracking_number || null, day, Number(o.payment?.tax ?? 0));
        setOrderItems(db, storeId, `tt-${o.id}`, (o.line_items ?? []).map((li) => ({ productId: `tt-${li.product_id}`, quantity: li.quantity ?? 1, revenue: Number(li.sale_price ?? 0) * (li.quantity ?? 1), cost: 0 })));
      }
      // At 1D an interval is one day, so its daily average is that day's count. Days after latest_available_date aren't in yet.
      const visits = db.prepare('INSERT INTO daily_metrics (store_id, date, sessions) VALUES (?, ?, ?) ON CONFLICT (store_id, date) DO UPDATE SET sessions = excluded.sessions');
      const ready = traffic?.latest_available_date?.slice(0, 10) ?? '';
      for (const d of [...(traffic?.performance?.intervals ?? []), ...(older?.performance?.intervals ?? [])]) if (d.start_date <= ready) visits.run(storeId, d.start_date, d.traffic?.avg_visitors ?? 0);
      // A failed older read is tried again next sync.
      const reached = !older ? back : older.performance?.intervals?.some((d) => (d.traffic?.avg_visitors ?? 0) > 0) ? addDays(back, -30) : limit;
      if (traffic) visitorReads.set(id, { shop: shop.cipher, back: reached });
      if (returns) {
        // Into the refund lines Amazon's go to too (rebuildRevenue takes them off their order's day). One per return,
        // re-written as its status moves, so a refund only counts once TikTok has granted it; a replacement never does.
        // The refunded tax is kept apart (rebuildRevenue). Returns name SKUs, not products: a refund on an order of one product comes off
        // that product (price tests measure it), one on a mixed order off the store only.
        // ponytail: a mixed order's refund isn't split; return lines carry order_line_item_id, which order_items doesn't keep.
        const refund = db.prepare(
          'INSERT INTO amazon_refunds (store_id, id, order_id, amount, tax, product_id) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (store_id, id) DO UPDATE SET amount = excluded.amount, tax = excluded.tax, product_id = excluded.product_id',
        );
        const onlyProduct = db.prepare('SELECT min(product_id) AS product FROM order_items WHERE store_id = ? AND order_id = ? HAVING count(DISTINCT product_id) = 1');
        const orderDay = db.prepare('SELECT local_date FROM orders WHERE store_id = ? AND id = ?');
        for (const r of returns) {
          const a = r.refund_amount;
          const paid = REFUNDED.has(r.return_status) && r.return_type !== 'REPLACEMENT';
          const tax = paid ? cents(Number(a?.refund_tax ?? 0)) : 0;
          refund.run(storeId, `tt-${r.return_id}`, `tt-${r.order_id}`, paid ? cents(Number(a?.refund_total ?? 0) - tax) : 0, tax, onlyProduct.get(storeId, `tt-${r.order_id}`)?.product ?? null);
          const day = orderDay.get(storeId, `tt-${r.order_id}`)?.local_date;
          if (day) days.add(String(day));
        }
        returnReads.set(id, { shop: shop.cipher, since: Math.floor(cursorAt(now).getTime() / 1000) });
      }
      rebuildRevenue(db, storeId, days);
      if (full) archiveMissing(db, id, storeId, 'tt-*', products.map((p) => `tt-${p.id}`), today);
      const next = Math.max(since, Math.floor(cursorAt(now).getTime() / 1000));
      db.prepare("UPDATE integrations SET cursor = ?, synced_at = ?, status = 'connected', error = NULL WHERE id = ?").run(String(next), now.toISOString(), id);
    });

    // Search results carry no images; Get Product does (main_images[].urls). Up to 50 a sync for products still without
    // one, and '' marks "looked, none" so a product with no gallery isn't asked again. A signed link (x-expires, seconds)
    // is read again within a day of expiring, and a product edited since the last sync (a new main image), first.
    const setImage = db.prepare('UPDATE products SET image = ? WHERE store_id = ? AND id = ?');
    const expiring = (url: string) => Number(URL.canParse(url) && new URL(url).searchParams.get('x-expires')) < now.getTime() / 1000 + 86_400;
    const edited = JSON.stringify(full ? [] : products.map((p) => `tt-${p.id}`));
    const unread = db
      .prepare(
        `SELECT id, image, id IN (SELECT value FROM json_each(?2)) AS edited FROM products WHERE store_id = ?1 AND id GLOB 'tt-*' AND status != 'archived'
           AND (image IS NULL OR image LIKE '%x-expires=%' OR id IN (SELECT value FROM json_each(?2))) ORDER BY edited DESC, id`,
      )
      .all(storeId, edited)
      .filter((r) => r.edited || r.image == null || expiring(String(r.image)))
      .slice(0, 50);
    for (const r of unread) {
      const d = await api<{ main_images?: { urls?: string[] }[] }>('GET', `/product/202309/products/${String(r.id).slice(3)}`, { shop_cipher: shop.cipher }).catch(() => undefined);
      if (!d) continue; // asked again next sync
      const url = d.main_images?.[0]?.urls?.[0];
      setImage.run(url?.startsWith('https://') ? url : '', storeId, String(r.id));
    }
  } catch (e) {
    setIntegrationStatus(db, id, 'error', e instanceof Error ? e.message : 'TikTok Shop sync failed');
  }
}

/**
 * Sets every SKU of a live product to one price (Product Modify scope). Call only for an approved request. Same contract
 * as Shopify's setProductPrice, except that a compare-at price is refused (TikTok's list price is US-only and audited) and
 * TikTok only reprices an active product that is in no running promotion (its error says so).
 * ponytail: sends price.amount; JP and US shops shipping from China warehouses want price.sale_price, and get TikTok's error.
 */
export async function setTikTokProductPrice(db: Db, key: Buffer, storeId: string, productId: string, { price, compareAt }: { price: number; compareAt?: number | null }, fetchFn: Fetch = fetch, now = new Date()) {
  if (!Number.isFinite(price) || price <= 0) throw new Error('Price must be more than 0');
  if (compareAt != null) throw new Error('TikTok Shop has no compare-at price here; run a discount from Seller Center → Promotions');
  if (!productId.startsWith('tt-')) throw new Error(`${productId} is not a TikTok Shop product`);
  const creds = getCredentials(db, key, 'tiktok_shop', storeId);
  if (!creds) throw new Error('TikTok Shop is not connected for this store');
  const path = `/product/202309/products/${productId.slice(3)}`;
  const synced = syncedPrice(db, storeId, productId);
  await logAction(db, storeId, 'price_change', productId, { price }, async () => {
    const { api, shop } = await shopClient(db, key, `tiktok_shop:${storeId}`, creds, fetchFn, now);
    const p = await api<{ status?: string; skus?: { id: string; price?: { currency?: string; sale_price?: string; tax_exclusive_price?: string } }[] }>('GET', path, { shop_cipher: shop.cipher });
    if (p.status !== 'ACTIVATE') throw new Error(`TikTok Shop only reprices live products; ${productId} is ${p.status ?? 'not live'}`);
    // One price for all would flatten e.g. a 1-pack and a 3-pack. Whole price objects are compared: any difference refuses.
    if (new Set((p.skus ?? []).map((k) => JSON.stringify(k.price ?? null))).size > 1) throw new Error(`TikTok Shop: ${productId}'s SKUs have different prices; change them in Seller Center`);
    const live = p.skus?.[0]?.price;
    stillAsSynced('TikTok Shop', `price of ${productId}`, Number(live?.sale_price ?? live?.tax_exclusive_price), synced); // as the sync reads it
    const currency = String(db.prepare('SELECT currency FROM stores WHERE id = ?').get(storeId)?.currency);
    const skus = (p.skus ?? []).map((k) => ({ id: k.id, price: { amount: price.toFixed(2), currency: k.price?.currency ?? currency } }));
    await api('POST', `${path}/prices/update`, { shop_cipher: shop.cipher }, { skus });
  });
  db.prepare('UPDATE products SET price = ?, compare_at = NULL WHERE store_id = ? AND id = ?').run(price, storeId, productId);
}

/** Ad-account write (Ads Management scope). Use setCampaignBudget / pauseCampaign in ./ads, never directly. */
export async function updateTikTokCampaign(db: Db, key: Buffer, storeId: string, campaignId: string, change: CampaignChange, fetchFn: Fetch = fetch) {
  const creds = getCredentials(db, key, 'tiktok_ads', storeId);
  if (!creds) throw new Error('TikTok Ads is not connected for this store');
  const advertiser_id = creds.advertiserId!.trim();
  let path = '/campaign/status/update/';
  let body: object = { advertiser_id, campaign_ids: [campaignId], operation_status: 'DISABLE' };
  if (!('status' in change)) {
    const synced = syncedBudget(db, storeId, 'tiktok', campaignId);
    // The budget comes in the store's currency (as synced); TikTok wants the advertiser account's.
    const rate = await adRate(db, storeId, (await advertiserInfo(advertiser_id, creds.accessToken!, fetchFn)).currency, fetchFn, 'TikTok Ads');
    const [live] = await pages<CampaignRow>('/campaign/get/', { advertiser_id, filtering: JSON.stringify({ campaign_ids: [campaignId] }) }, creds.accessToken!, fetchFn);
    stillAsSynced('TikTok Ads', 'daily budget', live?.budget_mode === 'BUDGET_MODE_DAY' ? cents(Number(live.budget) * rate) : NaN, synced);
    [path, body] = ['/campaign/update/', { advertiser_id, campaign_id: campaignId, budget: cents(change.dailyBudget / rate) }];
  }
  const res = await fetchFn(`${ADS_API}${path}`, { method: 'POST', headers: { 'Access-Token': creds.accessToken!, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { code?: number; message?: string };
  if (json.code !== undefined && json.code >= 40100 && json.code < 40200) throw new Error('TikTok rejected the access token; generate a new one for the advertiser account');
  if (!res.ok || json.code !== 0) throw new Error(`TikTok Ads: ${json.message ?? `HTTP ${res.status}`}`);
}
