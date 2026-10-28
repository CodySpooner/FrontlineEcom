import type { PrSignalSet, PrTrendsImport } from '@frontline/shared';
import { expect, test } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { upsertListing } from './catalog';
import { rankDemand } from './facts';
import { parseCsv } from './csv';
import { ADAPTERS } from './sources';
import { parseTrendsCsv } from './trends';

// The layout of classic "Interest over time" exports (multiTimeline.csv). Google doesn't document it (sources doc):
// these follow past files and are checked against the owner's first real export (decision 16).
const classic = (granularity: string, rows: string[], header = 'dog paw cleaner: (United States),lick mat: (United States)') =>
  ['Category: All categories', '', `${granularity},${header}`, ...rows, ''].join('\n');
const weeks = (values: (number | string)[], from = '2025-10-26') => values.map((v, i) => `${new Date(Date.parse(from) + i * 7 * 86_400_000).toISOString().slice(0, 10)},${v}`);

test('CSV rows: quoted cells keep commas, quotes and line breaks; CRLF and a byte-order mark are fine', () => {
  expect(parseCsv('﻿a,"b, c","say ""hi"""\r\n1,"two\nlines",3\r\n')).toEqual([
    ['a', 'b, c', 'say "hi"'],
    ['1', 'two\nlines', '3'],
  ]);
});

test('a weekly comparison export: one series per term with its region, "<1" kept as below one, the category read', () => {
  const f = parseTrendsCsv(classic('Week', ['2025-10-26,45,<1', '2025-11-02,52,3', '2025-11-09,100,<1']));
  expect(f).toEqual({
    category: 'All categories',
    granularity: 'week',
    series: [
      { term: 'dog paw cleaner', region: 'United States', points: [{ at: '2025-10-26', value: 45, belowOne: false }, { at: '2025-11-02', value: 52, belowOne: false }, { at: '2025-11-09', value: 100, belowOne: false }] },
      { term: 'lick mat', region: 'United States', points: [{ at: '2025-10-26', value: 0, belowOne: true }, { at: '2025-11-02', value: 3, belowOne: false }, { at: '2025-11-09', value: 0, belowOne: true }] },
    ],
  });
});

test('daily and monthly exports; a header with no category line, a quoted region and Windows line endings', () => {
  const day = parseTrendsCsv('Day,"ice roller: (Washington, D.C.)"\r\n2026-07-01,12\r\n2026-07-02,15\r\n2026-07-03,9\r\n');
  expect(day).toMatchObject({ category: null, granularity: 'day', series: [{ term: 'ice roller', region: 'Washington, D.C.' }] });
  const month = parseTrendsCsv(classic('Month', ['2021-11,20', '2021-12,64', '2022-01,25'], 'heated blanket: (Worldwide)'));
  expect(month).toMatchObject({ granularity: 'month', series: [{ term: 'heated blanket', region: 'Worldwide', points: [{ at: '2021-11' }, { at: '2021-12', value: 64 }, { at: '2022-01' }] }] });
  // A header the parser doesn't know (a newer layout) still reads: the granularity comes from the dates.
  expect(parseTrendsCsv('Time,posture corrector\n2026-01-04,30\n2026-01-11,31\n')).toMatchObject({ granularity: 'week', series: [{ term: 'posture corrector', region: null }] });
});

