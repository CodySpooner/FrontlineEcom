import { randomBytes } from 'node:crypto';
import { expect, test } from 'vitest';
import type { Store } from '@frontline/shared';
import { createApp } from '../app';
import { syncShopify } from '../connectors/shopify';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';

const key = randomBytes(32);
const setup = () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  return { db, app: createApp(db, key) };
};
const send = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const get = async (app: ReturnType<typeof createApp>, id: string) => (await (await app.request(`/api/stores/${id}`)).json()) as Store;
/** The store's own fields' change rows (connecting an integration writes its own). */
const changes = (db: Db, store: string) =>
  db.prepare("SELECT actor, scope, store_name, setting, before_json, after_json FROM settings_changes WHERE store_id = ? AND setting LIKE 'store.%' ORDER BY rowid").all(store).map((r) => ({ ...r }));

test('PATCH /api/stores/:id: the version read saves (one bump, a change row per moved field); a stale one 409s, none 428s; POST needs none', async () => {
  const { db, app } = setup();
  const created = await app.request('/api/stores', send('POST', { name: 'Volt Lab', platform: 'shopify', niche: 'tech' }));
  expect([created.status, ((await created.json()) as Store).version]).toEqual([201, 1]);

  const read = await get(app, 'glow');
  const saved = await app.request('/api/stores/glow', send('PATCH', { version: read.version, name: 'Glow Haus EU', color: '#00ff88', niche: read.niche, feePercent: 9.5 }));
  expect(await saved.json()).toMatchObject({ name: 'Glow Haus EU', color: '#00ff88', feePercent: 9.5, version: read.version! + 1 });
  expect(changes(db, 'glow')).toEqual([
    { actor: 'owner', scope: 'store', store_name: 'Glow Haus EU', setting: 'store.name', before_json: '"Glow Haus"', after_json: '"Glow Haus EU"' },
    { actor: 'owner', scope: 'store', store_name: 'Glow Haus EU', setting: 'store.color', before_json: JSON.stringify(read.color), after_json: '"#00ff88"' },
    { actor: 'owner', scope: 'store', store_name: 'Glow Haus EU', setting: 'store.feePercent', before_json: null, after_json: '9.5' },
  ]);

  const stale = await app.request('/api/stores/glow', send('PATCH', { version: read.version, name: 'Someone else' }));
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ code: 'stale', current: { name: 'Glow Haus EU', version: read.version! + 1 } });
  expect((await app.request('/api/stores/glow', send('PATCH', { name: 'No version' }))).status).toBe(428);
  expect((await get(app, 'glow')).name).toBe('Glow Haus EU');
  expect(changes(db, 'glow')).toHaveLength(3);
});

test("a 400 names the setting parseStoreInput refused, by its registry id", async () => {
  const { app } = setup();
  const v = (await get(app, 'glow')).version;
  for (const [body, field] of [
    [{ name: '' }, 'store.name'],
    [{ platform: 'ebay' }, 'store.platform'],
    [{ currency: 'usd' }, 'store.currency'],
    [{ timezone: 'Mars/Base' }, 'store.timezone'],
    [{ color: 'red' }, 'store.color'],
    [{ feePerOrder: -1 }, 'store.feePerOrder'],
  ] as const) {
    const res = await app.request('/api/stores/glow', send('PATCH', { version: v, ...body }));
    expect([res.status, ((await res.json()) as { field?: string }).field], field).toEqual([400, field]);
  }
});

test('a Shopify sync that changes the currency writes a sync:shopify change row and bumps the version; a sync that changes nothing leaves it', async () => {
  const { db, app } = setup();
  await app.request('/api/integrations', send('PUT', { kind: 'shopify', storeId: 'glow', values: { shopDomain: 'glow-haus.myshopify.com', accessToken: 'tok_not-a-real-secret' }, version: 0 }));
  const page = { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
  const shopify = (async (_url: string, init: RequestInit) => {
    const { query } = JSON.parse(String(init.body)) as { query: string };
    if (query.includes('shop {')) return Response.json({ data: { shop: { name: 'Glow Haus', currencyCode: 'EUR', ianaTimezone: 'Europe/Berlin' } } });
    if (query.includes('shopifyqlQuery')) return Response.json({ errors: [{ message: 'Access denied for shopifyqlQuery field.' }] });
    return Response.json({ data: { orders: page, products: page, events: page } });
  }) as typeof fetch;
  const before = await get(app, 'glow');
  await syncShopify(db, key, 'glow', shopify, new Date('2026-10-26T18:00:00Z'));
  const after = await get(app, 'glow');
  expect(after).toMatchObject({ currency: 'EUR', timezone: 'Europe/Berlin', connected: true });
  expect(after.version).toBe(before.version! + 2); // the currency, then the zone
  expect(changes(db, 'glow')).toEqual([
    { actor: 'sync:shopify', scope: 'store', store_name: 'Glow Haus', setting: 'store.currency', before_json: JSON.stringify(before.currency), after_json: '"EUR"' },
    { actor: 'sync:shopify', scope: 'store', store_name: 'Glow Haus', setting: 'store.timezone', before_json: JSON.stringify(before.timezone), after_json: '"Europe/Berlin"' },
  ]);

  // The next sync writes only its status, cursor and timestamp: no version, no change row.
  await syncShopify(db, key, 'glow', shopify, new Date('2026-10-26T19:00:00Z'));
  expect(db.prepare("SELECT synced_at FROM integrations WHERE id = 'shopify:glow'").get()?.synced_at).toBe('2026-10-26T19:00:00.000Z');
  expect((await get(app, 'glow')).version).toBe(after.version);
  expect(changes(db, 'glow')).toHaveLength(2);
});
