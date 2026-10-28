import { Hono } from 'hono';
import { expect, test } from 'vitest';
import { createApp } from '../app';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { scopeOf, storeOf, visible } from './scope';

const setup = () => {
  const db = openDb();
  seedDemo(db);
  const app = new Hono()
    .get('/scope', (c) => {
      const s = scopeOf(c, db);
      return s instanceof Response ? s : c.json({ store: s.store?.id ?? null });
    })
    .get('/own', (c) => {
      const s = storeOf(c, db);
      return s instanceof Response ? s : c.json({ store: s.id });
    });
  return { db, app };
};

test('the scope is a known store, or All stores; an unknown store is a 404 and private rows need a store', async () => {
  const { app } = setup();
  const get = async (path: string) => {
    const r = await app.request(path);
    return [r.status, await r.json()];
  };
  expect(await get('/scope?store=pawsome')).toEqual([200, { store: 'pawsome' }]);
  expect(await get('/scope')).toEqual([200, { store: null }]);
  expect(await get('/scope?store=all')).toEqual([200, { store: null }]);
  expect(await get('/scope?store=nope')).toEqual([404, { error: 'store not found' }]);
  expect(await get('/own?store=glow')).toEqual([200, { store: 'glow' }]);
  expect((await get('/own'))[0]).toBe(400);
});

test("a store reads shared rows and its own private rows, never another store's; All stores reads every row", () => {
  const { db } = setup();
  const at = '2026-10-28';
  db.exec(`INSERT INTO pr_products (id, title, created_at, updated_at) VALUES ('p', 'Cup', '${at}', '${at}');
    INSERT INTO pr_listings (id, product_id, store_id, source, source_ref, title, origin, first_seen_at, last_seen_at) VALUES
      ('shared', 'p', NULL, 'cj', '1', 'Cup', 'ingest', '${at}', '${at}'),
      ('mine', 'p', 'pawsome', 'link', 'a', 'Cup', 'owner_link', '${at}', '${at}'),
      ('theirs', 'p', 'glow', 'link', 'a', 'Cup', 'owner_link', '${at}', '${at}');`);
  const ids = (store: string | null) => {
    const v = visible(store);
    return db.prepare(`SELECT id FROM pr_listings WHERE ${v.sql} ORDER BY id`).all(...v.params).map((r) => r.id);
  };
  expect(ids('pawsome')).toEqual(['mine', 'shared']);
  expect(ids('glow')).toEqual(['shared', 'theirs']);
  expect(ids(null)).toEqual(['mine', 'shared', 'theirs']);
});

test('every /api/pr route sits behind the request guard: a body over 1 MB is refused unread', async () => {
  const db = openDb();
  const big = 'x'.repeat(1_048_576 + 10);
  const r = await createApp(db).request('/api/pr/anything', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(big.length) }, body: big });
  expect(r.status).toBe(413);
});
