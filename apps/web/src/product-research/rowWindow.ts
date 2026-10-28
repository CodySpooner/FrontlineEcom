import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** Decision 14: past a few hundred cards the grid keeps only the rows near the viewport in the DOM. */
export const WINDOW_AT = 300;
const PITCH = 434; // a card row and its gap until one is measured (jsdom has no layout)

/**
 * The cards to keep: whole rows from `overscan` rows above the viewport to `overscan` below it. `scrolled` is how far
 * the grid's top is above the viewport's; `above` and `below` are the rows the spacers stand in for.
 */
export function rowWindow(count: number, cols: number, pitch: number, scrolled: number, viewH: number, overscan = 3) {
  const rows = Math.ceil(count / cols);
  const first = Math.max(0, Math.min(rows, Math.floor(scrolled / pitch) - overscan));
  const last = Math.max(first, Math.min(rows, Math.ceil((scrolled + viewH) / pitch) + overscan));
  return { from: Math.min(count, first * cols), to: Math.min(count, last * cols), above: first, below: rows - last };
}

type Win = ReturnType<typeof rowWindow> & { pitch: number; gap: number };

const scrollParent = (el: HTMLElement) => {
  for (let p = el.parentElement; p; p = p.parentElement) if (/auto|scroll/.test(getComputedStyle(p).overflowY)) return p;
  return null;
};

/**
 * Windows `count` cards in `grid` (cards carry `data-card`) once there are more than WINDOW_AT. Until the first
 * measure, and below the threshold, every card renders. The row pitch is measured then (every card is in the DOM) and
 * again only when the column count changes: re-measuring on scroll would move the top spacer under the reader.
 * ponytail: one average pitch for every row, so a spacer is off by the rows' height differences; per-row heights if
 * the scrollbar jumps.
 */
export function useRowWindow(grid: RefObject<HTMLDivElement | null>, count: number): Win {
  const [w, setW] = useState<Win | null>(null);
  const fixed = useRef<{ cols: number; pitch: number } | null>(null);
  const on = count > WINDOW_AT;
  useLayoutEffect(() => {
    const el = grid.current;
    if (!on || !el) return void ((fixed.current = null), setW(null));
    const scroller = scrollParent(el);
    const update = () => {
      const style = getComputedStyle(el);
      const cols = style.gridTemplateColumns.split(' ').filter(Boolean).length || 1;
      if (fixed.current?.cols !== cols) {
        const cards = el.querySelectorAll<HTMLElement>('[data-card]');
        const rows = Math.floor((cards.length - 1) / cols);
        const measured = rows > 0 ? (cards[rows * cols]!.offsetTop - cards[0]!.offsetTop) / rows : 0;
        fixed.current = { cols, pitch: measured > 0 ? measured : PITCH };
      }
      const { pitch } = fixed.current;
      const top = el.getBoundingClientRect().top - (scroller?.getBoundingClientRect().top ?? 0);
      const next = { ...rowWindow(count, cols, pitch, -top, scroller?.clientHeight || window.innerHeight), pitch, gap: parseFloat(style.rowGap) || 0 };
      setW((w) => (w && w.from === next.from && w.to === next.to && w.below === next.below && w.pitch === next.pitch ? w : next));
    };
    update();
    const target = scroller ?? window;
    target.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => (target.removeEventListener('scroll', update), window.removeEventListener('resize', update));
  }, [on, count, grid]);
  return on && w ? w : { from: 0, to: count, above: 0, below: 0, pitch: PITCH, gap: 0 };
}
