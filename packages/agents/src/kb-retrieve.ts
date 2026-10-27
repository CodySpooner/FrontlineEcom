import type { DatabaseSync } from 'node:sqlite';
import type { AgentRole, KbCard, KbStage, KbWorkspace } from '@frontline/shared';
import { getCard, kbScope } from './kb';
import { RELIABLE } from './kb-links';

// Retrieval (KB-17, decision 12): what agents get from the knowledge base, in the prompt and from search_knowledge.
// Keyword search (FTS5 bm25 over any of the words) on accepted cards the role may use, ranked up by stage, recency, the
// role's own areas, use, reliable sources, and confirmed links to the best matches. No embeddings: there's no provider.

const STOP = new Set(
  'the and for with that this from what how our your are was were will can should would could about into than then them they have has had not but all any you out get make more most some such its why when who over also just very much like need want does did been being'.split(' '),
);
const STAGE: Record<KbStage, number> = { hypothesis: 1, supported: 1.15, tested: 1.3, validated: 1.5 };
const DAY = 86_400_000;
// ponytail: the categories each role works in, by name, until the owner sets them per role (KB-22).
const AREAS: Record<AgentRole, RegExp> = {
  ad_strategist: /advert|\bads?\b|campaign|media|tiktok|meta|google/,
  product_hunter: /product|sourcing|supplier|trend|niche/,
  store_developer: /store|conversion|page|checkout|design|\bux\b|seo/,
  creative_studio: /creative|video|image|visual|brand|hook/,
  market_analyst: /market|competitor|trend|research|analytic|pricing|consumer|psycholog/,
  copywriter: /copy|messag|brand|seo|content|hook/,
  email_sms: /email|sms|retention|flow|loyalty/,
  operations: /operation|fulfil|shipping|inventory|order|return|customer service/,
};

/** A task's words as an FTS5 query: any of them, quoted (so no word is read as syntax), common ones left out. */
export function ftsQuery(text: string): string | undefined {
  const words = [...new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].filter((w) => !STOP.has(w)).slice(0, 24);
  return words.length ? words.map((w) => `"${w}"`).join(' OR ') : undefined;
}

/**
 * The cards best matching `query` that `role` may use in `ws`: active ones, the store's and General's (General only for
 * null), none blocked for the role. Cards the query names as [kb:<id>] (Use in a task) come before any match. At most
 * `limit`, the store's own first, then General's, each best first.
 */
export function retrieveKnowledge(db: DatabaseSync, q: Query & { limit: number }, now = new Date()): KbCard[] {
  const s = kbScope(q.ws, q.ws !== null, 'c.store_id');
  const usable = usableBy(q.role);
  const named = [...q.query.matchAll(/\[kb:([\w-]+)\]/g)]
    .flatMap((m) => db.prepare(`SELECT c.id, c.blocked_roles FROM kb_cards c WHERE c.id = ? AND c.status = 'active' AND ${s.sql}`).all(m[1]!, ...s.params))
    .filter(usable)
    .map((r) => String(r.id));
  const ranked = matches(db, q, now).filter((id) => !named.includes(id));
  const cards = [...new Set(named)].concat(ranked).slice(0, q.limit).map((id) => getCard(db, id)!);
  return [...cards.filter((c) => c.storeId !== null), ...cards.filter((c) => c.storeId === null)];
}

type Query = { ws: KbWorkspace; role: AgentRole; query: string };
const usableBy = (role: AgentRole) => (r: Record<string, unknown>) => !(JSON.parse(String(r.blocked_roles)) as string[]).some((x) => x === '*' || x === role);

