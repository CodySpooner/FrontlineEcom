import { deleteMemory, fakeEngine, getAgent, listMemory, once, runAgent, updateAgent, writeMemory, type FakeStep, type RunInput } from '@frontline/agents';
import type { AgentEvent, ApprovalDecision, ApprovalRequest } from '@frontline/shared';
import { beforeEach, expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { decide } from '../approvals';
import { addDays, localDate } from '../dates';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { updateCaps } from '../settings';
import { getStore } from '../stores';
import { toolEnv } from './agents';
import { applyAdChange } from './agents-actions';
import { checkAdOutcomes, startOutcomeLoop } from './agents-gamification';

let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  app = createApp(db);
  // The demo's own pending budget request on pawsome-c1 would block new ones (one change per campaign at a time).
  db.prepare(`UPDATE approvals SET status = 'denied' WHERE store_id = 'pawsome' AND status = 'pending'`).run();
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
  expect(head).toMatch(/^margin after cost and fees [\d.]+%, AOV [\d.]+, break-even ROAS [\d.]+, target ROAS [\d.]+, max CPA [\d.]+ \(30 days\); campaigns over 7 days:$/);
  expect(cols).toBe('network,id,name,status,daily_budget,spend,roas,cpa,purchases,verdict,suggested_budget');
  expect(rows).toHaveLength(4);
  for (const r of rows) expect(['scale', 'hold', 'cut', 'pause', 'learning', 'paused']).toContain(r.split(',')[9]);
});

