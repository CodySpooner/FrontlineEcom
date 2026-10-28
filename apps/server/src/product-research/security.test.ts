import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrTask } from '@frontline/shared';
import { afterEach, expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { syncCj } from '../connectors/cj';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { saveIntegration } from '../integrations';
import { initLog } from '../log';
import { runManager } from '../routes/agents';
import { getStore } from '../stores';
import { upsertListing } from './catalog';
import { enqueue, runJob } from './jobs';
import { searchCjAlternatives } from './matching';
import { cjAdapter } from './sources/cj';

const AT = '2026-10-28T00:00:00.000Z';

/**
 * PR-26: the isolation sweep. Every /api/pr route that names a row (a product, a listing, a task, a watch, a
 * comparison, a signal, a History row) is called as Pawsome Gear on Glow Haus's own rows, with a body that would
 * otherwise be accepted: each is a 404 and nothing in the database changes.
 */
test("isolation sweep: every /api/pr route that names a row refuses another store's row (404) and writes nothing", async () => {
  const db = openDb();
  seedDemo(db);
  const app = createApp(db);
  db.exec(`INSERT INTO pr_products (id, title, created_at, updated_at) VALUES ('gp', 'Glow serum', '${AT}', '${AT}');
    INSERT INTO pr_products (id, title, created_at, updated_at) VALUES ('sp', 'Shared cup', '${AT}', '${AT}');
    INSERT INTO pr_listings (id, product_id, store_id, source, source_ref, title, origin, image_ref, first_seen_at, last_seen_at) VALUES ('gl', 'gp', 'glow', 'link', 'a', 'Glow serum', 'owner_link', 'img', '${AT}', '${AT}'),
      ('sl', 'sp', NULL, 'cj', '1', 'Shared cup', 'ingest', NULL, '${AT}', '${AT}');
    INSERT INTO pr_stage_history (id, store_id, product_id, kind, from_stage, to_stage, reason, by, at) VALUES ('gh', 'glow', 'gp', 'stage', NULL, 'rejected', 'No', 'owner', '${AT}');
    INSERT INTO pr_watches (id, store_id, list_name, target_kind, target_id, created_at) VALUES ('gw', 'glow', 'Watchlist', 'product', 'gp', '${AT}');
    INSERT INTO pr_comparisons (id, store_id, name, product_ids_json, assumptions_json, created_at, updated_at) VALUES ('gc', 'glow', 'Serums', '["gp"]', '{}', '${AT}', '${AT}');
    INSERT INTO pr_signals (id, store_id, product_id, platform, metric, scope, origin, retrieved_at) VALUES ('gs', 'glow', NULL, 'google_trends', 'interest', 'query', 'import', '${AT}');`);
  const task = await app.request('/api/pr/tasks?store=glow', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientRequestId: randomUUID(), productId: 'gp', type: 'product_hunter', mode: 'new', instructions: 'Evaluate it.' }),
  });
  const gt = ((await task.json()) as PrTask).id;
  await runManager(db).idle();

  const ids: Record<string, string> = { id: 'gp', listing: 'gl', ref: 'gp', hid: 'gh', flag: 'batteries', tab: 'demand' };
  const byPrefix: [RegExp, string][] = [[/^\/api\/pr\/tasks\//, gt], [/^\/api\/pr\/watches\//, 'gw'], [/^\/api\/pr\/comparisons\//, 'gc'], [/^\/api\/pr\/signals\//, 'gs'], [/^\/api\/pr\/listings\//, 'gl']];
  const bodies: Record<string, unknown> = {
    'POST /api/pr/products/:id/assign': { storeId: 'pawsome' },
    'POST /api/pr/products/:id/notes': { platform: 'tiktok_creative_center', url: 'https://www.tiktok.com/x', note: 'Seen', observedAt: '2026-10-01' },
    'PUT /api/pr/products/:id/economics': { base: { price: 2900 } },
    'POST /api/pr/products/:id/matches/:listing': { action: 'same' },
    'PUT /api/pr/products/:id/owner': { owner: 'Cody' },
    'POST /api/pr/products/:id/links': { kind: 'experiment', refId: 'e1' },
    'PUT /api/pr/products/:id/brief': { fields: { targetCustomer: 'Anyone' } },
    'PUT /api/pr/watches/:id': { prefs: { priceChangePct: 5 } },
    'PUT /api/pr/comparisons/:id': { name: 'Mine now', productIds: ['sp'] }, // a product Pawsome sees: only the row is Glow's
    'POST /api/pr/products/:id/stage': { stage: 'rejected', reason: 'No' },
    'PUT /api/pr/products/:id/store-notes': { notes: 'Mine' },
    'POST /api/pr/products/:id/flags/:flag/dismiss': { reason: 'Fine' },
    'PUT /api/pr/products/:id/watch': { watched: true },
    'POST /api/pr/products/:id/store-products': { storeProductId: 'p1' },
    'POST /api/pr/signals/:id/links': { productId: 'sp', confirmed: true },
  };
  const counts = () =>
    Object.fromEntries(
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%'`)
        .all()
        .map((t) => [String(t.name), Number(db.prepare(`SELECT count(*) AS n FROM "${String(t.name)}"`).get()!.n)]),
    );
  await app.request('/api/pr/products/sp?store=pawsome'); // Pawsome's own evaluation of the shared product, made on first read
  const before = counts();
  const routes = [...new Set(app.routes.filter((r) => r.path.startsWith('/api/pr/') && r.method !== 'ALL' && r.path.includes('/:')).map((r) => `${r.method} ${r.path}`))];
  const sources = routes.filter((r) => r.includes('/api/pr/sources/')); // sources are the app's, not a store's
  expect(sources).toEqual(['POST /api/pr/sources/:id/sync']);
  const refused: Record<string, number> = {};
  for (const route of routes.filter((r) => !sources.includes(r))) {
    const [method, pattern] = route.split(' ') as [string, string];
    const own = byPrefix.find(([re]) => re.test(pattern))?.[1];
    let first = true;
    const path = pattern.replace(/:(\w+)(\{[^}]*\})?/g, (_, name: string) => {
      const v = first && own ? own : ids[name]!;
      first = false;
      return v;
    });
    const body = bodies[route];
    const r = await app.request(`${path}?store=pawsome&ask=positioning`, { method, headers: { 'content-type': 'application/json' }, ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }) });
    if (r.status !== 404) refused[route] = r.status;
  }
  expect(refused).toEqual({});
  expect(counts()).toEqual(before);
});

