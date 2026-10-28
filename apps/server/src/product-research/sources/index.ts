import type { PrSourceState } from '@frontline/shared';
import type { Db } from '../../db';
import { visible } from '../scope';
import type { PrAdapter } from './adapter';
import { cjAdapter } from './cj';
import { notesSource, ordersSource, feedSource } from './local';
import { trendsApiSource, trendsCsvSource } from './trends';

/** Every Product Research source, in the order the source strip and the health view list them (decision 4). */
export const ADAPTERS: PrAdapter[] = [cjAdapter, trendsCsvSource, trendsApiSource, ordersSource, notesSource, feedSource];

// What each source's count is: products it has rows for in the scope. A listing source counts its listings' products;
// a signal source its sets' products (a query-level set through its confirmed links).
const LISTINGS: Record<string, string> = { cj: "l.source = 'cj'", supplier_feed: "l.source LIKE 'feed:%'" };
const SIGNALS: Record<string, string> = { google_trends_csv: "s.platform = 'google_trends'", store_orders: "s.platform = 'orders'", tiktok_creative_center: "s.platform = 'tiktok_creative_center'" };

/** Every source's real state for the strip and the health view, counted in the scope (`store` null: All stores). */
export function sourceStates(db: Db, key: Buffer, store: string | null): PrSourceState[] {
  const count = (sql: string, params: string[]) => Number(db.prepare(sql).get(...params)?.n ?? 0);
  return ADAPTERS.map((a) => {
    const row = db.prepare('SELECT status, last_success_at, last_error, error_kind FROM pr_sources WHERE id = ?').get(a.id);
    const by = (fixture: boolean) => {
      const real = fixture ? "= 'fixture'" : "NOT IN ('fixture', 'legacy_sample')";
      if (LISTINGS[a.id]) {
        const v = visible(store, 'l.store_id');
        return count(`SELECT count(DISTINCT l.product_id) AS n FROM pr_listings l WHERE ${LISTINGS[a.id]} AND l.origin ${real} AND ${v.sql}`, v.params);
      }
      if (SIGNALS[a.id]) {
        const v = visible(store, 's.store_id');
        return count(
          `SELECT count(DISTINCT coalesce(s.product_id, k.product_id)) AS n FROM pr_signals s LEFT JOIN pr_signal_links k ON k.signal_id = s.id AND k.confirmed_at IS NOT NULL
           WHERE ${SIGNALS[a.id]} AND s.origin ${fixture ? "= 'fixture'" : "!= 'fixture'"} AND coalesce(s.product_id, k.product_id) IS NOT NULL AND ${v.sql}`,
          v.params,
        );
      }
      return 0;
    };
    return {
      id: a.id,
      name: a.name,
      answers: [...a.answers],
      access: a.access(db, key),
      connect: a.connect,
      status: row?.status == null ? null : String(row.status),
      lastSuccessAt: row?.last_success_at == null ? null : String(row.last_success_at),
      lastError: row?.last_error == null ? null : String(row.last_error),
      errorKind: row?.error_kind == null ? null : (String(row.error_kind) as PrSourceState['errorKind']),
      products: by(false),
      fixtures: by(true),
    };
  });
}
