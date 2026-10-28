import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { AGENT_ROLES, gist, hasEffects, INTERRUPTED, type AgentEvent, type AgentRole, type AgentRun, type AgentRunDetail, type RunAttachment, type RunStatus, type RunUsage, type RuntimeId, type Store } from '@frontline/shared';
import { customRole, getConfig } from './configs';
import { conversationPreface, conversationQuery } from './conversations';
import { defaultEngine, runAgent, type Engine, type RunInput } from './engine';
import { researchContext } from './kb-research';
import { citedCards, inScope, logKnowledgeUse, retrieveKnowledge, withConflicts } from './kb-retrieve';
import { untrustedBlock } from './kb-sources';
import { once, parseLearnings, REFLECTION_PROMPT, searchMemory, writeMemory } from './memory';
import { listNicheLearnings, nicheKey } from './niche';
import { assemblePrompt } from './prompt';
import { costToday, getAgent } from './squads';
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
  /** `seq`: the event's number in the run, for the live feed (AgentRunDetail.seq). */
  onEvent?: (run: AgentRun, event: AgentEvent, seq: number) => void;
  /** A run that failed to finish (its row or the hooks above threw); the console when unset. */
  onError?: (run: AgentRun, error: unknown) => void;
}

export type RunManager = ReturnType<typeof createRunManager>;


