import type { PrFeedImport } from '@frontline/shared';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { openDb } from '../db';
import { minorDigits, toMinor } from './money';

beforeEach(() => (vi.useFakeTimers({ toFake: ['Date'] }), vi.setSystemTime(new Date('2026-10-28T10:00:00.000Z'))));
afterEach(() => vi.useRealTimers());
const post = (app: ReturnType<typeof createApp>, body: unknown) => app.request('/api/pr/imports/feed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const HEADER = 'Title,SKU,Currency,Product_Ref,Variant,Unit_Cost,Shipping_Cost,Destination,Delivery_Days_Min,Delivery_Days_Max,Stock,MOQ,Ships_From,GTIN,Checked_At';
const feed = (...rows: string[]) => [HEADER, ...rows, ''].join('\n');

test("money in a currency's minor units: unknown stays unknown, a bad amount is an error, yen has no cents", () => {
  expect([toMinor('3.42', 'USD'), toMinor('3', 'EUR'), toMinor('1200', 'JPY'), toMinor('', 'USD'), toMinor('3,42', 'USD'), toMinor('-1', 'USD'), toMinor('1', 'XYZ1')]).toEqual([342, 300, 1200, null, undefined, undefined, undefined]);
  expect([minorDigits('USD'), minorDigits('JPY'), minorDigits('usd'), minorDigits('ABCD')]).toEqual([2, 0, null, null]);
});

test('a supplier feed: a listing per product, a variant per SKU, an offer per row dated by the file or marked a supplier claim', async () => {
  const db = openDb();
  const app = createApp(db);
  const csv = feed(
    'Paw Cleaner Cup,PC-M,usd,PC,Medium,3.42,4.10,us,6,10,1200,1,cn,0123456789012,2026-10-20',
    'Paw Cleaner Cup,PC-L,USD,PC,Large,3.90,,US,,,0,1,CN,,2026-10-20',
    '"Lick Mat, Slow Feeder",LM-1,JPY,,,450,,JP,2,4,,,JP,,',
    ',,,,,,,,,,,,,,',
  );
  const res = await post(app, { supplier: 'Acme Wholesale', name: 'acme.csv', csv });
  expect(res.status).toBe(201);
  expect((await res.json()) as PrFeedImport).toMatchObject({ duplicate: false, supplier: 'Acme Wholesale', listings: 2, variants: 3, offers: 3, undated: 1 });
  expect(db.prepare('SELECT source, source_ref, origin, title, currency, store_id FROM pr_listings ORDER BY source_ref').all().map((r) => ({ ...r }))).toEqual([
    { source: 'feed:acme-wholesale', source_ref: 'LM-1', origin: 'import', title: 'Lick Mat, Slow Feeder', currency: 'JPY', store_id: null },
    { source: 'feed:acme-wholesale', source_ref: 'PC', origin: 'import', title: 'Paw Cleaner Cup', currency: 'USD', store_id: null },
  ]);
  const offers = db.prepare(`SELECT v.sku, v.gtin, o.supplier, o.destination, o.unit_cost_minor, o.shipping_cost_minor, o.currency, o.delivery_days_min, o.delivery_days_max, o.moq, o.ships_from, o.stock_json, o.provenance, o.checked_at
    FROM pr_offers o JOIN pr_variants v ON v.id = o.variant_id ORDER BY v.sku`).all().map((r) => ({ ...r }));
  expect(offers).toEqual([
    { sku: 'LM-1', gtin: null, supplier: 'Acme Wholesale', destination: 'JP', unit_cost_minor: 450, shipping_cost_minor: null, currency: 'JPY', delivery_days_min: 2, delivery_days_max: 4, moq: null, ships_from: 'JP', stock_json: null, provenance: 'supplier_claim', checked_at: expect.any(String) },
    { sku: 'PC-L', gtin: null, supplier: 'Acme Wholesale', destination: 'US', unit_cost_minor: 390, shipping_cost_minor: null, currency: 'USD', delivery_days_min: null, delivery_days_max: null, moq: 1, ships_from: 'CN', stock_json: '[{"countryCode":"CN","totalInventory":0}]', provenance: 'import', checked_at: '2026-10-20T00:00:00.000Z' },
    { sku: 'PC-M', gtin: '0123456789012', supplier: 'Acme Wholesale', destination: 'US', unit_cost_minor: 342, shipping_cost_minor: 410, currency: 'USD', delivery_days_min: 6, delivery_days_max: 10, moq: 1, ships_from: 'CN', stock_json: '[{"countryCode":"CN","totalInventory":1200}]', provenance: 'import', checked_at: '2026-10-20T00:00:00.000Z' },
  ]);
  expect(db.prepare(`SELECT kind, name FROM pr_files`).all().map((r) => `${r.kind}:${r.name}`)).toEqual(['feed:acme.csv']);

  const again = await post(app, { supplier: 'Acme Wholesale', csv });
  expect(again.status).toBe(200);
  expect(((await again.json()) as PrFeedImport).duplicate).toBe(true);
  expect(db.prepare('SELECT count(*) AS n FROM pr_offers').get()?.n).toBe(3);

  // A newer feed for the same SKU adds an observation; the listing and variant stay one.
  await post(app, { supplier: 'Acme Wholesale', csv: feed('Paw Cleaner Cup,PC-M,USD,PC,Medium,3.10,4.10,US,6,10,900,1,CN,,2026-10-27') });
  expect(db.prepare(`SELECT count(*) AS n FROM pr_variants WHERE sku = 'PC-M'`).get()?.n).toBe(1);
  expect(db.prepare(`SELECT o.unit_cost_minor FROM pr_offers o JOIN pr_variants v ON v.id = o.variant_id WHERE v.sku = 'PC-M' ORDER BY o.checked_at DESC LIMIT 1`).get()?.unit_cost_minor).toBe(310);
});

test('a feed with a bad cell or a missing column is refused whole, with the lines to fix', async () => {
  const db = openDb();
  const app = createApp(db);
  const err = async (body: unknown) => {
    const res = await post(app, body);
    expect(res.status).toBe(400);
    return ((await res.json()) as { error: string }).error;
  };
  expect(await err({ supplier: 'Acme', csv: 'name,price\nCup,3\n' })).toMatch(/^The feed needs the columns title, sku, currency\. Columns it reads: title, sku, currency, product_ref/);
  expect(await err({ supplier: 'Acme', csv: feed('Cup,C1,USD,,,3.42.1,,USA,,,lots,,,,tomorrow-ish') })).toBe(
    'Line 2: unit_cost "3.42.1" is not an amount like 3.42. Line 2: destination "USA" is not a two-letter country code. Line 2: stock "lots" is not a whole number. Line 2: checked_at "tomorrow-ish" is not a past date.',
  );
  expect(await err({ supplier: 'Acme', csv: feed('Cup,C1,DOLLARS,,,3,,,,,,,,,', ',C2,USD,,,3,,,,,,,,,') })).toBe('Line 2: currency "DOLLARS" is not an ISO currency code. Line 3: title is empty.');
  expect(await err({ supplier: 'Acme', csv: feed('Cup,C1,USD,,,3,,US,,,,,,,2030-01-01') })).toMatch(/checked_at "2030-01-01" is not a past date/);
  expect(await err({ supplier: ' ', csv: feed('Cup,C1,USD,,,3,,,,,,,,,') })).toBe('Name the supplier the feed is from.');
  expect(await err({ supplier: 'Acme', csv: HEADER })).toBe('The feed has no rows.');
  expect(db.prepare('SELECT count(*) AS n FROM pr_listings').get()?.n).toBe(0); // nothing half-imported
});
