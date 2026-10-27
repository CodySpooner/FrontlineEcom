import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import {
  addEvidence,
  cancelResearch,
  cardsUnder,
  createResearchTask,
  createCard,
  createLink,
  decideLink,
  deleteEvidence,
  detachMerged,
  getAgent,
  getResearchTask,
  linked,
  listEvidence,
  listLinks,
  listRevisions,
  restoreRevision,
  retryResearch,
  saveSource,
  setSourceReliability,
  toKbTask,
  createCategory,
  ensureCategoryPath,
  getCard,
  isUnder,
  kbRow,
  kbScope,
  listCards,
  listCategories,
  mergeCards,
  updateCard,
  updateCategory,
} from '@frontline/agents';
import { AGENT_ROLES, KB_CARD_TYPES, KB_LINK_TYPES, KB_SOURCE_RELIABILITY, KB_STAGES, type KbCardPatch, type KbEvidenceInput, type KbCardQuery, type KbCardStatus, type KbSourceBrief, type KbSourceReliability, type KbView, type KbWorkspace } from '@frontline/shared';
import { tx, type Db } from '../db';
import { publish } from '../live';
import { advanceKbResearch, runManager } from '../routes/agents';
import { readUpload } from './fetcher';

// Knowledge Base routes (knowledge-base lane). Every by-id route names its workspace (?ws=) and 404s on another's id.

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, min: number, max: number) => typeof v === 'string' && v.trim().length >= min && v.trim().length <= max;
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const csv = (v: string | undefined) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined);
const unique = (e: unknown) => e instanceof Error && /UNIQUE/.test(e.message);
const LONG = ['body', 'relevance', 'application', 'appliesTo', 'limits'] as const;
const ROLES = new Set<string>(['*', ...Object.keys(AGENT_ROLES)]);

/** 'general' → null, a store id → itself, 'all' (reads only) → 'all'; anything else is undefined (a 400). */
function wsOf(db: Db, v: unknown, all = false): KbWorkspace | 'all' | undefined {
  if (v === 'general') return null;
  if (v === 'all') return all ? 'all' : undefined;
  return typeof v === 'string' && db.prepare('SELECT 1 FROM stores WHERE id = ?').get(v) ? v : undefined;
}
const WS_ERROR = 'ws must be general or a store id';
/** What one bulk action may change on many cards at once. */
const BULK = ['status', 'blockedRoles', 'researchMarked', 'category'];
const toView = (r: Record<string, unknown>): KbView => ({ id: String(r.id), storeId: (r.store_id as string | null) ?? null, name: String(r.name), state: JSON.parse(String(r.state_json)), createdAt: String(r.created_at) });
const isWebUrl = (u: unknown) => typeof u === 'string' && /^https?:\/\//i.test(u) && URL.canParse(u);
const taskExists = (db: Db, id: string) => !!db.prepare('SELECT 1 FROM kb_tasks WHERE id = ?').get(id);

/** Research From Source: what's wrong with the owner's request, or the task, made with its uploaded document kept as a source. */
async function sourceTask(db: Db, b: Obj) {
  const agent = typeof b.agentId === 'string' ? getAgent(db, b.agentId) : undefined;
  if (!agent) return 'agentId must be an agent';
  const ws = wsOf(db, b.ws);
  if (ws === undefined || (ws !== null && ws !== agent.storeId)) return "Findings go to General or the agent's own store";
  const urls = b.urls ?? [];
  if (!Array.isArray(urls) || !urls.every(isWebUrl)) return 'urls must be web addresses (http or https)';
  if (urls.length > 8) return 'At most 8 links in one task';
  if (b.text !== undefined && !text(b.text, 0, 200_000)) return 'text must be at most 200,000 characters';
  if (b.lookFor !== undefined && !text(b.lookFor, 0, 500)) return 'lookFor must be at most 500 characters';
  if (b.categoryId !== undefined && !kbRow(db, 'kb_categories', String(b.categoryId), ws)) return 'categoryId must be a category of that workspace';
  if (typeof b.budgetUsd !== 'number' || !(b.budgetUsd >= 0.1 && b.budgetUsd <= 20)) return 'budgetUsd must be between $0.10 and $20';
  const doc = b.document;
  if (doc !== undefined && !(isObj(doc) && text(doc.name, 1, 200) && typeof doc.data === 'string')) return 'document must be {name, data} with the file in base64';
  const pasted = typeof b.text === 'string' ? b.text.trim() : '';
  if (!urls.length && !pasted && !doc) return 'Give at least one link, some text or a document';
  const name = doc && String(doc.name).trim();
  const read = name ? await readUpload(name, Buffer.from(String(doc.data), 'base64')) : undefined;
  if (read && read.status !== 'read') return `${name}: ${read.error}`;
  const lookFor = typeof b.lookFor === 'string' ? b.lookFor.trim() : '';
  const more = urls.length + (pasted ? 1 : 0) + (name ? 1 : 0) - 1;
  const from = urls.length ? new URL(urls[0]).hostname : (name ?? 'pasted text');
  return tx(db, () => {
    const at = new Date().toISOString();
    const kept = read && saveSource(db, ws, { kind: 'document', title: read.title || name!, status: 'read', text: read.text, publishedAt: read.publishedAt, fetchedAt: at });
    const t = createResearchTask(db, {
      ws, payerId: agent.storeId, role: agent.role, kind: 'source', origin: 'owner', objective: lookFor || `Research from ${from}${more ? ` and ${more} more` : ''}`,
      brief: { ...(urls.length ? { urls } : {}), ...(pasted ? { text: pasted } : {}), ...(lookFor ? { lookFor } : {}), ...(kept ? { documentIds: [kept.id] } : {}) },
      ...(b.categoryId !== undefined ? { categoryId: String(b.categoryId) } : {}), budgetUsd: b.budgetUsd as number,
    });
    if (kept) db.prepare('INSERT INTO kb_task_sources (task_id, source_id) VALUES (?, ?)').run(t.id, kept.id);
    return t;
  });
}

