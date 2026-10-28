import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  KB_STAGES,
  type FindingTag,
  type KbCard,
  type KbCardType,
  type KbEvidence,
  type KbEvidenceInput,
  type KbLink,
  type KbLinkStatus,
  type KbLinkType,
  type KbRevision,
  type KbSourceReliability,
  type KbSourceStatus,
  type KbStage,
  type KbWorkspace,
} from '@frontline/shared';
import { createCard, ensureCategoryPath, freshness, getCard, kbControls, kbScope, revise } from './kb';

// Evidence, the confidence ladder, links and the suggester, revisions (knowledge-base lane, decision 11).

type Row = Record<string, unknown>;
const opt = (v: unknown) => (v == null ? undefined : String(v));
const num = (v: unknown) => (v == null ? undefined : Number(v));
const DAY = 86_400_000;
const STAGES = Object.keys(KB_STAGES) as KbStage[];
export const RELIABLE = new Set<string>(['platform_docs', 'research', 'publication'] satisfies KbSourceReliability[]);
const host = (url: unknown) => {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
};

// ---- the ladder

/** Agents may propose Hypotheses and Research-Supported cards only, and never set the owner's or the measured types. */
export function agentCardError(c: { type: KbCardType; stage: KbStage }): string | undefined {
  if (c.type === 'validated_insight' || c.type === 'user_provided') return `type ${c.type} is set by the owner or by measured results, never by an agent`;
  if (c.stage !== 'hypothesis' && c.stage !== 'supported') return 'stage must be hypothesis or supported: testing and validating take measured results';
}

/**
 * The stage a card's evidence earns. Research-Supported: 2+ read sources on different sites, or 1 read source rated
 * reliable, unless the research that made it rated its evidence weak (2 of 5 or less) or contested. Experimentally
 * Tested: a measured result. Validated: measured results from 2+ different tests. Each piece of contradicting evidence
 * cancels one of its own kind (measured or not), so evidence against moves a card down.
 */
export function earnedStage(db: DatabaseSync, cardId: string): { stage: KbStage; reason: string } {
  const rows = db
    .prepare(
      `SELECT e.id, e.kind, e.test_ref, e.metric, e.observation_id, e.source_id, s.url, s.content_hash, s.status, s.reliability
       FROM kb_evidence e LEFT JOIN kb_sources s ON s.id = e.source_id WHERE e.card_id = ?`,
    )
    .all(cardId);
  const measured = (r: Row) => r.metric != null || r.observation_id != null;
  const against = rows.filter((r) => r.kind === 'conflict');
  const tests = new Set(rows.filter((r) => r.kind === 'measured').map((r) => String(r.test_ref ?? r.id))).size - against.filter(measured).length;
  const read = rows.filter((r) => r.kind === 'research' && r.status === ('read' satisfies KbSourceStatus));
  const readAgainst = against.filter((r) => !measured(r)).length;
  const sites = new Set(read.map((r) => host(r.url) ?? String(r.content_hash ?? r.source_id))).size - readAgainst;
  if (tests >= 2) return { stage: 'validated', reason: `${tests} independent measured tests` };
  if (tests >= 1) return { stage: 'tested', reason: '1 measured test' };
  const reliable = !readAgainst && read.some((r) => RELIABLE.has(String(r.reliability)));
  // The evaluating stage's verdict on the finding that made this card (kb-research.ts); one merged in later doesn't count.
  const weak = (sites >= 2 || reliable) && db.prepare(
    `SELECT 1 FROM kb_findings WHERE card_id = ? AND status = 'stored' AND (json_extract(assessment_json, '$.evidence') <= 2 OR json_array_length(assessment_json, '$.contradictions') > 0)`,
  ).get(cardId);
  if (weak) return { stage: 'hypothesis', reason: 'the research rated its evidence weak or contested' };
  if (sites >= 2) return { stage: 'supported', reason: `${sites} independent read sources` };
  if (reliable) return { stage: 'supported', reason: 'a reliable read source' };
  return { stage: 'hypothesis', reason: 'not enough evidence yet' };
}

