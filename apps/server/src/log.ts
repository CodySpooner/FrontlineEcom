import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MAX_BYTES = 5 * 1024 * 1024;
let file: string | undefined;

/** Starts writing to <dir>/logs/api.log. Until then (tests, scripts) log() is a no-op. */
export function initLog(dir: string) {
  mkdirSync(join(dir, 'logs'), { recursive: true });
  file = join(dir, 'logs', 'api.log');
}

/**
 * One JSON line per event: { at, level, msg, ...fields }. Keeps one rotated copy (api.log.1) at 5 MB.
 * Never pass credentials or tokens in `fields`.
 */
export function log(level: 'info' | 'warn' | 'error', msg: string, fields: Record<string, unknown> = {}) {
  if (!file) return;
  try {
    if (statSync(file, { throwIfNoEntry: false })?.size! > MAX_BYTES) renameSync(file, `${file}.1`);
    appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), level, msg, ...fields }) + '\n');
  } catch {
    // A full or locked disk must not take the API down with it.
  }
}