afterEach(() => vi.unstubAllGlobals());

/**
 * PR-26 (decision 12): the CJ key and the token it buys stay in the encrypted integrations store, even when CJ's own
 * answer repeats them: never in an error, a web response, a prompt, a job row, any other database row or the log.
 */
test('credentials never leave the integrations store, even when CJ repeats them in an error', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pr-security-'));
  initLog(dir);
  const db = openDb();
  seedDemo(db);
  const key = randomBytes(32);
  const app = createApp(db, key);
  const SECRETS = ['CJ-SECRET-KEY-123', 'CJ-TOKEN-456', 'CJ-REFRESH-789'];
  const [apiKey, token, refresh] = SECRETS as [string, string, string];
  saveIntegration(db, key, { kind: 'cj', values: { apiKey } });
  // CJ hands out a token, then refuses every other call with a message that repeats what it was sent.
  const fetchFn = vi.fn(async (url: string, _init?: RequestInit) =>
    url.endsWith('/authentication/getAccessToken')
      ? Response.json({ code: 200, result: true, data: { accessToken: token, accessTokenExpiryDate: '2027-04-26T09:16:33+08:00', refreshToken: refresh } })
      : Response.json({ code: 1600100, result: false, message: `Invalid request: token ${token} for key ${apiKey}` }, { status: 403 }),
  );
  vi.stubGlobal('fetch', fetchFn);
  const store = getStore(db, 'pawsome')!;
  const { productId } = upsertListing(db, { source: 'cj', sourceRef: '1', title: 'Dog travel water bowl', origin: 'ingest' });

  expect(await runJob(db, enqueue(db, { kind: 'ingest', source: 'cj', storeId: 'pawsome', queries: ['dog bowl'] }), cjAdapter, { key })).toBe('stopped');
  const search = await searchCjAlternatives(db, key, store, productId, { fetchFn: fetchFn as unknown as typeof fetch, gapMs: 0 });
  expect(search.error).toBe('CJ: Invalid request: token [redacted] for key [redacted]');
  await syncCj(db, key, 'pawsome', fetchFn as unknown as typeof fetch, new Date(), 0);
  const task = await app.request('/api/pr/tasks?store=pawsome', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientRequestId: randomUUID(), productId, type: 'product_hunter', mode: 'new', instructions: 'Evaluate it.' }),
  });
  expect(task.status).toBe(201);
  await runManager(db).idle();
  expect(fetchFn.mock.calls.some(([, init]) => JSON.stringify(init?.headers ?? {}).includes(token))).toBe(true); // the token was used

  const web = await Promise.all(
    ['/api/integrations', '/api/pr/sources?store=pawsome', '/api/pr/source-health', `/api/pr/products/${productId}/matches?store=pawsome`, '/api/pr/tasks?store=pawsome', `/api/pr/products/${productId}?store=pawsome`].map(
      async (u) => `${u} ${await (await app.request(u)).text()}`,
    ),
  );
  const rows = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all()
    .map((t) => JSON.stringify(db.prepare(`SELECT * FROM "${String(t.name)}"`).all()))
    .join('\n');
  const logFile = join(dir, 'logs', 'api.log');
  const logged = existsSync(logFile) ? readFileSync(logFile, 'utf8') : '';
  expect(logged).toContain('product research source failed'); // the failure was logged
  expect(rows).toContain('[redacted]'); // and kept on the job, the source and the integration
  for (const secret of SECRETS) {
    expect(search.error).not.toContain(secret);
    for (const w of web) expect(w).not.toContain(secret);
    expect(rows).not.toContain(secret); // prompts (agent_runs), job rows, sources, integration status: the secrets table is encrypted
    expect(logged).not.toContain(secret);
  }
});

test('every /api/pr route is local-only: a non-local Host (DNS rebinding) or a foreign Origin is a 403', async () => {
  const db = openDb();
  seedDemo(db);
  const app = createApp(db);
  expect((await app.request('/api/pr/products?store=pawsome')).status).toBe(200);
  expect((await app.request('http://evil.test/api/pr/products?store=pawsome')).status).toBe(403);
  expect((await app.request('/api/pr/profile?store=pawsome', { method: 'PUT', headers: { origin: 'http://evil.test', 'content-type': 'application/json' }, body: '{}' })).status).toBe(403);
  expect((await app.request('/api/pr/tasks?store=pawsome', { method: 'POST', headers: { origin: 'http://localhost:9999', 'content-type': 'application/json' }, body: '{}' })).status).toBe(403); // another local port is another site
});
