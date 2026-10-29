import { randomBytes } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import type { AnalyticsSummary, Integration, Order, Page, Product, Store } from '@frontline/shared';
import { createApp } from '../app';
import { openDb } from '../db';
import { saveIntegration } from '../integrations';
import { rebuildRevenue, switchToReal } from './common';
import { seedDemo } from '../demo';
import { listActions } from '../actions';
import { createProducts, deleteTheme, duplicateTheme, fulfillmentOf, funnelDays, listThemes, publishPage, publishProductPage, publishTheme, readThemeFiles, setProductPrice, shopHost, syncShopify, upsertThemeFiles , type NewProduct } from './shopify';
import { createWooProducts } from './woocommerce';

const key = randomBytes(32);
const TOKEN = 'shpat_fixture_token';
const NOW = new Date('2026-10-26T18:00:00Z');

const money = (amount: string) => ({ amount });
const order = (name: string, createdAt: string, total: string, extra: Record<string, unknown> = {}) => ({
  id: `gid://shopify/Order/${name.slice(1)}`, name, createdAt, updatedAt: createdAt, cancelledAt: null, test: false, displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'UNFULFILLED',
  currentTotalPriceSet: { shopMoney: money(total) }, fulfillments: [],
  lineItems: { nodes: [
    { quantity: 2, currentQuantity: 2, product: { id: 'gid://shopify/Product/111' }, discountedUnitPriceAfterAllDiscountsSet: { shopMoney: money('40.00') }, variant: { inventoryItem: { unitCost: money('5.00') } } },
    { quantity: 1, currentQuantity: 1, product: null, discountedUnitPriceAfterAllDiscountsSet: { shopMoney: money('4.00') }, variant: null }, // custom line item, e.g. gift wrap
  ], pageInfo: { hasNextPage: false, endCursor: null } },
  ...extra,
});

const PRODUCT = {
  id: 'gid://shopify/Product/111', title: 'LED Light Therapy Mask', status: 'ACTIVE', updatedAt: '2026-10-20T10:00:00Z', totalInventory: 42,
  featuredMedia: { preview: { image: { url: 'https://cdn.shopify.com/mask.jpg' } } },
  variants: { nodes: [{ price: '89.99', compareAtPrice: '149.99', inventoryItem: { unitCost: money('28.00') } }] },
};

/** Fake Shopify: answers by query type, pages orders 2 at a time, records requests. */
function fakeShopify(orders: ReturnType<typeof order>[], status = 200, funnel = false, deleted: string[] = []) {
  const calls: { url: string; token: string | null; body: { query: string; variables: Record<string, unknown> } }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, token: new Headers(init.headers).get('x-shopify-access-token'), body });
    if (status !== 200) return new Response('nope', { status });
    const json = (data: unknown) => Response.json({ data });
    if (body.query.includes('shop {')) return json({ shop: { name: 'Glow Haus', currencyCode: 'EUR', ianaTimezone: 'Europe/Berlin' } });
    if (body.query.includes('products(')) return json({ products: { nodes: [PRODUCT], pageInfo: { hasNextPage: false, endCursor: null } } });
    if (body.query.includes('refunds(')) return json({ order: { refunds: [] } });
    if (body.query.includes('events(')) return json({ events: { nodes: deleted.map((subjectId) => ({ subjectId })), pageInfo: { hasNextPage: false, endCursor: null } } });
    if (body.query.includes('shopifyqlQuery')) {
      if (!funnel) return Response.json({ errors: [{ message: 'Access denied for shopifyqlQuery field.' }] });
      const columns = ['day', 'sessions', 'sessions_with_cart_additions', 'sessions_that_reached_checkout'].map((name) => ({ name, dataType: 'INTEGER' }));
      // Bot visits on the 25th; the 26th has no human/bot verdict.
      if (body.variables.q.includes("WHERE human_or_bot_session = 'bot'")) return json({ shopifyqlQuery: { parseErrors: [], tableData: { columns, rows: [['2026-10-25', '20', '1', '0']] } } });
      return json({ shopifyqlQuery: { parseErrors: [], tableData: { columns, rows: [['2026-10-25', '120', '14', '6'], ['2026-10-26', 80, 9, 4]] } } });
    }
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

test("Shopify next to a store's own platform dates its orders on the store's days, and an unknown shop zone doesn't stop the sync", async () => {
  const { db } = await setup();
  switchToReal(db, 'glow');
  db.prepare("UPDATE stores SET platform = 'woocommerce', currency = 'EUR', timezone = 'America/Chicago' WHERE id = 'glow'").run();
  db.prepare("INSERT INTO integrations (id, kind, store_id, status, settings_json, encrypted_credentials, updated_at, synced_at) VALUES ('woocommerce:glow', 'woocommerce', 'glow', 'connected', '{}', '', '2026-10-26T00:00:00Z', '2026-10-26T00:00:00Z')").run();
  await syncShopify(db, key, 'glow', fakeShopify([order('#1001', '2026-10-25T23:30:00Z', '44.00')]).fetchFn, NOW);
  // 23:30 UTC: the 26th in Berlin (the shop), still the 25th in Chicago (the store).
  expect(db.prepare("SELECT local_date FROM orders WHERE store_id = 'glow' AND id = '#1001'").get()?.local_date).toBe('2026-10-25');

  const lone = (await setup()).db;
  const fake = fakeShopify([order('#1001', '2026-10-25T23:30:00Z', '44.00')]);
  const fetchFn = (async (url: string, init: RequestInit) =>
    String(init.body).includes('shop {') ? Response.json({ data: { shop: { name: 'Glow Haus', currencyCode: 'EUR', ianaTimezone: 'America/Nowhere' } } }) : fake.fetchFn(url, init)) as typeof fetch;
  await syncShopify(lone, key, 'glow', fetchFn, NOW);
  expect(lone.prepare("SELECT status FROM integrations WHERE id = 'shopify:glow'").get()?.status).toBe('connected');
});

