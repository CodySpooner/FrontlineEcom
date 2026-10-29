// SA-36..39: WooCommerce orders, lines, customer refs, refunds, variants and listings against the REST docs' shapes (fixtures/woocommerce-doc-examples.json names the page and the date read).
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { saveIntegration } from '../integrations';
import { checkOrderIdentity } from '../store-analytics/reconcile';
import { syncWooCommerce } from './woocommerce';

const key = randomBytes(32);
const NOW = new Date('2026-10-26T18:00:00Z');
const DOC = JSON.parse(readFileSync(new URL('./fixtures/woocommerce-doc-examples.json', import.meta.url), 'utf8'));
const page = (body: unknown) => Response.json(body, { headers: { 'x-wp-totalpages': '1' } });

function fakeWoo(orders = DOC.orders, { refunds = true } = {}) {
  const fetchFn = (async (url: string) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/settings/general/woocommerce_currency')) return Response.json({ id: 'woocommerce_currency', value: 'USD' });
    if (u.pathname.endsWith('/wp-json/')) return Response.json({ timezone_string: 'America/New_York' });
    if (u.pathname.endsWith('/refunds')) return refunds ? page(DOC.refunds[u.pathname.split('/').at(-2)!] ?? []) : Response.json({ message: 'Internal Server Error' }, { status: 500 });
    if (u.pathname.endsWith('/orders')) return page(u.searchParams.get('status') === 'trash' ? [] : orders);
    if (u.pathname.endsWith('/variations')) return page(DOC.variations[u.pathname.split('/').at(-2)!] ?? []);
    if (u.pathname.endsWith('/products')) return page(u.searchParams.get('status') === 'trash' ? [] : DOC.products);
    return page([]);
  }) as typeof fetch;
  return { fetchFn };
}

function setup() {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  saveIntegration(db, key, { kind: 'woocommerce', storeId: 'pawsome', values: { siteUrl: 'https://shop.test', consumerKey: 'ck_not-a-real-key', consumerSecret: 'cs_not-a-real-secret' } });
  return db;
}
const rows = (db: ReturnType<typeof openDb>) =>
  db.prepare(
    `SELECT id, source_kind, source_id, channel, currency, fx_rate, total, tax, gross_sales AS gross, discounts, shipping, paid_at, fulfilled_at, source_updated_at, breakdown_at IS NOT NULL AS parts
     FROM orders WHERE store_id = 'pawsome' ORDER BY id`,
  ).all();

describe('WooCommerce orders contract (SA-36)', () => {
  it('writes the source ids, currency, paid time and money parts; the identity holds on every order with parts', async () => {
    const db = setup();
    await syncWooCommerce(db, key, 'pawsome', fakeWoo().fetchFn, NOW);
    const [a, b, c] = rows(db);
    expect(a).toEqual({
      id: 'woo-727', source_kind: 'woocommerce', source_id: '727', channel: 'site', currency: 'USD', fx_rate: 1, total: 29.35, tax: 1.35,
      gross: 18, discounts: 0, shipping: 10, paid_at: '2026-10-25T19:28:08.000Z', fulfilled_at: null, source_updated_at: '2026-10-25T19:28:08.000Z', parts: 1,
    });
    // prices with tax in: the lines' subtotals are without it; a gift-wrap fee is gross, a credit fee a discount
    expect(b).toMatchObject({ gross: 35.06, discounts: 5.13, shipping: 4.13, tax: 7.15, total: 41.21, fulfilled_at: '2026-10-26T09:00:00.000Z', parts: 1 });
    for (const o of [a, b]) expect(checkOrderIdentity({ gross: Number(o!.gross), discounts: Number(o!.discounts), shipping: Number(o!.shipping), tax: Number(o!.tax), refunds: 0, total: Number(o!.total) }).ok).toBe(true);
    // a partial refund: parts as placed; they count with its refund in the ledger (SA-38)
    expect(c).toMatchObject({ gross: 40, shipping: 5, total: 35, parts: 1 });
  });

  it('an order missing a documented money field keeps no parts (an estimate, never 0)', async () => {
    const db = setup();
    const [first] = structuredClone(DOC.orders);
    delete first.shipping_total;
    await syncWooCommerce(db, key, 'pawsome', fakeWoo([first]).fetchFn, NOW);
    expect(rows(db)[0]).toMatchObject({ id: 'woo-727', gross: null, discounts: null, shipping: null, parts: 0, total: 29.35 });
  });
});

