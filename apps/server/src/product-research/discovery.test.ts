import type { PrCard, PrDiscovery } from '@frontline/shared';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { openDb, tx, type Db } from '../db';
import { upsertListing } from './catalog';
import { refreshProduct } from './evaluate';

const NOW = new Date('2026-10-28T10:00:00.000Z');
beforeEach(() => (vi.useFakeTimers({ toFake: ['Date'] }), vi.setSystemTime(NOW)));
afterEach(() => vi.useRealTimers());

const get = async (app: ReturnType<typeof createApp>, qs: string) => {
  const res = await app.request(`/api/pr/products?${qs}`);
  return { status: res.status, body: (await res.json()) as PrDiscovery & { error?: string } };
};
const ids = (d: PrDiscovery) => d.items.map((i) => i.title);
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function stores(db: Db) {
  db.exec(`INSERT INTO stores (id, name, platform, niche, currency, demo, connected) VALUES ('paws', 'Paws', 'shopify', 'pet', 'USD', 0, 1), ('uk', 'UK Pets', 'shopify', 'pet', 'GBP', 1, 1)`);
}

/** n catalog products with facts for US/USD written directly: a scale fixture, not the pipeline. */
function bulk(db: Db, n: number) {
  const truth: { id: string; cost: number | null; seen: string; flags: number; category: string | null }[] = [];
  tx(db, () => {
    const prod = db.prepare('INSERT INTO pr_products (id, title, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
    const lst = db.prepare(`INSERT INTO pr_listings (id, product_id, source, source_ref, title, category, origin, first_seen_at, last_seen_at) VALUES (?, ?, 'cj', ?, ?, ?, 'ingest', ?, ?)`);
    const fact = db.prepare(`INSERT INTO pr_product_facts (product_id, destination, currency, cost_ship_minor, first_seen_at, evidence_at, momentum, rule_flags, computed_at) VALUES (?, 'US', 'USD', ?, ?, ?, ?, ?, ?)`);
    for (let i = 0; i < n; i++) {
      const id = `p${String(i).padStart(5, '0')}`;
      const category = i % 10 === 0 ? null : ['Pet Supplies > Grooming', 'Pet Supplies > Toys', 'Home > Kitchen'][i % 3]!;
      const cost = i % 7 === 0 ? null : ((i * 7919) % 5000) + 100;
      const seen = day(i % 40);
      const flags = i % 13 === 0 ? 1 : 0;
      prod.run(id, `Product ${id}`, category, seen, seen);
      lst.run(`l${id}`, id, id, `Product ${id}`, category, seen, seen);
      fact.run(id, cost, seen, seen, i % 5 === 0 ? null : (i % 17) / 4, flags, NOW.toISOString());
      truth.push({ id, cost, seen, flags, category });
    }
  });
  return truth;
}

test('10,000 products: cost sorts across pages with nulls last, filters and counts cover the full set, in SQL', async () => {
  const db = openDb();
  stores(db);
  const app = createApp(db);
  const truth = bulk(db, 10_000);
  const t0 = performance.now();
  const page1 = await get(app, 'sort=cost');
  const ms = performance.now() - t0;
  expect(page1.status).toBe(200);
  expect(page1.body.total).toBe(10_000);
  expect(page1.body.items).toHaveLength(48);
  const page2 = await get(app, `sort=cost&cursor=${page1.body.next}`);
  const want = [...truth].sort((a, b) => (a.cost === null ? 1 : 0) - (b.cost === null ? 1 : 0) || (a.cost ?? 0) - (b.cost ?? 0) || a.id.localeCompare(b.id));
  expect([...page1.body.items, ...page2.body.items].map((i) => i.id)).toEqual(want.slice(0, 96).map((t) => t.id));
  const last = await get(app, `sort=cost&cursor=${10_000 - 5}`);
  expect(last.body.items.map((i) => i.costShip)).toEqual([null, null, null, null, null]);
  expect(last.body.next).toBeNull();

  // "Cost + shipping ≤" keeps unknown costs unless the owner switches that off.
  const under = truth.filter((t) => t.cost !== null && t.cost <= 1000).length;
  const unknown = truth.filter((t) => t.cost === null).length;
  expect((await get(app, 'costMax=1000')).body.total).toBe(under + unknown);
  expect((await get(app, 'costMax=1000&strict=cost')).body.total).toBe(under);
  // Category, with the unknown category kept or dropped.
  const grooming = truth.filter((t) => t.category === 'Pet Supplies > Grooming').length;
  expect((await get(app, 'category=Pet+Supplies+%3E+Grooming&strict=category')).body.total).toBe(grooming);
  expect((await get(app, 'category=Pet+Supplies+%3E+Grooming')).body.total).toBe(grooming + truth.filter((t) => t.category === null).length);

  const all = (await get(app, 'view=flagged')).body;
  expect(all.counts).toEqual({ all: 10_000, demand: 0, new: truth.filter((t) => t.seen >= day(14)).length, watchlist: 0, flagged: truth.filter((t) => t.flags).length });
  expect(all.total).toBe(all.counts.flagged);
  expect(all.facets.categories[0]).toMatchObject({ n: 3000 });
  expect(all.facets.categories.find((c) => c.value === '')).toEqual({ value: '', label: 'Category unknown', n: 1000 });
  // Store scope, Best fit: fit order, then (no demand here) verified cost, nulls last.
  db.exec(`INSERT INTO pr_evaluations (store_id, product_id, fit, open_flags, in_scope, created_at, updated_at)
    SELECT 'paws', id, CASE CAST(substr(id, 2) AS INTEGER) % 4 WHEN 0 THEN 'strong' WHEN 1 THEN 'medium' WHEN 2 THEN 'weak' ELSE 'unknown' END, 0, 1, '${NOW.toISOString()}', '${NOW.toISOString()}' FROM pr_products`);
  const t1 = performance.now();
  const best = (await get(app, 'store=paws')).body;
  const ms2 = performance.now() - t1;
  const strong = truth.filter((_, i) => i % 4 === 0).sort((a, b) => (a.cost === null ? 1 : 0) - (b.cost === null ? 1 : 0) || (a.cost ?? 0) - (b.cost ?? 0) || a.id.localeCompare(b.id));
  expect(best.total).toBe(10_000);
  expect(best.items.map((i) => i.id)).toEqual(strong.slice(0, 48).map((t) => t.id));
  expect((await get(app, 'store=paws&fit=weak')).body.total).toBe(2500);
  // ponytail: loose bounds for CI machines; the Done line records the measured times.
  expect(ms).toBeLessThan(3000);
  expect(ms2).toBeLessThan(3000);
  console.log(`discovery over 10,000 products: first page in ${Math.round(ms)} ms (All stores), ${Math.round(ms2)} ms (store, Best fit)`);
});

test('a sample row never appears in discovery, its counts, facets or sorts; merged-away products neither', async () => {
  const db = openDb();
  stores(db);
  const app = createApp(db);
  const at = NOW.toISOString();
  upsertListing(db, { source: 'research_feed', sourceRef: 's1', title: 'Sample Lick Mat', category: 'Samples', origin: 'legacy_sample', at });
  const kept = upsertListing(db, { source: 'cj', sourceRef: '1', title: 'Paw Cleaner Cup', category: 'Pet Supplies', origin: 'ingest', at }).productId;
  const gone = upsertListing(db, { source: 'cj', sourceRef: '2', title: 'Paw Cleaner Cup (dupe)', category: 'Pet Supplies', origin: 'ingest', at }).productId;
  db.prepare('UPDATE pr_products SET merged_into = ? WHERE id = ?').run(kept, gone);
  for (const qs of ['', 'sort=cost', 'sort=momentum', 'q=lick', 'store=paws', 'store=paws&sort=recent']) {
    const { body } = await get(app, qs);
    expect(ids(body), qs).not.toContain('Sample Lick Mat');
    expect(ids(body), qs).not.toContain('Paw Cleaner Cup (dupe)');
    expect(body.counts.all, qs).toBe(qs === 'q=lick' ? 0 : 1);
    expect(body.facets.categories.map((c) => c.value), qs).not.toContain('Samples');
  }
});

test("scopes: a store sees shared rows and its own, never another store's; All stores names a private row's store", async () => {
  const db = openDb();
  stores(db);
  const app = createApp(db);
  const at = NOW.toISOString();
  upsertListing(db, { source: 'cj', sourceRef: '1', title: 'Paw Cleaner Cup', category: 'Pet Supplies > Grooming', origin: 'ingest', at });
  upsertListing(db, { source: 'owner_link', sourceRef: 'u1', title: 'Cat Window Perch', url: 'https://shop.example.com/perch', origin: 'owner_link', storeId: 'uk', at });
  upsertListing(db, { source: 'cj', sourceRef: '3', title: 'Silicone Spatula Set', category: 'Home > Kitchen', origin: 'ingest', at });
  expect(ids((await get(app, 'store=paws&sort=recent')).body).sort()).toEqual(['Paw Cleaner Cup', 'Silicone Spatula Set']);
  expect(ids((await get(app, 'store=uk&sort=recent')).body).sort()).toEqual(['Cat Window Perch', 'Paw Cleaner Cup', 'Silicone Spatula Set']);
  const all = (await get(app, 'q=perch')).body.items[0]!;
  expect(all).toMatchObject({ privateTo: 'uk', source: { label: 'Your link', host: 'shop.example.com', origin: 'owner_link' }, stage: null, fit: null, category: null });

  // Store scope keeps the included categories and every unknown category; out-of-scope rows leave its counts too.
  await app.request('/api/pr/profile?store=uk', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ includeCategories: ['Grooming'], version: 0 }) }); // the first save (settings ST-08b)
  const uk = (await get(app, 'store=uk&sort=recent')).body;
  expect(ids(uk).sort()).toEqual(['Cat Window Perch', 'Paw Cleaner Cup']);
  expect(uk.counts.all).toBe(2);
  expect(uk.facets.categories.map((c) => c.label).sort()).toEqual(['Category unknown', 'Pet Supplies > Grooming']);
  // Search covers titles, categories and supplier SKUs, within the scope.
  expect(ids((await get(app, 'store=paws&q=kitchen')).body)).toEqual(['Silicone Spatula Set']);
  expect(ids((await get(app, 'store=paws&q=perch')).body)).toEqual([]);
});

