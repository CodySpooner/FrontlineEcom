import type { KbCardBrief } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { CARD, cull, edge, fit, HEAD, layout, nearest, PAD, panIntoView, pillAt, start, zoomAt, type Rect } from './layout';

const card = (id: string, path: string[], extra: Partial<KbCardBrief> = {}): KbCardBrief => ({
  id, storeId: 'peak', categoryId: path.join('/'), path, type: 'strategy', stage: 'hypothesis', status: 'active', title: id, summary: '', tags: [], authorId: 'owner', origin: 'owner',
  pinned: false, blockedRoles: [], researchMarked: false, usedCount: 0, citedCount: 0, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', ...extra,
});

describe('the artboard layout', () => {
  it('makes one frame per category, in path order, with its cards in a grid', () => {
    const frames = layout([card('a', ['SEO']), card('b', ['Advertising', 'Hooks']), card('c', ['Advertising', 'Hooks']), card('d', ['Advertising', 'Hooks'])], {}, new Set());
    expect(frames.map((f) => [f.path.join(' › '), f.cards.map((p) => p.card.id)])).toEqual([
      ['Advertising › Hooks', ['b', 'c', 'd']],
      ['SEO', ['a']],
    ]);
    const [hooks] = frames;
    // 3 cards → 2 columns: b c / d
    expect(hooks!.cards.map((p) => [p.x - hooks!.x, p.y - hooks!.y])).toEqual([
      [PAD, HEAD],
      [PAD + CARD.w + 44, HEAD],
      [PAD, HEAD + CARD.h + 12],
    ]);
    expect([hooks!.w, hooks!.h]).toEqual([PAD + 2 * CARD.w + 44 + PAD, HEAD + 2 * CARD.h + 12 + PAD]);
  });

  it('pins first, marks General frames, and keeps General apart from the store frame of the same name', () => {
    const frames = layout([card('g', ['Advertising'], { storeId: null, categoryId: 'general-advertising' }), card('a', ['Advertising']), card('b', ['Advertising'], { pinned: true })], {}, new Set());
    expect(frames.map((f) => [f.general, f.cards.map((p) => p.card.id)])).toEqual([
      [false, ['b', 'a']],
      [true, ['g']],
    ]);
    // Two cards stack in one column, as in the design.
    expect(frames[0]!.cards.map((p) => p.rx)).toEqual([PAD, PAD]);
  });

  it("puts a card where the owner dragged it, inside its frame, and the frame grows to hold it", () => {
    const [f] = layout([card('a', ['SEO']), card('b', ['SEO'])], { b: { x: 600, y: 300 } }, new Set());
    expect(f!.cards.find((p) => p.card.id === 'b')).toMatchObject({ x: f!.x + 600, y: f!.y + 300, rx: 600, ry: 300 });
    expect([f!.w, f!.h]).toEqual([600 + CARD.w + PAD, 300 + CARD.h + PAD]);
  });

  it("doesn't reshuffle the board when a dragged card grows its frame: rows keep their frames, the frame stays put", () => {
    const cards = Array.from({ length: 12 }, (_, i) => card(`c${i}`, [`Cat ${String(i % 6).padStart(2, '0')}`]));
    const before = layout(cards, {}, new Set());
    const after = layout(cards, { c0: { x: 2000, y: 900 } }, new Set());
    const rows = (fs: typeof before) => fs.map((f) => f.y === fs[0]!.y);
    expect(rows(after)).toEqual(rows(before)); // the same frames share the first row
    expect([after[0]!.x, after[0]!.y]).toEqual([before[0]!.x, before[0]!.y]);
    for (const a of after) for (const b of after) if (a !== b) expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false);
  });

  it('shows a collapsed frame as its header only, at the same width', () => {
    const open = layout([card('a', ['SEO'])], {}, new Set())[0]!;
    const shut = layout([card('a', ['SEO'])], {}, new Set(['SEO']))[0]!;
    expect(shut).toMatchObject({ collapsed: true, w: open.w, h: HEAD, count: 1, cards: [] });
  });

  it('packs frames in rows without overlaps', () => {
    const frames = layout(Array.from({ length: 30 }, (_, i) => card(`c${i}`, [`Cat ${String(i % 12).padStart(2, '0')}`])), {}, new Set());
    expect(frames).toHaveLength(12);
    for (const a of frames) for (const b of frames) if (a !== b) expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false);
    expect(new Set(frames.map((f) => f.y)).size).toBeGreaterThan(1);
  });
});

