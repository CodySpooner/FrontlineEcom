// A run's transcript and the approval cards, used by the AI Agents workspace and across the app. Runs stream in over /api/live.
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { Brain, ChevronRight, Wrench } from 'lucide-react';
import { APPROVAL_KINDS, type AgentRole, type AgentRunDetail, type ApprovalRequest } from '@frontline/shared';
import { useApprovals, useCancelRun, useDecide, useKbCard } from '../api/client';
import { expiredWhy, shownReason } from '../lib/approvals';
import { cents, money } from '../lib/format';
import { isLive, toBlocks, toolName, type Block } from '../lib/transcript';
import { budgetFix } from '../lib/usage';
import { researchHref } from '../knowledge/url';
import { ApprovalExtras } from './ApprovalExtras';
import { Portrait } from './Art';
import { Badge, Button, cx, inputClass, StatusDot } from './ui';

/** One exchange: the owner's task, then the agent's streamed reply, tool steps, approvals and learnings. */
/** `onRetry` (the newest message only) offers to send a failed or stopped task again. */
export function Transcript({ run, role, onRetry }: { run: AgentRunDetail; role: AgentRole; onRetry?: (task: string) => void }) {
  const cancel = useCancelRun();
  const live = isLive(run);
  const blocks = toBlocks(run.transcript);
  return (
    <div className="grid gap-2.5">
      <p className="ml-auto max-w-[80%] rounded-xl rounded-br-sm border border-red/30 bg-red-soft px-3 py-2 text-[13px] whitespace-pre-wrap">
        <Cited text={run.task} />
      </p>
      <div className="flex gap-2.5">
        <Portrait role={role} className="size-8" />
        <div className="grid min-w-0 flex-1 gap-2">
          {blocks.map((b, i) =>
            b.kind === 'text' ? (
              <p key={i} className="text-[13px] leading-relaxed whitespace-pre-wrap text-text">
                <Cited text={b.text} />
              </p>
            ) : b.kind === 'tool' ? (
              <ToolBlock key={i} b={b} />
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
                {cancel.isError && (
                  <span role="alert" className="text-red">
                    {cancel.error.message}
                  </span>
                )}
              </>
            ) : run.status === 'done' ? (
              <>
                {`Done${run.usage.costUsd ? ` · ${cents(run.usage.costUsd)}` : ''}`}
                <Link to={researchHref(run.storeId, run.task)} className="underline-offset-2 hover:text-white hover:underline">
                  Research this
                </Link>
              </>
            ) : run.status === 'cancelled' ? (
              'Stopped'
            ) : (
              <>
                {/* The transcript's own error line already says why, when it has one. */}
                <span className="text-red">Failed{run.error && !run.transcript.some((e) => e.type === 'error' && e.message === run.error) ? `: ${run.error}` : ''}</span>
                {run.error && <FixLink message={run.error} agentId={run.agentId} />}
              </>
            )}
            {onRetry && (run.status === 'error' || run.status === 'cancelled') && (
              <button type="button" onClick={() => onRetry(run.task)} className="cursor-pointer underline-offset-2 hover:text-white hover:underline">
                Try again
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A link to the setting that lifts a budget refusal; nothing for other errors. */
export function FixLink({ message, agentId, onClick }: { message: string; agentId: string; onClick?: () => void }) {
  const fix = budgetFix(message, agentId);
  return fix ? (
    <Link to={fix.to} onClick={onClick} className="font-semibold whitespace-nowrap text-text-2 underline underline-offset-2 hover:text-white">
      {fix.label}
    </Link>
  ) : null;
}

/** Deny's second step: an optional reason, sent with the deny, so the squad's memory of the "no" says why. */
export function DenyReason({ title, disabled, onDeny, onBack, className }: { title: string; disabled?: boolean; onDeny: (note?: string) => void; onBack: () => void; className?: string }) {
  const [note, setNote] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onDeny(note.trim() || undefined);
      }}
      className={cx('flex min-w-0 flex-1 flex-wrap items-center gap-1.5', className)}
    >
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={300}
        autoFocus
        aria-label={`Why deny ${title}?`}
        placeholder="Why not? (optional)"
        className={cx(inputClass, 'min-w-40 flex-1 py-1!')}
      />
      <Button size="sm" onClick={onBack}>
        Back
      </Button>
      <Button size="sm" type="submit" disabled={disabled} aria-label={`Confirm deny: ${title}`}>
        Deny
      </Button>
    </form>
  );
}

/** How a request decided elsewhere (Dashboard, bell, autopilot) ended, or that the app closed it. Mounted only once it's out of the waiting list. */
function Outcome({ id }: { id: string }) {
  const done = [...(useApprovals('approved').data ?? []), ...(useApprovals('denied').data ?? [])].find((x) => x.id === id);
  if (!done) return <Badge tone="muted">Decided</Badge>;
  if (done.status === 'approved') return <Badge tone="good">Approved</Badge>;
  return expiredWhy(done) ? <Badge tone="muted">Expired</Badge> : <Badge tone="red">Denied</Badge>;
}

/** A request raised mid-run. Decided ones (here or on the dashboard) drop their buttons. */
/** `who` (e.g. "Ad Strategist · Pawsome Gear") replaces the generic heading where the store isn't obvious. */
/** An answer with each [kb:<id>] it cites as a link to that knowledge card (KB-17), named by the card's title. */
function Cited({ text }: { text: string }) {
  return text.split(/(\[kb:[\w-]+\])/).map((part, i) => {
    const id = /^\[kb:([\w-]+)\]$/.exec(part)?.[1];
    return id ? <KbCite key={i} id={id} raw={part} /> : part;
  });
}

/** One cited card. Until it loads, and for an id that isn't a card (its 404 is retried a while), it stays as the agent wrote it. */
function KbCite({ id, raw }: { id: string; raw: string }) {
  const card = useKbCard(id).data;
  if (!card) return raw;
  return (
    <Link to={`/knowledge?card=${encodeURIComponent(id)}`} className="text-red underline-offset-2 hover:underline">
      {card.title}
    </Link>
  );
}

/** `tone="amber"` (the AI Agents thread only): the board's amber card, with Deny… before Approve on the right. */
export function ApprovalCard({ a, who, tone }: { a: ApprovalRequest; who?: string; tone?: 'amber' }) {
  const amber = tone === 'amber';
  const pending = useApprovals().data;
  const decide = useDecide();
  const [verdict, setVerdict] = useState<'approve' | 'deny'>();
  const open = !verdict && (pending?.some((p) => p.id === a.id) ?? a.status === 'pending');
  const [denying, setDenying] = useState(false);
  // Backing out of the reason field unmounts it: focus returns to Deny, not the top of the page.
  const [backed, setBacked] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const act = (v: 'approve' | 'deny', note?: string) => {
    // A decided card drops out of a waiting list (notifications, the agent page): focus moves on to the next open
    // request beside it, not the top of the page.
    const others = [...(card.current?.parentElement?.querySelectorAll<HTMLButtonElement>('[data-approve]') ?? [])].filter((b) => !card.current!.contains(b));
    (others.find((b) => card.current!.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ?? others.at(-1))?.focus();
    return decide.mutateAsync({ id: a.id, verdict: v, note }).then(() => setVerdict(v), () => {});
  };
  return (
    <div ref={card} className={amber ? 'rounded-lg border border-amber/38 bg-amber/5 p-3' : 'rounded-lg border border-red/40 bg-red-soft/40 p-3'}>
      <div className={amber ? 'text-[11px] font-semibold tracking-[.07em] text-amber uppercase' : 'font-display text-[11px] font-bold tracking-[.12em] text-red uppercase'}>
        {who ?? (amber ? (open ? 'Approval needed' : 'Request') : open ? 'Needs your approval' : 'Request')}
        {APPROVAL_KINDS[a.action.kind] && ` · ${APPROVAL_KINDS[a.action.kind]!.label}`}
      </div>
      <div className="mt-1 text-[13px] font-semibold">{a.title}</div>
      <div className="mt-0.5 text-xs text-muted">
        {shownReason(a)}
        {a.action.amountUsd !== undefined && <span className="ml-1.5 font-semibold text-text-2">· {money(a.action.amountUsd)}/day at stake</span>}
      </div>
      <ApprovalExtras action={a.action} storeId={a.storeId} />
      <div className={cx('mt-2.5 flex flex-wrap items-center gap-1.5', amber && 'justify-end')}>
        {open && denying ? (
          <DenyReason title={a.title} disabled={decide.isPending} onDeny={(note) => act('deny', note)} onBack={() => (setDenying(false), setBacked(true))} />
        ) : open && amber ? (
          <>
            <Button size="sm" disabled={decide.isPending} onClick={() => setDenying(true)} aria-label={`Deny: ${a.title}`} autoFocus={backed}>
              Deny…
            </Button>
            <Button size="sm" variant="primary" disabled={decide.isPending} onClick={() => act('approve')} aria-label={`Approve: ${a.title}`} data-approve={a.id}>
              Approve
            </Button>
          </>
        ) : open ? (
          <>
            <Button size="sm" variant="primary" disabled={decide.isPending} onClick={() => act('approve')} aria-label={`Approve: ${a.title}`} data-approve={a.id}>
              Approve
            </Button>
            <Button size="sm" disabled={decide.isPending} onClick={() => setDenying(true)} aria-label={`Deny: ${a.title}`} autoFocus={backed}>
              Deny
            </Button>
          </>
        ) : (
          verdict ? <Badge tone={verdict === 'deny' ? 'red' : 'good'}>{verdict === 'approve' ? 'Approved' : 'Denied'}</Badge> : <Outcome id={a.id} />
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

/** One tool call: its name and outcome, opening to the raw input and output. */
export function ToolBlock({ b }: { b: Extract<Block, { kind: 'tool' }> }) {
  return (
    <details className="group rounded-lg border border-line bg-bg-2 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-text-2 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 text-muted transition-transform group-open:rotate-90" />
        <Wrench className="size-3.5 text-muted" />
        <ToolName id={b.name} />
        <span className={cx('ml-auto', b.isError ? 'text-red' : 'text-muted')}>{b.output === undefined ? 'running…' : b.isError ? 'failed' : 'done'}</span>
      </summary>
      <div className="grid gap-2 border-t border-line px-3 py-2">
        <pre className="overflow-x-auto font-mono text-[11px] whitespace-pre-wrap text-muted">{JSON.stringify(b.input, null, 2)}</pre>
        {b.output !== undefined && <pre className="max-h-48 overflow-auto font-mono text-[11px] whitespace-pre-wrap text-text-2">{b.output}</pre>}
      </div>
    </details>
  );
}

function ToolName({ id }: { id: string }) {
  const [tool, server] = toolName(id);
  return (
    <>
      <span className="font-mono">{tool}</span>
      {server && <span className="text-muted">· {server}</span>}
    </>
  );
}
