import { generateKeyPairSync, randomBytes, verify } from 'node:crypto';
import { expect, test } from 'vitest';
import type { Integration } from '@frontline/shared';
import { createApp } from '../app';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { saveIntegration } from '../integrations';
import { googleId, serviceAccountJwt, syncGa4, syncGoogleAds } from './google';

const key = randomBytes(32);
const NOW = new Date('2026-10-26T18:00:00Z');
const REFRESH = '1//refresh_fixture';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = JSON.stringify({ client_email: 'frontline@proj.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });

type Call = { url: string; headers: Headers; body: string };
/** Fake Google: token endpoint, Ads search (metrics paged once), GA4 runReport. */
function fakeGoogle(opts: { tokenError?: unknown; adsError?: unknown; currency?: string } = {}) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    const body = String(init.body);
    calls.push({ url, headers: new Headers(init.headers), body });
    if (url === 'https://oauth2.googleapis.com/token') return opts.tokenError ? Response.json(opts.tokenError, { status: 400 }) : Response.json({ access_token: 'ya29.fixture' });
    if (url.includes('googleads')) {
      if (opts.adsError) return Response.json(opts.adsError, { status: 403 });
      const { query, pageToken } = JSON.parse(body);
      if (!query.includes('segments.date')) return Response.json({ results: [{ campaign: { id: '301', name: 'Search - Brand', status: 'ENABLED' }, campaignBudget: { amountMicros: '25000000' }, customer: { currencyCode: opts.currency ?? 'USD' } }, { campaign: { id: '302', name: 'PMax', status: 'REMOVED' } }] });
      const row = (id: string, date: string, cost: string) => ({ campaign: { id }, segments: { date }, metrics: { costMicros: cost, conversions: 2.6, conversionsValue: 130.5, clicks: '40', impressions: '900' } });
      return pageToken
        ? Response.json({ results: [row('302', '2026-10-25', '5000000')] })
        : Response.json({ results: [row('301', '2026-10-25', '12340000'), row('301', '2026-10-26', '10000000')], nextPageToken: 'p2' });
    }
    return Response.json({ rows: [{ dimensionValues: [{ value: '20261025' }], metricValues: [{ value: '1200' }, { value: '96' }, { value: '41' }] }] });
  }) as typeof fetch;
  return { fetchFn, calls };
}

const setup = () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  saveIntegration(db, key, { kind: 'google_ads', storeId: 'glow', values: { customerId: '123-456-7890', clientId: 'cid.apps.googleusercontent.com', clientSecret: 'csecret', developerToken: 'devtoken', refreshToken: REFRESH } });
  saveIntegration(db, key, { kind: 'ga4', storeId: 'glow', values: { propertyId: 'properties/987654', serviceAccountJson: SA } });
  return { db, app: createApp(db, key) };
};

test('ids and the service-account JWT', () => {
  expect(googleId('123-456-7890', 'Customer ID', 'x')).toBe('1234567890');
  expect(googleId(' properties/987 ', 'Property ID', 'x')).toBe('987');
  expect(() => googleId('act_1', 'Customer ID', '123-456-7890')).toThrow('Customer ID must look like 123-456-7890');

  const [head, claims, sig] = serviceAccountJwt(SA, NOW).split('.') as [string, string, string];
  expect(verify('RSA-SHA256', Buffer.from(`${head}.${claims}`), publicKey, Buffer.from(sig, 'base64url'))).toBe(true);
  expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toEqual({
    iss: 'frontline@proj.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/analytics.readonly', aud: 'https://oauth2.googleapis.com/token', iat: 1793037600, exp: 1793041200,
  });
  expect(() => serviceAccountJwt('{oops', NOW)).toThrow('not valid JSON');
});

