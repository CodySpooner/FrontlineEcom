import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useOutletContext, useParams, useSearchParams } from 'react-router';
import { Bot, List, PanelRight, SearchX, Users } from 'lucide-react';
import type { Store } from '@frontline/shared';
import { useConversation, useConversations, useRun, useStores } from '../api/client';
import { Hero } from '../components/Hero';
import { useStoreSelection } from '../components/StoreFilter';
import { buttonClass, cx, Dialog, EmptyState, ErrorState, LoadingState } from '../components/ui';
import { NAV } from '../nav';
import { Conversation, ReadOnlyRun } from './Conversation';
import { Details } from './Details';
import { useFill } from './fill';
import { clampPanes, lastOpened, PANES, usePaneState } from './layout';
import { ListPane, meta } from './ListPane';
import { SettingsDrawer } from './settings';
import { StateDot } from './StateDot';
import { agentsUrl } from './urls';

/**
 * The AI Agents workspace: a store's conversation list, the open conversation, and its details. The URL's `store` is
 * the lookup key; another store's conversation is a 404 and shows the not-found state (decision 13).
 */
export function Workspace() {
  const { pathname } = useLocation();
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const stores = useStores();
  const { ids } = useStoreSelection();
  const store = stores.data?.find((s) => s.id === params.get('store'));
  const view = pathname.startsWith('/agents/c/') ? 'conversation' : pathname.startsWith('/agents/t/') ? 'team' : 'workspace';
  const run = params.get('run') ?? undefined;
  const remembered = store && view === 'workspace' && !run ? lastOpened.get(store.id) : undefined;
  let body: ReactNode;
  if (stores.isPending) body = <LoadingState rows={6} className="pt-4" />;
  else if (stores.isError) body = <ErrorState message="Couldn't load your stores." onRetry={() => stores.refetch()} />;
  else if (!stores.data.length)
    body = (
      <EmptyState icon={Users} title="No stores yet" action={<Link to="/settings" className={buttonClass('primary')}>Add a store</Link>}>
        Each store gets its own agents and conversations.
      </EmptyState>
    );
  // No store named: the first store picked in the store filter, else the first store.
  else if (!params.get('store')) body = <Navigate replace to={agentsUrl({ store: (stores.data.find((s) => ids.includes(s.id)) ?? stores.data[0]!).id })} />;
  else if (!store) body = <NotFound what="store" />;
  else if (remembered) body = <Navigate replace to={agentsUrl({ store: store.id, conversation: remembered })} />;
  // ponytail: teams arrive with AA-19, so no team id can exist yet.
  else if (view === 'team') body = <NotFound what="team" store={store} />;
  else body = <Panes store={store} conversationId={view === 'conversation' ? id : undefined} runId={run} />;
  return (
    <>
      <Hero compact title={NAV[1]!.title} icon={NAV[1]!.icon}>
        {store && !store.connected && <span className="rounded-full border border-dashed border-[#f2b84b]/55 px-2 py-0.5 text-[10px] font-semibold tracking-[.08em] whitespace-nowrap text-[#f2b84b] uppercase">Demo data</span>}
      </Hero>
      {body}
    </>
  );
}

function NotFound({ what, store }: { what: 'store' | 'team' | 'conversation' | 'run'; store?: Store }) {
  return (
    <EmptyState
      icon={SearchX}
      title={`${{ store: 'Store', team: 'Team', conversation: 'Conversation', run: 'Run' }[what]} not found`}
      action={store && <Link to={agentsUrl({ store: store.id })} className={buttonClass()}>Back to {store.name}</Link>}
    >
      {what === 'store' ? 'That store was deleted, or the link is wrong.' : `It was deleted, or it belongs to another store than ${store?.name ?? 'this one'}.`}
    </EmptyState>
  );
}

