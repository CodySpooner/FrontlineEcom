import type { Niche, PrStoreProfile, Store } from '@frontline/shared';
import type { Db } from '../db';

/** A store's default ship-to (decision 5): its currency's main country, else none until the owner picks one. */
const MAIN_COUNTRY: Record<string, string> = { USD: 'US', GBP: 'GB', CAD: 'CA', AUD: 'AU' };

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

/** In the niche or an included category: true, false, or null when the category is unknown. */
export function inNiche(store: Pick<Store, 'niche' | 'nicheDetail'>, include: string[], category: string | null): boolean | null {
  if (!category) return null;
  const words = store.niche === 'other' ? ((store.nicheDetail ?? '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []) : NICHE_WORDS[store.niche];
  return categoryMatches([...words, ...include], category);
}

const num = (v: unknown) => (v == null ? null : Number(v));

/** A store's profile with decision 5's defaults: its currency, ship-to from its currency's main country, the rest unknown. */
export function getProfile(db: Db, store: Store): PrStoreProfile {
  const r = db.prepare('SELECT * FROM pr_store_profiles WHERE store_id = ?').get(store.id);
  const ship = r?.ship_to ? String(r.ship_to) : null;
  return {
    storeId: store.id,
    audience: r?.audience == null ? null : String(r.audience),
    priceMin: num(r?.price_min_minor),
    priceMax: num(r?.price_max_minor),
    priceCurrency: store.currency,
    shipTo: ship ?? MAIN_COUNTRY[store.currency] ?? null,
    shipToDefault: !ship,
    warehouses: json(r?.warehouses_json),
    maxDeliveryDays: num(r?.max_delivery_days),
    avoidCategories: json(r?.avoid_categories_json),
    avoidTerms: json(r?.avoid_terms_json),
    includeCategories: json(r?.include_categories_json),
    keywords: json(r?.keywords_json),
    updatedAt: r?.updated_at == null ? null : String(r.updated_at),
  };
}

const LISTS = ['warehouses', 'avoidCategories', 'avoidTerms', 'includeCategories', 'keywords'] as const;

/** Saves the fields present in `body` (the rest stay). The price band is in the store's currency. */
export function saveProfile(db: Db, store: Store, body: Record<string, unknown>, now = new Date()): PrStoreProfile | { error: string } {
  const p = getProfile(db, store);
  const next = { ...p, shipTo: p.shipToDefault ? null : p.shipTo };
  const has = (k: string) => Object.hasOwn(body, k);
  if (has('audience')) {
    const v = body.audience;
    if (v !== null && (typeof v !== 'string' || v.length > 500)) return { error: 'audience must be text up to 500 characters, or null' };
    next.audience = typeof v === 'string' && v.trim() ? v.trim() : null;
  }
  for (const k of ['priceMin', 'priceMax'] as const) {
    if (!has(k)) continue;
    const v = body[k];
    if (v !== null && !(Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 1e9)) return { error: `${k} must be a whole amount in minor units (cents), or null` };
    next[k] = v as number | null;
  }
  if (next.priceMin !== null && next.priceMax !== null && next.priceMin > next.priceMax) return { error: 'priceMin must be at most priceMax' };
  if (has('shipTo')) {
    const v = body.shipTo;
    if (v !== null && (typeof v !== 'string' || !/^[A-Za-z]{2}$/.test(v))) return { error: 'shipTo must be a two-letter country code, or null for the default' };
    next.shipTo = typeof v === 'string' ? v.toUpperCase() : null;
  }
  if (has('maxDeliveryDays')) {
    const v = body.maxDeliveryDays;
    if (v !== null && !(Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 120)) return { error: 'maxDeliveryDays must be 1–120, or null' };
    next.maxDeliveryDays = v as number | null;
  }
  for (const k of LISTS) {
    if (!has(k)) continue;
    const v = body[k];
    if (!Array.isArray(v) || v.length > 50 || v.some((x) => typeof x !== 'string' || !x.trim() || x.length > 80)) return { error: `${k} must be a list of up to 50 short texts` };
    const seen = new Set<string>();
    const out = (v as string[]).map((x) => (k === 'warehouses' ? x.trim().toUpperCase() : x.trim())).filter((x) => !seen.has(x.toLowerCase()) && !!seen.add(x.toLowerCase()));
    if (k === 'warehouses' && out.some((c) => !/^[A-Z]{2}$/.test(c))) return { error: 'warehouses must be two-letter country codes' };
    next[k] = out;
  }
  db.prepare(
    `INSERT INTO pr_store_profiles (store_id, audience, price_min_minor, price_max_minor, price_currency, ship_to, warehouses_json, max_delivery_days, avoid_categories_json, avoid_terms_json, include_categories_json, keywords_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (store_id) DO UPDATE SET audience = excluded.audience, price_min_minor = excluded.price_min_minor, price_max_minor = excluded.price_max_minor,
       price_currency = excluded.price_currency, ship_to = excluded.ship_to, warehouses_json = excluded.warehouses_json, max_delivery_days = excluded.max_delivery_days,
       avoid_categories_json = excluded.avoid_categories_json, avoid_terms_json = excluded.avoid_terms_json, include_categories_json = excluded.include_categories_json,
       keywords_json = excluded.keywords_json, updated_at = excluded.updated_at`,
  ).run(
    store.id, next.audience, next.priceMin, next.priceMax, store.currency, next.shipTo, JSON.stringify(next.warehouses), next.maxDeliveryDays,
    JSON.stringify(next.avoidCategories), JSON.stringify(next.avoidTerms), JSON.stringify(next.includeCategories), JSON.stringify(next.keywords), now.toISOString(),
  );
  return getProfile(db, store);
}
