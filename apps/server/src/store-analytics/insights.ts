// SA-74 (decision 28): the one rule engine. Each rule has an id@version, named thresholds, a minimum sample and the
// datasets it reads; its insights are Observed only, never scored. A rule that flags on datasets from a stale or failed
// source is held back: one data-health insight says so and why, never a business alert (`source_health` names the source).
import { SA_SOURCES, type SaDataset, type SaFreshness, type SaInsight, type SaInsights, type SaRule, type SaSourceKind } from '@frontline/shared';
import { addDays } from '../dates';
import type { Db } from '../db';
import { LINE_COST } from './costs';
import { demoShares, totals } from './listings';
import type { StorePeriod } from './period';
import { computeMetricSet, setup } from './metric-set';
import { CANONICAL, salesMetrics } from './sales';
import { datasetFreshness } from './sources';

/** Stock cover under this many days flags, at the sales rate of the last `COVER_WINDOW` full days. */
export const COVER_DAYS = 10;
export const COVER_WINDOW = 14;
/** Units sold in the cover window below which there is no rate to judge by. */
export const COVER_MIN_UNITS = 5;
/** A product's refund rate over this multiple of the store's flags… */
export const REFUND_MULTIPLE = 2;
/** …once it ordered at least this many units in the period. */
export const REFUND_MIN_UNITS = 30;
/** A product's net sales down by this share of the comparison's flags… */
export const DOWN_SHARE = 0.3;
/** …when it sold at least this many units in the comparison. */
export const DOWN_MIN_UNITS = 20;
/** Ad spend up by this share while contribution after ads fell. */
export const AD_UP = 0.1;
/** Site conversion down by this share of the comparison's flags, with at least this many sessions in each period. */
export const CONVERSION_DOWN = 0.15;
export const CONVERSION_MIN_SESSIONS = 500;
/** Paid and not shipped after this many hours: `LATE_HOURS` in apps/web/src/lib/orders.ts (insights.test.ts holds them equal). */
export const LATE_HOURS = 48;

type Ctx = { db: Db; storeId: string; sp: StorePeriod; demo: boolean; freshness: SaFreshness[]; now: number; money: (v: number) => string };
type Rule = SaRule & { run: (c: Ctx) => SaInsight[] };

const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const groupBy = <T>(xs: T[], key: (x: T) => string) => xs.reduce((m, x) => m.set(key(x), [...(m.get(key(x)) ?? []), x]), new Map<string, T[]>()); // ES2024's Map.groupBy
const sourceName = (kind: string) => SA_SOURCES[kind as SaSourceKind]?.name ?? kind;
/** Failed, or no success for 3 sync intervals (sources.ts `stale`). */
const bad = (f: SaFreshness) => f.status === 'failed' || f.stale;

function stockCover({ db, storeId, sp, demo }: Ctx): SaInsight[] {
  const [from, to] = [addDays(sp.today, -COVER_WINDOW), addDays(sp.today, -1)];
  let units: Map<string, number>;
  if (demo) {
    const all = salesMetrics(db, storeId, from, to).units.value ?? 0;
    units = new Map([...demoShares(db, storeId)].map(([id, k]) => [id, Math.round(all * k)]));
  } else units = new Map([...totals(db, storeId, from, to, 'refund_day')].map(([id, t]) => [id, t.units]));
  return db
    .prepare("SELECT id, title, inventory AS stock FROM products WHERE store_id = ? AND status = 'active' AND inventory_tracked AND inventory > 0 ORDER BY title")
    .all(storeId)
    .flatMap((p): SaInsight[] => {
      const sold = units.get(String(p.id)) ?? 0;
      const [stock, rate] = [Number(p.stock), sold / COVER_WINDOW];
      if (sold < COVER_MIN_UNITS || stock / rate >= COVER_DAYS) return [];
      const cover = stock / rate;
      return [{
        rule: 'stock_cover@1', kind: 'business', tone: 'warn',
        title: `${p.title}: ${cover < 1 ? 'under a day' : `~${Math.round(cover)} days`} of stock`,
        detail: `${stock} left · ${rate.toFixed(1)} sold a day over the last ${COVER_WINDOW} days`,
        evidence: { stock, units: sold, days: COVER_WINDOW, cover: Math.round(cover * 10) / 10 },
        target: { kind: 'product', id: String(p.id) },
      }];
    });
}

