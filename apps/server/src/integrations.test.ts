import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { Integration } from '@frontline/shared';
import { createApp } from './app';
import { openDb } from './db';
import { seedDemo } from './demo';
import { getCredentials } from './integrations';
import { decrypt, encrypt, loadKey } from './secrets';

const key = randomBytes(32);
const setup = () => {
  const db = openDb();
  seedDemo(db);
  return { db, app: createApp(db, key) };
};
const put = (body: unknown) => ({ method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
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
  const upd = (await (await app.request('/api/integrations', put({ kind: 'shopify', storeId: 'glow', values: { shopDomain: 'b.myshopify.com' } }))).json()) as Integration;
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
  const res = await reset.request('/api/integrations', put({ kind: 'shopify', storeId: 'glow', values: { shopDomain: 'glow-haus.myshopify.com', accessToken: TOKEN } }));
  expect(await res.json()).toMatchObject({ status: 'connected', secretsSet: ['accessToken'] });
});
