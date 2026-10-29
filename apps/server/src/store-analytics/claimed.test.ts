// SA-08: the connectors/common.ts functions this lane claims (decision 41), against the migration-56 ledger.
import { describe, expect, it } from 'vitest';
import { forgetPlatform, rebuildRevenue, setOrderItems, setStoreTimezone } from '../connectors/common';
import { openDb } from '../db';
import { insertStore } from '../stores';

const setup = () => {
  const db = openDb();
  insertStore(db, { id: 's1', name: 'Glow Haus', platform: 'shopify', niche: 'beauty', currency: 'USD', timezone: 'America/New_York', color: '#ff2a3a', connected: true });
  return db;
};
const order = (db: ReturnType<typeof openDb>, id: string, total: number, extra: Record<string, unknown> = {}) => {
  const o = { store_id: 's1', id, created_at: '2026-10-10T15:00:00.000Z', total, status: 'paid', fulfillment_status: 'fulfilled', cogs: 0, local_date: '2026-10-10', ...extra };
  db.prepare(`INSERT INTO orders (${Object.keys(o).join(', ')}) VALUES (${Object.keys(o).map(() => '?').join(', ')})`).run(...(Object.values(o) as string[]));
};
const revenue = (db: ReturnType<typeof openDb>, date = '2026-10-10') => db.prepare('SELECT revenue, orders FROM daily_metrics WHERE store_id = ? AND date = ?').get('s1', date);

describe('rebuildRevenue', () => {
  it("leaves a channel copy marked duplicate_of out of the day's revenue and orders, with its refund lines", () => {
    const db = setup();
    order(db, '#1001', 50);
    order(db, '#1002', 30, { duplicate_of: 'tt-5770001' });
    order(db, 'tt-5770001', 30);
    db.prepare("INSERT INTO amazon_refunds (store_id, id, order_id, amount, tax) VALUES ('s1', 'r1', '#1002', 10, 0), ('s1', 'r2', 'tt-5770001', 5, 0)").run();
    rebuildRevenue(db, 's1', ['2026-10-10']);
    expect(revenue(db)).toEqual({ revenue: 75, orders: 2 }); // 50 + 30 − 5; the copy and its refund line are out
  });
});

describe('setOrderItems', () => {
  it('keeps a known line cost when the order is re-synced after the product cost changed', () => {
    const db = setup();
    db.prepare("INSERT INTO products (store_id, id, title, price, cost) VALUES ('s1', 'p1', 'Serum', 32, 9), ('s1', 'p2', 'Mask', 20, 0)").run();
    order(db, '#1001', 52);
    setOrderItems(db, 's1', '#1001', [{ productId: 'p1', quantity: 2, revenue: 64, cost: 0 }, { productId: 'p2', quantity: 1, revenue: 20, cost: 0 }]);
    expect(db.prepare("SELECT product_id, cost FROM order_items WHERE order_id = '#1001' ORDER BY product_id").all()).toEqual([{ product_id: 'p1', cost: 18 }, { product_id: 'p2', cost: 0 }]);
    db.prepare("UPDATE products SET cost = 12 WHERE id = 'p1'").run();
    db.prepare("UPDATE products SET cost = 5 WHERE id = 'p2'").run();
    setOrderItems(db, 's1', '#1001', [{ productId: 'p1', quantity: 2, revenue: 64, cost: 0 }, { productId: 'p2', quantity: 1, revenue: 20, cost: 0 }]);
    // p1's cost was known (18 at 9 each) and stays; p2 had none and takes today's
    expect(db.prepare("SELECT product_id, cost FROM order_items WHERE order_id = '#1001' ORDER BY product_id").all()).toEqual([{ product_id: 'p1', cost: 18 }, { product_id: 'p2', cost: 5 }]);
    expect(db.prepare("SELECT cogs FROM orders WHERE id = '#1001'").get()).toEqual({ cogs: 18 }); // filled once, where 0
  });
});

