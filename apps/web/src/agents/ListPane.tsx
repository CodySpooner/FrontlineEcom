import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQueries } from '@tanstack/react-query';
import { Archive, ArrowLeft, ChevronDown, ChevronRight, ChevronsUpDown, Ellipsis, Pin, Plus, Search, Users, type LucideIcon } from 'lucide-react';
import type { AgentTypeInfo, Conversation, ConversationState, SquadMission, Store } from '@frontline/shared';
import { teamQuery, useAgentTypes, useConversationCounts, useConversations, useStores, useUpdateConversation } from '../api/client';
import { PLATFORM_NAME } from '../components/StoreForm';
import { Button, cx, ErrorState, LoadingState, RUN_STATUS } from '../components/ui';
import { useTeamDialog } from './CreateTeam';
import { useDeploy } from './Deploy';
import { useStored } from './layout';
import { hidePopover, MenuItem, Popover, rove } from './Popover';
import { useAgentSettings } from './settings';
import { StateDot } from './StateDot';
import { currentTask, stateOf, teamMeta } from './Team';
import { agentsUrl } from './urls';

const ACTIVE = new Set<ConversationState>(['running', 'awaiting_approval', 'waiting_for_input', 'queued', 'failed', 'interrupted']);
const date = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
/** A row's right-hand meta: the state's word while it needs watching, else the last activity date. */
export const meta = (c: Conversation) => (ACTIVE.has(c.state) ? RUN_STATUS[c.state].label : date(c.lastActivityAt));
const RANGES = [7, 30, 90];

const Label = ({ children, className }: { children: ReactNode; className?: string }) => <div className={cx('px-2.5 pt-3 pb-1 text-[11px] font-semibold tracking-[.07em] text-muted uppercase', className)}>{children}</div>;

/**
 * The store's conversations: the store switcher, search, then Pinned, Teams and Agents grouped by type, older ones
 * loading on scroll, and the archive. Keyed by store, so search and the archive view reset on a switch.
 */