/**
 * Moves the card to the stage its evidence earns, as a revision. A stage the owner set stays (their call outranks the
 * app's), and so does a merged card's. A Validated Insight that drops below Validated goes back to its earlier type.
 */
export function settleStage(db: DatabaseSync, cardId: string, cause?: string, now = new Date()) {
  const r = db.prepare('SELECT stage, type, prev_type, stage_by_owner, status FROM kb_cards WHERE id = ?').get(cardId);
  if (!r || r.stage_by_owner || r.status === 'merged') return;
  const earned = earnedStage(db, cardId);
  if (earned.stage === r.stage) return;
  const up = STAGES.indexOf(earned.stage) > STAGES.indexOf(r.stage as KbStage);
  const type = r.type === 'validated_insight' && earned.stage !== 'validated' ? (opt(r.prev_type) ?? 'research_finding') : String(r.type);
  const at = now.toISOString();
  db.prepare('UPDATE kb_cards SET stage = ?, type = ?, updated_at = ? WHERE id = ?').run(earned.stage, type, at, cardId);
  revise(db, cardId, 'app', `Moved ${up ? 'up' : 'down'} to ${KB_STAGES[earned.stage]}: ${up ? earned.reason : (cause ?? earned.reason)}`, at);
}

// ---- conflicts

/** Opens a conflict unless the same pair (or the same evidence) already has an open one. */
export function openConflict(db: DatabaseSync, c: { storeId: string | null; cardId: string; otherCardId?: string; evidenceId?: string; note: string; taskId?: string }, now = new Date()) {
  const open = c.evidenceId
    ? db.prepare(`SELECT 1 FROM kb_conflicts WHERE evidence_id = ? AND status = 'open'`).get(c.evidenceId)
    : db
        .prepare(`SELECT 1 FROM kb_conflicts WHERE status = 'open' AND evidence_id IS NULL AND ((card_id = ? AND other_card_id IS ?) OR (card_id = ? AND other_card_id = ?))`)
        .get(c.cardId, c.otherCardId ?? null, c.otherCardId ?? '', c.cardId);
  if (open) return;
  db.prepare('INSERT INTO kb_conflicts (id, store_id, card_id, other_card_id, evidence_id, note, task_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    randomUUID(), c.storeId, c.cardId, c.otherCardId ?? null, c.evidenceId ?? null, c.note.slice(0, 600), c.taskId ?? null, now.toISOString(),
  );
}

// ---- evidence

function toEvidence(r: Row): KbEvidence {
  return {
    id: String(r.id),
    cardId: String(r.card_id),
    kind: r.kind as KbEvidence['kind'],
    text: String(r.text),
    ...(r.source_id && r.s_id
      ? {
          source: {
            id: String(r.s_id),
            ...(r.s_url ? { url: String(r.s_url) } : {}),
            title: String(r.s_title),
            status: r.s_status as KbSourceStatus,
            reliability: r.s_reliability as KbSourceReliability,
            ...(r.s_fetched_at ? { fetchedAt: String(r.s_fetched_at) } : {}),
          },
        }
      : {}),
    ...(r.observation_id ? { observationId: String(r.observation_id) } : {}),
    ...(r.metric != null ? { metric: String(r.metric) } : {}),
    ...(r.value != null ? { value: num(r.value) } : {}),
    ...(r.baseline != null ? { baseline: num(r.baseline) } : {}),
    ...(r.window_from ? { windowFrom: String(r.window_from) } : {}),
    ...(r.window_to ? { windowTo: String(r.window_to) } : {}),
    ...(r.sample_size != null ? { sampleSize: num(r.sample_size) } : {}),
    ...(r.test_ref ? { testRef: String(r.test_ref) } : {}),
    ...(r.merged_from ? { mergedFrom: String(r.merged_from) } : {}),
    authorId: String(r.author_id),
    ...(r.run_id ? { runId: String(r.run_id) } : {}),
    ...(r.task_id ? { taskId: String(r.task_id) } : {}),
    createdAt: String(r.created_at),
  };
}

