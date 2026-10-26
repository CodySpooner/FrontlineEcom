import { createDefaultJobs, createSquad, DEFAULT_JOBS } from '@frontline/agents';
import type { AutomationRule } from '@frontline/shared';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
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
  expect(peak.every((r) => r.enabled && r.nextRunAt)).toBe(true);
});

test('stores made before a job shipped get it on the next start; a job the owner deleted stays deleted', async () => {
  db.prepare(`UPDATE stores SET connected = 1 WHERE id = 'peak'`).run();
  agentRoutes(db); // activation: the jobs are on
  // A store from before 'Monthly flow check' shipped: no rule and no ledger entry. 'Daily briefing' the owner deleted.
  db.prepare(`DELETE FROM automation_rules WHERE store_id = 'peak' AND name IN ('Monthly flow check', 'Daily briefing')`).run();
  db.prepare(`DELETE FROM done_once WHERE ref = 'default-job:peak:Monthly flow check'`).run();
  agentRoutes(db);
  const peak = await rules('peak');
  expect(peak.map((r) => r.name).sort()).toEqual(DEFAULT_JOBS.map((j) => j.name).filter((n) => n !== 'Daily briefing').sort());
  expect(peak.find((r) => r.name === 'Monthly flow check')?.enabled).toBe(true);
  expect(db.prepare(`SELECT body FROM notifications WHERE title = 'New scheduled work for Peak Fit'`).all()).toEqual([
    { body: 'Monthly flow check. It runs on your Claude login; pause or change it in Automation.' },
  ]);
  agentRoutes(db);
  expect(await rules('peak')).toHaveLength(DEFAULT_JOBS.length - 1);
});
