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
  expect(run?.task).toMatch(/^New draft product\(s\) just added to Glow Haus: Ice Facial Roller\./);
  await runManager(db).idle();
});

test("a Product Hunter's own request goes through the same path; denied ones add nothing", async () => {
  const agent = getAgent(db, 'pawsome:product_hunter')!;
  const input: RunInput = { agent, store: getStore(db, 'pawsome')!, task: 't', env: toolEnv(db) };
  const ask = (title: string): FakeStep => ({
    call: 'request_approval',
    input: { title: `Add ${title}`, reason: 'score 81', kind: 'store.add_products', payload: { products: [{ researchProductId: 'lick-mat-slow-feeder', title, price: 9.99, cost: 1.2 }] } },
  });
  for (const [title, answer] of [['Lick Mat Slow Feeder', 'deny'], ['Lick Mat Slow Feeder', 'approve']] as const) {
    for await (const e of runAgent(input, fakeEngine(() => [ask(title)])) as AsyncIterable<AgentEvent>) if (e.type === 'approval_request') decide(db, e.approval.id, answer);
    await tick();
    expect(!!product('pawsome', 'research-lick-mat-slow-feeder')).toBe(answer === 'approve');
  }
  await runManager(db).idle();
});

test('connected stores are not written to; the owner is told instead', async () => {
  db.prepare(`UPDATE stores SET connected = 1 WHERE id = 'peak'`).run();
  const approval = (await (await post('/api/research/smart-jump-rope/add-to-store', { storeId: 'peak' })).json()) as ApprovalRequest;
  await post(`/api/approvals/${approval.id}/approve`);
  await tick();
  expect(product('peak', 'research-smart-jump-rope')).toBeUndefined();
  expect(db.prepare(`SELECT title FROM notifications WHERE kind = 'info' AND store_id = 'peak'`).get()?.title).toBe('Add 1 product(s) to Peak Fit by hand');
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
});
