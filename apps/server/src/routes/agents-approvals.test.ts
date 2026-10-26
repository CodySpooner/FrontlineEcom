import { claudeEngine, fakeEngine, getAgent, runAgent, updateAgent, type ClaudeEngineOptions, type FakeStep, type RunInput } from '@frontline/agents';
import type { AgentEvent, ApprovalRequest } from '@frontline/shared';
import { beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app';
import { decide } from '../approvals';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
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
const ask = (title: string, amountUsd?: number): FakeStep => ({
  call: 'request_approval',
  input: { title, reason: 'ROAS 3.4 for 5 days', kind: 'change_budget', payload: { campaignId: 'c1' }, ...(amountUsd === undefined ? {} : { amountUsd }) },
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
  test('approves on its own within the daily cap, then asks', async () => {
    updateAgent(db, 'pawsome:ad_strategist', { autonomy: 'autopilot', autopilotCapUsd: 100 });
    const events = await run(input('pawsome:ad_strategist'), [ask('Raise budget $60 → $120', 60), ask('Raise budget $120 → $180', 60)]);
    const [auto, asked] = requests(events);
    expect(auto).toMatchObject({ status: 'approved', action: { amountUsd: 60, auto: true }, reason: expect.stringContaining('[autopilot: $60 of $100/day cap, $0 used before]') });
    expect(asked).toMatchObject({ status: 'pending', action: { amountUsd: 60 } });
    expect(asked?.action.auto).toBeUndefined();
    expect(outputs(events)).toEqual(['Auto-approved (autopilot): Raise budget $60 → $120', 'Approved by the owner: Raise budget $120 → $180']);
  });

  test('asks when the amount is unknown or the agent is not on autopilot', async () => {
    updateAgent(db, 'pawsome:ad_strategist', { autonomy: 'autopilot', autopilotCapUsd: 100 });
    const unknown = await run(input('pawsome:ad_strategist'), [ask('Pause ad set')]);
    expect(requests(unknown)[0]?.status).toBe('pending');
    const asking = await run(input('glow:ad_strategist'), [ask('Raise budget', 10)]);
    expect(requests(asking)[0]?.status).toBe('pending');
  });

  test('cap is set and validated through the API', async () => {
    const app = createApp(db);
    const patch = (body: unknown) =>
      app.request('/api/agents/peak%3Aad_strategist', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(await (await patch({ autonomy: 'autopilot', autopilotCapUsd: 200 })).json()).toMatchObject({ autonomy: 'autopilot', autopilotCapUsd: 200 });
    expect((await patch({ autopilotCapUsd: -5 })).status).toBe(400);
    expect(getAgent(db, 'glow:copywriter')?.autopilotCapUsd).toBe(0);
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
