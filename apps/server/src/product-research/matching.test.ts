import { randomBytes } from 'node:crypto';
import type { PrHistoryRow, PrMatches, PrOffer } from '@frontline/shared';
import { expect, test } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { saveIntegration } from '../integrations';
import { upsertListing } from './catalog';
import { refreshProduct } from './evaluate';
import { judge, searchCjAlternatives, type Ident } from './matching';
import doc from './sources/fixtures/cj-doc-examples.json';

const NOW = new Date('2026-10-28T10:00:00.000Z');
const key = randomBytes(32);
const id = (o: Partial<Ident>): Ident => ({ title: 'Dog grooming brush', category: 'Pet Supplies > Grooming', supplier: 'CJdropshipping', sku: [], gtin: [], mpn: [], variants: [], ...o });

test('the rule: Exact only on a shared GTIN, MPN or SKU; everything else Similar, with what matches and what differs', () => {
  expect(judge(id({ gtin: ['0123'] }), id({ title: 'Grooming glove', supplier: 'Acme', gtin: ['0123'] }))).toEqual({
    verdict: 'exact', matching: ['GTIN 0123', 'Title words: grooming', 'Category'], differing: ['Title', 'Supplier'], shared: 1,
  });
  expect(judge(id({}), id({ supplier: 'Acme' }))).toMatchObject({ verdict: 'similar', matching: ['Title', 'Category'], differing: ['Supplier'] }); // a lookalike is never merged by the rule
  expect(judge(id({ mpn: ['X1'], variants: ['M / Grey'] }), id({ title: 'Dog brush, grooming', mpn: ['X2'], variants: ['L / Blue'] }))).toMatchObject({
    verdict: 'similar', matching: ['Title words: dog, grooming, brush', 'Category', 'Supplier'], differing: ['MPN', 'Title', 'Variants'],
  });
});

function setup() {
  const db = openDb();
  db.exec(`INSERT INTO stores (id, name, platform, niche, currency, demo, connected) VALUES ('a', 'Paws', 'shopify', 'pet', 'USD', 1, 1), ('b', 'Glow', 'shopify', 'beauty', 'USD', 1, 1)`);
  const app = createApp(db, key);
  const listing = (ref: string, title: string, o: { supplier?: string; store?: string; gtin?: string } = {}) => {
    const l = upsertListing(db, { source: o.supplier ? `feed:${o.supplier.toLowerCase()}` : 'cj', sourceRef: ref, title, category: 'Pet Supplies > Grooming', origin: 'ingest', ...(o.store ? { storeId: o.store } : {}), ...(o.supplier ? { transform: { supplier: o.supplier } } : {}) });
    if (o.gtin) db.prepare(`INSERT INTO pr_variants (id, listing_id, source_ref, sku, gtin, attributes_json) VALUES (?, ?, ?, NULL, ?, '{}')`).run(`v${ref}`, l.id, `v${ref}`, o.gtin);
    return l;
  };
  const send = async <T>(method: string, path: string, body?: unknown) => {
    const r = await app.request(path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, body: (await r.json()) as T };
  };
  return { db, listing, send };
}

const offer = (db: Db, listing: string, variant: string, unit: number) =>
  db.prepare(
    `INSERT INTO pr_offers (id, listing_id, variant_id, supplier, destination, quantity, method, unit_cost_minor, shipping_cost_minor, currency, delivery_days_max, ships_from, stock_json, provenance, checked_at)
     VALUES (?, ?, ?, 'Acme', 'US', 1, 'Post', ?, 300, 'USD', 9, 'US', '[{"countryCode":"US","totalInventory":50}]', 'live', ?)`,
  ).run(`o-${listing}`, listing, variant, unit, new Date(NOW.getTime() - 86_400_000).toISOString());

