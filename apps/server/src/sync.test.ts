import { randomBytes } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { openDb } from './db';
import { seedDemo } from './demo';
import { saveIntegration, setIntegrationStatus } from './integrations';
import { startSyncLoop } from './sync';

afterEach(() => vi.useRealTimers());

test('sync loop runs new integrations once, retries when stale or when credentials change', async () => {
  vi.useFakeTimers({ now: new Date('2026-10-26T12:00:00Z') });
  const db = openDb();
  seedDemo(db, '2026-10-26');
  const key = randomBytes(32);
  const save = () => saveIntegration(db, key, { kind: 'shopify', storeId: 'glow', values: { shopDomain: 'glow.myshopify.com', accessToken: 't' } });
  save();
  const shopify = vi.fn(async () => {});
  const stop = startSyncLoop(db, key, { everyMs: 1000, staleMs: 60_000, syncers: { shopify } });

  expect(shopify).toHaveBeenCalledTimes(1);
  expect(shopify).toHaveBeenCalledWith(db, key, 'glow');
  await vi.advanceTimersByTimeAsync(5000);
  expect(shopify).toHaveBeenCalledTimes(1);

  vi.setSystemTime(new Date('2026-10-26T12:00:10Z'));
  save();
  await vi.advanceTimersByTimeAsync(1000);
  expect(shopify).toHaveBeenCalledTimes(2);

  await vi.advanceTimersByTimeAsync(61_000);
  expect(shopify).toHaveBeenCalledTimes(3);
  stop();
});

test('a connection that breaks raises one error notification, and one when it recovers', async () => {
  vi.useFakeTimers({ now: new Date('2026-10-26T12:00:00Z') });
  const db = openDb();
  seedDemo(db, '2026-10-26');
  const key = randomBytes(32);
  saveIntegration(db, key, { kind: 'shopify', storeId: 'glow', values: { shopDomain: 'glow.myshopify.com', accessToken: 't' } });
  let fail = true;
  const shopify = vi.fn(async () => setIntegrationStatus(db, 'shopify:glow', fail ? 'error' : 'connected', fail ? 'Shopify refused the token' : undefined));
  const notes = () => db.prepare('SELECT kind, title, body, store_id AS storeId, link FROM notifications ORDER BY rowid DESC').all().map((n) => Object.values(n));
  const stop = startSyncLoop(db, key, { everyMs: 1000, staleMs: 60_000, syncers: { shopify } });
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(61_000 * 2); // two failed retries
  expect(shopify).toHaveBeenCalledTimes(3);
  expect(notes()).toEqual([['error', 'Shopify for Glow Haus stopped syncing', 'Shopify refused the token. Fix it in Integrations.', 'glow', '/integrations']]);

  fail = false;
  await vi.advanceTimersByTimeAsync(61_000);
  expect(notes()[0]).toEqual(['info', 'Shopify for Glow Haus is syncing again', null, 'glow', '/integrations']);
  expect(notes()).toHaveLength(2);
  stop();
});
