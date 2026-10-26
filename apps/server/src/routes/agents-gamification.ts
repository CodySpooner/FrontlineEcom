import { adWindow, awardXp, cash, checkAchievements, commander, dailyMissions, economics, getAgent, judgeRun, levelForXp, nicheKey, once, profitStreak, promotionCandidates, thresholds, uncostedShare, writeMemory, XP, type Award, type Facts, type NewMemory } from '@frontline/agents';
import { AGENT_ROLES, PRODUCT_WRITE_PLATFORMS, type MetricTotals, type Mission, type Store } from '@frontline/shared';
import { Hono } from 'hono';
import { currentWindow, summarize } from '../analytics';
import { approvalsHook } from '../approvals';
import { addDays, localDate, midnight } from '../dates';
import { cachedRate, fxFor } from '../fx';
import type { Db } from '../db';
import { publish } from '../live';
import { log } from '../log';
import { onApproved } from './agents-actions';
import { notify } from '../settings';
import { listStores, storeZone } from '../stores';

/** awardXp + an `xp` live message (XP toast / level-up burst). */
export function award(db: Db, a: Award) {
  const out = awardXp(db, a);
  if (out) publish({ type: 'xp', ...out });
  return out;
}

/** A measured outcome becomes the agent's store learning and, once per change, a note in the owner's feed. */
function recordOutcome(db: Db, ref: string, worked: boolean | undefined, m: NewMemory, unclear = 'without unit costs') {
  writeMemory(db, m);
  if (!once(db, `outcome-note:${ref}`)) return;
  const agent = getAgent(db, m.agentId);
  const name = agent ? AGENT_ROLES[agent.role].name : 'Agent';
  const title = worked === undefined ? `${name}: result unclear ${unclear}` : worked ? `Measured win: ${name}` : `${name}: no lift this time`;
  notify(db, { kind: 'info', title, body: m.text, storeId: m.storeId, link: `/agents/${m.agentId}?tab=${worked ? 'history' : 'memory'}` }); // a win's XP line, else the learning
}

const count = (db: Db, sql: string, ...args: string[]) => Number(db.prepare(sql).get(...args)?.n ?? 0);
/** The dashboard's window: each store's today is its own (a live store dates its data in its zone). */
const summary = (db: Db, storeIds: string[], range: 7 | 30) => {
  const { to, todayFraction, rows } = currentWindow(db, storeIds, range);
  return summarize(rows, { range, to, storeIds, todayFraction });
};
/** A day in the store's zone, the one its orders and metrics are dated in (demo stores: this machine's). */
const storeDay = (db: Db, storeId: string, at: string | number = Date.now()) => localDate(new Date(at), storeZone(db, storeId));
// The 15-days-on checks pre-filter loosely in SQL (a store's day, or a UTC date, can sit up to 3 days off this machine's
// date), then gate each row on its store's own today.
const roughly15DaysAgo = (today?: string) => addDays(today ?? localDate(), -12);
/**
 * Every sync feeding the store's numbers (its platform, ad accounts, GA4: the per-store integrations) has finished since
 * `end` was over in the store's zone, and none is failing. Each check judges once, so judging before the last days'
 * orders arrived (the app reopened after a weekend, a broken login) would be wrong for good. Demo stores have none.
 * ponytail: Amazon's daily totals land a day or two late; only the ad check reads them.
 */
const synced = (db: Db, storeId: string, end: string) =>
  db
    .prepare('SELECT status, synced_at FROM integrations WHERE store_id = ?')
    .all(storeId)
    .every((i) => i.status !== 'error' && i.synced_at != null && storeDay(db, storeId, String(i.synced_at)) > end);
const settled = (db: Db, storeId: string, day: string, today?: string) => day <= addDays(today ?? storeDay(db, storeId), -15) && synced(db, storeId, addDays(day, 14));

const watched = new WeakSet<Db>();

/** Approved requests pay the agent that made them. */
function watchApprovals(db: Db) {
  if (watched.has(db)) return;
  watched.add(db);
  onApproved(db, (db, { id, title, storeId, agentId }) => award(db, { ref: `approval:${id}`, amount: XP.approved, reason: `Request approved: ${title}`, storeId, agentId }));
}

/**
 * SQL: `at` (a time or date) is on or after the store went live. Requests from its demo phase acted on demo data the
 * real sync replaced, so real numbers say nothing about them. Demo stores (never live) always pass.
 */
