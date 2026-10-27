import { Hono } from 'hono';
import {
  cardsUnder,
  createCard,
  createCategory,
  ensureCategoryPath,
  getCard,
  isUnder,
  kbRow,
  listCards,
  listCategories,
  mergeCards,
  updateCard,
  updateCategory,
} from '@frontline/agents';
import { AGENT_ROLES, KB_CARD_TYPES, KB_STAGES, type KbCardPatch, type KbCardQuery, type KbCardStatus, type KbWorkspace } from '@frontline/shared';
import { tx, type Db } from '../db';

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
    if (typeof b.type !== 'string' || !(b.type in KB_CARD_TYPES)) return `type must be one of ${Object.keys(KB_CARD_TYPES).join(', ')}`;
    out.type = b.type as keyof typeof KB_CARD_TYPES;
  }
  if (b.stage !== undefined) {
    if (typeof b.stage !== 'string' || !(b.stage in KB_STAGES)) return `stage must be one of ${Object.keys(KB_STAGES).join(', ')}`;
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

function parseQuery(q: Record<string, string>): string | KbCardQuery {
  const out: KbCardQuery = { general: q.general === '1' };
  const stage = csv(q.stage);
  if (stage?.some((s) => !(s in KB_STAGES))) return `stage must list ${Object.keys(KB_STAGES).join(', ')}`;
  const type = csv(q.type);
  if (type?.some((t) => !(t in KB_CARD_TYPES))) return `type must list ${Object.keys(KB_CARD_TYPES).join(', ')}`;
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
          return createCard(db, ws, { ...card, title: card.title!, categoryId: cat.id, type, stage, status: 'active', authorId: 'owner', origin: 'owner' });
        });
        return typeof made === 'string' ? c.json({ error: made }, 400) : c.json(made, 201);
      } catch (e) {
        if (unique(e)) return c.json({ error: 'a card with that title is already in this workspace' }, 409);
        throw e;
      }
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
      return c.json(mergeCards(db, id, b.from, 'owner'));
    });
}
