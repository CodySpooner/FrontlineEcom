// SA-27..34: Shopify orders, refunds, variants, lines, publications, customer refs, purchasing sessions and traffic breakdowns against the reference's shapes (fixtures/shopify-doc-examples.json names the pages and the date
// read), and the static cost of every Shopify read.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { saveIntegration } from '../integrations';
import { checkOrderIdentity } from '../store-analytics/reconcile';
import { salesMetrics } from '../store-analytics/sales';
import { sourceRows } from '../store-analytics/sources';
import { purchaseDays, SHOPIFY_READS, syncShopify } from './shopify';

const key = randomBytes(32);
const NOW = new Date('2026-10-26T18:00:00Z');
const DOC = JSON.parse(readFileSync(new URL('./fixtures/shopify-doc-examples.json', import.meta.url), 'utf8'));
const TOKEN = 'tok_not-a-real-secret-not-a-real-secret';

type Field = { name: string; first?: number; fragment: boolean; children?: Field[] };
/** A query's selections: names (with their arguments' `first:`) and nested selections. */
function parse(query: string): Field[] {
  const tokens = query.match(/\.\.\.\s*on\s+\w+|[\w$]+(?:\s*\([^)]*\))?|[{}]/g)!;
  let i = tokens.indexOf('{') + 1;
  const fields = (): Field[] => {
    const out: Field[] = [];
    while (i < tokens.length && tokens[i] !== '}') {
      const tok = tokens[i++]!;
      const f: Field = { name: tok.replace(/\s*\(.*$/s, ''), first: Number(/\bfirst:\s*(\d+)/.exec(tok)?.[1]) || undefined, fragment: tok.startsWith('...') };
      if (tokens[i] === '{') {
        i++;
        f.children = fields();
        i++;
      }
      out.push(f);
    }
    return out;
  };
  return fields();
}
const sum = (fs: Field[]): number => fs.reduce((a, f) => a + fieldCost(f), 0);
/** Shopify's rule: an object 1, a connection or sized list 2 + first × (1 + a node), pageInfo 1, scalars 0. */
function fieldCost(f: Field): number {
  if (!f.children) return 0;
  if (f.fragment) return sum(f.children);
  if (f.first == null) return 1 + sum(f.children);
  const nodes = f.children.find((c) => c.name === 'nodes' || c.name === 'edges');
  if (!nodes) return 2 + f.first * (1 + sum(f.children));
  return 2 + f.children.reduce((a, c) => a + (c === nodes ? f.first! * (1 + sum(c.children ?? [])) : fieldCost(c)), 0);
}
const queryCost = (query: string) => sum(parse(query));

function fakeShopify(orders = DOC.orders, { denyPublications = false, deny = [] as ('customer' | 'country')[], funnel = false, purchases = true, breakdowns = true } = {}) {
  const asked: string[] = [];
  const fetchFn = (async (_url: string, init: RequestInit) => {
    const { query, variables } = JSON.parse(String(init.body)) as { query: string; variables: { id?: string } };
    asked.push(query);
    const json = (data: unknown) => Response.json({ data });
    if (query.includes('shop {')) return json({ shop: DOC.shop });
    if (query.includes('resourcePublications(')) {
      if (denyPublications) return Response.json({ errors: [{ message: 'Access denied for resourcePublications field. Required access: `read_publications` access scope.', extensions: { code: 'ACCESS_DENIED' } }] });
      return json({ products: DOC.publications });
    }
    if (query.includes('productVariants(')) return json({ productVariants: DOC.variants });
    if (query.includes('products(')) return json({ products: DOC.products });
    if (query.includes('events(')) return json({ events: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } });
    if (query.includes('shopifyqlQuery')) {
      const q = String((variables as { q?: string }).q);
      if (!funnel || (q.includes('sessions_that_completed_checkout') && !purchases)) return Response.json({ errors: [{ message: 'Access denied for shopifyqlQuery field.' }] });
      const by = Object.keys(DOC.sessions.breakdowns).find((f) => q.includes(`GROUP BY day, ${f},`));
      if (by) return breakdowns ? json({ shopifyqlQuery: { parseErrors: [], tableData: DOC.sessions.breakdowns[by] } }) : Response.json({ errors: [{ message: 'Access denied for shopifyqlQuery field.' }] });
      if (q.includes('sessions_that_completed_checkout')) return json({ shopifyqlQuery: { parseErrors: [], tableData: DOC.sessions.purchases } });
      return json({ shopifyqlQuery: { parseErrors: [], tableData: q.includes("'bot'") ? { columns: DOC.sessions.funnel.columns, rows: [] } : DOC.sessions.funnel } });
    }
    if (query.includes('refunds(')) return json({ order: { refunds: DOC.refunds[variables.id!] ?? [] } });
    const [customer, country] = [query.includes('customer {'), query.includes('shippingAddress {')];
    if ((customer && deny.includes('customer')) || (country && deny.includes('country'))) {
      return Response.json({ errors: [{ message: 'This app is not approved to access the Customer object.', extensions: { code: 'ACCESS_DENIED' } }] });
    }
    // Shopify sends only the fields asked for
    const only = (o: Record<string, unknown>) => {
      const { customer: c, shippingAddress: s, ...rest } = o;
      return { ...rest, ...(customer ? { customer: c ?? null } : {}), ...(country ? { shippingAddress: s ?? null } : {}) };
    };
    return json({ orders: { ...orders, nodes: orders.nodes.map(only) } });
  }) as typeof fetch;
  return { fetchFn, asked };
}

