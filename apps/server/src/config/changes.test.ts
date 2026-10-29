import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import type { ConfigChange, ConfigChangesPage, ConfigView, LiveMessage } from '@frontline/shared';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { subscribe } from '../live';
import { JOBS, resumeJobs } from './apply';
import { logChanges } from './write';

const key = randomBytes(32);
afterEach(() => JOBS.clear());
const setup = () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  return { db, app: createApp(db, key) };
};
const send = async (app: ReturnType<typeof createApp>, method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await res.text(); // a 204 has none
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as never };
};
const state = (db: Db, id: string) => db.prepare('SELECT state, detail FROM settings_changes WHERE id = ?').get(id);
/** A row as a job's setting writes it, left in `state`. */
const row = (db: Db, id: string, s: string, storeId: string | null = null) =>
  db.prepare("INSERT INTO settings_changes (id, at, actor, scope, store_id, setting, after_json, state) VALUES (?, ?, 'owner', ?, ?, ?, '\"EUR\"', ?)")
    .run(id, new Date().toISOString(), storeId ? 'store' : 'workspace', storeId, storeId ? 'store.currency' : 'baseCurrency', s);
const saveBase = async (app: ReturnType<typeof createApp>, value: string) => {
  const version = ((await send(app, 'GET', '/api/config')).body as ConfigView).versions.app ?? 0;
  return (await send(app, 'PATCH', '/api/config', { documents: [{ doc: 'app', version, set: { baseCurrency: value } }] })).body as ConfigView;
};

test('Change History pages newest first, filters by store, setting and scope, and never holds a secret value', async () => {
  const { db, app } = setup();
  const SECRETS = ['tok_not-a-real-secret-a', 'tok_not-a-real-secret-b', 'tok_not-a-real-secret-c'];
  await send(app, 'PUT', '/api/integrations', { kind: 'cj', version: 0, values: { email: 'ops@shop.test', apiKey: SECRETS[0] } });
  await send(app, 'PUT', '/api/integrations', { kind: 'cj', version: 1, values: { email: 'ops@shop.test', apiKey: SECRETS[1] } });
  await send(app, 'PUT', '/api/integrations', { kind: 'shopify', storeId: 'glow', version: 0, values: { shopDomain: 'glow-haus.myshopify.com', accessToken: SECRETS[2] } });
  await send(app, 'DELETE', '/api/integrations/cj:global');
  const all = (await send(app, 'GET', '/api/config/changes')).body as ConfigChangesPage;
  expect(all.changes.map((c) => [c.setting, c.detail])).toEqual([
    ['cj.apiKey', 'removed'],
    ['shopify.accessToken', 'replaced'],
    ['shopify.shopDomain', undefined],
    ['cj.apiKey', 'replaced'],
    ['cj.apiKey', 'replaced'],
    ['cj.email', undefined],
  ]);
  expect(all.changes.filter((c) => c.setting.endsWith('Key') || c.setting.endsWith('Token')).every((c) => !('before' in c) && !('after' in c))).toBe(true);
  for (const s of SECRETS) expect(JSON.stringify(all) + JSON.stringify(db.prepare('SELECT * FROM settings_changes').all())).not.toContain(s);

  expect(((await send(app, 'GET', '/api/config/changes?store=glow')).body as ConfigChangesPage).changes.map((c) => c.storeName)).toEqual(['Glow Haus', 'Glow Haus']);
  expect(((await send(app, 'GET', '/api/config/changes?setting=cj.email')).body as ConfigChangesPage).changes).toMatchObject([{ actor: 'owner', scope: 'workspace', before: null, after: 'ops@shop.test' }]);
  expect(((await send(app, 'GET', '/api/config/changes?scope=store')).body as ConfigChangesPage).changes).toHaveLength(2);

  logChanges(db, { at: '2020-01-01T00:00:00.000Z', actor: 'owner' }, Array.from({ length: 105 }, (_, i) => [`kb.n${i}`, i, i + 1, 'workspace']));
  const seen: string[] = [];
  let next: string | undefined = '';
  while (next !== undefined) {
    const page = (await send(app, 'GET', `/api/config/changes?scope=workspace${next ? `&cursor=${encodeURIComponent(next)}` : ''}`)).body as ConfigChangesPage;
    seen.push(...page.changes.map((c) => c.setting));
    next = page.next;
  }
  // Three pages, nothing twice or missed; within one save, its last write first.
  expect(seen).toEqual(['cj.apiKey', 'cj.apiKey', 'cj.apiKey', 'cj.email', ...Array.from({ length: 105 }, (_, i) => `kb.n${104 - i}`)]);
  expect((await send(app, 'GET', '/api/config/changes?cursor=nope')).status).toBe(400);
});

