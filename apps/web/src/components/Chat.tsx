// UI-07 agent chat: each message is a run; follow-ups resume the previous run's session. Runs stream in over /api/live.
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Brain, ChevronRight, MessageSquare, SendHorizontal, Wrench } from 'lucide-react';
import { AGENT_ROLES, APPROVAL_KINDS, type Agent, type AgentRole, type AgentRunDetail, type ApprovalRequest } from '@frontline/shared';
import { useApprovals, useCancelRun, useDecide, useRun, useStartRun } from '../api/client';
import { cents, money } from '../lib/format';
import { isLive, toBlocks } from '../lib/transcript';
import { ApprovalExtras } from './ApprovalExtras';
import { Portrait } from './Art';
import { Badge, Button, cx, EmptyState, LoadingState, Panel, StatusDot } from './ui';

export function Chat({ agent, thread, onThread }: { agent: Agent; thread: string[]; onThread: (ids: string[]) => void }) {
  const name = AGENT_ROLES[agent.role].name;
  const start = useStartRun();
  const [task, setTask] = useState('');
  const last = useRun(thread.at(-1) ?? '').data;
  const busy = !!last && isLive(last);
  const off = agent.enabled === false;

  // Keep the newest message in view as text streams in.
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const ro = new ResizeObserver(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight }));
    if (content.current) ro.observe(content.current);
    return () => ro.disconnect();
  }, []);

  const send = (e?: FormEvent) => {
    e?.preventDefault();
    const t = task.trim();
    if (!t || busy || start.isPending) return;
    start.mutate(
      { agentId: agent.id, task: t, resumeRunId: last?.sessionId ? last.id : undefined },
      {
        onSuccess: (r) => {
          setTask('');
          onThread([...thread, r.id]);
        },
      },
    );
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    send();
  };

  return (
    <Panel
      title={`Chat with ${name}`}
      sub="Follow-ups continue the same conversation."
      action={
        thread.length > 0 && (
          <Button size="sm" onClick={() => onThread([])}>
            New chat
          </Button>
        )
      }
    >
      <div ref={scroller} className="max-h-[min(60vh,560px)] min-h-[240px] overflow-y-auto pr-1" aria-live="polite">
        <div ref={content} className="grid gap-5">
          {thread.length ? (
            thread.map((id) => <RunView key={id} id={id} role={agent.role} />)
          ) : (
            <EmptyState icon={MessageSquare} title={`Brief your ${name}`}>
              Give it a task, e.g. "What should we change this week?" It works with this store's data and asks before it spends or
              publishes anything.
            </EmptyState>
          )}
        </div>
      </div>
      <form onSubmit={send} className="mt-3 flex items-end gap-2 border-t border-line pt-3">
        <label htmlFor="chat-task" className="sr-only">
          Message {name}
        </label>
        <textarea
          id="chat-task"
          rows={2}
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={onKey}
          disabled={off}
          maxLength={4000}
          placeholder={off ? `Deploy ${name} to chat with it` : `Message ${name}…  (Enter to send, Shift+Enter for a new line)`}
          className="min-h-[44px] flex-1 resize-y rounded-lg border border-line-2 bg-bg-2 px-3 py-2 text-[13px] placeholder:text-muted focus:border-red/60 focus:outline-none disabled:opacity-50"
        />
        <Button type="submit" variant="primary" disabled={off || busy || start.isPending || !task.trim()} aria-label="Send">
          <SendHorizontal className="size-4" strokeWidth={2} />
          Send
        </Button>
      </form>
      {start.isError && (
        <p role="alert" className="mt-2 text-xs text-red">
          {start.error.message}
        </p>
      )}
    </Panel>
  );
}

function RunView({ id, role }: { id: string; role: AgentRole }) {
  const q = useRun(id);
  if (q.isPending) return <LoadingState rows={1} />;
  if (q.isError) return <p className="text-xs text-red">Couldn't load this message.</p>;
  return <Transcript run={q.data} role={role} />;
}

