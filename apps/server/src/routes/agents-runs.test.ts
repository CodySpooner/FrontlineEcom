import { createRunManager, fakeEngine, getAgent, getRun, listRuns, listMemory, REFLECTION_PROMPT, updateAgent, type Engine, type FakeStep, type RunManagerOptions } from '@frontline/agents';
import type { AgentEvent, AgentRun, LiveMessage } from '@frontline/shared';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { decide } from '../approvals';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { subscribe } from '../live';
import { updateCaps } from '../settings';
import { getStore } from '../stores';
import { runHooks, runManager, toolEnv } from './agents';

let db: Db;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  createApp(db);
});

const manager = (o: Partial<RunManagerOptions> = {}) => createRunManager({ db, env: toolEnv(db), store: (id) => getStore(db, id), ...o });

test('tool outputs of runs older than 90 days are trimmed at startup; the text, tool calls and recent runs stay whole', () => {
  const transcript = JSON.stringify([
    { type: 'tool_call', id: 't1', name: 'list_orders', input: { days: 30 } },
    { type: 'tool_result', id: 't1', output: 'x'.repeat(4000), isError: false },
    { type: 'tool_result', id: 't2', output: 'short', isError: false },
    { type: 'tool_result', id: 't3', output: 'y'.repeat(4000), isError: false },
    { type: 'text_delta', text: 'Orders are fine.' },
  ]);
  const add = db.prepare(`INSERT INTO agent_runs (id, store_id, agent_id, task, status, created_at, transcript_json) VALUES (?, 'glow', 'glow:operations', 't', 'done', ?, ?)`);
  db.prepare(`DELETE FROM done_once WHERE ref = 'transcripts-trimmed-to'`).run(); // a first startup (setup already ran one)
  add.run('old', new Date(Date.now() - 91 * 86_400_000).toISOString(), transcript);
  add.run('new', new Date(Date.now() - 89 * 86_400_000).toISOString(), transcript);
  add.run('damaged', new Date(Date.now() - 92 * 86_400_000).toISOString(), `[{"type":"text_delta"${' '.repeat(9000)}`); // skipped, startup goes on
  manager();
  const events = (id: string) => JSON.parse(String(db.prepare('SELECT transcript_json FROM agent_runs WHERE id = ?').get(id)?.transcript_json)) as AgentEvent[];
  const outputs = (id: string) => events(id).flatMap((e) => (e.type === 'tool_result' ? [e.output.length] : []));
  expect(outputs('old')).toEqual([226, 5, 226]);
  expect(events('old')[0]).toEqual({ type: 'tool_call', id: 't1', name: 'list_orders', input: { days: 30 } });
  expect(events('old').at(-1)).toEqual({ type: 'text_delta', text: 'Orders are fine.' });
  expect(outputs('new')).toEqual([4000, 5, 4000]);
  // The next startup reads only runs that turned 90 since: one behind the mark is left alone.
  add.run('behind', new Date(Date.now() - 95 * 86_400_000).toISOString(), transcript);
  manager();
  expect(outputs('behind')).toEqual([4000, 5, 4000]);
});
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
  // Demo engine: the Copywriter saves one ad copy for real, reads the summary, then replies quoting it.
  expect(saved.transcript.map((e) => e.type)).toEqual(['tool_call', 'tool_result', 'tool_call', 'tool_result', 'text_delta', 'done']);
  expect(saved.transcript[0]).toMatchObject({ name: 'create_creative', input: { kind: 'copy', cta: 'Shop now' } });
  expect(saved.transcript[2]).toMatchObject({ name: 'store_summary', input: { range: 30 } });
  expect(saved.transcript[4]).toMatchObject({
    text: expect.stringMatching(/^Copywriter for Glow Haus: on it — "Rewrite the hero headline"\. Last 30 days: [\d,]+ USD revenue, -?[\d,]+ USD profit, ROAS [\d.]+, \d+ orders\./),
  });
  expect(listMemory(db, 'glow')).toEqual([]); // reflection learns nothing in demo mode
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

test("taking an agent offline stops its running and queued work, not the squad's", async () => {
  const { engine, open } = gated();
  const m = manager({ engine });
  const running = ok(m.start('glow:copywriter', 'x'));
  const queued = ok(m.start('glow:copywriter', 'y'));
  const other = ok(m.start('glow:ad_strategist', 'z'));
  m.cancelAgent('glow:copywriter');
  open();
  await m.idle();
  expect([running, queued, other].map((r) => getRun(db, r.id)?.status)).toEqual(['cancelled', 'cancelled', 'done']);
});