export function ListPane({ store, open, search }: { store: Store; open?: string; search: RefObject<HTMLInputElement | null> }) {
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const [range, setRange] = useState<number | undefined>(30);
  const [collapsed, setCollapsed] = useStored<string[]>('fe.agents.collapsed', []);
  const [renaming, setRenaming] = useState<string>();
  const [tabStop, setTabStop] = useState<string>();
  const query = q.trim();
  const flat = archived || !!query;
  const list = useConversations(store.id, archived ? { view: 'archived', ...(query ? { q: query } : {}) } : query ? { q: query } : range ? { range } : {});
  const pinned = useConversations(store.id, { view: 'pinned' }).data?.pages.flatMap((p) => p.items) ?? [];
  const archivedTotal = useConversations(store.id, { view: 'archived' }).data?.pages[0]?.total ?? 0;
  const types = useAgentTypes(store.id).data ?? [];
  const update = useUpdateConversation(store.id);
  const deploy = useDeploy();
  const teamDialog = useTeamDialog();
  // `?expand=<type>` (an old agent link): that type's group is shown open.
  const expand = useSearchParams()[0].get('expand') ?? undefined;
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const byType = list.data?.pages[0]?.byType ?? {};
  // Running teams first, then ended ones, newest first (the list comes newest first).
  const teamRows = useQueries({ queries: items.flatMap((c) => (c.teamId ? [teamQuery(store.id, c.teamId)] : [])) });
  const byTeam = new Map(teamRows.flatMap((q) => (q.data ? [[q.data.id, q.data] as const] : [])));
  const teams = items.filter((c) => c.teamId).sort((a, b) => Number(byTeam.get(b.teamId!)?.status === 'running') - Number(byTeam.get(a.teamId!)?.status === 'running'));
  // Types with conversations become groups (a type no longer listed, such as an archived custom role, keeps its own);
  // the rest fold into one row.
  const named = new Map(types.map((t) => [t.id, t]));
  const groups = [...types.filter((t) => byType[t.id]), ...Object.keys(byType).filter((id) => id !== 'team' && !named.has(id)).map((id) => ({ id, name: 'Archived role', description: '', baseRole: 'copywriter' as const }))];
  const idle = types.filter((t) => !byType[t.id]);
  const keys = flat ? items.map((c) => `f:${c.id}`) : [...pinned.map((c) => `p:${c.id}`), ...teams.map((c) => `t:${c.id}`), ...groups.flatMap((g) => (collapsed.includes(g.id) ? [] : items.filter((c) => !c.teamId && c.type === g.id).map((c) => `g:${c.id}`)))];
  // One tab stop for the rows: the last one focused, else the open conversation, else the first.
  const stop = keys.includes(tabStop ?? '') ? tabStop : (keys.find((k) => k.endsWith(`:${open}`)) ?? keys[0]);
  const row = (c: Conversation, section: string, icon?: LucideIcon, team?: SquadMission) => (
    <Row
      key={`${section}:${c.id}`}
      c={c}
      store={store}
      team={team}
      open={c.id === open || (!!c.teamId && c.teamId === open)}
      icon={icon}
      indent={!icon && section === 'g'}
      tabStop={stop === `${section}:${c.id}`}
      onFocus={() => setTabStop(`${section}:${c.id}`)}
      menu={`menu-${section}-${c.id}`}
      renaming={renaming === `${section}:${c.id}`}
      onRename={(title) => {
        setRenaming(undefined);
        if (title !== undefined && title.trim() && title.trim() !== c.title) update.mutate({ id: c.id, title: title.trim() });
      }}
      actions={[
        ['Rename', () => setRenaming(`${section}:${c.id}`)],
        [c.pinned ? 'Unpin' : 'Pin', () => update.mutate({ id: c.id, pinned: !c.pinned })],
        [c.archivedAt ? 'Unarchive' : 'Archive', () => update.mutate({ id: c.id, archived: !c.archivedAt })],
      ]}
    />
  );
  return (
    <nav aria-label="Conversations" className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2.5 px-3.5 pt-3.5 pb-2.5">
        <StoreSwitcher store={store} />
        <div className="flex gap-2">
          <Button variant="primary" size="sm" className="flex-1" onClick={() => deploy.open()}>
            <Plus aria-hidden className="size-3.5" /> Deploy agent
          </Button>
          <Button size="sm" className="flex-1" onClick={() => teamDialog.open()}>
            <Users aria-hidden className="size-3.5" /> Create team
          </Button>
        </div>
        <label className="flex h-8 items-center gap-2 rounded-lg border border-[#26262c] bg-bg-2 px-2.5 text-muted focus-within:border-red/60">
          <Search aria-hidden className="size-4 shrink-0" strokeWidth={1.8} />
          <input ref={search} type="search" aria-label="Search conversations" placeholder="Search this store's conversations" value={q} onChange={(e) => setQ(e.target.value)} className="w-full min-w-0 bg-transparent text-[12.5px] text-text outline-none placeholder:text-muted" />
          <kbd className="rounded border border-[#2c2c33] px-1.5 font-sans text-[10px]">/</kbd>
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" onKeyDown={(e) => rove(e, '[data-row]')}>
        {archived && (
          <button type="button" onClick={() => setArchived(false)} className="flex cursor-pointer items-center gap-1.5 px-2.5 pt-1 pb-1 text-[12px] text-text-2 hover:text-white">
            <ArrowLeft aria-hidden className="size-3.5" />
            Archived conversations
          </button>
        )}
        {list.isPending ? (
          <LoadingState rows={5} className="px-2 pt-2" />
        ) : list.isError ? (
          <ErrorState message="Couldn't load the conversations." onRetry={() => list.refetch()} />
        ) : flat ? (
          items.length ? (
            items.map((c) => row(c, 'f', undefined, c.teamId ? byTeam.get(c.teamId) : undefined))
          ) : (
            <p className="px-2.5 py-3 text-[12.5px] text-muted">{query ? `No conversation matches "${query}".` : 'No archived conversations.'}</p>
          )
        ) : (
          <>
            {pinned.length > 0 && (
              <>
                <Label className="pt-1.5">Pinned</Label>
                {pinned.map((c) => row(c, 'p', c.teamId ? Users : Pin, c.teamId ? byTeam.get(c.teamId) : undefined))}
              </>
            )}
            {teams.length > 0 && (
              <>
                <Label>Teams</Label>
                {teams.map((c) => {
                  const t = byTeam.get(c.teamId!);
                  // A running team, or the one open, shows its participants (role, status, current task).
                  return (
                    <div key={`t:${c.id}`}>
                      {row(c, 't', Users, t)}
                      {t && (t.status === 'running' || t.id === open) && t.participants?.map((p, i) => (
                        <Link
                          key={p.configId}
                          data-row
                          tabIndex={-1}
                          to={`${agentsUrl({ store: store.id, team: t.id })}&participant=${encodeURIComponent(p.configId)}`}
                          className="flex items-center gap-2 rounded-[7px] py-[5px] pr-2.5 pl-[30px] text-[12px] text-[#c4c4cc] outline-none hover:bg-[#141418] focus-visible:ring-1 focus-visible:ring-red/60"
                        >
                          <StateDot state={stateOf(t.steps.filter((s) => s.configId === p.configId))} label={RUN_STATUS[stateOf(t.steps.filter((s) => s.configId === p.configId))].label} />
                          <span className="shrink-0">
                            {p.name}
                            {i === 0 && ' (lead)'}
                          </span>
                          <span className="ml-auto min-w-0 truncate text-[11px] text-muted">{currentTask(t, p.configId)}</span>
                        </Link>
                      ))}
                    </div>
                  );
                })}
              </>
            )}
            <div className="flex items-baseline px-2.5 pt-3 pb-1">
              <span className="text-[11px] font-semibold tracking-[.07em] text-muted uppercase">Agents</span>
              <span className="ml-auto text-[11px] text-muted">Group: type</span>
            </div>
            {!groups.length && <p className="px-2.5 py-2 text-[12.5px] text-muted">{range ? `No conversations in the last ${range} days.` : 'No conversations yet.'}</p>}
            {groups.map((g) => {
              const shut = collapsed.includes(g.id) && g.id !== expand;
              return (
                <div key={g.id}>
                  <div className="group relative">
                    <button
                      type="button"
                      aria-expanded={!shut}
                      onClick={() => setCollapsed((all) => (shut ? all.filter((id) => id !== g.id) : [...all, g.id]))}
                      className="flex w-full cursor-pointer items-center gap-[7px] rounded-[7px] px-2.5 pt-[9px] pb-[3px] text-left text-[12.5px] font-semibold text-[#e6e6ea]"
                    >
                      {shut ? <ChevronRight aria-hidden className="size-[13px] text-muted" /> : <ChevronDown aria-hidden className="size-[13px] text-muted" />}
                      {g.name}
                      <span className="text-[11px] font-medium text-muted">{byType[g.id]}</span>
                    </button>
                    {named.has(g.id) && <TypeMenu type={g} />}
                  </div>
                  {!shut && items.filter((c) => !c.teamId && c.type === g.id).map((c) => row(c, 'g'))}
                </div>
              );
            })}
            {idle.length > 0 && <MoreTypes types={idle} />}
          </>
        )}
        {list.hasNextPage && <LoadOlder busy={list.isFetchingNextPage} onLoad={() => list.fetchNextPage()} />}
      </div>
      {!archived && (
        <div className="flex items-center justify-between gap-2 border-t border-[#1d1d22] px-[18px] py-2.5 text-[12px] text-muted">
          <button type="button" onClick={() => setArchived(true)} className="flex cursor-pointer items-center gap-[7px] text-[#a9a9b2] hover:text-white">
            <Archive aria-hidden className="size-3.5" strokeWidth={1.8} />
            Archived · {archivedTotal}
          </button>
          <button type="button" popoverTarget="list-range" className="cursor-pointer hover:text-white">
            {range ? `Showing active + ${range} days` : 'Showing all'}
          </button>
          <Popover id="list-range" label="Show conversations from" align="end" className="w-44">
            {[...RANGES, undefined].map((r) => (
              <MenuItem key={r ?? 'all'} popover="list-range" current={r === range} onClick={() => setRange(r)}>
                {r ? `Active + ${r} days` : 'All conversations'}
              </MenuItem>
            ))}
          </Popover>
        </div>
      )}
    </nav>
  );
}

