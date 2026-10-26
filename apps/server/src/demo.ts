import { randomUUID } from 'node:crypto';
import type { Store, StoreEvent, StoreEventType, TopProduct } from '@frontline/shared';
import { tx, type Db } from './db';
import { addDays, dayFraction, dayNumber, localDate } from './dates';
import { insertStore } from './stores';

/** Days of history kept for demo stores (2 years). */
export const DEMO_DAYS = 730;
/** Day the growth curve is anchored to, so numbers stay at mockup scale around launch. */
const ANCHOR = dayNumber('2026-10-26');

interface Params {
  base: number;
  growth: number;
  roas: number;
  margin: number;
  aov: number;
}

export const DEMO_STORES: (Store & { params: Params })[] = [
  { id: 'pawsome', name: 'Pawsome Gear', platform: 'shopify', niche: 'pet', nicheDetail: 'dog travel gear', currency: 'USD', timezone: 'America/Chicago', color: '#ff2a3a', connected: false, params: { base: 1150, growth: 0.0011, roas: 3.3, margin: 0.62, aov: 45 } },
  { id: 'glow', name: 'Glow Haus', platform: 'shopify', niche: 'beauty', nicheDetail: 'at-home skincare devices', currency: 'USD', timezone: 'America/Chicago', color: '#ff8f98', connected: false, params: { base: 680, growth: 0.0008, roas: 2.9, margin: 0.58, aov: 46 } },
  { id: 'peak', name: 'Peak Fit', platform: 'tiktok_shop', niche: 'fitness', nicheDetail: 'home workout accessories', currency: 'USD', timezone: 'America/Chicago', color: '#9a9aa3', connected: false, params: { base: 430, growth: 0.0002, roas: 1.75, margin: 0.55, aov: 40 } },
];

export const mulberry32 = (a: number) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export const hash = (s: string) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;

/** Preset params for the seeded stores; any other demo store gets stable params derived from its id. */
function paramsFor(storeId: string): Params {
  const preset = DEMO_STORES.find((s) => s.id === storeId);
  if (preset) return preset.params;
  const r = mulberry32(hash(storeId));
  return { base: 300 + 600 * r(), growth: 0.0004 + 0.0008 * r(), roas: 2 + 1.5 * r(), margin: 0.5 + 0.15 * r(), aov: 30 + 30 * r() };
}

const cents = (n: number) => Math.round(n * 100) / 100;

/** Campaign mix per store: share of daily spend and relative ROAS. */
const CAMPAIGNS = [
  { network: 'meta', name: 'Prospecting · Broad', share: 0.45, roas: 1.1, budget: 0.5 },
  { network: 'meta', name: 'Retargeting · 30D', share: 0.2, roas: 1.6, budget: 0.2 },
  { network: 'tiktok', name: 'Spark Ads · UGC', share: 0.25, roas: 0.75, budget: 0.25 },
  { network: 'google', name: 'Shopping · Brand', share: 0.1, roas: 1.3, budget: 0.1 },
];

/** One day of demo numbers: a pure function of (store, date), so reruns and top-ups are deterministic. */
export function demoDay(storeId: string, date: string) {
  const p = paramsFor(storeId);
  const d = dayNumber(date);
  const r = mulberry32(hash(storeId) + d * 7919);
  const revenue = p.base * Math.exp(p.growth * (d - ANCHOR)) * (0.82 + 0.36 * r()) * (1 + 0.07 * Math.sin((d / 7) * 2 * Math.PI));
  const adSpend = revenue / (p.roas * (0.85 + 0.3 * r()));
  const cogs = revenue * (1 - p.margin) * (0.95 + 0.1 * r());
  const orders = Math.max(1, Math.round(revenue / (p.aov * (0.9 + 0.2 * r()))));
  const checkouts = Math.round(orders * (1.8 + 0.6 * r()));
  const addToCarts = Math.round(checkouts * (2 + 0.8 * r()));
  const sessions = Math.round(addToCarts * (10 + 5 * r()));
  const campaigns = CAMPAIGNS.map((c, i) => {
    const spend = adSpend * c.share;
    const rev = spend * p.roas * c.roas * (0.8 + 0.4 * r());
    const clicks = Math.round(spend / (0.6 + 0.8 * r()));
    return { id: `${storeId}-c${i + 1}`, network: c.network, spend: cents(spend), revenue: cents(rev), purchases: Math.round(rev / p.aov), clicks, impressions: Math.round(clicks * (60 + 40 * r())) };
  });
  return { date, revenue: cents(revenue), adSpend: cents(adSpend), cogs: cents(cogs), orders, sessions, addToCarts, checkouts, campaigns };
}

