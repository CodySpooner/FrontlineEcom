// The settings row kit (ST-03, boards A1/A2): section cards, rows with their origin line, the scope switch, the save bar,
// immediate rows and the danger zone. Every section from ST-12 on is built from these.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { ChevronDown, ChevronRight, GitBranch, Layers, Lock, Server, Undo2 } from 'lucide-react';
import { useStores } from '../api/client';
import { cx, flatButtonClass } from '../components/ui';

/** A section card: title, one line of help, rows, and an optional "Advanced · …" expander for the technical rows. */
export function SettingsSection({ title, help, aside, advanced, children, className }: { title: ReactNode; help?: ReactNode; aside?: ReactNode; advanced?: { summary: string; children: ReactNode }; children?: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <section aria-labelledby={`${id}-t`} className={cx('min-w-0 rounded-xl border border-line bg-linear-to-b from-[#151518] to-[#111114]', className)}>
      <div className="flex items-start gap-3 px-[18px] pt-3.5 pb-3">
        <div className="min-w-0 flex-1">
          <h3 id={`${id}-t`} className="text-[15px] font-semibold">
            {title}
          </h3>
          {help && <p className="mt-0.5 text-[12.5px] text-muted">{help}</p>}
        </div>
        {aside}
      </div>
      {children}
      {advanced && (
        <>
          <button
            type="button"
            data-action="settings.advanced"
            aria-expanded={open}
            aria-controls={`${id}-adv`}
            onClick={() => setOpen((o) => !o)}
            className="flex w-full cursor-pointer items-center gap-2 border-t border-line px-[18px] py-2.5 text-left text-[12.5px] text-text-2 hover:text-white"
          >
            <ChevronRight aria-hidden className={cx('size-3.5 transition-transform', open && 'rotate-90')} />
            Advanced · {advanced.summary}
          </button>
          {/* Hidden, not unmounted: its rows stay in the page (search, coverage), just out of sight. */}
          <div id={`${id}-adv`} hidden={!open}>
            {advanced.children}
          </div>
        </>
      )}
    </section>
  );
}

export type Origin =
  | { kind: 'workspace'; note?: string }
  /** A store override; `workspace` is the formatted workspace value, `same` when the override equals it. */
  | { kind: 'store'; workspace: string; same?: boolean; onUse?: () => void }
  | { kind: 'policy'; text: string }
  | { kind: 'env'; text: string }
  | { kind: 'demo' };

/** Where a value comes from, under its label. */
export function OriginLine({ origin }: { origin: Origin }) {
  const [Icon, tone, text] =
    origin.kind === 'workspace'
      ? [Layers, 'text-muted', `Using workspace default${origin.note ? ` · ${origin.note}` : ''}`]
      : origin.kind === 'store'
        ? [GitBranch, 'text-[#7fb2ff]', `Customized for this store · ${origin.same ? 'same as ' : ''}workspace default ${origin.workspace}`]
        : origin.kind === 'policy'
          ? [Lock, 'text-amber', `Restricted by workspace policy · ${origin.text}`]
          : origin.kind === 'env'
            ? [Server, 'text-amber', `Set by the environment · ${origin.text}`]
            : [Layers, 'text-muted', 'Demo store · runs on the demo engine'];
  return (
    <span className={cx('inline-flex items-center gap-[5px] text-[11.5px]', tone)}>
      <Icon aria-hidden className="size-3 shrink-0" strokeWidth={2} />
      {text}
    </span>
  );
}

/**
 * One setting: label with its help and origin on the left, the control on the right, the server's error for this field
 * under it. `setting` (the registry id) is the row's anchor for deep links; `htmlFor` ties the label to the control.
 */
export function SettingRow({ setting, label, htmlFor, help, origin, error, changed, children }: { setting?: string; label: ReactNode; htmlFor?: string; help?: ReactNode; origin?: Origin; error?: string; changed?: boolean; children?: ReactNode }) {
  const Label = htmlFor ? 'label' : 'div';
  return (
    <div id={setting} className={cx('flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line px-[18px] py-3', changed && 'bg-[rgba(127,178,255,.05)]')}>
      <div className="min-w-[200px] flex-1">
        <Label htmlFor={htmlFor} className="block text-[13px] font-medium">
          {label}
        </Label>
        {help && <div className="text-xs text-muted">{help}</div>}
        {origin && (
          <div>
            <OriginLine origin={origin} />
          </div>
        )}
      </div>
      {origin?.kind === 'store' && origin.onUse && (
        <button type="button" onClick={origin.onUse} className={flatButtonClass('ghost', 'sm')}>
          <Undo2 aria-hidden className="size-3.5" />
          Use workspace default
        </button>
      )}
      {children}
      {error && (
        <p role="alert" className="basis-full text-xs text-red">
          {error}
        </p>
      )}
    </div>
  );
}

