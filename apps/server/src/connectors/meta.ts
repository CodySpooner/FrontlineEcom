import { tx, type Db } from '../db';
import { addDays, localDate } from '../dates';
import { getCredentials, setIntegrationStatus } from '../integrations';
import { rebuildAdSpend, switchToReal } from './common';

// Meta Marketing API (Graph). System-user token with ads_read on the ad account.
export const META_API_VERSION = 'v24.0';
const GRAPH = `https://graph.facebook.com/${META_API_VERSION}`;
/** First sync pulls this many days; later syncs re-pull the attribution window so late conversions land. */
const BACKFILL_DAYS = 730;
const ATTRIBUTION_DAYS = 28;
/** Insights requests span at most this many days to stay under Meta's per-query limits. */
const CHUNK_DAYS = 90;

type Fetch = typeof fetch;
type Action = { action_type: string; value: string };

interface InsightRow {
  campaign_id: string;
  campaign_name: string;
  date_start: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: Action[];
  action_values?: Action[];
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

/** GETs a Graph edge and follows `paging.next` (only on graph.facebook.com). */
async function edge<T>(url: string, token: string, fetchFn: Fetch): Promise<T[]> {
  const out: T[] = [];
  let next: string | undefined = url;
  while (next) {
    if (!next.startsWith('https://graph.facebook.com/')) throw new Error('Meta returned an unexpected paging URL');
    const res = await fetchFn(next, { headers: { Authorization: `Bearer ${token}` } });
    const body = (await res.json().catch(() => ({}))) as { data?: T[]; paging?: { next?: string }; error?: { message: string; code?: number } };
    if (body.error?.code === 190 || res.status === 401) throw new Error('Meta rejected the access token; generate a new system user token with ads_read');
    if (!res.ok || body.error) throw new Error(`Meta: ${body.error?.message ?? `HTTP ${res.status}`}`);
    out.push(...(body.data ?? []));
    next = body.paging?.next;
  }
  return out;
}

export async function syncMeta(db: Db, key: Buffer, storeId: string, fetchFn: Fetch = fetch, now = new Date()) {
  const id = `meta_ads:${storeId}`;
  const creds = getCredentials(db, key, 'meta_ads', storeId);
  if (!creds) return;
  try {
    const act = adAccount(creds.adAccountId!);
    const token = creds.accessToken!;
    const today = localDate(now);
    const cursor = db.prepare('SELECT cursor FROM integrations WHERE id = ?').get(id)?.cursor as string | null;
    const start = cursor ? addDays(cursor, -ATTRIBUTION_DAYS) : addDays(today, 1 - BACKFILL_DAYS);

    const campaigns = await edge<CampaignRow>(`${GRAPH}/${act}/campaigns?fields=id,name,effective_status,daily_budget&limit=200`, token, fetchFn);
    const rows: InsightRow[] = [];
    for (let since = start; since <= today; since = addDays(since, CHUNK_DAYS)) {
      const until = addDays(since, CHUNK_DAYS - 1) < today ? addDays(since, CHUNK_DAYS - 1) : today;
      const params = new URLSearchParams({
        level: 'campaign',
        time_increment: '1',
        time_range: JSON.stringify({ since, until }),
        fields: 'campaign_id,campaign_name,spend,impressions,clicks,actions,action_values',
        limit: '500',
      });
      rows.push(...(await edge<InsightRow>(`${GRAPH}/${act}/insights?${params}`, token, fetchFn)));
    }

    tx(db, () => {
      switchToReal(db, storeId);
      // ponytail: daily_budget is in the account currency's minor unit; /100 is wrong for zero-decimal currencies (JPY, KRW)
      const camp = db.prepare(
        `INSERT INTO campaigns (network, id, store_id, name, status, daily_budget) VALUES ('meta', ?, ?, ?, ?, ?)
         ON CONFLICT (network, id) DO UPDATE SET name = excluded.name, status = excluded.status, daily_budget = excluded.daily_budget`,
      );
      for (const c of campaigns) camp.run(c.id, storeId, c.name, c.effective_status.toLowerCase(), Number(c.daily_budget ?? 0) / 100);
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
        day.run(r.campaign_id, r.date_start, Number(r.spend ?? 0), purchaseValue(r.action_values), Math.round(purchaseValue(r.actions)), Number(r.clicks ?? 0), Number(r.impressions ?? 0));
      }
      rebuildAdSpend(db, storeId, dates);
      db.prepare("UPDATE integrations SET cursor = ?, synced_at = ?, status = 'connected', error = NULL WHERE id = ?").run(today, now.toISOString(), id);
    });
  } catch (e) {
    setIntegrationStatus(db, id, 'error', e instanceof Error ? e.message : 'Meta sync failed');
  }
}
