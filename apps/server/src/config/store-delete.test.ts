import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_JOBS } from '@frontline/agents';
import { AGENT_ROLES, type StoreDeleteImpact } from '@frontline/shared';
import { expect, test } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';

// Settings → Stores → Delete this store (ST-19).
const setup = () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  return { db, app: createApp(db) };
};
type App = ReturnType<typeof createApp>;
const del = (app: App, id: string, confirm?: string) => app.request(`/api/stores/${id}${confirm === undefined ? '' : `?confirm=${encodeURIComponent(confirm)}`}`, { method: 'DELETE' });
const at = '2026-10-28T00:00:00Z';
const count = (db: Db, table: string, storeId: string, where = '') => Number(db.prepare(`SELECT count(*) AS n FROM ${table} WHERE store_id = ?${where}`).get(storeId)!.n);
const REMOVED = ['agents', 'agent_runs', 'automation_rules', 'integrations', 'approvals', 'kb_cards', 'store_memory', 'pr_watches', 'orders'];

/** A known amount of each kind of row on `storeId`. */
function seed(db: Db, storeId: string) {
  for (const t of ['approvals', 'kb_cards', 'store_memory', 'pr_watches']) db.prepare(`DELETE FROM ${t} WHERE store_id = ?`).run(storeId);
  const agent = `${storeId}:market_analyst`;
  const run = db.prepare('INSERT INTO agent_runs (id, store_id, agent_id, task, status, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  for (const status of ['running', 'queued', 'queued', 'done']) run.run(randomUUID(), storeId, agent, 'T', status, at);
  for (const kind of ['shopify', 'meta_ads']) db.prepare("INSERT INTO integrations (id, kind, store_id, encrypted_credentials, updated_at) VALUES (?, ?, ?, 'x', ?)").run(`${kind}:${storeId}`, kind, storeId, at);
  for (const status of ['pending', 'pending', 'approved']) db.prepare("INSERT INTO approvals (id, store_id, agent_id, title, reason, action_json, status, created_at) VALUES (?, ?, ?, 'T', 'R', '{}', ?, ?)").run(randomUUID(), storeId, agent, status, at);
  db.prepare("INSERT OR IGNORE INTO kb_categories (id, name, created_at) VALUES ('st19-cat', 'Test', ?)").run(at);
  for (let i = 0; i < 3; i++) db.prepare("INSERT INTO kb_cards (id, store_id, category_id, type, title, author_id, origin, created_at, updated_at) VALUES (?, ?, 'st19-cat', 'insight', ?, 'owner', 'manual', ?, ?)").run(randomUUID(), storeId, `C ${i}`, at, at);
  for (let i = 0; i < 2; i++) db.prepare("INSERT INTO store_memory (store_id, agent_id, kind, text, created_at) VALUES (?, ?, 'fact', 'M', ?)").run(storeId, agent, at);
  for (let i = 0; i < 2; i++) db.prepare("INSERT INTO pr_watches (id, store_id, target_kind, target_id, created_at) VALUES (?, ?, 'product', ?, ?)").run(randomUUID(), storeId, randomUUID(), at);
  for (let i = 0; i < 4; i++) db.prepare("INSERT INTO action_log (store_id, action, target, detail_json, at) VALUES (?, 'test', 'x', '{}', ?)").run(storeId, at);
  db.prepare("INSERT INTO niche_learnings (niche, text, store_id, created_at) VALUES ('fitness', ?, ?, ?)").run(`L ${storeId}`, storeId, at);
}

test('the impact counts are right, and the save removes exactly those rows while the kept ones stay', async () => {
  const { db, app } = setup();
  seed(db, 'peak');
  seed(db, 'glow');
  await app.request('/api/stores/peak', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version: 1, name: 'Peak Fit Co' }) }); // a change row
  const folder = join(process.env.FRONTLINE_CODEX_WORK!, 'peak');
  mkdirSync(folder, { recursive: true });
  const orders = count(db, 'orders', 'peak');
  const changes = count(db, 'settings_changes', 'peak');
  const research = 2 + count(db, 'pr_store_profiles', 'peak');
  expect(orders * changes).toBeGreaterThan(0);

  const impact = (await (await app.request('/api/stores/peak/impact')).json()) as StoreDeleteImpact;
  expect(impact).toEqual({
    removes: [
      { count: Object.keys(AGENT_ROLES).length, text: `${Object.keys(AGENT_ROLES).length} agents` },
      { count: 1, text: '1 running run' },
      { count: 2, text: '2 queued runs' },
      { count: DEFAULT_JOBS.length, text: `${DEFAULT_JOBS.length} scheduled jobs and automation rules` },
      { count: 2, text: '2 connections' },
      { count: 2, text: '2 requests waiting for approval' },
      { count: 3, text: '3 knowledge cards' },
      { count: 2, text: '2 store memory entries' },
      { count: research, text: `${research} Product Research rows` },
      { count: orders, text: `${orders} orders` },
    ],
    keeps: [
      { count: 4, text: '4 action log entries' },
      { count: 1, text: '1 niche learning, no longer linked to the store' },
      { count: changes, text: `${changes} change history ${changes === 1 ? 'entry' : 'entries'}` },
    ],
    codexFolder: folder,
  });
  const glow = REMOVED.map((t) => count(db, t, 'glow'));

  expect((await del(app, 'peak', 'Peak Fit Co')).status).toBe(204);
  expect(REMOVED.map((t) => count(db, t, 'peak'))).toEqual(REMOVED.map(() => 0));
  expect([count(db, 'action_log', 'peak'), count(db, 'settings_changes', 'peak')]).toEqual([4, changes]);
  expect(db.prepare("SELECT count(*) AS n FROM niche_learnings WHERE store_id IS NULL AND text = 'L peak'").get()!.n).toBe(1);
  expect(existsSync(folder)).toBe(true);
  expect(REMOVED.map((t) => count(db, t, 'glow'))).toEqual(glow); // another store's rows are untouched
  expect((await app.request('/api/stores/peak/impact')).status).toBe(404);
});

