// SA-36: WooCommerce orders against the REST docs' shapes (fixtures/woocommerce-doc-examples.json names the page and the date read).
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

function fakeWoo(orders = DOC.orders) {
  const fetchFn = (async (url: string) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/settings/general/woocommerce_currency')) return Response.json({ id: 'woocommerce_currency', value: 'USD' });
    if (u.pathname.endsWith('/wp-json/')) return Response.json({ timezone_string: 'America/New_York' });
    if (u.pathname.endsWith('/refunds')) return page([]);
    if (u.pathname.endsWith('/orders')) return page(u.searchParams.get('status') === 'trash' ? [] : orders);
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
    // a partial refund: parts as placed, but they count only once its refund is in the ledger (SA-38)
    expect(c).toMatchObject({ gross: 40, shipping: 5, total: 35, parts: 0 });
  });

  it('an order missing a documented money field keeps no parts (an estimate, never 0)', async () => {
    const db = setup();
    const [first] = structuredClone(DOC.orders);
    delete first.shipping_total;
    await syncWooCommerce(db, key, 'pawsome', fakeWoo([first]).fetchFn, NOW);
    expect(rows(db)[0]).toMatchObject({ id: 'woo-727', gross: null, discounts: null, shipping: null, parts: 0, total: 29.35 });
  });
});
