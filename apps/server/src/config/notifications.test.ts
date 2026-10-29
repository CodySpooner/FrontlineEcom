import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { sendDigest } from '../digest';
import { getSettings, notify } from '../settings';
import { writeConfig } from './write';

// The machine is New York; the workspace is Tokyo, so quiet hours on the machine's clock would fail.
let tz: string | undefined;
beforeEach(() => {
  tz = process.env.TZ;
  process.env.TZ = 'America/New_York';
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-28T03:00:00Z')); // 12:00 in Tokyo
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
  return { db, app: createApp(db) };
};
const set = (db: Db, values: Record<string, unknown>) => writeConfig(db, [{ doc: 'app', version: getSettings(db).version, set: values }], { current: () => getSettings(db) });
const rows = (db: Db) => Number(db.prepare('SELECT count(*) AS n FROM notifications').get()?.n);
const at = (iso: string) => vi.setSystemTime(new Date(iso));

test('a category turned off or a muted store stores nothing; info always shows', () => {
  const { db } = setup();
  const before = rows(db);
  set(db, { 'notifications.errors': false, 'notifications.mutedStores': ['glow'] });
  expect(notify(db, { kind: 'error', title: 'Sync failed', storeId: 'peak' })).toBeUndefined();
  expect(notify(db, { kind: 'agent_done', title: 'Done', storeId: 'glow' })).toBeUndefined();
  expect(rows(db)).toBe(before);
  expect(notify(db, { kind: 'agent_done', title: 'Done', storeId: 'peak' })).toMatchObject({ toast: true });
  expect(notify(db, { kind: 'info', title: 'Glow Haus is live', storeId: 'glow' })).toBeDefined();
  expect(rows(db)).toBe(before + 2);
});

test('toasts off for a category, or quiet hours across midnight in the workspace zone, store with toast: false', () => {
  const { db } = setup();
  set(db, { 'notifications.toasts.agentDone': false, 'notifications.quietHours': { from: 22, to: 7 } });
  expect(notify(db, { kind: 'agent_done', title: 'Done 1' })).toMatchObject({ toast: false });
  expect(notify(db, { kind: 'error', title: 'Failed 1' })).toMatchObject({ toast: true }); // noon in Tokyo
  at('2026-10-28T14:30:00Z'); // 23:30 in Tokyo, 10:30 in New York
  expect(notify(db, { kind: 'error', title: 'Failed 2' })).toMatchObject({ toast: false });
  at('2026-10-28T21:59:00Z'); // 06:59 in Tokyo, the next morning
  expect(notify(db, { kind: 'error', title: 'Failed 3' })).toMatchObject({ toast: false });
  at('2026-10-28T22:00:00Z'); // 07:00 in Tokyo: over
  expect(notify(db, { kind: 'error', title: 'Failed 4' })).toMatchObject({ toast: true });
  expect(db.prepare("SELECT count(*) AS n FROM notifications WHERE title LIKE 'Failed %'").get()?.n).toBe(4); // the bell gets every one
  // The digest is an info notification with its own switch.
  at('2026-10-28T03:00:00Z');
  expect(sendDigest(db)).toMatchObject({ kind: 'info', toast: true });
  set(db, { 'notifications.toasts.digest': false });
  db.prepare('UPDATE notifications SET read_at = ?').run(new Date().toISOString());
  expect(sendDigest(db)).toMatchObject({ kind: 'info', toast: false });
});

test('an identical unread notification within 10 minutes is stored once; approvals never merge', () => {
  const { db } = setup();
  const n = { kind: 'error' as const, title: 'Shopify stopped syncing', body: 'Token expired', storeId: 'glow', link: '/settings/integrations' };
  expect(notify(db, n)).toBeDefined();
  at('2026-10-28T03:09:00Z');
  expect(notify(db, n)).toBeUndefined();
  expect(notify(db, { ...n, body: 'Rate limited' })).toBeDefined(); // not identical
  at('2026-10-28T03:11:00Z');
  expect(notify(db, n)).toBeDefined(); // 10 minutes on from the first
  db.prepare('UPDATE notifications SET read_at = ?').run(new Date().toISOString());
  expect(notify(db, n)).toBeDefined(); // the last one was read
  const ask = { kind: 'approval' as const, title: 'Raise the Glow Haus budget to $40/day', storeId: 'glow', link: '/' };
  expect([notify(db, ask), notify(db, ask)].every(Boolean)).toBe(true);
  expect(db.prepare("SELECT count(*) AS n FROM notifications WHERE kind = 'approval' AND title LIKE 'Raise%'").get()?.n).toBe(2);
});

test('the test notification reports what the server decided', async () => {
  const { db, app } = setup();
  const send = async (category: unknown) => {
    const res = await app.request('/api/notifications/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ category }) });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const before = rows(db);
  expect(await send('errors')).toEqual({ status: 200, body: { bell: 'Bell: added', toast: 'Windows toast: requested' } });
  set(db, { 'notifications.toasts.errors': false, 'notifications.errors': false });
  expect((await send('errors')).body).toEqual({ bell: 'Bell: added', toast: 'Windows toast: not sent (toasts off for Errors)' }); // a category off still tests
  set(db, { 'notifications.quietHours': { from: 22, to: 7 } });
  at('2026-10-28T14:30:00Z'); // 23:30 in Tokyo
  expect((await send('digest')).body).toEqual({ bell: 'Bell: added', toast: 'Windows toast: not sent (quiet hours until 07:00)' });
  expect((await send('digest')).body.bell).toBe('Bell: added'); // a second test isn't merged into the first
  expect(rows(db)).toBe(before + 4);
  expect(db.prepare("SELECT DISTINCT kind FROM notifications WHERE title = 'Test notification'").all()).toEqual([{ kind: 'info' }]);
  expect(await send('spam')).toMatchObject({ status: 400, body: { field: 'category' } });
});
