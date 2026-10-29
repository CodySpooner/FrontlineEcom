import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { Integration } from '@frontline/shared';
import { createApp } from './app';
import { openDb } from './db';
import { seedDemo } from './demo';
import { deleteIntegration, getCredentials, saveIntegration } from './integrations';
import { decrypt, encrypt, loadKey } from './secrets';
import { rebuildRevenue, switchToReal } from './connectors/common';

const key = randomBytes(32);
const setup = () => {
  const db = openDb();
  seedDemo(db);
  return { db, app: createApp(db, key) };
};
/** A new connection sends version 0 (settings ST-08c); an update passes the version it read. */
const put = (body: object, version = 0) => ({ method: 'PUT', body: JSON.stringify({ version, ...body }), headers: { 'content-type': 'application/json' } });
const TOKEN = 'shpat_super_secret_123';

test('encrypt/decrypt round-trips and rejects tampering, wrong row, wrong key', () => {
  const blob = encrypt(key, { accessToken: TOKEN }, 'shopify:glow');
  expect(blob).not.toContain(TOKEN);
  expect(decrypt(key, blob, 'shopify:glow')).toEqual({ accessToken: TOKEN });
  expect(() => decrypt(key, blob, 'shopify:peak')).toThrow();
  expect(() => decrypt(randomBytes(32), blob, 'shopify:glow')).toThrow();
  const raw = Buffer.from(blob.slice(3), 'base64');
  raw[raw.length - 1]! ^= 1;
  expect(() => decrypt(key, 'v1:' + raw.toString('base64'), 'shopify:glow')).toThrow();
});

