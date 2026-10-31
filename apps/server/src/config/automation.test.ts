// ST-29 (decision 14): "Pause new automation" stops the starts the app makes by itself and never the owner's; cancelling
// the runs automations started says what really happened to each.
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCard, createRunManager, ensureCategoryPath, fakeEngine, getRun, type Engine } from '@frontline/agents';
import type { AutomationRule, AutomationStatus, ConfigImpact } from '@frontline/shared';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { startScheduler, type RunTask } from '../automations';
import { once, openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { autonomousResearch } from '../kb/autonomy';
import { proposeKbPromotions } from '../kb/promote';
import { toolEnv } from '../routes/agents';
import { getStore } from '../stores';
import { cancelRunning, RUN_STARTS } from './automation';

let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 26, 8, 0, 30));
  db = openDb();
  seedDemo(db, '2026-10-26');
  app = createApp(db);
});
afterEach(() => vi.useRealTimers());

const send = async <T>(method: string, path: string, body?: unknown) => {
  const r = await app.request(path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: (await r.json()) as T };
};
/** Settings → Automation & Approvals' switch: the workspace document over the version read. */
const pause = async (on: boolean) => {
  const { versions } = (await send<{ versions: Record<string, number> }>('GET', '/api/config')).body;
  expect((await send('PATCH', '/api/config', { documents: [{ doc: 'workspace', version: versions.workspace ?? 0, set: { 'automation.paused': on } }] })).status).toBe(200);
};
const rule = async (body: Record<string, unknown> = {}) =>
  (await send<AutomationRule>('POST', '/api/automations', { storeId: 'glow', name: 'Daily brief', approval: 'auto', trigger: { type: 'schedule', cron: '0 9 * * *' }, action: { type: 'agent_task', agentId: 'glow:market_analyst', task: 'Write the daily brief' }, ...body })).body;
