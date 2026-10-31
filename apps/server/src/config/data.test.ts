// ST-31 (decision 15): Data & Backups says where the key and the data folder come from, and what made each backup.
import { randomBytes } from 'node:crypto';
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Backup, Health } from '@frontline/shared';
import { afterEach, expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { backupNow, backupRoutes, listBackups, stageRestore } from '../backups';
import { openDb } from '../db';

afterEach(() => vi.unstubAllEnvs());

test.each([
  ['the data folder', {}, 'data-dir', 'default'],
  ['a key set by hand', { FRONTLINE_SECRET_KEY: 'key', FRONTLINE_DATA_DIR: 'D:/frontline' }, 'environment', 'env'],
  ["the desktop app's safe storage", { FRONTLINE_SECRET_KEY: 'key', FRONTLINE_KEY_SOURCE: 'safe-storage', FRONTLINE_DATA_DIR: 'C:/Users/x/AppData/Roaming/Frontline Ecom/data' }, 'safe-storage', 'desktop'],
] as const)('the key location from %s is named, never the key', async (_, env, keyLocation, dataDirSource) => {
  const app = createApp(openDb());
  const key = randomBytes(32).toString('base64');
  vi.stubEnv('FRONTLINE_SECRET_KEY', 'FRONTLINE_SECRET_KEY' in env ? key : '');
  vi.stubEnv('FRONTLINE_KEY_SOURCE', 'FRONTLINE_KEY_SOURCE' in env ? env.FRONTLINE_KEY_SOURCE : '');
  vi.stubEnv('FRONTLINE_DATA_DIR', 'FRONTLINE_DATA_DIR' in env ? env.FRONTLINE_DATA_DIR : '');
  const r = await app.request('/api/health');
  const text = await r.text();
  expect(JSON.parse(text) as Health).toMatchObject({ keyLocation, dataDirSource });
  expect(text).not.toContain(key);
  expect(text).not.toContain(Buffer.from(key, 'base64').toString('hex'));
});

test("each kind round-trips through the file name; a snapshot from before kinds were recorded says so", async () => {
  const db = openDb();
  const dir = join(mkdtempSync(join(tmpdir(), 'frontline-kinds-')), 'backups');
  const daily = await backupNow(db, dir, new Date('2026-10-01T03:00:00Z'), 'daily');
  expect(daily).toMatchObject({ name: 'frontline-2026-10-01T03-00-00-daily.db', kind: 'daily' });
  const manual = (await (await backupRoutes(db, () => dir).request('/api/backups', { method: 'POST' })).json()) as Backup;
  expect(manual.name).toMatch(/^frontline-[\dT-]+-manual\.db$/);
  // Restoring makes an undo copy first; openDb names its pre-migration copy -before-update.
  const live = join(dir, '..', 'frontline.db');
  expect(await stageRestore(db, daily.name, live, dir)).toBeUndefined();
  copyFileSync(join(dir, daily.name), join(dir, 'frontline-2026-09-30T03-00-00-before-update.db'));
  copyFileSync(join(dir, daily.name), join(dir, 'frontline-2026-09-29T03-00-00.db'));
  writeFileSync(join(dir, 'frontline-2026-09-28T03-00-00-weekly.db'), ''); // an unknown suffix isn't guessed at
  const kinds = Object.fromEntries(listBackups(dir).map((b) => [b.name.replace(/^frontline-[\dT-]{19}-?/, ''), b.kind]));
  expect(kinds).toEqual({ 'daily.db': 'daily', 'manual.db': 'manual', 'before-restore.db': 'before-restore', 'before-update.db': 'before-update', '.db': null, 'weekly.db': null });
});