test('loadKey creates a 32-byte key once and reuses it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'frontline-key-'));
  try {
    const a = loadKey(join(dir, 'data'));
    expect(a).toHaveLength(32);
    expect(loadKey(join(dir, 'data')).equals(a)).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('saving an integration stores secrets encrypted and never returns them', async () => {
  const { db, app } = setup();
  const res = await app.request('/api/integrations', put({ kind: 'shopify', storeId: 'glow', values: { shopDomain: 'glow-haus.myshopify.com', accessToken: TOKEN } }));
  const text = await res.text();
  expect(res.status).toBe(200);
  expect(text).not.toContain(TOKEN);
  expect(JSON.parse(text)).toMatchObject({ id: 'shopify:glow', kind: 'shopify', storeId: 'glow', status: 'connected', settings: { shopDomain: 'glow-haus.myshopify.com' }, secretsSet: ['accessToken'] });

  const listed = await (await app.request('/api/integrations?stores=glow')).text();
  expect(listed).not.toContain(TOKEN);
  expect(JSON.stringify(db.prepare('SELECT * FROM integrations').all())).not.toContain(TOKEN);
  expect(getCredentials(db, key, 'shopify', 'glow')).toEqual({ shopDomain: 'glow-haus.myshopify.com', accessToken: TOKEN });
  expect(((await (await app.request('/api/integrations?stores=peak')).json()) as Integration[])).toEqual([]);
});

test('updating keeps omitted secrets; global integrations need no store; delete works', async () => {
  const { db, app } = setup();
  await app.request('/api/integrations', put({ kind: 'shopify', storeId: 'glow', values: { shopDomain: 'a.myshopify.com', accessToken: TOKEN } }));
  const upd = (await (await app.request('/api/integrations', put({ kind: 'shopify', storeId: 'glow', values: { shopDomain: 'b.myshopify.com' } }, 1))).json()) as Integration;
  expect(upd.settings.shopDomain).toBe('b.myshopify.com');
  expect(getCredentials(db, key, 'shopify', 'glow')?.accessToken).toBe(TOKEN);

  const cj = (await (await app.request('/api/integrations', put({ kind: 'cj', values: { email: 'me@x.com', apiKey: 'k' } }))).json()) as Integration;
  expect(cj.id).toBe('cj:global');
  expect(((await (await app.request('/api/integrations?stores=peak')).json()) as Integration[]).map((i) => i.id)).toEqual(['cj:global']);

  expect((await app.request('/api/integrations/shopify:glow', { method: 'DELETE' })).status).toBe(204);
  expect((await app.request('/api/integrations/shopify:glow', { method: 'DELETE' })).status).toBe(404);
});

test('invalid integration bodies are rejected', async () => {
  const { app } = setup();
  const bad = [
    { kind: 'myspace', storeId: 'glow', values: {} },
    { kind: 'constructor', storeId: 'glow', values: {} },
    { kind: 'shopify', values: { shopDomain: 'a', accessToken: 'b' } },
    { kind: 'shopify', storeId: 'nope', values: { shopDomain: 'a', accessToken: 'b' } },
    { kind: 'shopify', storeId: 'glow', values: { shopDomain: 'a' } },
    { kind: 'shopify', storeId: 'glow', values: { shopDomain: 'a', accessToken: 'b', extra: 'c' } },
    { kind: 'shopify', storeId: 'glow', values: { shopDomain: 'a', accessToken: 5 } },
    { kind: 'cj', storeId: 'glow', values: { email: 'a', apiKey: 'b' } },
  ];
  for (const body of bad) expect((await app.request('/api/integrations', put(body))).status, JSON.stringify(body)).toBe(400);
});

test('credentials saved under another key read as an error to re-enter, never a crash', async () => {
  const { db, app } = setup();
  await app.request('/api/integrations', put({ kind: 'shopify', storeId: 'glow', values: { shopDomain: 'glow-haus.myshopify.com', accessToken: TOKEN } }));
  const reset = createApp(db, randomBytes(32)); // desktop key was reset
  const [listed] = (await (await reset.request('/api/integrations?stores=glow')).json()) as Integration[];
  expect(listed).toMatchObject({ status: 'error', error: expect.stringContaining('Enter them again'), secretsSet: [] });
  expect(getCredentials(db, randomBytes(32), 'shopify', 'glow')).toBeUndefined();
  expect(db.prepare('SELECT status FROM integrations').get()).toEqual({ status: 'error' });
  // keeping the old token is impossible, so it must be entered again
  expect((await reset.request('/api/integrations', put({ kind: 'shopify', storeId: 'glow', values: { shopDomain: 'glow-haus.myshopify.com' } }))).status).toBe(400);
  const res = await reset.request('/api/integrations', put({ kind: 'shopify', storeId: 'glow', values: { shopDomain: 'glow-haus.myshopify.com', accessToken: TOKEN } }, 1));
  expect(await res.json()).toMatchObject({ status: 'connected', secretsSet: ['accessToken'] });
});

test('GET /api/health lists each connector state without secrets', async () => {
  const { db, app } = setup();
  expect((await app.request('/api/health')).status).toBe(200);
  await app.request('/api/integrations', put({ kind: 'shopify', storeId: 'glow', values: { shopDomain: 'glow-haus.myshopify.com', accessToken: TOKEN } }));
  db.prepare("UPDATE integrations SET status = 'error', error = 'Shopify rejected the access token' WHERE id = 'shopify:glow'").run();
  await app.request('/api/integrations', put({ kind: 'cj', values: { email: 'a@b.co', apiKey: 'cj-secret' } }));
  db.prepare("UPDATE integrations SET synced_at = '2026-10-26T10:00:00.000Z' WHERE id = 'cj:global'").run();

  const res = await (await app.request('/api/health')).text();
  expect(res).not.toContain(TOKEN);
  expect(res).not.toContain('cj-secret');
  expect(JSON.parse(res)).toEqual({
    ok: true,
    uptimeSec: expect.any(Number),
    version: 'dev',
    connectors: [
      { id: 'cj:global', kind: 'cj', status: 'connected', syncedAt: '2026-10-26T10:00:00.000Z' },
      { id: 'shopify:glow', kind: 'shopify', storeId: 'glow', status: 'error', error: 'Shopify rejected the access token' },
    ],
  });
});

test('pointing an integration at another ad account restarts its backfill; a new token keeps the sync cursor', () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  const save = (adAccountId: string, accessToken: string) => saveIntegration(db, key, { kind: 'meta_ads', storeId: 'glow', values: { adAccountId, accessToken } });
  const cursor = () => db.prepare("SELECT cursor FROM integrations WHERE id = 'meta_ads:glow'").get()?.cursor;
  save('act_1', 'token-a');
  db.prepare("UPDATE integrations SET cursor = '2026-10-26' WHERE id = 'meta_ads:glow'").run();
  save('act_1', 'token-b');
  expect(cursor()).toBe('2026-10-26');
  save('act_2', 'token-b');
  expect(cursor()).toBeNull();
});

test("reconnecting a store to another shop drops the old shop's orders, products and revenue; other sources stay", () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  switchToReal(db, 'glow');
  const order = db.prepare("INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, cogs, local_date) VALUES ('glow', ?, '2026-10-25T12:00:00Z', ?, 'paid', 'unfulfilled', 0, '2026-10-25')");
  order.run('#1001', 100);
  order.run('tt-5', 20);
  const product = db.prepare("INSERT INTO products (store_id, id, title, price, cost, inventory, status) VALUES ('glow', ?, 'p', 10, 0, 1, 'active')");
  for (const id of ['8001', 'tt-9', 'research-r1']) product.run(id);
  db.prepare("INSERT INTO channel_daily (store_id, channel, date, revenue, orders) VALUES ('glow', 'amazon', '2026-10-24', 50, 2)").run();
  rebuildRevenue(db, 'glow', ['2026-10-24', '2026-10-25']);
  const shopify = (shopDomain: string, accessToken: string) => saveIntegration(db, key, { kind: 'shopify', storeId: 'glow', values: { shopDomain, accessToken } });
  const amazon = (marketplaceId: string) =>
    saveIntegration(db, key, { kind: 'amazon', storeId: 'glow', values: { sellerId: 'A1', region: 'na', marketplaceId, clientId: 'c', clientSecret: 's', refreshToken: 'r' } });
  const ids = (t: string) => db.prepare(`SELECT id FROM ${t} WHERE store_id = 'glow' ORDER BY id`).all().map((r) => r.id);
  const revenue = (date: string) => db.prepare("SELECT revenue FROM daily_metrics WHERE store_id = 'glow' AND date = ?").get(date)?.revenue;

  shopify('dev-shop.myshopify.com', 'token-a');
  shopify('https://Dev-Shop.myshopify.com/', 'token-b'); // the same shop, a new token
  amazon('ATVPDKIKX0DER');
  expect(ids('orders')).toEqual(['#1001', 'tt-5']);

  shopify('real-shop.myshopify.com', 'token-c');
  expect(ids('orders')).toEqual(['tt-5']);
  expect(ids('products')).toEqual(['research-r1', 'tt-9']);
  expect(revenue('2026-10-25')).toBe(20);
  expect(revenue('2026-10-24')).toBe(50);

  amazon('A1F83G8C2ARO7P');
  expect(revenue('2026-10-24')).toBe(0);
  expect(ids('orders')).toEqual(['tt-5']);
});

