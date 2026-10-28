import { createConversation, createRunManager, fakeEngine, getRun, resolveType, runAgent, seatDefault, updateAgent, type FakeStep } from '@frontline/agents';
import type { AgentEvent, AgentRun, ApprovalRequest } from '@frontline/shared';
import { beforeEach, expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { approvalsHook, getApproval } from '../approvals';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { getStore } from '../stores';
import { runHooks, toolEnv } from './agents';

let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  app = createApp(db);
});

const answer = (id: string, store: string, text: unknown) => app.request(`/api/approvals/${id}/answer?store=${store}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
const pending = () => Number(db.prepare(`SELECT count(*) AS n FROM approvals WHERE status = 'pending'`).get()?.n);
const done: FakeStep = { type: 'done', sessionId: 's1', usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 } };
/** A glow Copywriter conversation whose turns run `steps` on the scripted engine. */
function asking(steps: FakeStep[]) {
  const m = createRunManager({ db, env: toolEnv(db), store: (id) => getStore(db, id), engine: fakeEngine((i) => (i.task.endsWith('Write the spring hero line') ? [...steps, done] : [done])), ...runHooks(db) }); // not the reflection turn
  const store = getStore(db, 'glow')!;
  const type = resolveType(db, 'glow', 'copywriter')!;
  const c = createConversation(db, store, type, seatDefault(store, type), { title: 'Spring hero line' });
  const run = m.start(c.agentId, 'Write the spring hero line', undefined, undefined, { conversationId: c.id }) as AgentRun;
  return { m, c, run };
}
const asked = (m: ReturnType<typeof asking>['m'], runId: string) =>
  m.get(runId)!.transcript.flatMap((e) => (e.type === 'approval_request' && e.approval.action.kind === 'question' ? [e.approval] : [])).at(0);

test('a suggest seat asks: the conversation reads Needs reply, the notice links to it, and the answer from its store reaches the agent', async () => {
  updateAgent(db, 'glow:copywriter', { autonomy: 'suggest' });
  const { m, c, run } = asking([{ call: 'ask_owner', input: { question: 'Lead with the serum or the LED mask?' } }]);
  await vi.waitFor(() => expect(asked(m, run.id)).toBeDefined());
  const q = asked(m, run.id)!;
  expect(q).toMatchObject({ status: 'pending', title: 'Lead with the serum or the LED mask?', conversationId: c.id, action: { kind: 'question' } });
  expect(await (await app.request(`/api/conversations/${c.id}?store=glow`)).json()).toMatchObject({ state: 'waiting_for_input' });
  expect(db.prepare(`SELECT link FROM notifications WHERE title = ?`).get(q.title)).toEqual({ link: `/agents/c/${c.id}?store=glow` });
  expect((await answer(q.id, 'peak', 'The mask')).status).toBe(409); // another store's
  expect((await answer(q.id, 'glow', '  ')).status).toBe(400);
  const r = await answer(q.id, 'glow', ' The LED mask ');
  expect(await r.json()).toMatchObject({ status: 'approved', decisionNote: 'The LED mask', conversationId: c.id });
  await m.idle();
  expect(getRun(db, run.id)).toMatchObject({ status: 'done' });
  expect(getRun(db, run.id)!.transcript.find((e) => e.type === 'tool_result')).toMatchObject({ output: 'The owner answered: The LED mask' });
  expect((await answer(q.id, 'glow', 'Again')).status).toBe(409); // answered once
});

test("request_approval can't ask a question or save a finding, a run outside a conversation can't ask, and /answer answers only questions", async () => {
  const store = getStore(db, 'glow')!;
  const before = pending();
  const events: AgentEvent[] = [];
  const steps: FakeStep[] = [
    { call: 'request_approval', input: { title: 'Which product?', reason: 'Two candidates', kind: 'question', payload: {} } },
    { call: 'request_approval', input: { title: 'Save the hook finding', reason: 'It worked', kind: 'kb.save', payload: {} } },
    { call: 'ask_owner', input: { question: 'Which product leads?' } },
  ];
  for await (const e of runAgent({ agent: { id: 'glow:copywriter', storeId: 'glow', role: 'copywriter', status: 'idle' }, store, task: 't', env: toolEnv(db) }, fakeEngine(() => steps))) events.push(e);
  expect(events.flatMap((e) => (e.type === 'tool_result' ? [e.output] : []))).toEqual([
    'Not sent: question requests come from ask_owner. Use it instead.',
    'Not sent: kb.save requests come from save_finding. Use it instead.',
    'Not sent: only a run in a conversation can ask, and this one has none. End your answer with the question instead.',
  ]);
  expect(pending()).toBe(before);
  const budget = approvalsHook(db).create({ storeId: 'glow', agentId: 'glow:ad_strategist', title: 'Raise Spring by $20/day', reason: 'ROAS 3.1', action: { kind: 'ads.set_budget', payload: {} } });
  expect((await answer(budget.id, 'glow', 'Yes')).status).toBe(409);
  expect(getApproval(db, budget.id)).toMatchObject({ status: 'pending' });
  expect((await answer('nope', 'glow', 'Yes')).status).toBe(409);
});

test('a question still waiting when its run is stopped is closed, unanswered', async () => {
  const { m, run } = asking([{ call: 'ask_owner', input: { question: 'Which tone: playful or clinical?' } }]);
  await vi.waitFor(() => expect(asked(m, run.id)).toBeDefined());
  m.cancel(run.id);
  await m.idle();
  expect(getRun(db, run.id)).toMatchObject({ status: 'cancelled' });
  expect(getApproval(db, asked(m, run.id)!.id)).toMatchObject({ status: 'denied' } satisfies Partial<ApprovalRequest>);
});