/** A demo day `frac` of the way through: traffic and ad spend accrue with the clock, sales step with whole orders. */
export function demoSoFar(storeId: string, date: string, frac: number) {
  const m = demoDay(storeId, date);
  if (frac >= 1) return m;
  const orders = Math.floor(m.orders * frac);
  const sold = orders / m.orders;
  const t = (n: number) => Math.floor(n * frac);
  return {
    ...m,
    revenue: cents(m.revenue * sold),
    adSpend: cents(m.adSpend * frac),
    cogs: cents(m.cogs * sold),
    orders,
    sessions: t(m.sessions),
    addToCarts: t(m.addToCarts),
    checkouts: t(m.checkouts),
    campaigns: m.campaigns.map((c) => ({ ...c, spend: cents(c.spend * frac), revenue: cents(c.revenue * sold), purchases: Math.floor(c.purchases * sold), clicks: t(c.clicks), impressions: t(c.impressions) })),
  };
}

/** Upserts a demo day's daily_metrics row and, if the store has campaigns, its campaign_daily rows. */
function writeDay(db: Db, storeId: string, m: ReturnType<typeof demoDay>) {
  db.prepare(
    `INSERT INTO daily_metrics (store_id, date, revenue, ad_spend, cogs, orders, sessions, add_to_carts, checkouts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (store_id, date) DO UPDATE SET revenue = excluded.revenue, ad_spend = excluded.ad_spend, cogs = excluded.cogs, orders = excluded.orders,
       sessions = excluded.sessions, add_to_carts = excluded.add_to_carts, checkouts = excluded.checkouts`,
  ).run(storeId, m.date, m.revenue, m.adSpend, m.cogs, m.orders, m.sessions, m.addToCarts, m.checkouts);
  if (!db.prepare('SELECT count(*) AS n FROM campaigns WHERE store_id = ?').get(storeId)?.n) return;
  const camp = db.prepare(
    `INSERT INTO campaign_daily (network, campaign_id, date, spend, revenue, purchases, clicks, impressions) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (network, campaign_id, date) DO UPDATE SET spend = excluded.spend, revenue = excluded.revenue, purchases = excluded.purchases,
       clicks = excluded.clicks, impressions = excluded.impressions`,
  );
  for (const c of m.campaigns) camp.run(c.network, c.id, m.date, c.spend, c.revenue, c.purchases, c.clicks, c.impressions);
}

const PRODUCTS: Record<string, [title: string, price: number, compareAt: number, cost: number][]> = {
  pawsome: [
    ['Collapsible Travel Water Bowl', 18.99, 29.99, 4.2],
    ['Car Seat Hammock Cover', 49.99, 79.99, 14.5],
    ['No-Pull Adventure Harness', 34.99, 54.99, 8.9],
    ['Orthopedic Travel Bed', 59.99, 99.99, 19.0],
    ['LED Safety Collar', 22.99, 34.99, 5.1],
    ['Pet Water Fountain', 44.99, 69.99, 14.75],
  ],
  glow: [
    ['LED Light Therapy Mask', 89.99, 149.99, 28.0],
    ['Ice Facial Roller', 24.99, 34.99, 4.6],
    ['Electric Scalp Massager', 39.99, 49.99, 7.3],
    ['Microcurrent Face Sculptor', 69.99, 119.99, 21.5],
    ['Heated Eyelash Curler', 29.99, 44.99, 6.2],
    ['Ultrasonic Skin Scrubber', 34.99, 59.99, 8.4],
  ],
  peak: [
    ['Smart Jump Rope', 29.99, 44.99, 7.8],
    ['Resistance Band Set (5)', 24.99, 39.99, 5.5],
    ['Ab Roller Pro', 27.99, 39.99, 6.9],
    ['Adjustable Kettlebell 20lb', 79.99, 119.99, 31.0],
    ['Posture Corrector', 19.99, 34.99, 3.9],
    ['Massage Gun Mini', 59.99, 99.99, 22.0],
  ],
};

