import { randomUUID } from 'node:crypto';
import type { Db } from '../db';
import { mirrorSaved } from '../research';
import { LEGACY_SOURCE } from './legacy';

export type WatchKind = 'listing' | 'product' | 'niche' | 'offer';

/**
 * Watches or un-watches a target in one scope (a store, or `null` for the owner's all-stores list). Un-watching removes
 * it from every list in that scope. A listing that stands for a legacy research row is mirrored into "Saved" while any
 * scope still watches it.
 */
export function setWatch(db: Db, w: { storeId: string | null; kind: WatchKind; targetId: string; on: boolean; listName?: string }) {
  if (w.on) {
    db.prepare(`INSERT OR IGNORE INTO pr_watches (id, store_id, list_name, target_kind, target_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
      randomUUID(),
      w.storeId,
      w.listName ?? 'Watchlist',
      w.kind,
      w.targetId,
      new Date().toISOString(),
    );
  } else {
    db.prepare(`DELETE FROM pr_watches WHERE ifnull(store_id, '') = ? AND target_kind = ? AND target_id = ?`).run(w.storeId ?? '', w.kind, w.targetId);
  }
  if (w.kind !== 'listing') return;
  const legacy = db.prepare('SELECT source_ref FROM pr_listings WHERE id = ? AND source = ?').get(w.targetId, LEGACY_SOURCE)?.source_ref;
  const watched = !!db.prepare(`SELECT 1 FROM pr_watches WHERE target_kind = 'listing' AND target_id = ?`).get(w.targetId);
  if (legacy) mirrorSaved(db, String(legacy), watched);
}
