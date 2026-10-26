import { Hono } from 'hono';
import { ANALYTICS_RANGES, type AnalyticsRange } from '@frontline/shared';
import { loadRows, summarize } from './analytics';
import type { Db } from './db';
import { localDate } from './dates';
import { listStores } from './stores';

/** `?stores=a,b` → known store ids in store order; missing/empty = all stores. */
const pickStores = (db: Db, q?: string) => {
  const ids = listStores(db).map((s) => s.id);
  const want = q?.split(',').filter(Boolean);
  return want?.length ? ids.filter((id) => want.includes(id)) : ids;
};

export const createApp = (db: Db) =>
  new Hono()
    .get('/api/health', (c) => c.json({ ok: true }))
    .get('/api/stores', (c) => c.json(listStores(db)))
    .get('/api/analytics/summary', (c) => {
      const range = Number(c.req.query('range') ?? 30) as AnalyticsRange;
      if (!ANALYTICS_RANGES.includes(range)) return c.json({ error: 'range must be 7, 30, 90 or 365' }, 400);
      const storeIds = pickStores(db, c.req.query('stores'));
      const to = localDate();
      return c.json(summarize(loadRows(db, storeIds, range, to), { range, to, storeIds }));
    });
