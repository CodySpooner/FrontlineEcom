import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { AlertTriangle, ArrowUp, Check, ChevronDown, ChevronRight, Ellipsis, LoaderCircle, Pencil, Square, Users, X } from 'lucide-react';
import { AGENT_ROLES, blockFinding, EFFORT_LABEL, hasEffects, INTERRUPTED, KB_STAGES, type AgentConfig, type AgentRole, type AgentRunDetail, type ApprovalRequest, type Conversation as ConversationRecord, type ConversationContext, type ConversationState, type KnowledgeScope, type KbStage, type RunDeliverable, type RuntimeId, type Store } from '@frontline/shared';
import { useAgentTypes, useAnswer, useApprovals, useCreateConversation, useKbCard, useKbCardsIn, useRetryRun, useSaveFinding, useRun, useSendMessage, useStopConversation, useThread, useUpdateConversation } from '../api/client';
import { ApprovalCard, FixLink, ToolBlock } from '../components/Chat';
import { Button, cx, ErrorState, LoadingState, RUN_STATUS } from '../components/ui';
import { cents, modelName } from '../lib/format';
import { isLive, toBlocks, toolName, type Block } from '../lib/transcript';
import { activitySteps, activitySummary, savedText, type Step } from './activity';
import { AttachButton, attachError, Attachments, toUploads } from './attach';
import { renderReply } from './markdown';
import { MenuItem, Popover } from './Popover';
import { useTeamDialog } from './CreateTeam';
import { knowledgeLabel, useChangeRuntime } from './Deploy';
import { useAgentSettings } from './settings';
import { StateDot } from './StateDot';
import { agentsUrl } from './urls';

// The centre pane: a conversation's header and meta chips, its thread (owner bubbles, agent replies with their
// activity, citations and approval cards, retried attempts folded under the retry) and the composer. A run with no
// conversation opens read-only, with Continue in a new conversation in place of the composer (decision 4).

const COLUMN = 'mx-auto w-full max-w-[700px]';
export const chip = 'inline-flex h-6 items-center gap-1.5 rounded-md border border-[#1d1d22] bg-[#111114] px-2 text-[11.5px] whitespace-nowrap text-text-2';
// The reply's markdown: tables scroll sideways inside the column, code and quotes as the board draws them.
const REPLY =
  'grid gap-2.5 text-[13.5px] leading-relaxed text-text [&_a]:text-[#ff6b76] [&_a:hover]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-[#2a2a30] [&_blockquote]:pl-3 [&_blockquote]:text-text-2 [&_code]:rounded [&_code]:bg-[#16161a] [&_code]:px-1 [&_code]:font-mono [&_code]:text-[12px] [&_h1]:text-[15px] [&_h1]:font-semibold [&_h2]:text-[14.5px] [&_h2]:font-semibold [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-[#111114] [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:block [&_table]:overflow-x-auto [&_table]:border-collapse [&_table]:text-[12.5px] [&_td]:border-b [&_td]:border-[#1d1d22] [&_td]:px-2.5 [&_td]:py-1.5 [&_th]:border-b [&_th]:border-[#26262c] [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold [&_th]:text-text-2';
const STAGE_TONE: Record<KbStage, string> = { hypothesis: 'text-[#f2b84b]', supported: 'text-[#7aa7ff]', tested: 'text-[#7aa7ff]', validated: 'text-[#3ddc84]' };

// Each conversation's thread scroll offset for this session: leaving the page and coming back returns to it.
const scrollTops = new Map<string, number>();

export const initials = (name: string) => (name.match(/\b\p{L}/gu) ?? []).join('').slice(0, 2).toUpperCase();
export const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const interrupted = (r: Pick<AgentRunDetail, 'status' | 'error'>) => r.status === 'error' && r.error === INTERRUPTED;
// An Ask KB all-stores run, or one that compared stores, holds other stores' data (decision 17): it can't continue here.
const otherStores = (r: AgentRunDetail) => r.task.includes('The cards come from every store and General') || r.transcript.some((e) => e.type === 'tool_call' && toolName(e.name)[0] === 'compare_stores');

/** "Claude · Opus 5.5 · High", "Demo (free)"; nothing for a run from before runtimes were recorded. */
export function runtimeLabel(r: { runtime?: RuntimeId; model?: string; effort?: string }) {
  if (!r.runtime) return undefined;
  if (r.runtime === 'demo') return 'Demo (free)';
  return [r.runtime === 'claude' ? 'Claude' : 'Codex', r.model && modelName(r.model), r.effort && (EFFORT_LABEL[r.effort] ?? r.effort)].filter(Boolean).join(' · ');
}