test("a run waiting on the owner's decision doesn't hold the store's slot", async () => {
  const usageDone = { type: 'done', sessionId: 's', usage } as const;
  const m = manager({
    perStore: 1,
    engine: fakeEngine((input) => (input.task === 'ask' ? [{ call: 'request_approval', input: { title: 'Scale Broad TOF', reason: 'ROAS 3.2 for 7 days', kind: 'k', payload: {} } }, usageDone] : [usageDone])),
  });
  const asking = ok(m.start('glow:ad_strategist', 'ask'));
  const pending = () => db.prepare(`SELECT id FROM approvals WHERE run_id = ? AND status = 'pending'`).get(asking.id)?.id;
  for (let i = 0; i < 50 && !pending(); i++) await new Promise((r) => setImmediate(r));
  const other = ok(m.start('glow:copywriter', 'other'));
  for (let i = 0; i < 50 && getRun(db, other.id)?.status !== 'done'; i++) await new Promise((r) => setImmediate(r));
  expect(getRun(db, other.id)?.status).toBe('done');
  expect(getRun(db, asking.id)?.status).toBe('running');
  expect(typeof m.start('glow:ad_strategist', 'again')).toBe('object'); // queued: the same agent never runs twice at once
  decide(db, String(pending()), 'approve');
  await m.idle();
  expect(getRun(db, asking.id)?.status).toBe('done');
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

test("an agent's own daily budget caps its runs inside the store's; the rest of the squad keeps the store's", async () => {
  const budgets: (number | undefined)[] = [];
  const m = manager({ engine: fakeEngine((input) => (budgets.push(input.budgetUsd), [{ type: 'done', sessionId: 's', usage }])) });
  const patch = (body: unknown) => createApp(db).request('/api/agents/glow%3Acopywriter', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  updateCaps(db, 'glow', { agentCostPerDay: 1 });
  expect(await (await patch({ dailyBudgetUsd: 0.3 })).json()).toMatchObject({ dailyBudgetUsd: 0.3 });
  expect((await patch({ dailyBudgetUsd: -1 })).status).toBe(400);
  db.prepare(`INSERT INTO agent_runs (id, store_id, agent_id, task, status, cost_usd, created_at) VALUES ('r0', 'glow', 'glow:copywriter', 't', 'done', 0.2, ?)`).run(new Date().toISOString());
  ok(m.start('glow:copywriter', 'one'));
  ok(m.start('glow:ad_strategist', 'two'));
  await m.idle();
  expect(budgets.map((b) => b?.toFixed(2))).toEqual(['0.10', '0.50']); // the copywriter's $0.30 less $0.20 spent; half the store's $1
  db.prepare(`UPDATE agent_runs SET cost_usd = 0.3 WHERE id = 'r0'`).run();
  expect(m.start('glow:copywriter', 'three')).toBe("Today's budget for this agent ($0.3) is used up. Raise it in its settings.");
  expect(typeof m.start('glow:market_analyst', 'four')).toBe('object');
  const cleared = (await (await patch({ dailyBudgetUsd: null })).json()) as object;
  expect(cleared).not.toHaveProperty('dailyBudgetUsd');
  expect(typeof m.start('glow:copywriter', 'five')).toBe('object');
  await m.idle();
});

test("a run stops once its agent's spend today passes the agent's own budget", async () => {
  const m = manager({
    engine: async function* (input) {
      input.onSpend?.(0.6);
      yield { type: 'text_delta', text: 'Looking' };
      await new Promise((r) => (input.signal?.aborted ? r(0) : input.signal?.addEventListener('abort', r)));
      yield { type: 'error', message: 'aborted' };
    },
  });
  updateAgent(db, 'glow:copywriter', { dailyBudgetUsd: 0.5 });
  const run = ok(m.start('glow:copywriter', 'x'));
  await m.idle();
  expect(getRun(db, run.id)).toMatchObject({ status: 'error', error: "Stopped: today's budget for this agent ($0.5) is used up. Raise it in its settings." });
});

test("each run is told what is left of the store's daily AI budget", async () => {
  const budgets: (number | undefined)[] = [];
  const m = manager({ engine: fakeEngine((input) => (budgets.push(input.budgetUsd), [{ type: 'done', sessionId: 's', usage }])) });
  updateCaps(db, 'glow', { agentCostPerDay: 1 });
  db.prepare(`INSERT INTO agent_runs (id, store_id, agent_id, task, status, cost_usd, created_at) VALUES ('r0', 'glow', 'glow:copywriter', 't', 'done', 0.75, ?)`).run(new Date().toISOString());
  ok(m.start('glow:copywriter', 'one'));
  await m.idle();
  expect(budgets).toEqual([0.25]);
});

test('what a run spends is saved as it goes, so a cancelled run still counts against the daily AI budget', async () => {
  const budgets: (number | undefined)[] = [];
  const m = manager({
    perStore: 1,
    engine: async function* (input) {
      budgets.push(input.budgetUsd);
      if (input.task === 'next') return yield { type: 'done', sessionId: 's', usage };
      input.onSpend?.(0.3);
      yield { type: 'text_delta', text: 'Looking…' };
      await new Promise((r) => (input.signal?.aborted ? r(0) : input.signal?.addEventListener('abort', r)));
    },
  });
  updateCaps(db, 'glow', { agentCostPerDay: 1 });
  const long = ok(m.start('glow:copywriter', 'long'));
  for (let i = 0; i < 50 && !getRun(db, long.id)?.usage.costUsd; i++) await new Promise((r) => setImmediate(r));
  expect(getRun(db, long.id)?.usage.costUsd).toBe(0.3); // in flight: an app restart now would keep it
  m.cancel(long.id);
  await m.idle();
  expect(getRun(db, long.id)).toMatchObject({ status: 'cancelled', usage: { costUsd: 0.3 } });
  ok(m.start('glow:copywriter', 'next'));
  await m.idle();
  expect(budgets.map((b) => b?.toFixed(2))).toEqual(['1.00', '0.70']);
});

test("a run stops once the store's spend today passes the cap, whatever share it started with", async () => {
  const m = manager({
    engine: async function* (input) {
      input.onSpend?.(0.4);
      yield { type: 'text_delta', text: 'Looking' };
      input.onSpend?.(0.75); // with $0.30 spent elsewhere today (a paused run that came back), past the $1 cap
      await new Promise((r) => (input.signal?.aborted ? r(0) : input.signal?.addEventListener('abort', r)));
      yield { type: 'error', message: 'aborted' };
    },
  });
  updateCaps(db, 'glow', { agentCostPerDay: 1 });
  db.prepare(`INSERT INTO agent_runs (id, store_id, agent_id, task, status, cost_usd, created_at) VALUES ('r0', 'glow', 'glow:ad_strategist', 't', 'running', 0.3, ?)`).run(new Date().toISOString());
  const run = ok(m.start('glow:copywriter', 'x'));
  await m.idle();
  expect(getRun(db, run.id)).toMatchObject({ status: 'error', error: "Stopped: today's AI budget for this store ($1) is used up. Raise it in Settings.", usage: { costUsd: 0.75 } });
});

test('a crash result reporting $0 keeps what the run was seen spending', async () => {
  const m = manager({
    engine: async function* (input) {
      input.onSpend?.(1.2);
      yield { type: 'error', message: 'Claude Code process exited with code 1', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } };
    },
  });
  const run = ok(m.start('glow:copywriter', 'x'));
  await m.idle();
  expect(getRun(db, run.id)).toMatchObject({ status: 'error', usage: { costUsd: 1.2 } });
});

test('a lower spend report later in the run (a resumed reflection) does not erase the earlier estimate', async () => {
  const m = manager({
    engine: async function* (input) {
      input.onSpend?.(0.5);
      input.onSpend?.(0.05);
      yield { type: 'error', message: 'stopped', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } };
    },
  });
  const run = ok(m.start('glow:copywriter', 'x'));
  await m.idle();
  expect(getRun(db, run.id)?.usage?.costUsd).toBe(0.5);
});

test("runs side by side share the store's daily AI budget instead of each getting all of it", async () => {
  const budgets: (number | undefined)[] = [];
  const m = manager({ engine: fakeEngine((input) => (budgets.push(input.budgetUsd), [{ type: 'done', sessionId: 's', usage: { ...usage, costUsd: 0.1 } }])) });
  updateCaps(db, 'glow', { agentCostPerDay: 1 });
  ok(m.start('glow:copywriter', 'one'));
  ok(m.start('glow:ad_strategist', 'two'));
  await m.idle();
  expect(budgets).toEqual([0.5, 0.5]); // a share each (perStore 2), together the cap

  db.prepare(`UPDATE agent_runs SET cost_usd = 0.4 WHERE store_id = 'glow'`).run(); // $0.80 spent, $0.20 left
  ok(m.start('glow:copywriter', 'three'));
  ok(m.start('glow:ad_strategist', 'four')); // nothing unheld: waits for 'three', then gets what it left
  await m.idle();
  expect(budgets.slice(2).map((b) => b!.toFixed(2))).toEqual(['0.20', '0.10']);
  expect(db.prepare(`SELECT status FROM agent_runs WHERE task = 'four'`).get()?.status).toBe('done');
});

test("the reflection gets what the run left of today's budget, and is skipped when nothing is left", async () => {
  const budgets: (number | undefined)[] = [];
  const m = manager({
    engine: fakeEngine((input) => {
      budgets.push(input.budgetUsd);
      const cost = input.task === REFLECTION_PROMPT ? 0 : Number(input.task);
      return input.task === REFLECTION_PROMPT ? [{ type: 'done', sessionId: 's', usage }] : [{ call: 'store_summary' }, { type: 'done', sessionId: 's', usage: { ...usage, costUsd: cost } }];
    }),
  });
  updateCaps(db, 'glow', { agentCostPerDay: 1 });
  ok(m.start('glow:copywriter', '0.4'));
  await m.idle();
  expect(budgets.map((b) => b?.toFixed(2))).toEqual(['0.50', '0.10']); // a run's share is half the cap (perStore 2)
  ok(m.start('glow:copywriter', '0.7'));
  await m.idle();
  expect(budgets.slice(2).map((b) => b?.toFixed(2))).toEqual(['0.50']); // this run spends it all: no reflection call
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
  expect(db.prepare('SELECT run_id FROM store_memory WHERE text = ?').get('Glow buyers respond to routine-based bundles')).toEqual({ run_id: run.id });
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

test('a follow-up whose session is gone goes on from a recap of the last exchange', async () => {
  const tasks: string[] = [];
  const engine: Engine = async function* (input) {
    if (input.resume) {
      yield { type: 'error', message: `No conversation found with session ID: ${input.resume}` };
      return;
    }
    tasks.push(input.task);
    yield { type: 'text_delta', text: 'Glow your way to morning' };
    yield { type: 'done', sessionId: `s${tasks.length}`, usage };
  };
  const m = manager({ engine });
  const first = ok(m.start('glow:copywriter', 'Draft 3 headlines'));
  await m.idle();
  const reply = ok(m.start('glow:copywriter', 'Shorter please', first.id));
  await m.idle();
  expect(getRun(db, reply.id)).toMatchObject({ status: 'done', sessionId: 's2' });
  expect(tasks[1]).toContain('asked: Draft 3 headlines\nYou answered: Glow your way to morning\n\nNow: Shorter please');
});

test('an account problem (usage limit) is told once a day, not once per failed run', async () => {
  const limit = "You've hit your Claude usage limit for now. Agents can run again once it resets.";
  const m = manager({ engine: async function* () { yield { type: 'error', message: limit }; }, ...runHooks(db) });
  for (const a of ['glow:copywriter', 'glow:operations', 'peak:operations']) ok(m.start(a, 'Daily check'));
  await m.idle();
  expect(db.prepare(`SELECT body FROM notifications WHERE kind = 'error'`).all()).toEqual([{ body: limit }]);
});

test("the store's scheduled jobs are in the prompt, so a run doesn't hand off what one does anyway", async () => {
  db.prepare(`UPDATE automation_rules SET enabled = 0 WHERE store_id = 'pawsome'`).run();
  db.prepare(`UPDATE automation_rules SET enabled = 1 WHERE store_id = 'pawsome' AND name IN ('Daily campaign review', 'Daily order check')`).run();
  let prompt = '';
  const m = manager({ engine: async function* (input) { prompt = input.systemPrompt ?? ''; yield { type: 'done', sessionId: 's', usage }; } });
  ok(m.start('pawsome:market_analyst', 'Daily briefing'));
  await m.idle();
  expect(prompt).toContain(
    "# Scheduled jobs\nThese run on their own (cron, the owner's computer time); don't assign_task what one of them does today:\n" +
      '- Daily campaign review (Ad Strategist, cron 30 8 * * *)\n- Daily order check (Operations, cron 0 10 * * *)\n\n',
  );
});

test("the store's open requests are in the prompt, so nobody asks twice", async () => {
  db.prepare(`DELETE FROM approvals WHERE store_id = 'pawsome'`).run();
  db.prepare(`INSERT INTO approvals (id, store_id, agent_id, title, reason, action_json, status, created_at) VALUES ('w1', 'pawsome', 'pawsome:product_hunter', 'Add 2 products', 'r', '{"kind":"store.add_products"}', 'pending', '2026-10-24T09:00:00Z')`).run();
  let prompt = '';
  const m = manager({ engine: async function* (input) { prompt = input.systemPrompt ?? ''; yield { type: 'done', sessionId: 's', usage }; } });
  ok(m.start('pawsome:product_hunter', 'Daily product scan'));
  await m.idle();
  expect(prompt).toContain("# Waiting for the owner\nAlready asked in this store; don't ask for these again:\n- Add 2 products (Product Hunter, 2026-10-24)\n\nToday is");
});

test('a follow-up and a reflection are told what their session already cost; a run that stops early is charged', async () => {
  const seen: (number | undefined)[] = [];
  const engine: Engine = async function* (input) {
    seen.push(input.sessionCostUsd);
    if (input.task === 'Look' && !input.resume) yield { type: 'tool_call', id: 't', name: 'store_summary', input: {} };
    if (input.task === 'Too big') {
      yield { type: 'error', message: 'Stopped: the run hit its 40-turn limit before finishing. Give it a narrower task.', usage: { ...usage, costUsd: 0.4 } };
      return;
    }
    yield { type: 'done', sessionId: 's1', usage };
  };
  const m = manager({ engine });
  const first = ok(m.start('glow:copywriter', 'Look'));
  await m.idle();
  ok(m.start('glow:copywriter', 'More', first.id));
  await m.idle();
  expect(seen).toEqual([undefined, 0.02, 0.04]); // run, its reflection (after the run's $0.02), the follow-up (run + reflection)
  const big = ok(m.start('glow:market_analyst', 'Too big'));
  await m.idle();
  expect(getRun(db, big.id)).toMatchObject({ status: 'error', usage: { costUsd: 0.4 } });
});

test("deleting a store stops its runs, including one waiting on the owner, and nothing reports a run that's gone", async () => {
  const seen: (AgentRun | undefined)[] = [];
  const ask: FakeStep = { call: 'request_approval', input: { title: 'Message 3 late customers', reason: 'r', kind: 'customer_message', payload: {} } };
  const m = manager({ engine: fakeEngine(() => [ask]), perStore: 1, onRun: (r) => seen.push(r) });
  ok(m.start('peak:operations', 'Check late orders'));
  ok(m.start('peak:copywriter', 'Write hooks')); // queued behind it
  const waiting = () => db.prepare(`SELECT 1 FROM approvals WHERE store_id = 'peak' AND status = 'pending' AND title = 'Message 3 late customers'`).get();
  for (let i = 0; i < 20 && !waiting(); i++) await new Promise((r) => setImmediate(r));
  expect(waiting()).toBeTruthy();
  m.cancelStore('peak');
  db.prepare(`DELETE FROM stores WHERE id = 'peak'`).run();
  await m.idle();
  expect(seen.every(Boolean)).toBe(true);
  expect(db.prepare(`SELECT count(*) AS n FROM agent_runs WHERE store_id = 'peak'`).get()?.n).toBe(0);
});

test('a restart marks runs that were in flight as interrupted', () => {
  db.prepare(`INSERT INTO agent_runs (id, store_id, agent_id, task, status, created_at) VALUES ('r1', 'glow', 'glow:copywriter', 't', 'running', '2026-01-01T00:00:00Z')`).run();
  manager();
  expect(getRun(db, 'r1')).toMatchObject({ status: 'error', error: 'Interrupted by an app restart' });
});

test('runs cut off by a restart in the last 6 hours run again, once; chat follow-ups and older runs do not', async () => {
  const add = db.prepare(`INSERT INTO agent_runs (id, store_id, agent_id, task, status, resume, created_at) VALUES (?, 'glow', ?, ?, 'running', ?, ?)`);
  const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
  add.run('r1', 'glow:market_analyst', 'Daily briefing', null, ago(1));
  add.run('r2', 'glow:copywriter', 'Old task', null, ago(8));
  add.run('r3', 'glow:operations', 'Shorter please', 's-1', ago(1));
  await manager({ engine: fakeEngine() }).idle();
  const retries = () => db.prepare(`SELECT id, agent_id, task, status FROM agent_runs WHERE id NOT IN ('r1', 'r2', 'r3')`).all();
  expect(retries()).toEqual([expect.objectContaining({ agent_id: 'glow:market_analyst', task: 'Daily briefing', status: 'done' })]);

  db.prepare(`UPDATE agent_runs SET status = 'running' WHERE id = ?`).run(String(retries()[0]!.id)); // the retry is cut off too
  await manager({ engine: fakeEngine() }).idle();
  expect(retries()).toHaveLength(1);
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
  expect(steps.filter((t, i) => t !== steps[i - 1])).toEqual([
    'run:queued', 'run:running', 'event:tool_call', 'event:tool_result', 'event:tool_call', 'event:tool_result', 'event:text_delta', 'event:done', 'run:done',
  ]);
  const done = seen.find((s) => s.type === 'notification' && s.notification.title === 'Operations finished');
  expect(done?.type === 'notification' && done.notification.body).toMatch(/^Operations for .+: on it — "Check late orders"\.$/); // the answer's gist
});

test('requests a run can no longer act on expire when it ends; ones the server carries out stay open', async () => {
  runManager(db); // registers the approvals watcher that applies ad changes
  const pending = () => db.prepare(`SELECT id, status, reason, json_extract(action_json, '$.kind') AS kind FROM approvals WHERE run_id IS NOT NULL ORDER BY created_at`).all();
  const waitFor = async (n: number) => {
    for (let i = 0; i < 100 && pending().length < n; i++) await new Promise((r) => setImmediate(r));
  };
  const steps: Record<string, FakeStep[]> = {
    creative_studio: [{ call: 'create_creative' as const, input: { kind: 'image', headline: 'Glow', primaryText: 'Serum, soft light', prompt: 'serum on marble' } }],
    ad_strategist: [{ call: 'propose_ad_change' as const, input: { campaignId: 'glow-c1', change: 'pause', evidence: '7d ROAS 0.6 vs break-even 2.1' } }],
  };
  const m = manager({ engine: fakeEngine((input) => (input.task === REFLECTION_PROMPT ? [] : steps[input.agent.role] ?? [])) });
  const creative = ok(m.start('glow:creative_studio', 'Make an ad'));
  const ad = ok(m.start('glow:ad_strategist', 'Review ads'));
  await waitFor(2);
  m.cancel(creative.id);
  m.cancel(ad.id);
  await m.idle();
  const [c, a] = pending() as { id: string; status: string; reason: string; kind: string }[];
  expect(c).toMatchObject({ kind: 'creative.generate', status: 'denied', reason: expect.stringMatching(/\[Expired: the agent run ended before a decision\.\]$/) });
  expect(a).toMatchObject({ kind: 'ads.pause_campaign', status: 'pending' });
  decide(db, a!.id, 'approve');
  await new Promise((r) => setImmediate(r));
  expect(db.prepare(`SELECT status FROM campaigns WHERE id = 'glow-c1'`).get()?.status).toBe('paused');

  // An app restart closes in-run requests of the runs it interrupts.
  const before = manager({ engine: fakeEngine((input) => (input.task === REFLECTION_PROMPT ? [] : steps.creative_studio!)) });
  const stuck = ok(before.start('glow:creative_studio', 'Make another ad'));
  await waitFor(3);
  const after = manager({ engine: fakeEngine(() => []) }); // its retry of the cut-off run asks nothing
  expect(pending().at(-1)).toMatchObject({ kind: 'creative.generate', status: 'denied' });
  before.cancel(stuck.id);
  await before.idle();
  await after.idle();
});

test('long tool outputs are cut in the stored transcript (the agent still saw all of it)', async () => {
  const m = manager({ engine: fakeEngine(() => [{ call: 'list_orders', input: { days: 90, limit: 500 } }, { type: 'done', sessionId: 's', usage }]) });
  const run = ok(m.start('glow:operations', 'orders'));
  await m.idle();
  const result = getRun(db, run.id)!.transcript.find((e) => e.type === 'tool_result') as { output: string };
  expect(result.output).toMatch(/\n… \(\d+ more characters\)$/);
  expect(result.output.length).toBeLessThan(4100);
});
