import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS, openDb } from '../db';

/** The first migration this lane added (SA-07): the one numbered "56" in the backlog. */
const LEDGER = MIGRATIONS.findIndex((m) => m.includes('CREATE TABLE refunds (')) + 1;
const NEW_TABLES = ['refunds', 'order_fees', 'order_lines', 'product_variants', 'channel_listings', 'product_links', 'product_collections', 'unit_costs', 'inventory_snapshots', 'sync_runs', 'source_datasets', 'fx_rates', 'traffic_breakdown_daily'];
const cols = (db: DatabaseSync, t: string) => db.prepare(`PRAGMA table_info(${t})`).all() as { name: string; dflt_value: unknown; notnull: number }[];

describe('ledger migration (SA-07)', () => {
  it('applies to an empty database', () => {
    const db = openDb();
    for (const t of NEW_TABLES) expect(cols(db, t).length, t).toBeGreaterThan(0);
    const added = cols(db, 'orders').filter((c) => ['source_kind', 'gross_sales', 'discounts', 'shipping', 'customer_ref', 'country', 'breakdown_at', 'duplicate_of'].includes(c.name));
    expect(added).toHaveLength(8);
    // null means unknown: no default, nullable
    for (const c of added) expect([c.dflt_value, c.notnull]).toEqual([null, 0]);
    expect(cols(db, 'daily_metrics').find((c) => c.name === 'purchase_sessions')).toMatchObject({ dflt_value: null, notnull: 0 });
  });

  it('upgrades a database that has rows, leaving the new columns unknown', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'sa-schema-')), 'frontline.db');
    const old = new DatabaseSync(file);
    MIGRATIONS.slice(0, LEDGER - 1).forEach((m) => old.exec(m));
    old.exec(`PRAGMA user_version = ${LEDGER - 1}`);
    old.exec(`INSERT INTO stores (id, name, platform, niche) VALUES ('s1', 'Glow Haus', 'shopify', 'beauty');
      INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, local_date) VALUES ('s1', '#1001', '2026-10-01T12:00:00Z', 42.5, 'paid', 'fulfilled', '2026-10-01');
      INSERT INTO daily_metrics (store_id, date, revenue, orders, sessions) VALUES ('s1', '2026-10-01', 42.5, 1, 30);`);
    old.close();
    const db = openDb(file);
    expect(Number(db.prepare('PRAGMA user_version').get()!.user_version)).toBe(MIGRATIONS.length);
    expect(db.prepare("SELECT total, gross_sales, breakdown_at, customer_ref FROM orders WHERE id = '#1001'").get()).toEqual({ total: 42.5, gross_sales: null, breakdown_at: null, customer_ref: null });
    expect(db.prepare("SELECT sessions, purchase_sessions FROM daily_metrics WHERE store_id = 's1'").get()).toEqual({ sessions: 30, purchase_sessions: null });
    db.close();
  });

  it('removes a store’s ledger rows with the store', () => {
    const db = openDb();
    db.exec(`INSERT INTO stores (id, name, platform, niche) VALUES ('s1', 'A', 'shopify', 'beauty');
      INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status) VALUES ('s1', '#1', '2026-10-01T12:00:00Z', 10, 'paid', 'fulfilled');
      INSERT INTO order_lines (store_id, order_id, line_id, quantity, gross) VALUES ('s1', '#1', 'l1', 1, 10);
      INSERT INTO refunds (store_id, id, refund_id, order_id, refunded_at, local_date, merchandise, source) VALUES ('s1', 'r1', 'r', '#1', '2026-10-02T00:00:00Z', '2026-10-02', 5, 'shopify');
      INSERT INTO inventory_snapshots (store_id, variant_id, date, quantity, tracked) VALUES ('s1', 'v1', '2026-10-02', 4, 1);
      DELETE FROM stores WHERE id = 's1';`);
    for (const t of ['order_lines', 'refunds', 'inventory_snapshots']) expect(db.prepare(`SELECT count(*) AS n FROM ${t}`).get()!.n, t).toBe(0);
  });
});
