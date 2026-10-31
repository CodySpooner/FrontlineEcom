// SA-74 (decision 28): the one rule engine. Each rule has an id@version, named thresholds, a minimum sample and the
// datasets it reads; its insights are Observed only, never scored. A business rule whose datasets come from a stale or
// failed source isn't run: it says it wasn't checked and why (a data-health insight), never a business alert.
import { SA_SOURCES, type SaDataset, type SaFreshness, type SaInsight, type SaInsights, type SaRule, type SaSourceKind } from '@frontline/shared';
import { addDays } from '../dates';
import type { Db } from '../db';
import { LINE_COST } from './costs';
import { demoShares, totals } from './listings';
import type { StorePeriod } from './period';
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

type Ctx = { db: Db; storeId: string; sp: StorePeriod; demo: boolean; freshness: SaFreshness[]; now: number };
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
    id: 'stock_cover@1', name: 'Low stock cover', datasets: ['orders', 'order_lines', 'inventory'], run: stockCover,
    when: `Tracked stock covers under ${COVER_DAYS} days at the last ${COVER_WINDOW} full days' sales rate`, minSample: `${COVER_MIN_UNITS} units sold in those ${COVER_WINDOW} days`,
  },
  {
    id: 'refund_rate@1', name: 'High refund rate', datasets: ['orders', 'order_lines', 'refunds'], run: refundRate,
    when: `A product's units refunded ÷ units ordered is over ${REFUND_MULTIPLE}× the store's, in the period`, minSample: `${REFUND_MIN_UNITS} units ordered in the period`,
  },
  {
    id: 'unit_cost@1', name: 'No unit cost', datasets: ['orders', 'order_lines', 'catalog'], run: unitCost,
    when: 'Units sold in the period have no unit cost, so contribution leaves them out', minSample: '1 unit sold',
  },
  {
    id: 'listing_sync@1', name: 'Listing sync failed', datasets: ['channel_listings'], run: listingSync,
    when: "A sales channel's last sync of a listing failed", minSample: 'None: every failure counts',
  },
  {
    id: 'source_health@1', name: 'Stale or failed source', datasets: [], run: sourceHealth,
    when: "A source's last sync of a dataset failed, or it hasn't synced for 3 of its sync intervals", minSample: 'None',
  },
];

export function insights(db: Db, storeId: string, sp: StorePeriod, now = Date.now()): SaInsights {
  const freshness = datasetFreshness(db, storeId, now);
  const ctx: Ctx = { db, storeId, sp, now, freshness, demo: !!db.prepare('SELECT demo FROM stores WHERE id = ?').get(storeId)?.demo };
  const out = RULES.flatMap((r): SaInsight[] => {
    const stale = freshness.filter((f) => bad(f) && r.datasets.includes(f.dataset));
    if (!stale.length) return r.run(ctx);
    return [{
      rule: r.id, kind: 'data_health', tone: 'red',
      title: `${r.name} not checked`,
      detail: `${stale.map((f) => `${sourceName(f.source)} ${f.dataset.replaceAll('_', ' ')}`).join(', ')} ${stale.some((f) => f.status === 'failed') ? 'failing to sync' : 'out of date'}`,
      evidence: { sources: stale.length },
      target: { kind: 'sources' },
    }];
  });
  return { insights: out, rules: RULES.map(({ run: _, ...r }) => r) };
}