// ponytail: "went live" = the first time the agents saw the store connected (activateConnectedStores), minutes after the sync.
// A connected store the agents haven't seen yet (the check ran first at startup, or nobody opened the app since the sync)
// has no go-live time: nothing of it passes until it does ('~' sorts after every timestamp).
const sinceLive = (at: string, storeId: string) =>
  `${at} >= coalesce((SELECT at FROM done_once WHERE ref = 'activate:' || ${storeId}), CASE WHEN (SELECT connected FROM stores WHERE id = ${storeId}) = 1 THEN '~' ELSE '' END)`;

/**
 * Outcomes of approved ad changes: the store's blended ROAS over the 3 days after vs the 7 days before. Each outcome
 * becomes a store learning for the agent (so its next review knows what worked), and a win pays it once.
 * Checked lazily (commander/achievements reads); changes older than 30 days are left alone.
 */
export function checkAdOutcomes(db: Db, today?: string) {
  const rows = db
    .prepare(
      `SELECT id, store_id, agent_id, run_id, title, decided_at, json_extract(action_json, '$.kind') AS kind, json_extract(action_json, '$.payload.from') AS bfrom,
         json_extract(action_json, '$.payload.to') AS bto, (SELECT currency FROM stores WHERE id = approvals.store_id) AS currency FROM approvals
       WHERE status = 'approved' AND json_extract(action_json, '$.kind') IN ('ads.set_budget', 'ads.pause_campaign', 'ads.pause_adsets') AND decided_at >= ?
         AND NOT EXISTS (SELECT 1 FROM done_once WHERE ref = 'not-applied:' || approvals.id) AND ${sinceLive('decided_at', 'approvals.store_id')}`,
    )
    .all(new Date(Date.now() - 30 * 86_400_000).toISOString());
  for (const r of rows) {
    const day = storeDay(db, String(r.store_id), String(r.decided_at));
    if (addDays(day, 3) >= (today ?? storeDay(db, String(r.store_id)))) continue; // the 3 days after aren't complete yet
    if (!synced(db, String(r.store_id), addDays(day, 3))) continue;
    const b = adWindow(db, String(r.store_id), addDays(day, -7), addDays(day, -1));
    const a = adWindow(db, String(r.store_id), addDays(day, 1), addDays(day, 3));
    // A raise is judged on what its extra spend brought: blended ROAS dips as a winner scales even when it pays back.
    // A pause or cut on what the spend it took away was bringing: blended ROAS rises when any spend goes, even spend
    // that paid back. ponytail: per-day averages, store-wide; whatever else moved revenue in those days counts too.
    const [extra, more] = [a.spend / 3 - b.spend / 7, a.revenue / 3 - b.revenue / 7];
    // Not when many sales have no unit cost: break-even reads low there, so a losing raise would pass and a fair cut fail.
    const costed = uncostedShare(db, String(r.store_id), addDays(day, -30)) < 0.1;
    const budget = r.kind === 'ads.set_budget';
    const raise = budget && Number(r.bto) > Number(r.bfrom) && extra > 0 && costed;
    const cut = (!budget || Number(r.bto) < Number(r.bfrom)) && extra < 0 && costed;
    if (!b.spend || (!a.spend && !cut)) continue;
    if (!once(db, `ads-outcome:${r.id}`)) continue; // judged once: an outcome the owner deleted stays deleted
    const [before, after] = [b.revenue / b.spend, a.revenue / a.spend];
    const breakEven = raise || cut ? thresholds(economics(db, String(r.store_id), addDays(day, -30))).breakEven : 0;
    const marginal = more / extra; // a cut's: the revenue that went per unit of spend that went
    const worked = raise ? marginal >= breakEven : cut ? marginal < breakEven : after > before;
    const money = (n: number) => `${n < 0 ? '-' : '+'}${Math.round(Math.abs(n)).toLocaleString('en-US')} ${String(r.currency)}/day`;
    const vs = `${marginal.toFixed(2)} vs break-even ${breakEven.toFixed(2)}`;
    const roas = raise
      ? `${money(extra)} ad spend brought ${money(more)} revenue (incremental ROAS ${vs})`
      : cut
        ? `${money(extra)} ad spend went with ${money(more)} revenue (ROAS of the spend cut ${vs})`
        : `blended ROAS ${before.toFixed(2)} → ${after.toFixed(2)}`;
    recordOutcome(db, `ads:${r.id}`, worked, {
      storeId: String(r.store_id), agentId: String(r.agent_id), kind: 'learning', confidence: worked ? 0.7 : 0.6, tags: ['outcome', 'ads'],
      text: `"${r.title}" ${worked ? 'worked' : 'did not help'}: ${roas} in the 3 days after.`,
      evidence: `7 days before vs 3 days after ${day} (request ${r.id})`,
    });
    // Once per run and day: its other changes that day are judged on the same store-wide ROAS, not new evidence.
    if (r.run_id) judgeRun(db, `ads:${r.run_id}:${day}`, String(r.run_id), worked);
    if (!worked) continue;
    award(db, {
      ref: `win:${r.id}`, amount: XP.win, storeId: String(r.store_id), agentId: String(r.agent_id),
      reason: raise
        ? `Measured win: incremental ROAS ${vs} after "${r.title}"`
        : cut
          ? `Measured win: the spend "${r.title}" cut was returning ${marginal.toFixed(2)}, under break-even ${breakEven.toFixed(2)}`
          : `Measured win: ROAS ${before.toFixed(2)} → ${after.toFixed(2)} after "${r.title}"`,
    });
  }
}

