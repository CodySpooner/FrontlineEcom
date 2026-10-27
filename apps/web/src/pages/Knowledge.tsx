// UI-16 Knowledge Base: the expertise layers agents read (role playbooks, platform and niche packs) and each store's memory.
import { useDeferredValue, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Brain, Pin, Search, Trash2 } from 'lucide-react';
import type { KnowledgeDoc, KnowledgeKind, MemoryKind, StoreMemory } from '@frontline/shared';
import { useAgents, useDraftNichePack, useForgetMemory, useKnowledge, useKnowledgeDoc, useMemories, useSaveKnowledge, useUpdateMemory } from '../api/client';
import { FixLink } from '../components/Chat';
import { Hero } from '../components/Hero';
import { Markdown } from '../components/Markdown';
import { SharedLearnings } from '../components/NicheLearnings';
import { StoreFilter, useStoreSelection } from '../components/StoreFilter';
import { Badge, Button, ConfirmDelete, cx, EmptyState, ErrorState, inputClass, LoadingState, MEMORY_KINDS, memoryAuthor, Panel, Segmented, Tabs, useFocusBack } from '../components/ui';
import { ago } from '../lib/format';
import { nicheKey } from '../lib/niche';
import { NAV } from '../nav';

type Tab = KnowledgeKind | 'memory';
const TABS: { value: Tab; label: string }[] = [
  { value: 'playbook', label: 'Playbooks' },
  { value: 'platform', label: 'Platform packs' },
  { value: 'niche', label: 'Niche packs' },
  { value: 'memory', label: 'Store memory' },
];
const ABOUT: Record<KnowledgeKind, string> = {
  playbook: 'How each agent role works: its loop, thresholds and red lines.',
  platform: 'Rules and limits of each selling platform, read by agents on stores that sell there.',
  niche: 'What sells, to whom and how. Every store in the niche reads it.',
};
const MAX = 50_000;
const short = (d: KnowledgeDoc) => d.title.replace(/ (playbook|platform pack|niche pack)$/, '');

export function Knowledge() {
  const nav = NAV.find((n) => n.path === '/knowledge')!;
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.value === params.get('tab'))?.value ?? 'playbook') as Tab;
  return (
    <>
      <Hero title={nav.title} subtitle={nav.subtitle} icon={nav.icon} art={nav.art} />
      <div className="mb-3.5">
        <Tabs label="Knowledge" tabs={TABS} value={tab} onChange={(t) => setParams(t === 'playbook' ? {} : { tab: t }, { replace: true })} />
      </div>
      {tab === 'memory' ? <MemoryBrowser /> : <Docs key={tab} kind={tab} />}
    </>
  );
}

