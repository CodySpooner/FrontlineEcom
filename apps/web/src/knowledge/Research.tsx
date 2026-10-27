// Research From Source (KB-14): the bar under the Research Center, the full form the toolbar opens, and a task as it
// runs: each source as it's read, the findings, the report, and the cards it proposed for the owner to accept or reject.
import { useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { Paperclip, X } from 'lucide-react';
import { AGENT_ROLES, KB_CARD_TYPES, KB_STAGES, type KbTaskDetail } from '@frontline/shared';
import { useAgents, useKbCard, useKbCardWrite, useKbCategories, useKbTask, useKbTaskAction, useStartKbResearch, useStores } from '../api/client';
import { Badge, Button, buttonClass, cx, Dialog, ErrorState, Field, inputClass, LoadingState } from '../components/ui';
import { categoryPaths, FETCH } from './DetailsPanel';
import { STATUS } from './Library';

const URL_RE = /https?:\/\/[^\s<>"']+/gi;
const MAX_MB = 10;
const ACCEPT = '.pdf,.txt,.md,.markdown,.vtt,.srt,.csv,.html,.htm';

/** The links in what the owner pasted, and the paste itself as text to read when there's more in it than links. */
export function splitSources(s: string) {
  const urls = [...new Set((s.match(URL_RE) ?? []).map((u) => u.replace(/[.,;:!?)\]]+$/, '')))];
  return { urls, text: /[\p{L}\p{N}]/u.test(s.replace(URL_RE, '')) ? s.trim() : '' };
}

const base64 = (f: File) =>
  new Promise<string>((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1] ?? '');
    r.onerror = () => fail(r.error);
    r.readAsDataURL(f);
  });

/** Links, text or a document, the agent, where its findings go and what to look for; `full` (the dialog) adds the budget. */
function SourceForm({ ws, full, onStarted }: { ws: string; full?: boolean; onStarted: (taskId: string) => void }) {
  const stores = useStores().data ?? [];
  const agents = (useAgents().data ?? []).filter((a) => a.enabled !== false);
  const start = useStartKbResearch();
  const [paste, setPaste] = useState('');
  const [file, setFile] = useState<File>();
  const [agentId, setAgentId] = useState<string>();
  const [dest, setDest] = useState<string>();
  const [lookFor, setLookFor] = useState('');
  const [budget, setBudget] = useState('1');
  const home = ws === 'general' ? stores[0]?.id : ws;
  const agent = agents.find((a) => a.id === agentId) ?? agents.find((a) => a.storeId === home && a.role === 'market_analyst') ?? agents[0];
  const own = useKbCategories(agent?.storeId ?? 'general').data ?? [];
  const general = useKbCategories('general').data ?? [];
  const name = (id: string) => stores.find((s) => s.id === id)?.name ?? id;
  // Findings go to the agent's own store or to General, never another store (the server says so too).
  const places = agent
    ? [
        { value: `${agent.storeId}|`, label: name(agent.storeId) },
        ...categoryPaths(own).map((c) => ({ value: `${agent.storeId}|${c.id}`, label: `${name(agent.storeId)} › ${c.path}` })),
        { value: 'general|', label: 'General' },
        ...categoryPaths(general).map((c) => ({ value: `general|${c.id}`, label: `General › ${c.path}` })),
      ]
    : [];
  const to = places.find((p) => p.value === dest)?.value ?? (ws === 'general' ? 'general|' : `${agent?.storeId}|`);
  const src = splitSources(paste);
  const reads = [src.urls.length && `${src.urls.length} link${src.urls.length === 1 ? '' : 's'}`, src.text && 'the pasted text', file?.name].filter(Boolean);
  const big = !!file && file.size > MAX_MB * 1_048_576;
  const drop = (e: DragEvent) => {
    const f = e.dataTransfer.files[0];
    if (!f) return;
    e.preventDefault();
    setFile(f);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const [into, categoryId] = to.split('|');
    const document = file && { name: file.name, data: await base64(file) };
    start.mutate(
      {
        agentId: agent!.id, ws: into!, ...(categoryId ? { categoryId } : {}), ...(src.urls.length ? { urls: src.urls } : {}), ...(src.text ? { text: src.text } : {}),
        ...(document ? { document } : {}), ...(lookFor.trim() ? { lookFor: lookFor.trim() } : {}), budgetUsd: Number(budget),
      },
      { onSuccess: (t) => onStarted(t.id) },
    );
  };
  const field = cx(inputClass, 'w-full');
  return (
    <form onSubmit={submit} className={cx('grid gap-3', !full && 'items-start md:grid-cols-[repeat(3,minmax(0,1fr))_auto]')}>
      <div className={cx('grid gap-1.5', !full && 'md:col-span-4')}>
        <Field label="Links or text">
          <textarea
            rows={full ? 4 : 2}
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
            onDrop={drop}
            placeholder="Paste one or more URLs or some text, or drop a PDF or transcript"
            className={cx(field, 'resize-y')}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <label className={cx(buttonClass('ghost', 'sm'), 'cursor-pointer')}>
            <Paperclip aria-hidden className="size-3.5" /> Attach
            <input type="file" aria-label="Attach a document" accept={ACCEPT} className="sr-only" onChange={(e) => setFile(e.target.files?.[0])} />
          </label>
          {file && (
            <span className="inline-flex items-center gap-1 text-text-2">
              {file.name}
              <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFile(undefined)} className="cursor-pointer rounded p-0.5 hover:text-white">
                <X className="size-3" />
              </button>
            </span>
          )}
          <span>{big ? <span className="text-red">{`${file!.name} is over the ${MAX_MB} MB limit`}</span> : reads.length ? `Reads ${reads.join(' · ')}` : `A PDF, text, markdown, transcript, CSV or HTML file, up to ${MAX_MB} MB.`}</span>
        </div>
      </div>
      <Field label="Agent">
        <select value={agent?.id ?? ''} onChange={(e) => setAgentId(e.target.value)} className={field}>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{`${AGENT_ROLES[a.role].name} · ${name(a.storeId)}`}</option>
          ))}
        </select>
      </Field>
      <Field label="Save findings to">
        <select value={to} onChange={(e) => setDest(e.target.value)} className={field}>
          {places.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </Field>
      <Field label="What to look for (optional)">
        <input type="text" maxLength={500} value={lookFor} onChange={(e) => setLookFor(e.target.value)} placeholder="e.g. hooks that work for anxious dogs" className={field} />
      </Field>
      {full && (
        <Field label="Budget (USD)">
          <input type="number" min={0.1} max={20} step={0.05} required value={budget} onChange={(e) => setBudget(e.target.value)} className={field} />
        </Field>
      )}
      <div className={cx('grid gap-1.5', !full && 'md:pt-5')}>
        <Button type="submit" variant="primary" disabled={!agent || !reads.length || big || start.isPending}>
          Start research
        </Button>
        {start.error && <p role="alert" className="text-xs text-red">{start.error.message}</p>}
      </div>
    </form>
  );
}