describe('the camera', () => {
  it('zooms about the cursor: the point under it stays put', () => {
    const c = zoomAt({ x: 40, y: 20, scale: 1 }, 2, { x: 140, y: 120 });
    expect(c).toEqual({ x: -60, y: -80, scale: 2 });
    expect(zoomAt({ x: 0, y: 0, scale: 2 }, 10, { x: 0, y: 0 }).scale).toBe(2);
    expect(zoomAt({ x: 0, y: 0, scale: 0.2 }, 0.1, { x: 0, y: 0 }).scale).toBe(0.15);
  });

  it('fits the content into the area the panels leave free, never above 100%', () => {
    const inset = { top: 60, right: 360, bottom: 20, left: 240 };
    const c = fit({ x: 100, y: 100, w: 1000, h: 400 }, { w: 1600, h: 900 }, inset);
    const left = 100 * c.scale + c.x;
    const right = 1100 * c.scale + c.x;
    expect(left).toBeGreaterThanOrEqual(240);
    expect(right).toBeLessThanOrEqual(1600 - 360);
    expect((left + right) / 2).toBeCloseTo(240 + (1600 - 240 - 360) / 2);
    expect(fit({ x: 0, y: 0, w: 100, h: 100 }, { w: 1600, h: 900 }, inset).scale).toBe(1);
  });

  it('opens on the fitted view, or on the top-left at 75% when fitting would make cards too small to read', () => {
    const view = { w: 1200, h: 800 };
    const inset = { top: 64, right: 16, bottom: 16, left: 16 };
    expect(start({ x: 0, y: 0, w: 600, h: 300 }, view, inset)).toEqual(fit({ x: 0, y: 0, w: 600, h: 300 }, view, inset));
    expect(start({ x: 0, y: 0, w: 9000, h: 5000 }, view, inset)).toEqual({ scale: 0.75, x: 16 + 40, y: 64 + 40 });
  });

  it('pans a card into view only when it is off screen', () => {
    const inset = { top: 60, right: 16, bottom: 16, left: 16 };
    const cam = { x: 0, y: 0, scale: 1 };
    expect(panIntoView(cam, { x: 100, y: 100, w: CARD.w, h: CARD.h }, { w: 1200, h: 800 }, inset)).toBe(cam);
    const moved = panIntoView(cam, { x: 1500, y: 900, w: CARD.w, h: CARD.h }, { w: 1200, h: 800 }, inset);
    expect(1500 + CARD.w + moved.x).toBeLessThanOrEqual(1200 - 16);
    expect(900 + CARD.h + moved.y).toBeLessThanOrEqual(800 - 16);
  });
});

describe('culling', () => {
  it('renders only what is on screen, plus the focused and selected cards, so 1000 cards stay light', () => {
    const frames = layout(Array.from({ length: 1000 }, (_, i) => card(`c${i}`, [`Cat ${Math.floor(i / 20)}`])), {}, new Set());
    const view: Rect = { x: 0, y: 0, w: 1280, h: 720 };
    const far = frames.at(-1)!.cards.at(-1)!.card.id;
    const shown = cull(frames, view, new Set([far]));
    expect(shown.cards.length).toBeLessThan(80);
    expect(shown.cards.map((p) => p.card.id)).toContain(far);
    expect(shown.frames.length).toBeLessThan(frames.length);
    expect(shown.cards.map((p) => p.card.id)).toContain('c0');
  });
});

describe('keyboard navigation between cards', () => {
  const r = (id: string, x: number, y: number) => ({ id, x, y, w: CARD.w, h: CARD.h });
  const cards = [r('a', 0, 0), r('b', 300, 0), r('c', 0, 200), r('d', 300, 40), r('e', 900, 600)];
  it('moves to the nearest card that way, preferring ones in line', () => {
    expect(nearest(cards[0]!, cards, 'right')).toBe('b');
    expect(nearest(cards[0]!, cards, 'down')).toBe('c');
    expect(nearest(cards[1]!, cards, 'left')).toBe('a');
    expect(nearest(cards[2]!, cards, 'up')).toBe('a');
  });
  it('stays put when nothing lies that way', () => {
    expect(nearest(cards[0]!, cards, 'left')).toBeUndefined();
    expect(nearest(cards[0]!, cards, 'up')).toBeUndefined();
  });
});

describe('connection lines', () => {
  const a = { x: 0, y: 0, w: CARD.w, h: CARD.h };
  it('runs side to side between cards apart, from the facing edges, with the pill at the middle', () => {
    const e = edge(a, { x: 400, y: 200, w: CARD.w, h: CARD.h });
    expect([e.from, e.to]).toEqual([
      { x: CARD.w, y: CARD.h / 2 },
      { x: 400, y: 200 + CARD.h / 2 },
    ]);
    expect(e.mid).toEqual({ x: (CARD.w + 400) / 2, y: (CARD.h / 2 + 200 + CARD.h / 2) / 2 });
    expect(e.d.startsWith(`M ${CARD.w} ${CARD.h / 2} C`)).toBe(true);
    expect(edge({ x: 400, y: 200, w: CARD.w, h: CARD.h }, a).from).toEqual({ x: 400, y: 200 + CARD.h / 2 });
  });
  it('runs top to bottom between stacked cards', () => {
    const e = edge(a, { x: 20, y: 300, w: CARD.w, h: CARD.h });
    expect([e.from, e.to]).toEqual([
      { x: CARD.w / 2, y: CARD.h },
      { x: 20 + CARD.w / 2, y: 300 },
    ]);
  });
});

describe('pill placement', () => {
  it("sits at the line's middle, or the nearest point along it that isn't on a card", () => {
    const e = edge({ x: 0, y: 0, w: CARD.w, h: CARD.h }, { x: 0, y: 600, w: CARD.w, h: CARD.h });
    expect(pillAt(e, [])).toEqual(e.mid);
    const between = { x: 0, y: 300, w: CARD.w, h: CARD.h }; // a card right over the middle
    const p = pillAt(e, [between]);
    expect(p.y < between.y || p.y > between.y + between.h).toBe(true);
    expect(Math.abs(p.y - e.mid.y)).toBeLessThan(200);
    expect(pillAt(e, [{ x: -50, y: 0, w: 400, h: 2000 }])).toEqual(e.mid); // nowhere free: the middle
  });
});
