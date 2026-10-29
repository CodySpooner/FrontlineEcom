// Apply jobs (ST-09, decision 6): a setting whose effect runs in the background (the base currency re-rank, ST-16; a
// store's currency or niche re-evaluation, ST-28) writes its change row `applying`. This runner does the job once the
// write has committed, then marks the row `applied` or `failed` (its reason in `detail`) and says so on the live socket.
import { Hono } from 'hono';
import type { ConfigChange } from '@frontline/shared';
import type { Db } from '../db';
import { publish } from '../live';
import { toChange } from './changes';

/** The background job of each setting id that has one. ST-16 and ST-28 add theirs; a job must be safe to run twice. */
export const JOBS = new Map<string, (db: Db, change: ConfigChange) => void | Promise<void>>();

/** Keyed by change row: one run at a time per row. */
const running = new Set<string>();

/** Runs the row's job if it's still `applying` (a rolled-back write left none) and nothing runs it yet. */
export async function runJob(db: Db, id: string) {
  const r = running.has(id) ? undefined : db.prepare("SELECT * FROM settings_changes WHERE id = ? AND state = 'applying'").get(id);
  if (!r) return;
  running.add(id);
  const change = toChange(r);
  let failed: string | undefined;
  try {
    const job = JOBS.get(change.setting);
    if (!job) throw new Error('Nothing applies this setting any more.');
    await job(db, change);
  } catch (e) {
    failed = (e instanceof Error ? e.message : String(e)).slice(0, 500);
  } finally {
    running.delete(id);
  }
  const done = db.prepare("UPDATE settings_changes SET state = ?, detail = ? WHERE id = ? AND state = 'applying' RETURNING *").get(failed ? 'failed' : 'applied', failed ?? r.detail ?? null, id);
  if (done) publish({ type: 'config_change', change: toChange(done) });
}

/** At boot: finishes the jobs a quit or crash left `applying`. */
export function resumeJobs(db: Db) {
  for (const r of db.prepare("SELECT id FROM settings_changes WHERE state = 'applying'").all()) void runJob(db, String(r.id));
}

/** A failed row goes back to `applying` and runs again. Only the first of two retries moves it, so two have one's effect. */
export function retryJob(db: Db, id: string): ConfigChange | undefined {
  const r = db.prepare("UPDATE settings_changes SET state = 'applying', detail = NULL WHERE id = ? AND state = 'failed' RETURNING *").get(id);
  if (!r) return undefined;
  const change = toChange(r);
  publish({ type: 'config_change', change });
  setImmediate(() => void runJob(db, id));
  return change;
}

/** POST /api/config/changes/:id/retry: a store's row names its store (`?store=`; decision 1's store rule). */
export function applyRoutes(db: Db) {
  return new Hono().post('/api/config/changes/:id/retry', (c) => {
    const id = c.req.param('id');
    const store = c.req.query('store') || undefined;
    const r = db.prepare('SELECT * FROM settings_changes WHERE id = ?').get(id);
    if (r?.store_id && !store) return c.json({ error: 'Name the store this change belongs to (?store=).' }, 400);
    if (!r || (r.store_id ?? undefined) !== store) return c.json({ error: 'change not found' }, 404);
    if (r.state === 'saved') return c.json({ error: 'This change has no job to retry.' }, 409);
    const again = retryJob(db, id);
    return again ? c.json(again, 202) : c.json(toChange(r)); // already applying or applied: nothing to do
  });
}
