// SA-19: contribution before ads, cost coverage and fees (SA_METRICS, decisions 15 to 17) for one store's days.
import { combineStatus, ratio, type SaValue } from '@frontline/shared';
import { AMAZON_REFERRAL } from '../analytics';
import type { Db } from '../db';
import { demoParts } from '../demo';
import { storeConverter } from './fx';
import { CANONICAL, unread, type RefundBasis } from './sales';

export type CostMetricId = 'contribution_before_ads' | 'cost_coverage' | 'fees';

/**
 * Decision 15: a line's cost is the one recorded with it, else the unit cost (variant first, then product) effective on
 * its order's day, else unknown (NULL). Aliases: `l` the order line, `o` its order. Costs are in the store's currency.
 */
const LINE_COST = `coalesce(l.cost, l.quantity * (SELECT u.cost FROM unit_costs u WHERE u.store_id = l.store_id AND u.product_id = l.product_id
  AND (u.variant_id IS NULL OR u.variant_id = l.variant_id) AND u.effective_from <= o.local_date ORDER BY u.variant_id IS NULL, u.effective_from DESC, u.recorded_at DESC LIMIT 1))`;

const cents = (n: number) => Math.round(n * 100) / 100;
const value = (v: number | null, status: SaValue['status'], extra: Omit<SaValue, 'value' | 'status'> = {}): SaValue => ({ value: v, status, ...extra });

/** Decision 30: from the demo day's parts; product cost is the demo cogs, fees the store's estimate. Every value `demo`. */
function demoCosts(db: Db, storeId: string, from: string, to: string): Record<CostMetricId, SaValue> {
  const s = db.prepare('SELECT fee_percent AS pct, fee_per_order AS per FROM stores WHERE id = ?').get(storeId)!;
  const days = db.prepare('SELECT date, revenue, cogs, orders FROM daily_metrics WHERE store_id = ? AND date BETWEEN ? AND ?').all(storeId, from, to);
  if (!days.length) {
    const none = value(null, 'unavailable', { reason: 'insufficient_history', note: 'Before the demo history' });
    return { contribution_before_ads: none, cost_coverage: none, fees: none };
  }
  let [net, cogs, fees] = [0, 0, 0];
  for (const d of days) {
    const p = demoParts(storeId, String(d.date), Number(d.revenue));
    net += Number(d.revenue);
    cogs += Number(d.cogs);
    fees += (Number(s.pct) / 100) * (p.gross - p.discounts + p.shipping + p.tax) + Number(s.per) * Number(d.orders);
  }
  return { contribution_before_ads: value(cents(net - cogs - fees), 'demo'), cost_coverage: value(1, 'demo'), fees: value(cents(fees), 'demo') };
}

