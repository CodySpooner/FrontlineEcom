import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { MemoryKind, StoreMemory } from '@frontline/shared';

// Rows live in `store_memory` + FTS5 index `store_memory_fts` (agents-lane migration in apps/server/src/db.ts).

export interface NewMemory {
  storeId: string;
  agentId: string;
  kind: MemoryKind;
  text: string;
  evidence?: string;
  confidence: number;
  tags?: string[];
  /** The run that learned it: outcomes of that run's requests move its confidence (judgeRun). */
  runId?: string;
}

const KINDS: MemoryKind[] = ['fact', 'learning', 'preference'];
const clamp = (n: number) => Math.min(1, Math.max(0, n));

/** Tags only the app sets: `outcome` (a measured result of an approved change) and `denied` (the owner's no). */
export const agentTags = (tags: string[] = []) => tags.filter((t) => !['outcome', 'denied'].includes(t.trim().toLowerCase()));

/** Saves a memory. The same text (case-insensitive) for the same store is merged instead of duplicated. */
export function writeMemory(db: DatabaseSync, m: NewMemory, now = new Date()): StoreMemory {
  const text = m.text.trim();
  const same = db.prepare('SELECT * FROM store_memory WHERE store_id = ? AND lower(text) = lower(?)').get(m.storeId, text);
  if (same?.agent_id === 'owner' && m.agentId !== 'owner') return toMemory(same); // the owner's note stays theirs, evidence and all
  // A measured result stays the app's: an agent restating it word for word mustn't swap in its own evidence or confidence
  // under the "measured" label (agents can't tag `outcome`, agentTags).
  if (same && parseTags(same.tags).includes('outcome') && !m.tags?.includes('outcome') && m.agentId !== 'owner') return toMemory(same);
  // The owner writing what the squad wrote makes it the owner's note: kept at go-live and past the cap, not judged by outcomes.
  if (same && m.agentId === 'owner') db.prepare(`UPDATE store_memory SET agent_id = 'owner', run_id = NULL, kind = ? WHERE id = ?`).run(m.kind, String(same.id));
  if (same) {
    const tags = [...new Set([...parseTags(same.tags), ...(m.tags ?? [])])];
    db.prepare('UPDATE store_memory SET confidence = max(confidence, ?), evidence = coalesce(?, evidence), tags = ? WHERE id = ?').run(
      clamp(m.confidence),
      m.evidence ?? null,
      JSON.stringify(tags),
      String(same.id),
    );
    return getMemory(db, String(same.id))!;
  }
  const id = randomUUID();
  db.prepare(
    'INSERT INTO store_memory (id, store_id, agent_id, kind, text, evidence, confidence, tags, created_at, run_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, m.storeId, m.agentId, m.kind, text, m.evidence ?? null, clamp(m.confidence), JSON.stringify(m.tags ?? []), now.toISOString(), m.runId ?? null);
  const written = getMemory(db, id)!;
  // The daily jobs would pile up thousands (an unpaged Knowledge Base, a pairwise promotion scan): past the cap the
  // weakest agent facts and learnings go, oldest first; the one just written, measured outcomes and proven ones (0.8+)
  // go last. Pins, preferences and the owner's notes stay.
  db.prepare(
    `DELETE FROM store_memory WHERE id IN (
       SELECT id FROM store_memory WHERE store_id = ? AND agent_id != 'owner' AND kind IN ('fact', 'learning') AND pinned = 0
       ORDER BY id = ? DESC, (confidence >= 0.8 OR tags LIKE '%"outcome"%') DESC, created_at DESC, rowid DESC LIMIT -1 OFFSET ?)`,
  ).run(m.storeId, id, MEMORY_CAP);
  return written;
}

/** Agent-written facts and learnings a store keeps (writeMemory). */
export const MEMORY_CAP = 300;

export function getMemory(db: DatabaseSync, id: string): StoreMemory | undefined {
  const row = db.prepare('SELECT * FROM store_memory WHERE id = ?').get(id);
  return row && toMemory(row);
}

/** Every memory of a store, pinned first, then newest first (Knowledge Base / agent detail). */
export const listMemory = (db: DatabaseSync, storeId: string) =>
  db.prepare('SELECT * FROM store_memory WHERE store_id = ? ORDER BY pinned DESC, created_at DESC, rowid DESC').all(storeId).map(toMemory);

/** The owner's edit (Knowledge Base). Rewording a squad memory makes it the owner's; a pin or a confidence change doesn't. */
export function updateMemory(db: DatabaseSync, id: string, patch: Partial<Pick<StoreMemory, 'text' | 'evidence' | 'confidence' | 'tags' | 'kind' | 'pinned'>>) {
  const cur = getMemory(db, id);
  if (!cur) return undefined;
  const next = { ...cur, ...patch };
  const reworded = next.text.trim() !== cur.text;
  db.prepare(`UPDATE store_memory SET text = ?, evidence = ?, confidence = ?, tags = ?, kind = ?, pinned = ?${reworded ? ", agent_id = 'owner', run_id = NULL" : ''} WHERE id = ?`).run(
    next.text.trim(),
    next.evidence ?? null,
    clamp(next.confidence),
    JSON.stringify(next.tags),
    next.kind,
    next.pinned ? 1 : 0,
    id,
  );
  return getMemory(db, id);
}

export const deleteMemory = (db: DatabaseSync, id: string) => db.prepare('DELETE FROM store_memory WHERE id = ?').run(id).changes > 0;

/** Outcome feedback: a confirmed learning gains confidence, a contradicted one loses it. */
export function adjustConfidence(db: DatabaseSync, id: string, delta: number) {
  db.prepare('UPDATE store_memory SET confidence = min(1, max(0, confidence + ?)) WHERE id = ?').run(delta, id);
  return getMemory(db, id);
}

/** True the first time it's called for `ref`, false ever after (the `done_once` ledger). */
export const once = (db: DatabaseSync, ref: string, now = new Date()) =>
  db.prepare('INSERT OR IGNORE INTO done_once (ref, at) VALUES (?, ?)').run(ref, now.toISOString()).changes > 0;

/**
 * Outcome of a request a run made (an ad change, a product): the learnings that run wrote gain confidence when it
 * worked and lose it when it didn't. Once per outcome `ref`.
 */
// ponytail: moves every learning of the run, not only the ones behind the request; match on tags if that misfires.
export function judgeRun(db: DatabaseSync, ref: string, runId: string, worked: boolean, now = new Date()) {
  if (!once(db, ref, now)) return [];
  return db
    .prepare('SELECT id FROM store_memory WHERE run_id = ?')
    .all(runId)
    .map((r) => adjustConfidence(db, String(r.id), worked ? 0.1 : -0.1)!);
}

/**
 * Pinned memories, the owner's notes and no's (however old or off-topic: the prompt fits them in first), then the top-k
 * others for a task: relevance × recency × confidence.
 * relevance = 0.3 + bm25 share of the best match (unmatched memories can still rank on confidence + recency),
 * recency = 0.2 + 0.8 × 0.5^(age / 90 days). Marks the returned memories as used.
 */
const always = (m: StoreMemory) => m.pinned || m.agentId === 'owner' || m.tags.includes('denied');

// ponytail: scores every memory of the store in JS; fine to a few thousand rows per store.
export function searchMemory(db: DatabaseSync, storeId: string, query = '', k = 8, now = new Date()): StoreMemory[] {
  const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].slice(0, 24);
  const bm25 = new Map<string, number>();
  if (terms.length) {
    const rows = db
      .prepare(
        `SELECT m.id, bm25(store_memory_fts) AS r FROM store_memory_fts JOIN store_memory m ON m.rowid = store_memory_fts.rowid
         WHERE store_memory_fts MATCH ? AND m.store_id = ?`,
      )
      .all(terms.map((t) => `"${t}"`).join(' OR '), storeId);
    for (const r of rows) bm25.set(String(r.id), -Number(r.r));
  }
  const best = Math.max(0, ...bm25.values()) || 1;
  const day = 86_400_000;
  const scored = db
    .prepare('SELECT * FROM store_memory WHERE store_id = ?')
    .all(storeId)
    .map(toMemory)
    .map((m) => {
      const relevance = 0.3 + (bm25.get(m.id) ?? 0) / best;
      const age = Math.max(0, now.getTime() - Date.parse(m.createdAt)) / day;
      return { m, score: relevance * (0.2 + 0.8 * 0.5 ** (age / 90)) * m.confidence };
    })
    .sort((a, b) => Number(always(b.m)) - Number(always(a.m)) || Number(!!b.m.pinned) - Number(!!a.m.pinned) || b.score - a.score);
  const ranked = scored.slice(0, k + scored.filter((s) => always(s.m)).length).map((s) => s.m);
  const used = db.prepare('UPDATE store_memory SET last_used_at = ? WHERE id = ?');
  for (const m of ranked) used.run(now.toISOString(), m.id);
  return ranked;
}