/**
 * Products added through an approved request, judged on their first 14 days of real sales (core's order_items; demo
 * stores have none, so they're skipped). Each becomes a store learning for the agent that proposed it; a product that
 * sold 10+ units at a profit pays it once.
 */
export function checkProductOutcomes(db: Db, today?: string) {
  // Added as a draft, a product goes on sale when the owner activates it (on the platform, or its page on a demo store),
  // maybe days later: its 14 days count from then. ponytail: seen here, so up to a sync plus an hour late.
  const live = db.prepare(
    `SELECT t.store_id, t.product_id FROM product_tests t JOIN products p ON p.store_id = t.store_id AND p.id = t.product_id WHERE t.judged_at IS NULL AND p.status = 'active'`,
  );
  for (const r of live.all()) once(db, `product-live:${r.store_id}:${r.product_id}`);
  const tests = db
    .prepare(
      `SELECT t.*, s.currency, a.run_id, p.status, (SELECT at FROM done_once WHERE ref = 'product-live:' || t.store_id || ':' || t.product_id) AS live_at FROM product_tests t JOIN stores s ON s.id = t.store_id LEFT JOIN approvals a ON a.id = t.approval_id
       LEFT JOIN products p ON p.store_id = t.store_id AND p.id = t.product_id
       WHERE t.judged_at IS NULL AND s.demo = 0 AND t.added_on <= ? AND ${sinceLive('coalesce(a.decided_at, t.added_on)', 't.store_id')}`,
    )
    .all(roughly15DaysAgo(today));
  for (const t of tests) {
    const start = t.live_at ? [String(t.added_on), storeDay(db, String(t.store_id), String(t.live_at))].sort().at(-1)! : String(t.added_on);
    if (!settled(db, String(t.store_id), start, today)) continue;
    const end = addDays(start, 13); // its first 14 days, the first one included
    const { units, revenue, profit, uncosted } = productSales(db, String(t.store_id), String(t.product_id), start, end);
    // Still a draft with no sales: the owner never put it on sale, which says nothing about demand. Archived or removed
    // without a sale is judged: it flopped, or the owner turned the pick down after approving it.
    if (!units && t.status === 'draft') {
      db.prepare('UPDATE product_tests SET judged_at = ? WHERE store_id = ? AND product_id = ?').run(new Date().toISOString(), String(t.store_id), String(t.product_id));
      continue;
    }
    // ponytail: no per-product ad spend yet, so the bar is units + profit, not ROAS vs break-even. Sold with no unit cost,
    // its revenue reads as profit: enough units, but whether it paid can't be told.
    const won = units < 10 ? false : uncosted ? undefined : profit > 0;
    const money = (n: number) => `${Math.round(n).toLocaleString('en-US')} ${t.currency}`;
    const storeId = String(t.store_id);
    const agentId = String(t.agent_id);
    recordOutcome(db, `product:${t.approval_id}:${t.product_id}`, won, {
      storeId, agentId, kind: 'learning', confidence: won ? 0.7 : won === undefined ? 0.5 : 0.6, tags: ['outcome', 'product'],
      text:
        won === undefined
          ? `"${t.title}" sold ${units} units, ${money(revenue)} revenue in its first 14 days${t.live_at ? ' on sale' : ''}; its profit can't be judged: it has no unit cost.`
          : `"${t.title}" ${won ? 'sold' : 'did not take off'}: ${units} units, ${money(revenue)} revenue, ${money(profit)} profit in its first 14 days${t.live_at ? ' on sale' : ''}.`,
      evidence: `paid orders ${start} to ${end} (request ${t.approval_id})`,
    });
    if (t.run_id && won !== undefined) judgeRun(db, `product:${t.approval_id}:${t.product_id}`, String(t.run_id), won);
    if (won) award(db, { ref: `product-win:${t.approval_id}:${t.product_id}`, amount: XP.win, storeId, agentId, reason: `Measured win: "${t.title}" sold ${units} units in 14 days` });
    db.prepare('UPDATE product_tests SET judged_at = ? WHERE store_id = ? AND product_id = ?').run(new Date().toISOString(), storeId, String(t.product_id));
  }
}

