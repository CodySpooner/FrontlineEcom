// ST-28 (decision 13): a store's default assumptions in Product Research economics, its price band read in the currency
// it was saved in, and the re-evaluation a store's currency or niche change runs in the background.
import { randomUUID } from 'node:crypto';
import { econInputs, type PrEconomics, type PrStoreProfile } from '@frontline/shared';
import { beforeEach, expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { takeCurrency } from '../connectors/common';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { upsertListing } from '../product-research/catalog';
import { listComparisons, saveComparison } from '../product-research/comparisons';
import { saveEconomics } from '../product-research/economics';
import { refreshProduct, storeProducts } from '../product-research/evaluate';
import { getStore } from '../stores';

let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  app = createApp(db);
});

const send = async <T>(method: string, path: string, body?: unknown) => {
  const r = await app.request(path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: (await r.json()) as T };
};
const profile = async (store: string) => (await send<PrStoreProfile>('GET', `/api/pr/profile?store=${store}`)).body;
/** Saves `set` over the version read, as Settings → Product Research does. */
const save = async (store: string, set: Partial<PrStoreProfile>) => send<PrStoreProfile & { error?: string }>('PUT', `/api/pr/profile?store=${store}`, { version: (await profile(store)).version, ...set });
const product = (title: string, category: string) => {
  const { productId } = upsertListing(db, { source: 'cj', sourceRef: randomUUID(), title, category, origin: 'ingest' });
  refreshProduct(db, productId, new Date());
  return productId;
};
const economics = async (productId: string) => (await send<PrEconomics>('GET', `/api/pr/products/${productId}/economics?store=pawsome`)).body;
const fit = (productId: string) => db.prepare("SELECT fit, fit_reasons_json FROM pr_evaluations WHERE store_id = 'pawsome' AND product_id = ?").get(productId);
const change = (setting: string) => db.prepare("SELECT state, detail FROM settings_changes WHERE store_id = 'pawsome' AND setting = ? ORDER BY at DESC, rowid DESC").get(setting);

test("the store's default assumptions read as Your assumption; null keeps today's; a product's own figure wins; a missing cost stays Unknown", async () => {
  const bowl = product('Dog travel water bowl', 'Pet Supplies > Travel');
  const before = (await economics(bowl)).derived;
  expect([before.discountPct, before.returnRatePct, before.refundPct]).toEqual([
    { value: 0, tag: 'assumption', note: 'No discount' },
    { value: 0, tag: 'assumption', note: 'No returns' },
    { value: 100, tag: 'assumption', note: 'Full refund on a return' },
  ]);
  expect((await save('pawsome', { discountPct: 10, returnRatePct: 4.5 })).body).toMatchObject({ discountPct: 10, returnRatePct: 4.5, refundPct: null });
  const e = await economics(bowl);
  const mine = { tag: 'assumption', note: 'Your assumption · Pawsome Gear default' };
  expect([e.derived.discountPct, e.derived.returnRatePct, e.derived.refundPct]).toEqual([{ value: 10, ...mine }, { value: 4.5, ...mine }, before.refundPct]);
  expect(e.derived.supplierCost).toEqual(before.supplierCost); // no verified offer: still unknown, whatever the assumptions
  expect(e.derived.supplierCost.value).toBeNull();

  saveEconomics(db, 'pawsome', bowl, { base: { discountPct: 20 }, conservative: { returnRatePct: 12 }, optimistic: {} });
  const own = await economics(bowl);
  expect([econInputs(own, 'base').discountPct, econInputs(own, 'base').returnRatePct, econInputs(own, 'conservative').returnRatePct]).toEqual([20, 4.5, 12]);

  expect((await save('pawsome', { discountPct: null, returnRatePct: null })).status).toBe(200);
  expect((await economics(bowl)).derived.discountPct).toEqual(before.discountPct);
  expect((await save('pawsome', { refundPct: 101 })).body).toEqual({ error: 'refundPct must be a percentage from 0 to 100, or null', field: 'pr.refundPct' });
  expect(db.prepare("SELECT setting FROM settings_changes WHERE store_id = 'pawsome' AND setting LIKE 'pr.%' ORDER BY at, rowid").all().map((r) => r.setting)).toEqual([
    'pr.discountPct', 'pr.returnRatePct', 'pr.discountPct', 'pr.returnRatePct',
  ]);
});