export function listEvidence(db: DatabaseSync, cardId: string): KbEvidence[] {
  return db
    .prepare(
      `SELECT e.*, s.id AS s_id, s.url AS s_url, s.title AS s_title, s.status AS s_status, s.reliability AS s_reliability, s.fetched_at AS s_fetched_at
       FROM kb_evidence e LEFT JOIN kb_sources s ON s.id = e.source_id WHERE e.card_id = ? ORDER BY e.created_at, e.rowid`,
    )
    .all(cardId)
    .map(toEvidence);
}

export type NewKbEvidence = KbEvidenceInput & { authorId: string; runId?: string; taskId?: string; observationId?: string };

/**
 * Adds evidence (the source, if any, is in the card's workspace: the caller checks). Evidence against opens a conflict.
 * The card's stage is weighed again and it counts as verified now; a cited source may link it to cards citing the same.
 */
export function addEvidence(db: DatabaseSync, cardId: string, e: NewKbEvidence, now = new Date()): KbCard {
  const id = randomUUID();
  const at = now.toISOString();
  // Checked again past its category's age (KB-23): its history says so, and the Research Center shows it this week.
  const was = db.prepare('SELECT category_id, coalesce(verified_at, created_at) AS seen FROM kb_cards WHERE id = ?').get(cardId)!;
  const days = Math.floor((now.getTime() - Date.parse(String(was.seen))) / DAY);
  if (e.kind !== 'conflict' && days > freshness(db)(String(was.category_id))) revise(db, cardId, e.authorId, `Refreshed: new ${e.kind} evidence after ${days} days`, at);
  db.prepare(
    `INSERT INTO kb_evidence (id, card_id, kind, text, source_id, observation_id, metric, value, baseline, window_from, window_to, sample_size, test_ref,
       author_id, run_id, task_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, cardId, e.kind, e.text, e.sourceId ?? null, e.observationId ?? null, e.metric ?? null, e.value ?? null, e.baseline ?? null, e.windowFrom ?? null,
    e.windowTo ?? null, e.sampleSize ?? null, e.testRef ?? null, e.authorId, e.runId ?? null, e.taskId ?? null, at,
  );
  db.prepare('UPDATE kb_cards SET verified_at = ? WHERE id = ?').run(at, cardId);
  if (e.kind === 'conflict') {
    const storeId = opt(db.prepare('SELECT store_id FROM kb_cards WHERE id = ?').get(cardId)?.store_id) ?? null;
    openConflict(db, { storeId, cardId, evidenceId: id, note: e.text, taskId: e.taskId }, now);
  }
  settleStage(db, cardId, e.kind === 'conflict' ? 'contradicting evidence' : undefined, now);
  if (e.sourceId) suggestLinks(db, cardId, now);
  return getCard(db, cardId)!;
}

export function deleteEvidence(db: DatabaseSync, evidenceId: string, now = new Date()): KbCard | undefined {
  const cardId = opt(db.prepare('SELECT card_id FROM kb_evidence WHERE id = ?').get(evidenceId)?.card_id);
  if (!cardId) return undefined;
  db.prepare('DELETE FROM kb_evidence WHERE id = ?').run(evidenceId);
  settleStage(db, cardId, 'evidence removed', now);
  return getCard(db, cardId);
}

// ---- links

const toLink = (r: Row): KbLink => ({
  id: String(r.id),
  storeId: opt(r.store_id) ?? null,
  fromId: String(r.from_id),
  toId: String(r.to_id),
  type: r.type as KbLinkType,
  why: String(r.why),
  status: r.status as KbLinkStatus,
  ...(r.score != null ? { score: Number(r.score) } : {}),
  authorId: String(r.author_id),
  createdAt: String(r.created_at),
  ...(r.decided_at ? { decidedAt: String(r.decided_at) } : {}),
});

/** The workspace's links (rejected ones left out), or one card's. */
export function listLinks(db: DatabaseSync, ws: KbWorkspace | 'all', general = false, cardId?: string): KbLink[] {
  const s = kbScope(ws, general);
  const card = cardId ? ' AND (from_id = ? OR to_id = ?)' : '';
  return db
    .prepare(`SELECT * FROM kb_links WHERE ${s.sql} AND status != 'rejected'${card} ORDER BY created_at, rowid`)
    .all(...s.params, ...(cardId ? [cardId, cardId] : []))
    .map(toLink);
}

/** True when the two cards are already linked, either way round, in any state (a rejected link is never suggested again). */
export const linked = (db: DatabaseSync, a: string, b: string, type?: KbLinkType) =>
  !!db.prepare(`SELECT 1 FROM kb_links WHERE ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))${type ? ' AND type = ?' : ''}`).get(a, b, b, a, ...(type ? [type] : []));

/** Saves a link; the caller has checked both cards are visible from `storeId`'s workspace. A contradiction opens a conflict. */
export function createLink(
  db: DatabaseSync,
  storeId: string | null,
  l: { from: string; to: string; type: KbLinkType; why: string; authorId: string; status: KbLinkStatus; score?: number },
  now = new Date(),
): KbLink {
  const id = randomUUID();
  const at = now.toISOString();
  db.prepare('INSERT INTO kb_links (id, store_id, from_id, to_id, type, why, status, score, author_id, created_at, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    id, storeId, l.from, l.to, l.type, l.why, l.status, l.score ?? null, l.authorId, at, l.status === 'suggested' ? null : at,
  );
  if (l.type === 'contradicts' && l.status !== 'rejected') openConflict(db, { storeId, cardId: l.from, otherCardId: l.to, note: l.why }, now);
  return toLink(db.prepare('SELECT * FROM kb_links WHERE id = ?').get(id)!);
}

/** The owner accepts or rejects a link. Rejecting a contradiction closes the conflict it opened. */
export function decideLink(db: DatabaseSync, id: string, status: 'confirmed' | 'rejected', now = new Date()): KbLink {
  const at = now.toISOString();
  db.prepare('UPDATE kb_links SET status = ?, decided_at = ? WHERE id = ?').run(status, at, id);
  const l = toLink(db.prepare('SELECT * FROM kb_links WHERE id = ?').get(id)!);
  if (l.type === 'contradicts' && status === 'confirmed') openConflict(db, { storeId: l.storeId, cardId: l.fromId, otherCardId: l.toId, note: l.why }, now);
  if (l.type === 'contradicts' && status === 'rejected')
    db.prepare(`UPDATE kb_conflicts SET status = 'resolved', resolved_at = ? WHERE status = 'open' AND ((card_id = ? AND other_card_id = ?) OR (card_id = ? AND other_card_id = ?))`).run(at, l.fromId, l.toId, l.toId, l.fromId);
  return l;
}

// ---- the suggester

const STOP = new Set(
  'the and for with that this from are was were has have had our your their more most than then into over when what which who how why about they them its can will does did also just very much many some such only other each per via all any out off'.split(' '),
);
const NEG = new Set(['not', 'no', 'never', "don't", "doesn't", "didn't", "isn't", "aren't", "wasn't", "won't", "can't", 'cannot', 'fails', 'failed', 'hurts', 'hurt']);
const tokens = (t: string) => new Set((t.toLowerCase().match(/[\p{L}\p{N}']{3,}/gu) ?? []).filter((w) => !STOP.has(w) && !NEG.has(w)));
const negated = (t: string) => (t.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []).some((w) => NEG.has(w));
const textOf = (r: Row) => `${r.title} ${r.summary} ${(JSON.parse(String(r.tags ?? '[]')) as string[]).join(' ')}`;
const rootOf = (db: DatabaseSync, categoryId: string) =>
  opt(
    db.prepare('WITH RECURSIVE up(id, parent_id, name) AS (SELECT id, parent_id, name FROM kb_categories WHERE id = ? UNION ALL SELECT c.id, c.parent_id, c.name FROM kb_categories c JOIN up ON c.id = up.parent_id) SELECT lower(name) AS name FROM up WHERE parent_id IS NULL').get(categoryId)?.name,
  );

/**
 * The card in `ws` (its own workspace only) that already says this: one with the same title in any state, else a live
 * one sharing 60%+ of the words of the title and summary. Research merges a finding into it instead of a duplicate.
 */
export function sameCard(db: DatabaseSync, ws: KbWorkspace, title: string, summary: string): { id: string; live: boolean } | undefined {
  const s = kbScope(ws);
  const exact = db.prepare(`SELECT id, status FROM kb_cards WHERE ${s.sql} AND lower(title) = lower(?)`).get(...s.params, title);
  if (exact) return { id: String(exact.id), live: ['proposed', 'active'].includes(String(exact.status)) };
  const mine = tokens(`${title} ${summary}`);
  const terms = [...mine].slice(0, 24);
  if (!terms.length) return undefined;
  const best = db
    .prepare(`SELECT k.* FROM kb_cards_fts JOIN kb_cards k ON k.seq = kb_cards_fts.rowid WHERE kb_cards_fts MATCH ? AND ${kbScope(ws, false, 'k.store_id').sql} AND k.status IN ('proposed', 'active') LIMIT 50`)
    .all(terms.map((t) => `"${t.replace(/"/g, '')}"`).join(' OR '), ...s.params)
    .map((k) => {
      const theirs = tokens(`${k.title} ${k.summary}`);
      const shared = [...mine].filter((w) => theirs.has(w)).length;
      return { id: String(k.id), j: shared / (mine.size + theirs.size - shared || 1) };
    })
    .sort((a, b) => b.j - a.j)[0];
  return best && best.j >= 0.6 ? { id: best.id, live: true } : undefined;
}

