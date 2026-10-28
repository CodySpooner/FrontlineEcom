import { Hono } from 'hono';
import type { Db } from '../db';
import { productVisible } from './catalog';
import { scopeOf } from './scope';
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
    });
}
