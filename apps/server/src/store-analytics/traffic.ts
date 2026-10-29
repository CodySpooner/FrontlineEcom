// SA-21: sessions and site conversion v1 (SA_METRICS, decision 14) for one store's days.
import { SA_SOURCES, ratio, type SaReason, type SaSourceKind, type SaValue } from '@frontline/shared';
import { dayNumber } from '../dates';
import type { Db } from '../db';
import { demoParts } from '../demo';
import { datasetFreshness } from './sources';

export type TrafficMetricId = 'sessions' | 'site_conversion';

const value = (v: number | null, status: SaValue['status'], extra: Omit<SaValue, 'value' | 'status'> = {}): SaValue => ({ value: v, status, ...extra });

/**
 * A day's sessions count as reported when it has some, or falls inside a traffic read's covered days (a real 0).
 * ponytail: daily_metrics.sessions defaults to 0, so a 0 outside every read's range is read as not reported.
 */
export function trafficMetrics(db: Db, storeId: string, from: string, to: string): Record<TrafficMetricId, SaValue> {
  const store = db.prepare('SELECT platform, demo FROM stores WHERE id = ?').get(storeId)!;
  const span = dayNumber(to) - dayNumber(from) + 1;
  if (store.demo) {
    const days = db.prepare('SELECT date, revenue, sessions FROM daily_metrics WHERE store_id = ? AND date BETWEEN ? AND ?').all(storeId, from, to);
    if (!days.length) {
      const none = value(null, 'unavailable', { reason: 'insufficient_history', note: 'Before the demo history' });
      return { sessions: none, site_conversion: none };
    }
    const sessions = days.reduce((a, d) => a + Number(d.sessions), 0);
    const bought = days.reduce((a, d) => a + demoParts(storeId, String(d.date), Number(d.revenue)).purchaseSessions, 0);
    return { sessions: value(sessions, 'demo'), site_conversion: value(ratio(bought, sessions), 'demo') };
  }

  // GA4 owns the site's sessions when connected (the Shopify funnel read steps aside); else the store's own platform.
  const source: SaSourceKind = db.prepare('SELECT 1 FROM integrations WHERE id = ?').get(`ga4:${storeId}`) ? 'ga4' : (store.platform as SaSourceKind);
  const ranges = db
    .prepare("SELECT covered_from AS f, covered_to AS t FROM source_datasets WHERE store_id = ? AND dataset = 'traffic' AND covered_from IS NOT NULL")
    .all(storeId)
    .map((r) => [String(r.f), String(r.t)]);
  const days = db
    .prepare('SELECT date, sessions, purchase_sessions AS ps FROM daily_metrics WHERE store_id = ? AND date BETWEEN ? AND ?')
    .all(storeId, from, to)
    .filter((d) => Number(d.sessions) > 0 || ranges.some(([f, t]) => String(d.date) >= f! && String(d.date) <= t!));
  const both = days.filter((d) => d.ps != null);
  const sum = (rows: typeof days, k: string) => rows.reduce((a, d) => a + Number(d[k]), 0);
  const covered = (n: number) => (n < span ? { coverage: { share: n / span, of: 'days' }, note: `${n} of ${span} days reported` } : {});

  // No reported day: the traffic dataset's own reason (awaiting connection, not synced, failed…), never 0.
  const freshness = datasetFreshness(db, storeId).filter((f) => f.dataset === 'traffic' && f.source === source);
  const reason: SaReason = freshness.find((f) => f.reason)?.reason ?? (freshness.some((f) => f.status === 'failed') ? 'failed' : 'needs_ingestion');
  const sessions = days.length ? value(sum(days, 'sessions'), days.length < span ? 'partial' : 'ok', covered(days.length)) : value(null, 'unavailable', { reason });

  const ps = SA_SOURCES[source]?.datasets.purchase_sessions;
  const site_conversion =
    !ps || ps.support !== 'supported'
      ? value(null, 'unavailable', { reason: 'unsupported', note: ps?.reason ?? 'Shopify site sessions only' })
      : !days.length
        ? sessions
        : !both.length
          ? value(null, 'unavailable', { reason: 'needs_ingestion', note: 'Purchasing sessions not synced yet' })
          : value(ratio(sum(both, 'ps'), sum(both, 'sessions')), both.length < span ? 'partial' : 'ok', covered(both.length));
  return { sessions, site_conversion };
}