/**
 * Suggests up to 3 links for a card, deterministically: word overlap (found through the FTS index), the same category,
 * and sources both cite. A store card looks at its store and General, a General card at General only. A near-identical
 * claim that one side negates is a possible contradiction, which also opens a conflict. Pairs already linked in any
 * state, rejected included, are left alone, so the artboard isn't cluttered with weak or refused lines.
 */
// ponytail: up to 50 FTS candidates scored in JS; enough while a workspace holds a few thousand cards.
export function suggestLinks(db: DatabaseSync, cardId: string, now = new Date()): KbLink[] {
  const c = db.prepare('SELECT * FROM kb_cards WHERE id = ?').get(cardId);
  if (!c || !['proposed', 'active'].includes(String(c.status))) return [];
  const ws = opt(c.store_id) ?? null;
  const s = kbScope(ws, ws !== null, 'k.store_id');
  const mine = tokens(textOf(c));
  const candidates = new Map<string, Row>();
  const terms = [...mine].slice(0, 24);
  if (terms.length)
    for (const r of db
      .prepare(`SELECT k.* FROM kb_cards_fts JOIN kb_cards k ON k.seq = kb_cards_fts.rowid WHERE kb_cards_fts MATCH ? AND ${s.sql} AND k.id != ? AND k.status IN ('proposed', 'active') LIMIT 50`)
      .all(terms.map((t) => `"${t.replace(/"/g, '')}"`).join(' OR '), ...s.params, cardId))
      candidates.set(String(r.id), r);
  const cited = new Map<string, string>();
  for (const r of db
    .prepare(
      `SELECT k.*, src.title AS source_title FROM kb_evidence e JOIN kb_evidence o ON o.source_id = e.source_id AND o.card_id != e.card_id
       JOIN kb_cards k ON k.id = o.card_id JOIN kb_sources src ON src.id = e.source_id WHERE e.card_id = ? AND ${s.sql} AND k.status IN ('proposed', 'active')`,
    )
    .all(cardId, ...s.params)) {
    candidates.set(String(r.id), r);
    cited.set(String(r.id), String(r.source_title || 'the same source'));
  }
  const root = rootOf(db, String(c.category_id));
  const scored = [...candidates.values()]
    .filter((k) => !linked(db, cardId, String(k.id)))
    .map((k) => {
      const theirs = tokens(textOf(k));
      const shared = [...mine].filter((w) => theirs.has(w));
      const j = shared.length / (mine.size + theirs.size - shared.length || 1);
      const place = k.category_id === c.category_id ? 0.15 : rootOf(db, String(k.category_id)) === root ? 0.05 : 0;
      const source = cited.get(String(k.id));
      return { k, shared, j, source, score: j + place + (source ? 0.3 : 0) };
    })
    .filter((x) => x.score >= 0.35)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  return scored.map(({ k, shared, j, source, score }) => {
    const against = j >= 0.4 && negated(textOf(c)) !== negated(textOf(k));
    const type: KbLinkType = against ? 'contradicts' : ws && k.store_id == null ? 'builds_upon' : 'related_to';
    const words = shared.slice(0, 5).join(', ');
    const why = against ? `Possible contradiction: the same claim (${words}), but one of them says it doesn't hold` : source ? `Both cite "${source}"` : `Same topic: ${words}`;
    return createLink(db, ws ?? opt(k.store_id) ?? null, { from: cardId, to: String(k.id), type, why, authorId: 'app', status: 'suggested', score: Math.round(score * 100) / 100 }, now);
  });
}

