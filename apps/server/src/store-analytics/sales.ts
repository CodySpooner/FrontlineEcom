// SA-16: the v1 sales metrics (SA_METRICS, decisions 8 to 12) for one store over [from, to] of its own days.
import type { SQLInputValue } from 'node:sqlite';
import { SA_REASONS, combineStatus, ratio, type SaReason, type SaValue } from '@frontline/shared';
import { addDays, localDate } from '../dates';
import type { Db } from '../db';
import { demoParts, demoSoFar } from '../demo';
import { storeZone } from '../stores';
import { storeConverter } from './fx';
import { datasetFreshness } from './sources';

export type SalesMetricId = 'net_sales' | 'gross_sales' | 'discounts' | 'refunds' | 'orders' | 'aov' | 'units' | 'cancelled_orders' | 'refund_rate';
/** Decision 8: refunds on their own day (the default) or on their order's day (`refunds=order_day`, labelled). */
export type RefundBasis = 'refund_day' | 'order_day';

/**
 * Decision 10: canonical paid orders, not duplicate channel copies. One with money parts (`breakdown_at`) was paid when
 * it has a paid time, cancelled or refunded later or not; one synced before them counts as the legacy surfaces do.
 */
export const PAID = `iif(o.breakdown_at IS NULL, o.status = 'paid', o.paid_at IS NOT NULL AND o.status IN ('paid', 'refunded'))`;
export const CANONICAL = `o.duplicate_of IS NULL AND ${PAID}`;

/**
 * What a computation is narrowed to (SA-22). `cut`: the comparison's last day cut at today's clock time (decision 6):
 * order-grain rows on that day count up to `at`, day-grain ones scale by `fraction` (estimated). `channels`: the channel
 * filter, on the order's channel (an order synced before channels were recorded: TikTok Shop's by its id, else the
 * store's own channel).
 */
/**
 * `products`: orders holding one of these products' lines, counting only those lines (SA-47's collection filter).
 * `variants` (SA-83, with `products`): only the order and refund lines naming one of these variants; per-product rows
 * (`order_items`) name no variant, so none of them count.
 */
export type Slice = { cut?: { at: string; fraction: number }; channels?: string[]; products?: string[]; variants?: string[]; countries?: string[]; segments?: string[] };

/** ` AND …` conditions narrowing order `o` (and the row's own day and time columns) to a slice, with their params. */
export function sliceSql(db: Db, storeId: string, s: Slice | undefined, to: string, day = 'o.local_date', time = 'o.created_at') {
  const sql: string[] = [];
  const params: SQLInputValue[] = [];
  if (s?.cut) sql.push(`(${day} < ? OR julianday(${time}) <= julianday(?))`), params.push(to, s.cut.at);
  if (s?.channels?.length) {
    const platform = String(db.prepare('SELECT platform FROM stores WHERE id = ?').get(storeId)?.platform);
    sql.push(`coalesce(o.channel, iif(+o.id GLOB 'tt-*', 'tiktok_shop', ?)) IN (${s.channels.map(() => '?').join(', ')})`);
    params.push(platform === 'shopify' || platform === 'woocommerce' ? 'site' : platform, ...s.channels);
  }
  // SA-96: the order's recorded shipping country
  if (s?.countries) sql.push('o.country IN (SELECT value FROM json_each(?))'), params.push(JSON.stringify(s.countries));
  // SA-107: new is a customer's first counted order (since the first synced one), returning any later one; guests neither
  if (s?.segments) {
    const earlier = `EXISTS (SELECT 1 FROM orders p WHERE p.store_id = o.store_id AND p.customer_ref = o.customer_ref AND (p.created_at, p.id) < (o.created_at, o.id) AND ${CANONICAL.replace(/\bo\./g, 'p.')})`;
    sql.push(`o.customer_ref IS NOT NULL AND iif(${earlier}, 'returning', 'new') IN (SELECT value FROM json_each(?))`), params.push(JSON.stringify(s.segments));
  }
  if (s?.variants) {
    sql.push('EXISTS (SELECT 1 FROM order_lines x WHERE x.store_id = o.store_id AND x.order_id = o.id AND x.product_id IN (SELECT value FROM json_each(?)) AND x.variant_id IN (SELECT value FROM json_each(?)))');
    params.push(JSON.stringify(s.products ?? []), JSON.stringify(s.variants));
  } else if (s?.products) {
    const holds = (t: string) => `EXISTS (SELECT 1 FROM ${t} x WHERE x.store_id = o.store_id AND x.order_id = o.id AND x.product_id IN (SELECT value FROM json_each(?)))`;
    sql.push(`(${holds('order_lines')} OR ${holds('order_items')})`);
    params.push(JSON.stringify(s.products), JSON.stringify(s.products));
  }
  return { sql: sql.map((x) => ` AND ${x}`).join(''), params };
}

