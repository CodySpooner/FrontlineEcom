import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { ArrowRight, ArrowUp, Lock, Pencil, Plus, Square } from 'lucide-react';
import { type ConversationState, type SquadMission, type SquadMissionStep, type Store } from '@frontline/shared';
import { useConversation, useRun, useSendMessage, useStopConversation, useTeam, useTeamAction, useThread, useUpdateConversation } from '../api/client';
import { Button, cx, Dialog, ErrorState, LoadingState, RUN_STATUS } from '../components/ui';
import { withParams, webHref } from '../knowledge/url';
import { cents } from '../lib/format';
import { toBlocks } from '../lib/transcript';
import { chip, initials, Reply, runtimeLabel, Source, time, Turns } from './Conversation';
import { AddAgent } from './CreateTeam';
import { StateDot } from './StateDot';

// The team view (decision 12): B's thread in the centre pane (the lead's plan, each contribution with its handoffs,
// Unresolved with Compare both, the synthesis and, after it, the team conversation's follow-ups), a tab per
// participant with its runs in full, and "To: Lead". TeamDetails is the right panel's team variant.

const COLUMN = 'mx-auto w-full max-w-[760px]';
const box = 'mt-1.5 rounded-[10px] border border-[#24242a] bg-[#0d0d10] px-3 py-2.5 text-[12.5px] text-[#d6d6dc]';
const PILL = { muted: 'bg-[#1d1d22] text-[#c4c4cc]', good: 'bg-[#3ddc84]/10 text-[#3ddc84]', amber: 'bg-[#f2b84b]/10 text-[#f2b84b]', red: 'bg-[#ff5a66]/10 text-[#ff6b76]' };
const link = 'cursor-pointer text-[#ff6b76] hover:underline';

type Participant = NonNullable<SquadMission['participants']>[number];

/** A step's word and pill tone: an interrupted run reads Interrupted, a step that hasn't started Waiting. */
function stepStatus(s: SquadMissionStep): [string, keyof typeof PILL] {
  if (s.interrupted) return ['Interrupted', 'amber'];
  if (s.status === 'waiting') return ['Waiting', 'muted'];
  if (s.status === 'blocked') return ['Blocked', 'muted'];
  if (s.status === 'running') return ['Running', 'good'];
  if (s.status === 'error') return ['Failed', 'red'];
  return [RUN_STATUS[s.status].label, 'muted'];
}

/**
 * Steps folded into one state, for a participant's dot and a running team's row: what needs the owner first.
 * ponytail: a step's status is its run's, so a step waiting on an approval reads Running here; its tab shows the card.
 */
export function stateOf(steps: SquadMissionStep[]): ConversationState {
  const has = (f: (s: SquadMissionStep) => boolean) => steps.some(f);
  if (has((s) => !!s.interrupted)) return 'interrupted';
  if (has((s) => s.status === 'running')) return 'running';
  if (has((s) => s.status === 'queued' || s.status === 'waiting')) return 'queued';
  if (has((s) => s.status === 'error' || s.status === 'blocked')) return 'failed';
  if (steps.length && steps.every((s) => s.status === 'done')) return 'completed';
  return has((s) => s.status === 'cancelled') ? 'cancelled' : 'idle';
}

/** The list row's dot and meta: 'N agents' while it runs, then Ready (· N unresolved), Failed or Stopped. */
export function teamMeta(t: SquadMission): { state: ConversationState; word: string; meta: string } {
  if (t.status === 'running') {
    const state = stateOf(t.steps);
    return { state, word: RUN_STATUS[state].label, meta: `${t.participants?.length ?? 0} agents` };
  }
  if (t.status === 'cancelled') return { state: 'cancelled', word: 'Stopped', meta: 'Stopped' };
  if (t.status === 'blocked') return { state: 'failed', word: 'Failed', meta: 'Failed' };
  const open = t.steps.find((s) => s.kind === 'synthesis')?.unresolved?.length ?? 0;
  return { state: 'completed', word: 'Ready', meta: open ? `Ready · ${open} unresolved` : 'Ready' };
}