/** The three panes, laid out for the workspace's own width (decision: breakpoints at 1100 and 720 px). */
function Panes({ store, conversationId, runId }: { store: Store; conversationId?: string; runId?: string }) {
  const fill = useFill<HTMLDivElement>();
  const [prefs, setPrefs] = usePaneState();
  // Before the first measure (and in jsdom), assume the window minus the shell's 232 px sidebar.
  const workspace = fill.width || window.innerWidth - 232;
  const { mode, left, right } = clampPanes(workspace, prefs, prefs.rightOpen);
  const [drawer, setDrawer] = useState<'list' | 'details'>();
  const search = useRef<HTMLInputElement>(null);
  const online = useOutletContext<boolean | undefined>() ?? true;
  useEffect(() => setDrawer(undefined), [conversationId, mode]);
  useEffect(() => {
    if (conversationId) lastOpened.set(store.id, conversationId);
  }, [store.id, conversationId]);
  // `/` focuses the list search, unless a modifier is held, focus is in a field, or a dialog is open.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || document.querySelector('dialog[open]')) return;
      e.preventDefault();
      search.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const showRight = mode === 'three' && prefs.rightOpen;
  const list = <ListPane key={store.id} store={store} open={conversationId} search={search} />;
  const details = (end?: ReactNode) => <Details store={store} conversationId={conversationId} end={end} />;
  const buttons = (
    <>
      {mode === 'one' && <IconButton label="Show conversations" icon={List} onClick={() => setDrawer('list')} />}
      {!showRight && <IconButton label="Show details" icon={PanelRight} onClick={() => (mode === 'three' ? setPrefs({ rightOpen: true }) : setDrawer('details'))} />}
    </>
  );
  return (
    <div
      ref={fill.ref}
      style={{ ...fill.style, gridTemplateColumns: [mode !== 'one' && `${left}px`, 'minmax(0,1fr)', showRight && `${right}px`].filter(Boolean).join(' ') }}
      className="-mx-[22px] -mb-8 grid min-h-0 grid-rows-[minmax(0,1fr)] bg-bg"
    >
      {mode !== 'one' && (
        <div className="relative flex min-h-0 flex-col border-r border-[#1d1d22] bg-[#0a0a0c]">
          {list}
          <Handle label="Resize the conversation list" value={left} min={PANES.left.min} max={PANES.left.max} edge="right" onChange={(v) => setPrefs({ left: clampPanes(workspace, { ...prefs, left: v }, prefs.rightOpen).left })} />
        </div>
      )}
      <div className="flex min-h-0 min-w-0 flex-col">
        {!online && (
          <p role="status" className="border-b border-[#1d1d22] bg-[#f2b84b]/8 px-6 py-2 text-xs text-[#f2b84b]">
            Reconnecting… Live replies catch up when the connection is back.
          </p>
        )}
        {conversationId ? (
          <ConversationView key={conversationId} store={store} id={conversationId} buttons={buttons} />
        ) : runId ? (
          <RunView key={runId} store={store} id={runId} buttons={buttons} />
        ) : (
          <Start store={store} buttons={buttons} />
        )}
      </div>
      {showRight && (
        <aside aria-label="Details" className="relative flex min-h-0 flex-col border-l border-[#1d1d22] bg-[#0a0a0c]">
          <Handle label="Resize the details panel" value={right} min={PANES.right.min} max={PANES.right.max} edge="left" onChange={(v) => setPrefs({ right: clampPanes(workspace, { ...prefs, right: v }).right })} />
          {details(<IconButton label="Hide details" icon={PanelRight} onClick={() => setPrefs({ rightOpen: false })} />)}
        </aside>
      )}
      {mode === 'one' && (
        <Dialog side="left" open={drawer === 'list'} onClose={() => setDrawer(undefined)} title="Conversations">
          {list}
        </Dialog>
      )}
      {mode !== 'three' && (
        <Dialog side="right" open={drawer === 'details'} onClose={() => setDrawer(undefined)} title="Details">
          {details()}
        </Dialog>
      )}
      <SettingsDrawer storeId={store.id} />
    </div>
  );
}