/** Appended to a finished run (same session) to extract what is worth remembering. */
export const REFLECTION_PROMPT = `Before you finish: what did this run teach you about this store that will still matter next month?
Reply with only a JSON array (no prose), at most 5 items, [] if nothing durable:
[{"kind":"fact|learning|preference","text":"one sentence","evidence":"the numbers or source behind it","confidence":0.0-1.0,"tags":["short","tags"]}]
Skip anything already in "What the squad has learned", generic advice, and guesses without evidence.`;

/** Parses the reflection reply. Tolerates prose or code fences around the array; drops invalid items. */
export function parseLearnings(reply: string): Omit<NewMemory, 'storeId' | 'agentId'>[] {
  const start = reply.indexOf('[');
  const end = reply.lastIndexOf(']');
  if (start < 0 || end < start) return [];
  let items: unknown;
  try {
    items = JSON.parse(reply.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(items)) return [];
  return items
    .filter((i): i is Record<string, unknown> => typeof i === 'object' && i !== null)
    // write_memory's limits: every prompt carries the squad's memories, so a paragraph-long one costs every run.
    .filter((i) => typeof i.text === 'string' && i.text.trim().length >= 5 && i.text.trim().length <= 300 && KINDS.includes(i.kind as MemoryKind))
    .slice(0, 5)
    .map((i) => ({
      kind: i.kind as MemoryKind,
      text: (i.text as string).trim(),
      ...(typeof i.evidence === 'string' && i.evidence ? { evidence: i.evidence.slice(0, 300) } : {}),
      confidence: clamp(typeof i.confidence === 'number' ? i.confidence : 0.5),
      tags: agentTags(Array.isArray(i.tags) ? i.tags.filter((t): t is string => typeof t === 'string') : []).slice(0, 6),
    }));
}

const words = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);