const APPROVALS = [
  { storeId: 'peak', role: 'ad_strategist', title: 'Pause "Spark Ads · UGC"', reason: 'Losing $45/day for 4 days straight', action: { kind: 'ads.pause_campaign', payload: { network: 'tiktok', campaignId: 'peak-c3' } } },
  { storeId: 'pawsome', role: 'ad_strategist', title: 'Raise daily budget 20% ($60 → $72)', reason: 'ROAS above 3.0 for 5 days', action: { kind: 'ads.set_budget', payload: { campaignId: 'pawsome-c1', from: 60, to: 72 } } },
  {
    storeId: 'glow', role: 'product_hunter', title: 'Add 3 trending products to the store', reason: 'AI score 85+, about 60% margin',
    action: { kind: 'store.add_products', payload: { products: [
      { title: 'Gua Sha Stone Set', price: 24.99, compareAt: 39.99, cost: 5.2 },
      { title: 'Heated Eyelash Curler', price: 29.99, compareAt: 44.99, cost: 6.8 },
      { title: 'Blue Light Acne Pen', price: 34.99, compareAt: 59.99, cost: 8.4 },
    ] } },
  },
];

const SUPPLIERS = ['CJ Dropshipping', 'DSers', 'Zendrop'];

/** Writes missing daily_metrics / campaign_daily rows for a demo store, up to `today` (today: so far). */
function topUp(db: Db, storeId: string, today: string) {
  const last = db.prepare('SELECT MAX(date) AS d FROM daily_metrics WHERE store_id = ?').get(storeId)?.d as string | null;
  // From the last stored day: a session that ended mid-day left it "so far".
  const start = last ?? addDays(today, 1 - DEMO_DAYS);
  for (let date = start; date <= today; date = addDays(date, 1)) writeDay(db, storeId, date < today ? demoDay(storeId, date) : demoSoFar(storeId, date, dayFraction(date)));
}

/** New demo orders from this long before `now` go to the live feed; older ones (the app was closed) are only filled in. */
const LIVE_MS = 60_000;

/**
 * Moves a demo store's numbers to `now`: yesterday becomes final, today is updated so far, and each day of the last
 * week (the days that have orders, as seeded) gets the orders that came due: days the app was closed, the rest of
 * yesterday, today so far. They are spread over the gap since that day's last order. Returns the ones from the last
 * minute as live-feed events, so the feed, the orders table and the KPIs agree.
 */
export function advanceDemoDay(db: Db, storeId: string, now = new Date()): StoreEvent[] {
  const today = localDate(now);
  writeDay(db, storeId, demoDay(storeId, addDays(today, -1)));
  const m = demoSoFar(storeId, today, dayFraction(today, now.getTime()));
  writeDay(db, storeId, m);
  if (!PRODUCTS[storeId]) return [];
  const first = addDays(today, -6);
  const byDay = new Map<string, number[]>();
  for (const r of db.prepare('SELECT created_at FROM orders WHERE store_id = ? AND created_at >= ?').all(storeId, new Date(`${first}T00:00:00`).toISOString())) {
    const t = Date.parse(String(r.created_at));
    byDay.set(localDate(new Date(t)), [...(byDay.get(localDate(new Date(t))) ?? []), t]);
  }
  let last = Number(db.prepare("SELECT coalesce(max(CAST(substr(id, 2) AS INTEGER)), 1000) AS n FROM orders WHERE store_id = ? AND id LIKE '#%'").get(storeId)!.n);
  const order = db.prepare("INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, supplier, tracking, cogs, local_date) VALUES (?, ?, ?, ?, 'paid', 'unfulfilled', ?, NULL, ?, ?)");
  const events: StoreEvent[] = [];
  for (let date = first; date <= today; date = addDays(date, 1)) {
    const have = byDay.get(date) ?? [];
    const due = (date < today ? demoDay(storeId, date) : m).orders - have.length;
    if (due <= 0) continue;
    const full = demoDay(storeId, date);
    const total = cents(full.revenue / full.orders);
    const from = Math.max(new Date(`${date}T00:00:00`).getTime(), ...have);
    const to = date < today ? new Date(`${addDays(date, 1)}T00:00:00`).getTime() - 1000 : now.getTime();
    for (let i = 1; i <= due; i++) {
      const t = Math.round(from + ((to - from) * i) / due);
      const at = new Date(t).toISOString();
      order.run(storeId, `#${++last}`, at, total, SUPPLIERS[(last - 1) % SUPPLIERS.length]!, cents(full.cogs / full.orders), date);
      if (now.getTime() - t < LIVE_MS) events.push({ id: randomUUID(), storeId, type: 'order', amount: total, at });
    }
  }
  return events;
}

