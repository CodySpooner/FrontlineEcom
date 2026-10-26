// UI-01 design system: the small set of primitives every screen is built from.
import { cloneElement, useEffect, useId, useRef } from 'react';
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactElement, ReactNode, TableHTMLAttributes } from 'react';
import { Inbox, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import { AGENT_ROLES, type AgentRole, type AgentStatus, type MemoryKind, type RunStatus, type StoreHealthStatus } from '@frontline/shared';
import { usedShare } from '../lib/usage';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('card', className)} {...p} />;
}

/** Card with a header row: title (+ optional sub line) on the left, `action` on the right. */
export function Panel({ title, sub, action, children, className }: { title: string; sub?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('card min-w-0 p-4', className)}>
      <div className="mb-3 flex items-center justify-between gap-2.5">
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold tracking-[.02em]">{title}</h2>
          {sub && <div className="text-xs text-muted">{sub}</div>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost'; size?: 'sm' | 'md' };

/** Button look, also used by router links that act as buttons. */
export const buttonClass = (variant: 'primary' | 'ghost' = 'ghost', size: 'sm' | 'md' = 'md') =>
  cx(
    'inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border font-semibold transition duration-150 hover:brightness-115 active:scale-[.97] disabled:cursor-not-allowed disabled:opacity-50',
    size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm',
    variant === 'primary' ? 'border-red-fill bg-red-fill text-white shadow-glow' : 'border-line-2 bg-panel-2 text-text-2',
  );

export function Button({ variant, size, className, type = 'button', ...p }: ButtonProps) {
  return <button type={type} className={cx(buttonClass(variant, size), className)} {...p} />;
}

/** Toggle chip, e.g. one store in the store filter. `color` adds an identity dot. */
export function Chip({ on, color, className, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { on?: boolean; color?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      className={cx(
        'flex cursor-pointer select-none items-center gap-1.5 rounded-[9px] border px-3 py-1.5 text-[13px] font-medium transition duration-150',
        on ? 'border-red bg-red-soft text-white' : 'border-line-2 bg-panel text-text-2 hover:border-line-3 hover:text-white',
        className,
      )}
      {...p}
    >
      {color && <i className="size-[7px] rounded-full" style={{ background: color }} />}
      {children}
    </button>
  );
}

export const inputClass = 'rounded-lg border border-line-2 bg-bg-2 px-3 py-2 text-[13px] text-text placeholder:text-muted focus:border-red/60 focus:outline-none';

/** A form control with its visible label above it. */
export const Field = ({ label, children, className }: { label: string; children: ReactNode; className?: string }) => (
  <label className={cx('grid content-start gap-1 text-xs text-muted', className)}>
    {label}
    {children}
  </label>
);

/** A checkbox drawn as a toggle. Put it inside the <label> that names it. */
export function Switch(p: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'role' | 'className'>) {
  return (
    <>
      <input type="checkbox" role="switch" className="peer sr-only" {...p} />
      <span
        aria-hidden
        className="relative h-6 w-11 shrink-0 rounded-full border border-line-2 bg-panel-2 transition peer-checked:border-red peer-checked:bg-red peer-focus-visible:outline-2 peer-focus-visible:outline-red peer-disabled:opacity-60 after:absolute after:top-0.5 after:left-0.5 after:size-[18px] after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-5"
      />
    </>
  );
}

export function Segmented<T extends string | number>({ label, options, value, onChange }: { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex gap-0.5 rounded-[10px] border border-line-2 bg-panel p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            'cursor-pointer rounded-[7px] px-3 py-1 font-display text-xs font-semibold transition duration-150',
            o.value === value ? 'bg-red-fill text-white shadow-glow' : 'text-muted hover:text-white',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Underlined tab bar (store tabs, page sections). `color` adds an identity dot. */
export function Tabs<T extends string>({ label, tabs, value, onChange }: { label: string; tabs: { value: T; label: string; color?: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto [scrollbar-width:none] shadow-[inset_0_-1px_0_var(--color-line)]">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={t.value === value}
          onClick={() => onChange(t.value)}
          className={cx(
            'flex shrink-0 cursor-pointer items-center gap-1.5 border-b-2 px-4 py-2.5 text-[13px] font-semibold transition duration-150',
            t.value === value ? 'border-red bg-red-soft text-white' : 'border-transparent text-muted hover:text-white',
          )}
        >
          {t.color && <i className="size-[7px] rounded-full" style={{ background: t.color }} />}
          {t.label}
        </button>
      ))}
    </div>
  );
}

const BADGE = {
  red: 'border-red/35 bg-red-soft text-red',
  good: 'border-good/25 bg-good/10 text-good',
  muted: 'border-line-2 bg-white/4 text-text-2',
};

export function Badge({ tone = 'muted', children }: { tone?: keyof typeof BADGE; children: ReactNode }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap', BADGE[tone])}>{children}</span>;
}

const DOT = { good: 'bg-good shadow-glow-good', red: 'bg-red shadow-glow', idle: 'bg-muted/70' };

export function StatusDot({ tone, pulse }: { tone: keyof typeof DOT; pulse?: boolean }) {
  return <i aria-hidden className={cx('inline-block size-2 shrink-0 rounded-full', DOT[tone], pulse && 'animate-blink')} />;
}

export const AGENT_STATUS: Record<AgentStatus, { label: string; tone: keyof typeof DOT; pulse?: boolean }> = {
  running: { label: 'Running', tone: 'good', pulse: true },
  waiting_approval: { label: 'Needs you', tone: 'red', pulse: true },
  idle: { label: 'Idle', tone: 'idle' },
  error: { label: 'Error', tone: 'red' },
  offline: { label: 'Offline', tone: 'idle' },
};

export const RUN_STATUS: Record<RunStatus, { label: string; tone: 'red' | 'good' | 'muted' }> = {
  queued: { label: 'Queued', tone: 'muted' },
  running: { label: 'Running', tone: 'good' },
  done: { label: 'Done', tone: 'muted' },
  error: { label: 'Failed', tone: 'red' },
  cancelled: { label: 'Stopped', tone: 'muted' },
};

/** `value` 0..1. `scan` = indeterminate "working" sweep instead of a fill. */
/** Store health from shared `storeHealth()`: only losing money gets the alarm color. */
export const STORE_HEALTH: Record<StoreHealthStatus, { label: string; tone: keyof typeof BADGE }> = {
  winning: { label: 'Winning', tone: 'good' },
  steady: { label: 'Steady', tone: 'muted' },
  bleeding: { label: 'Bleeding', tone: 'red' },
};

export const MEMORY_KINDS: { value: MemoryKind; label: string }[] = [
  { value: 'fact', label: 'Fact' },
  { value: 'learning', label: 'Learning' },
  { value: 'preference', label: 'Preference' },
];

/** Who saved a memory: the owner or one of the squad's roles. */
export const memoryAuthor = (agentId: string) => (agentId === 'owner' ? 'You' : AGENT_ROLES[agentId.split(':')[1] as AgentRole]?.name ?? 'Agent');

export function ProgressBar({ value = 0, tone = 'red', scan, label }: { value?: number; tone?: 'red' | 'good' | 'muted'; scan?: boolean; label: string }) {
  const v = Math.min(1, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={scan ? undefined : Math.round(v * 100)}
      className="h-1 overflow-hidden rounded bg-grid"
    >
      {scan ? (
        <i className="block h-full w-2/5 animate-scan bg-linear-to-r from-transparent via-red to-transparent" />
      ) : (
        <i
          className={cx('block h-full origin-left rounded transition-transform duration-500 ease-out', tone === 'good' ? 'bg-good shadow-glow-good' : tone === 'muted' ? 'bg-muted' : 'bg-linear-to-r from-red-2 to-red shadow-glow')}
          style={{ transform: `scaleX(${v})` }}
        />
      )}
    </div>
  );
}

/** Today's use of a daily cap: a neutral bar that turns red from 80%. */
export function UsageMeter({ label, used, cap, fmt }: { label: string; used: number; cap: number; fmt: (n: number) => string }) {
  const share = usedShare(used, cap);
  return (
    <div className="grid gap-1">
      <ProgressBar value={share} tone={share >= 0.8 ? 'red' : 'muted'} label={`${label} used today`} />
      <span className={cx('text-[11px] tabular-nums', share >= 1 ? 'text-red' : 'text-muted')}>
        {fmt(used)} of {fmt(cap)} used today
      </span>
    </div>
  );
}

/** `xp` / `next` = progress through the current level. */
export function XPBar({ level, rank, xp, next }: { level: number; rank?: string; xp: number; next: number }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px]">
        <span className="font-display font-bold tracking-[.12em] text-red">
          LV {level}
          {rank && <span className="ml-1.5 font-sans font-semibold tracking-normal text-text-2">{rank}</span>}
        </span>
        <span className="text-muted tabular-nums">
          {xp.toLocaleString('en-US')} / {next.toLocaleString('en-US')} XP
        </span>
      </div>
      <ProgressBar value={xp / next} label={`Level ${level} progress`} />
    </div>
  );
}

/** Hover/focus tooltip. The child must be focusable so keyboard users get it too. */
export function Tooltip({ tip, children }: { tip: ReactNode; children: ReactElement<{ 'aria-describedby'?: string }> }) {
  const id = useId();
  return (
    <span className="group relative inline-flex">
      {cloneElement(children, { 'aria-describedby': id })}
      <span
        role="tooltip"
        id={id}
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-max max-w-60 -translate-x-1/2 rounded-lg border border-line-2 bg-bg-2/95 px-2.5 py-1.5 text-xs font-normal hidden text-text shadow-lg transition duration-150 group-focus-within:block group-hover:block starting:opacity-0"
      >
        {tip}
      </span>
    </span>
  );
}

export function Table({ className, ...p }: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table
        className={cx(
          'w-full border-collapse text-sm',
          '[&_th]:border-b [&_th]:border-line [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-display [&_th]:text-[11px] [&_th]:font-semibold [&_th]:tracking-[.12em] [&_th]:text-muted [&_th]:uppercase',
          '[&_td]:border-b [&_td]:border-line [&_td]:px-3 [&_td]:py-2.5 [&_td]:tabular-nums [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-white/2',
          className,
        )}
        {...p}
      />
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, children, action }: { icon?: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
      <div className="mb-1 grid size-11 place-items-center rounded-xl border border-line-2 bg-white/3 text-muted">
        <Icon className="size-5" strokeWidth={1.8} />
      </div>
      <div className="font-display font-semibold">{title}</div>
      {children && <div className="max-w-sm text-[13px] text-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function LoadingState({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cx('flex flex-col gap-2.5', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-9 animate-pulse rounded-lg bg-white/4" style={{ animationDelay: `${i * 120}ms` }} />
      ))}
    </div>
  );
}