function refundRate({ db, storeId, sp }: Ctx): SaInsight[] {
  const { from, to } = sp.period;
  const store = salesMetrics(db, storeId, from, to).refund_rate.value;
  if (store == null) return [];
  // salesMetrics' refunded units (by refund day), per product
  const refunded = new Map(
    db
      .prepare(`SELECT r.product_id AS p, sum(r.quantity) AS q FROM refunds r JOIN orders o ON o.store_id = r.store_id AND o.id = r.order_id
        WHERE r.store_id = ? AND r.local_date BETWEEN ? AND ? AND r.product_id IS NOT NULL AND o.breakdown_at IS NOT NULL AND ${CANONICAL} GROUP BY 1`)
      .all(storeId, from, to)
      .map((r) => [String(r.p), Number(r.q ?? 0)]),
  );
  const title = db.prepare('SELECT title FROM products WHERE store_id = ? AND id = ?');
  return [...totals(db, storeId, from, to, 'refund_day')].flatMap(([id, t]): SaInsight[] => {
    const back = refunded.get(id) ?? 0;
    if (t.units < REFUND_MIN_UNITS || back / t.units <= REFUND_MULTIPLE * store) return [];
    return [{
      rule: 'refund_rate@1', kind: 'business', tone: 'red',
      title: `${title.get(storeId, id)?.title ?? `Product ${id}`}: ${pct(back / t.units)} of units refunded`,
      detail: `${back} of ${t.units} units · store average ${pct(store)}`,
      evidence: { refunded: back, units: t.units, rate: back / t.units, store },
      target: { kind: 'product', id },
    }];
  });
}

function unitCost({ db, storeId, sp }: Ctx): SaInsight[] {
  // costMetrics' lines: an order line's cost or its unit cost on the day; an order without lines, its rows' (0 = none)
  const rows = db
    .prepare(
      `SELECT p, sum(q) AS q, sum(iif(c IS NULL, q, 0)) AS u FROM (
         SELECT l.product_id AS p, l.quantity AS q, ${LINE_COST} AS c FROM order_lines l JOIN orders o ON o.store_id = l.store_id AND o.id = l.order_id
         WHERE o.store_id = ?1 AND o.local_date BETWEEN ?2 AND ?3 AND ${CANONICAL}
         UNION ALL
         SELECT i.product_id, i.quantity, nullif(i.cost, 0) FROM order_items i JOIN orders o ON o.store_id = i.store_id AND o.id = i.order_id
         WHERE o.store_id = ?1 AND o.local_date BETWEEN ?2 AND ?3 AND ${CANONICAL} AND NOT EXISTS (SELECT 1 FROM order_lines l WHERE l.store_id = o.store_id AND l.order_id = o.id)
       ) GROUP BY 1`,
    )
    .all(storeId, sp.period.from, sp.period.to);
  const missing = rows.filter((r) => Number(r.u) > 0);
  if (!missing.length) return [];
  const [units, uncosted] = [rows.reduce((a, r) => a + Number(r.q), 0), missing.reduce((a, r) => a + Number(r.u), 0)];
  return [{
    rule: 'unit_cost@1', kind: 'business', tone: 'warn',
    title: `${plural(missing.length, 'product')} ${missing.length === 1 ? 'has' : 'have'} no unit cost`,
    detail: `${pct(uncosted / units, 0)} of units sold · left out of contribution`,
    evidence: { products: missing.length, uncosted, units },
    target: { kind: 'products', ids: missing.map((r) => String(r.p)) },
  }];
}

function listingSync({ db, storeId }: Ctx): SaInsight[] {
  const failed = db
    .prepare("SELECT c.channel, c.error, coalesce(p.title, c.product_id) AS title FROM channel_listings c LEFT JOIN products p ON p.store_id = c.store_id AND p.id = c.product_id WHERE c.store_id = ? AND c.status = 'failed' ORDER BY c.channel, 3")
    .all(storeId);
  return [...groupBy(failed, (r) => String(r.channel))].map(([channel, rows]): SaInsight => ({
    rule: 'listing_sync@1', kind: 'business', tone: 'info',
    title: `${plural(rows.length, `${channel === 'site' ? 'Site' : sourceName(channel)} listing`)} failed to sync`,
    detail: rows.length === 1 ? [rows[0]!.title, rows[0]!.error].filter((x) => x != null).join(' · ') : `${rows.slice(0, 2).map((r) => r.title).join(', ')}${rows.length > 2 ? ` and ${rows.length - 2} more` : ''}`,
    evidence: { listings: rows.length },
    target: { kind: 'listings', channel },
  }));
}

