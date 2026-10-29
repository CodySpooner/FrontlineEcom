// SA-58: each ad network's account currency and attribution setting, recorded with its reads (recorded responses in the
// documented shapes: Meta Ad Account Insights, Google Ads v26 conversion_action, TikTok Business API ad groups).
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { saveIntegration } from '../integrations';
import { adMetrics } from '../store-analytics/ads';
import { googleAttribution, syncGoogleAds } from './google';
import { metaAttribution, syncMeta } from './meta';
import { syncTikTokAds } from './tiktok';

const key = randomBytes(32);
const NOW = new Date('2026-10-26T18:00:00Z');
const ECB = `<gesmes:Envelope><Cube><Cube time='2026-10-26'><Cube currency='USD' rate='1.17'/></Cube></Cube></gesmes:Envelope>`;
const ecb = (url: string) => (url.includes('eurofxref') ? new Response(ECB) : url.includes('currency-api') ? new Response('', { status: 503 }) : undefined);
const notes = (db: ReturnType<typeof openDb>, id: string) =>
  Object.fromEntries(db.prepare("SELECT dataset, status, error FROM source_datasets WHERE integration_id = ? AND dataset IN ('ad_spend', 'attribution')").all(id).map((r) => [String(r.dataset), [r.status, r.error]]));
const store = () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  return db;
};

