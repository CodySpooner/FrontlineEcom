import type { PrFlag, PrStoreProfile } from '@frontline/shared';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { upsertListing } from './catalog';
import { getStore, listStores } from '../stores';
import { decayPass, evaluate, evaluateStore, fitFor, type FitInput } from './evaluate';
import { convertMinor, factKeys } from './facts';
import { inNiche } from './profile';

const NOW = new Date('2026-10-28T10:00:00.000Z');
beforeEach(() => (vi.useFakeTimers({ toFake: ['Date'] }), vi.setSystemTime(NOW)));
afterEach(() => vi.useRealTimers());

const flag = (kind: PrFlag['kind'], label: string = kind): PrFlag => ({ id: `${kind}:x`, kind, label, reason: '' });
const known: FitInput = { flags: [], category: 'Pet Supplies > Grooming', inNiche: true, costShip: 752, priceMax: 2500, fastest: 10, maxDelivery: 14, shipsFrom: ['CN'], warehouses: [] };
const fit = (o: Partial<FitInput>) => fitFor({ ...known, ...o });

test('store fit: Strong when every known input passes', () => {
  expect(fit({})).toEqual({ fit: 'strong', reasons: ['Every known input passes'] });
  expect(fit({ costShip: null, fastest: null, shipsFrom: [] }).fit).toBe('strong'); // no offer yet: nothing known fails
});

test('store fit: Weak on an avoid-list hit, a restricted flag or verified cost + shipping above the band', () => {
  expect(fit({ flags: [flag('avoid', 'Avoided term: squeaky')] })).toEqual({ fit: 'weak', reasons: ['Avoided term: squeaky'] });
  expect(fit({ flags: [flag('restricted', 'Batteries')] })).toEqual({ fit: 'weak', reasons: ['Batteries'] });
  expect(fit({ costShip: 2600 })).toEqual({ fit: 'weak', reasons: ["Cost + shipping above the price band's maximum"] });
  for (const kind of ['brand', 'compatibility', 'review'] as const) expect(fit({ flags: [flag(kind)] }).fit, kind).toBe('strong'); // warnings only
});

test('store fit: Medium outside the niche, over the delivery limit, or with no preferred warehouse', () => {
  expect(fit({ inNiche: false })).toEqual({ fit: 'medium', reasons: ['Category outside the niche and included categories'] });
  expect(fit({ fastest: 18 })).toEqual({ fit: 'medium', reasons: ['Delivery up to 18 days, over the 14-day limit'] });
  expect(fit({ warehouses: ['US'], shipsFrom: ['CN'] })).toEqual({ fit: 'medium', reasons: ['Ships from CN, no preferred warehouse'] });
  expect(fit({ warehouses: ['US'], shipsFrom: ['CN', 'US'] }).fit).toBe('strong');
});

test('store fit: Unknown names the missing price band or category; a known problem outranks it', () => {
  expect(fit({ priceMax: null })).toEqual({ fit: 'unknown', reasons: ['Missing price band'] });
  expect(fit({ priceMax: null, category: null, inNiche: null })).toEqual({ fit: 'unknown', reasons: ['Missing price band and category'] });
  expect(fit({ priceMax: null, inNiche: false }).fit).toBe('medium');
  expect(fit({ priceMax: null, inNiche: false, flags: [flag('restricted')] }).fit).toBe('weak');
});

test("the niche test matches a word's start in the category, or an included category", () => {
  const pet = { niche: 'pet' as const };
  expect(inNiche(pet, [], 'Pet Supplies > Dog Grooming')).toBe(true);
  expect(inNiche(pet, [], 'Home & Garden > Kitchen')).toBe(false);
  expect(inNiche(pet, ['kitchen'], 'Home & Garden > Kitchen')).toBe(true);
  expect(inNiche(pet, [], 'Education > Supplies')).toBe(false); // "cat" inside a word doesn't count
  expect(inNiche(pet, [], null)).toBe(null);
  expect(inNiche({ niche: 'other', nicheDetail: 'Aquarium and pond gear' }, [], 'Garden > Pond Pumps')).toBe(true);
});

test('money converts between minor units with the stored ECB rates, never fetching', () => {
  const db = openDb();
  expect(convertMinor(db, 752, 'USD', 'GBP')).toBeUndefined();
  db.prepare(`INSERT INTO settings (key, value_json) VALUES ('fx', ?)`).run(JSON.stringify({ date: '2026-10-27', rates: { EUR: 1, USD: 1.1, GBP: 0.85, JPY: 160 } }));
  expect([convertMinor(db, 752, 'USD', 'USD'), convertMinor(db, 752, 'USD', 'GBP'), convertMinor(db, 752, 'USD', 'JPY'), convertMinor(db, 1094, 'JPY', 'USD')]).toEqual([752, 581, 1094, 752]);
});

// --- the Evaluate and Rank steps over the API

