import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { AGENT_ROLES, type AgentEvent, type AgentRole, type AgentRun, type AgentRunDetail, type RunStatus, type RunUsage, type Store } from '@frontline/shared';
import { defaultEngine, runAgent, type Engine, type RunInput } from './engine';
import { once, parseLearnings, REFLECTION_PROMPT, searchMemory, writeMemory } from './memory';
import { listNicheLearnings, nicheKey } from './niche';
import { assemblePrompt } from './prompt';
import { getAgent } from './squads';
import { OUTLIVE_RUN, type ToolEnv } from './tools';

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
  const active = new Map<string, { storeId: string; agentId: string; abort: AbortController; done: Promise<void>; transcript: AgentEvent[]; waiting?: boolean; budget?: number; spent?: number }>();
  /** Runs paused on the owner's decision don't hold a slot, so one unanswered request can't stall the store's other work. */
  // ponytail: a resumed run can briefly push past the limits; they only gate starting runs.
  const working = () => [...active.values()].filter((a) => !a.waiting);

  /**
   * A run that ended without finishing can't act on its pending requests any more, so they're closed as denied with a
   * note. Kinds the server carries out on approval (OUTLIVE_RUN) stay open: approving them later still works.
   */
  function expireApprovals(runIds: string[]) {
    if (!env.decide || !runIds.length) return;
    const rows = db
      .prepare(
        `SELECT id FROM approvals WHERE status = 'pending' AND run_id IN (${runIds.map(() => '?').join(',')})
         AND json_extract(action_json, '$.kind') NOT IN (${OUTLIVE_RUN.map(() => '?').join(',')})`,
      )
      .all(...runIds, ...OUTLIVE_RUN);
    for (const r of rows) {
      db.prepare('UPDATE approvals SET reason = reason || ? WHERE id = ?').run(' [Expired: the agent run ended before a decision.]', String(r.id));
      env.decide(String(r.id), 'deny');
    }
  }

  // In-flight runs die with the process; say so instead of leaving them "running" forever.
  const interrupted = db.prepare(`SELECT id, agent_id, task, resume, parent_run_id, created_at FROM agent_runs WHERE status IN ('queued', 'running')`).all();
  db.prepare(`UPDATE agent_runs SET status = 'error', error = 'Interrupted by an app restart', ended_at = ? WHERE status IN ('queued', 'running')`).run(
    new Date().toISOString(),
  );
  expireApprovals(interrupted.map((r) => String(r.id)));
  trimOldTranscripts(db);

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
    if (agent.dailyBudgetUsd !== undefined && costToday(db, agent.storeId, agentId) >= agent.dailyBudgetUsd) return ownUsedUp(agent.dailyBudgetUsd);
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

  /** Stops every run of a store that is being deleted, so none waits forever on requests that go with it. */
  function cancelStore(storeId: string) {
    db.prepare(`UPDATE agent_runs SET status = 'cancelled', ended_at = ? WHERE store_id = ? AND status = 'queued'`).run(new Date().toISOString(), storeId);
    for (const a of active.values()) if (a.storeId === storeId) a.abort.abort();
  }

  /** Stops an agent's queued and running work when the owner takes it offline. */
  const cancelAgent = (agentId: string) => {
    for (const r of db.prepare(`SELECT id FROM agent_runs WHERE agent_id = ? AND status IN ('queued', 'running')`).all(agentId)) cancel(String(r.id));
  };

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

  /**
   * What a starting run may spend: what is left of the store's daily AI budget (runs in flight count what they spent so
   * far) after the unspent shares its other runs hold, and at most a perStore-th of the cap, so the store's runs can still
   * go side by side and never add up past it.
   */
  // ponytail: like slots, a run paused on the owner holds no share, so an unanswered request can't stall the store; the
  // cap itself still holds, since a run stops as soon as the store's spend today passes it (spend in execute).
  function budgetFor(storeId: string) {
    const cap = env.caps?.(storeId).agentCostPerDay;
    if (cap === undefined) return undefined;
    const held = working().reduce((n, a) => n + (a.storeId === storeId ? Math.max(0, (a.budget ?? 0) - (a.spent ?? 0)) : 0), 0);
    return Math.max(0, Math.min(cap / perStore, cap - costToday(db, storeId) - held));
  }

  function pump() {
    const queued = db.prepare(`SELECT * FROM agent_runs WHERE status = 'queued' ORDER BY created_at, rowid`).all().map(toRun);
    for (const run of queued) {
      if (working().length >= concurrency) return;
      if ([...active.values()].some((a) => a.agentId === run.agentId) || working().filter((a) => a.storeId === run.storeId).length >= perStore) continue;
      const share = budgetFor(run.storeId);
      if (share !== undefined && share < 0.01 && working().some((a) => a.storeId === run.storeId)) continue; // waits for a share to free up
      // One run per agent at a time, so its own cap needs no shares: what is left of it today.
      const own = getAgent(db, run.agentId)?.dailyBudgetUsd;
      const budget = own === undefined ? share : Math.min(share ?? Infinity, Math.max(0, own - costToday(db, run.storeId, run.agentId)));
      const abort = new AbortController();
      const transcript: AgentEvent[] = [];
      const done = execute(run, abort, transcript, budget)
        .catch((e) => console.error(`Run ${run.id} failed to finish:`, e))
        .finally(() => {
          active.delete(run.id);
          pump();
        });
      active.set(run.id, { storeId: run.storeId, agentId: run.agentId, abort, done, transcript, ...(budget !== undefined ? { budget } : {}) });
    }
  }

  async function execute(queued: AgentRun, abort: AbortController, transcript: AgentEvent[], budget: number | undefined) {
    const signal = abort.signal;
    db.prepare(`UPDATE agent_runs SET status = 'running', started_at = ? WHERE id = ?`).run(new Date().toISOString(), queued.id);
    const run = getRun(db, queued.id)!;
    opts.onRun?.(run);
    const emit = (full: AgentEvent) => {
      // The agent saw the whole tool output; the stored transcript and the live feed keep the first 4,000 characters.
      const event = full.type === 'tool_result' && full.output.length > SHOWN ? { ...full, output: `${full.output.slice(0, SHOWN)}\n… (${full.output.length - SHOWN} more characters)` } : full;
      const slot = active.get(run.id);
      const waiting = event.type === 'approval_request' && event.approval.status === 'pending';
      if (slot && !!slot.waiting !== waiting) {
        slot.waiting = waiting;
        if (waiting) pump();
      }
      const last = transcript.at(-1);
      if (event.type === 'text_delta' && last?.type === 'text_delta') transcript[transcript.length - 1] = { type: 'text_delta', text: last.text + event.text };
      else transcript.push(event);
      opts.onEvent?.(run, event);
    };

    // What the run has spent so far, saved as it goes: a cancel, crash or restart (no result from the engine) still counts it.
    let ended = false;
    let spent = 0;
    const cap = env.caps?.(run.storeId).agentCostPerDay;
    const own = getAgent(db, run.agentId)?.dailyBudgetUsd;
    let overCap = false;
    let overOwn = false;
    const spend = (usd: number) => {
      if (ended) return;
      spent = Math.max(spent, usd); // the reflection reports from the engine's figure, which can be under the estimate
      const slot = active.get(run.id);
      if (slot) slot.spent = spent;
      db.prepare('UPDATE agent_runs SET cost_usd = ? WHERE id = ?').run(spent, run.id);
      // Shares split the cap; this holds it however many runs paused on the owner come back at once.
      if (cap !== undefined && !overCap && costToday(db, run.storeId) > cap) {
        overCap = true;
        abort.abort();
      }
      if (own !== undefined && !overCap && costToday(db, run.storeId, run.agentId) > own) {
        overCap = overOwn = true;
        abort.abort();
      }
    };
    let end: AgentEvent = { type: 'error', message: 'Agent or store not found' };
    try {
      const agent = getAgent(db, run.agentId);
      const store = opts.store(run.storeId);
      if (budget !== undefined && budget < 0.01) {
        const ownGone = own !== undefined && costToday(db, run.storeId, run.agentId) >= own - 0.01;
        end = { type: 'error', message: ownGone ? ownUsedUp(own) : `Today's AI budget for this store ($${env.caps?.(run.storeId).agentCostPerDay}) is used up. Raise it in Settings.` };
      }
      else if (agent && store) {
        const resume = db.prepare('SELECT resume FROM agent_runs WHERE id = ?').get(run.id)?.resume;
        const input: RunInput = {
          agent,
          store,
          task: run.task,
          systemPrompt: assemblePrompt({ agent, store, memories: searchMemory(db, store.id, run.task, 12), nicheLearnings: listNicheLearnings(db, nicheKey(store), 20), waiting: waitingFor(store.id), scheduled: scheduledFor(store.id) }),
          signal,
          env: { ...env, runId: run.id },
          ...(resume ? { resume: String(resume), sessionCostUsd: sessionCost(String(resume)) } : {}),
          ...(budget !== undefined ? { budgetUsd: budget } : {}),
          onSpend: spend,
        };
        let toolCalls = 0;
        let attempt = input;
        for (; ; attempt = recapped(attempt)) {
          for await (const event of runAgent(attempt, engine)) {
            if (event.type === 'done' || event.type === 'error') end = event;
            else {
              if (event.type === 'tool_call') toolCalls++;
              emit(event);
            }
          }
          // Claude Code keeps sessions 30 days, per folder: a follow-up whose session is gone goes on from a recap.
          if (end.type !== 'error' || !attempt.resume || !end.message.startsWith('No conversation found')) break;
        }
        // ponytail: only runs that looked at data (tool calls) reflect; a chat reply rarely teaches anything durable.
        if (end.type === 'done' && toolCalls > 0 && !signal.aborted) end = await reflect(attempt, end, emit);
      }
    } catch (err) {
      end = { type: 'error', message: err instanceof Error ? err.message : String(err) };
    }
    if (overCap && end.type === 'error') end = { type: 'error', message: overOwn ? ownUsedUp(own!, true) : `Stopped: today's AI budget for this store ($${cap}) is used up. Raise it in Settings.` };
    emit(end);

    const status: RunStatus = end.type === 'done' ? 'done' : signal.aborted && !overCap ? 'cancelled' : 'error';
    ended = true;
    const reported = end.type === 'done' ? end.usage : (end.type === 'error' && end.usage) || { inputTokens: 0, outputTokens: 0, costUsd: 0 };
    // The engine's figure, unless the live estimate is higher: crash results can carry zeros, a cut-off reflection reports none.
    const usage = { ...reported, costUsd: Math.max(reported.costUsd, spent) };
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
    if (status !== 'done') expireApprovals([run.id]);
    const final = getRun(db, run.id); // gone when its store was deleted meanwhile
    if (final) opts.onRun?.(final);
  }

  /** What a session has cost so far: every run that continued it. */
  const sessionCost = (sessionId: string) => Number(db.prepare('SELECT coalesce(sum(cost_usd), 0) AS n FROM agent_runs WHERE session_id = ?').get(sessionId)?.n ?? 0);

  /** The store's open requests, newest first: "<title> (<agent>, <date>)". */
  function scheduledFor(storeId: string) {
    return db.prepare('SELECT name, trigger_json, action_json FROM automation_rules WHERE store_id = ? AND enabled = 1 ORDER BY name').all(storeId).flatMap((r) => {
      const t = JSON.parse(String(r.trigger_json)) as { type?: string; cron?: string };
      const a = JSON.parse(String(r.action_json)) as { type?: string; agentId?: string };
      const role = AGENT_ROLES[String(a.agentId).split(':')[1] as AgentRole];
      return t.type === 'schedule' && a.type === 'agent_task' && role ? [`${r.name} (${role.name}, cron ${t.cron})`] : [];
    });
  }

  function waitingFor(storeId: string) {
    return db
      .prepare(`SELECT title, agent_id, created_at FROM approvals WHERE store_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 15`)
      .all(storeId)
      .map((r) => `${r.title} (${AGENT_ROLES[String(r.agent_id).split(':')[1] as AgentRole]?.name ?? 'owner'}, ${String(r.created_at).slice(0, 10)})`);
  }

  /** A fresh session for a follow-up whose session is gone, with the last exchange as context. */
  function recapped({ resume, sessionCostUsd: _, ...input }: RunInput): RunInput {
    const prev = db.prepare('SELECT task, transcript_json FROM agent_runs WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(resume!);
    if (!prev) return input;
    // ponytail: only the last exchange; walk the `resume` chain if longer chats need more.
    const said = (JSON.parse(String(prev.transcript_json ?? '[]')) as AgentEvent[]).flatMap((e) => (e.type === 'text_delta' ? [e.text] : [])).join('\n').slice(-3000);
    return { ...input, task: `Earlier in this chat (its full history has expired) you were asked: ${prev.task}\nYou answered: ${said}\n\nNow: ${input.task}` };
  }

  /** Asks the agent, in the same session, what it learned, and saves that as store memory. Never fails the run. */
  async function reflect(input: RunInput, done: Extract<AgentEvent, { type: 'done' }>, emit: (e: AgentEvent) => void) {
    let reply = '';
    let usage = done.usage;
    // The reflection spends from what the run left of today's budget; nothing left, no reflection.
    const left = input.budgetUsd === undefined ? undefined : input.budgetUsd - done.usage.costUsd;
    if (left !== undefined && left <= 0) return done;
    const sessionCostUsd = (input.sessionCostUsd ?? 0) + done.usage.costUsd;
    const onSpend = (usd: number) => input.onSpend?.(done.usage.costUsd + usd);
    for await (const event of runAgent({ ...input, task: REFLECTION_PROMPT, resume: done.sessionId, sessionCostUsd, onSpend, ...(left !== undefined ? { budgetUsd: left } : {}) }, engine)) {
      if (event.type === 'text_delta') reply += event.text;
      if ((event.type === 'done' || event.type === 'error') && event.usage) usage = addUsage(usage, event.usage);
    }
    for (const learning of parseLearnings(reply)) {
      const runId = input.env?.runId;
      emit({ type: 'memory_written', memory: writeMemory(db, { ...learning, storeId: input.store.id, agentId: input.agent.id, ...(runId ? { runId } : {}) }) });
    }
    return { ...done, usage };
  }

  // ...and the ones from the last 6 hours run again: closing the app at 8:01 shouldn't cost the day's briefing (the
  // scheduler counts it as fired). Chat follow-ups are left for the owner to resend; a retry is never retried.
  for (const r of interrupted) {
    if (r.resume || Date.now() - Date.parse(String(r.created_at)) > 6 * 3_600_000 || !once(db, `retried:${r.id}`)) continue;
    const again = start(String(r.agent_id), String(r.task), undefined, r.parent_run_id ? String(r.parent_run_id) : undefined);
    if (typeof again !== 'string') once(db, `retried:${again.id}`);
  }

  return { start, cancel, cancelStore, cancelAgent, get, idle };
}

