import { addNicheLearning, ADS_JOB, createMission, DEFAULT_JOBS, getMission, listFlowDrafts, listMemory, listNicheLearnings, listRuns, once, saveCreative, saveFlowDraft, saveNichePack, updateMemory, writeMemory } from '@frontline/agents';
import type { AgentRun, Store } from '@frontline/shared';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { decide } from '../approvals';
import { switchToReal } from '../connectors/common';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { runManager } from './agents';

let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  vi.stubEnv('FRONTLINE_DATA_DIR', mkdtempSync(join(tmpdir(), 'activate-'))); // no custom packs yet
  db = openDb();
  seedDemo(db);
  app = createApp(db);
});
afterEach(() => {
  vi.unstubAllEnvs();
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
  expect(again.id).not.toBe(first.id); // a deleted store's id is never reused (CORE-91)
  const jobs = db.prepare('SELECT name FROM automation_rules WHERE store_id = ?').all(again.id).map((r) => r.name);
  expect(jobs.sort()).toEqual(DEFAULT_JOBS.map((j) => j.name).sort());
  switchToReal(db, again.id);
  await app.request('/api/agents');
  expect(jobsOn(again.id)).toBe(DEFAULT_JOBS.length - 1);
  await runManager(db).idle();
});

test("the owner can ask a custom niche's Market Analyst for its pack again; not on the demo engine, nor while one waits or exists", async () => {
  const store = (await (
    await app.request('/api/stores', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ink & Nib', platform: 'shopify', niche: 'other', nicheDetail: 'Vintage fountain pens' }),
    })
  ).json()) as Store;
  const ask = (agentId = `${store.id}:market_analyst`) => app.request(`/api/agents/${encodeURIComponent(agentId)}/niche-pack`, { method: 'POST' });
  const error = async (agentId?: string) => ((await (await ask(agentId)).json()) as { error: string }).error;
  expect(await error()).toBe("On the demo engine the Market Analyst can't research a niche, and its pack would be made up. Connect the store first.");
  // What the agent says it runs on; the app's run manager was made with the demo engine and stays on it.
  vi.stubEnv('FRONTLINE_AGENT_ENGINE', 'claude');
  expect((await ask(`${store.id}:copywriter`)).status).toBe(404);
  expect(await error('glow:market_analyst')).toBe("Glow Haus's niche has a built-in pack; edit it in Knowledge.");
  const res = await ask();
  expect(res.status).toBe(201);
  expect(((await res.json()) as AgentRun).task.split('\n')[0]).toBe(
    'Draft a niche pack for "Vintage fountain pens" so the whole squad of Ink & Nib works like seasoned operators of this niche.',
  );
  await runManager(db).idle();
  db.prepare(
    `INSERT INTO approvals (id, store_id, agent_id, run_id, title, reason, action_json, status, created_at) VALUES ('np', ?, ?, NULL, 'Save the pack', 'r', ?, 'pending', ?)`,
  ).run(store.id, `${store.id}:market_analyst`, JSON.stringify({ kind: 'save_niche_pack', payload: { slug: 'vintage-fountain-pens', markdown: '# Pens' } }), new Date().toISOString());
  expect(await error()).toBe('A draft of the "Vintage fountain pens" pack is waiting for your approval in Requests.');
  saveNichePack('vintage-fountain-pens', '# Vintage fountain pens\n- Nibs: verify');
  expect(await error()).toBe('The "Vintage fountain pens" pack exists; edit it in Knowledge.');
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
    expect.stringMatching(/^Denied/), 'Stopped: the store went live during this', 'Stopped: the store went live during this',
  ]);
});

