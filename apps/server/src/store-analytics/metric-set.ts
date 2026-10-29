// SA-22: one store's metric set for a period: every v1 metric computed here, with its comparison and one filter scope.
import { SA_FILTERS, SA_METRICS, changeOf, saDef, type SaFilterKey, type SaFilterScope, type SaFilters, type SaMetricId, type SaMetricSet, type SaSeries, type SaSeriesPoint, type SaValue } from '@frontline/shared';
import { addDays } from '../dates';
import type { Db } from '../db';
import { adMetrics } from './ads';
import { costMetrics } from './costs';
import type { StorePeriod } from './period';
import type { Scope } from './routes';
import { salesMetrics, type RefundBasis, type Slice } from './sales';
import { trafficMetrics } from './traffic';

const SALES: SaMetricId[] = ['net_sales', 'gross_sales', 'discounts', 'refunds', 'orders', 'aov', 'units', 'cancelled_orders', 'refund_rate'];
const COSTS: SaMetricId[] = ['contribution_before_ads', 'cost_coverage', 'fees'];
const ADS: SaMetricId[] = ['ad_spend', 'platform_roas', 'contribution_after_ads'];
const TRAFFIC: SaMetricId[] = ['sessions', 'site_conversion'];
/** The metrics' filters the computation applies today; the registry's others are named as not applied yet. */
const APPLIED: SaFilterKey[] = ['channel'];

/** Every metric in `ids` over [from, to], computing only the groups they need. */
function valuesOf(db: Db, storeId: string, ids: SaMetricId[], from: string, to: string, basis: RefundBasis, slice: Slice): Record<SaMetricId, SaValue> {
  const need = (g: SaMetricId[]) => ids.some((i) => g.includes(i));
  const out = {} as Record<SaMetricId, SaValue>;
  if (need(SALES)) Object.assign(out, salesMetrics(db, storeId, from, to, basis, slice));
  const costs = need([...COSTS, 'contribution_after_ads']) ? costMetrics(db, storeId, from, to, basis, slice) : undefined;
  Object.assign(out, costs);
  if (need(ADS)) Object.assign(out, adMetrics(db, storeId, from, to, { before: costs?.contribution_before_ads, slice }).values);
  if (need(TRAFFIC)) Object.assign(out, trafficMetrics(db, storeId, from, to, slice));
  // ponytail: stock cover needs inventory snapshots, which nothing reads yet (SA-50).
  out.stock_cover = { value: null, status: 'unavailable', reason: 'needs_ingestion', note: 'Stock levels over time are not synced yet' };
  return out;
}

/** Why `id` doesn't apply filter `key`, or undefined when it does (decision 4). */
function ignoredBecause(id: SaMetricId, key: SaFilterKey, demo: boolean) {
  if (id === 'contribution_after_ads') return "Ad spend isn't allocated: store level only";
  if (!SA_METRICS[id].filters.includes(key)) return `Store level: not split by ${SA_FILTERS[key].toLowerCase()}`;
  if (demo) return `Demo data isn't split by ${SA_FILTERS[key].toLowerCase()}`;
  if (!APPLIED.includes(key)) return 'Not applied to this metric yet';
}

/** The filters' slice, the comparison's dates and its last-day cut: what a set and a series share. */
function setup(db: Db, storeId: string, sp: StorePeriod, filters: SaFilters) {
  const demo = !!db.prepare('SELECT demo FROM stores WHERE id = ?').get(storeId)?.demo;
  const active = (Object.keys(filters) as SaFilterKey[]).filter((k) => filters[k]?.length);
  const slice: Slice = filters.channel?.length && !demo ? { channels: filters.channel } : {};
  const compare = sp.compare && 'from' in sp.compare ? sp.compare : undefined;
  // With today in the period, the comparison's last day stops at the same clock time (decision 6).
  const cut = sp.period.partial && sp.cut && sp.fraction != null ? { at: sp.cut, fraction: sp.fraction } : undefined;
  return { demo, active, slice, compare, cut };
}

