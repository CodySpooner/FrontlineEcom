// SA-24: reconcile v1 net sales against the legacy revenue Dashboard shows, line by line (spec §9 Reconciliation).
import type { SaReconcile, SaReconcileLine } from '@frontline/shared';
import type { Db } from '../db';
import { dedupeSummary } from './dedupe';
import { storeConverter } from './fx';
import { CANONICAL, salesMetrics, type RefundBasis } from './sales';

const cents = (n: number) => Math.round(n * 100) / 100 + 0; // + 0: no -0

/**
 * Decision 9: an order's as-placed parts less every refund line make its platform's current total, to the cent.
 * All in one currency. A platform whose totals aren't net of refunds (TikTok Shop) passes against its total less the
 * refund lines legacy takes off.
 */
export function checkOrderIdentity(o: { gross: number; discounts: number; shipping: number; tax: number; refunds: number; total: number }, tolerance = 0.01) {
  const expected = o.gross - o.discounts + o.shipping + o.tax - o.refunds;
  const diff = cents(expected - o.total);
  return { ok: Math.abs(diff) <= tolerance, expected: cents(expected), diff };
}

/**
 * From Dashboard's revenue (current order totals: tax, shipping and refunds to date in, refunded orders out) to v1 net
 * sales. Money parts and refund lines are in the order's currency, `total` and `tax` in the store's (as the legacy
 * columns always were). Orders failing the identity carry what the lines can't, listed by id.
 */
