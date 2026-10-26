import { sign } from 'node:crypto';
import { tx, type Db } from '../db';
import { addDays, localDate } from '../dates';
import { getCredentials, setIntegrationStatus } from '../integrations';
import { AD_ZONES, adRate, backfillRate, cents, pruneCampaigns, rebuildAdSpend, stateOf, switchToReal, type CampaignChange } from './common';

// Google Ads API (REST + GAQL) with an OAuth refresh token; GA4 Data API with a service account (read-only scope).
export const GOOGLE_ADS_API_VERSION = 'v26';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** First sync pulls this many days (1Y range + the previous year for deltas). */
const BACKFILL_DAYS = 730;
/** Conversions keep landing for weeks after the click, so later Ads syncs re-pull this window. */
const ADS_ATTRIBUTION_DAYS = 30;
/** GA4 finishes processing a day within ~48h. */
const GA4_SETTLE_DAYS = 3;

type Fetch = typeof fetch;
type GoogleError = { error?: string | { message?: string; details?: { errors?: { message: string }[] }[] }; error_description?: string };

interface AdsRow {
  campaign: { id: string; name?: string; status?: string };
  campaignBudget?: { amountMicros?: string };
  segments?: { date: string };
  metrics?: { costMicros?: string; conversions?: number; conversionsValue?: number; clicks?: string; impressions?: string };
  customer?: { currencyCode?: string; timeZone?: string };
}

const STATUS: Record<string, string> = { ENABLED: 'active', PAUSED: 'paused', REMOVED: 'archived' };
const micros = (v: string | undefined) => Number(v ?? 0) / 1e6;

/** "123-456-7890" / "properties/123" → digits only. */
export function googleId(id: string, what: string, example: string) {
  const d = id.trim().replace(/^properties\//, '').replace(/-/g, '');
  if (!/^\d+$/.test(d)) throw new Error(`${what} must look like ${example}`);
  return d;
}

/** Ads puts the useful text in details[].errors[]; OAuth uses error_description. */
const errorText = (b: GoogleError, status: number) =>
  typeof b.error === 'string' ? (b.error_description ?? b.error) : (b.error?.details?.[0]?.errors?.[0]?.message ?? b.error?.message ?? `HTTP ${status}`);

async function call<T>(url: string, init: RequestInit, fetchFn: Fetch, service: string): Promise<T> {
  const res = await fetchFn(url, init);
  const body = (await res.json().catch(() => ({}))) as T & GoogleError;
  if (!res.ok) throw new Error(`${service}: ${errorText(body, res.status)}`);
  return body;
}

/** Trades a refresh token or a service-account JWT for an access token. */
async function accessToken(grant: Record<string, string>, fetchFn: Fetch, service: string) {
  const res = await fetchFn(TOKEN_URL, { method: 'POST', body: new URLSearchParams(grant) });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string } & GoogleError;
  // A refresh token lapses after 7 days while the owner's OAuth app is in Testing (and when revoked).
  if (body.error === 'invalid_grant' && grant.grant_type === 'refresh_token') {
    throw new Error(`${service} sign-in expired: press Connect to sign in again. If it lapses again after a week, publish the OAuth app (Google Cloud → Google Auth Platform → Audience → Publish app).`);
  }
  if (!res.ok) throw new Error(`${service} sign-in failed: ${errorText(body, res.status)}`);
  if (!body.access_token) throw new Error(`${service} sign-in failed: no access token`);
  return body.access_token;
}

/** The JWT a service account signs to get a read-only Analytics token. */
export function serviceAccountJwt(json: string, now: Date) {
  let sa: { client_email?: string; private_key?: string };
  try {
    sa = JSON.parse(json);
  } catch {
    throw new Error('Service account JSON is not valid JSON; paste the whole key file');
  }
  if (!sa.client_email || !sa.private_key) throw new Error('Service account JSON needs client_email and private_key');
  const iat = Math.floor(now.getTime() / 1000);
  const part = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/analytics.readonly', aud: TOKEN_URL, iat, exp: iat + 3600 })}`;
  return `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key).toString('base64url')}`;
}

/** Google Ads API headers; login-customer-id when the ad account is reached through a manager account. */
const adsHeaders = (token: string, creds: Record<string, string>) => ({
  authorization: `Bearer ${token}`, 'developer-token': creds.developerToken!, 'content-type': 'application/json',
  ...(creds.managerId ? { 'login-customer-id': googleId(creds.managerId, 'Manager account ID', '123-456-7890') } : {}),
});

