import { randomUUID } from 'node:crypto';
import { advanceMissions, createRunManager, createTeam, fakeEngine, getRun, getTeam, REFLECTION_PROMPT, TEAM_PLAN, TEAM_SYNTHESIS, type Engine, type FakeScript, type RunManager } from '@frontline/agents';
import type { AgentEvent, AgentRun, ConfigView, PrAgentRow, PrTask } from '@frontline/shared';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { upsertListing } from '../product-research/catalog';
import { refreshProduct } from '../product-research/evaluate';
import { runManager, toolEnv } from '../routes/agents';
import { updateCaps } from '../settings';
import { getStore } from '../stores';

// Settings → Agents & Providers → Advanced (ST-22, decision 9): retries and runs at once reach the run queue and teams.
let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  app = createApp(db);
});
afterEach(() => vi.useRealTimers());

const send = (method: string, path: string, body?: unknown) => app.request(path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
/** Saves run limits (`retries`, `atOnce`, `perStore`) over the workspace version read now. */
async function limits(set: Record<string, number>) {
  const view = (await (await send('GET', '/api/config')).json()) as ConfigView;
  const r = await send('PATCH', '/api/config', { documents: [{ doc: 'workspace', version: view.versions.workspace, set: Object.fromEntries(Object.entries(set).map(([k, v]) => [`runs.${k}`, v])) }] });
  return { status: r.status, body: (await r.json()) as { error?: string; field?: string } };
}
const manager = (engine: Engine) => createRunManager({ db, env: toolEnv(db), store: (id) => getStore(db, id), engine });
const ok = (r: AgentRun | string) => {
  if (typeof r === 'string') throw new Error(r);
  return r;
};
const usage = { inputTokens: 1, outputTokens: 1, costUsd: 0 };
/** Every run waits until `open()`. */
function gated() {
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  const engine: Engine = async function* () {
    await gate;
    yield { type: 'done', sessionId: 's', usage };
  };
  return { engine, open };
}
const status = (...runs: AgentRun[]) => runs.map((r) => getRun(db, r.id)?.status);

test("retries 0: a busy service isn't tried again; 1: once", async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const busy: AgentEvent = { type: 'error', message: 'Claude is rate limited right now.', code: 'rate_limit' };
  let calls = 0;
  const m = manager(async function* () {
    calls++;
    yield busy;
  });
  expect((await limits({ retries: 0 })).status).toBe(200);
  const first = ok(m.start('glow:copywriter', 'Draft'));
  await vi.advanceTimersByTimeAsync(60_000);
  await m.idle();
  expect([calls, getRun(db, first.id)?.status]).toEqual([1, 'error']);

  calls = 0;
  expect((await limits({ retries: 1 })).status).toBe(200);
  ok(m.start('glow:copywriter', 'Draft again'));
  await vi.advanceTimersByTimeAsync(60_000);
  await m.idle();
  expect(calls).toBe(2);
});

test("a total of 1: a second store's run queues until the first is done", async () => {
  // Per store is never above the total: a save that would leave it so is refused, on its field.
  expect(await limits({ atOnce: 1 })).toEqual({ status: 400, body: { error: "Runs at once per store can't be above the total (1).", field: 'runs.perStore' } });
  expect((await limits({ atOnce: 1, perStore: 1 })).status).toBe(200);
  const { engine, open } = gated();
  const m = manager(engine);
  const glow = ok(m.start('glow:copywriter', 'a'));
  const peak = ok(m.start('peak:copywriter', 'b'));
  expect(status(glow, peak)).toEqual(['running', 'queued']);
  open();
  await m.idle();
  expect(status(glow, peak)).toEqual(['done', 'done']);
});

test('per store 1: a second run on the store queues; lowered with 2 going, both go on and the next waits', async () => {
  const { engine, open } = gated();
  const m = manager(engine);
  const a = ok(m.start('glow:copywriter', 'a'));
  const b = ok(m.start('glow:ad_strategist', 'b'));
  expect(status(a, b)).toEqual(['running', 'running']); // the defaults: 2 per store
  // The impact says it, from the runs going now.
  const impact = (await (await send('POST', '/api/config/impact', { documents: [{ doc: 'workspace', version: 0, set: { 'runs.perStore': 1, 'runs.atOnce': 2 } }] })).json()) as { impacts: { text: string }[] };
  expect(impact.impacts.map((i) => i.text)).toEqual(['Applies to the next run that starts; 2 runs going now keep going']);

  expect((await limits({ perStore: 1 })).status).toBe(200);
  const c = ok(m.start('glow:market_analyst', 'c'));
  const d = ok(m.start('peak:copywriter', 'd')); // another store's slot is its own
  expect(status(a, b, c, d)).toEqual(['running', 'running', 'queued', 'running']);
  open();
  await m.idle();
  expect(status(a, b, c, d)).toEqual(['done', 'done', 'done', 'done']);
});