function IconButton({ label, icon: Icon, onClick }: { label: string; icon: typeof List; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-lg text-muted transition hover:bg-panel-2 hover:text-white">
      <Icon className="size-4" strokeWidth={1.8} />
    </button>
  );
}

/** A pane's drag edge: pointer drag, or ←/→ in 16 px steps. `onChange` gets the wanted width and keeps it in bounds. */
function Handle({ label, value, min, max, edge, onChange }: { label: string; value: number; min: number; max: number; edge: 'left' | 'right'; onChange: (width: number) => void }) {
  const start = useRef<{ x: number; width: number }>(null);
  const dir = edge === 'right' ? 1 : -1;
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, width: value };
      }}
      onPointerMove={(e) => start.current && onChange(start.current.width + (e.clientX - start.current.x) * dir)}
      onPointerUp={() => (start.current = null)}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        onChange(value + (e.key === 'ArrowRight' ? 16 : -16) * dir);
      }}
      className={cx('absolute inset-y-0 z-10 w-1.5 cursor-col-resize touch-none outline-none hover:bg-red/40 focus-visible:bg-red/60', edge === 'right' ? '-right-[3px]' : '-left-[3px]')}
    />
  );
}

/** No conversation open: how to start, and the store's latest conversations. */
function Start({ store, buttons }: { store: Store; buttons: ReactNode }) {
  const recent = (useConversations(store.id).data?.pages[0]?.items ?? []).slice(0, 5);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex justify-end gap-1 px-4 pt-3">{buttons}</div>
      <EmptyState icon={Bot} title={`${store.name}'s agents`}>
        Pick a conversation from the list. Ask AI (Ctrl K) and the agent actions on other pages start new ones.
      </EmptyState>
      {recent.length > 0 && (
        <div className="mx-auto grid max-w-md gap-1 px-4 pb-8">
          <h2 className="px-2.5 pb-1 text-[11px] font-semibold tracking-[.07em] text-muted uppercase">Recent</h2>
          {recent.map((c) => (
            <Link key={c.id} to={agentsUrl({ store: store.id, conversation: c.id })} className="flex items-center gap-2.5 rounded-[7px] px-2.5 py-1.5 text-[13px] text-text-2 hover:bg-[#141418]">
              <StateDot state={c.state} />
              <span title={c.title} className="min-w-0 flex-1 truncate">
                {c.title}
              </span>
              <span className="text-[11px] text-muted">{meta(c)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function ConversationView({ store, id, buttons }: { store: Store; id: string; buttons: ReactNode }) {
  const c = useConversation(store.id, id);
  const missing = c.isError && /not found$/.test(c.error.message);
  useEffect(() => {
    if (missing && lastOpened.get(store.id) === id) lastOpened.set(store.id, undefined);
  }, [missing, store.id, id]);
  if (c.isPending) return <LoadingState rows={4} className="p-6" />;
  if (missing) return <NotFound what="conversation" store={store} />;
  if (c.isError) return <ErrorState message="Couldn't load this conversation." onRetry={() => c.refetch()} />;
  return <Conversation store={store} conversation={c.data} config={c.data.config} buttons={buttons} />;
}

/** `?run=`: a run in a conversation opens there; one with none reads here (decision 4). Scope comes from the run. */
function RunView({ store, id, buttons }: { store: Store; id: string; buttons: ReactNode }) {
  const run = useRun(id);
  if (run.isPending) return <LoadingState rows={4} className="p-6" />;
  if ((run.isError && /not found$/i.test(run.error.message)) || (run.data && run.data.storeId !== store.id)) return <NotFound what="run" store={store} />;
  if (run.isError) return <ErrorState message="Couldn't load this run." onRetry={() => run.refetch()} />;
  if (run.data.conversationId) return <Navigate replace to={agentsUrl({ store: store.id, conversation: run.data.conversationId })} />;
  return <ReadOnlyRun store={store} run={run.data} buttons={buttons} />;
}
