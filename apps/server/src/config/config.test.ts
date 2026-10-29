import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { SETTINGS, type ConfigView, type SettingDef, type StoreCaps } from '@frontline/shared';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { getCaps } from '../settings';
import { bootConfig } from './boot';
import { effective } from './effective';
import { writeConfig } from './write';

const setup = (file = ':memory:') => {
  const db = openDb(file);
  db.exec(`INSERT OR IGNORE INTO stores (id, name, platform, niche) VALUES ('a', 'Store A', 'shopify', 'pet'), ('b', 'Store B', 'etsy', 'home')`);
  bootConfig(db, 'America/Chicago');
  return { db, app: createApp(db) };
};
const send = (app: ReturnType<typeof createApp>, method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const config = async (app: ReturnType<typeof createApp>, store?: string) => (await (await send(app, 'GET', `/api/config${store ? `?store=${store}` : ''}`)).json()) as ConfigView;
const patch = (app: ReturnType<typeof createApp>, documents: unknown[]) => send(app, 'PATCH', '/api/config', { documents });
const rows = (db: Db) => ({
  settings: db.prepare('SELECT key, value_json, version FROM settings ORDER BY key').all().map((r) => ({ ...r })),
  caps: db.prepare('SELECT store_id, value_json, version FROM store_caps ORDER BY store_id').all().map((r) => ({ ...r })),
});
const capsJson = (db: Db, store: string) => JSON.parse(String(db.prepare('SELECT value_json FROM store_caps WHERE store_id = ?').get(store)?.value_json ?? 'null'));

test('a store override, else the workspace value, else the default; an inherits: none entry never falls back', async () => {
  const db = openDb();
  db.exec(`INSERT INTO stores (id, name, platform, niche) VALUES ('a', 'Store A', 'shopify', 'pet')`);
  const app = createApp(db);
  const at = async (store?: string) => {
    const v = await config(app, store);
    return [v.values['caps.agentCostPerDay'], v.origins['caps.agentCostPerDay']];
  };
  expect(await at('a')).toEqual([5, 'default']); // no workspace row yet (before boot)
  bootConfig(db, 'America/Chicago');
  expect(await at('a')).toEqual([5, 'workspace']);
  expect((await patch(app, [{ doc: 'workspace', version: 1, set: { 'caps.agentCostPerDay': 7 } }])).status).toBe(200);
  expect([await at(), await at('a')]).toEqual([[7, 'workspace'], [7, 'workspace']]);
  expect((await patch(app, [{ doc: 'store_caps', storeId: 'a', version: 0, set: { 'caps.agentCostPerDay': 2 } }])).status).toBe(200);
  expect([await at(), await at('a')]).toEqual([[7, 'workspace'], [2, 'store']]);
  expect((await config(app)).origins['policy.approvals']).toBe('locked');

  const none = { ...SETTINGS.find((d) => d.id === 'caps.agentCostPerDay')!, id: 'x.none', inherits: 'none', default: 1 } as SettingDef;
  writeConfig(db, [{ doc: 'workspace', set: { 'x.none': 9 } }], { trusted: true, current: () => null });
  expect([effective(db, {}, [none]).values['x.none'], effective(db, { storeId: 'a' }, [none])]).toEqual([9, expect.objectContaining({ values: { 'x.none': 1 }, origins: { 'x.none': 'default' } })]);
});

test('unset deletes the override: the store inherits again, and later workspace changes reach it', async () => {
  const { db, app } = setup();
  await patch(app, [{ doc: 'store_caps', storeId: 'a', version: 0, set: { 'caps.agentCostPerDay': 9 } }]);
  expect(capsJson(db, 'a')).toEqual({ agentCostPerDay: 9 });
  await patch(app, [{ doc: 'store_caps', storeId: 'a', version: 1, unset: ['caps.agentCostPerDay'] }]);
  expect(capsJson(db, 'a')).toEqual({});
  await patch(app, [{ doc: 'workspace', version: 1, set: { 'caps.agentCostPerDay': 11 } }]);
  expect(getCaps(db, 'a').agentCostPerDay).toBe(11);
});

test('each document is written alone: personal, workspace, app, store A leave the others (rows and versions) as they were', async () => {
  const { db, app } = setup();
  await patch(app, [{ doc: 'store_caps', storeId: 'b', version: 0, set: { 'caps.agentCostPerDay': 3 } }]);
  const others = (except: string) => {
    const r = rows(db);
    return { settings: r.settings.filter((x) => x.key !== except), caps: r.caps.filter((x) => `store_caps:${x.store_id}` !== except) };
  };
  for (const [doc, write] of [
    ['personal', () => writeConfig(db, [{ doc: 'personal', version: 1, set: { 'appearance.motion': 'reduce' } }], { trusted: true, current: () => null })],
    ['workspace', () => patch(app, [{ doc: 'workspace', version: 1, set: { 'caps.higgsfieldCreditsPerDay': 300 } }])],
    ['app', () => patch(app, [{ doc: 'app', version: 0, set: { baseCurrency: 'EUR' } }])],
    ['store_caps:a', () => patch(app, [{ doc: 'store_caps', storeId: 'a', version: 0, set: { 'caps.adSpendChangePerDay': 40 } }])],
  ] as const) {
    const before = others(doc);
    await write();
    expect(others(doc), doc).toEqual(before);
  }
  expect(capsJson(db, 'b')).toEqual({ agentCostPerDay: 3 });
});

test('PUT /api/caps saves only the keys it sends: the rest keep inheriting (origin workspace)', async () => {
  const { db, app } = setup();
  expect((await send(app, 'PUT', '/api/caps/a', { version: 0, agentCostPerDay: 2 })).status).toBe(200);
  expect(capsJson(db, 'a')).toEqual({ agentCostPerDay: 2 });
  await patch(app, [{ doc: 'workspace', version: 1, set: { 'caps.adSpendChangePerDay': 150 } }]);
  expect(getCaps(db, 'a')).toMatchObject({ agentCostPerDay: 2, adSpendChangePerDay: 150, higgsfieldCreditsPerDay: 200 });

  expect((await send(app, 'PUT', '/api/caps/b', { version: 0, autopilot: { 'ads.set_budget': { enabled: true, maxUsdPerDay: 25 } } })).status).toBe(200);
  expect(capsJson(db, 'b')).toEqual({ autopilot: { 'ads.set_budget': { enabled: true, maxUsdPerDay: 25 } } });
  const b = await config(app, 'b');
  expect(['caps.agentCostPerDay', 'caps.adSpendChangePerDay', 'caps.higgsfieldCreditsPerDay', 'autopilot.ads.set_budget'].map((id) => b.origins[id])).toEqual(['workspace', 'workspace', 'workspace', 'store']);
});

test('versions: 0 creates a row; a stale one gets 409 with the current document and writes nothing; none gets 428', async () => {
  const { db, app } = setup();
  expect((await send(app, 'PATCH', '/api/settings', { version: 0, baseCurrency: 'gbp' })).status).toBe(200); // a fresh database's app row
  expect((await patch(app, [{ doc: 'store_caps', storeId: 'a', version: 0, set: { 'caps.agentCostPerDay': 4 } }])).status).toBe(200);
  expect((await config(app, 'a')).versions).toEqual({ app: 1, personal: 1, workspace: 1, 'store_caps:a': 1 });
  await patch(app, [{ doc: 'store_caps', storeId: 'a', version: 1, set: { 'caps.agentCostPerDay': 6 } }]);

  const before = rows(db);
  const stale = await patch(app, [{ doc: 'store_caps', storeId: 'a', version: 1, set: { 'caps.agentCostPerDay': 8 } }]);
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ code: 'stale', current: { values: { 'caps.agentCostPerDay': 6 }, versions: { 'store_caps:a': 2 } } });
  expect((await patch(app, [{ doc: 'store_caps', storeId: 'b', version: 3, set: { 'caps.agentCostPerDay': 8 } }])).status).toBe(409); // no row: never recreated
  expect((await patch(app, [{ doc: 'store_caps', storeId: 'a', set: { 'caps.agentCostPerDay': 8 } }])).status).toBe(428);
  // Two documents, the second stale: neither is written.
  expect((await patch(app, [{ doc: 'workspace', version: 1, set: { 'caps.agentCostPerDay': 9 } }, { doc: 'store_caps', storeId: 'a', version: 1, set: { 'caps.agentCostPerDay': 9 } }])).status).toBe(409);
  expect(rows(db)).toEqual(before);
});

