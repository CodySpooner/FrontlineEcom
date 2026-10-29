// SA-66: the Listings tab (spec §7 Listings table): every product of one store matching the status, search and filters,
// sorted over the whole matching set and paged at 25 (decision 38). A row's state is current; its sales are the period's,
// from the v1 functions narrowed to that product.
import type { SQLInputValue } from 'node:sqlite';
import { SA_LISTING_SORTS, SA_LISTING_STATUSES, type SaFilterScope, type SaFilters, type SaListingRow, type SaListings, type SaListingSort, type SaListingStatus, type SaValue } from '@frontline/shared';
import type { Db } from '../db';
import { costMetrics } from './costs';
import { storeConverter } from './fx';
import type { StorePeriod } from './period';
import { CANONICAL, salesMetrics, sliceSql, type RefundBasis } from './sales';

export const PAGE_SIZE = 25;
const METRIC_SORTS = new Set<SaListingSort>(['units', 'net_sales', 'refunds']);

type Query = { status?: string; q?: string; sort?: string; page?: string };

/**
 * Each product's units, net sales and refunds over [from, to], grouped in three passes so a sort covers every product.
 * The same rules as `salesMetrics` with a one-product slice (listings.test.ts holds them equal): units from order lines,
 * else the order's per-product rows; money from lines of orders with money parts at their day's rate, else the per-product
 * rows; merchandise refunds of orders with money parts.
 */
