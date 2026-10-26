import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { RANKS, type Achievement, type Commander, type MetricPoint, type Mission, type Rank, type XpEvent } from '@frontline/shared';

// XP is a ledger (`xp_events`, agents-lane migration in apps/server/src/db.ts). `ref` makes every award idempotent:
// the same run, approval, memory, mission or achievement never pays twice. Agent totals are mirrored on `agents.xp`.

/** What each action is worth to the agent who did it. */
export const XP = { runDone: 10, memory: 5, approved: 25, win: 50 } as const;

/** Total XP to reach `level`: 0, 100, 300, 600, 1000… (each level costs 100 more than the last). */
export const xpForLevel = (level: number) => 50 * level * (level - 1);

export function levelForXp(xp: number) {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  return level;
}

/** XP into the current level and what the level costs, for XP bars. */
export function levelProgress(xp: number) {
  const level = levelForXp(xp);
  return { xp: xp - xpForLevel(level), needed: xpForLevel(level + 1) - xpForLevel(level) };
}

const RANK_FROM: Record<Rank, number> = { Recruit: 1, Operative: 5, Specialist: 10, Veteran: 15, Elite: 20, Legend: 30 };
export const rankForLevel = (level: number): Rank => RANKS.findLast((r) => level >= RANK_FROM[r]) ?? 'Recruit';

/** Demo squads start with some history so levels and ranks vary (deterministic per agent). */
export function demoXp(agentId: string) {
  let h = 2166136261;
  for (const c of agentId) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return 150 + ((h >>> 0) % 5850);
}

export interface Award {
  /** Unique per source, e.g. `run:<id>`, `approval:<id>`, `mission:<id>`, `achievement:<id>`. */
  ref: string;
  amount: number;
  reason: string;
  storeId?: string;
  /** Omitted = the owner (commander). */
  agentId?: string;
}

/** Adds XP once per `ref`. Returns the event (+ level-up) when it was new. */
export function awardXp(db: DatabaseSync, a: Award, now = new Date()): { xp: XpEvent; levelUp?: { level: number; rank: Rank } } | undefined {
  const before = a.agentId ? agentXp(db, a.agentId) : commanderXp(db);
  if (before === undefined) return; // unknown agent
  const xp: XpEvent = {
    id: randomUUID(),
    amount: a.amount,
    reason: a.reason,
    ...(a.storeId ? { storeId: a.storeId } : {}),
    ...(a.agentId ? { agentId: a.agentId } : {}),
    createdAt: now.toISOString(),
  };
  const added = db
    .prepare('INSERT OR IGNORE INTO xp_events (id, ref, store_id, agent_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(xp.id, a.ref, a.storeId ?? null, a.agentId ?? null, a.amount, a.reason, xp.createdAt).changes;
  if (!added) return;
  const after = before + a.amount;
  if (a.agentId) db.prepare('UPDATE agents SET xp = ?, level = ? WHERE id = ?').run(after, levelForXp(after), a.agentId);
  const level = levelForXp(after);
  return { xp, ...(level > levelForXp(before) ? { levelUp: { level, rank: rankForLevel(level) } } : {}) };
}

const agentXp = (db: DatabaseSync, id: string) => {
  const r = db.prepare('SELECT xp FROM agents WHERE id = ?').get(id);
  return r ? Number(r.xp) : undefined;
};
const commanderXp = (db: DatabaseSync) => Number(db.prepare('SELECT coalesce(sum(amount), 0) AS xp FROM xp_events WHERE agent_id IS NULL').get()?.xp ?? 0);

/** The owner's level: XP from missions and achievements. */
export function commander(db: DatabaseSync, streakDays: number): Commander {
  const xp = commanderXp(db);
  const level = levelForXp(xp);
  return { level, xp, rank: rankForLevel(level), levelProgress: levelProgress(xp), streakDays };
}

/** Days in a row, ending with the last day of the series, that made a profit. */
export function profitStreak(series: Pick<MetricPoint, 'profit'>[]) {
  let days = 0;
  for (let i = series.length - 1; i >= 0 && series[i]!.profit > 0; i--) days++;
  return days;
}

export interface StoreDay {
  storeId: string;
  /** YYYY-MM-DD */
  date: string;
  currency: string;
  revenueToday: number;
  ordersToday: number;
  /** Daily averages over the previous 7 days. */
  avgRevenue: number;
  avgOrders: number;
  requestsOpen: number;
  requestsDecidedToday: number;
  runsToday: number;
  /** Squad missions: which agents are on, and what they shipped today. */
  creativeAgentsOn?: boolean;
  productHunterOn?: boolean;
  creativesToday?: number;
  productsApprovedToday?: number;
}

/** Today's 3 missions for a store: beat the recent average on revenue and orders, then clear requests (or brief the squad). */
export function dailyMissions(d: StoreDay): Mission[] {
  const id = (kind: string) => `${d.storeId}:${d.date}:${kind}`;
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: d.currency, maximumFractionDigits: 0 });
  const revenueTarget = Math.max(50, Math.ceil((d.avgRevenue * 1.1) / 50) * 50);
  const ordersTarget = Math.max(1, Math.ceil(d.avgOrders * 1.1));
  const requests = d.requestsOpen + d.requestsDecidedToday;
  return [
    { id: id('revenue'), storeId: d.storeId, title: `Hit ${money.format(revenueTarget)} revenue today`, progress: Math.floor(d.revenueToday), target: revenueTarget, xp: 100 },
    { id: id('orders'), storeId: d.storeId, title: `Get ${ordersTarget} orders today`, progress: d.ordersToday, target: ordersTarget, xp: 60 },
    requests
      ? { id: id('requests'), storeId: d.storeId, title: 'Clear all agent requests', progress: d.requestsDecidedToday, target: requests, xp: 40 }
      : { id: id('brief'), storeId: d.storeId, title: 'Give your squad 2 tasks', progress: Math.min(2, d.runsToday), target: 2, xp: 40 },
    ...squadMission(d, id),
  ];
}

