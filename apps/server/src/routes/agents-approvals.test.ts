import { budgetAddedToday, claudeEngine, fakeEngine, getAgent, listMemory, runAgent, updateAgent, type ClaudeEngineOptions, type FakeStep, type RunInput } from '@frontline/agents';
import type { AgentEvent, ApprovalRequest } from '@frontline/shared';
import { beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app';
import { decide } from '../approvals';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { updateCaps } from '../settings';
import { listStores } from '../stores';
import { toolEnv } from './agents';

let db: Db;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  createApp(db);
});

const input = (agentId: string): RunInput => {
  const agent = getAgent(db, agentId)!;
  return { agent, store: listStores(db).find((s) => s.id === agent.storeId)!, task: 't', env: toolEnv(db) };
};
const ask = (title: string, amount?: number): FakeStep => ({
  call: 'request_approval',
  input: { title, reason: 'ROAS 3.4 for 5 days', kind: 'change_budget', payload: { campaignId: 'c1' }, ...(amount === undefined ? {} : { amount }) },
});

/** Runs steps; any pending request is approved by "the owner" so the run can finish. */
async function run(i: RunInput, steps: FakeStep[]) {
  const events: AgentEvent[] = [];
  for await (const e of runAgent(i, fakeEngine(() => steps))) {
    events.push(e);
    if (e.type === 'approval_request' && e.approval.status === 'pending') decide(db, e.approval.id, 'approve');
  }
  return events;
}
const requests = (events: AgentEvent[]) => events.flatMap((e) => (e.type === 'approval_request' ? [e.approval] : []));
const outputs = (events: AgentEvent[]) => events.flatMap((e) => (e.type === 'tool_result' ? [e.output] : []));