/**
 * A product's paid units and profit after unit cost and the store's fee estimate (% of revenue plus the per-order fee
 * for each order it was in) over [from, to] (core's order_items: real stores only). Amazon refund lines come off their
 * order's day, as on the dashboard. ponytail: units stay gross (a refund line has no quantity), a refund posted after
 * the judgement isn't seen, and an order with several products charges each of them the whole per-order fee (errs low).
 */
const productSales = (db: Db, storeId: string, productId: string, from: string, to: string) => {
  const r = db
    .prepare(
      `SELECT coalesce(sum(units), 0) AS units, coalesce(sum(revenue), 0) AS revenue,
         coalesce(sum(revenue - cost), 0) - coalesce(sum(revenue), 0) * (SELECT fee_percent FROM stores WHERE id = ?1) / 100
           - count(DISTINCT order_id) * (SELECT fee_per_order FROM stores WHERE id = ?1) AS profit,
         coalesce(max(order_id IS NOT NULL AND cost = 0), 0) AS uncosted
       FROM (
         SELECT i.order_id, i.quantity AS units, i.revenue, i.cost FROM order_items i JOIN orders o ON o.store_id = i.store_id AND o.id = i.order_id
         WHERE i.store_id = ?1 AND i.product_id = ?2 AND o.status = 'paid' AND o.local_date BETWEEN ?3 AND ?4
         UNION ALL SELECT NULL, 0, -r.amount, 0 FROM amazon_refunds r JOIN orders o ON o.store_id = r.store_id AND o.id = r.order_id
         WHERE r.store_id = ?1 AND r.product_id = ?2 AND o.status = 'paid' AND o.local_date BETWEEN ?3 AND ?4
       )`,
    )
    .get(storeId, productId, from, to)!;
  return { units: Number(r.units), revenue: Number(r.revenue), profit: Number(r.profit), uncosted: !!r.uncosted };
};

/**
 * The profit a product would have made after `day` had nothing changed but the season: its 14 days before, moved as
 * much as the rest of the store's product sales did (Black Friday lifts every product; January drops them). `note`
 * says so when that's 10%+. ponytail: store-wide, revenue-weighted; a loss before isn't scaled.
 */
function par(db: Db, storeId: string, productId: string, day: string, before: { profit: number }, money: (n: number) => string) {
  const rest = db.prepare(
    `SELECT coalesce(sum(i.revenue), 0) AS revenue FROM order_items i JOIN orders o ON o.store_id = i.store_id AND o.id = i.order_id
     WHERE i.store_id = ? AND i.product_id != ? AND o.status = 'paid' AND o.local_date BETWEEN ? AND ?`,
  );
  const [b, a] = [[-14, -1], [1, 14]].map(([from, to]) => Number(rest.get(storeId, productId, addDays(day, from!), addDays(day, to!))?.revenue));
  const trend = b! > 0 && a! > 0 && before.profit > 0 ? a! / b! : 1;
  const moved = Math.round((trend - 1) * 100);
  const profit = before.profit * trend;
  return { profit, note: Math.abs(moved) >= 10 ? ` (par ${money(profit)}: the rest of the store's sales moved ${moved > 0 ? '+' : ''}${moved}%)` : '' };
}

/** Units a price test or page needs across its 28 days to be judged. ponytail: under it one order flips the verdict; no significance test. */
const MIN_UNITS = 10;
/** Orders a theme change needs across its 28 days to be judged on conversion. */
const MIN_ORDERS = 30;

/**
 * Price tests on real stores, 15+ days after the change: the product's profit in the 14 days after vs the 14
 * before, scaled to the season (par); core's order_items, demo stores have none. A learning either way; more profit is a
 * measured win.
 */
