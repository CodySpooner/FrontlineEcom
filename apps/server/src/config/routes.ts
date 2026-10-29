// GET /api/config?store= and PATCH /api/config (ST-07): the effective configuration and its versioned writer; Change
// History and its retries (ST-09); POST /api/config/impact, what a save would touch (ST-10); the setup checklist (ST-17).
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { ConfigDoc, ConfigWrite } from '@frontline/shared';
import type { Db } from '../db';
import { claudeLogin } from '../routes/agents-runtimes';
import { getStore } from '../stores';
import { applyRoutes } from './apply';
import { changeRoutes, toChange } from './changes';
import { checklist } from './checklist';
import { effective } from './effective';
import { impactOf } from './impact';
import { ConfigError, currencies, versionOf, writeConfig } from './write';

const DOCS: ConfigDoc[] = ['app', 'personal', 'workspace', 'store_caps'];

/** The body's documents, or why not: 400 for a malformed one, 428 for one without its version (a write needs it). */
function documentsOf(body: Partial<ConfigWrite> | undefined, write: boolean): ConfigWrite['documents'] | { error: string; status: 400 | 428 } {
  const docs = body?.documents;
  if (!Array.isArray(docs) || !docs.length) return { error: 'documents must be a list of { doc, storeId?, version, set?, unset? }', status: 400 };
  for (const d of docs) {
    if (!d || !DOCS.includes(d.doc)) return { error: `doc must be one of ${DOCS.join(', ')}`, status: 400 };
    if ((d.doc === 'store_caps') !== (typeof d.storeId === 'string')) return { error: 'storeId goes with store_caps, and only with it', status: 400 };
    if (d.set !== undefined && (!d.set || typeof d.set !== 'object' || Array.isArray(d.set))) return { error: 'set must be an object of setting → value', status: 400 };
    if (d.unset !== undefined && (!Array.isArray(d.unset) || !d.unset.every((k) => typeof k === 'string'))) return { error: 'unset must be a list of setting ids', status: 400 };
    if (write && versionOf(d) === undefined) return { error: 'Send the version you read with each document (version).', status: 428 };
  }
  return docs;
}

export function configRoutes(db: Db) {
  return new Hono()
    .route('/', changeRoutes(db))
    .route('/', applyRoutes(db))
    .get('/api/config', (c) => {
      const storeId = c.req.query('store') || undefined;
      if (storeId && !getStore(db, storeId)) return c.json({ error: 'store not found' }, 404);
      return c.json(effective(db, { storeId }));
    })
    // Settings → General's currency picker (ST-16): the codes PATCH accepts for baseCurrency.
    .get('/api/config/currencies', (c) => c.json(currencies(db)))
    .get('/api/config/checklist', async (c) => c.json(checklist(db, await claudeLogin())))
    .post('/api/config/impact', async (c) => {
      const docs = documentsOf(await c.req.json().catch(() => undefined), false);
      if (!Array.isArray(docs)) return c.json({ error: docs.error }, docs.status);
      if (docs.some((d) => d.storeId && !getStore(db, d.storeId))) return c.json({ error: 'store not found' }, 404);
      return c.json({ impacts: impactOf(db, docs) });
    })
    .patch('/api/config', async (c) => {
      const docs = documentsOf(await c.req.json().catch(() => undefined), true);
      if (!Array.isArray(docs)) return c.json({ error: docs.error }, docs.status);
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