describe('autopilot', () => {
  const budget = (id: string) => Number(db.prepare('SELECT daily_budget FROM campaigns WHERE id = ?').get(id)?.daily_budget);
  const raise = (campaignId: string, by: number): FakeStep => ({ call: 'propose_ad_change', input: { campaignId, change: 'budget', newDailyBudget: budget(campaignId) + by, evidence: 'ROAS 3.4 for 5 days' } });
  const autopilot = (agentId: string, storeId: string) => {
    db.prepare(`UPDATE approvals SET status = 'denied' WHERE status = 'pending'`).run(); // the demo's own requests
    updateAgent(db, agentId, { autonomy: 'autopilot' });
    updateCaps(db, storeId, { adSpendChangePerDay: 1000, autopilot: { 'ads.set_budget': { enabled: true, maxUsdPerDay: 100 }, change_budget: { enabled: true, maxUsdPerDay: 100 } } });
  };

  test('approves on its own within the store cap for that kind, then asks', async () => {
    autopilot('pawsome:ad_strategist', 'pawsome');
    const events = await run(input('pawsome:ad_strategist'), [raise('pawsome-c2', 60), raise('pawsome-c3', 60)]);
    const [auto, asked] = requests(events);
    expect(auto).toMatchObject({ status: 'approved', action: { amountUsd: 60, auto: true }, reason: expect.stringContaining('[autopilot: $60 of $100/day cap, $0 used before]') });
    expect(asked).toMatchObject({ status: 'pending', action: { amountUsd: 60 } });
    expect(asked?.action.auto).toBeUndefined();
    expect(outputs(events)).toEqual([expect.stringMatching(/^Auto-approved \(autopilot\): Raise .+\. It will be applied to the ad account\.$/), expect.stringMatching(/^Approved by the owner: Raise /)]);
  });

  test('pauses and cuts count the budget they touch against their autopilot cap; only raises count as added spend', async () => {
    autopilot('pawsome:ad_strategist', 'pawsome');
    updateCaps(db, 'pawsome', { autopilot: { 'ads.pause_campaign': { enabled: true, maxUsdPerDay: 100 }, 'ads.set_budget': { enabled: true, maxUsdPerDay: 1 } } });
    db.prepare(`UPDATE campaigns SET daily_budget = 60 WHERE id IN ('pawsome-c2', 'pawsome-c3')`).run();
    const pause = (campaignId: string): FakeStep => ({ call: 'propose_ad_change', input: { campaignId, change: 'pause', evidence: 'CPA 3x target' } });
    const cut: FakeStep = { call: 'propose_ad_change', input: { campaignId: 'pawsome-c1', change: 'budget', newDailyBudget: 10, evidence: '7d ROAS 0.8 vs break-even 2.1' } };
    const [first, second, cutting] = requests(await run(input('pawsome:ad_strategist'), [pause('pawsome-c2'), pause('pawsome-c3'), cut]));
    expect(first).toMatchObject({ status: 'approved', action: { amountUsd: 60, auto: true } });
    expect(second).toMatchObject({ status: 'pending', action: { amountUsd: 60 } }); // $60 + $60 > the $100 pause cap
    expect(cutting).toMatchObject({ status: 'pending', action: { amountUsd: expect.any(Number), payload: { addedUsd: 0 } } }); // a cut of $1+ is past the $1 budget cap
    expect(cutting!.action.amountUsd).toBeGreaterThan(1);
    expect(budgetAddedToday(db, 'pawsome')).toBe(0);
  });

  test("a pause of a campaign with no campaign budget (ad set or lifetime budgets) isn't $0: the owner decides", async () => {
    autopilot('pawsome:ad_strategist', 'pawsome');
    updateCaps(db, 'pawsome', { autopilot: { 'ads.pause_campaign': { enabled: true, maxUsdPerDay: 0 } } });
    db.prepare(`UPDATE campaigns SET daily_budget = 0 WHERE id = 'pawsome-c2'`).run();
    const [paused] = requests(await run(input('pawsome:ad_strategist'), [{ call: 'propose_ad_change', input: { campaignId: 'pawsome-c2', change: 'pause', evidence: 'CPA 3x target' } }]));
    expect(paused).toMatchObject({ status: 'pending' });
    expect(paused!.action).not.toHaveProperty('amountUsd');
  });

  test('an agent the owner takes off autopilot mid-run asks from then on', async () => {
    autopilot('pawsome:ad_strategist', 'pawsome');
    const started = input('pawsome:ad_strategist'); // the run's copy says autopilot
    updateAgent(db, 'pawsome:ad_strategist', { autonomy: 'ask' });
    expect(requests(await run(started, [raise('pawsome-c2', 10)]))[0]).toMatchObject({ status: 'pending' });
    updateAgent(db, 'pawsome:ad_strategist', { autonomy: 'suggest' });
    expect(outputs(await run(started, [raise('pawsome-c3', 10)]))).toEqual(['Not sent: your autonomy is "suggest". Put the recommendation in your answer instead.']);
  });

  test('a raise asked before midnight and approved after it counts toward the day it was approved', async () => {
    autopilot('pawsome:ad_strategist', 'pawsome');
    updateAgent(db, 'pawsome:ad_strategist', { autonomy: 'ask' });
    await run(input('pawsome:ad_strategist'), [raise('pawsome-c2', 40)]); // the owner approves it now
    const lastNight = new Date();
    lastNight.setHours(0, 0, 0, 0);
    db.prepare(`UPDATE approvals SET created_at = ? WHERE status = 'approved'`).run(new Date(lastNight.getTime() - 600_000).toISOString());
    expect(budgetAddedToday(db, 'pawsome')).toBe(40);
  });

  test('asks for a kind with no rule, a hand-made request, or an agent not on autopilot', async () => {
    autopilot('pawsome:ad_strategist', 'pawsome');
    const status = async (agentId: string, step: FakeStep) => requests(await run(input(agentId), [step]))[0]?.status;
    expect(await status('pawsome:ad_strategist', { call: 'propose_ad_change', input: { campaignId: 'pawsome-c2', change: 'pause', evidence: 'CPA 3x target' } })).toBe('pending');
    expect(await status('pawsome:ad_strategist', ask('Raise budget', 5))).toBe('pending'); // the model's own amount never auto-approves
    updateCaps(db, 'glow', { autopilot: { 'ads.set_budget': { enabled: true, maxUsdPerDay: 100 } } });
    expect(await status('glow:ad_strategist', raise('glow-c1', 10))).toBe('pending');
  });
});

