// SA-09: the v1 values for the ledger fixture (fixture.ts), worked out by hand here, never by the code under test.
// Each metric's item replaces its `todo` with a real check (SA-16 sales, SA-19 contribution, SA-20 ads, SA-21 traffic).
import { describe, expect, it } from 'vitest';
import { openDb } from '../db';
import { LEDGER_ORDERS, LEDGER_PERIODS, LEDGER_REFUNDS, LEDGER_STORE, seedLedgerStore } from './fixture';
import { adMetrics } from './ads';
import { costMetrics } from './costs';
import { salesMetrics } from './sales';
import { trafficMetrics } from './traffic';

/**
 * Canonical orders = paid (status paid or refunded, with a paid time), not test, not a duplicate copy.
 * P1 (Oct 26 – Nov 1): #1003, #1004, #1005, #1008, tt-5770001, #1012, #1015, #1013, #1014 (9). Out: #1006 test,
 * #1007 unpaid, #1009 and #1010 TikTok copies. P2 (Oct 19–25): #1001, #1011 (a copy outside TikTok's covered days), #1002.
 * P3 (Nov 2–8): no orders; the #1004 full refund (Nov 3) and the refund waiting for #1016 (counted nowhere).
 */
export const ORACLE = {
  P1: {
    // 68 + 84 + 32 + 96 + 30 + 54 (€50 × 1.08) + 42 + 32 + 32
    gross_sales: 470,
    // #1003 6.80 + #1008 9.60
    discounts: 16.4,
    // refund day: #1003 16.20 (Oct 28) + #1005 32 (Oct 29); #1005's $5 shipping and all tax are not merchandise
    refunds: 48.2,
    // 470 − 16.40 − 48.20
    net_sales: 405.4,
    // order day: + #1004's 84 (its order is Oct 27): 470 − 16.40 − 132.20
    net_sales_order_day: 321.4,
    orders: 9,
    // (470 − 16.40) ÷ 9, before refunds
    aov: 50.4,
    // 3 (#1003) + 2 + 1 + 3 + 1 (tt) + 1 (€) + 1 + 1 + 1
    units: 14,
    // #1005, cancelled Oct 29
    cancelled_orders: 1,
    // refunded units by refund day (#1003 1, #1005 1) ÷ 14
    refund_rate: 2 / 14,
    // costed lines' sales 28.80 + 84 + 32 + 86.40 + 54 + 42 + 32 + 32 = 391.20, less the costed refund (#1005 32) = 359.20;
    // cost 9 + 26.40 + 9 + 33 + 13.20 + 13.20 + 11 + 11 = 125.80, less #1005's restocked unit (9) = 116.80;
    // fees 2.9% × 495.56 charged (gross − discounts + shipping + tax of the 9 orders) + $0.30 × 9 = 17.07124
    contribution_before_ads: 225.33, // 359.20 − 116.80 − 17.07124 = 225.32876
    fees: 17.07,
    // units with a cost: 11 of 14 (the masks and the scrunchie have none)
    cost_coverage: 11 / 14,
    // $20 a day × 7
    ad_spend: 140,
    // 225.32876 − 140
    contribution_after_ads: 85.33,
    // Meta's own $50 a day ÷ $20
    platform_roas: 2.5,
    sessions: 700,
    // Oct 27 has no purchasing sessions: 6 days, 12 ÷ 600; coverage 6 of 7 days
    site_conversion: 0.02,
    site_conversion_days: 6,
  },
  P2: {
    gross_sales: 134, // 64 + 28 + 42
    discounts: 4,
    refunds: 0,
    net_sales: 130,
    orders: 3,
    aov: 130 / 3, // 43.33
    units: 4,
    cancelled_orders: 0,
    // sales 130, cost 18 + 9 + 13.20 = 40.20, fees 2.9% × 143.16 + 0.90 = 5.05164
    contribution_before_ads: 84.75,
    cost_coverage: 1,
    ad_spend: 140,
    contribution_after_ads: -55.25, // 84.74836 − 140
    sessions: 700,
    site_conversion: 0.02, // 14 ÷ 700
  },
  P3: {
    gross_sales: 0,
    refunds: 84, // #1004 (Nov 3); #1016's refund waits for its order
    net_sales: -84,
    orders: 0,
    aov: null, // no orders: unavailable, not $0
    units: 0,
    refund_rate: null, // 2 refunded units over 0 ordered: unavailable
    // −84 of costed sales, its 2 restocked units give back 26.40 of cost, no fees: −57.60
    contribution_before_ads: -57.6,
    cost_coverage: null, // no units sold
    ad_spend: 140,
    contribution_after_ads: -197.6,
  },
};

