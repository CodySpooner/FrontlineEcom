import type { Agent, AgentEvent, Store } from '@frontline/shared';
import { agentModel, claudeEngine } from './claude-engine';
import { fakeEngine } from './fake-engine';
import type { ToolEnv } from './tools';

export interface RunInput {
  agent: Agent;
  store: Store;
  task: string;
  /** `sessionId` from an earlier run's `done` event: continues that chat. */
  resume?: string;
  /** Overrides the assembled prompt (`assemblePrompt`). */
  systemPrompt?: string;
  signal?: AbortSignal;
  /** App data access for the role's tools. Without it the agent only has its built-ins. */
  env?: ToolEnv;
  /** What is left of the store's daily AI budget (USD); engines that bill stop the run there. */
  budgetUsd?: number;
  /** What the resumed session already cost (USD). Engines report each query's own cost, so they subtract it from running totals. */
  sessionCostUsd?: number;
  /** Told, as the run goes, what this query has spent so far (USD, estimated), so a run that never finishes still counts. */
  onSpend?: (usd: number) => void;
}

/** Streams one agent run. Engines may throw or stop early; `runAgent` normalizes that. */
export type Engine = (input: RunInput) => AsyncIterable<AgentEvent>;

/**
 * Connected stores run on the owner's Claude Code login; demo stores on the free fake engine, so exploring the demo
 * never spends Claude usage. `FRONTLINE_AGENT_ENGINE=claude|fake` forces one for every store (tests default to fake).
 */
export function defaultEngine(claude: Engine = claudeEngine(), fake: Engine = fakeEngine()): Engine {
  const forced = forcedEngine();
  if (forced) return forced === 'claude' ? claude : fake;
  return (input) => (input.store.connected ? claude : fake)(input);
}

const forcedEngine = () => process.env.FRONTLINE_AGENT_ENGINE ?? (process.env.VITEST ? 'fake' : undefined); // a test run outside the root config never reaches Claude

/** What `defaultEngine` runs a store's agents on, for the API: Claude with its model, or the demo engine. */
export const engineInfo = (connected: boolean): NonNullable<Agent['engine']> =>
  (forcedEngine() ? forcedEngine() === 'claude' : connected) ? { provider: 'claude', model: agentModel() } : { provider: 'demo' };

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
