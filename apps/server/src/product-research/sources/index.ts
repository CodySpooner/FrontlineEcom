import type { PrSourceHealth, PrSourceState } from '@frontline/shared';
import { CAPS, callsToday, type CallPurpose } from '../caps';
import { stoppedReason } from '../jobs';
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

const PURPOSES: CallPurpose[] = ['token', 'ingestion', 'search', 'watch', 'order_sync', 'owner'];
const DAILY_CAP: Partial<Record<CallPurpose, number>> = { ingestion: CAPS.cj.ingestionCallsPerDay, watch: CAPS.cj.watchCallsPerDay };
const STALE_DAYS = 7;

/** The source health view: each source's state, limits, today's calls, the call ledger, recent jobs and stale coverage. */
export function sourceHealth(db: Db, key: Buffer, store: string | null, now = new Date()): PrSourceHealth[] {
  const states = sourceStates(db, key, store);
  return ADAPTERS.map((a, i) => {
    const row = db.prepare('SELECT last_attempt_at, quota_json FROM pr_sources WHERE id = ?').get(a.id);
    let points: PrSourceHealth['points'] = null;
    try {
      const q = row?.quota_json ? (JSON.parse(String(row.quota_json)) as { pointsRemaining?: number; pointsTotal?: number }) : null;
      if (q && typeof q.pointsRemaining === 'number' && typeof q.pointsTotal === 'number') points = { remaining: q.pointsRemaining, total: q.pointsTotal };
    } catch {
      /* a malformed quota row shows as unknown */
    }
    const v = visible(store, 'l.store_id');
    const stale = LISTINGS[a.id]
      ? Number(
          db
            .prepare(
              `SELECT count(*) AS n FROM (SELECT l.product_id FROM pr_listings l JOIN pr_offers o ON o.listing_id = l.id
               WHERE ${LISTINGS[a.id]} AND l.origin NOT IN ('fixture', 'legacy_sample') AND ${v.sql} GROUP BY l.product_id HAVING max(o.checked_at) < ?)`,
            )
            .get(...v.params, new Date(now.getTime() - STALE_DAYS * 86_400_000).toISOString())?.n ?? 0,
        )
      : 0;
    return {
      ...states[i]!,
      rate: a.rate,
      quota: a.quota,
      refreshHours: a.refreshHours ?? null,
      lastAttemptAt: row?.last_attempt_at == null ? null : String(row.last_attempt_at),
      stopped: stoppedReason(db, a, now) ?? null,
      points,
      callsToday: PURPOSES.map((p) => ({ purpose: p, calls: callsToday(db, a.id, p, now), cap: a.id === 'cj' ? (DAILY_CAP[p] ?? null) : null })).filter((c) => c.calls || c.cap !== null),
      ledger: db
        .prepare('SELECT purpose, at, ok FROM pr_calls WHERE source = ? ORDER BY id DESC LIMIT 20')
        .all(a.id)
        .map((c) => ({ purpose: String(c.purpose), at: String(c.at), ok: c.ok === 1 })),
      jobs: db
        .prepare('SELECT id, kind, status, attempts, error, created_at, finished_at, next_attempt_at FROM pr_jobs WHERE source = ? ORDER BY created_at DESC LIMIT 10')
        .all(a.id)
        .map((j) => ({
          id: String(j.id),
          kind: String(j.kind),
          status: String(j.status),
          attempts: Number(j.attempts),
          error: j.error == null ? null : String(j.error),
          createdAt: String(j.created_at),
          finishedAt: j.finished_at == null ? null : String(j.finished_at),
          nextAttemptAt: j.next_attempt_at == null ? null : String(j.next_attempt_at),
        })),
      stale,
      canSync: !!(a.plan && a.page && a.ready?.(db, key)),
      syncing: !!db.prepare(`SELECT 1 FROM pr_jobs WHERE source = ? AND status IN ('queued', 'running')`).get(a.id),
    };
  });
}
