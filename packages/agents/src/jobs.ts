import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { AgentRole } from '@frontline/shared';

// Default scheduled work for a squad, as rows in core's `automation_rules` (apps/server/src/automations.ts runs them).

export const DEFAULT_JOBS: { name: string; role: AgentRole; cron: string; task: string }[] = [
  {
    name: 'Daily briefing',
    role: 'market_analyst',
    cron: '0 8 * * *',
    task:
      'Daily briefing: compare yesterday with the 7-day average (revenue, profit, ROAS, orders, AOV) using store_summary and metrics_timeseries. ' +
      'Say what moved and the likely why in 3 bullets, then the top 3 actions for today, each with the squad role that should own it. Under 150 words.',
  },
  {
    name: 'Daily campaign review',
    role: 'ad_strategist',
    cron: '30 8 * * *',
    task:
      'Daily campaign review: run review_campaigns. For clear scale, cut or pause verdicts use propose_ad_change (at most 3, biggest money at stake first). ' +
      'List campaigns still learning and what data they need. Save anything durable with write_memory.',
  },
  {
    name: 'Daily product scan',
    role: 'product_hunter',
    cron: '0 9 * * *',
    task:
      "Daily product scan: check research_feed (trending, then high_margin) for this store's niche against list_products. Record up to 2 strong web finds " +
      'with record_product_find. Request a store.add_products approval only for a product that clearly beats the weakest current product; otherwise report the top 3 to watch.',
  },
  {
    name: 'Weekly report',
    role: 'market_analyst',
    cron: '0 9 * * 1',
    task:
      'Weekly report: last 7 days vs the 7 before (revenue, profit, ROAS, orders, AOV), best and worst products and campaigns, what the squad shipped ' +
      '(approved requests), and the 3 priorities for next week with owners. Under 250 words.',
  },
];

/**
 * Adds the default jobs for a store. They start enabled only when the store is connected: on demo data they would
 * spend the owner's Claude usage on simulated numbers. The owner can switch them on in Automation.
 */
export function createDefaultJobs(db: DatabaseSync, storeId: string, now = new Date()) {
  const connected = db.prepare('SELECT connected FROM stores WHERE id = ?').get(storeId)?.connected === 1;
  const insert = db.prepare(
    `INSERT INTO automation_rules (id, store_id, name, enabled, trigger_json, action_json, approval, max_runs_per_day, cooldown_hours, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'auto', 1, 24, ?)`,
  );
  for (const j of DEFAULT_JOBS) {
    insert.run(
      randomUUID(), storeId, j.name, connected ? 1 : 0, JSON.stringify({ type: 'schedule', cron: j.cron }),
      JSON.stringify({ type: 'agent_task', agentId: `${storeId}:${j.role}`, task: j.task }), now.toISOString(),
    );
  }
}
