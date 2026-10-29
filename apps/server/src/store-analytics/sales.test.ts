// SA-16: sales metrics beyond the oracle: estimates, never-read stores, missing rates.
import { describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db';
import { insertStore } from '../stores';
import { LEDGER_PERIODS, LEDGER_STORE, seedLedgerStore } from './fixture';
import { salesMetrics } from './sales';

const store = (db: Db, id = 'legacy') => insertStore(db, { id, name: 'Legacy Shop', platform: 'shopify', niche: 'beauty', currency: 'USD', timezone: 'America/New_York', color: '#ff2a3a', connected: true });
const legacyOrder = (db: Db, id: string, total: number, tax: number, day = '2026-10-20') => {
  db.prepare("INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, cogs, local_date, tax) VALUES ('legacy', ?, ?, ?, 'paid', 'fulfilled', 0, ?, ?)").run(id, `${day}T15:00:00Z`, total, day, tax);
  db.prepare("INSERT INTO order_items (store_id, order_id, product_id, quantity, revenue, cost) VALUES ('legacy', ?, 'p1', 2, ?, 0)").run(id, total - tax);
};

describe('salesMetrics', () => {
  it('a store whose orders all predate money parts is estimated (or unavailable), never ok', () => {
    const db = openDb();
    store(db);
    legacyOrder(db, '#1', 54, 4);
    legacyOrder(db, '#2', 33, 3);
    db.prepare("INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, cogs, local_date, tax) VALUES ('legacy', '#3', '2026-10-20T16:00:00Z', 0, 'refunded', 'fulfilled', 0, '2026-10-20', 0)").run();
    const m = salesMetrics(db, 'legacy', '2026-10-19', '2026-10-25');
    expect(m.gross_sales).toMatchObject({ value: 80, status: 'estimated', coverage: { share: 0, of: 'orders with money parts' }, note: '100% of orders synced before money parts were recorded' });
    expect(m.net_sales).toMatchObject({ value: 80, status: 'estimated' });
    expect(m.orders).toMatchObject({ value: 2, status: 'estimated' }); // a legacy 'refunded' order may never have been paid
    expect(m.aov).toMatchObject({ value: 40, status: 'estimated' });
    expect(m.units).toMatchObject({ value: 4, status: 'estimated', coverage: { share: 0, of: 'orders with order lines' } });
    for (const id of ['discounts', 'refunds', 'cancelled_orders', 'refund_rate'] as const) expect(m[id], id).toMatchObject({ value: null, status: 'unavailable', reason: 'needs_ingestion' });
    expect(Object.values(m).some((v) => v.status === 'ok')).toBe(false);
  });

  it("a store whose orders were never read says why instead of 0", () => {
    const db = openDb();
    store(db);
    const m = salesMetrics(db, 'legacy', '2026-10-19', '2026-10-25');
    expect(m.orders).toEqual({ value: null, status: 'unavailable', reason: 'needs_credentials' });
    expect(m.net_sales.value).toBeNull();
  });

  it('a TikTok Shop order synced before money parts nets its legacy refund lines in the estimate', () => {
    const db = openDb();
    store(db);
    legacyOrder(db, 'tt-1', 32.4, 2.4);
    db.prepare("INSERT INTO amazon_refunds (store_id, id, order_id, amount, tax) VALUES ('legacy', 'r1', 'tt-1', 10, 0.8)").run();
    expect(salesMetrics(db, 'legacy', '2026-10-19', '2026-10-25').net_sales).toMatchObject({ value: 20, status: 'estimated' });
  });

  it('an order in another currency with no rate for its day is left out of the money and listed', () => {
    const db = openDb();
    seedLedgerStore(db);
    db.prepare("DELETE FROM fx_rates WHERE date = '2026-10-30'").run();
    const m = salesMetrics(db, LEDGER_STORE, LEDGER_PERIODS.P1.from, LEDGER_PERIODS.P1.to);
    expect(m.gross_sales).toMatchObject({ value: 416, status: 'partial', note: 'Left out, no exchange rate: 1 order in EUR on 2026-10-30' }); // 470 − €50 × 1.08
    expect(m.orders).toMatchObject({ value: 9, status: 'ok' }); // still an order
    expect(m.aov.value).toBeCloseTo((416 - 16.4) / 8, 2);
  });

  it('a mix of orders with and without money parts: totals estimated, the parts-only metrics partial, with their share', () => {
    const db = openDb();
    seedLedgerStore(db);
    db.prepare("UPDATE orders SET breakdown_at = NULL WHERE store_id = ? AND id = '#1001'").run(LEDGER_STORE);
    const m = salesMetrics(db, LEDGER_STORE, LEDGER_PERIODS.P2.from, LEDGER_PERIODS.P2.to);
    // #1001 counts as total − tax (69.80 − 4.80 = 65, its shipping included): 28 + 42 + 65
    expect(m.gross_sales).toMatchObject({ value: 135, status: 'estimated', coverage: { share: 2 / 3 } });
    expect(m.discounts).toMatchObject({ value: 0, status: 'partial', coverage: { share: 2 / 3 } });
  });
});