const setup = () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  saveIntegration(db, key, { kind: 'shopify', storeId: 'glow', values: { shopDomain: 'contract-test.myshopify.com', accessToken: TOKEN } });
  return db;
};
const rows = (db: ReturnType<typeof openDb>) =>
  db.prepare(
    `SELECT id, local_date, total, tax, status, source_kind, source_id, channel, channel_order_id, currency, gross_sales, discounts, shipping, paid_at, cancelled_at,
       fulfilled_at, delivered_at, source_updated_at, breakdown_at FROM orders WHERE store_id = 'glow' ORDER BY id`,
  ).all();

describe('Shopify orders contract (SA-27)', () => {
  it('every read costs at most 1000, priced from its first: values', () => {
    const costs = Object.fromEntries(Object.entries(SHOPIFY_READS).map(([name, q]) => [name, queryCost(q)]));
    expect(Object.entries(costs).filter(([, c]) => c > 1000)).toEqual([]);
    // the arithmetic in shopify.ts's comment
    expect([costs.ORDERS_Q, costs.ORDER_ITEMS_Q, costs.PRODUCTS_Q]).toEqual([893, 904, 453]);
    expect(queryCost('{ a(first: 3) { nodes { b { c } } pageInfo { hasNextPage } } }')).toBe(2 + 3 * 2 + 1);
  });

  it('writes the money parts, channel, dates and source ids; the identity holds on every order', async () => {
    const db = setup();
    const { fetchFn, asked } = fakeShopify();
    await syncShopify(db, key, 'glow', fetchFn, NOW);
    expect(asked.find((q) => q.includes('sortKey: UPDATED_AT'))).toContain('customer { id }'); // SA-32's probes allowed it
    const synced = NOW.toISOString();
    expect(rows(db)).toEqual([
      {
        id: '#1001', local_date: '2026-10-20', total: 82.75, tax: 5.76, status: 'paid', source_kind: 'shopify', source_id: '5501001', channel: 'site', channel_order_id: null, currency: 'USD',
        gross_sales: 80, discounts: 8, shipping: 4.99, paid_at: '2026-10-20T15:00:00Z', cancelled_at: null, fulfilled_at: '2026-10-21T10:00:00Z', delivered_at: '2026-10-23T14:00:00Z',
        source_updated_at: '2026-10-23T14:05:00Z', breakdown_at: synced,
      },
      // prices include VAT: each part gives up the order's tax share
      expect.objectContaining({ id: '#1002', total: 114, tax: 19, gross_sales: 100, discounts: 10, shipping: 5, channel: 'site' }),
      expect.objectContaining({ id: '#1003', channel: 'tiktok_shop', channel_order_id: '577012345678901234', gross_sales: 19.99, discounts: 0, shipping: 0 }),
      expect.objectContaining({ id: '#1004', channel: 'pos', channel_order_id: null, fulfilled_at: '2026-10-22T18:00:10Z', delivered_at: null }),
    ]); // the test order (#1005) isn't stored
    for (const o of rows(db)) {
      const id = checkOrderIdentity({ gross: Number(o.gross_sales), discounts: Number(o.discounts), shipping: Number(o.shipping), tax: Number(o.tax), refunds: 0, total: Number(o.total) });
      expect([o.id, id.ok]).toEqual([o.id, true]);
    }
    expect(salesMetrics(db, 'glow', '2026-10-20', '2026-10-22').net_sales).toMatchObject({ value: 80 - 8 + 100 - 10 + 19.99 + 15, status: 'ok' });
  });

  it('orders synced before SA-27 still read (as estimates), and a re-sync fills their parts', async () => {
    const db = setup();
    const { fetchFn } = fakeShopify();
    await syncShopify(db, key, 'glow', fetchFn, NOW);
    db.prepare("UPDATE orders SET gross_sales = NULL, discounts = NULL, shipping = NULL, breakdown_at = NULL WHERE store_id = 'glow' AND id = '#1004'").run();
    // #1004 alone on the 22nd (#1003, 01:10 UTC, is the 21st in the shop's zone): 16.20 less its 1.20 tax
    expect(salesMetrics(db, 'glow', '2026-10-22', '2026-10-22').net_sales).toMatchObject({ value: 15, status: 'estimated' });
    await syncShopify(db, key, 'glow', fetchFn, NOW);
    expect(salesMetrics(db, 'glow', '2026-10-22', '2026-10-22').net_sales).toMatchObject({ value: 15, status: 'ok' });
  });
});