describe('WooCommerce lines, customers and country (SA-37)', () => {
  it('one row per line by variation; the cost only when Woo reports it', async () => {
    const db = setup();
    await syncWooCommerce(db, key, 'pawsome', fakeWoo().fetchFn, NOW);
    const lines = db.prepare("SELECT order_id, line_id, product_id, variant_id, sku, quantity, gross, discount, cost, cost_source FROM order_lines WHERE store_id = 'pawsome' ORDER BY order_id, line_id").all();
    expect(lines).toEqual([
      { order_id: 'woo-727', line_id: '315', product_id: 'woo-93', variant_id: null, sku: null, quantity: 2, gross: 6, discount: 0, cost: null, cost_source: null },
      { order_id: 'woo-727', line_id: '316', product_id: 'woo-22', variant_id: 'woo-23', sku: 'Bar3', quantity: 1, gross: 12, discount: 0, cost: null, cost_source: null },
      { order_id: 'woo-728', line_id: '401', product_id: 'woo-93', variant_id: null, sku: null, quantity: 2, gross: 33.06, discount: 4.13, cost: 14, cost_source: 'platform' },
      { order_id: 'woo-729', line_id: '501', product_id: 'woo-22', variant_id: 'woo-23', sku: 'Bar3', quantity: 2, gross: 40, discount: 0, cost: null, cost_source: null },
      { order_id: 'woo-731', line_id: '601', product_id: 'woo-93', variant_id: null, sku: null, quantity: 1, gross: 9, discount: 0, cost: null, cost_source: null },
    ]);
  });

  it('a guest order is guest, not a customer; one customer is one ref; the country code only', async () => {
    const db = setup();
    await syncWooCommerce(db, key, 'pawsome', fakeWoo().fetchFn, NOW);
    const [guest, a, b] = db.prepare("SELECT customer_ref AS ref, customer_state AS state, country FROM orders WHERE store_id = 'pawsome' ORDER BY id").all();
    expect(guest).toEqual({ ref: null, state: 'guest', country: 'US' }); // shipping empty: billing's
    expect(a).toMatchObject({ state: 'identified', country: 'DE', ref: expect.stringMatching(/^c_[0-9a-f]{24}$/) });
    expect(b!.ref).toBe(a!.ref);
    expect(db.prepare("SELECT status FROM source_datasets WHERE integration_id = 'woocommerce:pawsome' AND dataset = 'customers'").get()?.status).toBe('available');
  });

  it("asks only for the addresses' country codes", async () => {
    const db = setup();
    const asked: URL[] = [];
    const { fetchFn } = fakeWoo();
    await syncWooCommerce(db, key, 'pawsome', ((url: string, init?: RequestInit) => (asked.push(new URL(url)), fetchFn(url, init))) as typeof fetch, NOW);
    const fields = asked.find((u) => u.pathname.endsWith('/orders'))!.searchParams.get('_fields')!.split(',');
    expect(fields.filter((f) => /billing|shipping\b|customer/.test(f))).toEqual(['customer_id', 'billing.country', 'shipping.country']);
  });
});

describe('WooCommerce refunds (SA-38)', () => {
  const ledger = (db: ReturnType<typeof openDb>) =>
    db.prepare("SELECT id, order_id, product_id, local_date, merchandise, shipping, tax, other, quantity FROM refunds WHERE store_id = 'pawsome' ORDER BY id").all();

  it('a partial refund with no line items gives one other row; lines and shipping as given; the identity holds', async () => {
    const db = setup();
    await syncWooCommerce(db, key, 'pawsome', fakeWoo().fetchFn, NOW);
    expect(ledger(db)).toEqual([
      { id: '730:other', order_id: 'woo-729', product_id: null, local_date: '2026-10-26', merchandise: null, shipping: null, tax: null, other: 10, quantity: null },
      { id: '732:line:801', order_id: 'woo-731', product_id: 'woo-93', local_date: '2026-10-26', merchandise: 9, shipping: null, tax: 0, other: null, quantity: 1 },
      { id: '732:ship:802', order_id: 'woo-731', product_id: null, local_date: '2026-10-26', merchandise: null, shipping: 5, tax: 0, other: null, quantity: null },
    ]);
    const settled = db.prepare(
      `SELECT o.id, o.gross_sales AS g, o.discounts AS d, o.shipping AS s, o.tax, o.total,
         (SELECT coalesce(sum(coalesce(merchandise, 0) + coalesce(shipping, 0) + coalesce(tax, 0) + coalesce(other, 0)), 0) FROM refunds r WHERE r.store_id = o.store_id AND r.order_id = o.id) AS back
       FROM orders o WHERE o.store_id = 'pawsome' AND o.breakdown_at IS NOT NULL`,
    ).all();
    expect(settled).toHaveLength(4);
    for (const o of settled) expect([o.id, checkOrderIdentity({ gross: Number(o.g), discounts: Number(o.d), shipping: Number(o.s), tax: Number(o.tax), refunds: Number(o.back), total: Number(o.total) }).ok]).toEqual([o.id, true]);
  });

  it("a failed refunds read keeps the ledger as it was and the order's parts uncounted", async () => {
    const db = setup();
    await syncWooCommerce(db, key, 'pawsome', fakeWoo().fetchFn, NOW);
    const before = ledger(db);
    await syncWooCommerce(db, key, 'pawsome', fakeWoo(DOC.orders, { refunds: false }).fetchFn, NOW);
    expect(ledger(db)).toEqual(before);
    expect(db.prepare("SELECT breakdown_at IS NOT NULL AS parts FROM orders WHERE store_id = 'pawsome' AND id = 'woo-729'").get()?.parts).toBe(0);
    expect(db.prepare("SELECT status FROM source_datasets WHERE integration_id = 'woocommerce:pawsome' AND dataset = 'refunds'").get()?.status).toBe('failed');
  });
});

