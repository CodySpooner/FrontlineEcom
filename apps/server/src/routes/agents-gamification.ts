import { awardXp, checkAchievements, commander, dailyMissions, levelForXp, profitStreak, XP, type Award, type Facts } from '@frontline/agents';
import type { MetricTotals, Mission } from '@frontline/shared';
import { Hono } from 'hono';
import { loadRows, summarize } from '../analytics';
import { localDate } from '../dates';
import type { Db } from '../db';
import { publish, subscribe } from '../live';
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

/** Approved requests pay the agent that made them. The bus is process-wide, so the handler holds the DB weakly. */
function watchApprovals(db: Db) {
  if (watched.has(db)) return;
  watched.add(db);
  const ref = new WeakRef(db);
  const off = subscribe((m) => {
    const db = ref.deref();
    if (!db) return off();
    if (m.type !== 'approval' || m.approval.status !== 'approved') return;
    if (!db.prepare(`SELECT 1 FROM approvals WHERE id = ? AND status = 'approved'`).get(m.approval.id)) return; // another DB's (tests)
    const { id, title, storeId, agentId } = m.approval;
    // Next tick: publishing inside this publish would reach other listeners before the approval itself.
    setImmediate(() => award(db, { ref: `approval:${id}`, amount: XP.approved, reason: `Request approved: ${title}`, storeId, agentId }));
  });
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
      });
      for (const m of list) if (m.progress >= m.target) award(db, { ref: `mission:${m.id}`, amount: m.xp, reason: `Mission complete: ${m.title}`, storeId: s.id });
      return list;
    });
}

export function gamificationRoutes(db: Db) {
  watchApprovals(db);
  const achievements = () => checkAchievements(db, facts(db), (a) => award(db, a));
  return new Hono()
    .get('/api/missions', (c) => c.json(missions(db, c.req.query('stores')?.split(',').filter(Boolean))))
    .get('/api/achievements', (c) => c.json(achievements()))
    .get('/api/commander', (c) => {
      achievements(); // newly unlocked ones count toward the level
      return c.json(commander(db, profitStreak(summary(db, listStores(db).map((s) => s.id), 30).series)));
    });
}