describe('Shopify refunds ledger contract (SA-28)', () => {
  const ledger = (db: ReturnType<typeof openDb>) =>
    db.prepare("SELECT id, refund_id, order_id, product_id, variant_id, local_date, merchandise, shipping, tax, other, quantity, restocked FROM refunds WHERE store_id = 'glow' ORDER BY id").all();

  it('a partial refund, a full refund with its shipping and a restock, and an amount refunded give the right rows; the identity holds', async () => {
    const db = setup();
    const { fetchFn, asked } = fakeShopify(DOC.refundOrders);
    await syncShopify(db, key, 'glow', fetchFn, NOW);
    expect(asked.filter((q) => q.includes('refunds('))).toHaveLength(3);
    expect(ledger(db)).toEqual([
      { id: '7001:line:9101', refund_id: '7001', order_id: '#1006', product_id: '111', variant_id: '1111', local_date: '2026-10-24', merchandise: 25, shipping: null, tax: 2, other: null, quantity: 1, restocked: 0 },
      { id: '7002:line:9102', refund_id: '7002', order_id: '#1007', product_id: '112', variant_id: '1121', local_date: '2026-10-25', merchandise: 40, shipping: null, tax: 3.2, other: null, quantity: 1, restocked: 1 },
      { id: '7002:ship:7102', refund_id: '7002', order_id: '#1007', product_id: null, variant_id: null, local_date: '2026-10-25', merchandise: null, shipping: 6, tax: 0, other: null, quantity: null, restocked: null },
      { id: '7003:adj:7203', refund_id: '7003', order_id: '#1008', product_id: null, variant_id: null, local_date: '2026-10-25', merchandise: null, shipping: null, tax: 0, other: 10, quantity: null, restocked: null },
    ]);
    const back = db.prepare("SELECT coalesce(sum(coalesce(merchandise, 0) + coalesce(shipping, 0) + coalesce(tax, 0) + coalesce(other, 0)), 0) AS n FROM refunds WHERE store_id = 'glow' AND order_id = ?");
    for (const o of rows(db)) {
      const id = checkOrderIdentity({ gross: Number(o.gross_sales), discounts: Number(o.discounts), shipping: Number(o.shipping), tax: Number(o.tax), refunds: Number(back.get(String(o.id))!.n), total: Number(o.total) });
      expect([o.id, id]).toEqual([o.id, expect.objectContaining({ ok: true })]);
    }
    // v1: the three orders on their day (refunded ones too), the merchandise refunds on theirs
    expect(salesMetrics(db, 'glow', '2026-10-21', '2026-10-21').net_sales.value).toBe(150);
    expect(salesMetrics(db, 'glow', '2026-10-24', '2026-10-25').refunds.value).toBe(65);
    expect(db.prepare("SELECT status FROM source_datasets WHERE integration_id = 'shopify:glow' AND dataset = 'refunds'").get()?.status).toBe('available');
  });

  it('re-running is a no-op: unchanged orders ask nothing, a changed one rewrites the same rows', async () => {
    const db = setup();
    await syncShopify(db, key, 'glow', fakeShopify(DOC.refundOrders).fetchFn, NOW);
    const before = ledger(db);
    const again = fakeShopify(DOC.refundOrders);
    await syncShopify(db, key, 'glow', again.fetchFn, NOW);
    expect(again.asked.filter((q) => q.includes('refunds('))).toEqual([]);
    const touched = { ...DOC.refundOrders, nodes: DOC.refundOrders.nodes.map((o: { updatedAt: string }) => ({ ...o, updatedAt: '2026-10-26T12:00:00Z' })) };
    const third = fakeShopify(touched);
    await syncShopify(db, key, 'glow', third.fetchFn, NOW);
    expect(third.asked.filter((q) => q.includes('refunds('))).toHaveLength(3);
    expect(ledger(db)).toEqual(before);
  });
});

