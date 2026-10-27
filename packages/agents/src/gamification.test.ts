import { storeHealth } from '@frontline/shared';
import { expect, test } from 'vitest';
import { ACHIEVEMENTS, dailyMissions, demoXp, levelForXp, levelProgress, profitStreak, rankForLevel, xpForLevel, type Facts, type StoreDay } from './index';

test('long-run achievements: a 30-day profit streak and Elite / Legend agents', () => {
  const none: Facts = { orders: 0, best30Revenue: 0, best7Roas: 0, profitStreak: 0, fullSquad: false, runsDone: 0, approved: 0, memories: 0, topLevel: 1, wins: 0, liveStores: 0 };
  const unlocked = (f: Partial<Facts>) => ACHIEVEMENTS.filter((a) => a.check({ ...none, ...f })).map((a) => a.id);
  expect(unlocked({ profitStreak: 29, topLevel: 19 })).toEqual(['profit_streak_7', 'battle_hardened']);
  expect(unlocked({ profitStreak: 30, topLevel: 30 })).toEqual(['profit_streak_7', 'battle_hardened', 'profit_streak_30', 'elite_agent', 'legend_agent']);
  expect(unlocked({ liveStores: 1 })).toEqual(['open_for_business']); // demo stores never count
});

test('level curve: each level costs 100 more than the last', () => {
  expect([1, 2, 3, 5, 10].map(xpForLevel)).toEqual([0, 100, 300, 1000, 4500]);
  expect([0, 99, 100, 299, 300, 4499, 4500].map(levelForXp)).toEqual([1, 1, 2, 2, 3, 9, 10]);
  expect(levelProgress(150)).toEqual({ xp: 50, needed: 200 });
});

test('ranks by level', () => {
  expect([1, 4, 5, 10, 15, 20, 29, 30, 80].map(rankForLevel)).toEqual(['Recruit', 'Recruit', 'Operative', 'Specialist', 'Veteran', 'Elite', 'Elite', 'Legend', 'Legend']);
});

test('store health: bleeding when losing money, winning from 15% net margin', () => {
  expect(storeHealth({ revenue: 10_000, profit: 2_000 })).toEqual({ status: 'winning', marginPct: 20, bar: 2 / 3 });
  expect(storeHealth({ revenue: 10_000, profit: 1_499 })).toMatchObject({ status: 'winning', marginPct: 15 }); // judged on the margin shown
  expect(storeHealth({ revenue: 10_000, profit: 1_449 })).toMatchObject({ status: 'steady', marginPct: 14.5 });
  expect(storeHealth({ revenue: 10_000, profit: -1 })).toMatchObject({ status: 'bleeding', bar: 0 });
  expect(storeHealth({ revenue: 0, profit: 0 })).toEqual({ status: 'steady', marginPct: 0, bar: 0 });
  expect(storeHealth({ revenue: 100, profit: 60 }).bar).toBe(1);
});

test('profit streak counts back from today; today counts once profitable and does not break it before', () => {
  expect(profitStreak([{ profit: 5 }, { profit: -1 }, { profit: 2 }, { profit: 3 }])).toBe(2);
  expect(profitStreak([...Array(29).fill({ profit: 40 }), { profit: -12 }])).toBe(29); // 7am: ad spend ahead of orders
  expect(profitStreak([{ profit: 1 }, { profit: -3 }, { profit: 0 }])).toBe(0);
  expect(profitStreak([])).toBe(0);
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
  // $50 in the store's currency, to one figure: not ¥50 (a third of a dollar) for 100 XP.
  expect(dailyMissions({ ...day, currency: 'JPY', usdRate: 152.3, avgRevenue: 0 })[0]).toMatchObject({ title: 'Hit ¥8,000 revenue today', target: 8000 });
  expect(dailyMissions({ ...day, currency: 'JPY', usdRate: 152.3, avgRevenue: 101_000 })[0]?.target).toBe(112_000);
  expect(dailyMissions({ ...day, currency: 'GBP', usdRate: 0.79, avgRevenue: 0 })[0]?.title).toBe('Hit £40 revenue today');
  expect(quiet[2]).toMatchObject({ title: 'Give your squad 2 tasks', progress: 2, target: 2 });
});

test('the squad mission follows which agents are on, alternating by day when both are', () => {
  const both = { ...day, creativeAgentsOn: true, productHunterOn: true, creativesToday: 3, productsApprovedToday: 0 };
  expect(dailyMissions(both)[3]).toEqual({ id: 'glow:2026-10-26:creatives', storeId: 'glow', title: 'Launch 2 new creatives', progress: 2, target: 2, xp: 50 });
  expect(dailyMissions({ ...both, date: '2026-10-27' })[3]).toEqual({ id: 'glow:2026-10-27:product', storeId: 'glow', title: 'Approve a product to test', progress: 0, target: 1, xp: 50 });
  expect(dailyMissions({ ...both, creativeAgentsOn: false })[3]?.title).toBe('Approve a product to test');
  expect(dailyMissions({ ...both, date: '2026-10-27', productHunterOn: false })[3]?.title).toBe('Launch 2 new creatives');
  expect(dailyMissions({ ...both, creativeAgentsOn: false, productHunterOn: false })).toHaveLength(3);
});