test("a re-sync after Shopify's unit cost changed keeps the order's stored cogs; the new cost is recorded once (SA-26)", async () => {
  const { db } = await setup();
  await syncShopify(db, key, 'glow', fakeShopify([order('#1001', '2026-10-25T09:00:00Z', '100.00')]).fetchFn, NOW);
  const cogs = () => db.prepare("SELECT cogs FROM orders WHERE store_id = 'glow' AND id = '#1001'").get()?.cogs;
  expect(cogs()).toBe(10);
  const later = order('#1001', '2026-10-25T09:00:00Z', '100.00', { updatedAt: '2026-10-26T12:00:00Z' });
  later.lineItems.nodes[0]!.variant = { inventoryItem: { unitCost: money('7.00') } };
  await syncShopify(db, key, 'glow', fakeShopify([later]).fetchFn, NOW);
  expect(cogs()).toBe(10);
  expect(db.prepare("SELECT cost, source, effective_from FROM unit_costs WHERE store_id = 'glow' AND product_id = '111'").all()).toEqual([{ cost: 28, source: 'shopify', effective_from: '2026-10-26' }]);
});

test('shopHost normalizes and only allows myshopify.com hosts', () => {
  expect(shopHost(' https://Glow-Haus.myshopify.com/admin ')).toBe('glow-haus.myshopify.com');
  // The address the Shopify admin shows today names the shop too.
  expect(shopHost('https://admin.shopify.com/store/glow-haus')).toBe('glow-haus.myshopify.com');
  expect(shopHost('admin.shopify.com/store/Glow-Haus/products?x=1')).toBe('glow-haus.myshopify.com');
  expect(() => shopHost('https://admin.shopify.com/settings')).toThrow('myshopify.com');
  expect(() => shopHost('https://evil.com/store/glow-haus')).toThrow('myshopify.com');
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
    order('#1001', '2026-10-24T23:30:00Z', '100.00', { displayFulfillmentStatus: 'FULFILLED', fulfillments: [{ displayStatus: 'IN_TRANSIT', trackingInfo: [{ number: 'TRK1', url: 'https://www.ups.com/track?tracknum=TRK1' }] }] }),
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
  expect(orders.items.find((o) => o.id === '#1001')).toMatchObject({ tracking: 'TRK1', trackingUrl: 'https://www.ups.com/track?tracknum=TRK1' }); // the carrier's own page

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
  const first = fakeShopify([order('#1001', '2026-10-25T09:00:00Z', '100.00')]);
  await syncShopify(db, key, 'glow', first.fetchFn, NOW);
  expect(first.calls.find((c) => c.body.query.includes('products(first: 50'))!.body.variables.q).toBeNull(); // every product, however old
  const refunded = order('#1001', '2026-10-25T09:00:00Z', '0.00', { updatedAt: '2026-10-26T12:00:00Z', displayFinancialStatus: 'REFUNDED' });
  const second = fakeShopify([refunded]);
  await syncShopify(db, key, 'glow', second.fetchFn, NOW);
  expect(second.calls.find((c) => c.body.query.includes('orders('))!.body.variables.q).toBe("updated_at:>='2026-10-26T17:55:00Z'");
  expect(second.calls.find((c) => c.body.query.includes('products(first: 50'))!.body.variables.q).toBe("updated_at:>='2026-10-26T17:55:00Z'");
  // Thumbnails, not the multi-megabyte originals.
  expect(second.calls.find((c) => c.body.query.includes('products('))!.body.query).toContain('url(transform: { maxWidth: 480 })');
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

  const created = await createProducts(db, key, 'glow', [{ title: 'Ice Roller', price: 24.9, compareAt: 39, cost: 6.5 }, { title: 'Gua Sha', price: 19, compareAt: 0 }], fetchFn); // 0: none
  expect(created).toEqual([{ id: '901', title: 'Ice Roller' }, { id: '902', title: 'Gua Sha' }]);
  expect(calls[0]!.variables).toEqual({ product: { title: 'Ice Roller', status: 'DRAFT' } });
  expect(calls[1]!.variables).toEqual({ productId: 'gid://shopify/Product/901', variants: [{ id: 'gid://shopify/ProductVariant/801', price: '24.90', compareAtPrice: '39.00', inventoryItem: { cost: '6.50' } }] });
  expect(calls[3]!.variables.variants).toEqual([{ id: 'gid://shopify/ProductVariant/802', price: '19.00' }]);
  expect(db.prepare("SELECT title, price, compare_at, cost, status FROM products WHERE store_id = 'glow' AND id = '901'").get()).toEqual({ title: 'Ice Roller', price: 24.9, compare_at: 39, cost: 6.5, status: 'draft' });
  expect(db.prepare("SELECT compare_at FROM products WHERE store_id = 'glow' AND id = '902'").get()?.compare_at).toBeNull();

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
  expect(listActions(db, ['glow'], 10).map((a) => [a.action, a.target, a.ok])).toEqual([['page_publish', 'Bad', false], ['page_publish', 'About us', true], ['product_page_publish', '111', true]]);
});