export function computeMetricSet(db: Db, scope: Scope, ids: SaMetricId[], sp: StorePeriod, filters: SaFilters = {}, basis: RefundBasis = 'refund_day'): SaMetricSet {
  const { demo, active, slice, compare, cut } = setup(db, scope.storeId, sp, filters);
  const cur = valuesOf(db, scope.storeId, ids, sp.period.from, sp.period.to, basis, slice);
  const prev = compare && valuesOf(db, scope.storeId, ids, compare.from, compare.to, basis, { ...slice, ...(cut && { cut }) });

  const out: SaFilterScope = { applied: [], ignored: [] };
  const metrics = ids.map((id) => {
    let value = cur[id];
    for (const key of active) {
      const reason = ignoredBecause(id, key, demo);
      if (!reason) {
        if (!out.applied.includes(key)) out.applied.push(key);
        continue;
      }
      out.ignored.push({ key, reason, metric: id });
      if (id === 'contribution_after_ads') value = { value: null, status: 'unavailable', note: 'Unavailable with a filter: ad spend is never allocated' };
    }
    const previous = prev ? prev[id] : null;
    return { ...value, id, def: saDef(id), previous, change: changeOf(value.value, previous?.value ?? null, SA_METRICS[id].unit) };
  });
  return { period: sp.period, compare: sp.compare ?? null, today: sp.today, zoneLabel: sp.zoneLabel, zoneAbbr: sp.zoneAbbr, metrics, scope: out };
}

/**
 * SA-23: one metric's points over the period, days (weeks past 120 days) in the store's zone, so a 25-hour DST day is
 * one point. Each comparison point sits at the same day offset; the one holding the comparison's last day is cut like
 * the set's. ponytail: every point is its own computation; one grouped pass per day when SA-25's plans ask for it.
 */
export function computeSeries(db: Db, scope: Scope, id: SaMetricId, sp: StorePeriod, filters: SaFilters = {}, basis: RefundBasis = 'refund_day'): SaSeries {
  const set = computeMetricSet(db, scope, [id], sp, filters, basis);
  const { active, slice, compare, cut } = setup(db, scope.storeId, sp, filters);
  const blocked = id === 'contribution_after_ads' && active.length > 0;
  const step = sp.period.days > 120 ? 7 : 1;
  const min = (a: string, b: string) => (a < b ? a : b);
  const points: SaSeriesPoint[] = [];
  for (let i = 0; i * step < sp.period.days; i++) {
    const from = addDays(sp.period.from, i * step);
    const to = min(addDays(from, step - 1), sp.period.to);
    const v = valuesOf(db, scope.storeId, [id], from, to, basis, slice)[id];
    const pf = compare && addDays(compare.from, i * step);
    const pt = compare && pf! <= compare.to ? min(addDays(pf!, step - 1), compare.to) : undefined;
    const p = pt ? valuesOf(db, scope.storeId, [id], pf!, pt, basis, { ...slice, ...(cut && pt === compare!.to && { cut }) })[id] : undefined;
    points.push({
      from,
      to,
      value: blocked ? null : v.value,
      status: blocked ? 'unavailable' : v.status,
      previous: blocked ? null : (p?.value ?? null),
      ...(sp.period.partial && to === sp.period.to && { partial: true as const }),
    });
  }
  return { metric: id, def: saDef(id), grain: step === 1 ? 'day' : 'week', period: sp.period, compare: sp.compare ?? null, points, total: set.metrics[0]!, scope: set.scope };
}

/** `filters=` JSON → SaFilters, or an error message. */
export function parseFilters(raw: string | undefined): SaFilters | string {
  if (!raw) return {};
  let f: unknown;
  try {
    f = JSON.parse(raw);
  } catch {
    return 'filters must be JSON, e.g. {"channel":["site"]}';
  }
  if (!f || typeof f !== 'object' || Array.isArray(f)) return 'filters must be an object of lists';
  for (const [k, v] of Object.entries(f)) {
    if (!(k in SA_FILTERS)) return `Unknown filter: ${k}`;
    if (!Array.isArray(v) || !v.every((x) => typeof x === 'string' && x.length <= 200) || v.length > 100) return `filters.${k} must be a list of ids`;
  }
  return f as SaFilters;
}
