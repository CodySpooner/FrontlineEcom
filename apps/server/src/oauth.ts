import { createHash, randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { INTEGRATION_KINDS, type IntegrationKind, type OAuthStart } from '@frontline/shared';
import type { Db } from './db';
import { saveIntegration, updateSecrets } from './integrations';
import { getStore } from './stores';

// "Connect" buttons: the owner enters the app credentials, consents in the browser, and the tokens are saved for them.
// Google sends the browser back to this API (loopback). Etsy only redirects to https://, which a local app can't serve,
// so the owner pastes the address the browser lands on (it carries the code) into POST /api/integrations/oauth/finish.
// TikTok Shop works the same way, with the redirect URL set in Partner Center.

type Fetch = typeof fetch;
type Values = Record<string, string>;
interface Provider {
  /** 'loopback' = this API's /api/oauth/callback; otherwise the fixed https:// address the owner registers. */
  redirect: 'loopback' | string;
  /** Extra checks on the entered values; returns a message for the owner. */
  validate?(values: Values): string | undefined;
  authorizeUrl(p: { values: Values; redirectUri: string; state: string; challenge: string }): string;
  /** Returns the token fields to store; extra keys (e.g. accessTokenExpiresAt) go to the secrets, not the form. */
  exchange(p: { values: Values; redirectUri: string; code: string; verifier: string }, fetchFn: Fetch, now: Date): Promise<Values>;
}

export const PASTE_REDIRECT = 'https://localhost/frontline-oauth';

async function tokenPost(url: string, form: Values, fetchFn: Fetch, name: string) {
  const res = await fetchFn(url, { method: 'POST', body: new URLSearchParams(form) });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !body.refresh_token) throw new Error(`${name} sign-in failed: ${body.error_description ?? body.error ?? `HTTP ${res.status}`}`);
  return body;
}

const PROVIDERS: Partial<Record<IntegrationKind, Provider>> = {
  google_ads: {
    redirect: 'loopback',
    authorizeUrl: ({ values, redirectUri, state, challenge }) =>
      `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
        client_id: values.clientId!, redirect_uri: redirectUri, response_type: 'code', scope: 'https://www.googleapis.com/auth/adwords',
        // offline + consent: Google only returns a refresh token on a fresh consent.
        access_type: 'offline', prompt: 'consent', state, code_challenge: challenge, code_challenge_method: 'S256',
      })}`,
    exchange: async ({ values, redirectUri, code, verifier }, fetchFn) => {
      const t = await tokenPost('https://oauth2.googleapis.com/token', { grant_type: 'authorization_code', code, client_id: values.clientId!, client_secret: values.clientSecret!, redirect_uri: redirectUri, code_verifier: verifier }, fetchFn, 'Google');
      return { refreshToken: t.refresh_token! };
    },
  },
  etsy: {
    redirect: PASTE_REDIRECT,
    authorizeUrl: ({ values, redirectUri, state, challenge }) =>
      `https://www.etsy.com/oauth/connect?${new URLSearchParams({
        response_type: 'code', client_id: values.apiKey!, redirect_uri: redirectUri, scope: 'transactions_r listings_r', state, code_challenge: challenge, code_challenge_method: 'S256',
      })}`,
    exchange: async ({ values, redirectUri, code, verifier }, fetchFn, now) => {
      const t = await tokenPost('https://api.etsy.com/v3/public/oauth/token', { grant_type: 'authorization_code', client_id: values.apiKey!, redirect_uri: redirectUri, code, code_verifier: verifier }, fetchFn, 'Etsy');
      return { accessToken: t.access_token!, refreshToken: t.refresh_token!, accessTokenExpiresAt: String(Math.floor(now.getTime() / 1000) + (t.expires_in ?? 3600)) };
    },
  },
  tiktok_shop: {
    redirect: PASTE_REDIRECT,
    // The link Partner Center shows carries the right host (US sellers have their own) and the app's service_id.
    validate: ({ authLink }) => {
      const u = URL.canParse(authLink!) ? new URL(authLink!) : undefined;
      return u?.protocol === 'https:' && /(^|\.)tiktokshop\.com$/.test(u.hostname) && u.searchParams.get('service_id') ? undefined : 'Authorization link must be the https://…tiktokshop.com/open/authorize?service_id=… link from Partner Center';
    },
    authorizeUrl: ({ values, state }) => {
      const u = new URL(values.authLink!);
      u.searchParams.set('state', state);
      return u.href;
    },
    exchange: async ({ values, code }, fetchFn) => {
      const q = new URLSearchParams({ app_key: values.appKey!, app_secret: values.appSecret!, auth_code: code, grant_type: 'authorized_code' });
      const res = await fetchFn(`https://auth.tiktok-shops.com/api/v2/token/get?${q}`);
      const body = (await res.json().catch(() => ({}))) as { code?: number; message?: string; data?: { access_token?: string; access_token_expire_in?: number; refresh_token?: string } };
      if (body.code !== 0 || !body.data?.access_token || !body.data.refresh_token) throw new Error(`TikTok Shop sign-in failed: ${body.message ?? `HTTP ${res.status}`}`);
      return { accessToken: body.data.access_token, refreshToken: body.data.refresh_token, accessTokenExpiresAt: String(body.data.access_token_expire_in ?? 0) };
    },
  },
};

export const oauthKinds = () => Object.keys(PROVIDERS) as IntegrationKind[];

