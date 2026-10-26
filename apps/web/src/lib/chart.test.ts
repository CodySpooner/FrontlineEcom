import { describe, expect, it } from 'vitest';
import { niceTicks, sparkPoints, weekly } from './chart';

describe('chart helpers', () => {
  it('picks 3-5 round axis steps, never quarter values like 2,250', () => {
    expect(niceTicks(2640)).toEqual([0, 1000, 2000, 3000]);
    expect(niceTicks(4070)).toEqual([0, 1000, 2000, 3000, 4000, 5000]);
    expect(niceTicks(800)).toEqual([0, 200, 400, 600, 800]);
    expect(niceTicks(1001)).toEqual([0, 500, 1000, 1500]);
    expect(niceTicks(0.3)).toEqual([0, 0.1, 0.2, 0.3]);
    expect(niceTicks(0)).toEqual([0, 1]);
    for (const v of [7, 93, 1234, 56789, 2.5e6]) {
      const t = niceTicks(v);
      expect(t.length - 1).toBeGreaterThanOrEqual(3);
      expect(t.length - 1).toBeLessThanOrEqual(5);
      expect(t.at(-1)).toBeGreaterThanOrEqual(v);
    }
  });
  it('buckets a year into weeks that end on the last day', () => {
    const pts = Array.from({ length: 365 }, (_, i) => ({ date: `d${i}`, value: 1 }));
    const w = weekly(pts);
    expect(w).toHaveLength(52);
    expect(w.every((b) => b.value === 7)).toBe(true);
    expect(w.at(-1)!.date).toBe('d364');
    expect(w[0]!.date).toBe('d7'); // d0 is the dropped partial week
  });
  it('draws a flat sparkline without dividing by zero', () => {
    expect(sparkPoints([5, 5, 5])).toBe('0.0,28.0 50.0,28.0 100.0,28.0');
    expect(sparkPoints([7])).toBe('0.0,28.0');
  });
});
