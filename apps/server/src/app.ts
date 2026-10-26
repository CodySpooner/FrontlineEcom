import { createSquad } from '@frontline/agents';
import { Hono } from 'hono';
import { ANALYTICS_RANGES, type AnalyticsRange, type StoreInput } from '@frontline/shared';
import { loadRows, summarize } from './analytics';
import type { Db } from './db';
import { localDate } from './dates';
import { agentRoutes } from './routes/agents';
import { createStore, deleteStore, getStore, listStores, parseStoreInput, updateStore } from './stores';

/** `?stores=a,b` → known store ids in store order; missing/empty = all stores. */
const pickStores = (db: Db, q?: string) => {
  const ids = listStores(db).map((s) => s.id);
  const want = q?.split(',').filter(Boolean);
  return want?.length ? ids.filter((id) => want.includes(id)) : ids;
};

const json = (req: Request): Promise<unknown> => req.json().catch(() => undefined);

export const createApp = (db: Db) =>
  new Hono()
    .get('/api/health', (c) => c.json({ ok: true }))
    .get('/api/stores', (c) => c.json(listStores(db)))
    .get('/api/stores/:id', (c) => {
      const store = getStore(db, c.req.param('id'));
      return store ? c.json(store) : c.json({ error: 'store not found' }, 404);
    })
    .post('/api/stores', async (c) => {
      const input = parseStoreInput(await json(c.req.raw), false);
      if (typeof input === 'string') return c.json({ error: input }, 400);
      const store = createStore(db, input as StoreInput);
      createSquad(db, store);
      return c.json(store, 201);
    })
    .patch('/api/stores/:id', async (c) => {
      const input = parseStoreInput(await json(c.req.raw), true);
      if (typeof input === 'string') return c.json({ error: input }, 400);
      const store = updateStore(db, c.req.param('id'), input);
      return store ? c.json(store) : c.json({ error: 'store not found' }, 404);
    })
    .delete('/api/stores/:id', (c) => (deleteStore(db, c.req.param('id')) ? c.body(null, 204) : c.json({ error: 'store not found' }, 404)))
    .get('/api/analytics/summary', (c) => {
      const range = Number(c.req.query('range') ?? 30) as AnalyticsRange;
      if (!ANALYTICS_RANGES.includes(range)) return c.json({ error: 'range must be 7, 30, 90 or 365' }, 400);
      const storeIds = pickStores(db, c.req.query('stores'));
      const to = localDate();
      return c.json(summarize(loadRows(db, storeIds, range, to), { range, to, storeIds }));
    })
    .route('/', agentRoutes(db));
