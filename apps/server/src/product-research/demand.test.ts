import { expect, test } from 'vitest';
import { classifyDemand, type DemandPoint } from './demand';

/** Weekly points from 2024-11-03 on (Sundays, as Trends dates its weeks), or daily / monthly ones. */
const weekly = (values: number[]): DemandPoint[] => values.map((value, i) => ({ at: new Date(Date.UTC(2024, 10, 3 + 7 * i)).toISOString().slice(0, 10), value }));
const daily = (values: number[]): DemandPoint[] => values.map((value, i) => ({ at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), value }));
const monthly = (values: number[], from = 2024): DemandPoint[] => values.map((value, i) => ({ at: `${from + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`, value }));
const flat = (n: number, v = 40) => Array.from({ length: n }, (_, i) => v + (i % 2 ? 4 : -4)); // steady, CV 0.1
const cls = (p: DemandPoint[], g: 'day' | 'week' | 'month') => classifyDemand(p, g).cls;

test('insufficient history: under 26 weekly, 90 daily or 24 monthly points, or more than half below 1', () => {
  expect([cls(weekly(flat(25)), 'week'), cls(weekly(flat(26)), 'week')]).toEqual(['insufficient_history', 'sustained']);
  expect([cls(daily(flat(89)), 'day'), cls(daily(flat(90)), 'day')]).toEqual(['insufficient_history', 'sustained']);
  expect([cls(monthly(flat(23)), 'month'), cls(monthly(flat(24)), 'month')]).toEqual(['insufficient_history', 'sustained']);
  const half = [...Array(13).fill(0), ...flat(13)];
  expect(cls(weekly(half), 'week')).not.toBe('insufficient_history'); // exactly half: not more than half
  expect(cls(weekly([0, ...half]), 'week')).toBe('insufficient_history');
  expect(classifyDemand(weekly(flat(25)), 'week')).toEqual({ cls: 'insufficient_history', peakMonth: null, momentum: null });
});

test('seasonal: the same month in the top 10% of each of the last two years, and peak at least 2× trough', () => {
  // 104 weeks; every December high. The newest year's December is the peak month.
  const year = (peak: number) => Array.from({ length: 52 }, (_, i) => (i >= 5 && i <= 8 ? peak : 30)); // weeks 5–8 fall in December both years
  const two = weekly([...year(70), ...year(65)]);
  expect(classifyDemand(two, 'week')).toMatchObject({ cls: 'seasonal', peakMonth: 12 });
  expect(cls(weekly([...year(59), ...year(59)]), 'week')).not.toBe('seasonal'); // peak 59 < 2 × 30
  expect(cls(weekly([...year(60), ...year(60)]), 'week')).toBe('seasonal'); // exactly 2×
  expect(cls(weekly([...year(70), ...year(70)].slice(1)), 'week')).not.toBe('seasonal'); // 103 points: not two years
  // The peaks in different months each year: not seasonal.
  const shifted = weekly([...year(70), ...Array.from({ length: 52 }, (_, i) => (i >= 30 && i <= 34 ? 70 : 30))]);
  expect(cls(shifted, 'week')).not.toBe('seasonal');
  // Monthly: July both years.
  const m = monthly([10, 10, 10, 10, 10, 10, 40, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 45, 10, 10, 10, 10, 10]);
  expect(classifyDemand(m, 'month')).toMatchObject({ cls: 'seasonal', peakMonth: 7 });
});

test('isolated spike: the maximum at least 3× the median, with fewer than 3 points above 2× the median', () => {
  const spike = (n: number, top: number) => weekly([...flat(30, 20).map(() => 20), ...Array(n).fill(top)]);
  expect(cls(spike(1, 60), 'week')).toBe('isolated_spike');
  expect(cls(spike(1, 59), 'week')).not.toBe('isolated_spike'); // under 3×
  expect(cls(spike(2, 60), 'week')).toBe('isolated_spike');
  expect(cls(spike(3, 60), 'week')).not.toBe('isolated_spike'); // three points above 2×: a real rise, not a spike
});

test('recent acceleration: the last 13 weeks at least 1.3× the 13 before, the earlier mean at least 5', () => {
  const rise = (before: number, after: number) => weekly([...Array(13).fill(before), ...Array(13).fill(before), ...Array(13).fill(after)]);
  expect(cls(rise(10, 13), 'week')).toBe('recent_acceleration');
  expect(cls(rise(10, 12.9), 'week')).not.toBe('recent_acceleration');
  expect(cls(rise(4.9, 7), 'week')).not.toBe('recent_acceleration'); // too low to read a ratio from
  expect(classifyDemand(rise(10, 13), 'week').momentum).toBe(1.3);
  const d = daily([...Array(90).fill(10), ...Array(90).fill(14)]); // daily: 90 days over the 90 before
  expect(classifyDemand(d, 'day')).toMatchObject({ cls: 'recent_acceleration', momentum: 1.4 });
});

test('sustained interest: median at least 20 and coefficient of variation at most 0.5; otherwise no clear pattern', () => {
  expect(cls(weekly(flat(30, 20)), 'week')).toBe('sustained');
  expect(cls(weekly(flat(30, 19)), 'week')).toBe('no_clear_pattern'); // median 19
  const wide = (spread: number) => weekly(Array.from({ length: 30 }, (_, i) => 40 + (i % 2 ? spread : -spread))); // CV = spread / 40
  expect(cls(wide(20), 'week')).toBe('sustained'); // CV 0.5
  expect(cls(wide(21), 'week')).toBe('no_clear_pattern');
});

test('precedence follows decision 9: a seasonal set that also rose recently is seasonal; momentum is kept either way', () => {
  const year = (peak: number) => Array.from({ length: 52 }, (_, i) => (i >= 5 && i <= 8 ? peak : 30));
  const lastYear = year(70).map((v, i) => (i >= 39 ? v * 2 : v)); // the last 13 weeks doubled too
  const d = classifyDemand(weekly([...year(70), ...lastYear]), 'week');
  expect(d.cls).toBe('seasonal');
  expect(d.momentum).toBe(2);
});
