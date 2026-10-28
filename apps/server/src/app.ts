import { createSquad } from '@frontline/agents';
import { serve, upgradeWebSocket } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { WebSocketServer } from 'ws';
import { ANALYTICS_RANGES, type AnalyticsRange, type ApprovalDecision, type ApprovalStatus, type StoreInput } from '@frontline/shared';
import { campaignStats, currentWindow, dayShifts, platformSplit, summarize, topProducts } from './analytics';
import { decide, listApprovals } from './approvals';
import { automationRoutes } from './automations';
import { actionRoutes } from './actions';
import { backupRoutes } from './backups';
import { fxFor } from './fx';
import { kbRoutes } from './kb/routes';
import { log } from './log';
import { oauthKinds, oauthRoutes } from './oauth';
import { demoSupplierProducts, searchCj } from './connectors/cj';
import { listOrders, listProducts, setProductCost } from './catalog';
import { competitorRoutes } from './competitors';
import { dataDir, type Db } from './db';
import { addDays } from './dates';
import { deleteIntegration, health, listIntegrations, saveIntegration } from './integrations';
import { listEvents, subscribe } from './live';
import { researchRoutes } from './research';
import { settingsRoutes } from './settings';
import { agentRoutes, runManager } from './routes/agents';
import { listeningOn } from './routes/agents-runtimes';
import { wrongStore } from './routes/agents-scope';
import { ecosystemRoutes } from './routes/ecosystem';
import { loadKey } from './secrets';
import { createStore, deleteStore, getStore, listStores, parseStoreInput, updateStore } from './stores';

/** `?stores=a,b` → known store ids in store order; missing/empty = all stores. */
const pickStores = (db: Db, q?: string) => {
  const ids = listStores(db).map((s) => s.id);
  const want = q?.split(',').filter(Boolean);
  return want?.length ? ids.filter((id) => want.includes(id)) : ids;
};

const json = (req: Request): Promise<unknown> => req.json().catch(() => undefined);


const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const isLocal = (url: string) => URL.canParse(url) && LOCAL_HOSTS.has(new URL(url).hostname);
/** Same host and port: a page from another local port (another dev server, a local tool) is a different site. */
const sameHost = (origin: string, url: string) => URL.canParse(origin) && new URL(origin).host === new URL(url).host;

const MB = 1_048_576;
/**
 * Requests that start agent runs: knowledge-base research (new, retried, refined), Ask the knowledge base, a
 * conversation's create, send, retry and resume, and a team's start and a step's resume.
 */
const STARTS = /^\/api\/(kb\/(ask|research\/tasks(\/[^/]+\/(retry|refine))?)|conversations(\/[^/]+\/(messages|runs\/[^/]+\/(retry|resume)))?|teams(\/[^/]+\/steps\/[^/]+\/resume)?)$/;
/** Bodies that may carry a document or attachments (10 MB in base64). */
const LARGE = /^\/api\/(kb\/research\/tasks|conversations(\/[^/]+\/messages)?)$/;

/**
 * KB-25: the knowledge base and product research read no body over its size (research from an uploaded document
 * carries the file, at most 10 MB, in base64) and take at most 300 changes a minute, of which 10 start agent runs (a
 * refused request starts none), so a runaway client loop gets 429s instead of spending budgets or stalling the API.
 * Reads are never limited.
 */
function kbGuard(): MiddlewareHandler {
  const hits = { start: [] as number[], change: [] as number[] };
  return async (c, next) => {
    if (c.req.method === 'GET') return next();
    const now = Date.now();
    const recent = (k: keyof typeof hits) => (hits[k] = hits[k].filter((t) => now - t < 60_000)).length;
    const starts = c.req.method === 'POST' && STARTS.test(c.req.path);
    if (recent('change') >= 300 || (starts && recent('start') >= 10)) return c.json({ error: 'Too many requests at once: wait a minute and try again.' }, 429);
    hits.change.push(now);
    const maxSize = LARGE.test(c.req.path) ? 15 * MB : MB;
    let tooLarge = false;
    const done = await bodyLimit({ maxSize, onError: (c) => ((tooLarge = true), c.json({ error: 'The request is too large.' }, 413)) })(c, next);
    if (starts && !tooLarge && c.res.status < 300) hits.start.push(now);
    return done;
  };
}