/** One exchange: the owner's task, then the agent's streamed reply, tool steps, approvals and learnings. */
export function Transcript({ run, role }: { run: AgentRunDetail; role: AgentRole }) {
  const cancel = useCancelRun();
  const live = isLive(run);
  const blocks = toBlocks(run.transcript);
  return (
    <div className="grid gap-2.5">
      <p className="ml-auto max-w-[80%] rounded-xl rounded-br-sm border border-red/30 bg-red-soft px-3 py-2 text-[13px] whitespace-pre-wrap">{run.task}</p>
      <div className="flex gap-2.5">
        <Portrait role={role} className="size-8" />
        <div className="grid min-w-0 flex-1 gap-2">
          {blocks.map((b, i) =>
            b.kind === 'text' ? (
              <p key={i} className="text-[13px] leading-relaxed whitespace-pre-wrap text-text">
                {b.text}
              </p>
            ) : b.kind === 'tool' ? (
              <details key={i} className="group rounded-lg border border-line bg-bg-2 text-xs">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-text-2 [&::-webkit-details-marker]:hidden">
                  <ChevronRight className="size-3.5 text-muted transition-transform group-open:rotate-90" />
                  <Wrench className="size-3.5 text-muted" />
                  <span className="font-mono">{b.name}</span>
                  <span className={cx('ml-auto', b.isError ? 'text-red' : 'text-muted')}>{b.output === undefined ? 'running…' : b.isError ? 'failed' : 'done'}</span>
                </summary>
                <div className="grid gap-2 border-t border-line px-3 py-2">
                  <pre className="overflow-x-auto font-mono text-[11px] whitespace-pre-wrap text-muted">{JSON.stringify(b.input, null, 2)}</pre>
                  {b.output !== undefined && <pre className="max-h-48 overflow-auto font-mono text-[11px] whitespace-pre-wrap text-text-2">{b.output}</pre>}
                </div>
              </details>
            ) : b.kind === 'approval' ? (
              <ApprovalCard key={i} a={b.approval} />
            ) : b.kind === 'memory' ? (
              <p key={i} className="flex items-start gap-2 text-xs text-text-2">
                <Brain className="mt-px size-3.5 shrink-0 text-red" />
                <span>
                  <span className="text-muted">Learned:</span> {b.memory.text}
                </span>
              </p>
            ) : (
              <p key={i} role="alert" className="text-xs text-red">
                {b.message}
              </p>
            ),
          )}
          <div className="flex items-center gap-2 text-[11px] text-muted">
            {live ? (
              <>
                <StatusDot tone="good" pulse />
                {run.status === 'queued' ? 'Queued…' : 'Working…'}
                <button type="button" onClick={() => cancel.mutate(run.id)} disabled={cancel.isPending} className="cursor-pointer underline-offset-2 hover:text-white hover:underline">
                  Stop
                </button>
              </>
            ) : run.status === 'done' ? (
              `Done${run.usage.costUsd ? ` · ${cents(run.usage.costUsd)}` : ''}`
            ) : run.status === 'cancelled' ? (
              'Stopped'
            ) : (
              <span className="text-red">Failed{run.error ? `: ${run.error}` : ''}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A request raised mid-run. Decided ones (here or on the dashboard) drop their buttons. */
export function ApprovalCard({ a }: { a: ApprovalRequest }) {
  const pending = useApprovals().data;
  const decide = useDecide();
  const [verdict, setVerdict] = useState<'approve' | 'deny'>();
  const open = !verdict && (pending?.some((p) => p.id === a.id) ?? a.status === 'pending');
  const act = (v: 'approve' | 'deny') => decide.mutateAsync({ id: a.id, verdict: v }).then(() => setVerdict(v), () => {});
  return (
    <div className="rounded-lg border border-red/40 bg-red-soft/40 p-3">
      <div className="font-display text-[11px] font-bold tracking-[.12em] text-red uppercase">Needs your approval{APPROVAL_KINDS[a.action.kind] && ` · ${APPROVAL_KINDS[a.action.kind]!.label}`}</div>
      <div className="mt-1 text-[13px] font-semibold">{a.title}</div>
      <div className="mt-0.5 text-xs text-muted">
        {a.reason}
        {a.action.amountUsd !== undefined && <span className="ml-1.5 font-semibold text-text-2">· {money(a.action.amountUsd)}/day at stake</span>}
      </div>
      <ApprovalExtras action={a.action} />
      <div className="mt-2.5 flex items-center gap-1.5">
        {open ? (
          <>
            <Button size="sm" variant="primary" disabled={decide.isPending} onClick={() => act('approve')} aria-label={`Approve: ${a.title}`}>
              Approve
            </Button>
            <Button size="sm" disabled={decide.isPending} onClick={() => act('deny')} aria-label={`Deny: ${a.title}`}>
              Deny
            </Button>
          </>
        ) : (
          <Badge tone={verdict === 'deny' ? 'red' : verdict ? 'good' : 'muted'}>{verdict === 'approve' ? 'Approved' : verdict === 'deny' ? 'Denied' : 'Decided'}</Badge>
        )}
        {decide.isError && (
          <span role="alert" className="text-xs text-red">
            {decide.error.message}
          </span>
        )}
      </div>
    </div>
  );
}