describe('Shopify variants contract (SA-29)', () => {
  it('a 3-variant product gives three variant rows and one products row; each variant cost is recorded once', async () => {
    const db = setup();
    await syncShopify(db, key, 'glow', fakeShopify().fetchFn, NOW);
    expect(db.prepare("SELECT id, price, compare_at, cost, inventory, inventory_tracked, status FROM products WHERE store_id = 'glow'").all()).toEqual([
      { id: '120', price: 39, compare_at: 49, cost: 11, inventory: 45, inventory_tracked: 1, status: 'active' },
    ]);
    const synced = NOW.toISOString();
    expect(db.prepare("SELECT product_id, id, title, sku, price, compare_at, inventory, inventory_tracked, inventory_policy, status, synced_at FROM product_variants WHERE store_id = 'glow' ORDER BY id").all()).toEqual([
      { product_id: '120', id: '1201', title: 'Ivory', sku: 'SLK-IVR', price: 39, compare_at: 49, inventory: 30, inventory_tracked: 1, inventory_policy: 'deny', status: 'active', synced_at: synced },
      { product_id: '120', id: '1202', title: 'Black', sku: 'SLK-BLK', price: 39, compare_at: null, inventory: 15, inventory_tracked: 1, inventory_policy: 'deny', status: 'active', synced_at: synced },
      // sells at 0 and isn't tracked: untracked, like the products row reads it
      { product_id: '120', id: '1203', title: 'Rose', sku: 'SLK-RSE', price: 42, compare_at: null, inventory: 0, inventory_tracked: 0, inventory_policy: 'continue', status: 'active', synced_at: synced },
    ]);
    await syncShopify(db, key, 'glow', fakeShopify().fetchFn, NOW);
    expect(db.prepare("SELECT variant_id, cost FROM unit_costs WHERE store_id = 'glow' AND product_id = '120' ORDER BY variant_id").all()).toEqual([
      { variant_id: null, cost: 11 },
      { variant_id: '1201', cost: 11 },
      { variant_id: '1202', cost: 11.5 },
    ]);
    expect(db.prepare("SELECT status FROM source_datasets WHERE integration_id = 'shopify:glow' AND dataset = 'variants'").get()?.status).toBe('available');
  });
});

describe('Shopify order lines contract (SA-30)', () => {
  const lines = (db: ReturnType<typeof openDb>) =>
    db.prepare("SELECT order_id, line_id, product_id, variant_id, sku, quantity, gross, discount, cost, cost_source FROM order_lines WHERE store_id = 'glow' ORDER BY order_id, line_id").all();

  it('one row per line by variant; the line sums equal the order gross and discounts', async () => {
    const db = setup();
    await syncShopify(db, key, 'glow', fakeShopify().fetchFn, NOW);
    expect(lines(db).filter((l) => l.order_id === '#1001')).toEqual([
      { order_id: '#1001', line_id: '9001', product_id: '111', variant_id: '1111', sku: 'SER-30', quantity: 2, gross: 50, discount: 5, cost: 16, cost_source: 'platform' },
      { order_id: '#1001', line_id: '9002', product_id: '112', variant_id: '1121', sku: 'CRM-50', quantity: 1, gross: 30, discount: 3, cost: 9.5, cost_source: 'platform' },
    ]);
    // no unit cost in Shopify: unknown, not 0; prices include VAT: the line gives its tax share up like the order
    expect(lines(db).find((l) => l.order_id === '#1002')).toMatchObject({ gross: 100, discount: 10, cost: null, cost_source: null });
    const sums = db.prepare(
      `SELECT o.id, o.gross_sales, o.discounts, round(sum(l.gross), 2) AS g, round(sum(l.discount), 2) AS d FROM orders o JOIN order_lines l ON l.store_id = o.store_id AND l.order_id = o.id
       WHERE o.store_id = 'glow' GROUP BY o.id`,
    ).all();
    expect(sums).toHaveLength(4);
    for (const s of sums) expect([s.id, s.g, s.d]).toEqual([s.id, s.gross_sales, s.discounts]);
  });

  it("a line's first recorded cost is never overwritten by a later unit cost", async () => {
    const db = setup();
    await syncShopify(db, key, 'glow', fakeShopify().fetchFn, NOW);
    const later = structuredClone(DOC.orders);
    later.nodes[0].updatedAt = '2026-10-26T12:00:00Z';
    later.nodes[0].lineItems.nodes[0].variant.inventoryItem.unitCost.amount = '9.00';
    await syncShopify(db, key, 'glow', fakeShopify(later).fetchFn, NOW);
    expect(lines(db).find((l) => l.line_id === '9001')).toMatchObject({ cost: 16, cost_source: 'platform' });
    expect(db.prepare("SELECT status FROM source_datasets WHERE integration_id = 'shopify:glow' AND dataset = 'order_lines'").get()?.status).toBe('available');
  });
});

