// Change History (ST-09, decision 15): every row of `settings_changes`, newest first and paged. No row holds a secret
// value: a secret's row says only "replaced" or "removed" (its writers make sure; config/records.test.ts and
// config/changes.test.ts prove it).
import { Hono } from 'hono';
import { SETTINGS, type ChangeHistoryStore, type ChangeState, type ConfigChange, type ConfigChangesPage } from '@frontline/shared';
import type { Db } from '../db';

const PAGE = 50;
/** `<at>|<rowid>` of the page's last row. */
const CURSOR = /^([^|]+)\|(\d+)$/;

export const toChange = (r: Record<string, unknown>): ConfigChange => ({
  id: String(r.id),
  at: String(r.at),
  ...(r.request_id ? { requestId: String(r.request_id) } : {}),
  actor: String(r.actor),
  scope: String(r.scope),
  ...(r.store_id ? { storeId: String(r.store_id) } : {}),
  ...(r.store_name ? { storeName: String(r.store_name) } : {}),
  setting: String(r.setting),
  ...(r.before_json != null ? { before: JSON.parse(String(r.before_json)) } : {}),
  ...(r.after_json != null ? { after: JSON.parse(String(r.after_json)) } : {}),
  state: r.state as ChangeState,
  ...(r.detail ? { detail: String(r.detail) } : {}),
});

/**
 * Newest first; within one save, last written first. `cursor` is a page's `next`. `search` (ST-32) matches a setting's
 * id, or its registry label or synonyms, ignoring case.
 */
export function listChanges(db: Db, q: { store?: string; setting?: string; scope?: string; request?: string; search?: string; cursor?: string }): ConfigChangesPage {
  const where: string[] = [];
  const args: (string | number)[] = [];
  for (const [col, v] of [['store_id', q.store], ['setting', q.setting], ['scope', q.scope], ['request_id', q.request]] as const)
    if (v) where.push(`${col} = ?`), args.push(v);
  const term = q.search?.trim().toLowerCase();
  if (term) {
    const named = SETTINGS.filter((d) => [d.id, d.label, ...(d.synonyms ?? [])].some((t) => t.toLowerCase().includes(term))).map((d) => d.id);
    where.push(`(instr(lower(setting), ?) > 0 OR setting IN (${named.map(() => '?').join(',') || "''"}))`), args.push(term, ...named);
  }
  const [, at, n] = q.cursor?.match(CURSOR) ?? [];
  if (at) where.push('(at < ? OR (at = ? AND rowid < ?))'), args.push(at, at, Number(n));
  const rows = db.prepare(`SELECT rowid AS n, * FROM settings_changes ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY at DESC, rowid DESC LIMIT ?`).all(...args, PAGE + 1);
  const page = rows.slice(0, PAGE);
  const last = page.at(-1);
  return { changes: page.map(toChange), ...(rows.length > PAGE ? { next: `${last!.at}|${last!.n}` } : {}) };
}

/** The stores that have rows, a deleted one included, each by the name its newest row recorded (ST-32's filter). */
export function historyStores(db: Db): ChangeHistoryStore[] {
  // SQLite takes the bare columns of a max() group from the row with that max: the newest name.
  return db
    .prepare('SELECT c.store_id AS id, c.store_name AS name, max(c.at), s.id IS NULL AS deleted FROM settings_changes c LEFT JOIN stores s ON s.id = c.store_id WHERE c.store_id IS NOT NULL GROUP BY c.store_id ORDER BY lower(c.store_name)')
    .all()
    .map((r) => ({ id: String(r.id), name: String(r.name ?? r.id), deleted: r.deleted === 1 }));
}

export function changeRoutes(db: Db) {
  return new Hono()
    .get('/api/config/changes', (c) => {
      const { store, setting, scope, request, search, cursor } = c.req.query();
      if (cursor && !CURSOR.test(cursor)) return c.json({ error: 'cursor must be the next of a page this list gave' }, 400);
      return c.json(listChanges(db, { store, setting, scope, request, search, cursor }));
    })
    .get('/api/config/changes/stores', (c) => c.json(historyStores(db)));
}
