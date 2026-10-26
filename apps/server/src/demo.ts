import type { Store } from '@frontline/shared';
import { tx, type Db } from './db';
import { addDays, dayNumber, localDate } from './dates';
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

const mulberry32 = (a: number) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const hash = (s: string) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;

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
  { storeId: 'peak', role: 'ad_strategist', title: 'Pause 2 losing ad sets', reason: 'Losing $45/day for 4 days straight', action: { kind: 'ads.pause_adsets', payload: { campaignId: 'peak-c3', adsets: 2 } } },
  { storeId: 'pawsome', role: 'ad_strategist', title: 'Raise daily budget 20% ($60 → $72)', reason: 'ROAS above 3.0 for 5 days', action: { kind: 'ads.set_budget', payload: { campaignId: 'pawsome-c1', from: 60, to: 72 } } },
  { storeId: 'glow', role: 'product_hunter', title: 'Add 3 trending products to the store', reason: 'AI score 85+, about 60% margin', action: { kind: 'store.add_products', payload: { count: 3 } } },
];

const SUPPLIERS = ['CJ Dropshipping', 'DSers', 'Zendrop'];

/** Inserts missing daily_metrics / campaign_daily rows for a demo store, up to `today`. */
function topUp(db: Db, storeId: string, today: string) {
  const last = db.prepare('SELECT MAX(date) AS d FROM daily_metrics WHERE store_id = ?').get(storeId)?.d as string | null;
  const start = last ? addDays(last, 1) : addDays(today, 1 - DEMO_DAYS);
  const metric = db.prepare('INSERT OR IGNORE INTO daily_metrics (store_id, date, revenue, ad_spend, cogs, orders, sessions, add_to_carts, checkouts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const camp = db.prepare('INSERT OR IGNORE INTO campaign_daily (network, campaign_id, date, spend, revenue, purchases, clicks, impressions) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const hasCampaigns = db.prepare('SELECT count(*) AS n FROM campaigns WHERE store_id = ?').get(storeId)?.n;
  for (let date = start; date <= today; date = addDays(date, 1)) {
    const m = demoDay(storeId, date);
    metric.run(storeId, date, m.revenue, m.adSpend, m.cogs, m.orders, m.sessions, m.addToCarts, m.checkouts);
    if (hasCampaigns) for (const c of m.campaigns) camp.run(c.network, c.id, date, c.spend, c.revenue, c.purchases, c.clicks, c.impressions);
  }
}

/** First-run catalog for a demo store: campaigns, products, last week's orders. */
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
    for (let k = 0; k < demoDay(storeId, date).orders; k++) {
      const [, price] = products[Math.floor(r() * products.length)]!;
      const qty = r() < 0.8 ? 1 : 2;
      const at = new Date(`${date}T00:00:00Z`).getTime() + Math.floor(r() * 86400000);
      const fulfillment = ago >= 4 ? 'delivered' : ago >= 2 ? 'in_transit' : ago === 1 ? 'fulfilled' : 'unfulfilled';
      const tracking = fulfillment === 'unfulfilled' ? null : `YT${2600000000 + Math.floor(r() * 99999999)}`;
      order.run(storeId, `#${n++}`, new Date(at).toISOString(), cents(price * qty), r() < 0.03 ? 'refunded' : 'paid', fulfillment, SUPPLIERS[Math.floor(r() * SUPPLIERS.length)]!, tracking);
    }
  }
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
      APPROVALS.forEach((a, i) => appr.run(`demo-appr-${i + 1}`, a.storeId, `${a.storeId}:${a.role}`, a.title, a.reason, JSON.stringify(a.action), 'pending', new Date(Date.now() - (i + 1) * 3600000).toISOString()));
    }
    for (const { id } of db.prepare('SELECT id FROM stores WHERE demo = 1').all()) topUp(db, String(id), today);
  });
}
