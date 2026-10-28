import { econInputs, type PrEconomics, type PrProductDetail } from '@frontline/shared';
import { expect, test } from 'vitest';
import { createApp } from '../app';
import { openDb } from '../db';
import { upsertListing } from './catalog';
import { refreshProduct } from './evaluate';
import { linkStoreProduct } from './evidence';

const NOW = new Date();

function setup() {
  const db = openDb();
  db.exec(`INSERT INTO stores (id, name, platform, niche, currency, demo, connected) VALUES ('a', 'Paws', 'shopify', 'pet', 'USD', 1, 1)`);
  db.exec(`INSERT INTO stores (id, name, platform, niche, currency, demo, connected, fee_percent, fee_per_order) VALUES ('b', 'Glow', 'shopify', 'beauty', 'USD', 1, 1, 2.9, 0.3)`);
  const app = createApp(db);
  const { id: listing, productId: p } = upsertListing(db, { source: 'cj', sourceRef: '1', title: 'Dog grooming brush', category: 'Pet Supplies > Grooming', origin: 'ingest' });
  db.prepare(`INSERT INTO pr_variants (id, listing_id, source_ref, sku, attributes_json) VALUES ('v1', ?, 'v1', 'CJ-BRUSH-M', '{"name":"M / Grey"}')`).run(listing);
  db.prepare(
    `INSERT INTO pr_offers (id, listing_id, variant_id, supplier, destination, quantity, method, unit_cost_minor, shipping_cost_minor, currency, delivery_days_min, delivery_days_max, ships_from, stock_json, provenance, checked_at)
     VALUES ('us', ?, 'v1', 'CJdropshipping', 'US', 1, 'CJPacket', 342, 410, 'USD', 6, 12, 'CN', '[{"countryCode":"CN","totalInventory":120}]', 'live', ?)`,
  ).run(listing, new Date(NOW.getTime() - 86_400_000).toISOString());
  refreshProduct(db, p, NOW);
  const send = (method: string, path: string, body?: unknown) =>
    app.request(path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const json = async <T>(r: Response | Promise<Response>) => (await (await r).json()) as T;
  return { db, p, send, json };
}

test('the base inputs carry their provenance; a required unknown leaves the base incomplete, never a zero', async () => {
  const { p, send, json } = setup();
  const e = await json<PrEconomics>(send('GET', `/api/pr/products/${p}/economics?store=a`));
  expect(e).toMatchObject({ currency: 'USD', rateDate: null, saved: { base: {}, conservative: {}, optimistic: {} }, updatedAt: null });
  expect(e.derived.supplierCost).toEqual({ value: 342, tag: 'verified', note: expect.stringMatching(/^CJdropshipping · live · checked \d{4}-\d\d-\d\d$/) });
  expect(e.derived.shipping).toMatchObject({ value: 410, tag: 'verified' });
  expect(e.derived.price).toEqual({ value: null, tag: null, note: 'Needs a selling price' });
  expect(e.derived.feePercent).toEqual({ value: null, tag: null, note: 'Store fees not set' }); // 0 and 0 in Settings: not set
  expect(e.derived.discountPct).toEqual({ value: 0, tag: 'assumption', note: 'No discount' });
  expect(e.derived.duties).toEqual({ value: null, tag: null, note: 'Unknown by default' });
  const d = await json<PrProductDetail>(send('GET', `/api/pr/products/${p}?store=a`));
  expect(d.assessment.economics).toEqual({ currency: 'USD', result: { missing: ['price', 'feePercent', 'feePerOrder'], excluded: ['duties', 'otherCosts'], figures: null } });
  expect(d.assessment.confidence.has.economics).toBe(false);
});

test("the owner's figures complete the base and count toward confidence; scenarios keep only what the owner set", async () => {
  const { p, send, json } = setup();
  const put = (body: unknown) => send('PUT', `/api/pr/products/${p}/economics?store=a`, body);
  const saved = await json<PrEconomics>(put({ base: { price: 2999, feePercent: 2.9, feePerOrder: 30 }, conservative: { returnRatePct: 10, returnCost: 500 }, optimistic: {} }));
  expect(saved.saved).toEqual({ base: { price: 2999, feePercent: 2.9, feePerOrder: 30 }, conservative: { returnRatePct: 10, returnCost: 500 }, optimistic: {} });
  expect(econInputs(saved, 'conservative')).toMatchObject({ price: 2999, supplierCost: 342, returnRatePct: 10, returnCost: 500 }); // the rest as base
  expect(saved.updatedAt).not.toBeNull();
  const d = await json<PrProductDetail>(send('GET', `/api/pr/products/${p}?store=a`));
  expect(d.assessment.economics!.result.figures).toMatchObject({ orderValue: 2999, fees: 117, variableCosts: 342 + 410 + 117, before: 2999 - 869 });
  expect(d.assessment.confidence.has.economics).toBe(true);
  // A save replaces the saved figures: the conservative scenario is "same as base" again.
  expect((await json<PrEconomics>(put({ base: { price: 2999, feePercent: 2.9, feePerOrder: 30 } }))).saved.conservative).toEqual({});

  for (const [body, error] of [
    [{ base: { price: 29.99 } }, 'base.price must be an amount in minor units (0 or more)'],
    [{ base: { discountPct: 120 } }, 'base.discountPct must be a percentage from 0 to 100'],
    [{ optimistic: { margin: 5 } }, 'optimistic.margin is not an economics input'],
    [{ base: [] }, 'base must be an object of figures'],
  ] as const) {
    const r = await put(body);
    expect([r.status, ((await r.json()) as { error: string }).error]).toEqual([400, error]);
  }
  expect((await send('GET', `/api/pr/products/${p}/economics?store=all`)).status).toBe(400); // kept per store
});

test("a store that sells the product brings its own price; a store's fee settings are the owner's", async () => {
  const { db, p, send, json } = setup();
  db.prepare(`INSERT INTO products (id, store_id, title, price, cost, status) VALUES ('sp1', 'b', 'Grooming brush', 24.5, 3, 'active')`).run();
  expect(linkStoreProduct(db, 'b', p, 'sp1', NOW)).toBeNull();
  const e = await json<PrEconomics>(send('GET', `/api/pr/products/${p}/economics?store=b`));
  expect(e.derived.price).toEqual({ value: 2450, tag: 'owner', note: "Your store's price" });
  expect([e.derived.feePercent, e.derived.feePerOrder]).toEqual([{ value: 2.9, tag: 'owner', note: 'Store settings' }, { value: 30, tag: 'owner', note: 'Store settings' }]);
  expect((await json<PrProductDetail>(send('GET', `/api/pr/products/${p}?store=b`))).assessment.economics!.result.figures).toMatchObject({ before: 2450 - 342 - 410 - (71 + 30) });
});

test("mixed currencies: a EUR offer is converted to the store's currency with the rates' date; with no rate it stays unknown, never the EUR amount", async () => {
  const { db, send, json } = setup();
  const { id: listing, productId: q } = upsertListing(db, { source: 'cj', sourceRef: '2', title: 'Cat window perch', category: 'Pet Supplies > Cat', origin: 'ingest' });
  db.prepare(`INSERT INTO pr_variants (id, listing_id, source_ref, sku, attributes_json) VALUES ('v2', ?, 'v2', 'CJ-PERCH', '{"name":"Grey"}')`).run(listing);
  db.prepare(
    `INSERT INTO pr_offers (id, listing_id, variant_id, supplier, destination, quantity, method, unit_cost_minor, shipping_cost_minor, currency, delivery_days_min, delivery_days_max, ships_from, stock_json, provenance, checked_at)
     VALUES ('eur', ?, 'v2', 'CJdropshipping', 'US', 1, 'CJPacket', 342, 410, 'EUR', 6, 12, 'CN', '[{"countryCode":"CN","totalInventory":50}]', 'live', ?)`,
  ).run(listing, new Date(NOW.getTime() - 86_400_000).toISOString());
  refreshProduct(db, q, NOW);
  const none = await json<PrEconomics>(send('GET', `/api/pr/products/${q}/economics?store=a`));
  expect(none).toMatchObject({ currency: 'USD', rateDate: null });
  expect(none.derived.supplierCost).toMatchObject({ value: null, tag: null });
  db.prepare(`INSERT INTO settings (key, value_json) VALUES ('fx', ?)`).run(JSON.stringify({ date: '2026-10-27', rates: { EUR: 1, USD: 1.1 } }));
  refreshProduct(db, q, NOW);
  const e = await json<PrEconomics>(send('GET', `/api/pr/products/${q}/economics?store=a`));
  expect(e).toMatchObject({ currency: 'USD', rateDate: '2026-10-27' });
  expect(e.derived.supplierCost).toMatchObject({ value: 376, tag: 'verified' }); // €3.42 × 1.1
  expect(e.derived.shipping).toMatchObject({ value: 451, tag: 'verified' }); // €4.10 × 1.1
});