test("candidates: a shared code is an Exact match, a lookalike from another supplier is Similar; the owner's word overrides, and a merge keeps every listing", async () => {
  const { db, listing, send } = setup();
  const p = listing('1', 'Dog grooming brush', { gtin: '0123' });
  const twin = listing('2', 'Pet deshedding comb', { supplier: 'Acme', gtin: '0123' });
  const look = listing('3', 'Self-cleaning dog grooming brush', { supplier: 'Brushco' });
  listing('4', 'Kitchen spatula set');
  const theirs = listing('5', 'Dog grooming brush', { supplier: 'Mine', store: 'b' }); // another store's private listing
  offer(db, twin.id, 'v2', 250);
  refreshProduct(db, twin.productId, NOW);
  const url = `/api/pr/products/${p.productId}/matches?store=a`;
  const m = (await send<PrMatches>('GET', url)).body;
  expect(m.candidates.map((c) => [c.title, c.supplier, c.verdict, c.by])).toEqual([
    ['Pet deshedding comb', 'Acme', 'exact', 'rule'],
    ['Self-cleaning dog grooming brush', 'Brushco', 'similar', 'rule'],
  ]);
  expect(m.candidates[0]).toMatchObject({ matching: ['GTIN 0123', 'Category'], differing: ['Title', 'Supplier'], costShip: 550, fulfillment: 'verified' });
  expect(m.cj).toBe(false);

  // The owner's word: same, not the same (History), undo.
  const act = (listingId: string, action: string) => send<PrMatches & { error: string }>('POST', `/api/pr/products/${p.productId}/matches/${listingId}?store=a`, { action });
  expect((await act(look.id, 'merge')).body.error).toBe('Only an exact match can be merged: confirm it is the same product first');
  const lookalike = async (action: string) => (await act(look.id, action)).body.candidates.find((c) => c.listingId === look.id);
  expect(await lookalike('same')).toMatchObject({ verdict: 'exact', by: 'owner' });
  expect(await lookalike('not_same')).toMatchObject({ verdict: 'separate', by: 'owner' });
  expect(await lookalike('undo')).toMatchObject({ verdict: 'similar', by: 'rule' });
  expect((await act(p.id, 'same')).status).toBe(409); // its own listing
  expect((await act(look.id, 'shrug')).status).toBe(400);
  expect((await act(theirs.id, 'same')).body).toEqual({ error: 'listing not found' }); // store b's private listing

  // Merge: the twin's listing (and its offer) move here, nothing is dropped; the twin leaves discovery.
  const merged = (await act(twin.id, 'merge')).body;
  expect(merged.listings).toEqual([
    { id: p.id, title: 'Dog grooming brush', supplier: 'CJdropshipping', mergedFrom: null },
    { id: twin.id, title: 'Pet deshedding comb', supplier: 'Acme', mergedFrom: twin.productId },
  ]);
  expect(merged.candidates.map((c) => c.title)).toEqual(['Self-cleaning dog grooming brush']);
  expect((await send<PrOffer[]>('GET', `/api/pr/products/${p.productId}/offers?store=a`)).body.map((o) => o.unitCost)).toEqual([250]);
  expect((await send('GET', `/api/pr/products/${twin.productId}?store=a`)).status).toBe(404);
  expect(db.prepare('SELECT merged_into FROM pr_products WHERE id = ?').get(twin.productId)?.merged_into).toBe(p.productId);

  // Separate: back to two products, as before.
  const split = (await act(twin.id, 'split')).body;
  expect(split.listings.map((l) => l.id)).toEqual([p.id]);
  expect(split.candidates.at(-1)).toMatchObject({ title: 'Pet deshedding comb', verdict: 'separate', by: 'owner' });
  expect((await send('GET', `/api/pr/products/${twin.productId}?store=a`)).status).toBe(200);
  const history = (await send<PrHistoryRow[]>('GET', `/api/pr/products/${p.productId}/history?store=a`)).body;
  expect(history.filter((h) => h.kind !== 'stage').map((h) => [h.kind, h.reason])).toEqual([
    ['separate', 'Separated "Pet deshedding comb" (Acme) back into its own product'],
    ['merge', 'Merged "Pet deshedding comb" (Acme) into this product; every listing is kept'],
    ['separate', 'Not the same product as "Self-cleaning dog grooming brush" (Brushco)'],
  ]);
});

test('"Already in your store": linked products, possible ones by title, and the ones the owner ruled out', async () => {
  const { db, listing, send } = setup();
  const p = listing('1', 'Dog grooming brush');
  db.exec(`INSERT INTO products (store_id, id, title, price) VALUES ('a', 's1', 'Grooming Brush for Dogs', 19.99), ('a', 's2', 'Dog Grooming Glove', 14.99), ('a', 's3', 'Cat bed', 30), ('b', 's4', 'Dog grooming brush', 20)`);
  const inStore = async () => (await send<PrMatches>('GET', `/api/pr/products/${p.productId}/matches?store=a`)).body.inStore.map((s) => [s.id, s.linked]);
  expect(await inStore()).toEqual([['s1', false], ['s2', false]]); // never another store's
  expect((await send('POST', `/api/pr/products/${p.productId}/store-products?store=a`, { storeProductId: 's2', same: false })).status).toBe(201);
  expect((await send('POST', `/api/pr/products/${p.productId}/store-products?store=a`, { storeProductId: 's1' })).status).toBe(201);
  expect(await inStore()).toEqual([['s1', true]]);
  expect((await send('POST', `/api/pr/products/${p.productId}/store-products?store=a`, { storeProductId: 's4', same: false })).status).toBe(404);
});

test('Search CJdropshipping: at most 3 catalog calls, results stored as listings; without the key, no call at all', async () => {
  const { db, listing } = setup();
  const p = listing('1', 'Silicone dog paw cleaner cup', { gtin: '0123' });
  const store = { id: 'a', name: 'Paws', platform: 'shopify', niche: 'pet', currency: 'USD' } as Parameters<typeof searchCjAlternatives>[2];
  const calls: string[] = [];
  const fetchFn = (async (url: string) => {
    const u = new URL(url);
    calls.push(`${u.pathname.replace('/api2.0/v1', '')} ${u.searchParams.get('keyWord') ?? ''}`.trim());
    return Response.json(u.pathname.endsWith('getAccessToken') ? doc.token : doc.listV2);
  }) as typeof fetch;
  expect(await searchCjAlternatives(db, key, store, p.productId, { fetchFn, gapMs: 0, now: NOW })).toEqual({ calls: 0, stored: 0, error: 'CJ: not connected: enter the API key in Integrations' });
  expect(calls).toEqual([]);

  saveIntegration(db, key, { kind: 'cj', values: { apiKey: 'CJ-KEY' } });
  expect(await searchCjAlternatives(db, key, store, p.productId, { fetchFn, gapMs: 0, now: NOW })).toEqual({ calls: 3, stored: 2 });
  expect(calls).toEqual(['/authentication/getAccessToken', '/product/listV2 silicone dog paw cleaner', '/product/listV2 silicone dog', '/product/listV2 0123']);
  expect(db.prepare(`SELECT count(*) AS n FROM pr_listings WHERE source = 'cj' AND origin = 'ingest' AND source_ref != '1'`).get()?.n).toBe(2);
});
