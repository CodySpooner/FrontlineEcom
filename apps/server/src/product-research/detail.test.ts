import type { PrDemandTab, PrHistoryRow, PrOffer, PrProductDetail } from '@frontline/shared';
import { expect, test } from 'vitest';
import { createApp } from '../app';
import { openDb } from '../db';
import { upsertListing } from './catalog';
import { refreshProduct } from './evaluate';

const NOW = new Date();
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

function setup() {
  const db = openDb();
  db.exec(`INSERT INTO stores (id, name, platform, niche, currency, demo, connected) VALUES ('a', 'Paws', 'shopify', 'pet', 'USD', 1, 1), ('b', 'Glow', 'shopify', 'beauty', 'USD', 1, 1)`);
  const app = createApp(db);
  const { id: listing, productId: p } = upsertListing(db, { source: 'cj', sourceRef: '1', title: 'Dog grooming brush', category: 'Pet Supplies > Grooming', url: 'https://cjdropshipping.com/p/1', origin: 'ingest' });
  db.prepare(`INSERT INTO pr_variants (id, listing_id, source_ref, sku, attributes_json) VALUES ('v1', ?, 'v1', 'CJ-BRUSH-M', '{"name":"M / Grey"}')`).run(listing);
  const offer = db.prepare(
    `INSERT INTO pr_offers (id, listing_id, variant_id, supplier, destination, quantity, method, unit_cost_minor, shipping_cost_minor, currency, delivery_days_min, delivery_days_max, ships_from, stock_json, provenance, checked_at)
     VALUES (?, ?, 'v1', 'CJdropshipping', ?, 1, 'CJPacket', ?, ?, 'USD', 6, 12, 'CN', '[{"countryCode":"CN","totalInventory":120}]', 'live', ?)`,
  );
  offer.run('us', listing, 'US', 342, 410, ago(1));
  offer.run('ca', listing, 'CA', 342, null, ago(1)); // shipping unknown: pending, never a 0
  const set = (id: string, scope: string, productId: string | null) => {
    db.prepare(`INSERT INTO pr_signals (id, product_id, platform, query, region, period_start, period_end, granularity, metric, scope, origin, retrieved_at) VALUES (?, ?, 'google_trends', 'dog brush', 'US', ?, ?, 'week', 'interest_over_time', ?, 'import', ?)`).run(
      id, productId, ago(728).slice(0, 10), ago(7).slice(0, 10), scope, ago(2),
    );
    for (let i = 0; i < 104; i++) db.prepare('INSERT INTO pr_signal_points (signal_id, at, value, below_one) VALUES (?, ?, ?, 0)').run(id, ago(728 - i * 7).slice(0, 10), 50 + (i % 3));
  };
  set('s1', 'product', p);
  set('s2', 'query', null);
  db.prepare(`INSERT INTO pr_signal_links (signal_id, product_id, created_at) VALUES ('s2', ?, ?)`).run(p, ago(2)); // suggested, not confirmed
  const find = upsertListing(db, { source: 'research_feed', sourceRef: 'find-1', title: 'Dog grooming brush', category: 'Pet Supplies > Grooming', origin: 'agent_find', transform: { estimates: { price: 24.99, trend: 141 } } });
  db.prepare('UPDATE pr_listings SET product_id = ? WHERE id = ?').run(p, find.id); // matched to the same product
  const priv = upsertListing(db, { source: 'owner_link', sourceRef: 'u', title: 'Cat perch', origin: 'owner_link', storeId: 'b' }).productId;
  refreshProduct(db, p, NOW);
  refreshProduct(db, priv, NOW);
  return { db, app, p, priv };
}
const get = async <T>(app: ReturnType<typeof createApp>, path: string) => {
  const r = await app.request(path);
  return [r.status, (await r.json()) as T] as const;
};

test('the panel header and Overview: SKU, listing link, each assessment part on its own, and the agent estimates kept apart', async () => {
  const { app, p } = setup();
  const [status, d] = await get<PrProductDetail>(app, `/api/pr/products/${p}?store=a`);
  expect(status).toBe(200);
  expect(d).toMatchObject({ sku: 'CJ-BRUSH-M', url: 'https://cjdropshipping.com/p/1', currency: 'USD', shipTo: 'US', card: { title: 'Dog grooming brush', stage: 'discovered' } });
  expect(d.assessment.demand).toEqual({ level: 'moderate', sets: 1, ownOrders: false }); // the suggested query set doesn't count
  expect(d.assessment.flags).toEqual([]);
  expect(d.assessment.fit?.reasons.length).toBeGreaterThan(0);
  expect(d.assessment.confidence).toEqual({ level: 'medium', count: 2, has: { demand: true, offer: true, economics: false, report: false } });
  expect(d.agentEstimates).toEqual({ price: 24.99, trend: 141 });
  expect(d.stores).toEqual([]);
});

test('tabs: demand sets with their stored points and the suggested query set; offers each with their own status', async () => {
  const { app, p } = setup();
  const [, demand] = await get<PrDemandTab>(app, `/api/pr/products/${p}/demand?store=a`);
  expect(demand.sets.map((s) => [s.id, s.series.length, s.demandClass])).toEqual([['s1', 104, 'sustained']]);
  expect(demand.suggested.map((s) => [s.id, s.scope])).toEqual([['s2', 'query']]);
  expect(demand.notes).toEqual([]);
  const [, offers] = await get<PrOffer[]>(app, `/api/pr/products/${p}/offers?store=a`);
  expect(offers.map((o) => [o.destination, o.status, o.shipCost, o.sku, o.variant, o.deliveryMin, o.stock])).toEqual([
    ['CA', 'pending', null, 'CJ-BRUSH-M', 'M / Grey', 6, [{ warehouse: 'CN', units: 120 }]],
    ['US', 'verified', 410, 'CJ-BRUSH-M', 'M / Grey', 6, [{ warehouse: 'CN', units: 120 }]],
  ]);
  expect(offers[0]!.reasons).toEqual(['Shipping cost unknown']);
});

test('scope: a store never opens another store\'s private product; All stores assigns a product to a store once, in History', async () => {
  const { app, p, priv } = setup();
  for (const path of [`/api/pr/products/${priv}?store=a`, `/api/pr/products/${priv}/offers?store=a`, `/api/pr/products/${priv}/history?store=a`]) expect((await app.request(path)).status).toBe(404);
  expect((await get<PrProductDetail>(app, `/api/pr/products/${p}?shipTo=XX`))[0]).toBe(400);
  const assign = (storeId: string, id = p) => app.request(`/api/pr/products/${id}/assign`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId }) });
  expect((await assign('a', priv)).status).toBe(404);
  expect((await assign('a')).status).toBe(201);
  expect((await assign('a')).status).toBe(409);
  const [, all] = await get<PrProductDetail>(app, `/api/pr/products/${p}?shipTo=US`);
  expect(all.stores).toEqual([{ id: 'a', name: 'Paws', stage: 'discovered' }]);
  expect(all.card.storesEvaluating).toBe(1);
  expect(all.assessment.fit).toBeNull();
  const [, history] = await get<PrHistoryRow[]>(app, `/api/pr/products/${p}/history?store=a`);
  expect(history).toMatchObject([{ storeId: 'a', kind: 'stage', from: null, to: 'discovered', reason: 'Assigned from All stores', by: 'owner' }]);
  expect((await get<PrHistoryRow[]>(app, `/api/pr/products/${p}/history?store=b`))[1]).toEqual([]);
});
