import { AGENT_ROLES, type AgentEvent } from '@frontline/shared';
import type { Engine, RunInput } from './engine';
import { REFLECTION_PROMPT } from './memory';
import type { ToolName } from './roles';
import { callTool, channel, toolsFor } from './tools';

/** An event to emit, or a real call to one of the role's tools (needs `env`). */
export type FakeStep = AgentEvent | { call: ToolName; input?: Record<string, unknown> };
export type FakeScript = (input: RunInput) => FakeStep[];

/**
 * Deterministic default (demo mode): with tools available it reads the store's last 30 days for real and quotes them,
 * then acknowledges the task in a few text chunks. Reflection learns nothing, so demo runs don't fill store memory.
 */
export const echoScript: FakeScript = (input) => {
  const done: AgentEvent = { type: 'done', sessionId: input.resume ?? `fake-${input.agent.id}`, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } };
  if (input.task === REFLECTION_PROMPT) return [{ type: 'text_delta', text: '[]' }, done];
  let reply = `${AGENT_ROLES[input.agent.role].name} for ${input.store.name}: on it — "${input.task}".`;
  const t = input.env?.summary(input.store.id, 30).totals;
  if (t) {
    const money = (n: number) => `${Math.round(n).toLocaleString('en-US')} ${input.store.currency}`;
    reply += ` Last 30 days: ${money(t.revenue)} revenue, ${money(t.profit)} profit, ROAS ${t.roas.toFixed(2)}, ${t.orders} orders. (Demo engine: switch to Claude for a real answer.)`;
  }
  return [...(t ? [{ call: 'store_summary' as const, input: { range: 30 } }] : []), ...reply.split(/(?<= )/).map((text): AgentEvent => ({ type: 'text_delta', text })), done];
};

/** Scripted engine for tests and demo mode. Costs nothing, never touches the network, but runs tools for real. */
export function fakeEngine(script: FakeScript = echoScript): Engine {
  return async function* (input) {
    const events = channel<AgentEvent>();
    const ctx = input.env && { ...input.env, store: input.store, agent: input.agent, emit: events.push, signal: input.signal };
    const tools = toolsFor(input.agent.role);
    (async () => {
      let n = 0;
      for (const step of script(input)) {
        if (input.signal?.aborted) return;
        if (!('call' in step)) {
          events.push(step);
          continue;
        }
        const id = `fake-tool-${++n}`;
        const tool = tools.find((t) => t.name === step.call);
        events.push({ type: 'tool_call', id, name: step.call, input: step.input ?? {} });
        const result = tool && ctx ? await callTool(tool, step.input, ctx) : { output: `Tool ${step.call} is not available`, isError: true };
        events.push({ type: 'tool_result', id, ...result });
      }
    })().then(() => events.end(), events.end);
    yield* events.drain();
  };
}