/** One mission from the squad's state; with both agents on, creatives on even days and products on odd ones. */
function squadMission(d: StoreDay, id: (kind: string) => string): Mission[] {
  const creatives = d.creativeAgentsOn && (!d.productHunterOn || Number(d.date.slice(8)) % 2 === 0);
  if (creatives) return [{ id: id('creatives'), storeId: d.storeId, title: 'Launch 2 new creatives', progress: Math.min(2, d.creativesToday ?? 0), target: 2, xp: 50 }];
  if (d.productHunterOn) return [{ id: id('product'), storeId: d.storeId, title: 'Approve a product to test', progress: Math.min(1, d.productsApprovedToday ?? 0), target: 1, xp: 50 }];
  return [];
}

/** Numbers the achievement checks read. */
export interface Facts {
  orders: number;
  best30Revenue: number;
  best7Roas: number;
  profitStreak: number;
  fullSquad: boolean;
  runsDone: number;
  approved: number;
  memories: number;
  topLevel: number;
  /** Measured wins paid so far (an agent's change improved the numbers it was judged on). */
  wins: number;
}

// Revenue milestones read in the owner's base currency: core converts multi-store totals (CORE-26).
export const ACHIEVEMENTS: (Omit<Achievement, 'unlockedAt'> & { check: (f: Facts) => boolean })[] = [
  { id: 'first_sale', title: 'First Sale', description: 'A store made its first sale.', xp: 50, check: (f) => f.orders > 0 },
  { id: 'squad_deployed', title: 'Squad Fully Deployed', description: 'All 8 agents online in a store.', xp: 50, check: (f) => f.fullSquad },
  { id: 'first_orders', title: 'First Orders', description: 'Gave an agent its first task.', xp: 25, check: (f) => f.runsDone >= 1 },
  { id: 'ten_k_month', title: '$10K Month', description: 'A store did $10,000 in revenue over 30 days.', xp: 200, check: (f) => f.best30Revenue >= 10_000 },
  { id: 'roas_3x_week', title: 'ROAS 3x Week', description: 'A store held 3.0+ ROAS over the last 7 days.', xp: 150, check: (f) => f.best7Roas >= 3 },
  { id: 'profit_streak_7', title: '7-Day Profit Streak', description: 'Profitable every day for a week.', xp: 150, check: (f) => f.profitStreak >= 7 },
  { id: 'trusted_advisor', title: 'Trusted Advisor', description: 'Approved 10 agent requests.', xp: 100, check: (f) => f.approved >= 10 },
  { id: 'learning_machine', title: 'Learning Machine', description: 'Your squads learned 25 things about your stores.', xp: 100, check: (f) => f.memories >= 25 },
  { id: 'battle_hardened', title: 'Battle-Hardened', description: 'An agent reached Veteran rank.', xp: 150, check: (f) => f.topLevel >= RANK_FROM.Veteran },
  { id: 'first_win', title: 'First Measured Win', description: "An agent's change measurably improved the numbers.", xp: 100, check: (f) => f.wins >= 1 },
  { id: 'proven_squad', title: 'Proven Squad', description: '10 measured wins across your stores.', xp: 300, check: (f) => f.wins >= 10 },
  { id: 'hundred_k_month', title: '$100K Month', description: 'A store did $100,000 in revenue over 30 days.', xp: 500, check: (f) => f.best30Revenue >= 100_000 },
  { id: 'profit_streak_30', title: '30-Day Profit Streak', description: 'Profitable every day for 30 days.', xp: 400, check: (f) => f.profitStreak >= 30 },
  { id: 'elite_agent', title: 'Elite Operator', description: 'An agent reached Elite rank.', xp: 300, check: (f) => f.topLevel >= RANK_FROM.Elite },
  { id: 'legend_agent', title: 'Living Legend', description: 'An agent reached Legend rank.', xp: 500, check: (f) => f.topLevel >= RANK_FROM.Legend },
];

/** Unlocks what the facts now satisfy (paying its XP once) and returns the whole catalog with unlock times. */
export function checkAchievements(db: DatabaseSync, facts: Facts, award: (a: Award) => unknown = (a) => awardXp(db, a)): Achievement[] {
  for (const a of ACHIEVEMENTS) if (a.check(facts)) award({ ref: `achievement:${a.id}`, amount: a.xp, reason: `Achievement: ${a.title}` });
  const unlocked = new Map(
    db.prepare(`SELECT ref, created_at FROM xp_events WHERE ref LIKE 'achievement:%'`).all().map((r) => [String(r.ref).slice('achievement:'.length), String(r.created_at)]),
  );
  return ACHIEVEMENTS.map(({ check: _, ...a }) => ({ ...a, ...(unlocked.has(a.id) ? { unlockedAt: unlocked.get(a.id) } : {}) }));
}
