import { OFFICE_GRID } from '@frontline/shared';
import { tileKey, walkable, type Tile } from './world';

const neighbors = ({ x, y }: Tile): Tile[] => [{ x: x + 1, y }, { x, y: y + 1 }, { x: x - 1, y }, { x, y: y - 1 }];
const distance = (a: Tile, b: Tile) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** A* with Manhattan distance; excludes the start and includes the destination. */
export function findPath(start: Tile, goal: Tile, occupied = new Set<string>()): Tile[] {
  if (!walkable(start) || !walkable(goal) || occupied.has(tileKey(goal))) return [];
  const open = [start], scores = new Map([[tileKey(start), 0]]), parent = new Map<string, Tile>();
  while (open.length) {
    open.sort((a, b) => (scores.get(tileKey(a))! + distance(a, goal)) - (scores.get(tileKey(b))! + distance(b, goal)));
    const current = open.shift()!, key = tileKey(current);
    if (key === tileKey(goal)) {
      const path: Tile[] = [];
      let step = current;
      while (tileKey(step) !== tileKey(start)) { path.unshift(step); step = parent.get(tileKey(step))!; }
      return path;
    }
    for (const next of neighbors(current)) {
      const nk = tileKey(next), score = scores.get(key)! + 1;
      if (!walkable(next) || occupied.has(nk) || score >= (scores.get(nk) ?? Infinity)) continue;
      scores.set(nk, score); parent.set(nk, current);
      if (!open.some((p) => tileKey(p) === nk)) open.push(next);
    }
  }
  return [];
}

export function nearestFree(target: Tile, occupied: Set<string>): Tile | undefined {
  const candidates: Tile[] = [];
  for (let y = 0; y < OFFICE_GRID.height; y++) for (let x = 0; x < OFFICE_GRID.width; x++) if (walkable({ x, y }) && !occupied.has(tileKey({ x, y }))) candidates.push({ x, y });
  return candidates.sort((a, b) => distance(a, target) - distance(b, target))[0];
}

export interface Motion { position: Tile; cell: Tile; target: Tile; next?: Tile; route: Tile[]; planned: string; wait: number; arrived: boolean }
export const startMotion = (start: Tile, target: Tile): Motion => ({ position: { ...start }, cell: { ...start }, target, route: [], planned: '', wait: 0, arrived: tileKey(start) === tileKey(target) });

/** Reserve the next tile as well as the current one, so workers cannot cross through one another. */
export function advanceMotion(motions: Map<string, Motion>, seconds: number): string[] {
  const occupied = new Set<string>();
  for (const m of motions.values()) { occupied.add(tileKey(m.cell)); if (m.next) occupied.add(tileKey(m.next)); }
  const arrivals: string[] = [];
  for (const [id, m] of motions) {
    if (tileKey(m.cell) === tileKey(m.target) && !m.next) {
      if (!m.arrived) { m.arrived = true; arrivals.push(id); }
      continue;
    }
    m.arrived = false; m.wait -= seconds;
    if (!m.next && m.wait <= 0) {
      occupied.delete(tileKey(m.cell));
      if (!m.route.length || m.planned !== tileKey(m.target) || occupied.has(tileKey(m.route[0]!))) {
        m.route = findPath(m.cell, m.target, occupied); m.planned = tileKey(m.target);
      }
      m.next = m.route.shift();
      occupied.add(tileKey(m.cell));
      if (m.next) occupied.add(tileKey(m.next)); else m.wait = .5;
    }
    if (!m.next) continue;
    const dx = m.next.x - m.position.x, dy = m.next.y - m.position.y, length = Math.hypot(dx, dy), step = Math.min(seconds, .05) * 3.2;
    if (length <= step) {
      occupied.delete(tileKey(m.cell)); m.cell = m.next; m.position = { ...m.next }; m.next = undefined;
    } else { m.position.x += dx / length * step; m.position.y += dy / length * step; }
  }
  return arrivals;
}
