import {
  budgetAddedToday,
  costToday,
  creditsToday,
  XP,
  createDefaultJobs,
  DEFAULT_JOBS,
  createRunManager,
  customNichePack,
  draftNichePackTask,
  enableDefaultJobs,
  once,
  deleteMemory,
  deleteNicheLearning,
  ensureSquads,
  seedDemoXp,
  getAgent,
  getPageDraft,
  knowledgeDoc,
  knowledgeIndex,
  resetKnowledge,
  saveKnowledge,
  listAgents,
  listMemory,
  listNicheLearnings,
  nicheKey,
  listRuns,
  getRun,
  runGist,
  updateAgent,
  updateMemory,
  writeMemory,
  type RunManager,
  type RunManagerOptions,
  type ToolEnv,
} from '@frontline/agents';
import { AGENT_ROLES, AUTONOMY_LEVELS, type AdSnapshotData, type AgentUpdate, type MemoryInput, type MemoryKind, type Page, type ResearchProduct, type StartRunInput, type StoreUsage } from '@frontline/shared';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Hono } from 'hono';
import { loadRows, summarize } from '../analytics';
import { fxFor } from '../fx';
import { approvalsHook, decide } from '../approvals';
import { listCompetitors, priceChanges } from '../competitors';
import { localDate } from '../dates';
import { DEMO_STORES } from '../demo';
import { dataDir, type Db } from '../db';
import { researchRoutes } from '../research';
import { addProducts, applyAdChange, applyPriceChange, onApproved, publishDraft, type PushPage, type SetPrice, type WriteAd } from './agents-actions';
import { pageRoutes } from './agents-pages';
import { flowRoutes } from './agents-flows';
import { issueRoutes } from './agents-issues';
import { award, gamificationRoutes } from './agents-gamification';
import { creativeRoutes, higgsfieldGenerate } from './agents-creatives';
import { pauseCampaign, setCampaignBudget } from '../connectors/ads';
import { demoSupplierProducts, searchCj } from '../connectors/cj';
import { createProducts, publishPage, publishProductPage, setProductPrice } from '../connectors/shopify';
import { getCredentials } from '../integrations';
import { loadKey } from '../secrets';
import { getCaps, notify } from '../settings';
import { getStore, listStores } from '../stores';
import { publish } from '../live';

/** Approved ad changes → the store's ad account (core's Meta / Google / TikTok writers). */
const writeAd =
  (db: Db): WriteAd =>
  (storeId, network, campaignId, change) =>
    change === 'pause'
      ? pauseCampaign(db, loadKey(dataDir()), storeId, network, campaignId)
      : setCampaignBudget(db, loadKey(dataDir()), storeId, network, campaignId, change.dailyBudget);

/** Core's store writers are Shopify-only so far: other platforms get a readable error, and the owner applies it by hand. */
const onShopify = <T,>(db: Db, storeId: string, write: () => Promise<T>) =>
  getStore(db, storeId)?.platform === 'shopify' ? write() : Promise.reject(new Error('Only Shopify stores are updated automatically so far'));

/** Store Builder drafts → Shopify: product pages update the product, other pages are created. */
const pushPage =
  (db: Db): PushPage =>
  (d) => {
    const seo = { ...(d.seoTitle ? { seoTitle: d.seoTitle } : {}), ...(d.seoDescription ? { seoDescription: d.seoDescription } : {}) };
    return onShopify<unknown>(db, d.storeId, () =>
      d.kind === 'product' && d.productId
        ? publishProductPage(db, loadKey(dataDir()), d.storeId, d.productId, { title: d.title, descriptionHtml: d.html, ...seo })
        : publishPage(db, loadKey(dataDir()), d.storeId, { title: d.title, bodyHtml: d.html }),
    );
  };

/** Approved price tests → Shopify (every variant). */
const setPrice =
  (db: Db): SetPrice =>
  (storeId, productId, change) =>
    onShopify(db, storeId, () => setProductPrice(db, loadKey(dataDir()), storeId, productId, change));

/** App data + approvals for agent tools. `key` decrypts integration credentials (default: the data dir's key file). */

