import { SA_METRICS, SA_SOURCES, type SaMetricId } from '@frontline/shared';
import { Hono } from 'hono';
import type { Db } from '../db';

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

/** Every /api/analytics route this lane adds (the legacy summary, campaigns and top-products stay in app.ts). */
export function storeAnalyticsRoutes(db: Db) {
  return new Hono().get('/api/analytics/definitions', (c) => {
    const s = readScope(db, (k) => c.req.query(k));
    if ('error' in s) return c.json({ error: s.error }, s.status);
    const metrics = s.metrics ? Object.fromEntries(s.metrics.map((m) => [m, SA_METRICS[m]])) : SA_METRICS;
    return c.json({ metrics, sources: SA_SOURCES });
  });
}
