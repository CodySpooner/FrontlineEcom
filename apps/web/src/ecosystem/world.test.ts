import { expect, test } from 'vitest';
import { OFFICE_DESKS } from '@frontline/shared';
import { DESKS, ENTRANCE, ROOMS, deskTile, iso, uniso, walkable } from './world';

test('all thirty shared desks have unique, walkable seats in ten rooms', () => {
  expect(ROOMS).toHaveLength(10);
  expect(DESKS.map((d) => d.id)).toEqual(OFFICE_DESKS.map((d) => d.id));
  expect(new Set(DESKS.map((d) => JSON.stringify(deskTile(d.id)))).size).toBe(30);
  for (const d of DESKS) { expect(walkable(d)).toBe(false); expect(walkable(deskTile(d.id))).toBe(true); }
  expect(walkable(ENTRANCE)).toBe(true);
  for (const room of ROOMS) for (const x of [6, 7]) for (const y of [6, 7]) expect(walkable({ x: room.x + x, y: room.y + y })).toBe(false);
  expect(walkable({ x: -1, y: 0 })).toBe(false);
});
test('isometric tile centers round trip for pointer selection', () => {
  for (const d of DESKS) expect(uniso(iso({ x: d.x + 0.5, y: d.y + 0.5 }))).toEqual({ x: d.x, y: d.y });
});
