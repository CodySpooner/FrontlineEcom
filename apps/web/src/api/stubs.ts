// ponytail: typed stand-ins for endpoints the core/agents lanes haven't shipped yet (UI-03). client.ts only falls
// back here on a 404, so each stub goes dead the moment its real route lands — then delete it from this file.
// The contract types below are proposed to core in docs/backlog/core.md (Inbox); move to packages/shared when they land.
import { AGENT_ROLES, type Agent, type AgentRole, type ApprovalRequest, type StoreEvent, type StoreEventType } from '@frontline/shared';

export type Range = 7 | 30 | 90 | 365;

export interface Totals {
  revenue: number;
  profit: number;
  adSpend: number;
  /** revenue / adSpend (0 when no spend) */
  roas: number;
  orders: number;
  /** revenue / orders (0 when no orders) */
  aov: number;
}

export interface DayPoint {
  /** YYYY-MM-DD */
  date: string;
  revenue: number;
  profit: number;
  adSpend: number;
  orders: number;
}

/** GET /api/analytics/summary?stores=a,b&range=30 (empty `stores` = all stores) */
export interface AnalyticsSummary {
  range: Range;
  storeIds: string[];
  totals: Totals;
  /** Same metrics for the preceding period of equal length — deltas are computed against this. */
  previous: Totals;
  /** One point per day, oldest first, `range` points. */
  series: DayPoint[];
  byStore: ({ storeId: string } & Totals)[];
}

/** GET /api/missions — daily missions per store (agents lane AGT-13). */
export interface Mission {
  id: string;
  storeId: string;
  title: string;
  progress: number;
  target: number;
  xp: number;
}

/** Messages on the /api/live WebSocket. */
export type LiveMessage = { type: 'store_event'; event: StoreEvent } | { type: 'approval'; approval: ApprovalRequest };

// ---- seeded demo data (generator ported from docs/reference/dashboard-mockup-v3.html) ----

const N = 730;
const SEEDS = [
  { id: 'pawsome', base: 1150, growth: 0.0011, roas: 3.3, margin: 0.62, aov: 45 },
  { id: 'glow', base: 680, growth: 0.0008, roas: 2.9, margin: 0.58, aov: 46 },
  { id: 'peak', base: 430, growth: 0.0002, roas: 1.75, margin: 0.55, aov: 40 },
];

const mulberry32 = (a: number) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const now = new Date();
const DATES = Array.from({ length: N }, (_, i) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - (N - 1 - i)).toLocaleDateString('en-CA'));

const METRICS: Record<string, Omit<DayPoint, 'date'>[]> = Object.fromEntries(
  SEEDS.map((s, k) => {
    const r = mulberry32(7 + k * 101);
    return [
      s.id,
      Array.from({ length: N }, (_, i) => {
        const revenue = s.base * Math.exp(s.growth * (i - N + 1)) * (0.82 + 0.36 * r()) * (1 + 0.07 * Math.sin((i / 7) * 2 * Math.PI));
        const adSpend = revenue / (s.roas * (0.85 + 0.3 * r()));
        return { revenue, adSpend, profit: revenue * s.margin - adSpend, orders: Math.max(1, Math.round(revenue / (s.aov * (0.9 + 0.2 * r())))) };
      }),
    ];
  }),
);

function totals(pts: Omit<DayPoint, 'date'>[]): Totals {
  const t = pts.reduce((a, d) => ({ revenue: a.revenue + d.revenue, profit: a.profit + d.profit, adSpend: a.adSpend + d.adSpend, orders: a.orders + d.orders }), { revenue: 0, profit: 0, adSpend: 0, orders: 0 });
  return { ...t, roas: t.adSpend ? t.revenue / t.adSpend : 0, aov: t.orders ? t.revenue / t.orders : 0 };
}

function days(ids: string[], from: number, len: number): DayPoint[] {
  return Array.from({ length: len }, (_, j) => {
    const i = from + j;
    const p = { date: DATES[i]!, revenue: 0, profit: 0, adSpend: 0, orders: 0 };
    for (const id of ids) {
      const d = METRICS[id]?.[i];
      if (d) {
        p.revenue += d.revenue;
        p.profit += d.profit;
        p.adSpend += d.adSpend;
        p.orders += d.orders;
      }
    }
    return p;
  });
}

export function summary(storeIds: string[], range: Range): AnalyticsSummary {
  const ids = storeIds.length ? storeIds : SEEDS.map((s) => s.id);
  const series = days(ids, N - range, range);
  return {
    range,
    storeIds: ids,
    totals: totals(series),
    previous: totals(days(ids, N - 2 * range, range)),
    series,
    byStore: ids.map((id) => ({ storeId: id, ...totals(days([id], N - range, range)) })),
  };
}

// ---- live feed ----

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
let seq = 0;
const ev = (storeId: string, type: StoreEventType, amount: number, at: string): StoreEvent => ({ id: `stub-ev-${++seq}`, storeId, type, amount, at });

