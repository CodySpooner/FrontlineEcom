// SA-22: one store's metric set for a period: every v1 metric computed here, with its comparison and one filter scope.
import { SA_FILTERS, SA_METRICS, changeOf, saDef, type SaFilterKey, type SaFilterScope, type SaFilters, type SaMetricId, type SaMetricSet, type SaValue } from '@frontline/shared';
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

export function computeMetricSet(db: Db, scope: Scope, ids: SaMetricId[], sp: StorePeriod, filters: SaFilters = {}, basis: RefundBasis = 'refund_day'): SaMetricSet {
  const demo = !!db.prepare('SELECT demo FROM stores WHERE id = ?').get(scope.storeId)?.demo;
  const active = (Object.keys(filters) as SaFilterKey[]).filter((k) => filters[k]?.length);
  const slice: Slice = filters.channel?.length && !demo ? { channels: filters.channel } : {};
  const cur = valuesOf(db, scope.storeId, ids, sp.period.from, sp.period.to, basis, slice);
  const compare = sp.compare && 'from' in sp.compare ? sp.compare : undefined;
  // With today in the period, the comparison's last day stops at the same clock time (decision 6).
  const cut = sp.period.partial && sp.cut && sp.fraction != null ? { at: sp.cut, fraction: sp.fraction } : undefined;
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
