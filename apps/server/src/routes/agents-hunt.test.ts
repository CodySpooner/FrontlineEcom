import { fakeEngine, getAgent, listRuns, runAgent, type FakeStep, type RunInput } from '@frontline/agents';
import type { AgentEvent, ApprovalRequest, ResearchProduct } from '@frontline/shared';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { decide } from '../approvals';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { seedResearch } from '../research';
import { getStore } from '../stores';
import { runManager, toolEnv } from './agents';
import { addProducts } from './agents-actions';

let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  seedResearch(db);
  app = createApp(db);
});
const tick = () => new Promise((r) => setImmediate(r));
const post = (path: string, body?: unknown) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
const product = (storeId: string, id: string) => db.prepare('SELECT * FROM products WHERE store_id = ? AND id = ?').get(storeId, id);

test('approving "add to store" from the research screen adds a draft and has the Store Developer draft the page', async () => {
  const approval = (await (await post('/api/research/ice-facial-roller/add-to-store', { storeId: 'glow' })).json()) as ApprovalRequest;
  expect(product('glow', 'research-ice-facial-roller')).toBeUndefined();
  await post(`/api/approvals/${approval.id}/approve`);
  await tick();
  expect(product('glow', 'research-ice-facial-roller')).toMatchObject({ title: 'Ice Facial Roller', price: 11.3, compare_at: 34.99, cost: 2.6, status: 'draft', inventory: 0 });
  const [run] = listRuns(db, { agentId: 'glow:store_developer' });
  expect(run?.task).toMatch(/^New draft product\(s\) just added to Glow Haus: Ice Facial Roller \(productId research-ice-facial-roller\)\. .* draft_page .* publish_page\.$/);
  await runManager(db).idle();
});

test("a Product Hunter's own request goes through the same path; denied ones add nothing", async () => {
  const agent = getAgent(db, 'pawsome:product_hunter')!;
  const input: RunInput = { agent, store: getStore(db, 'pawsome')!, task: 't', env: toolEnv(db) };
  const ask = (title: string): FakeStep => ({
    call: 'request_approval',
    input: { title: `Add ${title}`, reason: 'score 81', kind: 'store.add_products', payload: { products: [{ researchProductId: 'lick-mat-slow-feeder', title, price: 9.99, cost: 1.2 }] } },
  });
  // A second request for a product already waiting isn't sent.
  const waits = db.prepare(`INSERT INTO approvals (id, store_id, agent_id, title, reason, action_json, status, created_at) VALUES ('w1', 'pawsome', 'pawsome:product_hunter', 'Add the lick mat', 'r', ?, 'pending', ?)`);
  waits.run(JSON.stringify({ kind: 'store.add_products', payload: { products: [{ title: 'Lick Mat Slow Feeder', price: 9.99 }] } }), new Date().toISOString());
  const outs: string[] = [];
  for await (const e of runAgent(input, fakeEngine(() => [ask(' lick mat slow feeder ')])) as AsyncIterable<AgentEvent>) if (e.type === 'tool_result') outs.push(e.output);
  expect(outs).toEqual(['Not sent: "Add the lick mat" already asks to add that product and is waiting for the owner.']);
  db.prepare(`DELETE FROM approvals WHERE id = 'w1'`).run();
  for (const [title, answer] of [['Lick Mat Slow Feeder', 'deny'], ['Lick Mat Slow Feeder', 'approve']] as const) {
    for await (const e of runAgent(input, fakeEngine(() => [ask(title)])) as AsyncIterable<AgentEvent>) if (e.type === 'approval_request') decide(db, e.approval.id, answer);
    await tick();
    expect(!!product('pawsome', 'research-lick-mat-slow-feeder')).toBe(answer === 'approve');
  }
  await runManager(db).idle();
});

test('connected stores get platform drafts; a platform error tells the owner instead', async () => {
  db.prepare(`UPDATE stores SET connected = 1, platform = 'shopify' WHERE id = 'peak'`).run();
  const approval = (await (await post('/api/research/smart-jump-rope/add-to-store', { storeId: 'peak' })).json()) as ApprovalRequest;
  await post(`/api/approvals/${approval.id}/approve`);
  await tick();
  expect(product('peak', 'research-smart-jump-rope')).toBeUndefined();
  expect(db.prepare(`SELECT title, body FROM notifications WHERE kind = 'error' AND store_id = 'peak'`).get()).toEqual({
    title: "Couldn't add products to Peak Fit",
    body: 'Shopify is not connected for this store. Approved: Smart Jump Rope. Add any not created yet by hand.',
  });

  const created: unknown[] = [];
  const runs: string[] = [];
  const titles = await addProducts(
    db,
    { ...approval, action: { kind: 'store.add_products', payload: { products: [{ researchProductId: 'smart-jump-rope', title: ' Smart Jump Rope ', price: 19.9, cost: 4 }] } } },
    (agentId) => runs.push(agentId),
    async (storeId, products) => (created.push([storeId, products]), [{ id: '901', title: 'Smart Jump Rope' }]),
  );
  expect(titles).toEqual(['Smart Jump Rope']);
  expect(created).toEqual([['peak', [{ title: 'Smart Jump Rope', price: 19.9, compareAt: undefined, cost: 4 }]]]);
  expect(runs).toEqual(['peak:store_developer']);

  // A second request for it, approved too (core's createProducts stored the first locally): nothing is made twice.
  db.prepare(`INSERT INTO products (store_id, id, title, price, cost, inventory, status) VALUES ('peak', '901', 'Smart Jump Rope', 19.9, 4, 0, 'draft')`).run();
  const second = { ...approval, id: 'again', action: { kind: 'store.add_products', payload: { products: [{ title: 'smart jump rope', price: 19.9 }] } } };
  expect(await addProducts(db, second, (agentId) => runs.push(agentId), async (storeId, products) => (created.push([storeId, products]), []))).toEqual([]);
  expect(created).toHaveLength(1);
  expect(runs).toHaveLength(1);

  // Two approvals for one product decided in the same second: the second doesn't wait for the first's create to return.
  let finish = (_: { id: string; title: string }[]) => {};
  const slow = async (storeId: string, products: unknown) => (created.push([storeId, products]), new Promise<{ id: string; title: string }[]>((r) => (finish = r)));
  const ask = (id: string) => ({ ...approval, id, action: { kind: 'store.add_products', payload: { products: [{ title: 'Grip Socks', price: 12 }] } } });
  const first = addProducts(db, ask('twice-1'), () => undefined, slow);
  expect(await addProducts(db, ask('twice-2'), () => undefined, slow)).toEqual([]);
  finish([{ id: '902', title: 'Grip Socks' }]);
  expect(await first).toEqual(['Grip Socks']);
  expect(created).toHaveLength(2); // the jump rope, then the socks once
});

