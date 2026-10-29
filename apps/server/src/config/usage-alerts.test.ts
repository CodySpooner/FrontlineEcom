import { randomUUID } from 'node:crypto';
import { costToday, fakeEngine, getAgent, getRun, runAgent, type FakeStep } from '@frontline/agents';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { decide } from '../approvals';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { startDigestLoop } from '../digest';
import { runHooks, toolEnv } from '../routes/agents';
import { getCaps, getSettings } from '../settings';
import { getStore } from '../stores';
import { usageAlert } from './usage-alerts';
import { writeConfig } from './write';

// The machine is New York; the workspace is Tokyo: the digest hour and the alert's day are the workspace's.
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

const setup = () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  db.prepare("INSERT INTO settings (key, value_json) VALUES ('workspace', '{\"timezone\":\"Asia/Tokyo\"}')").run();
  return db;
};
const set = (db: Db, values: Record<string, unknown>) => writeConfig(db, [{ doc: 'app', version: getSettings(db).version, set: values }], { current: () => getSettings(db) });
const digests = (db: Db) => db.prepare("SELECT 1 FROM notifications WHERE title LIKE 'Yesterday:%'").all();
const alerts = (db: Db) => db.prepare("SELECT title, body, link FROM notifications WHERE link LIKE '/settings/usage%' ORDER BY rowid").all();
const spend = (db: Db, usd: number) => {
  const id = randomUUID();
  const at = new Date().toISOString();
  db.prepare("INSERT INTO agent_runs (id, store_id, agent_id, task, status, cost_usd, created_at, ended_at) VALUES (?, 'glow', 'glow:market_analyst', 'T', 'done', ?, ?, ?)").run(id, usd, at, at);
  return id;
};
const credits = (db: Db, n: number) => db.prepare("INSERT INTO creative_credits (store_id, credits, created_at) VALUES ('glow', ?, ?)").run(n, new Date().toISOString());

test('the digest goes at the hour set, in the workspace zone; turned on after that hour, it still goes that day', async () => {
  vi.useFakeTimers({ now: new Date('2026-10-28T23:50:00Z') }); // 08:50 in Tokyo
  const db = setup();
  set(db, { 'notifications.digestHour': 9 });
  const stop = startDigestLoop(db, 10 * 60_000);
  expect(digests(db)).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(10 * 60_000); // 09:00
  expect(digests(db)).toHaveLength(1);

  set(db, { 'notifications.digest': false });
  await vi.advanceTimersByTimeAsync(26 * 60 * 60_000); // the next day, 11:00
  expect(digests(db)).toHaveLength(1);
  set(db, { 'notifications.digest': true });
  await vi.advanceTimersByTimeAsync(10 * 60_000);
  expect(digests(db)).toHaveLength(2);
  stop();
});

test('a usage alert fires once at 80% of a cap, not again that day, again the next day; with alerts off, none', () => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-28T05:00:00Z') }); // 14:00 in Tokyo, 01:00 in New York
  const db = setup();
  expect(getCaps(db, 'glow')).toMatchObject({ agentCostPerDay: 5, higgsfieldCreditsPerDay: 200 });
  spend(db, 3.99 - costToday(db, 'glow'));
  usageAlert(db, 'glow');
  expect(alerts(db)).toEqual([]);
  spend(db, 0.01); // $4.00: 80%
  usageAlert(db, 'glow');
  const budget = { title: "Glow Haus: 80% of today's AI budget used", body: '$4.00 of the $5.00 daily cap. At the cap its agents stop until tomorrow (workspace time), or until you raise it.', link: '/settings/usage?store=glow' };
  expect(alerts(db)).toEqual([budget]);
  spend(db, 0.6);
  usageAlert(db, 'glow');
  expect(alerts(db)).toHaveLength(1);
  // Credits are their own cap.
  credits(db, 170);
  usageAlert(db, 'glow');
  expect(alerts(db).at(-1)).toEqual({ title: "Glow Haus: 85% of today's generation credits used", body: '170 of the 200 daily cap. At the cap new renders are refused until tomorrow (workspace time), or until you raise it.', link: '/settings/usage?store=glow' });

  // Midnight in Tokyo (still the 28th in New York): a new day for both caps.
  vi.setSystemTime(new Date('2026-10-28T15:00:00Z'));
  usageAlert(db, 'glow');
  expect(alerts(db)).toHaveLength(2);
  spend(db, 4.2);
  usageAlert(db, 'glow');
  expect(alerts(db)).toHaveLength(3);

  // Off: none, and the day's alert is still there to fire once it's back on, at the share set.
  set(db, { 'notifications.usageAlerts': false });
  credits(db, 180);
  usageAlert(db, 'glow');
  expect(alerts(db)).toHaveLength(3);
  set(db, { 'notifications.usageAlerts': true, 'notifications.usageAlertPct': 95 });
  usageAlert(db, 'glow'); // 90%
  expect(alerts(db)).toHaveLength(3);
  credits(db, 10);
  usageAlert(db, 'glow');
  expect(alerts(db).at(-1)?.title).toBe("Glow Haus: 95% of today's generation credits used");

  // A muted store's usage alerts are dropped like its other notifications.
  set(db, { 'notifications.mutedStores': ['glow'] });
  vi.setSystemTime(new Date('2026-10-29T15:00:00Z'));
  spend(db, 4.9);
  usageAlert(db, 'glow');
  expect(alerts(db)).toHaveLength(4);
});

test('a run ending and credits being charged both check usage', async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-28T05:00:00Z') });
  const db = setup();
  createApp(db); // the squads
  runHooks(db).onRun!(getRun(db, spend(db, 4.5 - costToday(db, 'glow')))!);
  expect(alerts(db).map((a) => a.title)).toEqual(["Glow Haus: 90% of today's AI budget used"]);

  // A render the owner approves charges its credits mid-run.
  credits(db, 150);
  const agent = getAgent(db, 'glow:creative_studio')!;
  const steps: FakeStep[] = [{ call: 'create_creative', input: { kind: 'video', headline: 'Glow in 3 steps', primaryText: 'The routine.', prompt: 'Serum, soft light', aspect: '9:16' } }];
  for await (const e of runAgent({ agent, store: getStore(db, 'glow')!, task: 't', env: toolEnv(db) }, fakeEngine(() => steps))) {
    if (e.type === 'approval_request') decide(db, e.approval.id, 'approve');
    if (e.type === 'tool_result') expect(alerts(db).map((a) => a.title).at(-1)).toMatch(/^Glow Haus: \d+% of today's generation credits used$/);
  }
  expect(alerts(db)).toHaveLength(2);
});
