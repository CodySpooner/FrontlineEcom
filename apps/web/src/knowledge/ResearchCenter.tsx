// The Research Center (KB-16, design B `docs/reference/kb-research-center.html`): workspace chips, six stat tiles, the
// knowledge map, latest discoveries with a small artboard preview, and the research column (tasks, sources, what agents
// recommend, knowledge gaps), all on the server's numbers (GET /api/kb/overview).
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { AGENT_ROLES, KB_CARD_TYPES, KB_TASK_STAGES, type AgentRole, type KbDiscovery, type KbOverview, type KbStage, type KbTaskBrief } from '@frontline/shared';
import { useApprovals, useCreateKbCategory, useDecide, useKbCards, useKbOverview, useKbSources, useKbTask, useKbTaskAction, useKbTasks, useKbWorkspaces, useKeepBoth, useStores } from '../api/client';
import { Badge, Button, cx, ErrorState, LoadingState, Tabs } from '../components/ui';
import { ago } from '../lib/format';
import { NameForm } from './ArtboardPanels';
import { FETCH } from './DetailsPanel';
import { STAGE } from './Research';

type Set = (changes: Record<string, string | undefined>) => void;
const panel = 'rounded-xl border border-line bg-panel p-4';
const H2 = ({ children }: { children: ReactNode }) => <h2 className="font-display text-[15px] font-semibold text-white">{children}</h2>;
const H3 = ({ children }: { children: ReactNode }) => <h3 className="font-display text-[11px] font-semibold tracking-[.12em] text-muted uppercase">{children}</h3>;
const q = (o: Record<string, string>) => `/knowledge?${new URLSearchParams(o)}`;
/** Stages strongest first, as the map stacks them. */
const LEVELS: { stage: KbStage; label: string; bar: string }[] = [
  { stage: 'validated', label: 'validated', bar: 'bg-good' },
  { stage: 'tested', label: 'tested', bar: 'bg-text-2' },
  { stage: 'supported', label: 'supported', bar: 'bg-muted' },
  { stage: 'hypothesis', label: 'hypothesis', bar: 'border border-dashed border-line-3' },
];
const total = (stages: Record<KbStage, number>) => Object.values(stages).reduce((a, b) => a + b, 0);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function ResearchCenter({ ws, set, footer }: { ws: string; set: Set; footer: ReactNode }) {
  const stores = useStores().data ?? [];
  const o = useKbOverview(ws);
  const name = (id: string) => (id === 'general' ? 'General' : (stores.find((s) => s.id === id)?.name ?? id));
  return (
    <div className="grid gap-4">
      <Chips ws={ws} set={set} />
      {o.isPending ? (
        <LoadingState />
      ) : o.isError ? (
        <ErrorState message={o.error.message} onRetry={() => o.refetch()} />
      ) : (
        <>
          <Tiles ws={ws} o={o.data} />
          {/* Breakpoints all as min-[…px]: this Tailwind puts arbitrary ones before named ones, so they wouldn't win over lg:. */}
          <div className="grid gap-4 min-[1024px]:grid-cols-[280px_minmax(0,1fr)] min-[1440px]:grid-cols-[280px_minmax(0,1fr)_360px]">
            <KnowledgeMap ws={ws} o={o.data} />
            <div className="grid content-start gap-4">
              <Discoveries ws={ws} o={o.data} name={name} />
              <Preview o={o.data} />
            </div>
            <div className="min-[1024px]:col-span-2 min-[1440px]:col-span-1">
              <Column ws={ws} o={o.data} name={name} set={set} />
            </div>
          </div>
        </>
      )}
      {footer}
    </div>
  );
}

