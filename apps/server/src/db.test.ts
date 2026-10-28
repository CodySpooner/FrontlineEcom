import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { listBackups } from './backups';
import { dataDir, MIGRATIONS, openDb } from './db';

test('migrations create the Phase 1 tables and set user_version', () => {
  const db = openDb();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name);
  expect(tables).toEqual(expect.arrayContaining(['stores', 'daily_metrics', 'products', 'orders', 'events', 'campaigns', 'campaign_daily', 'agents', 'approvals']));
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(MIGRATIONS.length);
});

test('reopening a file DB keeps data and does not rerun migrations', () => {
  const dir = mkdtempSync(join(tmpdir(), 'frontline-db-'));
  try {
    const file = join(dir, 'test.db');
    const a = openDb(file);
    a.prepare("INSERT INTO stores (id, name, platform, niche) VALUES ('x', 'X', 'shopify', 'pet')").run();
    a.close();
    const b = openDb(file);
    expect(b.prepare('SELECT count(*) AS n FROM stores').get()?.n).toBe(1);
    b.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deleting a store cascades to its rows', () => {
  const db = openDb();
  db.prepare("INSERT INTO stores (id, name, platform, niche) VALUES ('x', 'X', 'shopify', 'pet')").run();
  db.prepare("INSERT INTO daily_metrics (store_id, date, revenue) VALUES ('x', '2026-10-26', 10)").run();
  db.prepare("DELETE FROM stores WHERE id = 'x'").run();
  expect(db.prepare('SELECT count(*) AS n FROM daily_metrics').get()?.n).toBe(0);
});

test("a day's orders are found through the (store_id, local_date) index, not a scan of the store's orders", () => {
  const plan = openDb().prepare("EXPLAIN QUERY PLAN SELECT total FROM orders WHERE store_id = ? AND local_date = ? AND status = 'paid'").all('s', '2026-10-26');
  expect(plan.map((r) => String(r.detail)).join(' ')).toContain('orders_by_day');
});

test("a store's ad spend for a day starts from its campaigns, not a scan of every campaign's history", () => {
  const plan = openDb()
    .prepare('EXPLAIN QUERY PLAN SELECT coalesce(sum(d.spend), 0) FROM campaign_daily d JOIN campaigns c ON c.network = d.network AND c.id = d.campaign_id WHERE c.store_id = ? AND d.date = ?')
    .all('s', '2026-10-26')
    .map((r) => String(r.detail));
  expect(plan).toEqual([expect.stringContaining('campaigns_by_store'), expect.stringContaining('campaign_daily')]);
  expect(plan.join(' ')).not.toContain('SCAN');
});

test("before an update's migrations run on existing data, the data is copied into the backups (restorable from Settings)", () => {
  const dir = mkdtempSync(join(tmpdir(), 'frontline-db-'));
  try {
    const file = join(dir, 'frontline.db');
    openDb(file).close(); // a fresh database: nothing to keep
    expect(readdirSync(dir)).not.toContain('backups');
    rmSync(file);
    const old = new DatabaseSync(file); // data from the app's first version
    old.exec(MIGRATIONS[0]!);
    old.exec('PRAGMA user_version = 1');
    old.prepare("INSERT INTO stores (id, name, platform, niche) VALUES ('x', 'X', 'shopify', 'pet')").run();
    old.close();
    openDb(file).close();
    const [backup] = listBackups(join(dir, 'backups'));
    expect(backup?.name).toMatch(/^frontline-[\w-]+-before-update\.db$/);
    const snap = new DatabaseSync(join(dir, 'backups', backup!.name), { readOnly: true });
    expect(snap.prepare('PRAGMA user_version').get()?.user_version).toBe(1);
    expect(snap.prepare('SELECT count(*) AS n FROM stores').get()?.n).toBe(1);
    snap.close();
    openDb(file).close(); // up to date: no second copy
    expect(listBackups(join(dir, 'backups'))).toHaveLength(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a database from before gamification was removed loses the XP ledger and agent levels, and keeps its agents', () => {
  const dir = mkdtempSync(join(tmpdir(), 'frontline-db-'));
  try {
    const file = join(dir, 'frontline.db');
    const old = new DatabaseSync(file); // the last version with XP
    for (const sql of MIGRATIONS.slice(0, 48)) old.exec(sql);
    old.exec(`PRAGMA user_version = 48;
      INSERT INTO stores (id, name, platform, niche) VALUES ('x', 'X', 'shopify', 'pet');
      INSERT INTO agents (id, store_id, role, autonomy, level, xp) VALUES ('x:copywriter', 'x', 'copywriter', 'autopilot', 3, 420);
      INSERT INTO xp_events (id, ref, store_id, agent_id, amount, reason, created_at) VALUES ('e', 'run:1', 'x', 'x:copywriter', 10, 'Completed', '2026-10-26');
      INSERT INTO ecosystem_seats (agent_id, desk_id, display_name, appearance_json, updated_at) VALUES ('x:copywriter', 'research-1', 'Nova', '{}', '2026-10-26');`);
    old.close();
    const db = openDb(file);
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(MIGRATIONS.length);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'xp_events%'").all()).toEqual([]);
    expect({ ...db.prepare('SELECT * FROM agents').get() }).toEqual({ id: 'x:copywriter', store_id: 'x', role: 'copywriter', enabled: 1, autonomy: 'autopilot', settings_json: '{}' });
    expect(db.prepare('SELECT count(*) AS n FROM ecosystem_seats').get()?.n).toBe(1);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a database from before conversations keeps its runs and missions, and gains configs, conversations and their search', () => {
  const dir = mkdtempSync(join(tmpdir(), 'frontline-db-'));
  try {
    const file = join(dir, 'frontline.db');
    const old = new DatabaseSync(file); // the last version without conversations
    for (const sql of MIGRATIONS.slice(0, 49)) old.exec(sql);
    old.exec(`PRAGMA user_version = 49;
      INSERT INTO stores (id, name, platform, niche) VALUES ('x', 'X', 'shopify', 'pet');
      INSERT INTO agent_runs (id, store_id, agent_id, task, status, created_at) VALUES ('r1', 'x', 'x:copywriter', 'Write it', 'done', '2026-10-27');
      INSERT INTO squad_missions (id, store_id, title, steps_json, created_at) VALUES ('m1', 'x', 'Launch', '[]', '2026-10-27');`);
    old.close();
    const db = openDb(file);
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(MIGRATIONS.length);
    expect({ ...db.prepare('SELECT task, conversation_id, team_id, config_id, runtime FROM agent_runs').get() }).toEqual({ task: 'Write it', conversation_id: null, team_id: null, config_id: null, runtime: null });
    expect({ ...db.prepare('SELECT title, kind, conversation_id FROM squad_missions').get() }).toEqual({ title: 'Launch', kind: null, conversation_id: null });
    db.exec(`INSERT INTO agent_configs (id, store_id, agent_id, runtime, tools_json, knowledge_json, permissions_json, created_at) VALUES ('c1', 'x', 'x:copywriter', 'demo', '[]', '["store","general"]', '{"saveFindings":"off"}', '2026-10-28');
      INSERT INTO conversations (id, store_id, config_id, title, client_request_id, created_at, updated_at, last_activity_at) VALUES ('v1', 'x', 'c1', 'Spring copy', 'req-1', '2026-10-28', '2026-10-28', '2026-10-28');
      INSERT INTO agent_runs (id, store_id, agent_id, task, created_at, conversation_id, config_id, client_request_id) VALUES ('r2', 'x', 'x:copywriter', 'Draft the hero line', '2026-10-28', 'v1', 'c1', 'req-2');
      INSERT INTO conversations_fts (title, text, store_id, conversation_id) VALUES ('Spring copy', 'Draft the hero line', 'x', 'v1');`);
    expect(() => db.prepare("INSERT INTO conversations (id, store_id, config_id, title, client_request_id, created_at, updated_at, last_activity_at) VALUES ('v2', 'x', 'c1', 'Again', 'req-1', '', '', '')").run()).toThrow(/UNIQUE/);
    expect(() => db.prepare("INSERT INTO agent_runs (id, store_id, agent_id, task, created_at, conversation_id, client_request_id) VALUES ('r3', 'x', 'x:copywriter', 'Again', '', 'v1', 'req-2')").run()).toThrow(/UNIQUE/);
    expect(db.prepare("SELECT conversation_id FROM conversations_fts WHERE conversations_fts MATCH 'hero' AND store_id = 'x'").all().map((r) => r.conversation_id)).toEqual(['v1']);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.exec("DELETE FROM stores WHERE id = 'x'"); // the only way a config or conversation goes
    expect(['agent_configs', 'conversations', 'agent_runs', 'squad_missions'].map((t) => db.prepare(`SELECT count(*) AS n FROM ${t}`).get()?.n)).toEqual([0, 0, 0, 0]);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a database from before Product Research keeps its lists and finds, and gains the pr_ tables with their keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'frontline-db-'));
  try {
    const file = join(dir, 'frontline.db');
    const old = new DatabaseSync(file); // the last version without pr_ tables
    for (const sql of MIGRATIONS.slice(0, 50)) old.exec(sql);
    old.exec(`PRAGMA user_version = 50;
      INSERT INTO stores (id, name, platform, niche) VALUES ('x', 'X', 'shopify', 'pet'), ('y', 'Y', 'shopify', 'pet');
      INSERT INTO research_products (id, title, category, niche, source, cost, price, compare_at, trend, competition, shipping_days) VALUES ('find-1', 'Paw cup', 'Grooming', 'pet', 'tiktok', 3, 12, 0, 40, 30, 9);
      INSERT INTO product_lists (id, name, created_at) VALUES ('l1', 'Saved', '2026-10-01');
      INSERT INTO product_list_items (list_id, product_id, added_at) VALUES ('l1', 'find-1', '2026-10-01');`);
    old.close();
    const db = openDb(file);
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(MIGRATIONS.length);
    expect(db.prepare('SELECT count(*) AS n FROM product_list_items').get()?.n).toBe(1);
    const at = '2026-10-28';
    db.exec(`INSERT INTO pr_products (id, title, created_at, updated_at) VALUES ('p1', 'Paw cup', '${at}', '${at}');
      INSERT INTO pr_listings (id, product_id, source, source_ref, title, origin, first_seen_at, last_seen_at) VALUES ('a', 'p1', 'cj', '123', 'Paw cup', 'ingest', '${at}', '${at}');
      INSERT INTO pr_listings (id, product_id, store_id, source, source_ref, title, origin, first_seen_at, last_seen_at) VALUES ('b', 'p1', 'x', 'link', 'shop.example/cup', 'Paw cup', 'owner_link', '${at}', '${at}');
      INSERT INTO pr_listings (id, product_id, store_id, source, source_ref, title, origin, first_seen_at, last_seen_at) VALUES ('c', 'p1', 'y', 'link', 'shop.example/cup', 'Paw cup', 'owner_link', '${at}', '${at}');
      INSERT INTO pr_tasks (id, store_id, product_id, instructions, mode, type, client_request_id, created_at, updated_at) VALUES ('t1', 'x', 'p1', 'Check it', 'new', 'product_hunter', 'req-1', '${at}', '${at}');
      INSERT INTO pr_watches (id, store_id, target_kind, target_id, created_at) VALUES ('w1', NULL, 'listing', 'a', '${at}');
      INSERT INTO pr_watches (id, store_id, list_name, target_kind, target_id, created_at) VALUES ('w2', NULL, 'Saved', 'listing', 'a', '${at}');`);
    // Two stores may paste the same link (each a private row); one source can't list the same ref twice.
    expect(() => db.prepare(`INSERT INTO pr_listings (id, product_id, source, source_ref, title, origin, first_seen_at, last_seen_at) VALUES ('d', 'p1', 'cj', '123', 'Again', 'ingest', '', '')`).run()).toThrow(/UNIQUE/);
    expect(() => db.prepare(`INSERT INTO pr_listings (id, product_id, store_id, source, source_ref, title, origin, first_seen_at, last_seen_at) VALUES ('e', 'p1', 'x', 'link', 'shop.example/cup', 'Again', 'owner_link', '', '')`).run()).toThrow(/UNIQUE/);
    // A repeated request is the same task; the all-stores watchlist can't hold one target twice in one list.
    expect(() => db.prepare(`INSERT INTO pr_tasks (id, store_id, product_id, instructions, mode, type, client_request_id, created_at, updated_at) VALUES ('t2', 'x', 'p1', 'Again', 'new', 'product_hunter', 'req-1', '', '')`).run()).toThrow(/UNIQUE/);
    expect(() => db.prepare(`INSERT INTO pr_watches (id, store_id, target_kind, target_id, created_at) VALUES ('w3', NULL, 'listing', 'a', '')`).run()).toThrow(/UNIQUE/);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.exec("DELETE FROM stores WHERE id = 'x'"); // a store's private rows go with it; shared rows stay
    expect(['pr_tasks', 'pr_listings', 'pr_products'].map((t) => db.prepare(`SELECT count(*) AS n FROM ${t}`).get()?.n)).toEqual([0, 2, 1]);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tests use a temp data folder, never the dev instance's (its Knowledge Base edits, its key)", () => {
  expect(dataDir().startsWith(tmpdir())).toBe(true);
});
