// Pause new automation and cancel the runs automations started (ST-29, decision 14). The pause is the workspace setting
// `automation.paused`, read at each automatic start (RUN_STARTS); cancelling is its own action, through the run manager.
import { Hono } from 'hono';
import { automationPaused, getRun, kbControls, type RunManager } from '@frontline/agents';
import type { AutomationCancelled, AutomationRunning, AutomationStatus, ConfigImpact } from '@frontline/shared';
import type { Db } from '../db';
import { runManager } from '../routes/agents';

type Kind = 'automatic' | 'owner' | 'under way' | 'not a run';
/**
 * Every line in the app's code that starts an agent run, and whether pausing new automation stops it (decision 14).
 * `automation.test.ts` greps the code and compares: a new start site fails it until it's classified here. `line` is a
 * piece of the line; `count` lines carry it. Automatic sites check the pause; the owner's own starts and the steps of
 * work already under way (a run's delegation, a mission's or team's steps, a research task's stages) never do.
 */
export const RUN_STARTS: { file: string; line: string; count?: number; kind: Kind; why: string }[] = [
  { file: 'apps/server/src/automations.ts', line: 'return start(logId, rule.action.agentId, task)', kind: 'automatic', why: 'A schedule or metric rule fires; the tick checks the pause first.' },
  { file: 'apps/server/src/automations.ts', line: "if (a.status === 'approved') start(", kind: 'owner', why: "You approved the rule's request." },
  { file: 'apps/server/src/index.ts', line: 'startScheduler(db, (agentId, task) => runManager(db).start(', kind: 'automatic', why: "The scheduler's start: its tick checks the pause." },
  { file: 'apps/server/src/index.ts', line: 'startKbPromotionLoop(db, (agentId, task) => runManager(db).start(', kind: 'automatic', why: "The promotion loop's start: its pass checks the pause." },
  { file: 'apps/server/src/kb/promote.ts', line: 'start(drafter(lead), promotionTask(', kind: 'automatic', why: 'A card found in two live stores is offered for General; the pass returns while paused.' },
  { file: 'apps/server/src/kb/routes.ts', line: 'runManager(db).start(agentId, promotionTask(card.id))', kind: 'owner', why: 'You promote a card to General.' },
  { file: 'apps/server/src/product-research/tasks.ts', line: 'runs.start(conversation.agentId, retryOf', kind: 'owner', why: 'You start or retry a Product Research task.' },
  { file: 'apps/server/src/routes/agents-actions.ts', line: 'startRun(', kind: 'owner', why: 'You approved adding products: the Store Developer writes their pages.' },
  { file: 'apps/server/src/routes/agents-conversations.ts', line: 'runs.start(conversation.agentId, input.message.trim()', kind: 'owner', why: 'You open a conversation.' },
  { file: 'apps/server/src/routes/agents-conversations.ts', line: 'runs.start(conversation.agentId, b.message.trim()', kind: 'owner', why: 'You send a message.' },
  { file: 'apps/server/src/routes/agents-conversations.ts', line: 'runs.start(conversation.agentId, run.task', count: 2, kind: 'owner', why: 'You retry a reply, or resume one a restart cut off.' },
  { file: 'apps/server/src/routes/agents.ts', line: 'startRun: (agentId, task, parentRunId) => runManager(db).start(', kind: 'under way', why: 'A running agent assigns part of its work (tools.ts assign_task).' },
  { file: 'apps/server/src/routes/agents.ts', line: 'addProducts(db, a, (agentId, task) => runManager(db).start(', kind: 'owner', why: 'You approved adding products.' },
  { file: 'apps/server/src/routes/agents.ts', line: '!automationPaused(db)) runs.start(', kind: 'automatic', why: "Going live drafts a custom niche's pack; skipped while paused (ask for it in Knowledge)." },
  { file: 'apps/server/src/routes/agents.ts', line: 'runs.start(agent.id, body.task.trim(), body.resumeRunId', kind: 'owner', why: 'You start or resume an agent run.' },
  { file: 'apps/server/src/routes/agents.ts', line: 'runs.start(`${payer}:market_analyst`, task)', kind: 'owner', why: 'You ask the knowledge base.' },
  { file: 'apps/server/src/routes/agents.ts', line: 'runs.start(agent.id, draftNichePackTask(store))', kind: 'owner', why: "You ask for a custom niche's pack." },
  { file: 'apps/server/src/sync.ts', line: 'startRun(db, id,', kind: 'not a run', why: "A sync's record (store-analytics/sources.ts), no agent." },
  { file: 'packages/agents/src/kb-research.ts', line: 'deps.start(`${t.payer_id}:${t.role}`', kind: 'under way', why: "A research task's next stage. Self-directed and scheduled research start no task while paused." },
  { file: 'packages/agents/src/missions.ts', line: 'start(`${mission.storeId}:${step.role}`', kind: 'under way', why: "A mission's next step: missions already under way go on." },
  { file: 'packages/agents/src/runs.ts', line: 'start(String(r.agent_id), String(r.task)', kind: 'automatic', why: "A run a restart interrupted runs again; while paused only a mission's step does." },
  { file: 'packages/agents/src/teams.ts', line: 'start(config.agentId, was.task', kind: 'owner', why: "You resume a team's interrupted step." },
  { file: 'packages/agents/src/teams.ts', line: "start(config.agentId, s.kind === 'plan'", kind: 'under way', why: "A team's next step: teams you started go on." },
  { file: 'packages/agents/src/tools.ts', line: 'ctx.startRun(`${ctx.store.id}:${role}`', kind: 'under way', why: 'A running agent assigns part of its work.' },
];

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const going = (status?: string) => status === 'queued' || status === 'running';

