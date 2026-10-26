import { randomBytes } from 'node:crypto';
import { expect, test } from 'vitest';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { saveIntegration } from '../integrations';
import { createWooProducts, publishWooProductPage, setWooProductPrice, syncWooCommerce, wooSite, wpZone } from './woocommerce';

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
      { id: 8, name: 'Leash', status: 'draft', price: '', regular_price: '', sale_price: '', stock_quantity: null, manage_stock: false, date_modified_gmt: '2026-10-21T00:00:00' },
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

  expect(calls.map((c) => `${c.url.pathname} ${c.url.searchParams.get('page')}`)).toEqual(['/store/wp-json/wc/v3/orders 1', '/store/wp-json/wc/v3/orders 2', '/store/wp-json/wc/v3/products 1', '/store/wp-json/wc/v3/settings/general/woocommerce_currency null', '/store/wp-json/ null']);
  expect(calls.every((c) => c.headers.get('authorization') === `Basic ${Buffer.from('ck_1:cs_2').toString('base64')}`)).toBe(true);
  expect(calls[0]!.url.searchParams.get('modified_after')).toBe('2024-10-26T18:00:00');

  expect(db.prepare("SELECT id, price, compare_at AS compareAt, inventory, inventory_tracked AS tracked, status FROM products WHERE store_id = 'pawsome' ORDER BY id").all()).toEqual([
    { id: 'woo-7', price: 19, compareAt: 24, inventory: 5, tracked: 1, status: 'active' },
    { id: 'woo-8', price: 0, compareAt: null, inventory: 0, tracked: 0, status: 'draft' }, // Manage stock off: 0 isn't sold out
  ]);
  expect(db.prepare("SELECT id, total, status, fulfillment_status AS f, local_date AS day FROM orders WHERE store_id = 'pawsome' ORDER BY id").all()).toEqual([
    { id: 'woo-1001', total: 30, status: 'paid', f: 'unfulfilled', day: '2026-10-25' },
    { id: 'woo-1002', total: 20, status: 'paid', f: 'fulfilled', day: '2026-10-25' },
    { id: 'woo-1003', total: 15, status: 'refunded', f: 'unfulfilled', day: '2026-10-25' },
  ]);
  expect(db.prepare("SELECT product_id AS p, quantity AS q, revenue FROM order_items WHERE store_id = 'pawsome'").all()).toEqual([{ p: 'woo-7', q: 2, revenue: 25 }]);
  expect(db.prepare("SELECT revenue, orders FROM daily_metrics WHERE store_id = 'pawsome' AND date = '2026-10-25'").get()).toEqual({ revenue: 50, orders: 2 });
  expect(db.prepare("SELECT status, cursor FROM integrations WHERE id = 'woocommerce:pawsome'").get()).toEqual({ status: 'connected', cursor: '2026-10-26T17:55:00' });

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
  const fetchFn = (async (url: string) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/wp-json/')) return Response.json({ name: 'Shop', gmt_offset: 2, timezone_string: 'Europe/Berlin' });
    return path.endsWith('/orders')
      ? Response.json([order('2001', 'processing', '40.00', true, { currency: 'EUR', date_created: '2026-10-26T00:30:00', date_created_gmt: '2026-10-25T22:30:00' })], { headers: { 'x-wp-totalpages': '1' } })
      : Response.json([], { headers: { 'x-wp-totalpages': '1' } });
  }) as typeof fetch;
  await syncWooCommerce(db, key, 'pawsome', fetchFn, NOW);
  // 00:30 in Berlin is still the 25th in UTC (and in America/*): the shop's day wins, and the store's "today" follows it.
  expect(db.prepare("SELECT local_date AS day FROM orders WHERE store_id = 'pawsome'").all()).toEqual([{ day: '2026-10-26' }]);
  expect(db.prepare("SELECT currency, timezone FROM stores WHERE id = 'pawsome'").get()).toEqual({ currency: 'EUR', timezone: 'Europe/Berlin' });
});