/**
 * The maintenance pass over one workspace's live cards (KB-23), for the pairs suggestLinks missed (edited since, past its
 * top 3, made before it): a near-identical claim one side negates is a contradiction, and a near-identical pair (60%+
 * shared words) suggests merging the weaker card (lower stage, else newer) into the other. A pair already linked that
 * way, in any state, is left alone, so a rejected suggestion or a kept contradiction doesn't come back.
 */
// ponytail: every live card against its 50 FTS neighbours each pass; scan only cards changed since the last pass past a few thousand.
export function scanCards(db: DatabaseSync, ws: KbWorkspace, now = new Date()): { duplicates: number; contradictions: number } {
  const s = kbScope(ws, false, 'k.store_id');
  const stage = (k: Row) => Object.keys(KB_STAGES).indexOf(String(k.stage));
  const n = { duplicates: 0, contradictions: 0 };
  for (const c of db.prepare(`SELECT * FROM kb_cards k WHERE ${s.sql} AND k.status IN ('proposed', 'active') ORDER BY k.seq`).all(...s.params)) {
    const mine = tokens(textOf(c));
    const terms = [...mine].slice(0, 24);
    if (!terms.length) continue;
    const later = db
      .prepare(`SELECT k.* FROM kb_cards_fts JOIN kb_cards k ON k.seq = kb_cards_fts.rowid WHERE kb_cards_fts MATCH ? AND ${s.sql} AND k.seq > ? AND k.status IN ('proposed', 'active') LIMIT 50`)
      .all(terms.map((t) => `"${t.replace(/"/g, '')}"`).join(' OR '), ...s.params, Number(c.seq));
    for (const k of later) {
      const theirs = tokens(textOf(k));
      const shared = [...mine].filter((w) => theirs.has(w));
      const j = shared.length / (mine.size + theirs.size - shared.length || 1);
      const against = negated(textOf(c)) !== negated(textOf(k));
      const type: KbLinkType | undefined = against ? (j >= 0.4 ? 'contradicts' : undefined) : j >= 0.6 ? 'duplicates' : undefined;
      if (!type || linked(db, String(c.id), String(k.id), type)) continue;
      const keepC = stage(c) !== stage(k) ? stage(c) > stage(k) : String(c.created_at) <= String(k.created_at);
      const [from, to] = keepC ? [k, c] : [c, k];
      const words = shared.slice(0, 5).join(', ');
      const why = against ? `Possible contradiction: the same claim (${words}), but one of them says it doesn't hold` : `Possible duplicate: they share most of their words (${words})`;
      createLink(db, ws, { from: String(from.id), to: String(to.id), type, why, authorId: 'app', status: 'suggested', score: Math.round(j * 100) / 100 }, now);
      n[against ? 'contradictions' : 'duplicates']++;
    }
  }
  return n;
}