export function costMetrics(db: Db, storeId: string, from: string, to: string, basis: RefundBasis = 'refund_day'): Record<CostMetricId, SaValue> {
  const store = db.prepare('SELECT currency, demo, fee_percent AS pct, fee_per_order AS per FROM stores WHERE id = ?').get(storeId)!;
  if (store.demo) return demoCosts(db, storeId, from, to);
  const none = unread(db, storeId);
  if (none) return { contribution_before_ads: none, cost_coverage: none, fees: none };
  const { fx, unconverted, note } = storeConverter(db, String(store.currency));

  // Lines of the orders placed in the period. An order without order lines (synced before them) falls back to its
  // per-product rows, already in the store's currency, where a cost of 0 means none was known: an estimate.
  let [units, costedUnits, costedSales, cost, fallback] = [0, 0, 0, 0, 0];
  for (const r of db
    .prepare(
      `SELECT o.local_date AS day, o.currency AS cur, o.fx_rate AS locked, l.quantity AS q, l.gross - coalesce(l.discount, 0) AS sales, ${LINE_COST} AS cost, 0 AS items
       FROM order_lines l JOIN orders o ON o.store_id = l.store_id AND o.id = l.order_id WHERE o.store_id = ? AND o.local_date BETWEEN ? AND ? AND ${CANONICAL}
       UNION ALL
       SELECT o.local_date, NULL, 1, i.quantity, i.revenue, nullif(i.cost, 0), 1 FROM order_items i JOIN orders o ON o.store_id = i.store_id AND o.id = i.order_id
       WHERE o.store_id = ? AND o.local_date BETWEEN ? AND ? AND ${CANONICAL} AND NOT EXISTS (SELECT 1 FROM order_lines l WHERE l.store_id = o.store_id AND l.order_id = o.id)`,
    )
    .all(storeId, from, to, storeId, from, to)) {
    units += Number(r.q);
    if (r.items) fallback += Number(r.q);
    if (r.cost == null) continue;
    const x = fx(String(r.day), r.cur, r.locked, 0);
    if (x == null) continue;
    costedUnits += Number(r.q);
    costedSales += Number(r.sales) * x;
    cost += Number(r.cost);
  }

  // Merchandise refunds dated in the period come off the costed sales when their line had a cost; a restocked one gives
  // its units' cost back (decision 16). Legacy orders' refunds are already inside their per-product rows.
  // ponytail: a refund line finds its order line by variant (else product); two lines of one variant share the first's cost.
  let costedRefunds = 0;
  const dayCol = basis === 'order_day' ? 'o.local_date' : 'r.local_date';
  for (const r of db
    .prepare(
      `SELECT r.local_date AS day, o.currency AS cur, o.fx_rate AS locked, r.merchandise AS merch, coalesce(r.quantity, 0) AS q, r.restocked,
         (SELECT ${LINE_COST} / l.quantity FROM order_lines l WHERE l.store_id = r.store_id AND l.order_id = r.order_id
           AND (l.variant_id = r.variant_id OR (r.variant_id IS NULL AND l.product_id = r.product_id)) LIMIT 1) AS unit
       FROM refunds r JOIN orders o ON o.store_id = r.store_id AND o.id = r.order_id
       WHERE r.store_id = ? AND ${dayCol} BETWEEN ? AND ? AND r.merchandise IS NOT NULL AND o.breakdown_at IS NOT NULL AND ${CANONICAL}`,
    )
    .all(storeId, from, to)) {
    if (r.unit == null) continue;
    const x = fx(String(r.day), r.cur, r.locked, 0);
    if (x == null) continue;
    costedRefunds++;
    costedSales -= Number(r.merch) * x;
    if (r.restocked) cost -= Number(r.unit) * Number(r.q);
  }

  // Decision 17: recorded fees win, on their own day. Every other order placed in the period gets an estimate: Amazon as
  // a channel its referral fee on its sales, the rest the store's % of the amount charged plus its per-order fee.
  let [fees, estimatedOrders] = [0, 0];
  for (const r of db
    .prepare(
      `SELECT f.local_date AS day, coalesce(f.currency, o.currency) AS cur, iif(f.currency IS NULL OR f.currency = o.currency, o.fx_rate, NULL) AS locked, sum(f.amount) AS amount
       FROM order_fees f JOIN orders o ON o.store_id = f.store_id AND o.id = f.order_id WHERE f.store_id = ? AND f.local_date BETWEEN ? AND ? AND ${CANONICAL} GROUP BY 1, 2, 3`,
    )
    .all(storeId, from, to)) {
    const x = fx(String(r.day), r.cur, r.locked, 0);
    if (x != null) fees += Number(r.amount) * x;
  }
  for (const r of db
    .prepare(
      `SELECT o.local_date AS day, o.currency AS cur, o.fx_rate AS locked, o.breakdown_at IS NOT NULL AS parts, o.channel, o.gross_sales AS gross, o.discounts, o.shipping, o.tax, o.total
       FROM orders o WHERE o.store_id = ? AND o.local_date BETWEEN ? AND ? AND ${CANONICAL} AND NOT EXISTS (SELECT 1 FROM order_fees f WHERE f.store_id = o.store_id AND f.order_id = o.id)`,
    )
    .all(storeId, from, to)) {
    estimatedOrders++;
    // An order synced before money parts: its current total (tax, shipping, net of refunds) in the store's currency.
    const x = r.parts ? fx(String(r.day), r.cur, r.locked, 0) : 1;
    if (x == null) continue;
    const sales = (Number(r.gross ?? 0) - Number(r.discounts ?? 0)) * x;
    const charged = r.parts ? sales + (Number(r.shipping ?? 0) + Number(r.tax ?? 0)) * x : Number(r.total);
    fees += r.channel === 'amazon' ? AMAZON_REFERRAL * sales : (Number(store.pct) / 100) * charged + Number(store.per);
  }

  const fxStatus: SaValue['status'] = unconverted.size ? 'partial' : 'ok';
  const fxNote = note();
  const join = (...n: (string | undefined)[]) => (n.some(Boolean) ? { note: n.filter(Boolean).join('. ') } : {});
  const feeNote = estimatedOrders ? `Estimate for ${estimatedOrders} order${estimatedOrders === 1 ? '' : 's'}: ${Number(store.pct)}% of the amount charged + ${Number(store.per)} an order (Amazon: ${AMAZON_REFERRAL * 100}% of its sales)` : undefined;
  const feeValue = value(cents(fees), combineStatus(fxStatus, estimatedOrders ? 'estimated' : 'ok'), join(feeNote, fxNote));
  const share = ratio(costedUnits, units);
  const coverage = share == null ? {} : { coverage: { share, of: 'units with a unit cost' } };
  const fallbackNote = fallback ? `${fallback} unit${fallback === 1 ? '' : 's'} from orders synced before order lines` : undefined;
  const status = combineStatus(fxStatus, fallback ? 'estimated' : 'ok');

  return {
    fees: feeValue,
    cost_coverage: share == null ? value(null, 'unavailable', { note: 'No units sold in this period' }) : value(share, status, join(fallbackNote)),
    // No costed line and no costed refund: nothing to compute from, unavailable rather than 0 (or −fees).
    contribution_before_ads:
      !costedUnits && !costedRefunds && (units || fees)
        ? value(null, 'unavailable', { reason: 'not_tracked', note: 'None of the units sold have a unit cost', ...coverage })
        : value(cents(costedSales - cost - fees), combineStatus(status, feeValue.status, share != null && share < 1 ? 'partial' : 'ok'), { ...coverage, ...join(fallbackNote, feeNote, fxNote) }),
  };
}
