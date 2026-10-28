import { Hono } from 'hono';
import type { Db } from '../db';
import { log } from '../log';
import { productVisible } from './catalog';
import { assign, productDemand, productDetail, productHistory, productOffers } from './detail';
import { discover, parseDiscovery } from './discovery';
import { changeStage, dismissFlag, saveNotes, watchProduct } from './edits';
import { evaluateStore, refreshProduct } from './evaluate';
import { addNote, linkStoreProduct, NOTE_PLATFORMS } from './evidence';
import { importFeed } from './feed';
import { runDue, stoppedReason, syncNow } from './jobs';
import { cachedImage, listingImageRef, queueImage } from './images';
import { getProfile, saveProfile } from './profile';
import { scopeOf, storeOf } from './scope';
import { ADAPTERS, sourceHealth, sourceStates } from './sources';
import { importTrends, linkSet, signalSet } from './trends';

/** Product Research's API (`/api/pr/*`, behind the KB guard: change and body limits). `?store=` sets the scope. */
export function prRoutes(db: Db, key: () => Buffer) {
  return new Hono()
    .get('/api/pr/sources', (c) => {
      const s = scopeOf(c, db);
      return s instanceof Response ? s : c.json(sourceStates(db, key(), s.store?.id ?? null));
    })
    .get('/api/pr/source-health', (c) => {
      const s = scopeOf(c, db);
      return s instanceof Response ? s : c.json(sourceHealth(db, key(), s.store?.id ?? null));
    })
    // Sync now: queues today's planned queries and runs them in the background, one job at a time, then enriches.
    .post('/api/pr/sources/:id/sync', (c) => {
      const a = ADAPTERS.find((x) => x.id === c.req.param('id'));
      if (!a) return c.json({ error: 'unknown source' }, 404);
      const r = syncNow(db, a, key());
      if ('error' in r) return c.json(r, 409);
      void (async () => {
        const deps = { key: key(), onStored: (ids: string[]) => new Set(ids).forEach((id) => refreshProduct(db, id)) };
        for (let i = 0; i < r.jobs; i++) await runDue(db, [a], deps);
        if (a.enrich && !stoppedReason(db, a)) await a.enrich(db, key());
      })().catch((e) => log('error', 'product research sync failed', { source: a.id, error: e instanceof Error ? e.message : String(e) }));
      return c.json(r, 202);
    })
    // Discovery (decision 14): the scope's full matching set filtered, sorted and counted in SQL, a page at a time.
    .get('/api/pr/products', (c) => {
      const s = scopeOf(c, db);
      if (s instanceof Response) return s;
      const q = parseDiscovery(c.req.queries(), s.store);
      if ('error' in q) return c.json(q, 400);
      const r = discover(db, { ...q, store: s.store });
      return 'error' in r ? c.json(r, 400) : c.json(r);
    })
    // Decision 12: only the cache for the listing's stored image_ref, never a URL from the client. A miss is a 404 (the
    // card shows its icon) and queues one fetch.
    // The detail panel (PR-12): the header and Overview, then each tab on its own.
    .get('/api/pr/products/:id', (c) => {
      const s = scopeOf(c, db);
      if (s instanceof Response) return s;
      const ship = c.req.query('shipTo')?.toUpperCase();
      if (ship !== undefined && !/^[A-Z]{2}$/.test(ship)) return c.json({ error: 'shipTo must be a two-letter country code' }, 400);
      const d = productDetail(db, c.req.param('id'), s.store, ship);
      return !d ? c.json({ error: 'product not found' }, 404) : 'error' in d ? c.json(d, 400) : c.json(d);
    })
    .get('/api/pr/products/:id/:tab{demand|offers|history}', (c) => {
      const s = scopeOf(c, db);
      if (s instanceof Response) return s;
      const id = c.req.param('id');
      const store = s.store?.id ?? null;
      if (!productVisible(db, id, store)) return c.json({ error: 'product not found' }, 404);
      const tab = c.req.param('tab');
      return c.json(tab === 'demand' ? productDemand(db, id, store) : tab === 'offers' ? productOffers(db, id, store) : productHistory(db, id, store));
    })
    .post('/api/pr/products/:id/assign', async (c) => {
      const body = (await c.req.json().catch(() => undefined)) as { storeId?: unknown } | undefined;
      if (typeof body?.storeId !== 'string') return c.json({ error: 'storeId must be one of your stores' }, 400);
      const err = assign(db, c.req.param('id'), body.storeId);
      return err ? c.json({ error: err.error }, err.status) : c.json({ ok: true }, 201);
    })
    .get('/api/pr/listings/:id/image', (c) => {
      const s = scopeOf(c, db);
      if (s instanceof Response) return s;
      const ref = listingImageRef(db, c.req.param('id'), s.store?.id ?? null);
      if (ref === undefined) return c.json({ error: 'listing not found' }, 404);
      const hit = ref ? cachedImage(ref) : null;
      if (!hit) {
        if (ref) queueImage(ref);
        return c.json({ error: 'no cached image' }, 404);
      }
      return c.body(new Uint8Array(hit.bytes), 200, { 'content-type': hit.type, 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'", 'cache-control': 'private, max-age=86400' });
    })
    .get('/api/pr/profile', (c) => {
      const store = storeOf(c, db);
      return store instanceof Response ? store : c.json(getProfile(db, store));
    })
    // Saving re-evaluates every product the store may see (re-ranked first when the ship-to moved), so fit is current.
    .put('/api/pr/profile', async (c) => {
      const store = storeOf(c, db);
      if (store instanceof Response) return store;
      const body = (await c.req.json().catch(() => undefined)) as Record<string, unknown> | undefined;
      if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ error: 'body must be a JSON object of profile fields' }, 400);
      const before = getProfile(db, store).shipTo;
      const p = saveProfile(db, store, body);
      if ('error' in p) return c.json(p, 400);
      evaluateStore(db, store, { rerank: p.shipTo !== before });
      return c.json(p);
    })
    .post('/api/pr/imports/trends', async (c) => {
      const s = scopeOf(c, db);
      if (s instanceof Response) return s;
      const store = s.store?.id ?? null;
      const body = (await c.req.json().catch(() => undefined)) as { name?: unknown; csv?: unknown; productId?: unknown } | undefined;
      if (typeof body?.csv !== 'string' || !body.csv.trim()) return c.json({ error: "csv must be the export's text" }, 400);
      if (body.csv.length > 2_000_000) return c.json({ error: 'A Trends export is a few kilobytes; this file is over 2 MB.' }, 400);
      const productId = typeof body.productId === 'string' ? body.productId : null;
      if (body.productId !== undefined && !(productId && productVisible(db, productId, store))) return c.json({ error: 'product not found' }, 404);
      const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 200) : 'multiTimeline.csv';
      const r = importTrends(db, { name, csv: body.csv, productId, store });
      return 'error' in r ? c.json(r, 400) : c.json(r, r.duplicate ? 200 : 201);
    })
    .post('/api/pr/signals/:id/links', async (c) => {
      const s = scopeOf(c, db);
      if (s instanceof Response) return s;
      const store = s.store?.id ?? null;
      const body = (await c.req.json().catch(() => undefined)) as { productId?: unknown; confirmed?: unknown } | undefined;
      if (typeof body?.productId !== 'string' || typeof body.confirmed !== 'boolean') return c.json({ error: 'body must be { productId, confirmed: true | false }' }, 400);
      if (!signalSet(db, c.req.param('id'), store)) return c.json({ error: 'signal set not found' }, 404);
      if (!productVisible(db, body.productId, store)) return c.json({ error: 'product not found' }, 404);
      const err = linkSet(db, c.req.param('id'), body.productId, body.confirmed);
      return err ? c.json({ error: err }, 400) : c.json(signalSet(db, c.req.param('id'), store));
    })
    .post('/api/pr/imports/feed', async (c) => {
      const body = (await c.req.json().catch(() => undefined)) as { supplier?: unknown; name?: unknown; csv?: unknown } | undefined;
      if (typeof body?.csv !== 'string' || !body.csv.trim()) return c.json({ error: "csv must be the feed's text" }, 400);
      if (typeof body.supplier !== 'string' || !body.supplier.trim()) return c.json({ error: 'Name the supplier the feed is from.' }, 400);
      if (body.csv.length > 10_000_000) return c.json({ error: 'The feed is over 10 MB: split it into smaller files.' }, 400);
      const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 200) : 'feed.csv';
      const r = importFeed(db, { supplier: body.supplier.trim().slice(0, 100), name, csv: body.csv });
      return 'error' in r ? c.json(r, 400) : c.json(r, r.duplicate ? 200 : 201);
    })
    .post('/api/pr/products/:id/notes', async (c) => {
      const store = storeOf(c, db);
      if (store instanceof Response) return store;
      if (!productVisible(db, c.req.param('id'), store.id)) return c.json({ error: 'product not found' }, 404);
      const body = (await c.req.json().catch(() => undefined)) as { platform?: unknown; url?: unknown; note?: unknown; observedAt?: unknown } | undefined;
      if (!NOTE_PLATFORMS.includes(body?.platform as (typeof NOTE_PLATFORMS)[number])) return c.json({ error: `platform must be one of ${NOTE_PLATFORMS.join(', ')}` }, 400);
      if (typeof body!.url !== 'string' || !/^https?:\/\/\S+$/i.test(body!.url) || body!.url.length > 2048) return c.json({ error: 'url must be the http(s) link you looked at' }, 400);
      if (typeof body!.note !== 'string' || !body!.note.trim() || body!.note.length > 4000) return c.json({ error: 'note must say what you saw (up to 4,000 characters)' }, 400);
      const observed = body!.observedAt === undefined ? new Date() : new Date(String(body!.observedAt));
      if (!Number.isFinite(observed.getTime()) || observed.getTime() > Date.now() + 86_400_000) return c.json({ error: 'observedAt must be the date you looked' }, 400);
      const id = addNote(db, store.id, c.req.param('id'), { platform: String(body!.platform), url: body!.url, note: body!.note.trim(), observedAt: observed.toISOString() });
      return c.json({ id }, 201);
    })
    .post('/api/pr/products/:id/stage', async (c) => {
      const store = storeOf(c, db);
      if (store instanceof Response) return store;
      if (!productVisible(db, c.req.param('id'), store.id)) return c.json({ error: 'product not found' }, 404);
      const body = (await c.req.json().catch(() => undefined)) as { stage?: unknown; reason?: unknown } | undefined;
      const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
      const err = changeStage(db, store, c.req.param('id'), String(body?.stage ?? ''), reason);
      return err ? c.json({ error: err.error }, err.status) : c.json({ ok: true });
    })
    .put('/api/pr/products/:id/store-notes', async (c) => {
      const store = storeOf(c, db);
      if (store instanceof Response) return store;
      if (!productVisible(db, c.req.param('id'), store.id)) return c.json({ error: 'product not found' }, 404);
      const body = (await c.req.json().catch(() => undefined)) as { notes?: unknown } | undefined;
      if (typeof body?.notes !== 'string' || body.notes.length > 4000) return c.json({ error: 'notes must be text (up to 4,000 characters)' }, 400);
      saveNotes(db, store, c.req.param('id'), body.notes.trim());
      return c.json({ ok: true });
    })
    .post('/api/pr/products/:id/flags/:flag/dismiss', async (c) => {
      const store = storeOf(c, db);
      if (store instanceof Response) return store;
      if (!productVisible(db, c.req.param('id'), store.id)) return c.json({ error: 'product not found' }, 404);
      const body = (await c.req.json().catch(() => undefined)) as { reason?: unknown } | undefined;
      const err = dismissFlag(db, store, c.req.param('id'), c.req.param('flag'), typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) : '');
      return err ? c.json({ error: err.error }, err.status) : c.json({ ok: true });
    })
    // The watch toggle: a store's list, or the owner's all-stores list (the only private write in All stores).
    .put('/api/pr/products/:id/watch', async (c) => {
      const s = scopeOf(c, db);
      if (s instanceof Response) return s;
      if (!productVisible(db, c.req.param('id'), s.store?.id ?? null)) return c.json({ error: 'product not found' }, 404);
      const body = (await c.req.json().catch(() => undefined)) as { on?: unknown } | undefined;
      if (typeof body?.on !== 'boolean') return c.json({ error: 'body must be { on: true | false }' }, 400);
      watchProduct(db, s.store, c.req.param('id'), body.on);
      return c.json({ watched: body.on });
    })
    .post('/api/pr/products/:id/store-products', async (c) => {
      const store = storeOf(c, db);
      if (store instanceof Response) return store;
      if (!productVisible(db, c.req.param('id'), store.id)) return c.json({ error: 'product not found' }, 404);
      const body = (await c.req.json().catch(() => undefined)) as { storeProductId?: unknown } | undefined;
      if (typeof body?.storeProductId !== 'string') return c.json({ error: 'storeProductId must be one of the store’s products' }, 400);
      const err = linkStoreProduct(db, store.id, c.req.param('id'), body.storeProductId);
      if (err) return c.json({ error: err }, 404);
      const set = db.prepare(`SELECT id FROM pr_signals WHERE store_id = ? AND product_id = ? AND platform = 'orders'`).get(store.id, c.req.param('id'));
      return c.json({ ordersSet: set ? signalSet(db, String(set.id), store.id) : null }, 201);
    });
}