// ponytail: no traffic or ad-spend adjustment beyond the season; the learning says the windows so the agent can weigh it.
export function checkPriceOutcomes(db: Db, today?: string) {
  const tests = db
    .prepare(
      `SELECT t.*, s.currency, a.run_id FROM price_tests t JOIN stores s ON s.id = t.store_id LEFT JOIN approvals a ON a.id = t.approval_id
       WHERE t.judged_at IS NULL AND s.demo = 0 AND t.changed_on <= ? AND ${sinceLive('coalesce(a.decided_at, t.changed_on)', 't.store_id')}`,
    )
    .all(roughly15DaysAgo(today));
  for (const t of tests) {
    const [storeId, productId, day] = [String(t.store_id), String(t.product_id), String(t.changed_on)];
    if (!settled(db, storeId, day, today)) continue;
    const before = productSales(db, storeId, productId, addDays(day, -14), addDays(day, -1));
    const after = productSales(db, storeId, productId, addDays(day, 1), addDays(day, 14));
    db.prepare('UPDATE price_tests SET judged_at = ? WHERE approval_id = ?').run(new Date().toISOString(), String(t.approval_id));
    if (!before.units) continue; // no sales before (new, or not selling): no baseline, so nothing to compare
    const few = before.units + after.units < MIN_UNITS;
    // Sales with no unit cost (cost 0) count their whole price as profit: a cut that sells more at a loss would read as a win.
    const money = (n: number) => `${Math.round(n).toLocaleString('en-US')} ${t.currency}`;
    const season = par(db, storeId, productId, day, before, money);
    const worked = few || before.uncosted || after.uncosted ? undefined : after.profit > season.profit;
    const price = (n: unknown) => cash(Number(n), String(t.currency));
    const agentId = String(t.agent_id);
    recordOutcome(db, `price:${t.approval_id}`, worked, {
      storeId, agentId, kind: 'learning', confidence: worked ? 0.7 : worked === undefined ? 0.5 : 0.6, tags: ['outcome', 'pricing'],
      text: few
        ? `Pricing "${t.title}" ${price(t.from_price)} → ${price(t.to_price)} can't be judged on ${before.units + after.units} units sold (it takes ${MIN_UNITS}): profit ${money(before.profit)} → ${money(after.profit)}, ${before.units} → ${after.units} units (14 days before vs after).`
        : worked === undefined
        ? `Pricing "${t.title}" ${price(t.from_price)} → ${price(t.to_price)} can't be judged: no unit cost is set, so profit before product cost went ${money(before.profit)} → ${money(after.profit)}, ${before.units} → ${after.units} units (14 days before vs after).`
        : `Pricing "${t.title}" ${price(t.from_price)} → ${price(t.to_price)} ${worked ? 'worked' : 'did not help'}: profit ${money(before.profit)} → ${money(after.profit)}${season.note}, ${before.units} → ${after.units} units (14 days before vs after).`,
      evidence: `paid orders ${addDays(day, -14)} to ${addDays(day, 14)} (request ${t.approval_id})`,
    }, few ? 'on too few sales' : undefined);
    if (t.run_id && worked !== undefined) judgeRun(db, `price:${t.approval_id}`, String(t.run_id), worked);
    if (worked) award(db, { ref: `price-win:${t.approval_id}`, amount: XP.win, storeId, agentId, reason: `Measured win: "${t.title}" at ${price(t.to_price)} made more profit` });
  }
}

/**
 * Product pages published from the Store Builder on real stores, 15+ days later: the product's profit in the 14
 * days after publishing vs the 14 before, scaled to the season (par). A learning for the agent that drafted it; more
 * profit is a measured win. A price test on the product can't overlap it (propose_price_change and publish_page refuse).
 */