describe('WooCommerce variants and listings (SA-39)', () => {
  it('a variation is a variant, a simple product its own; parent-counted stock; the site listing state', async () => {
    const db = setup();
    await syncWooCommerce(db, key, 'pawsome', fakeWoo().fetchFn, NOW);
    expect(db.prepare("SELECT product_id, id, title, sku, price, compare_at, inventory, inventory_tracked AS tracked, inventory_policy AS policy, status FROM product_variants WHERE store_id = 'pawsome' ORDER BY id").all()).toEqual([
      { product_id: 'woo-22', id: 'woo-23', title: 'Black / M Test', sku: 'Bar3', price: 12, compare_at: null, inventory: 4, tracked: 1, policy: 'deny', status: 'active' },
      { product_id: 'woo-22', id: 'woo-24', title: 'Green / S Test', sku: null, price: 10, compare_at: 14, inventory: 5, tracked: 0, policy: 'continue', status: 'active' }, // the parent's count, which backorders
      { product_id: 'woo-22', id: 'woo-25', title: 'Red', sku: 'Bar5', price: null, compare_at: null, inventory: null, tracked: 0, policy: 'deny', status: 'draft' }, // stock not counted: unknown, not 0
      { product_id: 'woo-40', id: 'woo-40', title: null, sku: null, price: 15, compare_at: null, inventory: null, tracked: 0, policy: 'deny', status: 'draft' },
      { product_id: 'woo-93', id: 'woo-93', title: null, sku: 'WS-1', price: 3, compare_at: 4, inventory: 12, tracked: 1, policy: 'deny', status: 'active' },
    ]);
    expect(db.prepare("SELECT channel, id, status, published_at FROM channel_listings WHERE store_id = 'pawsome' ORDER BY id").all()).toEqual([
      { channel: 'site', id: 'woo-22', status: 'active', published_at: null },
      { channel: 'site', id: 'woo-40', status: 'scheduled', published_at: null },
      { channel: 'site', id: 'woo-93', status: 'active', published_at: null },
    ]);
    const datasets = db.prepare("SELECT dataset, status FROM source_datasets WHERE integration_id = 'woocommerce:pawsome' AND dataset IN ('variants', 'channel_listings') ORDER BY dataset").all();
    expect(datasets).toEqual([{ dataset: 'channel_listings', status: 'available' }, { dataset: 'variants', status: 'available' }]);
  });
});

describe('WooCommerce categories (SA-47)', () => {
  it("a product's categories are its collections; a re-read rewrites them", async () => {
    const db = setup();
    await syncWooCommerce(db, key, 'pawsome', fakeWoo().fetchFn, NOW);
    const members = () => db.prepare("SELECT collection_id, product_id, title FROM product_collections WHERE store_id = 'pawsome' ORDER BY collection_id, product_id").all();
    expect(members()).toEqual([
      { collection_id: 'woo-cat-14', product_id: 'woo-93', title: 'T-shirts' },
      { collection_id: 'woo-cat-9', product_id: 'woo-22', title: 'Clothing' },
      { collection_id: 'woo-cat-9', product_id: 'woo-93', title: 'Clothing' },
    ]);
    const before = DOC.products[0].categories;
    DOC.products[0].categories = [{ id: 9, name: 'Clothing', slug: 'clothing' }];
    try {
      db.prepare("UPDATE integrations SET cursor = NULL WHERE id = 'woocommerce:pawsome'").run();
      await syncWooCommerce(db, key, 'pawsome', fakeWoo().fetchFn, NOW);
    } finally {
      DOC.products[0].categories = before;
    }
    expect(members().map((m) => `${m.collection_id}/${m.product_id}`)).toEqual(['woo-cat-9/woo-22', 'woo-cat-9/woo-93']);
  });
});
