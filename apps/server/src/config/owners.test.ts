import { expect, test } from 'vitest';
import type { KbControlsState, PrStoreProfile } from '@frontline/shared';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';

const setup = () => {
  const db = openDb();
  seedDemo(db);
  return { db, app: createApp(db) };
};
const send = (app: ReturnType<typeof createApp>, method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const read = async <T,>(app: ReturnType<typeof createApp>, path: string) => (await (await send(app, 'GET', path)).json()) as T;
const changes = (db: Db, prefix: string) =>
  db.prepare('SELECT actor, scope, store_id, setting, before_json, after_json FROM settings_changes WHERE setting LIKE ? ORDER BY rowid').all(`${prefix}%`).map((r) => ({ ...r }));

test('KB controls: the first save sends 0; a second save on the same read is 409 with the current controls; none is 428; a 400 names the field', async () => {
  const { db, app } = setup();
  const path = '/api/kb/controls?ws=pawsome';
  const once = await read<KbControlsState>(app, path);
  expect(once.version).toBe(0);
  const first = await send(app, 'PUT', path, { version: once.version, retentionDays: 90, review: false });
  expect([first.status, ((await first.json()) as KbControlsState).version]).toEqual([200, 1]);
  const second = await send(app, 'PUT', path, { version: once.version, retentionDays: 365 });
  expect(second.status).toBe(409);
  expect(await second.json()).toMatchObject({ code: 'exists', current: { retentionDays: 90, version: 1 } });
  const later = await send(app, 'PUT', path, { version: 1, depth: 'deep' });
  expect(((await later.json()) as KbControlsState).version).toBe(2);
  expect((await send(app, 'PUT', path, { version: 1, depth: 'quick' })).status).toBe(409); // stale
  expect((await send(app, 'PUT', path, { depth: 'quick' })).status).toBe(428);
  for (const [body, field] of [[{ depth: 'abyss' }, 'depth'], [{ approval: 'yes' }, 'approval'], [{ blockedDomains: ['https://x'] }, 'blockedDomains'], [{ retentionDays: 5 }, 'retentionDays']] as const) {
    const res = await send(app, 'PUT', path, { version: 2, ...body });
    expect([res.status, ((await res.json()) as { field?: string }).field]).toEqual([400, field]);
  }
  expect((await read<KbControlsState>(app, path)).depth).toBe('deep');
  expect(changes(db, 'kb.')).toEqual([
    { actor: 'owner', scope: 'store', store_id: 'pawsome', setting: 'kb.review', before_json: 'true', after_json: 'false' },
    { actor: 'owner', scope: 'store', store_id: 'pawsome', setting: 'kb.retentionDays', before_json: 'null', after_json: '90' },
    { actor: 'owner', scope: 'store', store_id: 'pawsome', setting: 'kb.depth', before_json: '"standard"', after_json: '"deep"' },
  ]);
  // General's controls are the workspace's.
  await send(app, 'PUT', '/api/kb/controls?ws=general', { version: 0, retentionDays: 30 });
  expect(changes(db, 'kb.retentionDays').at(-1)).toMatchObject({ scope: 'workspace', store_id: null, after_json: '30' });
});

test('research profile: the version read saves; a stale one is 409 and writes nothing; none is 428; a 400 names the field; change rows', async () => {
  const { db, app } = setup();
  const path = '/api/pr/profile?store=pawsome';
  const fresh = await read<PrStoreProfile>(app, path);
  expect(fresh.version).toBe(0);
  const saved = await send(app, 'PUT', path, { version: 0, priceMax: 2500, shipTo: 'gb' });
  expect(await saved.json()).toMatchObject({ priceMax: 2500, shipTo: 'GB', version: 1 });
  const stale = await send(app, 'PUT', path, { version: 0, priceMax: 9900 });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ code: 'exists', current: { priceMax: 2500, version: 1 } });
  expect((await send(app, 'PUT', path, { version: 2, priceMax: 9900 })).status).toBe(409);
  expect((await send(app, 'PUT', path, { priceMax: 9900 })).status).toBe(428);
  for (const [body, field] of [[{ priceMax: 19.99 }, 'priceMax'], [{ shipTo: 'USA' }, 'shipTo'], [{ warehouses: ['China'] }, 'warehouses'], [{ priceMin: 3000 }, 'priceMin']] as const) {
    const res = await send(app, 'PUT', path, { version: 1, ...body });
    expect([res.status, ((await res.json()) as { field?: string }).field], JSON.stringify(body)).toEqual([400, field]);
  }
  expect((await read<PrStoreProfile>(app, path)).priceMax).toBe(2500);
  await send(app, 'PUT', path, { version: 1, shipTo: null, keywords: ['harness'] });
  expect(changes(db, 'pr.')).toEqual([
    { actor: 'owner', scope: 'store', store_id: 'pawsome', setting: 'pr.priceMax', before_json: 'null', after_json: '2500' },
    { actor: 'owner', scope: 'store', store_id: 'pawsome', setting: 'pr.shipTo', before_json: 'null', after_json: '"GB"' },
    { actor: 'owner', scope: 'store', store_id: 'pawsome', setting: 'pr.shipTo', before_json: '"GB"', after_json: 'null' },
    { actor: 'owner', scope: 'store', store_id: 'pawsome', setting: 'pr.keywords', before_json: '[]', after_json: '["harness"]' },
  ]);
});
