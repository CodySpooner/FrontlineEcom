import { mkdtempSync } from 'node:fs';
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