/** The participant's current work for its sub-row: the task it's on, else its last step's word. */
export function currentTask(t: SquadMission, configId: string) {
  const mine = t.steps.filter((s) => s.configId === configId);
  const on = mine.find((s) => s.status === 'running' || s.status === 'queued' || s.interrupted);
  if (on) return on.kind === 'task' ? on.task : on.kind === 'plan' ? 'Planning' : 'Synthesis';
  const last = mine.at(-1);
  return last ? stepStatus(last)[0] : 'Waiting for the plan';
}

const nameOf = (t: SquadMission, configId?: string) => t.participants?.find((p) => p.configId === configId)?.name ?? 'Agent';
const tasksOf = (t: SquadMission) => t.steps.filter((s) => s.kind === 'task');
const pending = (s: SquadMissionStep) => s.status === 'waiting' || s.status === 'queued' || s.status === 'running';

/** `/agents/t/<id>`: the team, else the not-found state. `run` opens that run's participant tab, scrolled to it. */
export function TeamPage({ store, id, buttons, notFound }: { store: Store; id: string; buttons: ReactNode; notFound: ReactNode }) {
  const t = useTeam(store.id, id);
  if (t.isPending) return <LoadingState rows={4} className="p-6" />;
  if ((t.isError && /not found$/i.test(t.error.message)) || (t.data && t.data.storeId !== store.id)) return notFound;
  if (t.isError) return <ErrorState message="Couldn't load this team." onRetry={() => t.refetch()} />;
  return <TeamView store={store} team={t.data} buttons={buttons} />;
}

