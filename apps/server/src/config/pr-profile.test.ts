// ST-27 (decision 13): a store's research profile, edited in Settings → Product Research through PUT /api/pr/profile.
// Its consumers: the next research task's message, the next discovery plan's CJ queries, and fit and flags at save.
import { randomBytes, randomUUID } from 'node:crypto';
import { getRun } from '@frontline/agents';
import type { PrFlag, PrStoreProfile, PrTask } from '@frontline/shared';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { saveIntegration } from '../integrations';
import { upsertListing } from '../product-research/catalog';
import { refreshProduct } from '../product-research/evaluate';
import { planToday, runJob } from '../product-research/jobs';
import { cjAdapter } from '../product-research/sources/cj';
import doc from '../product-research/sources/fixtures/cj-doc-examples.json';
import { runManager } from '../routes/agents';

let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  app = createApp(db);
});
afterEach(() => vi.restoreAllMocks());

const send = async <T>(method: string, path: string, body?: unknown) => {
  const r = await app.request(path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: (await r.json()) as T };
};
const profile = async (store: string) => (await send<PrStoreProfile>('GET', `/api/pr/profile?store=${store}`)).body;
/** Saves `set` over the version read, as Settings → Product Research does. */
const save = async (store: string, set: Partial<PrStoreProfile>) => send<PrStoreProfile & { error?: string; code?: string }>('PUT', `/api/pr/profile?store=${store}`, { version: (await profile(store)).version, ...set });
const product = (title: string, category: string) => {
  const { productId } = upsertListing(db, { source: 'cj', sourceRef: randomUUID(), title, category, origin: 'ingest' });
  refreshProduct(db, productId, new Date());
  return productId;
};
const research = async (productId: string) => {
  const t = (await send<PrTask>('POST', '/api/pr/tasks?store=pawsome', { clientRequestId: randomUUID(), productId, type: 'product_hunter', mode: 'new', instructions: 'Evaluate it.' })).body;
  await runManager(db).idle();
  return getRun(db, t.runId!)!.task;
};

test("a ship-to change reaches the next research task's message; an earlier task keeps the profile it started with", async () => {
  const bowl = product('Dog travel water bowl', 'Pet Supplies > Travel');
  const before = await research(bowl);
  expect(before).toMatch(/## Store research profile\n[\s\S]*> - Ship to: US \(the store currency's main country\)/);
  expect(before).toContain('> - Highest cost + shipping: not set');
  expect((await save('pawsome', { shipTo: 'GB', priceMax: 2500, keywords: ['Lick Mat'] })).status).toBe(200);
  const after = await research(bowl);
  expect(after).toContain('> - Ship to: GB\n');
  expect(after).toContain('> - Highest cost + shipping: 25.00 USD');
  expect(after).toContain('> - Keywords: Lick Mat');
  expect(getRun(db, db.prepare('SELECT run_id FROM pr_tasks ORDER BY created_at, rowid LIMIT 1').get()!.run_id as string)!.task).toBe(before);
});

test('a stale version gets 409 with the current profile, and nothing is written', async () => {
  const read = await profile('pawsome');
  expect((await save('pawsome', { audience: 'Dog owners who travel' })).status).toBe(200);
  const stale = await send<{ code: string; current: PrStoreProfile }>('PUT', '/api/pr/profile?store=pawsome', { version: read.version, audience: 'Cat owners' });
  expect(stale.status).toBe(409);
  expect(stale.body).toMatchObject({ code: read.version === 0 ? 'exists' : 'stale', current: { audience: 'Dog owners who travel' } });
  expect((await profile('pawsome')).audience).toBe('Dog owners who travel');
  expect((await send('PUT', '/api/pr/profile?store=pawsome', { audience: 'Cat owners' })).status).toBe(428); // no version
});

test("avoided categories and terms flag the store's products and make their fit Weak, never hiding them; only that store's", async () => {
  const toy = product('Squeaky Plush Bone', 'Pet Supplies > Dog Toys');
  const flags = (store: string) => (JSON.parse(String(db.prepare('SELECT flags_json FROM pr_evaluations WHERE store_id = ? AND product_id = ?').get(store, toy)?.flags_json ?? '[]')) as PrFlag[]).map((f) => f.id);
  expect(flags('pawsome')).toEqual([]);
  expect((await save('pawsome', { avoidCategories: ['Toys'], avoidTerms: ['squeaky'] })).status).toBe(200);
  expect(flags('pawsome')).toEqual(['avoid:category:toys', 'avoid:term:squeaky']);
  expect(db.prepare(`SELECT fit FROM pr_evaluations WHERE store_id = 'pawsome' AND product_id = ?`).get(toy)?.fit).toBe('weak');
  const cards = (await send<{ items: { id: string }[] }>('GET', '/api/pr/products?store=pawsome&view=all')).body;
  expect(cards.items.map((c) => c.id)).toContain(toy); // flagged, still listed
});

test("included categories and keywords reach the next discovery plan's CJ queries; an earlier plan's job keeps its own", async () => {
  const key = randomBytes(32);
  const cj = openDb();
  // A custom niche plans one query of its own; CJ's calls go one a second.
  cj.exec(`INSERT INTO stores (id, name, platform, niche, niche_detail, currency) VALUES ('pawsome', 'Pawsome', 'shopify', 'other', 'Crystal Healing', 'USD')`);
  saveIntegration(cj, key, { kind: 'cj', values: { apiKey: 'CJ-KEY' } });
  db = cj;
  app = createApp(cj);
  const asked: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation((async (url: string) => {
    const u = new URL(url);
    const path = u.pathname.replace('/api2.0/v1', '');
    if (path === '/product/listV2') asked.push(u.searchParams.get('keyWord')!);
    const body = path === '/authentication/getAccessToken' ? doc.token : path === '/product/listV2' ? doc.listV2 : { code: 200, result: true, message: 'Success', data: [] }; // an empty category tree
    return Response.json(body);
  }) as typeof fetch);
  const jobs = () => cj.prepare(`SELECT id, json_extract(checkpoint_json, '$.queries') AS q FROM pr_jobs ORDER BY created_at, rowid`).all().map((r) => ({ id: String(r.id), queries: JSON.parse(String(r.q)) as string[] }));
  const run = async (id: string, now: Date) => expect(await runJob(cj, id, cjAdapter, { key, now: () => now })).toBe('done');

  const day1 = new Date('2026-10-30T01:00:00.000Z');
  await planToday(cj, [cjAdapter], key, day1);
  const [first] = jobs();
  expect(first!.queries).toEqual(['crystal healing']);
  await run(first!.id, day1);
  expect(asked).toEqual(first!.queries);

  expect((await save('pawsome', { includeCategories: ['Dog Beds'], keywords: ['Lick Mat'] })).status).toBe(200);
  asked.length = 0;
  const day2 = new Date('2026-10-31T01:00:00.000Z');
  await planToday(cj, [cjAdapter], key, day2);
  const [earlier, next] = jobs();
  expect(earlier).toEqual(first);
  expect(next!.queries).toEqual(['crystal healing', 'dog beds', 'lick mat']);
  await run(next!.id, day2);
  expect(asked).toEqual(next!.queries);
}, 20_000);
