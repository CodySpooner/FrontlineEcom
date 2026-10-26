import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { AgentRole } from '@frontline/shared';
import { once } from './memory';

// Default scheduled work for a squad, as rows in core's `automation_rules` (apps/server/src/automations.ts runs them).

export const DEFAULT_JOBS: { name: string; role: AgentRole; cron: string; task: string }[] = [
  {
    name: 'Daily briefing',
    role: 'market_analyst',
    cron: '0 8 * * *',
    task:
      'Daily briefing: compare yesterday with the 7-day average (revenue, profit, ROAS, orders, AOV) using store_summary and metrics_timeseries. ' +
      'Say what moved and the likely why in 3 bullets, then the top 3 actions for today, each with the squad role that should own it. ' +
      'Hand the most urgent one to its owner with assign_task. Under 150 words.',
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
      'with record_product_find, costed with search_suppliers. Request a store.add_products approval only for a product that clearly beats the weakest current product; otherwise report the top 3 to watch.',
  },
  {
    name: 'Daily order check',
    role: 'operations',
    cron: '0 10 * * *',
    task:
      'Daily order check: list_orders for the last 14 days. Flag with flag_order_issue every order unfulfilled for 3+ days or in transit for 10+ days ' +
      '(severity high past 7 / 15 days), and any refund or supplier problem you can see, each with a suggested next step. ' +
      'Check list_order_issues for issues open 3+ days and say which need the owner today. Then summarize the queue in 3 lines.',
  },
  {
    name: 'Weekly price check',
    role: 'market_analyst',
    cron: '0 9 * * 3',
    task:
      "Weekly price check: list_products (price, cost, margin) against list_competitors' prices and recent price changes. If one product is clearly mispriced " +
      'with the numbers to show it, propose one price test with propose_price_change; otherwise say prices hold and why, in 3 lines. ' +
      "If a competitor's recent ads show a new angle or offer worth testing, hand it to the Ad Strategist with assign_task.",
  },
  {
    name: 'Weekly page refresh',
    role: 'store_developer',
    cron: '0 9 * * 4',
    task:
      'Weekly page refresh: list_products and take the best seller (most revenue_30d) that draft_page accepts. Draft one improved product page for it with draft_page: ' +
      'benefit-first headline, the objections buyers raise, proof, shipping and returns. Then ask to publish it with publish_page.',
  },
  {
    name: 'Monthly flow check',
    role: 'email_sms',
    cron: '0 9 1 * *',
    task:
      'Monthly flow check: list_flows against the four core flows (welcome, checkout abandonment, post-purchase, win-back). Draft the first missing one with draft_flow, ' +
      'sized from store_summary and metrics_timeseries; if all four exist, redraft the oldest with what search_memory and the last 30 days say. One flow per run.',
  },
  {
    name: 'Weekly report',
    role: 'market_analyst',
    cron: '0 9 * * 1',
    task:
      'Weekly report: last 7 days vs the 7 before (revenue, profit, ROAS, orders, AOV), best and worst products and campaigns, what the squad shipped ' +
      '(squad_log: approved requests and finished work), and the 3 priorities for next week with owners. Under 250 words.',
  },
];

/** Switches a store's default jobs on (it just got connected); returns how many were off. */
export function enableDefaultJobs(db: DatabaseSync, storeId: string): number {
  const names = DEFAULT_JOBS.map((j) => j.name);
  return Number(
    db.prepare(`UPDATE automation_rules SET enabled = 1 WHERE store_id = ? AND enabled = 0 AND name IN (${names.map(() => '?').join(',')})`).run(storeId, ...names).changes,
  );
}

/**
 * Adds the default jobs a store hasn't been given yet, each once: a job the owner deleted stays deleted, and stores made
 * before a job shipped get it. They start enabled only when the store is connected: on demo data they would spend the
 * owner's Claude usage on simulated numbers. The owner can switch them on in Automation. Returns the names added.
 */
export function createDefaultJobs(db: DatabaseSync, storeId: string, now = new Date()): string[] {
  const connected = db.prepare('SELECT connected FROM stores WHERE id = ?').get(storeId)?.connected === 1;
  const has = db.prepare('SELECT 1 FROM automation_rules WHERE store_id = ? AND name = ?');
  const insert = db.prepare(
    `INSERT INTO automation_rules (id, store_id, name, enabled, trigger_json, action_json, approval, max_runs_per_day, cooldown_hours, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'auto', 1, 24, ?)`,
  );
  const added = DEFAULT_JOBS.filter((j) => once(db, `default-job:${storeId}:${j.name}`, now) && !has.get(storeId, j.name));
  for (const j of added) {
    insert.run(
      randomUUID(), storeId, j.name, connected ? 1 : 0, JSON.stringify({ type: 'schedule', cron: j.cron }),
      JSON.stringify({ type: 'agent_task', agentId: `${storeId}:${j.role}`, task: j.task }), now.toISOString(),
    );
  }
  return added.map((j) => j.name);
}