function productDown({ db, storeId, sp, demo, money }: Ctx): SaInsight[] {
  const { compare, cut } = setup(db, storeId, sp, {});
  if (!compare || demo) return []; // ponytail: a demo store's products move with the store; the KPI already says so
  const cur = totals(db, storeId, sp.period.from, sp.period.to, 'refund_day');
  const prev = totals(db, storeId, compare.from, compare.to, 'refund_day', cut && { cut });
  const title = db.prepare('SELECT title FROM products WHERE store_id = ? AND id = ?');
  return [...prev].flatMap(([id, was]): SaInsight[] => {
    const now = cur.get(id)?.net_sales ?? 0;
    if (was.units < DOWN_MIN_UNITS || was.net_sales <= 0 || (was.net_sales - now) / was.net_sales < DOWN_SHARE) return [];
    return [{
      rule: 'product_down@1', kind: 'business', tone: 'warn',
      title: `${title.get(storeId, id)?.title ?? `Product ${id}`}: net sales down ${pct((was.net_sales - now) / was.net_sales, 0)}`,
      detail: `${money(now)} vs ${money(was.net_sales)} · ${was.units} units before`,
      evidence: { net_sales: now, previous: was.net_sales, previousUnits: was.units },
      target: { kind: 'product', id },
    }];
  });
}

function adsUpContributionDown({ db, storeId, sp, money }: Ctx): SaInsight[] {
  const [ads, after] = computeMetricSet(db, { storeId }, ['ad_spend', 'contribution_after_ads'], sp).metrics;
  const [a, a0, c, c0] = [ads!.value, ads!.previous?.value, after!.value, after!.previous?.value];
  if (a == null || !a0 || c == null || c0 == null || a / a0 - 1 < AD_UP || c >= c0) return [];
  return [{
    rule: 'ads_contribution@1', kind: 'business', tone: 'warn',
    title: `Ad spend up ${pct(a / a0 - 1)} while contribution after ads fell ${c0 > 0 ? pct((c0 - c) / c0) : `by ${money(c0 - c)}`}`,
    detail: `Ad spend ${money(a)} vs ${money(a0)} · contribution ${money(c)} vs ${money(c0)}`,
    evidence: { ad_spend: a, previousAdSpend: a0, contribution: c, previousContribution: c0 },
    target: { kind: 'metric', id: 'contribution_after_ads' },
  }];
}

function conversionDown({ db, storeId, sp }: Ctx): SaInsight[] {
  const [conv, sessions] = computeMetricSet(db, { storeId }, ['site_conversion', 'sessions'], sp).metrics;
  const [v, v0, s, s0] = [conv!.value, conv!.previous?.value, sessions!.value, sessions!.previous?.value];
  if (v == null || !v0 || s == null || s0 == null || Math.min(s, s0) < CONVERSION_MIN_SESSIONS || 1 - v / v0 < CONVERSION_DOWN) return [];
  return [{
    rule: 'conversion_down@1', kind: 'business', tone: 'warn',
    title: `Site conversion down to ${pct(v, 2)} from ${pct(v0, 2)}`,
    detail: `${((v0 - v) * 100).toFixed(2)} pts lower · ${s.toLocaleString('en-US')} sessions`,
    evidence: { site_conversion: v, previous: v0, sessions: s, previousSessions: s0 },
    target: { kind: 'metric', id: 'site_conversion' },
  }];
}

