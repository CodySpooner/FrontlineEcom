import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { listBackups } from './backups';
import { MIGRATIONS, openDb } from './db';

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