const cursorOf = (db: Db, id: string) => db.prepare('SELECT cursor FROM integrations WHERE id = ?').get(id)?.cursor as string | null;

export async function syncGoogleAds(db: Db, key: Buffer, storeId: string, fetchFn: Fetch = fetch, now = new Date()) {
  const id = `google_ads:${storeId}`;
  const creds = getCredentials(db, key, 'google_ads', storeId);
  if (!creds) return;
  try {
    const customer = googleId(creds.customerId!, 'Customer ID', '123-456-7890');
    const token = await accessToken({ grant_type: 'refresh_token', client_id: creds.clientId!, client_secret: creds.clientSecret!, refresh_token: creds.refreshToken! }, fetchFn, 'Google');
    const search = async (query: string) => {
      const rows: AdsRow[] = [];
      let pageToken: string | undefined;
      do {
        const page = await call<{ results?: AdsRow[]; nextPageToken?: string }>(
          `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customer}/googleAds:search`,
          { method: 'POST', headers: adsHeaders(token, creds), body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }) },
          fetchFn,
          'Google Ads',
        );
        rows.push(...(page.results ?? []));
        pageToken = page.nextPageToken;
      } while (pageToken);
      return rows;
    };
    const today = localDate(now);
    const cursor = cursorOf(db, id);
    const start = cursor ? addDays(cursor, -ADS_ATTRIBUTION_DAYS) : addDays(today, 1 - BACKFILL_DAYS);
    // Metrics first: a campaign created between the two queries then has a row for the join.
    const rows = await search(
      `SELECT campaign.id, segments.date, metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.clicks, metrics.impressions FROM campaign WHERE segments.date BETWEEN '${start}' AND '${today}'`,
    );
    const campaigns = await search('SELECT campaign.id, campaign.name, campaign.status, campaign_budget.amount_micros, customer.currency_code, customer.time_zone FROM campaign');
    const currency = campaigns[0]?.customer?.currencyCode;
    const zone = campaigns[0]?.customer?.timeZone;
    if (zone) stateOf<string>(db, AD_ZONES).set(id, zone);
    const rate = await adRate(db, storeId, currency, fetchFn, 'Google Ads');
    const rateOn = cursor ? () => rate : await backfillRate(db, storeId, currency, rate, fetchFn);

    tx(db, () => {
      switchToReal(db, storeId);
      const camp = db.prepare(
        `INSERT INTO campaigns (network, id, store_id, name, status, daily_budget) VALUES ('google', ?, ?, ?, ?, ?)
         ON CONFLICT (network, id) DO UPDATE SET name = excluded.name, status = excluded.status, daily_budget = excluded.daily_budget`,
      );
      for (const { campaign: c, campaignBudget } of campaigns) camp.run(c.id, storeId, c.name ?? c.id, STATUS[c.status ?? ''] ?? (c.status ?? 'unknown').toLowerCase(), cents(micros(campaignBudget?.amountMicros) * rate));
      const day = db.prepare(
        `INSERT INTO campaign_daily (network, campaign_id, date, spend, revenue, purchases, clicks, impressions) VALUES ('google', ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (network, campaign_id, date) DO UPDATE SET spend = excluded.spend, revenue = excluded.revenue, purchases = excluded.purchases,
           clicks = excluded.clicks, impressions = excluded.impressions`,
      );
      const dates = new Set<string>();
      for (const r of rows) {
        const m = r.metrics ?? {};
        dates.add(r.segments!.date);
        const k = rateOn(r.segments!.date);
        day.run(r.campaign.id, r.segments!.date, cents(micros(m.costMicros) * k), cents(Number(m.conversionsValue ?? 0) * k), Math.round(Number(m.conversions ?? 0)), Number(m.clicks ?? 0), Number(m.impressions ?? 0));
      }
      if (!cursor) for (const d of pruneCampaigns(db, storeId, 'google', [...campaigns.map((c) => c.campaign.id), ...rows.map((r) => r.campaign.id)])) dates.add(d);
      rebuildAdSpend(db, storeId, dates);
      db.prepare("UPDATE integrations SET cursor = ?, synced_at = ?, status = 'connected', error = NULL WHERE id = ?").run(today, now.toISOString(), id);
    });
  } catch (e) {
    setIntegrationStatus(db, id, 'error', e instanceof Error ? e.message : 'Google Ads sync failed');
  }
}

