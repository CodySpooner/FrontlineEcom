import { fakeEngine, getAgent, listMemory, once, runAgent, writeMemory, type FakeStep } from '@frontline/agents';
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
import { checkPriceOutcomes } from './agents-gamification';

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

  // A cut can show the price it was; a higher "was" price than the store charged can't be shown (the one it shows already can).
  const cut = Math.round(to * 0.8 * 100) / 100;
  db.prepare('DELETE FROM price_tests').run();
  expect(await run('glow', [price(id, cut, { compareAt: to + 5 })])).toEqual([
    `Not sent: compareAt is the "was" price, and ${String(p.title)} sells for $${to} now: $${to + 5} would be a discount from a price the store never charged. Use at most $${to}, or omit it.`,
  ]);
  db.prepare(`UPDATE products SET compare_at = ? WHERE store_id = 'glow' AND id = ?`).run(to + 5, id);
  expect((await run('glow', [price(id, cut, { compareAt: to + 5 })]))[0]).toMatch(/^Approved by the owner/);

  db.prepare(`UPDATE stores SET currency = 'EUR' WHERE id = 'glow'`).run(); // the owner reads amounts in the store's currency
  expect(await run('glow', [price(id, cost)])).toEqual([`Not sent: ${cost} EUR is at or below the unit cost (${cost} EUR).`]);
});

test("a product sold on TikTok Shop, Amazon, an Etsy shop or a second site next to the store isn't repriced through the store's platform", async () => {
  db.prepare(`UPDATE stores SET connected = 1 WHERE id = 'glow'`).run(); // Shopify
  const add = db.prepare(`INSERT INTO products (store_id, id, title, price, cost, inventory, status) VALUES ('glow', ?, 'Jade Roller', 20, 5, 9, 'active')`);
  for (const id of ['tt-17', 'amz-JR1', 'etsy-88', 'woo-12']) add.run(id);
  expect(await run('glow', [price('tt-17', 22), price('amz-JR1', 22), price('etsy-88', 22), price('woo-12', 22)])).toEqual(
    [['tt-17', 'TikTok Shop'], ['amz-JR1', 'Amazon'], ['etsy-88', 'Etsy'], ['woo-12', 'WooCommerce']].map(
      ([id, on]) => `Product ${id} sells on ${on}, next to the store, and the app only changes the shopify store. Put the change in your answer for the owner to make on ${on}.`,
    ),
  );
  expect(db.prepare(`SELECT count(*) AS n FROM approvals WHERE json_extract(action_json, '$.kind') = 'store.set_price'`).get()?.n).toBe(0);
  // A WooCommerce store's own products are woo- too: those it changes.
  db.prepare(`UPDATE stores SET platform = 'woocommerce' WHERE id = 'glow'`).run();
  expect((await run('glow', [price('woo-12', 22)]))[0]).toMatch(/^Approved by the owner/);
});

test("a product with no unit cost set has no floor to check, and the owner is told so", async () => {
  const p = db.prepare(`SELECT id, price FROM products WHERE store_id = 'glow' ORDER BY price DESC LIMIT 1`).get()!;
  db.prepare(`UPDATE products SET cost = 0 WHERE store_id = 'glow' AND id = ?`).run(String(p.id)); // Shopify's empty "Cost per item"
  const to = Math.round(Number(p.price) * 0.75 * 100) / 100;
  const [out] = await run('glow', [price(String(p.id), to)]);
  expect(out).toMatch(/^Approved by the owner: /);
  expect(String(db.prepare(`SELECT reason FROM approvals WHERE json_extract(action_json, '$.kind') = 'store.set_price'`).get()?.reason)).toBe(
    "Converts 3.1% at current price; competitors sell at $34-39 No unit cost is set for this product, so the app can't check the new price covers it, and its profit is judged before product cost.",
  );
});

test('an archived product (deleted on the platform) gets no price test', async () => {
  const id = String(db.prepare(`SELECT id FROM products WHERE store_id = 'glow' AND cost IS NOT NULL LIMIT 1`).get()!.id);
  db.prepare(`UPDATE products SET status = 'archived' WHERE store_id = 'glow' AND id = ?`).run(id);
  expect(await run('glow', [price(id, 30)])).toEqual([`Product ${id} is archived (deleted or trashed on the platform). Pick an active product from list_products.`]);
});