test("with Woo's Cost of Goods Sold on, orders, best sellers and products carry its costs", async () => {
  const db = setup();
  const fetchFn = (async (url: string) =>
    new URL(url).pathname.endsWith('/orders')
      ? Response.json([order('1001', 'processing', '30.00', true, { cost_of_goods_sold: { total_value: 9.5 }, line_items: [{ product_id: 7, quantity: 2, total: '25.00', cost_of_goods_sold: { value: 8 } }] })])
      : Response.json([{ id: 7, name: 'Travel Bowl', status: 'publish', price: '19.00', regular_price: '19.00', sale_price: '', stock_quantity: 5, date_modified_gmt: '2026-10-20T00:00:00', cost_of_goods_sold: { values: [{ defined_value: 4, effective_value: 4 }], total_value: 4 } }])) as typeof fetch;
  await syncWooCommerce(db, key, 'pawsome', fetchFn, NOW);
  expect(db.prepare("SELECT cogs FROM orders WHERE store_id = 'pawsome' AND id = 'woo-1001'").get()?.cogs).toBe(9.5);
  expect(db.prepare("SELECT cost FROM order_items WHERE store_id = 'pawsome' AND order_id = 'woo-1001'").get()?.cost).toBe(8);
  expect(db.prepare("SELECT cost FROM products WHERE store_id = 'pawsome' AND id = 'woo-7'").get()?.cost).toBe(4);
  expect(db.prepare("SELECT cogs FROM daily_metrics WHERE store_id = 'pawsome' AND date = '2026-10-25'").get()?.cogs).toBe(9.5);
});

test('a refund made while the sync was still reading is fetched by the next sync', async () => {
  const db = setup();
  // Order 1001 is read paid at 18:00; it's refunded at 18:01 (modified 18:01) while products are read, and a product
  // changed at 18:02 comes back last. The next sync must still ask for changes from before the refund.
  let refunded = false;
  const fetchFn = (async (url: string) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/orders')) {
      const o = refunded ? order('1001', 'refunded', '30.00', true, { date_modified_gmt: '2026-10-26T18:01:00' }) : order('1001', 'processing', '30.00', true);
      return Response.json(u.searchParams.get('modified_after')! <= o.date_modified_gmt ? [o] : [], { headers: { 'x-wp-totalpages': '1' } });
    }
    refunded = true;
    return Response.json([{ id: 7, name: 'Bowl', status: 'publish', price: '19.00', regular_price: '19.00', sale_price: '', stock_quantity: 5, date_modified_gmt: '2026-10-26T18:02:00' }], { headers: { 'x-wp-totalpages': '1' } });
  }) as typeof fetch;
  const day = () => db.prepare("SELECT revenue, orders FROM daily_metrics WHERE store_id = 'pawsome' AND date = '2026-10-25'").get();
  await syncWooCommerce(db, key, 'pawsome', fetchFn, NOW);
  expect(day()).toEqual({ revenue: 30, orders: 1 });
  await syncWooCommerce(db, key, 'pawsome', fetchFn, new Date('2026-10-26T18:10:00Z'));
  expect(day()).toEqual({ revenue: 0, orders: 0 });
});

test('a partly refunded Woo order counts what the customer kept', async () => {
  const db = setup();
  const woo = fakeWoo().fetchFn;
  const fetchFn = (async (url: string, init: RequestInit) =>
    new URL(url).pathname.endsWith('/orders')
      ? Response.json([order('2001', 'completed', '80.00', true, { refunds: [{ id: 9, reason: 'one mug broke', total: '-25.50' }] })], { headers: { 'x-wp-totalpages': '1' } })
      : woo(url, init)) as typeof fetch;
  await syncWooCommerce(db, key, 'pawsome', fetchFn, NOW);
  expect(db.prepare("SELECT total, status FROM orders WHERE store_id = 'pawsome' AND id = 'woo-2001'").get()).toEqual({ total: 54.5, status: 'paid' });
  expect(db.prepare("SELECT revenue FROM daily_metrics WHERE store_id = 'pawsome' AND date = '2026-10-25'").get()?.revenue).toBe(54.5);
});