/** The card fields of a body, trimmed, or what's wrong with them. The category is checked by the caller. */
function parseCard(b: Obj, partial: boolean): string | KbCardPatch {
  const out: KbCardPatch = {};
  if (!partial || b.title !== undefined) {
    if (!text(b.title, 3, 160)) return 'title must be 3-160 characters';
    out.title = String(b.title).trim();
  }
  if (b.summary !== undefined) {
    if (typeof b.summary !== 'string' || b.summary.length > 600) return 'summary must be at most 600 characters';
    out.summary = b.summary.trim();
  }
  for (const k of LONG) {
    if (b[k] === undefined) continue;
    if (typeof b[k] !== 'string' || (b[k] as string).length > 8000) return `${k} must be at most 8000 characters`;
    out[k] = (b[k] as string).trim();
  }
  if (b.tags !== undefined) {
    if (!Array.isArray(b.tags) || b.tags.length > 12 || !b.tags.every((t) => text(t, 1, 40))) return 'tags must be at most 12 tags of 1-40 characters';
    out.tags = [...new Map(b.tags.map((t: string) => [t.trim().toLowerCase(), t.trim()])).values()];
  }
  if (b.type !== undefined) {
    if (typeof b.type !== 'string' || !Object.hasOwn(KB_CARD_TYPES, b.type)) return `type must be one of ${Object.keys(KB_CARD_TYPES).join(', ')}`;
    out.type = b.type as keyof typeof KB_CARD_TYPES;
  }
  if (b.stage !== undefined) {
    if (typeof b.stage !== 'string' || !Object.hasOwn(KB_STAGES, b.stage)) return `stage must be one of ${Object.keys(KB_STAGES).join(', ')}`;
    out.stage = b.stage as keyof typeof KB_STAGES;
  }
  if (b.category !== undefined && (!Array.isArray(b.category) || !b.category.length || b.category.length > 6 || !b.category.every((n) => text(n, 1, 60))))
    return 'category must be a path of 1-6 names of 1-60 characters';
  if (b.categoryId !== undefined && typeof b.categoryId !== 'string') return 'categoryId must be a category id';
  if (!partial) return out;
  if (b.pinned !== undefined && typeof b.pinned !== 'boolean') return 'pinned must be true or false';
  if (b.researchMarked !== undefined && typeof b.researchMarked !== 'boolean') return 'researchMarked must be true or false';
  if (b.blockedRoles !== undefined && (!Array.isArray(b.blockedRoles) || !b.blockedRoles.every((r) => typeof r === 'string' && ROLES.has(r))))
    return `blockedRoles must list agent roles (${Object.keys(AGENT_ROLES).join(', ')}) or '*' for every role`;
  if (b.status !== undefined && !['active', 'archived', 'rejected'].includes(String(b.status))) return 'status must be active, archived or rejected';
  if (b.reason !== undefined && !text(b.reason, 1, 300)) return 'reason must be 1-300 characters';
  return {
    ...out,
    ...(b.pinned !== undefined ? { pinned: b.pinned as boolean } : {}),
    ...(b.researchMarked !== undefined ? { researchMarked: b.researchMarked as boolean } : {}),
    ...(b.blockedRoles !== undefined ? { blockedRoles: (b.blockedRoles as string[]).includes('*') ? ['*'] : [...new Set(b.blockedRoles as string[])] } : {}),
    ...(b.status !== undefined ? { status: b.status as 'active' | 'archived' | 'rejected' } : {}),
    ...(b.reason !== undefined ? { reason: String(b.reason).trim() } : {}),
  };
}

