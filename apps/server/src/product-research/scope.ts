import type { Store } from '@frontline/shared';
import type { Context } from 'hono';
import type { Db } from '../db';
import { getStore } from '../stores';

/**
 * The scope a /api/pr route works in, from `?store=`: a store id, or nothing (or `all`) for All stores. An unknown store
 * answers 404 like a missing record. Store-private tables need a store; shared tables read through `visible`.
 */
export type PrScope = { store: Store } | { store: null };

export function scopeOf(c: Context, db: Db): PrScope | Response {
  const id = c.req.query('store');
  if (!id || id === 'all') return { store: null };
  const store = getStore(db, id);
  return store ? { store } : c.json({ error: 'store not found' }, 404);
}

/** Like `scopeOf`, for routes that read or write a store's private rows: All stores is a 400. */
export function storeOf(c: Context, db: Db): Store | Response {
  const s = scopeOf(c, db);
  if (s instanceof Response) return s;
  return s.store ?? c.json({ error: 'Pick a store: this is kept per store.' }, 400);
}

/**
 * The rows of a shared table (pr_listings, pr_offers, pr_signals, pr_watches) a scope may read: shared rows (store_id
 * NULL) and the store's own private rows, never another store's. All stores reads every row; the UI names the store of
 * a private one.
 */
export const visible = (store: string | null, col = 'store_id'): { sql: string; params: string[] } =>
  store === null ? { sql: '1', params: [] } : { sql: `(${col} IS NULL OR ${col} = ?)`, params: [store] };