test("a price that covers the unit cost but not the store's fees is refused", async () => {
  const p = db.prepare(`SELECT id, price, cost FROM products WHERE store_id = 'glow' AND cost > 5 ORDER BY price DESC LIMIT 1`).get()!;
  const [id, cost] = [String(p.id), Number(p.cost)];
  db.prepare(`UPDATE products SET price = ? WHERE id = ?`).run(Math.round(cost * 1.2 * 100) / 100, id); // within ±30% of the test prices
  db.prepare(`UPDATE stores SET fee_percent = 10, fee_per_order = 0.3 WHERE id = 'glow'`).run();
  const floor = Math.round(((cost + 0.3) / 0.9) * 100) / 100;
  const [refused, sent] = await run('glow', [price(id, floor), price(id, Math.round((floor + 0.5) * 100) / 100)]);
  expect(refused).toBe(`Not sent: $${floor} is at or below the unit cost plus fees ($${floor}).`);
  expect(sent).toMatch(/^Approved by the owner/);
});

test("a price test is judged once its 14th day after is over in the store's own zone, not this machine's", () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    db.prepare(`UPDATE stores SET demo = 0, connected = 1, timezone = 'Pacific/Honolulu' WHERE id = 'peak'`).run(); // UTC-10
    once(db, 'activate:peak', new Date('2020-01-01'));
    db.prepare(`INSERT INTO price_tests (approval_id, store_id, product_id, agent_id, title, from_price, to_price, changed_on) VALUES ('a-late', 'peak', '77', 'peak:market_analyst', 'Grip Socks', 20, 25, '2026-06-01')`).run();
    const judged = () => db.prepare(`SELECT judged_at FROM price_tests WHERE approval_id = 'a-late'`).get()?.judged_at;
    vi.setSystemTime(new Date('2026-06-16T07:00:00Z')); // June 15, 9 pm in Honolulu: its 14th day after isn't over
    checkPriceOutcomes(db);
    expect(judged()).toBeNull();
    vi.setSystemTime(new Date('2026-06-16T11:00:00Z')); // June 16 there
    checkPriceOutcomes(db);
    expect(judged()).toEqual(expect.any(String));
  } finally {
    vi.useRealTimers();
  }
});

