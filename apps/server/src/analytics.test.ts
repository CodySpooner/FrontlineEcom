import { expect, test } from 'vitest';
import type { AnalyticsSummary, CampaignStats } from '@frontline/shared';
import { createApp } from './app';
import { openDb } from './db';
import { seedDemo } from './demo';
import { campaignStats, summarize, totalsOf, type MetricRow } from './analytics';

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

test('funnel: period totals of sessions, add to carts, checkouts and orders', () => {
  const s = summarize(
    [
      { ...row('a', '2026-10-26', 100, 10, 30, 2), sessions: 500, addToCarts: 40, checkouts: 12 },
      { ...row('a', '2026-10-25', 100, 10, 30, 3), sessions: 400, addToCarts: 30, checkouts: 9 },
      { ...row('a', '2026-10-19', 100, 10, 30, 9), sessions: 9999 }, // previous period: not counted
    ],
    { range: 7, to: '2026-10-26', storeIds: ['a'] },
  );
  expect(s.funnel).toEqual({ sessions: 900, addToCarts: 70, checkouts: 21, orders: 5 });
});

test('campaign stats over the period, folded statuses, biggest spend first; GET /api/analytics/campaigns', async () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  db.prepare("INSERT INTO campaigns (network, id, store_id, name, status, daily_budget) VALUES ('meta', 'old', 'glow', 'Old test', 'deleted', 0)").run();
  db.prepare("INSERT INTO campaign_daily (network, campaign_id, date, spend, revenue, purchases, clicks, impressions) VALUES ('meta', 'old', '2026-10-01', 50, 0, 0, 10, 100)").run();
  const week = campaignStats(db, ['glow'], '2026-10-20', '2026-10-26');
  expect(week.length).toBe(5);
  expect(week.map((c) => c.spend)).toEqual([...week.map((c) => c.spend)].sort((a, b) => b - a));
  expect(week.find((c) => c.id === 'old')).toMatchObject({ status: 'archived', spend: 0, roas: 0 });
  const top = week[0]!;
  expect(top.roas).toBeCloseTo(top.revenue / top.spend, 1);
  expect(campaignStats(db, ['glow'], '2026-10-01', '2026-10-26').find((c) => c.id === 'old')).toMatchObject({ spend: 50, clicks: 10 });

  const app = createApp(db);
  const res = (await (await app.request('/api/analytics/campaigns?stores=glow,peak&range=7')).json()) as CampaignStats[];
  expect(new Set(res.map((c) => c.storeId))).toEqual(new Set(['glow', 'peak']));
  expect((await app.request('/api/analytics/campaigns?range=12')).status).toBe(400);
});