/** All workspaces, General and each store, with their card counts; they stand in for the toolbar's switcher here. */
function Chips({ ws, set }: { ws: string; set: Set }) {
  const stores = useStores().data ?? [];
  const counts = useKbWorkspaces().data ?? {};
  const chip = (value: string, label: string, color?: string) => (
    <button
      key={value}
      type="button"
      aria-pressed={ws === value}
      onClick={() => set({ ws: value, card: undefined })}
      className={cx('flex h-9 cursor-pointer items-center gap-2 rounded-full border px-4 text-[13px] transition', ws === value ? 'border-red bg-red-soft font-semibold text-white' : 'border-line-2 bg-bg-2 text-text-2 hover:text-white')}
    >
      {color && <i aria-hidden className="size-[7px] rounded-full" style={{ background: color }} />}
      {label}
      {value !== 'all' && (
        <>
          {' '}
          <span className="text-muted tabular-nums">{counts[value] ?? 0}</span>
        </>
      )}
    </button>
  );
  return (
    <div role="group" aria-label="Workspace" className="flex flex-wrap gap-2">
      {chip('all', 'All workspaces')}
      {chip('general', 'General')}
      {stores.map((s) => chip(s.id, s.name, s.color))}
    </div>
  );
}

function Tile({ to, label, value, sub, tone }: { to: string; label: string; value: number; sub: string; tone?: 'good' | 'red' }) {
  const body = (
    <>
      <span className="block text-xs text-muted">{label}</span>{' '}
      <span className={cx('block font-display text-[26px] font-bold tabular-nums', tone === 'good' ? 'text-good' : tone === 'red' && value ? 'text-red' : 'text-white')}>{value}</span>{' '}
      <span className="block text-xs text-text-2">{sub}</span>
    </>
  );
  const cls = cx(panel, 'block min-w-0 transition hover:border-line-3', tone === 'red' && value > 0 && 'border-red/60');
  return to.startsWith('#') ? (
    <a href={to} className={cls}>
      {body}
    </a>
  ) : (
    <Link to={to} className={cls}>
      {body}
    </Link>
  );
}

function Tiles({ ws, o }: { ws: string; o: KbOverview }) {
  const lib = (extra: Record<string, string> = {}) => q({ view: 'library', ...(ws === 'all' ? {} : { ws }), ...extra });
  return (
    <div className="grid grid-cols-2 gap-3 min-[640px]:grid-cols-3 min-[1440px]:grid-cols-6">
      <Tile to={lib()} label="Knowledge cards" value={o.cards} sub={`+${o.thisWeek} this week`} />
      <Tile to={lib({ stage: 'validated' })} label="Validated" value={o.validated} sub={o.cards ? `${Math.round((o.validated / o.cards) * 100)}% of cards` : 'none yet'} tone="good" />
      <Tile to={lib({ stage: 'hypothesis' })} label="Hypotheses" value={o.hypotheses} sub={`${o.supported} research-supported, ready to test`} />
      <Tile to="#kb-research" label="Researching now" value={o.running} sub={`${o.queued} queued · ${plural(o.researchers, 'agent')}`} />
      <Tile to={lib({ sort: 'verified', dir: 'asc' })} label="Needs refresh" value={o.stale} sub="over 90 days since checked" />
      <Tile to="#kb-discoveries" label="Conflicts" value={o.conflicts} sub={o.conflicts ? 'waiting for your call' : 'none open'} tone="red" />
    </div>
  );
}

