import { expect, test } from 'vitest';
import { createApp } from '../app';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { seedResearch } from '../research';
import { toolEnv } from '../routes/agents';
import { importLegacy, LEGACY_SOURCE } from './legacy';
import { setWatch } from './watches';

const at = '2026-10-01T00:00:00.000Z';
const setup = () => {
  const db = openDb();
  seedDemo(db);
  seedResearch(db); // the sample catalog: never enters pr_ tables unless the owner saved a row
  const sample = String(db.prepare(`SELECT id FROM research_products WHERE id NOT LIKE 'find-%' ORDER BY id LIMIT 1`).get()!.id);
  db.exec(`INSERT INTO research_products (id, title, category, niche, source, cost, price, compare_at, trend, competition, shipping_days) VALUES
      ('find-a', 'Paw cup', 'Grooming', 'pet', 'tiktok', 3, 12, 0, 40, 30, 9),
      ('find-b', 'Lick mat', 'Feeding', 'pet', 'amazon', 2, 9, 14, 25, 50, 12);
    INSERT INTO product_lists (id, name, created_at) VALUES ('saved', 'Saved', '${at}'), ('gifts', 'Gift ideas', '${at}');
    INSERT INTO product_list_items (list_id, product_id, added_at) VALUES ('saved', 'find-a', '${at}'), ('gifts', 'find-a', '${at}'), ('saved', '${sample}', '${at}');`);
  return { db, sample };
};
const listing = (db: ReturnType<typeof openDb>, ref: string) => db.prepare('SELECT * FROM pr_listings WHERE source = ? AND source_ref = ?').get(LEGACY_SOURCE, ref);
const watches = (db: ReturnType<typeof openDb>) =>
  db.prepare('SELECT w.store_id, w.list_name, l.source_ref FROM pr_watches w JOIN pr_listings l ON l.id = w.target_id ORDER BY w.list_name, l.source_ref').all().map((r) => ({ ...r }));

test("the owner's lists become all-stores watches with their names; every find becomes an agent_find listing without numbers", () => {
  const { db, sample } = setup();
  importLegacy(db);
  expect(watches(db)).toEqual([
    { store_id: null, list_name: 'Gift ideas', source_ref: 'find-a' },
    ...[{ store_id: null, list_name: 'Saved', source_ref: 'find-a' }, { store_id: null, list_name: 'Saved', source_ref: sample }].sort((x, y) => (x.source_ref < y.source_ref ? -1 : 1)),
  ]);
  expect(db.prepare('SELECT count(*) AS n FROM product_list_items').get()?.n).toBe(3); // the legacy lists stay as they were
  const find = listing(db, 'find-b')!; // not saved, still a find
  expect({ origin: find.origin, store: find.store_id, title: find.title, category: find.category }).toEqual({ origin: 'agent_find', store: null, title: 'Lick mat', category: 'Feeding' });
  expect(JSON.parse(String(find.transform_json)).estimates).toMatchObject({ cost: 2, price: 9, trend: 25 }); // kept aside, labelled in the panel
  expect(db.prepare('SELECT count(*) AS n FROM pr_offers').get()?.n).toBe(0);
  expect(db.prepare('SELECT count(*) AS n FROM pr_signals').get()?.n).toBe(0);
  expect(db.prepare('SELECT count(*) AS n FROM pr_product_facts').get()?.n).toBe(0);
  // Sample rows: only the saved one enters, as sample data.
  expect(listing(db, sample)?.origin).toBe('legacy_sample');
  expect(db.prepare(`SELECT count(*) AS n FROM pr_listings WHERE origin = 'legacy_sample'`).get()?.n).toBe(1);
});

test('an item the owner un-watches stays un-watched when the app starts again; watching mirrors into "Saved"', () => {
  const { db } = setup();
  importLegacy(db);
  const a = String(listing(db, 'find-a')!.id);
  const inSaved = () => !!db.prepare(`SELECT 1 FROM product_list_items i JOIN product_lists l ON l.id = i.list_id WHERE l.name = 'Saved' AND i.product_id = 'find-a'`).get();
  setWatch(db, { storeId: null, kind: 'listing', targetId: a, on: false });
  expect(inSaved()).toBe(false);
  importLegacy(db);
  expect(watches(db).map((w) => w.source_ref)).not.toContain('find-a');
  setWatch(db, { storeId: 'pawsome', kind: 'listing', targetId: a, on: true });
  expect(inSaved()).toBe(true); // the agents' research_feed sees it as saved by the owner
  // Still watched in another scope: stays in Saved until no scope watches it.
  setWatch(db, { storeId: null, kind: 'listing', targetId: a, on: true });
  setWatch(db, { storeId: 'pawsome', kind: 'listing', targetId: a, on: false });
  expect(inSaved()).toBe(true);
});

test("a find from a run on Claude or Codex becomes a listing of the run's store; a demo-engine run's find is not mirrored", async () => {
  const db = openDb();
  seedDemo(db);
  importLegacy(db);
  db.exec(`INSERT INTO agent_runs (id, store_id, agent_id, task, status, created_at, runtime) VALUES
    ('live', 'pawsome', 'pawsome:product_hunter', 'Find', 'running', '${at}', 'claude'),
    ('demo', 'pawsome', 'pawsome:product_hunter', 'Find', 'running', '${at}', 'demo'),
    ('seat', 'pawsome', 'pawsome:product_hunter', 'Find', 'running', '${at}', NULL);`);
  const env = toolEnv(db);
  const find = { title: 'Cat window hammock', category: 'Furniture', niche: 'pet' as const, source: 'amazon' as const, cost: 6, price: 25, compareAt: 0, trend: 10, competition: 40, shippingDays: 10 };
  const demo = await env.recordFind!({ ...find, title: 'Demo bundle' }, 'demo');
  await env.recordFind!({ ...find, title: 'Seat default find' }, 'seat');
  expect(listing(db, demo.id)).toBeUndefined();
  expect(db.prepare('SELECT count(*) AS n FROM pr_listings').get()?.n).toBe(0);
  const live = await env.recordFind!(find, 'live');
  expect({ ...db.prepare('SELECT store_id, origin, title FROM pr_listings WHERE source_ref = ?').get(live.id) }).toEqual({ store_id: 'pawsome', origin: 'agent_find', title: 'Cat window hammock' });
  await env.recordFind!({ ...find, price: 27 }, 'live'); // the daily scan finds it again: one listing
  expect(db.prepare('SELECT count(*) AS n FROM pr_listings').get()?.n).toBe(1);
});

test('the legacy /api/research endpoints keep answering (agent tools call them in process)', async () => {
  const { db } = setup();
  importLegacy(db);
  const app = createApp(db);
  expect((await app.request('/api/research?limit=5')).status).toBe(200);
  expect((await app.request('/api/research/lists')).status).toBe(200);
  expect((await app.request('/api/research/find-a')).status).toBe(200);
});
