import { fakeEngine, getAgent, once, runAgent, writeMemory, type FakeStep } from '@frontline/agents';
import type { AgentEvent } from '@frontline/shared';
import { beforeEach, expect, test, vi } from 'vitest';
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
  writeMemory(db, { storeId: 'glow', agentId: 'glow:ad_strategist', kind: 'learning', confidence: 0.7, tags: ['outcome', 'ads'], text: '"Pause X" worked: blended ROAS 1.2 → 1.9 in the 3 days after.' });
  const [log] = await run('glow:market_analyst', [{ call: 'squad_log', input: { days: 7 } }]);
  const [requests, rest] = log!.split('\n\nruns:\n');
  const [runs, outcomes] = rest!.split('\n\noutcomes:\n');
  expect(requests).toMatch(/^requests:\ndate,agent,title,decision\n/);
  expect(requests).toMatch(/^\d{4}-\d{2}-\d{2},Ad Strategist,Pause .+,approved$/m);
  expect(runs).toMatch(/^date,agent,task,gist\n\d{4}-\d{2}-\d{2},Copywriter,Write 3 hooks,Copywriter for Glow Haus: on it — "Write 3 hooks"\.$/);
  expect(outcomes).toMatch(/^date,agent,result\n\d{4}-\d{2}-\d{2},Ad Strategist,"Pause X" worked: blended ROAS 1\.2 → 1\.9 in the 3 days after\.$/);
  expect((await run('peak:market_analyst', [{ call: 'squad_log' }]))[0]).toMatch(/\n\nruns:\n\(none\)\n\noutcomes:\n\(none\)$/);
});

test("a live store's log starts when it went live: demo-era work isn't its track record", async () => {
  const at = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  const ask = (id: string, title: string, created: string) =>
    db.prepare(`INSERT INTO approvals (id, store_id, agent_id, title, reason, action_json, status, created_at) VALUES (?, 'glow', 'glow:copywriter', ?, 'r', '{"kind":"tool_use"}', 'pending', ?)`).run(id, title, created);
  ask('demo', 'Demo-era hooks', at(5));
  once(db, 'activate:glow', new Date(at(3))); // went live 3 hours ago
  ask('real', 'Live hooks', at(1));
  const [log] = await run('glow:market_analyst', [{ call: 'squad_log', input: { days: 7 } }]);
  expect(log).toContain('Live hooks');
  expect(log).not.toContain('Demo-era hooks');
});

test("a store ahead of UTC still sees this morning's work: the log window is hours, not the store's date", async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-26T20:00:00Z')); // 10:00 on the 27th in Kiritimati (UTC+14)
  try {
    db.prepare(`UPDATE stores SET connected = 1, timezone = 'Pacific/Kiritimati' WHERE id = 'glow'`).run();
    db.prepare(`INSERT INTO approvals (id, store_id, agent_id, title, reason, action_json, status, created_at) VALUES ('early', 'glow', 'glow:copywriter', 'Early hooks', 'r', '{"kind":"tool_use"}', 'pending', '2026-10-26T19:59:00Z')`).run();
    const [log] = await run('glow:market_analyst', [{ call: 'squad_log', input: { days: 1 } }]);
    expect(log).toContain('2026-10-26,Copywriter,Early hooks,pending');
  } finally {
    vi.useRealTimers();
  }
});