export function checkPageOutcomes(db: Db, today?: string) {
  const pages = db
    .prepare(
      `SELECT d.id, d.store_id, d.agent_id, d.run_id, d.product_id, d.title, d.published_at, s.currency
       FROM page_drafts d JOIN stores s ON s.id = d.store_id
       WHERE d.kind = 'product' AND d.product_id IS NOT NULL AND d.published_at IS NOT NULL AND s.demo = 0 AND substr(d.published_at, 1, 10) <= ?
         AND ${sinceLive('d.published_at', 'd.store_id')}`,
    )
    .all(roughly15DaysAgo(today));
  for (const d of pages) {
    const [storeId, productId, agentId] = [String(d.store_id), String(d.product_id), String(d.agent_id)];
    const day = storeDay(db, storeId, String(d.published_at));
    if (!settled(db, storeId, day, today) || !once(db, `page-outcome:${d.id}`)) continue;
    const before = productSales(db, storeId, productId, addDays(day, -14), addDays(day, -1));
    const after = productSales(db, storeId, productId, addDays(day, 1), addDays(day, 14));
    if (!before.units) continue; // a new product's page (it had no sales before) has no baseline: its product test judges the sales
    const few = before.units + after.units < MIN_UNITS;
    const money = (n: number) => `${Math.round(n).toLocaleString('en-US')} ${d.currency}`;
    const season = par(db, storeId, productId, day, before, money);
    const worked = few || before.uncosted || after.uncosted ? undefined : after.profit > season.profit; // as price tests
    recordOutcome(db, `page:${d.id}`, worked, {
      storeId, agentId, kind: 'learning', confidence: worked ? 0.7 : worked === undefined ? 0.5 : 0.6, tags: ['outcome', 'page'],
      text: few
        ? `The new "${d.title}" page can't be judged on ${before.units + after.units} units sold (it takes ${MIN_UNITS}): profit ${money(before.profit)} → ${money(after.profit)}, ${before.units} → ${after.units} units (14 days before vs after).`
        : worked === undefined
        ? `The new "${d.title}" page can't be judged: no unit cost is set, so profit before product cost went ${money(before.profit)} → ${money(after.profit)}, ${before.units} → ${after.units} units (14 days before vs after).`
        : `The new "${d.title}" page ${worked ? 'worked' : 'did not help'}: profit ${money(before.profit)} → ${money(after.profit)}${season.note}, ${before.units} → ${after.units} units (14 days before vs after).`,
      evidence: `paid orders ${addDays(day, -14)} to ${addDays(day, 14)} (draft ${d.id})`,
    }, few ? 'on too few sales' : undefined);
    if (d.run_id && worked !== undefined) judgeRun(db, `page:${d.id}`, String(d.run_id), worked);
    if (worked) award(db, { ref: `page-win:${d.id}`, amount: XP.win, storeId, agentId, reason: `Measured win: the new "${d.title}" page made more profit` });
  }
}

/** Theme changes that went live 15+ days ago: store conversion rate in the 14 days after vs the 14 before, once each. */
// ponytail: any lift counts as a win, no significance test; small stores need a few thousand sessions a side to mean much.
export function checkThemeOutcomes(db: Db, today?: string) {
  const live = db
    .prepare(
      `SELECT a.id, a.store_id, a.agent_id, a.run_id, a.title, o.at FROM approvals a
       JOIN done_once o ON o.ref = 'theme-live:' || a.id JOIN stores s ON s.id = a.store_id
       WHERE s.demo = 0 AND substr(o.at, 1, 10) <= ?`,
    )
    .all(roughly15DaysAgo(today));
  // Amazon as an extra channel (core's channel_daily; a theme store is Shopify) and TikTok Shop's `tt-` orders (CORE-82)
  // are in orders, but their shoppers never saw the theme.
  // Only days with sessions: before traffic was reported (GA4 connected mid-window) a day's orders have no sessions to divide by.
  const funnel = db.prepare(
    `SELECT coalesce(sum(d.orders - coalesce(c.orders, 0)
         - (SELECT count(*) FROM orders o WHERE o.store_id = d.store_id AND o.local_date = d.date AND o.status = 'paid' AND o.id LIKE 'tt-%')), 0) AS orders,
       coalesce(sum(d.sessions), 0) AS sessions
     FROM daily_metrics d LEFT JOIN channel_daily c ON c.store_id = d.store_id AND c.date = d.date AND c.channel = 'amazon'
     WHERE d.store_id = ?1 AND d.date BETWEEN ?2 AND ?3 AND d.sessions > 0`,
  );
  for (const t of live) {
    const [storeId, agentId] = [String(t.store_id), String(t.agent_id)];
    const day = storeDay(db, storeId, String(t.at));
    if (!settled(db, storeId, day, today) || !once(db, `theme-outcome:${t.id}`)) continue;
    const before = funnel.get(storeId, addDays(day, -14), addDays(day, -1))!;
    const after = funnel.get(storeId, addDays(day, 1), addDays(day, 14))!;
    if (!Number(before.sessions) || !Number(after.sessions)) continue;
    const [cr0, cr1] = [Number(before.orders) / Number(before.sessions), Number(after.orders) / Number(after.sessions)];
    // A few orders a fortnight: one either way moves conversion more than any theme change (as MIN_UNITS for prices).
    const orders = Number(before.orders) + Number(after.orders);
    const worked = orders < MIN_ORDERS ? undefined : cr1 > cr0;
    const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
    const name = String(t.title).replace(/^Publish theme change: /, '');
    const verdict = worked === undefined ? `can't be judged on ${orders} orders (it takes ${MIN_ORDERS})` : worked ? 'worked' : 'did not help';
    recordOutcome(db, `theme:${t.id}`, worked, {
      storeId, agentId, kind: 'learning', confidence: worked ? 0.7 : worked === undefined ? 0.5 : 0.6, tags: ['outcome', 'theme'],
      text: `The theme change "${name}" ${verdict}: conversion ${pct(cr0)} → ${pct(cr1)} (14 days before vs after, ${Number(before.sessions).toLocaleString('en-US')} → ${Number(after.sessions).toLocaleString('en-US')} sessions).`,
      evidence: `daily metrics ${addDays(day, -14)} to ${addDays(day, 14)} (request ${t.id})`,
    }, 'on too few orders');
    if (t.run_id && worked !== undefined) judgeRun(db, `theme:${t.id}`, String(t.run_id), worked);
    if (worked) award(db, { ref: `theme-win:${t.id}`, amount: XP.win, storeId, agentId, reason: `Measured win: the theme change "${name}" lifted conversion` });
  }
}

