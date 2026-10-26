import { ADS_JOB, DEFAULT_JOBS, listMemory, listRuns, once, updateMemory, writeMemory } from '@frontline/agents';
import type { Store } from '@frontline/shared';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { decide } from '../approvals';
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
  expect(jobsOn(first.id)).toBe(DEFAULT_JOBS.length - 1); // no campaigns yet: the campaign review waits
  await runManager(db).idle();
  expect((await app.request(`/api/stores/${first.id}`, { method: 'DELETE' })).status).toBe(204);

  const again = await create();
  expect(again.id).toBe(first.id);
  const jobs = db.prepare('SELECT name FROM automation_rules WHERE store_id = ?').all(again.id).map((r) => r.name);
  expect(jobs.sort()).toEqual(DEFAULT_JOBS.map((j) => j.name).sort());
  switchToReal(db, again.id);
  await app.request('/api/agents');
  expect(jobsOn(again.id)).toBe(DEFAULT_JOBS.length - 1);
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
  expect(jobsOn(store.id)).toBe(DEFAULT_JOBS.length - 1);
  expect(notes(store.id)).toEqual(["Ink & Nib is live: the squad's scheduled jobs are on"]);
  const runs = listRuns(db, { storeIds: [store.id] });
  expect(runs.map((r) => [r.agentId, r.task.split('\n')[0]])).toEqual([
    [`${store.id}:market_analyst`, `Draft a niche pack for "Vintage fountain pens" so the whole squad of Ink & Nib works like seasoned operators of this niche.`],
  ]);
  await runManager(db).idle();

  expect(jobsOn('glow')).toBe(0); // demo stores stay off

  // An old account's archived campaign, no spend in 30 days: nothing to review yet.
  db.prepare(`INSERT INTO campaigns (network, id, store_id, name, status, daily_budget) VALUES ('meta', 'c0', ?, 'BFCM 2023', 'archived', 0)`).run(store.id);
  await app.request('/api/agents');
  expect(jobsOn(store.id)).toBe(DEFAULT_JOBS.length - 1);
  // A running one syncs: the campaign review switches on, once; turned off by the owner, it stays off.
  db.prepare(`INSERT INTO campaigns (network, id, store_id, name, status, daily_budget) VALUES ('meta', 'c1', ?, 'Prospecting', 'active', 40)`).run(store.id);
  await app.request('/api/agents');
  expect(jobsOn(store.id)).toBe(DEFAULT_JOBS.length);
  expect(notes(store.id)).toContain(`Ink & Nib: the ${ADS_JOB.toLowerCase()} is on`);
  db.prepare('UPDATE automation_rules SET enabled = 0 WHERE store_id = ? AND name = ?').run(store.id, ADS_JOB);
  await app.request('/api/agents');
  expect(jobsOn(store.id)).toBe(DEFAULT_JOBS.length - 1);
});

test('a demo run still going when the store goes live asks nothing more: its numbers are gone', async () => {
  const m = runManager(db);
  const run = m.start('glow:creative_studio', 'Make 3 variations of our best ad with different hooks. Make a 1:1 image ad and save it to the creatives library. Brief: Keep the shot.');
  if (typeof run === 'string') throw new Error(run);
  const asked = () => db.prepare('SELECT id, status FROM approvals WHERE run_id = ?').all(run.id);
  for (let i = 0; i < 50 && !asked().length; i++) await new Promise((r) => setImmediate(r));
  expect(asked()).toHaveLength(1); // waiting on the first variation
  switchToReal(db, 'glow');
  await app.request('/api/agents'); // go-live expires it; the run moves on to the next two
  await m.idle();
  expect(asked().map((a) => a.status)).toEqual(['denied']);
  expect(m.get(run.id)!.transcript!.filter((e) => e.type === 'tool_result').map((e) => e.type === 'tool_result' && e.output.slice(0, 40)).slice(0, 3)).toEqual([
    expect.stringMatching(/^Denied/), 'Not sent: the store went live during thi', 'Not sent: the store went live during thi',
  ]);
});