test('record_product_find puts a web find in the feed with its AI score', async () => {
  const agent = getAgent(db, 'pawsome:product_hunter')!;
  const find = { title: 'Collapsible Dog Bowl Set', category: 'Pet Supplies', source: 'amazon', cost: 2.1, price: 14.99, compareAt: 24.99, trend: 90, competition: 35, shippingDays: 8 };
  const events: AgentEvent[] = [];
  const input: RunInput = { agent, store: getStore(db, 'pawsome')!, task: 't', env: toolEnv(db) };
  for await (const e of runAgent(input, fakeEngine(() => [{ call: 'record_product_find', input: find }]))) events.push(e);
  const result = events.find((e) => e.type === 'tool_result');
  expect(result).toMatchObject({ isError: false, output: expect.stringMatching(/^Added to the research feed as find-\w+: AI score \d+/) });
  const feed = (await (await app.request('/api/research?q=collapsible')).json()) as { items: ResearchProduct[] };
  expect(feed.items[0]).toMatchObject({ title: 'Collapsible Dog Bowl Set', niche: 'pet', source: 'amazon', score: expect.any(Number) });

  // Found again the next day: the same row gets the new numbers, no copy.
  const again: AgentEvent[] = [];
  for await (const e of runAgent(input, fakeEngine(() => [{ call: 'record_product_find', input: { ...find, title: 'collapsible dog bowl set', trend: 120 } }]))) again.push(e);
  expect(again.find((e) => e.type === 'tool_result')).toMatchObject({ output: expect.stringMatching(new RegExp(`^Already in the research feed as ${feed.items[0]!.id}; refreshed its numbers: AI score`)) });
  const now = (await (await app.request('/api/research?q=collapsible')).json()) as { items: ResearchProduct[] };
  expect(now.items.filter((p) => p.id.startsWith('find-')).map((p) => [p.id, p.trend])).toEqual([[feed.items[0]!.id, 120]]);
});

test('search_suppliers gives supplier prices: demo listings without CJ, none for an unknown product', async () => {
  const input: RunInput = { agent: getAgent(db, 'glow:product_hunter')!, store: getStore(db, 'glow')!, task: 't', env: toolEnv(db) };
  const steps: FakeStep[] = [{ call: 'search_suppliers', input: { q: 'roller', limit: 3 } }, { call: 'search_suppliers', input: { q: 'zzz-nothing' } }];
  const out: string[] = [];
  for await (const e of runAgent(input, fakeEngine(() => steps))) if (e.type === 'tool_result') out.push(e.output);
  expect(out[0]).toMatch(/^# Demo supplier data \(CJ is not connected\)\nsku,title,price_usd,listed_by_sellers\nCJ\w+,[^\n]*Roller[^\n]*,\d/);
  expect(out[1]).toBe('No supplier listings for "zzz-nothing".');
});

test('a store selling in another currency is told research and supplier prices are USD, with the rate', async () => {
  db.prepare(`UPDATE stores SET currency = 'EUR' WHERE id = 'glow'`).run();
  db.prepare(`INSERT INTO settings (key, value_json) VALUES ('fx', ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`).run(
    JSON.stringify({ date: '2026-10-26', fetchedAt: new Date().toISOString(), rates: { EUR: 1, USD: 1.25 } }),
  );
  const input: RunInput = { agent: getAgent(db, 'glow:product_hunter')!, store: getStore(db, 'glow')!, task: 't', env: toolEnv(db) };
  const out: string[] = [];
  for await (const e of runAgent(input, fakeEngine(() => [{ call: 'research_feed' }, { call: 'search_suppliers', input: { q: 'roller' } }]))) if (e.type === 'tool_result') out.push(e.output);
  expect(out[0]).toMatch(/^# Amounts in USD \(1 USD = 0\.8 EUR\); this store sells in EUR\.\nid,title,/);
  expect(out[1]).toMatch(/^# Demo supplier data \(CJ is not connected\)\n# Amounts in USD \(1 USD = 0\.8 EUR\); this store sells in EUR\.\nsku,/);
});