describe('ledger fixture', () => {
  it('seeds every case', () => {
    const db = openDb();
    seedLedgerStore(db);
    const n = (sql: string) => Number(db.prepare(sql).get(LEDGER_STORE)!.n);
    expect(n('SELECT count(*) AS n FROM orders WHERE store_id = ?')).toBe(LEDGER_ORDERS.length);
    expect(n('SELECT count(*) AS n FROM refunds WHERE store_id = ?')).toBe(LEDGER_REFUNDS.length);
    expect(n('SELECT count(*) AS n FROM orders WHERE store_id = ? AND duplicate_of IS NOT NULL')).toBe(2);
    expect(n('SELECT count(*) AS n FROM order_lines WHERE store_id = ? AND cost IS NULL')).toBe(5);
    // the refund that arrived before its order
    expect(n("SELECT count(*) AS n FROM refunds r WHERE r.store_id = ? AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.store_id = r.store_id AND o.id = r.order_id)")).toBe(1);
    // 21 days of daily rows, one per day across the DST change
    expect(n("SELECT count(*) AS n FROM daily_metrics WHERE store_id = ? AND date BETWEEN '2026-10-19' AND '2026-11-08'")).toBe(21);
  });
});

describe('oracle (v1)', () => {
  it('sales metrics: gross_sales, discounts, refunds, net_sales (both refund views), orders, aov, units, cancelled_orders, refund_rate (SA-16)', () => {
    const db = openDb();
    seedLedgerStore(db);
    const cents = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100);
    for (const p of ['P1', 'P2', 'P3'] as const) {
      const { from, to } = LEDGER_PERIODS[p];
      const o: Record<string, number | null> = ORACLE[p];
      const got = salesMetrics(db, LEDGER_STORE, from, to);
      for (const id of ['gross_sales', 'discounts', 'refunds', 'net_sales', 'orders', 'aov', 'units', 'cancelled_orders', 'refund_rate'] as const) {
        if (!(id in o)) continue;
        const v = got[id];
        expect([id, id === 'refund_rate' ? v.value : cents(v.value)], p).toEqual([id, id === 'refund_rate' ? o[id] : cents(o[id]!)]);
        expect([id, v.status], p).toEqual([id, o[id] == null ? 'unavailable' : 'ok']);
      }
      if ('net_sales_order_day' in o) expect(salesMetrics(db, LEDGER_STORE, from, to, 'order_day').net_sales.value, p).toBe(o.net_sales_order_day);
    }
  });
  it('contribution_before_ads, fees and cost_coverage (SA-19)', () => {
    const db = openDb();
    seedLedgerStore(db);
    for (const p of ['P1', 'P2', 'P3'] as const) {
      const { from, to } = LEDGER_PERIODS[p];
      const o: Record<string, number | null> = ORACLE[p];
      const got = costMetrics(db, LEDGER_STORE, from, to);
      expect(got.contribution_before_ads.value, p).toBe(o.contribution_before_ads);
      if (o.cost_coverage == null) expect(got.cost_coverage, p).toMatchObject({ value: null, status: 'unavailable' });
      else expect(got.cost_coverage.value, p).toBeCloseTo(o.cost_coverage, 10);
      if ('fees' in o) expect(got.fees, p).toMatchObject({ value: o.fees, status: 'estimated' });
    }
    // P1 is costed for 11 of 14 units and its fees are estimates; P2 is fully costed.
    expect(costMetrics(db, LEDGER_STORE, LEDGER_PERIODS.P1.from, LEDGER_PERIODS.P1.to).contribution_before_ads).toMatchObject({ status: 'estimated', coverage: { share: 11 / 14, of: 'units with a unit cost' } });
  });
  it('ad_spend, platform_roas and contribution_after_ads (SA-20)', () => {
    const db = openDb();
    seedLedgerStore(db);
    for (const p of ['P1', 'P2', 'P3'] as const) {
      const { from, to } = LEDGER_PERIODS[p];
      const o: Record<string, number | null> = ORACLE[p];
      const { values, networks } = adMetrics(db, LEDGER_STORE, from, to);
      expect(values.ad_spend, p).toMatchObject({ value: o.ad_spend, status: 'ok' });
      expect(values.contribution_after_ads.value, p).toBe(o.contribution_after_ads);
      expect(networks, p).toEqual([{ network: 'meta', name: 'Meta Ads', spend: 140, roas: 2.5, attribution: "Meta's own attribution · attribution setting not recorded" }]);
      if ('platform_roas' in o) expect(values.platform_roas, p).toMatchObject({ value: o.platform_roas, note: "Meta's own attribution · attribution setting not recorded" });
    }
  });
  it('sessions and site_conversion with day coverage (SA-21)', () => {
    const db = openDb();
    seedLedgerStore(db);
    for (const p of ['P1', 'P2'] as const) {
      const { from, to } = LEDGER_PERIODS[p];
      const o: Record<string, number | null> = ORACLE[p];
      const got = trafficMetrics(db, LEDGER_STORE, from, to);
      expect(got.sessions, p).toMatchObject({ value: o.sessions, status: 'ok' });
      expect(got.site_conversion.value, p).toBeCloseTo(o.site_conversion!, 10);
    }
    // P1: Oct 27's purchasing sessions weren't reported: that day is left out and counted in coverage.
    expect(trafficMetrics(db, LEDGER_STORE, LEDGER_PERIODS.P1.from, LEDGER_PERIODS.P1.to).site_conversion).toMatchObject({
      status: 'partial', coverage: { share: ORACLE.P1.site_conversion_days / 7, of: 'days' }, note: '6 of 7 days reported',
    });
  });
});
