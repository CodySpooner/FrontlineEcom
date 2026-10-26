import { EventEmitter } from 'node:events';
import type { LiveMessage, StoreEvent } from '@frontline/shared';
import { tx, type Db } from './db';
import { advanceDemoDay, demoEvent } from './demo';

// ponytail: one in-process bus per server; every /api/live socket subscribes to it.
const bus = new EventEmitter().setMaxListeners(0);

export const publish = (m: LiveMessage) => bus.emit('live', m);

export function subscribe(fn: (m: LiveMessage) => void) {
  bus.on('live', fn);
  return () => void bus.off('live', fn);
}

export function insertEvent(db: Db, e: StoreEvent) {
  db.prepare('INSERT INTO events (id, store_id, type, amount, at) VALUES (?, ?, ?, ?, ?)').run(e.id, e.storeId, e.type, e.amount, e.at);
}

/** Newest first. */
export function listEvents(db: Db, storeIds: string[], limit: number): StoreEvent[] {
  if (!storeIds.length) return [];
  return db
    .prepare(`SELECT id, store_id AS storeId, type, amount, at FROM events WHERE store_id IN (${storeIds.map(() => '?').join(',')}) ORDER BY at DESC LIMIT ?`)
    .all(...storeIds, limit) as unknown as StoreEvent[];
}

const demoStoreIds = (db: Db) => db.prepare('SELECT id FROM stores WHERE demo = 1').all().map((r) => String(r.id));

/**
 * Demo live feed: backfills the last 15 minutes if the feed went quiet, then emits an event for a random demo store
 * every `minMs`–`maxMs`. Events older than 7 days are pruned at start and on every tick (the tray app runs for weeks).
 * Returns stop().
 */
export function startDemoEmitter(db: Db, { minMs = 8000, maxMs = 25000 } = {}) {
  const prune = (now: number) => db.prepare('DELETE FROM events WHERE at < ?').run(new Date(now - 7 * 86400000).toISOString());
  const now = Date.now();
  prune(now);
  const newest = db.prepare('SELECT MAX(at) AS at FROM events').get()?.at as string | null;
  if (!newest || Date.parse(newest) < now - 10 * 60000) {
    for (let i = 8; i >= 1; i--) {
      const e = demoEvent(demoStoreIds(db), Math.random, new Date(now - i * 110000 - Math.random() * 60000));
      if (e) insertEvent(db, e);
    }
  }
  let timer: ReturnType<typeof setTimeout>;
  const tick = () => {
    const now = new Date();
    prune(now.getTime());
    for (const o of tx(db, () => demoStoreIds(db).flatMap((id) => advanceDemoDay(db, id, now)))) {
      insertEvent(db, o);
      publish({ type: 'event', event: o });
    }
    const e = demoEvent(demoStoreIds(db), Math.random, now);
    if (e) {
      insertEvent(db, e);
      publish({ type: 'event', event: e });
    }
    timer = setTimeout(tick, minMs + Math.random() * (maxMs - minMs));
  };
  timer = setTimeout(tick, minMs);
  return () => clearTimeout(timer);
}
