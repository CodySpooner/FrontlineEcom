import { createRunManager, getRun, listMemory, REFLECTION_PROMPT, type FakeStep, fakeEngine } from '@frontline/agents';
import type { AgentRole, AgentRun } from '@frontline/shared';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { decide } from '../approvals';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { seedResearch } from '../research';
import { getStore } from '../stores';
import { toolEnv } from './agents';

// Flow evals: each role's main pipeline, run through the real run manager and tools on seeded demo data, must end
// with the tool calls, the approval kind and the learned memory we expect. The owner approves everything.

let db: Db;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  seedResearch(db);
  createApp(db);
});

const ask = (kind: string, payload: object = {}): FakeStep => ({ call: 'request_approval', input: { title: `Do ${kind}`, reason: 'numbers', kind, payload } });
const FLOWS: { role: AgentRole; steps: FakeStep[]; approval?: string }[] = [
  { role: 'market_analyst', steps: [{ call: 'store_summary' }, { call: 'metrics_timeseries', input: { days: 14 } }, { call: 'research_feed' }] },
  { role: 'ad_strategist', steps: [{ call: 'review_campaigns' }, { call: 'propose_ad_change', input: { campaignId: 'glow-c3', change: 'pause', evidence: '7d ROAS 0.6 vs break-even 2.1' } }], approval: 'ads.pause_campaign' },
  { role: 'product_hunter', steps: [{ call: 'research_feed' }, { call: 'list_competitors' }, ask('store.add_products', { products: [{ researchProductId: 'heatless-curling-ribbon', title: 'Heatless Curling Ribbon', price: 14.9, cost: 1.4 }] })], approval: 'store.add_products' },
  { role: 'store_developer', steps: [{ call: 'list_products' }, ask('publish_page')], approval: 'publish_page' },
  { role: 'copywriter', steps: [{ call: 'list_products' }, { call: 'create_creative', input: { kind: 'copy', headline: 'Glow in 3 steps', primaryText: 'The routine customers swear by.' } }] },
  { role: 'creative_studio', steps: [{ call: 'list_campaigns' }, { call: 'create_creative', input: { kind: 'image', headline: 'Glow', primaryText: 'Serum, soft light', prompt: 'serum on marble' } }], approval: 'creative.generate' },
  { role: 'email_sms', steps: [{ call: 'list_orders' }, ask('email.send_campaign')], approval: 'email.send_campaign' },
  { role: 'operations', steps: [{ call: 'list_orders' }, { call: 'list_products' }] },
];

test.each(FLOWS)('$role pipeline: tools run, approval asked, learning saved', async ({ role, steps, approval }) => {
  const learning = `${role} learned something durable`;
  const engine = fakeEngine((input) =>
    input.task === REFLECTION_PROMPT
      ? [{ type: 'text_delta', text: JSON.stringify([{ kind: 'learning', text: learning, evidence: 'eval', confidence: 0.7 }]) }, { type: 'done', sessionId: 's', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } }]
      : [...steps, { type: 'done', sessionId: 's', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } }],
  );
  const asked: string[] = [];
  const m = createRunManager({
    db, env: toolEnv(db), store: (id) => getStore(db, id), engine,
    onEvent: (_run, e) => {
      if (e.type !== 'approval_request') return;
      asked.push(e.approval.action.kind);
      decide(db, e.approval.id, 'approve');
    },
  });
  const run = m.start(`glow:${role}`, 'eval') as AgentRun;
  await m.idle();

  const saved = getRun(db, run.id)!;
  expect(saved.status, saved.error).toBe('done');
  const results = saved.transcript.flatMap((e) => (e.type === 'tool_result' ? [e] : []));
  const calls = saved.transcript.flatMap((e) => (e.type === 'tool_call' ? [e.name] : []));
  expect(calls).toEqual(steps.map((s) => ('call' in s ? s.call : '')));
  for (const r of results) expect(r.isError, r.output).toBe(false);
  expect(asked).toEqual(approval ? [approval] : []);
  expect(listMemory(db, 'glow').map((x) => x.text)).toContain(learning);
});
