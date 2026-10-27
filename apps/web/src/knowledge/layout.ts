// The artboard's geometry: frames and card places in world units, the camera, culling and keyboard moves. Pure, so it's
// tested without a browser.
import type { KbCardBrief, KbPositions } from '@frontline/shared';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Camera {
  x: number;
  y: number;
  scale: number;
}
export interface Inset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
/** A card on the board: world position, and `rx`/`ry` relative to its frame (what's saved when it's dragged). */
export interface Placed {
  card: KbCardBrief;
  frame: string;
  x: number;
  y: number;
  rx: number;
  ry: number;
}
/** One per category that holds cards. A collapsed frame is its header only. */
export interface Frame extends Rect {
  id: string;
  path: string[];
  general: boolean;
  collapsed: boolean;
  count: number;
  cards: Placed[];
}

export const CARD = { w: 232, h: 132 };
export const PAD = 16;
export const HEAD = 44;
const GAP_X = 44; // room for the lines between cards
const GAP_Y = 12;
const FRAME_GAP = 32;

/**
 * Lays the cards out: a frame per category (a store's own before General's of the same path), cards in a grid (pinned
 * first) unless the owner dragged one, frames packed in rows about 16:9 overall.
 */
export function layout(cards: KbCardBrief[], positions: KbPositions, collapsed: Set<string>): Frame[] {
  const groups = new Map<string, KbCardBrief[]>();
  for (const c of cards) groups.set(c.categoryId, [...(groups.get(c.categoryId) ?? []), c]);
  const grid = new Map<string, { w: number; h: number }>(); // a frame's size before any drags: rows are packed by it
  const frames = [...groups.entries()]
    .map(([id, list]): Frame => {
      const sorted = [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned));
      const cols = sorted.length <= 2 ? 1 : Math.min(4, Math.ceil(Math.sqrt(sorted.length)));
      grid.set(id, { w: 2 * PAD + cols * CARD.w + (cols - 1) * GAP_X, h: HEAD + PAD + Math.ceil(sorted.length / cols) * (CARD.h + GAP_Y) - GAP_Y });
      const placed = sorted.map((card, i) => {
        const at = positions[card.id] ?? { x: PAD + (i % cols) * (CARD.w + GAP_X), y: HEAD + Math.floor(i / cols) * (CARD.h + GAP_Y) };
        return { card, frame: id, x: at.x, y: at.y, rx: at.x, ry: at.y };
      });
      const w = Math.max(...placed.map((p) => p.rx + CARD.w)) + PAD;
      const shut = collapsed.has(id);
      return { id, path: list[0]!.path, general: list[0]!.storeId === null, collapsed: shut, count: list.length, x: 0, y: 0, w, h: shut ? HEAD : Math.max(...placed.map((p) => p.ry + CARD.h)) + PAD, cards: shut ? [] : placed };
    })
    .sort((a, b) => a.path.join('\u0000').toLowerCase().localeCompare(b.path.join('\u0000').toLowerCase()) || Number(a.general) - Number(b.general));
  // Rows are decided by grid sizes, so a card dragged out wide pushes the frames after it along instead of re-wrapping
  // the board under the owner's hand.
  const g = (f: Frame) => grid.get(f.id)!;
  const rowWidth = Math.max(...frames.map((f) => g(f).w), Math.sqrt((frames.reduce((s, f) => s + (g(f).w + FRAME_GAP) * (g(f).h + FRAME_GAP), 0) * 16) / 9));
  let gx = 0;
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const f of frames) {
    if (gx > 0 && gx + g(f).w > rowWidth) {
      gx = 0;
      x = 0;
      y += rowH + FRAME_GAP;
      rowH = 0;
    }
    gx += g(f).w + FRAME_GAP;
    f.x = x;
    f.y = y;
    for (const p of f.cards) {
      p.x = x + p.rx;
      p.y = y + p.ry;
    }
    x += f.w + FRAME_GAP;
    rowH = Math.max(rowH, f.h);
  }
  return frames;
}