/** "This run $0.42 of $3.00", "This run $0.42 · No limit", or tokens for Codex (decision 9). */
export function spendLabel(run: Pick<AgentRunDetail, 'runtime' | 'usage'>, budgetUsd?: number) {
  if (run.runtime === 'codex') return `This run ${(run.usage.inputTokens + run.usage.outputTokens).toLocaleString()} tokens`;
  return `This run ${cents(run.usage.costUsd)}${budgetUsd ? ` of ${cents(budgetUsd)}` : ' · No limit'}`;
}

function useTypeName(storeId: string, type: string) {
  const types = useAgentTypes(storeId).data;
  return types?.find((t) => t.id === type)?.name ?? AGENT_ROLES[type as AgentRole]?.name ?? 'Agent';
}

/** Card links inside a reply are plain anchors (the HTML comes from the parser): open them in the app. */
function useAppLinks() {
  const navigate = useNavigate();
  return (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a');
    const href = a?.getAttribute('href');
    if (!href?.startsWith('/') || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    navigate(href);
  };
}

/** `onKnowledge`: the composer's knowledge chip opens the Knowledge tab. */
export function Conversation({ store, conversation: c, config, buttons, onKnowledge }: { store: Store; conversation: ConversationRecord; config: AgentConfig; buttons: ReactNode; onKnowledge?: () => void }) {
  const thread = useThread(store.id, c.id);
  // Pages come newest first; each page is oldest first.
  const runs = [...(thread.data?.pages ?? [])].reverse().flatMap((p) => p.items);
  const name = useTypeName(store.id, c.type);
  const change = useChangeRuntime();
  const latest = runs.filter((r) => !runs.some((x) => x.retryOf === r.id)).at(-1);
  const last = useRun(latest?.id ?? '').data ?? latest;
  const live = c.state === 'running' || c.state === 'queued' || c.state === 'awaiting_approval' || c.state === 'waiting_for_input';
  // The agent's question waiting on the owner (ask_owner): the composer answers it (decision 5).
  const question = useApprovals().data?.find((a) => a.action.kind === 'question' && a.conversationId === c.id);
  // Opens where it was left, else at the newest message; while at the bottom, growing replies stay in view.
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const loaded = !thread.isPending;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!loaded || !el) return;
    el.scrollTop = scrollTops.get(c.id) ?? el.scrollHeight;
    stick.current = !scrollTops.has(c.id);
    if (typeof ResizeObserver === 'undefined' || !el.firstElementChild) return;
    const ro = new ResizeObserver(() => stick.current && (el.scrollTop = el.scrollHeight));
    ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [loaded, c.id]);
  return (
    <section aria-label="Conversation" className="flex min-h-0 flex-1 flex-col">
      <Header store={store} conversation={c} live={live} buttons={buttons} />
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[#1d1d22] px-6 py-2">
        <span className={chip}>{name}</span>
        <span className={chip}>
          <i aria-hidden className="size-2 rounded-sm" style={{ background: store.color }} />
          {store.name}
        </span>
        {runtimeLabel(config) && (
          <button type="button" aria-label={`${runtimeLabel(config)}: change runtime or model`} onClick={change.open} className={cx(chip, 'cursor-pointer hover:border-line-2 hover:text-white')}>
            {runtimeLabel(config)}
            <ChevronDown aria-hidden className="size-3" />
          </button>
        )}
        {last && last.status !== 'queued' && <span className={chip}>{spendLabel(last, config.permissions.budgetUsd)}</span>}
        {c.context && <ContextChip store={store} context={c.context} />}
      </div>
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          scrollTops.set(c.id, el.scrollTop);
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-6 py-5"
      >
        {thread.isPending ? (
          <LoadingState rows={3} className={COLUMN} />
        ) : thread.isError ? (
          <ErrorState message="Couldn't load the messages." onRetry={() => thread.refetch()} />
        ) : (
          <div className={cx(COLUMN, 'grid gap-7')}>
            {thread.hasNextPage && (
              <Button size="sm" className="justify-self-center" disabled={thread.isFetchingNextPage} onClick={() => thread.fetchNextPage()}>
                Show earlier messages
              </Button>
            )}
            <Turns store={store} conversationId={c.id} runs={runs} name={name} latest={latest?.id} />
          </div>
        )}
      </div>
      {last && interrupted(last) && <Interrupted store={store} conversationId={c.id} runId={last.id} />}
      <Composer store={store} conversationId={c.id} type={c.type} name={name} live={live} question={question} knowledge={config.knowledge} onKnowledge={onKnowledge} />
    </section>
  );
}

