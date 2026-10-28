import type { PrGranularity } from '@frontline/shared';
import type { Db } from '../db';
import { storedRate } from '../fx';
import { getSettings } from '../settings';
import { listStores } from '../stores';
import { classifyDemand, type Demand } from './demand';
import { fulfillmentOf, type OfferRow } from './fulfillment';
import { minorDigits } from './money';
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
 * The (destination, currency) pairs facts are kept for: each store's ship-to and currency (`''` for a store with no
 * ship-to yet), plus All stores' default, US in the base currency (decision 5).
 */
export function factKeys(db: Db): (readonly [string, string])[] {
  const keys = new Map(listStores(db).map((s) => [`${shipTo(db, s) ?? ''}|${s.currency}`, [shipTo(db, s) ?? '', s.currency] as const]));
  const base = getSettings(db).baseCurrency;
  keys.set(`US|${base}`, ['US', base]);
  return [...keys.values()];
}

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
  const up = db.prepare(
    `INSERT INTO pr_product_facts (product_id, destination, currency, demand_class, momentum, demand_set_id, demand_peak_month, first_seen_at, evidence_at, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (product_id, destination, currency) DO UPDATE SET demand_class = excluded.demand_class, momentum = excluded.momentum,
       demand_set_id = excluded.demand_set_id, demand_peak_month = excluded.demand_peak_month, first_seen_at = excluded.first_seen_at,
       evidence_at = excluded.evidence_at, computed_at = excluded.computed_at`,
  );
  for (const [destination, currency] of factKeys(db))
    up.run(productId, destination, currency, best?.d?.cls ?? null, best?.d?.momentum ?? null, best?.id ?? null, best?.d?.peakMonth ?? null, (seen?.first as string | null) ?? null, evidenceAt, now.toISOString());
}

/** A product's offer rows: the shared ones, plus `storeId`'s own (owner-entered) when given. Never a sample's. */
export const offerRows = (db: Db, productId: string, storeId: string | null = null): OfferRow[] =>
  db
    .prepare(
      `SELECT o.* FROM pr_offers o JOIN pr_listings l ON l.id = o.listing_id
       WHERE l.product_id = ? AND l.origin != 'legacy_sample' AND (l.store_id IS NULL OR l.store_id = ?) AND (o.store_id IS NULL OR o.store_id = ?)`,
    )
    .all(productId, storeId, storeId)
    .map((r) => ({
      id: String(r.id),
      listingId: String(r.listing_id),
      variantId: r.variant_id == null ? null : String(r.variant_id),
      supplier: String(r.supplier),
      destination: r.destination == null ? null : String(r.destination),
      quantity: Number(r.quantity),
      method: r.method == null ? null : String(r.method),
      unitCost: r.unit_cost_minor == null ? null : Number(r.unit_cost_minor),
      shipCost: r.shipping_cost_minor == null ? null : Number(r.shipping_cost_minor),
      currency: r.currency == null ? null : String(r.currency),
      deliveryMax: r.delivery_days_max == null ? null : Number(r.delivery_days_max),
      moq: r.moq == null ? null : Number(r.moq),
      shipsFrom: r.ships_from == null ? null : String(r.ships_from),
      stock: r.stock_json == null ? null : (JSON.parse(String(r.stock_json)) as OfferRow['stock']),
      restrictions: r.restrictions == null ? null : String(r.restrictions),
      provenance: String(r.provenance),
      checkedAt: String(r.checked_at),
    }));

/**
 * Minor units of `from` in minor units of `to`, from the stored ECB rates (the FX loop refreshes them daily; Rank never
 * fetches). Undefined without a rate.
 */
export function convertMinor(db: Db, minor: number, from: string, to: string): number | undefined {
  const r = storedRate(db, from, to);
  const df = minorDigits(from);
  const dt = minorDigits(to);
  return r && df !== null && dt !== null ? Math.round((minor / 10 ** df) * r.rate * 10 ** dt) : undefined;
}

/**
 * Rank, the fulfillment part (decision 8): per facts key, the status for quantity 1 from the shared offers, the date
 * of the row it is shown with, and the cost + shipping of the cheapest Verified row in that key's currency. A key with
 * no ship-to gets no status.
 */
export function rankFulfillment(db: Db, productId: string, now = new Date()) {
  const offers = offerRows(db, productId);
  const up = db.prepare(
    `INSERT INTO pr_product_facts (product_id, destination, currency, fulfillment_status, fulfillment_checked_at, cost_ship_minor, cost_ship_offer_id, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (product_id, destination, currency) DO UPDATE SET fulfillment_status = excluded.fulfillment_status, fulfillment_checked_at = excluded.fulfillment_checked_at,
       cost_ship_minor = excluded.cost_ship_minor, cost_ship_offer_id = excluded.cost_ship_offer_id, computed_at = excluded.computed_at`,
  );
  for (const [destination, currency] of factKeys(db)) {
    const f = destination ? fulfillmentOf(offers, destination, 1, now, (minor, from) => convertMinor(db, minor, from, currency)) : null;
    up.run(productId, destination, currency, f?.status ?? null, f?.offer?.checkedAt ?? null, f?.costShip ?? null, f?.costShip == null ? null : f.offer!.id, now.toISOString());
  }
}

/** Rank: demand and fulfillment facts for one product. */
export function rank(db: Db, productId: string, now = new Date()) {
  rankDemand(db, productId, now);
  rankFulfillment(db, productId, now);
}
