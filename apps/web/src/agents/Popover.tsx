import type { KeyboardEvent, ReactNode } from 'react';
import { cx } from '../components/ui';

/** ↑/↓ move focus through the `selector` items inside the element handling the key. */
export function rove(e: KeyboardEvent<HTMLElement>, selector: string) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(selector)];
  const next = items[items.indexOf(document.activeElement as HTMLElement) + (e.key === 'ArrowDown' ? 1 : -1)];
  if (!next) return;
  e.preventDefault();
  next.focus();
}

export const hidePopover = (id: string) => document.getElementById(id)?.hidePopover?.();

/**
 * A menu or picker on the native Popover API (decision 15): Esc and a click outside close it. It opens under the
 * button whose `popoverTarget` is `id`, keeps within the window (scrolling inside), and focuses its current
 * `[data-item]` (or the first). ↑/↓ move through the items.
 */
export function Popover({ id, label, align = 'start', className, children }: { id: string; label: string; align?: 'start' | 'end'; className?: string; children: ReactNode }) {
  return (
    <div
      id={id}
      popover="auto"
      role="menu"
      aria-label={label}
      onKeyDown={(e) => rove(e, '[data-item]')}
      onToggle={(e) => {
        if (e.newState !== 'open') return;
        const el = e.currentTarget;
        const b = document.querySelector(`[popovertarget="${id}"]`)?.getBoundingClientRect();
        if (b) {
          el.style.top = `${b.bottom + 4}px`;
          el.style.left = `${Math.max(8, Math.min(document.documentElement.clientWidth - el.offsetWidth - 8, align === 'start' ? b.left : b.right - el.offsetWidth))}px`;
          el.style.maxHeight = `${window.innerHeight - b.bottom - 12}px`;
        }
        (el.querySelector<HTMLElement>('[data-item][aria-current]') ?? el.querySelector<HTMLElement>('[data-item]'))?.focus();
      }}
      className={cx('card fixed inset-auto m-0 overflow-y-auto p-1 text-text', className)}
    >
      {children}
    </div>
  );
}

/** A menu row: a button that closes its popover after acting. */
export function MenuItem({ popover, current, onClick, children }: { popover: string; current?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      data-item
      role="menuitem"
      aria-current={current ? 'true' : undefined}
      onClick={() => {
        onClick();
        hidePopover(popover);
      }}
      className={cx('flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] outline-none hover:bg-panel-2 hover:text-white focus-visible:bg-panel-2 focus-visible:text-white', current ? 'text-white' : 'text-text-2')}
    >
      {children}
    </button>
  );
}
