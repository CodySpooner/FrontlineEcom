import type { Db } from '../db';

/** Wipes a demo store's generated rows and marks it connected. Called by the first successful real sync of any connector. */
export function switchToReal(db: Db, storeId: string) {
  if (db.prepare('SELECT demo FROM stores WHERE id = ?').get(storeId)?.demo !== 1) return;
  for (const t of ['daily_metrics', 'products', 'orders', 'campaigns', 'events']) db.prepare(`DELETE FROM ${t} WHERE store_id = ?`).run(storeId);
  db.prepare('UPDATE stores SET demo = 0, connected = 1 WHERE id = ?').run(storeId);
}

/** daily_metrics.ad_spend = spend across every ad network's campaigns for that store and day. */
export function rebuildAdSpend(db: Db, storeId: string, dates: Iterable<string>) {
  const sum = db.prepare('SELECT coalesce(sum(d.spend), 0) AS spend FROM campaign_daily d JOIN campaigns c ON c.network = d.network AND c.id = d.campaign_id WHERE c.store_id = ? AND d.date = ?');
  const up = db.prepare('INSERT INTO daily_metrics (store_id, date, ad_spend) VALUES (?, ?, ?) ON CONFLICT (store_id, date) DO UPDATE SET ad_spend = excluded.ad_spend');
  for (const date of dates) up.run(storeId, date, Math.round(Number(sum.get(storeId, date)!.spend) * 100) / 100);
}

/**
 * daily_metrics revenue/cogs/orders = paid orders from every store platform that day, plus channels that only report daily
 * totals (channel_daily, e.g. Amazon). ad_spend is left to the ad connectors.
 */
export function rebuildRevenue(db: Db, storeId: string, dates: Iterable<string>) {
  const agg = db.prepare(
    `SELECT coalesce(sum(revenue), 0) AS revenue, coalesce(sum(cogs), 0) AS cogs, coalesce(sum(n), 0) AS n FROM (
       SELECT total AS revenue, cogs, 1 AS n FROM orders WHERE store_id = ?1 AND local_date = ?2 AND status = 'paid'
       UNION ALL SELECT revenue, 0, orders FROM channel_daily WHERE store_id = ?1 AND date = ?2)`,
  );
  const up = db.prepare(
    `INSERT INTO daily_metrics (store_id, date, revenue, cogs, orders) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (store_id, date) DO UPDATE SET revenue = excluded.revenue, cogs = excluded.cogs, orders = excluded.orders`,
  );
  for (const date of dates) {
    const a = agg.get(storeId, date)!;
    up.run(storeId, date, Math.round(Number(a.revenue) * 100) / 100, Math.round(Number(a.cogs) * 100) / 100, Number(a.n));
  }
}

export interface OrderItem {
  productId: string;
  quantity: number;
  revenue: number;
  cost: number;
}

/** Replaces an order's line items, summed per product (an order can hold several variants of one product). */
export function setOrderItems(db: Db, storeId: string, orderId: string, items: OrderItem[]) {
  db.prepare('DELETE FROM order_items WHERE store_id = ? AND order_id = ?').run(storeId, orderId);
  const byProduct = new Map<string, OrderItem>();
  for (const i of items) {
    const p = byProduct.get(i.productId);
    byProduct.set(i.productId, p ? { ...p, quantity: p.quantity + i.quantity, revenue: p.revenue + i.revenue, cost: p.cost + i.cost } : i);
  }
  const ins = db.prepare('INSERT INTO order_items (store_id, order_id, product_id, quantity, revenue, cost) VALUES (?, ?, ?, ?, ?, ?)');
  for (const i of byProduct.values()) ins.run(storeId, orderId, i.productId, i.quantity, Math.round(i.revenue * 100) / 100, Math.round(i.cost * 100) / 100);
}