test('unknown, locked and out-of-scope keys get 400 with the reason and the field', async () => {
  const { app } = setup();
  for (const [doc, key, value, error] of [
    ['workspace', 'nope', 1, "There's no setting nope"],
    ['workspace', 'policy.approvals', false, 'Spending, publishing and live-store edits is a workspace policy: nothing can change it'],
    ['workspace', 'autopilot.ads.set_budget', { enabled: true, maxUsdPerDay: 5 }, "Change ad budgets can't be set here (it's a store setting)"],
    ['personal', 'caps.agentCostPerDay', 1, "AI usage per day can't be set here (it's a workspace or store setting)"],
    ['workspace', 'caps.agentCostPerDay', -1, 'AI usage per day must be from 0 to 1000000'],
  ] as const) {
    const res = await patch(app, [{ doc, version: 1, set: { [key]: value } }]);
    expect([res.status, await res.json()], key).toEqual([400, { error, field: key }]);
  }
  const res = await patch(app, [{ doc: 'store_caps', storeId: 'a', version: 0, set: { 'autopilot.ads.set_budget': { enabled: 'yes', maxUsdPerDay: 5 } } }]);
  expect(await res.json()).toMatchObject({ field: 'autopilot.ads.set_budget' });
});

test('change rows hold before and after, with the scope and store', async () => {
  const { db, app } = setup();
  await patch(app, [{ doc: 'store_caps', storeId: 'a', version: 0, set: { 'caps.agentCostPerDay': 9 } }]);
  await patch(app, [{ doc: 'store_caps', storeId: 'a', version: 1, set: { 'caps.agentCostPerDay': 12 } }]);
  await patch(app, [{ doc: 'store_caps', storeId: 'a', version: 2, set: { 'caps.agentCostPerDay': 12 } }]); // no change: no row, no version move
  await patch(app, [{ doc: 'app', version: 0, set: { 'notifications.digest': false } }]);
  expect(db.prepare("SELECT actor, scope, store_id, store_name, setting, before_json, after_json, state FROM settings_changes WHERE actor = 'owner' ORDER BY rowid").all().map((r) => ({ ...r }))).toEqual([
    { actor: 'owner', scope: 'store', store_id: 'a', store_name: 'Store A', setting: 'caps.agentCostPerDay', before_json: null, after_json: '9', state: 'saved' },
    { actor: 'owner', scope: 'store', store_id: 'a', store_name: 'Store A', setting: 'caps.agentCostPerDay', before_json: '9', after_json: '12', state: 'saved' },
    { actor: 'owner', scope: 'personal', store_id: null, store_name: null, setting: 'notifications.digest', before_json: null, after_json: 'false', state: 'saved' },
  ]);
  expect((await config(app, 'a')).versions['store_caps:a']).toBe(2);
});

test('values survive closing and reopening the database file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'frontline-config-'));
  try {
    const file = join(dir, 'frontline.db');
    const first = setup(file);
    await patch(first.app, [{ doc: 'workspace', version: 1, set: { 'caps.agentCostPerDay': 8 } }, { doc: 'store_caps', storeId: 'b', version: 0, set: { 'caps.adSpendChangePerDay': 30 } }]);
    first.db.close();
    const again = setup(file);
    expect(getCaps(again.db, 'b')).toMatchObject<Partial<StoreCaps>>({ agentCostPerDay: 8, adSpendChangePerDay: 30, version: 1 });
    again.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
