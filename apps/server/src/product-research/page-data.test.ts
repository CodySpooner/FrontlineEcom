import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrDiscovery, PrSourceHealth, PrSourceState } from '@frontline/shared';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { openDb } from '../db';
import type { Fetched } from '../kb/fetcher';
import { recordCall } from './caps';
import { upsertListing } from './catalog';
import { loadFixtures } from './dev-fixtures';
import { refusal } from './dev-fixtures-cli';
import { cachedImage, fetchImage, queuedImages } from './images';
import { enqueue, markSource } from './jobs';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
beforeEach(() => vi.stubEnv('FRONTLINE_DATA_DIR', mkdtempSync(join(tmpdir(), 'pr-img-'))));
afterEach(() => (vi.unstubAllEnvs(), vi.useRealTimers()));

test('the image route serves only the cache for the listing it names, with safe headers; a miss queues a fetch', async () => {
  vi.useFakeTimers(); // the queue's timer never fires here: no real fetch
  const db = openDb();
  db.exec(`INSERT INTO stores (id, name, platform, niche, currency, demo, connected) VALUES ('a', 'A', 'shopify', 'pet', 'USD', 1, 1), ('b', 'B', 'shopify', 'pet', 'USD', 1, 1)`);
  const app = createApp(db);
  const ref = 'https://cf.example.com/p/brush.png';
  const shared = upsertListing(db, { source: 'cj', sourceRef: '1', title: 'Brush', imageRef: ref, origin: 'ingest' }).id;
  const mine = upsertListing(db, { source: 'owner_link', sourceRef: 'u', title: 'Perch', imageRef: 'https://shop.example.com/p.png', origin: 'owner_link', storeId: 'a' }).id;

  const miss = await app.request(`/api/pr/listings/${shared}/image`);
  expect(miss.status).toBe(404);
  expect(queuedImages()).toBe(1);
  const get = vi.fn(async (url: string): Promise<Fetched> => ({ url, status: 'read', bytes: PNG, imageType: 'image/png' }));
  expect(await fetchImage(ref, get)).toBe(true);
  expect(get).toHaveBeenCalledWith(ref, { image: true });
  const hit = await app.request(`/api/pr/listings/${shared}/image?url=https://evil.example.com/x.svg`); // a client URL is never read
  expect(hit.status).toBe(200);
  expect(Object.fromEntries(['content-type', 'x-content-type-options', 'content-security-policy'].map((h) => [h, hit.headers.get(h)]))).toEqual({
    'content-type': 'image/png',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  });
  expect(new Uint8Array(await hit.arrayBuffer())).toEqual(PNG);
  expect((await app.request(`/api/pr/listings/${mine}/image?store=b`)).status).toBe(404); // another store's private row
  expect((await app.request(`/api/pr/listings/nope/image`)).status).toBe(404);
});

test('the cache keeps only real images and drops the least recently served past its size', async () => {
  const dir = join(process.env.FRONTLINE_DATA_DIR!, 'pr-images');
  const ok = async (url: string): Promise<Fetched> => ({ url, status: 'read', bytes: PNG, imageType: 'image/png' });
  expect(await fetchImage('ftp://x/y.png', ok)).toBe(false);
  expect(await fetchImage('https://x/svg', async (url) => ({ url, status: 'unsupported', error: 'not an image' }))).toBe(false);
  await fetchImage('https://x/1.png', ok, 30);
  await new Promise((r) => setTimeout(r, 20));
  await fetchImage('https://x/2.png', ok, 30);
  await new Promise((r) => setTimeout(r, 20)); // the touch is whole milliseconds; 2's write time isn't, so leave a gap
  cachedImage('https://x/1.png'); // served: now the newest
  await new Promise((r) => setTimeout(r, 20));
  await fetchImage('https://x/3.png', ok, 30); // 36 bytes > 30: the least recently served (2) goes
  expect([cachedImage('https://x/1.png'), cachedImage('https://x/2.png'), cachedImage('https://x/3.png')].map((c) => !!c)).toEqual([true, false, true]);
  writeFileSync(join(dir, readdirSync(dir)[0]!), '<svg/>');
  expect(readdirSync(dir).map((f) => readFileSync(join(dir, f)).toString()).includes('<svg/>')).toBe(true);
  expect([cachedImage('https://x/1.png'), cachedImage('https://x/3.png')].filter(Boolean)).toHaveLength(1); // a non-image file is a miss
});

test('the source strip: each source with its real access state, counted in the scope; fixture rows counted apart', async () => {
  const db = openDb();
  db.exec(`INSERT INTO stores (id, name, platform, niche, currency, demo, connected) VALUES ('a', 'A', 'shopify', 'pet', 'USD', 1, 1)`);
  const app = createApp(db);
  upsertListing(db, { source: 'cj', sourceRef: '1', title: 'Brush', origin: 'ingest' });
  loadFixtures(db, { scale: 3 });
  const s = (await (await app.request('/api/pr/sources?store=a')).json()) as PrSourceState[];
  expect(s.map((x) => [x.id, x.access])).toEqual([
    ['cj', 'credentials_required'],
    ['google_trends_csv', 'authorized_import'],
    ['google_trends_api', 'approval_required'],
    ['store_orders', 'credentials_required'],
    ['tiktok_creative_center', 'manual_only'],
    ['supplier_feed', 'authorized_import'],
  ]);
  expect(s.find((x) => x.id === 'cj')).toMatchObject({ products: 1, fixtures: 13, status: null, lastSuccessAt: null });
  expect(s.find((x) => x.id === 'google_trends_csv')).toMatchObject({ products: 0, fixtures: 6 });
});

