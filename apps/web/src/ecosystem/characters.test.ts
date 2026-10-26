import { expect, test } from 'vitest';
import { ANIMATIONS, CELL, SHEET, appearanceFor, frameAt, type Direction } from './characters';

test('thirty workers have deterministic varied identities and every animation fits their atlas cell', () => {
  expect(new Set(Array.from({ length: 30 }, (_, i) => JSON.stringify(appearanceFor(`agent-${i}`)))).size).toBe(30);
  expect(appearanceFor('glow:copywriter')).toEqual(appearanceFor('glow:copywriter'));
  for (let worker=0;worker<30;worker++) for (const animation of ANIMATIONS) for(let direction=0;direction<4;direction++) {
    const p=frameAt(animation,500,direction as Direction,worker);
    expect(p.x).toBeGreaterThanOrEqual((worker%6)*SHEET.width);
    expect(p.x+CELL.width).toBeLessThanOrEqual((worker%6+1)*SHEET.width);
    expect(p.y+CELL.height).toBeLessThanOrEqual((Math.floor(worker/6)+1)*SHEET.height);
  }
  expect(frameAt('complete',2000,0,0)).toEqual(frameAt('sit',2000,0,0));
});
