import type { DatabaseSync } from 'node:sqlite';
import type { KbWorkspace } from '@frontline/shared';

// The knowledge base domain (knowledge-base lane). Rows live in the kb_* tables (migration 44 in apps/server/src/db.ts).

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
