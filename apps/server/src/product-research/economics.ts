import { econInputs, PR_ECON_FIELDS, PR_ECON_PERCENT, unitEconomics, type PrEconField, type PrEconInput, type PrEconomics, type PrEconOverrides, type PrEconResult, type Store } from '@frontline/shared';
import type { Db } from '../db';
import { minorDigits } from './money';
import { shipTo } from './profile';

const SCENARIOS = ['base', 'conservative', 'optimistic'] as const;
const known = (value: number, tag: PrEconInput['tag'], note: string | null = null): PrEconInput => ({ value, tag, note });
const unknown = (note: string | null = null): PrEconInput => ({ value: null, tag: null, note });

/**
 * The base inputs before the owner's figures (decision 13): the store's own price when it sells the product, the
 * cheapest Verified offer's cost and shipping to the store's ship-to, the store's fee settings, and assumptions that
 * change nothing (no discount, no returns). Everything else is unknown.
 */
function derived(db: Db, store: Store, productId: string): { inputs: Record<PrEconField, PrEconInput>; rateDate: string | null } {
  const digits = minorDigits(store.currency) ?? 2;
  const minor = (major: number) => Math.round(major * 10 ** digits);
  const own = db
    .prepare(`SELECT p.price FROM pr_outcomes o JOIN products p ON p.store_id = o.store_id AND p.id = o.ref_id WHERE o.store_id = ? AND o.product_id = ? AND o.kind = 'store_product' ORDER BY o.created_at LIMIT 1`)
    .get(store.id, productId);
  const to = shipTo(db, store);
  const f = to
    ? db.prepare('SELECT unit_minor, ship_minor, cost_ship_offer_id FROM pr_product_facts WHERE product_id = ? AND destination = ? AND currency = ?').get(productId, to, store.currency)
    : undefined;
  const offer = f?.cost_ship_offer_id ? db.prepare('SELECT supplier, provenance, checked_at, currency FROM pr_offers WHERE id = ?').get(String(f.cost_ship_offer_id)) : undefined;
  const verified = offer && f!.unit_minor != null && f!.ship_minor != null;
  const quote = verified ? `${offer.supplier} · ${offer.provenance} · checked ${String(offer.checked_at).slice(0, 10)}` : null;
  const converted = verified && offer.currency !== store.currency;
  const fees = store.feePercent !== undefined || store.feePerOrder !== undefined;
  const noOffer = to ? `No verified offer to ${to} yet` : 'Pick a ship-to country in the research profile';
  return {
    inputs: {
      price: own ? known(minor(Number(own.price)), 'owner', "Your store's price") : unknown('Needs a selling price'),
      discountPct: known(0, 'assumption', 'No discount'),
      supplierCost: verified ? known(Number(f!.unit_minor), 'verified', quote) : unknown(noOffer),
      shipping: verified ? known(Number(f!.ship_minor), 'verified', quote) : unknown(noOffer),
      feePercent: fees ? known(store.feePercent ?? 0, 'owner', 'Store settings') : unknown('Store fees not set'),
      feePerOrder: fees ? known(minor(store.feePerOrder ?? 0), 'owner', 'Store settings') : unknown('Store fees not set'),
      duties: unknown('Unknown by default'),
      returnRatePct: known(0, 'assumption', 'No returns'),
      refundPct: known(100, 'assumption', 'Full refund on a return'),
      returnCost: unknown(),
      otherCosts: unknown(),
      adCost: unknown(),
    },
    rateDate: converted ? (String(db.prepare("SELECT json_extract(value_json, '$.date') AS d FROM settings WHERE key = 'fx'").get()?.d ?? '') || null) : null,
  };
}

/** GET …/economics: the derived inputs with their provenance and the owner's saved figures. */
export function productEconomics(db: Db, store: Store, productId: string): PrEconomics {
  const { inputs, rateDate } = derived(db, store, productId);
  const r = db.prepare('SELECT inputs_json, updated_at FROM pr_economics WHERE store_id = ? AND product_id = ?').get(store.id, productId);
  const o = (r ? JSON.parse(String(r.inputs_json)) : {}) as Partial<PrEconOverrides>;
  return { currency: store.currency, rateDate, derived: inputs, saved: { base: o.base ?? {}, conservative: o.conservative ?? {}, optimistic: o.optimistic ?? {} }, updatedAt: r ? String(r.updated_at) : null };
}

/** The base scenario's result, for Overview and evidence confidence ("complete base economics"). */
export const baseEconomics = (db: Db, store: Store, productId: string): PrEconResult => unitEconomics(econInputs(productEconomics(db, store, productId), 'base'));

/** PUT …/economics: the owner's figures, checked; they replace the saved ones. */
export function parseOverrides(body: unknown): PrEconOverrides | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const out = {} as PrEconOverrides;
  for (const s of SCENARIOS) {
    const o = b[s] ?? {};
    if (typeof o !== 'object' || o === null || Array.isArray(o)) return { error: `${s} must be an object of figures` };
    out[s] = {};
    for (const [k, v] of Object.entries(o)) {
      if (!PR_ECON_FIELDS.includes(k as PrEconField)) return { error: `${s}.${k} is not an economics input` };
      const pct = PR_ECON_PERCENT.includes(k as PrEconField);
      const ok = typeof v === 'number' && Number.isFinite(v) && v >= 0 && (pct ? v <= 100 : Number.isInteger(v) && v <= 1e10);
      if (!ok) return { error: `${s}.${k} must be ${pct ? 'a percentage from 0 to 100' : 'an amount in minor units (0 or more)'}` };
      out[s][k as PrEconField] = v as number;
    }
  }
  return out;
}

export function saveEconomics(db: Db, storeId: string, productId: string, o: PrEconOverrides, now = new Date()) {
  db.prepare(
    `INSERT INTO pr_economics (store_id, product_id, inputs_json, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (store_id, product_id) DO UPDATE SET inputs_json = excluded.inputs_json, updated_at = excluded.updated_at`,
  ).run(storeId, productId, JSON.stringify(o), now.toISOString());
}