export function createRunManager(opts: RunManagerOptions) {
  const { db, env, concurrency = 3, perStore = 2 } = opts;
  const engine = opts.engine ?? defaultEngine();
  const active = new Map<string, { storeId: string; agentId: string; conversationId?: string; teamId?: string; abort: AbortController; done: Promise<void>; transcript: AgentEvent[]; seq: number; waiting?: boolean; budget?: number; spent?: number }>();
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
  const interrupted = db.prepare(`SELECT id, agent_id, task, resume, parent_run_id, mode, conversation_id, team_id, created_at FROM agent_runs WHERE status IN ('queued', 'running')`).all();
  db.prepare(`UPDATE agent_runs SET status = 'error', error = ?, ended_at = ? WHERE status IN ('queued', 'running')`).run(INTERRUPTED, new Date().toISOString());
  expireApprovals(interrupted.map((r) => String(r.id)));
  trimOldTranscripts(db);

  /**
   * Queues a task. Returns an error message when the agent can't take it. `mode` 'research:<task id>' makes it a stage of a
   * knowledge-base research task (kb-research.ts). A conversation's turn runs on its config and goes on from its session
   * when it starts (resumeFor). A repeated `clientRequestId` returns the run it started.
   */
  function start(agentId: string, task: string, resumeRunId?: string, parentRunId?: string, { retryOf, mode, conversationId, teamId, configId, clientRequestId, attachments }: StartOptions = {}): AgentRun | string {
    const agent = getAgent(db, agentId);
    if (!agent) return 'Agent not found';
    if (clientRequestId && (conversationId || teamId)) {
      const same = db.prepare(`SELECT id FROM agent_runs WHERE ${conversationId ? 'conversation_id' : 'team_id'} = ? AND client_request_id = ?`).get(conversationId ?? teamId!, clientRequestId);
      if (same) return getRun(db, String(same.id))!;
    }
    if (!agent.enabled) return OFFLINE;
    const conversation = conversationId ? db.prepare('SELECT c.config_id, f.agent_id FROM conversations c JOIN agent_configs f ON f.id = c.config_id WHERE c.id = ?').get(conversationId) : undefined;
    if (conversationId && conversation?.agent_id !== agentId) return 'Conversation not found';
    const config = conversation ? String(conversation.config_id) : configId;
    // A session holds what the tools said then: on a store since gone live, the demo numbers, read as the store's.
    const live = db.prepare('SELECT at FROM done_once WHERE ref = ?').get(`activate:${agent.storeId}`)?.at;
    // A new config ("Change runtime or model…") starts a new session from a recap that leaves those runs out.
    if (live && conversationId && db.prepare('SELECT 1 FROM agent_runs WHERE conversation_id = ? AND config_id IS ? AND created_at < ?').get(conversationId, config ?? null, String(live))) return DEMO_SESSION;
    let resume: string | undefined;
    if (resumeRunId) {
      const prev = getRun(db, resumeRunId);
      if (prev?.agentId !== agentId || !prev.sessionId) return 'That conversation cannot be continued';
      if (live && prev.createdAt < String(live)) return DEMO_SESSION;
      resume = prev.sessionId;
    }
    if (conversationId && retryOf) {
      // Resume goes on in the interrupted turn's session. Retry goes on from the last turn that finished before the one it
      // retries, so the session never holds the message twice (none: a fresh session).
      const prev = getRun(db, retryOf);
      resume = prev?.error === INTERRUPTED
        ? prev.sessionId
        : (db.prepare(`SELECT session_id FROM agent_runs WHERE conversation_id = ? AND config_id IS ? AND status = 'done' AND session_id IS NOT NULL AND rowid < (SELECT rowid FROM agent_runs WHERE id = ?) ORDER BY rowid DESC`).get(conversationId, config ?? null, retryOf)?.session_id as string | undefined);
    }
    // Under a cent left is used up, as the queue counts it (execute): a run taken here and turned down there would come
    // back as a mission step and be turned down again, forever.
    const cap = env.caps?.(agent.storeId).agentCostPerDay;
    if (cap !== undefined && Math.min(cap / perStore, cap - costToday(db, agent.storeId)) < 0.01) return `Today's AI budget for this store ($${cap}) is used up. Raise it in Settings.`;
    if (agent.dailyBudgetUsd !== undefined && agent.dailyBudgetUsd - costToday(db, agent.storeId, agentId) < 0.01) return ownUsedUp(agent.dailyBudgetUsd);
    const picked = config ? db.prepare('SELECT runtime, model, effort FROM agent_configs WHERE id = ?').get(config) : undefined;
    // A job that fires again while its last copy still waits in the queue (the agent is busy, e.g. on a request the owner
    // hasn't answered) doesn't stack another: the queued one does it.
    // Never a restart's retry (each is linked to the run it retries) or a mission's step (two missions with the same
    // first step would share one run, and calling one off would strand the other).
    // A conversation's turns and a team's steps each count, however alike.
    if (!resumeRunId && !parentRunId && !retryOf && !conversationId && !teamId) {
      const queued = db
        .prepare(
          `SELECT id FROM agent_runs WHERE agent_id = ? AND status = 'queued' AND task = ? AND resume IS NULL AND parent_run_id IS NULL AND id NOT IN (
             SELECT json_extract(s.value, '$.runId') FROM squad_missions m, json_each(iif(json_valid(m.steps_json), m.steps_json, '[]')) s
             WHERE m.ended_at IS NULL AND json_extract(s.value, '$.runId') IS NOT NULL)`,
        )
        .get(agentId, task);
      if (queued) return getRun(db, String(queued.id))!;
    }
    const id = randomUUID();
    // A retry or resume sends the same documents (decision 11).
    const attached = attachments ?? (retryOf ? getRun(db, retryOf)?.attachments : undefined);
    db.prepare(
      `INSERT INTO agent_runs (id, store_id, agent_id, task, resume, parent_run_id, mode, conversation_id, team_id, config_id, runtime, model, effort, client_request_id, attachments_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, agent.storeId, agentId, task, resume ?? null, parentRunId ?? null, mode ?? null, conversationId ?? null, teamId ?? null, config ?? null,
      ...(['runtime', 'model', 'effort'] as const).map((k) => (picked?.[k] ?? null) as string | null), clientRequestId ?? null, attached?.length ? JSON.stringify(attached) : null, new Date().toISOString(),
    );
    if (conversationId) db.prepare('UPDATE conversations SET last_activity_at = ? WHERE id = ?').run(new Date().toISOString(), conversationId);
    // A retry is linked before it can start: missions and assign_task follow `retry:<old>:<new>`.
    if (retryOf) once(db, `retried:${id}`) && once(db, `retry:${retryOf}:${id}`);
    const run = getRun(db, id)!;
    opts.onRun?.(run);
    pump();
    return run;
  }

  /** Cancels a queued or running run; `why` goes on one that never started. */
  function cancel(id: string, why?: string): AgentRun | undefined {
    const run = getRun(db, id);
    if (run?.status === 'queued') {
      db.prepare(`UPDATE agent_runs SET status = 'cancelled', error = ?, ended_at = ? WHERE id = ?`).run(why ?? null, new Date().toISOString(), id);
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
    for (const r of db.prepare(`SELECT id FROM agent_runs WHERE agent_id = ? AND status IN ('queued', 'running')`).all(agentId)) cancel(String(r.id), OFFLINE);
  };

  /** The run with its transcript so far while it is still running, and how many live events that holds. */
  function get(id: string): AgentRunDetail | undefined {
    const run = getRun(db, id);
    const live = active.get(id);
    return run && (live ? { ...run, transcript: [...live.transcript], seq: live.seq } : run.status === 'queued' ? { ...run, seq: 0 } : run);
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
      if (busy(run) || working().filter((a) => a.storeId === run.storeId).length >= perStore) continue;
      const share = budgetFor(run.storeId);
      if (share !== undefined && share < 0.01 && working().some((a) => a.storeId === run.storeId)) continue; // waits for a share to free up
      // The agent's own cap: what is left of it today, split with its runs going now (its conversations run side by side).
      // A config's budget for one run only narrows that, never widens it.
      const own = getAgent(db, run.agentId)?.dailyBudgetUsd;
      const seat = own === undefined ? undefined : Math.max(0, own - costToday(db, run.storeId, run.agentId)) / (working().filter((a) => a.agentId === run.agentId).length + 1);
      // A team's Claude step: what is left of the team budget, split with the team's Claude runs going now (decision 12).
      const team = run.teamId && run.runtime === 'claude' ? teamBudget(db, run.teamId) : undefined;
      const going = team === undefined ? 0 : Number(db.prepare(`SELECT count(*) AS n FROM agent_runs WHERE team_id = ? AND runtime = 'claude' AND status = 'running'`).get(run.teamId!)?.n);
      const teamShare = team === undefined ? undefined : Math.max(0, team - teamCost(db, run.teamId!)) / (going + 1);
      const caps = [share, seat, teamShare, run.configId && getConfig(db, run.configId)?.permissions.budgetUsd].filter((n) => typeof n === 'number');
      const budget = caps.length ? Math.min(...caps) : undefined;
      const abort = new AbortController();
      const transcript: AgentEvent[] = [];
      const done = execute(run, abort, transcript, budget)
        .catch((e) => (opts.onError ? opts.onError(run, e) : console.error(`Run ${run.id} failed to finish:`, e)))
        .finally(() => {
          active.delete(run.id);
          pump();
        });
      active.set(run.id, { storeId: run.storeId, agentId: run.agentId, ...(run.conversationId && { conversationId: run.conversationId }), ...(run.teamId && { teamId: run.teamId }), abort, done, transcript, seq: 0, ...(budget !== undefined ? { budget } : {}) });
    }
  }

  /**
   * One run per conversation, its waits on the owner included: a message sent meanwhile goes after the reply. Team steps
   * are bounded by their team (missions). Other runs keep one per agent, so a scheduled job doesn't overlap itself.
   */
  function busy(run: AgentRun) {
    if (run.conversationId) return [...active.values()].some((a) => a.conversationId === run.conversationId);
    return !run.teamId && [...active.values()].some((a) => a.agentId === run.agentId && !a.conversationId && !a.teamId);
  }

  /** A conversation's turn goes on in the session of its latest earlier turn on the same config (a runtime change starts a new one). */
  const resumeFor = (run: AgentRun) =>
    db.prepare(`SELECT session_id FROM agent_runs WHERE conversation_id = ? AND config_id IS ? AND session_id IS NOT NULL AND rowid < (SELECT rowid FROM agent_runs WHERE id = ?) ORDER BY rowid DESC`)
      .get(run.conversationId!, run.configId ?? null, run.id)?.session_id as string | undefined;

  async function execute(queued: AgentRun, abort: AbortController, transcript: AgentEvent[], budget: number | undefined) {
    const signal = abort.signal;
    db.prepare(`UPDATE agent_runs SET status = 'running', started_at = ? WHERE id = ?`).run(new Date().toISOString(), queued.id);
    const run = getRun(db, queued.id)!;
    opts.onRun?.(run);
    const config = run.configId ? getConfig(db, run.configId) : undefined;
    const { budgetUsd: runBudget, stopAfterMin } = config?.permissions ?? {};
    // Stop after N minutes of work: the clock stops while the run waits on the owner.
    let overTime = false;
    let left = stopAfterMin === undefined ? Infinity : stopAfterMin * 60_000;
    let since = 0;
    let deadline: NodeJS.Timeout | undefined;
    const clock = (on: boolean) => {
      if (left === Infinity) return;
      clearTimeout(deadline);
      if (!on) return void (left -= Date.now() - since);
      since = Date.now();
      deadline = setTimeout(() => ((overTime = true), abort.abort()), left);
    };
    clock(true);
    const emit = (full: AgentEvent) => {
      // The agent saw the whole tool output; the stored transcript and the live feed keep the first 4,000 characters.
      const event = full.type === 'tool_result' && full.output.length > SHOWN ? { ...full, output: `${full.output.slice(0, SHOWN)}\n… (${full.output.length - SHOWN} more characters)` } : full;
      const slot = active.get(run.id);
      const waiting = event.type === 'approval_request' && event.approval.status === 'pending';
      if (slot && !!slot.waiting !== waiting) {
        slot.waiting = waiting;
        clock(!waiting);
        if (waiting) pump();
      }
      const last = transcript.at(-1);
      if (event.type === 'text_delta' && last?.type === 'text_delta') transcript[transcript.length - 1] = { type: 'text_delta', text: last.text + event.text };
      else transcript.push(event);
      // Paused on the owner, a run can wait for days: what it did so far is kept, so a crash or restart meanwhile doesn't lose it.
      if (waiting) db.prepare('UPDATE agent_runs SET transcript_json = ? WHERE id = ?').run(JSON.stringify(transcript), run.id);
      const seq = slot ? ++slot.seq : 0;
      opts.onEvent?.(run, event, seq);
    };

    // What the run has spent so far, saved as it goes with its transcript: a cancel, crash or restart (no result from the
    // engine) still counts it, and shows what it did.
    let ended = false;
    let spent = 0;
    let cap = env.caps?.(run.storeId).agentCostPerDay;
    let own = getAgent(db, run.agentId)?.dailyBudgetUsd;
    let overCap = false;
    let overOwn = false;
    let overRun = false;
    let overTeam = false;
    // Codex and Demo steps aren't charged to a team budget (decision 12).
    const team = run.teamId && run.runtime === 'claude' ? teamBudget(db, run.teamId) : undefined;
    const spend = (usd: number) => {
      if (ended) return;
      spent = Math.max(spent, usd); // the reflection reports from the engine's figure, which can be under the estimate
      const slot = active.get(run.id);
      if (slot) slot.spent = spent;
      db.prepare('UPDATE agent_runs SET cost_usd = ?, transcript_json = ? WHERE id = ?').run(spent, JSON.stringify(transcript), run.id);
      cap = env.caps?.(run.storeId).agentCostPerDay; // read again: the owner may lower either mid-run
      own = getAgent(db, run.agentId)?.dailyBudgetUsd;
      // Shares split the cap; this holds it however many runs paused on the owner come back at once.
      if (cap !== undefined && !overCap && costToday(db, run.storeId) > cap) {
        overCap = true;
        abort.abort();
      }
      if (own !== undefined && !overCap && costToday(db, run.storeId, run.agentId) > own) {
        overCap = overOwn = true;
        abort.abort();
      }
      if (runBudget !== undefined && !overCap && spent > runBudget) {
        overCap = overRun = true;
        abort.abort();
      }
      if (team !== undefined && !overCap && teamCost(db, run.teamId!) > team) {
        overCap = overTeam = true;
        abort.abort();
      }
    };
    let end: AgentEvent = { type: 'error', message: 'Agent or store not found' };
    try {
      const agent = getAgent(db, run.agentId);
      const store = opts.store(run.storeId);
      // A research stage: its task's own prompt, and at most what the task has left.
      const research = agent && store && run.mode?.startsWith('research:') ? researchContext(db, run.mode.slice('research:'.length), agent, store, run.id) : undefined;
      if (research) budget = Math.min(budget ?? Infinity, research.left);
      if (research && research.left < 0.01) end = { type: 'error', message: "Stopped: the research task's budget is used up." };
      else if (budget !== undefined && budget < 0.01) {
        const ownGone = own !== undefined && costToday(db, run.storeId, run.agentId) >= own - 0.01;
        end = { type: 'error', message: ownGone ? ownUsedUp(own!) : `Today's AI budget for this store ($${env.caps?.(run.storeId).agentCostPerDay}) is used up. Raise it in Settings.` };
      }
      else if (agent && store) {
        // A Retry or Resume has its session set (start); none there means a fresh one.
        const resume = db.prepare('SELECT resume FROM agent_runs WHERE id = ?').get(run.id)?.resume ?? (run.conversationId && !retried(run.id) ? resumeFor(run) : undefined);
        // A research stage has its own prompt and searches the knowledge base itself. A conversation's turn searches by its
        // title, objective and message (decision 11).
        const query = run.conversationId ? conversationQuery(db, run.conversationId, run.task) : run.task;
        const knowledge = research ? [] : withConflicts(db, retrieveKnowledge(db, { ws: store.id, role: agent.role, query, limit: 8 }).filter(inScope(config?.knowledge)));
        const layers = {
          agent, store, memories: searchMemory(db, store.id, run.task, 12), nicheLearnings: listNicheLearnings(db, nicheKey(store), 20), waiting: waitingFor(store.id), scheduled: scheduledFor(store.id), knowledge,
          ...(config ? { tools: config.tools } : {}),
          ...(config?.customRoleId ? { customRole: customRole(db, config.customRoleId) } : {}),
        };
        const systemPrompt = research?.systemPrompt ?? assemblePrompt(layers);
        // A resumed session keeps the system prompt it was recorded with (SDK 0.3.310's default, AA-01): what changes
        // between runs (memory, knowledge, waiting requests, jobs, the date) goes in the user turn.
        const changed = resume && !research ? assemblePrompt({ ...layers, changing: true }) : undefined;
        const placed = knowledge.filter((c) => (changed ?? systemPrompt).includes(`[kb:${c.id}]`));
        logKnowledgeUse(db, placed.map((c) => c.id), { storeId: store.id, agentId: agent.id, runId: run.id, kind: 'prompt' });
        if (placed.length) emit({ type: 'knowledge', cards: placed.map(({ id, title, stage, storeId }) => ({ id, title, stage, storeId })) });
        const message = withAttachments(run);
        // A conversation's turn in a fresh session starts from what it continues or was opened from.
        const preface = !resume && run.conversationId ? conversationPreface(db, run.conversationId, run.id) : undefined;
        const input: RunInput = {
          agent,
          store,
          task: preface
            ? `${preface}\n\nNow: ${message}`
            : changed
              ? `The app's context for this message, as it is now (not the owner's words):\n\n${changed}\n\nNow: ${message}`
              : message,
          systemPrompt,
          ...(research ? { mode: 'research' as const } : {}),
          ...(config ? { config } : {}),
          signal,
          env: { ...env, runId: run.id },
          ...(resume ? { resume: String(resume), sessionCostUsd: sessionCost(String(resume)) } : {}),
          ...(budget !== undefined ? { budgetUsd: budget } : {}),
          onSpend: spend,
          onSession: (sessionId) => db.prepare('UPDATE agent_runs SET session_id = ? WHERE id = ?').run(sessionId, run.id),
          // What was asked (a run without a config learns its model and effort here) and what ran (decision 9).
          onRuntime: (r) =>
            db
              .prepare(
                `UPDATE agent_runs SET runtime = coalesce(runtime, ?), model = coalesce(model, ?), effort = coalesce(effort, ?), actual_model = coalesce(?, actual_model),
                 effort_applied = coalesce(?, effort_applied), runtime_version = coalesce(?, runtime_version) WHERE id = ?`,
              )
              .run(r.runtime ?? null, r.model ?? null, r.effort ?? null, r.actualModel ?? null, r.effortApplied ?? null, r.runtimeVersion ?? null, run.id),
        };
        let toolCalls = 0;
        let attempt = input;
        for (let retries = 0, mark = 0; ; mark = transcript.length) {
          let acted = false;
          for await (const event of runAgent(attempt, engine)) {
            if (event.type === 'done' || event.type === 'error') end = event;
            else {
              if (event.type === 'tool_call') toolCalls++, (acted ||= hasEffects(event.name));
              emit(event);
            }
          }
          // Claude Code keeps sessions 30 days, per folder: a follow-up whose session is gone goes on from a recap.
          if (end.type === 'error' && attempt.resume && end.message.startsWith('No conversation found')) {
            attempt = recapped({ ...attempt, task: message }, run.conversationId && conversationPreface(db, run.conversationId, run.id));
            emit({ type: 'notice', text: 'The earlier session had ended, so this reply started from a summary of the earlier work.' });
            continue;
          }
          // A busy or failing service is tried again, twice at most, unless the attempt already changed something.
          if (end.type !== 'error' || !TRANSIENT.includes(end.code ?? '') || acted || retries >= RETRY_MS.length || signal.aborted) break;
          await pause(RETRY_MS[retries++]!, signal);
          if (signal.aborted) {
            end = { type: 'error', message: 'Cancelled' };
            break;
          }
          transcript.length = mark; // what the failed attempt said goes; the retry says it again
          const slot = active.get(run.id);
          if (slot) slot.seq++; // a skipped number: a client that streamed the failed attempt refetches the transcript
        }
        // ponytail: only runs that looked at data (tool calls) reflect; a chat reply rarely teaches anything durable.
        // Research keeps what it learns as cards; Codex skips it in v1 (a second process, and plan quota).
        // Team steps skip it too, like research (decision 12).
        if (end.type === 'done' && toolCalls > 0 && !signal.aborted && !research && !run.teamId && config?.runtime !== 'codex') end = await reflect(attempt, end, emit);
      }
    } catch (err) {
      end = { type: 'error', message: err instanceof Error ? err.message : String(err) };
    }
    clearTimeout(deadline);
    // The engine's own budget stop means the run's budget when that was the smallest limit.
    if (end.type === 'error' && (overRun || (end.code === 'error_max_budget_usd' && runBudget !== undefined && runBudget <= (budget ?? Infinity)))) end = { ...end, message: `Stopped: this run's budget ($${runBudget}) is used up.` };
    else if (overTeam && end.type === 'error') end = { type: 'error', message: `Stopped: the team's budget ($${team}) is used up.` };
    else if (overCap && end.type === 'error') end = { type: 'error', message: overOwn ? ownUsedUp(own!, true) : `Stopped: today's AI budget for this store ($${cap}) is used up. Raise it in Settings.` };
    if (overTime && end.type === 'error') end = { ...end, message: `Stopped: this run's ${stopAfterMin}-minute limit was reached.` };
    emit(end);

    // The knowledge cards the answer cites as [kb:<id>] (the transcript already joined streamed pieces).
    const said = transcript.flatMap((e) => (e.type === 'text_delta' ? [e.text] : [])).join('');
    logKnowledgeUse(db, citedCards(db, said, run.storeId), { storeId: run.storeId, agentId: run.agentId, runId: run.id, kind: 'cited' });
    const status: RunStatus = end.type === 'done' ? 'done' : signal.aborted && !overCap && !overTime ? 'cancelled' : 'error';
    ended = true;
    const reported = end.type === 'done' ? end.usage : (end.type === 'error' && end.usage) || { inputTokens: 0, outputTokens: 0, costUsd: 0 };
    // The engine's figure, unless the live estimate is higher: crash results can carry zeros, a cut-off reflection reports none.
    const usage = { ...reported, costUsd: Math.max(reported.costUsd, spent) };
    db.prepare(
      `UPDATE agent_runs SET status = ?, session_id = coalesce(?, session_id), input_tokens = ?, output_tokens = ?, cost_usd = ?, error = ?, transcript_json = ?, ended_at = ?
       WHERE id = ?`,
    ).run(
      status,
      end.type === 'done' || end.type === 'error' ? (end.sessionId ?? null) : null, // a reply cut off by a limit goes on from here too
      usage.inputTokens,
      usage.outputTokens,
      usage.costUsd,
      end.type === 'error' ? end.message : null,
      JSON.stringify(transcript),
      new Date().toISOString(),
      run.id,
    );
    // No run ends with one of its in-run requests still open, a finished one included (a Codex tool's wait timed out).
    expireApprovals([run.id]);
    const final = getRun(db, run.id); // gone when its store was deleted meanwhile
    if (final) opts.onRun?.(final);
  }

  const retried = (runId: string) => !!db.prepare('SELECT 1 FROM done_once WHERE ref = ?').get(`retried:${runId}`);

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
  /** A conversation's turn goes on from the conversation's recap (decision 10); a chat follow-up from its last exchange. */
  function recapped({ resume, sessionCostUsd: _, ...input }: RunInput, preface?: string): RunInput {
    if (preface) return { ...input, task: `${preface}\n\nNow: ${input.task}` };
    const prev = db.prepare('SELECT task, transcript_json FROM agent_runs WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(resume!);
    if (!prev) return input;
    // ponytail: only the last exchange; walk the `resume` chain if longer chats need more.
    const said = (JSON.parse(String(prev.transcript_json ?? '[]')) as AgentEvent[]).flatMap((e) => (e.type === 'text_delta' ? [e.text] : [])).join('\n').slice(-3000);
    return { ...input, task: `Earlier in this chat (its full history has expired) you were asked: ${prev.task}\nYou answered: ${said}\n\nNow: ${input.task}` };
  }

  /** Asks the agent, in the same session, what it learned, and saves that as store memory. Never fails the run. */
  async function reflect(input: RunInput, done: Extract<AgentEvent, { type: 'done' }>, emit: (e: AgentEvent) => void) {
    // The store went live during the run: its demo numbers are gone, and so is what the squad learned from them (startFresh).
    if (!input.store.connected && opts.store(input.store.id)?.connected) return done;
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
  // scheduler counts it as fired). Chat follow-ups are left for the owner to resend; a retry is never retried. A
  // conversation's turn or a team's step shows as interrupted, and the owner resumes it.
  for (const r of interrupted) {
    if (r.resume || r.conversation_id || r.team_id || Date.now() - Date.parse(String(r.created_at)) > 6 * 3_600_000 || !once(db, `retried:${r.id}`)) continue;
    start(String(r.agent_id), String(r.task), undefined, r.parent_run_id ? String(r.parent_run_id) : undefined, { retryOf: String(r.id), ...(r.mode ? { mode: String(r.mode) } : {}) });
  }

  return { start, cancel, cancelStore, cancelAgent, get, idle };
}

const SHOWN = 4000;

/** What a team's Claude steps have spent, live (each run saves its spend as it goes). */
export const teamCost = (db: DatabaseSync, teamId: string) =>
  Number(db.prepare(`SELECT coalesce(sum(cost_usd), 0) AS n FROM agent_runs WHERE team_id = ? AND runtime = 'claude'`).get(teamId)?.n ?? 0);
const teamBudget = (db: DatabaseSync, teamId: string) => {
  const usd = db.prepare('SELECT budget_usd FROM squad_missions WHERE id = ?').get(teamId)?.budget_usd;
  return usd == null ? undefined : Number(usd);
};

/**
 * Runs older than 90 days keep their text and tool calls, but each tool output shrinks to its first 200 characters:
 * a store's runs would otherwise add ~50 MB a year to the database and to each of its 7 daily backups.
 */
// ponytail: runs at startup only; the app restarts often enough (updates, reboots). A daily timer if it ever doesn't.
function trimOldTranscripts(db: DatabaseSync, now = new Date()) {
  const cutoff = new Date(now.getTime() - 90 * 86_400_000).toISOString();
  // Each startup goes on from where the last one stopped: years of runs already trimmed aren't parsed again.
  const from = String(db.prepare(`SELECT at FROM done_once WHERE ref = 'transcripts-trimmed-to'`).get()?.at ?? '');
  for (const r of db.prepare('SELECT id, transcript_json FROM agent_runs WHERE created_at >= ? AND created_at < ? AND length(transcript_json) > 8000').all(from, cutoff)) {
    const before = String(r.transcript_json);
    let events: AgentEvent[];
    try {
      events = JSON.parse(before) as AgentEvent[];
    } catch {
      continue; // a damaged transcript stays as it is rather than stopping the app's startup
    }
    const after = JSON.stringify(events.map((e) => (e.type === 'tool_result' && e.output.length > 300 ? { ...e, output: `${e.output.slice(0, 200)}\n… (trimmed after 90 days)` } : e)));
    if (after !== before) db.prepare('UPDATE agent_runs SET transcript_json = ? WHERE id = ?').run(after, String(r.id));
  }
  // After the loop: a startup stopped halfway picks up the same window next time.
  db.prepare(`INSERT INTO done_once (ref, at) VALUES ('transcripts-trimmed-to', ?) ON CONFLICT (ref) DO UPDATE SET at = excluded.at`).run(cutoff);
}

const addUsage = (a: RunUsage, b: RunUsage): RunUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  costUsd: a.costUsd + b.costUsd,
});

