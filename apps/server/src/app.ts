import { Hono } from 'hono';
import type { Db } from './db';
import { listStores } from './stores';

export const createApp = (db: Db) =>
  new Hono()
    .get('/api/health', (c) => c.json({ ok: true }))
    .get('/api/stores', (c) => c.json(listStores(db)));
