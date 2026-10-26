import { createRunManager, fakeEngine, listNicheLearnings, runAgent, getAgent, type Engine, type FakeStep } from '@frontline/agents';
import type { AgentEvent, ApprovalDecision, NicheLearning, Store } from '@frontline/shared';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { decide } from '../approvals';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { getStore } from '../stores';
import { toolEnv } from './agents';

let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  app = createApp(db);
});

const promote = (text = 'Bundles of 2+ devices lift AOV ~25% in at-home skincare'): FakeStep => ({
  call: 'promote_niche_learning',
  input: { text, evidence: 'Glow Haus, Aug–Oct: bundle AOV $78 vs $62 single, 412 orders' },
});
async function run(steps: FakeStep[], answer: ApprovalDecision = 'approve') {
  const agent = getAgent(db, 'glow:market_analyst')!;
  const out: string[] = [];
  const kinds: string[] = [];
  for await (const e of runAgent({ agent, store: getStore(db, 'glow')!, task: 't', env: toolEnv(db) }, fakeEngine(() => steps)) as AsyncIterable<AgentEvent>) {
    if (e.type === 'approval_request') kinds.push(e.approval.action.kind), decide(db, e.approval.id, answer);
    if (e.type === 'tool_result') out.push(e.output);
  }
  return { out, kinds };
}

test('a learning already waiting for the owner is not proposed twice', async () => {
  const text = 'Bundles of 2+ devices lift AOV ~25% in at-home skincare';
  db.prepare(`INSERT INTO approvals (id, store_id, agent_id, title, reason, action_json, status, created_at) VALUES ('p1', 'glow', 'glow:market_analyst', 't', 'r', ?, 'pending', ?)`)
    .run(JSON.stringify({ kind: 'niche.promote_learning', payload: { niche: 'beauty', text, evidence: 'e' } }), new Date().toISOString());
  const { out, kinds } = await run([promote(` ${text.toUpperCase()} `)]);
  expect([out[0], kinds]).toEqual(['Already waiting for the owner: the same learning was proposed for this niche.', []]);
});

test("a demo store's learning isn't shared with a niche that has a live store", async () => {
  db.prepare(`UPDATE stores SET connected = 1 WHERE id = 'peak'`).run(); // live, another niche: demo-only beauty, so fine
  expect((await run([promote()], 'deny')).kinds).toEqual(['niche.promote_learning']);
  db.prepare(`UPDATE stores SET connected = 1, niche = 'beauty' WHERE id = 'peak'`).run();
  const { out, kinds } = await run([promote()]);
  expect([out[0], kinds]).toEqual(["Not sent: this store runs on demo data, and a learning shared with its niche reaches the owner's live stores too.", []]);
});

test("an approved learning reaches every same-niche store's prompt, once", async () => {
  expect((await run([promote()], 'deny')).out[0]).toMatch(/^Denied by the owner/);
  expect(listNicheLearnings(db)).toEqual([]);

  const { out, kinds } = await run([promote()]);
  expect(kinds).toEqual(['niche.promote_learning']);
  expect(out[0]).toMatch(/^Approved by the owner: .*\. Every beauty store's squad now sees it\.$/);
  expect((await run([promote()])).out[0]).toBe('Already shared with this niche.');

  const res = await app.request('/api/stores', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Dew Lab', platform: 'shopify', niche: 'beauty' }) });
  const dew = (await res.json()) as Store;
  const prompts: Record<string, string> = {};
  const engine: Engine = async function* (input) {
    prompts[input.store.id] = input.systemPrompt ?? '';
    yield { type: 'done', sessionId: 's', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } };
  };
  const m = createRunManager({ db, env: toolEnv(db), store: (id) => getStore(db, id), engine });
  m.start(`${dew.id}:copywriter`, 'Write a headline');
  m.start('pawsome:copywriter', 'Write a headline');
  await m.idle();
  expect(prompts[dew.id]).toContain('# Learned across beauty stores (owner-approved)\n- Bundles of 2+ devices lift AOV ~25% in at-home skincare Evidence: Glow Haus');
  expect(prompts.pawsome).not.toContain('Learned across');

  expect(await (await app.request(`/api/niche-learnings?store=${dew.id}`)).json()).toHaveLength(1);
  expect(await (await app.request('/api/niche-learnings?store=pawsome')).json()).toEqual([]);
  expect(await (await app.request('/api/niche-learnings?store=nope')).json()).toEqual([]);
  const [learning] = (await (await app.request('/api/niche-learnings?niche=beauty')).json()) as NicheLearning[];
  expect(learning).toMatchObject({ niche: 'beauty', storeId: 'glow', text: 'Bundles of 2+ devices lift AOV ~25% in at-home skincare' });
  expect((await app.request(`/api/niche-learnings/${learning!.id}`, { method: 'DELETE' })).status).toBe(204);
  expect((await app.request(`/api/niche-learnings/${learning!.id}`, { method: 'DELETE' })).status).toBe(404);
  expect(listNicheLearnings(db)).toEqual([]);
});
