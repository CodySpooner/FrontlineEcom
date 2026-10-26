import { expect, test } from 'vitest';
import { dailyMissions, demoXp, levelForXp, levelProgress, profitStreak, rankForLevel, xpForLevel, type StoreDay } from './index';

test('level curve: each level costs 100 more than the last', () => {
  expect([1, 2, 3, 5, 10].map(xpForLevel)).toEqual([0, 100, 300, 1000, 4500]);
  expect([0, 99, 100, 299, 300, 4499, 4500].map(levelForXp)).toEqual([1, 1, 2, 2, 3, 9, 10]);
  expect(levelProgress(150)).toEqual({ xp: 50, needed: 200 });
});

test('ranks by level', () => {
  expect([1, 4, 5, 10, 15, 20, 29, 30, 80].map(rankForLevel)).toEqual(['Recruit', 'Recruit', 'Operative', 'Specialist', 'Veteran', 'Elite', 'Elite', 'Legend', 'Legend']);
});

test('profit streak counts back from the last day', () => {
  expect(profitStreak([{ profit: 5 }, { profit: -1 }, { profit: 2 }, { profit: 3 }])).toBe(2);
  expect(profitStreak([{ profit: 1 }, { profit: 0 }])).toBe(0);
});

test('demo XP is stable and varied', () => {
  expect(demoXp('glow:copywriter')).toBe(demoXp('glow:copywriter'));
  const all = ['a', 'b', 'c', 'd', 'e'].map(demoXp);
  expect(new Set(all).size).toBe(5);
  expect(all.every((x) => x >= 150 && x < 6000)).toBe(true);
});

const day: StoreDay = {
  storeId: 'glow',
  date: '2026-10-26',
  currency: 'USD',
  revenueToday: 512.7,
  ordersToday: 11,
  avgRevenue: 700,
  avgOrders: 9.2,
  requestsOpen: 2,
  requestsDecidedToday: 1,
  runsToday: 0,
};

test('daily missions stretch the recent average and track requests', () => {
  expect(dailyMissions(day)).toEqual([
    { id: 'glow:2026-10-26:revenue', storeId: 'glow', title: 'Hit $800 revenue today', progress: 512, target: 800, xp: 100 },
    { id: 'glow:2026-10-26:orders', storeId: 'glow', title: 'Get 11 orders today', progress: 11, target: 11, xp: 60 },
    { id: 'glow:2026-10-26:requests', storeId: 'glow', title: 'Clear all agent requests', progress: 1, target: 3, xp: 40 },
  ]);
  const quiet = dailyMissions({ ...day, currency: 'EUR', avgRevenue: 0, requestsOpen: 0, requestsDecidedToday: 0, runsToday: 5 });
  expect(quiet[0]?.title).toBe('Hit €50 revenue today');
  expect(quiet[2]).toMatchObject({ title: 'Give your squad 2 tasks', progress: 2, target: 2 });
});
