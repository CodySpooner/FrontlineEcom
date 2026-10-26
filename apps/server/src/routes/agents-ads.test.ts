import { fakeEngine, getAgent, runAgent, type FakeStep, type RunInput } from '@frontline/agents';
import type { AgentEvent, ApprovalDecision, ApprovalRequest } from '@frontline/shared';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { decide } from '../approvals';
import { addDays, localDate } from '../dates';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { updateCaps } from '../settings';
import { getStore } from '../stores';
import { toolEnv } from './agents';

let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  app = createApp(db);
});
const tick = () => new Promise((r) => setImmediate(r));
const budget = (id: string) => db.prepare('SELECT daily_budget, status FROM campaigns WHERE id = ?').get(id) as { daily_budget: number; status: string };

async function run(steps: FakeStep[], answer: ApprovalDecision = 'approve', agentId = 'pawsome:ad_strategist') {
  const agent = getAgent(db, agentId)!;
  const input: RunInput = { agent, store: getStore(db, agent.storeId)!, task: 't', env: toolEnv(db) };
  const events: AgentEvent[] = [];
  for await (const e of runAgent(input, fakeEngine(() => steps))) {
    events.push(e);
    if (e.type === 'approval_request') decide(db, e.approval.id, answer);
  }
  await tick();
  return {
    outputs: events.flatMap((e) => (e.type === 'tool_result' ? [e.output] : [])),
    requests: events.flatMap((e) => (e.type === 'approval_request' ? [e.approval] : [])),
  };
}
const propose = (input: object): FakeStep => ({ call: 'propose_ad_change', input: { evidence: '7d ROAS 3.4 vs break-even 2.1, 41 purchases', ...input } });

test('review_campaigns gives thresholds and a verdict per campaign', async () => {
  const [out] = (await run([{ call: 'review_campaigns' }])).outputs;
  const [head, cols, ...rows] = out!.split('\n');
  expect(head).toMatch(/^gross margin [\d.]+%, AOV [\d.]+, break-even ROAS [\d.]+, target ROAS [\d.]+, max CPA [\d.]+ \(30 days\); campaigns over 7 days:$/);
  expect(cols).toBe('network,id,name,status,daily_budget,spend,roas,cpa,purchases,verdict,suggested_budget');
  expect(rows).toHaveLength(4);
  for (const r of rows) expect(['scale', 'hold', 'cut', 'pause', 'learning', 'paused']).toContain(r.split(',')[9]);
});

test('an approved budget change and pause are applied to the demo ad account', async () => {
  const from = budget('pawsome-c1').daily_budget;
  const raise = await run([propose({ campaignId: 'pawsome-c1', change: 'budget', newDailyBudget: from + 10 })]);
  expect(raise.requests[0]).toMatchObject({
    title: `Raise Prospecting · Broad budget $${from} → $${from + 10}/day`,
    reason: '7d ROAS 3.4 vs break-even 2.1, 41 purchases',
    action: { kind: 'ads.set_budget', amountUsd: 10, payload: { campaignId: 'pawsome-c1', from, to: from + 10 } },
  });
  expect(raise.outputs[0]).toMatch(/It will be applied to the ad account\.$/);
  expect(budget('pawsome-c1').daily_budget).toBe(from + 10);

  await run([propose({ campaignId: 'pawsome-c3', change: 'pause' })]);
  expect(budget('pawsome-c3').status).toBe('paused');
  await run([propose({ campaignId: 'pawsome-c2', change: 'pause' })], 'deny');
  expect(budget('pawsome-c2').status).toBe('active');
});

test("the owner's cap on added spend and bad input stop a proposal before asking", async () => {
  updateCaps(db, 'pawsome', { adSpendChangePerDay: 25 });
  const from = budget('pawsome-c1').daily_budget;
  await run([propose({ campaignId: 'pawsome-c1', change: 'budget', newDailyBudget: from + 20 })]);
  const { outputs, requests } = await run([
    propose({ campaignId: 'pawsome-c1', change: 'budget', newDailyBudget: from + 30 }),
    propose({ campaignId: 'glow-c1', change: 'pause' }),
    propose({ campaignId: 'pawsome-c2', change: 'budget' }),
  ]);
  expect(requests).toEqual([]);
  expect(outputs).toEqual([
    "Not sent: +$10/day would pass the owner's $25/day cap on added ad spend ($20 already approved today). Propose a smaller step.",
    'No campaign glow-c1 in this store. Use review_campaigns for ids.',
    'newDailyBudget is required for a budget change.',
  ]);
});

test('connected stores are told to apply it on the ad account', async () => {
  db.prepare(`UPDATE stores SET connected = 1 WHERE id = 'pawsome'`).run();
  await run([propose({ campaignId: 'pawsome-c3', change: 'pause' })]);
  expect(budget('pawsome-c3').status).toBe('active');
  expect(db.prepare(`SELECT title FROM notifications WHERE kind = 'info'`).get()?.title).toBe('Apply on the ad account: Pause Spark Ads · UGC');
});

test('an approved ad change followed by better blended ROAS is a measured win, paid once', async () => {
  const decided = addDays(localDate(), -10);
  const approval: Partial<ApprovalRequest> = { id: 'a-win', storeId: 'peak', agentId: 'peak:ad_strategist', title: 'Pause Spark Ads · UGC' };
  db.prepare(
    `INSERT INTO approvals (id, store_id, agent_id, title, reason, action_json, status, created_at, decided_at) VALUES (?, ?, ?, ?, 'r', ?, 'approved', ?, ?)`,
  ).run(approval.id!, approval.storeId!, approval.agentId!, approval.title!, JSON.stringify({ kind: 'ads.pause_campaign', payload: {} }), `${decided}T09:00:00Z`, `${decided}T12:00:00Z`);
  db.prepare(`UPDATE daily_metrics SET revenue = revenue * 3 WHERE store_id = 'peak' AND date BETWEEN ? AND ?`).run(addDays(decided, 1), addDays(decided, 3));
  const xp = () => getAgent(db, 'peak:ad_strategist')!.xp;
  const before = xp();
  await app.request('/api/commander');
  await app.request('/api/commander');
  expect(xp()).toBe(before + 50);
  expect(String(db.prepare(`SELECT reason FROM xp_events WHERE ref = 'win:a-win'`).get()?.reason)).toMatch(/^Measured win: ROAS [\d.]+ → [\d.]+ after "Pause Spark Ads · UGC"$/);
});
