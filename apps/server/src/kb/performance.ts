import { learn, once, type Reading } from '@frontline/agents';
import type { KbPerformance } from '@frontline/shared';
import { addDays } from '../dates';
import type { Db } from '../db';
import { newSince, productSales, restTrend, storeDay, storeFunnel, synced } from '../routes/agents-gamification';
import { listStores } from '../stores';

// Performance learning (knowledge-base lane, KB-19, decision 13). Each real store's settled 28-day periods are read
// against baselines: campaign by campaign, ad by ad and creative trait by trait (KB-20), the store's funnel, product by
// product. learn() in packages/agents turns the readings into lessons.

type Period = { from: string; to: string };

const EPOCH = '2024-01-01';
const PERIOD = 28;
/** Days a period's ad numbers keep changing: the syncs re-pull 28 (Meta) to 30 (Google) days of attribution. */
const SETTLE = 30;
/** Below these, one sale either way moves a number more than anything learned from it. */
const MIN = { days: 7, spendShare: 0.05, purchases: 10, clicks: 10, impressions: 1000, orders: 30, refunds: 10, units: 10 };
/** A campaign that ran fewer days than this isn't compared like for like: its days and the others' differ. */
const FULL = 21;
const NETWORK: Record<string, string> = { meta: 'Meta', google: 'Google', tiktok: 'TikTok' };
/** What each network calls the set of ads shown to the same people. */
const GROUP: Record<string, string> = { meta: 'ad set', google: 'ad group', tiktok: 'ad group' };
const TRAITS = ['format', 'hook', 'angle', 'offer'] as const;

const pct2 = (v: number) => `${(v * 100).toFixed(2)}%`;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/** The last 3 whole 28-day periods (counted from EPOCH) that ended SETTLE days or more before `today`, oldest first. */
export function settledPeriods(today: string): Period[] {
  const last = Math.floor((daysBetween(EPOCH, addDays(today, -SETTLE - 1)) + 1) / PERIOD) - 1;
  return [last - 2, last - 1, last].map((k) => ({ from: addDays(EPOCH, k * PERIOD), to: addDays(EPOCH, k * PERIOD + PERIOD - 1) }));
}

/**
 * Reads each real store's settled periods once each. A period is settled once every integration of the store synced
 * SETTLE days after it ended, so late conversions are in. Demo stores are left out: nothing is learned from demo numbers.
 */
export function learnFromPerformance(db: Db, today?: string) {
  for (const s of listStores(db)) {
    if (db.prepare('SELECT demo FROM stores WHERE id = ?').get(s.id)?.demo) continue;
    for (const p of settledPeriods(today ?? storeDay(db, s.id))) {
      if (!synced(db, s.id, addDays(p.to, SETTLE)) || !once(db, `kb-perf:${s.id}:${p.from}`)) continue;
      for (const r of [...campaignReadings(db, s.id, p), ...adReadings(db, s.id, p), ...storeReadings(db, s.id, s.currency, p), ...productReadings(db, s.id, p)]) learn(db, r);
    }
  }
}

/**
 * Each campaign against the store's other campaigns on its network in the same days, so season and the store's offers
 * are the same on both sides. With none there, against the rest, though networks count purchases their own way. Only
 * campaigns that ran 7+ days on 5%+ of the store's ad spend are read, or are anyone's baseline. ROAS and CTR are
 * ratios, so campaigns in ad accounts of different currencies still compare.
 */
