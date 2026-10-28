import { deleteFlowDraft, listFlowDrafts } from '@frontline/agents';
import { Hono } from 'hono';
import type { Db } from '../db';
import { wrongStore } from './agents-scope';

/** The Email & SMS agent's flow library. */
export function flowRoutes(db: Db) {
  return new Hono()
    .get('/api/flow-drafts', (c) => {
      const limit = Math.min(200, Math.max(1, Math.floor(Number(c.req.query('limit'))) || 50));
      return c.json(listFlowDrafts(db, { storeIds: c.req.query('stores')?.split(',').filter(Boolean), limit }));
    })
    .delete('/api/flow-drafts/:id', (c) => (!wrongStore(c, db, 'flow_drafts', c.req.param('id')) && deleteFlowDraft(db, c.req.param('id')) ? c.body(null, 204) : c.json({ error: 'Flow not found' }, 404)));
}
