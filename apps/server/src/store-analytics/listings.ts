// SA-66: the Listings tab (spec §7 Listings table): every product of one store matching the status, search and filters,
// sorted over the whole matching set and paged at 25 (decision 38). A row's state is current; its sales are the period's,
// from the v1 functions narrowed to that product.
import type { SQLInputValue } from 'node:sqlite';
import { SA_LISTING_FILTERS, SA_LISTING_SORTS, SA_LISTING_STATUSES, type SaFilterScope, type SaMetricId, type SaFilters, type SaListingRow, type SaListings, type SaListingSort, type SaListingStatus, type SaStockState, type SaValue, type SaVariants } from '@frontline/shared';
import { addDays } from '../dates';
import type { Db } from '../db';
import { hash, mulberry32 } from '../demo';
import { costMetrics } from './costs';
import { storeConverter } from './fx';
import { setup } from './metric-set';
import type { StorePeriod } from './period';
import { CANONICAL, salesMetrics, sliceSql, type RefundBasis, type Slice } from './sales';

export const PAGE_SIZE = 25;
/** The metrics a listing row carries; their definitions go with an export (SA-85) and a comparison (SA-86). */
export const LISTING_METRICS: SaMetricId[] = ['units', 'net_sales', 'refunds', 'refund_rate', 'contribution_before_ads', 'cost_coverage'];

/** Whether every one of `ids` (distinct) is a product of the store. */
export const inStore = (db: Db, storeId: string, ids: string[]) =>
  Number(db.prepare('SELECT count(*) AS n FROM products WHERE store_id = ? AND id IN (SELECT value FROM json_each(?))').get(storeId, JSON.stringify(ids))!.n) === ids.length;
const METRIC_SORTS = new Set<SaListingSort>(['units', 'net_sales', 'refunds']);

type Query = { status?: string; q?: string; sort?: string; page?: string } & { [K in keyof typeof SA_LISTING_FILTERS]?: string };

/** SA-74: stock cover under this many days is low, at the sales rate of the last `COVER_WINDOW` full days… */
export const COVER_DAYS = 10;
export const COVER_WINDOW = 14;
/** …once that window sold this many units; below it there is no rate to judge by. */
export const COVER_MIN_UNITS = 5;

/** Each product's units over the `COVER_WINDOW` full days before `today`; a demo store's by its fixed shares. */
export function coverUnits(db: Db, storeId: string, today: string, demo: boolean) {
  const [from, to] = [addDays(today, -COVER_WINDOW), addDays(today, -1)];
  if (!demo) return new Map([...totals(db, storeId, from, to, 'refund_day')].map(([id, t]) => [id, t.units]));
  const all = salesMetrics(db, storeId, from, to).units.value ?? 0;
  return new Map([...demoShares(db, storeId)].map(([id, k]) => [id, Math.round(all * k)]));
}

/** SA-81 (decision 27): an untracked product is supplier-managed when an order this many days back names a supplier. */
export const SUPPLIER_DAYS = 30;
const SUPPLIED = (via: string) =>
  `EXISTS (SELECT 1 FROM ${via} x JOIN orders o ON o.store_id = x.store_id AND o.id = x.order_id WHERE x.store_id = p.store_id AND x.product_id = p.id AND o.supplier IS NOT NULL AND o.local_date >= ?)`;

/** SA-82: days of tracked stock left at the cover window's rate; none for FBA, untracked or out, or under `COVER_MIN_UNITS` sold. */
const coverOf = (p: Record<string, unknown>, sold: number) => (!p.fba && p.tracked && Number(p.inv) > 0 && sold >= COVER_MIN_UNITS ? Number(p.inv) / (sold / COVER_WINDOW) : undefined);

/** SA-80: a product's stock now. FBA stock is Amazon's, a supplier's is theirs, untracked stock has no count: none is judged. */
function stockState(p: Record<string, unknown>, sold: number): SaStockState {
  if (p.fba) return 'fba';
  if (p.supplier) return 'supplier';
  if (!p.tracked) return 'not_tracked';
  if (Number(p.inv) <= 0) return 'out';
  return (coverOf(p, sold) ?? Infinity) < COVER_DAYS ? 'low' : 'in_stock';
}