test("a mismatched name gets 400 and deletes nothing; the store's exact name deletes it", async () => {
  const { db, app } = setup();
  for (const confirm of [undefined, '', 'peak fit', 'Peak', 'peak']) {
    const res = await del(app, 'peak', confirm);
    expect([res.status, await res.json()]).toEqual([400, { error: "Type the store's name, Peak Fit, to delete it.", field: 'confirm' }]);
  }
  expect(count(db, 'agents', 'peak')).toBeGreaterThan(0);
  expect((await del(app, 'peak', 'Peak Fit')).status).toBe(204);
  // A store Codex never ran for has no work folder to mention.
  await app.request('/api/stores', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'No Codex Yet', platform: 'etsy', niche: 'home' }) });
  expect(await (await app.request('/api/stores/no-codex-yet/impact')).json()).not.toHaveProperty('codexFolder');
  expect((await del(app, 'peak', 'Peak Fit')).status).toBe(404);
});

test("the leftover settings rows and read state of its connections go; other stores' stay", async () => {
  const { db, app } = setup();
  const put = (key: string, value: unknown) => db.prepare('INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json').run(key, JSON.stringify(value));
  const read = (key: string) => JSON.parse(String(db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key)?.value_json ?? 'null')) as unknown;
  put('shop:shopify:peak', { shop: 'peak-fit.myshopify.com' }); // kept by a disconnect for the next connect
  put('shop:shopify:glow', { shop: 'glow.myshopify.com' });
  put('ad_timezones', { 'meta_ads:peak': 'Europe/Paris', 'meta_ads:glow': 'America/Denver' });
  put('catalog_pass', { 'shopify:peak': '2026-10-28', 'shopify:glow': '2026-10-28' });
  put('amazon_orders', { 'amazon:peak': { after: 'x' } });
  put('competitor_watch', { 'peak-fit': 1 }); // not a connection id
  const workspace = read('workspace');

  expect((await del(app, 'peak', 'Peak Fit')).status).toBe(204);
  expect(read('shop:shopify:peak')).toBeNull();
  expect(read('shop:shopify:glow')).toEqual({ shop: 'glow.myshopify.com' });
  expect(read('ad_timezones')).toEqual({ 'meta_ads:glow': 'America/Denver' });
  expect(read('catalog_pass')).toEqual({ 'shopify:glow': '2026-10-28' });
  expect(read('amazon_orders')).toEqual({});
  expect(read('competitor_watch')).toEqual({ 'peak-fit': 1 });
  expect(read('workspace')).toEqual(workspace);
});