test("disconnecting, then connecting another shop, still drops the old shop's data; the same shop keeps it", () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  switchToReal(db, 'glow');
  db.prepare("INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, cogs, local_date) VALUES ('glow', '#1001', '2026-10-25T12:00:00Z', 100, 'paid', 'unfulfilled', 0, '2026-10-25')").run();
  const shopify = (shopDomain: string) => saveIntegration(db, key, { kind: 'shopify', storeId: 'glow', values: { shopDomain, accessToken: 't' } });
  const orders = () => db.prepare("SELECT id FROM orders WHERE store_id = 'glow'").all().map((r) => r.id);
  shopify('old-shop.myshopify.com');
  deleteIntegration(db, 'shopify:glow');
  shopify('old-shop.myshopify.com');
  expect(orders()).toEqual(['#1001']);
  deleteIntegration(db, 'shopify:glow');
  shopify('new-shop.myshopify.com');
  expect(orders()).toEqual([]);
});

test("the same shop typed differently, or TikTok's optional shop left blank, isn't another shop: nothing is dropped", () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  switchToReal(db, 'glow');
  const order = db.prepare("INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, cogs, local_date) VALUES ('glow', ?, '2026-10-25T12:00:00Z', 10, 'paid', 'unfulfilled', 0, '2026-10-25')");
  order.run('tt-5');
  order.run('woo-7');
  const orders = () => db.prepare("SELECT id FROM orders WHERE store_id = 'glow' ORDER BY id").all().map((r) => r.id);
  const tiktok = (shop?: string) => saveIntegration(db, key, { kind: 'tiktok_shop', storeId: 'glow', values: { appKey: 'ak', appSecret: 'as', ...(shop ? { shop } : {}) } });
  const woo = (siteUrl: string) => saveIntegration(db, key, { kind: 'woocommerce', storeId: 'glow', values: { siteUrl, consumerKey: 'ck', consumerSecret: 'cs', wpAppPassword: 'pw' } });
  tiktok('Glow Haus');
  deleteIntegration(db, 'tiktok_shop:glow');
  tiktok();
  woo('https://www.glow.com');
  deleteIntegration(db, 'woocommerce:glow');
  woo('https://glow.com/');
  expect(orders()).toEqual(['tt-5', 'woo-7']);
  tiktok('Other Shop'); // blank before, so still unknown
  expect(orders()).toEqual(['tt-5', 'woo-7']);
  woo('https://other.com');
  expect(orders()).toEqual(['tt-5']);
});

