import { sign } from 'node:crypto';
import { tx, type Db } from '../db';
import { addDays, localDate } from '../dates';
import { getCredentials, setIntegrationStatus } from '../integrations';
import { noteAdReads, noteRead } from './ingest';
import { adZone, AD_ZONES, claimCampaigns, adRate, backfillRate, cents, pruneCampaigns, rebuildAdSpend, saveAds, stateOf, switchToReal, syncView, stillAsSynced, syncedBudget, type CampaignChange } from './common';

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
  /** FROM ad_group_ad rows only. */
  adGroup?: { id: string };
  adGroupAd?: { status?: string; ad: { id: string; name?: string; responsiveSearchAd?: { headlines?: { text?: string }[]; descriptions?: { text?: string }[] } } };
  campaignBudget?: { amountMicros?: string };
  segments?: { date: string };
  metrics?: { costMicros?: string; conversions?: number; conversionsValue?: number; clicks?: string; impressions?: string };
  customer?: { currencyCode?: string; timeZone?: string };
  /** FROM conversion_action rows only (SA-58). */
  conversionAction?: { name?: string; attributionModelSettings?: { attributionModel?: string }; clickThroughLookbackWindowDays?: string; viewThroughLookbackWindowDays?: string };
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

/**
 * SA-58: the conversion actions in metrics.conversions (enabled, include_in_conversions_metric) with their attribution
 * model and lookback windows (conversion_action fields, v26 reference read 2026-10-29); undefined with none.
 * ponytail: the first three are named, then a count.
 */
export function googleAttribution(rows: AdsRow[]) {
  const named = rows.flatMap(({ conversionAction: c }) => {
    if (!c) return [];
    const model = (c.attributionModelSettings?.attributionModel ?? 'UNSPECIFIED').replace(/^GOOGLE_(SEARCH_ATTRIBUTION|ADS)_/, '').toLowerCase().replace(/_/g, '-');
    return [`${c.name ?? 'Unnamed'} (${model}, ${c.clickThroughLookbackWindowDays ?? '?'}-day click, ${c.viewThroughLookbackWindowDays ?? '?'}-day view)`];
  });
  if (!named.length) return;
  return `Conversion actions: ${named.slice(0, 3).join('; ')}${named.length > 3 ? `; and ${named.length - 3} more` : ''}`;
}

const cursorOf = (db: Db, id: string) => db.prepare('SELECT cursor FROM integrations WHERE id = ?').get(id)?.cursor as string | null;

