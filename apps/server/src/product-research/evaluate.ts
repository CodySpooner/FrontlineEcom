import type { PrFit, PrFlag, Store } from '@frontline/shared';
import { tx, type Db } from '../db';
import { listStores } from '../stores';
import { offerRows, rank } from './facts';
import { flagsFor } from './flags';
import { shippable } from './fulfillment';
import { categoryMatches, getProfile, inNiche } from './profile';

export interface FitInput {
  /** Undismissed flags. */
  flags: PrFlag[];
  category: string | null;
  inNiche: boolean | null;
  /** Verified cost + shipping in the store's currency, and the price band's maximum (minor units). */
  costShip: number | null;
  priceMax: number | null;
  /** The fastest shippable offer's delivery estimate (its upper bound, days), the profile's limit. */
  fastest: number | null;
  maxDelivery: number | null;
  /** Where the shippable offers ship from, the profile's preferred warehouses. */
  shipsFrom: string[];
  warehouses: string[];
}

/**
 * Decision 11's store fit, rule-based, main reason first. Weak beats Medium beats Unknown: a known problem says more
 * than a missing input. Unknown names what's missing.
 */
export function fitFor(i: FitInput): { fit: PrFit; reasons: string[] } {
  const weak = [
    ...i.flags.filter((f) => f.kind === 'avoid' || f.kind === 'restricted').map((f) => f.label),
    ...(i.costShip !== null && i.priceMax !== null && i.costShip > i.priceMax ? ["Cost + shipping above the price band's maximum"] : []),
  ];
  if (weak.length) return { fit: 'weak', reasons: weak };
  const medium = [
    ...(i.inNiche === false ? ['Category outside the niche and included categories'] : []),
    ...(i.fastest !== null && i.maxDelivery !== null && i.fastest > i.maxDelivery ? [`Delivery up to ${i.fastest} days, over the ${i.maxDelivery}-day limit`] : []),
    ...(i.warehouses.length && i.shipsFrom.length && !i.shipsFrom.some((w) => i.warehouses.includes(w)) ? [`Ships from ${i.shipsFrom.join(', ')}, no preferred warehouse`] : []),
  ];
  if (medium.length) return { fit: 'medium', reasons: medium };
  const missing = [...(i.priceMax === null ? ['price band'] : []), ...(i.category === null ? ['category'] : [])];
  if (missing.length) return { fit: 'unknown', reasons: [`Missing ${missing.join(' and ')}`] };
  return { fit: 'strong', reasons: ['Every known input passes'] };
}

/**
 * Evaluate, for one store and product: the flags (decision 10) on what the store may see of the product, and its fit,
 * kept in the store's evaluation. Stage, owner, notes and dismissals stay as they are.
 */
export function evaluate(db: Db, store: Store, productId: string, now = new Date()) {
  const p = db
    .prepare(
      `SELECT p.title, (SELECT category FROM pr_listings WHERE product_id = p.id AND category IS NOT NULL AND (store_id IS NULL OR store_id = ?) ORDER BY first_seen_at LIMIT 1) AS category
       FROM pr_products p WHERE p.id = ?`,
    )
    .get(store.id, productId);
  if (!p) return;
  const profile = getProfile(db, store);
  const category = p.category == null ? null : String(p.category);
  const flags = flagsFor({ title: String(p.title), category }, { categories: profile.avoidCategories, terms: profile.avoidTerms });
  const ev = db.prepare('SELECT flag_dismissals_json FROM pr_evaluations WHERE store_id = ? AND product_id = ?').get(store.id, productId);
  const dismissed = JSON.parse(String(ev?.flag_dismissals_json ?? '{}')) as Record<string, unknown>;
  const cost = db.prepare('SELECT cost_ship_minor FROM pr_product_facts WHERE product_id = ? AND destination = ? AND currency = ?').get(productId, profile.shipTo ?? '', store.currency)?.cost_ship_minor;
  const ships = profile.shipTo ? shippable(offerRows(db, productId, store.id), profile.shipTo, 1) : [];
  const days = ships.map((o) => o.deliveryMax).filter((d): d is number => d !== null);
  const open = flags.filter((f) => !dismissed[f.id]);
  const { fit, reasons } = fitFor({
    flags: open,
    category,
    inNiche: inNiche(store, profile.includeCategories, category),
    costShip: cost == null ? null : Number(cost),
    priceMax: profile.priceMax,
    fastest: days.length ? Math.min(...days) : null,
    maxDelivery: profile.maxDeliveryDays,
    shipsFrom: [...new Set(ships.map((o) => o.shipsFrom).filter((w): w is string => w !== null))],
    warehouses: profile.warehouses,
  });
  // Store scope keeps the included categories (all of them when none are set) and every unknown category (decision 5).
  const inScope = category === null ? null : !profile.includeCategories.length || categoryMatches(profile.includeCategories, category) ? 1 : 0;
  db.prepare(
    `INSERT INTO pr_evaluations (store_id, product_id, fit, fit_reasons_json, flags_json, open_flags, in_scope, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (store_id, product_id) DO UPDATE SET fit = excluded.fit, fit_reasons_json = excluded.fit_reasons_json, flags_json = excluded.flags_json,
       open_flags = excluded.open_flags, in_scope = excluded.in_scope`,
  ).run(store.id, productId, fit, JSON.stringify(reasons), JSON.stringify(flags), open.length, inScope, now.toISOString(), now.toISOString());
}

/** The catalog products a store may see (shared or its own; never sample rows or merged-away products). */
export const storeProducts = (db: Db, storeId: string) =>
  db
    .prepare(
      `SELECT DISTINCT l.product_id FROM pr_listings l JOIN pr_products p ON p.id = l.product_id
       WHERE (l.store_id IS NULL OR l.store_id = ?) AND l.origin != 'legacy_sample' AND p.merged_into IS NULL`,
    )
    .all(storeId)
    .map((r) => String(r.product_id));

/** After a profile change: every product the store may see, re-ranked first when the ship-to moved. */
export function evaluateStore(db: Db, store: Store, opts: { rerank?: boolean } = {}, now = new Date()) {
  tx(db, () => {
    for (const id of storeProducts(db, store.id)) {
      if (opts.rerank) rank(db, id, now);
      evaluate(db, store, id, now);
    }
  });
}

/** After new evidence for a product: Rank, then Evaluate in every store that may see it. */
export function refreshProduct(db: Db, productId: string, now = new Date()) {
  tx(db, () => {
    rank(db, productId, now);
    const stores = listStores(db);
    for (const s of stores) if (db.prepare(`SELECT 1 FROM pr_listings WHERE product_id = ? AND origin != 'legacy_sample' AND (store_id IS NULL OR store_id = ?) LIMIT 1`).get(productId, s.id)) evaluate(db, s, productId, now);
  });
}

/** Once a day (decision 8's decay): a Verified status older than 7 days goes back to pending ("re-check due"). */
export function decayPass(db: Db, now = new Date()) {
  const stale = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  for (const r of db.prepare(`SELECT DISTINCT product_id FROM pr_product_facts WHERE fulfillment_status = 'verified' AND fulfillment_checked_at < ?`).all(stale)) refreshProduct(db, String(r.product_id), now);
}