// ---- merging, detaching and revisions

/** Merges `fromId` into `keepId` (same workspace): its evidence and tags move over, marked so they can be detached again. */
export function mergeCards(db: DatabaseSync, keepId: string, fromId: string, actor: string, now = new Date()): KbCard {
  const at = now.toISOString();
  const keep = db.prepare('SELECT title, tags FROM kb_cards WHERE id = ?').get(keepId)!;
  const from = db.prepare('SELECT title, tags FROM kb_cards WHERE id = ?').get(fromId)!;
  const tags = [...new Map([...(JSON.parse(String(keep.tags)) as string[]), ...(JSON.parse(String(from.tags)) as string[])].map((t) => [t.toLowerCase(), t])).values()];
  db.prepare('UPDATE kb_evidence SET card_id = ?, merged_from = coalesce(merged_from, ?) WHERE card_id = ?').run(keepId, fromId, fromId);
  db.prepare('UPDATE kb_cards SET tags = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(tags), at, keepId);
  // Cards merged into `fromId` earlier follow their evidence, so they stay detachable from `keepId`.
  db.prepare('UPDATE kb_cards SET merged_into = ? WHERE merged_into = ?').run(keepId, fromId);
  db.prepare(`UPDATE kb_cards SET status = 'merged', merged_into = ?, updated_at = ? WHERE id = ?`).run(keepId, at, fromId);
  revise(db, keepId, actor, `Merged in "${from.title}"`, at);
  revise(db, fromId, actor, `Merged into "${keep.title}"`, at);
  settleStage(db, keepId, undefined, now);
  return getCard(db, keepId)!;
}

/** Undoes a merge: the merged card gets its evidence back and is active again. Both cards' stages are weighed again. */
export function detachMerged(db: DatabaseSync, keepId: string, fromId: string, actor: string, now = new Date()): KbCard | undefined {
  const from = db.prepare(`SELECT title FROM kb_cards WHERE id = ? AND status = 'merged' AND merged_into = ?`).get(fromId, keepId);
  if (!from) return undefined;
  const keep = db.prepare('SELECT title FROM kb_cards WHERE id = ?').get(keepId)!;
  const at = now.toISOString();
  db.prepare('UPDATE kb_evidence SET card_id = ?, merged_from = NULL WHERE card_id = ? AND merged_from = ?').run(fromId, keepId, fromId);
  db.prepare(`UPDATE kb_cards SET status = 'active', merged_into = NULL, updated_at = ? WHERE id = ?`).run(at, fromId);
  revise(db, keepId, actor, `Detached "${from.title}"`, at);
  revise(db, fromId, actor, `Detached from "${keep.title}"`, at);
  settleStage(db, keepId, 'evidence removed', now);
  settleStage(db, fromId, undefined, now);
  return getCard(db, fromId);
}

const SNAPSHOT = { title: 'title', summary: 'summary', body: 'body', relevance: 'relevance', application: 'application', appliesTo: 'applies_to', limits: 'limits', categoryId: 'category_id', type: 'type', stage: 'stage', status: 'status' } as const;

/** The card's history, newest first. */
export function listRevisions(db: DatabaseSync, cardId: string): KbRevision[] {
  return db
    .prepare('SELECT * FROM kb_revisions WHERE card_id = ? ORDER BY id DESC')
    .all(cardId)
    .map((r) => {
      const snap = JSON.parse(String(r.snapshot_json)) as Row;
      const snapshot = Object.fromEntries(Object.entries(SNAPSHOT).map(([k, col]) => [k, String(snap[col] ?? '')]));
      return {
        id: Number(r.id),
        cardId: String(r.card_id),
        actor: String(r.actor),
        reason: String(r.reason),
        createdAt: String(r.created_at),
        snapshot: { ...snapshot, tags: JSON.parse(String(snap.tags ?? '[]')) } as KbRevision['snapshot'],
      };
    });
}

const RESTORED = ['title', 'summary', 'body', 'relevance', 'application', 'applies_to', 'limits', 'tags', 'type', 'prev_type', 'stage', 'pinned', 'blocked_roles', 'research_marked'];

/**
 * Puts the card back as it was after revision `revId`, as a new revision. Its category comes back if it still exists,
 * and its status unless a merge is involved (detach undoes those). A stage the owner restores stays where they put it.
 */
export function restoreRevision(db: DatabaseSync, cardId: string, revId: number, actor: string, now = new Date()): KbCard | undefined {
  const rev = db.prepare('SELECT snapshot_json FROM kb_revisions WHERE id = ? AND card_id = ?').get(revId, cardId);
  if (!rev) return undefined;
  const snap = JSON.parse(String(rev.snapshot_json)) as Row;
  const cur = db.prepare('SELECT store_id, stage, status FROM kb_cards WHERE id = ?').get(cardId)!;
  const sets: Record<string, string | number | null> = Object.fromEntries(RESTORED.filter((k) => k in snap).map((k) => [k, (snap[k] ?? null) as string | number | null]));
  if (db.prepare('SELECT 1 FROM kb_categories WHERE id = ? AND store_id IS ?').get(String(snap.category_id), cur.store_id ?? null)) sets.category_id = String(snap.category_id);
  if (snap.status !== 'merged' && cur.status !== 'merged') sets.status = String(snap.status);
  if (actor === 'owner' && sets.stage !== cur.stage) sets.stage_by_owner = 1;
  const at = now.toISOString();
  sets.updated_at = at;
  db.prepare(`UPDATE kb_cards SET ${Object.keys(sets).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(sets), cardId);
  revise(db, cardId, actor, `Restored revision ${revId}`, at);
  return getCard(db, cardId);
}

// ---- findings from ordinary runs (ai-agents lane, decision 11)

export interface Finding {
  title: string;
  summary: string;
  body?: string;
  tag: FindingTag;
  /** URLs and [kb:id]s the finding cites: written into its evidence row as text, never as sources. */
  sources: string[];
}
export type Captured = { kind: 'saved' | 'added' | 'general'; card: KbCard } | { kind: 'refused'; reason: string };

/**
 * A finding into the run's store: a new hypothesis card, or one more 'observed' row on the live store card that says
 * it already. A General card that says it takes nothing; an archived or rejected one refuses it. The row doesn't count
 * as verifying the card (no verified_at, no 'Refreshed' revision) and no read source is made, so it never climbs the
 * ladder. `unreviewed`: save_finding's Automatically mode, proposed whatever the review setting (no one read the text).
 */
export function captureFinding(db: DatabaseSync, storeId: string, f: Finding, by: { agentId: string; runId: string; unreviewed?: boolean }, now = new Date()): Captured {
  const forbidden = agentCardError({ type: 'hypothesis', stage: 'hypothesis' });
  if (forbidden) return { kind: 'refused', reason: forbidden };
  const refused = (id: string) => ({ kind: 'refused' as const, reason: `the owner archived or rejected a card that says this ("${getCard(db, id)?.title}")` });
  const own = sameCard(db, storeId, f.title, f.summary);
  if (own && !own.live) return refused(own.id);
  const general = own ? undefined : sameCard(db, null, f.title, f.summary);
  if (general) return general.live ? { kind: 'general', card: getCard(db, general.id)! } : refused(general.id);
  const at = now.toISOString();
  const cardId =
    own?.id ??
    createCard(
      db,
      storeId,
      {
        categoryId: ensureCategoryPath(db, storeId, ['Findings']), title: f.title, summary: f.summary, body: f.body ?? '', type: 'hypothesis', stage: 'hypothesis',
        status: by.unreviewed || kbControls(db, storeId).review ? 'proposed' : 'active', authorId: by.agentId, origin: 'agent', runId: by.runId,
      },
      now,
    ).id;
  const text = [f.tag === 'untagged' ? 'untagged' : `[${f.tag}]`, ...f.sources].join(' ');
  db.prepare(`INSERT INTO kb_evidence (id, card_id, kind, text, author_id, run_id, created_at) VALUES (?, ?, 'observed', ?, ?, ?, ?)`).run(randomUUID(), cardId, text, by.agentId, by.runId, at);
  return { kind: own ? 'added' : 'saved', card: getCard(db, cardId)! };
}