/** GA4 owns the funnel columns (sessions, add to carts, checkouts) in daily_metrics. */
export async function syncGa4(db: Db, key: Buffer, storeId: string, fetchFn: Fetch = fetch, now = new Date()) {
  const id = `ga4:${storeId}`;
  const creds = getCredentials(db, key, 'ga4', storeId);
  if (!creds) return;
  try {
    const property = googleId(creds.propertyId!, 'Property ID', '123456789');
    const token = await accessToken({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: serviceAccountJwt(creds.serviceAccountJson!, now) }, fetchFn, 'Google Analytics');
    const today = localDate(now);
    const cursor = cursorOf(db, id);
    const start = cursor ? addDays(cursor, -GA4_SETTLE_DAYS) : addDays(today, 1 - BACKFILL_DAYS);
    const report = await call<{ rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[]; metadata?: { timeZone?: string } }>(
      `https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ dateRanges: [{ startDate: start, endDate: today }], dimensions: [{ name: 'date' }], metrics: [{ name: 'sessions' }, { name: 'addToCarts' }, { name: 'checkouts' }], limit: 100000 }),
      },
      fetchFn,
      'Google Analytics',
    );
    if (report.metadata?.timeZone) stateOf<string>(db, AD_ZONES).set(id, report.metadata.timeZone);

    tx(db, () => {
      switchToReal(db, storeId);
      const up = db.prepare(
        `INSERT INTO daily_metrics (store_id, date, sessions, add_to_carts, checkouts) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (store_id, date) DO UPDATE SET sessions = excluded.sessions, add_to_carts = excluded.add_to_carts, checkouts = excluded.checkouts`,
      );
      for (const r of report.rows ?? []) {
        const d = r.dimensionValues[0]!.value; // YYYYMMDD
        const [sessions, carts, checkouts] = r.metricValues.map((m) => Number(m.value));
        up.run(storeId, `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, sessions ?? 0, carts ?? 0, checkouts ?? 0);
      }
      db.prepare("UPDATE integrations SET cursor = ?, synced_at = ?, status = 'connected', error = NULL WHERE id = ?").run(today, now.toISOString(), id);
    });
  } catch (e) {
    setIntegrationStatus(db, id, 'error', e instanceof Error ? e.message : 'Google Analytics sync failed');
  }
}

/** Ad-account write. Use setCampaignBudget / pauseCampaign in ./ads, never directly. */
export async function updateGoogleCampaign(db: Db, key: Buffer, storeId: string, campaignId: string, change: CampaignChange, fetchFn: Fetch = fetch) {
  const creds = getCredentials(db, key, 'google_ads', storeId);
  if (!creds) throw new Error('Google Ads is not connected for this store');
  const customer = googleId(creds.customerId!, 'Customer ID', '123-456-7890');
  const token = await accessToken({ grant_type: 'refresh_token', client_id: creds.clientId!, client_secret: creds.clientSecret!, refresh_token: creds.refreshToken! }, fetchFn, 'Google');
  const base = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customer}`;
  const post = <T>(path: string, body: object) =>
    call<T>(`${base}/${path}`, { method: 'POST', headers: adsHeaders(token, creds), body: JSON.stringify(body) }, fetchFn, 'Google Ads');
  if ('status' in change) {
    await post('campaigns:mutate', { operations: [{ update: { resourceName: `customers/${customer}/campaigns/${campaignId}`, status: change.status }, updateMask: 'status' }] });
    return;
  }
  type Row = { campaign: { campaignBudget?: string }; campaignBudget?: { explicitlyShared?: boolean }; customer?: { currencyCode?: string } };
  const { results } = await post<{ results?: Row[] }>('googleAds:search', {
    query: `SELECT campaign.campaign_budget, campaign_budget.explicitly_shared, customer.currency_code FROM campaign WHERE campaign.id = ${campaignId}`,
  });
  const row = results?.[0];
  if (!row?.campaign.campaignBudget) throw new Error('Google Ads: campaign not found in this account');
  if (row.campaignBudget?.explicitlyShared) throw new Error('Google Ads: this campaign uses a shared budget; change it in Google Ads so the other campaigns sharing it are not affected');
  // The budget comes in the store's currency (as synced); Google wants the account's, in whole minor units (cents, or yen).
  const currency = row.customer?.currencyCode;
  const amount = change.dailyBudget / (await adRate(db, storeId, currency, fetchFn, 'Google Ads'));
  const digits = currency ? (new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2) : 2;
  const amountMicros = String(Math.round(amount * 10 ** digits) * 10 ** (6 - digits));
  await post('campaignBudgets:mutate', { operations: [{ update: { resourceName: row.campaign.campaignBudget, amountMicros }, updateMask: 'amount_micros' }] });
}