export function reconcile(db: Db, storeId: string, from: string, to: string, basis: RefundBasis = 'refund_day'): SaReconcile {
  const store = db.prepare('SELECT currency, demo FROM stores WHERE id = ?').get(storeId)!;
  const stored = cents(Number(db.prepare('SELECT coalesce(sum(revenue), 0) AS r FROM daily_metrics WHERE store_id = ? AND date BETWEEN ? AND ?').get(storeId, from, to)!.r));
  const net = salesMetrics(db, storeId, from, to, basis).net_sales;
  if (store.demo) return { from, to, legacy: stored, net_sales: net, lines: [], info: [{ key: 'demo', label: 'Demo data: net sales are the demo revenue split into its parts', amount: 0, count: 0 }], unexplained: cents((net.value ?? 0) - stored) };
  const { fx } = storeConverter(db, String(store.currency));

  const lines = new Map<string, SaReconcileLine>();
  const add = (key: string, label: string, amount: number, id?: string) => {
    const l = lines.get(key) ?? { key, label, amount: 0, count: 0 };
    l.amount += amount;
    l.count++;
    if (id && key === 'identity') l.ids = [...(l.ids ?? []), id];
    lines.set(key, l);
  };
  const info = new Map<string, SaReconcileLine>();
  const note = (key: string, label: string, amount: number) => {
    const l = info.get(key) ?? { key, label, amount: 0, count: 0 };
    l.amount += amount;
    l.count++;
    info.set(key, l);
  };

  let recomputed = 0;
  for (const o of db
    .prepare(
      `SELECT o.id, o.local_date AS day, o.currency AS cur, o.fx_rate AS locked, o.breakdown_at IS NOT NULL AS parts, o.status, o.duplicate_of AS dup, o.total, o.tax,
         o.gross_sales AS gross, o.discounts AS disc, o.shipping AS ship,
         o.status = 'paid' AND o.duplicate_of IS NULL AND NOT o.id GLOB 'amz-*' AS legacy, ${CANONICAL} AS v1,
         (SELECT coalesce(sum(coalesce(r.merchandise, 0) + coalesce(r.shipping, 0) + coalesce(r.tax, 0) + coalesce(r.other, 0)), 0) FROM refunds r WHERE r.store_id = o.store_id AND r.order_id = o.id) AS refunded,
         (SELECT coalesce(sum(a.amount), 0) FROM amazon_refunds a WHERE a.store_id = o.store_id AND a.order_id = o.id) AS amzAmount,
         (SELECT coalesce(sum(a.tax), 0) FROM amazon_refunds a WHERE a.store_id = o.store_id AND a.order_id = o.id) AS amzTax
       FROM orders o WHERE o.store_id = ? AND o.local_date BETWEEN ? AND ? ORDER BY o.local_date, o.id`,
    )
    .all(storeId, from, to)) {
    const [total, tax, amz] = [Number(o.total), Number(o.tax ?? 0), Number(o.amzAmount) + Number(o.amzTax)];
    const legacy = o.legacy ? total - amz : 0;
    recomputed += legacy;
    if (o.dup != null) note('duplicates', 'Channel copies of an order, left out of both', total);
    else if (!o.legacy && !o.v1 && o.status !== 'refunded') note('excluded', 'Test, unpaid or voided orders, left out of both', total);
    if (!o.legacy && !o.v1) continue;
    if (!o.parts) {
      // Synced before money parts: v1 estimates total − tax − its refund lines; legacy also took the refund lines' tax off.
      if (o.legacy && o.v1) add('estimates', 'Orders synced before money parts (v1 estimate): their tax', -tax + Number(o.amzTax));
      else if (o.v1) add('v1_only', 'Orders v1 counts that legacy leaves out', total - tax - Number(o.amzAmount));
      else add('legacy_only', 'Orders legacy counts as paid that v1 leaves out (no paid time)', -legacy);
      continue;
    }
    const x = fx(String(o.day), o.cur, o.locked, 1);
    if (x == null) {
      if (o.legacy) add('fx', 'Left out of v1, no exchange rate for their day', -legacy);
      continue;
    }
    const [gross, disc, ship] = [Number(o.gross ?? 0), Number(o.disc ?? 0), Number(o.ship ?? 0)];
    if (!o.legacy) {
      add(String(o.id).startsWith('amz-') ? 'amazon_orders' : 'refunded_orders', String(o.id).startsWith('amz-') ? "Amazon orders (legacy uses Amazon's daily totals)" : 'Paid orders since refunded or cancelled (legacy drops them)', (gross - disc) * x);
      continue;
    }
    if (!o.v1) {
      add('legacy_only', 'Orders legacy counts as paid that v1 leaves out (no paid time)', -legacy);
      continue;
    }
    if (tax) add('tax', 'Tax in current totals', -tax);
    if (ship) add('shipping', 'Shipping in current totals', -ship * x);
    // TikTok Shop's totals aren't net of refunds: legacy takes its refund lines off instead, so they aren't netted twice.
    const notNet = String(o.id).startsWith('tt-');
    if (Number(o.refunded) && !notNet) add('refunds_netted', 'Refunds already taken off current totals (v1 dates them instead)', Number(o.refunded) * x);
    if (amz) add('legacy_refund_lines', 'Refund lines legacy took off (TikTok Shop, Amazon)', amz);
    const id = checkOrderIdentity({ gross: gross * x, discounts: disc * x, shipping: ship * x, tax, refunds: Number(o.refunded) * x, total: notNet ? total - amz : total });
    if (!id.ok) add('identity', 'Orders failing the identity (parts − refunds ≠ current total)', id.diff, String(o.id));
  }
  const channel = db.prepare('SELECT coalesce(sum(revenue), 0) AS r, coalesce(sum(orders), 0) AS n FROM channel_daily WHERE store_id = ? AND date BETWEEN ? AND ?').get(storeId, from, to)!;
  recomputed += Number(channel.r);
  if (Number(channel.n) || Number(channel.r)) lines.set('channel_daily', { key: 'channel_daily', label: "Amazon's daily totals (v1 counts its orders instead)", amount: -Number(channel.r), count: Number(channel.n) });

  // v1's refunds: merchandise refund lines dated in the period (or on their order's day), at each order's rate.
  const dayCol = basis === 'order_day' ? 'o.local_date' : 'r.local_date';
  for (const r of db
    .prepare(
      `SELECT r.local_date AS day, o.currency AS cur, o.fx_rate AS locked, r.merchandise AS merch FROM refunds r JOIN orders o ON o.store_id = r.store_id AND o.id = r.order_id
       WHERE r.store_id = ? AND ${dayCol} BETWEEN ? AND ? AND r.merchandise IS NOT NULL AND o.breakdown_at IS NOT NULL AND ${CANONICAL}`,
    )
    .all(storeId, from, to)) {
    const x = fx(String(r.day), r.cur, r.locked, 0);
    if (x != null) add('refunds', basis === 'order_day' ? "Merchandise refunds of the period's orders" : 'Merchandise refunds dated in the period', -Number(r.merch) * x);
  }
  for (const r of db.prepare('SELECT merchandise AS m FROM refunds r WHERE r.store_id = ? AND r.local_date BETWEEN ? AND ? AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.store_id = r.store_id AND o.id = r.order_id)').all(storeId, from, to))
    note('waiting', 'Refunds waiting for their order to sync, counted nowhere yet', Number(r.m ?? 0));

  const stale = cents(recomputed - stored);
  const all = [...(Math.abs(stale) >= 0.01 ? [{ key: 'stale', label: "Dashboard's stored daily totals predate the latest sync", amount: stale, count: 0 }] : []), ...lines.values()].map((l) => ({ ...l, amount: cents(l.amount) }));
  const bridged = stored + all.reduce((a, l) => a + l.amount, 0);
  return {
    from, to, legacy: stored, net_sales: net, lines: all, info: [...info.values()].map((l) => ({ ...l, amount: cents(l.amount) })), unexplained: cents((net.value ?? 0) - bridged),
    dedupe: dedupeSummary(db, storeId, from, to),
  };
}
