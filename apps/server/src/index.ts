import { serve } from '@hono/node-server';
import { createApp } from './app';
import { dbFile, openDb } from './db';
import { seedDemo } from './demo';

const db = openDb(dbFile());
seedDemo(db);

const port = Number(process.env.API_PORT ?? 8787);
serve({ fetch: createApp(db).fetch, port, hostname: '127.0.0.1' }, () => console.log(`Frontline API on http://127.0.0.1:${port}`));
