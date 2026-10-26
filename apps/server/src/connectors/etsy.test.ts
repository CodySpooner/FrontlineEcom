import { randomBytes } from 'node:crypto';
import { expect, test } from 'vitest';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { getCredentials, saveIntegration } from '../integrations';
import { syncEtsy } from './etsy';

const key = randomBytes(32);
const NOW = new Date('2026-10-26T18:00:00Z');
const T = (iso: string) => Date.parse(iso) / 1000;
const usd = (cents: number) => ({ amount: cents, divisor: 100, currency_code: 'USD' });

const receipt = (id: number, status: string, cents: number, extra: Record<string, unknown> = {}) => ({
  receipt_id: id, status, is_paid: true, is_shipped: false, create_timestamp: T('2026-10-25T12:00:00Z'), updated_timestamp: T('2026-10-25T14:00:00Z'), grandtotal: usd(cents), ...extra,
});
const listing = (id: number, state: string, updated: string) => ({ listing_id: id, title: `Listing ${id}`, state, quantity: 5, price: usd(2400), updated_timestamp: T(updated) });

/** Fake Etsy: token refresh, receipts (two pages), listings sorted newest-changed first. */
function fakeEtsy(refreshError = false) {
  const calls: { url: URL; headers: Headers; body: string }[] = [];
  const fetchFn = (async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    calls.push({ url: u, headers: new Headers(init.headers), body: String(init.body ?? '') });
    if (u.pathname === '/v3/public/oauth/token') {
      return refreshError ? Response.json({ error: 'invalid_grant', error_description: 'refresh token expired' }, { status: 400 }) : Response.json({ access_token: '123.at_new', refresh_token: '123.rt_new', expires_in: 3600 });
    }
    const offset = Number(u.searchParams.get('offset'));
    if (u.pathname.endsWith('/receipts')) {
      const all = [receipt(1, 'paid', 3000, { transactions: [{ listing_id: 11, quantity: 2, price: usd(1250) }] }), receipt(2, 'completed', 2000, { is_shipped: true, shipments: [{ tracking_code: '9400' }] }), receipt(3, 'fully refunded', 1500), receipt(4, 'open', 999, { is_paid: false })];
      return Response.json({ count: 104, results: offset === 0 ? all : [] });
    }
    const state = u.searchParams.get('state');
    const results = state === 'active' ? [listing(11, 'active', '2026-10-24T00:00:00Z'), listing(12, 'active', '2020-01-01T00:00:00Z')] : state === 'draft' ? [listing(13, 'draft', '2026-10-01T00:00:00Z')] : [];
    return Response.json({ count: state === 'draft' ? 1 : 500, results });
  }) as typeof fetch;
  return { fetchFn, calls };
}

const setup = () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  saveIntegration(db, key, { kind: 'etsy', storeId: 'pawsome', values: { shopId: '4455', apiKey: 'keystr', sharedSecret: 'shh', accessToken: '123.at_old', refreshToken: '123.rt_old' } });
  return db;
};

test('Etsy sync renews the token, pulls paid receipts + changed listings, rebuilds revenue', async () => {
  const db = setup();
  const { fetchFn, calls } = fakeEtsy();
  await syncEtsy(db, key, 'pawsome', fetchFn, NOW);

  expect(Object.fromEntries(new URLSearchParams(calls[0]!.body))).toEqual({ grant_type: 'refresh_token', client_id: 'keystr', refresh_token: '123.rt_old' });
  expect(getCredentials(db, key, 'etsy', 'pawsome')).toMatchObject({ accessToken: '123.at_new', refreshToken: '123.rt_new', accessTokenExpiresAt: String(T('2026-10-26T19:00:00Z')) });
  const api = calls.slice(1);
  expect(api.every((c) => c.headers.get('x-api-key') === 'keystr:shh' && c.headers.get('authorization') === 'Bearer 123.at_new')).toBe(true);
  expect(api.filter((c) => c.url.pathname.endsWith('/receipts')).map((c) => c.url.searchParams.get('offset'))).toEqual(['0', '100']);
  // active stops at a listing older than the window, draft at its count, inactive at an empty page
  expect(api.filter((c) => c.url.pathname.endsWith('/listings')).map((c) => c.url.searchParams.get('state'))).toEqual(['active', 'draft', 'inactive']);

  expect(db.prepare("SELECT id, status FROM products WHERE store_id = 'pawsome' ORDER BY id").all()).toEqual([{ id: 'etsy-11', status: 'active' }, { id: 'etsy-13', status: 'draft' }]);
  expect(db.prepare("SELECT id, total, status, fulfillment_status, tracking FROM orders WHERE store_id = 'pawsome' ORDER BY id").all()).toEqual([
    { id: 'etsy-1', total: 30, status: 'paid', fulfillment_status: 'unfulfilled', tracking: null },
    { id: 'etsy-2', total: 20, status: 'paid', fulfillment_status: 'fulfilled', tracking: '9400' },
    { id: 'etsy-3', total: 15, status: 'refunded', fulfillment_status: 'unfulfilled', tracking: null },
  ]);
  expect(db.prepare("SELECT revenue, orders FROM daily_metrics WHERE store_id = 'pawsome' AND date = '2026-10-25'").get()).toEqual({ revenue: 50, orders: 2 });
  expect(db.prepare("SELECT product_id, quantity, revenue FROM order_items WHERE order_id = 'etsy-1'").all()).toEqual([{ product_id: 'etsy-11', quantity: 2, revenue: 25 }]);

  const again = fakeEtsy();
  await syncEtsy(db, key, 'pawsome', again.fetchFn, NOW);
  expect(again.calls[0]!.url.pathname.endsWith('/receipts')).toBe(true); // token still fresh
  expect(again.calls[0]!.url.searchParams.get('min_last_modified')).toBe(String(T('2026-10-26T17:55:00Z'))); // the last sync's start, less 5 min;
});

test('Etsy: an expired refresh token shows on the integration and keeps demo data', async () => {
  const db = setup();
  await syncEtsy(db, key, 'pawsome', fakeEtsy(true).fetchFn, NOW);
  expect(db.prepare("SELECT status, error FROM integrations WHERE id = 'etsy:pawsome'").get()).toEqual({ status: 'error', error: 'Etsy sign-in failed: refresh token expired; connect the shop again' });
  expect(db.prepare("SELECT demo FROM stores WHERE id = 'pawsome'").get()).toEqual({ demo: 1 });
});

test('a partly refunded Etsy receipt counts what the buyer kept', async () => {
  const db = setup();
  const etsy = fakeEtsy().fetchFn;
  const fetchFn = (async (url: string, init: RequestInit) =>
    new URL(url).pathname.endsWith('/receipts')
      ? Response.json({ count: 1, results: [receipt(9, 'partially refunded', 4000, { refunds: [{ amount: usd(1250), created_timestamp: T('2026-10-26T09:00:00Z'), reason: 'damaged' }] })] })
      : etsy(url, init)) as typeof fetch;
  await syncEtsy(db, key, 'pawsome', fetchFn, NOW);
  expect(db.prepare("SELECT total, status FROM orders WHERE store_id = 'pawsome' AND id = 'etsy-9'").get()).toEqual({ total: 27.5, status: 'paid' });
});
