import { randomBytes } from 'node:crypto';
import { expect, test } from 'vitest';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { saveIntegration } from '../integrations';
import { listActions } from '../actions';
import { pauseCampaign, setCampaignBudget } from './ads';

const key = randomBytes(32);
const IDS = { meta: '120210000000001', google: '987654', tiktok: '1780000000000' } as const;

function setup({ sharedBudget = false, metaError = '', metaCurrency = 'USD', adCurrency = 'USD' } = {}) {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  saveIntegration(db, key, { kind: 'meta_ads', storeId: 'glow', values: { adAccountId: 'act_1', accessToken: 'meta-token' } });
  saveIntegration(db, key, { kind: 'google_ads', storeId: 'glow', values: { customerId: '123-456-7890', clientId: 'cid', clientSecret: 'cs', developerToken: 'dev', refreshToken: 'rt' } });
  saveIntegration(db, key, { kind: 'tiktok_ads', storeId: 'glow', values: { advertiserId: '7001', accessToken: 'tt-token' } });
  const camp = db.prepare("INSERT INTO campaigns (network, id, store_id, name, status, daily_budget) VALUES (?, ?, 'glow', 'Test', 'active', 50)");
  for (const [network, id] of Object.entries(IDS)) camp.run(network, id);

  const calls: { url: string; headers: Headers; body: string }[] = [];
  const fetchFn = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, headers: new Headers(init.headers), body: String(init.body ?? '') });
    if (url.endsWith('?fields=currency')) return Response.json({ id: 'act_1', currency: metaCurrency });
    if (url.startsWith('https://graph.facebook.com/')) return metaError ? Response.json({ error: { message: 'x', error_user_msg: metaError } }, { status: 400 }) : Response.json({ success: true });
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'g-access' });
    if (url.endsWith('googleAds:search')) return Response.json({ results: [{ campaign: { campaignBudget: 'customers/1234567890/campaignBudgets/555' }, campaignBudget: { explicitlyShared: sharedBudget }, customer: { currencyCode: adCurrency } }] });
    if (url.includes('/advertiser/info/')) return Response.json({ code: 0, message: 'OK', data: { list: [{ advertiser_id: '7001', currency: adCurrency }] } });
    if (url.endsWith(':mutate')) return Response.json({ results: [{}] });
    return Response.json({ code: 0, message: 'OK', data: {} });
  }) as typeof fetch;
  return { db, calls, fetchFn };
}

test('budget and pause writes per network', async () => {
  const { db, calls, fetchFn } = setup();
  await setCampaignBudget(db, key, 'glow', 'meta', IDS.meta, 45.5, fetchFn);
  await pauseCampaign(db, key, 'glow', 'meta', IDS.meta, fetchFn);
  expect(calls.map((c) => [c.url, c.headers.get('authorization'), c.body])).toEqual([
    ['https://graph.facebook.com/v24.0/act_1?fields=currency', 'Bearer meta-token', ''],
    ['https://graph.facebook.com/v24.0/120210000000001', 'Bearer meta-token', 'daily_budget=4550'],
    ['https://graph.facebook.com/v24.0/120210000000001', 'Bearer meta-token', 'status=PAUSED'],
  ]);

  calls.length = 0;
  await setCampaignBudget(db, key, 'glow', 'google', IDS.google, 45.5, fetchFn);
  await pauseCampaign(db, key, 'glow', 'google', IDS.google, fetchFn);
  const google = calls.filter((c) => c.url.startsWith('https://googleads'));
  expect(google.map((c) => c.url.split('/v26/')[1])).toEqual(['customers/1234567890/googleAds:search', 'customers/1234567890/campaignBudgets:mutate', 'customers/1234567890/campaigns:mutate']);
  expect(JSON.parse(google[0]!.body).query).toContain('WHERE campaign.id = 987654');
  expect(JSON.parse(google[1]!.body)).toEqual({ operations: [{ update: { resourceName: 'customers/1234567890/campaignBudgets/555', amountMicros: '45500000' }, updateMask: 'amount_micros' }] });
  expect(JSON.parse(google[2]!.body)).toEqual({ operations: [{ update: { resourceName: 'customers/1234567890/campaigns/987654', status: 'PAUSED' }, updateMask: 'status' }] });
  expect(google.every((c) => c.headers.get('developer-token') === 'dev' && c.headers.get('authorization') === 'Bearer g-access')).toBe(true);

  calls.length = 0;
  await setCampaignBudget(db, key, 'glow', 'tiktok', IDS.tiktok, 45.5, fetchFn);
  await pauseCampaign(db, key, 'glow', 'tiktok', IDS.tiktok, fetchFn);
  expect(calls.map((c) => [c.url.split('/v1.3')[1], c.headers.get('access-token'), c.body && JSON.parse(c.body)])).toEqual([
    ['/advertiser/info/?advertiser_ids=%5B%227001%22%5D&fields=%5B%22currency%22%5D', 'tt-token', ''],
    ['/campaign/update/', 'tt-token', { advertiser_id: '7001', campaign_id: IDS.tiktok, budget: 45.5 }],
    ['/campaign/status/update/', 'tt-token', { advertiser_id: '7001', campaign_ids: [IDS.tiktok], operation_status: 'DISABLE' }],
  ]);
  expect(listActions(db, ['glow'], 10).map((a) => [a.action, a.target, a.detail, a.ok])[0]).toEqual(['ad_pause', `tiktok:${IDS.tiktok}`, { status: 'PAUSED' }, true]);
  expect(listActions(db, ['glow'], 10)).toHaveLength(6);
});

