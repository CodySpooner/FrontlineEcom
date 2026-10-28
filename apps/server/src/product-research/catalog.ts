import { randomUUID } from 'node:crypto';
import type { PrOrigin } from '@frontline/shared';
import type { Db } from '../db';

export interface NewListing {
  source: string;
  sourceRef: string;
  storeId?: string | null; // set: that store's private row
  origin: PrOrigin;
  title: string;
  category?: string | null;
  url?: string | null;
  canonicalUrl?: string | null;
  imageRef?: string | null;
  currency?: string | null;
  region?: string | null;
  retrievedAt?: string | null;
  rawHash?: string | null;
  transform?: unknown;
  at?: string;
}

/**
 * Stores one source listing, idempotent on (source, source_ref, store): a repeat refreshes what the source says and
 * when it was seen, keeping the first-seen time and the product it belongs to. A new listing gets its own product;
 * matching it to another source's listing is a separate, recorded step (pr_matches), never a silent merge.
 */
export function upsertListing(db: Db, l: NewListing): { id: string; productId: string; created: boolean } {
  const at = l.at ?? new Date().toISOString();
  const prior = db.prepare(`SELECT id, product_id FROM pr_listings WHERE source = ? AND source_ref = ? AND ifnull(store_id, '') = ?`).get(l.source, l.sourceRef, l.storeId ?? '');
  const transform = l.transform === undefined ? null : JSON.stringify(l.transform);
  if (prior) {
    db.prepare(
      `UPDATE pr_listings SET title = ?, category = coalesce(?, category), url = coalesce(?, url), canonical_url = coalesce(?, canonical_url), image_ref = coalesce(?, image_ref),
         currency = coalesce(?, currency), region = coalesce(?, region), retrieved_at = coalesce(?, retrieved_at), raw_hash = coalesce(?, raw_hash),
         transform_json = coalesce(?, transform_json), last_seen_at = ?, status = 'active' WHERE id = ?`,
    ).run(l.title, l.category ?? null, l.url ?? null, l.canonicalUrl ?? null, l.imageRef ?? null, l.currency ?? null, l.region ?? null, l.retrievedAt ?? null, l.rawHash ?? null, transform, at, String(prior.id));
    return { id: String(prior.id), productId: String(prior.product_id), created: false };
  }
  const id = randomUUID();
  const productId = randomUUID();
  db.prepare('INSERT INTO pr_products (id, title, category, image_ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(productId, l.title, l.category ?? null, l.imageRef ?? null, at, at);
  db.prepare(
    `INSERT INTO pr_listings (id, product_id, store_id, source, source_ref, url, canonical_url, title, category, image_ref, origin, currency, region, first_seen_at, last_seen_at, retrieved_at, raw_hash, transform_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, productId, l.storeId ?? null, l.source, l.sourceRef, l.url ?? null, l.canonicalUrl ?? null, l.title, l.category ?? null, l.imageRef ?? null, l.origin, l.currency ?? null, l.region ?? null, at, at, l.retrievedAt ?? null, l.rawHash ?? null, transform);
  return { id, productId, created: true };
}

/** A product the scope may see: one of its listings is shared or the store's own. */
export function productVisible(db: Db, productId: string, store: string | null): boolean {
  const own = store === null ? '' : 'AND (store_id IS NULL OR store_id = ?)';
  return !!db.prepare(`SELECT 1 FROM pr_listings WHERE product_id = ? ${own} LIMIT 1`).get(...(store === null ? [productId] : [productId, store]));
}
