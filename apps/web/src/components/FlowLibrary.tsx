// The Email & SMS agent's flow library: each flow as a timeline of steps, copy-ready for Klaviyo or Shopify Email.
import { useState } from 'react';
import { Copy, Mail, MessageSquare } from 'lucide-react';
import type { Agent, FlowDraft, FlowMessage } from '@frontline/shared';
import { useDeleteFlowDraft, useFlowDrafts, useStartRun } from '../api/client';
import { ago } from '../lib/format';
import { CHANNEL, delayLabel, flowText, messageText } from '../lib/flows';
import { Badge, Button, cx, EmptyState, ErrorState, LoadingState, Panel } from './ui';

const STARTER = 'Design a welcome series flow for new subscribers: trigger, timing, and the copy for every email and SMS. Save it to the flow library.';

export function FlowLibrary({ agent, onOpen }: { agent: Agent; onOpen: (runId: string) => void }) {
  const q = useFlowDrafts(agent.storeId);
  const start = useStartRun();
  const [picked, setPicked] = useState<string>();
  if (q.isPending) return <Panel title="Flow Library"><LoadingState rows={4} /></Panel>;
  if (q.isError) return <Panel title="Flow Library"><ErrorState message="Couldn't load the flows." onRetry={() => q.refetch()} /></Panel>;
  if (!q.data.length)
    return (
      <Panel title="Flow Library">
        <EmptyState
          title="No flows yet"
          action={
            <Button variant="primary" disabled={start.isPending} onClick={() => start.mutate({ agentId: agent.id, task: STARTER }, { onSuccess: (r) => onOpen(r.id) })}>
              Design a welcome series
            </Button>
          }
        >
          Ask this agent for a flow in Chat (welcome, abandoned cart, post-purchase, win-back) and it lands here, ready to paste into your email tool.
        </EmptyState>
      </Panel>
    );
  const flow = q.data.find((f) => f.id === picked) ?? q.data[0]!;
  return (
    <div className="grid items-start gap-3.5 min-[1000px]:grid-cols-[minmax(0,1fr)_minmax(0,2.2fr)]">
      <Panel title="Flow Library" sub="Nothing sends from here. Set these up in Klaviyo or Shopify Email.">
        <ul className="grid gap-1.5">
          {q.data.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => setPicked(f.id)}
                aria-current={f.id === flow.id}
                className={cx('w-full cursor-pointer rounded-lg border px-3 py-2 text-left transition', f.id === flow.id ? 'border-red/50 bg-red-soft' : 'border-line bg-bg-2 hover:border-line-2')}
              >
                <b className="block text-[13px]">{f.name}</b>
                <span className="text-xs text-muted">
                  {f.messages.length} {f.messages.length === 1 ? 'step' : 'steps'} · {ago(f.createdAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>
      <FlowView key={flow.id} flow={flow} onOpen={onOpen} />
    </div>
  );
}

function FlowView({ flow, onOpen }: { flow: FlowDraft; onOpen: (runId: string) => void }) {
  const del = useDeleteFlowDraft();
  const [confirm, setConfirm] = useState(false);
  return (
    <Panel
      title={flow.name}
      sub={`Trigger: ${flow.trigger}`}
      action={<CopyButton text={flowText(flow)} label="Copy flow" />}
    >
      {flow.notes && <p className="mb-4 rounded-lg border border-line bg-bg-2 p-3 text-[13px] leading-relaxed text-text-2">{flow.notes}</p>}
      <ol className="grid gap-3">
        {flow.messages.map((m, i) => (
          <Step key={i} m={m} n={i + 1} last={i === flow.messages.length - 1} />
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-3 text-xs">
        {flow.runId && (
          <button type="button" onClick={() => onOpen(flow.runId!)} className="cursor-pointer text-text-2 hover:text-white">
            See the conversation
          </button>
        )}
        {confirm ? (
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <span className="text-text-2">Delete this flow?</span>
            <Button size="sm" onClick={() => setConfirm(false)}>
              Keep
            </Button>
            <Button size="sm" variant="primary" disabled={del.isPending} onClick={() => del.mutate(flow.id)}>
              Delete flow
            </Button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirm(true)} className="ml-auto cursor-pointer text-muted hover:text-red">
            Delete
          </button>
        )}
      </div>
      {del.isError && (
        <p role="alert" className="mt-2 text-xs text-red">
          {del.error.message}
        </p>
      )}
    </Panel>
  );
}

function Step({ m, n, last }: { m: FlowMessage; n: number; last: boolean }) {
  const Icon = m.channel === 'email' ? Mail : MessageSquare;
  return (
    <li className="relative grid grid-cols-[28px_minmax(0,1fr)] gap-3">
      {!last && <span aria-hidden className="absolute top-8 bottom-[-12px] left-[13.5px] w-px bg-line-2" />}
      <span className="grid size-7 place-items-center rounded-full border border-line-2 bg-bg-2 text-text-2">
        <Icon className="size-3.5" aria-hidden />
      </span>
      <div className="min-w-0 rounded-lg border border-line bg-bg-2 p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <b className="text-[13px]">
            Step {n} · {CHANNEL[m.channel]}
          </b>
          <span className="text-xs text-muted">{delayLabel(m.delayHours)}</span>
          {m.offer && <Badge>{m.offer}</Badge>}
          <CopyButton text={messageText(m)} label="Copy" className="ml-auto" />
        </div>
        {m.subject && (
          <p className="text-[13px]">
            <span className="text-muted">Subject </span>
            {m.subject}
          </p>
        )}
        {m.preview && (
          <p className="text-xs text-muted">
            Preview <span className="text-text-2">{m.preview}</span>
          </p>
        )}
        <p className={cx('text-[13px] leading-relaxed whitespace-pre-wrap text-text-2', (m.subject || m.preview) && 'mt-2 border-t border-line pt-2')}>{m.body}</p>
      </div>
    </li>
  );
}

function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button size="sm" className={className} onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true))}>
      <Copy className="size-3.5" aria-hidden />
      {copied ? 'Copied' : label}
    </Button>
  );
}
