import type { AnalyticsRange, AnalyticsSummary, MetricTotals } from '@frontline/shared';
import type { Db } from './db';
import { addDays } from './dates';

export interface MetricRow {
  storeId: string;
  date: string;
  revenue: number;
  adSpend: number;
  cogs: number;
  orders: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function totalsOf(rows: MetricRow[]): MetricTotals {
  let revenue = 0, adSpend = 0, cogs = 0, orders = 0;
  for (const r of rows) {
    revenue += r.revenue;
    adSpend += r.adSpend;
    cogs += r.cogs;
    orders += r.orders;
  }
  return {
    revenue: r2(revenue),
    profit: r2(revenue - cogs - adSpend),
    adSpend: r2(adSpend),
    roas: adSpend ? r2(revenue / adSpend) : 0,
    orders,
    aov: orders ? r2(revenue / orders) : 0,
  };
}

const pct = (c: number, p: number) => (p ? r2(((c - p) / Math.abs(p)) * 100) : 0);

const deltasOf = (c: MetricTotals, p: MetricTotals) =>
  Object.fromEntries(Object.keys(c).map((k) => [k, pct(c[k as keyof MetricTotals], p[k as keyof MetricTotals])])) as unknown as MetricTotals;

/** Pure: aggregates rows into the selected period ending at `to` and the preceding period of the same length. */
export function summarize(rows: MetricRow[], { range, to, storeIds }: { range: AnalyticsRange; to: string; storeIds: string[] }): AnalyticsSummary {
  const from = addDays(to, 1 - range);
  const prevFrom = addDays(from, -range);
  const cur = rows.filter((r) => r.date >= from && r.date <= to);
  const prev = rows.filter((r) => r.date >= prevFrom && r.date < from);
  const totals = totalsOf(cur);
  const previous = totalsOf(prev);
  const series = Array.from({ length: range }, (_, i) => {
    const date = addDays(from, i);
    return { date, ...totalsOf(cur.filter((r) => r.date === date)) };
  });
  const byStore = storeIds.map((storeId) => {
    const t = totalsOf(cur.filter((r) => r.storeId === storeId));
    return { storeId, totals: t, deltas: deltasOf(t, totalsOf(prev.filter((r) => r.storeId === storeId))) };
  });
  return { range, storeIds, from, to, totals, previous, deltas: deltasOf(totals, previous), series, byStore };
}

/** Loads both periods for the given stores from daily_metrics. */
export function loadRows(db: Db, storeIds: string[], range: AnalyticsRange, to: string): MetricRow[] {
  if (!storeIds.length) return [];
  return db
    .prepare(
      `SELECT store_id AS storeId, date, revenue, ad_spend AS adSpend, cogs, orders FROM daily_metrics
       WHERE store_id IN (${storeIds.map(() => '?').join(',')}) AND date BETWEEN ? AND ?`,
    )
    .all(...storeIds, addDays(to, 1 - 2 * range), to) as unknown as MetricRow[];
}
