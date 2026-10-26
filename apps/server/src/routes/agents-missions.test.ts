import { advanceMissions, parseMission } from '@frontline/agents';
import type { AgentRun, NewSquadMission, SquadMission } from '@frontline/shared';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { runManager } from './agents';

let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  app = createApp(db);
});

const send = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const get = async <T>(path: string) => (await (await send('GET', path)).json()) as T;
const create = async (m: Omit<NewSquadMission, 'storeId'>) => (await (await send('POST', '/api/squad-missions', { storeId: 'glow', ...m })).json()) as SquadMission;
/** Waits until the mission stops moving: each finished run can start the next steps. */
async function settle(id: string) {
  for (let i = 0; i < 10; i++) {
    await runManager(db).idle();
    const m = await get<SquadMission>(`/api/squad-missions/${id}`);
    if (m.status !== 'running') return m;
  }
  return get<SquadMission>(`/api/squad-missions/${id}`);
}
const notes = () => db.prepare(`SELECT title, body FROM notifications WHERE title LIKE 'Mission %'`).all();

test('a mission runs its steps as agent runs in dependency order, each handed what the steps before it delivered', async () => {
  const created = await create({
    title: 'Spring launch',
    steps: [
      { id: 'numbers', role: 'market_analyst', task: "Pull last week's numbers for the spring launch." },
      { id: 'copy', role: 'copywriter', task: 'Write the launch ad copy from the numbers.', dependsOn: ['numbers'] },
      { id: 'ads', role: 'ad_strategist', task: 'Review the campaigns the launch will run beside.', dependsOn: ['numbers'] },
      { id: 'wrap', role: 'market_analyst', task: 'Wrap the launch plan up in three lines.', dependsOn: ['copy', 'ads'] },
    ],
  });
  expect(created.steps.map((s) => s.status)).toEqual([expect.stringMatching(/^(queued|running)$/), 'waiting', 'waiting', 'waiting']);

  const m = await settle(created.id);
  expect(m.status).toBe('done');
  expect(m.steps.every((s) => s.status === 'done' && s.runId && s.deliverable)).toBe(true);
  const [numbers, copy, ads, wrap] = await Promise.all(m.steps.map((s) => get<AgentRun>(`/api/runs/${s.runId}`)));
  expect(numbers!.task).toContain('First step of the mission "Spring launch".');
  expect([copy!.parentRunId, ads!.parentRunId, wrap!.parentRunId]).toEqual([numbers!.id, numbers!.id, copy!.id]); // real handoffs
  expect(wrap!.task).toMatch(/What your squadmates handed on:\n- Copywriter: .+\n- Ad Strategist: .+/);
  expect(notes()).toEqual([{ title: 'Mission done: Spring launch', body: m.steps[3]!.deliverable }]);
  expect((await get<SquadMission[]>('/api/squad-missions?stores=glow')).map((x) => x.id)).toEqual([m.id]);
  expect(await get<SquadMission[]>('/api/squad-missions?stores=peak')).toEqual([]);
});

test('a cancelled step blocks the steps that need it, and the owner hears the mission is stuck', async () => {
  runManager(db).start('glow:market_analyst', 'Something else first.'); // the mission's first step queues behind it
  const created = await create({
    title: 'Bundle test',
    steps: [
      { id: 'numbers', role: 'market_analyst', task: 'Pull the numbers for the bundle test.' },
      { id: 'copy', role: 'copywriter', task: 'Write the bundle ad copy from the numbers.', dependsOn: ['numbers'] },
    ],
  });
  await send('POST', `/api/runs/${created.steps[0]!.runId}/cancel`);
  const m = await settle(created.id);
  expect([m.status, ...m.steps.map((s) => s.status)]).toEqual(['blocked', 'cancelled', 'blocked']);
  expect(notes()).toEqual([{ title: 'Mission stuck: Bundle test', body: "The Market Analyst's step was cancelled, so the steps that need it didn't start." }]);
});

test("a step whose run an app restart interrupted follows the run that retried it", async () => {
  const run = db.prepare(`INSERT INTO agent_runs (id, store_id, agent_id, task, status, error, transcript_json, created_at) VALUES (?, 'glow', 'glow:market_analyst', 'Pull the numbers.', ?, ?, ?, ?)`);
  run.run('cut', 'error', 'Interrupted by an app restart', '[]', '2026-10-26T08:00:00.000Z');
  run.run('retry', 'done', null, JSON.stringify([{ type: 'text_delta', text: 'Revenue is up 12% on last week.' }]), '2026-10-26T08:05:00.000Z');
  const steps = [
    { id: 'numbers', role: 'market_analyst', task: 'Pull the numbers.', dependsOn: [], runId: 'cut' },
    { id: 'copy', role: 'copywriter', task: 'Write the ad copy from the numbers.', dependsOn: ['numbers'] },
  ];
  db.prepare(`INSERT INTO squad_missions (id, store_id, title, steps_json, created_at) VALUES ('m1', 'glow', 'Restarted', ?, '2026-10-26T08:00:00.000Z')`).run(JSON.stringify(steps));
  advanceMissions(db, runManager(db).start);
  const m = await settle('m1');
  expect(m.steps[0]).toMatchObject({ status: 'done', runId: 'retry', deliverable: 'Revenue is up 12% on last week.' });
  const copy = await get<AgentRun>(`/api/runs/${m.steps[1]!.runId}`);
  expect(copy.parentRunId).toBe('retry');
  expect(copy.task).toContain('- Market Analyst: Revenue is up 12% on last week.');
});

test('plans are checked (a step only waits on steps before it); the template is a valid plan of the six roles', async () => {
  const post = (steps: unknown, storeId = 'glow') => send('POST', '/api/squad-missions', { storeId, title: 'Checked mission', steps });
  const res = await post([{ id: 'a', role: 'copywriter', task: 'Write the copy first.', dependsOn: ['b'] }, { id: 'b', role: 'market_analyst', task: 'Pull the numbers.' }]);
  expect([res.status, await res.json()]).toEqual([400, { error: 'Step a can only wait on steps listed before it.' }]);
  expect((await post([{ id: 'a', role: 'wizard', task: 'Do some magic for us.' }])).status).toBe(400);
  expect((await post([])).status).toBe(400);
  expect((await post([{ id: 'a', role: 'copywriter', task: 'Write the copy first.' }], 'nope')).status).toBe(404);
  const [launch, ...more] = await get<Omit<NewSquadMission, 'storeId'>[]>('/api/squad-missions/templates');
  expect(more).toEqual([]);
  expect(typeof parseMission({ storeId: 'glow', ...launch })).toBe('object');
  expect(launch!.steps.map((s) => s.role)).toEqual(['product_hunter', 'market_analyst', 'copywriter', 'creative_studio', 'store_developer', 'ad_strategist']);
});
