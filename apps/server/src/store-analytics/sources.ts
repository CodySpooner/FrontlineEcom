import type { Db } from '../db';
import { decrypt } from '../secrets';

/** Long runs of key characters (API tokens, JWT segments, signed ids), with a "Bearer " before them. */
const TOKENISH = /(?:bearer\s+)?[A-Za-z0-9_-]{24,}(?:\.[A-Za-z0-9_-]+)*/gi;

/**
 * The one way a source error leaves the server (decision 23): every credential value (plain or URL-encoded) and every
 * token-shaped string removed, cut to 300 characters.
 */
export function scrubError(text: string, secrets: string[] = []) {
  let out = text;
  for (const s of secrets.filter((v) => v.length >= 4).sort((a, b) => b.length - a.length))
    out = out.replaceAll(s, '[hidden]').replaceAll(encodeURIComponent(s), '[hidden]');
  return out.replace(TOKENISH, '[hidden]').slice(0, 300);
}

/** An integration's secret values, to scrub its errors with. Kept in memory only. */
export function secretsOf(db: Db, key: Buffer, integrationId: string): string[] {
  const r = db.prepare('SELECT encrypted_credentials FROM integrations WHERE id = ?').get(integrationId);
  try {
    return Object.values(decrypt<Record<string, unknown>>(key, String(r?.encrypted_credentials), integrationId)).map(String);
  } catch {
    return [];
  }
}

const RUN_DAYS = 90;

/** At server start: runs the last process left `running` were cut off, and runs older than 90 days go. */
export function recoverRuns(db: Db, now = new Date()) {
  db.prepare("UPDATE sync_runs SET status = 'interrupted' WHERE status = 'running'").run();
  db.prepare('DELETE FROM sync_runs WHERE started_at < ?').run(new Date(now.getTime() - RUN_DAYS * 86_400_000).toISOString());
}

export function startRun(db: Db, integrationId: string, storeId: string | null, kind: string, now = new Date()) {
  return Number(
    db.prepare("INSERT INTO sync_runs (integration_id, store_id, kind, started_at, status) VALUES (?, ?, ?, ?, 'running')").run(integrationId, storeId, kind, now.toISOString()).lastInsertRowid,
  );
}

/** `error` undefined: the run succeeded. Returns the scrubbed error. */
export function endRun(db: Db, key: Buffer, runId: number, integrationId: string, error?: string, now = new Date()) {
  const scrubbed = error === undefined ? null : scrubError(error, secretsOf(db, key, integrationId));
  db.prepare('UPDATE sync_runs SET finished_at = ?, status = ?, error = ? WHERE id = ?').run(now.toISOString(), scrubbed === null ? 'done' : 'failed', scrubbed, runId);
  return scrubbed;
}