describe('setStoreTimezone', () => {
  it("re-dates refunds by their own time and fees by their order's day", () => {
    const db = setup();
    order(db, '#1001', 50, { created_at: '2026-10-10T03:30:00.000Z', local_date: '2026-10-09' }); // 23:30 in New York
    db.prepare("INSERT INTO refunds (store_id, id, refund_id, order_id, refunded_at, local_date, merchandise, source) VALUES ('s1', 'r1', 'R1', '#1001', '2026-10-12T02:00:00.000Z', '2026-10-11', 10, 'shopify')").run();
    db.prepare("INSERT INTO order_fees (store_id, order_id, kind, amount, local_date, source) VALUES ('s1', '#1001', 'payment', 1.75, '2026-10-09', 'estimate')").run();
    db.prepare("INSERT INTO inventory_snapshots (store_id, variant_id, date, quantity, tracked) VALUES ('s1', 'v1', '2026-10-09', 4, 1)").run();
    setStoreTimezone(db, 's1', 'Europe/London');
    expect(db.prepare("SELECT local_date FROM refunds WHERE id = 'r1'").get()).toEqual({ local_date: '2026-10-12' });
    expect(db.prepare("SELECT local_date FROM order_fees WHERE order_id = '#1001'").get()).toEqual({ local_date: '2026-10-10' });
    // snapshots keep the day they were taken
    expect(db.prepare("SELECT date FROM inventory_snapshots WHERE variant_id = 'v1'").get()).toEqual({ date: '2026-10-09' });
  });
});

describe('forgetPlatform', () => {
  it("drops one platform's ledger and catalog rows and leaves the other's", () => {
    const db = setup();
    order(db, '#1001', 50);
    order(db, 'tt-5770001', 30);
    const ins = (t: string, cols: string[], rows: unknown[][]) => rows.forEach((r) => db.prepare(`INSERT INTO ${t} (store_id, ${cols.join(', ')}) VALUES ('s1', ${cols.map(() => '?').join(', ')})`).run(...(r as string[])));
    ins('order_lines', ['order_id', 'line_id', 'product_id', 'quantity', 'gross'], [['#1001', 'l1', '8820417', 1, 50], ['tt-5770001', 'l1', 'tt-17', 1, 30]]);
    ins('refunds', ['id', 'refund_id', 'order_id', 'refunded_at', 'local_date', 'source'], [['r1', 'R', '#1001', 'x', '2026-10-11', 'shopify'], ['r2', 'R', 'tt-5770001', 'x', '2026-10-11', 'tiktok_shop']]);
    ins('order_fees', ['order_id', 'kind', 'amount', 'source'], [['#1001', 'payment', 1, 'estimate'], ['tt-5770001', 'payment', 1, 'estimate']]);
    ins('product_variants', ['product_id', 'id'], [['8820417', '4410'], ['tt-17', 'tt-1701']]);
    ins('channel_listings', ['channel', 'id', 'product_id'], [['site', '8820417', '8820417'], ['tiktok_shop', 'tt-17', 'tt-17']]);
    ins('product_links', ['channel', 'channel_product_id', 'product_id', 'method', 'created_at'], [['tiktok_shop', 'tt-17', '8820417', 'owner', 'x']]);
    ins('product_collections', ['collection_id', 'product_id'], [['c1', '8820417'], ['c1', 'tt-17']]);
    ins('unit_costs', ['product_id', 'cost', 'source', 'effective_from', 'recorded_at'], [['8820417', 13.2, 'shopify', 'x', 'x'], ['tt-17', 4, 'owner', 'x', 'x']]);
    ins('inventory_snapshots', ['variant_id', 'date', 'quantity'], [['4410', '2026-10-10', 38], ['tt-1701', '2026-10-10', 5]]);
    db.prepare("INSERT INTO source_datasets (integration_id, dataset, store_id) VALUES ('tiktok_shop:s1', 'orders', 's1'), ('shopify:s1', 'orders', 's1')").run();
    forgetPlatform(db, 's1', 'tiktok_shop');
    const left = (t: string, col: string) => db.prepare(`SELECT ${col} AS v FROM ${t} WHERE store_id = 's1' ORDER BY 1`).all().map((r) => r.v);
    expect(left('order_lines', 'order_id')).toEqual(['#1001']);
    expect(left('refunds', 'order_id')).toEqual(['#1001']);
    expect(left('order_fees', 'order_id')).toEqual(['#1001']);
    expect(left('product_variants', 'id')).toEqual(['4410']);
    expect(left('channel_listings', 'id')).toEqual(['8820417']);
    expect(left('product_links', 'product_id')).toEqual([]); // a link to the forgotten channel's product goes with it
    expect(left('product_collections', 'product_id')).toEqual(['8820417']);
    expect(left('unit_costs', 'product_id')).toEqual(['8820417']);
    expect(left('inventory_snapshots', 'variant_id')).toEqual(['4410']);
    expect(left('source_datasets', 'integration_id')).toEqual(['shopify:s1']);
  });
});
