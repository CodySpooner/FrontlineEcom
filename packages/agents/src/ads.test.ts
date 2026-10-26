import { expect, test } from 'vitest';
import { reviewCampaigns, thresholds, type CampaignStats } from './index';

const econ = { margin: 0.5, aov: 40 };

test('break-even ROAS, target and max CPA come from margin and AOV', () => {
  expect(thresholds(econ)).toEqual({ breakEven: 2, target: 2.6, maxCpa: 20 });
});

test('verdicts follow the playbook decision rules', () => {
  const c = (id: string, spend: number, revenue: number, status = 'active'): CampaignStats => ({ network: 'meta', id, name: id, status, dailyBudget: 100, spend, revenue, purchases: 10 });
  const out = reviewCampaigns([c('new', 30, 200), c('win', 100, 300), c('ok', 100, 220), c('meh', 100, 150), c('bad', 100, 100), c('off', 100, 50, 'paused')], econ);
  expect(out.map((r) => [r.id, r.verdict, r.suggestedBudget])).toEqual([
    ['new', 'learning', 100],
    ['win', 'scale', 120],
    ['ok', 'hold', 100],
    ['meh', 'cut', 50],
    ['bad', 'pause', 0],
    ['off', 'paused', 100],
  ]);
  expect(out[1]).toMatchObject({ roas: 3, cpa: 10 });
});