export type InlineState = 'idle' | 'saving' | 'saved' | 'error';

/** A preference that applies on change (no Save): marked so, with its own saving state and error. */
export function ImmediateRow({ state, error, help, children, ...row }: Omit<Parameters<typeof SettingRow>[0], 'error' | 'changed'> & { state: InlineState; error?: string }) {
  return (
    <SettingRow
      {...row}
      help={
        <>
          {help}
          {help && ' · '}Applies right away
        </>
      }
      error={state === 'error' ? (error ?? "Couldn't save that.") : undefined}
    >
      <span role="status" className="min-w-14 text-right text-[11.5px] text-muted">
        {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : ''}
      </span>
      {children}
    </SettingRow>
  );
}

export interface ScopeStore {
  id: string;
  name: string;
  color: string;
}

/**
 * The "Editing" switch: `defaults` is "Workspace defaults | <store ▾>", `knowledge` "General knowledge | <store ▾>", `store`
 * just the store picker. `value` null is the workspace (General) side. With several stores the store side is a listbox.
 */
export function ScopeSwitch({ variant = 'defaults', stores, value, onChange }: { variant?: 'defaults' | 'knowledge' | 'store'; stores: ScopeStore[]; value: string | null; onChange: (store: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const store = stores.find((s) => s.id === value);
  const shown = store ?? stores[0];
  const many = stores.length > 1;
  useEffect(() => {
    if (open) (list.current?.querySelector<HTMLElement>('[aria-selected="true"]') ?? list.current?.querySelector<HTMLElement>('[role="option"]'))?.focus();
  }, [open]);
  const pick = (s: string) => {
    setOpen(false);
    onChange(s);
    button.current?.focus();
  };
  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="option"]')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const to = e.key === 'ArrowDown' ? Math.min(items.length - 1, at + 1) : e.key === 'ArrowUp' ? Math.max(0, at - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : -1;
    if (to >= 0) {
      e.preventDefault();
      items[to]!.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (at >= 0) pick(stores[at]!.id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      button.current?.focus();
    }
  };
  const seg = (on: boolean) => cx('inline-flex cursor-pointer items-center gap-1.5 rounded-[7px] px-[11px] py-1 text-[12.5px] whitespace-nowrap', on ? 'bg-[#2a2a31] text-white' : 'text-text-2 hover:text-white');
  if (!shown && variant === 'store') return null;
  return (
    <div className="flex flex-col items-end gap-1.5">
      <span id={`${id}-l`} className="text-[10.5px] font-semibold tracking-[.09em] text-muted uppercase">
        Editing
      </span>
      <div role="group" aria-labelledby={`${id}-l`} className="relative inline-flex gap-0.5 rounded-[9px] border border-line-2 bg-bg-2 p-0.5">
        {variant !== 'store' && (
          <button type="button" aria-pressed={value === null} onClick={() => onChange(null)} className={seg(value === null)}>
            {variant === 'knowledge' ? 'General knowledge' : 'Workspace defaults'}
          </button>
        )}
        {shown && (
          <button
            ref={button}
            type="button"
            aria-pressed={!!store}
            aria-haspopup={many ? 'listbox' : undefined}
            aria-expanded={many ? open : undefined}
            aria-controls={many ? `${id}-list` : undefined}
            onClick={() => (many ? setOpen((o) => !o) : onChange(shown.id))}
            className={cx(seg(!!store), 'max-w-[240px]')}
          >
            <i aria-hidden className="size-[7px] shrink-0 rounded-full" style={{ background: shown.color }} />
            <span className="truncate">{store ? store.name : many ? 'Pick a store' : shown.name}</span>
            {many && <ChevronDown aria-hidden className="size-3 shrink-0" />}
          </button>
        )}
        {many && (
          <ul
            ref={list}
            id={`${id}-list`}
            role="listbox"
            aria-label="Stores"
            hidden={!open}
            onKeyDown={onListKey}
            onBlur={(e) => !e.currentTarget.parentElement?.contains(e.relatedTarget as Node) && setOpen(false)}
            className="absolute top-full right-0 z-20 mt-1 max-h-[min(320px,60vh)] w-64 overflow-y-auto rounded-[10px] border border-line-2 bg-panel p-1 shadow-[0_10px_30px_-10px_rgba(0,0,0,.7)]"
          >
            {stores.map((s) => (
              <li
                key={s.id}
                role="option"
                aria-selected={s.id === value}
                tabIndex={-1}
                onClick={() => pick(s.id)}
                className={cx('flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-[12.5px] outline-none focus:bg-panel-2', s.id === value ? 'text-white' : 'text-text-2')}
              >
                <i aria-hidden className="size-[7px] shrink-0 rounded-full" style={{ background: s.color }} />
                <span className="truncate">{s.name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** The scope a section with store overrides edits: the store `?store=` names (it carries from section to section), else the workspace. */
export function useScope() {
  const q = useStores();
  const [params, setParams] = useSearchParams();
  return { ready: !!q.data, stores: q.data ?? [], store: q.data?.find((s) => s.id === params.get('store')), set: (store: string | null) => setParams(store ? { store } : {}) };
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'applying' | 'applied' | 'failed' | 'error';

/** The state a mutation implies: "Saved" only once the server has answered, never before. */
export const saveState = (m: { isPending: boolean; isError: boolean; isSuccess: boolean }, dirty: number): SaveState =>
  m.isPending ? 'saving' : m.isError ? 'error' : m.isSuccess && !dirty ? 'saved' : 'idle';

/**
 * The sticky bar under an explicit-save section: "N unsaved changes · <scope> · <impact>", Cancel and Save changes. It
 * stays up while saving, and says Saved, Applying… or Applied (a background job) once the server says so, or Couldn't
 * apply with the job's reason (`error`) and Retry.
 */
export function SaveBar({ count, scope, impact, state, error, onCancel, onSave, onRetry }: { count: number; scope: string; impact?: ReactNode; state: SaveState; error?: string; onCancel: () => void; onSave: () => void; onRetry?: () => void }) {
  if (!count && (state === 'idle' || state === 'error')) return null;
  const dot = state === 'error' || state === 'failed' ? 'bg-red' : state === 'saved' || state === 'applied' ? 'bg-good' : state === 'applying' ? 'bg-amber' : 'bg-[#7fb2ff]';
  const line =
    count > 0 ? (
      <>
        <b className="font-semibold">
          {count} unsaved change{count > 1 ? 's' : ''}
        </b>
        <span className="text-muted">
          {' '}
          · {scope}
          {impact && <> · {impact}</>}
        </span>
      </>
    ) : (
      <b className="font-semibold">{state === 'saving' ? 'Saving…' : state === 'applying' ? 'Saved · applying…' : state === 'applied' ? 'Saved · applied' : state === 'failed' ? "Saved · couldn't apply" : 'Saved'}</b>
    );
  return (
    <div className="sticky bottom-[22px] z-10 flex flex-wrap items-center gap-2.5 rounded-xl border border-line-2 bg-[#16161a] py-2.5 pr-3 pl-4 text-[13px] shadow-[0_10px_30px_-10px_rgba(0,0,0,.7)]">
      <i aria-hidden className={cx('size-[7px] shrink-0 rounded-full', dot)} />
      <span role="status" className="min-w-0 flex-1">
        {line}
        {state === 'error' && error && <span className="block text-xs text-red">Couldn't save: {error}</span>}
        {state === 'failed' && <span className="block text-xs text-red">Couldn't apply{error ? `: ${error}` : ''}</span>}
      </span>
      {state === 'failed' && onRetry && (
        <button type="button" onClick={onRetry} className={flatButtonClass('ghost')}>
          Retry
        </button>
      )}
      {count > 0 && (
        <>
          <button type="button" onClick={onCancel} disabled={state === 'saving'} className={flatButtonClass('ghost')}>
            Cancel
          </button>
          <button type="button" onClick={onSave} disabled={state === 'saving'} className={flatButtonClass('primary')}>
            {state === 'saving' ? 'Saving…' : 'Save changes'}
          </button>
        </>
      )}
    </div>
  );
}

/** A separate, red-bordered card for one destructive action: what it does, then the action. */
export function DangerZone({ title, children, action }: { title: string; children: ReactNode; action: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-wrap items-start gap-3 rounded-xl border border-red/30 bg-linear-to-b from-[#151518] to-[#111114] px-[18px] py-3.5">
      <div className="min-w-[200px] flex-1">
        <h3 id={id} className="text-[15px] font-semibold">
          {title}
        </h3>
        <div className="mt-0.5 text-[12.5px] text-muted">{children}</div>
      </div>
      {action}
    </section>
  );
}