/** A product with no unit cost for itself, and none for one of its variants (or it has no variant rows). */
const MISSING_COST = `NOT EXISTS (SELECT 1 FROM unit_costs u WHERE u.store_id = p.store_id AND u.product_id = p.id AND u.variant_id IS NULL)
  AND (NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.store_id = p.store_id AND v.product_id = p.id)
    OR EXISTS (SELECT 1 FROM product_variants v WHERE v.store_id = p.store_id AND v.product_id = p.id
      AND NOT EXISTS (SELECT 1 FROM unit_costs u WHERE u.store_id = v.store_id AND u.product_id = v.product_id AND u.variant_id = v.id)))`;

/**
 * Each product's units, net sales and refunds over [from, to], grouped in three passes so a sort covers every product.
 * The same rules as `salesMetrics` with a one-product slice (listings.test.ts holds them equal): units from order lines,
 * else the order's per-product rows; money from lines of orders with money parts at their day's rate, else the per-product
 * rows; merchandise refunds of orders with money parts. A slice's cut stops the last day as `salesMetrics` does (SA-73).
 */
export function totals(db: Db, storeId: string, from: string, to: string, basis: RefundBasis, slice: Slice = {}) {
  const { fx } = storeConverter(db, String(db.prepare('SELECT currency FROM stores WHERE id = ?').get(storeId)!.currency));
  const t = new Map<string, Record<'units' | 'net_sales' | 'refunds', number>>();
  const of = (p: unknown) => t.get(String(p)) ?? t.set(String(p), { units: 0, net_sales: 0, refunds: 0 }).get(String(p))!;
  const w = sliceSql(db, storeId, slice, to);
  for (const r of db
    .prepare(
      `SELECT l.product_id AS p, o.local_date AS day, o.currency AS cur, o.fx_rate AS locked, o.breakdown_at IS NOT NULL AS parts, sum(l.quantity) AS q, sum(l.gross - coalesce(l.discount, 0)) AS sales
       FROM order_lines l JOIN orders o ON o.store_id = l.store_id AND o.id = l.order_id WHERE o.store_id = ? AND o.local_date BETWEEN ? AND ? AND ${CANONICAL}${w.sql} GROUP BY 1, 2, 3, 4, 5`,
    )
    .all(storeId, from, to, ...w.params)) {
    const x = of(r.p);
    x.units += Number(r.q);
    const rate = r.parts ? fx(String(r.day), r.cur, r.locked, 0) : null;
    if (rate != null) x.net_sales += Number(r.sales) * rate;
  }
  for (const r of db
    .prepare(
      `SELECT i.product_id AS p, o.breakdown_at IS NOT NULL AS parts, EXISTS (SELECT 1 FROM order_lines l WHERE l.store_id = o.store_id AND l.order_id = o.id) AS lined, sum(i.quantity) AS q, sum(i.revenue) AS rev
       FROM order_items i JOIN orders o ON o.store_id = i.store_id AND o.id = i.order_id WHERE o.store_id = ? AND o.local_date BETWEEN ? AND ? AND ${CANONICAL}${w.sql} GROUP BY 1, 2, 3`,
    )
    .all(storeId, from, to, ...w.params)) {
    const x = of(r.p);
    if (!r.lined) x.units += Number(r.q);
    if (!r.parts) x.net_sales += Number(r.rev);
  }
  const dayCol = basis === 'order_day' ? 'o.local_date' : 'r.local_date';
  const wr = sliceSql(db, storeId, slice, to, dayCol, basis === 'order_day' ? 'o.created_at' : 'r.refunded_at');
  for (const r of db
    .prepare(
      `SELECT r.product_id AS p, r.local_date AS day, o.currency AS cur, o.fx_rate AS locked, sum(r.merchandise) AS merch FROM refunds r JOIN orders o ON o.store_id = r.store_id AND o.id = r.order_id
       WHERE r.store_id = ? AND ${dayCol} BETWEEN ? AND ? AND r.product_id IS NOT NULL AND o.breakdown_at IS NOT NULL AND ${CANONICAL}${wr.sql} GROUP BY 1, 2, 3, 4`,
    )
    .all(storeId, from, to, ...wr.params)) {
    const rate = fx(String(r.day), r.cur, r.locked, 0);
    if (rate == null) continue;
    const x = of(r.p);
    x.refunds += Number(r.merch ?? 0) * rate;
    x.net_sales -= Number(r.merch ?? 0) * rate;
  }
  return t;
}