const manager = (engine: Engine) => createRunManager({ db, env: toolEnv(db), store: (id) => getStore(db, id), engine });
/** Every run waits until its cancel. */
const held: Engine = async function* (input) {
  await new Promise<void>((_, reject) => input.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
};

test('every line that starts an agent run is in the call-site table, with its decision', () => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const START = /(?:\bruns|runManager\(db\))\.start\(|\b(?:ctx|deps)\.start(?:Run)?\(|(?<![\w.])start(?:Run)?\((?!\))/;
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
  const found = ['apps/server/src', 'packages/agents/src'].flatMap((dir) =>
    walk(join(root, dir))
      .filter((f) => f.endsWith('.ts') && !/\.test\.ts$|[\\/]fake-|config[\\/]automation\.ts$/.test(f)) // the table quotes them
      .flatMap((f) =>
        readFileSync(f, 'utf8')
          .split('\n')
          .filter((l) => START.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l) && !/\bfunction start(Run)?\(/.test(l))
          .map((line) => ({ file: f.slice(root.length).replaceAll('\\', '/'), line })),
      ),
  );
  const unclassified = found.filter((s) => RUN_STARTS.filter((e) => e.file === s.file && s.line.includes(e.line)).length !== 1).map((s) => `${s.file}: ${s.line.trim()}`);
  expect(unclassified, 'classify each new run start in config/automation.ts RUN_STARTS').toEqual([]);
  const miscounted = RUN_STARTS.filter((e) => found.filter((s) => s.file === e.file && s.line.includes(e.line)).length !== (e.count ?? 1)).map((e) => `${e.file}: ${e.line}`);
  expect(miscounted).toEqual([]);
  // An automatic site's file reads the pause, except the boot wiring: the scheduler and the promotion pass read it.
  const unchecked = RUN_STARTS.filter((e) => e.kind === 'automatic' && e.file !== 'apps/server/src/index.ts' && !readFileSync(join(root, e.file), 'utf8').includes('automationPaused(db)')).map((e) => e.file);
  expect(unchecked).toEqual([]);
});

test("while paused a due slot doesn't fire, and on resume the missed slot is skipped, not caught up", async () => {
  let clock = new Date(2026, 9, 26, 8, 0, 30);
  const calls: string[] = [];
  const runTask: RunTask = (agentId) => (calls.push(agentId), { id: `run-${calls.length}` });
  const r = await rule();
  db.prepare('UPDATE automation_rules SET created_at = ? WHERE id = ?').run(clock.toISOString(), r.id);
  const s = startScheduler(db, runTask, { everyMs: 1e9, now: () => clock });
  await pause(true);
  expect((await send<AutomationStatus>('GET', '/api/config/automation')).body).toMatchObject({ paused: true, pausedAt: new Date(2026, 9, 26, 8, 0, 30).toISOString(), running: [] });
  clock = new Date(2026, 9, 26, 9, 0, 30);
  s.tick();
  expect(calls).toEqual([]);
  expect(db.prepare('SELECT count(*) AS n FROM automation_runs').get()!.n).toBe(0);
  clock = new Date(2026, 9, 26, 9, 30, 30);
  await pause(false);
  s.tick();
  expect(calls).toEqual([]); // 9:00 was missed while paused: skipped
  clock = new Date(2026, 9, 27, 9, 0, 30);
  s.tick();
  expect(calls).toEqual(['glow:market_analyst']);
  s.stop();
});

test('pausing says what stops from real counts; the passes for self-directed research and Knowledge promotion start nothing', async () => {
  await rule();
  await rule({ storeId: 'peak', action: { type: 'agent_task', agentId: 'peak:market_analyst', task: 'Brief' } });
  await rule({ enabled: false });
  // Self-directed research on for peak's ad strategist, with a gap to look into.
  const { version } = (await send<{ version: number }>('GET', '/api/kb/controls?ws=peak')).body;
  expect((await send('PUT', '/api/kb/controls?ws=peak', { autonomous: true, roles: { ad_strategist: [] }, approval: false, version })).status).toBe(200);
  createCard(db, 'peak', { categoryId: ensureCategoryPath(db, 'peak', ['Advertising', 'Hooks']), title: 'Problem-first hooks win', summary: 'They hold viewers', type: 'strategy', stage: 'hypothesis', status: 'active', authorId: 'owner', origin: 'owner' });
  // The same card in two live stores: offered for General once.
  for (const id of ['pawsome', 'glow']) {
    db.prepare('UPDATE stores SET connected = 1 WHERE id = ?').run(id);
    once(db, `activate:${id}`);
    createCard(db, id, { categoryId: ensureCategoryPath(db, id, ['Advertising']), title: 'Bundles lift order value', summary: 'Bundles lift order value, in short', type: 'strategy', stage: 'hypothesis', status: 'active', authorId: 'owner', origin: 'owner' });
  }
  const { versions } = (await send<{ versions: Record<string, number> }>('GET', '/api/config')).body;
  const impact = await send<{ impacts: ConfigImpact[] }>('POST', '/api/config/impact', { documents: [{ doc: 'workspace', version: versions.workspace ?? 0, set: { 'automation.paused': true } }] });
  expect(impact.body.impacts.map((i) => i.text)).toEqual(['Pauses 2 enabled rules across 2 stores and self-directed research in 1 store. 0 automation runs already going keep going.']);

  await pause(true);
  const deps = { engineAvailable: () => true, advance: () => {} };
  const start = vi.fn(() => ({ id: 'r1' }));
  expect(autonomousResearch(db, deps)).toEqual([]);
  proposeKbPromotions(db, start);
  expect(start).not.toHaveBeenCalled();
  expect(db.prepare('SELECT count(*) AS n FROM kb_tasks').get()!.n).toBe(0);

  await pause(false); // nothing was marked done while paused: the next passes start them
  expect(autonomousResearch(db, deps)).toMatchObject([{ storeId: 'peak', trigger: 'gap' }]);
  proposeKbPromotions(db, start);
  expect(start).toHaveBeenCalledTimes(1);
});

test("while paused a restart re-runs only a mission's step, and the owner's conversation still starts", async () => {
  const now = new Date().toISOString();
  const run = db.prepare("INSERT INTO agent_runs (id, store_id, agent_id, task, status, created_at) VALUES (?, 'glow', ?, ?, 'running', ?)");
  run.run('plain', 'glow:market_analyst', 'Write the daily brief', now);
  run.run('step', 'glow:copywriter', 'Step of the mission', now);
  db.prepare("INSERT INTO squad_missions (id, store_id, title, steps_json, created_at) VALUES ('m1', 'glow', 'Launch', ?, ?)").run(JSON.stringify([{ id: 's1', role: 'copywriter', task: 'x', dependsOn: [], runId: 'step' }]), now);
  await pause(true);
  const m = manager(fakeEngine()); // the app starting again
  await m.idle();
  const retried = (id: string) => db.prepare('SELECT count(*) AS n FROM done_once WHERE ref LIKE ?').get(`retry:${id}:%`)!.n;
  expect([getRun(db, 'plain')?.status, retried('plain'), retried('step')]).toEqual(['error', 0, 1]);

  const opened = await send<{ run: { status: string } }>('POST', '/api/conversations?store=glow', { clientRequestId: randomUUID(), type: 'copywriter', message: 'Three headlines for the serum' });
  expect(opened.status).toBe(201);
  expect(opened.body.run.status).toMatch(/queued|running/);
});

test('cancelling stops the runs automations started and lists what happened to each: its requests, or already finished', async () => {
  const r = await rule();
  const link = (runId: string) =>
    db.prepare("INSERT INTO automation_runs (id, rule_id, store_id, fired_at, status, detail, run_id) VALUES (?, ?, 'glow', ?, 'started', 'scheduled', ?)").run(randomUUID(), r.id, new Date().toISOString(), runId);
  const quick = manager(fakeEngine());
  const finished = quick.start('glow:copywriter', 'Write the weekly report');
  if (typeof finished === 'string') throw new Error(finished);
  await quick.idle();
  link(finished.id);
  const m = manager(held);
  const going = m.start('glow:market_analyst', 'Write the daily brief');
  if (typeof going === 'string') throw new Error(going);
  link(going.id);
  await vi.waitFor(() => expect(getRun(db, going.id)?.status).toBe('running'));
  // What it asked while running: a price change the server carries out (it stays) and an in-run question (it closes with the run).
  const ask = db.prepare("INSERT INTO approvals (id, store_id, agent_id, run_id, title, reason, action_json, created_at) VALUES (?, 'glow', 'glow:market_analyst', ?, ?, 'Why', ?, ?)");
  ask.run('a1', going.id, 'Set the serum to $24', JSON.stringify({ kind: 'store.set_price', payload: {} }), new Date().toISOString());
  ask.run('a2', going.id, 'Save this finding', JSON.stringify({ kind: 'kb.save', payload: {} }), new Date().toISOString());
  const running = (await send<AutomationStatus>('GET', '/api/config/automation')).body.running;
  expect(running).toMatchObject([{ runId: going.id, ruleName: 'Daily brief', storeName: 'Glow Haus', status: 'running' }]);

  const outcomes = await cancelRunning(db, [finished.id, going.id], m);
  expect(outcomes).toEqual([
    { runId: finished.id, ruleName: 'Daily brief', storeName: 'Glow Haus', status: 'done', approvals: [], outcome: 'Already finished' },
    {
      runId: going.id, ruleName: 'Daily brief', storeName: 'Glow Haus', status: 'cancelled', outcome: 'Stopped; its 1 request stays in Requests',
      approvals: [{ id: 'a1', title: 'Set the serum to $24', status: 'pending' }, { id: 'a2', title: 'Save this finding', status: 'denied' }],
    },
  ]);
  expect(getRun(db, going.id)?.status).toBe('cancelled');
  expect((await send('POST', '/api/config/automation/cancel-running', { runIds: 'all' })).status).toBe(400);
  expect((await send<{ outcomes: unknown[] }>('POST', '/api/config/automation/cancel-running', {})).body).toEqual({ outcomes: [] }); // nothing going now
});
