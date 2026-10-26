import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { Store } from '@frontline/shared';
import { createApp, startServer } from './app';
import { openDb } from './db';
import { seedDemo } from './demo';

const db = openDb();
seedDemo(db);
const app = createApp(db);

test('health responds ok', async () => {
  const res = await app.request('/api/health');
  expect(await res.json()).toEqual({ ok: true });
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
