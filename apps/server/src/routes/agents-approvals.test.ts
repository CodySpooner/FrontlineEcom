import { claudeEngine, fakeEngine, getAgent, listMemory, runAgent, updateAgent, type ClaudeEngineOptions, type FakeStep, type RunInput } from '@frontline/agents';
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
  const autopilot = (agentId: string, storeId: string) => {
    updateAgent(db, agentId, { autonomy: 'autopilot' });
    updateCaps(db, storeId, { autopilot: { change_budget: { enabled: true, maxUsdPerDay: 100 } } });
  };

  test('approves on its own within the store cap for that kind, then asks', async () => {
    autopilot('pawsome:ad_strategist', 'pawsome');
    const events = await run(input('pawsome:ad_strategist'), [ask('Raise budget $60 → $120', 60), ask('Raise budget $120 → $180', 60)]);
    const [auto, asked] = requests(events);
    expect(auto).toMatchObject({ status: 'approved', action: { amountUsd: 60, auto: true }, reason: expect.stringContaining('[autopilot: $60 of $100/day cap, $0 used before]') });
    expect(asked).toMatchObject({ status: 'pending', action: { amountUsd: 60 } });
    expect(asked?.action.auto).toBeUndefined();
    const byHand = `. This app can't carry out "change_budget" itself: end your answer with numbered steps the owner can follow to do it.`;
    expect(outputs(events)).toEqual([`Auto-approved (autopilot): Raise budget $60 → $120${byHand}`, `Approved by the owner: Raise budget $120 → $180${byHand}`]);
  });

  test('asks when the amount is unknown, the kind has no rule, or the agent is not on autopilot', async () => {
    autopilot('pawsome:ad_strategist', 'pawsome');
    const status = async (agentId: string, step: FakeStep) => requests(await run(input(agentId), [step]))[0]?.status;
    const publish: FakeStep = { call: 'request_approval', input: { title: 'Publish page', reason: 'r', kind: 'publish_page', payload: {}, amount: 5 } };
    expect(await status('pawsome:ad_strategist', ask('Pause ad set'))).toBe('pending');
    expect(await status('pawsome:ad_strategist', publish)).toBe('pending');
    updateCaps(db, 'glow', { autopilot: { change_budget: { enabled: true, maxUsdPerDay: 100 } } });
    expect(await status('glow:ad_strategist', ask('Raise budget', 10))).toBe('pending');
  });
});

describe('canUseTool', () => {
  /** A fake SDK that asks permission for one unlisted tool, the way the CLI does, and reports the answer. */
  const askingQuery: NonNullable<ClaudeEngineOptions['query']> = (params) =>
    (async function* () {
      const decision = await params.options.canUseTool!('mcp__shopify__update_product', { id: 'p1', price: 29 }, { signal: new AbortController().signal } as never);
      yield { type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: decision?.behavior } } } as never;
      yield { type: 'result', subtype: 'success', is_error: false, result: '', session_id: 's', total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } as never;
    })();

  test.each([
    ['approve', 'allow'],
    ['deny', 'deny'],
  ] as const)('owner %s → %s', async (decision, behavior) => {
    const events: AgentEvent[] = [];
    let request: ApprovalRequest | undefined;
    for await (const e of runAgent(input('glow:store_developer'), claudeEngine({ query: askingQuery }))) {
      events.push(e);
      if (e.type === 'approval_request') {
        request = e.approval;
        decide(db, e.approval.id, decision);
      }
    }
    expect(request).toMatchObject({ title: 'Allow shopify: update_product', action: { kind: 'tool_use', payload: { tool: 'mcp__shopify__update_product' } } });
    expect(events.find((e) => e.type === 'text_delta')).toEqual({ type: 'text_delta', text: behavior });
  });
});

test("the owner's no is remembered for the squad; a request that expired with its run isn't", async () => {
  const add = db.prepare(`INSERT INTO approvals (id, store_id, agent_id, title, reason, action_json, status, created_at) VALUES (?, 'glow', 'glow:ad_strategist', ?, ?, '{"kind":"ads.set_budget"}', 'pending', ?)`);
  add.run('n1', 'Raise Prospecting budget', 'ROAS 3.4 for 5 days', new Date().toISOString());
  add.run('n2', 'Pause Retargeting', 'CPA up 40% [Expired: the agent run ended before a decision.]', new Date().toISOString());
  decide(db, 'n1', 'deny');
  decide(db, 'n2', 'deny');
  await new Promise((r) => setImmediate(r));
  expect(listMemory(db, 'glow').filter((m) => m.tags.includes('denied'))).toEqual([
    expect.objectContaining({
      agentId: 'glow:ad_strategist', kind: 'preference', evidence: 'ROAS 3.4 for 5 days',
      text: expect.stringMatching(/^The owner turned down "Raise Prospecting budget" on \d{4}-\d\d-\d\d\.$/),
    }),
  ]);
});
