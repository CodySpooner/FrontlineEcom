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

test("a run retried after a restart doesn't hand out again what it assigned before", async () => {
  const now = new Date().toISOString();
  const add = db.prepare(`INSERT INTO agent_runs (id, store_id, agent_id, task, status, parent_run_id, created_at) VALUES (?, 'glow', ?, ?, ?, ?, ?)`);
  add.run('p', 'glow:market_analyst', 'Daily briefing', 'running', null, now); // cut off by the restart
  add.run('c', 'glow:copywriter', 'Rewrite the hero', 'done', 'p', now); // what it had handed out
  manager({ market_analyst: [assign('copywriter'), assign('operations')] }); // starting up retries it
  await new Promise((r) => setTimeout(r, 50));
  const [retry] = listRuns(db, { agentId: 'glow:market_analyst' }).filter((r) => r.id !== 'p');
  expect(outputs(retry!).map((o) => o.replace(/\(run [\w-]+,/, '(run …,'))).toEqual([
    "Already assigned to the Copywriter before the app restarted (run …, done): don't assign it again.",
    'Assigned to the Operations (run …, queued).',
  ]);
});

test("a conversation turn the owner resumes after a restart doesn't hand out again what it assigned before", async () => {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO agent_configs (id, store_id, agent_id, runtime, tools_json, knowledge_json, permissions_json, created_at) VALUES ('cfg', 'glow', 'glow:market_analyst', 'demo', '["assign_task"]', '["store"]', '{"saveFindings":"off"}', ?)`).run(now);
  db.prepare(`INSERT INTO conversations (id, store_id, config_id, title, created_at, updated_at, last_activity_at) VALUES ('chat', 'glow', 'cfg', 'Briefing', ?, ?, ?)`).run(now, now, now);
  const add = db.prepare(`INSERT INTO agent_runs (id, store_id, agent_id, task, status, parent_run_id, conversation_id, config_id, created_at) VALUES (?, 'glow', ?, ?, ?, ?, ?, ?, ?)`);
  add.run('p', 'glow:market_analyst', 'Plan the week', 'running', null, 'chat', 'cfg', now); // cut off by the restart
  add.run('c', 'glow:copywriter', 'Rewrite the hero', 'done', 'p', null, null, now);
  const m = manager({ market_analyst: [assign('copywriter'), assign('operations')] });
  expect(listRuns(db, { agentId: 'glow:market_analyst' })).toHaveLength(1); // not run again on its own
  const resumed = m.start('glow:market_analyst', 'Plan the week', undefined, undefined, { conversationId: 'chat', retryOf: 'p' }) as AgentRun;
  await m.idle();
  expect(outputs(resumed).map((o) => o.replace(/\(run [\w-]+,/, '(run …,'))).toEqual([
    "Already assigned to the Copywriter before the app restarted (run …, done): don't assign it again.",
    'Assigned to the Operations (run …, queued).',
  ]);
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