test('setProductPrice reprices every variant and the local product', async () => {
  const { db } = await setup();
  db.prepare("INSERT INTO products (store_id, id, title, price, compare_at, cost, inventory, status) VALUES ('glow', '111', 'Mask', 49, 79, 0, 0, 'active')").run();
  const calls: { query: string; variables: Record<string, unknown> }[] = [];
  let live: string | undefined; // the price in Shopify's admin; as synced unless set
  const fetchFn = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push(body);
    if (body.query.includes('variants(first')) {
      const now = live ?? Number(local()?.price).toFixed(2);
      const xl = body.variables.id.endsWith('/777') ? '25.00' : now;
      return Response.json({ data: { product: body.variables.id.endsWith('/404') ? null : { variants: { nodes: [{ id: 'gid://shopify/ProductVariant/1', price: now }, { id: 'gid://shopify/ProductVariant/2', price: xl }], pageInfo: { hasNextPage: body.variables.id.endsWith('/999') } } } } });
    }
    const bad = body.variables.variants[0].price === '1.00';
    return Response.json({ data: { productVariantsBulkUpdate: { userErrors: bad ? [{ message: 'Price is too low' }] : [] } } });
  }) as typeof fetch;
  const local = () => db.prepare("SELECT price, compare_at AS compareAt FROM products WHERE store_id = 'glow' AND id = '111'").get();

  await setProductPrice(db, key, 'glow', '111', { price: 44 }, fetchFn);
  expect(calls[0]!.variables).toEqual({ id: 'gid://shopify/Product/111' });
  expect(calls[1]!.variables).toEqual({ productId: 'gid://shopify/Product/111', variants: [{ id: 'gid://shopify/ProductVariant/1', price: '44.00' }, { id: 'gid://shopify/ProductVariant/2', price: '44.00' }] });
  expect(local()).toEqual({ price: 44, compareAt: 79 });

  await setProductPrice(db, key, 'glow', '111', { price: 39.5, compareAt: null }, fetchFn);
  expect((calls[3]!.variables.variants as unknown[])[0]).toEqual({ id: 'gid://shopify/ProductVariant/1', price: '39.50', compareAtPrice: null });
  expect(local()).toEqual({ price: 39.5, compareAt: null });

  calls.length = 0;
  await expect(setProductPrice(db, key, 'glow', '111', { price: 0 }, fetchFn)).rejects.toThrow('more than 0');
  await expect(setProductPrice(db, key, 'glow', '111', { price: 10, compareAt: Number.NaN }, fetchFn)).rejects.toThrow('Compare-at');
  expect(calls).toHaveLength(0);
  await expect(setProductPrice(db, key, 'glow', '404', { price: 10 }, fetchFn)).rejects.toThrow('Shopify: product 404 not found');
  await expect(setProductPrice(db, key, 'glow', '999', { price: 10 }, fetchFn)).rejects.toThrow('over 250 variants');
  await expect(setProductPrice(db, key, 'glow', '777', { price: 10 }, fetchFn)).rejects.toThrow("product 777's variants have different prices");
  expect(calls.some((c) => c.query.includes('productVariantsBulkUpdate'))).toBe(false);
  await expect(setProductPrice(db, key, 'glow', '111', { price: 1 }, fetchFn)).rejects.toThrow('Shopify: Price is too low');
  expect(local()).toEqual({ price: 39.5, compareAt: null });
  expect(listActions(db, ['glow'], 10).map((a) => [a.action, a.target, a.detail, a.ok])).toEqual([
    ['price_change', '111', { price: 1 }, false],
    ['price_change', '777', { price: 10 }, false],
    ['price_change', '999', { price: 10 }, false],
    ['price_change', '404', { price: 10 }, false],
    ['price_change', '111', { price: 39.5, compareAt: null }, true],
    ['price_change', '111', { price: 44 }, true],
  ]);
  await expect(setProductPrice(db, key, 'peak', '111', { price: 10 }, fetchFn)).rejects.toThrow('not connected');
  // Raised to 35 in Shopify since the last sync: "39.50 → 40" approved on the synced price would be another change there.
  live = '35.00';
  calls.length = 0;
  await expect(setProductPrice(db, key, 'glow', '111', { price: 40 }, fetchFn)).rejects.toThrow('Shopify: the price of 111 is 35 there now, not 39.5 as last synced');
  expect(calls.some((c) => c.query.includes('productVariantsBulkUpdate'))).toBe(false);
  live = '39.70'; // within 1%: a rounding difference, not a change
  await setProductPrice(db, key, 'glow', '111', { price: 40 }, fetchFn);
});

test('a Dev Dashboard app connects with client credentials; the 24 h token is cached and renewed', async () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  const app = createApp(db, key);
  const res = await app.request('/api/integrations', { method: 'PUT', body: JSON.stringify({ kind: 'shopify', storeId: 'glow', values: { shopDomain: 'glow-haus.myshopify.com', clientId: 'cid', clientSecret: 'shpss_1' } }), headers: { 'content-type': 'application/json' } });
  expect(res.status).toBe(200);
  const shop = fakeShopify([]);
  const grants: string[] = [];
  let refuse = false;
  const revoked = new Set<string>();
  const fetchFn = (async (url: string, init: RequestInit) => {
    if (!url.endsWith('/admin/oauth/access_token')) {
      return revoked.has(new Headers(init.headers).get('x-shopify-access-token')!) ? new Response('', { status: 401 }) : shop.fetchFn(url, init);
    }
    grants.push(`${url} ${init.body}`);
    if (refuse) return Response.json({ error: 'invalid_client', error_description: 'Client authentication failed' }, { status: 401 });
    return Response.json({ access_token: `tok-${grants.length}`, scope: 'read_products,read_orders', expires_in: 86399 });
  }) as typeof fetch;

  await syncShopify(db, key, 'glow', fetchFn, new Date('2026-10-26T12:00:00Z'));
  expect(grants).toEqual(['https://glow-haus.myshopify.com/admin/oauth/access_token grant_type=client_credentials&client_id=cid&client_secret=shpss_1']);
  expect(new Set(shop.calls.map((c) => c.token))).toEqual(new Set(['tok-1']));
  expect(db.prepare("SELECT status FROM integrations WHERE id = 'shopify:glow'").get()).toEqual({ status: 'connected' });

  await syncShopify(db, key, 'glow', fetchFn, new Date('2026-10-27T11:50:00Z')); // 23 h 50 min later: cached
  expect(grants).toHaveLength(1);
  await syncShopify(db, key, 'glow', fetchFn, new Date('2026-10-27T11:57:00Z')); // under 5 min left: renewed
  expect(grants).toHaveLength(2);
  expect(shop.calls.at(-1)!.token).toBe('tok-2');

  // Shopify drops the cached token early (app reinstalled): it is renewed once and the call goes through.
  revoked.add('tok-2');
  await syncShopify(db, key, 'glow', fetchFn, new Date('2026-10-27T12:00:00Z'));
  expect(grants).toHaveLength(3);
  expect(db.prepare("SELECT status FROM integrations WHERE id = 'shopify:glow'").get()).toEqual({ status: 'connected' });

  refuse = true;
  await syncShopify(db, key, 'glow', fetchFn, new Date('2026-10-29T00:00:00Z'));
  expect(db.prepare("SELECT status, error FROM integrations WHERE id = 'shopify:glow'").get()).toMatchObject({ status: 'error', error: expect.stringContaining('Client authentication failed') });

  const bare = await app.request('/api/integrations', { method: 'PUT', body: JSON.stringify({ kind: 'shopify', storeId: 'glow', values: { shopDomain: 'glow-haus.myshopify.com', clientId: '' } }), headers: { 'content-type': 'application/json' } });
  expect([bare.status, await bare.json()]).toEqual([400, { error: 'Enter the client ID and secret (or an Admin API access token)' }]);
});

