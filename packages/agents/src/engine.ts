import { AGENT_ROLES, type Agent, type AgentEvent, type Store } from '@frontline/shared';
import { claudeEngine } from './claude-engine';
import { fakeEngine } from './fake-engine';
import { ROLES, SQUAD_RULES } from './roles';

export interface RunInput {
  agent: Agent;
  store: Store;
  task: string;
  /** `sessionId` from an earlier run's `done` event: continues that chat. */
  resume?: string;
  /** Assembled system prompt (role + playbook + packs + memory). */
  systemPrompt?: string;
  signal?: AbortSignal;
}

/** Streams one agent run. Engines may throw or stop early; `runAgent` normalizes that. */
export type Engine = (input: RunInput) => AsyncIterable<AgentEvent>;

/** `FRONTLINE_AGENT_ENGINE=claude` uses the owner's Claude Code login; anything else is the free fake engine. */
export function defaultEngine(): Engine {
  return process.env.FRONTLINE_AGENT_ENGINE === 'claude' ? claudeEngine() : fakeEngine();
}

export function basicSystemPrompt({ agent, store }: Pick<RunInput, 'agent' | 'store'>): string {
  const role = ROLES[agent.role];
  return [
    `You are the ${AGENT_ROLES[agent.role].name} of ${store.name}, a ${store.niche} store on ${store.platform}.`,
    role.prompt,
    `You are measured on ${role.kpi}.`,
    SQUAD_RULES,
  ].join('\n\n');
}

/** Runs an agent and guarantees the stream ends with exactly one `done` or `error` event. */
export async function* runAgent(input: RunInput, engine: Engine = defaultEngine()): AsyncGenerator<AgentEvent> {
  try {
    for await (const event of engine(input)) {
      yield event;
      if (event.type === 'done' || event.type === 'error') return;
    }
    yield { type: 'error', message: input.signal?.aborted ? 'Cancelled' : 'Run ended without a result' };
  } catch (err) {
    yield { type: 'error', message: input.signal?.aborted ? 'Cancelled' : err instanceof Error ? err.message : String(err) };
  }
}