function lateFulfillment({ db, storeId, now }: Ctx): SaInsight[] {
  const late = db
    .prepare(
      `SELECT o.id, o.local_date AS day FROM orders o WHERE o.store_id = ? AND o.duplicate_of IS NULL AND o.status = 'paid' AND o.cancelled_at IS NULL
       AND o.fulfillment_status = 'unfulfilled' AND julianday(o.created_at) < julianday(?) ORDER BY o.created_at`,
    )
    .all(storeId, new Date(now - LATE_HOURS * 3_600_000).toISOString());
  if (!late.length) return [];
  const placed = new Date(`${late[0]!.day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return [{
    rule: 'late_fulfillment@1', kind: 'business', tone: 'red',
    title: `${plural(late.length, 'order')} not shipped after ${LATE_HOURS} h`,
    detail: `${late.length === 1 ? '' : 'Oldest '}${late[0]!.id}, placed ${placed}`,
    evidence: { orders: late.length, hours: LATE_HOURS },
    target: { kind: 'orders' },
  }];
}

function variantOut({ db, storeId }: Ctx): SaInsight[] {
  return db
    .prepare(
      `SELECT p.id, p.title, count(*) AS n, group_concat(coalesce(v.title, v.sku, v.id), ', ') AS out,
         (SELECT count(*) FROM product_variants w WHERE w.store_id = p.store_id AND w.product_id = p.id) AS variants
       FROM product_variants v JOIN products p ON p.store_id = v.store_id AND p.id = v.product_id
       WHERE v.store_id = ? AND p.status = 'active' AND v.inventory_tracked AND v.inventory <= 0 GROUP BY p.id ORDER BY p.title`,
    )
    .all(storeId)
    .map((r): SaInsight => {
      const many = Number(r.variants) > 1;
      return {
        rule: 'variant_out@1', kind: 'business', tone: 'warn',
        title: `${r.title}: ${many ? `${r.out} out of stock` : 'out of stock'}`,
        detail: many ? `${r.n} of ${r.variants} variants` : 'Tracked stock at 0',
        evidence: { variants: Number(r.variants), out: Number(r.n) },
        target: { kind: 'product', id: String(r.id) },
      };
    });
}

function unmappedOrders({ db, storeId, sp }: Ctx): SaInsight[] {
  const platform = String(db.prepare('SELECT platform FROM stores WHERE id = ?').get(storeId)!.platform);
  // dedupe.ts's warning: an unmapped sales-channel app's orders are never matched automatically
  const n = Number(
    db
      .prepare(`SELECT count(*) AS n FROM orders o WHERE o.store_id = ? AND o.source_kind = ? AND o.channel = 'other' AND o.local_date BETWEEN ? AND ? AND ${CANONICAL}`)
      .get(storeId, platform, sp.period.from, sp.period.to)!.n,
  );
  if (!n) return [];
  return [{
    rule: 'unmapped_orders@1', kind: 'data_health', tone: 'warn',
    title: `${plural(n, 'order')} from other sales-channel apps may be counted twice`,
    detail: `${sourceName(platform)} recorded ${n === 1 ? 'it' : 'them'} for an app the store has no integration for; never matched automatically`,
    evidence: { orders: n },
    target: { kind: 'sources' },
  }];
}

function sourceHealth({ freshness, now }: Ctx): SaInsight[] {
  return [...groupBy(freshness.filter(bad), (f) => f.source)].map(([source, rows]): SaInsight => {
    const failed = rows.some((f) => f.status === 'failed');
    const last = rows.map((f) => f.lastSuccess).filter((x) => x != null).sort()[0];
    const datasets = rows.map((f) => f.dataset.replaceAll('_', ' ')).join(', ');
    return {
      rule: 'source_health@1', kind: 'data_health', tone: 'red',
      title: failed ? `${sourceName(source)} sync failing` : `${sourceName(source)} hasn't synced for ${Math.round((now - Date.parse(last!)) / 3_600_000)} h`,
      detail: [datasets, rows.find((f) => f.error)?.error].filter(Boolean).join(' · '),
      evidence: { datasets: rows.length, ...(last && { lastSuccess: last }) },
      target: { kind: 'sources' },
    };
  });
}

