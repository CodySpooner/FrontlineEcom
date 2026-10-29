import { SA_METRICS, SA_SOURCES, type SaContext, type SaMetricId, type SaSourceKind } from '@frontline/shared';
import { Hono } from 'hono';
import type { Db } from '../db';
import { computeMetricSet, parseFilters } from './metric-set';
import { historyStart, storePeriod, zoneInfo } from './period';
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
    });
}