describe('Shopify publications contract (SA-31)', () => {
  const listings = (db: ReturnType<typeof openDb>) =>
    db.prepare("SELECT channel, id, product_id, status, published_at FROM channel_listings WHERE store_id = 'glow' ORDER BY channel").all();
  const dataset = (db: ReturnType<typeof openDb>, d: string) => db.prepare("SELECT status, error FROM source_datasets WHERE integration_id = 'shopify:glow' AND dataset = ?").get(d);

  it("each sales channel's current state; since only from Shopify's publish date", async () => {
    const db = setup();
    await syncShopify(db, key, 'glow', fakeShopify().fetchFn, NOW);
    expect(listings(db)).toEqual([
      { channel: 'google_youtube', id: '120', product_id: '120', status: 'scheduled', published_at: '2026-11-01T00:00:00Z' },
      { channel: 'pos', id: '120', product_id: '120', status: 'unpublished', published_at: null },
      { channel: 'site', id: '120', product_id: '120', status: 'active', published_at: '2026-09-01T12:00:00Z' },
      { channel: 'tiktok_shop', id: '120', product_id: '120', status: 'active', published_at: '2026-10-01T09:00:00Z' },
    ]);
    expect(dataset(db, 'channel_listings')).toEqual({ status: 'available', error: null });
  });

  it('a denied read records needs_permission and nothing else changes', async () => {
    const db = setup();
    await syncShopify(db, key, 'glow', fakeShopify().fetchFn, NOW);
    const before = { listings: listings(db), orders: rows(db), variants: db.prepare("SELECT * FROM product_variants WHERE store_id = 'glow'").all() };
    await syncShopify(db, key, 'glow', fakeShopify(DOC.orders, { denyPublications: true }).fetchFn, NOW);
    expect({ listings: listings(db), orders: rows(db), variants: db.prepare("SELECT * FROM product_variants WHERE store_id = 'glow'").all() }).toEqual(before);
    expect(dataset(db, 'channel_listings')).toMatchObject({ status: 'needs_permission', error: expect.stringContaining('read_publications') });
    expect(dataset(db, 'orders')?.status).toBe('available');
    expect(sourceRows(db, 'glow').find((r) => r.source === 'shopify' && r.dataset === 'channel_listings')).toMatchObject({ status: 'needs_permission', reason: 'needs_permission' });
  });
});

