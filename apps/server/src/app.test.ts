import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { Store } from '@frontline/shared';
import { createApp, startServer } from './app';
import { openDb } from './db';
import { seedDemo } from './demo';
import { initLog } from './log';

const db = openDb();
seedDemo(db);
const app = createApp(db);

test('health responds ok', async () => {
  const res = await app.request('/api/health');
  expect(await res.json()).toMatchObject({ ok: true, connectors: [], version: 'dev' }); // run from the repo
  // Never inside another site's frame: a hidden frame of the app could get the owner to click Approve.
  expect([res.headers.get('content-security-policy'), res.headers.get('x-frame-options')]).toEqual(["frame-ancestors 'none'", 'DENY']);
  process.env.FRONTLINE_VERSION = '1.2.3'; // set by the desktop app: its installed version
  try {
    expect(await (await app.request('/api/health')).json()).toMatchObject({ version: '1.2.3' });
  } finally {
    delete process.env.FRONTLINE_VERSION;
  }
});

test('stores lists the demo stores', async () => {
  const res = await app.request('/api/stores');
  const stores = (await res.json()) as Store[];
  expect(stores.map((s) => s.id)).toEqual(['pawsome', 'glow', 'peak']);
  expect(stores[0]).toMatchObject({ name: 'Pawsome Gear', nicheDetail: 'dog travel gear', connected: false });
});

test('with a web dir it serves the build and falls back to index.html for app routes, not for /api', async () => {
  const web = mkdtempSync(join(tmpdir(), 'frontline-web-'));
  mkdirSync(join(web, 'assets'));
  writeFileSync(join(web, 'index.html'), '<div id=root></div>');
  writeFileSync(join(web, 'assets', 'app.js'), 'console.log(1)');
  const db = openDb();
  let server!: ReturnType<typeof startServer>;
  const port = await new Promise<number>((resolve) => (server = startServer(db, 0, resolve, web)));
  const get = (path: string) => fetch(`http://127.0.0.1:${port}${path}`).then(async (r) => [r.status, await r.text()]);
  expect(await get('/')).toEqual([200, '<div id=root></div>']);
  expect(await get('/agents/glow:market_analyst')).toEqual([200, '<div id=root></div>']);
  expect(await get('/assets/app.js')).toEqual([200, 'console.log(1)']);
  expect((await get('/api/health'))[0]).toBe(200);
  expect((await get('/api/nope'))[0]).toBe(404);
  server.close();
});

test('only the local UI gets in: DNS-rebound hosts and foreign origins are refused', async () => {
  const app = createApp(openDb());
  const status = async (url: string, init?: RequestInit) => (await app.request(url, init)).status;
  expect(await status('http://127.0.0.1:8797/api/health')).toBe(200);
  expect(await status('http://[::1]:8797/api/health')).toBe(200);
  expect(await status('http://localhost:5183/api/health', { headers: { origin: 'http://localhost:5183' } })).toBe(200);
  expect(await status('http://attacker.example:8797/api/health')).toBe(403);
  expect(await status('http://127.0.0.1:8797/api/health', { headers: { origin: 'http://127.0.0.1:3000' } })).toBe(403); // another local port
  const post = { method: 'POST', body: '{}', headers: { 'content-type': 'text/plain' } };
  expect(await status('http://127.0.0.1:8797/api/approvals/demo-appr-1/approve', { ...post, headers: { ...post.headers, origin: 'https://attacker.example' } })).toBe(403);
  expect(await status('http://127.0.0.1:8797/api/approvals/demo-appr-1/approve', { ...post, headers: { ...post.headers, origin: 'null' } })).toBe(403);
});

test('route errors become JSON and land in the log; unknown paths are JSON 404s', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'frontline-err-'));
  initLog(dir);
  const app = createApp(openDb()).get('/api/boom', () => {
    throw new Error('kaboom');
  });
  const res = await app.request('/api/boom');
  expect([res.status, await res.json()]).toEqual([500, { error: 'kaboom' }]);
  const line = JSON.parse(readFileSync(join(dir, 'logs', 'api.log'), 'utf8').trim().split('\n').at(-1)!);
  expect(line).toMatchObject({ level: 'error', msg: 'request failed', method: 'GET', path: '/api/boom', error: expect.stringContaining('kaboom') });
  const missing = await app.request('/api/nope');
  expect([missing.status, await missing.json()]).toEqual([404, { error: 'GET /api/nope not found' }]);
});

test('demo mode off deletes the sample stores, keeps the owner\'s, and on brings them back fresh', async () => {
  const db = openDb();
  seedDemo(db);
  const app = createApp(db);
  const put = (on: unknown) => app.request('/api/demo-mode', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on }) });
  const ids = async () => ((await (await app.request('/api/stores')).json()) as Store[]).map((s) => s.id);
  await app.request('/api/stores', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Mine', platform: 'shopify', niche: 'home' }) });
  expect(await (await app.request('/api/demo-mode')).json()).toEqual({ on: true });
  expect((await put('yes')).status).toBe(400);
  expect(await (await put(false)).json()).toEqual({ on: false });
  expect(await ids()).toEqual(['mine']);
  expect(await (await put(true)).json()).toEqual({ on: true });
  expect((await ids()).sort()).toEqual(['glow', 'mine', 'pawsome', 'peak']);
  expect(db.prepare("SELECT count(*) AS n FROM daily_metrics WHERE store_id = 'glow'").get()!.n).toBeGreaterThan(300); // fresh history
  expect(db.prepare("SELECT count(*) AS n FROM agents WHERE store_id = 'glow'").get()!.n).toBe(8); // and its squad
});
