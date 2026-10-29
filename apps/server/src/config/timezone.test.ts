import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { autopilotUsedToday, budgetAddedToday, costToday, creditsToday, workspaceZone } from '@frontline/agents';
import { machineZone, type AutomationRule } from '@frontline/shared';
import { createApp } from '../app';
import { startScheduler, type RunTask } from '../automations';
import { cronDueBetween, nextCronTime, parseCron } from '../cron';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { startDigestLoop } from '../digest';

// The machine is New York in every test here, so a test passing on the workspace zone can't pass on the machine's.
let tz: string | undefined;
beforeEach(() => {
  tz = process.env.TZ;
  process.env.TZ = 'America/New_York';
});
afterEach(() => {
  vi.useRealTimers();
  if (tz === undefined) delete process.env.TZ;
  else process.env.TZ = tz;
});

const setZone = (db: Db, zone: string) =>
  db.prepare("INSERT INTO settings (key, value_json) VALUES ('workspace', json_object('timezone', ?)) ON CONFLICT (key) DO UPDATE SET value_json = json_set(value_json, '$.timezone', ?)").run(zone, zone);
/** Minutes in [from, to) at which a once-a-minute scheduler finds the rule due. */
const dueMinutes = (cron: string, from: string, to: string, zone: string) => {
  const c = parseCron(cron);
  const due: string[] = [];
  for (let t = Date.parse(from); t < Date.parse(to); t += 60_000) if (cronDueBetween(c, new Date(t), new Date(t + 60_000), zone)) due.push(new Date(t + 60_000).toISOString());
  return due;
};

test('without a workspace row or timezone the machine zone is used, never UTC', () => {
  const db = openDb();
  expect(workspaceZone(db)).toBe(machineZone());
  expect(machineZone()).toBe('America/New_York');
  db.prepare("INSERT INTO settings (key, value_json) VALUES ('workspace', '{}')").run();
  expect(workspaceZone(db)).toBe('America/New_York');
  setZone(db, 'Asia/Tokyo');
  expect(workspaceZone(db)).toBe('Asia/Tokyo');
});

test("schedules run on the workspace zone's wall clock: 9:00 there, and a 2:30 rule once on both DST nights", () => {
  expect(nextCronTime(parseCron('0 9 * * *'), new Date('2026-10-28T12:00:00Z'), 8, 'Asia/Tokyo')?.toISOString()).toBe('2026-10-29T00:00:00.000Z');
  // Berlin, 2026-03-29: 02:00 CET → 03:00 CEST, so 02:30 never happens and the rule runs as the clocks jump.
  expect(dueMinutes('30 2 * * *', '2026-03-28T22:00:00Z', '2026-03-29T06:00:00Z', 'Europe/Berlin')).toEqual(['2026-03-29T01:00:00.000Z']);
  // Berlin, 2026-10-25: 03:00 CEST → 02:00 CET, so 02:30 comes round twice and runs the first time.
  expect(dueMinutes('30 2 * * *', '2026-10-24T22:00:00Z', '2026-10-25T06:00:00Z', 'Europe/Berlin')).toEqual(['2026-10-25T00:30:00.000Z']);
});

test("every today counter starts at the workspace zone's midnight", () => {
  const db = openDb();
  db.prepare("INSERT INTO stores (id, name, platform, niche) VALUES ('glow', 'Glow Haus', 'shopify', 'beauty')").run();
  setZone(db, 'Asia/Tokyo');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-28T16:00:00Z')); // 01:00 on the 29th in Tokyo, noon on the 28th in New York
  const [before, after] = ['2026-10-28T14:30:00.000Z', '2026-10-28T15:30:00.000Z']; // 23:30 and 00:30 in Tokyo
  for (const [at, usd] of [[before, 1], [after, 2]] as const) {
    db.prepare("INSERT INTO agent_runs (id, store_id, agent_id, task, status, cost_usd, created_at, ended_at) VALUES (?, 'glow', 'glow:market_analyst', 'T', 'done', ?, ?, ?)").run(`r-${usd}`, usd, at, at);
    db.prepare("INSERT INTO creative_credits (store_id, credits, created_at) VALUES ('glow', ?, ?)").run(usd * 10, at);
    const approval = (id: string, action: object, status: string) =>
      db.prepare("INSERT INTO approvals (id, store_id, agent_id, title, reason, action_json, status, created_at, decided_at) VALUES (?, 'glow', 'glow:ad_strategist', 'T', 'R', ?, ?, ?, ?)").run(id, JSON.stringify(action), status, at, at);
    approval(`b-${usd}`, { kind: 'ads.set_budget', payload: { addedUsd: usd * 5 } }, 'approved');
    approval(`a-${usd}`, { kind: 'shop.set_price', amountUsd: usd * 3, auto: 1 }, 'approved');
  }
  expect(costToday(db, 'glow')).toBe(2);
  expect(creditsToday(db, 'glow')).toBe(20);
  expect(budgetAddedToday(db, 'glow')).toBe(10);
  expect(autopilotUsedToday(db, 'glow', 'shop.set_price')).toBe(6);
  // On the machine's midnight (04:00 UTC) both would count.
  setZone(db, 'America/New_York');
  expect([costToday(db, 'glow'), creditsToday(db, 'glow'), budgetAddedToday(db, 'glow'), autopilotUsedToday(db, 'glow', 'shop.set_price')]).toEqual([3, 30, 15, 9]);
});