test('createProducts logs each product; a failure part-way names the drafts already made', async () => {
  const { db } = await setup();
  let n = 0;
  const fetchFn = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (body.query.includes('productCreate')) {
      if (body.variables.product.title === 'Bad') return Response.json({ data: { productCreate: { product: null, userErrors: [{ message: 'Title is invalid' }] } } });
      n++;
      return Response.json({ data: { productCreate: { product: { id: `gid://shopify/Product/90${n}`, variants: { nodes: [{ id: `gid://shopify/ProductVariant/80${n}` }] } }, userErrors: [] } } });
    }
    return Response.json({ data: { productVariantsBulkUpdate: { userErrors: [] } } });
  }) as typeof fetch;
  await expect(createProducts(db, key, 'glow', [{ title: 'Roller', price: 20 }, { title: 'Mask', price: 50 }, { title: 'Bad', price: 5 }], fetchFn)).rejects.toThrow(
    'Shopify: Title is invalid (already created as drafts: Roller, Mask)',
  );
  expect(listActions(db, ['glow'], 10).map((a) => [a.target, a.ok])).toEqual([['Bad', false], ['Mask', true], ['Roller', true]]);
  expect(db.prepare("SELECT title FROM products WHERE store_id = 'glow' AND id IN ('901', '902') ORDER BY id").all()).toEqual([{ title: 'Roller' }, { title: 'Mask' }]);
});

test("createProducts names a product Shopify made but couldn't price, even when it's the first", async () => {
  const { db } = await setup();
  const fetchFn = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (body.query.includes('productCreate')) return Response.json({ data: { productCreate: { product: { id: 'gid://shopify/Product/911', variants: { nodes: [{ id: 'gid://shopify/ProductVariant/811' }] } }, userErrors: [] } } });
    return Response.json({ data: { productVariantsBulkUpdate: { userErrors: [{ message: 'Price must be greater than 0' }] } } });
  }) as typeof fetch;
  await expect(createProducts(db, key, 'glow', [{ title: 'Roller', price: 20 }], fetchFn)).rejects.toThrow(
    'Shopify: Price must be greater than 0 (already created as drafts: Roller, without its price: set it in Shopify rather than adding it again)',
  );
});

test('themes: list, read, copy, edit the copy (never the live theme), publish', async () => {
  const { db } = await setup();
  const calls: { query: string; variables: Record<string, unknown> }[] = [];
  const node = (id: number, role: string) => ({ id: `gid://shopify/OnlineStoreTheme/${id}`, name: role === 'MAIN' ? 'Dawn' : 'Copy of Dawn', role, processing: false });
  const fetchFn = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push(body);
    const q: string = body.query;
    if (q.includes('themes(')) return Response.json({ data: { themes: { nodes: [node(1, 'MAIN'), node(2, 'UNPUBLISHED')] } } });
    if (q.includes('files(')) {
      return Response.json({ data: { theme: body.variables.id.endsWith('/404') ? null : { files: { nodes: [{ filename: 'sections/hero.liquid', body: { content: '<h1>{{ section.settings.title }}</h1>' } }, { filename: 'assets/logo.png', body: {} }] } } } });
    }
    if (q.includes('themeDuplicate')) return Response.json({ data: { themeDuplicate: { newTheme: { ...node(3, 'UNPUBLISHED'), processing: true }, userErrors: [] } } });
    if (q.includes('themeFilesUpsert')) return Response.json({ data: { themeFilesUpsert: { upsertedThemeFiles: body.variables.files.map((f: { filename: string }) => ({ filename: f.filename })), userErrors: [] } } });
    if (q.includes('themePublish')) return Response.json({ data: { themePublish: { theme: node(3, 'MAIN'), userErrors: [] } } });
    return Response.json({ data: { theme: body.variables.id.endsWith('/1') ? node(1, 'MAIN') : node(3, 'UNPUBLISHED') } });
  }) as typeof fetch;

  expect(await listThemes(db, key, 'glow', fetchFn)).toEqual([
    { id: '1', name: 'Dawn', role: 'MAIN', processing: false, previewUrl: 'https://glow-haus.myshopify.com/?preview_theme_id=1' },
    { id: '2', name: 'Copy of Dawn', role: 'UNPUBLISHED', processing: false, previewUrl: 'https://glow-haus.myshopify.com/?preview_theme_id=2' },
  ]);
  expect(await readThemeFiles(db, key, 'glow', '1', ['sections/*', 'assets/logo.png'], fetchFn)).toEqual([
    { filename: 'sections/hero.liquid', content: '<h1>{{ section.settings.title }}</h1>' },
    { filename: 'assets/logo.png', content: null },
  ]);
  expect(calls.at(-1)!.variables).toEqual({ id: 'gid://shopify/OnlineStoreTheme/1', filenames: ['sections/*', 'assets/logo.png'] });
  await expect(readThemeFiles(db, key, 'glow', '404', ['layout/theme.liquid'], fetchFn)).rejects.toThrow('theme 404 not found');
  await expect(readThemeFiles(db, key, 'glow', '1', [], fetchFn)).rejects.toThrow('1 to 50');

  expect(await duplicateTheme(db, key, 'glow', '1', 'Frontline draft', fetchFn)).toMatchObject({ id: '3', role: 'UNPUBLISHED', processing: true });
  const files = [{ filename: 'sections/hero.liquid', body: '<h1>New</h1>' }];
  await expect(upsertThemeFiles(db, key, 'glow', '1', files, fetchFn)).rejects.toThrow('"Dawn" is the live theme');
  expect(calls.some((c) => c.query.includes('themeFilesUpsert'))).toBe(false);
  expect(await upsertThemeFiles(db, key, 'glow', '3', files, fetchFn)).toEqual(['sections/hero.liquid']);
  expect(calls.at(-1)!.variables).toEqual({ themeId: 'gid://shopify/OnlineStoreTheme/3', files: [{ filename: 'sections/hero.liquid', body: { type: 'TEXT', value: '<h1>New</h1>' } }] });
  expect(await publishTheme(db, key, 'glow', '3', fetchFn)).toMatchObject({ id: '3', role: 'MAIN' });

  expect(listActions(db, ['glow'], 10).map((a) => [a.action, a.target, a.ok])).toEqual([
    ['theme_publish', '3', true],
    ['theme_files', '3', true],
    ['theme_duplicate', '1', true],
  ]);
});

