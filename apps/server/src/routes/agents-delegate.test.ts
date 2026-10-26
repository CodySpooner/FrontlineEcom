import { createRunManager, fakeEngine, getRun, listRuns, REFLECTION_PROMPT, type FakeStep, type RunManager } from '@frontline/agents';
import type { AgentEvent, AgentRun } from '@frontline/shared';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { getStore } from '../stores';
import { toolEnv } from './agents';

let db: Db;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  createApp(db);
});

const done: AgentEvent = { type: 'done', sessionId: 's', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } };
const assign = (role: string, task = 'Rewrite the LED mask hero headline; CTR 0.8% vs 1.4% store avg') => ({ call: 'assign_task', input: { role, task } }) as FakeStep;

/** Each role runs `scripts[role]` (nothing for others); reflection learns nothing. */
function manager(scripts: Record<string, FakeStep[]>): RunManager {
  const m: RunManager = createRunManager({
    db, store: (id) => getStore(db, id),
    env: { ...toolEnv(db), startRun: (agentId, task, parent) => m.start(agentId, task, undefined, parent) },
    engine: fakeEngine((input) => (input.task === REFLECTION_PROMPT ? [done] : [...(scripts[input.agent.role] ?? []), done])),
  });
  return m;
}
const outputs = (run: AgentRun) => getRun(db, run.id)!.transcript.flatMap((e) => (e.type === 'tool_result' ? [e.output] : []));

test('an agent hands a task to a squadmate, who cannot pass it on', async () => {
  const m = manager({ market_analyst: [assign('copywriter')], copywriter: [assign('store_developer', 'Ship the new headline to the product page')] });
  const analyst = m.start('glow:market_analyst', 'Daily briefing') as AgentRun;
  await m.idle();
  expect(outputs(analyst)[0]).toMatch(/^Assigned to the Copywriter \(run [\w-]+, queued\)\.$/);

  const [child] = listRuns(db, { agentId: 'glow:copywriter' });
  expect(child).toMatchObject({ parentRunId: analyst.id, status: 'done', task: 'Rewrite the LED mask hero headline; CTR 0.8% vs 1.4% store avg\n\n(Assigned by the Market Analyst.)' });
  expect(outputs(child!)).toEqual(['This task was assigned to you, so it cannot be passed on. Do it, or say what is blocking it.']);
  expect(listRuns(db, { agentId: 'glow:store_developer' })).toEqual([]);
});

test('no self-assigning, at most 3 per run, offline squadmates are reported', async () => {
  db.prepare(`UPDATE agents SET enabled = 0 WHERE id = 'glow:email_sms'`).run();
  const m = manager({ market_analyst: [assign('market_analyst'), assign('email_sms'), assign('copywriter'), assign('operations'), assign('ad_strategist'), assign('product_hunter')] });
  const analyst = m.start('glow:market_analyst', 'Daily briefing') as AgentRun;
  await m.idle();
  expect(outputs(analyst).map((o) => o.replace(/\(run [\w-]+,/, '(run …,'))).toEqual([
    'That is your own role: do it yourself.',
    'Not assigned to the Email & SMS: This agent is offline. Redeploy it first.',
    'Assigned to the Copywriter (run …, queued).',
    'Assigned to the Operations (run …, queued).',
    'Assigned to the Ad Strategist (run …, queued).',
    'Not assigned: 3 tasks per run is the limit.',
  ]);
});
