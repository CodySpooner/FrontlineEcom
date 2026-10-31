import type { Niche, PrStoreProfile, Store } from '@frontline/shared';
import { ConfigError, logChanges } from '../config/write';
import { tx, type Db } from '../db';
import { convertMinor } from './facts';

/** A store's default ship-to (decision 5): its currency's main country, else none until the owner picks one. */
const MAIN_COUNTRY: Record<string, string> = { USD: 'US', GBP: 'GB', CAD: 'CA', AUD: 'AU' };

/** The ship-to a store gets from its currency when the owner hasn't picked one. */
export const defaultShipTo = (currency: string): string | null => MAIN_COUNTRY[currency] ?? null;

/** The destination every cost, delivery time and fulfillment status is for, in a store's scope. */
export function shipTo(db: Db, store: Pick<Store, 'id' | 'currency'>): string | null {
  const set = db.prepare('SELECT ship_to FROM pr_store_profiles WHERE store_id = ?').get(store.id)?.ship_to;
  return set ? String(set) : (MAIN_COUNTRY[store.currency] ?? null);
}

const json = (v: unknown): string[] => (typeof v === 'string' ? (JSON.parse(v) as string[]) : []);

/**
 * What discovery searches CJ for, per niche (decision 4): a few category keywords, never the whole catalog. A custom
 * niche searches the owner's own words. ponytail: keywords, not CJ category ids; switch to ids from /product/getCategory
 * (free) once a live call shows the tree.
 */
export const NICHE_QUERIES: Record<Exclude<Niche, 'other'>, string[]> = {
  pet: ['pet grooming', 'dog accessories', 'cat toys', 'pet feeding'],
  beauty: ['skin care tools', 'hair styling tools', 'makeup tools', 'nail art'],
  tech: ['phone accessories', 'charging gadgets', 'smart home gadgets', 'computer accessories'],
  fitness: ['fitness equipment', 'yoga accessories', 'resistance bands', 'muscle recovery'],
  home: ['kitchen gadgets', 'home organization', 'home decor', 'cleaning tools'],
  fashion: ['jewelry', 'women bags', 'fashion accessories', 'watches'],
  kids: ['kids toys', 'baby care', 'educational toys', 'kids room decor'],
  outdoor: ['camping gear', 'hiking accessories', 'garden tools', 'outdoor lighting'],
};

/** A store's discovery queries: its niche's, its research profile's included categories and its saved keywords. */
export function discoveryQueries(db: Db, store: Pick<Store, 'id' | 'niche' | 'nicheDetail'>): string[] {
  const p = db.prepare('SELECT include_categories_json, keywords_json FROM pr_store_profiles WHERE store_id = ?').get(store.id);
  const niche = store.niche === 'other' ? [store.nicheDetail?.trim()].filter((t): t is string => !!t) : NICHE_QUERIES[store.niche];
  return [...new Set([...niche, ...json(p?.include_categories_json), ...json(p?.keywords_json)].map((q) => q.trim().toLowerCase()).filter(Boolean))];
}

/**
 * Words that put a category in a niche (decision 11's "outside the niche"), matched from a word's start in the
 * category path. ponytail: a keyword heuristic; CJ category ids once the live check shows the tree.
 */
