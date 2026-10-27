// The artboard's floating panels (design A, `docs/reference/kb-atlas.html`): the Outline with saved views and the
// line legend, the "why linked" popover and the Researching dock.
import { useMemo, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { BookmarkPlus, FilePlus, FolderPlus, Trash2, X } from 'lucide-react';
import { AGENT_ROLES, KB_LINK_TYPES, KB_TASK_STAGES, type KbLink, type KbViewState } from '@frontline/shared';
import { useCreateKbCategory, useDecideKbLink, useDeleteKbView, useKbCategories, useKbTasks, useKbViews, useKbWorkspaces, useSaveKbView } from '../api/client';
import { Button, cx } from '../components/ui';
import type { Frame } from './layout';

const panel = 'rounded-xl border border-line-2 bg-[rgba(14,14,17,.92)] backdrop-blur-[8px]';
const field = 'h-7 w-full min-w-0 rounded-[7px] border border-[#2a2a31] bg-[#0b0b0d] px-2.5 text-xs text-text placeholder:text-muted';
const iconBtn = 'grid size-7 shrink-0 cursor-pointer place-items-center rounded-md border border-[#2a2a31] text-text-2 transition hover:text-white';
/** Esc in a panel's field closes that field, not the open card (the page's Esc handler skips handled keys). */
export const escape = (close: () => void) => (e: KeyboardEvent) => {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  close();
};

/** One-line text form for a name: Enter saves, Esc cancels. */
function NameForm({ label, onSave, onCancel, busy, error }: { label: string; onSave: (name: string) => void; onCancel: () => void; busy: boolean; error?: string }) {
  const [name, setName] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) onSave(name.trim());
  };
  return (
    <form onSubmit={submit} className="grid gap-1">
      <input aria-label={label} placeholder={label} autoFocus required maxLength={60} value={name} disabled={busy} onChange={(e) => setName(e.target.value)} onKeyDown={escape(onCancel)} className={field} />
      {error && (
        <p role="alert" className="text-[11px] text-red">
          {error}
        </p>
      )}
    </form>
  );
}

