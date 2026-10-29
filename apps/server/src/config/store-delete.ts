// Deleting a store (ST-19, spec §6.2, §10): what goes with it, what stays, and the leftovers it cleans up.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { INTEGRATION_KINDS, type StoreDeleteImpact } from '@frontline/shared';
import type { Db } from '../db';

/** Its connections' ids, saved or not (`integrations.ts` `idOf`). */
const integrationIds = (storeId: string) => Object.entries(INTEGRATION_KINDS).flatMap(([kind, k]) => (k.perStore ? [`${kind}:${storeId}`] : []));

// Product Research rows that are the store's own (shared catalog rows have no store).
const RESEARCH = ['pr_store_profiles', 'pr_evaluations', 'pr_stage_history', 'pr_tasks', 'pr_reports', 'pr_economics', 'pr_comparisons', 'pr_briefs', 'pr_outcomes', 'pr_watches', 'pr_listings', 'pr_offers', 'pr_signals', 'pr_jobs'];

export function deleteImpact(db: Db, storeId: string): StoreDeleteImpact {
  const n = (sql: string) => Number(db.prepare(sql).get(storeId)?.n ?? 0);
  const of = (table: string, where = '') => n(`SELECT count(*) AS n FROM ${table} WHERE store_id = ?${where}`);
  const item = (count: number, one: string, many: string) => ({ count, text: `${count} ${count === 1 ? one : many}` });
  // ponytail: codexWork's root (packages/agents/src/codex.ts), read here without creating the folder.
  const codex = resolve(process.env.FRONTLINE_CODEX_WORK ?? join(process.env.LOCALAPPDATA ?? homedir(), 'FrontlineEcom', 'codex-work'), storeId);
  return {
    removes: [
      item(of('agents'), 'agent', 'agents'),
      item(of('agent_runs', " AND status = 'running'"), 'running run', 'running runs'),
      item(of('agent_runs', " AND status = 'queued'"), 'queued run', 'queued runs'),
      item(of('automation_rules'), 'scheduled job or automation rule', 'scheduled jobs and automation rules'),
      item(of('integrations'), 'connection', 'connections'),
      item(of('approvals', " AND status = 'pending'"), 'request waiting for approval', 'requests waiting for approval'),
      item(of('kb_cards'), 'knowledge card', 'knowledge cards'),
      item(of('store_memory'), 'store memory entry', 'store memory entries'),
      item(RESEARCH.reduce((t, table) => t + of(table), 0), 'Product Research row', 'Product Research rows'),
      item(of('orders'), 'order', 'orders'),
    ],
    keeps: [
      item(of('action_log'), 'action log entry', 'action log entries'),
      item(of('niche_learnings'), 'niche learning, no longer linked to the store', 'niche learnings, no longer linked to the store'),
      item(of('settings_changes'), 'change history entry', 'change history entries'),
    ],
    ...(existsSync(codex) && { codexFolder: codex }),
  };
}

/** After the store's row is gone: the settings rows its connections left (`shop:<id>`), and their read-state entries. */
export function forgetStore(db: Db, storeId: string) {
  const ids = integrationIds(storeId);
  db.prepare('DELETE FROM settings WHERE key IN (SELECT value FROM json_each(?))').run(JSON.stringify(ids.map((id) => `shop:${id}`)));
  // ponytail: every settings map keyed by an integration id is connector read state (`stateOf`); they're found by key.
  const update = db.prepare('UPDATE settings SET value_json = ? WHERE key = ?');
  for (const r of db.prepare("SELECT key, value_json FROM settings WHERE json_valid(value_json) AND json_type(value_json) = 'object'").all()) {
    const v = JSON.parse(String(r.value_json)) as Record<string, unknown>;
    const held = ids.filter((id) => id in v);
    if (!held.length) continue;
    for (const id of held) delete v[id];
    update.run(JSON.stringify(v), String(r.key));
  }
}
