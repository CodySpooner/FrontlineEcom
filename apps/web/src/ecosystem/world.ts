import { OFFICE_DEPARTMENTS, OFFICE_GRID, type OfficeDepartment } from '@frontline/shared';

export interface Tile { x: number; y: number }
const ORIGINS: Record<OfficeDepartment, Tile> = {
  executive: { x: 9, y: 0 }, research: { x: 0, y: 0 }, advertising: { x: 18, y: 0 }, creative: { x: 27, y: 0 },
  development: { x: 0, y: 9 }, analytics: { x: 27, y: 9 }, copywriting: { x: 0, y: 18 }, operations: { x: 9, y: 18 }, retention: { x: 18, y: 18 }, integrations: { x: 27, y: 18 },
};
const COLORS = ['#ff4657', '#47d9ba', '#7895ff', '#c878ed', '#4bcb91', '#54c8ed', '#edb962', '#db9763', '#68b8e8', '#7590b5'];
export const ROOMS = OFFICE_DEPARTMENTS.map((d, i) => ({ ...d, ...ORIGINS[d.id], color: COLORS[i]! }));
export const DESKS = ROOMS.flatMap((d) => Array.from({ length: d.desks }, (_, i) => ({
  id: `${d.id}-${i + 1}`, department: d.id, color: d.color, x: d.x + 2 + (i % 2) * 3, y: d.y + 2 + Math.floor(i / 2) * 3,
})));
export const MEETING: Tile = { x: 17, y: 13 };
export const ENTRANCE: Tile = { x: 17, y: 26 };
export const MAP_SIZE = { width: (OFFICE_GRID.width + OFFICE_GRID.height) * 24 + 80, height: (OFFICE_GRID.width + OFFICE_GRID.height) * 12 + 160 };
export const tileKey = ({ x, y }: Tile) => `${x},${y}`;
export const iso = ({ x, y }: Tile) => ({ x: (x - y) * 24 + OFFICE_GRID.height * 24 + 40, y: (x + y) * 12 + 100 });
export const uniso = ({ x, y }: Tile): Tile => {
  const dx = (x - OFFICE_GRID.height * 24 - 40) / 24;
  const dy = (y - 100) / 12;
  return { x: Math.floor((dx + dy) / 2), y: Math.floor((dy - dx) / 2) };
};
export const deskTile = (id: string): Tile => { const d = DESKS.find((d) => d.id === id)!; return { x: d.x, y: d.y + 1 }; };
export const BLOCKED = new Set(DESKS.map(tileKey));
for (const room of ROOMS) {
  for (let i = 0; i < 8; i++) if (i !== 4) {
    BLOCKED.add(tileKey({ x: room.x + i, y: room.y }));
    BLOCKED.add(tileKey({ x: room.x, y: room.y + i }));
  }
  BLOCKED.add(tileKey({ x: room.x + 7, y: room.y + 1 }));
}
for (let x = 15; x <= 18; x++) for (let y = 11; y <= 14; y++) BLOCKED.add(tileKey({ x, y }));
export const walkable = (p: Tile) => Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.y >= 0 && p.x < OFFICE_GRID.width && p.y < OFFICE_GRID.height && !BLOCKED.has(tileKey(p));