/** ` AND <col> IN (the slice's products)` and its param, or nothing without a product set; with variants, its row's variant too. */
export function inProducts(s: Slice | undefined, col: string): { sql: string; params: SQLInputValue[] } {
  if (!s?.products) return { sql: '', params: [] };
  const sql = ` AND ${col} IN (SELECT value FROM json_each(?))`;
  if (!s.variants) return { sql, params: [JSON.stringify(s.products)] };
  if (col.startsWith('i.')) return { sql: ' AND 0', params: [] }; // order_items has no variant column
  return { sql: `${sql} AND ${col.replace('product_id', 'variant_id')} IN (SELECT value FROM json_each(?))`, params: [JSON.stringify(s.products), JSON.stringify(s.variants)] };
}

/** A demo store's daily rows over [from, to]; with a cut, its last day as it stood at that time (`demoSoFar`). */
export function demoDays(db: Db, storeId: string, from: string, to: string, cut?: Slice['cut']) {
  return db
    .prepare('SELECT date, revenue, orders, cogs, sessions, ad_spend AS adSpend FROM daily_metrics WHERE store_id = ? AND date BETWEEN ? AND ? ORDER BY date')
    .all(storeId, from, to)
    .map((d) => {
      const m = cut && d.date === to ? demoSoFar(storeId, to, cut.fraction) : { revenue: Number(d.revenue), orders: Number(d.orders), cogs: Number(d.cogs), sessions: Number(d.sessions), adSpend: Number(d.adSpend) };
      return { date: String(d.date), revenue: m.revenue, orders: m.orders, cogs: m.cogs, sessions: m.sessions, adSpend: m.adSpend };
    });
}

const cents = (n: number) => Math.round(n * 100) / 100;
const pct = (share: number) => `${Math.round(share * 100)}%`;
const value = (v: number | null, status: SaValue['status'], extra: Omit<SaValue, 'value' | 'status'> = {}): SaValue => ({ value: v, status, ...extra });
const missing = (reason: SaReason, note?: string): SaValue => value(null, 'unavailable', { reason, ...(note ? { note } : {}) });

/** Unavailable (with the orders dataset's reason) while the store's orders were never read: never a 0. */
export function unread(db: Db, storeId: string): SaValue | undefined {
  if (db.prepare('SELECT 1 FROM orders WHERE store_id = ? LIMIT 1').get(storeId)) return;
  const rows = datasetFreshness(db, storeId).filter((f) => f.dataset === 'orders');
  if (rows.some((f) => f.status === 'available' || f.status === 'partial' || f.status === 'verified')) return;
  const reason = rows.find((f) => f.reason)?.reason ?? (rows.some((f) => f.status === 'failed') ? 'failed' : 'needs_ingestion');
  return missing(reason, rows.find((f) => f.error)?.error ?? undefined);
}

/**
 * Decision 30: a demo store's sales from `demoDay`'s parts over the days it has numbers for (today so far), so net
 * sales and orders are Dashboard's. Every value is `demo`; refunds fall on their order's day either way.
 */
function demoSales(db: Db, storeId: string, from: string, to: string, cut?: Slice['cut']): Record<SalesMetricId, SaValue> {
  const days = demoDays(db, storeId, from, to, cut);
  if (!days.length) {
    const none = missing('insufficient_history', 'Before the demo history');
    return { net_sales: none, gross_sales: none, discounts: none, refunds: none, orders: none, aov: none, units: none, cancelled_orders: none, refund_rate: none };
  }
  const s = { revenue: 0, orders: 0, gross: 0, discounts: 0, refunds: 0, units: 0, refundedUnits: 0, cancelled: 0 };
  for (const d of days) {
    const p = demoParts(storeId, d.date, d.revenue);
    s.revenue += d.revenue;
    s.orders += d.orders;
    for (const k of ['gross', 'discounts', 'refunds', 'units', 'refundedUnits', 'cancelled'] as const) s[k] += p[k];
  }
  const demo = (v: number | null) => (v == null ? value(null, 'unavailable', { note: 'No demo orders in this period' }) : value(v, 'demo'));
  const aov = ratio(s.gross - s.discounts, s.orders);
  const rate = ratio(s.refundedUnits, s.units);
  return {
    net_sales: demo(cents(s.revenue)),
    gross_sales: demo(cents(s.gross)),
    discounts: demo(cents(s.discounts)),
    refunds: demo(cents(s.refunds)),
    orders: demo(s.orders),
    aov: demo(aov == null ? null : cents(aov)),
    units: demo(s.units),
    cancelled_orders: demo(s.cancelled),
    refund_rate: demo(rate),
  };
}

