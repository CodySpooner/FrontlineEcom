import { listFlowDrafts, listOrderIssues, listPageDrafts } from '@frontline/agents';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { addDays, localDate } from '../dates';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { runManager } from './agents';

let db: Db;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  createApp(db);
});
const go = async (agentId: string, task: string) => {
  const m = runManager(db);
  const run = m.start(agentId, task);
  if (typeof run === 'string') throw new Error(run);
  await m.idle();
};

test('demo runs do one real, non-blocking piece of each role’s work', async () => {
  const productId = String(db.prepare(`SELECT id FROM products WHERE store_id = 'glow' ORDER BY price LIMIT 1`).get()?.id);
  await go('glow:store_developer', `Draft the product pages for: Cheap thing (productId ${productId}).`);
  await go('glow:store_developer', `Draft the product pages for: Cheap thing (productId ${productId}).`);
  expect(listPageDrafts(db, { storeIds: ['glow'] }).map((d) => [d.productId, d.status])).toEqual([[productId, 'draft']]);

  const orderId = String(db.prepare(`SELECT id FROM orders WHERE store_id = 'glow' ORDER BY created_at LIMIT 1`).get()?.id);
  db.prepare(`UPDATE orders SET fulfillment_status = 'unfulfilled', local_date = ? WHERE store_id = 'glow' AND id = ?`).run(addDays(localDate(), -9), orderId);
  await go('glow:operations', 'Daily order check');
  expect(listOrderIssues(db, { storeIds: ['glow'] }).map((i) => [i.orderId, i.kind])).toContainEqual([orderId, 'late']);
  db.prepare(`UPDATE order_issues SET status = 'resolved' WHERE order_id = ?`).run(orderId);
  await go('glow:operations', 'Daily order check');
  expect(listOrderIssues(db, { storeIds: ['glow'], status: 'open' }).map((i) => i.orderId)).not.toContain(orderId); // resolved stays resolved

  await go('glow:email_sms', 'Plan retention flows');
  expect(listFlowDrafts(db, { storeIds: ['glow'] }).map((f) => f.name)).toEqual(['Checkout abandonment']);

  await go('glow:ad_strategist', 'Review campaigns');
  expect(db.prepare('SELECT count(*) AS n FROM approvals WHERE run_id IS NOT NULL').get()?.n).toBe(0); // demo runs never wait on the owner
});
