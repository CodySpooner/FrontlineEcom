import { randomBytes } from 'node:crypto';
import { expect, test } from 'vitest';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { getCredentials, saveIntegration, updateSecrets } from '../integrations';
import { htmlToText, publishEtsyProductPage, setEtsyListingPrice, syncEtsy } from './etsy';

const key = randomBytes(32);
const NOW = new Date('2026-10-26T18:00:00Z');
const T = (iso: string) => Date.parse(iso) / 1000;
const usd = (cents: number) => ({ amount: cents, divisor: 100, currency_code: 'USD' });

const receipt = (id: number, status: string, cents: number, extra: Record<string, unknown> = {}) => ({
  receipt_id: id, status, is_paid: true, is_shipped: false, create_timestamp: T('2026-10-25T12:00:00Z'), updated_timestamp: T('2026-10-25T14:00:00Z'), grandtotal: usd(cents), ...extra,
});
const listing = (id: number, state: string, updated: string) => ({
  listing_id: id, title: `Listing ${id}`, state, quantity: 5, price: usd(2400), updated_timestamp: T(updated),
  images: [{ rank: 2, url_570xN: `https://i.etsystatic.com/${id}-back.jpg` }, { rank: 1, url_570xN: `https://i.etsystatic.com/${id}-main.jpg` }],
});

/** Fake Etsy: token refresh, receipts (two pages), listings sorted newest-changed first. */
/** `gone`: deleted on Etsy (404 when asked for). `skipped`: still on Etsy, but missed by the listing pages (edited mid-read). */
function fakeEtsy(refreshError = false, gone: number[] = [], skipped: number[] = []) {
  const calls: { url: URL; headers: Headers; body: string }[] = [];
  const fetchFn = (async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    calls.push({ url: u, headers: new Headers(init.headers), body: String(init.body ?? '') });
    if (u.pathname === '/v3/public/oauth/token') {
      return refreshError ? Response.json({ error: 'invalid_grant', error_description: 'refresh token expired' }, { status: 400 }) : Response.json({ access_token: '123.at_new', refresh_token: '123.rt_new', expires_in: 3600 });
    }
    const single = /^\/v3\/application\/listings\/(\d+)$/.exec(u.pathname);
    if (single) {
      const n = Number(single[1]);
      return gone.includes(n) ? Response.json({ error: 'Listing not found' }, { status: 404 }) : Response.json(listing(n, 'active', '2026-10-27T17:00:00Z'));
    }
    const offset = Number(u.searchParams.get('offset'));
    if (u.pathname.endsWith('/receipts')) {
      const all = [receipt(1, 'paid', 3000, { transactions: [{ listing_id: 11, quantity: 2, price: usd(1250) }] }), receipt(2, 'completed', 2000, { is_shipped: true, shipments: [{ tracking_code: '9400' }] }), receipt(3, 'fully refunded', 1500), receipt(4, 'open', 999, { is_paid: false })];
      return Response.json({ count: 104, results: offset === 0 ? all : [] });
    }
    const state = u.searchParams.get('state');
    const one = { draft: listing(13, 'draft', '2026-10-01T00:00:00Z'), sold_out: listing(14, 'sold_out', '2026-10-25T00:00:00Z'), expired: listing(15, 'expired', '2026-10-20T00:00:00Z') }[state!];
    const results = (state === 'active' ? [listing(11, 'active', '2026-10-24T00:00:00Z'), listing(12, 'active', '2020-01-01T00:00:00Z')] : one ? [one] : []).filter((l) => !gone.includes(l.listing_id) && !skipped.includes(l.listing_id));
    return Response.json({ count: state === 'inactive' ? 500 : results.length, results });
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
  // The first sync reads every listing, however old: each state to its count (inactive to an empty page).
  expect(api.filter((c) => c.url.pathname.endsWith('/listings')).map((c) => c.url.searchParams.get('state'))).toEqual(['active', 'draft', 'inactive', 'sold_out', 'expired']);

  expect(api.find((c) => c.url.pathname.endsWith('/listings'))!.url.searchParams.get('includes')).toBe('Images');
  expect(db.prepare("SELECT image FROM products WHERE store_id = 'pawsome' AND id = 'etsy-11'").get()?.image).toBe('https://i.etsystatic.com/11-main.jpg');
  expect(db.prepare("SELECT id, status, inventory FROM products WHERE store_id = 'pawsome' ORDER BY id").all()).toEqual([
    { id: 'etsy-11', status: 'active', inventory: 5 },
    { id: 'etsy-12', status: 'active', inventory: 5 }, // unchanged since 2020, still listed
    { id: 'etsy-13', status: 'draft', inventory: 5 },
    { id: 'etsy-14', status: 'active', inventory: 0 }, // sold out: still listed, nothing left
    { id: 'etsy-15', status: 'archived', inventory: 5 },
  ]);
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
      ? Response.json({ count: 1, results: [receipt(9, 'partially refunded', 4000, {
          refunds: [{ amount: usd(1250), created_timestamp: T('2026-10-26T09:00:00Z'), reason: 'damaged' }],
          transactions: [{ listing_id: 11, quantity: 2, price: usd(1500) }, { listing_id: 12, quantity: 1, price: usd(1000) }],
        })] })
      : etsy(url, init)) as typeof fetch;
  await syncEtsy(db, key, 'pawsome', fetchFn, NOW);
  expect(db.prepare("SELECT total, status FROM orders WHERE store_id = 'pawsome' AND id = 'etsy-9'").get()).toEqual({ total: 27.5, status: 'paid' });
  // Etsy doesn't say which lines a refund was for: each line keeps its share of what the buyer kept (27.50 of 40).
  const lines = db.prepare("SELECT product_id, quantity, revenue FROM order_items WHERE order_id = 'etsy-9' ORDER BY product_id").all() as { revenue: number }[];
  expect(lines.map((l) => l.revenue)).toEqual([expect.closeTo(20.63, 1), expect.closeTo(6.88, 1)]);
});