test("a live TikTok Shop store doesn't get the weekly page refresh: its drafts could never be published there", async () => {
  const res = await app.request('/api/stores', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Tok', platform: 'tiktok_shop', niche: 'home' }) });
  const store = (await res.json()) as Store;
  switchToReal(db, store.id);
  await app.request('/api/agents');
  const on = db.prepare('SELECT name FROM automation_rules WHERE store_id = ? AND enabled = 1').all(store.id).map((r) => r.name);
  expect(on).not.toContain('Weekly page refresh');
  expect(on).toContain('Weekly price check'); // its findings still go to the owner, to apply by hand
  expect(db.prepare('SELECT enabled FROM automation_rules WHERE store_id = ? AND name = ?').get(store.id, 'Weekly page refresh')?.enabled).toBe(0); // still there to switch on
  await runManager(db).idle();
});

test('a store that went live before the job rules gets them once: jobs with nothing to do there switch off', async () => {
  const res = await app.request('/api/stores', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Tok', platform: 'tiktok_shop', niche: 'home' }) });
  const store = (await res.json()) as Store;
  switchToReal(db, store.id);
  once(db, `activate:${store.id}`); // went live on an older build: every job on, no gates
  db.prepare(`DELETE FROM done_once WHERE ref IN (?, ?)`).run(`job-gates:${store.id}`, `ads-job-wait:${store.id}`);
  db.prepare('UPDATE automation_rules SET enabled = 1 WHERE store_id = ?').run(store.id);
  await app.request('/api/agents');
  const on = () => db.prepare('SELECT name FROM automation_rules WHERE store_id = ? AND enabled = 1').all(store.id).map((r) => String(r.name));
  expect(on()).not.toContain('Weekly page refresh');
  expect(on()).not.toContain(ADS_JOB);
  expect(on()).toHaveLength(DEFAULT_JOBS.length - 2);
  expect(notes(store.id)).toEqual([`Tok: ${ADS_JOB.toLowerCase()} and weekly page refresh switched off`]);
  // Once: the owner switches the page refresh back on and it stays on; campaigns bring the review back.
  db.prepare('UPDATE automation_rules SET enabled = 1 WHERE store_id = ? AND name = ?').run(store.id, 'Weekly page refresh');
  db.prepare(`INSERT INTO campaigns (network, id, store_id, name, status, daily_budget) VALUES ('tiktok', 't1', ?, 'Spark', 'active', 30)`).run(store.id);
  await app.request('/api/agents');
  expect(on()).toHaveLength(DEFAULT_JOBS.length);
  await runManager(db).idle();
});

test("a demo request approved after the store's first sync, before the squad noticed, doesn't act on the live store", async () => {
  await app.request('/api/agents');
  const ask = db.prepare(`INSERT INTO approvals (id, store_id, agent_id, title, reason, action_json, status, created_at) VALUES (?, 'glow', 'glow:product_hunter', ?, 'AI score 90', ?, 'pending', ?)`);
  ask.run('ask2', 'Add Ice roller', '{"kind":"store.add_products","payload":{"products":[{"title":"Ice roller","price":19.9}]}}', new Date().toISOString());
  ask.run('ask3', 'Add Gua sha', '{"kind":"store.add_products","payload":{"products":[{"title":"Gua sha","price":24}]}}', new Date().toISOString());
  switchToReal(db, 'glow');
  decide(db, 'ask2', 'approve'); // the owner answers before any squad read
  await new Promise((r) => setTimeout(r, 20));
  expect(notes('glow')).toContain('Not applied: "Add Ice roller"');
  expect(db.prepare(`SELECT title FROM notifications WHERE store_id = 'glow' AND kind = 'error'`).all()).toEqual([]); // nothing tried on Shopify
  expect(db.prepare(`SELECT count(*) AS n FROM product_tests WHERE approval_id = 'ask2'`).get()?.n).toBe(0);
  expect(db.prepare(`SELECT status FROM approvals WHERE id = 'ask3'`).get()?.status).toBe('denied'); // the squad caught up: the rest expired
  await runManager(db).idle();
});

test("going live clears what the agents learned from simulated numbers, not the owner's notes, pins or preferences", async () => {
  await app.request('/api/agents');
  // Demo-phase leftovers: a request asked on simulated numbers, an issue on a demo order, a draft for a demo product.
  db.prepare(`INSERT INTO approvals (id, store_id, agent_id, title, reason, action_json, status, created_at) VALUES ('ask1', 'glow', 'glow:product_hunter', 'Add 2 products', 'AI score 88', '{"kind":"store.add_products","payload":{}}', 'pending', ?)`).run(new Date().toISOString());
  db.prepare(`INSERT INTO order_issues (id, store_id, order_id, agent_id, kind, severity, note, status, created_at) VALUES ('i1', 'glow', '#1001', 'glow:operations', 'late', 'high', 'Unfulfilled 9 days', 'open', ?)`).run(new Date().toISOString());
  db.prepare(`INSERT INTO page_drafts (id, store_id, agent_id, kind, product_id, title, html, notes, created_at) VALUES ('d1', 'glow', 'glow:store_developer', 'product', 'glow-p1', 'T', '<p>x</p>', 'n', ?), ('d2', 'glow', 'glow:store_developer', 'page', NULL, 'About us', '<p>x</p>', 'n', ?)`).run(new Date().toISOString(), new Date().toISOString());
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
  expect(db.prepare(`SELECT body FROM notifications WHERE title = 'Glow Haus: the squad starts fresh on real numbers'`).get()?.body).toBe(
    'Cleared what came from the demo data: 2 learnings, 1 request, 1 order issue. Your own notes, pins and preferences stay.',
  );
  expect(db.prepare(`SELECT status FROM approvals WHERE id = 'ask1'`).get()?.status).toBe('denied');
  expect(listMemory(db, 'glow').some((x) => x.tags.includes('denied'))).toBe(false); // expired, not the owner's no
  expect(db.prepare(`SELECT status FROM order_issues WHERE id = 'i1'`).get()?.status).toBe('resolved');
  expect(db.prepare(`SELECT id FROM page_drafts WHERE store_id = 'glow'`).all().map((r) => r.id)).toEqual(['d2']);
  await app.request('/api/agents'); // once: later learnings stay
  m('glow:market_analyst', 'learning', 'Real: mornings convert best');
  await app.request('/api/agents');
  expect(listMemory(db, 'glow')).toHaveLength(4);
  await runManager(db).idle();
});
