import { OFFICE_DEPARTMENTS, OFFICE_GRID, type OfficeDepartment } from '@frontline/shared';

export interface Tile { x: number; y: number }
const ORIGINS: Record<OfficeDepartment, Tile> = {
  executive: { x: 18, y: 2 }, research: { x: 2, y: 2 }, advertising: { x: 34, y: 2 }, creative: { x: 50, y: 2 },
  development: { x: 2, y: 18 }, analytics: { x: 50, y: 18 }, copywriting: { x: 2, y: 34 }, operations: { x: 18, y: 34 }, retention: { x: 34, y: 34 }, integrations: { x: 50, y: 34 },
};
export const ROOM_SIZE = 12;
const COLORS = ['#ff4657', '#47d9ba', '#7895ff', '#c878ed', '#4bcb91', '#54c8ed', '#edb962', '#db9763', '#68b8e8', '#7590b5'];
export const ROOMS = OFFICE_DEPARTMENTS.map((d, i) => ({ ...d, ...ORIGINS[d.id], color: COLORS[i]! }));
export const DESKS = ROOMS.flatMap((d) => Array.from({ length: d.desks }, (_, i) => ({
  id: `${d.id}-${i + 1}`, department: d.id, color: d.color, x: d.x + 3 + (i % 2) * 5, y: d.y + 4 + Math.floor(i / 2) * 4,
})));
export const MEETING: Tile = { x: 31, y: 25 };
export const ENTRANCE: Tile = { x: 31, y: 47 };
export const PLATFORM_PYLONS = [
  { id: 'shopify', name: 'SHOPIFY', color: '#95e65b', x: 21, y: 21 },
  { id: 'amazon', name: 'AMAZON', color: '#ffb34b', x: 27, y: 16 },
  { id: 'ebay', name: 'eBay', color: '#61adff', x: 37, y: 22 },
  { id: 'etsy', name: 'ETSY', color: '#ff8553', x: 43, y: 21 },
  { id: 'tiktok_shop', name: 'TIKTOK SHOP', color: '#68f4eb', x: 43, y: 28 },
  { id: 'woocommerce', name: 'WOO', color: '#bd8aff', x: 25, y: 29 },
  { id: 'walmart', name: 'WALMART', color: '#ffc85c', x: 20, y: 28 },
  { id: 'meta_ads', name: 'META ADS', color: '#70b0ff', x: 47, y: 4 },
  { id: 'google_ads', name: 'GOOGLE ADS', color: '#78d99a', x: 47, y: 8 },
  { id: 'tiktok_ads', name: 'TIKTOK ADS', color: '#ff82b4', x: 47, y: 12 },
] as const;
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
  for (let i = 0; i < ROOM_SIZE; i++) if (i !== 6 && i !== 7) {
    BLOCKED.add(tileKey({ x: room.x + i, y: room.y }));
    BLOCKED.add(tileKey({ x: room.x, y: room.y + i }));
  }
  BLOCKED.add(tileKey({ x: room.x + 1, y: room.y + 10 }));
  BLOCKED.add(tileKey({ x: room.x + 1, y: room.y + 1 }));
  for (const x of [5,6,7]) BLOCKED.add(tileKey({ x: room.x + x, y: room.y + 10 }));
  for (const x of [9, 10, 11]) for (const y of [1, 2, 3]) BLOCKED.add(tileKey({ x: room.x + x, y: room.y + y }));
  for (const x of [10, 11]) for (const y of [10, 11]) BLOCKED.add(tileKey({ x: room.x + x, y: room.y + y }));
}
for (let x = MEETING.x - 2; x <= MEETING.x + 1; x++) for (let y = MEETING.y - 2; y <= MEETING.y + 1; y++) BLOCKED.add(tileKey({ x, y }));
for (const p of PLATFORM_PYLONS) BLOCKED.add(tileKey(p));
BLOCKED.add(tileKey({ x: 17, y: 21 }));
export const walkable = (p: Tile) => Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.y >= 0 && p.x < OFFICE_GRID.width && p.y < OFFICE_GRID.height && !BLOCKED.has(tileKey(p));