test("a live TikTok Shop store doesn't get the weekly page refresh: its drafts could never be published there", async () => {
  const res = await app.request('/api/stores', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Tok', platform: 'tiktok_shop', niche: 'home' }) });
  const store = (await res.json()) as Store;
  switchToReal(db, store.id);
  await app.request('/api/agents');
  const on = db.prepare('SELECT name FROM automation_rules WHERE store_id = ? AND enabled = 1').all(store.id).map((r) => r.name);
  expect(on).not.toContain('Weekly page refresh');
  expect(on).not.toContain('Monthly flow check'); // TikTok owns its buyers: no list to mail
  expect(on).toContain('Weekly price check'); // its findings still go to the owner, to apply by hand
  expect(db.prepare('SELECT enabled FROM automation_rules WHERE store_id = ? AND name = ?').get(store.id, 'Weekly page refresh')?.enabled).toBe(0); // still there to switch on
  await runManager(db).idle();
});

test('a store that went live before the job rules gets them once: jobs with nothing to do there switch off', async () => {
  const res = await app.request('/api/stores', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Tok', platform: 'tiktok_shop', niche: 'home' }) });
  const store = (await res.json()) as Store;
  switchToReal(db, store.id);
  once(db, `activate:${store.id}`); // went live on an older build: every job on, no gates
  db.prepare(`DELETE FROM done_once WHERE ref IN (?, ?)`).run(`job-gates-2:${store.id}`, `ads-job-wait:${store.id}`);
  db.prepare('UPDATE automation_rules SET enabled = 1 WHERE store_id = ?').run(store.id);
  await app.request('/api/agents');
  const on = () => db.prepare('SELECT name FROM automation_rules WHERE store_id = ? AND enabled = 1').all(store.id).map((r) => String(r.name));
  expect(on()).not.toContain('Weekly page refresh');
  expect(on()).not.toContain(ADS_JOB);
  expect(on()).toHaveLength(DEFAULT_JOBS.length - 3);
  expect(notes(store.id)).toEqual([`Tok: ${ADS_JOB.toLowerCase()}, weekly page refresh, and monthly flow check switched off`]);
  expect(String(db.prepare(`SELECT body FROM notifications WHERE store_id = ? AND title LIKE '%switched off'`).get(store.id)?.body)).toContain(
    "Weekly page refresh: the app can't publish tiktok_shop product pages. Monthly flow check: tiktok_shop doesn't let sellers email or text its buyers.",
  );
  // Once: the owner switches the page refresh back on and it stays on; campaigns bring the review back.
  db.prepare('UPDATE automation_rules SET enabled = 1 WHERE store_id = ? AND name = ?').run(store.id, 'Weekly page refresh');
  db.prepare(`INSERT INTO campaigns (network, id, store_id, name, status, daily_budget) VALUES ('tiktok', 't1', ?, 'Spark', 'active', 30)`).run(store.id);
  await app.request('/api/agents');
  expect(on()).toHaveLength(DEFAULT_JOBS.length - 1);
  await runManager(db).idle();
});

test('jobs the owner switched on in Automation before the store went live stay on through the gates', async () => {
  const res = await app.request('/api/stores', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Tok', platform: 'tiktok_shop', niche: 'home' }) });
  const store = (await res.json()) as Store;
  const rule = (name: string) => db.prepare('SELECT id, enabled FROM automation_rules WHERE store_id = ? AND name = ?').get(store.id, name)!;
  for (const name of [ADS_JOB, 'Weekly page refresh']) {
    const patch = await app.request(`/api/automations/${rule(name).id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }) });
    expect(patch.status).toBe(200);
  }
  switchToReal(db, store.id); // no campaigns, and the app can't publish TikTok Shop pages
  await app.request('/api/agents');
  expect([rule(ADS_JOB).enabled, rule('Weekly page refresh').enabled]).toEqual([1, 1]);
  expect(notes(store.id).filter((t) => String(t).includes('switched off'))).toEqual([]);
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
  expect(db.prepare(`SELECT link FROM notifications WHERE title = 'Not applied: "Add Ice roller"'`).get()?.link).toBe('/agents/glow:product_hunter');
  expect(db.prepare(`SELECT title FROM notifications WHERE store_id = 'glow' AND kind = 'error'`).all()).toEqual([]); // nothing tried on Shopify
  expect(db.prepare(`SELECT count(*) AS n FROM product_tests WHERE approval_id = 'ask2'`).get()?.n).toBe(0);
  expect(db.prepare(`SELECT status FROM approvals WHERE id = 'ask3'`).get()?.status).toBe('denied'); // the squad caught up: the rest expired
  await runManager(db).idle();
});

test("a chat from the demo phase isn't continued on the live store: its context holds the demo numbers", async () => {
  await app.request('/api/agents');
  const runs = runManager(db);
  const chat = runs.start('glow:market_analyst', 'How did we do last week?');
  if (typeof chat === 'string') throw new Error(chat);
  await runs.idle();
  switchToReal(db, 'glow');
  await app.request('/api/agents');
  expect(runs.start('glow:market_analyst', 'And this week?', chat.id)).toBe('That conversation ran on demo data, before the store went live: start a new one.');
  const fresh = runs.start('glow:market_analyst', 'How are we doing?');
  if (typeof fresh === 'string') throw new Error(fresh);
  await runs.idle();
  expect(typeof runs.start('glow:market_analyst', 'And this week?', fresh.id)).toBe('object'); // a live chat goes on
  await runs.idle();
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
  addNicheLearning(db, { niche: 'beauty', text: 'Bundles lift AOV ~25%', evidence: 'demo numbers', storeId: 'glow' });
  addNicheLearning(db, { niche: 'beauty', text: 'Ship in 3 days or lose the sale', storeId: 'pawsome' }); // another store's
  const flow = { agentId: 'glow:email_sms', name: 'Checkout abandonment', trigger: 'Checkout started, no order in 1h', messages: [{ delayHours: 1, channel: 'email' as const, subject: 'Your serum waits', body: 'Demo serum reminder' }], notes: '412 demo checkouts' };
  saveFlowDraft(db, { storeId: 'glow', ...flow });
  saveFlowDraft(db, { storeId: 'pawsome', ...flow }); // another store's
  const ad = { agentId: 'glow:creative_studio', kind: 'image' as const, aspect: '1:1' as const, headline: 'Glow in 10 minutes', primaryText: 'The demo LED mask', credits: 2, mediaUrl: 'data:,x' };
  saveCreative(db, { storeId: 'glow', ...ad, source: 'demo' });
  saveCreative(db, { storeId: 'glow', ...ad, kind: 'copy', credits: 0, source: 'agent' });
  saveCreative(db, { storeId: 'glow', ...ad, headline: 'Paid for', mediaUrl: 'https://cdn.example/a.png', source: 'higgsfield' }); // credits spent: kept
  const mission = createMission(db, { storeId: 'glow', title: 'Launch a new product', steps: [{ id: 'hunt', role: 'product_hunter', task: 'Find the next product to launch.', dependsOn: [] }] });
  switchToReal(db, 'glow');
  await app.request('/api/agents');
  expect(listMemory(db, 'glow').map((x) => x.text).sort()).toEqual(['Customers ask about sensitive skin', 'Owner wants no exclamation marks', 'We ship from Austin']);
  expect(notes('glow')).toContain('Glow Haus: the squad starts fresh on real numbers');
  expect(db.prepare(`SELECT body FROM notifications WHERE title = 'Glow Haus: the squad starts fresh on real numbers'`).get()?.body).toBe(
    'Cleared what came from the demo data: 2 learnings, 1 niche learning, 1 request, 1 order issue, 1 flow draft, 2 creatives, 1 running mission. Your own notes, pins and preferences stay.',
  );
  expect(db.prepare(`SELECT headline FROM creatives WHERE store_id = 'glow'`).all().map((r) => r.headline)).toEqual(['Paid for']);
  expect(listNicheLearnings(db).map((l) => l.text)).toEqual(['Ship in 3 days or lose the sale']);
  expect(listFlowDrafts(db).map((f) => f.storeId)).toEqual(['pawsome']);
  expect(getMission(db, mission.id)?.status).toBe('cancelled');
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
