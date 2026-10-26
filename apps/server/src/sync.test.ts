import { randomBytes } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { openDb } from './db';
import { seedDemo } from './demo';
import { saveIntegration } from './integrations';
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