interface Pending { kind: IntegrationKind; storeId?: string; values: Values; verifier: string; redirectUri: string; expires: number }
const TTL_MS = 15 * 60_000;
const base64url = (b: Buffer) => b.toString('base64url');

/** Validates the non-token fields and returns where to send the owner. Error string on bad input. */
export function startOAuth(db: Db, body: unknown, callbackUrl: string, pending: Map<string, Pending>, now = Date.now()): string | OAuthStart {
  const { kind, storeId, values } = (body ?? {}) as { kind?: unknown; storeId?: unknown; values?: unknown };
  const provider = PROVIDERS[kind as IntegrationKind];
  if (!provider) return `Connect works for ${oauthKinds().join(', ')}`;
  const spec = INTEGRATION_KINDS[kind as IntegrationKind];
  if (spec.perStore && (typeof storeId !== 'string' || !getStore(db, storeId))) return `${spec.name} needs an existing storeId`;
  if (!spec.perStore && storeId !== undefined) return `${spec.name} is global; omit storeId`;
  if (!values || typeof values !== 'object') return 'values must be an object';
  const given: Values = {};
  for (const f of spec.fields.filter((f) => !f.oauth)) {
    const v = (values as Record<string, unknown>)[f.key];
    if (typeof v !== 'string' || !v.trim()) return `${f.label} is required`;
    given[f.key] = v.trim();
  }
  const invalid = provider.validate?.(given);
  if (invalid) return invalid;
  for (const [s, p] of pending) if (p.expires < now) pending.delete(s);
  const state = base64url(randomBytes(24));
  const verifier = base64url(randomBytes(32));
  const redirectUri = provider.redirect === 'loopback' ? callbackUrl : provider.redirect;
  pending.set(state, { kind: kind as IntegrationKind, ...(typeof storeId === 'string' ? { storeId } : {}), values: given, verifier, redirectUri, expires: now + TTL_MS });
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { url: provider.authorizeUrl({ values: given, redirectUri, state, challenge }), finish: provider.redirect === 'loopback' ? 'loopback' : 'paste', redirectUri };
}

/** Exchanges the code for tokens and saves the integration. Throws a message for the owner. */
export async function finishOAuth(db: Db, key: Buffer, params: URLSearchParams, pending: Map<string, Pending>, fetchFn: Fetch = fetch, now = new Date()) {
  const p = pending.get(params.get('state') ?? '');
  if (!p || p.expires < now.getTime()) throw new Error('This sign-in link expired or was already used. Press Connect again.');
  pending.delete(params.get('state')!);
  const denied = params.get('error');
  if (denied) throw new Error(`Sign-in was cancelled: ${params.get('error_description') ?? denied}`);
  const code = params.get('code');
  if (!code) throw new Error('The address has no sign-in code. Copy the full address from the browser after approving.');
  const provider = PROVIDERS[p.kind]!;
  const tokens = await provider.exchange({ values: p.values, redirectUri: p.redirectUri, code, verifier: p.verifier }, fetchFn, now);
  const fields = new Set(INTEGRATION_KINDS[p.kind].fields.map((f) => f.key));
  const form = Object.fromEntries(Object.entries(tokens).filter(([k]) => fields.has(k)));
  const saved = saveIntegration(db, key, { kind: p.kind, ...(p.storeId ? { storeId: p.storeId } : {}), values: { ...p.values, ...form } });
  if (typeof saved === 'string') throw new Error(saved);
  const extra = Object.fromEntries(Object.entries(tokens).filter(([k]) => !fields.has(k)));
  if (Object.keys(extra).length) updateSecrets(db, key, saved.id, extra);
  return saved;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const page = (title: string, text: string) =>
  `<!doctype html><meta charset="utf-8"><title>Frontline Ecom</title><body style="background:#08080a;color:#e4e4e7;font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0"><div style="max-width:440px;text-align:center"><h1 style="color:#ff2a3a;font-size:22px">${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p></div>`;

export function oauthRoutes(db: Db, key: () => Buffer, fetchFn: Fetch = fetch) {
  const pending = new Map<string, Pending>();
  return new Hono()
    .post('/api/integrations/oauth/start', async (c) => {
      const r = startOAuth(db, await c.req.json().catch(() => undefined), new URL('/api/oauth/callback', c.req.url).href, pending);
      return typeof r === 'string' ? c.json({ error: r }, 400) : c.json(r);
    })
    .post('/api/integrations/oauth/finish', async (c) => {
      const { url } = ((await c.req.json().catch(() => undefined)) ?? {}) as { url?: unknown };
      const params = typeof url === 'string' && URL.canParse(url.trim()) ? new URL(url.trim()).searchParams : undefined;
      if (!params) return c.json({ error: 'Paste the full address from the browser, starting with https://' }, 400);
      try {
        return c.json(await finishOAuth(db, key(), params, pending, fetchFn));
      } catch (e) {
        return c.json({ error: e instanceof Error ? e.message : 'Sign-in failed' }, 400);
      }
    })
    .get('/api/oauth/callback', async (c) => {
      try {
        const saved = await finishOAuth(db, key(), new URL(c.req.url).searchParams, pending, fetchFn);
        return c.html(page('Connected', `${INTEGRATION_KINDS[saved.kind].name} is connected. You can close this tab and go back to Frontline Ecom.`));
      } catch (e) {
        return c.html(page('Not connected', e instanceof Error ? e.message : 'Sign-in failed'), 400);
      }
    });
}