describe('Shopify customer refs and country (SA-32)', () => {
  const customers = (db: ReturnType<typeof openDb>, store = 'glow') =>
    db.prepare('SELECT id, customer_ref AS ref, customer_state AS state, country FROM orders WHERE store_id = ? ORDER BY id').all(store);
  const probes = (asked: string[]) => asked.filter((q) => q.startsWith('{ orders(first: 1)'));

  it('the same customer is one ref within a store and another on a different store; guests and countries', async () => {
    const db = setup();
    const { fetchFn, asked } = fakeShopify();
    await syncShopify(db, key, 'glow', fetchFn, NOW);
    expect(probes(asked)).toHaveLength(2);
    const [a, b, guest, pos] = customers(db);
    expect(a).toMatchObject({ id: '#1001', state: 'identified', country: 'US', ref: expect.stringMatching(/^c_[0-9a-f]{24}$/) });
    expect(b).toMatchObject({ id: '#1002', state: 'identified', country: 'DE', ref: a!.ref });
    expect(guest).toEqual({ id: '#1003', ref: null, state: 'guest', country: 'US' });
    expect(pos).toMatchObject({ state: 'identified', country: null });
    expect(pos!.ref).not.toBe(a!.ref);

    saveIntegration(db, key, { kind: 'shopify', storeId: 'pawsome', values: { shopDomain: 'contract-test-2.myshopify.com', accessToken: TOKEN } });
    await syncShopify(db, key, 'pawsome', fakeShopify().fetchFn, NOW);
    expect(customers(db, 'pawsome')[0]!.ref).not.toBe(a!.ref);
    expect(db.prepare("SELECT status FROM source_datasets WHERE integration_id = 'shopify:glow' AND dataset = 'customers'").get()?.status).toBe('available');

    // probed once a day
    const again = fakeShopify();
    await syncShopify(db, key, 'glow', again.fetchFn, NOW);
    expect(probes(again.asked)).toEqual([]);
  });

  it('a denied probe never fails the order sync: the field is left out and the dataset reads needs_permission', async () => {
    const db = setup();
    const { fetchFn, asked } = fakeShopify(DOC.orders, { deny: ['customer', 'country'] });
    await syncShopify(db, key, 'glow', fetchFn, NOW);
    expect(db.prepare("SELECT error FROM integrations WHERE id = 'shopify:glow'").get()?.error).toBeNull();
    expect(asked.find((q) => q.includes('sortKey: UPDATED_AT'))).not.toMatch(/customer \{|shippingAddress \{/);
    expect(customers(db).map((c) => c.state)).toEqual(['unavailable', 'unavailable', 'unavailable', 'unavailable']);
    expect(db.prepare("SELECT status FROM source_datasets WHERE integration_id = 'shopify:glow' AND dataset = 'customers'").get()?.status).toBe('needs_permission');
    expect(db.prepare("SELECT status FROM source_datasets WHERE integration_id = 'shopify:glow' AND dataset = 'orders'").get()?.status).toBe('available');
  });

  it("a ref read once stays when a later day's probe is denied", async () => {
    const db = setup();
    await syncShopify(db, key, 'glow', fakeShopify().fetchFn, NOW);
    const before = customers(db);
    const tomorrow = new Date(NOW.getTime() + 86_400_000);
    const touched = { ...DOC.orders, nodes: DOC.orders.nodes.map((o: { updatedAt: string }) => ({ ...o, updatedAt: '2026-10-27T12:00:00Z' })) };
    await syncShopify(db, key, 'glow', fakeShopify(touched, { deny: ['customer'] }).fetchFn, tomorrow);
    expect(customers(db)).toEqual(before);
    expect(db.prepare("SELECT status FROM source_datasets WHERE integration_id = 'shopify:glow' AND dataset = 'customers'").get()?.status).toBe('partial');
  });

  it('no column anywhere holds personal data (decision 20)', () => {
    const db = openDb();
    const pii = /e_?mail|phone|first_?name|last_?name|full_?name|customer_name|buyer|address|street|city|postal|zip|ip_addr|refund_reason|note/i;
    const columns = db.prepare("SELECT m.name AS t, p.name AS c FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table'").all().map((r) => `${r.t}.${r.c}`);
    expect(columns.filter((c) => /^(orders|order_lines|refunds|order_fees)\./.test(c) && pii.test(c))).toEqual([]);
  });
});

describe('Shopify purchasing sessions (SA-33)', () => {
  const days = (db: ReturnType<typeof openDb>) =>
    db.prepare("SELECT date, sessions, add_to_carts, checkouts, purchase_sessions FROM daily_metrics WHERE store_id = 'glow' AND date IN ('2026-10-24', '2026-10-25') ORDER BY date").all();
  const dataset = (db: ReturnType<typeof openDb>, d: string) => db.prepare("SELECT status FROM source_datasets WHERE integration_id = 'shopify:glow' AND dataset = ?").get(d)?.status;

  it("writes each day's purchasing sessions next to the funnel's", async () => {
    const db = setup();
    await syncShopify(db, key, 'glow', fakeShopify(DOC.orders, { funnel: true }).fetchFn, NOW);
    expect(days(db)).toEqual([
      { date: '2026-10-24', sessions: 400, add_to_carts: 40, checkouts: 18, purchase_sessions: 9 },
      { date: '2026-10-25', sessions: 380, add_to_carts: 36, checkouts: 15, purchase_sessions: 7 },
    ]);
    expect([dataset(db, 'traffic'), dataset(db, 'purchase_sessions')]).toEqual(['available', 'available']);
    expect(db.prepare("SELECT count(*) AS n FROM done_once WHERE ref = 'shopify-purchase-sessions:glow:contract-test.myshopify.com'").get()?.n).toBe(1);
  });

  it("a failure here leaves the funnel's sessions untouched and conversion unreported", async () => {
    const db = setup();
    await syncShopify(db, key, 'glow', fakeShopify(DOC.orders, { funnel: true, purchases: false }).fetchFn, NOW);
    expect(days(db)).toEqual([
      { date: '2026-10-24', sessions: 400, add_to_carts: 40, checkouts: 18, purchase_sessions: null },
      { date: '2026-10-25', sessions: 380, add_to_carts: 36, checkouts: 15, purchase_sessions: null },
    ]);
    expect([dataset(db, 'traffic'), dataset(db, 'purchase_sessions')]).toEqual(['available', 'failed']);
  });

  it('a day without the value is left out, never 0', () => {
    expect(purchaseDays({ columns: [{ name: 'day' }, { name: 'sessions_that_completed_checkout' }], rows: [['2026-10-24', '3'], ['2026-10-25', null], ['x', '1']] })).toEqual([{ date: '2026-10-24', purchases: 3 }]);
  });
});

describe('Shopify traffic breakdowns (SA-34)', () => {
  const split = (db: ReturnType<typeof openDb>, dimension: string) =>
    db.prepare("SELECT date, value, sessions, purchase_sessions AS ps FROM traffic_breakdown_daily WHERE store_id = 'glow' AND dimension = ? AND date IN ('2026-10-24', '2026-10-25') ORDER BY date, value").all(dimension);

  it("each dimension's day adds up to the day's sessions; a gap is an unknown row, bot rows are dropped", async () => {
    const db = setup();
    await syncShopify(db, key, 'glow', fakeShopify(DOC.orders, { funnel: true }).fetchFn, NOW);
    expect(split(db, 'source')).toEqual([
      { date: '2026-10-24', value: 'direct', sessions: 150, ps: 3 },
      { date: '2026-10-24', value: 'search', sessions: 250, ps: 6 },
      { date: '2026-10-25', value: 'unknown', sessions: 380, ps: 7 }, // a day with sessions but no split
    ]);
    expect(split(db, 'device').filter((r) => r.date === '2026-10-24')).toEqual([
      { date: '2026-10-24', value: 'Desktop', sessions: 80, ps: 2 },
      { date: '2026-10-24', value: 'Mobile', sessions: 300, ps: 6 },
      { date: '2026-10-24', value: 'unknown', sessions: 20, ps: 1 },
    ]);
    expect(split(db, 'country').filter((r) => r.date === '2026-10-24')).toEqual([{ date: '2026-10-24', value: 'US', sessions: 400, ps: 9 }]);
    for (const dimension of ['source', 'device', 'country']) {
      const sums = db.prepare("SELECT b.date, sum(b.sessions) AS s, d.sessions AS total FROM traffic_breakdown_daily b JOIN daily_metrics d USING (store_id, date) WHERE b.store_id = 'glow' AND b.dimension = ? GROUP BY b.date").all(dimension);
      for (const s of sums) expect(s.s).toBe(s.total);
    }
    expect(db.prepare("SELECT status FROM source_datasets WHERE integration_id = 'shopify:glow' AND dataset = 'traffic_breakdowns'").get()?.status).toBe('available');
  });

  it("a failed breakdown read leaves the funnel and earlier rows as they are", async () => {
    const db = setup();
    await syncShopify(db, key, 'glow', fakeShopify(DOC.orders, { funnel: true }).fetchFn, NOW);
    const before = split(db, 'source');
    await syncShopify(db, key, 'glow', fakeShopify(DOC.orders, { funnel: true, breakdowns: false }).fetchFn, NOW);
    expect(split(db, 'source')).toEqual(before);
    expect(db.prepare("SELECT sessions FROM daily_metrics WHERE store_id = 'glow' AND date = '2026-10-24'").get()?.sessions).toBe(400);
    expect(db.prepare("SELECT status FROM source_datasets WHERE integration_id = 'shopify:glow' AND dataset = 'traffic_breakdowns'").get()?.status).toBe('failed');
  });
});