test('a setting with a job saves as applying, then the job marks it applied or failed and says so on the socket', async () => {
  const { db, app } = setup();
  const heard: LiveMessage[] = [];
  const stop = subscribe((m) => heard.push(m));
  const ran: string[] = [];
  db.prepare("INSERT INTO settings (key, value_json) VALUES ('fx', ?)").run(JSON.stringify({ date: '2026-10-27', rates: { EUR: 1, GBP: 0.86, JPY: 162, USD: 1.08 } })); // codes the picker offers (ST-16)
  const real = JOBS.get('baseCurrency')!;
  JOBS.set('baseCurrency', (_db, c) => {
    ran.push(String(c.after));
    if (c.after === 'GBP') throw new Error('FX rates unavailable');
  });
  const saved = await saveBase(app, 'EUR');
  expect(saved.changes).toMatchObject([{ setting: 'baseCurrency', after: 'EUR', state: 'applying', requestId: expect.any(String) }]);
  const [c] = saved.changes!;
  await vi.waitFor(() => expect(state(db, c!.id)).toEqual({ state: 'applied', detail: null }));
  expect(((await send(app, 'GET', `/api/config/changes?request=${c!.requestId}`)).body as ConfigChangesPage).changes).toMatchObject([{ id: c!.id, state: 'applied' }]);

  const failed = (await saveBase(app, 'GBP')).changes![0]!;
  await vi.waitFor(() => expect(state(db, failed.id)).toEqual({ state: 'failed', detail: 'FX rates unavailable' }));
  expect(heard.filter((m) => m.type === 'config_change').map((m) => (m as { change: ConfigChange }).change.state)).toEqual(['applied', 'failed']);
  expect(ran).toEqual(['EUR', 'GBP']);

  JOBS.delete('baseCurrency'); // a setting without a job is saved, nothing more
  expect((await saveBase(app, 'JPY')).changes).toMatchObject([{ setting: 'baseCurrency', state: 'saved' }]);
  JOBS.set('baseCurrency', real);
  stop();
});

test('a job left applying across a restart finishes once', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'frontline-st09-'));
  let db: Db | undefined;
  try {
    const before = openDb(join(dir, 'frontline.db'));
    row(before, 'left', 'applying');
    before.close();
    const after = (db = openDb(join(dir, 'frontline.db')));
    const ran = vi.fn();
    JOBS.set('baseCurrency', ran);
    resumeJobs(after);
    resumeJobs(after); // a second pass while it runs starts nothing
    await vi.waitFor(() => expect(state(after, 'left')).toMatchObject({ state: 'applied' }));
    resumeJobs(after);
    await new Promise((r) => setTimeout(r, 10));
    expect(ran).toHaveBeenCalledTimes(1);
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('retrying a failed job twice runs it once; a store row names its store', async () => {
  const { db, app } = setup();
  const ran = vi.fn();
  JOBS.set('baseCurrency', ran);
  JOBS.set('store.currency', ran);
  row(db, 'ws', 'failed');
  const [first, second] = await Promise.all([send(app, 'POST', '/api/config/changes/ws/retry'), send(app, 'POST', '/api/config/changes/ws/retry')]);
  expect([first.status, second.status]).toEqual([202, 200]);
  expect(first.body).toMatchObject({ id: 'ws', state: 'applying' });
  await vi.waitFor(() => expect(state(db, 'ws')).toMatchObject({ state: 'applied' }));
  expect((await send(app, 'POST', '/api/config/changes/ws/retry')).body).toMatchObject({ state: 'applied' });
  expect(ran).toHaveBeenCalledTimes(1);

  row(db, 'st', 'failed', 'glow');
  expect((await send(app, 'POST', '/api/config/changes/st/retry')).status).toBe(400);
  expect((await send(app, 'POST', '/api/config/changes/st/retry?store=peak')).status).toBe(404);
  expect((await send(app, 'POST', '/api/config/changes/ws/retry?store=glow')).status).toBe(404); // a workspace row takes no store
  expect((await send(app, 'POST', '/api/config/changes/st/retry?store=glow')).status).toBe(202);
  row(db, 'plain', 'saved');
  expect((await send(app, 'POST', '/api/config/changes/plain/retry')).status).toBe(409);
  expect((await send(app, 'POST', '/api/config/changes/nope/retry')).status).toBe(404);
});
