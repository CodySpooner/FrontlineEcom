import { createHmac } from 'node:crypto';
import type { FulfillmentStatus, ProductStatus } from '@frontline/shared';
import { tx, type Db } from '../db';
import { addDays, localDate } from '../dates';
import { getCredentials, setIntegrationStatus, updateSecrets } from '../integrations';
import { rebuildAdSpend, rebuildRevenue, setOrderItems, switchToReal, type CampaignChange } from './common';

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

export async function syncTikTokAds(db: Db, key: Buffer, storeId: string, fetchFn: Fetch = fetch, now = new Date()) {
  const id = `tiktok_ads:${storeId}`;
  const creds = getCredentials(db, key, 'tiktok_ads', storeId);
  if (!creds) return;
  try {
    const advertiser = creds.advertiserId!.trim();
    if (!/^\d+$/.test(advertiser)) throw new Error('Advertiser ID must be the number shown in TikTok Ads Manager');
    const token = creds.accessToken!;
    const today = localDate(now);
    const cursor = db.prepare('SELECT cursor FROM integrations WHERE id = ?').get(id)?.cursor as string | null;
    const start = cursor ? addDays(cursor, -ATTRIBUTION_DAYS) : addDays(today, 1 - BACKFILL_DAYS);

    const rows: ReportRow[] = [];
    for (let from = start; from <= today; from = addDays(from, CHUNK_DAYS)) {
      const to = addDays(from, CHUNK_DAYS - 1) < today ? addDays(from, CHUNK_DAYS - 1) : today;
      rows.push(
        ...(await pages<ReportRow>(
          '/report/integrated/get/',
          {
            advertiser_id: advertiser,
            report_type: 'BASIC',
            data_level: 'AUCTION_CAMPAIGN',
            dimensions: JSON.stringify(['campaign_id', 'stat_time_day']),
            // ponytail: purchase value = complete_payment_roas × spend; the direct "total value" metric is ambiguously named in TikTok's docs
            metrics: JSON.stringify(['spend', 'impressions', 'clicks', 'complete_payment', 'complete_payment_roas']),
            start_date: from,
            end_date: to,
          },
          token,
          fetchFn,
        )),
      );
    }
    const campaigns = await pages<CampaignRow>('/campaign/get/', { advertiser_id: advertiser }, token, fetchFn);

    tx(db, () => {
      switchToReal(db, storeId);
      const camp = db.prepare(
        `INSERT INTO campaigns (network, id, store_id, name, status, daily_budget) VALUES ('tiktok', ?, ?, ?, ?, ?)
         ON CONFLICT (network, id) DO UPDATE SET name = excluded.name, status = excluded.status, daily_budget = excluded.daily_budget`,
      );
      for (const c of campaigns) camp.run(c.campaign_id, storeId, c.campaign_name, c.operation_status === 'ENABLE' ? 'active' : 'paused', c.budget_mode === 'BUDGET_MODE_DAY' ? Number(c.budget ?? 0) : 0);
      // Deleted campaigns only show up in the report but still need a row for the join.
      const seen = db.prepare("INSERT OR IGNORE INTO campaigns (network, id, store_id, name, status, daily_budget) VALUES ('tiktok', ?, ?, ?, 'archived', 0)");
      const day = db.prepare(
        `INSERT INTO campaign_daily (network, campaign_id, date, spend, revenue, purchases, clicks, impressions) VALUES ('tiktok', ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (network, campaign_id, date) DO UPDATE SET spend = excluded.spend, revenue = excluded.revenue, purchases = excluded.purchases,
           clicks = excluded.clicks, impressions = excluded.impressions`,
      );
      const n = (v: string | undefined) => Number(v) || 0; // TikTok sends "-" for empty metrics
      const dates = new Set<string>();
      for (const { dimensions: d, metrics: m } of rows) {
        const date = d.stat_time_day.slice(0, 10);
        dates.add(date);
        seen.run(d.campaign_id, storeId, `Campaign ${d.campaign_id}`);
        day.run(d.campaign_id, date, n(m.spend), Math.round(n(m.complete_payment_roas) * n(m.spend) * 100) / 100, n(m.complete_payment), n(m.clicks), n(m.impressions));
      }
      rebuildAdSpend(db, storeId, dates);
      db.prepare("UPDATE integrations SET cursor = ?, synced_at = ?, status = 'connected', error = NULL WHERE id = ?").run(today, now.toISOString(), id);
    });
  } catch (e) {
    setIntegrationStatus(db, id, 'error', e instanceof Error ? e.message : 'TikTok Ads sync failed');
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
  payment?: { total_amount?: string };
  /** One entry per unit unless `quantity` says otherwise; `sale_price` is per unit. */
  line_items?: { product_id: string; sale_price?: string; quantity?: number }[];
}

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

export async function syncTikTokShop(db: Db, key: Buffer, storeId: string, fetchFn: Fetch = fetch, now = new Date()) {
  const id = `tiktok_shop:${storeId}`;
  const creds = getCredentials(db, key, 'tiktok_shop', storeId);
  if (!creds) return;
  try {
    // accessTokenExpiresAt (unix seconds) is only known after our first refresh, so a freshly pasted token is refreshed once.
    const fresh = Number(creds.accessTokenExpiresAt) * 1000 - now.getTime() > 86400000;
    const token = fresh ? creds.accessToken! : await refreshShopToken(db, key, id, creds, fetchFn);
    const api = async <T>(method: 'GET' | 'POST', path: string, query: Record<string, string> = {}, body?: object) => {
      const json = body ? JSON.stringify(body) : '';
      const params = { ...query, app_key: creds.appKey!, timestamp: String(Math.floor(now.getTime() / 1000)) };
      const res = await fetchFn(`${SHOP_API}${path}?${new URLSearchParams({ ...params, sign: signTikTokShop(creds.appSecret!, path, params, json) })}`, {
        method,
        headers: { 'x-tts-access-token': token, 'content-type': 'application/json' },
        ...(body ? { body: json } : {}),
      });
      const b = (await res.json().catch(() => ({}))) as { code?: number; message?: string; data?: T };
      if (!res.ok || b.code !== 0) throw new Error(`TikTok Shop: ${b.message ?? `HTTP ${res.status}`}`);
      return b.data as T;
    };

    // ponytail: first authorized shop only; an app authorized by several shops needs a shop picker on the Integrations screen.
    const shop = (await api<{ shops?: { cipher: string }[] }>('GET', '/authorization/202309/shops')).shops?.[0];
    if (!shop) throw new Error('TikTok Shop: no shop has authorized this app');
    const search = async <T>(path: string, list: string, query: Record<string, string>, body: object) => {
      const out: T[] = [];
      let pageToken = '';
      do {
        const data = await api<Record<string, unknown>>('POST', path, { ...query, shop_cipher: shop.cipher, page_size: '100', ...(pageToken ? { page_token: pageToken } : {}) }, body);
        out.push(...((data[list] as T[] | undefined) ?? []));
        pageToken = String(data.next_page_token ?? '');
      } while (pageToken);
      return out;
    };
    const cursor = db.prepare('SELECT cursor FROM integrations WHERE id = ?').get(id)?.cursor as string | null;
    const since = cursor ? Number(cursor) : Math.floor(now.getTime() / 1000) - BACKFILL_DAYS * 86400;
    const products = await search<ShopProduct>('/product/202309/products/search', 'products', {}, { update_time_ge: since });
    const orders = await search<ShopOrder>('/order/202309/orders/search', 'orders', { sort_field: 'update_time', sort_order: 'ASC' }, { update_time_ge: since });
    const dayOf = new Intl.DateTimeFormat('en-CA', { timeZone: String(db.prepare('SELECT timezone FROM stores WHERE id = ?').get(storeId)?.timezone ?? 'UTC') });

    tx(db, () => {
      switchToReal(db, storeId);
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
      // ponytail: TikTok has no unit costs, so TikTok orders add revenue with cogs 0.
      const ord = db.prepare(
        `INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, supplier, tracking, cogs, local_date) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 0, ?)
         ON CONFLICT (store_id, id) DO UPDATE SET total = excluded.total, status = excluded.status, fulfillment_status = excluded.fulfillment_status, tracking = coalesce(excluded.tracking, tracking)`,
      );
      const days = new Set<string>();
      for (const o of orders) {
        if (o.status === 'UNPAID' || o.is_sample_order) continue;
        const created = new Date(o.create_time * 1000);
        const day = dayOf.format(created);
        days.add(day);
        ord.run(storeId, `tt-${o.id}`, created.toISOString(), Number(o.payment?.total_amount ?? 0), o.status === 'CANCELLED' ? 'refunded' : 'paid', shopFulfillment(o.status), o.tracking_number || null, day);
        setOrderItems(db, storeId, `tt-${o.id}`, (o.line_items ?? []).map((li) => ({ productId: `tt-${li.product_id}`, quantity: li.quantity ?? 1, revenue: Number(li.sale_price ?? 0) * (li.quantity ?? 1), cost: 0 })));
      }
      rebuildRevenue(db, storeId, days);
      const newest = [...products, ...orders].reduce((m, x) => Math.max(m, x.update_time), since);
      db.prepare("UPDATE integrations SET cursor = ?, synced_at = ?, status = 'connected', error = NULL WHERE id = ?").run(String(newest), now.toISOString(), id);
    });
  } catch (e) {
    setIntegrationStatus(db, id, 'error', e instanceof Error ? e.message : 'TikTok Shop sync failed');
  }
}

/** Ad-account write (Ads Management scope). Use setCampaignBudget / pauseCampaign in ./ads, never directly. */
export async function updateTikTokCampaign(db: Db, key: Buffer, storeId: string, campaignId: string, change: CampaignChange, fetchFn: Fetch = fetch) {
  const creds = getCredentials(db, key, 'tiktok_ads', storeId);
  if (!creds) throw new Error('TikTok Ads is not connected for this store');
  const advertiser_id = creds.advertiserId!.trim();
  const [path, body] =
    'status' in change
      ? ['/campaign/status/update/', { advertiser_id, campaign_ids: [campaignId], operation_status: 'DISABLE' }]
      : ['/campaign/update/', { advertiser_id, campaign_id: campaignId, budget: Math.round(change.dailyBudget * 100) / 100 }];
  const res = await fetchFn(`${ADS_API}${path}`, { method: 'POST', headers: { 'Access-Token': creds.accessToken!, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { code?: number; message?: string };
  if (json.code !== undefined && json.code >= 40100 && json.code < 40200) throw new Error('TikTok rejected the access token; generate a new one for the advertiser account');
  if (!res.ok || json.code !== 0) throw new Error(`TikTok Ads: ${json.message ?? `HTTP ${res.status}`}`);
}