test('deleteTheme removes a draft and refuses the live theme', async () => {
  const { db } = await setup();
  const calls: string[] = [];
  const fetchFn = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push(body.query);
    if (body.query.includes('themeDelete')) return Response.json({ data: { themeDelete: { deletedThemeId: body.variables.id, userErrors: [] } } });
    const id: string = body.variables.id;
    if (id.endsWith('/404')) return Response.json({ data: { theme: null } });
    return Response.json({ data: { theme: { id, name: id.endsWith('/1') ? 'Dawn' : 'Frontline draft', role: id.endsWith('/1') ? 'MAIN' : 'UNPUBLISHED', processing: false } } });
  }) as typeof fetch;

  await expect(deleteTheme(db, key, 'glow', '1', fetchFn)).rejects.toThrow('"Dawn" is the live theme');
  await expect(deleteTheme(db, key, 'glow', '404', fetchFn)).rejects.toThrow('theme 404 not found');
  expect(calls.some((q) => q.includes('themeDelete'))).toBe(false);
  await deleteTheme(db, key, 'glow', '3', fetchFn);
  expect(calls.filter((q) => q.includes('themeDelete'))).toHaveLength(1);
  expect(listActions(db, ['glow'], 10).map((a) => [a.action, a.target, a.detail, a.ok])).toEqual([['theme_delete', '3', { name: 'Frontline draft' }, true]]);
});

test('an order with more than 10 line items gets the rest before its cogs and best sellers are counted', async () => {
  const { db } = await setup();
  const item = (n: number) => ({ quantity: 1, currentQuantity: 1, product: { id: `gid://shopify/Product/${n}` }, discountedUnitPriceAfterAllDiscountsSet: { shopMoney: money('10.00') }, variant: { inventoryItem: { unitCost: money('2.00') } } });
  const big = order('#2001', '2026-10-26T09:00:00Z', '120.00', { lineItems: { nodes: Array.from({ length: 10 }, (_, i) => item(i + 1)), pageInfo: { hasNextPage: true, endCursor: 'c10' } } });
  const shop = fakeShopify([big]).fetchFn;
  const asked: unknown[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (!body.query.includes('order(id:')) return shop(url, init);
    asked.push(body.variables);
    return Response.json({ data: { order: { lineItems: { nodes: [item(11), item(12)], pageInfo: { hasNextPage: false, endCursor: null } } } } });
  }) as typeof fetch;
  await syncShopify(db, key, 'glow', fetchFn, NOW);
  expect(asked).toEqual([{ id: 'gid://shopify/Order/2001', after: 'c10' }]);
  expect(db.prepare("SELECT cogs FROM orders WHERE store_id = 'glow' AND id = '#2001'").get()?.cogs).toBe(24);
  expect(db.prepare("SELECT count(*) AS n FROM order_items WHERE store_id = 'glow' AND order_id = '#2001'").get()?.n).toBe(12);
});

test('a throttled query waits for the cost bucket to refill and runs again instead of failing the sync', async () => {
  const { db } = await setup();
  const shop = fakeShopify([order('#1001', '2026-10-25T09:00:00Z', '100.00')]).fetchFn;
  let throttled = 0;
  const fetchFn = (async (url: string, init: RequestInit) => {
    if (!String(init.body).includes('orders(') || throttled++) return shop(url, init);
    return Response.json({
      errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }],
      extensions: { cost: { requestedQueryCost: 938, actualQueryCost: null, throttleStatus: { maximumAvailable: 2000, currentlyAvailable: 638, restoreRate: 100 } } },
    });
  }) as typeof fetch;
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  try {
    const sync = syncShopify(db, key, 'glow', fetchFn, NOW);
    await vi.advanceTimersByTimeAsync(2999); // (938 - 638) / 100 = 3 s
    expect(throttled).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await sync;
  } finally {
    vi.useRealTimers();
  }
  expect(throttled).toBe(2);
  expect(db.prepare("SELECT status, error FROM integrations WHERE id = 'shopify:glow'").get()).toMatchObject({ status: 'connected', error: null });
  expect(db.prepare("SELECT count(*) AS n FROM orders WHERE store_id = 'glow' AND id = '#1001'").get()?.n).toBe(1);
});