const HEADER = 'Title,SKU,Currency,Product_Ref,Unit_Cost,Shipping_Cost,Destination,Delivery_Days_Max,Stock,MOQ,Ships_From,Category,Checked_At';
/** PUT /api/pr/profile sends the version it read (settings ST-08b). */
const send = async (app: ReturnType<typeof createApp>, method: string, path: string, body?: unknown) => {
  if (method === 'PUT' && path.startsWith('/api/pr/profile') && body && typeof body === 'object' && !('version' in body))
    body = { ...body, version: ((await (await app.request(path)).json()) as { version?: number }).version ?? 0 };
  return app.request(path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
};
const facts = (db: Db, product: string, destination = 'US', currency = 'USD') =>
  ({ ...db.prepare('SELECT fulfillment_status, fulfillment_checked_at, cost_ship_minor FROM pr_product_facts WHERE product_id = ? AND destination = ? AND currency = ?').get(product, destination, currency) });
const evaluation = (db: Db, store: string, product: string) => {
  const r = db.prepare('SELECT stage, fit, fit_reasons_json, flags_json FROM pr_evaluations WHERE store_id = ? AND product_id = ?').get(store, product);
  return r && { stage: r.stage, fit: r.fit, reasons: JSON.parse(String(r.fit_reasons_json)), flags: (JSON.parse(String(r.flags_json)) as PrFlag[]).map((f) => f.id) };
};

async function setup() {
  const db = openDb();
  db.exec(`INSERT INTO stores (id, name, platform, niche, currency, demo, connected) VALUES ('paws', 'Paws', 'shopify', 'pet', 'USD', 1, 1), ('uk', 'UK Pets', 'shopify', 'pet', 'GBP', 1, 1)`);
  const app = createApp(db);
  const csv = [HEADER, 'Paw Cleaner Cup,PC-M,USD,PC,3.42,4.10,US,10,1200,1,CN,Pet Supplies > Grooming,2026-10-25', 'Rechargeable Lint Remover,LR-1,USD,LR,6.00,3.00,US,12,40,1,CN,Home > Cleaning,2026-10-25', ''].join('\n');
  expect((await send(app, 'POST', '/api/pr/imports/feed', { supplier: 'Acme', csv })).status).toBe(201);
  const id = (ref: string) => String(db.prepare(`SELECT product_id FROM pr_listings WHERE source_ref = ?`).get(ref)!.product_id);
  return { db, app, cup: id('PC'), lint: id('LR') };
}

test('the profile API: defaults from the store, validation, and a save that re-evaluates fit', async () => {
  const { db, app, cup } = await setup();
  expect((await send(app, 'GET', '/api/pr/profile')).status).toBe(400); // All stores keeps no profile
  expect((await send(app, 'GET', '/api/pr/profile?store=nope')).status).toBe(404);
  const fresh = (await (await send(app, 'GET', '/api/pr/profile?store=paws')).json()) as PrStoreProfile;
  expect(fresh).toMatchObject({ storeId: 'paws', priceCurrency: 'USD', shipTo: 'US', shipToDefault: true, priceMin: null, priceMax: null, warehouses: [], updatedAt: null });
  expect(evaluation(db, 'paws', cup)).toEqual({ stage: 'discovered', fit: 'unknown', reasons: ['Missing price band'], flags: [] });

  for (const bad of [{ priceMin: 3000, priceMax: 2000 }, { priceMax: 19.99 }, { shipTo: 'USA' }, { warehouses: ['China'] }, { avoidTerms: 'squeaky' }, { maxDeliveryDays: 0 }]) {
    const res = await send(app, 'PUT', '/api/pr/profile?store=paws', bad);
    expect(res.status, JSON.stringify(bad)).toBe(400);
  }
  const saved = (await (await send(app, 'PUT', '/api/pr/profile?store=paws', { priceMin: 1500, priceMax: 700, audience: ' dog owners ' })).json()) as { error: string };
  expect(saved.error).toBe('priceMin must be at most priceMax');

  const p = (await (await send(app, 'PUT', '/api/pr/profile?store=paws', { priceMax: 700, audience: ' dog owners ', avoidTerms: ['squeaky', 'Squeaky '] })).json()) as PrStoreProfile;
  expect(p).toMatchObject({ priceMax: 700, audience: 'dog owners', avoidTerms: ['squeaky'], shipTo: 'US', shipToDefault: true });
  expect(evaluation(db, 'paws', cup)).toMatchObject({ fit: 'weak', reasons: ["Cost + shipping above the price band's maximum"] }); // 7.52 > 7.00
  await send(app, 'PUT', '/api/pr/profile?store=paws', { priceMax: 2500 });
  expect(evaluation(db, 'paws', cup)).toMatchObject({ fit: 'strong' });
  await send(app, 'PUT', '/api/pr/profile?store=paws', { maxDeliveryDays: 7, warehouses: ['us'] });
  expect(evaluation(db, 'paws', cup)).toMatchObject({ fit: 'medium', reasons: ['Delivery up to 10 days, over the 7-day limit', 'Ships from CN, no preferred warehouse'] });
});

test('Evaluate flags per store; a dismissed restricted flag no longer makes fit Weak; out-of-niche is Medium', async () => {
  const { db, app, lint } = await setup();
  await send(app, 'PUT', '/api/pr/profile?store=paws', { priceMax: 2500 });
  expect(evaluation(db, 'paws', lint)).toEqual({ stage: 'discovered', fit: 'weak', reasons: ['Batteries'], flags: ['restricted:batteries'] });
  db.prepare(`UPDATE pr_evaluations SET flag_dismissals_json = ? WHERE store_id = 'paws' AND product_id = ?`).run(JSON.stringify({ 'restricted:batteries': { reason: 'USB, no battery', at: NOW.toISOString() } }), lint);
  evaluate(db, getStore(db, 'paws')!, lint);
  expect(evaluation(db, 'paws', lint)).toEqual({ stage: 'discovered', fit: 'medium', reasons: ['Category outside the niche and included categories'], flags: ['restricted:batteries'] });
  expect(evaluation(db, 'uk', lint)?.fit).toBe('weak'); // another store's dismissal doesn't carry over
});

test('Rank: fulfillment and cost + ship per store ship-to and currency, a ship-to change re-ranks, and the 7-day decay', async () => {
  const { db, app, cup } = await setup();
  expect(factKeys(db)).toEqual([['US', 'USD'], ['GB', 'GBP'], ['GB', 'USD']]); // All stores: each ship-to in the base currency
  expect(facts(db, cup)).toEqual({ fulfillment_status: 'verified', fulfillment_checked_at: '2026-10-25T00:00:00.000Z', cost_ship_minor: 752 });
  expect(facts(db, cup, 'GB', 'GBP')).toEqual({ fulfillment_status: 'pending', fulfillment_checked_at: null, cost_ship_minor: null }); // no GB quote

  db.prepare(`INSERT INTO settings (key, value_json) VALUES ('fx', ?)`).run(JSON.stringify({ date: '2026-10-27', rates: { EUR: 1, USD: 1.1, GBP: 0.85 } }));
  await send(app, 'PUT', '/api/pr/profile?store=uk', { shipTo: 'us' });
  expect(factKeys(db)).toEqual([['US', 'USD'], ['US', 'GBP']]);
  expect(facts(db, cup, 'US', 'GBP')).toEqual({ fulfillment_status: 'verified', fulfillment_checked_at: '2026-10-25T00:00:00.000Z', cost_ship_minor: 581 });
  await send(app, 'PUT', '/api/pr/profile?store=paws', { shipTo: 'CA' });
  expect(factKeys(db)).toEqual([['CA', 'USD'], ['US', 'GBP'], ['US', 'USD']]); // All stores' default (US, base currency) stays
  expect(facts(db, cup, 'CA', 'USD').fulfillment_status).toBe('pending');

  const store = db.prepare(`SELECT fit FROM pr_evaluations WHERE store_id = 'uk' AND product_id = ?`);
  expect(store.get(cup)?.fit).toBe('unknown');
  decayPass(db, new Date('2026-10-31T10:00:00.000Z')); // 6 days: still verified
  expect(facts(db, cup).fulfillment_status).toBe('verified');
  vi.setSystemTime(new Date('2026-11-02T10:00:00.000Z'));
  decayPass(db);
  expect(facts(db, cup)).toEqual({ fulfillment_status: 'pending', fulfillment_checked_at: '2026-10-25T00:00:00.000Z', cost_ship_minor: null });
  expect(facts(db, cup, 'US', 'GBP').fulfillment_status).toBe('pending');
});

test('a sample row is never evaluated and a private listing is evaluated only for its store', async () => {
  const { db } = await setup();
  const at = NOW.toISOString();
  const sample = upsertListing(db, { source: 'legacy', sourceRef: 's1', title: 'Sample Lick Mat', origin: 'legacy_sample', at }).productId;
  const mine = upsertListing(db, { source: 'owner_link', sourceRef: 'u1', title: 'Knife Sharpener', origin: 'owner_link', storeId: 'uk', at }).productId;
  for (const s of listStores(db)) evaluateStore(db, s);
  expect(db.prepare('SELECT count(*) AS n FROM pr_evaluations WHERE product_id = ?').get(sample)?.n).toBe(0);
  expect(db.prepare('SELECT store_id FROM pr_evaluations WHERE product_id = ?').all(mine).map((r) => r.store_id)).toEqual(['uk']);
  expect(evaluation(db, 'uk', mine)).toMatchObject({ fit: 'weak', flags: ['restricted:weapons'] });
});