/** The B-style bar along the bottom of the Research Center. */
export function SourceBar({ ws, onStarted }: { ws: string; onStarted: (taskId: string) => void }) {
  return (
    <section aria-labelledby="kb-source-bar" className="card grid gap-3 p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="kb-source-bar" className="font-display text-[15px] font-semibold">
          Research from source
        </h2>
        <span className="text-xs text-muted">Give an agent links, text or a document. It reads only what it can open and says what it couldn't.</span>
      </div>
      <SourceForm ws={ws} onStarted={onStarted} />
    </section>
  );
}

/** The full form, then (`task`) the task it started, or any task a link opens. */
export function ResearchDialog({ ws, open, task, onStarted, onClose, onOpenCard }: { ws: string; open: boolean; task?: string; onStarted: (taskId: string) => void; onClose: () => void; onOpenCard: (cardId: string) => void }) {
  return (
    <Dialog open={open} onClose={onClose} title={task ? 'Research task' : 'Research from source'}>
      {task ? <TaskView id={task} onOpenCard={onOpenCard} /> : open && <SourceForm ws={ws} full onStarted={onStarted} />}
    </Dialog>
  );
}

const STAGE: Record<string, string> = {
  created: 'Queued', planning: 'Planning', discovering: 'Finding sources', retrieving: 'Reading sources', analyzing: 'Analyzing', evaluating: 'Weighing the evidence',
  extracting: 'Writing cards', deduping: 'Checking for duplicates', storing: 'Filing cards', linking: 'Linking cards', reporting: 'Writing the report',
};
const FINDING: Record<KbTaskDetail['findings'][number]['status'], string> = { pending: 'drafted', stored: 'filed', merged: 'added to a card', rejected: 'not kept', discarded: 'dropped' };
const H = ({ children }: { children: ReactNode }) => <h3 className="font-display text-[11px] font-semibold tracking-[.12em] text-muted uppercase">{children}</h3>;

