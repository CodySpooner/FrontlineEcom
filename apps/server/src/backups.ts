import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { settingsUrl, type Backup, type BackupKind } from '@frontline/shared';
import { dataDir, dbFile, MIGRATIONS, type Db } from './db';
import { log } from './log';
import { notify } from './settings';

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
      return { name, size: s.size, createdAt: s.mtime.toISOString(), kind: kindOf(name) };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
}

/** The kind recorded in a file name (`frontline-<ISO>-<kind>.db`, settings ST-31); null on older snapshots. */
const kindOf = (name: string) => (/-(daily|manual|before-restore|before-update)\.db$/.exec(name)?.[1] as BackupKind | undefined) ?? null;

/**
 * A consistent copy of the live database, then prunes to the newest KEEP. `kind` goes in the file name. node:sqlite's backup copies a batch of pages
 * per turn, so the server keeps answering (VACUUM INTO held it ~0.5 s on a 70 MB database, longer as it grows). It's
 * written as .part and renamed once whole, so a failed one never lists.
 */
export async function backupNow(db: Db, dir = backupDir(), now = new Date(), kind?: Exclude<BackupKind, 'before-update'>): Promise<Backup> {
  mkdirSync(dir, { recursive: true });
  const name = `frontline-${now.toISOString().slice(0, 19).replace(/:/g, '-')}${kind ? `-${kind}` : ''}.db`;
  const file = join(dir, name);
  // A .part untouched for an hour is from a run the app quit during; one still being copied keeps being written.
  for (const n of readdirSync(dir)) {
    if (n.endsWith('.part') && Date.now() - statSync(join(dir, n)).mtimeMs > 3_600_000) rmSync(join(dir, n), { force: true });
  }
  rmSync(`${file}.part`, { force: true });
  try {
    await backup(db, `${file}.part`);
  } catch (e) {
    rmSync(`${file}.part`, { force: true }); // e.g. the disk filled: give the space back
    throw e;
  }
  rmSync(file, { force: true });
  renameSync(`${file}.part`, file);
  for (const old of listBackups(dir).slice(KEEP)) rmSync(join(dir, old.name), { force: true });
  log('info', 'backup', { name });
  return { name, size: statSync(file).size, createdAt: statSync(file).mtime.toISOString(), kind: kind ?? null };
}

/**
 * Backs up when the newest snapshot is a day old (checked hourly). A failure raises one error notification (not one per
 * retry), and an info one once backups work again. Returns stop().
 */
export function startBackupLoop(db: Db, dir = backupDir()) {
  let failing = false;
  let running = false;
  const check = async () => {
    const newest = listBackups(dir)[0];
    if (running || (newest && Date.now() - Date.parse(newest.createdAt) < DAY_MS)) return;
    running = true;
    try {
      await backupNow(db, dir, new Date(), 'daily');
      if (failing) notify(db, { kind: 'info', title: 'Backups are working again', link: settingsUrl('data') });
      failing = false;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      log('error', 'backup failed', { error });
      if (!failing) notify(db, { kind: 'error', title: 'The daily backup failed', body: `${error}. Check free disk space and the data folder (Settings).`, link: settingsUrl('data') });
      failing = true;
    } finally {
      running = false;
    }
  };
  void check();
  const timer = setInterval(check, 3_600_000);
  return () => clearInterval(timer);
}

/** Exit code that asks the desktop app to start the API again. */
export const RESTART_CODE = 75;

/**
 * Checks a snapshot and stages it to replace `dbPath` on the next start (see openDb), after an undo backup of the
 * current data. Returns an error message, or undefined when staged.
 */
export async function stageRestore(db: Db, name: string, dbPath: string, dir = backupDir()): Promise<string | undefined> {
  const file = join(dir, name);
  if (!/^frontline-[\w-]+\.db$/.test(name) || !existsSync(file)) return 'backup not found';
  let version: number;
  try {
    const snap = new DatabaseSync(file, { readOnly: true });
    try {
      if (snap.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') return 'that backup is damaged';
      version = Number(snap.prepare('PRAGMA user_version').get()?.user_version);
    } finally {
      snap.close();
    }
  } catch {
    return 'that backup is damaged';
  }
  if (version > MIGRATIONS.length) return 'that backup was made by a newer version of the app';
  // Copied first (the undo backup may prune the snapshot being restored), but named .restore, which openDb swaps in,
  // only once the undo backup is whole: quitting or a crash before that leaves the live data as it was.
  const part = `${dbPath}.restore.part`;
  copyFileSync(file, part);
  try {
    await backupNow(db, dir, new Date(), 'before-restore');
  } catch (e) {
    rmSync(part, { force: true });
    throw e;
  }
  renameSync(part, `${dbPath}.restore`);
  log('info', 'restore staged', { name });
}

export function backupRoutes(db: Db, dir = backupDir, dbPath = dbFile, restart: () => void = () => process.exit(RESTART_CODE)) {
  return new Hono()
    .get('/api/backups', (c) => c.json(listBackups(dir())))
    .post('/api/backups', async (c) => c.json(await backupNow(db, dir(), new Date(), 'manual'), 201))
    .post('/api/backups/:name/restore', async (c) => {
      const error = await stageRestore(db, c.req.param('name'), dbPath(), dir());
      if (error) return c.json({ error }, error === 'backup not found' ? 404 : 400);
      // ponytail: exit after the response is out; the desktop app restarts the API, `pnpm dev` needs a manual restart.
      setTimeout(restart, 300);
      return c.json({ restarting: true }, 202);
    });
}
