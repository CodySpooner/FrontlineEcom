import {
  XP,
  createRunManager,
  deleteMemory,
  ensureSquads,
  seedDemoXp,
  getAgent,
  listAgents,
  listMemory,
  listRuns,
  updateAgent,
  updateMemory,
  writeMemory,
  type RunManager,
  type RunManagerOptions,
  type ToolEnv,
} from '@frontline/agents';
import { AGENT_ROLES, AUTONOMY_LEVELS, type AdSnapshotData, type AgentUpdate, type MemoryInput, type MemoryKind, type Page, type ResearchProduct, type StartRunInput } from '@frontline/shared';
import { Hono } from 'hono';
import { loadRows, summarize } from '../analytics';
import { approvalsHook, decide } from '../approvals';
import { listCompetitors, priceChanges } from '../competitors';
import { localDate } from '../dates';
import { DEMO_STORES } from '../demo';
import { dataDir, type Db } from '../db';
import { researchRoutes } from '../research';
import { award, gamificationRoutes } from './agents-gamification';
import { creativeRoutes } from './agents-creatives';
import { getCredentials } from '../integrations';
import { loadKey } from '../secrets';
import { getCaps, notify } from '../settings';
import { getStore } from '../stores';
import { publish } from '../live';

/** App data + approvals for agent tools. `key` decrypts integration credentials (default: the data dir's key file). */
export const toolEnv = (db: Db, key: () => Buffer = () => loadKey(dataDir())): ToolEnv => ({
  db,
  approvals: approvalsHook(db),
  decide: (id, decision) => decide(db, id, decision),
  caps: (storeId) => getCaps(db, storeId),
  externalMcp: (storeId) => {
    if (!db.prepare(`SELECT 1 FROM integrations WHERE kind = 'meta_ads' AND store_id = ?`).get(storeId)) return {};
    const meta = getCredentials(db, key(), 'meta_ads', storeId);
    return meta?.accessToken ? { meta_ads: { type: 'http', url: 'https://mcp.facebook.com/ads', headers: { Authorization: `Bearer ${meta.accessToken}` } } } : {};
  },
  competitors: (storeId) => ({
    competitors: listCompetitors(db, [storeId]),
    priceChanges: priceChanges(db, [storeId], 20),
    ads: db
      .prepare(
        `SELECT c.name, s.data_json FROM competitor_snapshots s JOIN competitors c ON c.id = s.competitor_id
         WHERE c.store_id = ? AND s.kind = 'ad' ORDER BY s.captured_at DESC, s.rowid DESC LIMIT 15`,
      )
      .all(storeId)
      .map((r) => ({ competitor: String(r.name), ...(JSON.parse(String(r.data_json)) as AdSnapshotData) })),
  }),
  research: async (q) => {
    const params = new URLSearchParams(Object.entries(q).flatMap(([k, v]) => (v === undefined ? [] : [[k, String(v)]])));
    const res = await researchRoutes(db).request(`/api/research?${params}`);
    return ((await res.json()) as Page<ResearchProduct>).items;
  },
  summary: (storeId, range) => {
    const to = localDate();
    return summarize(loadRows(db, [storeId], range, to), { range, to, storeIds: [storeId] });
  },
});

/** What the app does with runs: stream them over the live bus, pay XP, notify the owner when one finishes or fails. */
export const runHooks = (db: Db): Pick<RunManagerOptions, 'onRun' | 'onEvent'> => ({
  onEvent: (run, event) => {
    publish({ type: 'run_event', runId: run.id, agentId: run.agentId, storeId: run.storeId, event });
    if (event.type === 'memory_written') {
      const m = event.memory;
      award(db, { ref: `memory:${m.id}`, amount: XP.memory, reason: `Learned: ${m.text.slice(0, 80)}`, storeId: m.storeId, agentId: run.agentId });
    }
  },
  onRun: (run) => {
    publish({ type: 'run', run });
    if (run.status === 'done') award(db, { ref: `run:${run.id}`, amount: XP.runDone, reason: `Completed: ${run.task.slice(0, 80)}`, storeId: run.storeId, agentId: run.agentId });
    const agent = getAgent(db, run.agentId);
    const name = agent ? AGENT_ROLES[agent.role].name : 'Agent';
    const link = `/agents/${run.agentId}`;
    if (run.status === 'done') notify(db, { kind: 'agent_done', title: `${name} finished`, body: run.task, storeId: run.storeId, link });
    if (run.status === 'error') notify(db, { kind: 'error', title: `${name} hit an error`, body: run.error ?? run.task, storeId: run.storeId, link });
  },
});

const managers = new WeakMap<Db, RunManager>();

/** The app's run manager for this DB. */
export function runManager(db: Db): RunManager {
  let manager = managers.get(db);
  if (!manager) {
    manager = createRunManager({ db, env: toolEnv(db), store: (id) => getStore(db, id), ...runHooks(db) });
    managers.set(db, manager);
  }
  return manager;
}

const KINDS: MemoryKind[] = ['fact', 'learning', 'preference'];
const isText = (v: unknown, min: number, max: number) => typeof v === 'string' && v.trim().length >= min && v.trim().length <= max;