test('a saved comparison keeps the assumptions it was saved with when the store default moves', async () => {
  const ids = [product('Dog travel water bowl', 'Pet Supplies > Travel'), product('Lick mat', 'Pet Supplies > Feeding')];
  const store = getStore(db, 'pawsome')!;
  const c = saveComparison(db, store, { name: 'Travel', productIds: ids, figures: { discountPct: 5 } })!;
  const raw = db.prepare('SELECT assumptions_json FROM pr_comparisons WHERE id = ?').get(c.id)!.assumptions_json;
  expect((await save('pawsome', { discountPct: 15, returnRatePct: 3, shipTo: 'GB' })).status).toBe(200);
  expect(db.prepare('SELECT assumptions_json FROM pr_comparisons WHERE id = ?').get(c.id)!.assumptions_json).toBe(raw);
  expect(listComparisons(db, 'pawsome')[0]).toMatchObject({ destination: 'US', currency: 'USD', figures: { discountPct: 5 } });
});

test('a band saved in EUR on a store now in USD is converted at the stored rate or left out, never read as USD; other saves keep it as saved', async () => {
  db.prepare("UPDATE stores SET currency = 'EUR' WHERE id = 'pawsome'").run();
  expect((await save('pawsome', { priceMax: 4000 })).body).toMatchObject({ priceMax: 4000, priceCurrency: 'EUR', priceSaved: null });
  const bowl = product('Dog travel water bowl', 'Pet Supplies > Travel');
  takeCurrency(db, 'pawsome', 'shopify', 'USD'); // the store's platform says USD on its next sync

  expect(await profile('pawsome')).toMatchObject({ priceMax: null, priceCurrency: 'USD', priceSaved: { min: null, max: 4000, currency: 'EUR', converted: false } });
  await vi.waitFor(() => expect(change('store.currency')?.state).toBe('applied'));
  expect(fit(bowl)).toEqual({ fit: 'unknown', fit_reasons_json: JSON.stringify(['Missing price band']) }); // not $40.00
  expect((await save('pawsome', { audience: 'Dog owners who travel' })).status).toBe(200);
  expect(db.prepare("SELECT price_max_minor, price_currency FROM pr_store_profiles WHERE store_id = 'pawsome'").get()).toEqual({ price_max_minor: 4000, price_currency: 'EUR' });

  db.prepare("INSERT INTO settings (key, value_json) VALUES ('fx', ?)").run(JSON.stringify({ date: '2026-10-30', rates: { EUR: 1, USD: 1.1 } }));
  expect(await profile('pawsome')).toMatchObject({ priceMax: 4400, priceSaved: { max: 4000, currency: 'EUR', converted: true } });
  expect((await save('pawsome', { priceMax: 4500 })).body).toMatchObject({ priceMax: 4500, priceCurrency: 'USD', priceSaved: null });
});

test("a sync's currency change and the owner's niche change re-evaluate the store's products in the background; the impact says so first", async () => {
  const bowl = product('Dog travel water bowl', 'Pet Supplies > Travel');
  product('Lick mat', 'Pet Supplies > Feeding');
  expect((await save('pawsome', { priceMax: 2500 })).status).toBe(200);
  expect(fit(bowl)?.fit).toBe('strong');
  const n = storeProducts(db, 'pawsome').length;
  expect(n).toBeGreaterThan(1);
  const impact = async (set: object) => (await send<{ impacts: { text: string }[] }>('POST', '/api/config/store-impact', { storeId: 'pawsome', set })).body.impacts.map((i) => i.text);
  expect(await impact({ currency: 'GBP' })).toEqual([
    "Totals across stores convert Pawsome Gear's figures from GBP",
    "Product Research ships to GB instead of US: GBP's main country",
    `Re-evaluates Product Research fit for ${n} products in the background`,
  ]);
  expect(await impact({ niche: 'home' })).toEqual([`Re-evaluates Product Research fit for ${n} products in the background`]);

  takeCurrency(db, 'pawsome', 'shopify', 'GBP'); // no rate: the USD band is left out
  expect(change('store.currency')?.state).toBe('applying');
  await vi.waitFor(() => expect(change('store.currency')).toEqual({ state: 'applied', detail: null }));
  expect(fit(bowl)?.fit).toBe('unknown');

  const { version, ...store } = getStore(db, 'pawsome')!;
  expect((await send('PATCH', '/api/stores/pawsome', { niche: 'home', version })).status).toBe(200);
  await vi.waitFor(() => expect(change('store.niche')?.state).toBe('applied'));
  expect(fit(bowl)).toMatchObject({ fit: 'medium', fit_reasons_json: JSON.stringify(['Category outside the niche and included categories']) });
  expect(store.niche).toBe('pet');
});
