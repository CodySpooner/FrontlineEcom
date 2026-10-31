// SA-87 (spec §7 Product detail view): the product drawer's data in one call. Its row is its Listings row and its
// numbers come from the same functions (a demo store's by its fixed share), so the drawer and the table agree
// (consistency row). A linked channel product (SA-91) opens its store product, whose numbers and channels include it.
// SA-92: its unit cost history and the refund lines its Refunds number adds up.
import { changeOf, SA_METRICS, saDef, type SaFilters, type SaFilterScope, type SaListings, type SaMetricId, type SaMetricResult, type SaProductChannel, type SaProductDetail, type SaRefundLine, type SaValue } from '@frontline/shared';
import type { Db } from '../db';
import { costMetrics } from './costs';
import { storeConverter } from './fx';
import { insights } from './insights';
import { linkMap, productLinks, withLinked } from './links';
import { demoShares, demoSplit, inStore, listings, listingVariants, type Sales } from './listings';
import { computeSeries, setup } from './metric-set';
import type { StorePeriod } from './period';
import { CANONICAL, inProducts, salesMetrics, sliceSql, type RefundBasis, type Slice } from './sales';

const METRICS: [SaMetricId, keyof Sales][] = [
  ['units', 'units'],
  ['net_sales', 'net_sales'],
  ['refunds', 'refunds'],
  ['refund_rate', 'refund_rate'],
  ['contribution_before_ads', 'contribution'],
  ['cost_coverage', 'cost_coverage'],
];