function Header({ store, conversation: c, live, buttons }: { store: Store; conversation: ConversationRecord; live: boolean; buttons: ReactNode }) {
  const update = useUpdateConversation(store.id);
  const settings = useAgentSettings();
  const change = useChangeRuntime();
  const stop = useStopConversation(store.id, c.id);
  const team = useTeamDialog();
  const [renaming, setRenaming] = useState(false);
  const rename = (title?: string) => {
    setRenaming(false);
    if (title?.trim() && title.trim() !== c.title) update.mutate({ id: c.id, title: title.trim() });
  };
  const error = update.error ?? stop.error;
  return (
    <header className="flex items-center gap-2 border-b border-[#1d1d22] px-6 py-3">
      {renaming ? (
        <input
          autoFocus
          aria-label="Title"
          defaultValue={c.title}
          maxLength={200}
          onBlur={(e) => rename(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') rename(e.currentTarget.value);
            if (e.key === 'Escape') rename();
          }}
          className="h-8 min-w-0 flex-1 rounded-md border border-red/60 bg-bg-2 px-2 text-[15px] font-semibold text-text outline-none"
        />
      ) : (
        <>
          <h2 title={c.title} className="min-w-0 truncate text-[17px] font-semibold">
            {c.title}
          </h2>
          <button type="button" aria-label="Rename" title="Rename" onClick={() => setRenaming(true)} className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-lg text-muted hover:bg-panel-2 hover:text-white">
            <Pencil className="size-3.5" />
          </button>
        </>
      )}
      <span className={cx(chip, 'rounded-full')}>
        <StateDot state={c.state} />
        {RUN_STATUS[c.state].label}
      </span>
      <span className="flex-1" />
      {error && (
        <span role="alert" className="text-xs text-red">
          {error.message}
        </span>
      )}
      <Button size="sm" title="Start a team with this agent as the lead" className="shrink-0 whitespace-nowrap" onClick={() => team.open(c.id)}>
        <Users className="size-3.5" /> Collaborate
      </Button>
      {live && (
        <Button size="sm" title="Stops this reply. Pause isn't supported." className="shrink-0 whitespace-nowrap" disabled={stop.isPending} onClick={() => stop.mutate(undefined)}>
          <Square className="size-3 fill-current" /> Stop run
        </Button>
      )}
      <button type="button" aria-label="Conversation actions" popoverTarget="conversation-menu" className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-lg text-muted hover:bg-panel-2 hover:text-white">
        <Ellipsis className="size-4" />
      </button>
      <Popover id="conversation-menu" label="Conversation actions" align="end" className="w-52">
        <MenuItem popover="conversation-menu" onClick={() => setRenaming(true)}>
          Rename
        </MenuItem>
        <MenuItem popover="conversation-menu" onClick={() => update.mutate({ id: c.id, pinned: !c.pinned })}>
          {c.pinned ? 'Unpin' : 'Pin'}
        </MenuItem>
        <MenuItem popover="conversation-menu" onClick={() => update.mutate({ id: c.id, archived: !c.archivedAt })}>
          {c.archivedAt ? 'Unarchive' : 'Archive'}
        </MenuItem>
        <MenuItem popover="conversation-menu" onClick={change.open}>
          Change runtime or model…
        </MenuItem>
        <MenuItem popover="conversation-menu" onClick={() => settings.open(c.agentId.split(':')[1] as AgentRole)}>
          Agent settings
        </MenuItem>
      </Popover>
      {buttons}
    </header>
  );
}

/** The thread's turns, oldest first. A retried run folds under its retry as "Attempt N"; a model change gets a divider. */
export function Turns({ store, conversationId, runs, name, latest }: { store: Store; conversationId?: string; runs: AgentRunDetail[]; name: string; latest?: string }) {
  const byId = new Map(runs.map((r) => [r.id, r]));
  const shown = runs.filter((r) => !runs.some((x) => x.retryOf === r.id));
  return shown.map((r, i) => {
    const attempts: AgentRunDetail[] = [];
    for (let a = r.retryOf && byId.get(r.retryOf); a; a = a.retryOf && byId.get(a.retryOf)) attempts.unshift(a);
    const prev = shown[i - 1];
    const switched = prev?.runtime && r.runtime && runtimeLabel(prev) !== runtimeLabel(r);
    return (
      <div key={r.id} className="grid gap-7">
        {switched && (
          <div role="separator" className="flex items-center gap-3 text-[11.5px] text-muted before:h-px before:flex-1 before:bg-[#1d1d22] after:h-px after:flex-1 after:bg-[#1d1d22]">
            Switched to {runtimeLabel(r)} · the history stays here; the new session starts from a summary
          </div>
        )}
        <Turn store={store} conversationId={conversationId} seed={r} prev={prev} name={name} latest={r.id === latest} attempts={attempts} />
      </div>
    );
  });
}