function KnowledgeMap({ ws, o }: { ws: string; o: KbOverview }) {
  const create = useCreateKbCategory();
  const [adding, setAdding] = useState(false);
  const max = Math.max(1, ...o.map.map((m) => total(m.stages)));
  return (
    <section aria-label="Knowledge map" className={cx(panel, 'grid content-start gap-3 self-start')}>
      <div>
        <H2>Knowledge map</H2>
        <p className="text-xs text-muted">{`${o.cards} cards by category and evidence`}</p>
      </div>
      <div aria-hidden className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted capitalize">
        {LEVELS.map((l) => (
          <span key={l.stage} className="flex items-center gap-1.5">
            <i className={cx('size-2.5 rounded-sm', l.bar)} />
            {l.label}
          </span>
        ))}
      </div>
      {o.map.length ? (
        <ul className="grid gap-1">
          {o.map.map((m) => (
            <li key={m.name}>
              <Link to={q({ ws: m.ws, frame: m.categoryId })} className="grid gap-1 rounded-md px-1.5 py-1.5 transition hover:bg-panel-2">
                <span className="flex justify-between text-[13px] text-text">
                  <span>{m.name}</span> <span className="text-muted tabular-nums">{total(m.stages)}</span>
                </span>{' '}
                <span aria-hidden className="flex h-1.5 gap-px" style={{ width: `${(total(m.stages) / max) * 100}%` }}>
                  {LEVELS.filter((l) => m.stages[l.stage]).map((l) => (
                    <i key={l.stage} className={cx('h-full rounded-[1px]', l.bar)} style={{ flexGrow: m.stages[l.stage] }} />
                  ))}
                </span>
                <span className="sr-only">{LEVELS.filter((l) => m.stages[l.stage]).map((l) => `${m.stages[l.stage]} ${l.label}`).join(', ')}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted">No cards yet.</p>
      )}
      {/* A new root category belongs to one workspace, so not in All workspaces. */}
      {ws !== 'all' &&
        (adding ? (
          <NameForm label="Category name" busy={create.isPending} error={create.error?.message} onCancel={() => setAdding(false)} onSave={(n) => create.mutate({ ws, name: n }, { onSuccess: () => setAdding(false) })} />
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="h-9 cursor-pointer rounded-lg border border-dashed border-line-2 text-[13px] text-text-2 transition hover:text-white">
            + Custom category
          </button>
        ))}
    </section>
  );
}

const LABEL: Record<KbDiscovery['kind'], string> = { validated: 'Now validated', conflict: 'Conflict', promotion: 'Promote to General?' };

function Discoveries({ ws, o, name }: { ws: string; o: KbOverview; name: (ws: string) => string }) {
  const keep = useKeepBoth();
  const decide = useDecide();
  const home = (d: KbDiscovery) => d.card.storeId ?? 'general';
  return (
    <section id="kb-discoveries" aria-label="Latest discoveries" className={cx(panel, 'grid gap-3')}>
      <div className="flex items-baseline gap-2">
        <H2>Latest discoveries</H2>
        <span className="text-xs text-muted">this week</span>
        <Link to={q({ view: 'library', ...(ws === 'all' ? {} : { ws }), sort: 'updated' })} className="ml-auto text-xs text-red hover:underline">
          View all
        </Link>
      </div>
      {o.discoveries.length === 0 && <p className="text-xs text-muted">Nothing new this week. Cards that earn Validated, and conflicts and promotions waiting for your call, show here.</p>}
      {o.discoveries.map((d) => (
        <article key={d.kind === 'validated' ? `v-${d.card.id}` : d.id} className={cx('grid gap-1.5 rounded-lg border p-3.5', d.kind === 'conflict' ? 'border-red/50 bg-red/5' : 'border-line')}>
          <p className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-muted">
            <span className={cx('font-display font-semibold tracking-[.12em] uppercase', d.kind === 'validated' ? 'text-good' : 'text-red')}>{LABEL[d.kind]}</span>
            <span>{name(home(d))}</span>
            <span>{d.card.path.join(' › ')}</span>
            <span className="ml-auto">{ago(d.at)}</span>
          </p>
          <h3 className="text-[14px] font-semibold text-white">{d.card.title}</h3>
          {d.kind === 'validated' ? (
            <>
              {d.card.summary && <p className="text-[13px] text-text-2">{d.card.summary}</p>}
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="good">{d.reason}</Badge>
                <Link to={q({ ws: home(d), card: d.card.id })} className="ml-auto text-[13px] text-text-2 hover:text-white">
                  Open on artboard
                </Link>
              </div>
            </>
          ) : d.kind === 'promotion' ? (
            <>
              <p className="text-[13px] text-text-2">{`General version: ${d.title}`}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="primary" disabled={decide.isPending} onClick={() => decide.mutate({ id: d.id, verdict: 'approve' })}>
                  Approve
                </Button>
                <Link to={q({ view: 'library', ws: home(d), card: d.card.id })} className="inline-flex h-8 items-center rounded-lg border border-line-2 px-3 text-[13px] text-text-2 hover:text-white">
                  Review the edit
                </Link>
                <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: d.id, verdict: 'deny' })}>
                  Keep in store
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-[13px] text-text-2">{d.note}</p>
              {d.other && <p className="text-xs text-muted">{`Against: ${d.other.title}`}</p>}
              <div className="flex flex-wrap gap-2">
                <Link to={q({ view: 'library', ws: home(d), card: d.card.id })} className="inline-flex h-8 items-center rounded-lg border border-line-2 px-3 text-[13px] text-text-2 hover:text-white">
                  Compare evidence
                </Link>
                <Button size="sm" disabled={keep.isPending} onClick={() => keep.mutate({ id: d.id, ws: home(d) })}>
                  Keep both
                </Button>
              </div>
            </>
          )}
        </article>
      ))}
    </section>
  );
}

