import { listRuns } from '@frontline/agents';
import type { Store } from '@frontline/shared';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { switchToReal } from '../connectors/common';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { runManager } from './agents';

let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  process.env.FRONTLINE_DATA_DIR = mkdtempSync(join(tmpdir(), 'activate-')); // no custom packs yet
  db = openDb();
  seedDemo(db);
  app = createApp(db);
});
afterEach(() => {
  delete process.env.FRONTLINE_DATA_DIR;
});
const jobsOn = (storeId: string) => Number(db.prepare('SELECT count(*) AS n FROM automation_rules WHERE store_id = ? AND enabled = 1').get(storeId)?.n);
const notes = (storeId: string) => db.prepare(`SELECT title FROM notifications WHERE store_id = ? AND kind = 'info'`).all(storeId).map((r) => r.title);

test("a store's first real sync switches its squad's jobs on once, and a custom niche gets its pack drafted", async () => {
  const res = await app.request('/api/stores', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Ink & Nib', platform: 'shopify', niche: 'other', nicheDetail: 'Vintage fountain pens' }),
  });
  const store = (await res.json()) as Store;
  await app.request('/api/agents');
  expect(jobsOn(store.id)).toBe(0); // demo data until it syncs

  switchToReal(db, store.id);
  await app.request('/api/agents');
  await app.request('/api/agents');
  expect(jobsOn(store.id)).toBe(5);
  expect(notes(store.id)).toEqual(["Ink & Nib is live: the squad's scheduled jobs are on"]);
  const runs = listRuns(db, { storeIds: [store.id] });
  expect(runs.map((r) => [r.agentId, r.task.split('\n')[0]])).toEqual([
    [`${store.id}:market_analyst`, `Draft a niche pack for "Vintage fountain pens" so the whole squad of Ink & Nib works like seasoned operators of this niche.`],
  ]);
  await runManager(db).idle();

  expect(jobsOn('glow')).toBe(0); // demo stores stay off
});