function Lines({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="grid gap-1">
      <H>{title}</H>
      <ul className="list-disc space-y-0.5 pl-4 text-[13px] text-text-2">
        {items.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
    </div>
  );
}

function TaskView({ id, onOpenCard }: { id: string; onOpenCard: (cardId: string) => void }) {
  const q = useKbTask(id);
  const act = useKbTaskAction();
  const stores = useStores().data ?? [];
  if (q.isPending) return <LoadingState />;
  if (q.isError) return <ErrorState message={q.error.message} onRetry={() => q.refetch()} />;
  const t = q.data;
  const name = (storeId: string) => stores.find((s) => s.id === storeId)?.name ?? storeId;
  const going = t.status === 'queued' || t.status === 'running';
  // Links not read yet, while reading is still to come (a site may redirect, so after that the sources are the record).
  const waiting = going && !t.steps.some((s) => s.stage === 'retrieving' && s.status === 'done') ? (t.brief.urls ?? []).filter((u) => !t.sources.some((s) => s.url === u)) : [];
  const r = t.report;
  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <h3 className="text-[15px] font-semibold text-white">{t.objective}</h3>
        <p className="text-xs text-muted">{`${AGENT_ROLES[t.role].name} · ${name(t.payerId)}${t.storeId ? '' : ' → General'}`}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-text-2">
          <Badge tone={t.status === 'done' ? 'good' : t.status === 'failed' ? 'red' : 'muted'}>{t.status === 'cancelled' ? 'stopped' : t.status}</Badge>
          {going && <span>{STAGE[t.stage] ?? t.stage}</span>}
          <span className="tabular-nums">{`$${t.spentUsd.toFixed(2)} of $${t.budgetUsd.toFixed(2)}`}</span>
        </div>
      </div>
      {t.error && <p className="text-[13px] text-red">{t.error}</p>}
      <div className="grid gap-1.5">
        <H>Sources</H>
        {t.sources.length || waiting.length ? (
          <ul aria-label="Sources" className="grid gap-1">
            {t.sources.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-[13px]">
                <span className="min-w-0 flex-1 truncate">{s.title || s.url}</span>
                <Badge tone={s.status === 'read' ? 'good' : 'muted'}>{FETCH[s.status]}</Badge>
              </li>
            ))}
            {waiting.map((u) => (
              <li key={u} className="flex items-center gap-2 text-[13px] text-muted">
                <span className="min-w-0 flex-1 truncate">{u}</span>
                <Badge>waiting</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted">None read yet.</p>
        )}
      </div>
      {!r && t.findings.length > 0 && (
        <div className="grid gap-1.5">
          <H>Findings</H>
          <ul aria-label="Findings" className="grid gap-1">
            {t.findings.map((f) => (
              <li key={f.id} className="flex items-center gap-2 text-[13px]">
                <span className="min-w-0 flex-1 truncate">{f.title}</span>
                <Badge>{FINDING[f.status]}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
      {r && (
        <>
          {r.summary && <p className="text-[13px] text-text">{r.summary}</p>}
          <Lines title="Conclusions" items={r.conclusions} />
          <Lines title="How to use it" items={r.applications} />
          <Lines title="Still open" items={r.unresolved} />
          <Lines title="Limitations" items={[...r.limitations, ...r.failedSources.map((f) => `${f.url}: ${f.error ?? FETCH[f.status]}`), ...r.errors]} />
          <Lines title="Disagreements" items={r.conflicts} />
          {r.created.length > 0 && (
            <div className="grid gap-1.5">
              <H>New cards for your review</H>
              <ul aria-label="New cards" className="grid gap-1.5">
                {r.created.map((c) => (
                  <Review key={c.id} id={c.id} onOpen={onOpenCard} />
                ))}
              </ul>
            </div>
          )}
          {r.updated.length > 0 && (
            <div className="grid gap-1.5">
              <H>Added evidence to</H>
              <ul aria-label="Updated cards" className="grid gap-1">
                {r.updated.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => onOpenCard(c.id)} className="cursor-pointer text-left text-[13px] text-text-2 hover:text-white">
                      {c.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      {(going || t.status === 'failed' || t.status === 'cancelled') && (
        <div className="flex justify-end gap-2">
          <Button size="sm" disabled={act.isPending} onClick={() => act.mutate({ id, action: going ? 'cancel' : 'retry' })}>
            {going ? 'Stop' : 'Retry'}
          </Button>
        </div>
      )}
    </div>
  );
}

/** A card the task filed, to accept (agents then use it) or reject; one already reviewed says how. */
function Review({ id, onOpen }: { id: string; onOpen: (cardId: string) => void }) {
  const card = useKbCard(id).data;
  const write = useKbCardWrite();
  if (!card) return <li className="h-12 animate-pulse rounded-lg bg-panel-2" />;
  return (
    <li className="flex flex-wrap items-start gap-2 rounded-lg border border-line px-3 py-2">
      <div className="min-w-[12rem] flex-1">
        <button type="button" onClick={() => onOpen(card.id)} className="cursor-pointer text-left text-[13px] font-medium text-text hover:text-white">
          {card.title}
        </button>
        <p className="text-xs text-muted">{[KB_CARD_TYPES[card.type], KB_STAGES[card.stage], card.summary].filter(Boolean).join(' · ')}</p>
      </div>
      {card.status === 'proposed' ? (
        <div className="flex gap-2">
          <Button size="sm" variant="primary" aria-label={`Accept ${card.title}`} disabled={write.isPending} onClick={() => write.mutate({ card, body: { status: 'active' } })}>
            Accept
          </Button>
          <Button size="sm" aria-label={`Reject ${card.title}`} disabled={write.isPending} onClick={() => write.mutate({ card, body: { status: 'rejected' } })}>
            Reject
          </Button>
        </div>
      ) : (
        <Badge tone={card.status === 'active' ? 'good' : 'muted'}>{card.status === 'active' ? 'Accepted' : STATUS[card.status]}</Badge>
      )}
    </li>
  );
}