test("orders a multi-currency plugin took in another currency are converted into the shop's own", async () => {
  const db = setup();
  db.prepare("INSERT INTO settings (key, value_json) VALUES ('fx', ?)").run(JSON.stringify({ date: '2026-10-23', fetchedAt: NOW.toISOString(), rates: { EUR: 1, USD: 1.25 } }));
  const fetchFn = (async (url: string) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/woocommerce_currency')) return Response.json({ id: 'woocommerce_currency', value: 'EUR' });
    if (u.pathname.endsWith('/orders')) {
      return Response.json([
        order('3001', 'processing', '20.00', true, { currency: 'USD', line_items: [{ product_id: 7, quantity: 1, total: '20.00' }] }), // newest first
        order('3002', 'processing', '30.00', true),
        order('3003', 'processing', '50.00', true, { currency: 'GBP' }), // no rate: left out
      ], { headers: { 'x-wp-totalpages': '1' } });
    }
    return Response.json([], { headers: { 'x-wp-totalpages': '1' } });
  }) as typeof fetch;
  await syncWooCommerce(db, key, 'pawsome', fetchFn, NOW);
  expect(db.prepare("SELECT currency FROM stores WHERE id = 'pawsome'").get()?.currency).toBe('EUR');
  expect(db.prepare("SELECT id, total FROM orders WHERE store_id = 'pawsome' ORDER BY id").all().map((r) => [r.id, r.total])).toEqual([['woo-3001', 16], ['woo-3002', 30]]);
  expect(db.prepare("SELECT revenue FROM order_items WHERE store_id = 'pawsome' AND order_id = 'woo-3001'").get()?.revenue).toBe(16);
});

test("WordPress' timezone setting as an IANA zone: a city, a whole-hour offset, else none", () => {
  expect(wpZone({ timezone_string: 'Europe/Berlin', gmt_offset: 2 })).toBe('Europe/Berlin');
  expect(wpZone({ timezone_string: '', gmt_offset: 0 })).toBe('UTC'); // a fresh WordPress install
  expect(wpZone({ timezone_string: '', gmt_offset: -5 })).toBe('Etc/GMT+5');
  expect(wpZone({ timezone_string: '', gmt_offset: '5.5' })).toBeUndefined();
  expect(wpZone({ timezone_string: 'Mars/Olympus' })).toBeUndefined();
  expect(wpZone(undefined)).toBeUndefined();
});

/** Fake Woo product API: records writes, serves products 41 (on sale 30, was 40), 42 (25, not on sale), 43 (variable). */
function fakeWooWrites(status = 200) {
  const writes: { method: string; path: string; body: unknown }[] = [];
  const products: Record<string, object> = {
    '41': { type: 'simple', regular_price: '40', sale_price: '30' },
    '42': { type: 'simple', regular_price: '25', sale_price: '' },
    '43': { type: 'variable', regular_price: '', sale_price: '' },
  };
  const fetchFn = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname.replace('/store/wp-json/wc/v3/', '');
    const method = init.method ?? 'GET';
    if (status !== 200) return Response.json({ code: 'woocommerce_rest_cannot_create', message: 'Sorry, you are not allowed to create resources.' }, { status });
    if (method === 'GET') return Response.json(products[path.split('/')[1]!]);
    writes.push({ method, path, body: JSON.parse(String(init.body)) });
    return Response.json({ id: 500 + writes.length });
  }) as typeof fetch;
  return { fetchFn, writes };
}

