import { expect, test } from 'vitest';
import type { AnalyticsSummary } from '@frontline/shared';
import { createApp } from './app';
import { openDb } from './db';
import { seedDemo } from './demo';
import { summarize, totalsOf, type MetricRow } from './analytics';

const row = (storeId: string, date: string, revenue: number, adSpend: number, cogs: number, orders: number): MetricRow => ({ storeId, date, revenue, adSpend, cogs, orders });

test('totals: profit, ROAS and AOV follow DESIGN §6, zero-safe', () => {
  expect(totalsOf([row('a', '2026-10-01', 1000, 250, 300, 20), row('a', '2026-10-02', 500, 250, 150, 10)])).toEqual({
    revenue: 1500, profit: 550, adSpend: 500, roas: 3, orders: 30, aov: 50,
  });
  expect(totalsOf([])).toEqual({ revenue: 0, profit: 0, adSpend: 0, roas: 0, orders: 0, aov: 0 });
});

test('summary compares against the immediately preceding period of the same length', () => {
  const rows = [
    // previous period (Oct 19–25)
    row('a', '2026-10-19', 100, 50, 20, 2),
    row('b', '2026-10-25', 100, 50, 20, 2),
    // current period (Oct 26 – Nov 1)
    row('a', '2026-10-26', 300, 100, 60, 6),
    row('b', '2026-11-01', 100, 0, 20, 2),
    // outside both periods
    row('a', '2026-10-18', 9999, 9999, 9999, 99),
  ];
  const s = summarize(rows, { range: 7, to: '2026-11-01', storeIds: ['a', 'b'] });
  expect(s.from).toBe('2026-10-26');
  expect(s.to).toBe('2026-11-01');
  expect(s.totals).toEqual({ revenue: 400, profit: 220, adSpend: 100, roas: 4, orders: 8, aov: 50 });
  expect(s.previous).toEqual({ revenue: 200, profit: 60, adSpend: 100, roas: 2, orders: 4, aov: 50 });
  expect(s.deltas).toEqual({ revenue: 100, profit: 266.67, adSpend: 0, roas: 100, orders: 100, aov: 0 });
  expect(s.series).toHaveLength(7);
  expect(s.series[0]).toEqual({ date: '2026-10-26', revenue: 300, profit: 140, adSpend: 100, roas: 3, orders: 6, aov: 50 });
  expect(s.series[3]).toEqual({ date: '2026-10-29', revenue: 0, profit: 0, adSpend: 0, roas: 0, orders: 0, aov: 0 });
  expect(s.byStore.map((b) => [b.storeId, b.totals.revenue, b.deltas.revenue])).toEqual([['a', 300, 200], ['b', 100, 0]]);
});

test('negative previous profit gives a sign-correct delta', () => {
  const s = summarize([row('a', '2026-10-31', 100, 100, 50, 1), row('a', '2026-11-01', 100, 20, 30, 1)], { range: 1 as 7, to: '2026-11-01', storeIds: ['a'] });
  // previous profit -50 → current 50: +200%
  expect(s.deltas.profit).toBe(200);
});

test('GET /api/analytics/summary filters stores and validates range', async () => {
  const db = openDb();
  seedDemo(db);
  const app = createApp(db);
  const all = (await (await app.request('/api/analytics/summary?range=30')).json()) as AnalyticsSummary;
  expect(all.storeIds).toEqual(['pawsome', 'glow', 'peak']);
  expect(all.series).toHaveLength(30);
  expect(all.totals.revenue).toBeGreaterThan(0);
  const one = (await (await app.request('/api/analytics/summary?stores=peak,nope&range=7')).json()) as AnalyticsSummary;
  expect(one.storeIds).toEqual(['peak']);
  expect(one.byStore).toHaveLength(1);
  expect(one.totals.revenue).toBeLessThan(all.totals.revenue);
  expect((await app.request('/api/analytics/summary?range=12')).status).toBe(400);
});
