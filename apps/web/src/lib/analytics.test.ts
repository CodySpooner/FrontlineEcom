import { describe, expect, it } from 'vitest';
import type { AnalyticsSummary, MetricTotals } from '@frontline/shared';
import { stubCampaigns, stubFunnel } from '../api/stubs';
import { breakEvenRoas, byNetwork, rate, roasTone } from './analytics';

const totals: MetricTotals = { revenue: 10_000, profit: 2_000, adSpend: 3_000, roas: 3.33, orders: 200, aov: 50 };

describe('break-even ROAS', () => {
  it('is revenue over gross margin', () => {
    // gross = 10k − cogs 5k = 5k → break-even 2×
    expect(breakEvenRoas(totals)).toBe(2);
    expect(breakEvenRoas({ ...totals, profit: -3_000 })).toBe(Infinity);
  });

  it('tones ROAS against break-even', () => {
    expect([roasTone(1.9, 2), roasTone(2, 2), roasTone(2.9, 2), roasTone(3, 2)]).toEqual(['bad', 'ok', 'ok', 'good']);
  });
});

describe('byNetwork', () => {
  it('sums per network and recomputes ROAS', () => {
    const c = { id: '', storeId: 's', name: '', status: 'active' as const, dailyBudget: 0, clicks: 0, impressions: 0 };
    const out = byNetwork([
      { ...c, network: 'meta', spend: 100, revenue: 200, purchases: 4, roas: 2 },
      { ...c, network: 'tiktok', spend: 50, revenue: 300, purchases: 6, roas: 6 },
      { ...c, network: 'meta', spend: 100, revenue: 400, purchases: 8, roas: 4 },
    ]);
    expect(out).toEqual([
      { network: 'meta', spend: 200, revenue: 600, purchases: 12, roas: 3 },
      { network: 'tiktok', spend: 50, revenue: 300, purchases: 6, roas: 6 },
    ]);
  });
});

describe('UI-11 stubs', () => {
  const s = { range: 30, storeIds: [], from: '', to: '', totals, previous: totals, deltas: totals, series: Array(30).fill(null), byStore: [{ storeId: 'a', totals, deltas: totals }] } as unknown as AnalyticsSummary;

  it('campaigns split the real ad spend', () => {
    const cs = stubCampaigns(s);
    expect(cs.reduce((n, c) => n + c.spend, 0)).toBe(totals.adSpend);
    expect(cs.map((c) => c.spend)).toEqual([...cs.map((c) => c.spend)].sort((a, b) => b - a));
  });

  it('funnel narrows and ends at the real orders', () => {
    const f = stubFunnel(s);
    expect(f.orders).toBe(200);
    expect(f.sessions > f.addToCarts && f.addToCarts > f.checkouts && f.checkouts > f.orders).toBe(true);
    expect(rate(f.orders, f.sessions)).toBeGreaterThan(1.9);
  });
});