function Turn({ store, conversationId, seed, prev, name, latest, attempts }: { store: Store; conversationId?: string; seed: AgentRunDetail; prev?: AgentRunDetail; name: string; latest: boolean; attempts: AgentRunDetail[] }) {
  // The socket streams into ['run', id], which the thread page seeded.
  const run = useRun(seed.id).data ?? seed;
  const before = useRun(prev?.id ?? '').data ?? prev;
  const stop = useStopConversation(store.id, conversationId ?? '');
  return (
    <article aria-label={`Turn: ${run.task.slice(0, 80)}`} className="grid gap-3">
      <div className="ml-auto grid max-w-[520px] justify-items-end gap-1">
        <p className="rounded-xl rounded-br-sm border border-red/30 bg-red-soft px-3 py-2 text-[13px] whitespace-pre-wrap">{run.task}</p>
        <Attachments files={run.attachments ?? []} />
        <span className="flex items-center gap-2 text-[11px] text-muted">
          {run.status === 'queued' && conversationId ? (
            <>
              {before && isLive(before) ? 'Queued: sends when this reply finishes' : 'Queued'}
              <button type="button" disabled={stop.isPending} onClick={() => stop.mutate(run.id)} className="cursor-pointer underline-offset-2 hover:text-white hover:underline">
                Cancel
              </button>
            </>
          ) : (
            <time dateTime={run.createdAt}>{time(run.createdAt)}</time>
          )}
        </span>
      </div>
      {run.status !== 'queued' && <Reply store={store} conversationId={conversationId} run={run} name={name} latest={latest} deliverables={seed.deliverables} />}
      {attempts.map((a, i) => (
        <Attempt key={a.id} store={store} run={a} n={i + 1} name={name} />
      ))}
    </article>
  );
}

