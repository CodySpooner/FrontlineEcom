import { fakeEngine, getAgent, listMemory, runAgent, writeMemory, type FakeStep } from '@frontline/agents';
import type { AgentEvent, ApprovalRequest } from '@frontline/shared';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { decide } from '../approvals';
import { addDays, localDate } from '../dates';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { getStore } from '../stores';
import { toolEnv } from './agents';
import { applyPriceChange } from './agents-actions';

let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  app = createApp(db);
});
const tick = () => new Promise((r) => setImmediate(r));
async function run(storeId: string, steps: FakeStep[]) {
  const agent = getAgent(db, `${storeId}:market_analyst`)!;
  const out: string[] = [];
  for await (const e of runAgent({ agent, store: getStore(db, storeId)!, task: 't', env: toolEnv(db) }, fakeEngine(() => steps)) as AsyncIterable<AgentEvent>) {
    if (e.type === 'approval_request' && e.approval.status === 'pending') decide(db, e.approval.id, 'approve');
    if (e.type === 'tool_result') out.push(e.output);
  }
  await tick();
  return out;
}
const price = (productId: string, newPrice: number, extra: object = {}): FakeStep => ({
  call: 'propose_price_change',
  input: { productId, newPrice, evidence: 'Converts 3.1% at current price; competitors sell at $34-39', ...extra },
});

test('a price test is checked, approved and applied to a demo store', async () => {
  const p = db.prepare(`SELECT id, title, price, cost FROM products WHERE store_id = 'glow' AND cost IS NOT NULL ORDER BY price DESC LIMIT 1`).get()!;
  const [id, from, cost] = [String(p.id), Number(p.price), Number(p.cost)];
  const to = Math.round(from * 1.1 * 100) / 100;
  const out = await run('glow', [price('nope', 10), price(id, cost), price(id, from * 1.5), price(id, from), price(id, to, { compareAt: to })]);
  expect(out.slice(0, 5)).toEqual([
    'No product nope in this store. Use list_products for ids.',
    `Not sent: $${cost} is at or below the unit cost ($${cost}).`,
    'Not sent: test within ±30% of the current price, one step at a time.',
    `$${from} is already the price.`,
    'compareAt must be above the new price.',
  ]);

  const [applied] = await run('glow', [price(id, to)]);
  expect(applied).toBe(`Approved by the owner: Price ${String(p.title)} $${from} → $${to}. It will be applied to the store and judged on 14 days of sales after vs before.`);
  expect(Number(db.prepare(`SELECT price FROM products WHERE store_id = 'glow' AND id = ?`).get(id)?.price)).toBe(to);
  expect(db.prepare('SELECT product_id, from_price, to_price, changed_on FROM price_tests').get()).toEqual({ product_id: id, from_price: from, to_price: to, changed_on: localDate() });
  expect(await run('glow', [price(id, from)])).toEqual([`Not sent: a price test on this product has been running since ${localDate()}; it is judged after 14 days of sales.`]);

  db.prepare(`UPDATE stores SET currency = 'EUR' WHERE id = 'glow'`).run(); // the owner reads amounts in the store's currency
  expect(await run('glow', [price(id, cost)])).toEqual([`Not sent: ${cost} EUR is at or below the unit cost (${cost} EUR).`]);
});

test('on a real store a price test is judged on gross profit 14 days before vs after, once', async () => {
  db.prepare(`UPDATE stores SET demo = 0, connected = 1 WHERE id = 'peak'`).run();
  const day = addDays(localDate(), -20);
  db.prepare(
    `INSERT INTO approvals (id, store_id, agent_id, run_id, title, reason, action_json, status, created_at, decided_at) VALUES ('a-price', 'peak', 'peak:market_analyst', 'run-price', 't', 'r', '{"kind":"store.set_price"}', 'approved', ?, ?)`,
  ).run(`${day}T09:00:00Z`, `${day}T10:00:00Z`);
  db.prepare(`INSERT INTO price_tests (approval_id, store_id, product_id, agent_id, title, from_price, to_price, changed_on) VALUES ('a-price', 'peak', '77', 'peak:market_analyst', 'Grip Socks', 20, 25, ?)`).run(day);
  writeMemory(db, { storeId: 'peak', agentId: 'peak:market_analyst', kind: 'learning', text: 'Grip Socks are underpriced vs rivals', confidence: 0.6, runId: 'run-price' });
  const sell = (n: number, on: string, price: number) => {
    for (let k = 0; k < n; k++) {
      const id = `o-${on}-${k}`;
      db.prepare(`INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, local_date) VALUES ('peak', ?, ?, ?, 'paid', 'delivered', ?)`).run(id, `${on}T12:00:00Z`, price, on);
      db.prepare(`INSERT INTO order_items (store_id, order_id, product_id, quantity, revenue, cost) VALUES ('peak', ?, '77', 1, ?, 6)`).run(id, price);
    }
  };
  sell(10, addDays(day, -5), 20); // 140 gross profit before
  sell(9, addDays(day, 5), 25); // 171 after
  const xp = () => getAgent(db, 'peak:market_analyst')!.xp;
  const before = xp();
  await app.request('/api/achievements');
  await app.request('/api/achievements');

  const texts = listMemory(db, 'peak').filter((m) => m.tags.includes('pricing')).map((m) => m.text);
  expect(texts).toEqual(['Pricing "Grip Socks" $20 → $25 worked: gross profit 140 USD → 171 USD, 10 → 9 units (14 days before vs after).']);
  expect(xp()).toBe(before + 50);
  expect(listMemory(db, 'peak').find((m) => m.text === 'Grip Socks are underpriced vs rivals')?.confidence).toBe(0.7);
  expect(db.prepare(`SELECT body FROM notifications WHERE title = 'Measured win: Market Analyst'`).all()).toEqual([{ body: texts[0] }]);
});

test('connected stores get the price on Shopify; other platforms and write errors tell the owner and start no test', async () => {
  const p = db.prepare(`SELECT id, price FROM products WHERE store_id = 'peak' ORDER BY price DESC LIMIT 1`).get()!;
  const [id, from] = [String(p.id), Number(p.price)];
  const to = Math.round(from * 1.1 * 100) / 100;
  db.prepare(`UPDATE stores SET connected = 1, platform = 'woocommerce' WHERE id = 'peak'`).run();
  await run('peak', [price(id, to)]);
  expect(db.prepare(`SELECT body FROM notifications WHERE kind = 'error'`).get()?.body).toBe('Only Shopify stores are updated automatically so far. Change it by hand if you still want the test.');
  expect(db.prepare('SELECT count(*) AS n FROM price_tests').get()?.n).toBe(0);

  db.prepare(`UPDATE stores SET platform = 'shopify' WHERE id = 'peak'`).run();
  const approval = { id: 'a1', storeId: 'peak', agentId: 'peak:market_analyst', title: 't', reason: 'r', status: 'approved', createdAt: '', action: { kind: 'store.set_price', payload: { productId: id, title: 'T', from, to, compareAt: 99 } } } as ApprovalRequest;
  const writes: unknown[] = [];
  await applyPriceChange(db, approval, async (...args) => void writes.push(args));
  expect(writes).toEqual([['peak', id, { price: to, compareAt: 99 }]]);
  expect(db.prepare('SELECT approval_id, to_price FROM price_tests').all()).toEqual([{ approval_id: 'a1', to_price: to }]);
});