/** `secretKey` defaults to the key file in the data dir, loaded on first use. */
export const createApp = (db: Db, secretKey?: Buffer) => {
  const key = () => (secretKey ??= loadKey(dataDir()));
  const guard = kbGuard();
  return new Hono()
    // A bug in a route reaches the log file (the packaged app has no console) and the UI still gets JSON.
    .onError((e, c) => {
      log('error', 'request failed', { method: c.req.method, path: c.req.path, error: e.stack ?? String(e) });
      return c.json({ error: e.message || 'Something went wrong' }, 500);
    })
    .notFound((c) => c.json({ error: `${c.req.method} ${c.req.path} not found` }, 404))
    // Only the local UI: a non-local Host is DNS rebinding, a foreign Origin is another site posting (or opening a socket) here.
    .use('*', async (c, next) => {
      const origin = c.req.header('origin');
      if (!isLocal(c.req.url) || (origin !== undefined && !sameHost(origin, c.req.url))) return c.json({ error: 'forbidden' }, 403);
      await next();
      // Never inside another site's frame: a hidden frame of the app (same origin, so the check above passes) could get
      // the owner to click Approve. The app's own previews are srcdoc frames, which this doesn't touch.
      c.res.headers.set('Content-Security-Policy', "frame-ancestors 'none'");
      c.res.headers.set('X-Frame-Options', 'DENY');
    })
    .use('/api/kb/*', guard)
    .use('/api/conversations/*', guard) // the bare path too
    .use('/api/research/*', guard)
    .use('/api/pr/*', guard) // product-research: every /api/pr route
    .use('/api/teams/*', guard)
    .get('/api/health', (c) => c.json(health(db)))
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
    .delete('/api/stores/:id', (c) => {
      runManager(db).cancelStore(c.req.param('id')); // its runs would otherwise wait forever on requests deleted with it
      return deleteStore(db, c.req.param('id')) ? c.body(null, 204) : c.json({ error: 'store not found' }, 404);
    })
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
    .post('/api/approvals/:id/:decision{approve|deny}', async (c) => {
      const decision = c.req.param('decision') as ApprovalDecision;
      const note = decision === 'deny' ? ((await json(c.req.raw)) as { note?: unknown } | undefined)?.note : undefined;
      if (note !== undefined && (typeof note !== 'string' || !note.trim() || note.trim().length > 300)) return c.json({ error: 'note must be 1 to 300 characters' }, 400);
      if (wrongStore(c, db, 'approvals', c.req.param('id'))) return c.json({ error: 'approval not found' }, 404);
      const a = decide(db, c.req.param('id'), decision, note?.trim());
      if (!a) return c.json({ error: 'approval not found' }, 404);
      return a === 'decided' ? c.json({ error: 'approval already decided' }, 409) : c.json(a);
    })
    .get('/api/products', (c) => {
      const page = listProducts(db, pickStores(db, c.req.query('stores')), (k) => c.req.query(k));
      return typeof page === 'string' ? c.json({ error: page }, 400) : c.json(page);
    })
    .patch('/api/products/:storeId/:id', async (c) => {
      const p = setProductCost(db, c.req.param('storeId'), c.req.param('id'), await json(c.req.raw));
      if (!p) return c.json({ error: 'product not found' }, 404);
      return typeof p === 'string' ? c.json({ error: p }, 400) : c.json(p);
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
    .route('/', backupRoutes(db))
    .route('/', actionRoutes(db, (q) => pickStores(db, q)))
    .get('/api/integrations/oauth', (c) => c.json(oauthKinds()))
    .route('/', oauthRoutes(db, key))
    .delete('/api/integrations/:id', (c) => (deleteIntegration(db, c.req.param('id')) ? c.body(null, 204) : c.json({ error: 'integration not found' }, 404)))
    // Marked changed, like a re-save: the sync loop runs it on its next tick (30 s at most).
    .post('/api/integrations/:id/sync', (c) =>
      db.prepare('UPDATE integrations SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), c.req.param('id')).changes ? c.json({}, 202) : c.json({ error: 'integration not found' }, 404))
    .get('/api/suppliers/products', async (c) => {
      const q = (c.req.query('q') ?? '').trim();
      if (!q || q.length > 200) return c.json({ error: 'q must be 1 to 200 characters' }, 400);
      const limit = Math.min(50, Math.max(1, Math.floor(Number(c.req.query('limit'))) || 20));
      try {
        return c.json((await searchCj(db, key(), q, limit)) ?? demoSupplierProducts(db, q, limit));
      } catch (e) {
        return c.json({ error: e instanceof Error ? e.message : 'CJ search failed' }, 502);
      }
    })
    .get('/api/analytics/summary', (c) => {
      const range = Number(c.req.query('range') ?? 30) as AnalyticsRange;
      if (!ANALYTICS_RANGES.includes(range)) return c.json({ error: 'range must be 7, 30, 90 or 365' }, 400);
      const storeIds = pickStores(db, c.req.query('stores'));
      const { to, todayFraction, rows, shift } = currentWindow(db, storeIds, range);
      const { currency, unconverted } = fxFor(db, storeIds);
      const byPlatform = platformSplit(db, storeIds, addDays(to, 1 - range), to, shift);
      return c.json({ ...summarize(rows, { range, to, storeIds, todayFraction }), byPlatform, currency, ...(unconverted.length ? { unconverted } : {}) });
    })
    .get('/api/analytics/campaigns', (c) => {
      const range = Number(c.req.query('range') ?? 30) as AnalyticsRange;
      if (!ANALYTICS_RANGES.includes(range)) return c.json({ error: 'range must be 7, 30, 90 or 365' }, 400);
      const storeIds = pickStores(db, c.req.query('stores'));
      const { to, shift } = dayShifts(db, storeIds);
      return c.json(campaignStats(db, storeIds, addDays(to, 1 - range), to, shift));
    })
    .get('/api/analytics/top-products', (c) => {
      const range = Number(c.req.query('range') ?? 30) as AnalyticsRange;
      if (!ANALYTICS_RANGES.includes(range)) return c.json({ error: 'range must be 7, 30, 90 or 365' }, 400);
      const limit = Math.min(50, Math.max(1, Math.floor(Number(c.req.query('limit'))) || 8));
      const storeIds = pickStores(db, c.req.query('stores'));
      const { to, shift } = dayShifts(db, storeIds);
      return c.json(topProducts(db, storeIds, addDays(to, 1 - range), to, limit, shift));
    })
    .route('/', researchRoutes(db))
    .route('/', competitorRoutes(db, (q) => pickStores(db, q)))
    .route('/', automationRoutes(db, (q) => pickStores(db, q)))
    .route('/', settingsRoutes(db))
    .route('/', agentRoutes(db))
    .route('/', kbRoutes(db))
    .route('/', ecosystemRoutes(db));
};

/**
 * HTTP + WebSocket server on 127.0.0.1 (port 0 = any free port). With `webDir` (the desktop app) it also serves the
 * built web UI, falling back to index.html for client-side routes.
 */
export const startServer = (db: Db, port: number, onListen?: (port: number) => void, webDir?: string) => {
  const app = createApp(db);
  if (webDir) {
    const index = serveStatic({ root: webDir, path: 'index.html' });
    app.use('*', serveStatic({ root: webDir })).get('*', (c, next) => (c.req.path.startsWith('/api/') ? next() : index(c, next)));
  }
  return serve({ fetch: app.fetch, port, hostname: '127.0.0.1', websocket: { server: new WebSocketServer({ noServer: true }) } }, (info) => (listeningOn(info.port), onListen?.(info.port)));
};
