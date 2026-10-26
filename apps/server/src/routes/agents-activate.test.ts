import { DEFAULT_JOBS, listMemory, listRuns, updateMemory, writeMemory } from '@frontline/agents';
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

test('a store deleted and created again under the same name gets its jobs, and they switch on when it goes live', async () => {
  const create = async () =>
    (await (await app.request('/api/stores', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Acme', platform: 'shopify', niche: 'home' }) })).json()) as Store;
  const first = await create();
  switchToReal(db, first.id);
  await app.request('/api/agents');
  expect(jobsOn(first.id)).toBe(DEFAULT_JOBS.length);
  await runManager(db).idle();
  expect((await app.request(`/api/stores/${first.id}`, { method: 'DELETE' })).status).toBe(204);

  const again = await create();
  expect(again.id).toBe(first.id);
  const jobs = db.prepare('SELECT name FROM automation_rules WHERE store_id = ?').all(again.id).map((r) => r.name);
  expect(jobs.sort()).toEqual(DEFAULT_JOBS.map((j) => j.name).sort());
  switchToReal(db, again.id);
  await app.request('/api/agents');
  expect(jobsOn(again.id)).toBe(DEFAULT_JOBS.length);
  await runManager(db).idle();
});

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
  expect(jobsOn(store.id)).toBe(DEFAULT_JOBS.length);
  expect(notes(store.id)).toEqual(["Ink & Nib is live: the squad's scheduled jobs are on"]);
  const runs = listRuns(db, { storeIds: [store.id] });
  expect(runs.map((r) => [r.agentId, r.task.split('\n')[0]])).toEqual([
    [`${store.id}:market_analyst`, `Draft a niche pack for "Vintage fountain pens" so the whole squad of Ink & Nib works like seasoned operators of this niche.`],
  ]);
  await runManager(db).idle();

  expect(jobsOn('glow')).toBe(0); // demo stores stay off
});

test("going live clears what the agents learned from simulated numbers, not the owner's notes, pins or preferences", async () => {
  await app.request('/api/agents');
  const m = (agentId: string, kind: 'fact' | 'learning' | 'preference', text: string) => writeMemory(db, { storeId: 'glow', agentId, kind, text, confidence: 0.7 });
  m('glow:market_analyst', 'learning', 'LED masks outsell serums 3:1');
  m('glow:ad_strategist', 'fact', 'Broad TOF runs at 2.1 ROAS');
  m('glow:copywriter', 'preference', 'Owner wants no exclamation marks');
  m('owner', 'fact', 'We ship from Austin');
  updateMemory(db, m('glow:market_analyst', 'learning', 'Customers ask about sensitive skin').id, { pinned: true });
  switchToReal(db, 'glow');
  await app.request('/api/agents');
  expect(listMemory(db, 'glow').map((x) => x.text).sort()).toEqual(['Customers ask about sensitive skin', 'Owner wants no exclamation marks', 'We ship from Austin']);
  expect(notes('glow')).toContain('Glow Haus: the squad starts fresh on real numbers');
  await app.request('/api/agents'); // once: later learnings stay
  m('glow:market_analyst', 'learning', 'Real: mornings convert best');
  await app.request('/api/agents');
  expect(listMemory(db, 'glow')).toHaveLength(4);
  await runManager(db).idle();
});