function Attempt({ store, run: seed, n, name }: { store: Store; run: AgentRunDetail; n: number; name: string }) {
  const run = useRun(seed.id).data ?? seed;
  const acted = [...new Set(run.transcript.flatMap((e) => (e.type === 'tool_call' && hasEffects(e.name) ? [toolName(e.name)[0]] : [])))];
  return (
    <details className="group rounded-lg border border-[#1d1d22] text-[12.5px]">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-muted [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
        Attempt {n} · {RUN_STATUS[seed.state ?? run.status].label.toLowerCase()}
      </summary>
      <div className="grid gap-2 border-t border-[#1d1d22] px-3 py-3">
        {acted.length > 0 && <p className="text-xs text-[#f2b84b]">This attempt may have changed something before it ended: it ran {acted.join(', ')}.</p>}
        <Reply store={store} run={run} name={name} latest={false} deliverables={seed.deliverables} />
      </div>
    </details>
  );
}

type Part = { kind: 'text'; text: string } | { kind: 'approval'; approval: ApprovalRequest };

/** The record a module opened the conversation from (decision 14), linking back to it. */
function ContextChip({ store, context }: { store: Store; context: ConversationContext }) {
  // ponytail: Analytics and Product Research have no per-record view yet, so a campaign or product links to its page.
  const to = context.kind === 'run' ? agentsUrl({ store: store.id, run: context.id }) : context.kind === 'product' ? '/research' : '/analytics';
  return (
    <Link to={to} title={context.name} className={cx(chip, 'max-w-[280px] hover:text-white')}>
      <span className="truncate">
        {context.kind === 'run' ? 'Continued from' : context.kind === 'product' ? 'Opened from' : 'Campaign'} · {context.name}
      </span>
    </Link>
  );
}

const MADE: Record<RunDeliverable['kind'], string> = { creative: 'Creative', page_draft: 'Page draft', flow_draft: 'Flow draft', campaign: 'Campaign' };
const CREATIVE_TAB: Record<string, string> = { copy: 'copy', ugc: 'ugc', image: 'image' };

/** What the reply made, linked to where it lives: the Creative library, Store Builder, the flows, the campaign. */
function Deliverables({ items }: { items: RunDeliverable[] }) {
  const settings = useAgentSettings();
  const cls = cx(chip, 'max-w-[280px] cursor-pointer hover:text-white');
  const label = (d: RunDeliverable) => <span className="truncate">{`${MADE[d.kind]} · ${d.title}`}</span>;
  return (
    <div aria-label="Made in this reply" className="flex flex-wrap gap-1.5">
      {items.map((d) =>
        d.kind === 'flow_draft' ? (
          <button key={d.kind + d.id} type="button" onClick={() => settings.open('email_sms', 'flows')} className={cls}>
            {label(d)}
          </button>
        ) : (
          <Link key={d.kind + d.id} to={d.kind === 'creative' ? `/creative?tab=${CREATIVE_TAB[d.creativeKind ?? ''] ?? 'generate'}` : d.kind === 'page_draft' ? `/builder?draft=${encodeURIComponent(d.id)}` : '/analytics'} className={cls}>
            {label(d)}
          </Link>
        ),
      )}
    </div>
  );
}

export function Reply({ store, conversationId, run, name, latest, deliverables = [] }: { store: Store; conversationId?: string; run: AgentRunDetail; name: string; latest: boolean; deliverables?: RunDeliverable[] }) {
  const retry = useRetryRun(store.id, conversationId ?? '');
  const appLinks = useAppLinks();
  const [copied, setCopied] = useState(false);
  const live = isLive(run);
  const blocks = toBlocks(run.transcript);
  const steps = activitySteps(run.transcript);
  const tools = blocks.filter((b): b is Extract<Block, { kind: 'tool' }> => b.kind === 'tool');
  // The reply's text in order, split where the agent asked for an approval (the card sits where it asked).
  const parts: Part[] = [];
  for (const b of blocks) {
    const last = parts.at(-1);
    if (b.kind === 'text') last?.kind === 'text' ? (last.text += b.text) : parts.push({ kind: 'text', text: b.text });
    else if (b.kind === 'approval') parts.push({ kind: 'approval', approval: b.approval });
  }
  const cites: string[] = [];
  const href = (id: string) => `/knowledge?card=${encodeURIComponent(id)}&ws=${encodeURIComponent(run.storeId)}`;
  // Citations resolve in the run's store and General only (decision 11); another's stays as the agent wrote it.
  const ids = [...new Set(parts.flatMap((p) => (p.kind === 'text' ? [...p.text.matchAll(/\[kb:([\w-]+)\]/gi)].map((m) => m[1]!) : [])))];
  const checked = useKbCardsIn(ids, run.storeId);
  const missing = new Set(ids.filter((_, i) => checked[i]!.isError));
  const html = parts.map((p) => (p.kind === 'text' ? renderReply(p.text, href, cites, missing).html : ''));
  const texts = parts.flatMap((p) => (p.kind === 'text' && p.text.trim() ? [p.text.trim()] : []));
  const text = texts.join('\n\n');
  const [saving, setSaving] = useState(false);
  const failed = run.status === 'error' && !interrupted(run);
  const said = run.transcript.some((e) => e.type === 'error' && e.message === run.error);
  return (
    <div className="grid gap-2.5">
      <div className="flex items-center gap-2 text-xs">
        <span aria-hidden className="grid size-6 place-items-center rounded-md border border-[#26262c] bg-[#16161a] text-[10px] font-bold text-text-2">
          {initials(name)}
        </span>
        <span className="font-semibold text-text">{name}</span>
        {runtimeLabel(run) && <span className="text-muted">{runtimeLabel(run)}</span>}
        <time dateTime={run.startedAt ?? run.createdAt} className="text-muted">
          {time(run.startedAt ?? run.createdAt)}
        </time>
      </div>
      {(steps.length > 0 || live) && <Activity run={run} steps={steps} tools={tools} />}
      <div onClick={appLinks} className="grid gap-2.5">
        {parts.map((p, i) => (p.kind === 'text' ? <div key={i} className={REPLY} dangerouslySetInnerHTML={{ __html: html[i]! }} /> : <ApprovalCard key={i} a={p.approval} tone="amber" here />))}
      </div>
      {cites.length + missing.size > 0 && (
        <div aria-label="Sources" className="flex flex-wrap gap-1.5">
          {cites.map((id, i) => (
            <Source key={id} n={i + 1} id={id} storeId={run.storeId} href={href(id)} />
          ))}
          {[...missing].map((id) => (
            <Source key={id} id={id} storeId={run.storeId} href={href(id)} />
          ))}
        </div>
      )}
      {deliverables.length > 0 && <Deliverables items={deliverables} />}
      {failed && (
        <p role="alert" className="flex flex-wrap gap-2 text-xs text-red">
          {said || !run.error ? 'Failed' : `Failed: ${run.error}`}
          {run.error && <FixLink message={run.error} agentId={run.agentId} />}
        </p>
      )}
      {run.status === 'cancelled' && <p className="text-xs text-muted">Stopped</p>}
      {!live && !interrupted(run) && (text || (latest && conversationId)) && (
        <div className="flex items-center gap-3 text-[11.5px] text-muted">
          {text && (
            <button type="button" onClick={() => navigator.clipboard?.writeText(text).then(() => setCopied(true), () => {})} className="cursor-pointer hover:text-white">
              {copied ? 'Copied' : 'Copy'}
            </button>
          )}
          {text && conversationId && (
            <button type="button" aria-expanded={saving} onClick={() => setSaving(!saving)} className="cursor-pointer hover:text-white">
              Save to Knowledge Base
            </button>
          )}
          {latest && conversationId && (
            <button type="button" disabled={retry.isPending} onClick={() => retry.mutate({ runId: run.id, clientRequestId: crypto.randomUUID() })} className="cursor-pointer hover:text-white">
              Retry
            </button>
          )}
          {retry.isError && (
            <span role="alert" className="text-red">
              {retry.error.message}
            </span>
          )}
        </div>
      )}
      {saving && conversationId && <SaveFinding store={store} conversationId={conversationId} runId={run.id} blocks={texts} onClose={() => setSaving(false)} />}
    </div>
  );
}

const ICONS: Record<Step['icon'], ReactNode> = {
  done: <Check aria-label="Done" className="size-3.5 text-[#3ddc84]" />,
  running: <LoaderCircle aria-label="Running" className="size-3.5 animate-spin text-muted" />,
  warning: <AlertTriangle aria-label="Waiting" className="size-3.5 text-[#f2b84b]" />,
  failed: <X aria-label="Failed" className="size-3.5 text-[#ff5a66]" />,
};

/** "Worked for 3m 12s · 5 steps": one plain sentence per real event, open while the reply runs. */
function Activity({ run, steps, tools }: { run: AgentRunDetail; steps: Step[]; tools: Extract<Block, { kind: 'tool' }>[] }) {
  return (
    <details open={isLive(run) || undefined} className="group rounded-lg border border-[#1d1d22] bg-[#0d0d10] text-[12.5px]">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-text-2 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 text-muted transition-transform group-open:rotate-90" />
        {activitySummary(run, steps.length)}
      </summary>
      <div className="grid gap-2 border-t border-[#1d1d22] px-3 py-2.5">
        <ol className="grid gap-1.5">
          {steps.map((s, i) => (
            <li key={i} className="flex items-start gap-2 text-text-2">
              <span className="mt-0.5 shrink-0">{ICONS[s.icon]}</span>
              {s.text}
            </li>
          ))}
        </ol>
        {tools.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted hover:text-white">Tool calls & sources</summary>
            <div className="mt-2 grid gap-1.5">
              {tools.map((b) => (
                <ToolBlock key={b.id} b={b} />
              ))}
            </div>
          </details>
        )}
      </div>
    </details>
  );
}

