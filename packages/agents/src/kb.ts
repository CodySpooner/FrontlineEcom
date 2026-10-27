import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  KB_GENERAL_CATEGORIES,
  type KbCard,
  type KbCardBrief,
  type KbCardPatch,
  type KbCardQuery,
  type KbCardStatus,
  type KbCardType,
  type KbCategory,
  type KbCategoryCount,
  type KbOrigin,
  type KbStage,
  type KbWorkspace,
  type Page,
} from '@frontline/shared';
import { suggestLinks } from './kb-links';

// The knowledge base domain (knowledge-base lane). Rows live in the kb_* tables (migration 44 in apps/server/src/db.ts).

type Row = Record<string, unknown>;
const json = <T>(v: unknown, d: T): T => {
  try {
    return v == null ? d : (JSON.parse(String(v)) as T);
  } catch {
    return d;
  }
};
const opt = (v: unknown) => (v == null ? undefined : String(v));

/**
 * The one workspace filter every KB read and write goes through. A store sees its own rows, plus General's when `general`
 * is set, and never another store's. General sees only General. `'all'` is for the owner's search and the Research Center.
 */
export function kbScope(ws: KbWorkspace | 'all', general = false, col = 'store_id'): { sql: string; params: string[] } {
  if (ws === 'all') return { sql: '1 = 1', params: [] };
  if (ws === null) return { sql: `${col} IS NULL`, params: [] };
  return { sql: general ? `(${col} = ? OR ${col} IS NULL)` : `${col} = ?`, params: [ws] };
}

type KbTable = 'kb_cards' | 'kb_categories' | 'kb_sources' | 'kb_links' | 'kb_conflicts' | 'kb_tasks' | 'kb_views';

/** A row by id, only if `ws` may see it: another workspace's id finds nothing, so routes answer 404. */
export function kbRow(db: DatabaseSync, table: KbTable, id: string, ws: KbWorkspace | 'all', general = false): Record<string, unknown> | undefined {
  const s = kbScope(ws, general);
  return db.prepare(`SELECT * FROM ${table} WHERE id = ? AND ${s.sql}`).get(id, ...s.params);
}

/**
 * A demo store went live: what its knowledge learned from demo numbers goes. That is its performance readings (and the
 * measured evidence they back), the lessons drawn from them, and cards agents wrote in ordinary runs. The owner's cards
 * and web research stay. Its open research is cancelled.
 */
export function kbGoLive(db: DatabaseSync, storeId: string): { cards: number; measurements: number; tasks: number } {
  const measurements = Number(db.prepare(`SELECT count(*) AS n FROM kb_evidence WHERE observation_id IN (SELECT id FROM kb_observations WHERE store_id = ?)`).get(storeId)?.n);
  db.prepare('DELETE FROM kb_observations WHERE store_id = ?').run(storeId);
  const cards = db
    .prepare(
      `DELETE FROM kb_cards WHERE store_id = ? AND origin IN ('agent', 'performance')
         AND NOT EXISTS (SELECT 1 FROM kb_evidence e JOIN kb_sources s ON s.id = e.source_id WHERE e.card_id = kb_cards.id AND s.status = 'read')`,
    )
    .run(storeId).changes;
  const tasks = db.prepare(`UPDATE kb_tasks SET status = 'cancelled', ended_at = ? WHERE store_id = ? AND status IN ('queued', 'running')`).run(new Date().toISOString(), storeId).changes;
  return { cards: Number(cards), measurements, tasks: Number(tasks) };
}

// ---- categories

const toCategory = (r: Row): KbCategory => ({ id: String(r.id), storeId: opt(r.store_id) ?? null, parentId: opt(r.parent_id) ?? null, name: String(r.name), position: Number(r.position), createdAt: String(r.created_at) });

