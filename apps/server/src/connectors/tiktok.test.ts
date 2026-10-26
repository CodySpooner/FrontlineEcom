import { randomBytes } from 'node:crypto';
import { expect, test } from 'vitest';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { saveIntegration } from '../integrations';
import { syncTikTokAds } from './tiktok';

const key = randomBytes(32);
const TOKEN = 'tt_fixture_token';
const NOW = new Date('2026-10-26T18:00:00Z');

const report = (campaign_id: string, day: string, spend: string, roas: string) => ({
  dimensions: { campaign_id, stat_time_day: `${day} 00:00:00` },
  metrics: { spend, impressions: '2000', clicks: '55', complete_payment: '3', complete_payment_roas: roas },
});

/** Fake Marketing API: campaign list + daily report (the first report request has two pages). */
function fakeTikTok(error?: { code: number; message: string }) {
  const calls: URL[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    const u = new URL(url);
    calls.push(u);
    expect(new Headers(init.headers).get('access-token')).toBe(TOKEN);
    if (error) return Response.json({ ...error, data: {} });
    const page = Number(u.searchParams.get('page'));
    if (u.pathname.endsWith('/campaign/get/')) return Response.json({ code: 0, message: 'OK', data: { list: [{ campaign_id: '401', campaign_name: 'Spark - UGC', operation_status: 'ENABLE', budget: 80, budget_mode: 'BUDGET_MODE_DAY' }], page_info: { page: 1, total_page: 1 } } });
    const first = calls.filter((c) => c.pathname.endsWith('/report/integrated/get/')).length <= 2;
    const list = !first ? [] : page === 1 ? [report('401', '2026-10-25', '40.00', '2.5')] : [report('499', '2026-10-25', '10.00', '-')];
    return Response.json({ code: 0, message: 'OK', data: { list, page_info: { page, total_page: first ? 2 : 1 } } });
  }) as typeof fetch;
  return { fetchFn, calls };
}

const setup = () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  saveIntegration(db, key, { kind: 'tiktok_ads', storeId: 'glow', values: { advertiserId: '7000000001', accessToken: TOKEN } });
  return db;
};

test('TikTok Ads backfills in 30-day chunks, pages, stores campaigns + daily rows and feeds ad_spend', async () => {
  const db = setup();
  const { fetchFn, calls } = fakeTikTok();
  await syncTikTokAds(db, key, 'glow', fetchFn, NOW);

  const reports = calls.filter((c) => c.pathname.endsWith('/report/integrated/get/'));
  expect(reports[0]!.searchParams.get('start_date')).toBe('2024-10-27');
  expect(reports[0]!.searchParams.get('end_date')).toBe('2024-11-25');
  expect(reports.at(-1)!.searchParams.get('end_date')).toBe('2026-10-26');
  expect(reports[0]!.searchParams.get('data_level')).toBe('AUCTION_CAMPAIGN');

  expect(db.prepare("SELECT id, name, status, daily_budget FROM campaigns WHERE store_id = 'glow' AND network = 'tiktok' ORDER BY id").all()).toEqual([
    { id: '401', name: 'Spark - UGC', status: 'active', daily_budget: 80 },
    { id: '499', name: 'Campaign 499', status: 'archived', daily_budget: 0 },
  ]);
  expect(db.prepare("SELECT spend, revenue, purchases, clicks FROM campaign_daily WHERE network = 'tiktok' AND campaign_id = '401'").get()).toEqual({ spend: 40, revenue: 100, purchases: 3, clicks: 55 });
  expect(db.prepare("SELECT revenue FROM campaign_daily WHERE network = 'tiktok' AND campaign_id = '499'").get()).toEqual({ revenue: 0 });
  expect(db.prepare("SELECT ad_spend FROM daily_metrics WHERE store_id = 'glow' AND date = '2026-10-25'").get()).toEqual({ ad_spend: 50 });

  const again = fakeTikTok();
  await syncTikTokAds(db, key, 'glow', again.fetchFn, NOW);
  expect(again.calls[0]!.searchParams.get('start_date')).toBe('2026-09-28');
});

test('a bad token shows on the integration without leaking it, and keeps demo data', async () => {
  const db = setup();
  await syncTikTokAds(db, key, 'glow', fakeTikTok({ code: 40105, message: 'Access token is invalid' }).fetchFn, NOW);
  const row = db.prepare("SELECT status, error FROM integrations WHERE id = 'tiktok_ads:glow'").get();
  expect(row).toEqual({ status: 'error', error: expect.stringContaining('TikTok rejected the access token') });
  expect(JSON.stringify(row)).not.toContain(TOKEN);
  expect(db.prepare("SELECT demo FROM stores WHERE id = 'glow'").get()).toEqual({ demo: 1 });

  await syncTikTokAds(db, key, 'glow', fakeTikTok({ code: 40002, message: 'advertiser_id: Advertiser does not exist' }).fetchFn, NOW);
  expect(db.prepare("SELECT error FROM integrations WHERE id = 'tiktok_ads:glow'").get()).toEqual({ error: 'TikTok Ads: advertiser_id: Advertiser does not exist' });
});