function Docs({ kind }: { kind: KnowledgeKind }) {
  const q = useKnowledge();
  const { stores } = useStoreSelection();
  const [params, setParams] = useSearchParams();
  const docs = (q.data ?? []).filter((d) => d.kind === kind);
  const sel = docs.find((d) => d.key === params.get('doc')) ?? docs[0];
  const usedBy = (d: KnowledgeDoc) => (kind === 'playbook' ? [] : stores.filter((s) => (kind === 'platform' ? s.platform : nicheKey(s)) === d.key).map((s) => s.name));
  return (
    <div className="grid items-start gap-3.5 min-[1000px]:grid-cols-[280px_minmax(0,1fr)]">
      <Panel title={TABS.find((t) => t.value === kind)!.label} sub={ABOUT[kind]}>
        {q.isPending ? (
          <LoadingState rows={5} />
        ) : q.isError ? (
          <ErrorState message="Couldn't load the knowledge base." onRetry={() => q.refetch()} />
        ) : (
          <ul className="grid gap-1.5">
            {docs.map((d) => {
              const used = usedBy(d);
              return (
                <li key={d.key}>
                  <button
                    type="button"
                    aria-current={d.key === sel?.key}
                    onClick={() => setParams({ ...(kind !== 'playbook' && { tab: kind }), doc: d.key }, { replace: true })}
                    className={cx('w-full cursor-pointer rounded-lg border px-3 py-2 text-left transition', d.key === sel?.key ? 'border-red/70 bg-red-soft' : 'border-line bg-bg-2 hover:border-line-3')}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <b className="text-[13px] font-semibold">{short(d)}</b>
                      {d.custom ? <Badge>Custom</Badge> : d.edited && <Badge>Edited</Badge>}
                    </span>
                    {used.length > 0 && <span className="mt-0.5 block truncate text-xs text-muted">Used by {used.join(', ')}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {kind === 'niche' && q.data && <MissingPacks docs={docs} />}
      </Panel>
      {sel && (
        <div className="grid gap-3.5">
          {kind === 'niche' && <SharedLearnings key={sel.key} by={{ niche: sel.key }} niche={short(sel)} />}
          <DocView key={`${sel.kind}:${sel.key}`} d={sel} />
        </div>
      )}
    </div>
  );
}

/** Custom-niche stores with no pack yet. Going live drafts one once; after a denied or failed draft the owner asks again here. */
function MissingPacks({ docs }: { docs: KnowledgeDoc[] }) {
  const { stores } = useStoreSelection();
  const agents = useAgents().data;
  const draft = useDraftNichePack();
  const navigate = useNavigate();
  const missing = stores.filter((s) => s.niche === 'other' && s.nicheDetail?.trim() && !docs.some((d) => d.key === nicheKey(s)));
  if (!missing.length) return null;
  return (
    <ul className="mt-3 grid gap-1.5 border-t border-line pt-3">
      {missing.map((s) => {
        const analyst = agents?.find((a) => a.id === `${s.id}:market_analyst`);
        return (
          <li key={s.id} className="rounded-lg border border-dashed border-line px-3 py-2 text-xs text-muted">
            <b className="text-[13px] font-semibold text-text">{s.nicheDetail}</b> has no pack yet ({s.name}).
            {/* The demo engine can't research a niche: its pack would be made up, so the route refuses it. */}
            {analyst?.engine?.provider === 'claude' ? (
              <div className="mt-1.5">
                <Button size="sm" disabled={draft.isPending} onClick={() => draft.mutate(analyst.id, { onSuccess: (r) => navigate(`/agents/${encodeURIComponent(r.agentId)}?run=${r.id}`) })}>
                  Ask its Market Analyst to draft one
                </Button>
              </div>
            ) : (
              <span className="block">Its Market Analyst drafts one once the store is connected.</span>
            )}
            {draft.isError && draft.variables === analyst?.id && (
              <p role="alert" className="mt-1 text-red">
                {draft.error.message} <FixLink message={draft.error.message} agentId={analyst.id} />
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function DocView({ d }: { d: KnowledgeDoc }) {
  const q = useKnowledgeDoc(d.kind, d.key);
  const save = useSaveKnowledge();
  const [draft, setDraft] = useState<string>();
  const [confirm, setConfirm] = useState(false);
  const editing = draft !== undefined;
  const editRef = useFocusBack(editing);
  const restoreRef = useFocusBack(confirm);
  const actions = !editing && q.data && (
    <span className="flex items-center gap-2">
      {d.edited &&
        (confirm ? (
          <>
            <Button size="sm" autoFocus onClick={() => setConfirm(false)}>
              Keep mine
            </Button>
            <Button size="sm" variant="primary" disabled={save.isPending} onClick={() => save.mutate({ kind: d.kind, key: d.key }, { onSuccess: () => setConfirm(false) })}>
              Restore original
            </Button>
          </>
        ) : (
          <Button ref={restoreRef} size="sm" onClick={() => setConfirm(true)}>
            Restore original
          </Button>
        ))}
      {!confirm && (
        <Button ref={editRef} size="sm" onClick={() => setDraft(q.data.markdown ?? '')}>
          Edit
        </Button>
      )}
    </span>
  );
  return (
    <Panel
      title={d.title}
      sub={d.edited ? 'Your edited version. Agents use it from their next run.' : d.custom ? 'Drafted by the Market Analyst for your custom niche.' : 'Agents read this before every task.'}
      action={actions}
    >
      {q.isPending ? (
        <LoadingState rows={8} />
      ) : q.isError ? (
        <ErrorState message="Couldn't load this document." onRetry={() => q.refetch()} />
      ) : editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({ kind: d.kind, key: d.key, markdown: draft }, { onSuccess: () => setDraft(undefined) });
          }}
          className="grid gap-2"
        >
          <label htmlFor="kb-edit" className="sr-only">
            {d.title} (markdown)
          </label>
          <textarea id="kb-edit" value={draft} onChange={(e) => setDraft(e.target.value)} rows={24} maxLength={MAX} spellCheck={false} className={cx(inputClass, 'resize-y font-mono text-[12px] leading-relaxed')} />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="mr-auto text-xs text-muted tabular-nums">
              {draft.length.toLocaleString('en-US')} / {MAX.toLocaleString('en-US')} characters
            </span>
            {save.isError && (
              <span role="alert" className="text-xs text-red">
                {save.error.message}
              </span>
            )}
            <Button onClick={() => setDraft(undefined)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={!draft.trim() || save.isPending}>
              Save for all agents
            </Button>
          </div>
        </form>
      ) : (
        // The panel already shows the doc's title, so its leading # heading is dropped.
        <Markdown text={(q.data.markdown ?? '').replace(/^# .*\r?\n/, '')} />
      )}
    </Panel>
  );
}

function MemoryBrowser() {
  const { stores, has } = useStoreSelection();
  const q = useMemories(stores.filter((s) => has(s.id)).map((s) => s.id));
  const [kind, setKind] = useState<MemoryKind | 'all'>('all');
  const [search, setSearch] = useState('');
  const needle = useDeferredValue(search.trim().toLowerCase());
  const list = (q.data ?? [])
    .filter((m) => (kind === 'all' || m.kind === kind) && (!needle || [m.text, m.evidence, ...m.tags].some((s) => s?.toLowerCase().includes(needle))))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.createdAt.localeCompare(a.createdAt));
  return (
    <>
      <div className="mb-3.5">
        <StoreFilter />
      </div>
      <Panel title="Store Memory" sub="What the squads learned while working, plus what you taught them. Your notes, your no's and pinned items go into every run for that store.">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Segmented label="Kind" options={[{ value: 'all' as const, label: 'All' }, ...MEMORY_KINDS]} value={kind} onChange={setKind} />
          <label className="relative min-w-60 flex-1">
            <span className="sr-only">Search memory</span>
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search memory, evidence or tags" className={cx(inputClass, 'w-full pl-9')} />
          </label>
        </div>
        {q.isPending ? (
          <LoadingState rows={4} />
        ) : q.isError ? (
          <ErrorState message="Couldn't load store memory." onRetry={q.refetch} />
        ) : !list.length ? (
          <EmptyState icon={Brain} title={q.data?.length ? 'Nothing matches' : 'Nothing learned yet'}>
            {q.data?.length ? 'Try another word or kind.' : "Agents save what worked and why as they run tasks. You can also teach a store's squad from any agent's Memory tab."}
          </EmptyState>
        ) : (
          <ul className="grid gap-2">
            {list.map((m) => (
              <MemoryRow key={m.id} m={m} />
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

function MemoryRow({ m }: { m: StoreMemory }) {
  const { name } = useStoreSelection();
  const update = useUpdateMemory();
  const forget = useForgetMemory(m.storeId);
  const [draft, setDraft] = useState<string>();
  const memEditRef = useFocusBack(draft !== undefined);
  return (
    <li className={cx('rounded-lg border bg-bg-2 px-3 py-2.5', m.pinned ? 'border-red/45' : 'border-line')}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
            {m.pinned && <Badge tone="red">Pinned</Badge>}
            <Badge>{MEMORY_KINDS.find((k) => k.value === m.kind)?.label}</Badge>
            {memoryAuthor(m.agentId)} · {name(m.storeId)} · {ago(m.createdAt)} · {Math.round(m.confidence * 100)}% sure
          </div>
          {draft === undefined ? (
            <p className="mt-1 text-[13px]">{m.text}</p>
          ) : (
            <>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  update.mutate({ id: m.id, text: draft.trim() }, { onSuccess: () => setDraft(undefined) });
                }}
                className="mt-1.5 flex flex-wrap gap-2"
              >
                <label htmlFor={`mem-${m.id}`} className="sr-only">
                  Memory text
                </label>
                <input id={`mem-${m.id}`} value={draft} onChange={(e) => setDraft(e.target.value)} minLength={5} maxLength={300} required className={cx(inputClass, 'min-w-60 flex-1')} />
                <Button size="sm" onClick={() => setDraft(undefined)}>
                  Cancel
                </Button>
                <Button size="sm" type="submit" variant="primary" disabled={draft.trim().length < 5 || update.isPending}>
                  Save
                </Button>
              </form>
              {/* AGT-121: the owner rewording a squad memory makes it theirs. */}
              {m.agentId !== 'owner' && !m.tags.includes('denied') && (
                <p className="mt-1 text-xs text-muted">Saved, it becomes your note: always recalled, and results no longer change it.</p>
              )}
            </>
          )}
          {m.evidence && <p className="mt-0.5 text-xs text-muted">{m.evidence}</p>}
          {m.tags.length > 0 && <p className="mt-1 text-xs text-muted">{m.tags.map((t) => `#${t}`).join(' ')}</p>}
          {(update.isError || forget.isError) && (
            <p role="alert" className="mt-1 text-xs text-red">
              {(update.error ?? forget.error)?.message}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            aria-pressed={!!m.pinned}
            aria-label={m.pinned ? `Unpin: ${m.text}` : `Pin to every run: ${m.text}`}
            title={m.pinned ? 'Unpin' : 'Pin: always in the agents’ prompt for this store'}
            disabled={update.isPending}
            onClick={() => update.mutate({ id: m.id, pinned: !m.pinned })}
            className={cx('cursor-pointer rounded-md p-1.5 transition hover:bg-panel-2', m.pinned ? 'text-red' : 'text-muted hover:text-white')}
          >
            <Pin className={cx('size-4', m.pinned && 'fill-current')} />
          </button>
          {draft === undefined && (
            <button ref={memEditRef} type="button" onClick={() => setDraft(m.text)} className="cursor-pointer rounded-md px-2 py-1 text-xs text-text-2 transition hover:bg-panel-2 hover:text-white">
              Edit
            </button>
          )}
          <ConfirmDelete question="Forget this memory?" confirm="Forget memory" busy={forget.isPending} onConfirm={() => forget.mutate(m.id)}>
            {(open, ref) => (
              <button
                ref={ref}
                type="button"
                aria-label={`Forget: ${m.text}`}
                disabled={forget.isPending}
                onClick={open}
                className="cursor-pointer rounded-md p-1.5 text-muted transition hover:bg-panel-2 hover:text-red"
              >
                <Trash2 className="size-4" />
              </button>
            )}
          </ConfirmDelete>
        </div>
      </div>
    </li>
  );
}
