import { useLayoutEffect, useState } from 'react';

/**
 * A box that fills the window below where it starts, so its content scrolls inside and the details panel stays put.
 * `ref` is a callback ref: the box may only appear after a loading state.
 */
export function useFill<T extends HTMLElement>() {
  const [el, ref] = useState<T | null>(null);
  const [top, setTop] = useState(0);
  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => setTop(el.getBoundingClientRect().top + window.scrollY);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [el]);
  return { ref, style: { height: `calc(100dvh - ${top}px)` } };
}