/** Undefined: no such product in the store. The page's collection and product filters don't narrow one product. */
export function productDetail(db: Db, storeId: string, id: string, sp: StorePeriod, filters: SaFilters = {}, basis: RefundBasis = 'refund_day', now = Date.now()): SaProductDetail | undefined {
  if (!inStore(db, storeId, [id])) return undefined;
  id = linkMap(db, storeId).get(id) ?? id;
  const ids = withLinked(db, storeId, [id]);
  const store = db.prepare('SELECT platform, demo, currency, fee_percent AS pct, fee_per_order AS per FROM stores WHERE id = ?').get(storeId)!;
  const demo = !!store.demo;
  const { collection, product, ...rest } = filters;
  // ponytail: a fixed valid query, so never an error string
  const l = listings(db, storeId, { status: 'all' }, sp, { ...rest, product: [id] }, basis) as SaListings;
  const row = l.rows[0]!;
  const scope: SaFilterScope = {
    applied: l.scope.applied.filter((k) => k !== 'product'),
    ignored: [...l.scope.ignored, ...(['collection', 'product'] as const).filter((k) => filters[k]?.length).map((key) => ({ key, reason: 'The drawer shows the one product' }))],
  };

  const { compare, cut } = setup(db, storeId, sp, {});
  const channels = rest.channel?.length && !demo ? rest.channel : undefined;
  const numbers = (from: string, to: string, c?: Slice['cut'], only = channels): Sales => {
    if (demo) return demoSplit(db, storeId, from, to, basis, c && { cut: c })(id);
    const slice: Slice = { ...(only && { channels: only }), products: ids, ...(c && { cut: c }) };
    const k = costMetrics(db, storeId, from, to, basis, slice);
    return { ...salesMetrics(db, storeId, from, to, basis, slice), contribution: k.contribution_before_ads, cost_coverage: k.cost_coverage, fees: k.fees };
  };
  const cur = numbers(sp.period.from, sp.period.to);
  const prev = compare && numbers(compare.from, compare.to, cut);
  const metrics = METRICS.map(([m, k]): SaMetricResult => ({ ...cur[k], id: m, def: saDef(m), previous: prev ? prev[k] : null, change: changeOf(cur[k].value, prev ? prev[k].value : null, SA_METRICS[m].unit) }));

  // A demo store's units a day are the store's at the product's share, like its row (decision 30).
  const series = computeSeries(db, { storeId }, 'units', { ...sp, compare: undefined }, demo ? {} : { ...rest, product: [id] }, basis);
  const k = demo ? (demoShares(db, storeId).get(id) ?? 0) : 1;
  const points = series.points.map((p) => (demo ? { ...p, value: p.value == null ? null : Math.round(p.value * k) } : p));

  // One row a channel it's listed on or sold through in the period.
  const own = store.platform === 'shopify' || store.platform === 'woocommerce' ? 'site' : String(store.platform);
  const listed = new Map(
    db
      .prepare("SELECT channel, iif(max(status = 'failed'), 'failed', min(status)) AS status, max(error) AS error, max(synced_at) AS synced, min(published_at) AS published FROM channel_listings WHERE store_id = ? AND product_id IN (SELECT value FROM json_each(?)) GROUP BY channel")
      .all(storeId, JSON.stringify(ids))
      .map((r) => [String(r.channel), r]),
  );
  const w = sliceSql(db, storeId, { products: ids }, sp.period.to);
  const sold = demo
    ? []
    : db
        .prepare(`SELECT DISTINCT coalesce(o.channel, iif(+o.id GLOB 'tt-*', 'tiktok_shop', ?)) AS ch FROM orders o WHERE o.store_id = ? AND o.local_date BETWEEN ? AND ? AND ${CANONICAL}${w.sql}`)
        .all(own, storeId, sp.period.from, sp.period.to, ...w.params)
        .map((r) => String(r.ch));
  const none: SaValue = { value: null, status: 'unavailable', reason: 'unsupported', note: "Demo data isn't split by channel" };
  const rows = [...new Set([...listed.keys(), ...sold])]
    .filter((c) => !channels || channels.includes(c))
    .sort()
    .map((channel): SaProductChannel => {
      const x = listed.get(channel);
      const s = demo ? undefined : numbers(sp.period.from, sp.period.to, undefined, [channel]);
      return {
        channel,
        status: x?.status == null ? null : String(x.status),
        error: x?.error == null ? null : String(x.error),
        syncedAt: x?.synced == null ? null : String(x.synced),
        publishedAt: x?.published == null ? null : String(x.published),
        units: s?.units ?? none,
        netSales: s?.net_sales ?? none,
        refunds: s?.refunds ?? none,
      };
    });

  const cost = demo
    ? db.prepare("SELECT cost AS value, 'demo' AS source, NULL AS since FROM products WHERE store_id = ? AND id = ? AND cost > 0").get(storeId, id)
    : db.prepare('SELECT cost AS value, source, effective_from AS since FROM unit_costs WHERE store_id = ? AND product_id = ? AND variant_id IS NULL AND effective_from <= ? ORDER BY effective_from DESC, recorded_at DESC LIMIT 1').get(storeId, id, sp.today);
  const history = db
    .prepare(
      `SELECT u.cost, u.currency, u.source, u.effective_from AS since, u.recorded_at AS at, u.variant_id AS vid, v.title AS variant FROM unit_costs u
       LEFT JOIN product_variants v ON v.store_id = u.store_id AND v.product_id = u.product_id AND v.id = u.variant_id
       WHERE u.store_id = ? AND u.product_id = ? ORDER BY u.effective_from DESC, u.recorded_at DESC, u.rowid DESC`,
    )
    .all(storeId, id)
    .map((r) => ({ value: Number(r.cost), currency: r.currency == null ? null : String(r.currency), source: String(r.source), since: String(r.since), recordedAt: String(r.at), variant: r.vid == null ? null : String(r.variant ?? r.vid) }));

  // The rows `totals()` counts as its refunds: merchandise of orders with money parts, at the refund day's rate.
  const { fx } = storeConverter(db, String(store.currency));
  const day = basis === 'order_day' ? 'o.local_date' : 'r.local_date';
  const wr = sliceSql(db, storeId, channels && { channels }, sp.period.to, day, basis === 'order_day' ? 'o.created_at' : 'r.refunded_at');
  const ip = inProducts({ products: ids }, 'r.product_id');
  const refundLines = demo
    ? []
    : db
        .prepare(
          `SELECT r.id, r.order_id AS o, r.local_date AS day, r.quantity AS q, r.merchandise AS merch, r.restocked AS back, o.currency AS cur, o.fx_rate AS locked, coalesce(v.title, r.variant_id) AS variant
           FROM refunds r JOIN orders o ON o.store_id = r.store_id AND o.id = r.order_id
           LEFT JOIN product_variants v ON v.store_id = r.store_id AND v.product_id = r.product_id AND v.id = r.variant_id
           WHERE r.store_id = ? AND ${day} BETWEEN ? AND ? AND o.breakdown_at IS NOT NULL AND ${CANONICAL}${wr.sql}${ip.sql} ORDER BY r.local_date DESC, r.refunded_at DESC, r.id`,
        )
        .all(storeId, sp.period.from, sp.period.to, ...wr.params, ...ip.params)
        .flatMap((r): SaRefundLine[] => {
          const rate = fx(String(r.day), r.cur, r.locked, 0);
          if (rate == null) return [];
          const amount = Math.round(Number(r.merch ?? 0) * rate * 100) / 100;
          return [{ id: String(r.id), orderId: String(r.o), date: String(r.day), variant: r.variant == null ? null : String(r.variant), quantity: r.q == null ? null : Number(r.q), amount, restocked: r.back == null ? null : !!r.back }];
        });

  const failedOn = new Set(row.channels.filter((c) => c.status === 'failed').map((c) => c.channel));
  const flags = insights(db, storeId, sp, now);
  const mine = flags.insights.filter(({ target: t }) => (t.kind === 'product' && ids.includes(t.id)) || (t.kind === 'products' && t.ids.some((x) => ids.includes(x))) || (t.kind === 'listings' && failedOn.has(t.channel)));
  return {
    period: sp.period,
    compare: sp.compare ?? null,
    row,
    metrics,
    units: { grain: series.grain, points },
    channels: rows,
    ...(demo && { channelsNote: "Demo data isn't split by channel" }),
    costs: {
      unitCost: cost ? { value: Number(cost.value), source: String(cost.source), since: cost.since == null ? null : String(cost.since) } : null,
      fees: cur.fees,
      feeRule: { percent: Number(store.pct), perOrder: Number(store.per) },
      history,
    },
    variants: listingVariants(db, storeId, id, sp, rest, basis)!,
    insights: mine,
    rules: flags.rules.filter((r) => mine.some((i) => i.rule === r.id)),
    links: productLinks(db, storeId, id),
    refundLines: demo ? { rows: [], note: 'Demo data has no refund lines' } : { rows: refundLines },
    scope,
  };
}