test("an Etsy store takes its shop's currency from the receipts", async () => {
  const db = setup();
  const etsy = fakeEtsy().fetchFn;
  const eur = (cents: number) => ({ amount: cents, divisor: 100, currency_code: 'EUR' });
  const fetchFn = (async (url: string, init: RequestInit) =>
    new URL(url).pathname.endsWith('/receipts') ? Response.json({ count: 1, results: [receipt(7, 'paid', 0, { grandtotal: eur(3100) })] }) : etsy(url, init)) as typeof fetch;
  await syncEtsy(db, key, 'pawsome', fetchFn, NOW);
  expect(db.prepare("SELECT currency FROM stores WHERE id = 'pawsome'").get()?.currency).toBe('EUR');
  expect(db.prepare("SELECT total FROM orders WHERE store_id = 'pawsome' AND id = 'etsy-7'").get()?.total).toBe(31);
});

test('an approved Etsy price goes back with the whole inventory as read; per-variation prices and compare-at are refused', async () => {
  const db = setup();
  updateSecrets(db, key, 'etsy:pawsome', { accessTokenExpiresAt: String(T('2026-10-27T00:00:00Z')) });
  db.prepare("INSERT INTO products (store_id, id, title, price, cost, inventory, status) VALUES ('pawsome', 'etsy-555', 'Mug', 20, 0, 9, 'active')").run();
  const offering = (id: number, qty: number) => ({ offering_id: id, quantity: qty, is_enabled: true, is_deleted: false, price: usd(2000), readiness_state_id: 7 });
  const color = (id: number, value: string) => [{ property_id: 200, property_name: 'Color', scale_id: null, scale_name: null, value_ids: [id], values: [value] }];
  let inventory = {
    products: [
      { product_id: 1, sku: 'M-RED', is_deleted: false, property_values: color(1, 'Red'), offerings: [offering(11, 5)] },
      { product_id: 2, sku: 'M-BLUE', is_deleted: false, property_values: color(2, 'Blue'), offerings: [offering(12, 4)] },
    ],
    price_on_property: [] as number[], quantity_on_property: [200], sku_on_property: [200], readiness_state_on_property: [],
  };
  const puts: unknown[] = [];
  const fetchFn = (async (url: string, init: RequestInit = {}) => {
    expect(url).toBe('https://openapi.etsy.com/v3/application/listings/555/inventory');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer 123.at_old');
    if (init.method === 'PUT') puts.push(JSON.parse(String(init.body)));
    return Response.json(inventory);
  }) as typeof fetch;

  await setEtsyListingPrice(db, key, 'pawsome', 'etsy-555', { price: 24.5 }, fetchFn, NOW);
  const offer = (qty: number) => [{ price: 24.5, quantity: qty, is_enabled: true, readiness_state_id: 7 }];
  const prop = (id: number, value: string) => [{ property_id: 200, property_name: 'Color', scale_id: null, value_ids: [id], values: [value] }];
  expect(puts).toEqual([{
    products: [{ sku: 'M-RED', property_values: prop(1, 'Red'), offerings: offer(5) }, { sku: 'M-BLUE', property_values: prop(2, 'Blue'), offerings: offer(4) }],
    price_on_property: [], quantity_on_property: [200], sku_on_property: [200], readiness_state_on_property: [],
  }]);
  expect(db.prepare("SELECT price FROM products WHERE store_id = 'pawsome' AND id = 'etsy-555'").get()?.price).toBe(24.5);

  await expect(setEtsyListingPrice(db, key, 'pawsome', 'etsy-555', { price: 20, compareAt: 30 }, fetchFn, NOW)).rejects.toThrow('Etsy has no compare-at price');
  inventory = { ...inventory, price_on_property: [200] };
  await expect(setEtsyListingPrice(db, key, 'pawsome', 'etsy-555', { price: 20 }, fetchFn, NOW)).rejects.toThrow('priced per variation');
  expect(puts).toHaveLength(1);
  const denied = (async () => Response.json({ error: 'insufficient scope' }, { status: 403 })) as typeof fetch;
  await expect(setEtsyListingPrice(db, key, 'pawsome', 'etsy-555', { price: 20 }, denied, NOW)).rejects.toThrow('connect Etsy again');
  expect(db.prepare("SELECT action, error IS NULL AS ok FROM action_log WHERE store_id = 'pawsome' ORDER BY rowid").all()).toEqual([
    { action: 'price_change', ok: 1 }, { action: 'price_change', ok: 0 }, { action: 'price_change', ok: 0 },
  ]);
  // Synced at 24.50, but 20 on Etsy now (changed in Shop Manager): a change sized on 24.50 isn't the one approved.
  inventory = { ...inventory, price_on_property: [] };
  await expect(setEtsyListingPrice(db, key, 'pawsome', 'etsy-555', { price: 26 }, fetchFn, NOW)).rejects.toThrow('Etsy: the price of etsy-555 is 20 there now, not 24.5 as last synced');
  expect(puts).toHaveLength(1);
});

