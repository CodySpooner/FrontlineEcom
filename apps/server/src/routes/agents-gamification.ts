import { awardXp, blendedRoas, cash, checkAchievements, commander, dailyMissions, getAgent, judgeRun, levelForXp, once, profitStreak, writeMemory, XP, type Award, type Facts, type NewMemory } from '@frontline/agents';
import { AGENT_ROLES, type MetricTotals, type Mission } from '@frontline/shared';
import { Hono } from 'hono';
import { loadRows, summarize } from '../analytics';
import { addDays, localDate } from '../dates';
import type { Db } from '../db';
import { publish } from '../live';
import { onApproved } from './agents-actions';
import { notify } from '../settings';
import { listStores } from '../stores';

/** awardXp + an `xp` live message (XP toast / level-up burst). */
export function award(db: Db, a: Award) {
  const out = awardXp(db, a);
  if (out) publish({ type: 'xp', ...out });
  return out;
}

/** A measured outcome becomes the agent's store learning and, once per change, a note in the owner's feed. */
function recordOutcome(db: Db, ref: string, worked: boolean, m: NewMemory) {
  writeMemory(db, m);
  if (!once(db, `outcome-note:${ref}`)) return;
  const agent = getAgent(db, m.agentId);
  const name = agent ? AGENT_ROLES[agent.role].name : 'Agent';
  notify(db, { kind: 'info', title: worked ? `Measured win: ${name}` : `${name}: no lift this time`, body: m.text, storeId: m.storeId, link: `/agents/${m.agentId}` });
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
      `SELECT id, store_id, agent_id, run_id, title, decided_at FROM approvals
       WHERE status = 'approved' AND json_extract(action_json, '$.kind') IN ('ads.set_budget', 'ads.pause_campaign', 'ads.pause_adsets') AND decided_at >= ?
         AND NOT EXISTS (SELECT 1 FROM done_once WHERE ref = 'not-applied:' || approvals.id)`,
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
    recordOutcome(db, `ads:${r.id}`, worked, {
      storeId: String(r.store_id), agentId: String(r.agent_id), kind: 'learning', confidence: worked ? 0.7 : 0.6, tags: ['outcome', 'ads'],
      text: `"${r.title}" ${worked ? 'worked' : 'did not help'}: ${roas} in the 3 days after.`,
      evidence: `7 days before vs 3 days after ${day} (request ${r.id})`,
    });
    if (r.run_id) judgeRun(db, `ads:${r.id}`, String(r.run_id), worked);
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
      `SELECT t.*, s.currency, a.run_id FROM product_tests t JOIN stores s ON s.id = t.store_id LEFT JOIN approvals a ON a.id = t.approval_id
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
    recordOutcome(db, `product:${t.approval_id}:${t.product_id}`, won, {
      storeId, agentId, kind: 'learning', confidence: won ? 0.7 : 0.6, tags: ['outcome', 'product'],
      text: `"${t.title}" ${won ? 'sold' : 'did not take off'}: ${units} units, ${money(revenue)} revenue, ${money(profit)} gross profit in its first 14 days.`,
      evidence: `paid orders ${t.added_on} to ${end} (request ${t.approval_id})`,
    });
    if (t.run_id) judgeRun(db, `product:${t.approval_id}:${t.product_id}`, String(t.run_id), won);
    if (won) award(db, { ref: `product-win:${t.approval_id}:${t.product_id}`, amount: XP.win, storeId, agentId, reason: `Measured win: "${t.title}" sold ${units} units in 14 days` });
    db.prepare('UPDATE product_tests SET judged_at = ? WHERE store_id = ? AND product_id = ?').run(new Date().toISOString(), storeId, String(t.product_id));
  }
}

/** A product's paid units and gross profit over [from, to] (core's order_items: real stores only). */
const productSales = (db: Db, storeId: string, productId: string, from: string, to: string) => {
  const r = db
    .prepare(
      `SELECT coalesce(sum(i.quantity), 0) AS units, coalesce(sum(i.revenue - i.cost), 0) AS profit
       FROM order_items i JOIN orders o ON o.store_id = i.store_id AND o.id = i.order_id
       WHERE i.store_id = ? AND i.product_id = ? AND o.status = 'paid' AND o.local_date BETWEEN ? AND ?`,
    )
    .get(storeId, productId, from, to)!;
  return { units: Number(r.units), profit: Number(r.profit) };
};

/**
 * Price tests on real stores, 15+ days after the change: the product's gross profit in the 14 days after vs the 14
 * before (core's order_items; demo stores have none). A learning either way; more gross profit is a measured win.
 */
// ponytail: raw before/after, no seasonality or traffic adjustment; the learning says the windows so the agent can weigh it.
export function checkPriceOutcomes(db: Db, today = localDate()) {
  const tests = db
    .prepare(
      `SELECT t.*, s.currency, a.run_id FROM price_tests t JOIN stores s ON s.id = t.store_id LEFT JOIN approvals a ON a.id = t.approval_id
       WHERE t.judged_at IS NULL AND s.demo = 0 AND t.changed_on <= ?`,
    )
    .all(addDays(today, -15));
  for (const t of tests) {
    const [storeId, productId, day] = [String(t.store_id), String(t.product_id), String(t.changed_on)];
    const before = productSales(db, storeId, productId, addDays(day, -14), addDays(day, -1));
    const after = productSales(db, storeId, productId, addDays(day, 1), addDays(day, 14));
    db.prepare('UPDATE price_tests SET judged_at = ? WHERE approval_id = ?').run(new Date().toISOString(), String(t.approval_id));
    if (!before.units && !after.units) continue; // no sales either side: nothing to learn
    const worked = after.profit > before.profit;
    const money = (n: number) => `${Math.round(n).toLocaleString('en-US')} ${t.currency}`;
    const price = (n: unknown) => cash(Number(n), String(t.currency));
    const agentId = String(t.agent_id);
    recordOutcome(db, `price:${t.approval_id}`, worked, {
      storeId, agentId, kind: 'learning', confidence: worked ? 0.7 : 0.6, tags: ['outcome', 'pricing'],
      text: `Pricing "${t.title}" ${price(t.from_price)} → ${price(t.to_price)} ${worked ? 'worked' : 'did not help'}: gross profit ${money(before.profit)} → ${money(after.profit)}, ${before.units} → ${after.units} units (14 days before vs after).`,
      evidence: `paid orders ${addDays(day, -14)} to ${addDays(day, 14)} (request ${t.approval_id})`,
    });
    if (t.run_id) judgeRun(db, `price:${t.approval_id}`, String(t.run_id), worked);
    if (worked) award(db, { ref: `price-win:${t.approval_id}`, amount: XP.win, storeId, agentId, reason: `Measured win: "${t.title}" at ${price(t.to_price)} made more gross profit` });
  }
}

/**
 * Product pages published from the Store Builder on real stores, 15+ days later: the product's gross profit in the 14
 * days after publishing vs the 14 before. A learning for the agent that drafted it; more gross profit is a measured win.
 */
// ponytail: raw before/after like price tests; a price test on the same product in the window muddies it.
export function checkPageOutcomes(db: Db, today = localDate()) {
  const pages = db
    .prepare(
      `SELECT d.id, d.store_id, d.agent_id, d.run_id, d.product_id, d.title, substr(d.published_at, 1, 10) AS day, s.currency
       FROM page_drafts d JOIN stores s ON s.id = d.store_id
       WHERE d.kind = 'product' AND d.product_id IS NOT NULL AND d.published_at IS NOT NULL AND s.demo = 0 AND substr(d.published_at, 1, 10) <= ?`,
    )
    .all(addDays(today, -15));
  for (const d of pages) {
    if (!once(db, `page-outcome:${d.id}`)) continue;
    const [storeId, productId, day, agentId] = [String(d.store_id), String(d.product_id), String(d.day), String(d.agent_id)];
    const before = productSales(db, storeId, productId, addDays(day, -14), addDays(day, -1));
    const after = productSales(db, storeId, productId, addDays(day, 1), addDays(day, 14));
    if (!before.units && !after.units) continue;
    const worked = after.profit > before.profit;
    const money = (n: number) => `${Math.round(n).toLocaleString('en-US')} ${d.currency}`;
    recordOutcome(db, `page:${d.id}`, worked, {
      storeId, agentId, kind: 'learning', confidence: worked ? 0.7 : 0.6, tags: ['outcome', 'page'],
      text: `The new "${d.title}" page ${worked ? 'worked' : 'did not help'}: gross profit ${money(before.profit)} → ${money(after.profit)}, ${before.units} → ${after.units} units (14 days before vs after).`,
      evidence: `paid orders ${addDays(day, -14)} to ${addDays(day, 14)} (draft ${d.id})`,
    });
    if (d.run_id) judgeRun(db, `page:${d.id}`, String(d.run_id), worked);
    if (worked) award(db, { ref: `page-win:${d.id}`, amount: XP.win, storeId, agentId, reason: `Measured win: the new "${d.title}" page made more gross profit` });
  }
}

/** Theme changes that went live 15+ days ago: store conversion rate in the 14 days after vs the 14 before, once each. */
// ponytail: any lift counts as a win, no significance test; small stores need a few thousand sessions a side to mean much.
export function checkThemeOutcomes(db: Db, today = localDate()) {
  const live = db
    .prepare(
      `SELECT a.id, a.store_id, a.agent_id, a.run_id, a.title, substr(o.at, 1, 10) AS day FROM approvals a
       JOIN done_once o ON o.ref = 'theme-live:' || a.id JOIN stores s ON s.id = a.store_id
       WHERE s.demo = 0 AND substr(o.at, 1, 10) <= ?`,
    )
    .all(addDays(today, -15));
  const funnel = db.prepare('SELECT coalesce(sum(orders), 0) AS orders, coalesce(sum(sessions), 0) AS sessions FROM daily_metrics WHERE store_id = ? AND date BETWEEN ? AND ?');
  for (const t of live) {
    if (!once(db, `theme-outcome:${t.id}`)) continue;
    const [storeId, agentId, day] = [String(t.store_id), String(t.agent_id), String(t.day)];
    const before = funnel.get(storeId, addDays(day, -14), addDays(day, -1))!;
    const after = funnel.get(storeId, addDays(day, 1), addDays(day, 14))!;
    if (!Number(before.sessions) || !Number(after.sessions)) continue;
    const [cr0, cr1] = [Number(before.orders) / Number(before.sessions), Number(after.orders) / Number(after.sessions)];
    const worked = cr1 > cr0;
    const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
    const name = String(t.title).replace(/^Publish theme change: /, '');
    recordOutcome(db, `theme:${t.id}`, worked, {
      storeId, agentId, kind: 'learning', confidence: worked ? 0.7 : 0.6, tags: ['outcome', 'theme'],
      text: `The theme change "${name}" ${worked ? 'worked' : 'did not help'}: conversion ${pct(cr0)} → ${pct(cr1)} (14 days before vs after, ${Number(before.sessions).toLocaleString('en-US')} → ${Number(after.sessions).toLocaleString('en-US')} sessions).`,
      evidence: `daily metrics ${addDays(day, -14)} to ${addDays(day, 14)} (request ${t.id})`,
    });
    if (t.run_id) judgeRun(db, `theme:${t.id}`, String(t.run_id), worked);
    if (worked) award(db, { ref: `theme-win:${t.id}`, amount: XP.win, storeId, agentId, reason: `Measured win: the theme change "${name}" lifted conversion` });
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
    wins: count(db, `SELECT count(*) AS n FROM xp_events WHERE reason LIKE 'Measured win:%'`),
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
    checkPriceOutcomes(db);
    checkPageOutcomes(db);
    checkThemeOutcomes(db);
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
