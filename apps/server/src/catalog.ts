import type { FulfillmentStatus, Order, OrderStatus, Page, Product, ProductStatus } from '@frontline/shared';
import { rebuildRevenue } from './connectors/common';
import { tx, type Db } from './db';

type Row = Record<string, unknown>;
type Query = (key: string) => string | undefined;

const r2 = (n: number) => Math.round(n * 100) / 100;

const toProduct = (r: Row): Product => ({
  id: String(r.id),
  storeId: String(r.store_id),
  title: String(r.title),
  ...(r.image ? { image: String(r.image) } : {}),
  price: Number(r.price),
  ...(r.compare_at != null ? { compareAt: Number(r.compare_at) } : {}),
  cost: Number(r.cost),
  inventory: Number(r.inventory),
  ...(r.inventory_tracked === 0 ? { inventoryTracked: false } : {}),
  status: r.status as ProductStatus,
  margin: Number(r.price) ? r2(((Number(r.price) - Number(r.cost)) / Number(r.price)) * 100) : 0,
});

const toOrder = (r: Row): Order => ({
  id: String(r.id),
  storeId: String(r.store_id),
  createdAt: String(r.created_at),
  total: Number(r.total),
  status: r.status as OrderStatus,
  fulfillmentStatus: r.fulfillment_status as FulfillmentStatus,
  ...(r.supplier ? { supplier: String(r.supplier) } : {}),
  ...(r.tracking ? { tracking: String(r.tracking), trackingUrl: /^https:\/\//.test(String(r.tracking_url)) ? String(r.tracking_url) : `https://t.17track.net/en#nums=${encodeURIComponent(String(r.tracking))}` } : {}),
});

interface ListSpec {
  table: string;
  /** Allowed `?sort=` values → SQL expression. The first one is the default. */
  sorts: Record<string, string>;
  defaultDir: 'asc' | 'desc';
  /** `?<param>=` exact-match filters → column, with allowed values. */
  filters: Record<string, [column: string, allowed: readonly string[]]>;
  /** SQL expression searched (case-insensitive substring) by `?q=`. */
  search: string;
}

/** Shared filter/sort/paginate for list endpoints. Returns an error message for invalid params. */
function list<T>(db: Db, spec: ListSpec, storeIds: string[], q: Query, map: (r: Row) => T): string | Page<T> {
  const offset = Math.max(0, Math.floor(Number(q('offset')) || 0));
  const limit = Math.min(200, Math.max(1, Math.floor(Number(q('limit')) || 50)));
  const sortKey = q('sort') ?? Object.keys(spec.sorts)[0]!;
  if (!Object.hasOwn(spec.sorts, sortKey)) return `sort must be one of ${Object.keys(spec.sorts).join(', ')}`;
  const dir = q('dir') ?? spec.defaultDir;
  if (dir !== 'asc' && dir !== 'desc') return 'dir must be asc or desc';
  if (!storeIds.length) return { items: [], total: 0, offset, limit };

  const where = [`store_id IN (${storeIds.map(() => '?').join(',')})`];
  const args: string[] = [...storeIds];
  for (const [param, [column, allowed]] of Object.entries(spec.filters)) {
    const v = q(param);
    if (v === undefined) continue;
    if (!allowed.includes(v)) return `${param} must be one of ${allowed.join(', ')}`;
    where.push(`${column} = ?`);
    args.push(v);
  }
  const search = q('q')?.trim();
  if (search) {
    where.push(`instr(lower(${spec.search}), lower(?)) > 0`);
    args.push(search);
  }
  const w = where.join(' AND ');
  const total = Number(db.prepare(`SELECT count(*) AS n FROM ${spec.table} WHERE ${w}`).get(...args)?.n);
  const items = db
    .prepare(`SELECT * FROM ${spec.table} WHERE ${w} ORDER BY ${spec.sorts[sortKey]} ${dir}, store_id, id LIMIT ? OFFSET ?`)
    .all(...args, limit, offset)
    .map(map);
  return { items, total, offset, limit };
}

const PRODUCTS: ListSpec = {
  table: 'products',
  sorts: { title: 'title', price: 'price', inventory: 'inventory', margin: '(price - cost) / price' },
  defaultDir: 'asc',
  filters: { status: ['status', ['active', 'draft', 'archived']] },
  search: 'title',
};

const ORDERS: ListSpec = {
  table: 'orders',
  sorts: { createdAt: 'created_at', total: 'total' },
  defaultDir: 'desc',
  filters: { status: ['status', ['paid', 'refunded']], fulfillment: ['fulfillment_status', ['unfulfilled', 'fulfilled', 'in_transit', 'delivered']] },
  search: "id || ' ' || coalesce(tracking, '') || ' ' || coalesce(supplier, '')",
};

export const listProducts = (db: Db, storeIds: string[], q: Query) => list(db, PRODUCTS, storeIds, q, toProduct);

/**
 * The owner's unit cost for a product whose platform has none (Etsy, TikTok Shop, Woo without COGS). Its past lines
 * without a platform cost (0, or the previous owner cost) are re-priced, with their orders' cogs and days. Undefined =
 * no such product; a string = bad input.
 */
export function setProductCost(db: Db, storeId: string, productId: string, body: unknown): string | Product | undefined {
  const cost = (body as { cost?: unknown } | undefined)?.cost;
  if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0 || cost > 1_000_000) return 'cost must be a number from 0 to 1000000';
  const store = db.prepare('SELECT platform, connected FROM stores WHERE id = ?').get(storeId);
  // Shopify's own products (numeric ids); a TikTok Shop or Amazon product next to it (tt-, amz-) has no Shopify cost.
  if (store?.platform === 'shopify' && store.connected && /^\d+$/.test(productId)) {
    return 'Shopify keeps unit costs: set "Cost per item" on the product in Shopify and the next sync brings it here';
  }
  const old = db.prepare('SELECT cost FROM products WHERE store_id = ? AND id = ?').get(storeId, productId);
  if (!old) return undefined;
  tx(db, () => {
    db.prepare('UPDATE products SET cost = ? WHERE store_id = ? AND id = ?').run(cost, storeId, productId);
    const lines = db
      .prepare(
        `SELECT i.order_id, i.quantity, i.cost, o.local_date FROM order_items i JOIN orders o ON o.store_id = i.store_id AND o.id = i.order_id
         WHERE i.store_id = ? AND i.product_id = ? AND (i.cost = 0 OR abs(i.cost - i.quantity * ?) < 0.005)`,
      )
      .all(storeId, productId, Number(old.cost));
    const line = db.prepare('UPDATE order_items SET cost = ? WHERE store_id = ? AND order_id = ? AND product_id = ?');
    const order = db.prepare('UPDATE orders SET cogs = round(max(0, cogs + ?), 2) WHERE store_id = ? AND id = ?');
    for (const l of lines) {
      const next = r2(Number(l.quantity) * cost);
      line.run(next, storeId, String(l.order_id), productId);
      order.run(next - Number(l.cost), storeId, String(l.order_id));
    }
    rebuildRevenue(db, storeId, new Set(lines.map((l) => String(l.local_date))));
  });
  return toProduct(db.prepare('SELECT * FROM products WHERE store_id = ? AND id = ?').get(storeId, productId)!);
}
export const listOrders = (db: Db, storeIds: string[], q: Query) => list(db, ORDERS, storeIds, q, toOrder);
