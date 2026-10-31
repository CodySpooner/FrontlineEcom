import { chargeCredits, creditsToday, fakeEngine, getAgent, listCreatives, runAgent, type FakeStep, type RunInput } from '@frontline/agents';
import type { StoreUsage } from '@frontline/shared';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { decide } from '../approvals';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { toolEnv } from '../routes/agents';
import { updateCaps } from '../settings';
import { getStore } from '../stores';

// Usage: fixes and meters (ST-24a, decision 10).
let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  app = createApp(db);
});

const input = (agentId: string): RunInput => {
  const agent = getAgent(db, agentId)!;
  return { agent, store: getStore(db, agent.storeId)!, task: 't', env: toolEnv(db) };
};
const ad = (kind: string): FakeStep => ({ call: 'create_creative', input: { kind, headline: 'Glow in 3 steps', primaryText: 'The routine.', prompt: 'Model applying serum, soft morning light', aspect: '9:16' } });

test('a credits cap lowered while a render waits refuses it after approval', async () => {
  updateCaps(db, 'glow', { higgsfieldCreditsPerDay: 30 });
  const outputs: string[] = [];
  for await (const e of runAgent(input('glow:creative_studio'), fakeEngine(() => [ad('video')]))) {
    if (e.type === 'approval_request') updateCaps(db, 'glow', { higgsfieldCreditsPerDay: 10 }, 1), decide(db, e.approval.id, 'approve');
    if (e.type === 'tool_result') outputs.push(e.output);
  }
  expect(outputs[0]).toMatch(/, but not generated: today's credit cap is 10 now \(it was 30\) and 0 are used\. Suggest it for tomorrow instead\.$/);
  expect([creditsToday(db, 'glow'), listCreatives(db, { storeIds: ['glow'] })]).toEqual([0, []]); // nothing charged, nothing saved
});

test("the credits meter is today's renders plus the ones waiting on the owner", async () => {
  chargeCredits(db, 'glow', 20);
  const ask = (id: string, credits: number) =>
    db.prepare(`INSERT INTO approvals (id, store_id, agent_id, title, reason, action_json, status, created_at) VALUES (?, 'glow', 'glow:creative_studio', 't', 'r', ?, 'pending', ?)`).run(id, JSON.stringify({ kind: 'creative.generate', payload: { credits } }), new Date().toISOString());
  ask('a', 2);
  ask('b', 40);
  db.prepare(`INSERT INTO approvals (id, store_id, agent_id, title, reason, action_json, status, created_at) VALUES ('c', 'glow', 'glow:creative_studio', 't', 'r', ?, 'rejected', ?)`).run(JSON.stringify({ kind: 'creative.generate', payload: { credits: 9 } }), new Date().toISOString()); // turned down: out of it
  const [glow] = (await (await app.request('/api/usage?stores=glow')).json()) as StoreUsage[];
  expect(glow).toMatchObject({ storeId: 'glow', credits: 20, creditsPending: 42, rendersPending: 2 });
});