test("on a real store a price test is judged on profit after the store's fee %, 14 days before vs after, once", async () => {
  db.prepare(`UPDATE stores SET demo = 0, connected = 1, fee_percent = 20 WHERE id = 'peak'`).run();
  once(db, 'activate:peak', new Date('2020-01-01')); // live long before
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
  sell(10, addDays(day, -5), 20); // 140 gross profit before, 100 after the 20% fee
  sell(9, addDays(day, 5), 25); // 171 gross, 126 net
  // One sock refunded: 25 off the after window (146 gross, 106 net). Another product's refund, one on a cancelled order
  // (its line never counted) and one whose order isn't the store's don't count.
  db.prepare(`UPDATE orders SET status = 'refunded' WHERE store_id = 'peak' AND id = ?`).run(`o-${addDays(day, 5)}-8`);
  sell(1, addDays(day, 6), 25);
  const refund = db.prepare(`INSERT INTO amazon_refunds (store_id, id, order_id, amount, product_id) VALUES ('peak', ?, ?, ?, ?)`);
  refund.run('r1', `o-${addDays(day, 5)}-0`, 30, '77'); // with its 5 shipping: only the 25 the sock sold for comes off
  refund.run('r2', `o-${addDays(day, 5)}-1`, 25, '78');
  refund.run('r3', `o-${addDays(day, 5)}-8`, 25, '77');
  refund.run('r4', 'o-elsewhere', 25, '77');
  // The shop last synced before the after window was over, then its sync failed: not judged yet (it's judged once).
  const pricing = () => listMemory(db, 'peak').filter((m) => m.tags.includes('pricing'));
  db.prepare(`INSERT INTO integrations (id, kind, store_id, status, encrypted_credentials, updated_at, synced_at) VALUES ('tiktok_shop:peak', 'tiktok_shop', 'peak', 'connected', 'x', ?1, ?1)`).run(`${addDays(day, 14)}T15:00:00Z`);
  checkPriceOutcomes(db);
  expect(pricing()).toEqual([]);
  db.prepare(`UPDATE integrations SET status = 'error', synced_at = ? WHERE id = 'tiktok_shop:peak'`).run(new Date().toISOString());
  checkPriceOutcomes(db);
  expect(pricing()).toEqual([]);
  db.prepare(`UPDATE integrations SET status = 'connected' WHERE id = 'tiktok_shop:peak'`).run();
  const xp = () => getAgent(db, 'peak:market_analyst')!.xp;
  const before = xp();
  await app.request('/api/achievements');
  await app.request('/api/achievements');

  const texts = listMemory(db, 'peak').filter((m) => m.tags.includes('pricing')).map((m) => m.text);
  expect(texts).toEqual(['Pricing "Grip Socks" $20 → $25 worked: profit 100 USD → 106 USD, 10 → 9 units (14 days before vs after).']);
  expect(xp()).toBe(before + 50);
  expect(listMemory(db, 'peak').find((m) => m.text === 'Grip Socks are underpriced vs rivals')?.confidence).toBe(0.7);
  expect(db.prepare(`SELECT body FROM notifications WHERE title = 'Measured win: Market Analyst'`).all()).toEqual([{ body: texts[0] }]);
  const achievements = (await (await app.request('/api/achievements')).json()) as { id: string; unlockedAt?: string }[];
  expect(achievements.find((a) => a.id === 'first_win')?.unlockedAt).toEqual(expect.any(String));
});

test("a price test on a product with no unit cost isn't called a win: its profit is before product cost", async () => {
  db.prepare(`UPDATE stores SET demo = 0, connected = 1 WHERE id = 'peak'`).run();
  once(db, 'activate:peak', new Date('2020-01-01'));
  const day = addDays(localDate(), -20);
  db.prepare(`INSERT INTO price_tests (approval_id, store_id, product_id, agent_id, title, from_price, to_price, changed_on) VALUES ('a-cut', 'peak', '77', 'peak:market_analyst', 'Grip Socks', 25, 20, ?)`).run(day);
  const sell = (n: number, on: string, price: number) => {
    for (let k = 0; k < n; k++) {
      db.prepare(`INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, local_date) VALUES ('peak', ?, ?, ?, 'paid', 'delivered', ?)`).run(`o-${on}-${k}`, `${on}T12:00:00Z`, price, on);
      db.prepare(`INSERT INTO order_items (store_id, order_id, product_id, quantity, revenue, cost) VALUES ('peak', ?, '77', 1, ?, 0)`).run(`o-${on}-${k}`, price); // "Cost per item" empty
    }
  };
  sell(4, addDays(day, -5), 25);
  sell(6, addDays(day, 5), 20); // more "profit" at the lower price only because the socks cost nothing here
  const xp = getAgent(db, 'peak:market_analyst')!.xp;
  checkPriceOutcomes(db);
  const text = "Pricing \"Grip Socks\" $25 → $20 can't be judged: no unit cost is set, so profit before product cost went 100 USD → 120 USD, 4 → 6 units (14 days before vs after).";
  expect(listMemory(db, 'peak').filter((m) => m.tags.includes('pricing')).map((m) => [m.text, m.confidence])).toEqual([[text, 0.5]]);
  expect(getAgent(db, 'peak:market_analyst')!.xp).toBe(xp);
  expect(db.prepare(`SELECT title, body FROM notifications WHERE body = ?`).all(text)).toEqual([{ title: 'Market Analyst: result unclear without unit costs', body: text }]);
});