/** The category a card goes in: an id in `ws`, or a path made there. A string is the error. */
function categoryFor(db: Db, ws: KbWorkspace, b: Obj): string | { id: string } | undefined {
  if (typeof b.categoryId === 'string') return kbRow(db, 'kb_categories', b.categoryId, ws) ? { id: b.categoryId } : 'categoryId must be a category of this workspace';
  if (Array.isArray(b.category)) return { id: ensureCategoryPath(db, ws, b.category as string[]) };
  return undefined;
}

const EVIDENCE_KINDS = ['measured', 'research', 'observed', 'conflict'];
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

/** An evidence body, or what's wrong with it. The source is checked by the caller. */
function parseEvidence(b: Obj): string | KbEvidenceInput {
  if (!EVIDENCE_KINDS.includes(String(b.kind))) return `kind must be one of ${EVIDENCE_KINDS.join(', ')}`;
  if (!text(b.text, 3, 1000)) return 'text must be 3-1000 characters';
  if (b.sourceId !== undefined && typeof b.sourceId !== 'string') return 'sourceId must be a source id';
  if (b.metric !== undefined && !text(b.metric, 1, 40)) return 'metric must be 1-40 characters';
  for (const k of ['value', 'baseline'] as const) if (b[k] !== undefined && !finite(b[k])) return `${k} must be a number`;
  for (const k of ['windowFrom', 'windowTo'] as const) if (b[k] !== undefined && !isDate(b[k])) return `${k} must be YYYY-MM-DD`;
  if (b.sampleSize !== undefined && !(Number.isInteger(b.sampleSize) && (b.sampleSize as number) >= 0)) return 'sampleSize must be a whole number';
  if (b.testRef !== undefined && !text(b.testRef, 1, 120)) return 'testRef must be 1-120 characters';
  const pick = ['sourceId', 'metric', 'value', 'baseline', 'windowFrom', 'windowTo', 'sampleSize', 'testRef'].filter((k) => b[k] !== undefined);
  return { kind: b.kind as KbEvidenceInput['kind'], text: String(b.text).trim(), ...Object.fromEntries(pick.map((k) => [k, typeof b[k] === 'string' ? (b[k] as string).trim() : b[k]])) };
}

function parseQuery(q: Record<string, string>): string | KbCardQuery {
  const out: KbCardQuery = { general: q.general === '1' };
  const stage = csv(q.stage);
  if (stage?.some((s) => !Object.hasOwn(KB_STAGES, s))) return `stage must list ${Object.keys(KB_STAGES).join(', ')}`;
  const type = csv(q.type);
  if (type?.some((t) => !Object.hasOwn(KB_CARD_TYPES, t))) return `type must list ${Object.keys(KB_CARD_TYPES).join(', ')}`;
  const status = csv(q.status);
  if (status?.some((s) => !['proposed', 'active', 'archived', 'rejected', 'merged'].includes(s))) return 'status must list proposed, active, archived, rejected, merged';
  for (const k of ['createdFrom', 'createdTo', 'verifiedFrom', 'verifiedTo'] as const) {
    if (q[k] === undefined) continue;
    if (!isDate(q[k])) return `${k} must be YYYY-MM-DD`;
    out[k] = q[k];
  }
  if (q.sort && !['updated', 'created', 'title', 'stage', 'verified', 'used'].includes(q.sort)) return 'sort must be updated, created, title, stage, verified or used';
  if (q.q && q.q.length > 200) return 'q must be at most 200 characters';
  return {
    ...out,
    ...(stage ? { stage: stage as KbCardQuery['stage'] } : {}),
    ...(type ? { type: type as KbCardQuery['type'] } : {}),
    ...(status ? { status: status as KbCardStatus[] } : {}),
    ...(q.q ? { q: q.q } : {}),
    ...(q.category ? { category: q.category } : {}),
    ...(q.agent ? { agent: q.agent } : {}),
    ...(q.source ? { source: q.source } : {}),
    ...(q.metric ? { metric: q.metric } : {}),
    ...(q.tag ? { tag: csv(q.tag) } : {}),
    ...(q.sort ? { sort: q.sort as KbCardQuery['sort'] } : {}),
    ...(q.dir === 'asc' || q.dir === 'desc' ? { dir: q.dir } : {}),
    offset: Math.max(0, Math.floor(Number(q.offset)) || 0),
    limit: Math.min(1000, Math.max(1, Math.floor(Number(q.limit)) || 200)),
  };
}

