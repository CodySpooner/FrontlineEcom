// SA-50: inventory snapshots, one per tracked variant and store day.
import { describe, expect, it } from 'vitest';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { LEDGER_NOW, LEDGER_STORE, seedLedgerStore } from './fixture';
import { snapshotInventory, stockAt } from './inventory';

const ID = `shopify:${LEDGER_STORE}`;
const NOW = new Date(LEDGER_NOW); // Nov 9, 12:00 in New York
const START = new Date(LEDGER_NOW - 60_000);
const variantsRead = (db: ReturnType<typeof openDb>, status = 'available', at = NOW) =>
  db.prepare("INSERT INTO source_datasets (integration_id, dataset, store_id, status, last_try_at, last_success_at) VALUES (?, 'variants', ?, ?, ?, ?) ON CONFLICT (integration_id, dataset) DO UPDATE SET status = excluded.status, last_success_at = excluded.last_success_at")
    .run(ID, LEDGER_STORE, status, at.toISOString(), status === 'failed' ? null : at.toISOString());
const snapshots = (db: ReturnType<typeof openDb>) => db.prepare('SELECT variant_id, date, quantity FROM inventory_snapshots WHERE store_id = ? ORDER BY variant_id, date').all(LEDGER_STORE);

describe('inventory snapshots (SA-50)', () => {
  it("two syncs on one day give one snapshot: the day's first; the next day gets its own", () => {
    const db = openDb();
    seedLedgerStore(db);
    variantsRead(db);
    snapshotInventory(db, LEDGER_STORE, ID, START, NOW);
    db.prepare("UPDATE product_variants SET inventory = 100 WHERE store_id = ? AND id = '8001-1'").run(LEDGER_STORE);
    snapshotInventory(db, LEDGER_STORE, ID, START, new Date(LEDGER_NOW + 3_600_000));
    expect(stockAt(db, LEDGER_STORE, '8001-1', '2026-11-09')).toBe(120);
    expect(snapshots(db).filter((s) => s.date === '2026-11-09')).toHaveLength(6);
    // 23:30 in New York on the 9th is the 10th in UTC: still the 9th's
    snapshotInventory(db, LEDGER_STORE, ID, START, new Date('2026-11-10T04:30:00Z'));
    expect(stockAt(db, LEDGER_STORE, '8001-1', '2026-11-10')).toBeNull();
    snapshotInventory(db, LEDGER_STORE, ID, START, new Date('2026-11-10T15:00:00Z'));
    expect([stockAt(db, LEDGER_STORE, '8001-1', '2026-11-09'), stockAt(db, LEDGER_STORE, '8001-1', '2026-11-10')]).toEqual([120, 100]);
  });

  it('an untracked variant or one with no count gets none; a day with none reads null, never 0', () => {
    const db = openDb();
    seedLedgerStore(db);
    variantsRead(db);
    db.prepare("UPDATE product_variants SET inventory_tracked = 0 WHERE store_id = ? AND id = '8003-1'").run(LEDGER_STORE);
    db.prepare("UPDATE product_variants SET inventory = NULL WHERE store_id = ? AND id = '8003-2'").run(LEDGER_STORE);
    snapshotInventory(db, LEDGER_STORE, ID, START, NOW);
    expect(snapshots(db).map((s) => s.variant_id)).toEqual(['8001-1', '8002-1', '8003-3', 'tt-9001-1']);
    expect(stockAt(db, LEDGER_STORE, '8003-3', '2026-11-09')).toBe(0); // a real 0: out of stock
    expect(stockAt(db, LEDGER_STORE, '8003-1', '2026-11-09')).toBeNull();
    expect(stockAt(db, LEDGER_STORE, '8001-1', '2026-11-08')).toBeNull();
  });

  it('none without a successful variants read in this sync', () => {
    const db = openDb();
    seedLedgerStore(db);
    snapshotInventory(db, LEDGER_STORE, ID, START, NOW); // never read
    variantsRead(db, 'available', new Date(LEDGER_NOW - 3_600_000)); // read by an earlier sync
    snapshotInventory(db, LEDGER_STORE, ID, START, NOW);
    variantsRead(db, 'failed');
    snapshotInventory(db, LEDGER_STORE, ID, START, NOW);
    expect(snapshots(db)).toEqual([]);
  });

  it('a demo store gets none', () => {
    const db = openDb();
    seedDemo(db, '2026-10-26');
    db.prepare("INSERT INTO source_datasets (integration_id, dataset, store_id, status, last_try_at, last_success_at) VALUES ('shopify:glow', 'variants', 'glow', 'available', ?, ?)").run(NOW.toISOString(), NOW.toISOString());
    snapshotInventory(db, 'glow', 'shopify:glow', START, NOW);
    expect(db.prepare('SELECT count(*) AS n FROM inventory_snapshots').get()?.n).toBe(0);
  });
});