test('cards: cost + ship, fulfillment conditions, fit, flags and demand, with the store ranking Best fit first', async () => {
  const db = openDb();
  stores(db);
  const app = createApp(db);
  const header = 'Title,SKU,Currency,Product_Ref,Variant,Unit_Cost,Shipping_Cost,Destination,Delivery_Days_Max,Stock,MOQ,Ships_From,Category,Checked_At';
  const csv = [header, 'Paw Cleaner Cup,PC-M,USD,PC,Medium,3.42,4.10,US,10,1200,1,CN,Pet Supplies > Grooming,2026-10-25', 'Rechargeable Lint Remover,LR-1,USD,LR,,6.00,,US,12,40,1,CN,Pet Supplies > Grooming,2026-10-25', ''].join('\n');
  expect((await app.request('/api/pr/imports/feed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ supplier: 'Acme', csv }) })).status).toBe(201);
  await app.request('/api/pr/profile?store=paws', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ priceMax: 2500, version: 0 }) }); // the first save (settings ST-08b)
  const d = (await get(app, 'store=paws')).body;
  expect(ids(d)).toEqual(['Paw Cleaner Cup', 'Rechargeable Lint Remover']); // Strong before Weak
  const [cup, lint] = d.items as [PrCard, PrCard];
  expect(cup).toMatchObject({
    source: { id: 'feed:acme', label: 'Acme', host: null, origin: 'import' },
    fixture: false,
    stage: 'discovered',
    costShip: 752,
    fulfillment: { status: 'verified', reasons: [], checkedAt: '2026-10-25T00:00:00.000Z' },
    conditions: { variant: 'Medium', method: null, quantity: 1, checkedAt: '2026-10-25T00:00:00.000Z', supplier: 'Acme', deliveryMax: 10, shipsFrom: 'CN' },
    fit: { fit: 'strong', reason: 'Every known input passes' },
    flags: { count: 0, first: null },
    demand: null,
    demandSets: 0,
  });
  expect(lint).toMatchObject({ costShip: null, fulfillment: { status: 'pending', reasons: ['Shipping cost unknown'] }, fit: { fit: 'weak', reason: 'Batteries' }, flags: { count: 1, first: { id: 'restricted:batteries' } } });
  expect(d.facets.sources).toEqual([{ value: 'feed:acme', label: 'Acme', n: 2 }]);
  expect(d.facets.warehouses).toEqual([{ value: 'CN', label: 'CN', n: 2 }]);
  expect((await get(app, 'store=paws&view=flagged')).body.total).toBe(1);
  expect((await get(app, 'store=paws&fit=weak')).body.items.map((i) => i.title)).toEqual(['Rechargeable Lint Remover']);
  expect((await get(app, 'store=paws&availability=verified')).body.total).toBe(1);
  expect((await get(app, 'store=paws&warehouse=US&strict=warehouse')).body.total).toBe(0);
  expect((await get(app, 'store=paws&deliveryMax=10&strict=delivery')).body.total).toBe(1);
  expect((await get(app, 'flags=any')).body.items.map((i) => i.flags?.first?.label)).toEqual(['Batteries']); // All stores: rule flags
});

