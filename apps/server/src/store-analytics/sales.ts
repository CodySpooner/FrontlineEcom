// SA-16: the v1 sales metrics (SA_METRICS, decisions 8 to 12) for one store over [from, to] of its own days.
import { SA_REASONS, combineStatus, ratio, type SaReason, type SaValue } from '@frontline/shared';
import { addDays, localDate } from '../dates';
import type { Db } from '../db';
import { storeZone } from '../stores';
import { convertOn } from './fx';
import { datasetFreshness } from './sources';

export type SalesMetricId = 'net_sales' | 'gross_sales' | 'discounts' | 'refunds' | 'orders' | 'aov' | 'units' | 'cancelled_orders' | 'refund_rate';
/** Decision 8: refunds on their own day (the default) or on their order's day (`refunds=order_day`, labelled). */
export type RefundBasis = 'refund_day' | 'order_day';

/**
 * Decision 10: canonical paid orders, not duplicate channel copies. One with money parts (`breakdown_at`) was paid when
 * it has a paid time, cancelled or refunded later or not; one synced before them counts as the legacy surfaces do.
 */
export const CANONICAL = `o.duplicate_of IS NULL AND iif(o.breakdown_at IS NULL, o.status = 'paid', o.paid_at IS NOT NULL AND o.status IN ('paid', 'refunded'))`;

const cents = (n: number) => Math.round(n * 100) / 100;
const pct = (share: number) => `${Math.round(share * 100)}%`;
const value = (v: number | null, status: SaValue['status'], extra: Omit<SaValue, 'value' | 'status'> = {}): SaValue => ({ value: v, status, ...extra });
const missing = (reason: SaReason, note?: string): SaValue => value(null, 'unavailable', { reason, ...(note ? { note } : {}) });

/** Unavailable (with the orders dataset's reason) while the store's orders were never read: never a 0. */
function unread(db: Db, storeId: string): SaValue | undefined {
  if (db.prepare('SELECT 1 FROM orders WHERE store_id = ? LIMIT 1').get(storeId)) return;
  const rows = datasetFreshness(db, storeId).filter((f) => f.dataset === 'orders');
  if (rows.some((f) => f.status === 'available' || f.status === 'partial' || f.status === 'verified')) return;
  const reason = rows.find((f) => f.reason)?.reason ?? (rows.some((f) => f.status === 'failed') ? 'failed' : 'needs_ingestion');
  return missing(reason, rows.find((f) => f.error)?.error ?? undefined);
}

