// SA-21: sessions and site conversion v1 (SA_METRICS, decision 14) for one store's days. SA-100 (spec §8): the site
// funnel, each step in the unit its source reports, sessions by source, device and country, and marketplaces' own
// traffic kept apart from the site's.
import {
  SA_FUNNEL_STEPS,
  SA_SOURCES,
  combineStatus,
  ratio,
  type SaChannelTraffic,
  type SaFunnelStep,
  type SaFunnelStepId,
  type SaReason,
  type SaSourceKind,
  type SaTrafficBy,
  type SaTrafficRow,
  type SaValue,
} from '@frontline/shared';
import { dayNumber } from '../dates';
import type { Db } from '../db';
import { demoParts } from '../demo';
import { demoDays, type Slice } from './sales';
import { datasetFreshness } from './sources';

export type TrafficMetricId = 'sessions' | 'site_conversion';

const value = (v: number | null, status: SaValue['status'], extra: Omit<SaValue, 'value' | 'status'> = {}): SaValue => ({ value: v, status, ...extra });

/** A marketplace's own traffic, by its name for it. Never the site's sessions (decision 14). */
const MARKETPLACES: Partial<Record<SaSourceKind, string>> = { tiktok_shop: 'Visitors', amazon: 'Sessions' };

/** What each step counts. GA4's carts and checkouts are event counts, Shopify's are sessions. */
const STEPS: Record<SaFunnelStepId, [string, string?]> = {
  sessions: ['Sessions'],
  add_to_carts: ['Sessions with an add to cart', 'Add-to-cart events'],
  checkouts: ['Sessions that reached checkout', 'Checkout events'],
  purchase_sessions: ['Sessions that completed checkout'],
};
const step = (id: SaFunnelStepId, v: SaValue, ga4 = false): SaFunnelStep => {
  const events = ga4 && STEPS[id][1];
  return { id, label: events || STEPS[id][0], unit: events ? 'events' : 'sessions', value: v };
};

export interface TrafficFunnel {
  /** Who reports the site's traffic: GA4 when connected, else the store's platform; null for a marketplace store (no site). */
  source: SaSourceKind | null;
  steps: SaFunnelStep[];
  conversion: SaValue;
  channels: SaChannelTraffic[];
}

/**
 * A day's sessions count as reported when it has some, or falls inside a traffic read's covered days (a real 0).
 * ponytail: daily_metrics.sessions defaults to 0, so a 0 outside every read's range is read as not reported.
 * Store level, so a slice's channels don't apply; its cut scales the last day (day grain, estimated).
 */
