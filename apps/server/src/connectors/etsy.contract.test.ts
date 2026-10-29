// SA-41/42: Etsy receipts, variants and listings against the Open API spec's shapes (fixtures/etsy-doc-examples.json names the spec and the date read).
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { saveIntegration } from '../integrations';
import { checkOrderIdentity } from '../store-analytics/reconcile';
import { syncEtsy } from './etsy';

const key = randomBytes(32);
const NOW = new Date('2026-10-26T18:00:00Z');
const DOC = JSON.parse(readFileSync(new URL('./fixtures/etsy-doc-examples.json', import.meta.url), 'utf8'));

function fakeEtsy(receipts = DOC.receipts, listings = DOC.listings, asked: string[] = []) {
  return (async (url: string) => {
    const u = new URL(url);
    asked.push(u.pathname);
    const inv = /\/listings\/(\d+)\/inventory$/.exec(u.pathname)?.[1];
    if (inv) return DOC.inventory[inv] ? Response.json(DOC.inventory[inv]) : Response.json({ error: 'Listing has no inventory records' }, { status: 404 });
    if (u.pathname.endsWith('/listings')) {
      const results = listings.filter((l: { state: string }) => l.state === u.searchParams.get('state'));
      return Response.json({ count: results.length, results: Number(u.searchParams.get('offset')) ? [] : results });
    }
    if (u.pathname === '/v3/public/oauth/token') return Response.json({ access_token: '123.at_not-a-real-token', refresh_token: '123.rt_not-a-real-token', expires_in: 3600 });
    if (u.pathname.endsWith('/receipts')) return Response.json({ count: receipts.length, results: Number(u.searchParams.get('offset')) ? [] : receipts });
    return Response.json({ count: 0, results: [] });
  }) as typeof fetch;
}

function setup() {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  saveIntegration(db, key, { kind: 'etsy', storeId: 'pawsome', values: { shopId: '4455', apiKey: 'keystr-not-real', sharedSecret: 'not-a-real-secret', accessToken: '123.at_old', refreshToken: '123.rt_old' } });
  return db;
}
const orders = (db: ReturnType<typeof openDb>) =>
  db.prepare(
    `SELECT o.id, o.source_id, o.channel, o.currency, o.gross_sales AS gross, o.discounts, o.shipping, o.tax, o.total, o.paid_at, o.breakdown_at IS NOT NULL AS parts,
       o.customer_ref AS ref, o.customer_state AS state, o.country,
       (SELECT coalesce(sum(coalesce(merchandise, 0) + coalesce(other, 0)), 0) FROM refunds r WHERE r.store_id = o.store_id AND r.order_id = o.id) AS back
     FROM orders o WHERE o.store_id = 'pawsome' ORDER BY o.id`,
  ).all();

describe('Etsy receipts contract (SA-41)', () => {
  it('money parts from the documented totals, refunds dated by the refund; the identity holds', async () => {
    const db = setup();
    await syncEtsy(db, key, 'pawsome', fakeEtsy(), NOW);
    const [a, b, c, d, e] = orders(db);
    expect(a).toMatchObject({ id: 'etsy-1001', source_id: '1001', channel: 'etsy', currency: 'USD', gross: 50, discounts: 5, shipping: 6, tax: 3.6, total: 54.6, paid_at: '2026-10-25T14:00:30.000Z', parts: 1 });
    expect(b).toMatchObject({ gross: 30, shipping: 4, tax: 2, total: 26, parts: 1 });
    expect(c).toMatchObject({ gross: 20, shipping: 5, total: 0, parts: 1 }); // canceled with its refund
    expect(d).toMatchObject({ gross: 18, parts: 1 }); // gift wrap closes the gap
    expect(e).toMatchObject({ gross: null, parts: 0, total: 99 }); // parts that don't add up: an estimate, never a guess
    for (const o of [a, b, c, d]) {
      expect(checkOrderIdentity({ gross: Number(o!.gross), discounts: Number(o!.discounts), shipping: Number(o!.shipping), tax: Number(o!.tax), refunds: Number(o!.back), total: Number(o!.total) }).ok).toBe(true);
    }
    expect(db.prepare("SELECT order_id, local_date, merchandise, other FROM refunds WHERE store_id = 'pawsome' ORDER BY order_id").all()).toEqual([
      { order_id: 'etsy-1002', local_date: '2026-10-26', merchandise: 10, other: null },
      { order_id: 'etsy-1003', local_date: '2026-10-26', merchandise: 20, other: 5 }, // merchandise up to the receipt's, the rest other (Q30)
    ]);
  });

  it('transactions are lines; the buyer is a ref (0 = guest); the country code only', async () => {
    const db = setup();
    await syncEtsy(db, key, 'pawsome', fakeEtsy(), NOW);
    expect(db.prepare("SELECT order_id, line_id, product_id, variant_id, sku, quantity, gross, discount, cost FROM order_lines WHERE store_id = 'pawsome' AND order_id = 'etsy-1001' ORDER BY line_id").all()).toEqual([
      { order_id: 'etsy-1001', line_id: '5001', product_id: 'etsy-11', variant_id: 'etsy-501', sku: 'MUG-W', quantity: 1, gross: 25, discount: 5, cost: null },
      { order_id: 'etsy-1001', line_id: '5002', product_id: 'etsy-12', variant_id: 'etsy-502', sku: null, quantity: 2, gross: 25, discount: 0, cost: null },
    ]);
    const [a, b, guest] = orders(db);
    expect(a).toMatchObject({ state: 'identified', country: 'US', ref: expect.stringMatching(/^c_[0-9a-f]{24}$/) });
    expect(b!.ref).toBe(a!.ref);
    expect(guest).toMatchObject({ ref: null, state: 'guest', country: 'GB' });
  });
});