function totals(db: Db, storeId: string, from: string, to: string, basis: RefundBasis, channels?: string[]) {
  const { fx } = storeConverter(db, String(db.prepare('SELECT currency FROM stores WHERE id = ?').get(storeId)!.currency));
  const t = new Map<string, Record<'units' | 'net_sales' | 'refunds', number>>();
  const of = (p: unknown) => t.get(String(p)) ?? t.set(String(p), { units: 0, net_sales: 0, refunds: 0 }).get(String(p))!;
  const w = sliceSql(db, storeId, channels && { channels }, to);
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
  const wr = sliceSql(db, storeId, channels && { channels }, to, dayCol);
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

export function listings(db: Db, storeId: string, query: Query, sp: StorePeriod, filters: SaFilters = {}, basis: RefundBasis = 'refund_day'): SaListings | string {
  const status = (query.status || 'active') as SaListingStatus;
  if (!SA_LISTING_STATUSES.includes(status)) return `status must be one of ${SA_LISTING_STATUSES.join(', ')}`;
  const [key, dir = key === 'title' ? 'asc' : 'desc'] = (query.sort || 'units').split(':') as [SaListingSort, string?];
  if (!SA_LISTING_SORTS.includes(key) || (dir !== 'asc' && dir !== 'desc')) return `sort must be one of ${SA_LISTING_SORTS.join(', ')}, optionally :asc or :desc`;
  const page = Number(query.page || 1);
  if (!Number.isInteger(page) || page < 1) return 'page must be a whole number from 1';

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

  const counts = { active: 0, draft: 0, archived: 0, all: 0 };
  for (const r of db.prepare(`SELECT p.status AS s, count(*) AS n FROM products p WHERE ${where.join(' AND ')} GROUP BY 1`).all(...params)) {
    if (r.s === 'active' || r.s === 'draft' || r.s === 'archived') counts[r.s] = Number(r.n);
    counts.all += Number(r.n);
  }
  if (status !== 'all') where.push('p.status = ?'), params.push(status);

  // ponytail: the whole matching set is sorted in memory (20,000 products in the scale fixture); SQL ORDER BY when it isn't enough.
  const all = db.prepare(`SELECT p.id, p.title, p.price, iif(p.inventory_tracked, p.inventory, NULL) AS stock FROM products p WHERE ${where.join(' AND ')}`).all(...params);
  const t = METRIC_SORTS.has(key) && !demo ? totals(db, storeId, sp.period.from, sp.period.to, basis, channels) : undefined;
  const sortKey = (r: (typeof all)[number]): number | string | null => (t ? (t.get(String(r.id))?.[key as 'units'] ?? 0) : key === 'title' ? String(r.title).toLowerCase() : key === 'price' ? Number(r.price) : key === 'stock' ? (r.stock as number | null) : 0);
  const sign = dir === 'asc' ? 1 : -1;
  const sorted = all
    .map((r) => ({ r, k: sortKey(r) }))
    .sort((a, b) => {
      if (a.k !== b.k) return a.k == null ? 1 : b.k == null ? -1 : (a.k < b.k ? -1 : 1) * sign; // untracked stock last
      return String(a.r.title).localeCompare(String(b.r.title)) || String(a.r.id).localeCompare(String(b.r.id));
    });
  const ids = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((x) => String(x.r.id));

  const product = db.prepare(
    `SELECT p.id, p.title, p.image, p.status, p.category, p.price, p.compare_at, iif(p.inventory_tracked, p.inventory, NULL) AS stock,
       (SELECT count(*) FROM product_variants v WHERE v.store_id = p.store_id AND v.product_id = p.id) AS variants,
       (SELECT count(*) FROM product_variants v WHERE v.store_id = p.store_id AND v.product_id = p.id AND v.inventory_tracked AND v.inventory <= 0) AS out,
       (SELECT min(v.sku) FROM product_variants v WHERE v.store_id = p.store_id AND v.product_id = p.id) AS sku,
       coalesce(p.synced_at, (SELECT max(c.synced_at) FROM channel_listings c WHERE c.store_id = p.store_id AND c.product_id = p.id)) AS synced
     FROM products p WHERE p.store_id = ? AND p.id = ?`,
  );
  const listed = db.prepare('SELECT channel, status, error FROM channel_listings WHERE store_id = ? AND product_id = ? ORDER BY channel, id');
  const split: SaValue = { value: null, status: 'unavailable', note: "Demo data isn't split by product" };
  const rows = ids.map((id): SaListingRow => {
    const p = product.get(storeId, id)!;
    const slice = { ...(channels && { channels }), products: [id] };
    const sales = demo ? undefined : salesMetrics(db, storeId, sp.period.from, sp.period.to, basis, slice);
    const costs = demo ? undefined : costMetrics(db, storeId, sp.period.from, sp.period.to, basis, slice);
    return {
      id,
      title: String(p.title),
      image: p.image == null ? null : String(p.image),
      status: String(p.status),
      category: p.category == null ? null : String(p.category),
      sku: Number(p.variants) === 1 && p.sku != null ? String(p.sku) : null,
      variants: Math.max(1, Number(p.variants)),
      variantsOut: Number(p.out),
      price: Number(p.price),
      compareAt: p.compare_at == null ? null : Number(p.compare_at),
      stock: p.stock == null ? null : Number(p.stock),
      channels: listed.all(storeId, id).map((c) => ({ channel: String(c.channel), status: String(c.status), error: c.error == null ? null : String(c.error) })),
      syncedAt: p.synced == null ? null : String(p.synced),
      netSales: sales?.net_sales ?? split,
      units: sales?.units ?? split,
      refunds: sales?.refunds ?? split,
      contribution: costs?.contribution_before_ads ?? split,
    };
  });

  const n = (sql: string, ...first: SQLInputValue[]) => Number(db.prepare(sql).get(...first, ...params)!.n);
  return {
    period: sp.period,
    status,
    sort: `${key}:${dir}`,
    page,
    pageSize: PAGE_SIZE,
    total: all.length,
    counts,
    variants: n(`SELECT coalesce(sum(max(1, (SELECT count(*) FROM product_variants v WHERE v.store_id = p.store_id AND v.product_id = p.id))), 0) AS n FROM products p WHERE ${where.join(' AND ')}`),
    channelListings: n(`SELECT count(*) AS n FROM channel_listings c WHERE c.store_id = ? AND c.product_id IN (SELECT p.id FROM products p WHERE ${where.join(' AND ')})`, storeId),
    rows,
    scope,
  };
}