export function salesMetrics(db: Db, storeId: string, from: string, to: string, basis: RefundBasis = 'refund_day'): Record<SalesMetricId, SaValue> {
  const none = unread(db, storeId);
  if (none) return { net_sales: none, gross_sales: none, discounts: none, refunds: none, orders: none, aov: none, units: none, cancelled_orders: none, refund_rate: none };
  const storeCur = String(db.prepare('SELECT currency FROM stores WHERE id = ?').get(storeId)!.currency);
  // A day with no rate leaves its orders out of the money (decision 19), listed in the note.
  const unconverted = new Map<string, number>();
  const fx = (day: string, cur: unknown, locked: unknown, n: number) => {
    const x = locked != null ? Number(locked) : convertOn(db, day, cur == null ? storeCur : String(cur), storeCur);
    if (x == null) unconverted.set(`${String(cur)} on ${day}`, (unconverted.get(`${String(cur)} on ${day}`) ?? 0) + n);
    return x;
  };

  // Orders placed in the period. Those synced before money parts were recorded count as total − tax less their legacy
  // refund lines (TikTok Shop, Amazon), already in the store's currency: an estimate.
  let [orders, estimated, counted, gross, discounts, est] = [0, 0, 0, 0, 0, 0];
  const placed = db
    .prepare(
      `SELECT o.local_date AS day, o.currency AS cur, o.fx_rate AS locked, o.breakdown_at IS NOT NULL AS parts, count(*) AS n, sum(o.gross_sales) AS gross, sum(o.discounts) AS disc,
         sum(o.total - o.tax - coalesce((SELECT sum(r.amount) FROM amazon_refunds r WHERE r.store_id = o.store_id AND r.order_id = o.id), 0)) AS est
       FROM orders o WHERE o.store_id = ? AND o.local_date BETWEEN ? AND ? AND ${CANONICAL}
       GROUP BY 1, 2, 3, 4`,
    )
    .all(storeId, from, to);
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
  let refunds = 0;
  for (const r of db
    .prepare(
      `SELECT r.local_date AS day, o.currency AS cur, o.fx_rate AS locked, sum(r.merchandise) AS merch FROM refunds r JOIN orders o ON o.store_id = r.store_id AND o.id = r.order_id
       WHERE r.store_id = ? AND ${dayCol} BETWEEN ? AND ? AND o.breakdown_at IS NOT NULL AND ${CANONICAL} GROUP BY 1, 2, 3`,
    )
    .all(storeId, from, to)) {
    const x = fx(String(r.day), r.cur, r.locked, 0);
    if (x != null) refunds += Number(r.merch ?? 0) * x;
  }
  const refundedUnits = Number(
    db.prepare(`SELECT coalesce(sum(r.quantity), 0) AS q FROM refunds r JOIN orders o ON o.store_id = r.store_id AND o.id = r.order_id WHERE r.store_id = ? AND r.local_date BETWEEN ? AND ? AND o.breakdown_at IS NOT NULL AND ${CANONICAL}`).get(storeId, from, to)!.q,
  );

  // Decision 12: units from order lines; an order without them falls back to its per-product rows, estimated.
  const lineUnits = db
    .prepare(
      `SELECT coalesce(sum(l.quantity), 0) AS q, count(DISTINCT l.order_id) AS n FROM order_lines l JOIN orders o ON o.store_id = l.store_id AND o.id = l.order_id
       WHERE o.store_id = ? AND o.local_date BETWEEN ? AND ? AND ${CANONICAL}`,
    )
    .get(storeId, from, to)!;
  const itemUnits = db
    .prepare(
      `SELECT coalesce(sum(i.quantity), 0) AS q FROM order_items i JOIN orders o ON o.store_id = i.store_id AND o.id = i.order_id
       WHERE o.store_id = ? AND o.local_date BETWEEN ? AND ? AND ${CANONICAL} AND NOT EXISTS (SELECT 1 FROM order_lines l WHERE l.store_id = o.store_id AND l.order_id = o.id)`,
    )
    .get(storeId, from, to)!;
  const units = Number(lineUnits.q) + Number(itemUnits.q);
  const linesShare = orders ? Number(lineUnits.n) / orders : 1;

  // Paid orders cancelled on a day of the period (the store's days), whenever they were placed.
  const zone = storeZone(db, storeId);
  const cancelled = db
    .prepare(`SELECT o.cancelled_at AS at FROM orders o WHERE o.store_id = ? AND o.cancelled_at BETWEEN ? AND ? AND o.breakdown_at IS NOT NULL AND ${CANONICAL}`)
    .all(storeId, addDays(from, -1), addDays(to, 2))
    .filter((r) => {
      const day = localDate(new Date(String(r.at)), zone);
      return day >= from && day <= to;
    }).length;

  // Coverage. Orders without money parts make the totals estimates; what only money parts give (discounts, refunds,
  // cancellations) is partial, or unavailable when no order in the period has them.
  const partsShare = orders ? (orders - estimated) / orders : 1;
  const estNote = estimated ? `${pct(estimated / orders)} of orders synced before money parts were recorded` : undefined;
  const fxNote = unconverted.size ? `Left out, no exchange rate: ${[...unconverted].map(([k, n]) => (n ? `${n} order${n === 1 ? '' : 's'} in ${k}` : `refunds in ${k}`)).join('; ')}` : undefined;
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
