import { expect, test } from 'vitest';
import { advanceFrame, advanceMotion, findPath, nearestFree, startMotion } from './pathfinding';
import { DESKS, ENTRANCE, deskTile, tileKey, walkable } from './world';

test('A* reaches every workstation without crossing furniture or reserved tiles', () => {
  for (const desk of DESKS) {
    const goal = deskTile(desk.id), path = findPath(ENTRANCE, goal);
    expect(path.at(-1)).toEqual(goal);
    let previous = ENTRANCE;
    for (const tile of path) { expect(walkable(tile)).toBe(true); expect(Math.abs(tile.x - previous.x) + Math.abs(tile.y - previous.y)).toBe(1); previous = tile; }
    expect(findPath(ENTRANCE, goal, new Set([tileKey(goal)]))).toEqual([]);
  }
  expect(findPath({ x: -1, y: 0 }, ENTRANCE)).toEqual([]);
  expect(findPath(ENTRANCE, { x: 0, y: 0 })).toEqual([]);
  expect(findPath(ENTRANCE, ENTRANCE)).toEqual([]);
});

test('thirty workers reach distinct desks without occupying or reserving the same tile', () => {
  const occupied = new Set<string>(), motions = new Map();
  for (const desk of DESKS) { const start = nearestFree(ENTRANCE, occupied)!; occupied.add(tileKey(start)); motions.set(desk.id, startMotion(start, deskTile(desk.id))); }
  const arrived = new Set<string>();
  for (let step = 0; step < 4000 && arrived.size < 30; step++) {
    advanceMotion(motions, .05).forEach((id) => arrived.add(id));
    const reservations = [...motions.values()].flatMap((m) => [tileKey(m.cell), ...(m.next ? [tileKey(m.next)] : [])]);
    expect(new Set(reservations).size).toBe(reservations.length);
  }
  expect(arrived.size).toBe(30);
});

test('throttled frames catch up in collision-safe steps and cap long pauses', () => {
  const create = () => new Map([['a', startMotion(ENTRANCE, { x: 17, y: 22 })], ['b', startMotion({ x: 18, y: 26 }, { x: 17, y: 25 })]]);
  const smooth = create(), throttled = create(), paused = create();
  const arrivals = new Set<string>();
  for (let i = 0; i < 20; i++) advanceMotion(smooth, .05).forEach((id) => arrivals.add(id));
  expect(advanceFrame(throttled, 1000)).toEqual([...arrivals]);
  advanceFrame(paused, 60_000);
  for (const id of ['a', 'b']) {
    expect(throttled.get(id)!.position.x).toBeCloseTo(smooth.get(id)!.position.x);
    expect(throttled.get(id)!.position.y).toBeCloseTo(smooth.get(id)!.position.y);
    expect(paused.get(id)!.position).toEqual(throttled.get(id)!.position);
  }
  const reservations = [...throttled.values()].flatMap((m) => [tileKey(m.cell), ...(m.next ? [tileKey(m.next)] : [])]);
  expect(new Set(reservations).size).toBe(reservations.length);
});
