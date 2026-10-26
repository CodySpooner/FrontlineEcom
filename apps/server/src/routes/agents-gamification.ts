import { awardXp, blendedRoas, checkAchievements, commander, dailyMissions, levelForXp, profitStreak, writeMemory, XP, type Award, type Facts } from '@frontline/agents';
import type { MetricTotals, Mission } from '@frontline/shared';
import { Hono } from 'hono';
import { loadRows, summarize } from '../analytics';
import { addDays, localDate } from '../dates';
import type { Db } from '../db';
import { publish } from '../live';
import { onApproved } from './agents-actions';
import { listStores } from '../stores';

/** awardXp + an `xp` live message (XP toast / level-up burst). */
export function award(db: Db, a: Award) {
  const out = awardXp(db, a);
  if (out) publish({ type: 'xp', ...out });
  return out;
}

const midnight = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};
const count = (db: Db, sql: string, ...args: string[]) => Number(db.prepare(sql).get(...args)?.n ?? 0);
const summary = (db: Db, storeIds: string[], range: 7 | 30) => {
  const to = localDate();
  return summarize(loadRows(db, storeIds, range, to), { range, to, storeIds });
};

const watched = new WeakSet<Db>();

/** Approved requests pay the agent that made them. */
function watchApprovals(db: Db) {
  if (watched.has(db)) return;
  watched.add(db);
  onApproved(db, (db, { id, title, storeId, agentId }) => award(db, { ref: `approval:${id}`, amount: XP.approved, reason: `Request approved: ${title}`, storeId, agentId }));
}

/**
 * Outcomes of approved ad changes: the store's blended ROAS over the 3 days after vs the 7 days before. Each outcome
 * becomes a store learning for the agent (so its next review knows what worked), and a win pays it once.
 * Checked lazily (commander/achievements reads); changes older than 30 days are left alone.
 */
export function checkAdOutcomes(db: Db, today = localDate()) {
  const rows = db
    .prepare(
      `SELECT id, store_id, agent_id, title, decided_at FROM approvals
       WHERE status = 'approved' AND json_extract(action_json, '$.kind') IN ('ads.set_budget', 'ads.pause_campaign', 'ads.pause_adsets') AND decided_at >= ?`,
    )
    .all(new Date(Date.now() - 30 * 86_400_000).toISOString());
  for (const r of rows) {
    const day = localDate(new Date(String(r.decided_at)));
    if (addDays(day, 3) >= today) continue; // the 3 days after aren't complete yet
    const before = blendedRoas(db, String(r.store_id), addDays(day, -7), addDays(day, -1));
    const after = blendedRoas(db, String(r.store_id), addDays(day, 1), addDays(day, 3));
    if (before === undefined || after === undefined) continue;
    const worked = after > before;
    const roas = `blended ROAS ${before.toFixed(2)} → ${after.toFixed(2)}`;
    // ponytail: writeMemory dedupes by text, so rechecks are no-ops; an owner-deleted outcome comes back within 30 days.
    writeMemory(db, {
      storeId: String(r.store_id), agentId: String(r.agent_id), kind: 'learning', confidence: worked ? 0.7 : 0.6, tags: ['outcome', 'ads'],
      text: `"${r.title}" ${worked ? 'worked' : 'did not help'}: ${roas} in the 3 days after.`,
      evidence: `7 days before vs 3 days after ${day} (request ${r.id})`,
    });
    if (!worked) continue;
    award(db, {
      ref: `win:${r.id}`, amount: XP.win, storeId: String(r.store_id), agentId: String(r.agent_id),
      reason: `Measured win: ROAS ${before.toFixed(2)} → ${after.toFixed(2)} after "${r.title}"`,
    });
  }
}

/**
 * Products added through an approved request, judged on their first 14 days of real sales (core's order_items; demo
 * stores have none, so they're skipped). Each becomes a store learning for the agent that proposed it; a product that
 * sold 10+ units at a gross profit pays it once.
 */
export function checkProductOutcomes(db: Db, today = localDate()) {
  const tests = db
    .prepare(
      `SELECT t.*, s.currency FROM product_tests t JOIN stores s ON s.id = t.store_id
       WHERE t.judged_at IS NULL AND s.demo = 0 AND t.added_on <= ?`,
    )
    .all(addDays(today, -15));
  for (const t of tests) {
    const end = addDays(String(t.added_on), 14);
    const s = db
      .prepare(
        `SELECT coalesce(sum(i.quantity), 0) AS units, coalesce(sum(i.revenue), 0) AS revenue, coalesce(sum(i.revenue - i.cost), 0) AS profit
         FROM order_items i JOIN orders o ON o.store_id = i.store_id AND o.id = i.order_id
         WHERE i.store_id = ? AND i.product_id = ? AND o.status = 'paid' AND o.local_date BETWEEN ? AND ?`,
      )
      .get(String(t.store_id), String(t.product_id), String(t.added_on), end)!;
    const [units, revenue, profit] = [Number(s.units), Number(s.revenue), Number(s.profit)];
    // ponytail: no per-product ad spend yet, so the bar is units + gross profit, not ROAS vs break-even.
    const won = units >= 10 && profit > 0;
    const money = (n: number) => `${Math.round(n).toLocaleString('en-US')} ${t.currency}`;
    const storeId = String(t.store_id);
    const agentId = String(t.agent_id);
    writeMemory(db, {
      storeId, agentId, kind: 'learning', confidence: won ? 0.7 : 0.6, tags: ['outcome', 'product'],
      text: `"${t.title}" ${won ? 'sold' : 'did not take off'}: ${units} units, ${money(revenue)} revenue, ${money(profit)} gross profit in its first 14 days.`,
      evidence: `paid orders ${t.added_on} to ${end} (request ${t.approval_id})`,
    });
    if (won) award(db, { ref: `product-win:${t.approval_id}:${t.product_id}`, amount: XP.win, storeId, agentId, reason: `Measured win: "${t.title}" sold ${units} units in 14 days` });
    db.prepare('UPDATE product_tests SET judged_at = ? WHERE store_id = ? AND product_id = ?').run(new Date().toISOString(), storeId, String(t.product_id));
  }
}

