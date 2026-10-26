import { getAgent, listMemory, once } from '@frontline/agents';
import type { ApprovalRequest } from '@frontline/shared';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { addDays, localDate } from '../dates';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { addProducts } from './agents-actions';

let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  app = createApp(db);
});

const approval = (storeId: string, titles: string[]): ApprovalRequest =>
  ({
    id: `a-${storeId}`, storeId, agentId: `${storeId}:product_hunter`, title: 'Add products', reason: 'r', status: 'approved', createdAt: '',
    action: { kind: 'store.add_products', payload: { products: titles.map((title) => ({ title, price: 20, cost: 6 })) } },
  }) as ApprovalRequest;
function sell(storeId: string, productId: string, units: number, day: string) {
  for (let n = 0; n < units; n++) {
    const id = `${productId}-${day}-o${n}`;
    db.prepare(`INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, local_date) VALUES (?, ?, ?, 20, 'paid', 'delivered', ?)`).run(storeId, id, `${day}T12:00:00Z`, day);
    db.prepare('INSERT INTO order_items (store_id, order_id, product_id, quantity, revenue, cost) VALUES (?, ?, ?, 1, 20, 6)').run(storeId, id, productId);
  }
}
const outcomes = (storeId: string) => listMemory(db, storeId).filter((m) => m.tags.includes('product')).map((m) => m.text).sort();

test('products added on a real store are judged on their first 14 days of sales', async () => {
  db.prepare(`UPDATE stores SET demo = 0, connected = 1 WHERE id = 'peak'`).run();
  once(db, 'activate:peak', new Date('2020-01-01')); // live long before
  await addProducts(db, approval('peak', ['Smart Jump Rope', 'Grip Socks']), () => undefined, async () => [{ id: '901', title: 'Smart Jump Rope' }, { id: '902', title: 'Grip Socks' }]);
  await app.request('/api/achievements');
  expect(outcomes('peak')).toEqual([]); // too early

  const added = addDays(localDate(), -20);
  db.prepare(`UPDATE product_tests SET added_on = ?`).run(added);
  sell('peak', '901', 12, addDays(added, 3));
  sell('peak', '902', 2, addDays(added, 5));
  sell('peak', '902', 30, addDays(added, 16)); // after the 14-day window
  const xp = () => getAgent(db, 'peak:product_hunter')!.xp;
  const before = xp();
  await app.request('/api/achievements');
  await app.request('/api/achievements');

  expect(outcomes('peak')).toEqual([
    '"Grip Socks" did not take off: 2 units, 40 USD revenue, 28 USD gross profit in its first 14 days.',
    '"Smart Jump Rope" sold: 12 units, 240 USD revenue, 168 USD gross profit in its first 14 days.',
  ]);
  expect(xp()).toBe(before + 50);
});

test("products from a store's demo phase aren't judged once it's live; one never put on sale isn't called a flop", async () => {
  await addProducts(db, approval('peak', ['Demo Band']), () => undefined, async () => []); // demo phase: a local draft
  db.prepare(`UPDATE stores SET demo = 0, connected = 1 WHERE id = 'peak'`).run();
  db.prepare(`UPDATE product_tests SET added_on = ?`).run(addDays(localDate(), -20));
  const judged = () => db.prepare('SELECT judged_at FROM product_tests').get()?.judged_at;
  await app.request('/api/achievements'); // synced, but the squad hasn't seen it live yet (e.g. the hourly check ran first)
  expect(judged()).toBeNull();
  once(db, 'activate:peak'); // went live after it was added
  await app.request('/api/achievements');
  expect(outcomes('peak')).toEqual([]);
  expect(judged()).toBeNull(); // left alone

  db.prepare(`UPDATE done_once SET at = '2020-01-01' WHERE ref = 'activate:peak'`).run(); // as if added after going live
  await app.request('/api/achievements'); // still a draft with no sales: closed quietly, not "did not take off"
  expect(outcomes('peak')).toEqual([]);
  expect(judged()).toEqual(expect.any(String));
});

test('a product archived after selling nothing is a flop the squad learns from', async () => {
  db.prepare(`UPDATE stores SET demo = 0, connected = 1 WHERE id = 'peak'`).run();
  once(db, 'activate:peak', new Date('2020-01-01')); // live long before
  await addProducts(db, approval('peak', ['Ab Roller']), () => undefined, async () => [{ id: '903', title: 'Ab Roller' }]);
  db.prepare(`UPDATE product_tests SET added_on = ?`).run(addDays(localDate(), -20));
  db.prepare(`UPDATE products SET status = 'archived' WHERE store_id = 'peak' AND id = '903'`).run();
  await app.request('/api/achievements');
  expect(outcomes('peak')).toEqual(['"Ab Roller" did not take off: 0 units, 0 USD revenue, 0 USD gross profit in its first 14 days.']);
});

test('demo stores have no real line items, so their products are never judged', async () => {
  await addProducts(db, approval('glow', ['Ice Roller']), () => undefined, async () => []);
  db.prepare(`UPDATE product_tests SET added_on = ?`).run(addDays(localDate(), -20));
  await app.request('/api/achievements');
  expect(outcomes('glow')).toEqual([]);
  expect(db.prepare('SELECT judged_at FROM product_tests').get()).toEqual({ judged_at: null });
});
