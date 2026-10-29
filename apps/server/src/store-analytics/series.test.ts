// SA-23: computeSeries and GET /api/analytics/series.
import type { SaMetricId, SaSeries } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { LEDGER_NOW, LEDGER_PERIODS, LEDGER_STORE, seedLedgerStore } from './fixture';
import { computeSeries } from './metric-set';
import { storePeriod, type StorePeriod } from './period';

const { P1 } = LEDGER_PERIODS;
const sum = (s: SaSeries) => s.points.reduce((a, p) => a + (p.value ?? 0), 0);

describe('computeSeries', () => {
  it('additive metrics sum to the /metrics total; the 25-hour DST day is one point', () => {
    const db = openDb();
    seedLedgerStore(db);
    const sp = storePeriod(db, LEDGER_STORE, (k) => ({ period: 'custom', from: P1.from, to: P1.to })[k as 'period'], LEDGER_NOW) as StorePeriod;
    for (const id of ['net_sales', 'gross_sales', 'refunds', 'orders', 'units', 'ad_spend', 'fees', 'contribution_before_ads', 'contribution_after_ads'] as SaMetricId[]) {
      const s = computeSeries(db, { storeId: LEDGER_STORE }, id, sp);
      expect(s.grain).toBe('day');
      expect(s.points.map((p) => p.from)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
      expect(sum(s), id).toBeCloseTo(s.total.value!, 1);
    }
    const net = computeSeries(db, { storeId: LEDGER_STORE }, 'net_sales', sp);
    // Oct 31 had no countable sale: a real zero day; the comparison sits at the same offset (P2's days)
    expect(net.points[5]).toMatchObject({ from: '2026-10-31', value: 0, previous: 0 });
    expect(net.points[1]).toMatchObject({ from: '2026-10-27', value: 84, previous: 60 }); // #1004 vs Oct 20's #1001 (64 − 4)
  });

  it('days with no report are null, never 0; today is flagged partial', () => {
    const db = openDb();
    seedLedgerStore(db);
    db.prepare("UPDATE daily_metrics SET sessions = 0 WHERE store_id = 'ledger' AND date = '2026-11-08'").run();
    const sp = storePeriod(db, LEDGER_STORE, (k) => ({ period: 'last7' })[k as 'period'], LEDGER_NOW) as StorePeriod;
    const s = computeSeries(db, { storeId: LEDGER_STORE }, 'sessions', sp);
    expect(s.points.at(-1)).toMatchObject({ from: '2026-11-08', value: null, status: 'unavailable' });
    const today = storePeriod(db, LEDGER_STORE, (k) => ({ period: 'mtd' })[k as 'period'], LEDGER_NOW) as StorePeriod;
    const mtd = computeSeries(db, { storeId: LEDGER_STORE }, 'orders', today);
    expect(mtd.points.at(-1)).toMatchObject({ from: '2026-11-09', partial: true });
    expect(mtd.points.filter((p) => p.partial)).toHaveLength(1);
  });

  it('weekly points past 120 days', () => {
    const db = openDb();
    seedDemo(db, '2026-10-26');
    const sp = storePeriod(db, 'glow', (k) => ({ period: 'last365' })[k as 'period'], Date.parse('2026-10-26T18:00:00')) as StorePeriod;
    const s = computeSeries(db, { storeId: 'glow' }, 'net_sales', sp);
    expect(s.grain).toBe('week');
    expect(s.points).toHaveLength(53); // 52 full weeks and one day
    expect(s.points.at(-1)).toMatchObject({ from: '2026-10-25', to: '2026-10-25' });
    expect(sum(s)).toBeCloseTo(s.total.value!, 0);
  });
});

describe('GET /api/analytics/series', () => {
  it('needs one known metric', async () => {
    const db = openDb();
    seedDemo(db);
    const app = createApp(db);
    const res = await app.request('/api/analytics/series?store=glow&metric=orders&period=last7');
    expect(res.status).toBe(200);
    expect(((await res.json()) as SaSeries).points).toHaveLength(7);
    expect((await app.request('/api/analytics/series?store=glow')).status).toBe(400);
    expect((await app.request('/api/analytics/series?store=glow&metric=profit')).status).toBe(400);
  });
});
