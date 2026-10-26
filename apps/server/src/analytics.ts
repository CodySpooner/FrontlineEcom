import type { AdNetwork, AnalyticsRange, AnalyticsSummary, CampaignStats, MetricTotals, ProductStatus, TopProduct } from '@frontline/shared';
import type { Db } from './db';
import { addDays, dayFraction, dayNumber, localDate } from './dates';
import { demoTopProducts } from './demo';
import { fxFor } from './fx';
import { storeZone } from './stores';

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

/**
 * Each store's share of `day`'s sales made before `cutoff`, from its paid orders' times (sales aren't spread evenly over
 * the day: a morning holds less than its hours' share). `clock` stands in for a store with no orders that day.
 */
export function salesShares(db: Db, storeIds: string[], day: string, cutoff: Date, clock: number): Record<string, number> {
  const q = db.prepare(
    `SELECT coalesce(sum(total), 0) AS total, coalesce(sum(CASE WHEN julianday(created_at) < julianday(?) THEN total END), 0) AS before
     FROM orders WHERE store_id = ? AND local_date = ? AND status = 'paid'`,
  );
  return Object.fromEntries(storeIds.map((id) => {
    const r = q.get(cutoff.toISOString(), id, day)!;
    return [id, Number(r.total) > 0 ? Number(r.before) / Number(r.total) : clock];
  }));
}

/**
 * Pure: aggregates rows into the selected period ending at `to` and the preceding period of the same length.
 * `todayFraction` < 1 means `to` is still in progress: the previous period's last day then counts only that share (one
 * for all stores, or per store from salesShares), so deltas compare like with like instead of a partial day against a full one.
 */
export function summarize(rows: MetricRow[], { range, to, storeIds, todayFraction = 1 }: { range: AnalyticsRange; to: string; storeIds: string[]; todayFraction?: number | Record<string, number> }): AnalyticsSummary {
  const from = addDays(to, 1 - range);
  const prevFrom = addDays(from, -range);
  const prevLast = addDays(from, -1);
  const cur = rows.filter((r) => r.date >= from && r.date <= to);
  const share = (storeId: string) => (typeof todayFraction === 'number' ? todayFraction : (todayFraction[storeId] ?? 1));
  const prev = rows
    .filter((r) => r.date >= prevFrom && r.date < from)
    .map((r) => {
      const f = share(r.storeId);
      return r.date === prevLast && f < 1 ? { ...r, revenue: r.revenue * f, adSpend: r.adSpend * f, cogs: r.cogs * f, orders: Math.round(r.orders * f) } : r;
    });
  const totals = totalsOf(cur);
  const previous = totalsOf(prev);
  const series = Array.from({ length: range }, (_, i) => {
    const date = addDays(from, i);
    return { date, ...totalsOf(cur.filter((r) => r.date === date)) };
  });
  const byStore = storeIds.map((storeId) => {
    const t = totalsOf(cur.filter((r) => r.storeId === storeId));
    const p = totalsOf(prev.filter((r) => r.storeId === storeId));
    return { storeId, totals: t, previous: p, deltas: deltasOf(t, p) };
  });
  const sum = (k: 'sessions' | 'addToCarts' | 'checkouts') => cur.reduce((a, r) => a + (r[k] ?? 0), 0);
  const funnel = { sessions: sum('sessions'), addToCarts: sum('addToCarts'), checkouts: sum('checkouts'), orders: totals.orders };
  return { range, storeIds, from, to, totals, previous, deltas: deltasOf(totals, previous), series, byStore, funnel };
}

/**
 * Loads both periods for the given stores from daily_metrics, plus `pad` days either side. `cogs` also carries the store's
 * fee estimate, so profit nets it.
 */
export function loadRows(db: Db, storeIds: string[], range: AnalyticsRange, to: string, pad = 0): MetricRow[] {
  if (!storeIds.length) return [];
  const { rate } = fxFor(db, storeIds);
  return (db
    .prepare(
      `SELECT d.store_id AS storeId, d.date, d.revenue, d.ad_spend AS adSpend, d.cogs + d.revenue * s.fee_percent / 100 + d.orders * s.fee_per_order AS cogs,
         d.orders, d.sessions, d.add_to_carts AS addToCarts, d.checkouts
       FROM daily_metrics d JOIN stores s ON s.id = d.store_id
       WHERE d.store_id IN (${storeIds.map(() => '?').join(',')}) AND d.date BETWEEN ? AND ?`,
    )
    .all(...storeIds, addDays(to, 1 - 2 * range - pad), addDays(to, pad)) as unknown as MetricRow[])
    // A store with no exchange rate is left out (the summary lists its currency in `unconverted`).
    .flatMap((r) => {
      const x = rate(r.storeId);
      return !x ? [] : x === 1 ? [r] : [{ ...r, revenue: r.revenue * x, adSpend: r.adSpend * x, cogs: r.cogs * x }];
    });
}

/**
 * Today in the first store's day zone (a connected shop's own timezone) as `to`, and how many days each store's own today
 * is behind it (negative: ahead). A store's window ending `to` is its own days, `shift` earlier.
 */
export function dayShifts(db: Db, storeIds: string[], now = Date.now()) {
  const to = localDate(new Date(now), storeZone(db, storeIds[0]));
  return { to, shift: Object.fromEntries(storeIds.map((id) => [id, dayNumber(to) - dayNumber(localDate(new Date(now), storeZone(db, id)))])) };
}

/** Each store's [from, to] for a window [from, to] in `dayShifts`' days. */
const ownDays = (storeIds: string[], from: string, to: string, shift: Record<string, number>) =>
  storeIds.map((id) => [id, addDays(from, -(shift[id] ?? 0)), addDays(to, -(shift[id] ?? 0))] as const);