export function salesMetrics(db: Db, storeId: string, from: string, to: string, basis: RefundBasis = 'refund_day', slice?: Slice): Record<SalesMetricId, SaValue> {
  if (db.prepare('SELECT demo FROM stores WHERE id = ?').get(storeId)?.demo) return demoSales(db, storeId, from, to, slice?.cut);
  const none = unread(db, storeId);
  if (none) return { net_sales: none, gross_sales: none, discounts: none, refunds: none, orders: none, aov: none, units: none, cancelled_orders: none, refund_rate: none };
  // A day with no rate leaves its orders out of the money (decision 19), listed in the note.
  const { fx, unconverted, note } = storeConverter(db, String(db.prepare('SELECT currency FROM stores WHERE id = ?').get(storeId)!.currency));
  const w = sliceSql(db, storeId, slice, to);

  // Orders placed in the period. Those synced before money parts were recorded count as total − tax less their legacy
  // refund lines (TikTok Shop, Amazon), already in the store's currency: an estimate.
  // With a product set only the matching lines' money counts; an order without money parts, its matching per-product rows.
  let [orders, estimated, counted, gross, discounts, est] = [0, 0, 0, 0, 0, 0];
  const [pl, pi, pr] = [inProducts(slice, 'l.product_id'), inProducts(slice, 'i.product_id'), inProducts(slice, 'r.product_id')];
  const lines = (col: string) => `(SELECT sum(${col}) FROM order_lines l WHERE l.store_id = o.store_id AND l.order_id = o.id${pl.sql})`;
  const placed = db
    .prepare(
      `SELECT o.local_date AS day, o.currency AS cur, o.fx_rate AS locked, o.breakdown_at IS NOT NULL AS parts, count(*) AS n,
         sum(${slice?.products ? lines('l.gross') : 'o.gross_sales'}) AS gross, sum(${slice?.products ? lines('coalesce(l.discount, 0)') : 'o.discounts'}) AS disc,
         sum(${slice?.products ? `(SELECT sum(i.revenue) FROM order_items i WHERE i.store_id = o.store_id AND i.order_id = o.id${pi.sql})` : 'o.total - o.tax - coalesce((SELECT sum(r.amount) FROM amazon_refunds r WHERE r.store_id = o.store_id AND r.order_id = o.id), 0)'}) AS est
       FROM orders o WHERE o.store_id = ? AND o.local_date BETWEEN ? AND ? AND ${CANONICAL}${w.sql}
       GROUP BY 1, 2, 3, 4`,
    )
    .all(...(slice?.products ? [...pl.params, ...pl.params, ...pi.params] : []), storeId, from, to, ...w.params);
  for (const r of placed) {
    const n = Number(r.n);
    orders += n;
    if (!r.parts) {
      estimated += n;
      counted += n;
      est += Number(r.est);
      continue;
    }
    const x = fx(String(r.day), r.cur, r.locked, n);
    if (x == null) continue;
    counted += n;
    gross += Number(r.gross ?? 0) * x;
    discounts += Number(r.disc ?? 0) * x;
  }

  // Merchandise refunds of orders with money parts (the others' are inside their total), each at its own day's rate.
  const dayCol = basis === 'order_day' ? 'o.local_date' : 'r.local_date';
  const wr = sliceSql(db, storeId, slice, to, dayCol, basis === 'order_day' ? 'o.created_at' : 'r.refunded_at');
  const wu = sliceSql(db, storeId, slice, to, 'r.local_date', 'r.refunded_at');
  let refunds = 0;
  for (const r of db
    .prepare(
      `SELECT r.local_date AS day, o.currency AS cur, o.fx_rate AS locked, sum(r.merchandise) AS merch FROM refunds r JOIN orders o ON o.store_id = r.store_id AND o.id = r.order_id
       WHERE r.store_id = ? AND ${dayCol} BETWEEN ? AND ? AND o.breakdown_at IS NOT NULL AND ${CANONICAL}${wr.sql}${pr.sql} GROUP BY 1, 2, 3`,
    )
    .all(storeId, from, to, ...wr.params, ...pr.params)) {
    const x = fx(String(r.day), r.cur, r.locked, 0);
    if (x != null) refunds += Number(r.merch ?? 0) * x;
  }
  const refundedUnits = Number(
    db.prepare(`SELECT coalesce(sum(r.quantity), 0) AS q FROM refunds r JOIN orders o ON o.store_id = r.store_id AND o.id = r.order_id WHERE r.store_id = ? AND r.local_date BETWEEN ? AND ? AND o.breakdown_at IS NOT NULL AND ${CANONICAL}${wu.sql}${pr.sql}`).get(storeId, from, to, ...wu.params, ...pr.params)!.q,
  );

  // Decision 12: units from order lines; an order without them falls back to its per-product rows, estimated.
  const lineUnits = db
    .prepare(
      `SELECT coalesce(sum(l.quantity), 0) AS q, count(DISTINCT l.order_id) AS n FROM order_lines l JOIN orders o ON o.store_id = l.store_id AND o.id = l.order_id
       WHERE o.store_id = ? AND o.local_date BETWEEN ? AND ? AND ${CANONICAL}${w.sql}${pl.sql}`,
    )
    .get(storeId, from, to, ...w.params, ...pl.params)!;
  const itemUnits = db
    .prepare(
      `SELECT coalesce(sum(i.quantity), 0) AS q FROM order_items i JOIN orders o ON o.store_id = i.store_id AND o.id = i.order_id
       WHERE o.store_id = ? AND o.local_date BETWEEN ? AND ? AND ${CANONICAL} AND NOT EXISTS (SELECT 1 FROM order_lines l WHERE l.store_id = o.store_id AND l.order_id = o.id)${w.sql}${pi.sql}`,
    )
    .get(storeId, from, to, ...w.params, ...pi.params)!;
  const units = Number(lineUnits.q) + Number(itemUnits.q);
  const linesShare = orders ? Number(lineUnits.n) / orders : 1;

  // Paid orders cancelled on a day of the period (the store's days), whenever they were placed.
  const zone = storeZone(db, storeId);
  const wc = sliceSql(db, storeId, { ...slice, cut: undefined }, to);
  const cancelled = db
    .prepare(`SELECT o.cancelled_at AS at FROM orders o WHERE o.store_id = ? AND o.cancelled_at BETWEEN ? AND ? AND o.breakdown_at IS NOT NULL AND ${CANONICAL}${wc.sql}`)
    .all(storeId, addDays(from, -1), addDays(to, 2), ...wc.params)
    .filter((r) => {
      const day = localDate(new Date(String(r.at)), zone);
      return day >= from && day <= to && !(slice?.cut && day === to && Date.parse(String(r.at)) > Date.parse(slice.cut.at));
    }).length;

  // Coverage. Orders without money parts make the totals estimates; what only money parts give (discounts, refunds,
  // cancellations) is partial, or unavailable when no order in the period has them.
  const partsShare = orders ? (orders - estimated) / orders : 1;
  const estNote = estimated ? `${pct(estimated / orders)} of orders synced before money parts were recorded` : undefined;
  const fxNote = note();
  const notes = (...n: (string | undefined)[]) => (n.some(Boolean) ? { note: n.filter(Boolean).join('. ') } : {});
  const fxStatus: SaValue['status'] = unconverted.size ? 'partial' : 'ok';
  const partsCoverage = estimated ? { coverage: { share: partsShare, of: 'orders with money parts' } } : {};
  const money = (v: number) =>
    value(cents(v), combineStatus(fxStatus, estimated ? 'estimated' : 'ok'), { ...partsCoverage, ...notes(estNote, fxNote) });
  const partsOnly = (v: number | null, empty?: string) =>
    estimated && partsShare === 0
      ? missing('needs_ingestion', `${SA_REASONS.needs_ingestion}: these orders were synced before money parts were recorded`)
      : v == null
        ? value(null, 'unavailable', { note: empty! })
        : value(v, combineStatus(fxStatus, estimated ? 'partial' : 'ok'), { ...partsCoverage, ...notes(estNote, fxNote) });

  const orderValue = gross - discounts + est;
  const aov = ratio(orderValue, counted);
  const rate = ratio(refundedUnits, units);
  const unitsEstimated = linesShare < 1;
  return {
    gross_sales: money(gross + est),
    discounts: partsOnly(cents(discounts)),
    refunds: partsOnly(cents(refunds)),
    net_sales: value(cents(orderValue - refunds), combineStatus(fxStatus, estimated ? 'estimated' : 'ok'), {
      ...partsCoverage,
      ...notes(estNote, fxNote, basis === 'order_day' ? "Refunds on their order's day" : undefined),
    }),
    orders: value(orders, estimated ? 'estimated' : 'ok', { ...partsCoverage, ...notes(estNote) }),
    aov: aov == null ? value(null, 'unavailable', { note: 'No orders in this period' }) : money(aov),
    units: value(units, unitsEstimated ? 'estimated' : 'ok', unitsEstimated ? { coverage: { share: linesShare, of: 'orders with order lines' }, note: `${pct(1 - linesShare)} of orders have no order lines yet` } : {}),
    cancelled_orders: partsOnly(cancelled),
    refund_rate: estimated && partsShare === 0 ? partsOnly(null) : rate == null ? value(null, 'unavailable', { note: 'No units ordered in this period' }) : value(rate, combineStatus(unitsEstimated ? 'estimated' : 'ok', estimated ? 'partial' : 'ok'), { ...partsCoverage, ...notes(estNote) }),
  };
}
