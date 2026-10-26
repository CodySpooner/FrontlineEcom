import type { AddressInfo } from 'node:net';
import { expect, test } from 'vitest';
import type { LiveMessage, StoreEvent } from '@frontline/shared';
import { createApp, startServer } from './app';
import { openDb } from './db';
import { demoEvent, seedDemo } from './demo';
import { insertEvent, publish, startDemoEmitter } from './live';

const seeded = () => {
  const db = openDb();
  seedDemo(db);
  return db;
};

test('demoEvent picks a known store, a known type and a positive amount', () => {
  const ids = ['pawsome', 'glow', 'peak'];
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const events = Array.from({ length: 500 }, () => demoEvent(ids, rand, new Date('2026-10-26T12:00:00Z'))!);
  expect(new Set(events.map((e) => e.storeId))).toEqual(new Set(ids));
  expect(new Set(events.map((e) => e.type))).toEqual(new Set(['add_to_cart', 'checkout_started', 'order', 'refund']));
  expect(events.every((e) => e.amount > 0 && e.at === '2026-10-26T12:00:00.000Z')).toBe(true);
  // bigger stores get more events
  const n = (id: string) => events.filter((e) => e.storeId === id).length;
  expect(n('pawsome')).toBeGreaterThan(n('peak'));
  expect(demoEvent([], rand, new Date())).toBeUndefined();
});

test('GET /api/events returns newest first, filtered by store, limited', async () => {
  const db = seeded();
  const ev = (id: string, storeId: string, at: string): StoreEvent => ({ id, storeId, type: 'order', amount: 10, at });
  insertEvent(db, ev('1', 'pawsome', '2026-10-26T10:00:00.000Z'));
  insertEvent(db, ev('2', 'glow', '2026-10-26T11:00:00.000Z'));
  insertEvent(db, ev('3', 'pawsome', '2026-10-26T12:00:00.000Z'));
  const app = createApp(db);
  const get = async (q: string) => ((await (await app.request(`/api/events${q}`)).json()) as StoreEvent[]).map((e) => e.id);
  expect(await get('')).toEqual(['3', '2', '1']);
  expect(await get('?stores=pawsome')).toEqual(['3', '1']);
  expect(await get('?limit=1')).toEqual(['3']);
});

test('demo emitter backfills a quiet feed so the dashboard is never empty', () => {
  const db = seeded();
  const stop = startDemoEmitter(db, { minMs: 60000, maxMs: 60000 });
  stop();
  expect(db.prepare('SELECT count(*) AS n FROM events').get()?.n).toBe(8);
});

test('/api/live pushes published messages to connected sockets', async () => {
  const server = startServer(seeded(), 0);
  await new Promise((r) => server.once('listening', r));
  const ws = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/live`);
  try {
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    const got = new Promise<LiveMessage>((r) => (ws.onmessage = (m) => r(JSON.parse(String(m.data)))));
    const msg: LiveMessage = { type: 'event', event: { id: 'x', storeId: 'glow', type: 'order', amount: 42, at: '2026-10-26T12:00:00.000Z' } };
    publish(msg);
    expect(await got).toEqual(msg);
  } finally {
    ws.close();
    server.close();
  }
});
