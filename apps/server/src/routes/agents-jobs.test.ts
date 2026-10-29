import { createDefaultJobs, createSquad, DEFAULT_JOBS, enableDefaultJobs } from '@frontline/agents';
import type { AutomationRule } from '@frontline/shared';
import { createHash } from 'node:crypto';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { startScheduler } from '../automations';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { agentRoutes } from './agents';

let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  app = createApp(db);
});
const rules = async (storeId: string) => (await (await app.request(`/api/automations?stores=${storeId}`)).json()) as AutomationRule[];

test('every new squad gets the default jobs, off on demo stores', async () => {
  const glow = await rules('glow');
  expect(glow.map((r) => [r.name, r.action.agentId, r.trigger])).toEqual(DEFAULT_JOBS.map((j) => [j.name, `glow:${j.role}`, { type: 'schedule', cron: j.cron }]));
  expect(glow.every((r) => !r.enabled && r.approval === 'auto' && r.maxRunsPerDay === 1)).toBe(true);
  createSquad(db, { id: 'glow' });
  expect(await rules('glow')).toHaveLength(DEFAULT_JOBS.length);
});

test("a job's task text doesn't change without its old text's hash in FORMER_TASKS", () => {
  // Failing? Add the old hash below to FORMER_TASKS in packages/agents/src/jobs.ts (live stores' unedited jobs then move
  // to the new text), and put the new one here.
  const hash = (task: string) => createHash('sha256').update(task).digest('hex').slice(0, 12);
  expect(Object.fromEntries(DEFAULT_JOBS.map((j) => [j.name, hash(j.task)]))).toEqual({
    'Daily briefing': 'f385b8168ab7',
    'Daily campaign review': '0638a66c5c0c',
    'Daily product scan': '76b2727e6a46',
    'Daily order check': 'b4f3008ae90f',
    'Weekly price check': 'df5a9be0e3fd',
    'Weekly page refresh': '5b0e4eeea0b6',
    'Monthly flow check': 'c0b7ee3aa8ac',
    'Weekly report': '0753e76d0b9d',
  });
});

test("a job the owner never edited moves to the current task text; an edited one is left alone", async () => {
  const setTask = db.prepare(`UPDATE automation_rules SET action_json = json_set(action_json, '$.task', ?) WHERE store_id = 'peak' AND name = ?`);
  // The first shipped text of the order check, and an owner's own weekly report.
  setTask.run(
    'Daily order check: list_orders for the last 14 days. Flag with flag_order_issue every order unfulfilled for 3+ days or in transit for 10+ days ' +
      '(severity high past 7 / 15 days), and any refund or supplier problem you can see, each with a suggested next step. Then summarize the queue in 3 lines.',
    'Daily order check',
  );
  setTask.run('Weekly report: keep it to revenue and profit only.', 'Weekly report');
  createDefaultJobs(db, 'peak');
  const task = async (name: string) => (await rules('peak')).find((r) => r.name === name)?.action.task;
  expect(await task('Daily order check')).toBe(DEFAULT_JOBS.find((j) => j.name === 'Daily order check')!.task);
  expect(await task('Weekly report')).toBe('Weekly report: keep it to revenue and profit only.');
});

test('connected stores start with the jobs on', async () => {
  db.prepare(`UPDATE stores SET connected = 1 WHERE id = 'peak'`).run();
  db.prepare(`DELETE FROM automation_rules WHERE store_id = 'peak'`).run();
  db.prepare(`DELETE FROM done_once WHERE ref LIKE 'default-job:peak:%'`).run();
  expect(createDefaultJobs(db, 'peak')).toEqual(DEFAULT_JOBS.map((j) => j.name));
  const peak = await rules('peak');
  // The app can't publish TikTok Shop pages, and TikTok owns its buyers (no list to mail).
  expect(peak.filter((r) => !r.enabled).map((r) => r.name).sort()).toEqual(['Monthly flow check', 'Weekly page refresh']);
  expect(peak.filter((r) => r.enabled).every((r) => r.nextRunAt)).toBe(true);
});

test("a job switched on at go-live waits for its next slot instead of running for the ones it was off for", () => {
  db.prepare(`UPDATE automation_rules SET created_at = ? WHERE store_id = 'glow'`).run(new Date(Date.now() - 3 * 86_400_000).toISOString()); // off since
  enableDefaultJobs(db, 'glow');
  const started: string[] = [];
  startScheduler(db, (agentId, task) => (started.push(`${agentId} ${task}`), { id: 'r' }), { everyMs: 3_600_000 }).stop();
  expect(started.filter((s) => s.startsWith('glow:') && DEFAULT_JOBS.some((j) => s.includes(j.task)))).toEqual([]);
});

test('a job the owner edited in Automation keeps their on/off when the store goes live or gets campaigns', async () => {
  const report = (await rules('glow')).find((r) => r.name === 'Weekly report')!;
  expect((await app.request(`/api/automations/${report.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: false, version: report.version }) })).status).toBe(200); // the version read (settings ST-08c)
  expect(enableDefaultJobs(db, 'glow')).toBe(DEFAULT_JOBS.length - 1);
  expect((await rules('glow')).filter((r) => !r.enabled).map((r) => r.name)).toEqual(['Weekly report']);
});

test('stores made before a job shipped get it on the next start; a job the owner deleted stays deleted', async () => {
  db.prepare(`UPDATE stores SET connected = 1 WHERE id = 'peak'`).run();
  agentRoutes(db); // activation: the jobs are on
  // A store from before 'Weekly report' and 'Monthly flow check' shipped: no rules and no ledger entries. 'Daily briefing' the owner deleted.
  db.prepare(`DELETE FROM automation_rules WHERE store_id = 'peak' AND name IN ('Weekly report', 'Monthly flow check', 'Daily briefing')`).run();
  db.prepare(`DELETE FROM done_once WHERE ref IN ('default-job:peak:Weekly report', 'default-job:peak:Monthly flow check')`).run();
  agentRoutes(db);
  const peak = await rules('peak');
  expect(peak.map((r) => r.name).sort()).toEqual(DEFAULT_JOBS.map((j) => j.name).filter((n) => n !== 'Daily briefing').sort());
  expect(peak.find((r) => r.name === 'Weekly report')?.enabled).toBe(true);
  expect(peak.find((r) => r.name === 'Monthly flow check')?.enabled).toBe(false); // TikTok Shop: added, but off
  expect(db.prepare(`SELECT body FROM notifications WHERE title = 'New scheduled work for Peak Fit'`).all()).toEqual([
    { body: 'Weekly report. It runs on your Claude login; pause or change it in Automation.' },
  ]);
  agentRoutes(db);
  expect(await rules('peak')).toHaveLength(DEFAULT_JOBS.length - 1);
});