test('approved products become Woo drafts (sale price over regular for a compare-at); a read-only key says how to allow it', async () => {
  const db = setup();
  const { fetchFn, writes } = fakeWooWrites();
  const made = await createWooProducts(db, key, 'pawsome', [{ title: 'Paw Balm', price: 19.99, compareAt: 34.99, cost: 4 }, { title: 'Dog Bowl', price: 12 }], fetchFn);
  expect(made).toEqual([{ id: 'woo-501', title: 'Paw Balm' }, { id: 'woo-502', title: 'Dog Bowl' }]);
  expect(writes.map((w) => w.body)).toEqual([
    { name: 'Paw Balm', type: 'simple', status: 'draft', regular_price: '34.99', sale_price: '19.99' },
    { name: 'Dog Bowl', type: 'simple', status: 'draft', regular_price: '12' },
  ]);
  expect(db.prepare("SELECT price, compare_at, cost, status FROM products WHERE store_id = 'pawsome' AND id = 'woo-501'").get()).toEqual({ price: 19.99, compare_at: 34.99, cost: 4, status: 'draft' });
  await expect(createWooProducts(db, key, 'pawsome', [{ title: 'X', price: 5 }], fakeWooWrites(401).fetchFn)).rejects.toThrow('the key is read-only. Create a Read/Write key');
});

test('a Woo price change keeps, sets or clears the compare-at as asked, and leaves variable products alone', async () => {
  const db = setup();
  for (const id of ['woo-41', 'woo-42']) db.prepare("INSERT INTO products (store_id, id, title, price, compare_at, cost, inventory, status) VALUES ('pawsome', ?, 'p', 30, 40, 0, 1, 'active')").run(id);
  const { fetchFn, writes } = fakeWooWrites();
  const row = (id: string) => db.prepare("SELECT price, compare_at FROM products WHERE store_id = 'pawsome' AND id = ?").get(id);

  await setWooProductPrice(db, key, 'pawsome', 'woo-41', { price: 27 }, fetchFn); // on sale: the regular price stays the compare-at
  await setWooProductPrice(db, key, 'pawsome', 'woo-42', { price: 22 }, fetchFn); // not on sale: just the price
  await setWooProductPrice(db, key, 'pawsome', 'woo-42', { price: 22, compareAt: 35 }, fetchFn);
  await setWooProductPrice(db, key, 'pawsome', 'woo-41', { price: 27, compareAt: null }, fetchFn);
  expect(writes.map((w) => [w.path, w.body])).toEqual([
    ['products/41', { regular_price: '40', sale_price: '27' }],
    ['products/42', { regular_price: '22', sale_price: '' }],
    ['products/42', { regular_price: '35', sale_price: '22' }],
    ['products/41', { regular_price: '27', sale_price: '' }],
  ]);
  expect(row('woo-41')).toEqual({ price: 27, compare_at: null });
  expect(row('woo-42')).toEqual({ price: 22, compare_at: 35 });
  await expect(setWooProductPrice(db, key, 'pawsome', 'woo-43', { price: 10 }, fetchFn)).rejects.toThrow('is a variable product');
  await expect(setWooProductPrice(db, key, 'pawsome', '8001', { price: 10 }, fetchFn)).rejects.toThrow('not a WooCommerce product');
});

test("an approved product page replaces the Woo product's title and description", async () => {
  const db = setup();
  db.prepare("INSERT INTO products (store_id, id, title, price, cost, inventory, status) VALUES ('pawsome', 'woo-42', 'Old', 25, 0, 1, 'active')").run();
  const { fetchFn, writes } = fakeWooWrites();
  await publishWooProductPage(db, key, 'pawsome', 'woo-42', { title: 'Travel Bowl Pro', descriptionHtml: '<p>Folds flat</p>', seoTitle: 'ignored' }, fetchFn);
  expect(writes).toEqual([{ method: 'PUT', path: 'products/42', body: { name: 'Travel Bowl Pro', description: '<p>Folds flat</p>' } }]);
  expect(db.prepare("SELECT title FROM products WHERE store_id = 'pawsome' AND id = 'woo-42'").get()?.title).toBe('Travel Bowl Pro');
  expect(db.prepare("SELECT action, target FROM action_log WHERE store_id = 'pawsome'").all()).toEqual([{ action: 'product_page_publish', target: 'woo-42' }]);
});
