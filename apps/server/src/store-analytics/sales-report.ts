// SA-95 (spec §8 Sales and order performance): the net sales bridge (gross → discounts → refunds → net) with tax and
// shipping shown apart, and the sales metrics by day, week or month. Its totals are /metrics' for the same scope.
import { combineStatus, SA_SALES_REPORT, type SaFilters, type SaSalesGrain, type SaSalesReport, type SaSalesRow, type SaValue } from '@frontline/shared';
import { addDays } from '../dates';
import type { Db } from '../db';
import { demoParts } from '../demo';
import { storeConverter } from './fx';
import { computeMetricSet, setup } from './metric-set';
import type { StorePeriod } from './period';
import type { Scope } from './routes';
import { CANONICAL, demoDays, salesMetrics, sliceSql, unread, type RefundBasis, type Slice } from './sales';

/** The grain's rows over [from, to]: days; weeks from the first day (the trend chart's); calendar months; clipped. */
export function buckets(from: string, to: string, grain: SaSalesGrain) {
  const out: { from: string; to: string }[] = [];
  for (let a = from; a <= to; ) {
    const [y, m] = a.split('-').map(Number) as [number, number];
    const end = grain === 'day' ? a : grain === 'week' ? addDays(a, 6) : addDays(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`, -1);
    const b = end < to ? end : to;
    out.push({ from: a, to: b });
    a = addDays(b, 1);
  }
  return out;
}

const cents = (n: number) => Math.round(n * 100) / 100;

/** Tax and shipping charged on the orders placed in [from, to], before refunds, from their money parts. */
function apart(db: Db, storeId: string, from: string, to: string, slice: Slice, demo: boolean): { tax: SaValue; shipping: SaValue } {
  const both = (v: SaValue) => ({ tax: v, shipping: v });
  if (demo) {
    const days = demoDays(db, storeId, from, to);
    if (!days.length) return both({ value: null, status: 'unavailable', reason: 'insufficient_history', note: 'Before the demo history' });
    const parts = days.map((d) => demoParts(storeId, d.date, d.revenue));
    return { tax: { value: cents(parts.reduce((s, p) => s + p.tax, 0)), status: 'demo' }, shipping: { value: cents(parts.reduce((s, p) => s + p.shipping, 0)), status: 'demo' } };
  }
  if (slice.products) return both({ value: null, status: 'unavailable', note: 'Order level: not split by product' });
  const none = unread(db, storeId);
  if (none) return both(none);
  const { fx, unconverted, note } = storeConverter(db, String(db.prepare('SELECT currency FROM stores WHERE id = ?').get(storeId)!.currency));
  const w = sliceSql(db, storeId, slice, to);
  let [orders, withParts, tax, shipping] = [0, 0, 0, 0];
  for (const r of db
    .prepare(
      `SELECT o.local_date AS day, o.currency AS cur, o.fx_rate AS locked, o.breakdown_at IS NOT NULL AS parts, count(*) AS n, sum(o.tax) AS tax, sum(coalesce(o.shipping, 0)) AS ship
       FROM orders o WHERE o.store_id = ? AND o.local_date BETWEEN ? AND ? AND ${CANONICAL}${w.sql} GROUP BY 1, 2, 3, 4`,
    )
    .all(storeId, from, to, ...w.params)) {
    orders += Number(r.n);
    if (!r.parts) continue;
    withParts += Number(r.n);
    const x = fx(String(r.day), r.cur, r.locked, Number(r.n));
    if (x == null) continue;
    tax += Number(r.tax) * x;
    shipping += Number(r.ship) * x;
  }
  if (orders && !withParts) return both({ value: null, status: 'unavailable', reason: 'needs_ingestion', note: 'These orders were synced before money parts were recorded' });
  const share = orders ? withParts / orders : 1;
  const extra = { ...(share < 1 && { coverage: { share, of: 'orders with money parts' } }), ...(note() && { note: note() }) };
  const status = combineStatus(unconverted.size ? 'partial' : 'ok', share < 1 ? 'partial' : 'ok');
  return { tax: { value: cents(tax), status, ...extra }, shipping: { value: cents(shipping), status, ...extra } };
}

export function salesReport(db: Db, scope: Scope, sp: StorePeriod, filters: SaFilters, basis: RefundBasis, grain: SaSalesGrain): SaSalesReport {
  const set = computeMetricSet(db, scope, [...SA_SALES_REPORT], sp, filters, basis);
  const { demo, slice } = setup(db, scope.storeId, sp, filters);
  // ponytail: each row is its own computation (as the series' points are); one grouped pass when the scale run asks
  const rows = buckets(sp.period.from, sp.period.to, grain).map((b): SaSalesRow => {
    const v = salesMetrics(db, scope.storeId, b.from, b.to, basis, slice);
    const values = Object.fromEntries(SA_SALES_REPORT.map((id) => [id, { value: v[id].value, status: v[id].status }])) as SaSalesRow['values'];
    return { ...b, ...(sp.period.partial && b.to === sp.period.to && { partial: true as const }), values };
  });
  return { ...set, grain, ...apart(db, scope.storeId, sp.period.from, sp.period.to, slice, demo), rows };
}