/** First-run catalog for a demo store: campaigns, products, last week's orders. */
/** The seeded requests; the budget one quotes pawsome-c1's seeded budget (approving checks that it hasn't moved). */
function approvals(db: Db) {
  const budget = db.prepare("SELECT daily_budget FROM campaigns WHERE store_id = 'pawsome' AND id = 'pawsome-c1'").get()?.daily_budget;
  if (budget == null) return APPROVALS;
  const from = Number(budget);
  const to = Math.round(from * 1.2);
  return APPROVALS.map((a) =>
    a.action.kind === 'ads.set_budget' ? { ...a, title: `Raise daily budget 20% ($${from} → $${to})`, action: { ...a.action, payload: { ...a.action.payload, from, to } } } : a,
  );
}

function seedCatalog(db: Db, storeId: string, today: string) {
  const r = mulberry32(hash(storeId) ^ 0x5eed);
  const camp = db.prepare('INSERT INTO campaigns (network, id, store_id, name, status, daily_budget) VALUES (?, ?, ?, ?, ?, ?)');
  const spend = demoDay(storeId, today).adSpend;
  CAMPAIGNS.forEach((c, i) => camp.run(c.network, `${storeId}-c${i + 1}`, storeId, c.name, 'active', Math.round(spend * c.budget)));

  const products = PRODUCTS[storeId] ?? [];
  const prod = db.prepare('INSERT INTO products (store_id, id, title, image, price, compare_at, cost, inventory, status) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)');
  products.forEach(([title, price, compareAt, cost], i) => prod.run(storeId, `${storeId}-p${i + 1}`, title, price, compareAt, cost, Math.round(20 + 400 * r()), 'active'));
  if (!products.length) return;

  // ponytail: orders only for the last 7 days (count matches daily_metrics); older history lives in daily_metrics
  const order = db.prepare('INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, supplier, tracking) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  let n = 1001;
  for (let ago = 6; ago >= 0; ago--) {
    const date = addDays(today, -ago);
    const count = (ago ? demoDay(storeId, date) : demoSoFar(storeId, date, dayFraction(date))).orders;
    for (let k = 0; k < count; k++) {
      const [, price] = products[Math.floor(r() * products.length)]!;
      const qty = r() < 0.8 ? 1 : 2;
      // Within the local day; today's orders (all of them, so the count matches daily_metrics) only up to now.
      const midnight = new Date(`${date}T00:00:00`).getTime();
      const at = midnight + Math.floor(r() * Math.min(86400000, Math.max(60_000, Date.now() - midnight)));
      const fulfillment = ago >= 4 ? 'delivered' : ago >= 2 ? 'in_transit' : ago === 1 ? 'fulfilled' : 'unfulfilled';
      const tracking = fulfillment === 'unfulfilled' ? null : `YT${2600000000 + Math.floor(r() * 99999999)}`;
      order.run(storeId, `#${n++}`, new Date(at).toISOString(), cents(price * qty), r() < 0.03 ? 'refunded' : 'paid', fulfillment, SUPPLIERS[Math.floor(r() * SUPPLIERS.length)]!, tracking);
    }
  }
}

// Browsing only: demo orders come from advanceDemoDay so they match the store's numbers.
const EVENT_MIX: [StoreEventType, weight: number, amount: [min: number, max: number]][] = [
  ['add_to_cart', 0.62, [0.4, 1]],
  ['checkout_started', 0.38, [0.7, 1.5]],
];

/** One live-feed event for a demo store, picked in proportion to store size; amounts scale with the store's AOV. */
export function demoEvent(storeIds: string[], rand: () => number, at: Date): StoreEvent | undefined {
  if (!storeIds.length) return;
  const weights = storeIds.map((id) => paramsFor(id).base);
  let pick = rand() * weights.reduce((a, b) => a + b);
  const storeId = storeIds.find((_, i) => (pick -= weights[i]!) < 0) ?? storeIds[0]!;
  let t = rand();
  const [type, , [lo, hi]] = EVENT_MIX.find(([, w]) => (t -= w) < 0) ?? EVENT_MIX[0]!;
  return { id: randomUUID(), storeId, type, amount: cents(paramsFor(storeId).aov * (lo + (hi - lo) * rand())), at: at.toISOString() };
}

/** Gives a just-created demo store (no credentials yet) campaigns and 2 years of history. Call inside a transaction. */
export function seedDemoStore(db: Db, storeId: string, today = localDate()) {
  seedCatalog(db, storeId, today);
  topUp(db, storeId, today);
}

/**
 * Seeds the three demo stores on an empty DB, then tops up every demo store's history to `today`.
 * Safe to run on every startup.
 */
export function seedDemo(db: Db, today = localDate()) {
  tx(db, () => {
    if (!db.prepare('SELECT count(*) AS n FROM stores').get()?.n) {
      for (const { params: _, ...s } of DEMO_STORES) {
        insertStore(db, s, true);
        seedCatalog(db, s.id, today);
      }
      const appr = db.prepare('INSERT INTO approvals (id, store_id, agent_id, title, reason, action_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      approvals(db).forEach((a, i) => appr.run(`demo-appr-${i + 1}`, a.storeId, `${a.storeId}:${a.role}`, a.title, a.reason, JSON.stringify(a.action), 'pending', new Date(Date.now() - (i + 1) * 3600000).toISOString()));
    }
    // Seeded requests still waiting get the current wording and payload (earlier seeds had kinds nothing executes).
    const fix = db.prepare("UPDATE approvals SET title = ?, action_json = ? WHERE id = ? AND status = 'pending' AND store_id IN (SELECT id FROM stores WHERE demo = 1)");
    approvals(db).forEach((a, i) => fix.run(a.title, JSON.stringify(a.action), `demo-appr-${i + 1}`));
    for (const { id } of db.prepare('SELECT id FROM stores WHERE demo = 1').all()) topUp(db, String(id), today);
  });
}

/**
 * Demo stores keep only daily totals for most of their history, so their best sellers split the period's real revenue
 * across active products with fixed per-product weights: the numbers agree with the KPIs and don't move between loads.
 */
export function demoTopProducts(db: Db, storeId: string, from: string, to: string): TopProduct[] {
  const revenue = Number(db.prepare('SELECT coalesce(sum(revenue), 0) AS r FROM daily_metrics WHERE store_id = ? AND date BETWEEN ? AND ?').get(storeId, from, to)!.r);
  const products = db.prepare("SELECT id, title, image, price, cost FROM products WHERE store_id = ? AND status = 'active' AND price > 0").all(storeId);
  const weights = products.map((p) => 0.2 + mulberry32(hash(`${storeId}:${p.id}`))());
  const total = weights.reduce((a, w) => a + w, 0);
  return products.map((p, i) => {
    const price = Number(p.price);
    const units = Math.round((revenue * weights[i]!) / total / price);
    return { storeId, productId: String(p.id), title: String(p.title), ...(p.image ? { image: String(p.image) } : {}), units, revenue: cents(units * price), profit: cents(units * (price - Number(p.cost))) };
  });
}
