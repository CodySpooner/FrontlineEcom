// GET /api/config?store= and PATCH /api/config (ST-07): the effective configuration and its versioned writer; Change
// History and its retries (ST-09).
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { ConfigDoc, ConfigWrite } from '@frontline/shared';
import type { Db } from '../db';
import { getStore } from '../stores';
import { applyRoutes } from './apply';
import { changeRoutes, toChange } from './changes';
import { effective } from './effective';
import { ConfigError, versionOf, writeConfig } from './write';

const DOCS: ConfigDoc[] = ['app', 'personal', 'workspace', 'store_caps'];

export function configRoutes(db: Db) {
  return new Hono()
    .route('/', changeRoutes(db))
    .route('/', applyRoutes(db))
    .get('/api/config', (c) => {
      const storeId = c.req.query('store') || undefined;
      if (storeId && !getStore(db, storeId)) return c.json({ error: 'store not found' }, 404);
      return c.json(effective(db, { storeId }));
    })
    .patch('/api/config', async (c) => {
      const body = (await c.req.json().catch(() => undefined)) as Partial<ConfigWrite> | undefined;
      const docs = body?.documents;
      if (!Array.isArray(docs) || !docs.length) return c.json({ error: 'documents must be a list of { doc, storeId?, version, set?, unset? }' }, 400);
      for (const d of docs) {
        if (!d || !DOCS.includes(d.doc)) return c.json({ error: `doc must be one of ${DOCS.join(', ')}` }, 400);
        if ((d.doc === 'store_caps') !== (typeof d.storeId === 'string')) return c.json({ error: 'storeId goes with store_caps, and only with it' }, 400);
        if (d.set !== undefined && (!d.set || typeof d.set !== 'object' || Array.isArray(d.set))) return c.json({ error: 'set must be an object of setting → value' }, 400);
        if (d.unset !== undefined && (!Array.isArray(d.unset) || !d.unset.every((k) => typeof k === 'string'))) return c.json({ error: 'unset must be a list of setting ids' }, 400);
        if (versionOf(d) === undefined) return c.json({ error: 'Send the version you read with each document (version).' }, 428);
      }
      const requestId = randomUUID();
      try {
        writeConfig(db, docs, { requestId, current: (w) => effective(db, { storeId: w.storeId }) });
      } catch (e) {
        if (e instanceof ConfigError) return c.json(e.body, e.status);
        throw e;
      }
      const changes = db.prepare('SELECT * FROM settings_changes WHERE request_id = ? ORDER BY rowid').all(requestId).map(toChange);
      return c.json({ ...effective(db, { storeId: docs.find((d) => d.storeId)?.storeId }), changes });
    });
}