test('dev fixtures: origin fixture everywhere, never verified, never demand evidence; the loader refuses outside this worktree', async () => {
  const db = openDb();
  db.exec(`INSERT INTO stores (id, name, platform, niche, currency, demo, connected) VALUES ('a', 'A', 'shopify', 'pet', 'USD', 1, 1)`);
  const app = createApp(db);
  expect(loadFixtures(db, { scale: 5 })).toBe(15);
  expect(loadFixtures(db)).toBe(10); // re-running updates, never duplicates
  expect(db.prepare('SELECT count(*) AS n FROM pr_listings').get()?.n).toBe(15);
  expect(db.prepare(`SELECT DISTINCT origin FROM pr_listings`).all().map((r) => r.origin)).toEqual(['fixture']);
  expect(db.prepare(`SELECT DISTINCT provenance FROM pr_offers`).all().map((r) => r.provenance)).toEqual(['fixture']);
  const d = (await (await app.request('/api/pr/products?store=a&limit=100')).json()) as PrDiscovery;
  expect(d.items.every((i) => i.fixture)).toBe(true);
  expect(d.items.some((i) => i.fulfillment?.status === 'verified')).toBe(false);
  expect(d.counts.demand).toBe(0);
  expect(d.items.some((i) => i.demand)).toBe(true); // the class shows (labelled Test fixture), but it never qualifies

  const own = '/w/apps/server/.data';
  expect(refusal({}, own, own)).toBeNull();
  expect(refusal({ FRONTLINE_WEB_DIR: '/app/web' }, own, own)).toMatch(/packaged/);
  expect(refusal({}, '/Users/me/AppData/Frontline', own)).toMatch(/refusing/);
});

test('no production path writes a fixture row: only the dev loader inserts origin or provenance "fixture"', () => {
  const root = join(__dirname, '..');
  const files = (readdirSync(root, { recursive: true }) as string[]).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).map((f) => f.replaceAll('\\', '/'));
  const writers = files.filter((f) => /INSERT[\s\S]{0,600}'fixture'/.test(readFileSync(join(root, f), 'utf8')) || /origin: 'fixture'/.test(readFileSync(join(root, f), 'utf8')));
  expect(writers).toEqual(['product-research/dev-fixtures.ts']);
  const callers = files.filter((f) => f !== 'product-research/dev-fixtures.ts' && /loadFixtures|dev-fixtures'/.test(readFileSync(join(root, f), 'utf8')));
  expect(callers).toEqual(['product-research/dev-fixtures-cli.ts']);
});

test('source health: calls against the caps, the ledger, jobs, CJ points, stale coverage and why a source is stopped', async () => {
  const db = openDb();
  db.exec(`INSERT INTO stores (id, name, platform, niche, currency, demo, connected) VALUES ('a', 'A', 'shopify', 'pet', 'USD', 1, 1)`);
  const app = createApp(db);
  const now = new Date();
  const old = new Date(now.getTime() - 10 * 86_400_000).toISOString();
  for (const p of ['ingestion', 'ingestion', 'search'] as const) recordCall(db, 'cj', p, p !== 'search', now);
  const { id: listing } = upsertListing(db, { source: 'cj', sourceRef: '1', title: 'Brush', origin: 'ingest' });
  db.prepare(`INSERT INTO pr_offers (id, listing_id, supplier, destination, quantity, currency, provenance, checked_at) VALUES ('o1', ?, 'CJdropshipping', 'US', 1, 'USD', 'live', ?)`).run(listing, old);
  loadFixtures(db); // fixture offers are never "stale coverage"
  markSource(db, 'cj', { ok: false, kind: 'auth', error: 'API key refused' }, now);
  db.prepare(`UPDATE pr_sources SET quota_json = ? WHERE id = 'cj'`).run(JSON.stringify({ pointsRemaining: 49_900, pointsTotal: 50_000 }));
  enqueue(db, { kind: 'ingest', source: 'cj', storeId: 'a', queries: ['dog'] }, now);

  const h = (await (await app.request('/api/pr/source-health?store=a')).json()) as PrSourceHealth[];
  const cj = h.find((s) => s.id === 'cj')!;
  expect(cj).toMatchObject({
    stopped: 'The credentials were refused: enter them again in Integrations.',
    points: { remaining: 49_900, total: 50_000 },
    callsToday: [
      { purpose: 'ingestion', calls: 2, cap: 500 },
      { purpose: 'search', calls: 1, cap: null },
      { purpose: 'watch', calls: 0, cap: 100 },
    ],
    stale: 1,
    canSync: false, // no CJ key in this database
    syncing: true,
    refreshHours: 24,
  });
  expect(cj.ledger.map((c) => [c.purpose, c.ok])).toEqual([['search', false], ['ingestion', true], ['ingestion', true]]);
  expect(cj.jobs).toMatchObject([{ kind: 'ingest', status: 'queued', attempts: 0 }]);
  expect(h.find((s) => s.id === 'google_trends_csv')).toMatchObject({ callsToday: [], ledger: [], stale: 0, canSync: false, refreshHours: null, stopped: null });

  expect((await app.request('/api/pr/sources/nope/sync', { method: 'POST' })).status).toBe(404);
  const r = await app.request('/api/pr/sources/cj/sync', { method: 'POST' });
  expect([r.status, ((await r.json()) as { error: string }).error]).toEqual([409, expect.stringMatching(/^CJdropshipping isn't set up yet/)]);
});