function facts(db: Db): Facts {
  const ids = listStores(db).map((s) => s.id);
  const best = (totals: MetricTotals[], k: keyof MetricTotals) => Math.max(0, ...totals.map((t) => t[k]));
  const month = summary(db, ids, 30);
  const week = summary(db, ids, 7);
  // "$10K Month" is USD; the summary is in the one store's currency or the base currency. No rate yet: not counted.
  const usd = cachedRate(db, fxFor(db, ids).currency, 'USD') ?? 0;
  return {
    orders: month.totals.orders,
    best30Revenue: best(month.byStore.map((s) => s.totals), 'revenue') * usd,
    best7Roas: best(week.byStore.map((s) => s.totals), 'roas'),
    profitStreak: profitStreak(month.series),
    fullSquad: count(db, 'SELECT count(*) AS n FROM (SELECT store_id FROM agents GROUP BY store_id HAVING min(enabled) = 1 AND count(*) >= 8)') > 0,
    runsDone: count(db, `SELECT count(*) AS n FROM agent_runs WHERE status = 'done'`),
    approved: count(db, `SELECT count(*) AS n FROM approvals WHERE status = 'approved'`),
    memories: count(db, 'SELECT count(*) AS n FROM store_memory'),
    topLevel: levelForXp(count(db, 'SELECT coalesce(max(xp), 0) AS n FROM agents')),
    wins: count(db, `SELECT count(*) AS n FROM xp_events WHERE reason LIKE 'Measured win:%'`),
    liveStores: count(db, 'SELECT count(*) AS n FROM stores WHERE demo = 0 AND connected = 1'),
  };
}

/** Today's missions; ones that are complete pay the commander (once). */
function missions(db: Db, storeIds?: string[]): Mission[] {
  return listStores(db)
    .filter((s) => !storeIds?.length || storeIds.includes(s.id))
    .flatMap((s) => {
      // The store's own today and midnight: a live store in another zone has its day on its own clock.
      const { series, to } = summary(db, [s.id], 30);
      const since = new Date(midnight(to, storeZone(db, s.id))).toISOString();
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
        // A live store the app can't add products to can't get a product approved: no mission for it there.
        productHunterOn:
          (!s.connected || PRODUCT_WRITE_PLATFORMS.includes(s.platform)) &&
          !!count(db, `SELECT count(*) AS n FROM agents WHERE store_id = ? AND enabled = 1 AND role = 'product_hunter'`, s.id),
        creativesToday: count(db, 'SELECT count(*) AS n FROM creatives WHERE store_id = ? AND created_at >= ?', s.id, since),
        productsApprovedToday: count(
          db,
          `SELECT count(*) AS n FROM approvals WHERE store_id = ? AND status = 'approved' AND json_extract(action_json, '$.kind') = 'store.add_products' AND decided_at >= ?`,
          s.id, since,
        ),
      });
      // One payout per slot a day: the third (requests or a briefing) and fourth (creatives or a product) swap as the day goes.
      const slot = (id: string) => id.replace(/:brief$/, ':requests').replace(/:product$/, ':creatives');
      for (const m of list) if (m.progress >= m.target) award(db, { ref: `mission:${slot(m.id)}`, amount: m.xp, reason: `Mission complete: ${m.title}`, storeId: s.id });
      return list;
    });
}

