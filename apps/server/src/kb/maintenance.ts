// The knowledge base's maintenance pass (KB-23), hourly beside performance learning: duplicates and contradictions in
// each workspace (scanCards), then each workspace's data retention. Freshness needs no pass: it's read where it's shown
// (freshness() in packages/agents), and research picks stale cards up through the self-directed research triggers.
import { kbControls, scanCards } from '@frontline/agents';
import type { KbWorkspace } from '@frontline/shared';
import { tx, type Db } from '../db';

const DAY = 86_400_000;
const TRIMMED = 'Data retention';

/**
 * Past `ws`'s retention age: fetched page text, and finished research's log, stage outputs and run transcripts. The
 * sources (address, title, excerpt, hash), tasks and reports stay, and the log says it was trimmed.
 */
export function trim(db: Db, ws: KbWorkspace, now = new Date()): { sources: number; tasks: number } {
  const days = kbControls(db, ws).retentionDays;
  if (!days) return { sources: 0, tasks: 0 };
  const before = new Date(now.getTime() - days * DAY).toISOString();
  const sources = db.prepare(`UPDATE kb_sources SET text = NULL WHERE coalesce(store_id, '') = ? AND text IS NOT NULL AND coalesce(fetched_at, created_at) < ?`).run(ws ?? '', before);
  const tasks = db
    .prepare(
      `SELECT id FROM kb_tasks t WHERE coalesce(store_id, '') = ? AND status IN ('done', 'failed', 'cancelled') AND ended_at < ?
         AND (EXISTS (SELECT 1 FROM kb_task_log WHERE task_id = t.id AND stage != ?) OR EXISTS (SELECT 1 FROM kb_task_steps WHERE task_id = t.id AND output_json IS NOT NULL))`,
    )
    .all(ws ?? '', before, TRIMMED)
    .map((r) => String(r.id));
  for (const id of tasks) {
    db.prepare(`UPDATE agent_runs SET transcript_json = '[]' WHERE id IN (SELECT run_id FROM kb_task_steps WHERE task_id = ?)`).run(id);
    db.prepare('UPDATE kb_task_steps SET output_json = NULL WHERE task_id = ?').run(id);
    db.prepare('DELETE FROM kb_task_log WHERE task_id = ?').run(id);
    db.prepare(`INSERT INTO kb_task_log (task_id, stage, level, message, at) VALUES (?, ?, 'info', ?, ?)`).run(id, TRIMMED, `Log trimmed: this workspace keeps research logs ${days} days`, now.toISOString());
  }
  return { sources: Number(sources.changes), tasks: tasks.length };
}

export function maintain(db: Db, now = new Date()) {
  const out = { duplicates: 0, contradictions: 0, trimmed: { sources: 0, tasks: 0 } };
  for (const ws of [null, ...db.prepare('SELECT id FROM stores').all().map((r) => String(r.id))] as KbWorkspace[]) {
    const found = tx(db, () => scanCards(db, ws, now));
    const cut = tx(db, () => trim(db, ws, now));
    out.duplicates += found.duplicates;
    out.contradictions += found.contradictions;
    out.trimmed.sources += cut.sources;
    out.trimmed.tasks += cut.tasks;
  }
  return out;
}
