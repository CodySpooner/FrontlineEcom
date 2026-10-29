// SA-24: reconcile v1 net sales with Dashboard's revenue.
import type { SaReconcile } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { LEDGER_PERIODS, LEDGER_STORE, seedLedgerStore } from './fixture';
import { checkOrderIdentity, reconcile } from './reconcile';

const { P1, P3 } = LEDGER_PERIODS;
const amounts = (r: SaReconcile) => Object.fromEntries(r.lines.map((l) => [l.key, [l.amount, l.count]]));

describe('reconcile', () => {
  it('bridges the fixture to the cent, every line explained', () => {
    const db = openDb();
    seedLedgerStore(db);
    const r = reconcile(db, LEDGER_STORE, P1.from, P1.to);
    // 53.72 + 93.31 + 32.40 + 54 + 45.36 + 34.56 + 34.56 (the paid, non-copy orders' current totals)
    expect(r.legacy).toBe(347.91);
    expect(r.net_sales.value).toBe(405.4);
    expect(amounts(r)).toEqual({
      tax: [-22.69, 6], // #1012 has none
      shipping: [-4.99, 1],
      refunds_netted: [17.37, 1], // #1003's 16.20 + 1.17 tax
      refunded_orders: [116, 2], // #1004, #1005
      refunds: [-48.2, 2],
    });
    expect(r.unexplained).toBe(0);
    expect(Object.fromEntries(r.info.map((l) => [l.key, [l.amount, l.count]]))).toEqual({ duplicates: [59.4, 2], excluded: [45, 2] });
  });

  it('a late refund and one waiting for its order', () => {
    const db = openDb();
    seedLedgerStore(db);
    const r = reconcile(db, LEDGER_STORE, P3.from, P3.to);
    expect(r).toMatchObject({ legacy: 0, net_sales: { value: -84 }, unexplained: 0 });
    expect(amounts(r)).toEqual({ refunds: [-84, 1] });
    expect(r.info).toEqual([{ key: 'waiting', label: 'Refunds waiting for their order to sync, counted nowhere yet', amount: 20, count: 1 }]);
  });

  it('an order whose parts no longer make its total is listed by id and carries the gap', () => {
    const db = openDb();
    seedLedgerStore(db);
    db.prepare("UPDATE orders SET total = 90 WHERE store_id = 'ledger' AND id = '#1008'").run(); // 93.31 expected
    const r = reconcile(db, LEDGER_STORE, P1.from, P1.to);
    expect(r.lines.find((l) => l.key === 'identity')).toEqual({ key: 'identity', label: 'Orders failing the identity (parts − refunds ≠ current total)', amount: 3.31, count: 1, ids: ['#1008'] });
    // Dashboard's stored day hasn't been rebuilt since: that shows too, and the bridge still closes
    expect(r.lines.find((l) => l.key === 'stale')?.amount).toBe(-3.31);
    expect(r.unexplained).toBe(0);
  });

  it('orders synced before money parts and refunds on their order day', () => {
    const db = openDb();
    seedLedgerStore(db);
    db.prepare("UPDATE orders SET breakdown_at = NULL WHERE store_id = 'ledger' AND id = '#1015'").run();
    const r = reconcile(db, LEDGER_STORE, P1.from, P1.to, 'order_day');
    expect(amounts(r).estimates).toEqual([-3.36, 1]);
    expect(r.unexplained).toBe(0);
    expect(r.net_sales.value).toBe(321.4 + 3.36 - 3.36); // the estimate (45.36 − 3.36) is its gross: the same 42
  });

  it('checkOrderIdentity', () => {
    expect(checkOrderIdentity({ gross: 68, discounts: 6.8, shipping: 4.99, tax: 4.9, refunds: 17.37, total: 53.72 })).toEqual({ ok: true, expected: 53.72, diff: 0 });
    expect(checkOrderIdentity({ gross: 68, discounts: 6.8, shipping: 4.99, tax: 4.9, refunds: 0, total: 53.72 }).ok).toBe(false);
  });

  it('demo stores and the API', async () => {
    const db = openDb();
    seedDemo(db);
    const app = createApp(db);
    const res = await app.request('/api/analytics/reconcile?store=glow&period=last7');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ lines: [], unexplained: 0, net_sales: { status: 'demo' } });
    expect((await app.request('/api/analytics/reconcile?store=glow&refunds=x')).status).toBe(400);
  });
});