test("a price test is judged against the store's season: more profit while every product sold more isn't a win", () => {
  db.prepare(`UPDATE stores SET demo = 0, connected = 1, fee_percent = 0, fee_per_order = 0 WHERE id = 'peak'`).run();
  once(db, 'activate:peak', new Date('2020-01-01'));
  const day = addDays(localDate(), -20);
  db.prepare(`INSERT INTO price_tests (approval_id, store_id, product_id, agent_id, title, from_price, to_price, changed_on) VALUES ('a-bf', 'peak', '77', 'peak:market_analyst', 'Grip Socks', 20, 25, ?)`).run(day);
  let n = 0;
  const sell = (product: string, units: number, on: string, price: number) => {
    for (let k = 0; k < units; k++, n++) {
      db.prepare(`INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, local_date) VALUES ('peak', ?, ?, ?, 'paid', 'delivered', ?)`).run(`o-bf-${n}`, `${on}T12:00:00Z`, price, on);
      db.prepare(`INSERT INTO order_items (store_id, order_id, product_id, quantity, revenue, cost) VALUES ('peak', ?, ?, 1, ?, 10)`).run(`o-bf-${n}`, product, price);
    }
  };
  sell('77', 10, addDays(day, -5), 20); // 100 profit before
  sell('77', 8, addDays(day, 5), 25); // 120 after: +20%
  sell('other', 20, addDays(day, -5), 30);
  sell('other', 30, addDays(day, 5), 30); // the rest of the store sold 50% more (a holiday week)
  checkPriceOutcomes(db);
  expect(listMemory(db, 'peak').filter((m) => m.tags.includes('pricing')).map((m) => m.text)).toEqual([
    'Pricing "Grip Socks" $20 → $25 did not help: profit 100 USD → 120 USD (par 150 USD: the rest of the store\'s sales moved +50%), 10 → 8 units (14 days before vs after).',
  ]);
});

test('a price test on a few units sold is not judged on one order either way', () => {
  db.prepare(`UPDATE stores SET demo = 0, connected = 1 WHERE id = 'peak'`).run();
  once(db, 'activate:peak', new Date('2020-01-01'));
  const day = addDays(localDate(), -20);
  db.prepare(`INSERT INTO price_tests (approval_id, store_id, product_id, agent_id, title, from_price, to_price, changed_on) VALUES ('a-few', 'peak', '77', 'peak:market_analyst', 'Grip Socks', 20, 25, ?)`).run(day);
  const sell = (n: number, on: string, price: number) => {
    for (let k = 0; k < n; k++) {
      db.prepare(`INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, local_date) VALUES ('peak', ?, ?, ?, 'paid', 'delivered', ?)`).run(`o-${on}-${k}`, `${on}T12:00:00Z`, price, on);
      db.prepare(`INSERT INTO order_items (store_id, order_id, product_id, quantity, revenue, cost) VALUES ('peak', ?, '77', 1, ?, 8)`).run(`o-${on}-${k}`, price);
    }
  };
  sell(2, addDays(day, -5), 20);
  sell(2, addDays(day, 5), 25); // +10 profit on the same two units
  const xp = getAgent(db, 'peak:market_analyst')!.xp;
  checkPriceOutcomes(db);
  expect(listMemory(db, 'peak').filter((m) => m.tags.includes('pricing')).map((m) => m.text)).toEqual([
    `Pricing "Grip Socks" $20 → $25 can't be judged on 4 units sold (it takes 10): profit 24 USD → 34 USD, 2 → 2 units (14 days before vs after).`,
  ]);
  expect(getAgent(db, 'peak:market_analyst')!.xp).toBe(xp);
});

