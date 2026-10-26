import { randomBytes } from 'node:crypto';
import { expect, test } from 'vitest';
import type { AnalyticsSummary, Integration, Order, Page, Product, Store } from '@frontline/shared';
import { createApp } from '../app';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { createProducts, fulfillmentOf, publishPage, publishProductPage, shopHost, syncShopify } from './shopify';

const key = randomBytes(32);
const TOKEN = 'shpat_fixture_token';
const NOW = new Date('2026-10-26T18:00:00Z');

const money = (amount: string) => ({ amount });
const order = (name: string, createdAt: string, total: string, extra: Record<string, unknown> = {}) => ({
  name, createdAt, updatedAt: createdAt, cancelledAt: null, test: false, displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'UNFULFILLED',
  currentTotalPriceSet: { shopMoney: money(total) }, fulfillments: [],
  lineItems: { nodes: [
    { quantity: 2, product: { id: 'gid://shopify/Product/111' }, discountedTotalSet: { shopMoney: money('80.00') }, variant: { inventoryItem: { unitCost: money('5.00') } } },
    { quantity: 1, product: null, discountedTotalSet: { shopMoney: money('4.00') }, variant: null }, // custom line item, e.g. gift wrap
  ] },
  ...extra,
});

const PRODUCT = {
  id: 'gid://shopify/Product/111', title: 'LED Light Therapy Mask', status: 'ACTIVE', updatedAt: '2026-10-20T10:00:00Z', totalInventory: 42,
  featuredMedia: { preview: { image: { url: 'https://cdn.shopify.com/mask.jpg' } } },
  variants: { nodes: [{ price: '89.99', compareAtPrice: '149.99', inventoryItem: { unitCost: money('28.00') } }] },
};

/** Fake Shopify: answers by query type, pages orders 2 at a time, records requests. */
function fakeShopify(orders: ReturnType<typeof order>[], status = 200) {
  const calls: { url: string; token: string | null; body: { query: string; variables: Record<string, unknown> } }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, token: new Headers(init.headers).get('x-shopify-access-token'), body });
    if (status !== 200) return new Response('nope', { status });
    const json = (data: unknown) => Response.json({ data });
    if (body.query.includes('shop {')) return json({ shop: { name: 'Glow Haus', currencyCode: 'EUR', ianaTimezone: 'Europe/Berlin' } });
    if (body.query.includes('products(')) return json({ products: { nodes: [PRODUCT], pageInfo: { hasNextPage: false, endCursor: null } } });
    const start = body.variables.after ? Number(body.variables.after) : 0;
    const nodes = orders.slice(start, start + 2);
    return json({ orders: { nodes, pageInfo: { hasNextPage: start + 2 < orders.length, endCursor: String(start + 2) } } });
  }) as typeof fetch;
  return { fetchFn, calls };
}

const setup = async () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  const app = createApp(db, key);
  await app.request('/api/integrations', { method: 'PUT', body: JSON.stringify({ kind: 'shopify', storeId: 'glow', values: { shopDomain: 'https://Glow-Haus.myshopify.com/', accessToken: TOKEN } }), headers: { 'content-type': 'application/json' } });
  return { db, app };
};

test('shopHost normalizes and only allows myshopify.com hosts', () => {
  expect(shopHost(' https://Glow-Haus.myshopify.com/admin ')).toBe('glow-haus.myshopify.com');
  expect(() => shopHost('evil.com')).toThrow('myshopify.com');
  expect(() => shopHost('glow.myshopify.com.evil.com')).toThrow();
});

test('fulfillment status prefers the shipment status', () => {
  expect(fulfillmentOf({ displayFulfillmentStatus: 'FULFILLED', fulfillments: [{ displayStatus: 'DELIVERED', trackingInfo: [] }] })).toBe('delivered');
  expect(fulfillmentOf({ displayFulfillmentStatus: 'FULFILLED', fulfillments: [{ displayStatus: 'IN_TRANSIT', trackingInfo: [] }] })).toBe('in_transit');
  expect(fulfillmentOf({ displayFulfillmentStatus: 'FULFILLED', fulfillments: [{ displayStatus: 'CONFIRMED', trackingInfo: [] }] })).toBe('fulfilled');
  expect(fulfillmentOf({ displayFulfillmentStatus: 'PARTIALLY_FULFILLED', fulfillments: [] })).toBe('unfulfilled');
});

