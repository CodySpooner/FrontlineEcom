import { SA_METRICS, SA_SOURCES, type SaCollection, type SaContext, type SaMetricId, type SaSourceKind } from '@frontline/shared';
import { Hono } from 'hono';
import type { Db } from '../db';
import { annotations } from './annotations';
import { compareProducts } from './compare';
import { contributions } from './contributions';
import { exportListings } from './exports';
import { insights } from './insights';
import { deleteLink, setLink } from './links';
import { computeMetricSet, computeSeries, parseFilters } from './metric-set';
import { listings, listingVariants } from './listings';
import { overview } from './overview';
import { productDetail } from './product';
import { historyStart, storePeriod, zoneInfo } from './period';
import { reconcile } from './reconcile';
import { datasetFreshness, markVerified, sourceRows } from './sources';

export type Scope = { storeId: string; metrics?: SaMetricId[] };

/**
 * Decision 3: every Store Analytics route reads one store by id. A missing store is 400, an unknown one 404; there is
 * no "all stores" and no `stores=` list. A `metrics=` list may name registry ids only.
 */
export function readScope(db: Db, q: (k: string) => string | undefined): Scope | { error: string; status: 400 | 404 } {
  if (q('stores') !== undefined) return { error: 'One store at a time: use store=', status: 400 };
  const storeId = q('store')?.trim();
  if (!storeId) return { error: 'store is required', status: 400 };
  if (!db.prepare('SELECT 1 FROM stores WHERE id = ?').get(storeId)) return { error: 'store not found', status: 404 };
  const metrics = q('metrics')?.split(',').map((m) => m.trim()).filter(Boolean);
  const unknown = metrics?.filter((m) => !(m in SA_METRICS));
  if (unknown?.length) return { error: `Unknown metric: ${unknown.join(', ')}`, status: 400 };
  return { storeId, ...(metrics?.length ? { metrics: metrics as SaMetricId[] } : {}) };
}

export function storeContext(db: Db, storeId: string, now = Date.now()): SaContext {
  const s = db.prepare('SELECT name, niche, platform, currency, demo FROM stores WHERE id = ?').get(storeId)!;
  const zone = zoneInfo(db, storeId);
  const channels = db
    .prepare('SELECT kind, status FROM integrations WHERE store_id = ? ORDER BY id')
    .all(storeId)
    .filter((r) => String(r.kind) in SA_SOURCES)
    .map((r) => ({ kind: r.kind as SaSourceKind, name: SA_SOURCES[r.kind as SaSourceKind].name, status: r.status === 'error' ? ('error' as const) : ('connected' as const) }));
  return {
    storeId,
    name: String(s.name),
    niche: String(s.niche),
    platform: String(s.platform),
    currency: String(s.currency),
    demo: !!s.demo,
    channels,
    zone: zone.zone ?? null,
    zoneLabel: zone.label,
    zoneAbbr: zone.abbr,
    historyStart: historyStart(db, storeId) ?? null,
    freshness: datasetFreshness(db, storeId, now),
  };
}

