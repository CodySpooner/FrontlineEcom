// SA-44/45: Amazon order lines, refunds, fees and listings against the SP-API models' shapes (fixtures/amazon-doc-examples.json names them and the date read).
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { saveIntegration } from '../integrations';
import { costMetrics } from '../store-analytics/costs';
import { syncAmazon } from './amazon';

const key = randomBytes(32);
const NOW = new Date('2026-10-26T18:00:00Z');
const DOC = JSON.parse(readFileSync(new URL('./fixtures/amazon-doc-examples.json', import.meta.url), 'utf8'));

function fakeAmazon() {
  return (async (url: string) => {
    const u = new URL(url);
    if (u.hostname === 'api.amazon.com') return Response.json({ access_token: 'Atza|not-a-real-token', expires_in: 3600 });
    if (u.pathname === '/sales/v1/orderMetrics') return Response.json({ payload: [] });
    if (u.pathname === '/orders/2026-01-01/orders') return Response.json({ orders: DOC.orders, lastUpdatedBefore: '2026-10-26T17:58:00Z' });
    if (u.pathname === '/listings/2021-08-01/items/A1SELLER') return Response.json({ items: DOC.listings, pagination: {} });
    if (u.pathname === '/fba/inventory/v1/summaries') return Response.json({ payload: { inventorySummaries: DOC.fba }, pagination: {} });
    if (u.pathname === '/finances/v0/financialEvents') return Response.json({ payload: { FinancialEvents: { ShipmentEventList: DOC.shipments, RefundEventList: DOC.refunds } } });
    return Response.json({ errors: [{ message: 'Access to requested resource is denied.' }] }, { status: 403 }); // roles this test doesn't need
  }) as typeof fetch;
}

function setup() {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  db.prepare("UPDATE stores SET platform = 'amazon' WHERE id = 'peak'").run();
  saveIntegration(db, key, { kind: 'amazon', storeId: 'peak', values: { sellerId: 'A1SELLER', region: 'na', marketplaceId: 'ATVPDKIKX0DER', clientId: 'amzn1.application-oa2-client.not-real', clientSecret: 'not-a-real-secret', refreshToken: 'Atzr|not-a-real-refresh-token' } });
  return db;
}

describe('Amazon lines, refunds and fees contract (SA-44)', () => {
  it('order items are lines; a refund event goes into the ledger by part', async () => {
    const db = setup();
    await syncAmazon(db, key, 'peak', fakeAmazon(), NOW);
    expect(db.prepare("SELECT order_id, line_id, product_id, sku, quantity, gross, discount FROM order_lines WHERE store_id = 'peak' ORDER BY order_id, line_id").all()).toEqual([
      { order_id: 'amz-111-1', line_id: 'OI-1', product_id: 'amz-MUG-1', sku: 'MUG-1', quantity: 2, gross: 40, discount: 2 },
      { order_id: 'amz-111-1', line_id: 'OI-2', product_id: 'amz-CUP-1', sku: 'CUP-1', quantity: 1, gross: 16, discount: 0 },
      { order_id: 'amz-111-2', line_id: 'OI-3', product_id: 'amz-MUG-1', sku: 'MUG-1', quantity: 1, gross: 20, discount: null }, // no proceeds: unknown, not 0
    ]);
    // the selling price net of the promotion given back is merchandise; shipping and tax their own
    expect(db.prepare("SELECT id, order_id, product_id, local_date, merchandise, shipping, tax, other, quantity FROM refunds WHERE store_id = 'peak'").all()).toEqual([
      { id: 'ADJ-1', order_id: 'amz-111-1', product_id: 'amz-MUG-1', local_date: expect.stringMatching(/^2026-10-26$/), merchandise: 19, shipping: 2, tax: 1.6, other: null, quantity: 1 },
    ]);
    expect(db.prepare("SELECT amount FROM amazon_refunds WHERE store_id = 'peak' AND id = 'ADJ-1'").get()?.amount).toBe(20); // legacy unchanged
  });

  it('an order with recorded fees uses them; one without uses the estimate, labelled', async () => {
    const db = setup();
    await syncAmazon(db, key, 'peak', fakeAmazon(), NOW);
    expect(db.prepare("SELECT order_id, kind, amount, local_date, source FROM order_fees WHERE store_id = 'peak' ORDER BY source, kind").all()).toEqual([
      { order_id: 'amz-111-1', kind: 'Commission', amount: -3, local_date: '2026-10-24', source: 'amazon-refund:2026-10-26T09:30:00Z' }, // given back
      { order_id: 'amz-111-1', kind: 'RefundCommission', amount: 0.6, local_date: '2026-10-24', source: 'amazon-refund:2026-10-26T09:30:00Z' },
      { order_id: 'amz-111-1', kind: 'Commission', amount: 8.4, local_date: '2026-10-24', source: 'amazon:2026-10-25T08:00:00Z' },
      { order_id: 'amz-111-1', kind: 'FBAPerUnitFulfillmentFee', amount: 10.75, local_date: '2026-10-24', source: 'amazon:2026-10-25T08:00:00Z' },
    ]);
    db.prepare("UPDATE stores SET fee_percent = 10, fee_per_order = 0 WHERE id = 'peak'").run();
    const fees = costMetrics(db, 'peak', '2026-10-24', '2026-10-24').fees;
    expect(fees.status).toBe('estimated');
    expect(fees.note).toMatch(/^Estimate for 1 order: /);
    expect(fees.value).toBe(18.75); // 16.75 recorded for 111-1 + 10% of 111-2's 20.00
    // a re-read replaces the rows, never adds to them
    await syncAmazon(db, key, 'peak', fakeAmazon(), new Date(NOW.getTime() + 2 * 3_600_000));
    expect(db.prepare("SELECT round(sum(amount), 2) AS s FROM order_fees WHERE store_id = 'peak'").get()?.s).toBe(16.75);
  });
});