test("request_approval refuses kinds the app carries out, so a hand-made one can't skip their tool's checks", async () => {
  updateAgent(db, 'pawsome:operations', { autonomy: 'autopilot' });
  updateCaps(db, 'pawsome', { autopilot: { 'ads.set_budget': { enabled: true, maxUsdPerDay: 100 } } });
  const before = db.prepare(`SELECT daily_budget FROM campaigns WHERE id = 'pawsome-c1'`).get();
  const forged = (kind: string, payload: object): FakeStep => ({ call: 'request_approval', input: { title: 'Tidy order tags', reason: 'r', kind, payload, amount: 0 } });
  const product = String(db.prepare(`SELECT id FROM products WHERE store_id = 'pawsome' LIMIT 1`).get()?.id);
  const events = await run(input('pawsome:operations'), [
    forged('ads.set_budget', { campaignId: 'pawsome-c1', to: 5000 }),
    forged('store.set_price', { productId: product, to: 0.01 }),
    forged('store.publish_theme', { themeId: '123' }),
  ]);
  expect(requests(events)).toEqual([]);
  expect(outputs(events)).toEqual([
    "Not sent: ads.set_budget requests come from propose_ad_change, which checks the numbers and the owner's caps. Use it instead.",
    "Not sent: store.set_price requests come from propose_price_change, which checks the numbers and the owner's caps. Use it instead.",
    "Not sent: store.publish_theme requests come from draft_theme_change, which checks the numbers and the owner's caps. Use it instead.",
  ]);
  expect(db.prepare(`SELECT daily_budget FROM campaigns WHERE id = 'pawsome-c1'`).get()).toEqual(before);
});

describe('canUseTool', () => {
  /** A fake SDK that asks permission for one unlisted tool, the way the CLI does, and reports the answer. */
  const askingFor = (tool: string, toolInput: Record<string, unknown>): NonNullable<ClaudeEngineOptions['query']> => (params) =>
    (async function* () {
      const decision = await params.options.canUseTool!(tool, toolInput, { signal: new AbortController().signal } as never);
      yield { type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: decision?.behavior } } } as never;
      yield { type: 'result', subtype: 'success', is_error: false, result: '', session_id: 's', total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } as never;
    })();

  test.each([
    ['approve', 'allow'],
    ['deny', 'deny'],
  ] as const)('owner %s → %s', async (decision, behavior) => {
    const events: AgentEvent[] = [];
    let request: ApprovalRequest | undefined;
    for await (const e of runAgent(input('glow:store_developer'), claudeEngine({ query: askingFor('mcp__shopify__update_product', { id: 'p1', price: 29 }) }))) {
      events.push(e);
      if (e.type === 'approval_request') {
        request = e.approval;
        decide(db, e.approval.id, decision);
      }
    }
    expect(request).toMatchObject({ title: 'Allow shopify: update_product', action: { kind: 'tool_use', payload: { tool: 'mcp__shopify__update_product' } } });
    expect(events.find((e) => e.type === 'text_delta')).toEqual({ type: 'text_delta', text: behavior });
  });

  test.each([
    ['mcp__meta_ads__update_adset', { adset_id: '1', daily_budget: 90000 }],
    ['mcp__meta_ads__update_campaign', { id: '2', status: 'ACTIVE' }],
    ['mcp__meta_ads__set_bid', { id: '3', amount: 4 }],
  ])('%s is refused without asking: spend changes go through propose_ad_change', async (tool, toolInput) => {
    const events: AgentEvent[] = [];
    for await (const e of runAgent(input('glow:ad_strategist'), claudeEngine({ query: askingFor(tool, toolInput) }))) events.push(e);
    expect(requests(events)).toEqual([]);
    expect(events.find((e) => e.type === 'text_delta')).toEqual({ type: 'text_delta', text: 'deny' });
  });
});

test("the owner's no is remembered for the squad; a request that expired with its run isn't", async () => {
  const add = db.prepare(`INSERT INTO approvals (id, store_id, agent_id, title, reason, action_json, status, created_at) VALUES (?, 'glow', 'glow:ad_strategist', ?, ?, '{"kind":"ads.set_budget"}', 'pending', ?)`);
  add.run('n1', 'Raise Prospecting budget', 'ROAS 3.4 for 5 days', new Date().toISOString());
  add.run('n2', 'Pause Retargeting', 'CPA up 40% [Expired: the agent run ended before a decision.]', new Date().toISOString());
  add.run('n3', 'Launch Halloween bundle', 'Seasonal demand +30%', new Date().toISOString());
  decide(db, 'n1', 'deny');
  decide(db, 'n2', 'deny');
  decide(db, 'n3', 'deny', 'We never discount the starter kit');
  await new Promise((r) => setImmediate(r));
  expect(listMemory(db, 'glow').filter((m) => m.tags.includes('denied'))).toEqual([
    expect.objectContaining({ text: expect.stringMatching(/^The owner turned down "Launch Halloween bundle" on \d{4}-\d\d-\d\d: We never discount the starter kit\.$/) }),
    expect.objectContaining({
      agentId: 'glow:ad_strategist', kind: 'preference', evidence: 'ROAS 3.4 for 5 days',
      text: expect.stringMatching(/^The owner turned down "Raise Prospecting budget" on \d{4}-\d\d-\d\d\.$/),
    }),
  ]);
});