/** Saved views of this workspace: pick one to bring back its filters, camera and collapsed frames. */
export function SavedViews({ ws, current, onApply }: { ws: string; current: () => KbViewState; onApply: (s: KbViewState) => void }) {
  const views = useKbViews(ws);
  const save = useSaveKbView();
  const del = useDeleteKbView();
  const [naming, setNaming] = useState(false);
  const [active, setActive] = useState<string>();
  const list = views.data ?? [];
  const on = list.find((v) => v.id === active);
  return (
    <div className="grid shrink-0 gap-1.5">
      <div className="flex gap-1">
        <select
          aria-label="Saved views"
          value="" // a picker, not a state: picking the same view again brings it back again
          onChange={(e) => {
            const v = list.find((x) => x.id === e.target.value);
            if (!v) return;
            setActive(v.id);
            onApply(v.state);
          }}
          className={cx(field, 'cursor-pointer px-2')}
        >
          <option value="">{list.length ? 'Saved views' : 'No saved views'}</option>
          {list.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        {on && (
          <button type="button" aria-label={`Delete view ${on.name}`} title={`Delete view ${on.name}`} onClick={() => del.mutate(on, { onSuccess: () => setActive(undefined) })} className={iconBtn}>
            <Trash2 className="size-3.5" />
          </button>
        )}
        <button type="button" aria-label="Save view" aria-expanded={naming} onClick={() => setNaming((n) => !n)} className={iconBtn}>
          <BookmarkPlus className="size-3.5" />
        </button>
      </div>
      {naming && (
        <NameForm
          label="View name"
          busy={save.isPending}
          error={save.error?.message}
          onCancel={() => setNaming(false)}
          onSave={(name) => save.mutate({ ws, name, state: current() }, { onSuccess: (v) => (setNaming(false), setActive(v.id)) })}
        />
      )}
    </div>
  );
}

/**
 * The workspace's category tree with each row's card count (its whole subtree). A row opens and shows its frames;
 * `onGo` gets the row's key and the frame ids under it.
 */
export function Outline({ ws, frames, current, onGo, onNewCard, children }: { ws: string; frames: Frame[]; current?: string; onGo: (key: string, frameIds: string[]) => void; onNewCard: () => void; children: ReactNode }) {
  const cats = useKbCategories(ws);
  const counts = useKbWorkspaces();
  const create = useCreateKbCategory();
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState('');
  const list = useMemo(() => cats.data ?? [], [cats.data]);
  // The list comes parent-first, so walking it backwards meets every child before its parent.
  const under = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of [...list].reverse()) m.set(c.id, [c.id, ...list.filter((k) => k.parentId === c.id).flatMap((k) => m.get(k.id)!)]);
    return m;
  }, [list]);
  const depth = new Map<string, number>();
  for (const c of list) depth.set(c.id, c.parentId ? (depth.get(c.parentId) ?? 0) + 1 : 0);
  const own = new Map(list.map((c) => [c.id, c]));
  const needle = filter.trim().toLowerCase();
  const general = frames.filter((f) => f.general).map((f) => f.id);
  const row = (key: string, ids: string[]) => ({
    'aria-current': current === key || undefined,
    onClick: () => onGo(key, ids),
    className: cx('flex h-[26px] shrink-0 cursor-pointer items-center gap-1.5 rounded-md pr-1.5 text-left text-[12.5px] transition disabled:cursor-default', current === key ? 'bg-red/14 text-white' : 'text-text-2 enabled:hover:bg-panel-2 enabled:hover:text-white'),
  });
  return (
    <nav aria-label="Outline" className={cx(panel, 'flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3')}>
      <div className="flex shrink-0 items-center">
        <span className="font-display text-[11px] font-semibold tracking-[.12em] text-muted">OUTLINE</span>
        <span className="flex-1" />
        <button type="button" aria-label="New card" title="New card" onClick={onNewCard} className={cx(iconBtn, 'mr-1 size-6')}>
          <FilePlus className="size-3" />
        </button>
        <button type="button" aria-label="New category" title="New category" aria-expanded={adding} onClick={() => setAdding((a) => !a)} className={cx(iconBtn, 'size-6')}>
          <FolderPlus className="size-3" />
        </button>
      </div>
      {adding && <NameForm label="Category name" busy={create.isPending} error={create.error?.message} onCancel={() => setAdding(false)} onSave={(name) => create.mutate({ ws, name }, { onSuccess: () => setAdding(false) })} />}
      {children}
      <input type="search" aria-label="Filter categories" placeholder="Filter categories" value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={escape(() => setFilter(''))} className={cx(field, 'h-[30px] shrink-0')} />
      <div className="-mx-1 flex min-h-[80px] shrink flex-col gap-px overflow-y-auto px-1">
        {list
          .filter((c) => !needle || under.get(c.id)!.some((id) => own.get(id)!.name.toLowerCase().includes(needle)))
          .map((c) => {
            const n = under.get(c.id)!.reduce((s, id) => s + own.get(id)!.cards, 0);
            const d = depth.get(c.id)!;
            return (
              <button key={c.id} type="button" aria-label={`${c.name} ${n}`} {...row(c.id, under.get(c.id)!)} style={{ paddingLeft: 6 + d * 14 }}>
                <span className={cx('min-w-0 truncate', d === 0 && current !== c.id && 'font-semibold text-text')}>{c.name}</span>
                <span className={cx('ml-auto', current === c.id ? 'text-[#ffb4ba]' : 'text-muted')}>{n}</span>
              </button>
            );
          })}
        {cats.isSuccess && !list.length && <p className="px-1.5 text-[11.5px] text-muted">No categories yet.</p>}
      </div>
      {ws !== 'general' && (
        <div className="grid shrink-0 gap-1 border-t border-line pt-2.5">
          <button type="button" disabled={!general.length} aria-label={`General knowledge ${counts.data?.general ?? 0}`} {...row('general', general)} style={{ paddingLeft: 6 }}>
            General knowledge<span className={cx('ml-auto', current === 'general' ? 'text-[#ffb4ba]' : 'text-muted')}>{counts.data?.general ?? 0}</span>
          </button>
          <span className="text-[11px] leading-snug text-muted">Shown inside this store where it applies, marked General.</span>
        </div>
      )}
      <ul aria-label="Line legend" className="mt-auto grid shrink-0 gap-1.5 border-t border-line pt-2.5 text-[11px] text-muted">
        <Legend mark={<path d="M1 3h24" stroke="#d4d4da" strokeWidth="1.5" />}>Supports, builds on, validates</Legend>
        <Legend mark={<path d="M1 3h24" stroke="var(--color-red)" strokeWidth="1.3" strokeDasharray="5 4" />}>Contradicts</Legend>
        <Legend mark={<path d="M2 3h22" stroke="#8b8b94" strokeWidth="1.5" strokeDasharray="1.5 4" strokeLinecap="round" />}>Suggested by AI, not confirmed</Legend>
        <li className="flex items-center gap-2">
          <span aria-hidden className="h-2.5 w-6 shrink-0 rounded-[3px] border border-dashed border-[#6b6b75]" />
          Hypothesis, unproven
        </li>
      </ul>
    </nav>
  );
}

const Legend = ({ mark, children }: { mark: ReactNode; children: ReactNode }) => (
  <li className="flex items-center gap-2">
    <svg aria-hidden width="26" height="6" className="shrink-0">
      {mark}
    </svg>
    {children}
  </li>
);

