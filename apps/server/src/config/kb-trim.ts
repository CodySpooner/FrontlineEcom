// Settings → Knowledge (ST-25, decision 13): what the next hourly pass would trim if the workspace kept page text and
// research logs `days`, counted with the same rows `trim` in kb/maintenance.ts touches (kb-controls.test.ts holds them
// together), so lowering retention can say what goes before it's saved.
import type { KbWorkspace } from '@frontline/shared';
import type { Db } from '../db';

const DAY = 86_400_000;

export function trimCounts(db: Db, ws: KbWorkspace, days: number, now = new Date()) {
  const at = [ws ?? '', new Date(now.getTime() - days * DAY).toISOString()];
  const n = (sql: string) => Number(db.prepare(sql).get(...at)!.n);
  // Finished research with a log or a stage output still to trim (the log keeps its "Data retention" line).
  const tasks = `SELECT id FROM kb_tasks t WHERE coalesce(store_id, '') = ? AND status IN ('done', 'failed', 'cancelled') AND ended_at < ?
    AND (EXISTS (SELECT 1 FROM kb_task_log WHERE task_id = t.id AND stage != 'Data retention') OR EXISTS (SELECT 1 FROM kb_task_steps WHERE task_id = t.id AND output_json IS NOT NULL))`;
  return {
    pages: n(`SELECT count(*) AS n FROM kb_sources WHERE coalesce(store_id, '') = ? AND text IS NOT NULL AND coalesce(fetched_at, created_at) < ?`),
    logs: n(`SELECT count(*) AS n FROM (${tasks})`),
    outputs: n(`SELECT count(*) AS n FROM kb_task_steps WHERE output_json IS NOT NULL AND task_id IN (${tasks})`),
    transcripts: n(`SELECT count(*) AS n FROM agent_runs WHERE transcript_json IS NOT NULL AND transcript_json != '[]' AND id IN (SELECT run_id FROM kb_task_steps WHERE task_id IN (${tasks}))`),
  };
}