test("connected stores get the price on Shopify or WooCommerce; other platforms aren't asked and write errors tell the owner; neither starts a test", async () => {
  const p = db.prepare(`SELECT id, price FROM products WHERE store_id = 'peak' ORDER BY price DESC LIMIT 1`).get()!;
  const [id, from] = [String(p.id), Number(p.price)];
  const to = Math.round(from * 1.1 * 100) / 100;
  db.prepare(`UPDATE stores SET connected = 1, platform = 'walmart' WHERE id = 'peak'`).run();
  expect((await run('peak', [price(id, to)]))[0]).toMatch(/^Not sent: the app doesn't change walmart stores yet/);
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
  const withCompareAt = { call: 'propose_price_change', input: { productId: id, newPrice: to, compareAt: to + 10, evidence: 'rivals at $99' } } as const;
  expect((await run('peak', [withCompareAt]))[0]).toMatch(/^Not sent: Etsy has no compare-at price/);
  for (const [platform, name] of [['amazon', 'Amazon'], ['tiktok_shop', 'TikTok Shop']] as const) {
    db.prepare(`UPDATE stores SET platform = ? WHERE id = 'peak'`).run(platform); // their writers refuse one too
    expect((await run('peak', [withCompareAt]))[0]).toMatch(new RegExp(`^Not sent: ${name} has no compare-at price`));
  }
  db.prepare(`UPDATE products SET status = 'draft' WHERE store_id = 'peak' AND id = ?`).run(id);
  expect((await run('peak', [price(id, to)]))[0]).toMatch(/^Not sent: TikTok Shop only reprices live products, and .* is draft\.$/);
  db.prepare(`UPDATE products SET status = 'active' WHERE store_id = 'peak' AND id = ?`).run(id);
  db.prepare(`UPDATE stores SET platform = 'etsy' WHERE id = 'peak'`).run();
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

test('a price approved over 2 weeks after it was asked on a live store is asked again, not applied', async () => {
  db.prepare(`UPDATE stores SET connected = 1 WHERE id = 'peak'`).run();
  const p = db.prepare(`SELECT id, price FROM products WHERE store_id = 'peak' LIMIT 1`).get()!;
  const [id, from] = [String(p.id), Number(p.price)];
  const approval = (id2: string, daysAgo: number) =>
    ({
      id: id2, storeId: 'peak', agentId: 'peak:market_analyst', title: 'Test price', reason: 'r', status: 'approved',
      createdAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(), decidedAt: new Date().toISOString(),
      action: { kind: 'store.set_price', payload: { productId: id, title: 'T', from, to: from + 1 } },
    }) as ApprovalRequest;
  const writes: unknown[] = [];
  await applyPriceChange(db, approval('a-old', 15), async (...args) => void writes.push(args));
  expect(writes).toEqual([]);
  expect(db.prepare('SELECT count(*) AS n FROM price_tests').get()?.n).toBe(0);
  expect(db.prepare(`SELECT link FROM notifications WHERE title = 'Not applied: "Test price"'`).get()?.link).toBe('/agents/peak:market_analyst');
  expect(db.prepare(`SELECT body FROM notifications WHERE title = 'Not applied: "Test price"'`).get()?.body).toBe(
    'It was asked 15 days ago, on prices that may have moved since. Ask the Market Analyst again for a fresh read.',
  );
  await applyPriceChange(db, approval('a-new', 13), async (...args) => void writes.push(args));
  expect(writes).toHaveLength(1);
});

test('a price approved after the price moved is not applied and starts no test', async () => {
  const id = String(db.prepare(`SELECT id FROM products WHERE store_id = 'peak' LIMIT 1`).get()!.id);
  db.prepare(`UPDATE products SET price = 22 WHERE id = ?`).run(id);
  const approval = { id: 'a1', storeId: 'peak', agentId: 'peak:market_analyst', title: 'Test $24', reason: 'r', status: 'approved', createdAt: '', action: { kind: 'store.set_price', payload: { productId: id, title: 'T', from: 20, to: 24 } } } as ApprovalRequest;
  await applyPriceChange(db, approval, async () => {});
  expect(db.prepare('SELECT price FROM products WHERE id = ?').get(id)?.price).toBe(22);
  expect(db.prepare('SELECT count(*) AS n FROM price_tests').get()?.n).toBe(0);
  expect(db.prepare(`SELECT 1 AS y FROM done_once WHERE ref = 'not-applied:a1'`).get()).toEqual({ y: 1 }); // squad_log says so
  expect(db.prepare(`SELECT body FROM notifications WHERE title = 'Not applied: "Test $24"'`).get()?.body).toBe('The price moved since this was asked ($20 → now $22). Ask the Market Analyst again if it still makes sense.');
});