/** Everything's bounds, for Fit and the minimap. */
export function bounds(frames: Frame[]): Rect {
  if (!frames.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.min(...frames.map((f) => f.x));
  const y = Math.min(...frames.map((f) => f.y));
  return { x, y, w: Math.max(...frames.map((f) => f.x + f.w)) - x, h: Math.max(...frames.map((f) => f.y + f.h)) - y };
}

const MIN = 0.15;
const MAX = 2;

/** Zooms by `factor` keeping the screen point `at` over the same spot (copied from src/ecosystem/camera.ts). */
export function zoomAt(c: Camera, factor: number, at: { x: number; y: number }): Camera {
  const scale = Math.max(MIN, Math.min(MAX, c.scale * factor));
  return { scale, x: at.x - ((at.x - c.x) * scale) / c.scale, y: at.y - ((at.y - c.y) * scale) / c.scale };
}

/** The camera that centres `r` in the part of the screen the panels leave free, at 100% at most. */
export function fit(r: Rect, view: { w: number; h: number }, inset: Inset, margin = 40): Camera {
  const w = view.w - inset.left - inset.right;
  const h = view.h - inset.top - inset.bottom;
  const scale = Math.max(MIN, Math.min(1, (w - 2 * margin) / Math.max(1, r.w), (h - 2 * margin) / Math.max(1, r.h)));
  return { scale, x: inset.left + (w - r.w * scale) / 2 - r.x * scale, y: inset.top + (h - r.h * scale) / 2 - r.y * scale };
}

const READABLE = 0.75;

/** Where the board opens: fitted, unless that makes cards too small to read; then 75% from the top-left (the Outline's first frames). */
export function start(r: Rect, view: { w: number; h: number }, inset: Inset, margin = 40): Camera {
  const c = fit(r, view, inset, margin);
  return c.scale >= READABLE ? c : { scale: READABLE, x: inset.left + margin - r.x * READABLE, y: inset.top + margin - r.y * READABLE };
}

/** The camera moved just enough to show `r` (world units) in the free area; the same camera when it already shows. */
export function panIntoView(c: Camera, r: Rect, view: { w: number; h: number }, inset: Inset, margin = 24): Camera {
  const sx = r.x * c.scale + c.x;
  const sy = r.y * c.scale + c.y;
  const left = inset.left + margin;
  const top = inset.top + margin;
  const right = view.w - inset.right - margin;
  const bottom = view.h - inset.bottom - margin;
  const dx = sx < left ? left - sx : sx + r.w * c.scale > right ? right - sx - r.w * c.scale : 0;
  const dy = sy < top ? top - sy : sy + r.h * c.scale > bottom ? bottom - sy - r.h * c.scale : 0;
  return dx || dy ? { ...c, x: c.x + dx, y: c.y + dy } : c;
}

/** What the camera sees, in world units. */
export const seen = (c: Camera, view: { w: number; h: number }): Rect => ({ x: -c.x / c.scale, y: -c.y / c.scale, w: view.w / c.scale, h: view.h / c.scale });

export const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Frames and cards on screen (with a card's width to spare), plus the `keep` cards wherever they are. */
export function cull(frames: Frame[], view: Rect, keep: Set<string>) {
  const near = { x: view.x - CARD.w, y: view.y - CARD.w, w: view.w + 2 * CARD.w, h: view.h + 2 * CARD.w };
  const shown = frames.filter((f) => overlaps(f, near));
  return { frames: shown, cards: frames.flatMap((f) => f.cards.filter((p) => keep.has(p.card.id) || overlaps({ x: p.x, y: p.y, ...CARD }, near))) };
}

export type Dir = 'left' | 'right' | 'up' | 'down';

/** The card an arrow key moves to: the closest one that way, a sideways step counting double. */
export function nearest(from: Rect, cards: (Rect & { id: string })[], dir: Dir): string | undefined {
  const cx = (r: Rect) => r.x + r.w / 2;
  const cy = (r: Rect) => r.y + r.h / 2;
  let best: { id: string; score: number } | undefined;
  for (const c of cards) {
    const dx = cx(c) - cx(from);
    const dy = cy(c) - cy(from);
    const [ahead, aside] = dir === 'right' ? [dx, dy] : dir === 'left' ? [-dx, dy] : dir === 'down' ? [dy, dx] : [-dy, dx];
    if (ahead <= 0) continue;
    const score = ahead + 2 * Math.abs(aside);
    if (!best || score < best.score) best = { id: c.id, score };
  }
  return best?.id;
}

/**
 * A connection line between two cards: side to side when they're apart, else top to bottom, as an S-curve from the
 * facing edges. `mid` is where the relationship pill sits.
 */
export function edge(a: Rect, b: Rect) {
  const apart = b.x >= a.x + a.w || b.x + b.w <= a.x;
  const right = b.x > a.x;
  const below = b.y > a.y;
  const from = apart ? { x: right ? a.x + a.w : a.x, y: a.y + a.h / 2 } : { x: a.x + a.w / 2, y: below ? a.y + a.h : a.y };
  const to = apart ? { x: right ? b.x : b.x + b.w, y: b.y + b.h / 2 } : { x: b.x + b.w / 2, y: below ? b.y : b.y + b.h };
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const c1 = apart ? { x: mid.x, y: from.y } : { x: from.x, y: mid.y };
  const c2 = apart ? { x: mid.x, y: to.y } : { x: to.x, y: mid.y };
  const d = `M ${from.x} ${from.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${to.x} ${to.y}`;
  /** The point `t` (0..1) along the curve. */
  const at = (t: number) => {
    const u = 1 - t;
    const k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t] as const;
    return { x: k[0] * from.x + k[1] * c1.x + k[2] * c2.x + k[3] * to.x, y: k[0] * from.y + k[1] * c1.y + k[2] * c2.y + k[3] * to.y };
  };
  return { from, to, mid, d, at };
}

/** Where a line's pill goes: its middle, or the nearest point along it that isn't on one of `cards`. */
export function pillAt(e: ReturnType<typeof edge>, cards: Rect[]) {
  const on = (p: { x: number; y: number }) => cards.some((r) => p.x > r.x - 8 && p.x < r.x + r.w + 8 && p.y > r.y - 8 && p.y < r.y + r.h + 8);
  for (const t of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) if (!on(e.at(t))) return e.at(t);
  return e.mid;
}