test('the daily digest goes out at 8:00 in the workspace zone', async () => {
  vi.useFakeTimers({ now: new Date('2026-10-26T22:50:00Z') }); // 07:50 in Tokyo, 18:50 in New York
  const db = openDb();
  seedDemo(db, '2026-10-26');
  setZone(db, 'Asia/Tokyo');
  const sent = () => db.prepare("SELECT count(*) AS n FROM notifications WHERE title LIKE 'Yesterday:%'").get()?.n;
  const stop = startDigestLoop(db, 10 * 60_000);
  expect(sent()).toBe(0);
  await vi.advanceTimersByTimeAsync(10 * 60_000); // 08:00 in Tokyo
  expect(sent()).toBe(1);
  stop();
});

/** A scheduler on a clock the test moves, and the rule it runs. */
async function scheduled(cron: string, maxRunsPerDay: number) {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  setZone(db, 'Asia/Tokyo');
  const app = createApp(db);
  const res = await app.request('/api/automations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ storeId: 'glow', name: 'Brief', trigger: { type: 'schedule', cron }, approval: 'auto', maxRunsPerDay, cooldownHours: 0, action: { type: 'agent_task', agentId: 'glow:market_analyst', task: 'Brief me' } }),
  });
  const rule = (await res.json()) as AutomationRule;
  db.prepare('UPDATE automation_rules SET created_at = ? WHERE id = ?').run('2026-10-27T12:00:00.000Z', rule.id);
  const calls: string[] = [];
  let clock = new Date('2026-10-27T12:00:00Z');
  const runTask: RunTask = (_agent, task) => (calls.push(task), { id: `run-${calls.length}` });
  const s = startScheduler(db, runTask, { everyMs: 1e9, metricEveryMs: 1e9, now: () => clock });
  const tick = (iso: string) => ((clock = new Date(iso)), s.tick());
  return { db, app, rule, calls, tick, stop: s.stop };
}

test("a 9:00 rule fires at 9:00 in the workspace zone, and the API names the zone it worked next run out in", async () => {
  const { app, rule, calls, tick, stop } = await scheduled('0 9 * * *', 3);
  tick('2026-10-27T23:59:00Z'); // 08:59 in Tokyo
  expect(calls).toHaveLength(0);
  tick('2026-10-28T00:00:00Z'); // 09:00 in Tokyo, 20:00 the night before in New York
  expect(calls).toHaveLength(1);
  tick('2026-10-28T13:00:00Z'); // 09:00 in New York
  expect(calls).toHaveLength(1);
  const brief = ((await (await app.request('/api/automations?stores=glow')).json()) as AutomationRule[]).find((r) => r.id === rule.id)!;
  expect(brief.nextRunZone).toBe('Asia/Tokyo');
  expect(new Date(brief.nextRunAt!).toLocaleTimeString('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' })).toBe('09:00');
  stop();
});

test('a zone moved west mid-day: the rule runs its time once that day, and maxRunsPerDay counts across the switch', async () => {
  const daily = await scheduled('0 9 * * *', 3);
  daily.tick('2026-10-28T00:00:00Z'); // 09:00 Tokyo
  setZone(daily.db, 'Asia/Kolkata'); // 3.5 h behind: its 09:00 is still to come today
  daily.tick('2026-10-28T03:30:00Z'); // 09:00 in Kolkata
  expect(daily.calls).toHaveLength(1);
  daily.tick('2026-10-29T03:30:00Z'); // the next Kolkata morning runs again
  expect(daily.calls).toHaveLength(2);

  const twice = await scheduled('0 9,12 * * *', 1);
  twice.tick('2026-10-28T00:00:00Z'); // 09:00 Tokyo
  setZone(twice.db, 'Asia/Kolkata');
  twice.tick('2026-10-28T06:30:00Z'); // 12:00 in Kolkata: a time not yet run, but the day's one run already went
  expect(twice.calls).toHaveLength(1);
  expect(twice.db.prepare('SELECT status, detail FROM automation_runs ORDER BY fired_at DESC').get()).toMatchObject({ status: 'skipped', detail: expect.stringContaining('daily cap of 1 reached') });
  daily.stop();
  twice.stop();

  // Hourly rules aren't held to 24: Chicago's 2026-11-01, the day clocks fall back, has 25 real hours, and each runs.
  const hourly = await scheduled('0 * * * *', 100);
  setZone(hourly.db, 'America/Chicago');
  for (let t = Date.parse('2026-11-01T05:00:00Z'); t < Date.parse('2026-11-02T06:00:00Z'); t += 3_600_000) hourly.tick(new Date(t).toISOString());
  expect(hourly.calls).toHaveLength(25);
  hourly.stop();
});
