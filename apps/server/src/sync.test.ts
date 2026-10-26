import { randomBytes } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { openDb } from './db';
import { seedDemo } from './demo';
import { saveIntegration, setIntegrationStatus } from './integrations';
import { switchToReal } from './connectors/common';
import { subscribe } from './live';
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
  const stop = startSyncLoop(db, key, { everyMs: 1000, staleMs: 60_000, fastMs: 60_000, syncers: { shopify } });

  expect(shopify).toHaveBeenCalledTimes(1);
  expect(shopify).toHaveBeenCalledWith(db, key, 'glow', expect.any(Function));
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
  const stop = startSyncLoop(db, key, { everyMs: 1000, staleMs: 60_000, fastMs: 60_000, syncers: { shopify } });
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

test("a connected store's new paid orders reach the live feed once; history and the first real sync don't", async () => {
  vi.useFakeTimers({ now: new Date('2026-10-26T12:00:00Z') });
  const db = openDb();
  seedDemo(db, '2026-10-26');
  const key = randomBytes(32);
  saveIntegration(db, key, { kind: 'shopify', storeId: 'glow', values: { shopDomain: 'glow.myshopify.com', accessToken: 't' } });
  const order = db.prepare("INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, local_date) VALUES ('glow', ?, ?, ?, ?, 'unfulfilled', '2026-10-26')");
  let batch: [string, string, number, string][] = [];
  const shopify = vi.fn(async () => {
    switchToReal(db, 'glow');
    for (const o of batch) order.run(...o);
    batch = [];
  });
  const seen: string[] = [];
  const off = subscribe((m) => m.type === 'event' && seen.push(`${m.event.id} ${m.event.amount}`));
  const stop = startSyncLoop(db, key, { everyMs: 1000, staleMs: 60_000, fastMs: 60_000, syncers: { shopify, meta_ads: shopify } });

  batch = [['1001', '2026-10-26T11:50:00Z', 40, 'paid']]; // first real sync: history, not news
  await vi.advanceTimersByTimeAsync(0);
  expect(seen).toEqual([]);

  batch = [['1002', '2026-10-26T09:00:00Z', 15, 'paid'], ['1003', '2026-10-26T11:59:00Z', 25, 'paid'], ['1004', '2026-10-26T11:59:30Z', 30, 'refunded']];
  await vi.advanceTimersByTimeAsync(61_000);
  expect(seen).toEqual(['order:glow:1003 25']);
  expect(db.prepare("SELECT count(*) AS n FROM events WHERE id LIKE 'order:glow:%'").get()).toEqual({ n: 1 });

  await vi.advanceTimersByTimeAsync(61_000); // nothing new: nothing repeated
  expect(seen).toHaveLength(1);
  stop();
  off();
});

test('Shopify is polled every couple of minutes for new orders; ad networks wait the longer interval', async () => {
  vi.useFakeTimers({ now: new Date('2026-10-26T12:00:00Z') });
  const db = openDb();
  seedDemo(db, '2026-10-26');
  const key = randomBytes(32);
  saveIntegration(db, key, { kind: 'shopify', storeId: 'glow', values: { shopDomain: 'glow.myshopify.com', accessToken: 't' } });
  saveIntegration(db, key, { kind: 'meta_ads', storeId: 'glow', values: { adAccountId: 'act_1', accessToken: 't' } });
  const shopify = vi.fn(async () => {});
  const meta_ads = vi.fn(async () => {});
  const stop = startSyncLoop(db, key, { everyMs: 30_000, staleMs: 600_000, fastMs: 120_000, syncers: { shopify, meta_ads } });
  await vi.advanceTimersByTimeAsync(5 * 60_000);
  expect([shopify.mock.calls.length, meta_ads.mock.calls.length]).toEqual([3, 1]);
  await vi.advanceTimersByTimeAsync(6 * 60_000);
  expect([shopify.mock.calls.length, meta_ads.mock.calls.length]).toEqual([5, 2]);
  stop();
});
