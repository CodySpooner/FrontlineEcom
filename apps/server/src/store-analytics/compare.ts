// SA-86 (spec §11 Saved views and comparisons): the one compare route. Products for now: 2 to 4 side by side as their
// Listings rows, so each number is the table's, over one period, currency and set of definitions.
import { saDef, type SaProductCompare, type SaFilters, type SaListings } from '@frontline/shared';
import type { Db } from '../db';
import { inStore, LISTING_METRICS, listings } from './listings';
import type { StorePeriod } from './period';
import type { RefundBasis } from './sales';

export function compareProducts(db: Db, storeId: string, products: string | undefined, sp: StorePeriod, filters: SaFilters, basis: RefundBasis): SaProductCompare | { error: string; status: 400 | 404 } {
  const ids = [...new Set((products ?? '').split(',').filter(Boolean))];
  if (ids.length < 2 || ids.length > 4) return { error: 'products must name 2 to 4 different products', status: 400 };
  if (!inStore(db, storeId, ids)) return { error: 'A product is not in this store', status: 404 };
  // ponytail: a fixed valid query, so never an error string
  const l = listings(db, storeId, { status: 'all' }, sp, { ...filters, product: ids }, basis) as SaListings;
  return { period: l.period, definitions: LISTING_METRICS.map(saDef), rows: ids.map((id) => l.rows.find((r) => r.id === id)!), scope: l.scope };
}