function TeamView({ store, team: t, buttons }: { store: Store; team: SquadMission; buttons: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const run = params.get('run') ?? undefined;
  const tab = params.get('participant') ?? t.steps.find((s) => run && s.runId === run)?.configId ?? '';
  const open = (participant?: string, runId?: string) => setParams((p) => withParams(p, { participant, run: runId }), { replace: true });
  const lead = t.participants?.[0];
  useEffect(() => {
    if (run) document.getElementById(`run-${run}`)?.scrollIntoView?.({ block: 'start' });
  }, [run, tab]);
  return (
    <section aria-label="Team" className="flex min-h-0 flex-1 flex-col">
      <Header store={store} team={t} buttons={buttons} />
      <div role="tablist" aria-label="Team tabs" className="flex shrink-0 gap-[18px] overflow-x-auto border-b border-[#1d1d22] px-[22px] [scrollbar-width:none]">
        {[{ configId: '', name: 'Thread' } as Participant, ...(t.participants ?? [])].map((p, i) => (
          <button
            key={p.configId || 'thread'}
            type="button"
            role="tab"
            aria-selected={tab === p.configId}
            onClick={() => open(p.configId || undefined)}
            className={cx('flex h-[38px] shrink-0 cursor-pointer items-center gap-[7px] border-b-2 px-1 text-[12.5px] font-medium whitespace-nowrap', tab === p.configId ? 'border-[#ff2a3a] text-white' : 'border-transparent text-muted hover:text-white')}
          >
            {p.configId && <StateDot state={stateOf(t.steps.filter((s) => s.configId === p.configId))} label={RUN_STATUS[stateOf(t.steps.filter((s) => s.configId === p.configId))].label} />}
            {p.name}
            {i === 1 && ' · lead'}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-[22px] py-4">
        {tab ? <ParticipantTab store={store} team={t} configId={tab} /> : <Thread store={store} team={t} onOpen={open} />}
      </div>
      {lead && <ToLead store={store} team={t} />}
    </section>
  );
}

function Header({ store, team: t, buttons }: { store: Store; team: SquadMission; buttons: ReactNode }) {
  const c = useConversation(store.id, t.conversationId ?? '').data;
  const update = useUpdateConversation(store.id);
  const action = useTeamAction(store.id, t.id);
  const stop = useStopConversation(store.id, t.conversationId ?? '');
  const [renaming, setRenaming] = useState(false);
  const [adding, setAdding] = useState(false);
  const title = c?.title ?? t.title;
  const rename = (v?: string) => {
    setRenaming(false);
    if (v?.trim() && v.trim() !== title && t.conversationId) update.mutate({ id: t.conversationId, title: v.trim() });
  };
  // Money counts Claude participants only; a team with none leaves it out (decision 12).
  const claude = t.participants?.some((p) => p.config?.runtime === 'claude');
  const money = claude && (t.budgetUsd ? `${cents(t.spentUsd ?? 0)} of ${cents(t.budgetUsd)}` : `${cents(t.spentUsd ?? 0)} spent`);
  const limits = [money, `max ${t.maxConcurrent ?? 2} at once`, `${t.retries ?? 2} ${t.retries === 1 ? 'retry' : 'retries'} per task`].filter(Boolean).join(' · ');
  const planning = t.status === 'running' && pending(t.steps[0]!) && (t.participants?.length ?? 0) < 6;
  const followUp = t.status !== 'running' && c && ['running', 'queued', 'awaiting_approval', 'waiting_for_input'].includes(c.state);
  const error = action.error ?? update.error ?? stop.error;
  return (
    <header className="flex flex-col gap-1.5 px-[22px] pt-3">
      <div className="flex items-center gap-2 text-xs text-muted">
        <span>Team · {store.name}</span>
        <span aria-hidden>·</span>
        <span>{limits}</span>
      </div>
      <div className="flex items-center gap-2 pb-1">
        {renaming ? (
          <input
            autoFocus
            aria-label="Team name"
            defaultValue={title}
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
            <h2 title={title} className="min-w-0 truncate text-[17px] font-semibold">
              {title}
            </h2>
            <button type="button" aria-label="Rename team" title="Rename" onClick={() => setRenaming(true)} className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-lg text-muted hover:bg-panel-2 hover:text-white">
              <Pencil className="size-3.5" />
            </button>
          </>
        )}
        <span className="flex-1" />
        {error && (
          <span role="alert" className="text-xs text-red">
            {error.message}
          </span>
        )}
        {planning && (
          <Button size="sm" className="shrink-0" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" /> Add agent
          </Button>
        )}
        {t.status === 'running' && (
          <Button size="sm" className="shrink-0" disabled={action.isPending} onClick={() => action.mutate({ path: 'cancel' })}>
            <Square className="size-3 fill-current" /> Stop team
          </Button>
        )}
        {followUp && (
          <Button size="sm" className="shrink-0" disabled={stop.isPending} onClick={() => stop.mutate(undefined)}>
            <Square className="size-3 fill-current" /> Stop run
          </Button>
        )}
        {buttons}
      </div>
      {adding && <AddAgent store={store} team={t} onClose={() => setAdding(false)} />}
    </header>
  );
}

/** One thread event: the avatar, a name, what happened and when, then its body. */
function Event({ who, mark, what, at, tone, lead, children }: { who: string; mark?: string; what: ReactNode; at?: string; tone?: string; lead?: boolean; children?: ReactNode }) {
  return (
    <div className="grid grid-cols-[28px_minmax(0,1fr)] gap-3">
      <span aria-hidden className={cx('inline-flex size-7 items-center justify-center rounded-lg border border-[#2c2c33] bg-[#1b1b20] text-[10px] font-bold text-[#d6d6dc]', tone)}>
        {mark ?? initials(who)}
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[12.5px]">
          <b className="font-semibold">{who}</b>
          {lead && <span className={cx('rounded-full px-2 py-px text-[10.5px] font-semibold', PILL.muted)}>Lead</span>}
          <span className="min-w-0 truncate text-muted">{what}</span>
          {at && (
            <time dateTime={at} className="ml-auto shrink-0 text-[11px] text-muted">
              {time(at)}
            </time>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

/** A step's pill; an interrupted step's carries Resume (decision 12). */
function StepPill({ store, team, step }: { store: Store; team: SquadMission; step: SquadMissionStep }) {
  const resume = useTeamAction(store.id, team.id);
  const [word, tone] = stepStatus(step);
  return (
    <span className="flex items-center gap-2 justify-self-end">
      <span className={cx('rounded-full px-2 py-px text-[10.5px] font-semibold whitespace-nowrap', PILL[tone])}>{word}</span>
      {step.interrupted && team.status === 'running' && (
        <Button size="sm" disabled={resume.isPending} onClick={() => resume.mutate({ path: `steps/${encodeURIComponent(step.id)}/resume`, body: { clientRequestId: crypto.randomUUID() } })}>
          Resume
        </Button>
      )}
    </span>
  );
}

function Thread({ store, team: t, onOpen }: { store: Store; team: SquadMission; onOpen: (participant?: string, run?: string) => void }) {
  const plan = t.steps[0]!;
  const tasks = tasksOf(t);
  const synthesis = t.steps.find((s) => s.kind === 'synthesis');
  const lead = nameOf(t, plan.configId);
  const n = (id: string) => tasks.findIndex((s) => s.id === id) + 1;
  const planRun = useRun(plan.runId ?? '').data;
  const [compare, setCompare] = useState<[SquadMissionStep, SquadMissionStep]>();
  // Unresolved: a disagreement names the task it disagrees with ("t1: …"); a failed or blocked task stands alone.
  const disagreements = tasks.flatMap((s) =>
    (s.contribution?.disagreesWith ?? []).map((d) => {
      const other = tasks.find((x) => x.id === /^\s*([\w-]+)\s*:/.exec(d)?.[1]);
      return { s, other, text: other ? d.slice(d.indexOf(':') + 1).trim() : d };
    }),
  );
  const failed = tasks.filter((s) => (s.status === 'error' && !s.interrupted) || s.status === 'blocked' || (s.status === 'cancelled' && t.status !== 'cancelled'));
  return (
    <div className={cx(COLUMN, 'grid gap-3.5')}>
      <Event who="You" mark="Y" tone="bg-[#24242a]" what="set the objective" at={t.createdAt}>
        <p className="mt-0.5 whitespace-pre-wrap text-[13px] text-[#e6e6ea]">{t.objective}</p>
      </Event>
      <Event who={lead} lead what={tasks.length ? `split the work into ${tasks.length} task${tasks.length === 1 ? '' : 's'}` : plan.status === 'done' ? 'planned no tasks' : 'is planning the work'} at={planRun?.endedAt ?? planRun?.startedAt}>
        {tasks.length > 0 ? (
          <div aria-label="Plan" className={cx(box, 'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5')}>
            {tasks.map((s) => (
              <div key={s.id} className="contents">
                <span className="text-muted">{n(s.id)}</span>
                <span className="min-w-0">
                  {nameOf(t, s.configId)} · {s.task}
                  {s.dependsOn.length > 0 && <span className="text-muted"> after {s.dependsOn.map(n).join(', ')}</span>}
                  {s.note && <span className="block text-[11.5px] text-muted">{s.note}</span>}
                </span>
                <StepPill store={store} team={t} step={s} />
              </div>
            ))}
          </div>
        ) : (
          <div className={cx(box, 'flex items-center gap-3')}>
            <span className="flex-1 text-muted">{plan.note ?? (plan.status === 'done' ? 'The plan has no tasks.' : 'The lead reads the objective and splits it into tasks for the team.')}</span>
            <StepPill store={store} team={t} step={plan} />
          </div>
        )}
      </Event>
      {tasks.map((s) => (
        <Contribution key={s.id} store={store} team={t} step={s} n={n(s.id)} onOpen={onOpen} />
      ))}
      {t.ownerNotes?.map((note) => (
        <Event key={note.id} who="You" mark="Y" tone="bg-[#24242a]" what="note for the lead's synthesis" at={note.at}>
          <p className="mt-0.5 whitespace-pre-wrap text-[13px] text-[#e6e6ea]">{note.text}</p>
        </Event>
      ))}
      {disagreements.map(({ s, other, text }, i) => (
        <Event key={`d${i}`} who="Unresolved" mark="!" tone="text-[#7aa7ff]" what="participants disagree">
          <div className={cx(box, 'border-[#7aa7ff]/35')}>
            {nameOf(t, s.configId)} (task {n(s.id)}){other ? ` disagrees with ${nameOf(t, other.configId)} (task ${n(other.id)})` : ''}: {text}{' '}
            {other?.contribution && (
              <button type="button" onClick={() => setCompare([other, s])} className={link}>
                Compare both
              </button>
            )}
          </div>
        </Event>
      ))}
      {failed.map((s) => (
        <Event key={`f${s.id}`} who="Unresolved" mark="!" tone="text-[#7aa7ff]" what={s.status === 'blocked' ? "a task didn't run" : 'a task failed'}>
          <div className={cx(box, 'border-[#7aa7ff]/35')}>
            Task {n(s.id)} ({nameOf(t, s.configId)}) {s.status === 'blocked' ? "didn't run: a task it depends on failed." : `failed${s.note ? `: ${s.note}` : '.'}`}
          </div>
        </Event>
      ))}
      <Synthesis store={store} team={t} step={synthesis} lead={lead} tasks={tasks.length} />
      {t.status !== 'running' && t.conversationId && <FollowUps store={store} conversationId={t.conversationId} name={lead} />}
      {compare && <Compare team={t} pair={compare} n={n} onClose={() => setCompare(undefined)} />}
    </div>
  );
}

/** A finished task: "finished · runtime model · $cost", its summary, its sources and Open full output; then its handoffs. */
function Contribution({ store, team: t, step: s, n, onOpen }: { store: Store; team: SquadMission; step: SquadMissionStep; n: number; onOpen: (participant?: string, run?: string) => void }) {
  const run = useRun(s.runId ?? '').data;
  const [shown, setShown] = useState(false);
  if (!s.contribution || !run) return null;
  const text = toBlocks(run.transcript).flatMap((b) => (b.kind === 'text' ? [b.text] : [])).join('');
  const cards = [...new Set([...`${text}\n${s.contribution.evidence.join('\n')}`.matchAll(/\[kb:([\w-]+)\]/gi)].map((m) => m[1]!))];
  const urls = s.contribution.evidence.filter((e) => webHref(e));
  const sources = cards.length + urls.length;
  const next = tasksOf(t).filter((x) => x.dependsOn.includes(s.id) && x.runId);
  const what = ['finished', runtimeLabel(run), run.runtime !== 'codex' && cents(run.usage.costUsd)].filter(Boolean).join(' · ');
  return (
    <>
      <Event who={nameOf(t, s.configId)} what={what} at={run.endedAt}>
        <div className={box}>
          <span className="whitespace-pre-wrap">{s.contribution.summary}</span>{' '}
          {sources > 0 && (
            <>
              <button type="button" aria-expanded={shown} onClick={() => setShown(!shown)} className={link}>
                {sources} source{sources === 1 ? '' : 's'}
              </button>
              {' · '}
            </>
          )}
          <button type="button" onClick={() => onOpen(s.configId, s.runId)} className={link}>
            Open full output
          </button>
          {shown && (
            <div aria-label={`Sources for task ${n}`} className="mt-2 flex flex-wrap gap-1.5">
              {cards.map((id) => (
                <Source key={id} id={id} storeId={store.id} href={`/knowledge?card=${encodeURIComponent(id)}&ws=${encodeURIComponent(store.id)}`} />
              ))}
              {urls.map((u) => (
                <a key={u} href={webHref(u)} target="_blank" rel="noreferrer" className={cx(chip, 'max-w-[320px] hover:text-white')}>
                  <span className="truncate">{u}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      </Event>
      {next.map((x) => (
        <div key={x.id} className="flex items-center gap-2 pl-10 text-xs text-muted">
          <ArrowRight aria-hidden className="size-3.5" />
          Task {n}'s contribution handed to {nameOf(t, x.configId)}
        </div>
      ))}
    </>
  );
}

/** The lead's synthesis once it's in; until then the dashed placeholder, or why there won't be one. */
function Synthesis({ store, team: t, step, lead, tasks }: { store: Store; team: SquadMission; step?: SquadMissionStep; lead: string; tasks: number }) {
  const run = useRun(step?.status === 'done' ? (step.runId ?? '') : '').data;
  if (run) return <Reply store={store} run={run} name={lead} latest={false} deliverables={run.deliverables} />;
  const why =
    t.status === 'cancelled'
      ? 'The team was stopped before the synthesis.'
      : t.status === 'blocked'
        ? `No synthesis: ${t.steps[0]!.status === 'error' ? "the lead's plan" : 'the synthesis'} failed.`
        : step?.status === 'running' || step?.status === 'queued'
          ? 'The lead is writing the synthesis.'
          : `Final synthesis by the lead arrives after ${tasks > 1 ? `tasks 1 to ${tasks}` : tasks ? 'task 1' : 'the plan'}. You're notified when it's ready.`;
  return (
    <div className="ml-10 flex items-center gap-3 rounded-[10px] border border-dashed border-[#33333b] px-3 py-2.5 text-[12.5px] text-muted">
      <span className="flex-1">{why}</span>
      {step?.interrupted && <StepPill store={store} team={t} step={step} />}
    </div>
  );
}

/** After the team: the owner's messages in its conversation and the lead's replies, with that conversation's queue and Retry. */
function FollowUps({ store, conversationId, name }: { store: Store; conversationId: string; name: string }) {
  const thread = useThread(store.id, conversationId);
  const runs = [...(thread.data?.pages ?? [])].reverse().flatMap((p) => p.items);
  const latest = runs.filter((r) => !runs.some((x) => x.retryOf === r.id)).at(-1);
  return runs.length ? <Turns store={store} conversationId={conversationId} runs={runs} name={name} latest={latest?.id} /> : null;
}

/** Compare both: the two contributions side by side, as the agents wrote them (plain text). */
function Compare({ team: t, pair, n, onClose }: { team: SquadMission; pair: [SquadMissionStep, SquadMissionStep]; n: (id: string) => number; onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} title="Compare both" width={880} subtitle="Each participant's contribution, as it wrote it. The lead's synthesis says which way it went.">
      <div className="grid grid-cols-2 gap-4">
        {pair.map((s) => (
          <section key={s.id} aria-label={`${nameOf(t, s.configId)}, task ${n(s.id)}`} className="grid content-start gap-2 text-[12.5px]">
            <h3 className="text-[13px] font-semibold">
              {nameOf(t, s.configId)} · task {n(s.id)}
            </h3>
            <p className="text-muted">{s.task}</p>
            <p className="font-medium text-text">{s.contribution?.summary}</p>
            <p className="whitespace-pre-wrap text-text-2">{s.contribution?.output}</p>
            {!!s.contribution?.disagreesWith.length && <p className="text-[#7aa7ff]">Disagrees: {s.contribution.disagreesWith.join('; ')}</p>}
          </section>
        ))}
      </div>
    </Dialog>
  );
}

/** A participant's tab: each of its steps (plan, tasks, synthesis) with the run in full; `run-<id>` is the scroll target. */
function ParticipantTab({ store, team: t, configId }: { store: Store; team: SquadMission; configId: string }) {
  const steps = t.steps.filter((s) => s.configId === configId);
  const name = nameOf(t, configId);
  const n = (id: string) => tasksOf(t).findIndex((s) => s.id === id) + 1;
  if (!steps.length) return <p className={cx(COLUMN, 'text-[12.5px] text-muted')}>No task yet: the lead's plan hasn't given {name} one.</p>;
  return (
    <div className={cx(COLUMN, 'grid gap-6')}>
      {steps.map((s) => (
        <section key={s.id} id={s.runId ? `run-${s.runId}` : undefined} aria-label={s.kind === 'task' ? `Task ${n(s.id)}` : s.kind === 'plan' ? 'Plan' : 'Synthesis'} className="grid scroll-mt-4 gap-2.5">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b border-[#1d1d22] pb-2">
            <div className="min-w-0 text-[13px]">
              <span className="font-semibold">{s.kind === 'task' ? `Task ${n(s.id)}` : s.kind === 'plan' ? 'Plan' : 'Synthesis'}</span>
              {s.kind === 'task' && <span className="text-text-2"> · {s.task}</span>}
              {s.expected && <span className="block text-xs text-muted">Expected: {s.expected}</span>}
              {s.note && <span className="block text-xs text-muted">{s.note}</span>}
            </div>
            <StepPill store={store} team={t} step={s} />
          </div>
          {s.runId && <StepRun store={store} runId={s.runId} name={name} />}
        </section>
      ))}
    </div>
  );
}

function StepRun({ store, runId, name }: { store: Store; runId: string; name: string }) {
  const run = useRun(runId).data;
  return run ? <Reply store={store} run={run} name={name} latest={false} deliverables={run.deliverables} /> : <LoadingState rows={2} />;
}

/** "To: Lead" (decision 12): a note for the synthesis while the team runs, a message in its conversation after. */
function ToLead({ store, team: t }: { store: Store; team: SquadMission }) {
  const ended = t.status !== 'running';
  const note = useTeamAction(store.id, t.id);
  const send = useSendMessage(store.id, t.conversationId ?? '');
  const [text, setText] = useState('');
  const busy = note.isPending || send.isPending;
  const failure = (ended ? send : note).error;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = text.trim();
    if (!v || busy) return;
    const clientRequestId = crypto.randomUUID();
    const done = { onSuccess: () => setText('') };
    if (ended) send.mutate({ clientRequestId, message: v }, done);
    else note.mutate({ path: 'notes', body: { clientRequestId, text: v } }, done);
  };
  return (
    <form onSubmit={submit} className="px-[22px] pt-2 pb-[18px]">
      {failure && (
        <p role="alert" className={cx(COLUMN, 'pb-1.5 text-xs text-red')}>
          {failure.message}
        </p>
      )}
      <div className={cx(COLUMN, 'flex items-center gap-2 rounded-[14px] border border-[#2c2c33] bg-[#111114] px-3 py-2.5')}>
        <span className="inline-flex h-[26px] shrink-0 items-center rounded-full border border-[#26262c] px-2.5 text-xs text-text-2">To: Lead</span>
        <input aria-label="Message the lead" value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} placeholder={ended ? 'Message the lead…' : "Note for the lead's synthesis…"} className="min-w-0 flex-1 bg-transparent text-[13.5px] text-[#f0f0f2] outline-none placeholder:text-muted" />
        <button type="submit" aria-label="Send" disabled={!text.trim() || busy} className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg bg-[#e01e2d] text-white disabled:opacity-50">
          <ArrowUp className="size-4" />
        </button>
      </div>
    </form>
  );
}

/** The right panel with a team open: the lead, participants (runtime, model, status), limits and store scope. */
export function TeamDetails({ store, id, end }: { store: Store; id: string; end?: ReactNode }) {
  const t = useTeam(store.id, id).data;
  const section = (title: string, body: ReactNode) => (
    <section className="flex flex-col gap-1.5 border-b border-[#1d1d22] px-4 py-3.5">
      <h3 className="text-[11px] font-semibold tracking-[.07em] text-muted uppercase">{title}</h3>
      {body}
    </section>
  );
  const compares = t?.participants?.some((p) => p.config?.tools.includes('compare_stores'));
  return (
    <>
      <div className="flex h-10 shrink-0 items-center border-b border-[#1d1d22] pr-2 pl-4 text-[12.5px] font-medium">
        Team
        <span className="flex-1" />
        {end}
      </div>
      {!t ? (
        <LoadingState rows={3} className="p-4" />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {section('Lead', <div className="text-[12.5px] text-text-2">{t.participants?.[0]?.name}</div>)}
          {section(
            'Participants',
            <ul className="grid gap-2">
              {t.participants?.map((p) => {
                const state = stateOf(t.steps.filter((s) => s.configId === p.configId));
                return (
                  <li key={p.configId} className="grid gap-0.5 text-[12.5px]">
                    <span className="flex items-center gap-2">
                      <StateDot state={state} />
                      <span className="text-text">{p.name}</span>
                      <span className="ml-auto text-xs text-muted">{RUN_STATUS[state].label}</span>
                    </span>
                    <span className="pl-4 text-xs text-muted">{p.config && runtimeLabel(p.config)}</span>
                  </li>
                );
              })}
            </ul>,
          )}
          {section(
            'Limits',
            <ul className="grid gap-1 text-[12.5px] text-text-2">
              {t.participants?.some((p) => p.config?.runtime === 'claude') && <li>Team budget: {t.budgetUsd ? `${cents(t.spentUsd ?? 0)} of ${cents(t.budgetUsd)}` : `No limit (${cents(t.spentUsd ?? 0)} spent)`}</li>}
              <li>At once: {t.maxConcurrent ?? 2}</li>
              <li>Retries per task: {t.retries ?? 2}</li>
              <li className="flex items-center gap-1.5">
                Sub-teams: Off <Lock aria-hidden className="size-3 text-muted" />
              </li>
            </ul>,
          )}
          {section(
            'Store scope',
            <>
              <div className="flex items-center gap-1.5 text-[12.5px] text-text-2">
                <Lock aria-hidden className="size-3.5 text-muted" />
                {store.name} only
              </div>
              <p className="text-xs text-muted">
                {compares
                  ? "Also reads your other stores' names, platforms and niches and their totals (revenue, profit, margin, ad spend, ROAS, orders, health and revenue change) for comparison. Turned on in a participant's settings."
                  : "Fixed when the team started. Other stores' data is never read."}
              </p>
            </>,
          )}
        </div>
      )}
    </>
  );
}
