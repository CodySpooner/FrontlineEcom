import { randomBytes } from 'node:crypto';
import { expect, test } from 'vitest';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { saveIntegration } from '../integrations';
import { syncWooCommerce, wooSite } from './woocommerce';

const key = randomBytes(32);
const NOW = new Date('2026-10-26T18:00:00Z');

const order = (n: string, status: string, total: string, paid: boolean, extra: Record<string, unknown> = {}) => ({
  number: n, status, total, currency: 'EUR', date_created: '2026-10-25T14:00:00', date_created_gmt: '2026-10-25T12:00:00', date_modified_gmt: '2026-10-25T14:00:00', date_paid_gmt: paid ? '2026-10-25T12:01:00' : null, ...extra,
});

/** Fake Woo: orders over two pages (x-wp-totalpages), one page of products. */
function fakeWoo(status = 200) {
  const calls: { url: URL; headers: Headers }[] = [];
  const fetchFn = (async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    calls.push({ url: u, headers: new Headers(init.headers) });
    if (status !== 200) return Response.json({ code: 'woocommerce_rest_cannot_view', message: 'Sorry, you cannot list resources.' }, { status });
    if (u.pathname.endsWith('/orders')) {
      const page = u.searchParams.get('page') === '1'
        ? [order('1001', 'processing', '30.00', true, { line_items: [{ product_id: 7, quantity: 2, total: '25.00' }, { product_id: 0, quantity: 1, total: '5.00' }] }), order('1002', 'completed', '20.00', true)]
        : [order('1003', 'refunded', '15.00', true), order('1004', 'pending', '9.99', false), order('1005', 'on-hold', '12.00', false, { date_modified_gmt: '2026-10-26T09:30:00' })];
      return Response.json(page, { headers: { 'x-wp-totalpages': '2' } });
    }
    return Response.json([
      { id: 7, name: 'Travel Bowl', status: 'publish', price: '19.00', regular_price: '24.00', sale_price: '19.00', stock_quantity: 5, images: [{ src: 'https://shop.test/bowl.jpg' }], date_modified_gmt: '2026-10-20T00:00:00' },
      { id: 8, name: 'Leash', status: 'draft', price: '', regular_price: '', sale_price: '', stock_quantity: null, date_modified_gmt: '2026-10-21T00:00:00' },
    ], { headers: { 'x-wp-totalpages': '1' } });
  }) as typeof fetch;
  return { fetchFn, calls };
}

const setup = (siteUrl = 'https://shop.test/store/') => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  saveIntegration(db, key, { kind: 'woocommerce', storeId: 'pawsome', values: { siteUrl, consumerKey: 'ck_1', consumerSecret: 'cs_2' } });
  return db;
};

test('WooCommerce sync pulls paid orders + products since the cursor and rebuilds revenue', async () => {
  const db = setup();
  const { fetchFn, calls } = fakeWoo();
  await syncWooCommerce(db, key, 'pawsome', fetchFn, NOW);

  expect(calls.map((c) => `${c.url.pathname} ${c.url.searchParams.get('page')}`)).toEqual(['/store/wp-json/wc/v3/orders 1', '/store/wp-json/wc/v3/orders 2', '/store/wp-json/wc/v3/products 1']);
  expect(calls.every((c) => c.headers.get('authorization') === `Basic ${Buffer.from('ck_1:cs_2').toString('base64')}`)).toBe(true);
  expect(calls[0]!.url.searchParams.get('modified_after')).toBe('2024-10-26T18:00:00');

  expect(db.prepare("SELECT id, price, compare_at AS compareAt, inventory, status FROM products WHERE store_id = 'pawsome' ORDER BY id").all()).toEqual([
    { id: 'woo-7', price: 19, compareAt: 24, inventory: 5, status: 'active' },
    { id: 'woo-8', price: 0, compareAt: null, inventory: 0, status: 'draft' },
  ]);
  expect(db.prepare("SELECT id, total, status, fulfillment_status AS f, local_date AS day FROM orders WHERE store_id = 'pawsome' ORDER BY id").all()).toEqual([
    { id: 'woo-1001', total: 30, status: 'paid', f: 'unfulfilled', day: '2026-10-25' },
    { id: 'woo-1002', total: 20, status: 'paid', f: 'fulfilled', day: '2026-10-25' },
    { id: 'woo-1003', total: 15, status: 'refunded', f: 'unfulfilled', day: '2026-10-25' },
  ]);
  expect(db.prepare("SELECT product_id AS p, quantity AS q, revenue FROM order_items WHERE store_id = 'pawsome'").all()).toEqual([{ p: 'woo-7', q: 2, revenue: 25 }]);
  expect(db.prepare("SELECT revenue, orders FROM daily_metrics WHERE store_id = 'pawsome' AND date = '2026-10-25'").get()).toEqual({ revenue: 50, orders: 2 });
  expect(db.prepare("SELECT status, cursor FROM integrations WHERE id = 'woocommerce:pawsome'").get()).toEqual({ status: 'connected', cursor: '2026-10-26T09:30:00' });

  await syncWooCommerce(db, key, 'pawsome', fakeWoo().fetchFn, NOW);
  expect(db.prepare("SELECT count(*) AS n FROM orders WHERE store_id = 'pawsome'").get()).toEqual({ n: 3 });
});

test('WooCommerce sync refuses http sites and reports rejected keys', async () => {
  expect(wooSite(' https://shop.test/// ')).toBe('https://shop.test');
  expect(() => wooSite('http://shop.test')).toThrow('https://');
  expect(() => wooSite('shop.test')).toThrow('https://');

  const plain = setup('http://shop.test');
  const { fetchFn, calls } = fakeWoo();
  await syncWooCommerce(plain, key, 'pawsome', fetchFn, NOW);
  expect(calls).toHaveLength(0);
  expect(plain.prepare("SELECT status, error FROM integrations WHERE id = 'woocommerce:pawsome'").get()).toMatchObject({ status: 'error', error: expect.stringContaining('https://') });

  const denied = setup();
  await syncWooCommerce(denied, key, 'pawsome', fakeWoo(401).fetchFn, NOW);
  expect(denied.prepare("SELECT status, error FROM integrations WHERE id = 'woocommerce:pawsome'").get()).toMatchObject({ status: 'error', error: expect.stringContaining('refused the keys') });
  expect(denied.prepare("SELECT demo FROM stores WHERE id = 'pawsome'").get()).toEqual({ demo: 1 });
});

test("orders land on the shop's own day and the store takes the shop's currency", async () => {
  const db = setup();
  const fetchFn = (async (url: string) =>
    new URL(url).pathname.endsWith('/orders')
      ? Response.json([order('2001', 'processing', '40.00', true, { currency: 'EUR', date_created: '2026-10-26T00:30:00', date_created_gmt: '2026-10-25T22:30:00' })], { headers: { 'x-wp-totalpages': '1' } })
      : Response.json([], { headers: { 'x-wp-totalpages': '1' } })) as typeof fetch;
  await syncWooCommerce(db, key, 'pawsome', fetchFn, NOW);
  // 00:30 in Berlin is still the 25th in UTC (and in America/*): the shop's day wins.
  expect(db.prepare("SELECT local_date AS day FROM orders WHERE store_id = 'pawsome'").all()).toEqual([{ day: '2026-10-26' }]);
  expect(db.prepare("SELECT currency FROM stores WHERE id = 'pawsome'").get()).toEqual({ currency: 'EUR' });
});