test("break-even ROAS nets the owner's fee estimate, like the store's profit", async () => {
  const head = async () => {
    const [out] = (await run([{ call: 'review_campaigns' }])).outputs;
    const [margin, aov] = out!.match(/[\d.]+/g)!.map(Number);
    return { margin: margin!, aov: aov! };
  };
  const before = await head();
  db.prepare(`UPDATE stores SET fee_percent = 9.5, fee_per_order = 0.25 WHERE id = 'pawsome'`).run();
  const after = await head();
  expect(after.margin).toBeCloseTo(before.margin - 9.5 - (100 * 0.25) / before.aov, 1);
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

test('an unanswered budget request lets the run finish after 10 minutes and is still applied when approved later', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const agent = getAgent(db, 'pawsome:ad_strategist')!;
    const from = budget('pawsome-c1').daily_budget;
    const events: AgentEvent[] = [];
    const steps = [propose({ campaignId: 'pawsome-c1', change: 'budget', newDailyBudget: from + 10 })];
    const done = (async () => {
      for await (const e of runAgent({ agent, store: getStore(db, 'pawsome')!, task: 't', env: toolEnv(db) }, fakeEngine(() => steps))) events.push(e);
    })();
    while (!events.some((e) => e.type === 'approval_request')) await tick();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await done;
    expect(events.flatMap((e) => (e.type === 'tool_result' ? [e.output] : []))).toEqual([
      `Waiting for the owner: Raise Prospecting · Broad budget $${from} → $${from + 10}/day. The app carries it out once approved; don't wait for it, finish your answer.`,
    ]);
    const request = events.find((e) => e.type === 'approval_request');
    decide(db, request?.type === 'approval_request' ? request.approval.id : '', 'approve');
    await tick();
    expect(budget('pawsome-c1').daily_budget).toBe(from + 10);
  } finally {
    vi.useRealTimers();
  }
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

test('a store in another currency is held to the USD caps; with no exchange rate the owner decides', async () => {
  db.prepare(`UPDATE stores SET currency = 'EUR' WHERE id = 'pawsome'`).run();
  db.prepare(`INSERT INTO settings (key, value_json) VALUES ('fx', ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`).run(
    JSON.stringify({ date: localDate(), fetchedAt: new Date().toISOString(), rates: { EUR: 1, USD: 1.5 } }),
  );
  updateCaps(db, 'pawsome', { adSpendChangePerDay: 25, autopilot: { 'ads.set_budget': { enabled: true, maxUsdPerDay: 20 } } });
  updateAgent(db, 'pawsome:ad_strategist', { autonomy: 'autopilot' });
  const from = budget('pawsome-c1').daily_budget;
  const over = await run([propose({ campaignId: 'pawsome-c1', change: 'budget', newDailyBudget: from + 20 })]);
  expect(over.outputs).toEqual(["Not sent: +$30 (20 EUR)/day would pass the owner's $25/day cap on added ad spend ($0 already approved today). Propose a smaller step."]);
  const within = await run([propose({ campaignId: 'pawsome-c1', change: 'budget', newDailyBudget: from + 10 })]);
  expect(within.requests.map((r) => r.action)).toEqual([expect.objectContaining({ amountUsd: 15, auto: true })]); // €10 = $15, inside the $20 autopilot cap
  const asked = await run([{ call: 'request_approval', input: { title: 'Refund 2 orders', reason: 'r', kind: 'refund', payload: {}, amount: 10 } }], 'deny');
  expect(asked.requests[0]!.action.amountUsd).toBe(15); // the generic request converts the same way

  db.prepare(`UPDATE stores SET currency = 'ISK' WHERE id = 'pawsome'`).run(); // the ECB publishes no ISK rate
  const unknown = await run([propose({ campaignId: 'pawsome-c2', change: 'budget', newDailyBudget: budget('pawsome-c2').daily_budget + 1 })], 'deny');
  expect(unknown.requests.map((r) => r.action)).toEqual([expect.not.objectContaining({ amountUsd: expect.anything() })]);
  expect(unknown.requests[0]!.action.auto).toBeUndefined();
});

test('a campaign with a change already waiting for the owner gets no second request', async () => {
  db.prepare(`INSERT INTO approvals (id, store_id, agent_id, title, reason, action_json, status, created_at) VALUES ('w1', 'pawsome', 'pawsome:ad_strategist', 'Pause Prospecting · Broad', 'r', ?, 'pending', ?)`).run(
    JSON.stringify({ kind: 'ads.pause_campaign', payload: { campaignId: 'pawsome-c1' } }),
    new Date().toISOString(),
  );
  const { outputs, requests } = await run([propose({ campaignId: 'pawsome-c1', change: 'budget', newDailyBudget: 300 })]);
  expect(requests).toEqual([]);
  expect(outputs).toEqual(['Not sent: "Pause Prospecting · Broad" is already waiting for the owner. One change per campaign at a time.']);
});

test('connected stores get it on the ad account; an ad account error tells the owner and changes nothing', async () => {
  db.prepare(`UPDATE stores SET connected = 1 WHERE id = 'pawsome'`).run();
  await run([propose({ campaignId: 'pawsome-c3', change: 'pause' })]); // no ad credentials in tests
  expect(budget('pawsome-c3').status).toBe('active');
  expect(db.prepare(`SELECT title, body FROM notifications WHERE kind = 'error'`).get()).toEqual({
    title: `Couldn't apply "Pause Spark Ads · UGC" on the ad account`, body: expect.stringMatching(/not connected.*\. Apply it by hand in the ad manager\.$/),
  });

  const writes: unknown[] = [];
  const approval = (kind: string, payload: object) => ({ id: 'x', storeId: 'pawsome', agentId: 'pawsome:ad_strategist', title: 't', reason: 'r', status: 'approved', createdAt: '', action: { kind, payload } }) as ApprovalRequest;
  const write = async (...args: unknown[]) => void writes.push(args);
  await applyAdChange(db, approval('ads.set_budget', { campaignId: 'pawsome-c3', from: budget('pawsome-c3').daily_budget, to: 55 }), write);
  await applyAdChange(db, approval('ads.pause_campaign', { network: 'meta', campaignId: 'pawsome-c3' }), write);
  const network = String(db.prepare(`SELECT network FROM campaigns WHERE id = 'pawsome-c3'`).get()?.network);
  expect(writes).toEqual([['pawsome', network, 'pawsome-c3', { dailyBudget: 55 }], ['pawsome', 'meta', 'pawsome-c3', 'pause']]);
  expect(budget('pawsome-c3')).toEqual({ daily_budget: 55, status: 'paused' });
});

const decided = () => addDays(localDate(), -10);
function approvedChange(id: string, title: string, revenueFactorAfter: number) {
  const day = decided();
  db.prepare(
    `INSERT INTO approvals (id, store_id, agent_id, run_id, title, reason, action_json, status, created_at, decided_at) VALUES (?, 'peak', 'peak:ad_strategist', ?, ?, 'r', ?, 'approved', ?, ?)`,
  ).run(id, `run-${id}`, title, JSON.stringify({ kind: 'ads.pause_campaign', payload: {} }), `${day}T09:00:00Z`, `${day}T12:00:00Z`);
  // What the run that asked for it learned; the outcome moves its confidence.
  writeMemory(db, { storeId: 'peak', agentId: 'peak:ad_strategist', kind: 'learning', text: `Basis for ${title}`, confidence: 0.6, runId: `run-${id}` });
  db.prepare(`UPDATE daily_metrics SET revenue = revenue * ? WHERE store_id = 'peak' AND date BETWEEN ? AND ?`).run(revenueFactorAfter, addDays(day, 1), addDays(day, 3));
}
const outcomes = () => listMemory(db, 'peak').filter((m) => m.tags.includes('outcome'));
const basis = (title: string) => listMemory(db, 'peak').find((m) => m.text === `Basis for ${title}`)?.confidence;

test('outcomes are judged without the dashboard open: the server loop checks them at start', () => {
  approvedChange('unattended', 'Raise Broad', 1.5);
  startOutcomeLoop(db)(); // started, then stopped before the hourly tick
  expect(outcomes().map((m) => m.text)).toEqual([expect.stringMatching(/^"Raise Broad" worked/)]);
});

test("an ad change is judged once: an outcome the owner deleted doesn't come back", () => {
  approvedChange('judged', 'Raise Broad', 1.5);
  checkAdOutcomes(db);
  const [o] = outcomes();
  expect(o?.text).toMatch(/^"Raise Broad" worked/);
  deleteMemory(db, o!.id);
  checkAdOutcomes(db);
  expect(outcomes()).toEqual([]);
});

test("an ad change from a store's demo phase isn't judged on its real numbers", () => {
  approvedChange('demo-era', 'Pause Spark Ads', 1.5);
  once(db, 'activate:peak'); // the store went live after the change was approved
  checkAdOutcomes(db);
  expect(outcomes()).toEqual([]);
  expect(basis('Pause Spark Ads')).toBe(0.6);
});

test("a real store's ad change approved days after it was asked is not applied: its numbers are stale", async () => {
  const writes: unknown[] = [];
  db.prepare(`UPDATE stores SET connected = 1 WHERE id = 'pawsome'`).run();
  db.prepare(`UPDATE campaigns SET daily_budget = 60 WHERE id = 'pawsome-c1'`).run();
  const asked = (daysAgo: number) =>
    ({ id: `old-${daysAgo}`, storeId: 'pawsome', agentId: 'pawsome:ad_strategist', title: 'Raise it', reason: 'r', status: 'approved', createdAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(), decidedAt: new Date().toISOString(), action: { kind: 'ads.set_budget', payload: { campaignId: 'pawsome-c1', from: 60, to: 72 } } }) as ApprovalRequest;
  await applyAdChange(db, asked(5), async (...args) => void writes.push(args));
  expect(budget('pawsome-c1').daily_budget).toBe(60);
  expect(db.prepare(`SELECT body FROM notifications WHERE title LIKE 'Not applied%'`).get()?.body).toBe('It was asked 5 days ago, on numbers that have moved since. Ask the Ad Strategist again for a fresh read.');
  expect(db.prepare(`SELECT 1 FROM done_once WHERE ref = 'not-applied:old-5'`).get()).toBeTruthy(); // not scored either
  await applyAdChange(db, asked(2), async (...args) => void writes.push(args));
  expect(budget('pawsome-c1').daily_budget).toBe(72);
  expect(writes).toEqual([['pawsome', expect.any(String), 'pawsome-c1', { dailyBudget: 72 }]]); // only the fresh one reached the account
});

test('a late approval does not undo a budget the owner moved, nor pause a paused campaign, and is not scored', async () => {
  const writes: unknown[] = [];
  const write = async (...args: unknown[]) => void writes.push(args);
  const approval = (id: string, kind: string, payload: object) => ({ id, storeId: 'pawsome', agentId: 'pawsome:ad_strategist', title: 'Raise it', reason: 'r', status: 'approved', createdAt: '', action: { kind, payload } }) as ApprovalRequest;
  db.prepare(`UPDATE campaigns SET daily_budget = 90 WHERE id = 'pawsome-c1'`).run();
  db.prepare(`UPDATE campaigns SET status = 'paused' WHERE id = 'pawsome-c2'`).run();
  await applyAdChange(db, approval('late', 'ads.set_budget', { campaignId: 'pawsome-c1', from: 60, to: 72 }), write);
  await applyAdChange(db, approval('noop', 'ads.pause_campaign', { campaignId: 'pawsome-c2' }), write);
  await applyAdChange(db, approval('ok', 'ads.set_budget', { campaignId: 'pawsome-c1', from: 90.5, to: 100 }), write); // within 1%
  expect(budget('pawsome-c1').daily_budget).toBe(100);
  expect(db.prepare(`SELECT title, body FROM notifications WHERE title LIKE 'Not applied%'`).all()).toEqual([
    { title: 'Not applied: "Raise it"', body: 'The budget moved since this was asked ($60 → now $90). Ask the Ad Strategist again if it still makes sense.' },
  ]);
  expect(db.prepare(`SELECT ref FROM done_once WHERE ref LIKE 'not-applied:%' ORDER BY ref`).all()).toEqual([{ ref: 'not-applied:late' }, { ref: 'not-applied:noop' }]);

  approvedChange('a-skip', 'Raise it', 3);
  db.prepare(`INSERT INTO done_once (ref, at) VALUES ('not-applied:a-skip', '')`).run();
  await app.request('/api/commander');
  expect(outcomes()).toEqual([]);
});

test('an approved ad change followed by better blended ROAS is a measured win, paid once and remembered', async () => {
  approvedChange('a-win', 'Pause Spark Ads · UGC', 3);
  const xp = () => getAgent(db, 'peak:ad_strategist')!.xp;
  const before = xp();
  await app.request('/api/commander');
  await app.request('/api/commander');
  expect(xp()).toBe(before + 50);
  expect(basis('Pause Spark Ads · UGC')).toBe(0.7); // once, though checked twice
  expect(String(db.prepare(`SELECT reason FROM xp_events WHERE ref = 'win:a-win'`).get()?.reason)).toMatch(/^Measured win: ROAS [\d.]+ → [\d.]+ after "Pause Spark Ads · UGC"$/);
  expect(outcomes()).toEqual([
    expect.objectContaining({
      agentId: 'peak:ad_strategist', kind: 'learning', confidence: 0.7,
      text: expect.stringMatching(/^"Pause Spark Ads · UGC" worked: blended ROAS [\d.]+ → [\d.]+ in the 3 days after\.$/),
      evidence: `7 days before vs 3 days after ${decided()} (request a-win)`,
    }),
  ]);
});

test('a change that did not help is remembered too, without XP', async () => {
  approvedChange('a-flop', 'Raise Prospecting · Broad budget $50 → $80/day', 0.3);
  const before = getAgent(db, 'peak:ad_strategist')!.xp;
  await app.request('/api/achievements');
  expect(getAgent(db, 'peak:ad_strategist')!.xp).toBe(before);
  expect(basis('Raise Prospecting · Broad budget $50 → $80/day')).toBe(0.5);
  expect(outcomes().map((m) => [m.text.replace(/[\d.]+ → [\d.]+/, 'x → y'), m.confidence])).toEqual([
    ['"Raise Prospecting · Broad budget $50 → $80/day" did not help: blended ROAS x → y in the 3 days after.', 0.6],
  ]);
});