function Row({
  c,
  store,
  team,
  open,
  icon: Icon,
  indent,
  tabStop,
  onFocus,
  menu,
  renaming,
  onRename,
  actions,
}: {
  c: Conversation;
  store: Store;
  /** A team's own conversation row: it opens the team, and the team gives its dot and meta. */
  team?: SquadMission;
  open: boolean;
  icon?: LucideIcon;
  indent: boolean;
  tabStop: boolean;
  onFocus: () => void;
  menu: string;
  renaming: boolean;
  onRename: (title?: string) => void;
  actions: [string, () => void][];
}) {
  const t = team && teamMeta(team);
  const state = t?.state ?? c.state;
  const word = t ? t.word : ACTIVE.has(c.state) ? undefined : RUN_STATUS[c.state].label;
  const pad = indent ? 'pl-[30px]' : 'pl-2.5';
  if (renaming)
    return (
      <div className={cx('py-1 pr-2', pad)}>
        <input
          autoFocus
          aria-label="Conversation title"
          defaultValue={c.title}
          maxLength={200}
          onBlur={(e) => onRename(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onRename(e.currentTarget.value);
            if (e.key === 'Escape') onRename();
          }}
          className="w-full rounded-md border border-red/60 bg-bg-2 px-2 py-1 text-[13px] text-text outline-none"
        />
      </div>
    );
  // The context-menu key (or Shift+F10) opens the row's menu.
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
    e.preventDefault();
    document.getElementById(menu)?.showPopover?.();
  };
  return (
    <div className="group relative">
      <Link
        data-row
        to={c.teamId ? agentsUrl({ store: store.id, team: c.teamId }) : agentsUrl({ store: store.id, conversation: c.id })}
        tabIndex={tabStop ? 0 : -1}
        onFocus={onFocus}
        onKeyDown={onKey}
        aria-current={open ? 'page' : undefined}
        className={cx('flex items-center gap-[9px] rounded-[7px] py-1.5 pr-2.5 text-[13px] outline-none focus-visible:ring-1 focus-visible:ring-red/60', pad, open ? 'bg-[#1b1b20] text-white' : 'text-text-2 hover:bg-[#141418]')}
      >
        {Icon ? <Icon aria-hidden className="size-3.5 shrink-0 text-muted" strokeWidth={1.8} /> : <StateDot state={state} label={word} />}
        <span title={c.title} className="min-w-0 flex-1 truncate">
          {c.title}
        </span>
        {/* Pinned rows show only the dot, team rows the meta and the dot, as on the board. */}
        <span className="flex items-center gap-1.5 text-[11px] whitespace-nowrap text-muted group-focus-within:invisible group-hover:invisible">
          {Icon !== Pin && (t ? t.meta : meta(c))}
          {Icon && <StateDot state={state} label={Icon === Pin ? (t?.word ?? RUN_STATUS[c.state].label) : word} />}
        </span>
      </Link>
      <button
        type="button"
        tabIndex={-1}
        aria-label={`More for ${c.title}`}
        popoverTarget={menu}
        className="absolute top-1/2 right-1 grid size-6 -translate-y-1/2 cursor-pointer place-items-center rounded-md text-muted opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-panel-2 hover:text-white"
      >
        <Ellipsis className="size-4" />
      </button>
      <Popover id={menu} label={`Actions for ${c.title}`} align="end" className="w-40">
        {actions.map(([label, act]) => (
          <MenuItem key={label} popover={menu} onClick={act}>
            {label}
          </MenuItem>
        ))}
      </Popover>
    </div>
  );
}

