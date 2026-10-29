// SA-27/28: Shopify orders and refunds against the reference's shapes (fixtures/shopify-doc-examples.json names the pages and the date
// read), and the static cost of every Shopify read.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { saveIntegration } from '../integrations';
import { checkOrderIdentity } from '../store-analytics/reconcile';
import { salesMetrics } from '../store-analytics/sales';
import { SHOPIFY_READS, syncShopify } from './shopify';

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

function fakeShopify(orders = DOC.orders) {
  const asked: string[] = [];
  const fetchFn = (async (_url: string, init: RequestInit) => {
    const { query, variables } = JSON.parse(String(init.body)) as { query: string; variables: { id?: string } };
    asked.push(query);
    const json = (data: unknown) => Response.json({ data });
    if (query.includes('shop {')) return json({ shop: DOC.shop });
    if (query.includes('products(') || query.includes('events(')) return json({ [query.includes('events(') ? 'events' : 'products']: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } });
    if (query.includes('shopifyqlQuery')) return Response.json({ errors: [{ message: 'Access denied for shopifyqlQuery field.' }] });
    if (query.includes('refunds(')) return json({ order: { refunds: DOC.refunds[variables.id!] ?? [] } });
    return json({ orders });
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
    expect(asked.find((q) => q.includes('orders('))).not.toContain('customer {'); // SA-32 probes it first
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