/** Every /api/analytics route this lane adds (the legacy summary, campaigns and top-products stay in app.ts). */
export function storeAnalyticsRoutes(db: Db) {
  const scoped = (c: { req: { query: (k: string) => string | undefined } }) => readScope(db, (k) => c.req.query(k));
  return new Hono()
    .get('/api/analytics/definitions', (c) => {
      const s = scoped(c);
      if ('error' in s) return c.json({ error: s.error }, s.status);
      const metrics = s.metrics ? Object.fromEntries(s.metrics.map((m) => [m, SA_METRICS[m]])) : SA_METRICS;
      return c.json({ metrics, sources: SA_SOURCES });
    })
    .get('/api/analytics/context', (c) => {
      const s = scoped(c);
      return 'error' in s ? c.json({ error: s.error }, s.status) : c.json(storeContext(db, s.storeId));
    })
    // SA-22: one store's metrics for a period with their comparison; every v1 number on the page comes through here.
    .get('/api/analytics/metrics', (c) => {
      const s = scoped(c);
      if ('error' in s) return c.json({ error: s.error }, s.status);
      const sp = storePeriod(db, s.storeId, (k) => c.req.query(k));
      if (typeof sp === 'string') return c.json({ error: sp }, 400);
      const filters = parseFilters(c.req.query('filters'));
      if (typeof filters === 'string') return c.json({ error: filters }, 400);
      const basis = c.req.query('refunds') ?? 'refund_day';
      if (basis !== 'refund_day' && basis !== 'order_day') return c.json({ error: 'refunds must be refund_day or order_day' }, 400);
      return c.json(computeMetricSet(db, s, s.metrics ?? (Object.keys(SA_METRICS) as SaMetricId[]), sp, filters, basis));
    })
    // SA-23: one metric's daily (weekly past 120 days) points with the comparison aligned by day offset.
    .get('/api/analytics/series', (c) => {
      const s = scoped(c);
      if ('error' in s) return c.json({ error: s.error }, s.status);
      const metric = c.req.query('metric');
      if (!metric || !(metric in SA_METRICS)) return c.json({ error: metric ? `Unknown metric: ${metric}` : 'metric is required' }, 400);
      const sp = storePeriod(db, s.storeId, (k) => c.req.query(k));
      if (typeof sp === 'string') return c.json({ error: sp }, 400);
      const filters = parseFilters(c.req.query('filters'));
      if (typeof filters === 'string') return c.json({ error: filters }, 400);
      const basis = c.req.query('refunds') ?? 'refund_day';
      if (basis !== 'refund_day' && basis !== 'order_day') return c.json({ error: 'refunds must be refund_day or order_day' }, 400);
      return c.json(computeSeries(db, s, metric as SaMetricId, sp, filters, basis));
    })
    // SA-24: Dashboard's revenue to v1 net sales for the period, line by line.
    .get('/api/analytics/reconcile', (c) => {
      const s = scoped(c);
      if ('error' in s) return c.json({ error: s.error }, s.status);
      const sp = storePeriod(db, s.storeId, (k) => c.req.query(k));
      if (typeof sp === 'string') return c.json({ error: sp }, 400);
      const basis = c.req.query('refunds') ?? 'refund_day';
      if (basis !== 'refund_day' && basis !== 'order_day') return c.json({ error: 'refunds must be refund_day or order_day' }, 400);
      return c.json(reconcile(db, s.storeId, sp.period.from, sp.period.to, basis));
    })
    // SA-69: the Overview's KPIs and channel split in one call.
    .get('/api/analytics/overview', (c) => {
      const s = scoped(c);
      if ('error' in s) return c.json({ error: s.error }, s.status);
      const sp = storePeriod(db, s.storeId, (k) => c.req.query(k));
      if (typeof sp === 'string') return c.json({ error: sp }, 400);
      const filters = parseFilters(c.req.query('filters'));
      if (typeof filters === 'string') return c.json({ error: filters }, 400);
      const basis = c.req.query('refunds') ?? 'refund_day';
      if (basis !== 'refund_day' && basis !== 'order_day') return c.json({ error: 'refunds must be refund_day or order_day' }, 400);
      return c.json(overview(db, s, sp, filters, basis));
    })
    // SA-73: each product's share of the net sales change.
    .get('/api/analytics/contributions', (c) => {
      const s = scoped(c);
      if ('error' in s) return c.json({ error: s.error }, s.status);
      const sp = storePeriod(db, s.storeId, (k) => c.req.query(k));
      if (typeof sp === 'string') return c.json({ error: sp }, 400);
      const filters = parseFilters(c.req.query('filters'));
      if (typeof filters === 'string') return c.json({ error: filters }, 400);
      const basis = c.req.query('refunds') ?? 'refund_day';
      if (basis !== 'refund_day' && basis !== 'order_day') return c.json({ error: 'refunds must be refund_day or order_day' }, 400);
      return c.json(contributions(db, s, sp, filters, basis));
    })
    // SA-74: the rule engine's insights for the store (period rules over the period) and every rule.
    .get('/api/analytics/insights', (c) => {
      const s = scoped(c);
      if ('error' in s) return c.json({ error: s.error }, s.status);
      const sp = storePeriod(db, s.storeId, (k) => c.req.query(k));
      return typeof sp === 'string' ? c.json({ error: sp }, 400) : c.json(insights(db, s.storeId, sp));
    })
    // SA-72: the chart's markers for the period (price tests, approved changes, sync failures over 3 h).
    .get('/api/analytics/annotations', (c) => {
      const s = scoped(c);
      if ('error' in s) return c.json({ error: s.error }, s.status);
      const sp = storePeriod(db, s.storeId, (k) => c.req.query(k));
      return typeof sp === 'string' ? c.json({ error: sp }, 400) : c.json(annotations(db, s.storeId, sp));
    })
    // SA-66: one page of the store's products with their state now and their period sales, sorted over all of them.
    .get('/api/analytics/listings', (c) => {
      const s = scoped(c);
      if ('error' in s) return c.json({ error: s.error }, s.status);
      const sp = storePeriod(db, s.storeId, (k) => c.req.query(k));
      if (typeof sp === 'string') return c.json({ error: sp }, 400);
      const filters = parseFilters(c.req.query('filters'));
      if (typeof filters === 'string') return c.json({ error: filters }, 400);
      const basis = c.req.query('refunds') ?? 'refund_day';
      if (basis !== 'refund_day' && basis !== 'order_day') return c.json({ error: 'refunds must be refund_day or order_day' }, 400);
      const out = listings(db, s.storeId, c.req.query(), sp, filters, basis); // status, q, sort, page and SA-80's filters
      return typeof out === 'string' ? c.json({ error: out }, 400) : c.json(out);
    })
    // SA-83: a product's variants for its expanded row.
    .get('/api/analytics/listings/:id/variants', (c) => {
      const s = scoped(c);
      if ('error' in s) return c.json({ error: s.error }, s.status);
      const sp = storePeriod(db, s.storeId, (k) => c.req.query(k));
      if (typeof sp === 'string') return c.json({ error: sp }, 400);
      const filters = parseFilters(c.req.query('filters'));
      if (typeof filters === 'string') return c.json({ error: filters }, 400);
      const basis = c.req.query('refunds') ?? 'refund_day';
      if (basis !== 'refund_day' && basis !== 'order_day') return c.json({ error: 'refunds must be refund_day or order_day' }, 400);
      const out = listingVariants(db, s.storeId, c.req.param('id'), sp, filters, basis);
      return out ? c.json(out) : c.json({ error: 'No such product in this store' }, 404);
    })
    // SA-87: the product drawer's data.
    .get('/api/analytics/products/:id', (c) => {
      const s = scoped(c);
      if ('error' in s) return c.json({ error: s.error }, s.status);
      const sp = storePeriod(db, s.storeId, (k) => c.req.query(k));
      if (typeof sp === 'string') return c.json({ error: sp }, 400);
      const filters = parseFilters(c.req.query('filters'));
      if (typeof filters === 'string') return c.json({ error: filters }, 400);
      const basis = c.req.query('refunds') ?? 'refund_day';
      if (basis !== 'refund_day' && basis !== 'order_day') return c.json({ error: 'refunds must be refund_day or order_day' }, 400);
      const out = productDetail(db, s.storeId, c.req.param('id'), sp, filters, basis);
      return out ? c.json(out) : c.json({ error: 'No such product in this store' }, 404);
    })
    // SA-86: products side by side, each number its Listings row's.
    .get('/api/analytics/compare', (c) => {
      const s = scoped(c);
      if ('error' in s) return c.json({ error: s.error }, s.status);
      const sp = storePeriod(db, s.storeId, (k) => c.req.query(k));
      if (typeof sp === 'string') return c.json({ error: sp }, 400);
      const filters = parseFilters(c.req.query('filters'));
      if (typeof filters === 'string') return c.json({ error: filters }, 400);
      const basis = c.req.query('refunds') ?? 'refund_day';
      if (basis !== 'refund_day' && basis !== 'order_day') return c.json({ error: 'refunds must be refund_day or order_day' }, 400);
      const out = compareProducts(db, s.storeId, c.req.query('products'), sp, filters, basis);
      return 'error' in out ? c.json({ error: out.error }, out.status) : c.json(out);
    })
    // SA-85 (decision 35): the Listings table as CSV, every matching row (to the cap) or the selected products.
    .get('/api/analytics/export/listings', (c) => {
      const s = scoped(c);
      if ('error' in s) return c.json({ error: s.error }, s.status);
      const sp = storePeriod(db, s.storeId, (k) => c.req.query(k));
      if (typeof sp === 'string') return c.json({ error: sp }, 400);
      const filters = parseFilters(c.req.query('filters'));
      if (typeof filters === 'string') return c.json({ error: filters }, 400);
      const basis = c.req.query('refunds') ?? 'refund_day';
      if (basis !== 'refund_day' && basis !== 'order_day') return c.json({ error: 'refunds must be refund_day or order_day' }, 400);
      const out = exportListings(db, s.storeId, c.req.query(), sp, filters, basis);
      if ('error' in out) return c.json({ error: out.error }, out.status);
      return c.body(out.csv, 200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${out.name}"` });
    })
    // SA-47: the store's collections for the filter (Shopify collections, WooCommerce categories, Etsy shop sections).
    .get('/api/analytics/collections', (c) => {
      const s = scoped(c);
      if ('error' in s) return c.json({ error: s.error }, s.status);
      const rows = db.prepare('SELECT collection_id AS id, max(title) AS title, source, count(*) AS n FROM product_collections WHERE store_id = ? GROUP BY collection_id, source ORDER BY 2 COLLATE NOCASE, 1').all(s.storeId);
      return c.json(rows.map((r): SaCollection => ({ id: String(r.id), title: r.title == null ? null : String(r.title), source: String(r.source), products: Number(r.n) })));
    })
    .get('/api/analytics/sources', (c) => {
      const s = scoped(c);
      return 'error' in s ? c.json({ error: s.error }, s.status) : c.json(sourceRows(db, s.storeId));
    })
    // The owner's recorded live comparison (decision 24): the app never marks a dataset verified on its own.
    .put('/api/analytics/sources/verified', async (c) => {
      const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body || typeof body !== 'object') return c.json({ error: 'a JSON body is required' }, 400);
      const s = readScope(db, (k) => (typeof body[k] === 'string' ? (body[k] as string) : undefined));
      if ('error' in s) return c.json({ error: s.error }, s.status);
      const r = markVerified(db, s.storeId, body.integration, body.dataset, body.note);
      return 'refused' in r ? c.json({ error: r.refused }, r.status) : c.json(r);
    })
    // SA-91: the owner's product links (decision 22), the app's own data: nothing is written to a platform.
    .put('/api/analytics/product-links', async (c) => {
      const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body || typeof body !== 'object') return c.json({ error: 'a JSON body is required' }, 400);
      const s = readScope(db, (k) => (typeof body[k] === 'string' ? (body[k] as string) : undefined));
      if ('error' in s) return c.json({ error: s.error }, s.status);
      const r = setLink(db, s.storeId, body.channelProductId, body.productId);
      return 'refused' in r ? c.json({ error: r.refused }, r.status) : c.json(r);
    })
    .delete('/api/analytics/product-links', async (c) => {
      const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body || typeof body !== 'object') return c.json({ error: 'a JSON body is required' }, 400);
      const s = readScope(db, (k) => (typeof body[k] === 'string' ? (body[k] as string) : undefined));
      if ('error' in s) return c.json({ error: s.error }, s.status);
      const r = deleteLink(db, s.storeId, body.channelProductId);
      return 'refused' in r ? c.json({ error: r.refused }, r.status) : c.json(r);
    });
}
