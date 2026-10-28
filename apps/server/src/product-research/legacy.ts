import { randomUUID } from 'node:crypto';
import { once, tx, type Db } from '../db';
import { upsertListing } from './catalog';

/** Listings that stand for a legacy `research_products` row keep its id as their source_ref. */
export const LEGACY_SOURCE = 'research_feed';

type Row = Record<string, unknown>;

/**
 * An agent's find (a `find-*` row) as a listing: title, category and image only. Its typed numbers are the agent's
 * estimates, kept aside for the panel's "Agent's estimates (not evidence)" block and never used as offers, signals,
 * fit inputs, sorts or counts (decision 2).
 */
function findListing(db: Db, r: Row, storeId: string | null) {
  return upsertListing(db, {
    source: LEGACY_SOURCE,
    sourceRef: String(r.id),
    storeId,
    origin: 'agent_find',
    title: String(r.title),
    category: String(r.category),
    imageRef: r.image ? String(r.image) : null,
    transform: {
      legacyId: String(r.id),
      estimates: { source: r.source, cost: r.cost, price: r.price, compareAt: r.compare_at || undefined, trend: r.trend, competition: r.competition, shippingDays: r.shipping_days },
    },
  });
}

/**
 * Once per data folder: the owner's lists become all-stores watches (each keeps its list's name), every agent find
 * becomes an `agent_find` listing, and a saved sample row becomes a `legacy_sample` listing (shown only in the
 * Watchlist, as sample data). Unsaved sample rows never enter. An item un-watched later stays un-watched.
 */
export function importLegacy(db: Db) {
  tx(db, () => {
    if (!once(db, 'pr:legacy-import')) return;
    const listing = new Map<string, string>();
    for (const r of db.prepare(`SELECT * FROM research_products WHERE id LIKE 'find-%'`).all()) listing.set(String(r.id), findListing(db, r, null).id);
    const items = db.prepare(
      `SELECT l.name, i.added_at, p.* FROM product_list_items i JOIN product_lists l ON l.id = i.list_id JOIN research_products p ON p.id = i.product_id ORDER BY i.added_at, i.rowid`,
    ).all();
    for (const r of items) {
      const id = String(r.id);
      if (!listing.has(id)) {
        listing.set(id, upsertListing(db, { source: LEGACY_SOURCE, sourceRef: id, origin: 'legacy_sample', title: String(r.title), category: String(r.category), imageRef: r.image ? String(r.image) : null, transform: { legacyId: id, sample: true } }).id);
      }
      db.prepare(`INSERT OR IGNORE INTO pr_watches (id, store_id, list_name, target_kind, target_id, created_at) VALUES (?, NULL, ?, 'listing', ?, ?)`).run(randomUUID(), String(r.name), listing.get(id)!, String(r.added_at));
    }
  });
}

/**
 * T6: a find recorded by a run, mirrored as a listing of the run's store. Skipped unless the run ran on Claude or Codex
 * (a demo-engine run's find is a scripted example). A find the import already brought in is refreshed where it is.
 */
export function mirrorFind(db: Db, legacyId: string, runId: string | undefined) {
  const run = runId ? db.prepare('SELECT store_id, runtime FROM agent_runs WHERE id = ?').get(runId) : undefined;
  if (!run || (run.runtime !== 'claude' && run.runtime !== 'codex')) return;
  const r = db.prepare('SELECT * FROM research_products WHERE id = ?').get(legacyId);
  if (!r) return;
  const shared = db.prepare('SELECT 1 FROM pr_listings WHERE source = ? AND source_ref = ? AND store_id IS NULL').get(LEGACY_SOURCE, legacyId);
  findListing(db, r, shared ? null : String(run.store_id));
}