test('an approved product page replaces the listing title and a plain-text description', async () => {
  const db = setup();
  updateSecrets(db, key, 'etsy:pawsome', { accessTokenExpiresAt: String(T('2026-10-27T00:00:00Z')) });
  db.prepare("INSERT INTO products (store_id, id, title, price, cost, inventory, status) VALUES ('pawsome', 'etsy-555', 'Mug', 20, 0, 9, 'active')").run();
  const sent: { url: string; method?: string; body: Record<string, string> }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    sent.push({ url, method: init.method, body: Object.fromEntries(init.body as URLSearchParams) });
    return Response.json({ listing_id: 555 });
  }) as typeof fetch;
  await publishEtsyProductPage(db, key, 'pawsome', 'etsy-555', { title: 'Hand-thrown Mug', descriptionHtml: '<p>Holds 12 oz.</p><ul><li>Glazed</li></ul>', seoTitle: 'ignored' }, fetchFn, NOW);
  expect(sent).toEqual([{ url: 'https://openapi.etsy.com/v3/application/shops/4455/listings/555', method: 'PATCH', body: { title: 'Hand-thrown Mug', description: 'Holds 12 oz.\n\n• Glazed' } }]);
  expect(db.prepare("SELECT title FROM products WHERE store_id = 'pawsome' AND id = 'etsy-555'").get()?.title).toBe('Hand-thrown Mug');
  expect(db.prepare("SELECT action, target FROM action_log WHERE store_id = 'pawsome'").all()).toEqual([{ action: 'product_page_publish', target: 'etsy-555' }]);
});