export const NICHE_WORDS: Record<Exclude<Niche, 'other'>, string[]> = {
  pet: ['pet', 'dog', 'cat', 'pupp', 'kitten', 'animal', 'bird', 'fish', 'aquarium', 'hamster', 'rabbit', 'reptile'],
  beauty: ['beauty', 'makeup', 'cosmetic', 'skin', 'hair', 'nail', 'lash', 'brow', 'lip', 'face', 'facial', 'spa', 'fragrance'],
  tech: ['electronic', 'phone', 'mobile', 'computer', 'laptop', 'tablet', 'gadget', 'charg', 'cable', 'audio', 'headphone', 'earphone', 'speaker', 'smart', 'camera', 'gaming'],
  fitness: ['fitness', 'sport', 'gym', 'yoga', 'exercise', 'workout', 'training', 'running', 'cycling', 'muscle', 'massage', 'recovery'],
  home: ['home', 'kitchen', 'household', 'furniture', 'decor', 'storage', 'organiz', 'cleaning', 'bath', 'bedding', 'garden', 'lighting', 'tool'],
  fashion: ['fashion', 'clothing', 'apparel', 'jewel', 'bag', 'shoe', 'watch', 'accessor', 'women', 'men', 'dress', 'wallet', 'sunglass'],
  kids: ['kid', 'child', 'baby', 'toy', 'infant', 'toddler', 'mother', 'maternity', 'nursery', 'school'],
  outdoor: ['outdoor', 'camping', 'hiking', 'garden', 'fishing', 'hunting', 'travel', 'beach', 'picnic', 'climbing'],
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Any of `words` at a word's start in the category path. */
export const categoryMatches = (words: string[], category: string) =>
  words.some((w) => new RegExp(`(^|[^\\p{L}\\p{N}])${escape(w.toLowerCase())}`, 'u').test(category.toLowerCase()));

/** The words that put a category in the store's niche (a custom niche: the owner's own words). */
export const nicheWords = (store: Pick<Store, 'niche' | 'nicheDetail'>) =>
  store.niche === 'other' ? ((store.nicheDetail ?? '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []) : NICHE_WORDS[store.niche];

/** In the niche or an included category: true, false, or null when the category is unknown. */
export function inNiche(store: Pick<Store, 'niche' | 'nicheDetail'>, include: string[], category: string | null): boolean | null {
  if (!category) return null;
  return categoryMatches([...nicheWords(store), ...include], category);
}

const num = (v: unknown) => (v == null ? null : Number(v));

/**
 * A store's profile with decision 5's defaults: its currency, ship-to from its currency's main country, the rest unknown.
 * A band saved in another currency (the store's has changed since) is converted at the stored rate, or left out without
 * one: never read as the store's currency (settings ST-28).
 */
export function getProfile(db: Db, store: Store): PrStoreProfile {
  const r = db.prepare('SELECT * FROM pr_store_profiles WHERE store_id = ?').get(store.id);
  const ship = r?.ship_to ? String(r.ship_to) : null;
  const saved = { min: num(r?.price_min_minor), max: num(r?.price_max_minor), currency: String(r?.price_currency ?? store.currency) };
  const other = saved.currency !== store.currency && (saved.min !== null || saved.max !== null);
  const band = (v: number | null) => (v === null || !other ? v : (convertMinor(db, v, saved.currency, store.currency) ?? null));
  const priceMin = band(saved.min);
  const priceMax = band(saved.max);
  return {
    storeId: store.id,
    audience: r?.audience == null ? null : String(r.audience),
    priceMin,
    priceMax,
    priceCurrency: store.currency,
    priceSaved: other ? { ...saved, converted: (saved.max === null || priceMax !== null) && (saved.min === null || priceMin !== null) } : null,
    shipTo: ship ?? MAIN_COUNTRY[store.currency] ?? null,
    shipToDefault: !ship,
    warehouses: json(r?.warehouses_json),
    maxDeliveryDays: num(r?.max_delivery_days),
    avoidCategories: json(r?.avoid_categories_json),
    avoidTerms: json(r?.avoid_terms_json),
    includeCategories: json(r?.include_categories_json),
    keywords: json(r?.keywords_json),
    updatedAt: r?.updated_at == null ? null : String(r.updated_at),
    discountPct: num(r?.discount_pct),
    returnRatePct: num(r?.return_rate_pct),
    refundPct: num(r?.refund_pct),
    version: r ? Number(r.version) : 0,
  };
}

const LISTS = ['warehouses', 'avoidCategories', 'avoidTerms', 'includeCategories', 'keywords'] as const;
const PERCENTS = ['discountPct', 'returnRatePct', 'refundPct'] as const;

/** `field`: `pr.<key>`, the registry id where the key has one (settings decision 6). */
type Bad = { error: string; field: `pr.${keyof PrStoreProfile}` };

/**
 * Saves the fields present in `body` (the rest stay). The price band is in the store's currency. `version` (as read, 0
 * before the first save) is checked when given: a stale one throws ConfigError (409) and nothing is written (settings
 * decision 6). Each field that moved writes a change row, in the same transaction. A band saved in another currency
 * stays as saved until a save sends one.
 */
export function saveProfile(db: Db, store: Store, body: Record<string, unknown>, now = new Date(), version?: number): PrStoreProfile | Bad {
  const p = getProfile(db, store);
  const next = { ...p, shipTo: p.shipToDefault ? null : p.shipTo };
  const has = (k: string) => Object.hasOwn(body, k);
  if (has('audience')) {
    const v = body.audience;
    if (v !== null && (typeof v !== 'string' || v.length > 500)) return { error: 'audience must be text up to 500 characters, or null', field: 'pr.audience' };
    next.audience = typeof v === 'string' && v.trim() ? v.trim() : null;
  }
  for (const k of ['priceMin', 'priceMax'] as const) {
    if (!has(k)) continue;
    const v = body[k];
    if (v !== null && !(Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 1e9)) return { error: `${k} must be a whole amount in minor units (cents), or null`, field: `pr.${k}` };
    next[k] = v as number | null;
  }
  // Checked only when sent: Settings doesn't offer priceMin (no fit rule reads it), so a stored one never blocks a maximum.
  if (has('priceMin') && next.priceMin !== null && next.priceMax !== null && next.priceMin > next.priceMax) return { error: 'priceMin must be at most priceMax', field: 'pr.priceMin' };
  if (has('shipTo')) {
    const v = body.shipTo;
    if (v !== null && (typeof v !== 'string' || !/^[A-Za-z]{2}$/.test(v))) return { error: 'shipTo must be a two-letter country code, or null for the default', field: 'pr.shipTo' };
    next.shipTo = typeof v === 'string' ? v.toUpperCase() : null;
  }
  if (has('maxDeliveryDays')) {
    const v = body.maxDeliveryDays;
    if (v !== null && !(Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 120)) return { error: 'maxDeliveryDays must be 1–120, or null', field: 'pr.maxDeliveryDays' };
    next.maxDeliveryDays = v as number | null;
  }
  for (const k of LISTS) {
    if (!has(k)) continue;
    const v = body[k];
    if (!Array.isArray(v) || v.length > 50 || v.some((x) => typeof x !== 'string' || !x.trim() || x.length > 80)) return { error: `${k} must be a list of up to 50 short texts`, field: `pr.${k}` };
    const seen = new Set<string>();
    const out = (v as string[]).map((x) => (k === 'warehouses' ? x.trim().toUpperCase() : x.trim())).filter((x) => !seen.has(x.toLowerCase()) && !!seen.add(x.toLowerCase()));
    if (k === 'warehouses' && out.some((c) => !/^[A-Z]{2}$/.test(c))) return { error: 'warehouses must be two-letter country codes', field: 'pr.warehouses' };
    next[k] = out;
  }
  for (const k of PERCENTS) {
    if (!has(k)) continue;
    const v = body[k];
    if (v !== null && !(typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100)) return { error: `${k} must be a percentage from 0 to 100, or null`, field: `pr.${k}` };
    next[k] = v as number | null;
  }
  if (version !== undefined && version !== p.version)
    throw new ConfigError(409, { error: 'This profile was saved somewhere else while you were editing.', code: version === 0 ? 'exists' : 'stale', current: p });
  const band = has('priceMin') || has('priceMax') || !p.priceSaved ? [next.priceMin, next.priceMax, store.currency] : [p.priceSaved.min, p.priceSaved.max, p.priceSaved.currency];
  tx(db, () => {
    db.prepare(
      `INSERT INTO pr_store_profiles (store_id, audience, price_min_minor, price_max_minor, price_currency, ship_to, warehouses_json, max_delivery_days, avoid_categories_json, avoid_terms_json, include_categories_json, keywords_json, discount_pct, return_rate_pct, refund_pct, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (store_id) DO UPDATE SET audience = excluded.audience, price_min_minor = excluded.price_min_minor, price_max_minor = excluded.price_max_minor,
         price_currency = excluded.price_currency, ship_to = excluded.ship_to, warehouses_json = excluded.warehouses_json, max_delivery_days = excluded.max_delivery_days,
         avoid_categories_json = excluded.avoid_categories_json, avoid_terms_json = excluded.avoid_terms_json, include_categories_json = excluded.include_categories_json,
         keywords_json = excluded.keywords_json, discount_pct = excluded.discount_pct, return_rate_pct = excluded.return_rate_pct, refund_pct = excluded.refund_pct,
         updated_at = excluded.updated_at, version = pr_store_profiles.version + 1`,
    ).run(
      store.id, next.audience, ...band, next.shipTo, JSON.stringify(next.warehouses), next.maxDeliveryDays, JSON.stringify(next.avoidCategories),
      JSON.stringify(next.avoidTerms), JSON.stringify(next.includeCategories), JSON.stringify(next.keywords), next.discountPct ?? null, next.returnRatePct ?? null, next.refundPct ?? null,
      now.toISOString(),
    );
    const was = { ...p, shipTo: p.shipToDefault ? null : p.shipTo }; // the stored ship-to: null is the default
    const moved = (['audience', 'priceMin', 'priceMax', 'shipTo', 'maxDeliveryDays', ...LISTS, ...PERCENTS] as const)
      .filter((k) => JSON.stringify(was[k]) !== JSON.stringify(next[k]))
      .map((k) => [`pr.${k}`, was[k], next[k]] as [string, unknown, unknown]);
    logChanges(db, { at: now.toISOString(), actor: 'owner', store: { id: store.id, name: store.name } }, moved);
  });
  return getProfile(db, store);
}