function facts(db: Db): Facts {
  const ids = listStores(db).map((s) => s.id);
  const best = (totals: MetricTotals[], k: keyof MetricTotals) => Math.max(0, ...totals.map((t) => t[k]));
  const month = summary(db, ids, 30);
  const week = summary(db, ids, 7);
  return {
    orders: month.totals.orders,
    best30Revenue: best(month.byStore.map((s) => s.totals), 'revenue'),
    best7Roas: best(week.byStore.map((s) => s.totals), 'roas'),
    profitStreak: profitStreak(month.series),
    fullSquad: count(db, 'SELECT count(*) AS n FROM (SELECT store_id FROM agents GROUP BY store_id HAVING min(enabled) = 1 AND count(*) >= 8)') > 0,
    runsDone: count(db, `SELECT count(*) AS n FROM agent_runs WHERE status = 'done'`),
    approved: count(db, `SELECT count(*) AS n FROM approvals WHERE status = 'approved'`),
    memories: count(db, 'SELECT count(*) AS n FROM store_memory'),
    topLevel: levelForXp(count(db, 'SELECT coalesce(max(xp), 0) AS n FROM agents')),
  };
}

/** Today's missions; ones that are complete pay the commander (once). */
function missions(db: Db, storeIds?: string[]): Mission[] {
  const to = localDate();
  const since = midnight();
  return listStores(db)
    .filter((s) => !storeIds?.length || storeIds.includes(s.id))
    .flatMap((s) => {
      const series = summary(db, [s.id], 30).series;
      const today = series.at(-1)?.date === to ? series.at(-1) : undefined;
      const prev = series.filter((p) => p.date !== to).slice(-7);
      const avg = (k: 'revenue' | 'orders') => (prev.length ? prev.reduce((n, p) => n + p[k], 0) / prev.length : 0);
      const list = dailyMissions({
        storeId: s.id,
        date: to,
        currency: s.currency,
        revenueToday: today?.revenue ?? 0,
        ordersToday: today?.orders ?? 0,
        avgRevenue: avg('revenue'),
        avgOrders: avg('orders'),
        requestsOpen: count(db, `SELECT count(*) AS n FROM approvals WHERE store_id = ? AND status = 'pending'`, s.id),
        requestsDecidedToday: count(db, `SELECT count(*) AS n FROM approvals WHERE store_id = ? AND decided_at >= ?`, s.id, since),
        runsToday: count(db, 'SELECT count(*) AS n FROM agent_runs WHERE store_id = ? AND created_at >= ?', s.id, since),
        creativeAgentsOn: !!count(db, `SELECT count(*) AS n FROM agents WHERE store_id = ? AND enabled = 1 AND role IN ('creative_studio', 'copywriter')`, s.id),
        productHunterOn: !!count(db, `SELECT count(*) AS n FROM agents WHERE store_id = ? AND enabled = 1 AND role = 'product_hunter'`, s.id),
        creativesToday: count(db, 'SELECT count(*) AS n FROM creatives WHERE store_id = ? AND created_at >= ?', s.id, since),
        productsApprovedToday: count(
          db,
          `SELECT count(*) AS n FROM approvals WHERE store_id = ? AND status = 'approved' AND json_extract(action_json, '$.kind') = 'store.add_products' AND decided_at >= ?`,
          s.id, since,
        ),
      });
      for (const m of list) if (m.progress >= m.target) award(db, { ref: `mission:${m.id}`, amount: m.xp, reason: `Mission complete: ${m.title}`, storeId: s.id });
      return list;
    });
}

export function gamificationRoutes(db: Db) {
  watchApprovals(db);
  const achievements = () => {
    checkAdOutcomes(db);
    checkProductOutcomes(db);
    return checkAchievements(db, facts(db), (a) => award(db, a));
  };
  return new Hono()
    .get('/api/missions', (c) => c.json(missions(db, c.req.query('stores')?.split(',').filter(Boolean))))
    .get('/api/achievements', (c) => c.json(achievements()))
    .get('/api/commander', (c) => {
      achievements(); // newly unlocked ones count toward the level
      return c.json(commander(db, profitStreak(summary(db, listStores(db).map((s) => s.id), 30).series)));
    });
}
