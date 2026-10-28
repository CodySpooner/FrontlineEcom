import { tx, type Db } from '../db';
import { addDays, localDate } from '../dates';
import { getCredentials, setIntegrationStatus } from '../integrations';
import { adZone, AD_ZONES, archiveUnlisted, claimCampaigns, adRate, backfillRate, cents, pruneCampaigns, rebuildAdSpend, saveAds, stateOf, switchToReal, syncView, stillAsSynced, syncedBudget, type CampaignChange } from './common';

// Meta Marketing API (Graph). System-user token with ads_read on the ad account.
export const META_API_VERSION = 'v24.0';
const GRAPH = `https://graph.facebook.com/${META_API_VERSION}`;
/** First sync pulls this many days; later syncs re-pull the attribution window so late conversions land. */
const BACKFILL_DAYS = 730;
const ATTRIBUTION_DAYS = 28;
/** Insights requests span at most this many days to stay under Meta's per-query limits. */
const CHUNK_DAYS = 90;
/** Budgets are in the currency's minor unit (cents), except these, which have none (Marketing API currency offset 1). */
const ZERO_DECIMAL = new Set(['CLP', 'COP', 'CRC', 'HUF', 'ISK', 'IDR', 'JPY', 'KRW', 'PYG', 'TWD', 'VND']);

type Fetch = typeof fetch;
type Action = { action_type: string; value: string };

interface InsightRow {
  campaign_id: string;
  campaign_name: string;
  /** level=ad rows only. */
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  date_start: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: Action[];
  action_values?: Action[];
}

interface AdRow {
  id: string;
  name: string;
  campaign_id: string;
  adset_id?: string;
  effective_status: string;
  creative?: { body?: string };
}

interface CampaignRow {
  id: string;
  name: string;
  effective_status: string;
  daily_budget?: string;
}

/** Purchases: prefer Meta's de-duplicated omni_purchase, else pixel/onsite purchase. Never sum them (double counting). */
export function purchaseValue(list: Action[] | undefined) {
  for (const type of ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase']) {
    const hit = list?.find((a) => a.action_type === type);
    if (hit) return Number(hit.value);
  }
  return 0;
}

/** "act_123" or "123" → "act_123". */
export const adAccount = (id: string) => {
  const digits = id.trim().replace(/^act_/, '');
  if (!/^\d+$/.test(digits)) throw new Error('Ad account ID must look like act_1234567890');
  return `act_${digits}`;
};

/** GETs a Graph object. */
async function graph<T>(url: string, token: string, fetchFn: Fetch): Promise<T> {
  const res = await fetchFn(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message: string; code?: number } };
  if (body.error?.code === 190 || res.status === 401) throw new Error('Meta rejected the access token; generate a new system user token with ads_read');
  if (!res.ok || body.error) throw new Error(`Meta: ${body.error?.message ?? `HTTP ${res.status}`}`);
  return body;
}

/** GETs a Graph edge and follows `paging.next` (only on graph.facebook.com). */
async function edge<T>(url: string, token: string, fetchFn: Fetch): Promise<T[]> {
  const out: T[] = [];
  let next: string | undefined = url;
  while (next) {
    if (!next.startsWith('https://graph.facebook.com/')) throw new Error('Meta returned an unexpected paging URL');
    const body: { data?: T[]; paging?: { next?: string } } = await graph(next, token, fetchFn);
    out.push(...(body.data ?? []));
    next = body.paging?.next;
  }
  return out;
}

/** The factor from the ad account's currency into the store's, and its budget units (minor units, or 1 where it has none). */
async function accountMoney(db: Db, storeId: string, act: string, token: string, fetchFn: Fetch) {
  const { currency, timezone_name: zone } = await graph<{ currency: string; timezone_name?: string }>(`${GRAPH}/${act}?fields=currency,timezone_name`, token, fetchFn);
  return { currency, zone, rate: await adRate(db, storeId, currency, fetchFn, 'Meta'), units: ZERO_DECIMAL.has(currency) ? 1 : 100 };
}