export type Sales = Record<'net_sales' | 'units' | 'refunds' | 'refund_rate' | 'contribution' | 'cost_coverage' | 'fees', SaValue>;
const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * SA-67 (decision 30): a demo store's period totals (`demoDay`'s parts, through the v1 functions) split across its active
 * products by Dashboard's fixed per-product weights (`demoTopProducts`), so the rows add up to the store's numbers and
 * don't move between loads. Every value is `demo`; a draft or archived product sold nothing.
 */
export function demoSplit(db: Db, storeId: string, from: string, to: string, basis: RefundBasis, slice: Slice = {}) {
  const s = salesMetrics(db, storeId, from, to, basis, slice);
  const c = costMetrics(db, storeId, from, to, basis, slice);
  const part = (k: number): Sales => {
    const of = (v: SaValue, round: (n: number) => number): SaValue => (v.value == null ? v : { ...v, value: round(v.value * k) });
    // a share doesn't change a rate or a share; a product that sold nothing has none
    const rate = (v: SaValue) => (k ? v : { ...v, value: null });
    return { net_sales: of(s.net_sales, cents), units: of(s.units, Math.round), refunds: of(s.refunds, cents), refund_rate: rate(s.refund_rate), contribution: of(c.contribution_before_ads, cents), cost_coverage: rate(c.cost_coverage), fees: of(c.fees, cents) };
  };
  const rows = new Map([...demoShares(db, storeId)].map(([id, k]) => [id, part(k)]));
  return (id: string) => rows.get(id) ?? part(0);
}

/**
 * SA-83: a product's variants for its expanded row, each one's state now and its period sales, which only count when
 * every unit the product sold is on an order line naming its variant; else none, with the note. Undefined: no such
 * product in the store.
 */
export function listingVariants(db: Db, storeId: string, productId: string, sp: StorePeriod, filters: SaFilters = {}, basis: RefundBasis = 'refund_day'): SaVariants | undefined {
  if (!db.prepare('SELECT 1 FROM products WHERE store_id = ? AND id = ?').get(storeId, productId)) return undefined;
  const demo = !!db.prepare('SELECT demo FROM stores WHERE id = ?').get(storeId)?.demo;
  const vs = db
    .prepare("SELECT id, title, sku, price, inventory AS inv, inventory_tracked AS tracked, coalesce(inventory_policy = 'fba', 0) AS fba FROM product_variants WHERE store_id = ? AND product_id = ? ORDER BY rowid")
    .all(storeId, productId);
  const { from, to } = sp.period;
  const channels = filters.channel?.length && !demo ? filters.channel : undefined;
  const slice = (ids?: string[], all = false): Slice => ({ ...(channels && !all && { channels }), products: [productId], ...(ids && { variants: ids }) });
  const units = (a: string, b: string, s: Slice) => salesMetrics(db, storeId, a, b, basis, s).units.value ?? 0;
  const sum = (xs: number[]) => xs.reduce((a, n) => a + n, 0);
  // the cover window's rate per variant, store-wide like `coverUnits`, only when its lines name every unit too
  const [wf, wt] = [addDays(sp.today, -COVER_WINDOW), addDays(sp.today, -1)];
  const sold = vs.map((v) => (demo ? 0 : units(wf, wt, slice([String(v.id)], true))));
  const rated = !demo && sum(sold) === units(wf, wt, slice(undefined, true));
  const sales = vs.map((v) => (demo ? undefined : salesMetrics(db, storeId, from, to, basis, slice([String(v.id)]))));
  const recorded = !demo && sum(sales.map((s) => s!.units.value ?? 0)) === units(from, to, slice());
  const note = demo ? "Demo data isn't split by variant" : recorded ? undefined : 'Variant sales not recorded yet';
  const none: SaValue = { value: null, status: 'unavailable', reason: demo ? 'unsupported' : 'not_tracked', note };
  return {
    rows: vs.map((v, i) => {
      const s = recorded ? sales[i] : undefined;
      const cover = rated ? coverOf(v, sold[i]!) : undefined;
      return {
        id: String(v.id),
        title: v.title == null ? null : String(v.title),
        sku: v.sku == null ? null : String(v.sku),
        price: v.price == null ? null : Number(v.price),
        stock: v.tracked ? Number(v.inv) : null,
        stockState: stockState(v, rated ? sold[i]! : 0),
        ...(cover !== undefined && { coverDays: Math.round(cover * 10) / 10 }),
        units: s?.units ?? none,
        netSales: s?.net_sales ?? none,
        refunds: s?.refunds ?? none,
        contribution: s ? costMetrics(db, storeId, from, to, basis, slice([String(v.id)])).contribution_before_ads : none,
      };
    }),
    ...(note && { note }),
  };
}

