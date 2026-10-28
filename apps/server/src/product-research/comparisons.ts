import { randomUUID } from 'node:crypto';
import { PR_COMPARE_FIELDS, PR_COMPARE_MAX, type PrCompareField, type PrComparison, type PrComparisonInput, type Store } from '@frontline/shared';
import type { Db } from '../db';
import { productVisible } from './catalog';
import { parseOverrides } from './economics';
import { shipTo } from './profile';

// Saved comparisons (PR-19): the products and the owner's shared figures. Each product's own figures are read live.

const row = (r: Record<string, unknown>): PrComparison => {
  const a = JSON.parse(String(r.assumptions_json)) as Pick<PrComparison, 'destination' | 'currency' | 'figures'>;
  const ids = JSON.parse(String(r.product_ids_json)) as string[];
  return { id: String(r.id), name: String(r.name), productIds: ids, destination: a.destination, currency: a.currency, figures: a.figures, createdAt: String(r.created_at), updatedAt: String(r.updated_at) };
};

export const listComparisons = (db: Db, storeId: string) => db.prepare('SELECT * FROM pr_comparisons WHERE store_id = ? ORDER BY updated_at DESC').all(storeId).map(row);

/** The owner's comparison, checked: a name, 1–4 different products this store can see, and shared figures only. */
export function parseComparison(db: Db, storeId: string, body: unknown): PrComparisonInput | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name || name.length > 80) return { error: 'name must be 1 to 80 characters' };
  const ids = b.productIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > PR_COMPARE_MAX || ids.some((x) => typeof x !== 'string') || new Set(ids).size !== ids.length)
    return { error: `productIds must be 1 to ${PR_COMPARE_MAX} different products` };
  if (ids.some((id: string) => !productVisible(db, id, storeId))) return { error: 'product not found' };
  const own = Object.keys((b.figures ?? {}) as object).find((k) => !PR_COMPARE_FIELDS.includes(k as PrCompareField));
  if (own) return { error: `figures.${own} is each product's own, not a shared assumption` };
  const o = parseOverrides({ base: b.figures });
  if ('error' in o) return { error: o.error.replace(/^base/, 'figures') };
  return { name, productIds: ids as string[], figures: o.base as PrComparisonInput['figures'] };
}

/** Saves a new comparison, or replaces `id`'s (undefined: not this store's). The store's ship-to and currency are kept with it. */
export function saveComparison(db: Db, store: Store, c: PrComparisonInput, id?: string, now = new Date()): PrComparison | undefined {
  const at = now.toISOString();
  const assumptions = JSON.stringify({ destination: shipTo(db, store), currency: store.currency, figures: c.figures });
  if (id) {
    const r = db.prepare('UPDATE pr_comparisons SET name = ?, product_ids_json = ?, assumptions_json = ?, updated_at = ? WHERE id = ? AND store_id = ?');
    if (!r.run(c.name, JSON.stringify(c.productIds), assumptions, at, id, store.id).changes) return undefined;
  } else {
    id = randomUUID();
    db.prepare('INSERT INTO pr_comparisons (id, store_id, name, product_ids_json, assumptions_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, store.id, c.name, JSON.stringify(c.productIds), assumptions, at, at);
  }
  return row(db.prepare('SELECT * FROM pr_comparisons WHERE id = ?').get(id)!);
}

export const deleteComparison = (db: Db, storeId: string, id: string) => db.prepare('DELETE FROM pr_comparisons WHERE id = ? AND store_id = ?').run(id, storeId).changes > 0;