export async function syncMeta(db: Db, key: Buffer, storeId: string, fetchFn: Fetch = fetch, now = new Date()) {
  const id = `meta_ads:${storeId}`;
  const creds = getCredentials(db, key, 'meta_ads', storeId);
  if (!creds) return;
  const view = syncView(db, id);
  try {
    const act = adAccount(creds.adAccountId!);
    const token = creds.accessToken!;
    const today = localDate(now, adZone(db, id)); // the account's day (its zone as last seen; the machine's at first)
    const cursor = db.prepare('SELECT cursor FROM integrations WHERE id = ?').get(id)?.cursor as string | null;
    const start = cursor ? addDays(cursor, -ATTRIBUTION_DAYS) : addDays(today, 1 - BACKFILL_DAYS);

    const money = await accountMoney(db, storeId, act, token, fetchFn);
    if (money.zone) stateOf<string>(db, AD_ZONES).set(id, money.zone);
    const rateOn = cursor ? () => money.rate : await backfillRate(db, storeId, money.currency, money.rate, fetchFn);
    const campaigns = await edge<CampaignRow>(`${GRAPH}/${act}/campaigns?fields=id,name,effective_status,daily_budget&limit=200`, token, fetchFn);
    const ads = await edge<AdRow>(`${GRAPH}/${act}/ads?fields=id,name,campaign_id,adset_id,effective_status,creative{body}&limit=200`, token, fetchFn);
    // Campaign totals (the store's ad spend), then each ad's (KB-20).
    const rows: InsightRow[] = [];
    const adRows: InsightRow[] = [];
    for (let since = start; since <= today; since = addDays(since, CHUNK_DAYS)) {
      const until = addDays(since, CHUNK_DAYS - 1) < today ? addDays(since, CHUNK_DAYS - 1) : today;
      for (const [level, into] of [['campaign', rows], ['ad', adRows]] as const) {
        const params = new URLSearchParams({
          level,
          time_increment: '1',
          time_range: JSON.stringify({ since, until }),
          fields: `campaign_id,campaign_name,${level === 'ad' ? 'ad_id,ad_name,adset_id,' : ''}spend,impressions,clicks,actions,action_values`,
          limit: '500',
        });
        into.push(...(await edge<InsightRow>(`${GRAPH}/${act}/insights?${params}`, token, fetchFn)));
      }
    }

    if (syncView(db, id) !== view) return;
    tx(db, () => {
      switchToReal(db, storeId);
      claimCampaigns(db, storeId, 'meta', [...campaigns.map((c) => c.id), ...rows.map((r) => r.campaign_id)]);
      const camp = db.prepare(
        `INSERT INTO campaigns (network, id, store_id, name, status, daily_budget) VALUES ('meta', ?, ?, ?, ?, ?)
         ON CONFLICT (network, id) DO UPDATE SET name = excluded.name, status = excluded.status, daily_budget = excluded.daily_budget`,
      );
      for (const c of campaigns) camp.run(c.id, storeId, c.name, c.effective_status.toLowerCase(), cents((Number(c.daily_budget ?? 0) / money.units) * money.rate));
      archiveUnlisted(db, storeId, 'meta', campaigns.map((c) => c.id));
      // Campaigns that only show up in insights (deleted/archived since) still need a row for the join.
      const seen = db.prepare("INSERT OR IGNORE INTO campaigns (network, id, store_id, name, status, daily_budget) VALUES ('meta', ?, ?, ?, 'archived', 0)");
      for (const r of rows) seen.run(r.campaign_id, storeId, r.campaign_name);

      const day = db.prepare(
        `INSERT INTO campaign_daily (network, campaign_id, date, spend, revenue, purchases, clicks, impressions) VALUES ('meta', ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (network, campaign_id, date) DO UPDATE SET spend = excluded.spend, revenue = excluded.revenue, purchases = excluded.purchases,
           clicks = excluded.clicks, impressions = excluded.impressions`,
      );
      const dates = new Set<string>();
      for (const r of rows) {
        dates.add(r.date_start);
        const rate = rateOn(r.date_start);
        day.run(r.campaign_id, r.date_start, cents(Number(r.spend ?? 0) * rate), cents(purchaseValue(r.action_values) * rate), Math.round(purchaseValue(r.actions)), Number(r.clicks ?? 0), Number(r.impressions ?? 0));
      }
      if (!cursor) for (const d of pruneCampaigns(db, storeId, 'meta', [...campaigns.map((c) => c.id), ...rows.map((r) => r.campaign_id)])) dates.add(d);
      rebuildAdSpend(db, storeId, dates);
      saveAds(
        db, storeId, 'meta',
        ads.map((a) => ({ id: a.id, campaignId: a.campaign_id, groupId: a.adset_id, name: a.name, status: a.effective_status.toLowerCase(), copy: a.creative?.body })),
        adRows.map((r) => {
          const rate = rateOn(r.date_start);
          return {
            adId: r.ad_id!, campaignId: r.campaign_id, groupId: r.adset_id, name: r.ad_name, date: r.date_start, spend: cents(Number(r.spend ?? 0) * rate), revenue: cents(purchaseValue(r.action_values) * rate),
            purchases: Math.round(purchaseValue(r.actions)), clicks: Number(r.clicks ?? 0), impressions: Number(r.impressions ?? 0),
          };
        }),
      );
      db.prepare("UPDATE integrations SET cursor = ?, synced_at = ?, status = 'connected', error = NULL WHERE id = ?").run(today, now.toISOString(), id);
    });
  } catch (e) {
    setIntegrationStatus(db, id, 'error', e instanceof Error ? e.message : 'Meta sync failed');
  }
}

/** Ad-account write (token needs ads_management). Use setCampaignBudget / pauseCampaign in ./ads, never directly. */
export async function updateMetaCampaign(db: Db, key: Buffer, storeId: string, campaignId: string, change: CampaignChange, fetchFn: Fetch = fetch) {
  const creds = getCredentials(db, key, 'meta_ads', storeId);
  if (!creds) throw new Error('Meta Ads is not connected for this store');
  let form: Record<string, string>;
  if ('status' in change) form = { status: change.status };
  else {
    const synced = syncedBudget(db, storeId, 'meta', campaignId);
    // The budget comes in the store's currency (as synced); Meta wants the account's, in its minor units.
    const money = await accountMoney(db, storeId, adAccount(creds.adAccountId!), creds.accessToken!, fetchFn);
    const live = (await (await fetchFn(`${GRAPH}/${campaignId}?fields=daily_budget`, { headers: { Authorization: `Bearer ${creds.accessToken!}` } })).json().catch(() => ({}))) as { daily_budget?: string };
    stillAsSynced('Meta', 'daily budget', cents((Number(live.daily_budget) / money.units) * money.rate), synced);
    form = { daily_budget: String(Math.round((change.dailyBudget / money.rate) * money.units)) };
  }
  const res = await fetchFn(`${GRAPH}/${campaignId}`, { method: 'POST', headers: { Authorization: `Bearer ${creds.accessToken!}` }, body: new URLSearchParams(form) });
  const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: { message: string; error_user_msg?: string } };
  if (!res.ok || !body.success) throw new Error(`Meta: ${body.error?.error_user_msg ?? body.error?.message ?? `HTTP ${res.status}`}`);
}
