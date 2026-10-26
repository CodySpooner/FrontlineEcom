import { fakeEngine, getAgent, listMemory, runAgent, writeMemory, type FakeStep } from '@frontline/agents';
import type { AgentEvent, ApprovalRequest } from '@frontline/shared';
import { beforeEach, expect, test, vi } from 'vitest';
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
  const achievements = (await (await app.request('/api/achievements')).json()) as { id: string; unlockedAt?: string }[];
  expect(achievements.find((a) => a.id === 'first_win')?.unlockedAt).toEqual(expect.any(String));
});

test("connected stores get the price on Shopify or WooCommerce; other platforms aren't asked and write errors tell the owner; neither starts a test", async () => {
  const p = db.prepare(`SELECT id, price FROM products WHERE store_id = 'peak' ORDER BY price DESC LIMIT 1`).get()!;
  const [id, from] = [String(p.id), Number(p.price)];
  const to = Math.round(from * 1.1 * 100) / 100;
  db.prepare(`UPDATE stores SET connected = 1, platform = 'amazon' WHERE id = 'peak'`).run();
  expect((await run('peak', [price(id, to)]))[0]).toMatch(/^Not sent: the app doesn't change amazon stores yet/);
  expect(db.prepare(`SELECT count(*) AS n FROM approvals WHERE json_extract(action_json, '$.kind') = 'store.set_price'`).get()?.n).toBe(0);
  expect(db.prepare('SELECT count(*) AS n FROM price_tests').get()?.n).toBe(0);

  // WooCommerce is asked, and the approved change goes to core's Woo writer (its refusal of a non-Woo id reaches the owner).
  vi.stubEnv('FRONTLINE_SECRET_KEY', Buffer.alloc(32).toString('base64'));
  db.prepare(`UPDATE stores SET platform = 'woocommerce' WHERE id = 'peak'`).run();
  expect((await run('peak', [price(id, to)]))[0]).toMatch(/^Approved by the owner/);
  for (let i = 0; i < 20 && !db.prepare(`SELECT 1 FROM notifications WHERE title LIKE 'Couldn''t change the price%'`).get(); i++) await tick();
  expect(db.prepare(`SELECT body FROM notifications WHERE title LIKE 'Couldn''t change the price%'`).get()?.body).toBe(`${id} is not a WooCommerce product. Change it by hand if you still want the test.`);
  expect(db.prepare('SELECT count(*) AS n FROM price_tests').get()?.n).toBe(0);

  // Etsy prices too (core's Etsy writer refuses a non-Etsy id), but Etsy has no compare-at price: refused up front.
  db.prepare(`UPDATE stores SET platform = 'etsy' WHERE id = 'peak'`).run();
  expect((await run('peak', [{ call: 'propose_price_change', input: { productId: id, newPrice: to, compareAt: to + 10, evidence: 'rivals at $99' } }]))[0]).toMatch(/^Not sent: Etsy has no compare-at price/);
  expect((await run('peak', [price(id, to)]))[0]).toMatch(/^Approved by the owner/);
  for (let i = 0; i < 20 && !db.prepare(`SELECT 1 FROM notifications WHERE body LIKE '%not an Etsy listing%'`).get(); i++) await tick();
  expect(db.prepare(`SELECT body FROM notifications WHERE body LIKE '%not an Etsy listing%'`).get()?.body).toBe(`${id} is not an Etsy listing. Change it by hand if you still want the test.`);
  vi.unstubAllEnvs();

  db.prepare(`UPDATE stores SET platform = 'shopify' WHERE id = 'peak'`).run();
  const approval = { id: 'a1', storeId: 'peak', agentId: 'peak:market_analyst', title: 't', reason: 'r', status: 'approved', createdAt: '', action: { kind: 'store.set_price', payload: { productId: id, title: 'T', from, to, compareAt: 99 } } } as ApprovalRequest;
  const writes: unknown[] = [];
  await applyPriceChange(db, approval, async (...args) => void writes.push(args));
  expect(writes).toEqual([['peak', id, { price: to, compareAt: 99 }]]);
  expect(db.prepare('SELECT approval_id, to_price FROM price_tests').all()).toEqual([{ approval_id: 'a1', to_price: to }]);
});

test('a price approved after the price moved is not applied and starts no test', async () => {
  const id = String(db.prepare(`SELECT id FROM products WHERE store_id = 'peak' LIMIT 1`).get()!.id);
  db.prepare(`UPDATE products SET price = 22 WHERE id = ?`).run(id);
  const approval = { id: 'a1', storeId: 'peak', agentId: 'peak:market_analyst', title: 'Test $24', reason: 'r', status: 'approved', createdAt: '', action: { kind: 'store.set_price', payload: { productId: id, title: 'T', from: 20, to: 24 } } } as ApprovalRequest;
  await applyPriceChange(db, approval, async () => {});
  expect(db.prepare('SELECT price FROM products WHERE id = ?').get(id)?.price).toBe(22);
  expect(db.prepare('SELECT count(*) AS n FROM price_tests').get()?.n).toBe(0);
  expect(db.prepare(`SELECT body FROM notifications WHERE title = 'Not applied: "Test $24"'`).get()?.body).toBe('The price moved since this was asked ($20 → now $22). Ask the Market Analyst again if it still makes sense.');
});