describe('Amazon listings (SA-45)', () => {
  it('each SKU is a variant and a listing; FBA stock is Amazon-managed, never tracked; ERROR issues are the error', async () => {
    const db = setup();
    await syncAmazon(db, key, 'peak', fakeAmazon(), NOW);
    expect(db.prepare("SELECT product_id, id, sku, price, inventory, inventory_tracked, inventory_policy, status FROM product_variants WHERE store_id = 'peak' AND id GLOB 'amz-*' ORDER BY id").all()).toEqual([
      { product_id: 'amz-CUP-1', id: 'amz-CUP-1', sku: 'CUP-1', price: 16, inventory: 4, inventory_tracked: 1, inventory_policy: 'deny', status: 'active' },
      { product_id: 'amz-MUG-1', id: 'amz-MUG-1', sku: 'MUG-1', price: 20, inventory: 37, inventory_tracked: 0, inventory_policy: 'fba', status: 'active' },
      { product_id: 'amz-TRAY-1', id: 'amz-TRAY-1', sku: 'TRAY-1', price: null, inventory: null, inventory_tracked: 0, inventory_policy: null, status: 'draft' }, // no offer: price unknown
    ]);
    expect(db.prepare("SELECT id, variant_id, status, error, published_at FROM channel_listings WHERE store_id = 'peak' AND channel = 'amazon' ORDER BY id").all()).toEqual([
      { id: 'amz-CUP-1', variant_id: 'amz-CUP-1', status: 'active', error: null, published_at: null }, // a WARNING isn't an error
      { id: 'amz-MUG-1', variant_id: 'amz-MUG-1', status: 'active', error: null, published_at: null },
      { id: 'amz-TRAY-1', variant_id: 'amz-TRAY-1', status: 'unpublished', error: 'The listing is missing a product image.', published_at: null },
    ]);
    const datasets = db.prepare("SELECT dataset, status FROM source_datasets WHERE integration_id = 'amazon:peak' AND dataset IN ('variants', 'channel_listings') ORDER BY dataset").all();
    expect(datasets).toEqual([{ dataset: 'channel_listings', status: 'available' }, { dataset: 'variants', status: 'available' }]);
  });

  it("a re-read listing keeps its FBA units until FBA inventory gives new ones", async () => {
    const db = setup();
    await syncAmazon(db, key, 'peak', fakeAmazon(), NOW);
    DOC.fba[0].inventoryDetails.fulfillableQuantity = 30;
    try {
      await syncAmazon(db, key, 'peak', fakeAmazon(), new Date(NOW.getTime() + 2 * 3_600_000));
    } finally {
      DOC.fba[0].inventoryDetails.fulfillableQuantity = 37;
    }
    expect(db.prepare("SELECT inventory, inventory_policy FROM product_variants WHERE store_id = 'peak' AND id = 'amz-MUG-1'").get()).toEqual({ inventory: 30, inventory_policy: 'fba' });
  });
});