test('first sync switches the store from demo to real data', async () => {
  const { db, app } = await setup();
  const { fetchFn, calls } = fakeShopify([
    // 23:30 UTC on Oct 24 is Oct 25 in Berlin
    order('#1001', '2026-10-24T23:30:00Z', '100.00', { displayFulfillmentStatus: 'FULFILLED', fulfillments: [{ displayStatus: 'IN_TRANSIT', trackingInfo: [{ number: 'TRK1' }] }] }),
    order('#1002', '2026-10-25T09:00:00Z', '50.00'),
    order('#1003', '2026-10-25T10:00:00Z', '80.00', { cancelledAt: '2026-10-25T11:00:00Z' }),
    order('#1004', '2026-10-26T08:00:00Z', '30.00', { test: true }),
    order('#1005', '2026-10-26T09:00:00Z', '40.00'),
  ]);
  await syncShopify(db, key, 'glow', fetchFn, NOW);

  expect(calls.every((c) => c.url === 'https://glow-haus.myshopify.com/admin/api/2026-07/graphql.json' && c.token === TOKEN)).toBe(true);
  expect(calls.find((c) => c.body.query.includes('orders('))!.body.variables.q).toBe("updated_at:>='2024-10-26T00:00:00Z'");

  const store = (await (await app.request('/api/stores/glow')).json()) as Store;
  expect(store).toMatchObject({ connected: true, currency: 'EUR', timezone: 'Europe/Berlin' });

  const products = (await (await app.request('/api/products?stores=glow')).json()) as Page<Product>;
  expect(products.items).toEqual([{ id: '111', storeId: 'glow', title: 'LED Light Therapy Mask', image: 'https://cdn.shopify.com/mask.jpg', price: 89.99, compareAt: 149.99, cost: 28, inventory: 42, status: 'active', margin: 68.89 }]);

  const orders = (await (await app.request('/api/orders?stores=glow')).json()) as Page<Order>;
  expect(orders.items.map((o) => [o.id, o.status, o.fulfillmentStatus])).toEqual([
    ['#1005', 'paid', 'unfulfilled'], ['#1003', 'refunded', 'unfulfilled'], ['#1002', 'paid', 'unfulfilled'], ['#1001', 'paid', 'in_transit'],
  ]);
  expect(orders.items.find((o) => o.id === '#1001')!.tracking).toBe('TRK1');

  // demo history is gone; real days are rebuilt from orders (cogs = 2 × $5 per order)
  const rows = db.prepare("SELECT date, revenue, cogs, orders, ad_spend AS adSpend FROM daily_metrics WHERE store_id = 'glow' ORDER BY date").all();
  expect(rows.map((r) => ({ ...r }))).toEqual([
    { date: '2026-10-25', revenue: 150, cogs: 20, orders: 2, adSpend: 0 },
    { date: '2026-10-26', revenue: 40, cogs: 10, orders: 1, adSpend: 0 },
  ]);
  expect(db.prepare("SELECT order_id, product_id, quantity, revenue, cost FROM order_items WHERE store_id = 'glow' AND order_id = '#1002'").all()).toEqual([
    { order_id: '#1002', product_id: '111', quantity: 2, revenue: 80, cost: 10 },
  ]);
  expect(db.prepare("SELECT count(*) AS n FROM order_items WHERE order_id = '#1004'").get()?.n).toBe(0); // test order skipped
  expect(db.prepare("SELECT count(*) AS n FROM campaigns WHERE store_id = 'glow'").get()?.n).toBe(0);
  expect(db.prepare("SELECT count(*) AS n FROM daily_metrics WHERE store_id = 'pawsome'").get()?.n).toBe(730);

  const integration = ((await (await app.request('/api/integrations?stores=glow')).json()) as Integration[])[0]!;
  expect(integration).toMatchObject({ status: 'connected', syncedAt: NOW.toISOString() });
});

test('later syncs are incremental and update changed orders in place', async () => {
  const { db } = await setup();
  await syncShopify(db, key, 'glow', fakeShopify([order('#1001', '2026-10-25T09:00:00Z', '100.00')]).fetchFn, NOW);
  const refunded = order('#1001', '2026-10-25T09:00:00Z', '0.00', { updatedAt: '2026-10-26T12:00:00Z', displayFinancialStatus: 'REFUNDED' });
  const second = fakeShopify([refunded]);
  await syncShopify(db, key, 'glow', second.fetchFn, NOW);
  expect(second.calls.find((c) => c.body.query.includes('orders('))!.body.variables.q).toBe("updated_at:>='2026-10-25T09:00:00Z'");
  expect(db.prepare("SELECT revenue, orders FROM daily_metrics WHERE store_id = 'glow' AND date = '2026-10-25'").get()).toEqual({ revenue: 0, orders: 0 });
});

