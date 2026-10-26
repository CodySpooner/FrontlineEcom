import type { AgentEvent, AgentRun, AgentRunDetail, ApprovalRequest, StoreMemory } from '@frontline/shared';

/** What the chat draws for one run. */
export type Block =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; id: string; name: string; input: unknown; output?: string; isError?: boolean }
  | { kind: 'approval'; approval: ApprovalRequest }
  | { kind: 'memory'; memory: StoreMemory }
  | { kind: 'error'; message: string };

/** Consecutive text deltas merge into one paragraph; a tool result folds into its call; `done` draws nothing. */
export function toBlocks(events: AgentEvent[]): Block[] {
  const out: Block[] = [];
  for (const e of events) {
    const last = out.at(-1);
    if (e.type === 'text_delta') {
      if (last?.kind === 'text') last.text += e.text;
      else out.push({ kind: 'text', text: e.text });
    } else if (e.type === 'tool_call') out.push({ kind: 'tool', id: e.id, name: e.name, input: e.input });
    else if (e.type === 'tool_result') {
      const call = out.find((b): b is Extract<Block, { kind: 'tool' }> => b.kind === 'tool' && b.id === e.id);
      if (call) Object.assign(call, { output: e.output, isError: e.isError });
    } else if (e.type === 'approval_request') out.push({ kind: 'approval', approval: e.approval });
    else if (e.type === 'memory_written') out.push({ kind: 'memory', memory: e.memory });
    else if (e.type === 'error') out.push({ kind: 'error', message: e.message });
  }
  return out;
}

/** Live `run_event` → cached run detail (new object; react-query needs a fresh reference). */
export function applyRunEvent(run: AgentRunDetail, e: AgentEvent): AgentRunDetail {
  const next: AgentRunDetail = { ...run, transcript: [...run.transcript, e] };
  if (e.type === 'done') Object.assign(next, { status: 'done', sessionId: e.sessionId, usage: e.usage });
  else if (e.type === 'error') Object.assign(next, { status: 'error', error: e.message });
  else if (run.status === 'queued') next.status = 'running';
  return next;
}

export const isLive = (r: Pick<AgentRun, 'status'>) => r.status === 'queued' || r.status === 'running';