test("'With demand evidence' counts a store's own orders in its scope only", async () => {
  const db = openDb();
  stores(db);
  const app = createApp(db);
  const product = upsertListing(db, { source: 'cj', sourceRef: '1', title: 'Paw Cleaner Cup', category: 'Pet Supplies', origin: 'ingest', at: '2026-01-01T00:00:00.000Z' }).productId;
  db.exec(`INSERT INTO products (store_id, id, title, price) VALUES ('paws', 'sp1', 'Paw Cup', 19.99)`);
  // 30 weeks of steady sales: Sustained interest, from a store with demo = 0.
  for (let w = 1; w <= 30; w++) {
    const date = new Date(Date.parse('2026-10-25T00:00:00Z') - w * 7 * 86_400_000 + 86_400_000).toISOString().slice(0, 10);
    db.prepare(`INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, local_date) VALUES ('paws', ?, ?, 20, 'paid', 'fulfilled', ?)`).run(`o${w}`, `${date}T12:00:00Z`, date);
    db.prepare(`INSERT INTO order_items (store_id, order_id, product_id, quantity, revenue) VALUES ('paws', ?, 'sp1', 25, 20)`).run(`o${w}`);
  }
  expect((await app.request(`/api/pr/products/${product}/store-products?store=paws`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeProductId: 'sp1' }) })).status).toBe(201);
  refreshProduct(db, product);
  const paws = (await get(app, 'store=paws&view=demand')).body;
  expect(paws.counts.demand).toBe(1);
  expect(paws.items[0]).toMatchObject({ demandSets: 1, demand: { cls: 'sustained', platform: 'orders' } });
  expect((await get(app, 'store=uk')).body.counts.demand).toBe(0);
  expect((await get(app, '')).body.counts.demand).toBe(0);
});

test('the query string is validated: store-only sorts and filters need a store, values come from fixed lists', async () => {
  const db = openDb();
  stores(db);
  const app = createApp(db);
  for (const qs of ['sort=best_fit', 'stage=testing', 'fit=strong', 'sort=trending', 'view=hot', 'costMax=9.99', 'shipTo=USA', 'shipTo=FR', 'strict=price', 'niche=other', 'flags=some', 'availability=maybe', 'limit=500', 'cursor=abc', 'store=paws&stage=launched']) {
    const { status, body } = await get(app, qs);
    expect(status, qs).toBe(400);
    expect(body.error, qs).toBeTruthy();
  }
  expect((await get(app, 'store=nope')).status).toBe(404);
  const ok = (await get(app, 'shipTo=gb')).body;
  expect(ok).toMatchObject({ currency: 'USD', shipTo: 'GB', shipTos: ['US', 'GB'] });
  expect((await get(app, 'store=uk')).body).toMatchObject({ currency: 'GBP', shipTo: 'GB', shipTos: ['GB'] });
});