/** The runs automations started that are still going (`automation_runs.run_id`). */
const runningRows = (db: Db) =>
  db
    .prepare(
      `SELECT a.run_id, coalesce(r.name, 'A deleted rule') AS rule, s.id AS store_id, s.name AS store, g.agent_id, g.status, g.created_at
       FROM automation_runs a JOIN agent_runs g ON g.id = a.run_id JOIN stores s ON s.id = a.store_id LEFT JOIN automation_rules r ON r.id = a.rule_id
       WHERE g.status IN ('queued', 'running') ORDER BY g.created_at`,
    )
    .all()
    .map((r): AutomationRunning => ({ runId: String(r.run_id), ruleName: String(r.rule), storeId: String(r.store_id), storeName: String(r.store), agentId: String(r.agent_id), status: r.status as AutomationRunning['status'], startedAt: String(r.created_at) }));

export function automationStatus(db: Db): AutomationStatus {
  const paused = automationPaused(db);
  const at = paused ? db.prepare("SELECT at FROM settings_changes WHERE setting = 'automation.paused' ORDER BY at DESC, rowid DESC LIMIT 1").get()?.at : undefined;
  return { paused, pausedAt: at == null ? null : String(at), running: runningRows(db) };
}

/** Pausing: what stops, from real counts, and the runs that keep going (cancelling them is its own action). */
export function pauseImpact(db: Db, value: unknown): ConfigImpact[] {
  if (value !== true || automationPaused(db)) return [];
  const rules = db.prepare('SELECT count(*) AS n, count(DISTINCT store_id) AS stores FROM automation_rules WHERE enabled = 1').get()!;
  const research = db.prepare('SELECT id FROM stores').all().filter((s) => kbControls(db, String(s.id)).autonomous).length;
  const runs = runningRows(db).length;
  return [
    {
      setting: 'automation.paused',
      text: `Pauses ${count(Number(rules.n), 'enabled rule')} across ${count(Number(rules.stores), 'store')} and self-directed research in ${count(research, 'store')}. ${count(runs, 'automation run')} already going ${runs === 1 ? 'keeps' : 'keep'} going.`,
    },
  ];
}

/**
 * Cancels runs automations started (`runIds`, else every one still going) and says what really happened to each, read
 * once it has ended: its requests the server carries out stay in Requests, its in-run ones close with it, and nothing
 * already applied is undone.
 */
export async function cancelRunning(db: Db, runIds?: string[], runs: Pick<RunManager, 'cancel'> = runManager(db)): Promise<AutomationCancelled[]> {
  const ids = runIds ?? runningRows(db).map((r) => r.runId);
  const ours = db.prepare('SELECT a.run_id, coalesce(r.name, ?) AS rule, s.name AS store FROM automation_runs a JOIN stores s ON s.id = a.store_id LEFT JOIN automation_rules r ON r.id = a.rule_id WHERE a.run_id = ?');
  return Promise.all(
    ids.flatMap((id) => {
      const row = ours.get('A deleted rule', id);
      if (!row) return []; // not an automation's run: never cancelled from here
      return [
        (async (): Promise<AutomationCancelled> => {
          const was = getRun(db, id)?.status;
          if (going(was)) runs.cancel(id, 'Cancelled from Settings → Automation & Approvals.');
          // A running run turns cancelled once its engine stops. ponytail: polled for 5 s at most; it then reads as stopping.
          for (let i = 0; i < 100 && going(getRun(db, id)?.status); i++) await new Promise((r) => setTimeout(r, 50));
          const status = getRun(db, id)?.status ?? 'cancelled';
          const approvals = db.prepare('SELECT id, title, status FROM approvals WHERE run_id = ? ORDER BY created_at, rowid').all(id).map((a) => ({ id: String(a.id), title: String(a.title), status: String(a.status) }));
          const pending = approvals.filter((a) => a.status === 'pending').length;
          const applied = approvals.filter((a) => a.status === 'approved').length;
          const outcome = !going(was) || (status !== 'cancelled' && !going(status))
            ? 'Already finished'
            : going(status)
              ? 'Stopping: it ends at its next step'
              : !pending && !applied
                ? 'Stopped before it changed anything'
                : `Stopped; ${[pending && `its ${count(pending, 'request')} stay${pending === 1 ? 's' : ''} in Requests`, applied && `${count(applied, 'approved request')} stay${applied === 1 ? 's' : ''} as made`].filter(Boolean).join(', and ')}`;
          return { runId: id, ruleName: String(row.rule), storeName: String(row.store), status, approvals, outcome };
        })(),
      ];
    }),
  );
}

/** GET /api/config/automation: the pause and the automation runs going. POST …/cancel-running { runIds? }: each run's outcome. */
export function automationRoutes(db: Db) {
  return new Hono()
    .get('/api/config/automation', (c) => c.json(automationStatus(db)))
    .post('/api/config/automation/cancel-running', async (c) => {
      const b = (await c.req.json().catch(() => ({}))) as { runIds?: unknown };
      if (b.runIds !== undefined && !(Array.isArray(b.runIds) && b.runIds.length <= 100 && b.runIds.every((x) => typeof x === 'string'))) return c.json({ error: 'runIds must be a list of run ids' }, 400);
      return c.json({ outcomes: await cancelRunning(db, b.runIds as string[] | undefined) });
    });
}
