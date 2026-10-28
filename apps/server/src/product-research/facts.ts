import type { PrGranularity } from '@frontline/shared';
import type { Db } from '../db';
import { listStores } from '../stores';
import { classifyDemand, type Demand } from './demand';
import { shipTo } from './profile';

/** A set's points, oldest first ("<1" stored as 0). */
export const pointsOf = (db: Db, signalId: string) =>
  db.prepare('SELECT at, value FROM pr_signal_points WHERE signal_id = ? ORDER BY at').all(signalId).map((r) => ({ at: String(r.at), value: Number(r.value) }));

export const demandOf = (db: Db, s: { id: string; granularity: unknown }): Demand | null =>
  s.granularity ? classifyDemand(pointsOf(db, s.id), s.granularity as PrGranularity) : null;

/**
 * The shared sets that speak for a product: its product-scope sets and the query-scope sets the owner confirmed for it,
 * newest first. A suggested (unconfirmed) link or a category set never does (decision 9). A store's private sets (its
 * own orders, notes) stay out of the shared facts: the discovery API adds them for that store's scope.
 */
export const productSets = (db: Db, productId: string) =>
  db
    .prepare(
      `SELECT id, granularity, origin, retrieved_at FROM pr_signals WHERE store_id IS NULL AND (product_id = ?
        OR id IN (SELECT signal_id FROM pr_signal_links WHERE product_id = ? AND confirmed_at IS NOT NULL))
       ORDER BY retrieved_at DESC, id`,
    )
    .all(productId, productId);

/**
 * Rank, the demand part: one `pr_product_facts` row per (store ship-to, store currency) with the product's demand set
 * (the newest set with enough history, else the newest), its class and momentum, when it was first seen and how old its
 * newest evidence is. Fulfillment and cost columns are left as they are.
 */
export function rankDemand(db: Db, productId: string, now = new Date()) {
  const sets = productSets(db, productId).map((s) => ({ id: String(s.id), retrievedAt: String(s.retrieved_at), d: demandOf(db, { id: String(s.id), granularity: s.granularity }) }));
  const best = sets.find((s) => s.d && s.d.cls !== 'insufficient_history') ?? sets[0];
  const seen = db.prepare('SELECT min(first_seen_at) AS first, max(retrieved_at) AS newest FROM pr_listings WHERE product_id = ?').get(productId);
  const offer = db.prepare('SELECT max(o.checked_at) AS at FROM pr_offers o JOIN pr_listings l ON l.id = o.listing_id WHERE l.product_id = ?').get(productId)?.at;
  const evidenceAt = [seen?.newest, offer, sets[0]?.retrievedAt].filter((t): t is string => typeof t === 'string').sort().pop() ?? null;
  const keys = new Map(listStores(db).map((s) => [`${shipTo(db, s) ?? ''}|${s.currency}`, [shipTo(db, s) ?? '', s.currency] as const]));
  const up = db.prepare(
    `INSERT INTO pr_product_facts (product_id, destination, currency, demand_class, momentum, demand_set_id, demand_peak_month, first_seen_at, evidence_at, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (product_id, destination, currency) DO UPDATE SET demand_class = excluded.demand_class, momentum = excluded.momentum,
       demand_set_id = excluded.demand_set_id, demand_peak_month = excluded.demand_peak_month, first_seen_at = excluded.first_seen_at,
       evidence_at = excluded.evidence_at, computed_at = excluded.computed_at`,
  );
  for (const [destination, currency] of keys.values())
    up.run(productId, destination, currency, best?.d?.cls ?? null, best?.d?.momentum ?? null, best?.id ?? null, best?.d?.peakMonth ?? null, (seen?.first as string | null) ?? null, evidenceAt, now.toISOString());
}
