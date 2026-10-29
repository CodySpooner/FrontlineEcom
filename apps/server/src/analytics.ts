import type { AdNetwork, AnalyticsRange, AnalyticsSummary, CampaignStats, MetricTotals, Platform, ProductStatus, TopProduct } from '@frontline/shared';
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
  /** Of `orders`, those from a sales channel with its own shoppers (Amazon or TikTok Shop next to the store's site): not in `sessions`. */
  channelOrders?: number;
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
      // Spend too: ad networks pace delivery to traffic, which follows the same curve over the day as sales.
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
  // Orders from the store-days that report sessions: a store without a traffic source, or days from before its source
  // began (TikTok's last 30 days, GA4 connected mid-range), would inflate the conversion rate. With none, every order.
  // A channel's own orders (Amazon next to the site) are left out too: its shoppers never visited the site.
  const tracked = cur.filter((r) => (r.sessions ?? 0) > 0);
  const siteOrders = tracked.reduce((a, r) => a + r.orders - (r.channelOrders ?? 0), 0);
  const funnel = { sessions: sum('sessions'), addToCarts: sum('addToCarts'), checkouts: sum('checkouts'), orders: tracked.length ? siteOrders : totals.orders };
  return { range, storeIds, from, to, totals, previous, deltas: deltasOf(totals, previous), series, byStore, funnel };
}

/** Amazon's referral fee on most categories, for its sales next to a store's site. ponytail: FBA fees aren't estimated. */
export const AMAZON_REFERRAL = 0.15;

/**
 * Loads both periods for the given stores from daily_metrics, plus `pad` days either side. `cogs` also carries the store's
 * fee estimate, so profit nets it. A channel's sales next to the site (Amazon) come with no costs: they cost the store's
 * own cost ratio over the year to `to`, and Amazon's referral fee instead of the store's fees.
 */