/** The newest discovery's frame (else the biggest category), small, with the way onto the artboard. */
function Preview({ o }: { o: KbOverview }) {
  const d = o.discoveries[0];
  const at = d ? { ws: d.card.storeId ?? 'general', categoryId: d.card.categoryId, path: d.card.path } : o.map[0] && { ws: o.map[0].ws, categoryId: o.map[0].categoryId, path: [o.map[0].name] };
  const cards = useKbCards(at?.ws ?? 'general', { category: at?.categoryId, sort: 'updated', limit: 5 });
  if (!at) return null;
  return (
    <section aria-label="Artboard preview" className={cx(panel, 'grid gap-3')}>
      <div className="flex flex-wrap items-baseline gap-2">
        <H2>Artboard</H2>
        <span className="text-xs text-muted">{at.path.join(' › ')}</span>
        <Link to={q({ ws: at.ws, frame: at.categoryId })} className="ml-auto inline-flex h-8 items-center rounded-lg border border-line-2 px-3 text-[13px] text-text-2 hover:text-white">
          Open artboard
        </Link>
      </div>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2 rounded-lg border border-line bg-[radial-gradient(var(--color-line)_1px,transparent_1px)] bg-[size:16px_16px] p-3">
        {(cards.data?.items ?? []).map((c) => (
          <li key={c.id} className={cx('rounded-md border bg-panel-2 px-2.5 py-2', c.stage === 'validated' ? 'border-red/60' : c.stage === 'hypothesis' ? 'border-dashed border-line-3' : 'border-line-2')}>
            <span className="block text-[10px] font-semibold tracking-[.1em] text-muted uppercase">{c.stage === 'validated' ? 'Validated' : KB_CARD_TYPES[c.type]}</span>
            <span className="line-clamp-2 text-xs font-semibold text-white">{c.title}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

type ColumnTab = 'active' | 'queue' | 'done' | 'sources';
const ENDED: Partial<Record<KbTaskBrief['status'], string>> = { done: 'Done', failed: 'Failed', cancelled: 'Stopped' };

function Column({ ws, o, name, set }: { ws: string; o: KbOverview; name: (ws: string) => string; set: Set }) {
  const [tab, setTab] = useState<ColumnTab>('active');
  const tasks = useKbTasks(ws).data ?? [];
  const sources = useKbSources(ws, false);
  const approvals = useApprovals().data ?? [];
  const decide = useDecide();
  const of = (s: KbTaskBrief['status'][]) => tasks.filter((t) => s.includes(t.status));
  const [active, queue, done] = [of(['running']), of(['queued']), of(['done', 'failed', 'cancelled'])];
  const meta = (t: { role: AgentRole; storeId: string | null }) => `${AGENT_ROLES[t.role].name} · ${name(t.storeId ?? 'general')}`;
  const recommended = approvals.flatMap((a) => {
    if (a.action.kind !== 'kb.research') return [];
    const p = a.action.payload as { ws: string | null; role: AgentRole; objective: string; budgetUsd: number };
    return ws === 'all' || (p.ws ?? 'general') === ws ? [{ id: a.id, ...p }] : [];
  });
  const row = (t: KbTaskBrief, badge?: ReactNode) => (
    <li key={t.id} className="flex items-start gap-2 rounded-lg border border-line px-3 py-2">
      <button type="button" onClick={() => set({ task: t.id })} className="min-w-0 flex-1 cursor-pointer text-left">
        <span className="block text-[13px] font-medium text-text hover:text-white">{t.objective}</span>
        <span className="block text-xs text-muted">{`${meta(t)} · ${ago(t.createdAt)}`}</span>
      </button>
      {badge}
    </li>
  );
  return (
    <section id="kb-research" aria-label="Research Center" className={cx(panel, 'grid content-start gap-3')}>
      <H2>Research Center</H2>
      {/* Tighter tabs, so all four fit the 360px column. */}
      <div className="[&_[role=tab]]:px-2.5">
        <Tabs
          label="Research"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'active', label: `Active ${active.length}` },
            { value: 'queue', label: `Queue ${queue.length}` },
            { value: 'done', label: `Done ${done.length}` },
            { value: 'sources', label: `Sources ${o.sources}` },
          ]}
        />
      </div>
      {tab === 'active' && (active.length ? active.map((t) => <TaskCard key={t.id} id={t.id} meta={meta(t)} onOpen={() => set({ task: t.id })} />) : <p className="text-xs text-muted">Nothing researching right now.</p>)}
      {tab === 'queue' && (queue.length ? <ul className="grid gap-1.5">{queue.map((t) => row(t))}</ul> : <p className="text-xs text-muted">Nothing waiting.</p>)}
      {tab === 'done' && (done.length ? <ul className="grid gap-1.5">{done.map((t) => row(t, <Badge tone={t.status === 'done' ? 'good' : t.status === 'failed' ? 'red' : 'muted'}>{ENDED[t.status]}</Badge>))}</ul> : <p className="text-xs text-muted">No finished research yet.</p>)}
      {tab === 'sources' &&
        (sources.data?.length ? (
          <ul className="grid gap-1">
            {sources.data.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-[13px]">
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-text-2 hover:text-white">
                    {s.title || s.url}
                  </a>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-text-2">{s.title}</span>
                )}
                <Badge tone={s.status === 'read' ? 'good' : 'muted'}>{FETCH[s.status]}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted">No sources read yet.</p>
        ))}

      <H3>Agents recommend</H3>
      {recommended.length ? (
        <ul aria-label="Agents recommend" className="grid gap-1.5">
          {recommended.map((r) => (
            <li key={r.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-text">{r.objective}</p>
                <p className="text-xs text-muted">{`${AGENT_ROLES[r.role].name} · ${name(r.ws ?? 'general')} · up to $${r.budgetUsd.toFixed(2)}`}</p>
              </div>
              <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, verdict: 'approve' })}>
                Approve
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted">None waiting. Agents suggest research when a task raises a question the knowledge base can't answer.</p>
      )}

      <H3>Knowledge gaps</H3>
      {o.gaps.length ? (
        <ul className="grid gap-0.5">
          {o.gaps.map((g) => (
            <li key={`${g.ws}-${g.categoryId}`}>
              <Link to={q({ ws: g.ws, frame: g.categoryId })} className="flex items-baseline justify-between gap-2 rounded-md px-1.5 py-1 text-[13px] text-text hover:bg-panel-2">
                <span>{`${name(g.ws)} · ${g.name}`}</span> <span className="text-xs text-muted">{g.reason}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted">No weak spots found.</p>
      )}

      <H3>Performance learning</H3>
      {ws === 'general' ? (
        <p className="text-xs text-muted">Lessons come from each store's own numbers. Promote one to share it here.</p>
      ) : (
        <ul aria-label="Performance learning" className="grid gap-2.5">
          {o.performance.map((p) => (
            <li key={p.storeId} className="grid gap-1 text-xs">
              <p className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] text-text">{name(p.storeId)}</span>
                <Link to={q({ view: 'library', ws: p.storeId, type: 'performance_lesson' })} className="text-muted hover:text-white">
                  {`${p.lessons} lesson${p.lessons === 1 ? '' : 's'}`}
                </Link>
              </p>
              {p.demo ? (
                <p className="text-muted">Demo store: nothing is learned from demo numbers. It starts when the store goes live.</p>
              ) : (
                <>
                  {p.on.map((s) => (
                    <p key={s} className="text-text-2">
                      {s}
                    </p>
                  ))}
                  {p.off.map((s) => (
                    <p key={s} className="text-muted">{`Not enabled: ${s}`}</p>
                  ))}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A task as it runs: the pipeline as a segmented bar, what it has read and found, and what it has spent. */
function TaskCard({ id, meta, onOpen }: { id: string; meta: string; onOpen: () => void }) {
  const t = useKbTask(id).data;
  const act = useKbTaskAction();
  if (!t) return <div className="h-32 animate-pulse rounded-lg bg-panel-2" />;
  const at = KB_TASK_STAGES.indexOf(t.stage as (typeof KB_TASK_STAGES)[number]);
  const read = t.sources.filter((s) => s.status === 'read').length;
  const blocked = t.sources.filter((s) => s.status !== 'read');
  const merged = t.findings.filter((f) => f.status === 'merged').length;
  return (
    <article className="grid gap-2 rounded-lg border border-line p-3.5">
      <div className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 text-[14px] font-semibold text-white">{t.objective}</h3>
        <span className="flex items-center gap-1.5 text-xs text-red">
          <i aria-hidden className="size-1.5 rounded-full bg-red" />
          Running
        </span>
      </div>
      <p className="text-xs text-muted">{meta}</p>
      <div aria-hidden className="flex gap-1">
        {KB_TASK_STAGES.map((s, i) => (
          <i key={s} data-testid="stage" data-state={i < at ? 'done' : i === at ? 'now' : 'todo'} className={cx('h-1 flex-1 rounded-full', i < at ? 'bg-text-2' : i === at ? 'bg-red' : 'bg-line-2')} />
        ))}
      </div>
      <p className="text-[13px] text-text">{at < 0 ? STAGE[t.stage] : `Step ${at + 1} of ${KB_TASK_STAGES.length} · ${STAGE[t.stage] ?? t.stage}`}</p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-text-2">
        <span>{plural(read, 'source') + ' read'}</span>
        {blocked.length > 0 && <span>{`${blocked.length} blocked (${[...new Set(blocked.map((s) => FETCH[s.status]))].join(', ')})`}</span>}
        <span>{`${plural(t.findings.length, 'finding')} so far`}</span>
        {merged > 0 && <span>{merged === 1 ? '1 matches an existing card' : `${merged} match existing cards`}</span>}
      </div>
      <div className="flex items-center gap-2">
        <span className="flex-1 text-xs text-muted tabular-nums">{`$${t.spentUsd.toFixed(2)} of $${t.budgetUsd.toFixed(2)}`}</span>
        <Button size="sm" disabled={act.isPending} onClick={() => act.mutate({ id, action: 'cancel' })}>
          Stop
        </Button>
        <Button size="sm" onClick={onOpen}>
          Open task
        </Button>
      </div>
    </article>
  );
}
