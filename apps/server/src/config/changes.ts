// Change History (ST-09, decision 15): every row of `settings_changes`, newest first and paged. No row holds a secret
// value: a secret's row says only "replaced" or "removed" (its writers make sure; config/records.test.ts and
// config/changes.test.ts prove it).
import { Hono } from 'hono';
import type { ChangeState, ConfigChange, ConfigChangesPage } from '@frontline/shared';
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

/** Newest first; within one save, last written first. `cursor` is a page's `next`. */
export function listChanges(db: Db, q: { store?: string; setting?: string; scope?: string; request?: string; cursor?: string }): ConfigChangesPage {
  const where: string[] = [];
  const args: (string | number)[] = [];
  for (const [col, v] of [['store_id', q.store], ['setting', q.setting], ['scope', q.scope], ['request_id', q.request]] as const)
    if (v) where.push(`${col} = ?`), args.push(v);
  const [, at, n] = q.cursor?.match(CURSOR) ?? [];
  if (at) where.push('(at < ? OR (at = ? AND rowid < ?))'), args.push(at, at, Number(n));
  const rows = db.prepare(`SELECT rowid AS n, * FROM settings_changes ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY at DESC, rowid DESC LIMIT ?`).all(...args, PAGE + 1);
  const page = rows.slice(0, PAGE);
  const last = page.at(-1);
  return { changes: page.map(toChange), ...(rows.length > PAGE ? { next: `${last!.at}|${last!.n}` } : {}) };
}

export function changeRoutes(db: Db) {
  return new Hono().get('/api/config/changes', (c) => {
    const { store, setting, scope, request, cursor } = c.req.query();
    if (cursor && !CURSOR.test(cursor)) return c.json({ error: 'cursor must be the next of a page this list gave' }, 400);
    return c.json(listChanges(db, { store, setting, scope, request, cursor }));
  });
}