function campaignReadings(db: Db, storeId: string, p: Period): Reading[] {
  const rows = db
    .prepare(
      `SELECT c.network, c.id, c.name, sum(d.spend) AS spend, sum(d.revenue) AS revenue, sum(d.purchases) AS purchases, sum(d.clicks) AS clicks,
         sum(d.impressions) AS impressions, count(CASE WHEN d.spend > 0 THEN 1 END) AS days
       FROM campaigns c JOIN campaign_daily d ON d.network = c.network AND d.campaign_id = c.id
       WHERE c.store_id = ? AND d.date BETWEEN ? AND ? GROUP BY c.network, c.id`,
    )
    .all(storeId, p.from, p.to);
  const spent = rows.reduce((n, r) => n + Number(r.spend), 0);
  const changed = changedOn(db);
  const ads = rows
    .filter((r) => Number(r.days) >= MIN.days && Number(r.spend) >= MIN.spendShare * spent)
    .map((r) => {
      const [name, days, day] = [String(r.name).slice(0, 60), Number(r.days), changed.get(storeId, String(r.id), p.from, p.to)?.day];
      // What makes a comparison with it not like for like.
      const notes = [...(days < FULL ? [`"${name}" ran ${days} of ${PERIOD} days`] : []), ...(day ? [`"${name}" was changed on ${day}`] : [])];
      return { network: String(r.network), id: String(r.id), name, notes, ...sums([r]) };
    });
  return ads.flatMap((a) => {
    const peers = ads.filter((b) => b !== a && b.network === a.network);
    const base = peers.length ? peers : ads.filter((b) => b !== a);
    if (!base.length) return [];
    const t = sums(base);
    const network = NETWORK[a.network] ?? a.network;
    return ratios(
      {
        storeId, subject: `campaign:${a.network}:${a.id}`, name: `The "${a.name}" campaign (${network})`,
        vs: peers.length ? `the store's other ${network} campaigns` : "the store's campaigns on other networks", from: p.from, to: p.to,
        confounds: [...[a, ...base].flatMap((b) => b.notes), ...(peers.length ? [] : ['networks count purchases their own way'])], path: ['Advertising', 'Campaign results'],
      },
      a,
      t,
    );
  });
}

/**
 * Each ad against the other ads in its ad set (ad group): the same people, budget and days, so the difference is the
 * ad's. With none there, against the rest of its campaign, a Hypothesis. Ads on 5%+ of their campaign's spend only. Then
 * each creative trait of the ads made from library creatives (KB-20) against the store's other library ads on the
 * network with another: always a Hypothesis, as two ads differ in more than one trait.
 */
function adReadings(db: Db, storeId: string, p: Period): Reading[] {
  const rows = db
    .prepare(
      `SELECT a.network, a.id, a.name, a.campaign_id, a.group_id, cr.format, cr.hook, cr.angle, cr.offer, sum(d.spend) AS spend, sum(d.revenue) AS revenue,
         sum(d.purchases) AS purchases, sum(d.clicks) AS clicks, sum(d.impressions) AS impressions, count(CASE WHEN d.spend > 0 THEN 1 END) AS days
       FROM ads a JOIN campaigns c ON c.network = a.network AND c.id = a.campaign_id JOIN ad_daily d ON d.network = a.network AND d.ad_id = a.id
         LEFT JOIN creatives cr ON cr.id = a.creative_id
       WHERE c.store_id = ? AND d.date BETWEEN ? AND ? GROUP BY a.network, a.id`,
    )
    .all(storeId, p.from, p.to);
  const changed = changedOn(db);
  const spent = (r: Record<string, unknown>) => rows.filter((b) => b.network === r.network && b.campaign_id === r.campaign_id).reduce((n, b) => n + Number(b.spend), 0);
  const ads = rows
    .filter((r) => Number(r.days) >= MIN.days && Number(r.spend) >= MIN.spendShare * spent(r))
    .map((r) => {
      const [name, days] = [String(r.name).slice(0, 60), Number(r.days)];
      const notes = days < FULL ? [`"${name}" ran ${days} of ${PERIOD} days`] : [];
      const traits = Object.fromEntries(TRAITS.map((k) => [k, r[k] == null ? undefined : String(r[k]).trim().toLowerCase()]));
      return { network: String(r.network), id: String(r.id), name, campaign: String(r.campaign_id), group: r.group_id == null ? null : String(r.group_id), notes, traits, ...sums([r]) };
    });
  const out = ads.flatMap((a) => {
    const campaign = ads.filter((b) => b !== a && b.network === a.network && b.campaign === a.campaign);
    const peers = campaign.filter((b) => a.group !== null && b.group === a.group);
    const base = peers.length ? peers : campaign;
    const group = GROUP[a.network] ?? 'ad group';
    const day = changed.get(storeId, a.campaign, p.from, p.to)?.day;
    return ratios(
      {
        storeId, subject: `ad:${a.network}:${a.id}`, name: `The "${a.name}" ad (${NETWORK[a.network] ?? a.network})`, vs: `the other ads in its ${peers.length ? group : 'campaign'}`,
        from: p.from, to: p.to,
        confounds: [...[a, ...base].flatMap((b) => b.notes), ...(day ? [`the campaign was changed on ${day}`] : []), ...(peers.length ? [] : [`they run in different ${group}s, so to different people`])],
        path: ['Creative', 'Ad results'],
      },
      a,
      sums(base),
    );
  });
  for (const trait of TRAITS) {
    for (const [network, value] of [...new Set(ads.flatMap((a) => (a.traits[trait] ? [`${a.network}\n${a.traits[trait]}`] : [])))].map((k) => k.split('\n'))) {
      const own = ads.filter((a) => a.network === network && a.traits[trait] === value);
      const base = ads.filter((a) => a.network === network && a.traits[trait] && a.traits[trait] !== value);
      const name = NETWORK[network!] ?? network;
      out.push(
        ...ratios(
          {
            storeId, subject: `trait:${network}:${trait}:${value}`, name: `Ads whose ${trait} is "${value!.slice(0, 40)}" (${name})`, vs: `the store's other ${name} ads from the library`,
            from: p.from, to: p.to, confounds: [`they differ in more than their ${trait}: product, audience and the rest of the ad`], path: ['Creative', 'Creative results'],
          },
          sums(own),
          sums(base),
        ),
      );
    }
  }
  return out;
}

