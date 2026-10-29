// SA-19: contribution, cost coverage and fees beyond the oracle.
import { describe, expect, it } from 'vitest';
import { openDb } from '../db';
import { DEMO_STORES, seedDemo } from '../demo';
import { costMetrics } from './costs';
import { LEDGER_PERIODS, LEDGER_STORE, seedLedgerStore } from './fixture';

const { P1, P3 } = LEDGER_PERIODS;
const ledger = () => {
  const db = openDb();
  seedLedgerStore(db);
  return db;
};
const p1 = (db: ReturnType<typeof openDb>) => costMetrics(db, LEDGER_STORE, P1.from, P1.to);

describe('costMetrics', () => {
  it("an uncosted line takes the unit cost effective on its order's day, never a later one", () => {
    const db = ledger();
    const cost = db.prepare("INSERT INTO unit_costs (store_id, product_id, variant_id, cost, currency, source, effective_from, recorded_at) VALUES ('ledger', '8003', NULL, ?, 'USD', 'owner', ?, ?)");
    cost.run(7, '2026-10-27', '2026-10-27T00:00:00Z'); // after #1003 (Oct 26): no use to it
    expect(p1(db).cost_coverage.value).toBeCloseTo(11 / 14, 10);
    cost.run(5, '2026-10-01', '2026-10-01T00:00:00Z');
    const m = p1(db);
    expect(m.cost_coverage.value).toBeCloseTo(13 / 14, 10);
    // + the masks' 32.40 of sales − their refunded 16.20 (not restocked: its cost stays) − 2 × $5
    expect(m.contribution_before_ads.value).toBe(Math.round((359.2 + 32.4 - 16.2 - (116.8 + 10) - 17.07124) * 100) / 100);
  });

  it('a refunded unit that was not restocked keeps its product cost', () => {
    const db = ledger();
    db.prepare("UPDATE refunds SET restocked = 0 WHERE store_id = 'ledger' AND id = 'r1004-1'").run();
    expect(costMetrics(db, LEDGER_STORE, P3.from, P3.to).contribution_before_ads.value).toBe(-84);
  });

  it('no unit costs at all is unavailable, not 0 or −fees', () => {
    const db = ledger();
    db.prepare("UPDATE order_lines SET cost = NULL WHERE store_id = 'ledger'").run();
    db.prepare("DELETE FROM unit_costs WHERE store_id = 'ledger'").run();
    expect(p1(db).contribution_before_ads).toMatchObject({ value: null, status: 'unavailable', reason: 'not_tracked', coverage: { share: 0 } });
    expect(p1(db).cost_coverage.value).toBe(0);
    expect(p1(db).fees.value).toBe(17.07); // fees don't need costs
  });

  it("recorded fees win on their own day; Amazon as a channel takes its referral fee", () => {
    const db = ledger();
    db.prepare("INSERT INTO order_fees (store_id, order_id, kind, amount, currency, local_date, source) VALUES ('ledger', '#1013', 'payment', 1.5, 'USD', '2026-11-01', 'shopify')").run();
    // #1013's estimate was 2.9% × 34.56 + 0.30 = 1.30224
    expect(p1(db).fees.value).toBe(Math.round((17.07124 - 1.30224 + 1.5) * 100) / 100);
    db.prepare("UPDATE orders SET channel = 'amazon' WHERE store_id = 'ledger' AND id = '#1015'").run();
    // #1015: 15% × 42 instead of 2.9% × 45.36 + 0.30 = 1.61544
    expect(p1(db).fees.value).toBe(Math.round((17.07124 - 1.30224 + 1.5 - 1.61544 + 6.3) * 100) / 100);
  });

  it("demo stores: contribution is revenue − demo cogs − the store's fee estimate, every value demo", () => {
    const db = openDb();
    seedDemo(db, '2026-10-26');
    for (const { id } of DEMO_STORES) {
      const m = costMetrics(db, id, '2026-10-19', '2026-10-25');
      expect(new Set(Object.values(m).map((v) => v.status))).toEqual(new Set(['demo']));
      const d = db.prepare("SELECT sum(revenue) AS r, sum(cogs) AS c FROM daily_metrics WHERE store_id = ? AND date BETWEEN '2026-10-19' AND '2026-10-25'").get(id)!;
      expect(m.contribution_before_ads.value).toBeCloseTo(Number(d.r) - Number(d.c) - m.fees.value!, 1);
    }
  });
});
