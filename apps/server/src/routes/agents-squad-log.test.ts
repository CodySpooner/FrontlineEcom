import { fakeEngine, getAgent, runAgent, type FakeStep } from '@frontline/agents';
import type { AgentEvent } from '@frontline/shared';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { decide } from '../approvals';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { getStore } from '../stores';
import { runManager, toolEnv } from './agents';

let db: Db;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  createApp(db);
});
async function run(agentId: string, steps: FakeStep[]) {
  const agent = getAgent(db, agentId)!;
  const out: string[] = [];
  for await (const e of runAgent({ agent, store: getStore(db, agent.storeId)!, task: 't', env: toolEnv(db) }, fakeEngine(() => steps)) as AsyncIterable<AgentEvent>) {
    if (e.type === 'approval_request' && e.approval.status === 'pending') decide(db, e.approval.id, 'approve');
    if (e.type === 'tool_result') out.push(e.output);
  }
  return out;
}

test("the squad log shows the week's requests with their decision and finished runs with their gist", async () => {
  await run('glow:ad_strategist', [{ call: 'propose_ad_change', input: { campaignId: 'glow-c1', change: 'pause', evidence: '7d ROAS 0.6 vs break-even 2.1' } }]);
  const m = runManager(db);
  m.start('glow:copywriter', 'Write 3 hooks');
  await m.idle();
  const [log] = await run('glow:market_analyst', [{ call: 'squad_log', input: { days: 7 } }]);
  const [requests, runs] = log!.split('\n\nruns:\n');
  expect(requests).toMatch(/^requests:\ndate,agent,title,decision\n/);
  expect(requests).toMatch(/^\d{4}-\d{2}-\d{2},Ad Strategist,Pause .+,approved$/m);
  expect(runs).toMatch(/^date,agent,task,gist\n\d{4}-\d{2}-\d{2},Copywriter,Write 3 hooks,Copywriter for Glow Haus: on it — "Write 3 hooks"\.$/);
  expect((await run('peak:market_analyst', [{ call: 'squad_log' }]))[0]).toMatch(/\n\nruns:\n\(none\)$/);
});
