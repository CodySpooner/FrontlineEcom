import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { AgentEvent, AgentRun, AgentRunDetail, RunStatus, RunUsage, Store } from '@frontline/shared';
import { defaultEngine, runAgent, type Engine, type RunInput } from './engine';
import { parseLearnings, REFLECTION_PROMPT, searchMemory, writeMemory } from './memory';
import { assemblePrompt } from './prompt';
import { getAgent } from './squads';
import type { ToolEnv } from './tools';

// Runs live in `agent_runs` (agents-lane migration in apps/server/src/db.ts). The queue is the table itself.

export interface RunManagerOptions {
  db: DatabaseSync;
  env: ToolEnv;
  store: (id: string) => Store | undefined;
  engine?: Engine;
  /** Runs at once across all stores. */
  concurrency?: number;
  /** Runs at once per store. One agent never runs twice at once. */
  perStore?: number;
  /** Queued, started, finished. */
  onRun?: (run: AgentRun) => void;
  onEvent?: (run: AgentRun, event: AgentEvent) => void;
}

export type RunManager = ReturnType<typeof createRunManager>;

export function createRunManager(opts: RunManagerOptions) {
  const { db, env, concurrency = 3, perStore = 2 } = opts;
  const engine = opts.engine ?? defaultEngine();
  const active = new Map<string, { storeId: string; agentId: string; abort: AbortController; done: Promise<void>; transcript: AgentEvent[] }>();

  // In-flight runs die with the process; say so instead of leaving them "running" forever.
  db.prepare(`UPDATE agent_runs SET status = 'error', error = 'Interrupted by an app restart', ended_at = ? WHERE status IN ('queued', 'running')`).run(
    new Date().toISOString(),
  );

  /** Queues a task. Returns an error message when the agent can't take it. */
  function start(agentId: string, task: string, resumeRunId?: string, parentRunId?: string): AgentRun | string {
    const agent = getAgent(db, agentId);
    if (!agent) return 'Agent not found';
    if (!agent.enabled) return 'This agent is offline. Redeploy it first.';
    let resume: string | undefined;
    if (resumeRunId) {
      const prev = getRun(db, resumeRunId);
      if (prev?.agentId !== agentId || !prev.sessionId) return 'That conversation cannot be continued';
      resume = prev.sessionId;
    }
    const cap = env.caps?.(agent.storeId).agentCostPerDay;
    if (cap !== undefined && costToday(db, agent.storeId) >= cap) return `Today's AI budget for this store ($${cap}) is used up. Raise it in Settings.`;
    const id = randomUUID();
    db.prepare('INSERT INTO agent_runs (id, store_id, agent_id, task, resume, parent_run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      id, agent.storeId, agentId, task, resume ?? null, parentRunId ?? null, new Date().toISOString(),
    );
    const run = getRun(db, id)!;
    opts.onRun?.(run);
    pump();
    return run;
  }

  /** Cancels a queued or running run. */
  function cancel(id: string): AgentRun | undefined {
    const run = getRun(db, id);
    if (run?.status === 'queued') {
      db.prepare(`UPDATE agent_runs SET status = 'cancelled', ended_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
      opts.onRun?.(getRun(db, id)!);
    }
    active.get(id)?.abort.abort(); // the run flips to 'cancelled' once the engine stops
    return run && getRun(db, id);
  }

  /** The run with its transcript so far while it is still running. */
  function get(id: string): AgentRunDetail | undefined {
    const run = getRun(db, id);
    const live = active.get(id)?.transcript;
    return run && (live ? { ...run, transcript: [...live] } : run);
  }

  /** Resolves once nothing is running or queued (tests, shutdown). */
  async function idle() {
    while (active.size) await Promise.all([...active.values()].map((a) => a.done));
  }

  function pump() {
    const queued = db.prepare(`SELECT * FROM agent_runs WHERE status = 'queued' ORDER BY created_at, rowid`).all().map(toRun);
    for (const run of queued) {
      if (active.size >= concurrency) return;
      const busy = [...active.values()];
      if (busy.some((a) => a.agentId === run.agentId) || busy.filter((a) => a.storeId === run.storeId).length >= perStore) continue;
      const abort = new AbortController();
      const transcript: AgentEvent[] = [];
      const done = execute(run, abort.signal, transcript).finally(() => {
        active.delete(run.id);
        pump();
      });
      active.set(run.id, { storeId: run.storeId, agentId: run.agentId, abort, done, transcript });
    }
  }

  async function execute(queued: AgentRun, signal: AbortSignal, transcript: AgentEvent[]) {
    db.prepare(`UPDATE agent_runs SET status = 'running', started_at = ? WHERE id = ?`).run(new Date().toISOString(), queued.id);
    const run = getRun(db, queued.id)!;
    opts.onRun?.(run);
    const emit = (event: AgentEvent) => {
      const last = transcript.at(-1);
      if (event.type === 'text_delta' && last?.type === 'text_delta') transcript[transcript.length - 1] = { type: 'text_delta', text: last.text + event.text };
      else transcript.push(event);
      opts.onEvent?.(run, event);
    };

    let end: AgentEvent = { type: 'error', message: 'Agent or store not found' };
    try {
      const agent = getAgent(db, run.agentId);
      const store = opts.store(run.storeId);
      if (agent && store) {
        const resume = db.prepare('SELECT resume FROM agent_runs WHERE id = ?').get(run.id)?.resume;
        const input: RunInput = {
          agent,
          store,
          task: run.task,
          systemPrompt: assemblePrompt({ agent, store, memories: searchMemory(db, store.id, run.task, 12) }),
          signal,
          env: { ...env, runId: run.id },
          ...(resume ? { resume: String(resume) } : {}),
        };
        let toolCalls = 0;
        for await (const event of runAgent(input, engine)) {
          if (event.type === 'done' || event.type === 'error') end = event;
          else {
            if (event.type === 'tool_call') toolCalls++;
            emit(event);
          }
        }
        // ponytail: only runs that looked at data (tool calls) reflect; a chat reply rarely teaches anything durable.
        if (end.type === 'done' && toolCalls > 0 && !signal.aborted) end = await reflect(input, end, emit);
      }
    } catch (err) {
      end = { type: 'error', message: err instanceof Error ? err.message : String(err) };
    }
    emit(end);

    const status: RunStatus = end.type === 'done' ? 'done' : signal.aborted ? 'cancelled' : 'error';
    const usage = end.type === 'done' ? end.usage : { inputTokens: 0, outputTokens: 0, costUsd: 0 };
    db.prepare(
      `UPDATE agent_runs SET status = ?, session_id = ?, input_tokens = ?, output_tokens = ?, cost_usd = ?, error = ?, transcript_json = ?, ended_at = ?
       WHERE id = ?`,
    ).run(
      status,
      end.type === 'done' ? end.sessionId : null,
      usage.inputTokens,
      usage.outputTokens,
      usage.costUsd,
      end.type === 'error' ? end.message : null,
      JSON.stringify(transcript),
      new Date().toISOString(),
      run.id,
    );
    opts.onRun?.(getRun(db, run.id)!);
  }

  /** Asks the agent, in the same session, what it learned, and saves that as store memory. Never fails the run. */
  async function reflect(input: RunInput, done: Extract<AgentEvent, { type: 'done' }>, emit: (e: AgentEvent) => void) {
    let reply = '';
    let usage = done.usage;
    for await (const event of runAgent({ ...input, task: REFLECTION_PROMPT, resume: done.sessionId }, engine)) {
      if (event.type === 'text_delta') reply += event.text;
      if (event.type === 'done') usage = addUsage(usage, event.usage);
    }
    for (const learning of parseLearnings(reply)) {
      emit({ type: 'memory_written', memory: writeMemory(db, { ...learning, storeId: input.store.id, agentId: input.agent.id }) });
    }
    return { ...done, usage };
  }

  return { start, cancel, get, idle };
}

const addUsage = (a: RunUsage, b: RunUsage): RunUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  costUsd: a.costUsd + b.costUsd,
});

/** USD the store's agents spent since local midnight. */
export function costToday(db: DatabaseSync, storeId: string): number {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const row = db.prepare('SELECT coalesce(sum(cost_usd), 0) AS cost FROM agent_runs WHERE store_id = ? AND created_at >= ?').get(storeId, midnight.toISOString());
  return Number(row?.cost ?? 0);
}

export function getRun(db: DatabaseSync, id: string): AgentRunDetail | undefined {
  const r = db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(id);
  return r && { ...toRun(r), transcript: JSON.parse(String(r.transcript_json)) };
}

/** Newest first. */
export function listRuns(db: DatabaseSync, q: { agentId?: string; storeIds?: string[]; limit?: number } = {}): AgentRun[] {
  const where: string[] = [];
  const args: string[] = [];
  if (q.agentId) where.push('agent_id = ?'), args.push(q.agentId);
  if (q.storeIds?.length) where.push(`store_id IN (${q.storeIds.map(() => '?').join(',')})`), args.push(...q.storeIds);
  return db
    .prepare(`SELECT * FROM agent_runs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC, rowid DESC LIMIT ?`)
    .all(...args, q.limit ?? 50)
    .map(toRun);
}

function toRun(r: Record<string, unknown>): AgentRun {
  const opt = (k: string) => (r[k] == null ? undefined : String(r[k]));
  const [sessionId, error, startedAt, endedAt, parentRunId] = ['session_id', 'error', 'started_at', 'ended_at', 'parent_run_id'].map(opt);
  return {
    id: String(r.id),
    storeId: String(r.store_id),
    agentId: String(r.agent_id),
    task: String(r.task),
    status: r.status as RunStatus,
    ...(sessionId ? { sessionId } : {}),
    usage: { inputTokens: Number(r.input_tokens), outputTokens: Number(r.output_tokens), costUsd: Number(r.cost_usd) },
    ...(error ? { error } : {}),
    createdAt: String(r.created_at),
    ...(startedAt ? { startedAt } : {}),
    ...(endedAt ? { endedAt } : {}),
    ...(parentRunId ? { parentRunId } : {}),
  };
}
