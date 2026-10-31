// SA-73: What moved net sales (spec §6, §10). Each product's change between the period and its comparison, over the
// KPI's own slice and last-day cut; the top four up and two down, the rest combined, and what no product line carries
// (order-level discounts and refunds, orders without money parts, rounding), so the rows add up to the KPI's change.
import { SA_SOURCES, type SaFilters, type SaMoved, type SaMovedRow, type SaSourceKind } from '@frontline/shared';
import type { Db } from '../db';
import { demoShares, totals } from './listings';
import { computeMetricSet, setup } from './metric-set';
import type { StorePeriod } from './period';
import type { Scope } from './routes';
import { CANONICAL, type RefundBasis } from './sales';

const [UP, DOWN] = [4, 2];
const round2 = (n: number) => Math.round(n * 100) / 100;

export function contributions(db: Db, scope: Scope, sp: StorePeriod, filters: SaFilters = {}, basis: RefundBasis = 'refund_day'): SaMoved {
  const set = computeMetricSet(db, scope, ['net_sales'], sp, filters, basis);
  const net = set.metrics[0]!;
  const { demo, slice, compare, cut } = setup(db, scope.storeId, sp, filters);
  if (!compare) return { change: null, note: 'No comparison period', rows: [], scope: set.scope };
  if (net.value == null || net.previous?.value == null) return { change: null, note: "Net sales aren't available for both periods", rows: [], scope: set.scope };
  const change = round2(net.value - net.previous.value);
  const store = db.prepare('SELECT currency, platform FROM stores WHERE id = ?').get(scope.storeId)!;
  const prevSlice = { ...slice, ...(cut && { cut }) };

  // Each product's change, unrounded, and whether it sold nothing in the comparison. A demo store's products share its
  // sales by fixed weights.
  type Move = { change: number; new: boolean };
  const moved = new Map<string, Move>();
  if (demo) for (const [id, k] of demoShares(db, scope.storeId)) moved.set(id, { change: k * (net.value - net.previous.value), new: !net.previous.value });
  else {
    const cur = totals(db, scope.storeId, sp.period.from, sp.period.to, basis, slice);
    const prev = totals(db, scope.storeId, compare.from, compare.to, basis, prevSlice);
    for (const id of new Set([...cur.keys(), ...prev.keys()])) {
      if (slice.products && !slice.products.includes(id)) continue; // a filtered order's other products
      const p = prev.get(id);
      moved.set(id, { change: (cur.get(id)?.net_sales ?? 0) - (p?.net_sales ?? 0), new: !p?.units && !p?.net_sales });
    }
  }

  const all = [...moved].filter(([, m]) => m.change !== 0);
  const ups = all.filter(([, m]) => m.change > 0).sort((a, b) => b[1].change - a[1].change).slice(0, UP);
  const downs = all.filter(([, m]) => m.change < 0).sort((a, b) => a[1].change - b[1].change).slice(0, DOWN);
  const top = new Set([...ups, ...downs].map(([id]) => id));
  const rest = all.filter(([id]) => !top.has(id)).length;
  let unattributed = round2(change - all.reduce((a, [, m]) => a + m.change, 0));
  let others = round2(change - [...ups, ...downs].reduce((a, [, m]) => a + round2(m.change), 0) - unattributed); // the top rows' rounding
  if (!rest) [unattributed, others] = [round2(unattributed + others), 0];

  const split = demo ? undefined : channelSplit(db, scope.storeId, sp, compare, slice, prevSlice, basis, String(store.platform), [...top]);
  const money = (v: number) => (v < 0 ? '−' : '+') + new Intl.NumberFormat('en-US', { style: 'currency', currency: String(store.currency), maximumFractionDigits: 0 }).format(Math.abs(v));
  const info = db.prepare(
    `SELECT p.title, p.image, iif(p.inventory_tracked, p.inventory, NULL) AS stock,
       (SELECT count(*) FROM product_variants v WHERE v.store_id = p.store_id AND v.product_id = p.id) AS variants,
       (SELECT group_concat(coalesce(v.title, v.sku, v.id), ', ') FROM product_variants v WHERE v.store_id = p.store_id AND v.product_id = p.id AND v.inventory_tracked AND v.inventory <= 0) AS out
     FROM products p WHERE p.store_id = ? AND p.id = ?`,
  );
  const row = ([id, m]: [string, Move]): SaMovedRow => {
    const p = info.get(scope.storeId, id);
    const variants = Number(p?.variants ?? 0);
    const parts = split?.get(id)?.filter((c) => round2(c.change) !== 0);
    const note =
      parts && parts.length > 1 ? parts.map((c) => `${c.label} ${money(c.change)}`).join(' · ')
      : p?.out != null ? (variants > 1 ? `${p.out} out of stock` : 'Out of stock')
      : p?.stock != null ? `${p.stock} left in stock`
      : variants > 1 ? `${variants} variants`
      : undefined;
    return { kind: 'product', id, title: p ? String(p.title) : `Product ${id}`, image: p?.image == null ? null : String(p.image), change: round2(m.change), ...(note && { note }), ...(m.new && { new: true as const }) };
  };
  const rows: SaMovedRow[] = [
    ...ups.map(row),
    ...(rest ? [{ kind: 'others' as const, title: `${rest} other product${rest > 1 ? 's' : ''}`, note: 'combined', change: others }] : []),
    ...(unattributed ? [{ kind: 'unattributed' as const, title: 'Not on a product line', note: 'Order-level amounts and rounding', change: unattributed }] : []),
    ...downs.reverse().map(row),
  ];
  return { change, rows, scope: set.scope };
}

/** The top products' change per sales channel, when the period and comparison have orders on more than one. */
function channelSplit(db: Db, storeId: string, sp: StorePeriod, compare: { from: string; to: string }, slice: ReturnType<typeof setup>['slice'], prevSlice: typeof slice, basis: RefundBasis, platform: string, ids: string[]) {
  const own = platform === 'shopify' || platform === 'woocommerce' ? 'site' : platform;
  const channels =
    slice.channels ??
    db
      .prepare(`SELECT DISTINCT coalesce(o.channel, iif(+o.id GLOB 'tt-*', 'tiktok_shop', ?)) AS ch FROM orders o WHERE o.store_id = ? AND (o.local_date BETWEEN ? AND ? OR o.local_date BETWEEN ? AND ?) AND ${CANONICAL}`)
      .all(own, storeId, sp.period.from, sp.period.to, compare.from, compare.to)
      .map((r) => String(r.ch));
  if (channels.length < 2) return undefined;
  const out = new Map(ids.map((id) => [id, [] as { label: string; change: number }[]]));
  for (const ch of channels) {
    const cur = totals(db, storeId, sp.period.from, sp.period.to, basis, { ...slice, channels: [ch] });
    const prev = totals(db, storeId, compare.from, compare.to, basis, { ...prevSlice, channels: [ch] });
    const label = ch === 'site' ? 'site' : (SA_SOURCES[ch as SaSourceKind]?.name ?? ch);
    for (const id of ids) out.get(id)!.push({ label, change: (cur.get(id)?.net_sales ?? 0) - (prev.get(id)?.net_sales ?? 0) });
  }
  for (const parts of out.values()) parts.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  return out;
}