export function kbRoutes(db: Db) {
  return new Hono()
    .get('/api/kb/workspaces', (c) =>
      c.json(
        Object.fromEntries(
          db.prepare(`SELECT coalesce(store_id, 'general') AS ws, count(*) AS n FROM kb_cards WHERE status IN ('proposed', 'active') GROUP BY store_id`).all().map((r) => [r.ws, Number(r.n)]),
        ),
      ),
    )
    .get('/api/kb/positions', (c) => {
      const ws = wsOf(db, c.req.query('ws'));
      if (ws === undefined || ws === 'all') return c.json({ error: WS_ERROR }, 400);
      return c.json(Object.fromEntries(db.prepare('SELECT card_id, x, y FROM kb_positions WHERE store_id IS ?').all(ws).map((r) => [r.card_id, { x: r.x, y: r.y }])));
    })
    .put('/api/kb/positions', async (c) => {
      const ws = wsOf(db, c.req.query('ws'));
      if (ws === undefined || ws === 'all') return c.json({ error: WS_ERROR }, 400);
      const b = await c.req.json().catch(() => undefined);
      if (!isObj(b) || Object.keys(b).length > 1000) return c.json({ error: 'body must map up to 1000 card ids to {x, y}' }, 400);
      const at = Object.entries(b);
      if (!at.every(([, p]) => isObj(p) && finite(p.x) && finite(p.y))) return c.json({ error: 'each position needs numeric x and y' }, 400);
      if (!at.every(([id]) => kbRow(db, 'kb_cards', id, ws, ws !== null))) return c.json({ error: 'card not found' }, 404);
      tx(db, () => {
        for (const [id, p] of at as [string, { x: number; y: number }][]) {
          db.prepare(`DELETE FROM kb_positions WHERE store_id IS ? AND card_id = ?`).run(ws, id);
          db.prepare('INSERT INTO kb_positions (store_id, card_id, x, y) VALUES (?, ?, ?, ?)').run(ws, id, p.x, p.y);
        }
      });
      return c.body(null, 204);
    })
    .get('/api/kb/sources', (c) => {
      const ws = wsOf(db, c.req.query('ws'));
      if (ws === undefined || ws === 'all') return c.json({ error: WS_ERROR }, 400);
      const s = kbScope(ws, c.req.query('general') === '1');
      const rows = db.prepare(`SELECT id, url, title, status, reliability, fetched_at FROM kb_sources WHERE ${s.sql} ORDER BY lower(title), id`).all(...s.params);
      return c.json(rows.map((r): KbSourceBrief => ({ id: String(r.id), ...(r.url ? { url: String(r.url) } : {}), title: String(r.title), status: r.status as KbSourceBrief['status'], reliability: r.reliability as KbSourceBrief['reliability'], ...(r.fetched_at ? { fetchedAt: String(r.fetched_at) } : {}) })));
    })
    .patch('/api/kb/sources/:id', async (c) => {
      const ws = wsOf(db, c.req.query('ws'));
      if (ws === undefined || ws === 'all') return c.json({ error: WS_ERROR }, 400);
      const b = await c.req.json().catch(() => undefined);
      if (!isObj(b) || !Object.hasOwn(KB_SOURCE_RELIABILITY, String(b.reliability))) return c.json({ error: `reliability must be one of ${Object.keys(KB_SOURCE_RELIABILITY).join(', ')}` }, 400);
      if (!kbRow(db, 'kb_sources', c.req.param('id'), ws)) return c.json({ error: 'source not found' }, 404);
      return c.json(setSourceReliability(db, c.req.param('id'), b.reliability as KbSourceReliability));
    })
    .get('/api/kb/views', (c) => {
      const ws = wsOf(db, c.req.query('ws'));
      if (ws === undefined || ws === 'all') return c.json({ error: WS_ERROR }, 400);
      return c.json(db.prepare('SELECT * FROM kb_views WHERE store_id IS ? ORDER BY created_at DESC, rowid DESC').all(ws).map(toView));
    })
    .post('/api/kb/views', async (c) => {
      const b = await c.req.json().catch(() => undefined);
      if (!isObj(b)) return c.json({ error: 'body must be a JSON object' }, 400);
      const ws = wsOf(db, b.ws);
      if (ws === undefined || ws === 'all') return c.json({ error: WS_ERROR }, 400);
      if (!text(b.name, 1, 60)) return c.json({ error: 'name must be 1-60 characters' }, 400);
      const s = b.state;
      const cam = isObj(s) ? s.camera : undefined;
      if (
        !isObj(s) ||
        (s.q !== undefined && typeof s.q !== 'string') ||
        (s.general !== undefined && typeof s.general !== 'boolean') ||
        (cam !== undefined && !(isObj(cam) && finite(cam.x) && finite(cam.y) && finite(cam.scale))) ||
        (s.collapsed !== undefined && !(Array.isArray(s.collapsed) && s.collapsed.length <= 500 && s.collapsed.every((x) => typeof x === 'string'))) ||
        (s.filters !== undefined && !(isObj(s.filters) && Object.keys(s.filters).length <= 30 && Object.values(s.filters).every((x) => typeof x === 'string'))) ||
        JSON.stringify(s).length > 20_000
      )
        return c.json({ error: 'state must hold q, general, camera {x, y, scale}, collapsed frame ids and filters (strings)' }, 400);
      const id = randomUUID();
      db.prepare('INSERT INTO kb_views (id, store_id, name, state_json, created_at) VALUES (?, ?, ?, ?, ?)').run(id, ws, String(b.name).trim(), JSON.stringify(s), new Date().toISOString());
      return c.json(toView(db.prepare('SELECT * FROM kb_views WHERE id = ?').get(id)!), 201);
    })
    .delete('/api/kb/views/:id', (c) => {
      const ws = wsOf(db, c.req.query('ws'));
      if (ws === undefined || ws === 'all') return c.json({ error: WS_ERROR }, 400);
      if (!kbRow(db, 'kb_views', c.req.param('id'), ws)) return c.json({ error: 'view not found' }, 404);
      db.prepare('DELETE FROM kb_views WHERE id = ?').run(c.req.param('id'));
      return c.body(null, 204);
    })
    .get('/api/kb/research/tasks', (c) => {
      const ws = wsOf(db, c.req.query('ws'), true);
      if (ws === undefined) return c.json({ error: 'ws must be general, all or a store id' }, 400);
      const s = kbScope(ws);
      const open = c.req.query('open') === '1' ? ` AND status IN ('queued', 'running')` : '';
      return c.json(db.prepare(`SELECT * FROM kb_tasks WHERE ${s.sql}${open} ORDER BY created_at DESC, rowid DESC LIMIT 200`).all(...s.params).map(toKbTask));
    })
    .post('/api/kb/research/tasks', async (c) => {
      const b = await c.req.json().catch(() => null);
      if (!isObj(b)) return c.json({ error: 'body must be an object' }, 400);
      const t = await sourceTask(db, b);
      if (typeof t === 'string') return c.json({ error: t }, 400);
      advanceKbResearch(db);
      return c.json(t, 201);
    })
    .get('/api/kb/research/tasks/:id', (c) => {
      const t = getResearchTask(db, c.req.param('id'));
      return t ? c.json(t) : c.json({ error: 'task not found' }, 404);
    })
    .post('/api/kb/research/tasks/:id/cancel', (c) => {
      if (!taskExists(db, c.req.param('id'))) return c.json({ error: 'task not found' }, 404);
      const t = cancelResearch(db, c.req.param('id'), (runId) => runManager(db).cancel(runId));
      if (!t) return c.json({ error: 'Only a queued or running task can be stopped' }, 409);
      publish({ type: 'kb_task', task: t });
      return c.json(t);
    })
    .post('/api/kb/research/tasks/:id/retry', (c) => {
      if (!taskExists(db, c.req.param('id'))) return c.json({ error: 'task not found' }, 404);
      const t = retryResearch(db, c.req.param('id'));
      if (!t) return c.json({ error: 'Only a failed or stopped task can be retried' }, 409);
      publish({ type: 'kb_task', task: t });
      advanceKbResearch(db);
      return c.json(t);
    })
    .get('/api/kb/categories', (c) => {
      const ws = wsOf(db, c.req.query('ws'), true);
      if (ws === undefined) return c.json({ error: 'ws must be general, all or a store id' }, 400);
      return c.json(listCategories(db, ws, c.req.query('general') === '1'));
    })
    .post('/api/kb/categories', async (c) => {
      const b = await c.req.json().catch(() => undefined);
      if (!isObj(b)) return c.json({ error: 'body must be a JSON object' }, 400);
      const ws = wsOf(db, b.ws);
      if (ws === undefined || ws === 'all') return c.json({ error: WS_ERROR }, 400);
      if (!text(b.name, 1, 60)) return c.json({ error: 'name must be 1-60 characters' }, 400);
      if (b.parentId != null && (typeof b.parentId !== 'string' || !kbRow(db, 'kb_categories', b.parentId, ws))) return c.json({ error: 'parentId must be a category of this workspace' }, 400);
      try {
        return c.json({ ...createCategory(db, ws, String(b.name).trim(), (b.parentId as string | undefined) ?? null), cards: 0 }, 201);
      } catch (e) {
        if (unique(e)) return c.json({ error: 'a category with that name is already there' }, 409);
        throw e;
      }
    })
    .patch('/api/kb/categories/:id', async (c) => {
      const id = c.req.param('id');
      const ws = wsOf(db, c.req.query('ws'));
      if (ws === undefined || ws === 'all') return c.json({ error: WS_ERROR }, 400);
      if (!kbRow(db, 'kb_categories', id, ws)) return c.json({ error: 'category not found' }, 404);
      const b = await c.req.json().catch(() => undefined);
      if (!isObj(b)) return c.json({ error: 'body must be a JSON object' }, 400);
      if (b.name !== undefined && !text(b.name, 1, 60)) return c.json({ error: 'name must be 1-60 characters' }, 400);
      if (b.position !== undefined && !Number.isInteger(b.position)) return c.json({ error: 'position must be a whole number' }, 400);
      if (b.parentId != null && (typeof b.parentId !== 'string' || !kbRow(db, 'kb_categories', b.parentId, ws) || isUnder(db, b.parentId, id)))
        return c.json({ error: 'parentId must be a category of this workspace outside this one' }, 400);
      try {
        const moved = updateCategory(db, id, { name: b.name === undefined ? undefined : String(b.name).trim(), parentId: b.parentId as string | null | undefined, position: b.position as number | undefined });
        return c.json(listCategories(db, ws).find((x) => x.id === moved.id));
      } catch (e) {
        if (unique(e)) return c.json({ error: 'a category with that name is already there' }, 409);
        throw e;
      }
    })
    .delete('/api/kb/categories/:id', (c) => {
      const id = c.req.param('id');
      const ws = wsOf(db, c.req.query('ws'));
      if (ws === undefined || ws === 'all') return c.json({ error: WS_ERROR }, 400);
      if (!kbRow(db, 'kb_categories', id, ws)) return c.json({ error: 'category not found' }, 404);
      const n = cardsUnder(db, id);
      if (n) return c.json({ error: `${n} card${n === 1 ? ' is' : 's are'} filed here: move them first` }, 409);
      db.prepare('DELETE FROM kb_categories WHERE id = ?').run(id);
      return c.body(null, 204);
    })
    .get('/api/kb/cards', (c) => {
      const ws = wsOf(db, c.req.query('ws'), true);
      if (ws === undefined) return c.json({ error: 'ws must be general, all or a store id' }, 400);
      const q = parseQuery(c.req.query());
      return typeof q === 'string' ? c.json({ error: q }, 400) : c.json(listCards(db, ws, q));
    })
    .post('/api/kb/cards', async (c) => {
      const b = await c.req.json().catch(() => undefined);
      if (!isObj(b)) return c.json({ error: 'body must be a JSON object' }, 400);
      const ws = wsOf(db, b.ws);
      if (ws === undefined || ws === 'all') return c.json({ error: WS_ERROR }, 400);
      const card = parseCard(b, false);
      if (typeof card === 'string') return c.json({ error: card }, 400);
      const type = card.type ?? 'user_provided';
      const stage = card.stage ?? 'hypothesis';
      if (type === 'validated_insight' && stage !== 'validated') return c.json({ error: 'a Validated Insight needs the Validated stage' }, 400);
      try {
        // One transaction: a path made for a card that then can't be saved isn't left behind.
        const made = tx(db, () => {
          const cat = categoryFor(db, ws, b);
          if (typeof cat !== 'object') return cat ?? 'category (a path) or categoryId is required';
          return createCard(db, ws, { ...card, title: card.title!, categoryId: cat.id, type, stage, status: 'active', authorId: 'owner', origin: 'owner', stageByOwner: card.stage !== undefined });
        });
        return typeof made === 'string' ? c.json({ error: made }, 400) : c.json(made, 201);
      } catch (e) {
        if (unique(e)) return c.json({ error: 'a card with that title is already in this workspace' }, 409);
        throw e;
      }
    })
    .post('/api/kb/cards/bulk', async (c) => {
      const b = await c.req.json().catch(() => undefined);
      if (!isObj(b)) return c.json({ error: 'body must be a JSON object' }, 400);
      const ws = wsOf(db, b.ws);
      if (ws === undefined || ws === 'all') return c.json({ error: WS_ERROR }, 400);
      if (!Array.isArray(b.ids) || !b.ids.length || b.ids.length > 1000 || !b.ids.every((id) => typeof id === 'string')) return c.json({ error: 'ids must list 1-1000 card ids' }, 400);
      const ids = [...new Set(b.ids as string[])];
      const p = b.patch;
      if (!isObj(p) || !Object.keys(p).length || !Object.keys(p).every((k) => BULK.includes(k))) return c.json({ error: `patch may set ${BULK.join(', ')}` }, 400);
      const patch = parseCard(p, true);
      if (typeof patch === 'string') return c.json({ error: patch }, 400);
      const rows = ids.map((id) => kbRow(db, 'kb_cards', id, ws));
      if (!rows.every(Boolean)) return c.json({ error: 'card not found' }, 404);
      if (patch.status && rows.some((r) => r!.status === 'merged')) return c.json({ error: 'a merged card is restored by detaching it' }, 409);
      const done = tx(db, () => {
        const cat = categoryFor(db, ws, p);
        if (typeof cat === 'string') return cat;
        for (const id of ids) updateCard(db, id, { ...patch, ...(cat ? { categoryId: cat.id } : {}) }, 'owner');
      });
      return typeof done === 'string' ? c.json({ error: done }, 400) : c.json({ updated: ids.length });
    })
    .get('/api/kb/cards/:id', (c) => {
      const ws = wsOf(db, c.req.query('ws'), true);
      if (ws === undefined) return c.json({ error: 'ws must be general, all or a store id' }, 400);
      const card = getCard(db, c.req.param('id'), ws, c.req.query('general') === '1');
      return card ? c.json(card) : c.json({ error: 'card not found' }, 404);
    })
    .patch('/api/kb/cards/:id', async (c) => {
      const id = c.req.param('id');
      const ws = wsOf(db, c.req.query('ws'));
      if (ws === undefined || ws === 'all') return c.json({ error: WS_ERROR }, 400);
      const row = kbRow(db, 'kb_cards', id, ws);
      if (!row) return c.json({ error: 'card not found' }, 404);
      const b = await c.req.json().catch(() => undefined);
      if (!isObj(b)) return c.json({ error: 'body must be a JSON object' }, 400);
      const patch = parseCard(b, true);
      if (typeof patch === 'string') return c.json({ error: patch }, 400);
      if (row.status === 'merged' && patch.status) return c.json({ error: 'a merged card is restored by detaching it' }, 409);
      if (patch.type === 'validated_insight' && (patch.stage ?? row.stage) !== 'validated') return c.json({ error: 'a Validated Insight needs the Validated stage' }, 400);
      try {
        const done = tx(db, () => {
          const cat = categoryFor(db, ws, b);
          return typeof cat === 'string' ? cat : updateCard(db, id, { ...patch, ...(cat ? { categoryId: cat.id } : {}) }, 'owner');
        });
        return typeof done === 'string' ? c.json({ error: done }, 400) : c.json(done);
      } catch (e) {
        if (unique(e)) return c.json({ error: 'a card with that title is already in this workspace' }, 409);
        throw e;
      }
    })
    .post('/api/kb/cards/:id/merge', async (c) => {
      const id = c.req.param('id');
      const ws = wsOf(db, c.req.query('ws'));
      if (ws === undefined || ws === 'all') return c.json({ error: WS_ERROR }, 400);
      const b = await c.req.json().catch(() => undefined);
      if (!isObj(b) || typeof b.from !== 'string') return c.json({ error: 'from must be the id of the card to merge in' }, 400);
      if (b.from === id) return c.json({ error: 'a card cannot be merged into itself' }, 400);
      const keep = kbRow(db, 'kb_cards', id, ws);
      const from = kbRow(db, 'kb_cards', b.from, ws);
      if (!keep || !from) return c.json({ error: 'card not found' }, 404);
      if (keep.status === 'merged' || from.status === 'merged') return c.json({ error: 'that card was already merged' }, 409);
      return c.json(tx(db, () => mergeCards(db, id, b.from as string, 'owner')));
    })
    .post('/api/kb/cards/:id/detach', async (c) => {
      const id = c.req.param('id');
      const ws = wsOf(db, c.req.query('ws'));
      if (ws === undefined || ws === 'all') return c.json({ error: WS_ERROR }, 400);
      if (!kbRow(db, 'kb_cards', id, ws)) return c.json({ error: 'card not found' }, 404);
      const b = await c.req.json().catch(() => undefined);
      if (!isObj(b) || typeof b.from !== 'string') return c.json({ error: 'from must be the id of the merged card' }, 400);
      const back = tx(db, () => detachMerged(db, id, b.from as string, 'owner'));
      return back ? c.json(back) : c.json({ error: 'no card of that id was merged into this one' }, 404);
    })
    .get('/api/kb/cards/:id/revisions', (c) => {
      const ws = wsOf(db, c.req.query('ws'), true);
      if (ws === undefined) return c.json({ error: 'ws must be general, all or a store id' }, 400);
      const id = c.req.param('id');
      return kbRow(db, 'kb_cards', id, ws, c.req.query('general') === '1') ? c.json(listRevisions(db, id)) : c.json({ error: 'card not found' }, 404);
    })
    .post('/api/kb/cards/:id/revisions/:rev/restore', (c) => {
      const id = c.req.param('id');
      const ws = wsOf(db, c.req.query('ws'));
      if (ws === undefined || ws === 'all') return c.json({ error: WS_ERROR }, 400);
      if (!kbRow(db, 'kb_cards', id, ws)) return c.json({ error: 'card not found' }, 404);
      try {
        const card = tx(db, () => restoreRevision(db, id, Number(c.req.param('rev')), 'owner'));
        return card ? c.json(card) : c.json({ error: 'revision not found' }, 404);
      } catch (e) {
        if (unique(e)) return c.json({ error: 'another card in this workspace has that title now' }, 409);
        throw e;
      }
    })
    .get('/api/kb/cards/:id/evidence', (c) => {
      const ws = wsOf(db, c.req.query('ws'), true);
      if (ws === undefined) return c.json({ error: 'ws must be general, all or a store id' }, 400);
      const id = c.req.param('id');
      return kbRow(db, 'kb_cards', id, ws, c.req.query('general') === '1') ? c.json(listEvidence(db, id)) : c.json({ error: 'card not found' }, 404);
    })
    .post('/api/kb/cards/:id/evidence', async (c) => {
      const id = c.req.param('id');
      const ws = wsOf(db, c.req.query('ws'));
      if (ws === undefined || ws === 'all') return c.json({ error: WS_ERROR }, 400);
      if (!kbRow(db, 'kb_cards', id, ws)) return c.json({ error: 'card not found' }, 404);
      const b = await c.req.json().catch(() => undefined);
      const e = isObj(b) ? parseEvidence(b) : 'body must be a JSON object';
      if (typeof e === 'string') return c.json({ error: e }, 400);
      if (e.sourceId && !kbRow(db, 'kb_sources', e.sourceId, ws)) return c.json({ error: 'sourceId must be a source of this workspace' }, 400);
      return c.json(tx(db, () => addEvidence(db, id, { ...e, authorId: 'owner' })), 201);
    })
    .delete('/api/kb/evidence/:id', (c) => {
      const ws = wsOf(db, c.req.query('ws'));
      if (ws === undefined || ws === 'all') return c.json({ error: WS_ERROR }, 400);
      const cardId = db.prepare('SELECT card_id FROM kb_evidence WHERE id = ?').get(c.req.param('id'))?.card_id;
      if (typeof cardId !== 'string' || !kbRow(db, 'kb_cards', cardId, ws)) return c.json({ error: 'evidence not found' }, 404);
      return c.json(tx(db, () => deleteEvidence(db, c.req.param('id'))));
    })
    .get('/api/kb/links', (c) => {
      const ws = wsOf(db, c.req.query('ws'), true);
      if (ws === undefined) return c.json({ error: 'ws must be general, all or a store id' }, 400);
      return c.json(listLinks(db, ws, c.req.query('general') === '1', c.req.query('card') || undefined));
    })
    .post('/api/kb/links', async (c) => {
      const b = await c.req.json().catch(() => undefined);
      if (!isObj(b)) return c.json({ error: 'body must be a JSON object' }, 400);
      const ws = wsOf(db, b.ws);
      if (ws === undefined || ws === 'all') return c.json({ error: WS_ERROR }, 400);
      if (typeof b.from !== 'string' || typeof b.to !== 'string') return c.json({ error: 'from and to must be card ids' }, 400);
      if (b.from === b.to) return c.json({ error: 'a card cannot be linked to itself' }, 400);
      if (typeof b.type !== 'string' || !Object.hasOwn(KB_LINK_TYPES, b.type)) return c.json({ error: `type must be one of ${Object.keys(KB_LINK_TYPES).join(', ')}` }, 400);
      if (!text(b.why, 3, 600)) return c.json({ error: 'why must be 3-600 characters' }, 400);
      if (!kbRow(db, 'kb_cards', b.from, ws, ws !== null) || !kbRow(db, 'kb_cards', b.to, ws, ws !== null)) return c.json({ error: 'card not found' }, 404);
      const type = b.type as keyof typeof KB_LINK_TYPES;
      if (linked(db, b.from, b.to, type)) return c.json({ error: 'those cards already have that link' }, 409);
      return c.json(tx(db, () => createLink(db, ws, { from: b.from as string, to: b.to as string, type, why: String(b.why).trim(), authorId: 'owner', status: 'confirmed' })), 201);
    })
    .patch('/api/kb/links/:id', async (c) => {
      const ws = wsOf(db, c.req.query('ws'));
      if (ws === undefined || ws === 'all') return c.json({ error: WS_ERROR }, 400);
      if (!kbRow(db, 'kb_links', c.req.param('id'), ws)) return c.json({ error: 'link not found' }, 404);
      const b = await c.req.json().catch(() => undefined);
      if (!isObj(b) || (b.status !== 'confirmed' && b.status !== 'rejected')) return c.json({ error: 'status must be confirmed or rejected' }, 400);
      return c.json(tx(db, () => decideLink(db, c.req.param('id'), b.status as 'confirmed' | 'rejected')));
    })
    .delete('/api/kb/links/:id', (c) => {
      const ws = wsOf(db, c.req.query('ws'));
      if (ws === undefined || ws === 'all') return c.json({ error: WS_ERROR }, 400);
      if (!kbRow(db, 'kb_links', c.req.param('id'), ws)) return c.json({ error: 'link not found' }, 404);
      db.prepare('DELETE FROM kb_links WHERE id = ?').run(c.req.param('id'));
      return c.body(null, 204);
    });
}