/** Types with no conversations in the list's range, folded into one row; each starts a new conversation. */
function MoreTypes({ types }: { types: AgentTypeInfo[] }) {
  const [shown, setShown] = useState(false);
  const deploy = useDeploy();
  return (
    <div>
      <button type="button" aria-expanded={shown} onClick={() => setShown(!shown)} className="flex w-full cursor-pointer items-center gap-[7px] px-2.5 pt-[9px] pb-[3px] text-left text-[12.5px] font-medium text-muted hover:text-text-2">
        {shown ? <ChevronDown aria-hidden className="size-[13px]" /> : <ChevronRight aria-hidden className="size-[13px]" />}
        {types.length} more agent type{types.length === 1 ? '' : 's'} · no conversations yet
      </button>
      {shown &&
        types.map((t) => (
          <button
            key={t.id}
            type="button"
            title={t.description}
            aria-label={`New conversation with ${t.name}`}
            onClick={() => deploy.open(t.id)}
            className="group/new flex w-full cursor-pointer items-center gap-2 rounded-[7px] py-1 pr-2.5 pl-[30px] text-left text-[12.5px] text-muted hover:bg-[#141418] hover:text-text-2"
          >
            <span className="min-w-0 flex-1 truncate">{t.name}</span>
            <Plus aria-hidden className="size-3.5 opacity-0 group-hover/new:opacity-100 group-focus-visible/new:opacity-100" />
          </button>
        ))}
    </div>
  );
}

