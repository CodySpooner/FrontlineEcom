import { tx, type Db } from '../db';
import { addDays, localDate } from '../dates';
import { getCredentials, setIntegrationStatus } from '../integrations';
import { rebuildAdSpend, switchToReal } from './common';

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
