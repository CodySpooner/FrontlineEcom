import type { PrComparison } from '@frontline/shared';
import { expect, test } from 'vitest';
import { createApp } from '../app';
import { openDb } from '../db';
import { upsertListing } from './catalog';

function setup() {
  const db = openDb();
  db.exec(`INSERT INTO stores (id, name, platform, niche, currency, demo, connected) VALUES ('a', 'Paws', 'shopify', 'pet', 'USD', 1, 1), ('b', 'Glow', 'shopify', 'beauty', 'EUR', 1, 1)`);
  const app = createApp(db);
  const p = (ref: string, store?: string) => upsertListing(db, { source: 'cj', sourceRef: ref, title: `Product ${ref}`, category: 'Pet Supplies', origin: 'ingest', ...(store ? { storeId: store } : {}) }).productId;
  const send = (method: string, path: string, body?: unknown) =>
    app.request(path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { db, p, send };
}

test('a comparison is saved per store with its ship-to and currency, replaced on save and deleted by the owner', async () => {
  const { p, send } = setup();
  const [x, y, z] = [p('1'), p('2'), p('3')];
  const r = await send('POST', '/api/pr/comparisons?store=a', { name: ' Brushes ', productIds: [x, y], figures: { adCost: 800, discountPct: 10 } });
  expect(r.status).toBe(201);
  const c = (await r.json()) as PrComparison;
  expect(c).toMatchObject({ name: 'Brushes', productIds: [x, y], destination: 'US', currency: 'USD', figures: { adCost: 800, discountPct: 10 } });

  const put = await send('PUT', `/api/pr/comparisons/${c.id}?store=a`, { name: 'Brushes', productIds: [y, z], figures: {} });
  expect(((await put.json()) as PrComparison)).toMatchObject({ id: c.id, productIds: [y, z], figures: {}, createdAt: c.createdAt });
  expect(((await (await send('GET', '/api/pr/comparisons?store=a')).json()) as PrComparison[]).map((s) => s.productIds)).toEqual([[y, z]]);

  // Another store sees none of it, and can't change or delete it.
  expect(await (await send('GET', '/api/pr/comparisons?store=b')).json()).toEqual([]);
  expect((await send('PUT', `/api/pr/comparisons/${c.id}?store=b`, { name: 'Mine', productIds: [x], figures: {} })).status).toBe(404);
  expect((await send('DELETE', `/api/pr/comparisons/${c.id}?store=b`)).status).toBe(404);
  expect((await send('GET', '/api/pr/comparisons')).status).toBe(400); // All stores: kept per store

  expect((await send('DELETE', `/api/pr/comparisons/${c.id}?store=a`)).status).toBe(200);
  expect(await (await send('GET', '/api/pr/comparisons?store=a')).json()).toEqual([]);
});

test("a comparison holds 1 to 4 different products the store can see, and only the figures it shares", async () => {
  const { p, send } = setup();
  const ids = ['1', '2', '3', '4', '5'].map((r) => p(r));
  const theirs = p('6', 'b');
  for (const [body, error] of [
    [{ name: '', productIds: [ids[0]] }, 'name must be 1 to 80 characters'],
    [{ name: 'Five', productIds: ids }, 'productIds must be 1 to 4 different products'],
    [{ name: 'Twice', productIds: [ids[0], ids[0]] }, 'productIds must be 1 to 4 different products'],
    [{ name: 'None', productIds: [] }, 'productIds must be 1 to 4 different products'],
    [{ name: 'Private', productIds: [ids[0], theirs] }, 'product not found'],
    [{ name: 'Price', productIds: [ids[0]], figures: { price: 2999 } }, "figures.price is each product's own, not a shared assumption"],
    [{ name: 'Pct', productIds: [ids[0]], figures: { returnRatePct: 140 } }, 'figures.returnRatePct must be a percentage from 0 to 100'],
    [{ name: 'Cents', productIds: [ids[0]], figures: { adCost: 7.5 } }, 'figures.adCost must be an amount in minor units (0 or more)'],
  ] as const) {
    const r = await send('POST', '/api/pr/comparisons?store=a', body);
    expect([r.status, ((await r.json()) as { error: string }).error]).toEqual([400, error]);
  }
});