test('HTML to Etsy plain text: paragraphs, breaks, list bullets, entities', () => {
  expect(htmlToText('<h2>Why</h2><p>Soft &amp; warm<br>Machine-wash</p><ul>\n<li>Cotton</li>\n<li>Wool</li>\n</ul><p>It&#39;s 5&nbsp;&lt; 6 &#x2014; <b>yes</b> &hellip; &ldquo;Cozy&rdquo; &mdash; it&rsquo;s &zzz; &constructor; &#9999999;&#x110000;</p>')).toBe(
    "Why\n\nSoft & warm\nMachine-wash\n\n• Cotton\n• Wool\n\nIt's 5 < 6 \u2014 yes \u2026 \u201cCozy\u201d \u2014 it\u2019s &zzz; &constructor; \ufffd\ufffd",
  );
});

test('a sync and an approved change renewing the token together share one refresh (Etsy rotates the refresh token)', async () => {
  const db = setup();
  db.prepare("INSERT INTO products (store_id, id, title, price, cost, inventory, status) VALUES ('pawsome', 'etsy-11', 'Mug', 20, 0, 9, 'active')").run();
  const { fetchFn, calls } = fakeEtsy();
  const write = (async (url: string, init?: RequestInit) =>
    new URL(url).pathname.endsWith('/inventory') ? Response.json({ products: [], price_on_property: [], quantity_on_property: [], sku_on_property: [] }) : fetchFn(url, init)) as typeof fetch;
  await Promise.all([syncEtsy(db, key, 'pawsome', write, NOW), setEtsyListingPrice(db, key, 'pawsome', 'etsy-11', { price: 22 }, write, NOW)]);
  expect(calls.filter((c) => c.url.pathname === '/v3/public/oauth/token')).toHaveLength(1);
  expect(db.prepare("SELECT status FROM integrations WHERE id = 'etsy:pawsome'").get()?.status).toBe('connected');
});

test('Etsy: later syncs read changed listings only; once a day all of them, archiving listings deleted on Etsy', async () => {
  const db = setup();
  await syncEtsy(db, key, 'pawsome', fakeEtsy().fetchFn, NOW);
  const sameDay = fakeEtsy(false, [13]);
  await syncEtsy(db, key, 'pawsome', sameDay.fetchFn, NOW);
  const status = () => db.prepare("SELECT status FROM products WHERE store_id = 'pawsome' AND id = 'etsy-13'").get()?.status;
  expect(status()).toBe('draft'); // a changes-only read can't tell deleted from unchanged
  const nextDay = fakeEtsy(false, [13]);
  await syncEtsy(db, key, 'pawsome', nextDay.fetchFn, new Date('2026-10-27T18:00:00Z'));
  expect(status()).toBe('archived');
  expect(db.prepare("SELECT status FROM products WHERE store_id = 'pawsome' AND id = 'etsy-12'").get()?.status).toBe('active');
});

test("an Etsy receipt's sales tax and VAT count against profit, less the share a refund gave back", async () => {
  const db = setup();
  const base = fakeEtsy().fetchFn;
  const fetchFn = (async (url: string, init?: RequestInit) =>
    new URL(url).pathname.endsWith('/receipts')
      ? Response.json({ count: 1, results: [receipt(7, 'paid', 6000, { total_tax_cost: usd(400), total_vat_cost: usd(800), refunds: [{ amount: usd(1500) }] })] })
      : base(url, init)) as typeof fetch;
  await syncEtsy(db, key, 'pawsome', fetchFn, NOW);
  // $60 with $12 of tax, $15 refunded: $45 kept, holding three quarters of the tax.
  expect(db.prepare("SELECT total, tax FROM orders WHERE id = 'etsy-7'").get()).toEqual({ total: 45, tax: 9 });
});

test("a listing the daily full read missed is archived only once Etsy says it's gone; one edited mid-read is kept as Etsy has it", async () => {
  const db = setup();
  await syncEtsy(db, key, 'pawsome', fakeEtsy().fetchFn, NOW);
  const nextDay = fakeEtsy(false, [13], [14]); // 13 deleted; 14 moved from sold out to active while the pages were read
  await syncEtsy(db, key, 'pawsome', nextDay.fetchFn, new Date('2026-10-27T18:00:00Z'));
  const status = (n: number) => db.prepare("SELECT status FROM products WHERE store_id = 'pawsome' AND id = ?").get(`etsy-${n}`)?.status;
  expect([status(13), status(14)]).toEqual(['archived', 'active']);
  expect(nextDay.calls.filter((c) => /\/listings\/\d+$/.test(c.url.pathname)).map((c) => c.url.pathname.split('/').pop()).sort()).toEqual(['13', '14']);
});
