// SA-97 (spec §6 Drilldown behavior): the orders behind the period's net sales, by `salesMetrics`' rules, so their
// `net` adds up to it: each paid order placed in the period (a duplicate copy listed, adding nothing) and each order with
// a merchandise refund counted in it (by the refunds basis). No customer data is read.
import type { SaFilters, SaOrderRow, SaOrders } from '@frontline/shared';
import type { Db } from '../db';
import { storeConverter } from './fx';
import { computeMetricSet, setup } from './metric-set';
import type { StorePeriod } from './period';
import type { Scope } from './routes';
import { CANONICAL, inProducts, PAID, sliceSql, type RefundBasis } from './sales';

export const ORDERS_PAGE = 50;
const cents = (n: number) => Math.round(n * 100) / 100;

export function orderRecords(db: Db, scope: Scope, sp: StorePeriod, filters: SaFilters, basis: RefundBasis, page: number, pageSize = ORDERS_PAGE): SaOrders {
  const set = computeMetricSet(db, scope, ['net_sales'], { ...sp, compare: undefined }, filters, basis);
  const base = { period: sp.period, total: set.metrics[0]!, page, pageSize, scope: set.scope };
  const { demo, slice } = setup(db, scope.storeId, sp, filters);
  if (demo) return { ...base, count: 0, rows: [], note: 'Demo data has no order records' };
  const { storeId } = scope;
  const { from, to } = sp.period;
  const store = db.prepare('SELECT platform, currency FROM stores WHERE id = ?').get(storeId)!;
  const own = store.platform === 'shopify' || store.platform === 'woocommerce' ? 'site' : String(store.platform);
  const { fx } = storeConverter(db, String(store.currency));
  const products = !!slice.products;
  const [pl, pi, pr] = [inProducts(slice, 'l.product_id'), inProducts(slice, 'i.product_id'), inProducts(slice, 'r.product_id')];
  const lines = (col: string) => `(SELECT sum(${col}) FROM order_lines l WHERE l.store_id = o.store_id AND l.order_id = o.id${pl.sql})`;
  const cols = `o.id, o.local_date AS day, coalesce(o.channel, iif(+o.id GLOB 'tt-*', 'tiktok_shop', ?)) AS ch, o.status, coalesce(o.currency, ?) AS cur, o.fx_rate AS locked,
    o.breakdown_at IS NOT NULL AS parts, o.duplicate_of AS dup`;
  const rows = new Map<string, SaOrderRow>();
  const row = (r: Record<string, unknown>, placed: boolean): SaOrderRow => ({
    id: String(r.id), date: String(r.day), channel: String(r.ch), status: String(r.status), currency: String(r.cur), placed, estimated: !r.parts,
    gross: null, discounts: null, tax: null, shipping: null, refunds: null, net: null, duplicateOf: r.dup == null ? null : String(r.dup),
  });

  // Placed in the period: lines' money with a product set, else the order's; one without money parts, its estimate
  // (total less tax, or its matching per-product rows), already in the store's currency.
  const w = sliceSql(db, storeId, slice, to);
  for (const r of db
    .prepare(
      `SELECT ${cols}, ${products ? lines('l.gross') : 'o.gross_sales'} AS gross, ${products ? lines('coalesce(l.discount, 0)') : 'o.discounts'} AS disc, o.tax, o.shipping,
         ${products ? `(SELECT sum(i.revenue) FROM order_items i WHERE i.store_id = o.store_id AND i.order_id = o.id${pi.sql})` : 'o.total - o.tax - coalesce((SELECT sum(r.amount) FROM amazon_refunds r WHERE r.store_id = o.store_id AND r.order_id = o.id), 0)'} AS est
       FROM orders o WHERE o.store_id = ? AND o.local_date BETWEEN ? AND ? AND ${PAID}${w.sql}`,
    )
    .all(own, String(store.currency), ...(products ? [...pl.params, ...pl.params, ...pi.params] : []), storeId, from, to, ...w.params)) {
    const x = r.parts ? fx(String(r.day), r.cur, r.locked, 0) : 1;
    const money = (v: unknown) => (v == null || x == null ? null : cents(Number(v ?? 0) * x));
    const o = row(r, true);
    o.gross = r.parts ? money(r.gross ?? 0) : cents(Number(r.est ?? 0));
    o.discounts = r.parts ? money(r.disc ?? 0) : null;
    if (!products) [o.tax, o.shipping] = [money(r.tax), r.parts ? money(r.shipping ?? 0) : null];
    rows.set(o.id, o);
  }

  // Merchandise refunds counted in the period, each at its own day's rate; an order placed before it joins the rows.
  const dayCol = basis === 'order_day' ? 'o.local_date' : 'r.local_date';
  const wr = sliceSql(db, storeId, slice, to, dayCol, basis === 'order_day' ? 'o.created_at' : 'r.refunded_at');
  for (const r of db
    .prepare(
      `SELECT ${cols}, r.local_date AS refunded, sum(r.merchandise) AS merch FROM refunds r JOIN orders o ON o.store_id = r.store_id AND o.id = r.order_id
       WHERE r.store_id = ? AND ${dayCol} BETWEEN ? AND ? AND o.breakdown_at IS NOT NULL AND ${CANONICAL}${wr.sql}${pr.sql} GROUP BY o.id, r.local_date`,
    )
    .all(own, String(store.currency), storeId, from, to, ...wr.params, ...pr.params)) {
    const rate = fx(String(r.refunded), r.cur, r.locked, 0);
    if (rate == null) continue;
    const o = rows.get(String(r.id)) ?? rows.set(String(r.id), row(r, false)).get(String(r.id))!;
    o.refunds = cents((o.refunds ?? 0) + Number(r.merch ?? 0) * rate);
  }

  for (const o of rows.values()) {
    if (o.duplicateOf) continue;
    const sales = o.placed ? (o.gross == null ? null : o.gross - (o.discounts ?? 0)) : 0;
    o.net = sales == null ? null : cents(sales - (o.refunds ?? 0));
  }
  // ponytail: every row is built to page it; a keyset query when the scale run asks
  const all = [...rows.values()].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  return { ...base, count: all.length, rows: all.slice((page - 1) * pageSize, page * pageSize) };
}
