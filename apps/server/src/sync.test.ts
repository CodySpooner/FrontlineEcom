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

test("a connected store's refunds reach the live feed when a sync brings them: full, partial and refund lines", async () => {
  vi.useFakeTimers({ now: new Date('2026-10-26T12:00:00Z') });
  const db = openDb();
  seedDemo(db, '2026-10-26');
  switchToReal(db, 'glow');
  const key = randomBytes(32);
  saveIntegration(db, key, { kind: 'shopify', storeId: 'glow', values: { shopDomain: 'glow.myshopify.com', accessToken: 't' } });
  const order = db.prepare("INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, local_date) VALUES ('glow', ?, ?, ?, 'paid', 'unfulfilled', '2026-10-25')");
  order.run('2001', '2026-10-25T10:00:00Z', 40);
  order.run('2002', '2026-10-25T11:00:00Z', 60);
  order.run('2003', '2026-10-25T12:00:00Z', 20);
  order.run('1999', '2026-09-01T12:00:00Z', 80);
  let change = () => {};
  const shopify = vi.fn(async () => change());
  const seen: string[] = [];
  const off = subscribe((m) => m.type === 'event' && m.event.type === 'refund' && seen.push(`${m.event.id.split(':').slice(0, 3).join(':')} ${m.event.amount}`));
  const stop = startSyncLoop(db, key, { everyMs: 1000, staleMs: 60_000, fastMs: 60_000, syncers: { shopify } });
  await vi.advanceTimersByTimeAsync(0);
  expect(seen).toEqual([]);

  change = () => {
    db.prepare("UPDATE orders SET status = 'refunded', total = 0 WHERE store_id = 'glow' AND id = '2001'").run(); // in full
    db.prepare("UPDATE orders SET total = 45 WHERE store_id = 'glow' AND id = '2002'").run(); // 5 back: the total shrinks
    db.prepare("INSERT INTO amazon_refunds (store_id, id, order_id, amount, tax) VALUES ('glow', 'tt-R9', '2003', 7.4, 0.6)").run(); // a refund line
    db.prepare("UPDATE orders SET status = 'refunded' WHERE store_id = 'glow' AND id = '1999'").run(); // over a month old: not news
  };
  await vi.advanceTimersByTimeAsync(61_000);
  expect(seen.sort()).toEqual(['refund:glow:2001 40', 'refund:glow:2002 15', 'refund:glow:2003 8']);
  expect(db.prepare("SELECT count(*) AS n FROM events WHERE type = 'refund' AND store_id = 'glow'").get()).toEqual({ n: 3 });

  change = () => {};
  await vi.advanceTimersByTimeAsync(61_000); // nothing new: nothing repeated
  expect(seen).toHaveLength(3);

  change = () => {
    // The shop switched currency: every total is re-priced in it, and nothing was refunded.
    db.prepare("UPDATE stores SET currency = 'GBP' WHERE id = 'glow'").run();
    db.prepare("UPDATE orders SET total = total * 0.8 WHERE store_id = 'glow'").run();
  };
  await vi.advanceTimersByTimeAsync(61_000);
  expect(seen).toHaveLength(3);
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

test("an order older than the store's newest still reaches the feed when it's new to the store: paid later, or another platform's", async () => {
  vi.useFakeTimers({ now: new Date('2026-10-26T12:00:00Z') });
  const db = openDb();
  seedDemo(db, '2026-10-26');
  switchToReal(db, 'glow');
  const key = randomBytes(32);
  saveIntegration(db, key, { kind: 'shopify', storeId: 'glow', values: { shopDomain: 'glow.myshopify.com', accessToken: 't' } });
  const order = db.prepare("INSERT OR REPLACE INTO orders (store_id, id, created_at, total, status, fulfillment_status, local_date) VALUES ('glow', ?, ?, ?, 'paid', 'unfulfilled', '2026-10-26')");
  let batch: [string, string, number][] = [['5001', '2026-10-26T11:59:30Z', 30]]; // the loop's first sync runs at once
  const shopify = vi.fn(async () => {
    for (const o of batch) order.run(...o);
    batch = [];
  });
  const seen: string[] = [];
  const off = subscribe((m) => m.type === 'event' && m.event.type === 'order' && seen.push(m.event.id));
  const stop = startSyncLoop(db, key, { everyMs: 1000, staleMs: 60_000, fastMs: 60_000, syncers: { shopify } });
  await vi.advanceTimersByTimeAsync(0);
  batch = [['tt-9', '2026-10-26T11:58:00Z', 20]]; // placed before 5001, here only now (paid later, or a slower platform's sync)
  await vi.advanceTimersByTimeAsync(61_000);
  expect(seen).toEqual(['order:glow:5001', 'order:glow:tt-9']);
  stop();
  off();
});

test("a cancelled order with a refund line is one refund of its value, not two", async () => {
  vi.useFakeTimers({ now: new Date('2026-10-26T12:00:00Z') });
  const db = openDb();
  seedDemo(db, '2026-10-26');
  switchToReal(db, 'glow');
  const key = randomBytes(32);
  saveIntegration(db, key, { kind: 'shopify', storeId: 'glow', values: { shopDomain: 'glow.myshopify.com', accessToken: 't' } });
  db.prepare("INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, local_date) VALUES ('glow', 'tt-5', '2026-10-25T10:00:00Z', 50, 'paid', 'unfulfilled', '2026-10-25')").run();
  let change = () => {};
  const seen: string[] = [];
  const off = subscribe((m) => m.type === 'event' && m.event.type === 'refund' && seen.push(`${m.event.amount}`));
  const stop = startSyncLoop(db, key, { everyMs: 1000, staleMs: 60_000, fastMs: 60_000, syncers: { shopify: vi.fn(async () => change()) } });
  await vi.advanceTimersByTimeAsync(0);
  change = () => {
    db.prepare("UPDATE orders SET status = 'refunded' WHERE store_id = 'glow' AND id = 'tt-5'").run();
    db.prepare("INSERT INTO amazon_refunds (store_id, id, order_id, amount, tax) VALUES ('glow', 'tt-R5', 'tt-5', 50, 0)").run();
  };
  await vi.advanceTimersByTimeAsync(61_000);
  expect(seen).toEqual(['50']);
  stop();
  off();
});