test('a rejected token marks the integration as error without leaking it, and keeps demo data', async () => {
  const { db, app } = await setup();
  await syncShopify(db, key, 'glow', fakeShopify([], 401).fetchFn, NOW);
  const res = await (await app.request('/api/integrations?stores=glow')).text();
  expect(res).not.toContain(TOKEN);
  expect(JSON.parse(res)[0]).toMatchObject({ status: 'error', error: expect.stringContaining('rejected the access token') });
  const s = (await (await app.request('/api/analytics/summary?stores=glow&range=7')).json()) as AnalyticsSummary;
  expect(s.totals.revenue).toBeGreaterThan(0);
});

test('createProducts makes priced drafts in Shopify and shows them locally', async () => {
  const { db } = await setup();
  const calls: { query: string; variables: Record<string, unknown> }[] = [];
  let n = 0;
  const fetchFn = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push(body);
    if (body.query.includes('productCreate')) {
      if (body.variables.product.title === 'Bad') return Response.json({ data: { productCreate: { product: null, userErrors: [{ message: 'Title is invalid' }] } } });
      n++;
      return Response.json({ data: { productCreate: { product: { id: `gid://shopify/Product/90${n}`, variants: { nodes: [{ id: `gid://shopify/ProductVariant/80${n}` }] } }, userErrors: [] } } });
    }
    return Response.json({ data: { productVariantsBulkUpdate: { userErrors: [] } } });
  }) as typeof fetch;

  const created = await createProducts(db, key, 'glow', [{ title: 'Ice Roller', price: 24.9, compareAt: 39, cost: 6.5 }, { title: 'Gua Sha', price: 19 }], fetchFn);
  expect(created).toEqual([{ id: '901', title: 'Ice Roller' }, { id: '902', title: 'Gua Sha' }]);
  expect(calls[0]!.variables).toEqual({ product: { title: 'Ice Roller', status: 'DRAFT' } });
  expect(calls[1]!.variables).toEqual({ productId: 'gid://shopify/Product/901', variants: [{ id: 'gid://shopify/ProductVariant/801', price: '24.90', compareAtPrice: '39.00', inventoryItem: { cost: '6.50' } }] });
  expect(calls[3]!.variables.variants).toEqual([{ id: 'gid://shopify/ProductVariant/802', price: '19.00' }]);
  expect(db.prepare("SELECT title, price, compare_at, cost, status FROM products WHERE store_id = 'glow' AND id = '901'").get()).toEqual({ title: 'Ice Roller', price: 24.9, compare_at: 39, cost: 6.5, status: 'draft' });

  await expect(createProducts(db, key, 'glow', [{ title: 'Bad', price: 5 }], fetchFn)).rejects.toThrow('Shopify: Title is invalid');
  await expect(createProducts(db, key, 'peak', [{ title: 'X', price: 5 }], fetchFn)).rejects.toThrow('not connected');
});

test('publishProductPage updates the live product; publishPage creates a published page', async () => {
  const { db } = await setup();
  db.prepare("INSERT INTO products (store_id, id, title, price, cost, inventory, status) VALUES ('glow', '111', 'Old title', 10, 0, 0, 'active')").run();
  const calls: { query: string; variables: Record<string, unknown> }[] = [];
  const fetchFn = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push(body);
    if (body.query.includes('productUpdate')) return Response.json({ data: { productUpdate: { product: { id: 'x' }, userErrors: [] } } });
    if (body.variables.page.title === 'Bad') return Response.json({ data: { pageCreate: { page: null, userErrors: [{ message: 'Access denied for pageCreate' }] } } });
    return Response.json({ data: { pageCreate: { page: { id: 'gid://shopify/Page/77', handle: 'about-us' }, userErrors: [] } } });
  }) as typeof fetch;

  await publishProductPage(db, key, 'glow', '111', { title: 'LED Mask Pro', descriptionHtml: '<p>Glow</p>', seoTitle: 'LED Mask' }, fetchFn);
  expect(calls[0]!.variables).toEqual({ product: { id: 'gid://shopify/Product/111', title: 'LED Mask Pro', descriptionHtml: '<p>Glow</p>', seo: { title: 'LED Mask' } } });
  expect(db.prepare("SELECT title FROM products WHERE store_id = 'glow' AND id = '111'").get()).toEqual({ title: 'LED Mask Pro' });

  expect(await publishPage(db, key, 'glow', { title: 'About us', bodyHtml: '<h1>Hi</h1>' }, fetchFn)).toEqual({ id: '77', handle: 'about-us' });
  expect(calls[1]!.variables).toEqual({ page: { title: 'About us', body: '<h1>Hi</h1>', isPublished: true } });
  await expect(publishPage(db, key, 'glow', { title: 'Bad', bodyHtml: '' }, fetchFn)).rejects.toThrow('Shopify: Access denied');
  await expect(publishPage(db, key, 'peak', { title: 'X', bodyHtml: '' }, fetchFn)).rejects.toThrow('not connected');
});
