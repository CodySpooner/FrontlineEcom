import type { Niche, Store } from '@frontline/shared';
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
