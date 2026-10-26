import { expect, test } from 'vitest';
import type { AutomationRule, AutomationRun } from '@frontline/shared';
import { createApp } from './app';
import { metricValue, startScheduler, type RunTask } from './automations';
import { addDays, dayFraction } from './dates';
import { openDb } from './db';
import { seedDemo } from './demo';

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m, 30); // local time, Oct 2026
const send = (method: string, body?: unknown) => ({ method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const flush = () => new Promise((r) => setTimeout(r, 0));

const setup = () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  const app = createApp(db);
  const calls: [string, string][] = [];
  const runTask: RunTask = (agentId, task) => (calls.push([agentId, task]), { id: `run-${calls.length}` });
  let clock = at(26, 8);
  const scheduler = (rt = runTask) => startScheduler(db, rt, { everyMs: 1e9, metricEveryMs: 15 * 60_000, now: () => clock });
  const create = async (body: Record<string, unknown>) => {
    const res = await app.request('/api/automations', send('POST', { storeId: 'glow', name: 'Daily brief', action: { type: 'agent_task', agentId: 'glow:market_analyst', task: 'Write the daily brief' }, ...body }));
    const rule = (await res.json()) as AutomationRule;
    db.prepare('UPDATE automation_rules SET created_at = ? WHERE id = ?').run(at(26, 8).toISOString(), rule.id);
    return rule;
  };
  const runs = async () => (await (await app.request('/api/automations/runs')).json()) as AutomationRun[];
  return { db, app, calls, scheduler, create, runs, setClock: (d: Date) => (clock = d) };
};

test('CRUD with defaults, nextRunAt and validation', async () => {
  const { app, create } = setup();
  const rule = await create({ trigger: { type: 'schedule', cron: '0 9 * * *' } });
  expect(rule).toMatchObject({ storeId: 'glow', enabled: true, approval: 'ask', maxRunsPerDay: 3, cooldownHours: 24, trigger: { type: 'schedule', cron: '0 9 * * *' } });
  expect(new Date(rule.nextRunAt!).getHours()).toBe(9);

  const upd = (await (await app.request(`/api/automations/${rule.id}`, send('PATCH', { enabled: false, approval: 'auto' }))).json()) as AutomationRule;
  expect(upd).toMatchObject({ enabled: false, approval: 'auto', name: 'Daily brief' });
  expect(upd.nextRunAt).toBeUndefined();

  const base = { storeId: 'glow', name: 'X', trigger: { type: 'schedule', cron: '0 9 * * *' }, action: { type: 'agent_task', agentId: 'glow:market_analyst', task: 'T' } };
  for (const bad of [
    { ...base, trigger: { type: 'schedule', cron: 'every day' } },
    { ...base, trigger: { type: 'metric', metric: 'vibes', op: '<', value: 1, windowDays: 3 } },
    { ...base, trigger: { type: 'metric', metric: 'roas', op: '<=', value: 1, windowDays: 3 } },
    { ...base, action: { type: 'agent_task', agentId: 'peak:market_analyst', task: 'T' } },
    { ...base, approval: 'yolo' },
    { ...base, maxRunsPerDay: 0 },
    { ...base, storeId: 'nope' },
  ]) expect((await app.request('/api/automations', send('POST', bad))).status, JSON.stringify(bad)).toBe(400);
  expect((await app.request(`/api/automations/${rule.id}`, send('PATCH', { storeId: 'peak' }))).status).toBe(400);
  expect((await app.request(`/api/automations/${rule.id}`, { method: 'DELETE' })).status).toBe(204);
  expect((await app.request(`/api/automations/${rule.id}`, { method: 'DELETE' })).status).toBe(404);
});

test('schedule rules fire once per matching minute, catch up after downtime, and respect the daily cap', async () => {
  const { calls, scheduler, create, runs, setClock } = setup();
  await create({ trigger: { type: 'schedule', cron: '0 9 * * *' }, approval: 'auto', maxRunsPerDay: 1 });
  setClock(at(26, 8, 30));
  const s = scheduler(); // first tick: nothing due between creation (08:00) and 08:30
  expect(calls).toHaveLength(0);
  setClock(at(26, 9, 0));
  s.tick();
  s.tick();
  expect(calls).toEqual([['glow:market_analyst', expect.stringContaining('Write the daily brief')]]);
  expect(calls[0]![1]).toContain('scheduled (0 9 * * *)');
  // app closed overnight, opened at 10:15 next day → the missed 09:00 fires once
  setClock(at(27, 10, 15));
  s.tick();
  expect(calls).toHaveLength(2);
  s.stop();
  expect((await runs()).map((r) => [r.status, r.runId])).toEqual([['started', 'run-2'], ['started', 'run-1']]);
});

test('every-minute rule hits its daily cap and logs a skip', async () => {
  const { calls, scheduler, create, runs, setClock } = setup();
  await create({ trigger: { type: 'schedule', cron: '* * * * *' }, approval: 'auto', maxRunsPerDay: 2 });
  setClock(at(26, 12, 0));
  const s = scheduler();
  for (const m of [1, 2, 3]) {
    setClock(at(26, 12, m));
    s.tick();
  }
  s.stop();
  expect(calls).toHaveLength(2);
  expect((await runs())[0]).toMatchObject({ status: 'skipped', detail: expect.stringContaining('daily cap of 2') });
});

test("'ask' rules create an approval; approve starts the agent, deny logs it", async () => {
  const { app, calls, scheduler, create, runs, setClock } = setup();
  await create({ trigger: { type: 'schedule', cron: '0 9 * * *' } });
  setClock(at(26, 9, 0));
  const s = scheduler();
  const [first] = await runs();
  expect(first).toMatchObject({ status: 'awaiting_approval' });
  expect(calls).toHaveLength(0);
  await app.request(`/api/approvals/${first!.approvalId}/approve`, { method: 'POST' });
  await flush();
  expect(calls).toHaveLength(1);
  expect((await runs())[0]).toMatchObject({ status: 'started', runId: 'run-1' });

  setClock(at(27, 9, 0));
  s.tick();
  const [second] = await runs();
  await app.request(`/api/approvals/${second!.approvalId}/deny`, { method: 'POST' });
  await flush();
  expect((await runs())[0]).toMatchObject({ status: 'denied' });
  expect(calls).toHaveLength(1);
  s.stop();
});

test('a pending approval from before a restart still starts the agent when approved', async () => {
  const { app, calls, scheduler, create, runs, setClock } = setup();
  await create({ trigger: { type: 'schedule', cron: '0 9 * * *' } });
  setClock(at(26, 9, 0));
  const before: string[] = [];
  scheduler(() => (before.push('x'), 'old process is gone')).stop();
  const after = scheduler(); // "restart": re-attaches to the waiting request
  const [pending] = await runs();
  await app.request(`/api/approvals/${pending!.approvalId}/approve`, { method: 'POST' });
  await flush();
  expect(calls).toHaveLength(1);
  after.stop();
});

test('metric rules fire when the condition holds, then wait out the cooldown', async () => {
  const { calls, scheduler, create, runs, setClock } = setup();
  // Peak Fit runs at ~1.75 ROAS
  await create({ storeId: 'peak', name: 'ROAS guard', trigger: { type: 'metric', metric: 'roas', op: '<', value: 2, windowDays: 3 }, action: { type: 'agent_task', agentId: 'peak:ad_strategist', task: 'Find the losing ad sets' }, approval: 'auto', cooldownHours: 6 });
  await create({ storeId: 'peak', name: 'Never', trigger: { type: 'metric', metric: 'revenue', op: '>', value: 1e9, windowDays: 7 }, action: { type: 'agent_task', agentId: 'peak:ad_strategist', task: 'X' }, approval: 'auto' });
  setClock(at(26, 12, 0));
  const s = scheduler();
  expect(calls).toHaveLength(1);
  expect(calls[0]![1]).toMatch(/ROAS 1\.\d+ < 2 over the last 3 days/);
  setClock(at(26, 12, 20)); // checked again (15 min passed) but in cooldown
  s.tick();
  setClock(at(26, 18, 30)); // cooldown over
  s.tick();
  s.stop();
  expect(calls).toHaveLength(2);
  expect((await runs()).every((r) => r.status === 'started')).toBe(true);
});

test("a metric rule's window is the trailing 24 h per day: steady sales don't read low just after midnight", () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  db.prepare("DELETE FROM daily_metrics WHERE store_id = 'glow'").run();
  const now = new Date('2026-10-26T00:15:00'); // machine-local: demo stores are dated on the machine
  const f = dayFraction('2026-10-26', now.getTime());
  const day = db.prepare("INSERT INTO daily_metrics (store_id, date, revenue, ad_spend, cogs, orders) VALUES ('glow', ?, ?, ?, 0, ?)");
  for (let i = 1; i <= 10; i++) day.run(addDays('2026-10-26', -i), 1000, 250, 20);
  day.run('2026-10-26', 1000 * f, 250 * f, 0);
  expect(metricValue(db, 'glow', 'revenue', 1, now)).toBeCloseTo(1000, 0);
  expect(metricValue(db, 'glow', 'revenue', 3, now)).toBeCloseTo(3000, 0);
  expect(metricValue(db, 'glow', 'roas', 1, now)).toBe(4);
  expect(metricValue(db, 'glow', 'revenue', 1, now)! < 800).toBe(false); // 'Revenue < 800 over 1 day' stays quiet
});