/**
 * The window ending today, for the dashboard: each store's rows are lined up on its own today (see dayShifts), with its
 * share of its comparison day (`range` days back) made by now. ponytail: shifts of more than a day (zones 24 h+ apart)
 * fall outside the loaded rows.
 */
export function currentWindow(db: Db, storeIds: string[], range: AnalyticsRange, now = Date.now()) {
  const { to, shift } = dayShifts(db, storeIds, now);
  const cutoff = new Date(now - range * 86_400_000);
  const todayFraction: Record<string, number> = {};
  for (const id of storeIds) {
    const tz = storeZone(db, id);
    const today = addDays(to, -shift[id]!);
    Object.assign(todayFraction, salesShares(db, [id], addDays(today, -range), cutoff, dayFraction(today, now, tz)));
  }
  const rows = loadRows(db, storeIds, range, to, 1).map((r) => (shift[r.storeId] ? { ...r, date: addDays(r.date, shift[r.storeId]!) } : r));
  return { to, todayFraction, rows };
}

const STATUS = (s: string): CampaignStats['status'] => (s === 'paused' ? 'paused' : s === 'archived' || s === 'deleted' || s === 'removed' ? 'archived' : 'active');

/** Every campaign of the stores with its totals over [from, to] (each store's own days, see dayShifts), biggest spend first. */
export function campaignStats(db: Db, storeIds: string[], from: string, to: string, shift: Record<string, number> = {}): CampaignStats[] {
  if (!storeIds.length) return [];
  const { rate } = fxFor(db, storeIds);
  return db
    .prepare(
      `WITH w (store_id, d_from, d_to) AS (VALUES ${storeIds.map(() => '(?, ?, ?)').join(',')})
       SELECT c.network, c.id, c.store_id, c.name, c.status, c.daily_budget, coalesce(sum(d.spend), 0) AS spend, coalesce(sum(d.revenue), 0) AS revenue,
         coalesce(sum(d.purchases), 0) AS purchases, coalesce(sum(d.clicks), 0) AS clicks, coalesce(sum(d.impressions), 0) AS impressions
       FROM campaigns c JOIN w ON w.store_id = c.store_id
       LEFT JOIN campaign_daily d ON d.network = c.network AND d.campaign_id = c.id AND d.date BETWEEN w.d_from AND w.d_to
       GROUP BY c.network, c.id ORDER BY spend DESC, c.name`,
    )
    .all(...ownDays(storeIds, from, to, shift).flat())
    .filter((r) => rate(String(r.store_id)))
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

/**
 * Best sellers over [from, to] (each store's own days, see dayShifts): paid orders' line items for real stores, a
 * revenue-consistent split for demo stores.
 */
export function topProducts(db: Db, storeIds: string[], from: string, to: string, limit: number, shift: Record<string, number> = {}): TopProduct[] {
  if (!storeIds.length) return [];
  const marks = storeIds.map(() => '?').join(',');
  const demo = db.prepare(`SELECT id FROM stores WHERE demo = 1 AND id IN (${marks})`).all(...storeIds).map((r) => String(r.id));
  const real = storeIds.filter((id) => !demo.includes(id));
  const rows = real.length
    ? db
        .prepare(
          `WITH w (store_id, d_from, d_to) AS (VALUES ${real.map(() => '(?, ?, ?)').join(',')})
           SELECT i.store_id, i.product_id, p.title, p.image, p.inventory, p.inventory_tracked, p.status, sum(i.quantity) AS units, sum(i.revenue) AS revenue, sum(i.revenue - i.cost) AS profit
           FROM order_items i JOIN orders o ON o.store_id = i.store_id AND o.id = i.order_id
           JOIN w ON w.store_id = i.store_id AND o.local_date BETWEEN w.d_from AND w.d_to
           LEFT JOIN products p ON p.store_id = i.store_id AND p.id = i.product_id
           WHERE o.status = 'paid'
           GROUP BY i.store_id, i.product_id`,
        )
        // No LIMIT here: stores in different currencies only rank correctly after conversion (below).
        .all(...ownDays(real, from, to, shift).flat())
        .map((r) => ({
          storeId: String(r.store_id),
          productId: String(r.product_id),
          title: r.title == null ? 'Removed product' : String(r.title),
          ...(r.image ? { image: String(r.image) } : {}),
          units: Number(r.units),
          revenue: r2(Number(r.revenue)),
          profit: r2(Number(r.profit)),
          ...(r.status == null ? {} : { inventory: Number(r.inventory), inventoryTracked: !!r.inventory_tracked, status: String(r.status) as ProductStatus }),
        }))
    : [];
  const { rate } = fxFor(db, storeIds);
  // The store's fee % comes off each product's revenue, as it does off the store's profit (the per-order fee can't be split).
  const fee = new Map(db.prepare(`SELECT id, fee_percent FROM stores WHERE id IN (${marks})`).all(...storeIds).map((r) => [String(r.id), Number(r.fee_percent)]));
  return [...rows, ...ownDays(demo, from, to, shift).flatMap(([id, f, t]) => demoTopProducts(db, id, f, t))]
    .map((p) => (fee.get(p.storeId) ? { ...p, profit: r2(p.profit - (p.revenue * fee.get(p.storeId)!) / 100) } : p))
    .filter((p) => rate(p.storeId))
    .map((p) => (rate(p.storeId) === 1 ? p : { ...p, revenue: r2(p.revenue * rate(p.storeId)), profit: r2(p.profit * rate(p.storeId)) }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}
