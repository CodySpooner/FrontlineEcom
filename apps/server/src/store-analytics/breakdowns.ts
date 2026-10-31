// SA-96 (spec §8 Sales and order performance): net sales and units by channel, product, collection or country. The
// rows add up to /metrics' totals for the scope; what they can't place is an Unknown row. A product in several
// collections counts in each (`overlap`). Channels and countries are each the sales metrics with that slice; products
// and collections come from one per-product pass (`totals`, the Listings tab's).
import type { SaBreakdownBy, SaBreakdownRow, SaFilters, SaReason, SaSalesBreakdown } from '@frontline/shared';
import type { Db } from '../db';
import { totals } from './listings';
import { computeMetricSet, setup } from './metric-set';
import { channelsIn } from './overview';
import type { StorePeriod } from './period';
import type { Scope } from './routes';
import { CANONICAL, salesMetrics, sliceSql, type RefundBasis } from './sales';

const cents = (n: number) => Math.round(n * 100) / 100;

/** Why no order has a country: Shopify's last probe of it was denied (SA-32), else nothing reads one. */
function countryReason(db: Db, storeId: string): { reason: SaReason; note: string } {
  const last = db.prepare('SELECT ref FROM done_once WHERE ref GLOB ? ORDER BY ref DESC LIMIT 1').get(`sa-probe:shopify:${storeId}:country:*`)?.ref;
  return String(last ?? '').endsWith(':denied')
    ? { reason: 'needs_permission', note: "Shopify hasn't allowed reading the orders' shipping country (protected customer data)" }
    : { reason: 'not_tracked', note: "This store's orders don't record a country" };
}

export function salesBreakdown(db: Db, scope: Scope, sp: StorePeriod, filters: SaFilters, basis: RefundBasis, by: SaBreakdownBy, top = 50): SaSalesBreakdown {
  const set = computeMetricSet(db, scope, ['net_sales', 'units'], { ...sp, compare: undefined }, filters, basis);
  const [net, units] = set.metrics as [SaSalesBreakdown['total']['net_sales'], SaSalesBreakdown['total']['units']];
  const base = { by, period: sp.period, total: { net_sales: net, units }, scope: set.scope };
  const none = (note?: string, reason?: SaReason): SaSalesBreakdown => ({ ...base, rows: [], ...(reason && { reason }), ...(note && { note }) });
  const { demo, collections, slice } = setup(db, scope.storeId, sp, filters);
  if (demo) return none(`Demo data isn't split by ${by}`);
  if (net.value == null) return none();
  const { storeId } = scope;
  const { from, to } = sp.period;

  // `parts`: the rows that partition the total (products under collections), for the Unknown row
  let rows: SaBreakdownRow[];
  let parts: SaBreakdownRow[];
  let overlap = false;
  if (by === 'channel' || by === 'country') {
    const w = sliceSql(db, storeId, slice, to);
    const ids =
      by === 'channel'
        ? channelsIn(db, storeId, from, to, filters)
        : db.prepare(`SELECT DISTINCT o.country AS c FROM orders o WHERE o.store_id = ? AND o.local_date BETWEEN ? AND ? AND o.country IS NOT NULL AND ${CANONICAL}${w.sql}`).all(storeId, from, to, ...w.params).map((r) => String(r.c));
    if (by === 'country' && !ids.length) {
      const why = countryReason(db, storeId);
      return none(why.note, why.reason);
    }
    // ponytail: one sales computation per channel or country (the Overview's channel split does the same)
    rows = parts = ids.map((id) => {
      const v = salesMetrics(db, storeId, from, to, basis, { ...slice, [by === 'channel' ? 'channels' : 'countries']: [id] });
      return { id, label: id, net_sales: v.net_sales.value, units: v.units.value };
    });
  } else {
    const titles = new Map(db.prepare('SELECT id, title FROM products WHERE store_id = ?').all(storeId).map((r) => [String(r.id), String(r.title)]));
    parts = [...totals(db, storeId, from, to, basis, slice)].map(([id, t]) => ({ id, label: titles.get(id) ?? id, net_sales: cents(t.net_sales), units: t.units }));
    if (by === 'product') rows = parts;
    else {
      if (!collections) return none("Collections aren't synced for this store yet", 'needs_ingestion');
      const groups = new Map<string, { title: string; products: Set<string> }>();
      const memberOf = new Map<string, number>();
      for (const r of db.prepare('SELECT collection_id AS c, product_id AS p, title FROM product_collections WHERE store_id = ?').all(storeId)) {
        const g = groups.get(String(r.c)) ?? groups.set(String(r.c), { title: String(r.title ?? r.c), products: new Set() }).get(String(r.c))!;
        g.products.add(String(r.p));
        memberOf.set(String(r.p), (memberOf.get(String(r.p)) ?? 0) + 1);
      }
      const sum = (ps: SaBreakdownRow[]) => ({ net_sales: cents(ps.reduce((s, p) => s + (p.net_sales ?? 0), 0)), units: ps.reduce((s, p) => s + (p.units ?? 0), 0) });
      rows = [...groups].map(([id, g]) => ({ id, label: g.title, ...sum(parts.filter((p) => g.products.has(p.id!))) })).filter((r) => r.net_sales || r.units);
      const outside = parts.filter((p) => !memberOf.has(p.id!));
      if (outside.length) rows.push({ id: null, label: 'Not in a collection', kind: 'none', ...sum(outside) });
      overlap = parts.some((p) => (memberOf.get(p.id!) ?? 0) > 1);
    }
  }

  rows.sort((a, b) => (b.net_sales ?? 0) - (a.net_sales ?? 0) || a.label.localeCompare(b.label));
  const out = rows.slice(0, top);
  const rest = rows.slice(top);
  if (rest.length) out.push({ id: null, label: `${rest.length} more`, kind: 'more', net_sales: cents(rest.reduce((s, r) => s + (r.net_sales ?? 0), 0)), units: rest.reduce((s, r) => s + (r.units ?? 0), 0) });
  const gap = cents(net.value - parts.reduce((s, r) => s + (r.net_sales ?? 0), 0));
  const unitGap = (units.value ?? 0) - parts.reduce((s, r) => s + (r.units ?? 0), 0);
  if (gap || unitGap) out.push({ id: null, label: 'Unknown', kind: 'unknown', net_sales: gap, units: unitGap });
  return { ...base, rows: out, ...(overlap && { overlap: true as const }) };
}
