import { expect, test } from 'vitest';
import { storeHealth } from './index';

test('store health: bleeding when losing money, winning from 15% net margin', () => {
  expect(storeHealth({ revenue: 10_000, profit: 2_000 })).toEqual({ status: 'winning', marginPct: 20, bar: 2 / 3 });
  expect(storeHealth({ revenue: 10_000, profit: 1_499 })).toMatchObject({ status: 'winning', marginPct: 15 }); // judged on the margin shown
  expect(storeHealth({ revenue: 10_000, profit: 1_449 })).toMatchObject({ status: 'steady', marginPct: 14.5 });
  expect(storeHealth({ revenue: 10_000, profit: -1 })).toMatchObject({ status: 'bleeding', bar: 0 });
  expect(storeHealth({ revenue: 0, profit: 0 })).toEqual({ status: 'steady', marginPct: 0, bar: 0 });
  expect(storeHealth({ revenue: 100, profit: 60 }).bar).toBe(1);
});