/** A cited card: number, title and its stage. Another store's card shows only that it isn't available here. */
export function Source({ n, id, storeId, href }: { n?: number; id: string; storeId: string; href: string }) {
  const q = useKbCard(id, storeId);
  const card = q.data;
  const elsewhere = q.isError || (card && card.storeId !== null && card.storeId !== storeId);
  const body = (
    <>
      {n && <b className="text-[#ff6b76]">{n}</b>}
      <span className="min-w-0 truncate">{card && !elsewhere ? card.title : `kb:${id}`}</span>
      {(card || elsewhere) && <span className={cx('shrink-0 text-[10.5px] font-semibold', elsewhere || !card ? 'text-muted' : card.storeId === null ? 'text-text-2' : STAGE_TONE[card.stage])}>{elsewhere || !card ? 'not available in this store' : card.storeId === null ? 'General' : KB_STAGES[card.stage]}</span>}
    </>
  );
  const cls = 'inline-flex h-6 max-w-[320px] items-center gap-1.5 rounded-md border border-[#1d1d22] bg-[#111114] px-2 text-[11.5px] text-text-2';
  return card && !elsewhere ? (
    <Link to={href} className={cx(cls, 'hover:border-[#3a3a42] hover:text-white')}>
      {body}
    </Link>
  ) : (
    <span className={cls}>{body}</span>
  );
}

function Interrupted({ store, conversationId, runId }: { store: Store; conversationId: string; runId: string }) {
  const resume = useRetryRun(store.id, conversationId);
  return (
    <div className="px-6 pt-3">
      <div role="status" className={cx(COLUMN, 'flex items-center gap-3 rounded-lg border border-amber/38 bg-amber/5 px-3 py-2 text-[12.5px] text-text-2')}>
        <AlertTriangle aria-hidden className="size-4 shrink-0 text-amber" />
        <span className="flex-1">Interrupted: the app quit while this reply was running. Resume continues the same session.</span>
        {resume.isError && (
          <span role="alert" className="text-xs text-red">
            {resume.error.message}
          </span>
        )}
        <Button size="sm" disabled={resume.isPending} onClick={() => resume.mutate({ runId, resume: true, clientRequestId: crypto.randomUUID() })}>
          Resume
        </Button>
      </div>
    </div>
  );
}

const draftKey = (id: string) => `fe.agents.draft.${id}`;
function readDraft(id: string) {
  try {
    return localStorage.getItem(draftKey(id)) ?? '';
  } catch {
    return '';
  }
}
function writeDraft(id: string, text: string) {
  try {
    if (text) localStorage.setItem(draftKey(id), text);
    else localStorage.removeItem(draftKey(id));
  } catch {
    /* storage unavailable */
  }
}

/**
 * Enter sends, Shift+Enter adds a line. While a reply runs, the message waits in the queue behind it. Documents go with
 * the message (not with an answer to a question); the knowledge chip opens the Knowledge tab.
 */