/**
 * A learning live stores of one niche each found on their own becomes one request (once per text) to share it with every
 * store of the niche: no Claude run needed. Demo stores' learnings come from simulated numbers, so only live stores count.
 */
export function proposeNichePromotions(db: Db) {
  // Gone live, not just connected: going live (activateConnectedStores) is what clears a store's demo learnings.
  const activated = db.prepare('SELECT 1 FROM done_once WHERE ref = ?');
  // By niche key: custom niches group by their own name ("Soy candles" with "soy candles", not with every custom store).
  const byNiche = new Map<string, Store[]>();
  for (const s of listStores(db)) {
    const key = nicheKey(s);
    if (s.connected && key !== 'other:' && activated.get(`activate:${s.id}`)) byNiche.set(key, [...(byNiche.get(key) ?? []), s]);
  }
  // Once per learning: any memory of the group already offered (the group's lead wording can change as confidence
  // moves), or any of its wordings already asked about or shared, and it isn't asked again.
  const offered = db.prepare(`SELECT 1 FROM done_once WHERE ref IN (SELECT 'promote-memory:' || value FROM json_each(?))`);
  const known = db.prepare(
    `SELECT 1 FROM (SELECT lower(text) AS t FROM niche_learnings WHERE niche = ?1
       UNION ALL SELECT lower(json_extract(action_json, '$.payload.text')) FROM approvals WHERE json_extract(action_json, '$.kind') = 'niche.promote_learning' AND json_extract(action_json, '$.payload.niche') = ?1)
     WHERE t IN (SELECT lower(text) FROM store_memory WHERE id IN (SELECT value FROM json_each(?2)))`,
  );
  for (const [key, live] of byNiche) {
    if (live.length < 2) continue;
    const niche = live[0]!.niche === 'other' ? live[0]!.nicheDetail : live[0]!.niche;
    for (const c of promotionCandidates(db, live.map((s) => s.id))) {
      const stores = c.storeIds.map((id) => live.find((s) => s.id === id)!);
      const ids = JSON.stringify(c.memoryIds);
      if (offered.get(ids) || known.get(key, ids)) continue;
      for (const id of c.memoryIds) once(db, `promote-memory:${id}`);
      const names = stores.map((s) => s.name).join(', ');
      approvalsHook(db).create({
        storeId: stores[0]!.id,
        agentId: `${stores[0]!.id}:market_analyst`,
        title: `Share a learning with all ${niche} stores`.slice(0, 80),
        // Not cut: approved, the whole text reaches every store of the niche (a reflection's learning has no length cap).
        reason: `${c.text} Found on its own in ${names} (confidence ${c.confidence.toFixed(1)}). Approved, every ${niche} store's squad sees it.`,
        action: { kind: 'niche.promote_learning', payload: { niche: key, text: c.text, evidence: `Held in ${names}` } },
      });
    }
  }
}

/** Every outcome check, then the achievements they (and everything else) may have unlocked. */
function judge(db: Db) {
  checkAdOutcomes(db);
  checkProductOutcomes(db);
  checkPriceOutcomes(db);
  checkPageOutcomes(db);
  checkThemeOutcomes(db);
  return checkAchievements(db, facts(db), (a) => award(db, a));
}

/** Outcomes judged hourly as well as on dashboard reads, so the squad learns what worked while the app sits unopened. */
export function startOutcomeLoop(db: Db, everyMs = 3_600_000) {
  const check = () => {
    try {
      judge(db);
      proposeNichePromotions(db); // a pairwise scan over the niche's learnings: hourly, not on every dashboard read
    } catch (e) {
      log('error', 'outcome check failed', { error: e instanceof Error ? e.message : String(e) });
    }
  };
  check();
  const timer = setInterval(check, everyMs);
  return () => clearInterval(timer);
}

export function gamificationRoutes(db: Db) {
  watchApprovals(db);
  const achievements = () => judge(db);
  return new Hono()
    .get('/api/missions', (c) => c.json(missions(db, c.req.query('stores')?.split(',').filter(Boolean))))
    .get('/api/achievements', (c) => c.json(achievements()))
    .get('/api/commander', (c) => {
      achievements(); // newly unlocked ones count toward the level
      return c.json(commander(db, profitStreak(summary(db, listStores(db).map((s) => s.id), 30).series)));
    });
}