const FEED: StoreEvent[] = [
  ev('pawsome', 'order', 67, minsAgo(2)),
  ev('glow', 'add_to_cart', 89.99, minsAgo(3)),
  ev('pawsome', 'checkout_started', 120, minsAgo(5)),
  ev('peak', 'order', 49.99, minsAgo(8)),
  ev('pawsome', 'add_to_cart', 79.99, minsAgo(12)),
  ev('glow', 'order', 54, minsAgo(15)),
  ev('peak', 'checkout_started', 64.98, minsAgo(19)),
  ev('glow', 'add_to_cart', 38.5, minsAgo(24)),
  ev('peak', 'add_to_cart', 29.99, minsAgo(31)),
  ev('glow', 'checkout_started', 112.4, minsAgo(38)),
];

export const events = () => FEED;

const TYPES: StoreEventType[] = ['order', 'order', 'add_to_cart', 'add_to_cart', 'add_to_cart', 'checkout_started'];

/** Demo emitter standing in for the /api/live socket. Returns a stop function. */
export function startLive(onMessage: (m: LiveMessage) => void): () => void {
  const r = mulberry32(Date.now());
  let timer = 0;
  const tick = () => {
    const store = SEEDS[Math.floor(r() * SEEDS.length)]!;
    const amount = Math.round(store.aov * (0.5 + 2 * r()) * 100) / 100;
    onMessage({ type: 'store_event', event: ev(store.id, TYPES[Math.floor(r() * TYPES.length)]!, amount, new Date().toISOString()) });
    timer = window.setTimeout(tick, 4000 + r() * 6000);
  };
  timer = window.setTimeout(tick, 3000);
  return () => clearTimeout(timer);
}

// ---- squads, approvals, missions ----

const TASKS: Record<AgentRole, string> = {
  ad_strategist: 'Optimizing campaigns…',
  product_hunter: 'Scanning trending products…',
  store_developer: 'Ready for tasks.',
  creative_studio: 'Generating ad concepts…',
  market_analyst: 'Analyzing competitors…',
  copywriter: 'Rewriting product descriptions…',
  email_sms: 'Drafting a win-back flow…',
  operations: 'Checking supplier stock…',
};

const AGENTS: Agent[] = SEEDS.flatMap((s, k) =>
  (Object.keys(AGENT_ROLES) as AgentRole[]).map((role, i) => {
    const idle = role === 'store_developer' || (i + k) % 4 === 3;
    return { id: `${s.id}:${role}`, storeId: s.id, role, status: idle ? 'idle' : 'running', level: 2 + ((i * 7 + k * 3) % 9), xp: (i * 137 + k * 61) % 400, currentTask: idle ? 'Ready for tasks.' : TASKS[role] };
  }),
);

export const agents = () => AGENTS.map((a) => ({ ...a }));

const APPROVALS: ApprovalRequest[] = [
  { id: 'stub-ap-1', storeId: 'peak', agentId: 'peak:ad_strategist', title: 'Pause 2 losing ad sets', reason: 'Losing $45/day for 4 days straight', action: { kind: 'ads.pause', payload: null }, status: 'pending', createdAt: minsAgo(9) },
  { id: 'stub-ap-2', storeId: 'pawsome', agentId: 'pawsome:ad_strategist', title: 'Raise daily budget 20% ($60 → $72)', reason: 'ROAS above 3.0 for 5 days', action: { kind: 'ads.budget', payload: null }, status: 'pending', createdAt: minsAgo(26) },
  { id: 'stub-ap-3', storeId: 'glow', agentId: 'glow:product_hunter', title: 'Add 3 trending products to the store', reason: 'AI score 85+, about 60% margin', action: { kind: 'store.add_products', payload: null }, status: 'pending', createdAt: minsAgo(47) },
];
for (const a of APPROVALS) {
  const agent = AGENTS.find((g) => g.id === a.agentId);
  if (agent) agent.status = 'waiting_approval';
}

export const approvals = () => APPROVALS.filter((a) => a.status === 'pending');

export function decide(id: string, verdict: 'approve' | 'deny'): ApprovalRequest {
  const a = APPROVALS.find((x) => x.id === id);
  if (!a) throw new Error(`Approval ${id} not found`);
  a.status = verdict === 'approve' ? 'approved' : 'denied';
  const agent = AGENTS.find((g) => g.id === a.agentId);
  if (agent) agent.status = 'running';
  return a;
}

const MISSIONS: Mission[] = [
  { id: 'stub-m-1', storeId: 'pawsome', title: 'Hit $1,000 revenue today', progress: 742, target: 1000, xp: 100 },
  { id: 'stub-m-2', storeId: 'glow', title: 'Launch 2 new creatives', progress: 1, target: 2, xp: 50 },
  { id: 'stub-m-3', storeId: 'peak', title: 'Clear all agent requests', progress: 0, target: 1, xp: 40 },
  { id: 'stub-m-4', storeId: 'pawsome', title: 'Reply to 5 customer emails', progress: 5, target: 5, xp: 30 },
  { id: 'stub-m-5', storeId: 'glow', title: 'Get 10 orders today', progress: 6, target: 10, xp: 60 },
];

export const missions = () => MISSIONS;