test('files that are not a whole Trends "Interest over time" export are refused with the reason', () => {
  const err = (text: string) => (parseTrendsCsv(text) as { error: string }).error;
  expect(err(classic('Week', ['2026-07-01,12', '2026-07-02,15', '2026-07-03,9']))).toBe(
    'The file says weekly ("Week") but its dates are daily: it was edited or mislabelled. Download it again from trends.google.com.',
  );
  expect(err('Category: All categories\n\nRegion,dog paw cleaner: (10/26/25 - 10/26/26)\nTexas,100\nOhio,82\n')).toMatch(/isn't a Google Trends "Interest over time" export/);
  expect(err('title,sku,cost\nPaw cup,CJ1,3.42\n')).toMatch(/isn't a Google Trends/);
  expect(err('Time,ice roller\n2026-10-21T10,40\n2026-10-21T11,42\n')).toMatch(/hourly/);
  expect(err(classic('Week', weeks([45, 101]), 'x: (US)'))).toBe('Line 5: "101" isn\'t a Trends value (a whole number 0–100, or <1).');
  expect(err(classic('Week', weeks([45, '']), 'x: (US)'))).toMatch(/Line 5: "" isn't a Trends value/);
  expect(err(classic('Week', ['2025-10-26,45,1', '2025-11-02,52'], 'a: (US),b: (US)'))).toBe('Line 5 has 2 columns; the header has 3.');
  expect(err(classic('Week', ['2025-10-26,45', '2025-11-02,52', '2025-11-23,50'], 'x: (US)'))).toMatch(/evenly spaced/);
});

function setup() {
  const db = openDb();
  db.exec(`INSERT INTO stores (id, name, platform, niche, currency) VALUES ('x', 'Pawsome', 'shopify', 'pet', 'USD'), ('y', 'Barkley', 'shopify', 'pet', 'GBP')`);
  const add = (sourceRef: string, title: string, extra: { storeId?: string; origin?: 'ingest' | 'owner_link' | 'legacy_sample' } = {}) =>
    upsertListing(db, { source: extra.origin === 'owner_link' ? 'link' : 'cj', sourceRef, title, origin: extra.origin ?? 'ingest', storeId: extra.storeId ?? null, at: '2026-10-20T00:00:00.000Z' }).productId;
  return {
    db,
    shared: add('1', 'Silicone Dog Paw Cleaner Cup'),
    plural: add('2', 'Portable dog paw-cleaners (2 pack)'),
    other: add('3', 'Lick Mat Slow Feeder'),
    privateY: add('https://shop.example/paw', 'Dog Paw Cleaner Pro', { storeId: 'y', origin: 'owner_link' }),
    sample: add('sample-1', 'Dog Paw Cleaner Sample', { origin: 'legacy_sample' }),
  };
}
const post = (app: ReturnType<typeof createApp>, path: string, body: unknown) => app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
/** 30 weeks: steady around 40, so the class is Sustained interest. */
const steady = classic('Week', weeks(Array.from({ length: 30 }, (_, i) => (i % 2 ? 44 : 36))), 'dog paw cleaner: (United States)');
const facts = (db: Db, productId: string) => db.prepare('SELECT destination, currency, demand_class, momentum, demand_set_id FROM pr_product_facts WHERE product_id = ? ORDER BY destination, currency').all(productId).map((r) => ({ ...r }));

test('an import keeps the file, makes a query-level set per term and suggests only products the scope may see', async () => {
  const { db, shared, plural, privateY } = setup();
  const app = createApp(db);
  const res = await post(app, '/api/pr/imports/trends?store=x', { name: 'multiTimeline.csv', csv: steady });
  expect(res.status).toBe(201);
  const r = (await res.json()) as PrTrendsImport;
  expect(r).toMatchObject({ duplicate: false, category: 'All categories' });
  expect(r.sets).toHaveLength(1);
  const set = r.sets[0]!;
  expect(set).toMatchObject({
    platform: 'google_trends', query: 'dog paw cleaner', region: 'United States', granularity: 'week', metric: 'interest_over_time',
    scope: 'query', origin: 'import', periodStart: '2025-10-26', points: 30, demandClass: 'sustained',
  });
  // Suggested, not confirmed. Store y's private product and the sample row are never suggested to store x.
  expect(set.links.map((l) => [l.productId, l.confirmed]).sort()).toEqual([[plural, false], [shared, false]].sort());
  expect(db.prepare('SELECT product_id FROM pr_signal_links').all().map((l) => l.product_id)).not.toContain(privateY);
  expect({ ...db.prepare('SELECT kind, name, body FROM pr_files').get() }).toEqual({ kind: 'trends', name: 'multiTimeline.csv', body: steady });
  expect(facts(db, shared)).toEqual([]); // a suggestion is not evidence

  const again = await post(app, '/api/pr/imports/trends?store=x', { csv: steady });
  expect(again.status).toBe(200);
  expect(((await again.json()) as PrTrendsImport)).toMatchObject({ duplicate: true, fileId: r.fileId });
  expect(db.prepare('SELECT count(*) AS n FROM pr_signals').get()?.n).toBe(1);

  const bad = await post(app, '/api/pr/imports/trends', { csv: 'title,sku\nPaw,1\n' });
  expect(bad.status).toBe(400);
  expect(((await bad.json()) as { error: string }).error).toMatch(/isn't a Google Trends/);
});

test("the owner's confirmation makes a query set the product's demand evidence; removing the link takes it back", async () => {
  const { db, shared, plural, other, privateY } = setup();
  const app = createApp(db);
  const set = ((await (await post(app, '/api/pr/imports/trends', { csv: steady })).json()) as PrTrendsImport).sets[0]!;
  const ok = await post(app, `/api/pr/signals/${set.id}/links`, { productId: shared, confirmed: true });
  expect(ok.status).toBe(200);
  expect(((await ok.json()) as PrSignalSet).links.find((l) => l.productId === shared)?.confirmed).toBe(true);
  // One row per store ship-to and currency (USD store → US, GBP store → GB), and All stores' GB in the base currency.
  expect(facts(db, shared)).toEqual([
    { destination: 'GB', currency: 'GBP', demand_class: 'sustained', momentum: 1.02, demand_set_id: set.id },
    { destination: 'GB', currency: 'USD', demand_class: 'sustained', momentum: 1.02, demand_set_id: set.id },
    { destination: 'US', currency: 'USD', demand_class: 'sustained', momentum: 1.02, demand_set_id: set.id },
  ]);
  rankDemand(db, plural); // still only suggested: not evidence
  expect(facts(db, plural).map((f) => f.demand_class)).toEqual([null, null, null]);
  // The owner may link a product the match didn't suggest.
  expect((await post(app, `/api/pr/signals/${set.id}/links`, { productId: other, confirmed: true })).status).toBe(200);
  expect(facts(db, other)[0]?.demand_class).toBe('sustained');

  await post(app, `/api/pr/signals/${set.id}/links`, { productId: shared, confirmed: false });
  expect(facts(db, shared).map((f) => f.demand_class)).toEqual([null, null, null]);
  expect(db.prepare('SELECT count(*) AS n FROM pr_signal_links WHERE product_id = ?').get(shared)?.n).toBe(0);

  expect((await post(app, `/api/pr/signals/${set.id}/links?store=x`, { productId: privateY, confirmed: true })).status).toBe(404); // store y's product
  expect((await post(app, '/api/pr/signals/nope/links', { productId: shared, confirmed: true })).status).toBe(404);
  expect((await post(app, `/api/pr/signals/${set.id}/links`, { productId: shared })).status).toBe(400);
});

test("an import from a product's page is that product's evidence at once; the newest set with enough history wins", async () => {
  const { db, shared, privateY } = setup();
  const app = createApp(db);
  const res = await post(app, '/api/pr/imports/trends?store=x', { csv: steady, productId: shared });
  const set = ((await res.json()) as PrTrendsImport).sets[0]!;
  expect(set).toMatchObject({ scope: 'product', links: [] });
  expect(facts(db, shared).map((f) => f.demand_set_id)).toEqual([set.id, set.id, set.id]);
  expect((await post(app, `/api/pr/signals/${set.id}/links`, { productId: shared, confirmed: true })).status).toBe(400); // already the product's

  // A newer, shorter export doesn't replace the set that has enough history.
  const short = classic('Week', weeks([40, 41, 42], '2026-09-01'), 'paw cleaner: (US)');
  await post(app, '/api/pr/imports/trends', { csv: short, productId: shared });
  expect(facts(db, shared).map((f) => f.demand_set_id)).toEqual([set.id, set.id, set.id]);

  expect((await post(app, '/api/pr/imports/trends?store=x', { csv: steady, productId: privateY })).status).toBe(404);
  expect((await post(app, '/api/pr/imports/trends?store=nope', { csv: steady })).status).toBe(404);
});

test('an upload may be large (the guard lets imports through to 15 MB); every other /api/pr body stops at 1 MB', async () => {
  const { db } = setup();
  const app = createApp(db);
  const big = 'x'.repeat(1_500_000);
  const upload = await post(app, '/api/pr/imports/trends', { csv: big });
  expect(upload.status).toBe(400); // past the guard; refused by the route as no Trends export
  expect((await post(app, '/api/pr/signals/s1/links', { productId: big, confirmed: true })).status).toBe(413);
});

test('both Google Trends sources are declared with their status; neither is ever scheduled', () => {
  const by = Object.fromEntries(ADAPTERS.map((a) => [a.id, a]));
  const db = openDb();
  expect(by.google_trends_csv?.access(db, Buffer.alloc(32))).toBe('authorized_import');
  expect(by.google_trends_api?.access(db, Buffer.alloc(32))).toBe('approval_required');
  expect(by.google_trends_api?.connect).toContain('https://developers.google.com/search/apis/trends#apply');
  expect([by.google_trends_csv?.page, by.google_trends_api?.page, by.google_trends_api?.plan]).toEqual([undefined, undefined, undefined]);
});