/** The workspace's category tree in display order: each parent before its children, siblings by position then name. */
export function listCategories(db: DatabaseSync, ws: KbWorkspace | 'all', general = false): KbCategoryCount[] {
  const s = kbScope(ws, general, 'c.store_id');
  const rows = db
    .prepare(
      `SELECT c.*, (SELECT count(*) FROM kb_cards k WHERE k.category_id = c.id AND k.status IN ('proposed', 'active')) AS cards
       FROM kb_categories c WHERE ${s.sql} ORDER BY c.position, lower(c.name)`,
    )
    .all(...s.params);
  const kids = new Map<string, Row[]>();
  for (const r of rows) kids.set(String(r.parent_id ?? ''), [...(kids.get(String(r.parent_id ?? '')) ?? []), r]);
  const out: KbCategoryCount[] = [];
  const walk = (parent: string): void => (kids.get(parent) ?? []).forEach((r) => (out.push({ ...toCategory(r), cards: Number(r.cards) }), walk(String(r.id))));
  walk('');
  return out;
}

/** Category names from the root down, for every category `ws` can file into (and General's). */
function pathsOf(db: DatabaseSync, ws: KbWorkspace | 'all'): (id: string) => string[] {
  const s = kbScope(ws, true);
  const byId = new Map(db.prepare(`SELECT id, parent_id, name FROM kb_categories WHERE ${s.sql}`).all(...s.params).map((r) => [String(r.id), r]));
  return (id) => {
    const out: string[] = [];
    for (let r = byId.get(id); r && out.length < 32; r = r.parent_id ? byId.get(String(r.parent_id)) : undefined) out.unshift(String(r.name));
    return out;
  };
}

/** Next sibling position. A store's top-level category named like a General one takes its place, so the trees line up. */
function positionFor(db: DatabaseSync, ws: KbWorkspace, parentId: string | null, name: string): number {
  const general = KB_GENERAL_CATEGORIES.findIndex((n) => n.toLowerCase() === name.toLowerCase());
  if (!parentId && general >= 0) return general + 1;
  const s = kbScope(ws);
  return Math.max(100, Number(db.prepare(`SELECT max(position) AS n FROM kb_categories WHERE ${s.sql} AND parent_id IS ?`).get(...s.params, parentId)?.n ?? 0) + 1);
}

/** Adds a category; the caller has checked that `parentId` is in the same workspace. Throws on a duplicate name. */
export function createCategory(db: DatabaseSync, ws: KbWorkspace, name: string, parentId: string | null = null, position?: number): KbCategory {
  const id = randomUUID();
  db.prepare('INSERT INTO kb_categories (id, store_id, parent_id, name, position, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id,
    ws,
    parentId,
    name,
    position ?? positionFor(db, ws, parentId, name),
    new Date().toISOString(),
  );
  return toCategory(db.prepare('SELECT * FROM kb_categories WHERE id = ?').get(id)!);
}

/** The leaf of a category path in `ws`, made as needed. A top-level name matching a General category takes its spelling. */
export function ensureCategoryPath(db: DatabaseSync, ws: KbWorkspace, path: string[]): string {
  const s = kbScope(ws);
  let parent: string | null = null;
  for (const [i, raw] of path.entries()) {
    const name = (i === 0 && KB_GENERAL_CATEGORIES.find((n) => n.toLowerCase() === raw.trim().toLowerCase())) || raw.trim();
    const found: Row | undefined = db.prepare(`SELECT id FROM kb_categories WHERE ${s.sql} AND parent_id IS ? AND lower(name) = lower(?)`).get(...s.params, parent, name);
    parent = found ? String(found.id) : createCategory(db, ws, name, parent).id;
  }
  if (!parent) throw new Error('empty category path');
  return parent;
}

/** True when `parentId` is `id` or sits somewhere under it: moving `id` there would make a loop. */
export function isUnder(db: DatabaseSync, parentId: string, id: string): boolean {
  for (let p: string | undefined = parentId, n = 0; p && n < 64; n++) {
    if (p === id) return true;
    p = opt(db.prepare('SELECT parent_id FROM kb_categories WHERE id = ?').get(p)?.parent_id);
  }
  return false;
}