/** The ids of the cards matching the query's words, best first. */
function matches(db: DatabaseSync, q: Query, now: Date): string[] {
  const match = ftsQuery(q.query.replace(/\[kb:[\w-]+\]/g, ' '));
  if (!match) return [];
  const s = kbScope(q.ws, q.ws !== null, 'c.store_id');
  const usable = usableBy(q.role);
  const rows = db
    .prepare(
      `SELECT c.id, c.store_id, c.category_id, c.stage, c.updated_at, c.used_count, c.cited_count, c.blocked_roles, -bm25(kb_cards_fts, 4, 2, 1, 2) AS rel
       FROM kb_cards_fts JOIN kb_cards c ON c.seq = kb_cards_fts.rowid
       WHERE kb_cards_fts MATCH ? AND c.status = 'active' AND ${s.sql} ORDER BY rel DESC LIMIT 60`,
    )
    .all(match, ...s.params)
    .filter(usable);
  if (!rows.length) return [];
  const ids = rows.map((r) => String(r.id));
  const marks = ids.map(() => '?').join(',');
  const cs = kbScope(q.ws, q.ws !== null);
  const cat = new Map(db.prepare(`SELECT id, parent_id, name FROM kb_categories WHERE ${cs.sql}`).all(...cs.params).map((c) => [String(c.id), c]));
  const path = (id: string): string => {
    const c = cat.get(id);
    return c ? `${c.parent_id ? path(String(c.parent_id)) : ''} ${String(c.name).toLowerCase()}` : '';
  };
  const reliable = new Set(
    db
      .prepare(`SELECT DISTINCT e.card_id FROM kb_evidence e JOIN kb_sources s ON s.id = e.source_id WHERE e.kind = 'research' AND s.status = 'read' AND s.reliability IN (${[...RELIABLE].map(() => '?').join(',')}) AND e.card_id IN (${marks})`)
      .all(...RELIABLE, ...ids)
      .map((r) => String(r.card_id)),
  );
  const score = new Map(
    rows.map((r) => [
      String(r.id),
      Number(r.rel) *
        STAGE[r.stage as KbStage] *
        (now.getTime() - Date.parse(String(r.updated_at)) < 30 * DAY ? 1.1 : 1) *
        (AREAS[q.role].test(path(String(r.category_id))) ? 1.3 : 1) *
        (1 + Math.min(Number(r.used_count) + 2 * Number(r.cited_count), 10) * 0.03) *
        (reliable.has(String(r.id)) ? 1.1 : 1),
    ]),
  );
  // Cards the owner confirmed as linked to the three best matches come along at half that match's score.
  const best = [...score].sort((a, b) => b[1] - a[1]).slice(0, 3);
  for (const [id, sc] of best) {
    const near = db
      .prepare(
        `SELECT c.id, c.blocked_roles FROM kb_links l JOIN kb_cards c ON c.id = CASE WHEN l.from_id = ? THEN l.to_id ELSE l.from_id END
         WHERE l.status = 'confirmed' AND (l.from_id = ? OR l.to_id = ?) AND c.status = 'active' AND ${s.sql}`,
      )
      .all(id, id, id, ...s.params)
      .filter(usable);
    for (const n of near) if (!score.has(String(n.id))) score.set(String(n.id), sc / 2);
  }
  return [...score].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

/** Logs that a run's agent got these cards (in its prompt, from a search) or cited them. Each counts once per run. */
export function logKnowledgeUse(db: DatabaseSync, ids: string[], u: { storeId: string; agentId: string; runId?: string; kind: 'prompt' | 'search' | 'cited' }, now = new Date()) {
  const col = u.kind === 'cited' ? 'cited_count' : 'used_count';
  for (const id of new Set(ids)) {
    const before = u.runId && db.prepare(`SELECT 1 FROM kb_retrievals WHERE run_id = ? AND card_id = ? AND (kind = 'cited') = ?`).get(u.runId, id, u.kind === 'cited' ? 1 : 0);
    db.prepare('INSERT INTO kb_retrievals (card_id, store_id, run_id, agent_id, kind, at) VALUES (?, ?, ?, ?, ?, ?)').run(id, u.storeId, u.runId ?? null, u.agentId, u.kind, now.toISOString());
    if (!before) db.prepare(`UPDATE kb_cards SET ${col} = ${col} + 1 WHERE id = ?`).run(id);
  }
}

/** The cards an answer cites as [kb:<id>] that the store's agents may see: unknown ids and other stores' are left out. */
export function citedCards(db: DatabaseSync, text: string, storeId: string): string[] {
  return [...text.matchAll(/\[kb:([\w-]+)\]/g)].map((m) => m[1]!).filter((id) => db.prepare('SELECT 1 FROM kb_cards WHERE id = ? AND (store_id = ? OR store_id IS NULL)').get(id, storeId));
}