export const RULES: Rule[] = [
  {
    id: 'stock_cover@1', name: 'Low stock cover', metrics: ['units'], datasets: ['orders', 'order_lines', 'inventory'], run: stockCover,
    when: `Tracked stock covers under ${COVER_DAYS} days at the last ${COVER_WINDOW} full days' sales rate`, minSample: `${COVER_MIN_UNITS} units sold in those ${COVER_WINDOW} days`,
  },
  {
    id: 'refund_rate@1', name: 'High refund rate', metrics: ['refund_rate', 'units'], datasets: ['orders', 'order_lines', 'refunds'], run: refundRate,
    when: `A product's units refunded ÷ units ordered is over ${REFUND_MULTIPLE}× the store's, in the period`, minSample: `${REFUND_MIN_UNITS} units ordered in the period`,
  },
  {
    id: 'unit_cost@1', name: 'No unit cost', metrics: ['cost_coverage', 'contribution_before_ads'], datasets: ['orders', 'order_lines', 'catalog'], run: unitCost,
    when: 'Units sold in the period have no unit cost, so contribution leaves them out', minSample: '1 unit sold',
  },
  {
    id: 'listing_sync@1', name: 'Listing sync failed', metrics: [], datasets: ['channel_listings'], run: listingSync,
    when: "A sales channel's last sync of a listing failed", minSample: 'None: every failure counts',
  },
  {
    id: 'product_down@1', name: 'Product sales down', metrics: ['net_sales'], datasets: ['orders', 'order_lines', 'refunds'], run: productDown,
    when: `A product's net sales fell ${pct(DOWN_SHARE, 0)} or more against the comparison`, minSample: `${DOWN_MIN_UNITS} units sold in the comparison`,
  },
  {
    id: 'ads_contribution@1', name: 'Ad spend up, contribution down', metrics: ['ad_spend', 'contribution_after_ads'], datasets: ['ad_spend', 'orders', 'order_lines'], run: adsUpContributionDown,
    when: `Ad spend rose ${pct(AD_UP, 0)} or more against the comparison while contribution after ads fell`, minSample: 'Ad spend and contribution in both periods',
  },
  {
    id: 'conversion_down@1', name: 'Conversion down', metrics: ['site_conversion', 'sessions'], datasets: ['traffic', 'purchase_sessions'], run: conversionDown,
    when: `Site conversion fell ${pct(CONVERSION_DOWN, 0)} or more against the comparison (only where it is tracked)`, minSample: `${CONVERSION_MIN_SESSIONS} sessions in each period`,
  },
  {
    id: 'late_fulfillment@1', name: 'Late fulfillment', metrics: [], datasets: ['orders'], run: lateFulfillment,
    when: `A paid order not shipped ${LATE_HOURS} hours after it was placed`, minSample: 'None: every late order counts',
  },
  {
    id: 'variant_out@1', name: 'Out of stock', metrics: [], datasets: ['variants', 'inventory'], run: variantOut,
    when: "An active product's tracked variant at 0 or below", minSample: 'None',
  },
  {
    id: 'unmapped_orders@1', name: 'Orders that may duplicate', metrics: ['orders'], datasets: ['orders'], run: unmappedOrders,
    when: 'Orders the store platform recorded for a sales-channel app with no integration here, in the period', minSample: 'None',
  },
  {
    id: 'source_health@1', name: 'Stale or failed source', metrics: [], datasets: [], run: sourceHealth,
    when: "A source's last sync of a dataset failed, or it hasn't synced for 3 of its sync intervals", minSample: 'None',
  },
];

export function insights(db: Db, storeId: string, sp: StorePeriod, now = Date.now()): SaInsights {
  const freshness = datasetFreshness(db, storeId, now);
  const store = db.prepare('SELECT demo, currency FROM stores WHERE id = ?').get(storeId)!;
  const money = (v: number) => (v < 0 ? '−' : '') + new Intl.NumberFormat('en-US', { style: 'currency', currency: String(store.currency), maximumFractionDigits: 0 }).format(Math.abs(v));
  const ctx: Ctx = { db, storeId, sp, now, freshness, money, demo: !!store.demo };
  const out = RULES.flatMap((r): SaInsight[] => {
    const found = r.run(ctx);
    const stale = freshness.filter((f) => bad(f) && r.datasets.includes(f.dataset));
    if (!stale.length || !found.length) return found;
    return [{
      rule: r.id, kind: 'data_health', tone: 'red',
      title: `${r.name} held back`,
      detail: `${plural(found.length, 'flag')} waiting for ${stale.map((f) => `${sourceName(f.source)} ${f.dataset.replaceAll('_', ' ')}`).join(', ')} (${stale.some((f) => f.status === 'failed') ? 'failing to sync' : 'out of date'})`,
      evidence: { flags: found.length, sources: stale.length },
      target: { kind: 'sources' },
    }];
  });
  return { insights: out, rules: RULES.map(({ run: _, ...r }) => r) };
}