function Composer({ store, conversationId, type, name, live, question, knowledge, onKnowledge }: { store: Store; conversationId: string; type: string; name: string; live: boolean; question?: ApprovalRequest; knowledge: KnowledgeScope[]; onKnowledge?: () => void }) {
  const [text, setText] = useState(() => readDraft(conversationId));
  const [files, setFiles] = useState<File[]>([]);
  const tooBig = attachError(files);
  const [saved, setSaved] = useState(false);
  const send = useSendMessage(store.id, conversationId);
  const answer = useAnswer(store.id, conversationId);
  const navigate = useNavigate();
  const create = useCreateConversation(store.id);
  // A conversation that ran on demo data can't go on once the store is live (DEMO_SESSION): the message starts a new one.
  const stale = send.isError && send.error.message.startsWith('That conversation ran on demo data');
  const fresh = () => {
    const message = send.variables!.message;
    create.mutate({ clientRequestId: crypto.randomUUID(), type, message }, { onSuccess: (r) => (setText(''), navigate(agentsUrl({ store: store.id, conversation: r.conversation.id }))) });
  };
  // One id per message until the server answers, so a repeated send returns the first one's run.
  const request = useRef(crypto.randomUUID());
  useEffect(() => {
    writeDraft(conversationId, text);
    setSaved(false);
    if (!text.trim()) return;
    const t = setTimeout(() => setSaved(true), 800);
    return () => clearTimeout(t);
  }, [conversationId, text]);
  const submit = async () => {
    const message = text.trim();
    if (!message || send.isPending || answer.isPending) return;
    if (question) return answer.mutate({ id: question.id, text: message }, { onSuccess: () => setText('') });
    if (tooBig) return;
    // A second Enter while the files read sends the same request id, which returns the first one's run.
    const attachments = files.length ? await toUploads(files) : undefined;
    send.mutate(
      { clientRequestId: request.current, message, ...(attachments ? { attachments } : {}) },
      {
        onSuccess: () => {
          request.current = crypto.randomUUID();
          setText('');
          setFiles([]);
        },
      },
    );
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="px-6 pt-3 pb-4"
    >
      <div className={cx(COLUMN, 'rounded-xl border border-[#26262c] bg-[#111114] focus-within:border-[#3a3a42]')}>
        <textarea
          aria-label="Message"
          rows={2}
          value={text}
          maxLength={20000}
          placeholder={question ? `Answer ${name}'s question` : live ? 'Reply… it sends when this reply finishes' : `Message ${name}`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          className="block max-h-48 min-h-[52px] w-full resize-none bg-transparent px-3.5 pt-3 text-[13.5px] text-text outline-none placeholder:text-muted"
        />
        {!question && files.length > 0 && (
          <div className="px-3 pb-1">
            <Attachments files={files} onChange={setFiles} />
          </div>
        )}
        <div className="flex items-center gap-2 px-2.5 pb-2.5">
          {!question && <AttachButton files={files} onChange={setFiles} />}
          {onKnowledge && (
            <button type="button" onClick={onKnowledge} title="See the knowledge this conversation uses" className={cx(chip, 'cursor-pointer hover:border-[#3a3a42] hover:text-white')}>
              {knowledgeLabel(knowledge)}
            </button>
          )}
          {saved && <span className="text-[11px] text-muted">Draft saved</span>}
          {(send.error ?? answer.error ?? (!question && tooBig)) && (
            <span role="alert" className="text-[11px] text-red">
              {(send.error ?? answer.error)?.message ?? tooBig}
            </span>
          )}
          {stale && (
            <Button size="sm" disabled={create.isPending} onClick={fresh}>
              Send as a new conversation
            </Button>
          )}
          <button type="submit" aria-label={question ? 'Send answer' : 'Send'} disabled={!text.trim() || send.isPending || answer.isPending} className="ml-auto grid size-8 cursor-pointer place-items-center rounded-full bg-red text-white transition hover:brightness-110 disabled:cursor-default disabled:opacity-40">
            <ArrowUp className="size-4" strokeWidth={2.2} />
          </button>
        </div>
      </div>
    </form>
  );
}

/**
 * A run with no conversation (from before conversations, or a scheduled or module job), read-only (decision 4). Continue
 * starts a conversation whose first turn carries a recap of it, except for runs that hold other stores' data.
 */
export function ReadOnlyRun({ store, run: seed, buttons }: { store: Store; run: AgentRunDetail; buttons: ReactNode }) {
  const run = useRun(seed.id).data ?? seed;
  const role = run.agentId.split(':')[1] as AgentRole;
  const name = AGENT_ROLES[role]?.name ?? 'Agent';
  const state: ConversationState = run.state ?? (interrupted(run) ? 'interrupted' : run.status === 'done' ? 'completed' : run.status === 'error' ? 'failed' : run.status);
  return (
    <section aria-label="Run" className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-[#1d1d22] px-6 py-3">
        <h2 title={run.task} className="min-w-0 truncate text-[17px] font-semibold">
          {run.task.split('\n')[0]}
        </h2>
        <span className={cx(chip, 'rounded-full')}>
          <StateDot state={state} />
          {RUN_STATUS[state].label}
        </span>
        <span className="flex-1" />
        {buttons}
      </header>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[#1d1d22] px-6 py-2">
        <span className={chip}>{name}</span>
        <span className={chip}>
          <i aria-hidden className="size-2 rounded-sm" style={{ background: store.color }} />
          {store.name}
        </span>
        <span className={chip}>Read-only · not part of a conversation</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className={COLUMN}>
          <Turns store={store} runs={[run]} name={name} />
        </div>
      </div>
      {/* ponytail: a team step opens its team from AA-19 (decision 4); until then it reads here, without Continue. */}
      {otherStores(run) ? (
        <p className={cx(COLUMN, 'px-6 pt-3 pb-4 text-[12.5px] text-muted')}>This run read other stores' data, so it can't continue in one store's conversation.</p>
      ) : !run.teamId && !isLive(run) ? (
        <Continue store={store} run={run} name={name} />
      ) : null}
    </section>
  );
}

function Continue({ store, run, name }: { store: Store; run: AgentRunDetail; name: string }) {
  const create = useCreateConversation(store.id);
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const request = useRef(crypto.randomUUID());
  const submit = () =>
    text.trim() &&
    create.mutate({ clientRequestId: request.current, fromRunId: run.id, message: text.trim() }, { onSuccess: (r) => navigate(agentsUrl({ store: store.id, conversation: r.conversation.id })) });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="px-6 pt-3 pb-4"
    >
      <div className={cx(COLUMN, 'grid gap-2 rounded-xl border border-[#26262c] bg-[#111114] p-2.5')}>
        <textarea aria-label="First message" rows={2} value={text} placeholder={`What should ${name} do next with this?`} onChange={(e) => setText(e.target.value)} className="block w-full resize-none bg-transparent px-1 text-[13.5px] text-text outline-none placeholder:text-muted" />
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted">The new conversation starts with a recap of this run.</span>
          {create.isError && (
            <span role="alert" className="text-[11px] text-red">
              {create.error.message}
            </span>
          )}
          <Button size="sm" variant="primary" type="submit" className="ml-auto" disabled={!text.trim() || create.isPending}>
            Continue in a new conversation
          </Button>
        </div>
      </div>
    </form>
  );
}

/**
 * Save to Knowledge Base (decision 11): the reply's last text block, with a title and summary the owner can trim. The
 * defaults come from the block itself, with no model call. ponytail: an inline panel under the reply, not a floating one.
 */
function SaveFinding({ store, conversationId, runId, blocks, onClose }: { store: Store; conversationId: string; runId: string; blocks: string[]; onClose: () => void }) {
  const [defaults] = useState(() => blockFinding(blocks.at(-1)!));
  const [title, setTitle] = useState(defaults.title);
  const [summary, setSummary] = useState(defaults.summary);
  const save = useSaveFinding(store.id, conversationId);
  const fits = title.trim().length >= 5 && title.trim().length <= 160 && summary.trim().length >= 10 && summary.trim().length <= 600;
  const field = 'w-full rounded-md border border-[#26262c] bg-[#0c0c0f] px-2.5 py-1.5 text-[12.5px] text-text outline-none focus:border-[#3a3a42]';
  if (save.data) {
    return (
      <p role="status" className="text-[12px] text-text-2">
        <Link to={`/knowledge?card=${encodeURIComponent(save.data.card.id)}&ws=${encodeURIComponent(store.id)}`} className="text-[#ff6b76] hover:underline">
          {savedText(save.data)}
        </Link>
      </p>
    );
  }
  return (
    <form
      aria-label="Save to Knowledge Base"
      onSubmit={(e) => {
        e.preventDefault();
        if (fits) save.mutate({ runId, block: blocks.length - 1, title: title.trim(), summary: summary.trim() });
      }}
      className="grid max-w-[520px] gap-2 rounded-lg border border-[#26262c] bg-[#111114] p-3"
    >
      <label className="grid gap-1 text-[11.5px] text-muted">
        Title (5–160 characters)
        <input value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} className={field} />
      </label>
      <label className="grid gap-1 text-[11.5px] text-muted">
        Summary (10–600 characters)
        <textarea rows={3} value={summary} maxLength={600} onChange={(e) => setSummary(e.target.value)} className={cx(field, 'resize-none')} />
      </label>
      {!store.connected && <p className="text-[11.5px] text-muted">Findings from demo data are removed when the store goes live.</p>}
      {save.error && (
        <p role="alert" className="text-[11.5px] text-red">
          {save.error.message}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" type="submit" variant="primary" disabled={!fits || save.isPending}>
          Save
        </Button>
      </div>
    </form>
  );
}
