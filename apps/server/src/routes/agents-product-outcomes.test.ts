import { getAgent, listMemory } from '@frontline/agents';
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

test('demo stores have no real line items, so their products are never judged', async () => {
  await addProducts(db, approval('glow', ['Ice Roller']), () => undefined, async () => []);
  db.prepare(`UPDATE product_tests SET added_on = ?`).run(addDays(localDate(), -20));
  await app.request('/api/achievements');
  expect(outcomes('glow')).toEqual([]);
  expect(db.prepare('SELECT judged_at FROM product_tests').get()).toEqual({ judged_at: null });
});