/** USD the store's agents spent since local midnight. */
const ownUsedUp = (usd: number, stopped = false) => `${stopped ? "Stopped: today's" : "Today's"} budget for this agent ($${usd}) is used up. Raise it in its settings.`;

/** The error of a run that was in flight when the app stopped (one from the last 6 hours runs again, as a new run). */
export { INTERRUPTED };
const OFFLINE = 'This agent is offline. Redeploy it first.';
const DEMO_SESSION = 'That conversation ran on demo data, before the store went live: start a new one.';

export interface StartOptions {
  /** The run this one retries: a restart's retry, or the owner's Retry or Resume. Linked `retry:<old>:<new>`. */
  retryOf?: string;
  mode?: string;
  conversationId?: string;
  /** A team session's step. */
  teamId?: string;
  /** The config a run outside a conversation runs on (a team participant's). */
  configId?: string;
  /** The owner action's id: sent again, it returns the run it started. */
  clientRequestId?: string;
  /** The documents sent with the message, read already (the server's route). */
  attachments?: RunAttachment[];
}

/** The message with each attachment's text as an untrusted block after it (decision 11). */
function withAttachments(run: AgentRun): string {
  const blocks = (run.attachments ?? []).map((a) => untrustedBlock(`the attached file "${a.name}"${a.cut ? ` (only its first ${a.text.length.toLocaleString('en')} characters)` : ''}`, a.text, a.text.length));
  return [run.task, ...blocks].join('\n\n');
}