test('Google Ads sync stores campaigns + daily metrics and feeds ad_spend; later syncs re-pull 30 days', async () => {
  const { db } = setup();
  const { fetchFn, calls } = fakeGoogle();
  await syncGoogleAds(db, key, 'glow', fetchFn, NOW);

  expect(new URLSearchParams(calls[0]!.body).get('refresh_token')).toBe(REFRESH);
  const search = calls.filter((c) => c.url.includes('googleads'));
  expect(search[0]!.url).toBe('https://googleads.googleapis.com/v26/customers/1234567890/googleAds:search');
  expect(search[0]!.headers.get('developer-token')).toBe('devtoken');
  expect(search[0]!.headers.get('authorization')).toBe('Bearer ya29.fixture');
  expect(JSON.parse(search[0]!.body).query).toContain("BETWEEN '2024-10-27' AND '2026-10-26'");

  expect(db.prepare("SELECT id, name, status, daily_budget FROM campaigns WHERE store_id = 'glow' ORDER BY id").all()).toEqual([
    { id: '301', name: 'Search - Brand', status: 'active', daily_budget: 25 },
    { id: '302', name: 'PMax', status: 'archived', daily_budget: 0 },
  ]);
  expect(db.prepare("SELECT spend, revenue, purchases FROM campaign_daily WHERE campaign_id = '301' AND date = '2026-10-25'").get()).toEqual({ spend: 12.34, revenue: 130.5, purchases: 3 });
  expect(db.prepare("SELECT ad_spend FROM daily_metrics WHERE store_id = 'glow' AND date = '2026-10-25'").get()).toEqual({ ad_spend: 17.34 });

  const again = fakeGoogle();
  await syncGoogleAds(db, key, 'glow', again.fetchFn, NOW);
  expect(JSON.parse(again.calls.find((c) => c.url.includes('googleads'))!.body).query).toContain("BETWEEN '2026-09-26' AND '2026-10-26'");
});

test('GA4 sync writes the funnel without touching revenue or ad spend', async () => {
  const { db } = setup();
  await syncGoogleAds(db, key, 'glow', fakeGoogle().fetchFn, NOW);
  db.prepare("UPDATE daily_metrics SET revenue = 999 WHERE store_id = 'glow' AND date = '2026-10-25'").run();
  const { fetchFn, calls } = fakeGoogle();
  await syncGa4(db, key, 'glow', fetchFn, NOW);

  const grant = new URLSearchParams(calls[0]!.body);
  expect(grant.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
  expect(calls[1]!.url).toBe('https://analyticsdata.googleapis.com/v1beta/properties/987654:runReport');
  expect(db.prepare("SELECT revenue, ad_spend, sessions, add_to_carts, checkouts FROM daily_metrics WHERE store_id = 'glow' AND date = '2026-10-25'").get()).toEqual({
    revenue: 999, ad_spend: 17.34, sessions: 1200, add_to_carts: 96, checkouts: 41,
  });
});

test('auth and API errors show on the integration without leaking secrets, and keep demo data', async () => {
  const { db, app } = setup();
  await syncGoogleAds(db, key, 'glow', fakeGoogle({ tokenError: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } }).fetchFn, NOW);
  await syncGa4(db, key, 'glow', fakeGoogle({ tokenError: { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' } }).fetchFn, NOW);
  const listed = await (await app.request('/api/integrations?stores=glow')).text();
  expect(listed).not.toContain(REFRESH);
  expect(listed).not.toContain('PRIVATE KEY');
  const byKind = Object.fromEntries((JSON.parse(listed) as Integration[]).map((i) => [i.kind, i.error]));
  expect(byKind).toEqual({ google_ads: 'Google sign-in failed: Token has been expired or revoked.', ga4: 'Google Analytics sign-in failed: Invalid JWT Signature.' });
  expect(db.prepare("SELECT demo FROM stores WHERE id = 'glow'").get()).toEqual({ demo: 1 });

  await syncGoogleAds(db, key, 'glow', fakeGoogle({ adsError: { error: { message: 'The caller does not have permission', details: [{ errors: [{ message: 'User doesn\'t have permission to access customer.' }] }] } } }).fetchFn, NOW);
  expect(db.prepare("SELECT error FROM integrations WHERE id = 'google_ads:glow'").get()).toEqual({ error: "Google Ads: User doesn't have permission to access customer." });
});

test('a USD Google Ads account on a euro store: cost, conversion value and budgets are converted into euros', async () => {
  const { db } = setup();
  db.prepare("UPDATE stores SET currency = 'EUR' WHERE id = 'glow'").run();
  db.prepare("INSERT INTO settings (key, value_json) VALUES ('fx', ?)").run(JSON.stringify({ date: '2026-10-26', fetchedAt: new Date().toISOString(), rates: { EUR: 1, USD: 1.25, JPY: 160 } }));
  await syncGoogleAds(db, key, 'glow', fakeGoogle().fetchFn, NOW);
  expect({ ...db.prepare("SELECT spend, revenue FROM campaign_daily WHERE network = 'google' AND campaign_id = '301' AND date = '2026-10-26'").get() }).toEqual({ spend: 8, revenue: 104.4 });
  expect(db.prepare("SELECT daily_budget AS b FROM campaigns WHERE network = 'google' AND id = '301'").get()?.b).toBe(20);
});