/** A type header's menu: a new conversation with it, and its seat's settings. */
function TypeMenu({ type }: { type: Pick<AgentTypeInfo, 'id' | 'name' | 'baseRole'> }) {
  const settings = useAgentSettings();
  const deploy = useDeploy();
  const id = `type-${type.id.replace(/\W/g, '-')}`;
  return (
    <>
      <button
        type="button"
        aria-label={`More for ${type.name}`}
        popoverTarget={id}
        className="absolute top-[6px] right-1 grid size-6 cursor-pointer place-items-center rounded-md text-muted opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-panel-2 hover:text-white"
      >
        <Ellipsis className="size-4" />
      </button>
      <Popover id={id} label={`Actions for ${type.name}`} align="end" className="w-40">
        <MenuItem popover={id} onClick={() => deploy.open(type.id)}>
          New conversation
        </MenuItem>
        <MenuItem popover={id} onClick={() => settings.open(type.baseRole)}>
          Agent settings
        </MenuItem>
      </Popover>
    </>
  );
}

/** Loads the next 50 when it scrolls into view, or on click. */
function LoadOlder({ busy, onLoad }: { busy: boolean; onLoad: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const load = useRef(onLoad);
  load.current = busy ? () => undefined : onLoad;
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || !ref.current) return;
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && load.current());
    io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  return (
    <button ref={ref} type="button" disabled={busy} onClick={onLoad} className="mt-1 w-full cursor-pointer rounded-md py-1.5 text-[12px] text-muted hover:text-white disabled:cursor-default">
      {busy ? 'Loading…' : 'Show older'}
    </button>
  );
}

/** The store button and its picker: every store with what's going and waiting there. Switching changes only the view. */
function StoreSwitcher({ store }: { store: Store }) {
  const stores = useStores().data ?? [];
  const counts = useConversationCounts().data ?? {};
  const others = stores.filter((s) => s.id !== store.id);
  const running = others.reduce((n, s) => n + (counts[s.id]?.running ?? 0), 0);
  const square = (s: Store) => (
    <span aria-hidden className="grid size-[30px] shrink-0 place-items-center rounded-lg text-[13px] font-bold text-white" style={{ background: s.color }}>
      {s.name.charAt(0).toUpperCase()}
    </span>
  );
  const line = (s: Store) => [PLATFORM_NAME[s.platform], s.nicheDetail ?? s.niche].join(' · ');
  return (
    <>
      <button type="button" popoverTarget="store-switcher" aria-label={`${store.name}: switch store`} className="flex w-full cursor-pointer items-center gap-2.5 rounded-[10px] border border-[#26262c] bg-[#111114] px-2.5 py-2 text-left hover:border-line-2">
        {square(store)}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{store.name}</span>
          <span className="block truncate text-[11px] text-muted">{line(store)}</span>
        </span>
        <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-muted" />
      </button>
      {others.length > 0 && (
        <div className="-mt-1 px-0.5 text-[11.5px] text-muted">
          {others.length} other store{others.length === 1 ? '' : 's'} · <span className={running ? 'text-[#3ddc84]' : undefined}>{running} agent{running === 1 ? '' : 's'} running there</span>
        </div>
      )}
      <Popover id="store-switcher" label="Switch store" className="w-[264px]">
        {stores.map((s) => {
          const n = counts[s.id];
          const busy = [n?.running && `${n.running} running`, n?.waiting && `${n.waiting} waiting`].filter(Boolean).join(' · ');
          return (
            <Link
              key={s.id}
              data-item
              role="menuitem"
              to={agentsUrl({ store: s.id })}
              aria-current={s.id === store.id ? 'true' : undefined}
              onClick={() => hidePopover('store-switcher')}
              className={cx('flex items-center gap-2.5 rounded-lg px-2 py-1.5 outline-none hover:bg-panel-2 focus-visible:bg-panel-2', s.id === store.id && 'bg-[#1b1b20]')}
            >
              {square(s)}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">{s.name}</span>
                <span className="block truncate text-[11px] text-muted">{PLATFORM_NAME[s.platform]}</span>
              </span>
              {busy && <span className="text-[11px] whitespace-nowrap text-[#3ddc84]">{busy}</span>}
            </Link>
          );
        })}
      </Popover>
    </>
  );
}
