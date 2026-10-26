import { createDefaultJobs, createSquad, DEFAULT_JOBS } from '@frontline/agents';
import type { AutomationRule } from '@frontline/shared';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';

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

test('connected stores start with the jobs on', async () => {
  db.prepare(`UPDATE stores SET connected = 1 WHERE id = 'peak'`).run();
  db.prepare(`DELETE FROM automation_rules WHERE store_id = 'peak'`).run();
  createDefaultJobs(db, 'peak');
  const peak = await rules('peak');
  expect(peak.every((r) => r.enabled && r.nextRunAt)).toBe(true);
});