/** A demo store's fixed share of its sales per active product (Dashboard's `demoTopProducts` weights), adding up to 1. */
export function demoShares(db: Db, storeId: string) {
  const products = db.prepare("SELECT id FROM products WHERE store_id = ? AND status = 'active' AND price > 0").all(storeId).map((p) => String(p.id));
  const weights = products.map((id) => 0.2 + mulberry32(hash(`${storeId}:${id}`))());
  const total = weights.reduce((a, w) => a + w, 0);
  return new Map(products.map((id, i) => [id, weights[i]! / total]));
}

export function listings(db: Db, storeId: string, query: Query, sp: StorePeriod, filters: SaFilters = {}, basis: RefundBasis = 'refund_day', pageSize = PAGE_SIZE): SaListings | string {
  const status = (query.status || 'active') as SaListingStatus;
  if (!SA_LISTING_STATUSES.includes(status)) return `status must be one of ${SA_LISTING_STATUSES.join(', ')}`;
  const [key, dir = key === 'title' ? 'asc' : 'desc'] = (query.sort || 'units').split(':') as [SaListingSort, string?];
  if (!SA_LISTING_SORTS.includes(key) || (dir !== 'asc' && dir !== 'desc')) return `sort must be one of ${SA_LISTING_SORTS.join(', ')}, optionally :asc or :desc`;
  const page = Number(query.page || 1);
  if (!Number.isInteger(page) || page < 1) return 'page must be a whole number from 1';
  for (const k of Object.keys(SA_LISTING_FILTERS) as (keyof typeof SA_LISTING_FILTERS)[])
    if (query[k] && !(SA_LISTING_FILTERS[k] as readonly string[]).includes(query[k])) return `${k} must be one of ${SA_LISTING_FILTERS[k].join(', ')}`;

  const demo = !!db.prepare('SELECT demo FROM stores WHERE id = ?').get(storeId)?.demo;
  const scope: SaFilterScope = { applied: [], ignored: [] };
  // The product and collection filters pick the rows; the channel filter narrows their sales.
  const where = ['p.store_id = ?'];
  const params: SQLInputValue[] = [storeId];
  if (query.q?.trim()) {
    const like = `%${query.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(`(p.title LIKE ? ESCAPE '\\' OR p.id LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM product_variants v WHERE v.store_id = p.store_id AND v.product_id = p.id AND v.sku LIKE ? ESCAPE '\\'))`);
    params.push(like, like, like);
  }
  if (filters.product?.length) {
    where.push('p.id IN (SELECT value FROM json_each(?))');
    params.push(JSON.stringify(filters.product));
    scope.applied.push('product');
  }
  if (filters.collection?.length) {
    if (db.prepare('SELECT 1 FROM product_collections WHERE store_id = ? LIMIT 1').get(storeId)) {
      where.push('p.id IN (SELECT product_id FROM product_collections WHERE store_id = p.store_id AND collection_id IN (SELECT value FROM json_each(?)))');
      params.push(JSON.stringify(filters.collection));
      scope.applied.push('collection');
    } else scope.ignored.push({ key: 'collection', reason: "Collections aren't synced for this store yet" });
  }
  const channels = filters.channel?.length && !demo ? filters.channel : undefined;
  if (channels) scope.applied.push('channel');
  else if (filters.channel?.length) scope.ignored.push({ key: 'channel', reason: "Demo data isn't split by channel" });
  for (const k of ['market', 'segment'] as const) if (filters[k]?.length) scope.ignored.push({ key: k, reason: 'Not applied to listings yet' });
  if (query.cost === 'missing') where.push(demo ? 'coalesce(p.cost, 0) = 0' : MISSING_COST); // a demo store's costs are its catalog's
  if (query.sync === 'failed') {
    // SA-82: with a channel filter, a failed listing on one of those channels (Needs attention's listing-sync link)
    const on = filters.channel?.length ? ' AND c.channel IN (SELECT value FROM json_each(?))' : '';
    where.push(`EXISTS (SELECT 1 FROM channel_listings c WHERE c.store_id = p.store_id AND c.product_id = p.id AND c.status = 'failed'${on})`);
    if (on) params.push(JSON.stringify(filters.channel));
  }

  // ponytail: the whole matching set is filtered and sorted in memory (20,000 products in the scale fixture); SQL when it isn't enough.
  const matched = db
    .prepare(
      `SELECT p.id, p.title, p.price, p.status, iif(p.inventory_tracked, p.inventory, NULL) AS stock, p.inventory_tracked AS tracked, p.inventory AS inv,
         EXISTS (SELECT 1 FROM product_variants v WHERE v.store_id = p.store_id AND v.product_id = p.id AND v.inventory_policy = 'fba') AS fba,
         (SELECT count(*) FROM product_variants v WHERE v.store_id = p.store_id AND v.product_id = p.id) AS nv,
         (SELECT count(*) FROM product_variants v WHERE v.store_id = p.store_id AND v.product_id = p.id AND v.inventory_tracked AND v.inventory <= 0) AS vout,
         (SELECT count(*) FROM channel_listings c WHERE c.store_id = p.store_id AND c.product_id = p.id) AS nc,
         NOT p.inventory_tracked AND (${SUPPLIED('order_lines')} OR ${SUPPLIED('order_items')}) AS supplier
       FROM products p WHERE ${where.join(' AND ')}`,
    )
    .all(...Array(2).fill(addDays(sp.today, -SUPPLIER_DAYS)), ...params);
  const demoSales = demo ? demoSplit(db, storeId, sp.period.from, sp.period.to, basis) : undefined;
  const { compare, cut } = setup(db, storeId, sp, {});
  const demoBefore = demo && compare ? demoSplit(db, storeId, compare.from, compare.to, basis, cut && { cut }) : undefined;
  const t = (METRIC_SORTS.has(key) || (query.sales && query.sales !== 'any')) && !demo ? totals(db, storeId, sp.period.from, sp.period.to, basis, channels && { channels }) : undefined;
  const sold = coverUnits(db, storeId, sp.today, demo);
  const state = (r: (typeof matched)[number]) => stockState(r, sold.get(String(r.id)) ?? 0);
  const units = (id: string) => (demoSales ? (demoSales(id).units.value ?? 0) : (t!.get(id)?.units ?? 0));
  const matching = matched.filter(
    (r) =>
      (!query.stock || (query.stock === 'variants_out' ? Number(r.vout) > 0 : state(r) === query.stock)) &&
      (!query.sales || query.sales === 'any' || units(String(r.id)) > 0 === (query.sales === 'with')),
  );
  const counts = { active: 0, draft: 0, archived: 0, all: matching.length };
  for (const r of matching) if (r.status === 'active' || r.status === 'draft' || r.status === 'archived') counts[r.status]++;
  const all = status === 'all' ? matching : matching.filter((r) => r.status === status);
  const byId = new Map(all.map((r) => [String(r.id), r]));
  const m = key as 'units' | 'net_sales' | 'refunds';
  const sortKey = (r: (typeof all)[number]): number | string | null =>
    METRIC_SORTS.has(key) ? (demoSales ? (demoSales(String(r.id))[m].value ?? 0) : (t!.get(String(r.id))?.[m] ?? 0)) : key === 'title' ? String(r.title).toLowerCase() : key === 'price' ? Number(r.price) : (r.stock as number | null);
  const sign = dir === 'asc' ? 1 : -1;
  const sorted = all
    .map((r) => ({ r, k: sortKey(r) }))
    .sort((a, b) => {
      if (a.k !== b.k) return a.k == null ? 1 : b.k == null ? -1 : (a.k < b.k ? -1 : 1) * sign; // untracked stock last
      return String(a.r.title).localeCompare(String(b.r.title)) || String(a.r.id).localeCompare(String(b.r.id));
    });
  const ids = sorted.slice((page - 1) * pageSize, page * pageSize).map((x) => String(x.r.id));

  const product = db.prepare(
    `SELECT p.id, p.title, p.image, p.status, p.category, p.price, p.compare_at, iif(p.inventory_tracked, p.inventory, NULL) AS stock,
       (SELECT count(*) FROM product_variants v WHERE v.store_id = p.store_id AND v.product_id = p.id) AS variants,
       (SELECT count(*) FROM product_variants v WHERE v.store_id = p.store_id AND v.product_id = p.id AND v.inventory_tracked AND v.inventory <= 0) AS out,
       (SELECT min(v.sku) FROM product_variants v WHERE v.store_id = p.store_id AND v.product_id = p.id) AS sku,
       coalesce(p.synced_at, (SELECT max(c.synced_at) FROM channel_listings c WHERE c.store_id = p.store_id AND c.product_id = p.id)) AS synced
     FROM products p WHERE p.store_id = ? AND p.id = ?`,
  );
  const listed = db.prepare('SELECT channel, status, error FROM channel_listings WHERE store_id = ? AND product_id = ? ORDER BY channel, id');
  const member = db.prepare('SELECT DISTINCT coalesce(title, collection_id) AS t FROM product_collections WHERE store_id = ? AND product_id = ? ORDER BY 1 COLLATE NOCASE');
  const rows = ids.map((id): SaListingRow => {
    const p = product.get(storeId, id)!;
    const slice = { ...(channels && { channels }), products: [id] };
    const sales = demoSales ? undefined : salesMetrics(db, storeId, sp.period.from, sp.period.to, basis, slice);
    const costs = demoSales ? undefined : costMetrics(db, storeId, sp.period.from, sp.period.to, basis, slice);
    const d = demoSales?.(id) ?? { ...sales!, contribution: costs!.contribution_before_ads, cost_coverage: costs!.cost_coverage, fees: costs!.fees };
    const cover = coverOf(byId.get(id)!, sold.get(id) ?? 0);
    const before = compare && (demoBefore?.(id).net_sales ?? salesMetrics(db, storeId, compare.from, compare.to, basis, { ...slice, ...(cut && { cut }) }).net_sales);
    return {
      id,
      title: String(p.title),
      image: p.image == null ? null : String(p.image),
      status: String(p.status),
      category: p.category == null ? null : String(p.category),
      collections: member.all(storeId, id).map((c) => String(c.t)),
      sku: Number(p.variants) === 1 && p.sku != null ? String(p.sku) : null,
      variants: Math.max(1, Number(p.variants)),
      variantsOut: Number(p.out),
      price: Number(p.price),
      compareAt: p.compare_at == null ? null : Number(p.compare_at),
      stock: p.stock == null ? null : Number(p.stock),
      stockState: state(byId.get(id)!),
      ...(cover !== undefined && { coverDays: Math.round(cover * 10) / 10 }),
      channels: listed.all(storeId, id).map((c) => ({ channel: String(c.channel), status: String(c.status), error: c.error == null ? null : String(c.error) })),
      syncedAt: p.synced == null ? null : String(p.synced),
      netSales: d.net_sales,
      units: d.units,
      refunds: d.refunds,
      refundRate: d.refund_rate,
      contribution: d.contribution,
      costCoverage: d.cost_coverage,
      ...(before && { previousNetSales: before }),
    };
  });

  return {
    period: sp.period,
    status,
    sort: `${key}:${dir}`,
    page,
    pageSize,
    total: all.length,
    counts,
    variants: all.reduce((a, r) => a + Math.max(1, Number(r.nv)), 0),
    channelListings: all.reduce((a, r) => a + Number(r.nc), 0),
    rows,
    scope,
  };
}
