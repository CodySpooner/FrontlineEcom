import { expect, test } from 'vitest';
import { OFFICE_DESKS, OFFICE_GRID } from '@frontline/shared';
import { DESKS, ENTRANCE, ROOMS, ROOM_SIZE, deskTile, iso, uniso, walkable } from './world';
import { nearestFree } from './pathfinding';

test('all thirty shared desks have unique, walkable seats in ten rooms', () => {
  expect(ROOMS).toHaveLength(10);
  expect(DESKS.map((d) => d.id)).toEqual(OFFICE_DESKS.map((d) => d.id));
  expect(new Set(DESKS.map((d) => JSON.stringify(deskTile(d.id)))).size).toBe(30);
  for (const d of DESKS) { expect(walkable(d)).toBe(false); expect(walkable(deskTile(d.id))).toBe(true); }
  expect(walkable(ENTRANCE)).toBe(true);
  for (const room of ROOMS) for (const x of [10, 11]) for (const y of [10, 11]) expect(walkable({ x: room.x + x, y: room.y + y })).toBe(false);
  expect(walkable({ x: -1, y: 0 })).toBe(false);
});
test('expanded departments leave four-tile corridors and displaced saves use a nearby free tile', () => {
  expect(OFFICE_GRID.width * OFFICE_GRID.height).toBeGreaterThan(36 * 27 * 3);
  for (const a of ROOMS) for (const b of ROOMS) if (a !== b) expect(Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))).toBeGreaterThanOrEqual(ROOM_SIZE + 4);
  const saved = DESKS[0]!, restored = nearestFree(saved, new Set())!;
  expect(walkable(restored)).toBe(true);
  expect(Math.abs(restored.x - saved.x) + Math.abs(restored.y - saved.y)).toBe(1);
});
test('isometric tile centers round trip for pointer selection', () => {
  for (const d of DESKS) expect(uniso(iso({ x: d.x + 0.5, y: d.y + 0.5 }))).toEqual({ x: d.x, y: d.y });
});
