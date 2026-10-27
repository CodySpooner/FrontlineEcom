import { expect, test } from 'vitest';
import { backdropOffset } from './backdrop';

test('parallax stays inside the texture overscan and freezes for reduced motion', () => {
  for (const pan of [{ x: 0, y: 0 }, { x: 9000, y: -9000 }, { x: -100000, y: 100000 }]) {
    const p = backdropOffset(pan, false);
    expect(Math.abs(p.x)).toBeLessThanOrEqual(20); expect(Math.abs(p.y)).toBeLessThanOrEqual(12);
    expect(backdropOffset(pan, true)).toEqual({ x: 0, y: 0 });
  }
});
