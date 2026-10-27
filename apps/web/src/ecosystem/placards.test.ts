import { expect, test } from 'vitest';
import { createDemo } from './demo';
import { departmentCounts } from './placards';

test('department signs count deployed seats, including offline workers, and exclude archives', () => {
  const { seats } = createDemo();
  const counts = departmentCounts(seats);
  expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(30);
  expect(counts.executive).toBe(2); expect(counts.research).toBe(4);
  expect(departmentCounts(seats.map((s, i) => i === 0 ? { ...s, archived: true } : s)).executive).toBe(1);
  expect(Object.values(departmentCounts([])).every((v) => v === 0)).toBe(true);
});
