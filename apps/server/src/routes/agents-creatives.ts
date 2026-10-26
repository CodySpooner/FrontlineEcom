import { deleteCreative, listCreatives } from '@frontline/agents';
import type { CreativeKind } from '@frontline/shared';
import { Hono } from 'hono';
import type { Db } from '../db';

const KINDS: CreativeKind[] = ['image', 'video', 'ugc', 'copy'];

export function creativeRoutes(db: Db) {
  return new Hono()
    .get('/api/creatives', (c) => {
      const kind = c.req.query('kind') as CreativeKind | undefined;
      if (kind && !KINDS.includes(kind)) return c.json({ error: `kind must be one of ${KINDS.join(', ')}` }, 400);
      const limit = Math.min(200, Math.max(1, Math.floor(Number(c.req.query('limit'))) || 100));
      return c.json(listCreatives(db, { storeIds: c.req.query('stores')?.split(',').filter(Boolean), kind, limit }));
    })
    .delete('/api/creatives/:id', (c) => (deleteCreative(db, c.req.param('id')) ? c.body(null, 204) : c.json({ error: 'Creative not found' }, 404)));
}