describe('Etsy variants and listings (SA-42)', () => {
  it("an inventory's products are the variants; no inventory records: the listing is its own; the listing state", async () => {
    const db = setup();
    await syncEtsy(db, key, 'pawsome', fakeEtsy(), NOW);
    expect(db.prepare("SELECT product_id, id, title, sku, price, inventory, status FROM product_variants WHERE store_id = 'pawsome' ORDER BY id").all()).toEqual([
      { product_id: 'etsy-13', id: 'etsy-13', title: null, sku: 'GC', price: 50, inventory: 1, status: 'draft' }, // 404: the listing itself
      { product_id: 'etsy-11', id: 'etsy-501', title: 'White', sku: 'MUG-W', price: 25, inventory: 4, status: 'active' },
      { product_id: 'etsy-12', id: 'etsy-502', title: null, sku: null, price: 12.5, inventory: 0, status: 'active' },
      { product_id: 'etsy-11', id: 'etsy-503', title: 'Blue', sku: 'MUG-B', price: 27, inventory: 3, status: 'active' }, // a deleted offering left out
      { product_id: 'etsy-11', id: 'etsy-505', title: 'Green', sku: null, price: 25, inventory: 0, status: 'draft' }, // no enabled offering
    ]);
    expect(db.prepare("SELECT channel, id, status, published_at FROM channel_listings WHERE store_id = 'pawsome' ORDER BY id").all()).toEqual([
      { channel: 'etsy', id: 'etsy-11', status: 'active', published_at: '2026-09-25T14:00:00.000Z' },
      { channel: 'etsy', id: 'etsy-12', status: 'active', published_at: '2026-10-23T14:00:00.000Z' }, // sold out is still listed
      { channel: 'etsy', id: 'etsy-13', status: 'unpublished', published_at: null },
    ]);
  });

  it('at most 50 inventory reads a sync; the rest show as pending and come next sync', async () => {
    const db = setup();
    const many = Array.from({ length: 52 }, (_, i) => ({ ...DOC.listings[0], listing_id: 100 + i }));
    const asked: string[] = [];
    await syncEtsy(db, key, 'pawsome', fakeEtsy([], many, asked), NOW);
    expect(asked.filter((p) => p.endsWith('/inventory'))).toHaveLength(50);
    const dataset = () => db.prepare("SELECT status, error FROM source_datasets WHERE integration_id = 'etsy:pawsome' AND dataset = 'variants'").get();
    expect(dataset()).toEqual({ status: 'partial', error: "2 listings' variants pending (at most 50 inventory reads a sync)" });
    const next: string[] = [];
    await syncEtsy(db, key, 'pawsome', fakeEtsy([], many, next), new Date(NOW.getTime() + 120_000));
    expect(next.filter((p) => p.endsWith('/inventory'))).toHaveLength(2);
    expect(dataset()).toEqual({ status: 'available', error: null });
  });
});