export function updateCategory(db: DatabaseSync, id: string, patch: { name?: string; parentId?: string | null; position?: number }): KbCategory {
  const sets = Object.entries({ name: patch.name, parent_id: patch.parentId, position: patch.position }).filter(([, v]) => v !== undefined);
  if (sets.length) db.prepare(`UPDATE kb_categories SET ${sets.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...sets.map(([, v]) => v ?? null), id);
  return toCategory(db.prepare('SELECT * FROM kb_categories WHERE id = ?').get(id)!);
}

/** Cards filed in the category or anywhere under it, any status: a merged or rejected card still needs its category. */
export function cardsUnder(db: DatabaseSync, id: string): number {
  return Number(
    db
      .prepare(`WITH RECURSIVE sub(id) AS (SELECT ? UNION ALL SELECT c.id FROM kb_categories c JOIN sub ON c.parent_id = sub.id) SELECT count(*) AS n FROM kb_cards WHERE category_id IN (SELECT id FROM sub)`)
      .get(id)?.n,
  );
}

// ---- cards

const STAGE_ORDER: KbStage[] = ['hypothesis', 'supported', 'tested', 'validated'];

function toBrief(r: Row, path: (id: string) => string[]): KbCardBrief {
  return {
    id: String(r.id),
    storeId: opt(r.store_id) ?? null,
    categoryId: String(r.category_id),
    path: path(String(r.category_id)),
    type: r.type as KbCardType,
    stage: r.stage as KbStage,
    status: r.status as KbCardStatus,
    ...(r.merged_into ? { mergedInto: String(r.merged_into) } : {}),
    title: String(r.title),
    summary: String(r.summary),
    tags: json<string[]>(r.tags, []),
    authorId: String(r.author_id),
    origin: r.origin as KbOrigin,
    ...(r.run_id ? { runId: String(r.run_id) } : {}),
    ...(r.task_id ? { taskId: String(r.task_id) } : {}),
    pinned: !!r.pinned,
    blockedRoles: json<string[]>(r.blocked_roles, []),
    researchMarked: !!r.research_marked,
    usedCount: Number(r.used_count),
    citedCount: Number(r.cited_count),
    ...(r.verified_at ? { verifiedAt: String(r.verified_at) } : {}),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

const toCard = (r: Row, path: (id: string) => string[]): KbCard => ({
  ...toBrief(r, path),
  body: String(r.body),
  relevance: String(r.relevance),
  application: String(r.application),
  appliesTo: String(r.applies_to),
  limits: String(r.limits),
});

/** Quoted prefix terms, ANDed, so any input is a valid FTS5 query. */
const ftsQuery = (q: string) =>
  [...new Set(q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])]
    .slice(0, 12)
    .map((t) => `"${t}"*`)
    .join(' ');

const SORTS = {
  updated: 'updated_at',
  created: 'created_at',
  title: 'lower(title)',
  stage: `CASE stage ${STAGE_ORDER.map((s, i) => `WHEN '${s}' THEN ${i}`).join(' ')} END`,
  verified: "coalesce(verified_at, '')",
  used: 'used_count',
};

/** The §13 filters over a workspace's cards (proposed and active unless `status` says otherwise). */
export function listCards(db: DatabaseSync, ws: KbWorkspace | 'all', q: KbCardQuery = {}): Page<KbCardBrief> {
  const s = kbScope(ws, q.general);
  const where = [s.sql];
  const params: (string | number)[] = [...s.params];
  const add = (sql: string, ...p: (string | number)[]) => (where.push(sql), params.push(...p));
  const list = (col: string, values: string[]) => add(`${col} IN (${values.map(() => '?').join(', ')})`, ...values);
  list('status', q.status?.length ? q.status : ['proposed', 'active']);
  if (q.stage?.length) list('stage', q.stage);
  if (q.type?.length) list('type', q.type);
  if (q.category) add('category_id IN (WITH RECURSIVE sub(id) AS (SELECT ? UNION ALL SELECT c.id FROM kb_categories c JOIN sub ON c.parent_id = sub.id) SELECT id FROM sub)', q.category);
  if (q.agent) add(`(author_id = ? OR author_id LIKE '%:' || ?)`, q.agent, q.agent);
  if (q.source) add('id IN (SELECT card_id FROM kb_evidence WHERE source_id = ?)', q.source);
  if (q.metric) add('id IN (SELECT card_id FROM kb_evidence WHERE metric = ?)', q.metric);
  if (q.createdFrom) add('substr(created_at, 1, 10) >= ?', q.createdFrom);
  if (q.createdTo) add('substr(created_at, 1, 10) <= ?', q.createdTo);
  if (q.verifiedFrom) add('substr(verified_at, 1, 10) >= ?', q.verifiedFrom);
  if (q.verifiedTo) add('substr(verified_at, 1, 10) <= ?', q.verifiedTo);
  if (q.tag?.length) add(`EXISTS (SELECT 1 FROM json_each(tags) WHERE lower(value) IN (${q.tag.map(() => '?').join(', ')}))`, ...q.tag.map((t) => t.toLowerCase()));
  const match = q.q ? ftsQuery(q.q) : '';
  if (match) add('seq IN (SELECT rowid FROM kb_cards_fts WHERE kb_cards_fts MATCH ?)', match);
  const offset = Math.max(0, q.offset ?? 0);
  const limit = Math.min(1000, Math.max(1, q.limit ?? 200));
  const dir = q.dir === 'asc' ? 'ASC' : 'DESC';
  const from = `FROM kb_cards WHERE ${where.join(' AND ')}`;
  const total = Number(db.prepare(`SELECT count(*) AS n ${from}`).get(...params)?.n);
  const rows = db.prepare(`SELECT * ${from} ORDER BY ${SORTS[q.sort ?? 'updated']} ${dir}, seq ${dir} LIMIT ? OFFSET ?`).all(...params, limit, offset);
  const path = pathsOf(db, ws);
  return { items: rows.map((r) => toBrief(r, path)), total, offset, limit };
}

/** One card, only if `ws` may see it. */
export function getCard(db: DatabaseSync, id: string, ws: KbWorkspace | 'all' = 'all', general = false): KbCard | undefined {
  const r = kbRow(db, 'kb_cards', id, ws, general);
  return r && toCard(r, pathsOf(db, opt(r.store_id) ?? null));
}

/** Records the card as it is now, with why it changed. Every move and edit is one. */
export function revise(db: DatabaseSync, id: string, actor: string, reason: string, at: string) {
  const { seq: _, ...snapshot } = db.prepare('SELECT * FROM kb_cards WHERE id = ?').get(id)!;
  db.prepare('INSERT INTO kb_revisions (card_id, actor, reason, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?)').run(id, actor, reason, JSON.stringify(snapshot), at);
}

export interface NewKbCard {
  categoryId: string;
  title: string;
  summary?: string;
  body?: string;
  relevance?: string;
  application?: string;
  appliesTo?: string;
  limits?: string;
  tags?: string[];
  type: KbCardType;
  stage: KbStage;
  status: KbCardStatus;
  authorId: string;
  origin: KbOrigin;
  runId?: string;
  taskId?: string;
  /** The owner chose the stage: the app's ladder leaves it there. */
  stageByOwner?: boolean;
}

/** Saves a card in `ws` (its category must be there too) with its first revision. Throws on a title already used there. */
export function createCard(db: DatabaseSync, ws: KbWorkspace, c: NewKbCard, now = new Date()): KbCard {
  const id = randomUUID();
  const at = now.toISOString();
  db.prepare(
    `INSERT INTO kb_cards (id, store_id, category_id, type, stage, status, title, summary, body, relevance, application, applies_to, limits, tags,
       author_id, origin, run_id, task_id, stage_by_owner, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, ws, c.categoryId, c.type, c.stage, c.status, c.title, c.summary ?? '', c.body ?? '', c.relevance ?? '', c.application ?? '', c.appliesTo ?? '', c.limits ?? '',
    JSON.stringify(c.tags ?? []), c.authorId, c.origin, c.runId ?? null, c.taskId ?? null, c.stageByOwner ? 1 : 0, at, at,
  );
  revise(db, id, c.authorId, 'Created', at);
  suggestLinks(db, id, now);
  return getCard(db, id)!;
}

const TEXT = { title: 'title', summary: 'summary', body: 'body', relevance: 'relevance', application: 'application', appliesTo: 'applies_to', limits: 'limits' } as const;

/**
 * Applies one change as one revision. Type and stage stay consistent: Validated Insight needs the Validated stage, and a
 * card that drops below it goes back to the type it had before.
 */
export function updateCard(db: DatabaseSync, id: string, patch: Omit<KbCardPatch, 'category'>, actor: string, now = new Date()): KbCard {
  const r = db.prepare('SELECT * FROM kb_cards WHERE id = ?').get(id)!;
  const sets: Record<string, string | number> = {};
  const edited: string[] = [];
  const said: string[] = [];
  for (const [k, col] of Object.entries(TEXT)) {
    const v = patch[k as keyof typeof TEXT];
    if (v !== undefined && v !== r[col]) (sets[col] = v), edited.push(k);
  }
  if (patch.tags && JSON.stringify(patch.tags) !== r.tags) (sets.tags = JSON.stringify(patch.tags)), edited.push('tags');
  if (patch.categoryId && patch.categoryId !== r.category_id) (sets.category_id = patch.categoryId), edited.push('category');
  const stage = patch.stage ?? (r.stage as KbStage);
  let type = patch.type ?? (r.type as KbCardType);
  if (type === 'validated_insight' && stage !== 'validated') type = (opt(r.prev_type) as KbCardType | undefined) ?? 'research_finding';
  if (type !== r.type) {
    sets.type = type;
    if (type === 'validated_insight') sets.prev_type = String(r.type);
    edited.push('type');
  }
  if (stage !== r.stage) (sets.stage = stage), edited.push('stage');
  if (patch.stage !== undefined && actor === 'owner') sets.stage_by_owner = 1;
  if (edited.length) said.push(`Edited ${edited.join(', ')}`);
  if (patch.pinned !== undefined && patch.pinned !== !!r.pinned) (sets.pinned = patch.pinned ? 1 : 0), said.push(patch.pinned ? 'Pinned' : 'Unpinned');
  if (patch.researchMarked !== undefined && patch.researchMarked !== !!r.research_marked)
    (sets.research_marked = patch.researchMarked ? 1 : 0), said.push(patch.researchMarked ? 'Marked for research' : 'Research mark cleared');
  if (patch.blockedRoles && JSON.stringify(patch.blockedRoles) !== r.blocked_roles) {
    sets.blocked_roles = JSON.stringify(patch.blockedRoles);
    said.push(!patch.blockedRoles.length ? 'Unblocked' : patch.blockedRoles.includes('*') ? 'Blocked from every agent' : `Blocked from ${patch.blockedRoles.join(', ')}`);
  }
  if (patch.status && patch.status !== r.status) {
    sets.status = patch.status;
    said.push(patch.status === 'archived' ? 'Archived' : patch.status === 'rejected' ? 'Rejected' : r.status === 'proposed' ? 'Accepted' : 'Restored');
  }
  if (!said.length) return getCard(db, id)!;
  const at = now.toISOString();
  sets.updated_at = at;
  db.prepare(`UPDATE kb_cards SET ${Object.keys(sets).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(sets), id);
  revise(db, id, actor, said.join('; ') + (patch.reason ? `: ${patch.reason}` : ''), at);
  return getCard(db, id)!;
}