export async function syncGoogleAds(db: Db, key: Buffer, storeId: string, fetchFn: Fetch = fetch, now = new Date()) {
  const id = `google_ads:${storeId}`;
  const creds = getCredentials(db, key, 'google_ads', storeId);
  if (!creds) return;
  const view = syncView(db, id);
  let campaignSynced = false;
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
    const today = localDate(now, adZone(db, id)); // the account's day (its zone as last seen; the machine's at first)
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
    const rateOn = await backfillRate(db, storeId, currency, rate, fetchFn, !cursor);
    const actions = await search(
      "SELECT conversion_action.name, conversion_action.attribution_model_settings.attribution_model, conversion_action.click_through_lookback_window_days, conversion_action.view_through_lookback_window_days FROM conversion_action WHERE conversion_action.status = 'ENABLED' AND conversion_action.include_in_conversions_metric = TRUE",
    ).catch(() => []);

    if (syncView(db, id) !== view) return;
    tx(db, () => {
      switchToReal(db, storeId);
      claimCampaigns(db, storeId, 'google', [...campaigns.map((c) => c.campaign.id), ...rows.map((r) => r.campaign.id)]);
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
    });
    campaignSynced = true;
    noteAdReads(db, key, id, { from: start, to: today }, currency, googleAttribution(actions), now);

    // Each ad's days and its text (KB-20). ponytail: responsive search ads' descriptions only; Performance Max has asset groups, not ads.
    const adRows = await search(
      `SELECT ad_group_ad.ad.id, ad_group.id, campaign.id, segments.date, metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.clicks, metrics.impressions FROM ad_group_ad WHERE segments.date BETWEEN '${start}' AND '${today}'`,
    );
    const ads = await search(
      'SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, ad_group.id, campaign.id FROM ad_group_ad',
    );
    if (syncView(db, id) !== view) return;
    // Keep the cursor until both reads succeed so missing ad history is retried.
    tx(db, () => {
      saveAds(
        db, storeId, 'google',
        ads.map(({ adGroupAd: g, adGroup, campaign }) => {
          const rsa = g!.ad.responsiveSearchAd;
          const text = (rsa?.descriptions ?? []).map((t) => t.text).filter(Boolean).join('\n');
          return { id: g!.ad.id, campaignId: campaign.id, groupId: adGroup?.id, name: g!.ad.name || rsa?.headlines?.[0]?.text || `Ad ${g!.ad.id}`, status: STATUS[g!.status ?? ''] ?? (g!.status ?? 'unknown').toLowerCase(), copy: text || undefined };
        }),
        adRows.map(({ adGroupAd: g, adGroup, campaign, segments, metrics: m = {} }) => {
          const k = rateOn(segments!.date);
          return {
            adId: g!.ad.id, campaignId: campaign.id, groupId: adGroup?.id, date: segments!.date, spend: cents(micros(m.costMicros) * k), revenue: cents(Number(m.conversionsValue ?? 0) * k),
            purchases: Math.round(Number(m.conversions ?? 0)), clicks: Number(m.clicks ?? 0), impressions: Number(m.impressions ?? 0),
          };
        }),
      );
      db.prepare("UPDATE integrations SET cursor = ?, synced_at = ?, status = 'connected', error = NULL WHERE id = ?").run(today, now.toISOString(), id);
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Google Ads sync failed';
    setIntegrationStatus(db, id, 'error', campaignSynced ? `Campaign spend synced; ad-level sync failed: ${message}` : message);
  }
}

/**
 * SA-57: the session dimensions read per day (Data API schema, checked 2026-10-29), each into `traffic_breakdown_daily`
 * under the name Shopify's use (BREAKDOWNS in shopify.ts). countryId is ISO 3166-1 alpha-2, as Shopify's country code.
 */
const GA4_BREAKDOWNS = { source: 'sessionDefaultChannelGroup', device: 'deviceCategory', country: 'countryId' } as const;

type Ga4Report = { rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[]; metadata?: { timeZone?: string } };
const ga4Day = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`; // YYYYMMDD

/** GA4 owns the funnel columns (sessions, add to carts, checkouts) in daily_metrics. */
export async function syncGa4(db: Db, key: Buffer, storeId: string, fetchFn: Fetch = fetch, now = new Date()) {
  const id = `ga4:${storeId}`;
  const creds = getCredentials(db, key, 'ga4', storeId);
  if (!creds) return;
  const view = syncView(db, id);
  try {
    const property = googleId(creds.propertyId!, 'Property ID', '123456789');
    const token = await accessToken({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: serviceAccountJwt(creds.serviceAccountJson!, now) }, fetchFn, 'Google Analytics');
    const today = localDate(now, adZone(db, id)); // the account's day (its zone as last seen; the machine's at first)
    const cursor = cursorOf(db, id);
    const start = cursor ? addDays(cursor, -GA4_SETTLE_DAYS) : addDays(today, 1 - BACKFILL_DAYS);
    const run = (dimensions: string[], metrics: string[]) =>
      call<Ga4Report>(
        `https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ dateRanges: [{ startDate: start, endDate: today }], dimensions: dimensions.map((name) => ({ name })), metrics: metrics.map((name) => ({ name })), limit: 100000 }),
        },
        fetchFn,
        'Google Analytics',
      );
    const report = await run(['date'], ['sessions', 'addToCarts', 'checkouts']);
    noteRead(db, key, id, 'traffic', { status: 'available', from: start, to: today }, now);
    if (report.metadata?.timeZone) stateOf<string>(db, AD_ZONES).set(id, report.metadata.timeZone);
    // A failed split is left as it was and tried again next sync; the funnel still syncs.
    // ponytail: a dimension past 100k rows (two years of countries) is cut short; its shortfall reads as unknown.
    const split: [string, Ga4Report][] = [];
    for (const [dimension, field] of Object.entries(GA4_BREAKDOWNS)) {
      const r = await run(['date', field], ['sessions']).catch(() => null);
      if (r) split.push([dimension, r]);
    }
    noteRead(db, key, id, 'traffic_breakdowns', split.length === 3 ? { status: 'available', from: start, to: today }
      : split.length ? { status: 'partial', from: start, to: today, note: 'Some session splits failed; tried again next sync' } : { status: 'failed', error: 'Google Analytics returned no session splits' }, now);

    if (syncView(db, id) !== view) return;
    tx(db, () => {
      switchToReal(db, storeId);
      const up = db.prepare(
        `INSERT INTO daily_metrics (store_id, date, sessions, add_to_carts, checkouts) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (store_id, date) DO UPDATE SET sessions = excluded.sessions, add_to_carts = excluded.add_to_carts, checkouts = excluded.checkouts`,
      );
      const totals = new Map<string, number>();
      for (const r of report.rows ?? []) {
        const [sessions, carts, checkouts] = r.metricValues.map((m) => Number(m.value));
        totals.set(ga4Day(r.dimensionValues[0]!.value), sessions ?? 0);
        up.run(storeId, ga4Day(r.dimensionValues[0]!.value), sessions ?? 0, carts ?? 0, checkouts ?? 0);
      }
      // GA4 has no purchasing sessions (decision 14): they stay unknown. "(not set)" and any shortfall against the day's
      // sessions read as unknown.
      const clear = db.prepare("DELETE FROM traffic_breakdown_daily WHERE store_id = ? AND dimension = ? AND source = 'ga4' AND date >= ?");
      const put = db.prepare(
        `INSERT INTO traffic_breakdown_daily (store_id, date, dimension, value, sessions, purchase_sessions, source) VALUES (?, ?, ?, ?, ?, NULL, 'ga4')
         ON CONFLICT (store_id, date, dimension, value) DO UPDATE SET sessions = excluded.sessions, purchase_sessions = NULL, source = excluded.source`,
      );
      for (const [dimension, r] of split) {
        clear.run(storeId, dimension, start);
        const sums = new Map<string, number>();
        for (const row of r.rows ?? []) {
          const [date, value] = [ga4Day(row.dimensionValues[0]!.value), row.dimensionValues[1]?.value];
          const sessions = Number(row.metricValues[0]?.value) || 0;
          if (!value || value === '(not set)') continue;
          put.run(storeId, date, dimension, value, sessions);
          sums.set(date, (sums.get(date) ?? 0) + sessions);
        }
        for (const [date, total] of totals) if (total - (sums.get(date) ?? 0) > 0) put.run(storeId, date, dimension, 'unknown', total - (sums.get(date) ?? 0));
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
  const synced = syncedBudget(db, storeId, 'google', campaignId);
  type Row = { campaign: { campaignBudget?: string }; campaignBudget?: { explicitlyShared?: boolean; amountMicros?: string }; customer?: { currencyCode?: string } };
  const { results } = await post<{ results?: Row[] }>('googleAds:search', {
    query: `SELECT campaign.campaign_budget, campaign_budget.explicitly_shared, campaign_budget.amount_micros, customer.currency_code FROM campaign WHERE campaign.id = ${campaignId}`,
  });
  const row = results?.[0];
  if (!row?.campaign.campaignBudget) throw new Error('Google Ads: campaign not found in this account');
  if (row.campaignBudget?.explicitlyShared) throw new Error('Google Ads: this campaign uses a shared budget; change it in Google Ads so the other campaigns sharing it are not affected');
  // The budget comes in the store's currency (as synced); Google wants the account's, in whole minor units (cents, or yen).
  const currency = row.customer?.currencyCode;
  const rate = await adRate(db, storeId, currency, fetchFn, 'Google Ads');
  stillAsSynced('Google Ads', 'daily budget', cents((Number(row.campaignBudget?.amountMicros) / 1e6) * rate), synced);
  const amount = change.dailyBudget / rate;
  const digits = currency ? (new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2) : 2;
  const amountMicros = String(Math.round(amount * 10 ** digits) * 10 ** (6 - digits));
  await post('campaignBudgets:mutate', { operations: [{ update: { resourceName: row.campaign.campaignBudget, amountMicros }, updateMask: 'amount_micros' }] });
}