export function loadRows(db: Db, storeIds: string[], range: AnalyticsRange, to: string, pad = 0): MetricRow[] {
  if (!storeIds.length) return [];
  const { rate } = fxFor(db, storeIds);
  const channel = (col: string) =>
    `iif(s.platform = 'amazon', 0, (SELECT coalesce(sum(c.${col}), 0) FROM channel_daily c WHERE c.store_id = d.store_id AND c.date = d.date))`;
  // TikTok Shop next to the site keeps its orders (tt-) with their own costs: they leave only the funnel and the site's
  // per-order fee. ponytail: the store's fee % still applies to them, for TikTok's own commission.
  // `+o.id` keeps SQLite on the day index: on the id index a 1Y view of a 100k-order store took 5 s instead of 35 ms.
  const tiktokOrders = `iif(s.platform = 'tiktok_shop', 0, (SELECT count(*) FROM orders o WHERE o.store_id = d.store_id AND o.local_date = d.date AND o.status = 'paid' AND +o.id GLOB 'tt-*'))`;
  // An Etsy shop or another site next to the store's own platform: out of its funnel (their shoppers aren't in its
  // sessions), but they pay a per-order fee much like the site's. ponytail: Shopify's orders (no prefix) next to
  // another platform stay in its funnel, as in platformSplit.
  const shopOrders = `(SELECT count(*) FROM orders o WHERE o.store_id = d.store_id AND o.local_date = d.date AND o.status = 'paid'
    AND (+o.id GLOB 'etsy-*' OR +o.id GLOB 'woo-*') AND NOT +o.id GLOB iif(s.platform = 'etsy', 'etsy-*', iif(s.platform = 'woocommerce', 'woo-*', '')))`;
  const ratios = new Map<string, number>();
  const ratio = (storeId: string) => {
    if (!ratios.has(storeId)) {
      const r = db
        .prepare(`SELECT sum(d.cogs) AS cogs, sum(d.revenue - ${channel('revenue')}) AS revenue FROM daily_metrics d JOIN stores s ON s.id = d.store_id WHERE d.store_id = ? AND d.date BETWEEN ? AND ?`)
        .get(storeId, addDays(to, -364), to);
      ratios.set(storeId, Number(r?.revenue) > 0 ? Number(r!.cogs) / Number(r!.revenue) : 0);
    }
    return ratios.get(storeId)!;
  };
  return (db
    .prepare(
      `SELECT d.store_id AS storeId, d.date, d.revenue, d.ad_spend AS adSpend, d.cogs, s.fee_percent AS feePercent, s.fee_per_order AS feePerOrder,
         d.orders, d.sessions, d.add_to_carts AS addToCarts, d.checkouts, ${channel('orders')} + ${tiktokOrders} AS channelOrders, ${shopOrders} AS shopOrders, ${channel('revenue')} AS channelRevenue
       FROM daily_metrics d JOIN stores s ON s.id = d.store_id
       WHERE d.store_id IN (${storeIds.map(() => '?').join(',')}) AND d.date BETWEEN ? AND ?`,
    )
    .all(...storeIds, addDays(to, 1 - 2 * range - pad), addDays(to, pad)) as unknown as (MetricRow & { feePercent: number; feePerOrder: number; channelRevenue: number; shopOrders: number })[])
    .map(({ feePercent, feePerOrder, channelRevenue, shopOrders, ...r }) => ({
      ...r,
      channelOrders: r.channelOrders! + shopOrders,
      cogs: r.cogs + ((r.revenue - channelRevenue) * feePercent) / 100 + (r.orders - r.channelOrders!) * feePerOrder
        + (channelRevenue ? channelRevenue * (ratio(r.storeId) + AMAZON_REFERRAL) : 0),
    }))
    // A store with no exchange rate is left out (the summary lists its currency in `unconverted`).
    .flatMap((r) => {
      const x = rate(r.storeId, r.date); // SA-53: each day at its own rate
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
  return { to, todayFraction, rows, shift };
}

/**
 * A sales channel next to a store's own platform, and its order ids (Amazon's sales are its daily totals, channel_daily).
 * ponytail: Shopify's ids have no prefix, so Shopify next to another platform stays in that platform's share.
 */
const CHANNELS = { tiktok_shop: 'tt-*', amazon: 'amz-*', etsy: 'etsy-*', woocommerce: 'woo-*' } as const;

/**
 * Revenue and orders over [from, to] (each store's own days, as topProducts) per sales platform, biggest first, in the
 * summary's currency: a channel next to a store's own platform is split out of the store's totals, net of its refunds as
 * the totals are, and the rest is the store's own platform's. Stores without an exchange rate are left out, as there.
 */
export function platformSplit(db: Db, storeIds: string[], from: string, to: string, shift: Record<string, number> = {}) {
  const { rate } = fxFor(db, storeIds);
  const platform = db.prepare('SELECT platform FROM stores WHERE id = ?');
  const totals = db.prepare('SELECT coalesce(sum(revenue), 0) AS revenue, coalesce(sum(orders), 0) AS orders FROM daily_metrics WHERE store_id = ? AND date BETWEEN ? AND ?');
  const orderSales = db.prepare("SELECT coalesce(sum(total), 0) AS revenue, count(*) AS orders FROM orders WHERE store_id = ? AND id GLOB ? AND status = 'paid' AND duplicate_of IS NULL AND local_date BETWEEN ? AND ?");
  const amazonSales = db.prepare("SELECT coalesce(sum(revenue), 0) AS revenue, coalesce(sum(orders), 0) AS orders FROM channel_daily WHERE store_id = ? AND channel = 'amazon' AND date BETWEEN ? AND ?");
  const refunds = db.prepare(
    `SELECT coalesce(sum(r.amount + r.tax), 0) AS amount FROM orders o JOIN amazon_refunds r ON r.store_id = o.store_id AND r.order_id = o.id
     WHERE o.store_id = ? AND o.id GLOB ? AND o.status = 'paid' AND o.duplicate_of IS NULL AND o.local_date BETWEEN ? AND ?`,
  );
  const out = new Map<Platform, { revenue: number; orders: number }>();
  const add = (p: Platform, revenue: number, orders: number) => {
    const o = out.get(p) ?? { revenue: 0, orders: 0 };
    out.set(p, { revenue: o.revenue + revenue, orders: o.orders + orders });
  };
  for (const [id, f, t] of ownDays(storeIds, from, to, shift)) {
    // ponytail: the split converts at the period's last day's rate, the totals (loadRows) per day (SA-53); per day here
    // needs each query by day. Campaigns and best sellers keep the latest rate.
    const x = rate(id, t);
    if (!x) continue;
    const own = platform.get(id)!.platform as Platform;
    const all = totals.get(id, f, t)!;
    let [revenue, orders] = [Number(all.revenue), Number(all.orders)];
    for (const [p, ids] of Object.entries(CHANNELS) as [keyof typeof CHANNELS, string][]) {
      if (p === own) continue;
      const c = (p === 'amazon' ? amazonSales.get(id, f, t) : orderSales.get(id, ids, f, t))!;
      const r = Number(c.revenue) - Number(refunds.get(id, ids, f, t)!.amount);
      if (!r && !Number(c.orders)) continue;
      add(p, r * x, Number(c.orders));
      revenue -= r;
      orders -= Number(c.orders);
    }
    add(own, revenue * x, orders);
  }
  return [...out].map(([p, v]) => ({ platform: p, revenue: r2(v.revenue), orders: v.orders })).sort((a, b) => b.revenue - a.revenue);
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
 * Best sellers over [from, to] (each store's own days, see dayShifts): paid orders' line items less their refund lines for real stores, a
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
          `WITH w (store_id, d_from, d_to) AS (VALUES ${real.map(() => '(?, ?, ?)').join(',')}),
           lines AS (
             SELECT i.store_id, i.product_id, i.quantity, i.revenue, i.cost
             FROM order_items i JOIN orders o ON o.store_id = i.store_id AND o.id = i.order_id
             JOIN w ON w.store_id = i.store_id AND o.local_date BETWEEN w.d_from AND w.d_to
             WHERE o.status = 'paid'
             -- Refund lines (TikTok Shop, Amazon) off their order's day, as rebuildRevenue takes them off the store's. One
             -- that names no product (a TikTok refund of a mixed order) lands on none. A product's refunds on an order come
             -- off at most what it sold for there: TikTok's refund total also returns shipping. ponytail: units stay gross.
             UNION ALL SELECT r.store_id, r.product_id, 0,
               -min(sum(r.amount), (SELECT coalesce(sum(i.revenue), 0) FROM order_items i WHERE i.store_id = r.store_id AND i.order_id = r.order_id AND i.product_id = r.product_id)), 0
             FROM amazon_refunds r JOIN orders o ON o.store_id = r.store_id AND o.id = r.order_id
             JOIN w ON w.store_id = r.store_id AND o.local_date BETWEEN w.d_from AND w.d_to
             WHERE o.status = 'paid' AND r.product_id IS NOT NULL
             GROUP BY r.store_id, r.order_id, r.product_id
           ),
           -- Summed before the product join: a lookup per product, not per line (1Y of a 110k-order store: 700 → 180 ms).
           -- ponytail: an orders (store_id, local_date, status, id) index would halve it again, if it's ever needed.
           sums AS (SELECT store_id, product_id, sum(quantity) AS units, sum(revenue) AS revenue, sum(revenue - cost) AS profit FROM lines GROUP BY store_id, product_id)
           SELECT s.store_id, s.product_id, p.title, p.image, p.inventory, p.inventory_tracked, p.status, s.units, s.revenue, s.profit
           FROM sums s LEFT JOIN products p ON p.store_id = s.store_id AND p.id = s.product_id`,
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
