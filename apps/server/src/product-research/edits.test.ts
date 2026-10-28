import type { PrCard, PrHistoryRow, PrProductDetail } from '@frontline/shared';
import { expect, test } from 'vitest';
import { createApp } from '../app';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { upsertListing } from './catalog';
import { refreshProduct } from './evaluate';
import { importLegacy, LEGACY_SOURCE } from './legacy';

function setup() {
  const db = openDb();
  seedDemo(db);
  const app = createApp(db);
  const p = upsertListing(db, { source: 'cj', sourceRef: '1', title: 'Rechargeable nail trimmer', category: 'Pet Supplies > Grooming', origin: 'ingest' }).productId;
  refreshProduct(db, p);
  const send = (method: string, path: string, body: unknown) => app.request(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const get = async <T>(path: string) => (await (await app.request(path)).json()) as T;
  return { db, app, p, send, get };
}

test('a stage change needs a reason, is kept in History with who and why, and puts the product in the pipeline', async () => {
  const { p, send, get } = setup();
  expect((await send('POST', `/api/pr/products/${p}/stage?store=pawsome`, { stage: 'shortlisted', reason: '  ' })).status).toBe(400);
  expect((await send('POST', `/api/pr/products/${p}/stage?store=pawsome`, { stage: 'bought', reason: 'x' })).status).toBe(400);
  expect((await send('POST', `/api/pr/products/${p}/stage`, { stage: 'shortlisted', reason: 'x' })).status).toBe(400); // store scope only
  expect((await send('POST', `/api/pr/products/${p}/stage?store=pawsome`, { stage: 'shortlisted', reason: 'Cheap to ship, fits the grooming line' })).status).toBe(200);
  expect((await send('POST', `/api/pr/products/${p}/stage?store=pawsome`, { stage: 'shortlisted', reason: 'again' })).status).toBe(409);
  const [card] = (await get<{ items: PrCard[] }>(`/api/pr/products?store=pawsome&limit=48`)).items.filter((c) => c.id === p);
  expect(card!.stage).toBe('shortlisted');
  expect(await get<PrHistoryRow[]>(`/api/pr/products/${p}/history?store=pawsome`)).toMatchObject([{ kind: 'stage', from: 'discovered', to: 'shortlisted', reason: 'Cheap to ship, fits the grooming line', by: 'owner' }]);
  expect((await get<PrProductDetail>(`/api/pr/products/${p}?shipTo=US`)).stores).toEqual([{ id: 'pawsome', name: expect.any(String), stage: 'shortlisted' }]);
});

test('notes are the store\'s own; a dismissed flag needs a reason, leaves the open flags and the Flagged view, and is in History', async () => {
  const { p, send, get } = setup();
  expect((await send('PUT', `/api/pr/products/${p}/store-notes?store=pawsome`, { notes: ' Ask CJ for a UK warehouse ' })).status).toBe(200);
  expect((await get<PrProductDetail>(`/api/pr/products/${p}?store=pawsome`)).notes).toBe('Ask CJ for a UK warehouse');
  expect((await get<PrProductDetail>(`/api/pr/products/${p}?store=glow`)).notes).toBeNull();
  const before = await get<PrProductDetail>(`/api/pr/products/${p}?store=pawsome`);
  expect(before.assessment.flags!.map((f) => f.id)).toEqual(['restricted:batteries']);
  expect(before.assessment.fit!.fit).toBe('weak');
  expect((await send('POST', `/api/pr/products/${p}/flags/${encodeURIComponent('restricted:batteries')}/dismiss?store=pawsome`, { reason: '' })).status).toBe(400);
  expect((await send('POST', `/api/pr/products/${p}/flags/brand/dismiss?store=pawsome`, { reason: 'x' })).status).toBe(404);
  expect((await send('POST', `/api/pr/products/${p}/flags/${encodeURIComponent('restricted:batteries')}/dismiss?store=pawsome`, { reason: 'USB-C, battery sealed and certified' })).status).toBe(200);
  expect((await send('POST', `/api/pr/products/${p}/flags/${encodeURIComponent('restricted:batteries')}/dismiss?store=pawsome`, { reason: 'again' })).status).toBe(409);
  const after = await get<PrProductDetail>(`/api/pr/products/${p}?store=pawsome`);
  expect(after.assessment.flags).toEqual([]);
  expect(after.assessment.fit!.fit).not.toBe('weak');
  expect((await get<{ counts: { flagged: number } }>(`/api/pr/products?store=pawsome&limit=1`)).counts.flagged).toBe(0);
  expect((await get<PrProductDetail>(`/api/pr/products/${p}?store=glow`)).assessment.flags!.map((f) => f.id)).toEqual(['restricted:batteries']); // only that store's
  expect(await get<PrHistoryRow[]>(`/api/pr/products/${p}/history?store=pawsome`)).toMatchObject([{ kind: 'flag', reason: 'Batteries: USB-C, battery sealed and certified', by: 'owner' }]);
  expect((await get<PrProductDetail>(`/api/pr/products/${p}?shipTo=US`)).stores).toEqual([]); // notes and dismissals don't put it in a pipeline
});

test('Watch per store and for all stores; a legacy row is watched through its listing, so "Saved" mirrors it', async () => {
  const { db, p, send, get } = setup();
  const watched = async (scope: string) => (await get<{ items: PrCard[] }>(`/api/pr/products?${scope}&limit=48`)).items.find((c) => c.id === p)!.watched;
  expect((await send('PUT', `/api/pr/products/${p}/watch?store=pawsome`, { on: 'yes' })).status).toBe(400);
  expect((await send('PUT', `/api/pr/products/${p}/watch?store=pawsome`, { on: true })).status).toBe(200);
  expect([await watched('store=pawsome'), await watched('store=glow'), await watched('shipTo=US')]).toEqual([true, false, false]);
  expect((await send('PUT', `/api/pr/products/${p}/watch`, { on: true })).status).toBe(200);
  expect(await watched('shipTo=US')).toBe(true);
  expect((await send('PUT', `/api/pr/products/${p}/watch?store=pawsome`, { on: false })).status).toBe(200);
  expect([await watched('store=pawsome'), await watched('shipTo=US')]).toEqual([false, true]);
  expect((await get<PrHistoryRow[]>(`/api/pr/products/${p}/history?store=pawsome`)).map((h) => [h.kind, h.reason])).toEqual([['watch', 'Stopped watching'], ['watch', 'Watching']]);

  db.exec(`INSERT INTO research_products (id, title, category, niche, source, cost, price, compare_at, trend, competition, shipping_days) VALUES ('find-a', 'Paw cup', 'Grooming', 'pet', 'tiktok', 3, 12, 0, 40, 30, 9)`);
  importLegacy(db);
  const legacy = String(db.prepare('SELECT product_id FROM pr_listings WHERE source = ? AND source_ref = ?').get(LEGACY_SOURCE, 'find-a')!.product_id);
  const inSaved = () => !!db.prepare(`SELECT 1 FROM product_list_items i JOIN product_lists l ON l.id = i.list_id WHERE l.name = 'Saved' AND i.product_id = 'find-a'`).get();
  await send('PUT', `/api/pr/products/${legacy}/watch?store=pawsome`, { on: true });
  expect(inSaved()).toBe(true);
  await send('PUT', `/api/pr/products/${legacy}/watch?store=pawsome`, { on: false });
  expect(inSaved()).toBe(false);
});
