import { SA_METRICS, SA_SOURCES, type SaContext, type SaMetricId, type SaSourceKind } from '@frontline/shared';
import { Hono } from 'hono';
import type { Db } from '../db';
import { historyStart, zoneInfo } from './period';
import { datasetFreshness, sourceRows } from './sources';

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
    .get('/api/analytics/sources', (c) => {
      const s = scoped(c);
      return 'error' in s ? c.json({ error: s.error }, s.status) : c.json(sourceRows(db, s.storeId));
    });
}