type Sums = ReturnType<typeof sums>;
const sums = (rows: Record<string, unknown>[]) => {
  const sum = (k: string) => rows.reduce((n, r) => n + Number(r[k]), 0);
  return { spend: sum('spend'), revenue: sum('revenue'), purchases: sum('purchases'), clicks: sum('clicks'), impressions: sum('impressions') };
};

/** ROAS and click-through rate of `a` against `t`, each where both sides have enough to read. */
function ratios(common: Pick<Reading, 'storeId' | 'subject' | 'name' | 'vs' | 'from' | 'to' | 'confounds' | 'path'>, a: Sums, t: Sums): Reading[] {
  const ref = (metric: string) => `perf:${common.storeId}:${common.subject}:${metric}:${common.from}`;
  const out: Reading[] = [];
  if (a.purchases >= MIN.purchases && t.purchases >= MIN.purchases)
    out.push({ ...common, ref: ref('roas'), metric: 'roas', label: 'ROAS', value: a.revenue / a.spend, baseline: t.revenue / t.spend, k: a.purchases, kBase: t.purchases, n: a.purchases, unit: 'purchases', show: (v) => v.toFixed(2) });
  if (Math.min(a.impressions, t.impressions) >= MIN.impressions && Math.min(a.clicks, t.clicks) >= MIN.clicks)
    out.push({ ...common, ref: ref('ctr'), metric: 'ctr', label: 'click-through rate', value: a.clicks / a.impressions, baseline: t.clicks / t.impressions, k: a.clicks, kBase: t.clicks, n: a.impressions, unit: 'impressions', show: pct2 });
  return out;
}

/** The first day in a period an approved ads.* request changed a campaign. */
const changedOn = (db: Db) =>
  db.prepare(
    `SELECT min(substr(decided_at, 1, 10)) AS day FROM approvals WHERE store_id = ? AND status = 'approved' AND json_extract(action_json, '$.kind') LIKE 'ads.%'
       AND json_extract(action_json, '$.payload.campaignId') = ? AND substr(decided_at, 1, 10) BETWEEN ? AND ?`,
  );

/**
 * The store's conversion rate, average order value and refund rate against its own 12 weeks before. Season, promotions
 * and ad changes differ between the two, so these are patterns to test (Hypotheses), never measured results.
 */
