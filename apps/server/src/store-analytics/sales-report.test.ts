import { describe, expect, it } from 'vitest';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { LEDGER_PERIODS, LEDGER_STORE, seedLedgerStore } from './fixture';
import { storePeriod } from './period';
import { buckets, salesReport } from './sales-report';

describe('sales report (SA-95)', () => {
  it('months are calendar months clipped to the period, across a year end; weeks run from its first day', () => {
    expect(buckets('2026-11-15', '2027-01-10', 'month')).toEqual([
      { from: '2026-11-15', to: '2026-11-30' },
      { from: '2026-12-01', to: '2026-12-31' },
      { from: '2027-01-01', to: '2027-01-10' },
    ]);
    expect(buckets('2026-10-01', '2026-10-16', 'week').map((b) => b.to)).toEqual(['2026-10-07', '2026-10-14', '2026-10-16']);
  });

  it("orders synced before money parts make tax and shipping partial, or unavailable when none have them; a demo store's are demo", () => {
    const db = openDb();
    seedLedgerStore(db);
    const { from, to } = LEDGER_PERIODS.P1;
    const report = (store: string, q: Record<string, string>, d = db) => {
      const sp = storePeriod(d, store, (k) => q[k], Date.parse('2026-11-09T17:00:00Z'));
      if (typeof sp === 'string') throw new Error(sp);
      return salesReport(d, { storeId: store }, sp, {}, 'refund_day', 'day');
    };
    const p1 = { period: 'custom', from, to };
    // Month to date holds today (Nov 9): its last row is today so far
    expect(report(LEDGER_STORE, { period: 'mtd' }).rows.map((r) => [r.from, !!r.partial]).slice(-2)).toEqual([['2026-11-08', false], ['2026-11-09', true]]);
    // #1012 in EUR at Oct 30's 1.08: €5 tax and €10 shipping are $5.40 and $10.80; a past period has no partial row
    db.prepare("UPDATE orders SET tax = 5, shipping = 10 WHERE store_id = ? AND id = '#1012'").run(LEDGER_STORE);
    const eur = report(LEDGER_STORE, p1);
    expect([eur.tax.value, eur.shipping.value, eur.rows.some((r) => r.partial)]).toEqual([37.37, 20.79, false]);
    db.prepare("UPDATE orders SET breakdown_at = NULL WHERE store_id = ? AND id = '#1013'").run(LEDGER_STORE);
    expect(report(LEDGER_STORE, p1).tax).toEqual({ value: 34.81, status: 'partial', coverage: { share: 8 / 9, of: 'orders with money parts' } });
    db.prepare("UPDATE orders SET breakdown_at = NULL, status = 'paid' WHERE store_id = ?").run(LEDGER_STORE);
    expect(report(LEDGER_STORE, p1).shipping).toMatchObject({ value: null, status: 'unavailable', reason: 'needs_ingestion' });

    const demoDb = openDb();
    seedDemo(demoDb, '2026-10-26');
    const demo = report('glow', { period: 'custom', from: '2026-10-19', to: '2026-10-25' }, demoDb);
    expect([demo.tax.status, demo.shipping.status, demo.tax.value! > 0]).toEqual(['demo', 'demo', true]);
  });
});
