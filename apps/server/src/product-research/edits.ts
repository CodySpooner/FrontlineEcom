import { randomUUID } from 'node:crypto';
import { PR_STAGE_LABEL, PR_STAGES, type PrFlag, type PrStage, type Store } from '@frontline/shared';
import type { Db } from '../db';
import { evaluate } from './evaluate';
import { LEGACY_SOURCE } from './legacy';
import { setWatch } from './watches';

// The owner's edits in the detail panel (PR-13). Each one is written to History; none is ever made by an agent.

type Result = { error: string; status: 400 | 404 | 409 } | null;

export function history(db: Db, h: { storeId: string; productId: string; kind: string; from?: string | null; to?: string | null; reason: string | null; by?: string; at: Date }) {
  db.prepare('INSERT INTO pr_stage_history (id, store_id, product_id, kind, from_stage, to_stage, reason, by, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    randomUUID(),
    h.storeId,
    h.productId,
    h.kind,
    h.from ?? null,
    h.to ?? null,
    h.reason,
    h.by ?? 'owner',
    h.at.toISOString(),
  );
}

/** The store's evaluation row, created by Evaluate when the store has none yet. */
function evaluation(db: Db, store: Store, id: string, now: Date) {
  const get = () => db.prepare('SELECT stage, flags_json, flag_dismissals_json FROM pr_evaluations WHERE store_id = ? AND product_id = ?').get(store.id, id);
  return get() ?? (evaluate(db, store, id, now), get());
}

/** An owner's stage change: the reason is required and kept in History with the move. */
export function changeStage(db: Db, store: Store, id: string, to: string, reason: string, now = new Date()): Result {
  if (!PR_STAGES.includes(to as PrStage)) return { error: `stage must be one of ${PR_STAGES.join(', ')}`, status: 400 };
  if (!reason) return { error: 'Say why it moves: the reason is kept in History.', status: 400 };
  const from = String(evaluation(db, store, id, now)?.stage ?? 'discovered');
  if (from === to) return { error: `It is already ${PR_STAGE_LABEL[to as PrStage]}.`, status: 409 };
  db.prepare('UPDATE pr_evaluations SET stage = ?, updated_at = ? WHERE store_id = ? AND product_id = ?').run(to, now.toISOString(), store.id, id);
  history(db, { storeId: store.id, productId: id, kind: 'stage', from, to, reason, at: now });
  return null;
}

/** Decision 5's one automatic move: Discovered → Researching when a research task starts, by that task. */
export function researchStarted(db: Db, store: Store, id: string, taskId: string, now = new Date()) {
  if (String(evaluation(db, store, id, now)?.stage ?? 'discovered') !== 'discovered') return;
  db.prepare('UPDATE pr_evaluations SET stage = ?, updated_at = ? WHERE store_id = ? AND product_id = ?').run('researching', now.toISOString(), store.id, id);
  history(db, { storeId: store.id, productId: id, kind: 'stage', from: 'discovered', to: 'researching', reason: 'A research task started', by: taskId, at: now });
}

/** The store's own notes on the product (owner-provided, never evidence). Empty clears them. */
export function saveNotes(db: Db, store: Store, id: string, notes: string, now = new Date()) {
  evaluation(db, store, id, now);
  db.prepare('UPDATE pr_evaluations SET notes = ?, updated_at = ? WHERE store_id = ? AND product_id = ?').run(notes || null, now.toISOString(), store.id, id);
}

/** Dismisses one open flag with the owner's reason (decision 10), then re-evaluates: fit and the Flagged view follow. */
export function dismissFlag(db: Db, store: Store, id: string, flagId: string, reason: string, now = new Date()): Result {
  if (!reason) return { error: 'Say why the flag does not apply: the reason is kept in History.', status: 400 };
  const e = evaluation(db, store, id, now);
  const dismissed = JSON.parse(String(e?.flag_dismissals_json ?? '{}')) as Record<string, { reason: string; at: string }>;
  const flag = (JSON.parse(String(e?.flags_json ?? '[]')) as PrFlag[]).find((f) => f.id === flagId);
  if (!flag) return { error: 'That flag is not on this product.', status: 404 };
  if (dismissed[flagId]) return { error: 'That flag is already dismissed.', status: 409 };
  dismissed[flagId] = { reason, at: now.toISOString() };
  db.prepare('UPDATE pr_evaluations SET flag_dismissals_json = ?, updated_at = ? WHERE store_id = ? AND product_id = ?').run(JSON.stringify(dismissed), now.toISOString(), store.id, id);
  history(db, { storeId: store.id, productId: id, kind: 'flag', reason: `${flag.label}: ${reason}`, at: now });
  evaluate(db, store, id, now);
  return null;
}

/**
 * Watch toggle for a store or the owner's all-stores list (`null`). A product carrying a legacy research row is watched
 * through that listing, so "Saved" mirrors it (decision 2); un-watching clears the product and all its listings.
 */
export function watchProduct(db: Db, store: Store | null, id: string, on: boolean, now = new Date()) {
  const storeId = store?.id ?? null;
  if (on) {
    const legacy = db.prepare('SELECT id FROM pr_listings WHERE product_id = ? AND source = ? AND store_id IS NULL ORDER BY first_seen_at LIMIT 1').get(id, LEGACY_SOURCE)?.id;
    setWatch(db, legacy ? { storeId, kind: 'listing', targetId: String(legacy), on } : { storeId, kind: 'product', targetId: id, on });
  } else {
    setWatch(db, { storeId, kind: 'product', targetId: id, on });
    for (const l of db.prepare('SELECT id FROM pr_listings WHERE product_id = ?').all(id)) setWatch(db, { storeId, kind: 'listing', targetId: String(l.id), on });
  }
  if (store) history(db, { storeId: store.id, productId: id, kind: 'watch', reason: on ? 'Watching' : 'Stopped watching', at: now });
}