test('ad writes refuse unknown campaigns, bad budgets, shared Google budgets and surface network errors', async () => {
  const { db, calls, fetchFn } = setup({ sharedBudget: true, metaError: 'Budget is too low for this campaign' });
  await expect(pauseCampaign(db, key, 'pawsome', 'meta', IDS.meta, fetchFn)).rejects.toThrow('No meta campaign 120210000000001 in this store');
  await expect(pauseCampaign(db, key, 'glow', 'meta', '../act_1/campaigns', fetchFn)).rejects.toThrow('No meta campaign');
  await expect(setCampaignBudget(db, key, 'glow', 'meta', IDS.meta, 0, fetchFn)).rejects.toThrow('at least 1');
  await expect(setCampaignBudget(db, key, 'glow', 'meta', IDS.meta, Number.NaN, fetchFn)).rejects.toThrow('at least 1');
  expect(calls).toHaveLength(0);

  expect(listActions(db, ['glow', 'pawsome'], 10)).toEqual([]); // refused before reaching the network: nothing ran
  await expect(setCampaignBudget(db, key, 'glow', 'meta', IDS.meta, 5, fetchFn)).rejects.toThrow('Meta: Budget is too low for this campaign');
  expect(listActions(db, ['glow'], 1)[0]).toMatchObject({ action: 'ad_budget', detail: { dailyBudget: 5 }, ok: false, error: 'Meta: Budget is too low for this campaign' });
  await expect(setCampaignBudget(db, key, 'glow', 'google', IDS.google, 5, fetchFn)).rejects.toThrow('shared budget');
  expect(calls.some((c) => c.url.endsWith('campaignBudgets:mutate'))).toBe(false);
  // Demo campaigns exist locally but the store has no Meta connection.
  await expect(pauseCampaign(db, key, 'peak', 'meta', 'peak-c1', fetchFn)).rejects.toThrow('Meta Ads is not connected for this store');
});

test('Meta budgets in a currency without cents (yen) are whole units, not hundredths', async () => {
  const { db, calls, fetchFn } = setup({ metaCurrency: 'JPY' });
  db.prepare("UPDATE stores SET currency = 'JPY' WHERE id = 'glow'").run();
  await setCampaignBudget(db, key, 'glow', 'meta', IDS.meta, 7200, fetchFn);
  expect(calls.map((c) => c.body)).toEqual(['', 'daily_budget=7200']);
});

test('Google Ads through a manager account sends its id as login-customer-id', async () => {
  const { db, calls, fetchFn } = setup();
  saveIntegration(db, key, { kind: 'google_ads', storeId: 'glow', values: { customerId: '123-456-7890', managerId: '999-888-7777', clientId: 'cid', clientSecret: 'cs', developerToken: 'dev', refreshToken: 'rt' } });
  await pauseCampaign(db, key, 'glow', 'google', IDS.google, fetchFn);
  expect(calls.filter((c) => c.url.startsWith('https://googleads')).map((c) => c.headers.get('login-customer-id'))).toEqual(['9998887777']);
});

test("a Meta budget in the store's currency is converted to the ad account's before it's written", async () => {
  const { db, calls, fetchFn } = setup();
  db.prepare("UPDATE stores SET currency = 'EUR' WHERE id = 'glow'").run();
  db.prepare("INSERT INTO settings (key, value_json) VALUES ('fx', ?)").run(JSON.stringify({ date: '2026-10-26', fetchedAt: new Date().toISOString(), rates: { EUR: 1, USD: 1.25 } }));
  await setCampaignBudget(db, key, 'glow', 'meta', IDS.meta, 72, fetchFn); // 72 EUR = 90 USD
  expect(calls.map((c) => c.body)).toEqual(['', 'daily_budget=9000']);
});

test('Google and TikTok budgets in the store currency are converted to the ad account currency (yen in whole units)', async () => {
  const { db, calls, fetchFn } = setup({ adCurrency: 'JPY' });
  db.prepare("UPDATE stores SET currency = 'EUR' WHERE id = 'glow'").run();
  db.prepare("INSERT INTO settings (key, value_json) VALUES ('fx', ?)").run(JSON.stringify({ date: '2026-10-26', fetchedAt: new Date().toISOString(), rates: { EUR: 1, USD: 1.25, JPY: 160 } }));
  await setCampaignBudget(db, key, 'glow', 'google', IDS.google, 72.13, fetchFn); // 11540.8 JPY
  const mutate = calls.find((c) => c.url.endsWith('campaignBudgets:mutate'))!;
  expect(JSON.parse(mutate.body).operations[0].update.amountMicros).toBe('11541000000');
  await setCampaignBudget(db, key, 'glow', 'tiktok', IDS.tiktok, 50, fetchFn);
  expect(JSON.parse(calls.find((c) => c.url.endsWith('/campaign/update/'))!.body).budget).toBe(8000);
});