describe('ad account currency and attribution (SA-58)', () => {
  it("Meta: a EUR account on a USD store; the Insights API's default windows, and the ad sets' own when they differ", async () => {
    const db = store();
    saveIntegration(db, key, { kind: 'meta_ads', storeId: 'pawsome', values: { adAccountId: '1234567890', accessToken: 'EAAG_not-a-real-token' } });
    const asked: URL[] = [];
    const fetchFn = (async (url: string) => {
      const fx = ecb(url);
      if (fx) return fx;
      const u = new URL(url);
      asked.push(u);
      if (u.searchParams.get('fields') === 'currency,timezone_name') return Response.json({ id: 'act_1234567890', currency: 'EUR', timezone_name: 'Europe/Berlin' });
      if (u.pathname.endsWith('/campaigns')) return Response.json({ data: [{ id: '201', name: 'Prospecting', effective_status: 'ACTIVE', daily_budget: '6000' }] });
      if (u.pathname.endsWith('/insights') && u.searchParams.get('level') === 'campaign' && u.searchParams.get('time_range')!.includes('2026-10-2')) {
        return Response.json({ data: [{ campaign_id: '201', campaign_name: 'Prospecting', date_start: '2026-10-26', spend: '10.00', attribution_setting: '1d_click', actions: [], action_values: [{ action_type: 'omni_purchase', value: '30' }] }] });
      }
      return Response.json({ data: [] });
    }) as typeof fetch;
    await syncMeta(db, key, 'pawsome', fetchFn, NOW);
    expect(asked.find((u) => u.searchParams.get('level') === 'campaign')!.searchParams.get('fields')).toContain('attribution_setting');
    expect(notes(db, 'meta_ads:pawsome')).toEqual({
      ad_spend: ['available', "Account currency EUR, converted into USD at each day's ECB rate"],
      attribution: ['available', '7-day click or 1-day view (the Insights API default); the ad sets are set to 1d_click, which Ads Manager uses'],
    });
    expect(adMetrics(db, 'pawsome', '2026-10-20', '2026-10-26').networks[0]).toMatchObject({
      spend: 11.7, // €10 at that day's 1.17
      attribution: "Meta's own attribution · 7-day click or 1-day view (the Insights API default); the ad sets are set to 1d_click, which Ads Manager uses",
    });
    expect(metaAttribution([{ campaign_id: '1', campaign_name: 'x', date_start: '2026-10-26', attribution_setting: '7d_click_1d_view' }])).toBe('7-day click or 1-day view (the Insights API default)');
  });

  it('Google Ads: the conversion actions in metrics.conversions with their model and lookback windows', async () => {
    const db = store();
    saveIntegration(db, key, { kind: 'google_ads', storeId: 'glow', values: { customerId: '123-456-7890', clientId: 'cid.apps.googleusercontent.com', clientSecret: 'not-a-real-secret', developerToken: 'not-a-real-token', refreshToken: '1//not-a-real-token' } });
    const queries: string[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'ya29.not-a-real-token' });
      const { query } = JSON.parse(String(init.body)) as { query: string };
      queries.push(query);
      if (query.includes('FROM conversion_action')) {
        return Response.json({
          results: [
            { conversionAction: { resourceName: 'customers/1234567890/conversionActions/11', name: 'Purchase', attributionModelSettings: { attributionModel: 'GOOGLE_SEARCH_ATTRIBUTION_DATA_DRIVEN' }, clickThroughLookbackWindowDays: '30', viewThroughLookbackWindowDays: '1' } },
            { conversionAction: { resourceName: 'customers/1234567890/conversionActions/12', name: 'Shopify checkout', attributionModelSettings: { attributionModel: 'GOOGLE_ADS_LAST_CLICK' }, clickThroughLookbackWindowDays: '7', viewThroughLookbackWindowDays: '1' } },
          ],
        });
      }
      if (query.includes('FROM ad_group_ad')) return Response.json({ results: [] });
      if (!query.includes('segments.date')) return Response.json({ results: [{ campaign: { id: '301', name: 'Search - Brand', status: 'ENABLED' }, campaignBudget: { amountMicros: '25000000' }, customer: { currencyCode: 'USD', timeZone: 'America/Phoenix' } }] });
      return Response.json({ results: [{ campaign: { id: '301' }, segments: { date: '2026-10-25' }, metrics: { costMicros: '12340000', conversions: 2, conversionsValue: 130.5, clicks: '40', impressions: '900' } }] });
    }) as typeof fetch;
    await syncGoogleAds(db, key, 'glow', fetchFn, NOW);
    expect(queries.find((q) => q.includes('FROM conversion_action'))).toContain("conversion_action.include_in_conversions_metric = TRUE");
    expect(notes(db, 'google_ads:glow')).toEqual({
      ad_spend: ['available', "Account currency USD, the store's"],
      attribution: ['available', 'Conversion actions: Purchase (data-driven, 30-day click, 1-day view); Shopify checkout (last-click, 7-day click, 1-day view)'],
    });
    expect(googleAttribution([])).toBeUndefined();
  });

  it("TikTok Ads: each ad group's windows as sent; a refused ad group read leaves the setting unrecorded, never guessed", async () => {
    const run = async (groups: unknown) => {
      const db = store();
      saveIntegration(db, key, { kind: 'tiktok_ads', storeId: 'glow', values: { advertiserId: '7000000001', accessToken: 'tt_not-a-real-token' } });
      const one = (list: unknown[] = []) => Response.json({ code: 0, message: 'OK', data: { list, page_info: { page: 1, total_page: 1 } } });
      const fetchFn = (async (url: string) => {
        const u = new URL(url);
        if (u.pathname.endsWith('/advertiser/info/')) return Response.json({ code: 0, message: 'OK', data: { list: [{ advertiser_id: '7000000001', currency: 'USD', timezone: 'Etc/GMT+7', display_timezone: 'America/Phoenix' }] } });
        if (u.pathname.endsWith('/campaign/get/')) return one([{ campaign_id: '401', campaign_name: 'Spark - UGC', operation_status: 'ENABLE', budget: 80, budget_mode: 'BUDGET_MODE_DAY' }]);
        if (u.pathname.endsWith('/adgroup/get/')) return groups ? one(groups as unknown[]) : Response.json({ code: 40002, message: 'Invalid field: click_attribution_window', data: {} });
        return one([]);
      }) as typeof fetch;
      await syncTikTokAds(db, key, 'glow', fetchFn, NOW);
      return notes(db, 'tiktok_ads:glow');
    };
    expect(await run([{ adgroup_id: '501', click_attribution_window: 'SEVEN_DAYS', view_attribution_window: 'ONE_DAY' }, { adgroup_id: '502', click_attribution_window: 'SEVEN_DAYS', view_attribution_window: 'ONE_DAY' }])).toEqual({
      ad_spend: ['available', "Account currency USD, the store's"],
      attribution: ['available', 'Ad groups: click seven days, view one day'],
    });
    expect((await run(null)).attribution).toEqual(['partial', "The attribution setting couldn't be read"]);
  });
});