test('"sync now" marks an integration changed, so the sync loop picks it up on its next tick', async () => {
  const { db, app } = setup();
  saveIntegration(db, key, { kind: 'shopify', storeId: 'glow', values: { shopDomain: 'glow-haus.myshopify.com', accessToken: TOKEN } });
  db.prepare("UPDATE integrations SET updated_at = '2026-01-01T00:00:00.000Z' WHERE id = 'shopify:glow'").run();
  expect((await app.request('/api/integrations/shopify:glow/sync', { method: 'POST' })).status).toBe(202);
  expect(String(db.prepare("SELECT updated_at FROM integrations WHERE id = 'shopify:glow'").get()?.updated_at) > '2026-01-01T00:00:00.000Z').toBe(true);
  expect((await app.request('/api/integrations/shopify:nope/sync', { method: 'POST' })).status).toBe(404);
});

test('an ad account feeds one store: connecting it to a second one says where it is', () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  const key = randomBytes(32);
  expect(saveIntegration(db, key, { kind: 'meta_ads', storeId: 'glow', values: { adAccountId: 'act_123', accessToken: 't' } })).toMatchObject({ status: 'connected' });
  expect(saveIntegration(db, key, { kind: 'meta_ads', storeId: 'pawsome', values: { adAccountId: ' 123 ', accessToken: 't' } })).toMatch(/already connected to Glow Haus/);
  expect(saveIntegration(db, key, { kind: 'meta_ads', storeId: 'glow', values: { adAccountId: '123', accessToken: 't2' } })).toMatchObject({ status: 'connected' }); // its own store again
  saveIntegration(db, key, { kind: 'google_ads', storeId: 'glow', values: { customerId: '123-456-7890', clientId: 'c', clientSecret: 's', refreshToken: 'r', developerToken: 'd' } });
  expect(saveIntegration(db, key, { kind: 'google_ads', storeId: 'peak', values: { customerId: '1234567890', clientId: 'c', clientSecret: 's', refreshToken: 'r', developerToken: 'd' } })).toMatch(/already connected/);
});