test("a store budget under a cent a run at its runs at once is refused, naming the limit", async () => {
  const m = manager(async function* () {
    yield { type: 'done', sessionId: 's', usage };
  });
  updateCaps(db, 'glow', { agentCostPerDay: 0.015 }); // a run gets at most the cap ÷ runs at once per store
  expect(m.start('glow:copywriter', 'a')).toBe("Today's AI budget for this store ($0.015) is under a cent a run at 2 runs at once per store. Raise it in Settings.");
  expect((await limits({ perStore: 1 })).status).toBe(200);
  ok(m.start('glow:copywriter', 'a'));
  await m.idle();
});

test('a team made at 2 at once runs at most the lowered per-store value at the next pump', async () => {
  const done = { type: 'done', sessionId: 's', usage } as const;
  const say = (text: string) => [{ type: 'text_delta', text } as const, done];
  const fence = (o: unknown) => `\n\n\`\`\`json\n${JSON.stringify(o)}\n\`\`\``;
  let team = '';
  let most = 0;
  const script: FakeScript = (input) => {
    if (input.task === REFLECTION_PROMPT) return [done];
    if (input.task.startsWith(TEAM_PLAN)) {
      const [, a, b] = [...input.task.matchAll(/^- id (\S+):/gm)].map((x) => x[1]!);
      return say(`Three angles.${fence({ tasks: ['t1', 't2', 't3'].map((id, i) => ({ id, assignee: i === 1 ? b : a, task: `Hero line ${id}`, expected: 'One line' })) })}`);
    }
    if (input.task.startsWith(TEAM_SYNTHESIS)) return say('The synthesis.');
    // A task starting: how many of the team's tasks are queued or going now, this one included.
    most = Math.max(most, Number(db.prepare(`SELECT count(*) AS n FROM agent_runs WHERE team_id = ? AND status IN ('queued', 'running') AND task NOT LIKE ? AND task NOT LIKE ?`).get(team, `${TEAM_PLAN}%`, `${TEAM_SYNTHESIS}%`)!.n));
    return say(`A hero line.${fence({ summary: 'A hero line', output: 'A hero line, in full.', evidence: [], open_questions: [], disagrees_with: [] })}`);
  };
  const m: RunManager = createRunManager({
    db, store: (id) => getStore(db, id), engine: fakeEngine(script),
    env: { ...toolEnv(db), startRun: (agentId, task, parent) => m.start(agentId, task, undefined, parent) },
    onRun: (run) => void (['done', 'error', 'cancelled'].includes(run.status) && advanceMissions(db, m.start)),
  });
  const made = createTeam(db, getStore(db, 'glow')!, { clientRequestId: randomUUID(), title: 'Spring launch', objective: 'Plan the spring launch for the LED mask.', participants: [{ type: 'market_analyst' }, { type: 'copywriter' }, { type: 'copywriter' }] }, []);
  if ('status' in made) throw new Error(made.error);
  team = made.team.id;
  expect(made.team.maxConcurrent).toBe(2);

  expect((await limits({ perStore: 1 })).status).toBe(200);
  expect(getTeam(db, team)?.maxConcurrent).toBe(1); // what the team page shows now
  advanceMissions(db, m.start);
  await m.idle();
  expect(getTeam(db, team)?.status).toBe('done');
  expect(most).toBe(1);
});

test("Product Research's queue lines name the store's runs at once", async () => {
  expect((await limits({ perStore: 1 })).status).toBe(200);
  const p = upsertListing(db, { source: 'cj', sourceRef: '1', title: 'Dog travel water bowl', category: 'Pet Supplies > Travel', url: 'https://cjdropshipping.com/p/1', origin: 'ingest' }).productId;
  refreshProduct(db, p, new Date());
  const r = await send('POST', '/api/pr/tasks?store=pawsome', { clientRequestId: randomUUID(), productId: p, type: 'product_hunter', mode: 'new', instructions: 'Check the margin at $29.' });
  const t = (await r.json()) as PrTask;
  await runManager(db).idle();
  // The conversation mid-turn on a row the manager isn't running: the store's one slot is taken.
  db.prepare(`UPDATE agent_runs SET status = 'running' WHERE id = ?`).run(t.runId);
  const [row] = (await (await send('GET', '/api/pr/agents?store=pawsome')).json()) as PrAgentRow[];
  expect(row!.busy).toMatchObject({ slotsFull: true, perStore: 1 });
  db.prepare(`UPDATE agent_runs SET status = 'queued' WHERE id = ?`).run(t.runId);
  expect(await (await send('GET', `/api/pr/tasks/${t.id}?store=pawsome`)).json()).toMatchObject({ status: 'queued', detail: 'Waiting for a free store slot (1 per store)' });
  db.prepare(`UPDATE agent_runs SET status = 'done' WHERE id = ?`).run(t.runId);
});
