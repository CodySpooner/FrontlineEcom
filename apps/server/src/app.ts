import { createSquad } from '@frontline/agents';
import { serve, upgradeWebSocket } from '@hono/node-server';
import { Hono } from 'hono';
import { WebSocketServer } from 'ws';
import { ANALYTICS_RANGES, type AnalyticsRange, type ApprovalDecision, type ApprovalStatus, type StoreInput } from '@frontline/shared';
import { loadRows, summarize } from './analytics';
import { decide, listApprovals } from './approvals';
import { listOrders, listProducts } from './catalog';
import { competitorRoutes } from './competitors';
import { dataDir, type Db } from './db';
import { localDate } from './dates';
import { deleteIntegration, listIntegrations, saveIntegration } from './integrations';
import { listEvents, subscribe } from './live';
import { researchRoutes } from './research';
import { settingsRoutes } from './settings';
import { agentRoutes } from './routes/agents';
import { loadKey } from './secrets';
import { createStore, deleteStore, getStore, listStores, parseStoreInput, updateStore } from './stores';

/** `?stores=a,b` → known store ids in store order; missing/empty = all stores. */
const pickStores = (db: Db, q?: string) => {
  const ids = listStores(db).map((s) => s.id);
  const want = q?.split(',').filter(Boolean);
  return want?.length ? ids.filter((id) => want.includes(id)) : ids;
};

const json = (req: Request): Promise<unknown> => req.json().catch(() => undefined);

/** `secretKey` defaults to the key file in the data dir, loaded on first use. */
export const createApp = (db: Db, secretKey?: Buffer) => {
  const key = () => (secretKey ??= loadKey(dataDir()));
  return new Hono()
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
    .get('/api/events', (c) => {
      const limit = Math.min(200, Math.max(1, Number(c.req.query('limit')) || 20));
      return c.json(listEvents(db, pickStores(db, c.req.query('stores')), limit));
    })
    .get(
      '/api/live',
      upgradeWebSocket(() => {
        let off = () => {};
        return {
          onOpen: (_, ws) => void (off = subscribe((m) => ws.send(JSON.stringify(m)))),
          onClose: () => off(),
        };
      }),
    )
    .get('/api/approvals', (c) => {
      const status = c.req.query('status') as ApprovalStatus | undefined;
      if (status && !['pending', 'approved', 'denied'].includes(status)) return c.json({ error: 'status must be pending, approved or denied' }, 400);
      return c.json(listApprovals(db, pickStores(db, c.req.query('stores')), status));
    })
    .post('/api/approvals/:id/:decision{approve|deny}', (c) => {
      const a = decide(db, c.req.param('id'), c.req.param('decision') as ApprovalDecision);
      if (!a) return c.json({ error: 'approval not found' }, 404);
      return a === 'decided' ? c.json({ error: 'approval already decided' }, 409) : c.json(a);
    })
    .get('/api/products', (c) => {
      const page = listProducts(db, pickStores(db, c.req.query('stores')), (k) => c.req.query(k));
      return typeof page === 'string' ? c.json({ error: page }, 400) : c.json(page);
    })
    .get('/api/orders', (c) => {
      const page = listOrders(db, pickStores(db, c.req.query('stores')), (k) => c.req.query(k));
      return typeof page === 'string' ? c.json({ error: page }, 400) : c.json(page);
    })
    .get('/api/integrations', (c) => c.json(listIntegrations(db, key(), pickStores(db, c.req.query('stores')))))
    .put('/api/integrations', async (c) => {
      const saved = saveIntegration(db, key(), await json(c.req.raw));
      return typeof saved === 'string' ? c.json({ error: saved }, 400) : c.json(saved);
    })
    .delete('/api/integrations/:id', (c) => (deleteIntegration(db, c.req.param('id')) ? c.body(null, 204) : c.json({ error: 'integration not found' }, 404)))
    .get('/api/analytics/summary', (c) => {
      const range = Number(c.req.query('range') ?? 30) as AnalyticsRange;
      if (!ANALYTICS_RANGES.includes(range)) return c.json({ error: 'range must be 7, 30, 90 or 365' }, 400);
      const storeIds = pickStores(db, c.req.query('stores'));
      const to = localDate();
      return c.json(summarize(loadRows(db, storeIds, range, to), { range, to, storeIds }));
    })
    .route('/', researchRoutes(db))
    .route('/', competitorRoutes(db, (q) => pickStores(db, q)))
    .route('/', settingsRoutes(db))
    .route('/', agentRoutes(db));
};

/** HTTP + WebSocket server on 127.0.0.1 (port 0 = any free port). */
export const startServer = (db: Db, port: number, onListen?: (port: number) => void) =>
  serve({ fetch: createApp(db).fetch, port, hostname: '127.0.0.1', websocket: { server: new WebSocketServer({ noServer: true }) } }, (info) => onListen?.(info.port));