/** Why two cards are linked (non-modal); a suggested link can be accepted or rejected here. Without x/y it sits inline. */
export function LinkPopover({ link, from, to, x, y, onClose }: { link: KbLink; from: string; to: string; x?: number; y?: number; onClose: () => void }) {
  const decide = useDecideKbLink();
  const suggested = link.status === 'suggested';
  const answer = (status: 'confirmed' | 'rejected') => decide.mutate({ link, status }, { onSuccess: onClose });
  return (
    <div role="dialog" aria-label="Why these cards are linked" onKeyDown={escape(onClose)} className={cx(panel, 'grid gap-2 p-3 text-xs', x !== undefined && 'absolute z-20 w-72 shadow-[0_18px_40px_-16px_rgba(0,0,0,.9)]')} style={x !== undefined ? { left: x, top: y } : undefined}>
      <div className="flex items-center gap-2">
        <span className={cx('font-display text-[10.5px] font-semibold tracking-[.1em] uppercase', link.type === 'contradicts' ? 'text-red' : 'text-text-2')}>{KB_LINK_TYPES[link.type]}</span>
        {suggested && <span className="rounded border border-dashed border-line-3 px-1 text-[10px] text-muted">Suggested by AI</span>}
        <span className="flex-1" />
        <button type="button" aria-label="Close" autoFocus onClick={onClose} className="grid size-6 cursor-pointer place-items-center rounded-md text-muted transition hover:text-white">
          <X className="size-3.5" />
        </button>
      </div>
      <p className="leading-snug text-text-2">
        <span className="font-semibold text-text">{from}</span> → <span className="font-semibold text-text">{to}</span>
      </p>
      <p className="leading-snug text-text">{link.why}</p>
      {suggested && (
        <div className="flex gap-2">
          <Button size="sm" variant="primary" disabled={decide.isPending} onClick={() => answer('confirmed')}>
            Accept
          </Button>
          <Button size="sm" disabled={decide.isPending} onClick={() => answer('rejected')}>
            Reject
          </Button>
        </div>
      )}
      {decide.isError && (
        <p role="alert" className="text-[11px] text-red">
          Couldn't save that: {decide.error.message}
        </p>
      )}
    </div>
  );
}

const progress = (stage: string) => ((KB_TASK_STAGES.indexOf(stage as (typeof KB_TASK_STAGES)[number]) + 1) / KB_TASK_STAGES.length) * 100;

/** Live research of this workspace (hidden when there is none); a click opens the Research Center. */
export function Dock({ ws, right, onOpen }: { ws: string; right: number; onOpen: () => void }) {
  const tasks = useKbTasks(ws, true);
  const list = tasks.data ?? [];
  if (!list.length) return null;
  const running = list.filter((t) => t.status === 'running');
  const queued = list.length - running.length;
  return (
    <div className="pointer-events-none absolute bottom-4 left-[228px] z-10 flex justify-center" style={{ right }}>
      <button type="button" onClick={onOpen} className={cx(panel, '@container pointer-events-auto flex h-[52px] w-full max-w-[560px] cursor-pointer items-center gap-3.5 pr-2 pl-3.5 text-left transition hover:border-line-3')}>
        <span className="flex shrink-0 items-center gap-[7px] font-display text-[10.5px] font-semibold tracking-[.12em] text-[#ffb4ba] uppercase">
          <i aria-hidden className="size-[7px] rounded-full bg-red shadow-[0_0_10px_rgba(255,42,58,.7)]" />
          Researching
        </span>
        {/* Below ~520px only the first task fits. */}
        {running.slice(0, 2).map((t, i) => (
          <span key={t.id} className={cx('min-w-0 flex-1 flex-col gap-1', i ? 'hidden @min-[520px]:flex' : 'flex')}>
            <span className="truncate text-xs font-semibold">{t.objective}</span>
            <span className="flex items-center gap-1.5 text-[10.5px] whitespace-nowrap text-muted">
              <span className="truncate">{`${AGENT_ROLES[t.role]?.name ?? t.role} · ${t.stage}`}</span>
              <span aria-hidden className="h-[3px] min-w-6 flex-1 overflow-hidden rounded-sm bg-line">
                <span className="block h-full bg-red" style={{ width: `${progress(t.stage)}%` }} />
              </span>
            </span>
          </span>
        ))}
        {!running.length && <span className="flex-1 text-xs text-text-2">Waiting for a free agent</span>}
        {queued > 0 && <span className="flex h-[34px] shrink-0 items-center rounded-lg border border-[#2a2a31] bg-panel-2 px-2.5 text-[11.5px] whitespace-nowrap">{`+${queued} queued`}</span>}
      </button>
    </div>
  );
}
