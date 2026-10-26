import type { AdNetwork, AnalyticsRange, AnalyticsSummary, CampaignStats, MetricTotals, TopProduct } from '@frontline/shared';
import type { Db } from './db';
import { addDays } from './dates';
import { demoTopProducts } from './demo';
import { fxFor } from './fx';

export interface MetricRow {
  storeId: string;
  date: string;
  revenue: number;
  adSpend: number;
  cogs: number;
  orders: number;
  sessions?: number;
  addToCarts?: number;
  checkouts?: number;
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
  const sum = (k: 'sessions' | 'addToCarts' | 'checkouts') => cur.reduce((a, r) => a + (r[k] ?? 0), 0);
  const funnel = { sessions: sum('sessions'), addToCarts: sum('addToCarts'), checkouts: sum('checkouts'), orders: totals.orders };
  return { range, storeIds, from, to, totals, previous, deltas: deltasOf(totals, previous), series, byStore, funnel };
}

/** Loads both periods for the given stores from daily_metrics. */
export function loadRows(db: Db, storeIds: string[], range: AnalyticsRange, to: string): MetricRow[] {
  if (!storeIds.length) return [];
  const { rate } = fxFor(db, storeIds);
  return (db
    .prepare(
      `SELECT store_id AS storeId, date, revenue, ad_spend AS adSpend, cogs, orders, sessions, add_to_carts AS addToCarts, checkouts FROM daily_metrics
       WHERE store_id IN (${storeIds.map(() => '?').join(',')}) AND date BETWEEN ? AND ?`,
    )
    .all(...storeIds, addDays(to, 1 - 2 * range), to) as unknown as MetricRow[])
    .map((r) => {
      const x = rate(r.storeId);
      return x === 1 ? r : { ...r, revenue: r.revenue * x, adSpend: r.adSpend * x, cogs: r.cogs * x };
    });
}

const STATUS = (s: string): CampaignStats['status'] => (s === 'paused' ? 'paused' : s === 'archived' || s === 'deleted' || s === 'removed' ? 'archived' : 'active');

/** Every campaign of the stores with its totals over [from, to], biggest spend first. */
export function campaignStats(db: Db, storeIds: string[], from: string, to: string): CampaignStats[] {
  if (!storeIds.length) return [];
  const { rate } = fxFor(db, storeIds);
  return db
    .prepare(
      `SELECT c.network, c.id, c.store_id, c.name, c.status, c.daily_budget, coalesce(sum(d.spend), 0) AS spend, coalesce(sum(d.revenue), 0) AS revenue,
         coalesce(sum(d.purchases), 0) AS purchases, coalesce(sum(d.clicks), 0) AS clicks, coalesce(sum(d.impressions), 0) AS impressions
       FROM campaigns c LEFT JOIN campaign_daily d ON d.network = c.network AND d.campaign_id = c.id AND d.date BETWEEN ? AND ?
       WHERE c.store_id IN (${storeIds.map(() => '?').join(',')}) GROUP BY c.network, c.id ORDER BY spend DESC, c.name`,
    )
    .all(from, to, ...storeIds)
    .map((r) => {
      const x = rate(String(r.store_id));
      const spend = r2(Number(r.spend) * x);
      const revenue = r2(Number(r.revenue) * x);
      return {
        network: r.network as AdNetwork,
        id: String(r.id),
        storeId: String(r.store_id),
        name: String(r.name),
        status: STATUS(String(r.status)),
        dailyBudget: r2(Number(r.daily_budget) * x),
        spend,
        revenue,
        roas: spend ? r2(revenue / spend) : 0,
        purchases: Number(r.purchases),
        clicks: Number(r.clicks),
        impressions: Number(r.impressions),
      };
    })
    .sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name));
}

/** Best sellers over [from, to]: paid orders' line items for real stores, a revenue-consistent split for demo stores. */
export function topProducts(db: Db, storeIds: string[], from: string, to: string, limit: number): TopProduct[] {
  if (!storeIds.length) return [];
  const marks = storeIds.map(() => '?').join(',');
  const demo = db.prepare(`SELECT id FROM stores WHERE demo = 1 AND id IN (${marks})`).all(...storeIds).map((r) => String(r.id));
  const real = storeIds.filter((id) => !demo.includes(id));
  const rows = real.length
    ? db
        .prepare(
          `SELECT i.store_id, i.product_id, p.title, p.image, sum(i.quantity) AS units, sum(i.revenue) AS revenue, sum(i.revenue - i.cost) AS profit
           FROM order_items i JOIN orders o ON o.store_id = i.store_id AND o.id = i.order_id
           LEFT JOIN products p ON p.store_id = i.store_id AND p.id = i.product_id
           WHERE i.store_id IN (${real.map(() => '?').join(',')}) AND o.status = 'paid' AND o.local_date BETWEEN ? AND ?
           GROUP BY i.store_id, i.product_id ORDER BY revenue DESC LIMIT ?`,
        )
        .all(...real, from, to, limit)
        .map((r) => ({
          storeId: String(r.store_id),
          productId: String(r.product_id),
          title: r.title == null ? 'Removed product' : String(r.title),
          ...(r.image ? { image: String(r.image) } : {}),
          units: Number(r.units),
          revenue: r2(Number(r.revenue)),
          profit: r2(Number(r.profit)),
        }))
    : [];
  const { rate } = fxFor(db, storeIds);
  return [...rows, ...demo.flatMap((id) => demoTopProducts(db, id, from, to))]
    .map((p) => (rate(p.storeId) === 1 ? p : { ...p, revenue: r2(p.revenue * rate(p.storeId)), profit: r2(p.profit * rate(p.storeId)) }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}
