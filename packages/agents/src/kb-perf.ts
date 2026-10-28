import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { createCard, ensureCategoryPath } from './kb';
import { addEvidence } from './kb-links';

// Performance learning (knowledge-base lane, KB-19, decision 13). A store's own numbers, read against a baseline
// (apps/server/src/kb/performance.ts), become Performance Lesson cards or evidence on the ones they already made, and
// approved changes' outcomes become evidence on the cards their run cited. One path for every analyzer. The numbers and
// the verdict are the app's, never an agent's.

export type Lift = { ratio: number; low: number; high: number; z: number };

/**
 * `value` against `baseline`: the ratio, its 95% range, and z (the gap in standard errors). Each side is taken as noisy
 * as a count of `k` (purchases, clicks, orders, units). ponytail: Poisson on a log scale. ROAS is as noisy as its
 * purchases (the spread of order values is left out, so its range errs narrow); an average passes orders / (sd/mean)².
 */
export function lift(value: number, k: number, baseline: number, kBase: number): Lift {
  const ln = Math.log(value / baseline);
  const se = Math.sqrt(1 / k + 1 / kBase);
  return { ratio: value / baseline, low: Math.exp(ln - 1.96 * se), high: Math.exp(ln + 1.96 * se), z: ln / se };
}

/** One reading of a store's numbers: what, over which days, against what. */
export interface Reading {
  storeId: string;
  /** What was read over which days: each is read once. */
  ref: string;
  /** campaign:meta:123, store, product:abc */
  subject: string;
  /** What a lesson's title calls it: 'The "Dog car" campaign (Meta)'. */
  name: string;
  metric: string;
  /** The metric in words: 'ROAS', 'conversion rate'. */
  label: string;
  /** The baseline in words: "the store's other Meta campaigns". */
  vs: string;
  value: number;
  baseline: number;
  /** The counts behind each side's noise (see lift). */
  k: number;
  kBase: number;
  /** What it's over, e.g. 60 purchases. */
  n: number;
  unit: string;
  from: string;
  to: string;
  show: (v: number) => string;
  /** What else differed. Any makes it a pattern to test (observed evidence, a Hypothesis at most), not a measured result. */
  confounds: string[];
  path: string[];
}

const pct = (r: number) => `${r >= 1 ? '+' : '-'}${Math.round(Math.abs(r - 1) * 100)}%`;
const OPEN = new Set(['active', 'proposed']);

/**
 * Records a reading once. Inside the noise (|z| under 1.96) it stays an observation. Otherwise it's evidence on the
 * lesson it made before, for the same thing going the same way: measured when nothing else differed, observed when
 * something did. A measured reading is also evidence against the lesson going the other way, which moves that one down
 * and opens a conflict. A reading with no lesson yet makes its card (createCard runs the link suggester).
 */
export function learn(db: DatabaseSync, r: Reading, now = new Date()): 'lesson' | 'evidence' | 'noted' | undefined {
  const id = randomUUID();
  const fresh = db
    .prepare(
      `INSERT INTO kb_observations (id, store_id, ref, subject, metric, value, baseline, window_from, window_to, sample_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (ref) DO NOTHING`,
    )
    .run(id, r.storeId, r.ref, r.subject, r.metric, r.value, r.baseline, r.from, r.to, JSON.stringify({ k: r.k, kBase: r.kBase, n: r.n }), now.toISOString()).changes;
  if (!fresh) return undefined;
  const l = lift(r.value, r.k, r.baseline, r.kBase);
  if (!(Math.abs(l.z) >= 1.96)) return 'noted'; // NaN too: two averages with no spread, the same
  const up = r.value > r.baseline;
  const measured = !r.confounds.length;
  const text = (
    `${r.label[0]!.toUpperCase()}${r.label.slice(1)} ${r.show(r.value)} vs ${r.show(r.baseline)} for ${r.vs}, ${r.from} to ${r.to}: ` +
    `${pct(l.ratio)} (95% range ${pct(l.low)} to ${pct(l.high)}), on ${r.n.toLocaleString('en-US')} ${r.unit}.` +
    (measured ? '' : ` Not conclusive: ${r.confounds.join('; ')}.`)
  ).slice(0, 600);
  const evidence = { text, observationId: id, metric: r.metric, value: r.value, baseline: r.baseline, windowFrom: r.from, windowTo: r.to, sampleSize: r.n, testRef: r.ref, authorId: 'app' };
  const title = (way: boolean) => `${r.name}: ${r.label} ${way ? 'above' : 'below'} ${r.vs}`;
  // The lesson for this thing going this way: the card its readings are evidence on, or one with its title.
  const lesson = (way: boolean) =>
    db
      .prepare(
        `SELECT id, status FROM kb_cards c WHERE store_id = ? AND status != 'merged' AND (lower(title) = lower(?) OR EXISTS (
           SELECT 1 FROM kb_evidence e JOIN kb_observations o ON o.id = e.observation_id
           WHERE e.card_id = c.id AND e.kind != 'conflict' AND o.subject = ? AND o.metric = ? AND (o.value > o.baseline) = ?))`,
      )
      .get(r.storeId, title(way), r.subject, r.metric, way ? 1 : 0);
  const against = lesson(!up);
  if (measured && against && OPEN.has(String(against.status))) addEvidence(db, String(against.id), { ...evidence, kind: 'conflict' }, now);
  const kind = measured ? 'measured' : 'observed';
  const mine = lesson(up);
  if (mine) {
    if (!OPEN.has(String(mine.status))) return 'noted'; // the owner archived or rejected it
    addEvidence(db, String(mine.id), { ...evidence, kind }, now);
    return 'evidence';
  }
  const card = createCard(
    db,
    r.storeId,
    { categoryId: ensureCategoryPath(db, r.storeId, r.path), title: title(up), summary: text, type: 'performance_lesson', stage: 'hypothesis', status: 'active', authorId: 'app', origin: 'performance' },
    now,
  );
  addEvidence(db, card.id, { ...evidence, kind }, now);
  return 'lesson';
}

/**
 * An approved change's outcome (agents-outcomes' checkers) is evidence on the store's cards that the run asking
 * for it cited: measured when it worked, against them when it didn't. An unclear outcome adds nothing, nor does a demo
 * store's, nor one on a General card (those hold beyond one store).
 */
export function learnFromOutcome(
  db: DatabaseSync,
  o: { ref: string; runId?: string; storeId: string; agentId: string; worked?: boolean; text: string; evidence?: string },
  now = new Date(),
) {
  if (o.worked === undefined || !o.runId || db.prepare('SELECT demo FROM stores WHERE id = ?').get(o.storeId)?.demo) return;
  const cards = db
    .prepare(
      `SELECT DISTINCT r.card_id FROM kb_retrievals r JOIN kb_cards c ON c.id = r.card_id
       WHERE r.run_id = ? AND r.kind = 'cited' AND c.store_id = ? AND c.status IN ('active', 'proposed')`,
    )
    .all(o.runId, o.storeId);
  const text = `Acted on in an approved change: ${o.text}${o.evidence ? ` (${o.evidence})` : ''}`.slice(0, 1000);
  for (const c of cards) addEvidence(db, String(c.card_id), { kind: o.worked ? 'measured' : 'conflict', text, metric: 'outcome', testRef: o.ref, authorId: o.agentId }, now);
}