function storeReadings(db: Db, storeId: string, currency: string, p: Period): Reading[] {
  const before = { from: addDays(p.from, -3 * PERIOD), to: addDays(p.from, -1) };
  const common = {
    storeId, subject: 'store', name: 'The store', vs: 'its 12 weeks before', from: p.from, to: p.to,
    confounds: ['season, promotions and ad changes differ from its weeks before'], path: ['Conversion', 'Store results'],
  };
  const ref = (metric: string) => `perf:${storeId}:store:${metric}:${p.from}`;
  const out: Reading[] = [];
  const [f, fb] = [storeFunnel(db, storeId, p.from, p.to), storeFunnel(db, storeId, before.from, before.to)];
  if (Math.min(f.orders, fb.orders) >= MIN.orders)
    out.push({ ...common, ref: ref('cvr'), metric: 'cvr', label: 'conversion rate', value: f.orders / f.sessions, baseline: fb.orders / fb.sessions, k: f.orders, kBase: fb.orders, n: f.orders, unit: 'orders', show: pct2 });
  const orders = db.prepare(
    `SELECT count(CASE WHEN status = 'paid' THEN 1 END) AS paid, count(CASE WHEN status = 'refunded' THEN 1 END) AS refunded,
       avg(CASE WHEN status = 'paid' THEN total END) AS mean, avg(CASE WHEN status = 'paid' THEN total * total END) AS sq
     FROM orders WHERE store_id = ? AND local_date BETWEEN ? AND ?`,
  );
  const [o, ob] = [p, before].map((w) => {
    const r = orders.get(storeId, w.from, w.to)!;
    const [paid, mean] = [Number(r.paid), Number(r.mean)];
    // An average is as noisy as a count of orders / (sd/mean)² (see lift).
    return { paid, refunded: Number(r.refunded), mean, k: (paid * mean ** 2) / Math.max(Number(r.sq) - mean ** 2, 0) };
  }) as [{ paid: number; refunded: number; mean: number; k: number }, { paid: number; refunded: number; mean: number; k: number }];
  if (Math.min(o.paid, ob.paid) >= MIN.orders)
    out.push({ ...common, ref: ref('aov'), metric: 'aov', label: 'average order value', value: o.mean, baseline: ob.mean, k: o.k, kBase: ob.k, n: o.paid, unit: 'orders', show: (v) => `${v.toFixed(2)} ${currency}` });
  if (Math.min(o.refunded, ob.refunded) >= MIN.refunds) {
    const rate = (x: typeof o) => x.refunded / (x.paid + x.refunded);
    out.push({ ...common, ref: ref('refund_rate'), metric: 'refund_rate', label: 'refund rate', value: rate(o), baseline: rate(ob), k: o.refunded, kBase: ob.refunded, n: o.paid + o.refunded, unit: 'orders', show: pct2, path: ['Operations', 'Returns'] });
  }
  return out;
}

/**
 * Each product's units against its 4 weeks before, moved as much as the rest of the store's sales did (par's season
 * adjustment). A product new in those weeks has no baseline; a price or page change in them is named as a confound.
 */
