import { copyFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vitest';
import type { Backup } from '@frontline/shared';
import { backupNow, backupRoutes, listBackups, startBackupLoop } from './backups';
import { openDb } from './db';
import { seedDemo } from './demo';

const tmp = () => join(mkdtempSync(join(tmpdir(), 'frontline-backup-')), "O'Brien data", 'backups');

test('backupNow writes a usable snapshot and keeps the newest 7', () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  const dir = tmp();
  const first = backupNow(db, dir, new Date('2026-10-01T03:00:00Z'));
  expect(first.name).toBe('frontline-2026-10-01T03-00-00.db');
  const copy = new DatabaseSync(join(dir, first.name), { readOnly: true });
  expect(copy.prepare('SELECT count(*) AS n FROM stores').get()).toEqual({ n: 3 });
  copy.close();

  for (let d = 2; d <= 9; d++) backupNow(db, dir, new Date(`2026-10-0${d}T03:00:00Z`));
  const names = listBackups(dir).map((b) => b.name);
  expect(names).toHaveLength(7);
  expect(names[0]).toBe('frontline-2026-10-09T03-00-00.db');
  expect(names).not.toContain('frontline-2026-10-02T03-00-00.db');
});

test('backup routes and the daily loop', async () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  const dir = tmp();
  expect(listBackups(dir)).toEqual([]);
  startBackupLoop(db, dir)();
  startBackupLoop(db, dir)(); // the newest is under a day old: no second snapshot
  expect(listBackups(dir)).toHaveLength(1);

  const app = backupRoutes(db, () => dir);
  const res = await app.request('/api/backups', { method: 'POST' });
  expect(res.status).toBe(201);
  const made = (await res.json()) as Backup;
  expect(made.size).toBeGreaterThan(0);
  expect(((await (await app.request('/api/backups')).json()) as Backup[]).map((b) => b.name)).toContain(made.name);
});

test('a staged restore replaces the database when it next opens', () => {
  const dir = mkdtempSync(join(tmpdir(), 'frontline-restore-'));
  const file = join(dir, 'frontline.db');
  const live = openDb(file);
  live.prepare("INSERT INTO settings (key, value_json) VALUES ('who', '\"live\"')").run();
  const snap = openDb(join(dir, 'snap.db'));
  snap.prepare("INSERT INTO settings (key, value_json) VALUES ('who', '\"backup\"')").run();
  snap.close();
  live.close();
  copyFileSync(join(dir, 'snap.db'), `${file}.restore`);
  const reopened = openDb(file);
  expect(reopened.prepare("SELECT value_json FROM settings WHERE key = 'who'").get()).toEqual({ value_json: '"backup"' });
  expect(existsSync(`${file}.restore`)).toBe(false);
});

test('restore: checks the snapshot, keeps an undo backup, stages it and asks for a restart', async () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  const dir = tmp();
  const dbPath = join(dir, '..', 'frontline.db');
  for (let d = 1; d <= 7; d++) backupNow(db, dir, new Date(`2026-10-0${d}T03:00:00Z`));
  writeFileSync(join(dir, 'frontline-junk.db'), 'not a database');
  const newer = join(dir, 'frontline-newer.db');
  copyFileSync(join(dir, 'frontline-2026-10-07T03-00-00.db'), newer);
  const n = new DatabaseSync(newer);
  n.exec('PRAGMA user_version = 9999');
  n.close();

  let restarts = 0;
  const app = backupRoutes(db, () => dir, () => dbPath, () => restarts++);
  const restore = async (name: string) => {
    const res = await app.request(`/api/backups/${name}/restore`, { method: 'POST' });
    return [res.status, await res.json()];
  };
  expect(await restore('..%2Fsecret.key')).toEqual([404, { error: 'backup not found' }]);
  expect(await restore('frontline-nope.db')).toEqual([404, { error: 'backup not found' }]);
  expect(await restore('frontline-junk.db')).toEqual([400, { error: 'that backup is damaged' }]);
  expect(await restore('frontline-newer.db')).toEqual([400, { error: 'that backup was made by a newer version of the app' }]);
  expect(existsSync(`${dbPath}.restore`)).toBe(false);

  // The oldest snapshot: the undo backup prunes it from the folder, but it's already staged.
  expect(await restore('frontline-2026-10-01T03-00-00.db')).toEqual([202, { restarting: true }]);
  expect(existsSync(`${dbPath}.restore`)).toBe(true);
  expect(listBackups(dir).map((b) => b.name)).not.toContain('frontline-2026-10-01T03-00-00.db');
  expect(restarts).toBe(0);
  await new Promise((r) => setTimeout(r, 350));
  expect(restarts).toBe(1);
});