export function trafficFunnel(db: Db, storeId: string, from: string, to: string, slice?: Slice): TrafficFunnel {
  const store = db.prepare('SELECT platform, demo FROM stores WHERE id = ?').get(storeId)!;
  const span = dayNumber(to) - dayNumber(from) + 1;
  const k = slice?.cut?.fraction ?? 1;
  if (store.demo) {
    const days = demoDays(db, storeId, from, to, slice?.cut);
    if (!days.length) {
      const none = value(null, 'unavailable', { reason: 'insufficient_history', note: 'Before the demo history' });
      return { source: 'demo', steps: SA_FUNNEL_STEPS.map((id) => step(id, none)), conversion: none, channels: [] };
    }
    const counts = db.prepare('SELECT date, add_to_carts AS carts, checkouts FROM daily_metrics WHERE store_id = ? AND date BETWEEN ? AND ?').all(storeId, from, to);
    const count = (col: string) => Math.round(counts.reduce((a, d) => a + Number(d[col]) * (d.date === to ? k : 1), 0));
    const sessions = days.reduce((a, d) => a + d.sessions, 0);
    const bought = days.reduce((a, d) => a + demoParts(storeId, d.date, d.revenue).purchaseSessions, 0);
    const demo = (v: number | null) => value(v, 'demo');
    return {
      source: 'demo',
      steps: [step('sessions', demo(sessions)), step('add_to_carts', demo(count('carts'))), step('checkouts', demo(count('checkouts'))), step('purchase_sessions', demo(bought))],
      conversion: demo(ratio(bought, sessions)),
      channels: [],
    };
  }

  // GA4 owns the site's sessions when connected (the platform's own traffic read steps aside); else the store's platform.
  const ga4 = !!db.prepare('SELECT 1 FROM integrations WHERE id = ?').get(`ga4:${storeId}`);
  const platform = store.platform as SaSourceKind;
  const source: SaSourceKind = ga4 ? 'ga4' : platform;
  const ranges = db
    .prepare("SELECT covered_from AS f, covered_to AS t FROM source_datasets WHERE store_id = ? AND dataset = 'traffic' AND covered_from IS NOT NULL")
    .all(storeId)
    .map((r) => [String(r.f), String(r.t)]);
  const days = db
    .prepare('SELECT date, sessions, add_to_carts AS carts, checkouts, purchase_sessions AS ps FROM daily_metrics WHERE store_id = ? AND date BETWEEN ? AND ?')
    .all(storeId, from, to)
    .filter((d) => Number(d.sessions) > 0 || ranges.some(([f, t]) => String(d.date) >= f! && String(d.date) <= t!));
  const both = days.filter((d) => d.ps != null);
  const total = (rows: typeof days, col: string) => rows.reduce((a, d) => a + Number(d[col]) * (d.date === to ? k : 1), 0);
  const sum = (rows: typeof days, col: string) => Math.round(total(rows, col));
  const cutStatus: SaValue['status'] = slice?.cut ? 'estimated' : 'ok';
  const covered = (n: number) => (n < span ? { coverage: { share: n / span, of: 'days' }, note: `${n} of ${span} days reported` } : {});
  const reported = (col: string) => value(sum(days, col), combineStatus(days.length < span ? 'partial' : 'ok', cutStatus), covered(days.length));

  // No reported day: the traffic dataset's own reason (awaiting connection, not synced, failed…), never 0.
  const freshness = datasetFreshness(db, storeId).filter((f) => f.dataset === 'traffic' && f.source === source);
  const reason: SaReason = freshness.find((f) => f.reason)?.reason ?? (freshness.some((f) => f.status === 'failed') ? 'failed' : 'needs_ingestion');
  const sessions = days.length ? reported('sessions') : value(null, 'unavailable', { reason });

  // Each marketplace on the store: its own traffic is read only when it's the store's platform and GA4 isn't connected.
  const channels = db
    .prepare("SELECT kind FROM integrations WHERE store_id = ? AND kind IN ('tiktok_shop', 'amazon') ORDER BY kind")
    .all(storeId)
    .map((r) => r.kind as SaSourceKind)
    .map((kind): SaChannelTraffic => {
      const label = MARKETPLACES[kind]!;
      const name = SA_SOURCES[kind].name;
      const v = kind === source ? sessions : value(null, 'unavailable', { reason: 'not_tracked', note: `${name}'s ${label.toLowerCase()} are read only for a ${name} store without GA4` });
      return { channel: kind, label, value: v };
    });
  if (!ga4 && MARKETPLACES[platform]) {
    if (!channels.length) channels.push({ channel: platform, label: MARKETPLACES[platform]!, value: sessions });
    const name = SA_SOURCES[platform].name;
    const none = value(null, 'unavailable', { reason: 'unsupported', note: `${name} has no site: its ${MARKETPLACES[platform]!.toLowerCase()} are its own traffic` });
    return { source: null, steps: SA_FUNNEL_STEPS.map((id) => step(id, none)), conversion: none, channels };
  }

  const ps = SA_SOURCES[source]?.datasets.purchase_sessions;
  const purchases =
    !ps || ps.support !== 'supported'
      ? value(null, 'unavailable', { reason: 'unsupported', note: ps?.reason ?? 'Shopify site sessions only' })
      : !days.length
        ? sessions
        : !both.length
          ? value(null, 'unavailable', { reason: 'needs_ingestion', note: 'Purchasing sessions not synced yet' })
          : value(sum(both, 'ps'), combineStatus(both.length < span ? 'partial' : 'ok', cutStatus), covered(both.length));
  const conversion = purchases.value == null ? purchases : value(ratio(total(both, 'ps'), total(both, 'sessions')), purchases.status, covered(both.length));
  return {
    source,
    steps: [step('sessions', sessions), step('add_to_carts', days.length ? reported('carts') : sessions, ga4), step('checkouts', days.length ? reported('checkouts') : sessions, ga4), step('purchase_sessions', purchases)],
    conversion,
    channels,
  };
}

export function trafficMetrics(db: Db, storeId: string, from: string, to: string, slice?: Slice): Record<TrafficMetricId, SaValue> {
  const f = trafficFunnel(db, storeId, from, to, slice);
  return { sessions: f.steps[0]!.value, site_conversion: f.conversion };
}

/**
 * SA-100: sessions by one dimension from `traffic_breakdown_daily`, as the site's traffic source wrote them (its
 * `unknown` row holds what the values don't cover). A value's purchasing sessions are null unless every day of it has them.
 */
export function trafficBreakdown(db: Db, storeId: string, from: string, to: string, by: SaTrafficBy): { rows: SaTrafficRow[]; reason?: SaReason; note?: string } {
  const store = db.prepare('SELECT platform, demo FROM stores WHERE id = ?').get(storeId)!;
  if (store.demo) return { rows: [], reason: 'unsupported', note: 'Demo data has no traffic breakdowns' };
  const source: SaSourceKind = db.prepare('SELECT 1 FROM integrations WHERE id = ?').get(`ga4:${storeId}`) ? 'ga4' : (store.platform as SaSourceKind);
  const support = SA_SOURCES[source]?.datasets.traffic_breakdowns;
  if (!support || support.support !== 'supported') return { rows: [], reason: 'unsupported', note: support?.reason };
  const rows = db
    .prepare(
      `SELECT value, sum(sessions) AS sessions, CASE WHEN count(purchase_sessions) = count(*) THEN sum(purchase_sessions) END AS ps
       FROM traffic_breakdown_daily WHERE store_id = ? AND dimension = ? AND source = ? AND date BETWEEN ? AND ?
       GROUP BY value ORDER BY value = 'unknown', sessions DESC, value`,
    )
    .all(storeId, by, source, from, to)
    .map((r) => ({ value: String(r.value), sessions: Number(r.sessions), purchase_sessions: r.ps == null ? null : Number(r.ps) }));
  if (rows.length) return { rows };
  const freshness = datasetFreshness(db, storeId).filter((f) => f.dataset === 'traffic_breakdowns' && f.source === source);
  return { rows, reason: freshness.find((f) => f.reason)?.reason ?? (freshness.some((f) => f.status === 'failed') ? 'failed' : 'needs_ingestion') };
}