function productReadings(db: Db, storeId: string, p: Period): Reading[] {
  const before = { from: addDays(p.from, -PERIOD), to: addDays(p.from, -1) };
  const products = db
    .prepare(
      `SELECT DISTINCT i.product_id AS id, coalesce(p.title, i.product_id) AS title FROM order_items i JOIN orders o ON o.store_id = i.store_id AND o.id = i.order_id
       LEFT JOIN products p ON p.store_id = i.store_id AND p.id = i.product_id WHERE i.store_id = ? AND o.status = 'paid' AND o.local_date BETWEEN ? AND ?`,
    )
    .all(storeId, before.from, p.to);
  const priced = db.prepare(`SELECT min(changed_on) AS day FROM price_tests WHERE store_id = ? AND product_id = ? AND changed_on BETWEEN ? AND ?`);
  const paged = db.prepare(`SELECT min(substr(published_at, 1, 10)) AS day FROM page_drafts WHERE store_id = ? AND product_id = ? AND substr(published_at, 1, 10) BETWEEN ? AND ?`);
  return products.flatMap((r) => {
    const id = String(r.id);
    if (newSince(db, storeId, id, before.from)) return [];
    const [a, b] = [productSales(db, storeId, id, p.from, p.to), productSales(db, storeId, id, before.from, before.to)];
    if (Math.min(a.units, b.units) < MIN.units) return [];
    const [price, page] = [priced, paged].map((q) => q.get(storeId, id, before.from, p.to)?.day);
    return [{
      storeId, ref: `perf:${storeId}:product:${id}:units:${p.from}`, subject: `product:${id}`, name: `"${String(r.title).slice(0, 60)}"`, metric: 'units', label: 'unit sales',
      vs: "its 4 weeks before, adjusted for the store's trend", value: a.units, baseline: b.units * restTrend(db, storeId, id, before, p), k: a.units, kBase: b.units,
      n: a.units, unit: 'units', show: (v: number) => Math.round(v).toLocaleString('en-US'), from: p.from, to: p.to,
      confounds: [...(price ? [`its price changed on ${price}`] : []), ...(page ? [`its page changed on ${page}`] : [])], path: ['Products', 'Sales results'],
    }];
  });
}

/** What a store's performance learning reads from, and what isn't enabled. */
export function performanceStatus(db: Db, storeId: string): KbPerformance {
  const demo = !!db.prepare('SELECT demo FROM stores WHERE id = ?').get(storeId)?.demo;
  const lessons = Number(db.prepare(`SELECT count(*) AS n FROM kb_cards WHERE store_id = ? AND origin = 'performance' AND status IN ('active', 'proposed')`).get(storeId)?.n);
  if (demo) return { storeId, demo, on: [], off: [], lessons };
  const has = (sql: string) => !!db.prepare(sql).get(storeId);
  const parts: [boolean, string, string][] = [
    [
      has('SELECT 1 FROM campaigns c JOIN campaign_daily d ON d.network = c.network AND d.campaign_id = c.id WHERE c.store_id = ? LIMIT 1'),
      'Campaign results: ROAS and click-through rate',
      'Campaign results: connect Meta, Google or TikTok Ads',
    ],
    [has('SELECT 1 FROM daily_metrics WHERE store_id = ? AND sessions > 0 LIMIT 1'), 'Conversion rate', "Conversion rate: no sessions synced yet (GA4, or the platform's analytics)"],
    [has('SELECT 1 FROM orders WHERE store_id = ? LIMIT 1'), 'Order value and refunds', 'Order value and refunds: no orders synced yet'],
    [has('SELECT 1 FROM order_items WHERE store_id = ? LIMIT 1'), 'Product sales', 'Product sales: no order lines synced yet'],
    [
      has(`SELECT 1 FROM ads a JOIN campaigns c ON c.network = a.network AND c.id = a.campaign_id JOIN ad_daily d ON d.network = a.network AND d.ad_id = a.id WHERE c.store_id = ? LIMIT 1`),
      'Ad results: each ad against the others in its ad set',
      'Ad results: none synced yet (ads sync with their Meta, Google or TikTok Ads campaigns)',
    ],
    [
      has(`SELECT 1 FROM ads a JOIN campaigns c ON c.network = a.network AND c.id = a.campaign_id JOIN creatives cr ON cr.id = a.creative_id
           WHERE c.store_id = ? AND coalesce(cr.format, cr.hook, cr.angle, cr.offer) IS NOT NULL LIMIT 1`),
      'Creative traits: format, hook, angle and offer of ads made from library creatives',
      'Creative traits: no synced ad was made from a library creative with its format, hook, angle or offer noted',
    ],
  ];
  return { storeId, demo, on: parts.filter((x) => x[0]).map((x) => x[1]), off: parts.filter((x) => !x[0]).map((x) => x[2]), lessons };
}

/** The hourly read, while the app runs. */
export function startKbPerformanceLoop(db: Db, everyMs = 3_600_000) {
  const timer = setInterval(() => learnFromPerformance(db), everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