test('a first sync that stops partway keeps the order pages it saved, and the next one resumes from there', async () => {
  const { db, app } = await setup();
  const backfill = async () => ((await (await app.request('/api/integrations?stores=glow')).json()) as Integration[]).find((i) => i.kind === 'shopify')!.backfill;
  expect(await backfill()).toBeUndefined();
  const orders = [order('#1001', '2026-10-20T09:00:00Z', '10.00'), order('#1002', '2026-10-21T09:00:00Z', '20.00'), order('#1003', '2026-10-22T09:00:00Z', '30.00')];
  const shop = fakeShopify(orders).fetchFn;
  const dropsOnPage2 = (async (url: string, init: RequestInit) => (JSON.parse(String(init.body)).variables.after === '2' ? new Response('down', { status: 502 }) : shop(url, init))) as typeof fetch;
  await syncShopify(db, key, 'glow', dropsOnPage2, NOW);
  expect(db.prepare("SELECT id FROM orders WHERE store_id = 'glow' ORDER BY id").all().map((r) => r.id)).toEqual(['#1001', '#1002']);
  expect(db.prepare("SELECT status, cursor FROM integrations WHERE id = 'shopify:glow'").get()).toMatchObject({ status: 'error', cursor: '2026-10-21T09:00:00Z' });
  expect(await backfill()).toEqual({ through: '2026-10-21', done: false });

  const { fetchFn, calls } = fakeShopify(orders.slice(1));
  await syncShopify(db, key, 'glow', fetchFn, NOW);
  expect(calls.find((c) => c.body.query.includes('orders('))!.body.variables.q).toBe("updated_at:>='2026-10-21T09:00:00Z'");
  expect(db.prepare("SELECT count(*) AS n FROM orders WHERE store_id = 'glow'").get()?.n).toBe(3);
  expect(db.prepare("SELECT status, cursor FROM integrations WHERE id = 'shopify:glow'").get()).toMatchObject({ status: 'connected', cursor: '2026-10-26T17:55:00Z' });
  expect(await backfill()).toEqual({ through: '2026-10-26', done: true });
});

test('only paid orders count as revenue: unpaid ones stay out, and one that expires unpaid drops out', async () => {
  const { db } = await setup();
  const day = '2026-10-25T09:00:00Z';
  const statuses = ['PAID', 'PARTIALLY_REFUNDED', 'PENDING', 'AUTHORIZED', 'PARTIALLY_PAID', 'EXPIRED', 'VOIDED'];
  await syncShopify(db, key, 'glow', fakeShopify(statuses.map((s, i) => order(`#20${i}`, day, '100.00', { displayFinancialStatus: s }))).fetchFn, NOW);
  const revenue = () => db.prepare("SELECT revenue, orders FROM daily_metrics WHERE store_id = 'glow' AND date = '2026-10-25'").get();
  expect(revenue()).toEqual({ revenue: 200, orders: 2 });
  expect(db.prepare("SELECT id, status FROM orders WHERE store_id = 'glow' ORDER BY id").all().map((r) => `${r.id} ${r.status}`)).toEqual(['#200 paid', '#201 paid', '#205 refunded', '#206 refunded']);

  // Stored by an older build as paid, then it expires: the next sync takes it out.
  db.prepare("INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, cogs, local_date) VALUES ('glow', '#300', ?, 50, 'paid', 'unfulfilled', 0, '2026-10-25')").run(day);
  rebuildRevenue(db, 'glow', ['2026-10-25']);
  expect(revenue()).toEqual({ revenue: 250, orders: 3 });
  await syncShopify(db, key, 'glow', fakeShopify([order('#300', day, '50.00', { displayFinancialStatus: 'PENDING', updatedAt: '2026-10-26T10:00:00Z' })]).fetchFn, NOW);
  expect(revenue()).toEqual({ revenue: 200, orders: 2 });
  await syncShopify(db, key, 'glow', fakeShopify([order('#300', day, '50.00', { updatedAt: '2026-10-26T11:00:00Z' })]).fetchFn, NOW); // paid at last
  expect(revenue()).toEqual({ revenue: 250, orders: 3 });
});

test("without GA4, the funnel comes from Shopify's analytics; without its scope, orders still sync", async () => {
  const { db } = await setup();
  const funnel = () => db.prepare("SELECT date, sessions, add_to_carts AS carts, checkouts FROM daily_metrics WHERE store_id = 'glow' AND date >= '2026-10-25' ORDER BY date").all();
  await syncShopify(db, key, 'glow', fakeShopify([order('#1', '2026-10-25T09:00:00Z', '10.00')]).fetchFn, NOW);
  expect(db.prepare("SELECT status FROM integrations WHERE id = 'shopify:glow'").get()?.status).toBe('connected');
  expect(funnel().every((d) => !d.sessions)).toBe(true);

  // The scope added later: the first read that works covers the whole backfill window, later ones the last 3 days.
  const ql = (c: { body: { query: string; variables: Record<string, unknown> } }[]) => c.filter((x) => x.body.query.includes('shopifyqlQuery')).map((x) => x.body.variables.q);
  const { fetchFn, calls } = fakeShopify([], 200, true);
  await syncShopify(db, key, 'glow', fetchFn, NOW);
  expect(ql(calls)).toEqual([
    'FROM sessions SHOW sessions, sessions_with_cart_additions, sessions_that_reached_checkout TIMESERIES day SINCE -730d ORDER BY day ASC',
    "FROM sessions SHOW sessions, sessions_with_cart_additions, sessions_that_reached_checkout WHERE human_or_bot_session = 'bot' TIMESERIES day SINCE -730d ORDER BY day ASC",
  ]);
  const again = fakeShopify([], 200, true);
  await syncShopify(db, key, 'glow', again.fetchFn, NOW);
  expect(ql(again.calls)[0]).toBe('FROM sessions SHOW sessions, sessions_with_cart_additions, sessions_that_reached_checkout TIMESERIES day SINCE -3d ORDER BY day ASC');
  // Bot visits come off; a day Shopify didn't classify keeps its total.
  expect(funnel()).toEqual([
    { date: '2026-10-25', sessions: 100, carts: 13, checkouts: 6 },
    { date: '2026-10-26', sessions: 80, carts: 9, checkouts: 4 },
  ]);
});

