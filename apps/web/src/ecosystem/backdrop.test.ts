import { expect, test } from 'vitest';
import { backdropOffset, trafficPosition } from './backdrop';

test('parallax stays inside the texture overscan and freezes for reduced motion', () => {
  for (const pan of [{ x: 0, y: 0 }, { x: 9000, y: -9000 }, { x: -100000, y: 100000 }]) {
    const p = backdropOffset(pan, false);
    expect(Math.abs(p.x)).toBeLessThanOrEqual(20); expect(Math.abs(p.y)).toBeLessThanOrEqual(12);
    expect(backdropOffset(pan, true)).toEqual({ x: 0, y: 0 });
  }
});
test('distant traffic loops within the skyline and remains stationary in reduced motion', () => {
  for (let i=0;i<4;i++) {
    const start=trafficPosition(0,i,900,600,false), loop=trafficPosition(18000+i*7000,i,900,600,false);
    expect(start.x).toBeCloseTo(loop.x); expect(start.y).toBeCloseTo(loop.y);
    expect(trafficPosition(50000,i,900,600,true)).toEqual(trafficPosition(0,i,900,600,true));
    for (let t=0;t<60000;t+=250) {
      const p=trafficPosition(t,i,900,600,false);
      expect(p.x).toBeGreaterThanOrEqual(-48);expect(p.x).toBeLessThanOrEqual(948);
      expect(p.y).toBeGreaterThan(0);expect(p.y).toBeLessThan(600);
    }
  }
});