export function ErrorState({ message = "Couldn't load this.", onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 px-4 py-6 text-center">
      <TriangleAlert className="size-5 text-red" strokeWidth={1.8} />
      <div className="text-[13px] text-text-2">{message}</div>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** Modal (`side="center"`) or right-hand drawer (`side="right"`) on the native <dialog>: focus trap, Esc and backdrop for free. */
export function Dialog({ open, onClose, title, side = 'center', children }: { open: boolean; onClose: () => void; title: string; side?: 'center' | 'right'; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (open && !d?.open) d?.showModal();
    if (!open && d?.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      // Esc → `cancel` (synchronous; `close` can lag until the next frame). The parent then flips `open` and the effect closes it.
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label={title}
      className={cx(
        'card p-0 text-text backdrop:bg-black/60 backdrop:backdrop-blur-sm',
        side === 'right' ? 'drawer my-0 mr-0 ml-auto h-dvh max-h-none w-[min(440px,100vw)] rounded-none rounded-l-xl' : 'm-auto w-[min(520px,calc(100vw-32px))]',
      )}
    >
      <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <h2 className="font-display text-base font-semibold">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="cursor-pointer rounded-md p-1 text-muted transition hover:bg-panel-2 hover:text-white">
          <X className="size-4" />
        </button>
      </header>
      <div className="p-5">{children}</div>
    </dialog>
  );
}
