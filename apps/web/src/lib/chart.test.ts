import { describe, expect, it } from 'vitest';
import { niceMax, sparkPoints, weekly } from './chart';

describe('chart helpers', () => {
  it('rounds axis maxima to nice numbers', () => {
    expect(niceMax(3700)).toBe(4000);
    expect(niceMax(2600)).toBe(3000);
    expect(niceMax(1400)).toBe(1500);
    expect(niceMax(81)).toBe(100);
    expect(niceMax(0)).toBe(1);
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