export const toolEnv = (db: Db, key: () => Buffer = () => loadKey(dataDir())): ToolEnv => ({
  db,
  approvals: approvalsHook(db),
  decide: (id, decision) => decide(db, id, decision),
  caps: (storeId) => getCaps(db, storeId),
  startRun: (agentId, task, parentRunId) => runManager(db).start(agentId, task, undefined, parentRunId),
  generateMedia: async (req, signal) => {
    const creds = db.prepare(`SELECT 1 FROM integrations WHERE kind = 'higgsfield'`).get() && getCredentials(db, key(), 'higgsfield');
    if (!creds?.keyId || !creds.keySecret) return undefined;
    return higgsfieldGenerate({ keyId: creds.keyId, keySecret: creds.keySecret }, req, join(dataDir(), 'creatives'), { signal });
  },
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
  recordFind: async (find) => {
    const id = `find-${randomUUID().slice(0, 8)}`;
    db.prepare(
      'INSERT INTO research_products (id, title, category, niche, image, source, cost, price, compare_at, trend, competition, shipping_days) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(id, find.title, find.category, find.niche, find.image ?? null, find.source, find.cost, find.price, find.compareAt, find.trend, find.competition, find.shippingDays);
    return (await (await researchRoutes(db).request(`/api/research/${id}`)).json()) as ResearchProduct;
  },
  searchSuppliers: async (q, limit) => (await searchCj(db, loadKey(dataDir()), q, limit)) ?? demoSupplierProducts(db, q, limit),
  research: async (q) => {
    const params = new URLSearchParams(Object.entries(q).flatMap(([k, v]) => (v === undefined ? [] : [[k, String(v)]])));
    const res = await researchRoutes(db).request(`/api/research?${params}`);
    return ((await res.json()) as Page<ResearchProduct>).items;
  },
  summary: (storeId, range) => {
    const to = localDate();
    return summarize(loadRows(db, [storeId], range, to), { range, to, storeIds: [storeId] });
  },
  portfolio: (range) => {
    const [to, ids] = [localDate(), listStores(db).map((s) => s.id)];
    const { currency, unconverted } = fxFor(db, ids);
    return { ...summarize(loadRows(db, ids, range, to), { range, to, storeIds: ids }), currency, ...(unconverted.length ? { unconverted } : {}) };
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
    if (run.status === 'done') notify(db, { kind: 'agent_done', title: `${name} finished`, body: runGist(getRun(db, run.id)?.transcript ?? []) ?? run.task, storeId: run.storeId, link });
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
    // Approved actions that can come from outside a run (research screen, automations) are carried out here.
    onApproved(db, (db, a) => {
      if (a.action.kind === 'store.add_products') {
        return addProducts(db, a, (agentId, task) => runManager(db).start(agentId, task), (storeId, products) =>
          onShopify(db, storeId, () => createProducts(db, loadKey(dataDir()), storeId, products)),
        );
      }
      if (a.action.kind === 'ads.set_budget' || a.action.kind === 'ads.pause_campaign') return applyAdChange(db, a, writeAd(db));
      if (a.action.kind === 'store.set_price') return applyPriceChange(db, a, setPrice(db));
      if (a.action.kind === 'store.publish_page') {
        const d = getPageDraft(db, String((a.action.payload as { draftId?: unknown })?.draftId));
        if (d) return publishDraft(db, d, pushPage(db));
      }
    });
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
  if (has('pinned') && (!partial || typeof b.pinned !== 'boolean')) return 'pinned must be true or false (PATCH only)';
  const out: Partial<MemoryInput> = {};
  for (const k of ['kind', 'text', 'evidence', 'confidence', 'tags', 'pinned'] as const) if (has(k)) Object.assign(out, { [k]: typeof b[k] === 'string' ? b[k].trim() : b[k] });
  return out;
}

/**
 * A store's first real sync connects it (core's switchToReal). Once per store: its default jobs switch on (they run on
 * the owner's Claude login, so the owner is told), and a custom niche without a pack gets the Market Analyst drafting one.
 */
// ponytail: checked at startup and on squad reads (the dashboard polls them); core has no connect event to hook.
function activateConnectedStores(db: Db, runs: RunManager) {
  for (const store of listStores(db).filter((s) => s.connected)) {
    if (!once(db, `activate:${store.id}`)) continue;
    if (enableDefaultJobs(db, store.id)) {
      const jobs = DEFAULT_JOBS.map((j) => j.name).join(', ');
      notify(db, { kind: 'info', title: `${store.name} is live: the squad's scheduled jobs are on`, body: `${jobs}. They run on your Claude login; pause or change them in Automation.`, storeId: store.id, link: '/automation' });
    }
    if (store.niche === 'other' && store.nicheDetail && !customNichePack(store.nicheDetail)) runs.start(`${store.id}:market_analyst`, draftNichePackTask(store));
  }
}

export function agentRoutes(db: Db) {
  ensureSquads(db);
  seedDemoXp(db, DEMO_STORES.map((s) => s.id));
  const runs = runManager(db);
  activateConnectedStores(db, runs);
  // Default jobs that shipped after a store was made; a live store's owner hears about them (they use Claude usage).
  for (const store of listStores(db)) {
    const added = createDefaultJobs(db, store.id);
    if (added.length && store.connected) {
      notify(db, { kind: 'info', title: `New scheduled work for ${store.name}`, body: `${added.join(', ')}. It runs on your Claude login; pause or change it in Automation.`, storeId: store.id, link: '/automation' });
    }
  }
  const limit = (v: string | undefined) => Math.min(200, Math.max(1, Math.floor(Number(v)) || 50));
  return new Hono()
    .get('/api/usage', (c) => {
      const ids = c.req.query('stores')?.split(',').filter(Boolean);
      const stores = listStores(db).filter((s) => !ids?.length || ids.includes(s.id));
      return c.json(
        stores.map((s): StoreUsage => ({ storeId: s.id, agentCostUsd: costToday(db, s.id), credits: creditsToday(db, s.id), adBudgetAddedUsd: budgetAddedToday(db, s.id) })),
      );
    })
    .get('/api/agents', (c) => {
      activateConnectedStores(db, runs);
      return c.json(listAgents(db, c.req.query('stores')?.split(',').filter(Boolean)));
    })
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
    .get('/api/knowledge', (c) => c.json(knowledgeIndex()))
    .get('/api/knowledge/:kind/:key', (c) => {
      const d = knowledgeDoc(c.req.param('kind'), c.req.param('key'));
      return d ? c.json(d) : c.json({ error: 'Not found' }, 404);
    })
    .put('/api/knowledge/:kind/:key', async (c) => {
      const markdown = ((await c.req.json().catch(() => null)) as { markdown?: unknown } | null)?.markdown;
      if (typeof markdown !== 'string' || !markdown.trim() || markdown.length > 50_000) return c.json({ error: 'markdown must be 1–50,000 characters' }, 400);
      const d = saveKnowledge(c.req.param('kind'), c.req.param('key'), markdown);
      return d ? c.json(d) : c.json({ error: 'Not found' }, 404);
    })
    .delete('/api/knowledge/:kind/:key', (c) => {
      const d = resetKnowledge(c.req.param('kind'), c.req.param('key'));
      if (d === 'custom') return c.json({ error: 'A custom niche pack has no shipped version to go back to' }, 400);
      return d ? c.json(d) : c.json({ error: 'Not found' }, 404);
    })
    .get('/api/niche-learnings', (c) => {
      const storeId = c.req.query('store');
      const store = storeId ? getStore(db, storeId) : undefined;
      if (storeId && !store) return c.json([]);
      return c.json(listNicheLearnings(db, store ? nicheKey(store) : c.req.query('niche') || undefined));
    })
    .delete('/api/niche-learnings/:id', (c) => (deleteNicheLearning(db, c.req.param('id')) ? c.body(null, 204) : c.json({ error: 'Learning not found' }, 404)))
    .route('/', pageRoutes(db, pushPage(db)))
    .route('/', issueRoutes(db))
    .route('/', flowRoutes(db))
    .route('/', gamificationRoutes(db))
    .route('/', creativeRoutes(db));
}