/** Errors a moment later may not repeat (SDKAssistantMessageError codes). */
const TRANSIENT = ['rate_limit', 'overloaded', 'server_error'];
const RETRY_MS = [5_000, 20_000];
const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
  });

export { hasEffects };

/**
 * A run that ended without doing anything because its agent couldn't take it then: the budget was used up by the time
 * it left the queue, or the agent was taken offline while it waited. A mission step tries again (missions.ts).
 */
export const turnedDown = (r: Record<string, unknown>) =>
  !Number(r.cost_usd) && ((r.status === 'error' && /^Today's (AI )?budget .* is used up/.test(String(r.error))) || (r.status === 'cancelled' && r.error === OFFLINE));

/** The agent's final answer: the text after its last tool step. */
export function finalText(transcript: AgentEvent[]): string {
  const lastTool = transcript.findLastIndex((e) => e.type === 'tool_call' || e.type === 'tool_result');
  return transcript.slice(lastTool + 1).map((e) => (e.type === 'text_delta' ? e.text : '')).join('').trim();
}

/**
 * One line for the activity feed: the first sentence of the agent's final answer, skipping headings and list markers.
 * Undefined when the run ended without a final answer.
 */
export function runGist(transcript: AgentEvent[], max = 160): string | undefined {
  return gist(finalText(transcript), max);
}

/** A reply's text blocks as its page shows them: the text split where it asked for an approval, empty parts left out. */
export function replyBlocks(transcript: AgentEvent[]): string[] {
  const parts = [''];
  for (const e of transcript) {
    if (e.type === 'text_delta') parts[parts.length - 1] += e.text;
    else if (e.type === 'approval_request') parts.push('');
  }
  return parts.map((p) => p.trim()).filter(Boolean);
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
  const [sessionId, error, startedAt, endedAt, parentRunId, mode] = ['session_id', 'error', 'started_at', 'ended_at', 'parent_run_id', 'mode'].map(opt);
  const [conversationId, teamId, configId, runtime, model, effort, runtimeVersion, actualModel, effortApplied] = [
    'conversation_id', 'team_id', 'config_id', 'runtime', 'model', 'effort', 'runtime_version', 'actual_model', 'effort_applied',
  ].map(opt);
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
    ...(mode ? { mode } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(teamId ? { teamId } : {}),
    ...(configId ? { configId } : {}),
    ...(runtime ? { runtime: runtime as RuntimeId } : {}),
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    ...(runtimeVersion ? { runtimeVersion } : {}),
    ...(actualModel ? { actualModel } : {}),
    ...(effortApplied ? { effortApplied } : {}),
    ...(r.attachments_json ? { attachments: JSON.parse(String(r.attachments_json)) as RunAttachment[] } : {}),
  };
}
