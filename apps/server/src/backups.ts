import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import type { Backup } from '@frontline/shared';
import { dataDir, type Db } from './db';
import { log } from './log';

/** Snapshots kept in <data dir>/backups; older ones are deleted. */
const KEEP = 7;
const DAY_MS = 86_400_000;

export const backupDir = () => join(dataDir(), 'backups');

/** Newest first. */
export function listBackups(dir = backupDir()): Backup[] {
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => /^frontline-.*\.db$/.test(n));
  } catch {
    return [];
  }
  return names
    .map((name) => {
      const s = statSync(join(dir, name));
      return { name, size: s.size, createdAt: s.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
}

/** A consistent copy of the live database (VACUUM INTO), then prunes to the newest KEEP. */
export function backupNow(db: Db, dir = backupDir(), now = new Date()): Backup {
  mkdirSync(dir, { recursive: true });
  const name = `frontline-${now.toISOString().slice(0, 19).replace(/:/g, '-')}.db`;
  const file = join(dir, name);
  rmSync(file, { force: true });
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  for (const old of listBackups(dir).slice(KEEP)) rmSync(join(dir, old.name), { force: true });
  log('info', 'backup', { name });
  return { name, size: statSync(file).size, createdAt: statSync(file).mtime.toISOString() };
}

/** Backs up when the newest snapshot is a day old (checked hourly). Returns stop(). */
export function startBackupLoop(db: Db, dir = backupDir()) {
  const check = () => {
    const newest = listBackups(dir)[0];
    if (newest && Date.now() - Date.parse(newest.createdAt) < DAY_MS) return;
    try {
      backupNow(db, dir);
    } catch (e) {
      log('error', 'backup failed', { error: e instanceof Error ? e.message : String(e) });
    }
  };
  check();
  const timer = setInterval(check, 3_600_000);
  return () => clearInterval(timer);
}

export function backupRoutes(db: Db, dir = backupDir) {
  return new Hono()
    .get('/api/backups', (c) => c.json(listBackups(dir())))
    .post('/api/backups', (c) => c.json(backupNow(db, dir()), 201));
}