test('ShopifyQL rows read the same as arrays or as objects, and rows without a day are skipped', () => {
  const columns = [{ name: 'day' }, { name: 'sessions' }, { name: 'sessions_with_cart_additions' }, { name: 'sessions_that_reached_checkout' }];
  const day = { date: '2026-10-25', sessions: 5, carts: 2, checkouts: 1 };
  expect(funnelDays({ columns, rows: [['2026-10-25T00:00:00-05:00', 5, 2, 1]] })).toEqual([day]);
  expect(funnelDays({ columns, rows: [{ day: '2026-10-25', sessions: '5', sessions_with_cart_additions: '2', sessions_that_reached_checkout: '1' }, { day: null }] })).toEqual([day]);
  expect(funnelDays(null)).toEqual([]);
});

test("a product whose stock Shopify doesn't track reads as untracked, not sold out", async () => {
  const { db, app } = await setup();
  const shop = fakeShopify([]).fetchFn;
  const fetchFn = (async (url: string, init: RequestInit) =>
    String(init.body).includes('products(')
      ? Response.json({ data: { products: { nodes: [{ ...PRODUCT, totalInventory: 0, tracksInventory: false }], pageInfo: { hasNextPage: false, endCursor: null } } } })
      : shop(url, init)) as typeof fetch;
  await syncShopify(db, key, 'glow', fetchFn, NOW);
  const [p] = ((await (await app.request('/api/products?stores=glow')).json()) as Page<Product>).items;
  expect(p).toMatchObject({ id: '111', inventory: 0, inventoryTracked: false });
});

test('a product that keeps selling when out of stock (inventory policy CONTINUE) reads as untracked, not sold out', async () => {
  const { db, app } = await setup();
  const shop = fakeShopify([]).fetchFn;
  const continues = { ...PRODUCT, totalInventory: -3, tracksInventory: true, variants: { nodes: [{ ...PRODUCT.variants.nodes[0]!, inventoryPolicy: 'CONTINUE' }] } };
  const fetchFn = (async (url: string, init: RequestInit) =>
    String(init.body).includes('products(first: 50')
      ? Response.json({ data: { products: { nodes: [continues], pageInfo: { hasNextPage: false, endCursor: null } } } })
      : shop(url, init)) as typeof fetch;
  await syncShopify(db, key, 'glow', fetchFn, NOW);
  const [p] = ((await (await app.request('/api/products?stores=glow')).json()) as Page<Product>).items;
  expect(p).toMatchObject({ id: '111', inventoryTracked: false });
});

test("a product deleted in Shopify is archived from its delete event (later syncs only)", async () => {
  const { db } = await setup();
  const first = fakeShopify([], 200, false, ['gid://shopify/Product/111']);
  await syncShopify(db, key, 'glow', first.fetchFn, NOW);
  expect(first.calls.some((c) => c.body.query.includes('events('))).toBe(false); // nothing local to archive yet
  const status = () => db.prepare("SELECT status FROM products WHERE store_id = 'glow' AND id = '111'").get()?.status;
  expect(status()).toBe('active');

  const second = fakeShopify([], 200, false, ['gid://shopify/Product/111']);
  await syncShopify(db, key, 'glow', second.fetchFn, NOW);
  expect(second.calls.find((c) => c.body.query.includes('events('))!.body.variables.q).toBe("action:'destroy' AND subject_type:'PRODUCT' AND created_at:>='2026-10-26T17:55:00Z'");
  expect(status()).toBe('archived');
});

test('once a day every Shopify product id is read, and products it lacks are archived (deleted before the events reached them)', async () => {
  const { db } = await setup();
  await syncShopify(db, key, 'glow', fakeShopify([]).fetchFn, NOW);
  const add = db.prepare("INSERT INTO products (store_id, id, title, price, cost, inventory, status) VALUES ('glow', ?, 'x', 1, 0, 1, 'active')");
  for (const id of ['222', 'research-9', 'woo-5']) add.run(id);
  const status = () => db.prepare("SELECT id, status FROM products WHERE store_id = 'glow' ORDER BY id").all();

  const later = fakeShopify([]);
  await syncShopify(db, key, 'glow', later.fetchFn, NOW);
  expect(later.calls.some((c) => c.body.query.includes('products(first: 250'))).toBe(true);
  // 222 is gone from Shopify; other platforms' and local drafts' rows are not Shopify's to judge.
  expect(status()).toEqual([
    { id: '111', status: 'active' }, { id: '222', status: 'archived' }, { id: 'research-9', status: 'active' }, { id: 'woo-5', status: 'active' },
  ]);
  const again = fakeShopify([]);
  await syncShopify(db, key, 'glow', again.fetchFn, NOW);
  expect(again.calls.some((c) => c.body.query.includes('products(first: 250'))).toBe(false); // once a day
});

