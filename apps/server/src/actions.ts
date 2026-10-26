import { Hono } from 'hono';
import type { ActionKind, ActionLogEntry } from '@frontline/shared';
import type { Db } from './db';

/** Runs a live write (ad account, store) and records it with its outcome; rethrows the error. */
export async function logAction<T>(db: Db, storeId: string, action: ActionKind, target: string, detail: object, run: () => Promise<T>): Promise<T> {
  const add = (error: string | null) =>
    db.prepare('INSERT INTO action_log (store_id, action, target, detail_json, error, at) VALUES (?, ?, ?, ?, ?, ?)').run(storeId, action, target, JSON.stringify(detail), error, new Date().toISOString());
  try {
    const out = await run();
    add(null);
    return out;
  } catch (e) {
    add(e instanceof Error ? e.message : String(e));
    throw e;
  }
}

export function listActions(db: Db, storeIds: string[], limit: number): ActionLogEntry[] {
  if (!storeIds.length) return [];
  return db
    .prepare(`SELECT * FROM action_log WHERE store_id IN (${storeIds.map(() => '?').join(',')}) ORDER BY id DESC LIMIT ?`)
    .all(...storeIds, limit)
    .map((r) => ({
      id: Number(r.id),
      storeId: String(r.store_id),
      action: r.action as ActionKind,
      target: String(r.target),
      detail: JSON.parse(String(r.detail_json)),
      ok: r.error == null,
      ...(r.error != null ? { error: String(r.error) } : {}),
      at: String(r.at),
    }));
}

export function actionRoutes(db: Db, pickStores: (q: string | undefined) => string[]) {
  return new Hono().get('/api/actions', (c) => {
    const limit = Math.min(200, Math.max(1, Math.floor(Number(c.req.query('limit'))) || 50));
    return c.json(listActions(db, pickStores(c.req.query('stores')), limit));
  });
}