const SHOWN = 4000;

/**
 * Runs older than 90 days keep their text and tool calls, but each tool output shrinks to its first 200 characters:
 * a store's runs would otherwise add ~50 MB a year to the database and to each of its 7 daily backups.
 */
// ponytail: runs at startup only; the app restarts often enough (updates, reboots). A daily timer if it ever doesn't.
function trimOldTranscripts(db: DatabaseSync, now = new Date()) {
  const cutoff = new Date(now.getTime() - 90 * 86_400_000).toISOString();
  for (const r of db.prepare('SELECT id, transcript_json FROM agent_runs WHERE created_at < ? AND length(transcript_json) > 8000').all(cutoff)) {
    const before = String(r.transcript_json);
    const after = JSON.stringify(
      (JSON.parse(before) as AgentEvent[]).map((e) => (e.type === 'tool_result' && e.output.length > 300 ? { ...e, output: `${e.output.slice(0, 200)}\n… (trimmed after 90 days)` } : e)),
    );
    if (after !== before) db.prepare('UPDATE agent_runs SET transcript_json = ? WHERE id = ?').run(after, String(r.id));
  }
}

const addUsage = (a: RunUsage, b: RunUsage): RunUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  costUsd: a.costUsd + b.costUsd,
});

/** USD the store's agents spent since local midnight. */
/** What the store's runs (or one agent's) cost since local midnight. */
export function costToday(db: DatabaseSync, storeId: string, agentId?: string): number {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const row = db
    .prepare(`SELECT coalesce(sum(cost_usd), 0) AS cost FROM agent_runs WHERE store_id = ? AND created_at >= ? ${agentId ? 'AND agent_id = ?' : ''}`)
    .get(storeId, midnight.toISOString(), ...(agentId ? [agentId] : []));
  return Number(row?.cost ?? 0);
}

const ownUsedUp = (usd: number, stopped = false) => `${stopped ? "Stopped: today's" : "Today's"} budget for this agent ($${usd}) is used up. Raise it in its settings.`;

/**
 * One line for the activity feed: the first sentence of the agent's final answer (the text after its last tool step),
 * skipping headings and list markers. Undefined when the run ended without a final answer.
 */
export function runGist(transcript: AgentEvent[], max = 160): string | undefined {
  const lastTool = transcript.findLastIndex((e) => e.type === 'tool_call' || e.type === 'tool_result');
  const text = transcript.slice(lastTool + 1).map((e) => (e.type === 'text_delta' ? e.text : '')).join('');
  const line = text
    .split('\n')
    .map((l) => l.replace(/[*_`]/g, '').replace(/^\s*(?:[-•>]|\d+\.)\s+/, '').trim())
    .find((l) => l && !l.startsWith('#') && !/^[-=|: ]+$/.test(l));
  if (!line) return undefined;
  const sentence = line.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? line;
  return sentence.length <= max ? sentence : `${sentence.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
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
