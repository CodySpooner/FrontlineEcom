import { createHash, randomBytes } from 'node:crypto';
import { expect, test } from 'vitest';
import type { Integration, OAuthStart } from '@frontline/shared';
import { openDb } from './db';
import { seedDemo } from './demo';
import { getCredentials } from './integrations';
import { oauthRoutes, PASTE_REDIRECT } from './oauth';

const key = randomBytes(32);
const post = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

function setup() {
  const db = openDb();
  seedDemo(db);
  const calls: { url: string; form: Record<string, string> }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, form: Object.fromEntries(new URLSearchParams(String(init.body))) });
    if (url.includes('googleapis')) return Response.json({ access_token: 'ya29.x', refresh_token: '1//google-refresh', expires_in: 3599 });
    return Response.json({ access_token: '12345.etsy-access', refresh_token: '12345.etsy-refresh', expires_in: 3600, token_type: 'Bearer' });
  }) as typeof fetch;
  return { db, calls, app: oauthRoutes(db, () => key, fetchFn) };
}

test('Google Ads: Connect sends the owner to consent with PKCE, the loopback callback saves the refresh token', async () => {
  const { db, calls, app } = setup();
  const values = { customerId: '123-456-7890', clientId: 'cid.apps.googleusercontent.com', clientSecret: 'g-secret', developerToken: 'dev-token' };
  const start = (await (await app.request('http://127.0.0.1:8787/api/integrations/oauth/start', post({ kind: 'google_ads', storeId: 'glow', values }))).json()) as OAuthStart;
  expect(start).toMatchObject({ finish: 'loopback', redirectUri: 'http://127.0.0.1:8787/api/oauth/callback' });
  const q = new URL(start.url).searchParams;
  expect(Object.fromEntries(q)).toMatchObject({ client_id: values.clientId, redirect_uri: start.redirectUri, scope: 'https://www.googleapis.com/auth/adwords', access_type: 'offline', prompt: 'consent', code_challenge_method: 'S256' });

  const page = await app.request(`http://127.0.0.1:8787/api/oauth/callback?code=4/abc&state=${q.get('state')}`);
  expect(page.status).toBe(200);
  expect(await page.text()).toContain('Google Ads is connected');
  const form = calls[0]!.form;
  expect(form).toMatchObject({ grant_type: 'authorization_code', code: '4/abc', client_id: values.clientId, client_secret: 'g-secret', redirect_uri: start.redirectUri });
  expect(createHash('sha256').update(form.code_verifier!).digest('base64url')).toBe(q.get('code_challenge'));
  expect(getCredentials(db, key, 'google_ads', 'glow')).toEqual({ ...values, refreshToken: '1//google-refresh' });

  // A state works once.
  const replay = await app.request(`http://127.0.0.1:8787/api/oauth/callback?code=4/abc&state=${q.get('state')}`);
  expect(replay.status).toBe(400);
  expect(await replay.text()).toContain('expired or was already used');
});

test('Etsy: the owner pastes the https address they land on; tokens and expiry are stored', async () => {
  const { db, calls, app } = setup();
  const values = { shopId: '987', apiKey: 'keystring', sharedSecret: 'shh' };
  const start = (await (await app.request('/api/integrations/oauth/start', post({ kind: 'etsy', storeId: 'pawsome', values }))).json()) as OAuthStart;
  expect(start).toMatchObject({ finish: 'paste', redirectUri: PASTE_REDIRECT });
  const state = new URL(start.url).searchParams.get('state');
  expect(new URL(start.url).searchParams.get('scope')).toBe('transactions_r listings_r');

  const saved = (await (await app.request('/api/integrations/oauth/finish', post({ url: ` ${PASTE_REDIRECT}?code=etsy-code&state=${state} ` }))).json()) as Integration;
  expect(saved).toMatchObject({ id: 'etsy:pawsome', status: 'connected', settings: { shopId: '987' } });
  expect(calls[0]).toMatchObject({ url: 'https://api.etsy.com/v3/public/oauth/token', form: { grant_type: 'authorization_code', client_id: 'keystring', redirect_uri: PASTE_REDIRECT, code: 'etsy-code' } });
  expect(getCredentials(db, key, 'etsy', 'pawsome')).toMatchObject({ accessToken: '12345.etsy-access', refreshToken: '12345.etsy-refresh', accessTokenExpiresAt: expect.stringMatching(/^\d+$/) });
});

