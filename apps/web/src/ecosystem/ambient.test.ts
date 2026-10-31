import { expect, test } from 'vitest';
import { AMBIENT_ROUTES, ambientPosition, idleMoment, specialistIdle } from './ambient';
import { walkable } from './world';

test('maintenance routes stay in clear corridors and freeze when motion is disabled', () => {
  for (const route of AMBIENT_ROUTES) for (let t = 0; t < 400000; t += 1400) {
    const p = ambientPosition(route, t, 0, false);
    expect(walkable({ x: Math.round(p.x), y: Math.round(p.y) })).toBe(true);
    expect(ambientPosition(route, t, 24, true)).toEqual(ambientPosition(route, 0, 24, true));
  }
  expect(idleMoment(11000, 0, false)).toBe(1);
  expect(idleMoment(18000, 0, false)).toBe(2);
  expect(idleMoment(20000, 0, false)).toBe(0);
  expect(idleMoment(11000, 0, true)).toBe(0);
});


test('personal gestures spend most of their time still and remain stable for an identity', () => {
  const gestures=(id:string,role:string)=>Array.from({length:800},(_,i)=>specialistIdle(i*100,id,role,false));
  const a=gestures('glow:copywriter','copywriter'), b=gestures('paws:operations','operations');
  expect(a).toEqual(gestures('glow:copywriter','copywriter'));
  expect(a).not.toEqual(b);
  expect(a.filter(Boolean).length/a.length).toBeLessThan(.1);
  expect(new Set(a)).toEqual(new Set([0,1,2]));
  for(let t=0;t<100000;t+=1300)expect(specialistIdle(t,'glow:copywriter','copywriter',true)).toBe(0);
});
