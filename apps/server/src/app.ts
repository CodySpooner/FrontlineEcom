import { Hono } from 'hono';
import { DEMO_STORES } from './demo';

export const app = new Hono()
  .get('/api/health', (c) => c.json({ ok: true }))
  .get('/api/stores', (c) => c.json(DEMO_STORES));
