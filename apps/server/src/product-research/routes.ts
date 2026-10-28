import { Hono } from 'hono';
import type { Db } from '../db';
import { productVisible } from './catalog';
import { addNote, linkStoreProduct, NOTE_PLATFORMS } from './evidence';
import { importFeed } from './feed';
import { scopeOf, storeOf } from './scope';
import { importTrends, linkSet, signalSet } from './trends';

/** Product Research's API (`/api/pr/*`, behind the KB guard: change and body limits). `?store=` sets the scope. */
export function prRoutes(db: Db) {
  return new Hono()
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