test("a Shopify order's tax counts against profit, revenue stays the order total", async () => {
  const { db } = await setup();
  const { fetchFn, calls } = fakeShopify([order('#1001', '2026-10-25T09:00:00Z', '120.00', { currentTotalTaxSet: { shopMoney: money('20.00') } })]);
  await syncShopify(db, key, 'glow', fetchFn, NOW);
  expect(db.prepare("SELECT error FROM integrations WHERE id = 'shopify:glow'").get()?.error).toBeNull();
  expect(calls.find((c) => c.body.query.includes('orders('))!.body.query).toContain('currentTotalTaxSet');
  const day = db.prepare("SELECT revenue, cogs FROM daily_metrics WHERE store_id = 'glow' AND date = '2026-10-25'").get()!;
  const itemCost = Number(db.prepare("SELECT cogs FROM orders WHERE store_id = 'glow' AND id = '#1001'").get()?.cogs);
  expect(db.prepare("SELECT total, tax FROM orders WHERE store_id = 'glow' AND id = '#1001'").get()).toEqual({ total: 120, tax: 20 });
  expect(day).toEqual({ revenue: 120, cogs: itemCost + 20 });
});

test('in a store whose prices include VAT, product revenue leaves the VAT out like the order does', async () => {
  const { db } = await setup();
  // 120 including 20 VAT: the 80 line holds 80 × 20/120 of it.
  const { fetchFn } = fakeShopify([order('#1001', '2026-10-25T09:00:00Z', '120.00', { taxesIncluded: true, currentTotalTaxSet: { shopMoney: money('20.00') } })]);
  await syncShopify(db, key, 'glow', fetchFn, NOW);
  expect(db.prepare("SELECT revenue FROM order_items WHERE store_id = 'glow' AND order_id = '#1001' AND product_id = '111'").get()?.revenue).toBe(66.67);
});

test("a Shopify refund of an amount (no item returned) comes off the order: received less refunded, when that's lower", async () => {
  const { db } = await setup();
  const net = (amount: string) => ({ displayFinancialStatus: 'PARTIALLY_REFUNDED', netPaymentSet: { shopMoney: money(amount) } });
  await syncShopify(db, key, 'glow', fakeShopify([
    order('#21', '2026-10-25T09:00:00Z', '100.00', net('80.00')), // a $20 goodwill refund: the current total stays 100
    order('#22', '2026-10-25T10:00:00Z', '60.00', net('65.00')), // an item returned less a $5 fee: the current total is lower
    order('#23', '2026-10-25T11:00:00Z', '50.00'),
  ]).fetchFn, NOW);
  expect(db.prepare("SELECT id, total FROM orders WHERE store_id = 'glow' AND id IN ('#21', '#22', '#23') ORDER BY id").all().map((r) => [r.id, r.total])).toEqual([['#21', 80], ['#22', 60], ['#23', 50]]);
});

test("a Shopify product's numbers count the units kept, at their price after every discount (an order's code too)", async () => {
  const { db } = await setup();
  // 3 at $33.33 list, a 10% code on the order: $30 each; one unit refunded. Its cost stays on all 3 (a refund needn't be a return).
  const line = { quantity: 3, currentQuantity: 2, product: { id: 'gid://shopify/Product/111' }, discountedUnitPriceAfterAllDiscountsSet: { shopMoney: money('30.00') }, variant: { inventoryItem: { unitCost: money('5.00') } } };
  const gone = { ...line, currentQuantity: 0, product: { id: 'gid://shopify/Product/112' } }; // refunded in full
  await syncShopify(db, key, 'glow', fakeShopify([
    order('#31', '2026-10-25T09:00:00Z', '60.00', { displayFinancialStatus: 'PARTIALLY_REFUNDED', lineItems: { nodes: [line, gone], pageInfo: { hasNextPage: false, endCursor: null } } }),
  ]).fetchFn, NOW);
  expect(db.prepare("SELECT product_id, quantity, revenue, cost FROM order_items WHERE store_id = 'glow' AND order_id = '#31'").all()).toEqual([
    { product_id: '111', quantity: 2, revenue: 60, cost: 15 },
  ]);
});

test("a Shopify sync whose shop was swapped while it paged orders stops writing (the new shop's backfill starts clean)", async () => {
  const { db } = await setup();
  const shopify = fakeShopify([order('#41', '2026-10-25T09:00:00Z', '30.00')]).fetchFn;
  const fetchFn = (async (url: string, init: RequestInit) => {
    if (String(init.body).includes('orders(first')) saveIntegration(db, key, { kind: 'shopify', storeId: 'glow', values: { shopDomain: 'other-shop.myshopify.com', accessToken: TOKEN } });
    return shopify(url, init);
  }) as typeof fetch;
  await syncShopify(db, key, 'glow', fetchFn, NOW);
  expect(db.prepare("SELECT cursor FROM integrations WHERE id = 'shopify:glow'").get()?.cursor).toBeNull();
  expect(db.prepare("SELECT count(*) AS n FROM orders WHERE store_id = 'glow' AND id = '#41'").get()?.n).toBe(0);
});

test('products to create are checked before anything is created: a string where a number belongs, or a title with HTML, would leave a half-made draft', async () => {
  const { db } = await setup();
  const calls: string[] = [];
  const fetchFn = (async (url: string) => (calls.push(url), Response.json({}))) as typeof fetch;
  const bad = [
    { title: 'Ice Roller', price: 24.9, compareAt: '39.99' },
    { title: 'Ice Roller', price: 0 },
    { title: 'Ice Roller', price: 10, cost: -1 },
    { title: '  ', price: 10 },
    { title: 'Roller <img src=x onerror=alert(1)>', price: 10 },
  ] as unknown as NewProduct[];
  for (const p of bad) {
    await expect(createProducts(db, key, 'glow', [{ title: 'Fine', price: 5 }, p], fetchFn)).rejects.toThrow(/^Product 2/);
    await expect(createWooProducts(db, key, 'glow', [{ title: 'Fine', price: 5 }, p], fetchFn)).rejects.toThrow(/^Product 2/);
  }
  expect(calls).toHaveLength(0);
});