test('Connect validates input, reports a cancelled consent and escapes provider text', async () => {
  const { app } = setup();
  const bad = async (body: unknown) => ((await (await app.request('/api/integrations/oauth/start', post(body))).json()) as { error: string }).error;
  expect(await bad({ kind: 'meta_ads', storeId: 'glow', values: {} })).toContain('Connect works for google_ads, etsy');
  expect(await bad({ kind: 'google_ads', storeId: 'nope', values: {} })).toContain('existing storeId');
  expect(await bad({ kind: 'google_ads', storeId: 'glow', values: { customerId: '1', clientId: 'c', developerToken: 'd' } })).toBe('OAuth client secret is required');

  const start = (await (await app.request('/api/integrations/oauth/start', post({ kind: 'google_ads', storeId: 'glow', values: { customerId: '1', clientId: 'c', clientSecret: 's', developerToken: 'd' } }))).json()) as OAuthStart;
  const state = new URL(start.url).searchParams.get('state');
  const page = await (await app.request(`/api/oauth/callback?error=access_denied&error_description=${encodeURIComponent('<script>x()</script>')}&state=${state}`)).text();
  expect(page).toContain('Sign-in was cancelled');
  expect(page).not.toContain('<script>');
  expect((await app.request('/api/integrations/oauth/finish', post({ url: 'not a url' }))).status).toBe(400);
});

test('TikTok Shop: Connect uses the Partner Center link (any market host) and exchanges the pasted code', async () => {
  const db = openDb();
  seedDemo(db);
  const urls: URL[] = [];
  const fetchFn = (async (url: string) => {
    urls.push(new URL(url));
    return Response.json({ code: 0, message: 'success', data: { access_token: 'ROW_access', access_token_expire_in: 1793000000, refresh_token: 'ROW_refresh', refresh_token_expire_in: 1800000000 } });
  }) as typeof fetch;
  const app = oauthRoutes(db, () => key, fetchFn);
  const start = async (authLink: string) => (await app.request('/api/integrations/oauth/start', post({ kind: 'tiktok_shop', storeId: 'glow', values: { appKey: 'ak', appSecret: 'as', authLink } }))).json();

  expect(((await start('https://services.tiktokshop.com.evil.io/open/authorize?service_id=1')) as { error: string }).error).toContain('Authorization link must be');
  expect(((await start('http://services.tiktokshop.com/open/authorize?service_id=1')) as { error: string }).error).toContain('Authorization link must be');
  const ok = (await start('https://services.us.tiktokshop.com/open/authorize?service_id=7123')) as OAuthStart;
  const auth = new URL(ok.url);
  expect([auth.host, auth.searchParams.get('service_id'), ok.finish]).toEqual(['services.us.tiktokshop.com', '7123', 'paste']);

  const saved = (await (await app.request('/api/integrations/oauth/finish', post({ url: `${PASTE_REDIRECT}?code=tt-code&state=${auth.searchParams.get('state')}` }))).json()) as Integration;
  expect(saved).toMatchObject({ id: 'tiktok_shop:glow', status: 'connected', settings: { appKey: 'ak', authLink: ok.url.replace(/&state=[^&]+/, '') } });
  expect(Object.fromEntries(urls[0]!.searchParams)).toEqual({ app_key: 'ak', app_secret: 'as', auth_code: 'tt-code', grant_type: 'authorized_code' });
  expect(getCredentials(db, key, 'tiktok_shop', 'glow')).toMatchObject({ accessToken: 'ROW_access', refreshToken: 'ROW_refresh', accessTokenExpiresAt: '1793000000' });
});
