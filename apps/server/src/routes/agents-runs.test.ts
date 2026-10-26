import { createRunManager, fakeEngine, getAgent, getRun, listRuns, listMemory, REFLECTION_PROMPT, type Engine, type RunManagerOptions } from '@frontline/agents';
import type { AgentRun, LiveMessage } from '@frontline/shared';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { decide } from '../approvals';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { subscribe } from '../live';
import { updateCaps } from '../settings';
import { getStore } from '../stores';
import { runManager, toolEnv } from './agents';

let db: Db;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  createApp(db);
});

const manager = (o: Partial<RunManagerOptions> = {}) => createRunManager({ db, env: toolEnv(db), store: (id) => getStore(db, id), ...o });
const ok = (r: AgentRun | string) => {
  if (typeof r === 'string') throw new Error(r);
  return r;
};
const usage = { inputTokens: 100, outputTokens: 20, costUsd: 0.02 };

/** Every run waits until `open()` (or its cancel). */
function gated() {
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  const engine: Engine = async function* (input) {
    await new Promise<void>((resolve, reject) => {
      gate.then(resolve);
      input.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
    yield { type: 'done', sessionId: `s-${input.agent.id}`, usage };
  };
  return { engine, open };
}

test('a run streams, persists its transcript and usage, and shows the agent as running meanwhile', async () => {
  const m = manager({ engine: fakeEngine() });
  const run = ok(m.start('glow:copywriter', 'Rewrite the hero headline'));
  expect(getAgent(db, 'glow:copywriter')).toMatchObject({ status: 'running', currentTask: 'Rewrite the hero headline' });
  await m.idle();
  const saved = getRun(db, run.id)!;
  expect(saved).toMatchObject({ status: 'done', sessionId: 'fake-glow:copywriter' });
  expect(saved.transcript).toEqual([
    { type: 'text_delta', text: 'Copywriter for Glow Haus: on it — "Rewrite the hero headline".' },
    { type: 'done', sessionId: 'fake-glow:copywriter', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } },
  ]);
  expect(getAgent(db, 'glow:copywriter')?.status).toBe('idle');
});

test('get() returns the transcript so far while a run waits for approval', async () => {
  const m = manager({
    engine: fakeEngine((input) =>
      input.task === REFLECTION_PROMPT
        ? [{ type: 'done', sessionId: 's', usage }]
        : [
            { type: 'text_delta', text: 'Proposing a change.' },
            { call: 'request_approval', input: { title: 'Rewrite hero', reason: 'CTR 0.8%', kind: 'publish_page', payload: {} } },
            { type: 'done', sessionId: 's', usage },
          ],
    ),
  });
  const run = ok(m.start('glow:copywriter', 'Fix the hero'));
  await new Promise((r) => setTimeout(r, 20));
  const live = m.get(run.id)!;
  expect(live.transcript.map((e) => e.type)).toEqual(['text_delta', 'tool_call', 'approval_request']);
  expect(getAgent(db, 'glow:copywriter')).toMatchObject({ status: 'waiting_approval', currentTask: 'Rewrite hero' });
  const request = live.transcript[2];
  if (request?.type === 'approval_request') decide(db, request.approval.id, 'approve');
  await m.idle();
  expect(m.get(run.id)?.transcript.at(-1)?.type).toBe('done');
});

test('global, per-store and per-agent limits queue runs in order', async () => {
  const { engine, open } = gated();
  const m = manager({ engine, concurrency: 2, perStore: 1 });
  const a = ok(m.start('glow:copywriter', 'a'));
  const b = ok(m.start('glow:ad_strategist', 'b')); // same store
  const c = ok(m.start('peak:copywriter', 'c'));
  const d = ok(m.start('pawsome:copywriter', 'd')); // global limit
  const status = () => [a, b, c, d].map((r) => getRun(db, r.id)?.status);
  expect(status()).toEqual(['running', 'queued', 'running', 'queued']);
  open();
  await m.idle();
  expect(status()).toEqual(['done', 'done', 'done', 'done']);
  expect(listRuns(db, { storeIds: ['glow'] }).map((r) => r.task)).toEqual(['b', 'a']);
});

test('cancel stops running and queued runs', async () => {
  const { engine } = gated();
  const m = manager({ engine });
  const running = ok(m.start('glow:copywriter', 'x'));
  const queued = ok(m.start('glow:copywriter', 'y'));
  expect(m.cancel(queued.id)?.status).toBe('cancelled');
  m.cancel(running.id);
  await m.idle();
  expect(getRun(db, running.id)).toMatchObject({ status: 'cancelled', error: 'Cancelled' });
  expect(getRun(db, queued.id)?.startedAt).toBeUndefined();
});

test("the store's daily AI budget blocks new runs once spent", async () => {
  const m = manager({ engine: fakeEngine(() => [{ type: 'done', sessionId: 's', usage }]) });
  updateCaps(db, 'glow', { agentCostPerDay: 0.03 });
  ok(m.start('glow:copywriter', 'one'));
  ok(m.start('glow:ad_strategist', 'two'));
  await m.idle();
  expect(m.start('glow:copywriter', 'three')).toBe("Today's AI budget for this store ($0.03) is used up. Raise it in Settings.");
  expect(typeof m.start('peak:copywriter', 'other store')).toBe('object');
  expect(m.start('glow:nobody', 'x')).toBe('Agent not found');
});

test('runs that used tools reflect, and the learnings become store memory', async () => {
  const learning = '[{"kind":"learning","text":"Glow buyers respond to routine-based bundles","evidence":"AOV +18% on bundles, 30d","confidence":0.7,"tags":["offer"]}]';
  const m = manager({
    engine: fakeEngine((input) =>
      input.task === REFLECTION_PROMPT
        ? [{ type: 'text_delta', text: learning }, { type: 'done', sessionId: 's', usage }]
        : [{ call: 'store_summary' }, { type: 'done', sessionId: 's', usage }],
    ),
  });
  const run = ok(m.start('glow:market_analyst', 'Why is AOV up?'));
  await m.idle();
  const saved = getRun(db, run.id)!;
  expect(saved.usage).toEqual({ inputTokens: 200, outputTokens: 40, costUsd: 0.04 });
  expect(saved.transcript.map((e) => e.type)).toEqual(['tool_call', 'tool_result', 'memory_written', 'done']);
  expect(listMemory(db, 'glow')[0]).toMatchObject({ agentId: 'glow:market_analyst', text: 'Glow buyers respond to routine-based bundles', confidence: 0.7 });
});

test('a follow-up message resumes the previous run session', async () => {
  const m = manager({ engine: fakeEngine() });
  const first = ok(m.start('glow:copywriter', 'Draft 3 headlines'));
  await m.idle();
  expect(m.start('glow:ad_strategist', 'More', first.id)).toBe('That conversation cannot be continued');
  const reply = ok(m.start('glow:copywriter', 'Shorter please', first.id));
  await m.idle();
  expect(getRun(db, reply.id)?.sessionId).toBe(getRun(db, first.id)?.sessionId);
});

test('a restart marks runs that were in flight as interrupted', () => {
  db.prepare(`INSERT INTO agent_runs (id, store_id, agent_id, task, status, created_at) VALUES ('r1', 'glow', 'glow:copywriter', 't', 'running', '2026-10-26T00:00:00Z')`).run();
  manager();
  expect(getRun(db, 'r1')).toMatchObject({ status: 'error', error: 'Interrupted by an app restart' });
});

test('the app run manager publishes runs and their events on the live bus', async () => {
  const seen: LiveMessage[] = [];
  const stop = subscribe((m) => seen.push(m));
  const m = runManager(db);
  ok(m.start('peak:operations', 'Check late orders'));
  await m.idle();
  stop();
  const mine = seen.filter((s) => (s.type === 'run' ? s.run.agentId : s.type === 'run_event' ? s.agentId : '') === 'peak:operations');
  const steps = mine.map((s) => (s.type === 'run' ? `run:${s.run.status}` : s.type === 'run_event' ? `event:${s.event.type}` : ''));
  expect(steps.filter((t, i) => t !== steps[i - 1])).toEqual(['run:queued', 'run:running', 'event:text_delta', 'event:done', 'run:done']);
  expect(seen.some((s) => s.type === 'notification' && s.notification.title === 'Operations finished')).toBe(true);
});