/** Validates a MemoryInput (all fields optional when partial). Returns an error message or the clean input. */
export function parseMemoryInput(body: unknown, partial: boolean): string | Partial<MemoryInput> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'body must be a JSON object';
  const b = body as Record<string, unknown>;
  const has = (k: string) => b[k] !== undefined;
  if ((has('kind') || !partial) && !KINDS.includes(b.kind as MemoryKind)) return `kind must be one of ${KINDS.join(', ')}`;
  if ((has('text') || !partial) && !isText(b.text, 5, 300)) return 'text must be 5–300 characters';
  if (has('evidence') && !isText(b.evidence, 0, 300)) return 'evidence must be up to 300 characters';
  if (has('confidence') && !(typeof b.confidence === 'number' && b.confidence >= 0 && b.confidence <= 1)) return 'confidence must be 0–1';
  if (has('tags') && !(Array.isArray(b.tags) && b.tags.length <= 10 && b.tags.every((t) => isText(t, 1, 40)))) return 'tags must be up to 10 short strings';
  const out: Partial<MemoryInput> = {};
  for (const k of ['kind', 'text', 'evidence', 'confidence', 'tags'] as const) if (has(k)) Object.assign(out, { [k]: typeof b[k] === 'string' ? b[k].trim() : b[k] });
  return out;
}

export function agentRoutes(db: Db) {
  ensureSquads(db);
  seedDemoXp(db, DEMO_STORES.map((s) => s.id));
  const runs = runManager(db);
  const limit = (v: string | undefined) => Math.min(200, Math.max(1, Math.floor(Number(v)) || 50));
  return new Hono()
    .get('/api/agents', (c) => c.json(listAgents(db, c.req.query('stores')?.split(',').filter(Boolean))))
    .get('/api/agents/:id', (c) => {
      const agent = getAgent(db, c.req.param('id'));
      return agent ? c.json(agent) : c.json({ error: 'Agent not found' }, 404);
    })
    .patch('/api/agents/:id', async (c) => {
      const body = (await c.req.json().catch(() => null)) as AgentUpdate | null;
      if (
        !body ||
        (body.enabled !== undefined && typeof body.enabled !== 'boolean') ||
        (body.autonomy !== undefined && !AUTONOMY_LEVELS.includes(body.autonomy))
      ) {
        return c.json({ error: 'Expected { enabled?: boolean, autonomy?: suggest|ask|autopilot }' }, 400);
      }
      const agent = updateAgent(db, c.req.param('id'), { enabled: body.enabled, autonomy: body.autonomy });
      return agent ? c.json(agent) : c.json({ error: 'Agent not found' }, 404);
    })
    .post('/api/agents/:id/runs', async (c) => {
      if (!getAgent(db, c.req.param('id'))) return c.json({ error: 'Agent not found' }, 404);
      const body = (await c.req.json().catch(() => null)) as StartRunInput | null;
      if (!body || !isText(body.task, 1, 4000) || (body.resumeRunId !== undefined && typeof body.resumeRunId !== 'string')) {
        return c.json({ error: 'Expected { task: string (1–4000 chars), resumeRunId?: string }' }, 400);
      }
      const run = runs.start(c.req.param('id'), body.task.trim(), body.resumeRunId);
      return typeof run === 'string' ? c.json({ error: run }, 409) : c.json(run, 201);
    })
    .get('/api/runs', (c) =>
      c.json(listRuns(db, { agentId: c.req.query('agent'), storeIds: c.req.query('stores')?.split(',').filter(Boolean), limit: limit(c.req.query('limit')) })),
    )
    .get('/api/runs/:id', (c) => {
      const run = runs.get(c.req.param('id'));
      return run ? c.json(run) : c.json({ error: 'Run not found' }, 404);
    })
    .post('/api/runs/:id/cancel', (c) => {
      const run = runs.cancel(c.req.param('id'));
      return run ? c.json(run) : c.json({ error: 'Run not found' }, 404);
    })
    .get('/api/stores/:id/memory', (c) => {
      if (!getStore(db, c.req.param('id'))) return c.json({ error: 'Store not found' }, 404);
      const q = c.req.query('q')?.trim().toLowerCase();
      const all = listMemory(db, c.req.param('id'));
      return c.json(q ? all.filter((m) => `${m.text} ${m.evidence ?? ''} ${m.tags.join(' ')}`.toLowerCase().includes(q)) : all);
    })
    .post('/api/stores/:id/memory', async (c) => {
      const storeId = c.req.param('id');
      if (!getStore(db, storeId)) return c.json({ error: 'Store not found' }, 404);
      const input = parseMemoryInput(await c.req.json().catch(() => null), false);
      if (typeof input === 'string') return c.json({ error: input }, 400);
      const { kind, text, ...rest } = input as MemoryInput;
      return c.json(writeMemory(db, { confidence: 0.8, ...rest, kind, text, storeId, agentId: 'owner' }), 201);
    })
    .patch('/api/memory/:id', async (c) => {
      const input = parseMemoryInput(await c.req.json().catch(() => null), true);
      if (typeof input === 'string') return c.json({ error: input }, 400);
      const memory = updateMemory(db, c.req.param('id'), input);
      return memory ? c.json(memory) : c.json({ error: 'Memory not found' }, 404);
    })
    .delete('/api/memory/:id', (c) => (deleteMemory(db, c.req.param('id')) ? c.body(null, 204) : c.json({ error: 'Memory not found' }, 404)))
    .route('/', gamificationRoutes(db))
    .route('/', creativeRoutes(db));
}
