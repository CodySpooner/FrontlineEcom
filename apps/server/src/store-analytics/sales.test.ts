// SA-16: sales metrics beyond the oracle: estimates, never-read stores, missing rates.
import { describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db';
import { DEMO_STORES, demoDay, seedDemo } from '../demo';
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

describe('demo stores (SA-17)', () => {
  it("demoDay's parts net to the day's revenue, the same every call", () => {
    for (const { id } of DEMO_STORES)
      for (const date of ['2025-03-02', '2026-10-21', '2026-10-25']) {
        const { revenue, parts } = demoDay(id, date);
        expect(demoDay(id, date).parts).toEqual(parts);
        expect(Math.round((parts.gross - parts.discounts - parts.refunds) * 100)).toBe(Math.round(revenue * 100));
        expect(parts.units).toBeGreaterThanOrEqual(demoDay(id, date).orders);
      }
  });

  it("every value is demo, net sales and orders are Dashboard's, and two calls agree", () => {
    const db = openDb();
    seedDemo(db, '2026-10-26');
    for (const { id } of DEMO_STORES) {
      const m = salesMetrics(db, id, '2026-10-19', '2026-10-25');
      expect(salesMetrics(db, id, '2026-10-19', '2026-10-25')).toEqual(m);
      expect(new Set(Object.values(m).map((v) => v.status))).toEqual(new Set(['demo']));
      const legacy = db.prepare("SELECT sum(revenue) AS r, sum(orders) AS n FROM daily_metrics WHERE store_id = ? AND date BETWEEN '2026-10-19' AND '2026-10-25'").get(id)!;
      expect(m.net_sales.value).toBe(Math.round(Number(legacy.r) * 100) / 100);
      expect(m.orders.value).toBe(Number(legacy.n));
      expect(m.gross_sales.value! - m.discounts.value! - m.refunds.value!).toBeCloseTo(m.net_sales.value!, 1);
    }
    // Today so far (the seed day) nets to its partial revenue; before the history there is nothing, not 0.
    const today = db.prepare("SELECT revenue FROM daily_metrics WHERE store_id = 'glow' AND date = '2026-10-26'").get()!;
    expect(salesMetrics(db, 'glow', '2026-10-26', '2026-10-26').net_sales.value).toBe(Number(today.revenue));
    expect(salesMetrics(db, 'glow', '2020-01-01', '2020-01-07').net_sales).toMatchObject({ value: null, status: 'unavailable', reason: 'insufficient_history' });
  });
});
