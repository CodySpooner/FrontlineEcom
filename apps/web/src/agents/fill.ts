import { useLayoutEffect, useState } from 'react';

/**
 * A box that fills the window below where it starts, so its panes scroll inside (copied from knowledge/fill.ts), plus
 * its width, which the pane breakpoints follow. `ref` is a callback ref: the box may only appear after a loading state.
 */
export function useFill<T extends HTMLElement>() {
  const [el, ref] = useState<T | null>(null);
  const [top, setTop] = useState(0);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => {
      setTop(el.getBoundingClientRect().top + window.scrollY);
      setWidth(el.clientWidth);
    };
    measure();
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    ro?.observe(el);
    return () => {
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
  }, [el]);
  return { ref, width, style: { height: `calc(100dvh - ${top}px)` } };
}