/**
 * Learnings that hold in 2+ of these stores (one niche's; confident, ≥50% word overlap): candidates to promote
 * into the niche pack so the next store in that niche starts smarter. Promotion itself needs approval.
 */
// ponytail: pairwise Jaccard over confident memories; switch to FTS lookups if a niche grows past ~1k of them.
export function promotionCandidates(db: DatabaseSync, storeIds: string[], minConfidence = 0.7) {
  const rows = db
    .prepare(
      `SELECT * FROM store_memory WHERE store_id IN (SELECT value FROM json_each(?)) AND kind = 'learning' AND confidence >= ? ORDER BY confidence DESC`,
    )
    .all(JSON.stringify(storeIds), minConfidence)
    .map(toMemory);
  const out: { text: string; storeIds: string[]; memoryIds: string[]; confidence: number }[] = [];
  const taken = new Set<string>();
  const sets = new Map(rows.map((m) => [m.id, words(m.text)])); // once each: the scan below is pairwise
  for (const a of rows) {
    if (taken.has(a.id)) continue;
    const wa = sets.get(a.id)!;
    const group = rows.filter((b) => {
      if (taken.has(b.id) || b.storeId === a.storeId) return false;
      const wb = sets.get(b.id)!;
      const shared = [...wa].filter((w) => wb.has(w)).length;
      return shared / (wa.size + wb.size - shared) >= 0.5;
    });
    if (!group.length) continue;
    const all = [a, ...group];
    all.forEach((m) => taken.add(m.id));
    out.push({
      text: a.text,
      storeIds: [...new Set(all.map((m) => m.storeId))],
      memoryIds: all.map((m) => m.id),
      confidence: all.reduce((s, m) => s + m.confidence, 0) / all.length,
    });
  }
  return out;
}

function parseTags(raw: unknown): string[] {
  try {
    const tags = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(tags) ? tags.map(String) : [];
  } catch {
    return [];
  }
}

function toMemory(r: Record<string, unknown>): StoreMemory {
  return {
    id: String(r.id),
    storeId: String(r.store_id),
    agentId: String(r.agent_id),
    kind: r.kind as MemoryKind,
    text: String(r.text),
    ...(r.evidence ? { evidence: String(r.evidence) } : {}),
    confidence: Number(r.confidence),
    tags: parseTags(r.tags),
    createdAt: String(r.created_at),
    ...(r.pinned ? { pinned: true } : {}),
  };
}
