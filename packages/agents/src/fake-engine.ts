import { AGENT_ROLES, type AgentEvent } from '@frontline/shared';
import type { Engine, RunInput } from './engine';

export type FakeScript = (input: RunInput) => AgentEvent[];

/** Deterministic default: acknowledges the task in a few text chunks, then finishes. */
export const echoScript: FakeScript = (input) => {
  const reply = `${AGENT_ROLES[input.agent.role].name} for ${input.store.name}: on it — "${input.task}".`;
  return [
    ...reply.split(/(?<= )/).map((text): AgentEvent => ({ type: 'text_delta', text })),
    { type: 'done', sessionId: input.resume ?? `fake-${input.agent.id}`, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } },
  ];
};

/** Scripted engine for tests and demo mode. Costs nothing, never touches the network. */
export function fakeEngine(script: FakeScript = echoScript): Engine {
  return async function* (input) {
    for (const event of script(input)) {
      if (input.signal?.aborted) return;
      yield event;
    }
  };
}
