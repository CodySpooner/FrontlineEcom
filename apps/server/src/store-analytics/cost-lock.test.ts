// SA-26 (decision 15): an owner's unit cost fills lines with none and never rewrites a known past cost.
import { describe, expect, it } from 'vitest';
import { setProductCost } from '../catalog';
import { recordUnitCost } from '../connectors/ingest';
import { openDb } from '../db';
import { costMetrics } from './costs';
import { LEDGER_STORE, seedLedgerStore } from './fixture';

const [FROM, TO] = ['2026-10-01', '2026-11-09'];

describe('cost lock', () => {
  it('a first cost fills uncosted lines and flags them; changing it leaves past contribution unchanged', () => {
    const db = openDb();
    seedLedgerStore(db);
    const contribution = () => costMetrics(db, LEDGER_STORE, FROM, TO).contribution_before_ads.value!;
    const line = () => db.prepare("SELECT cost, cost_source, owner_backfill FROM order_lines WHERE store_id = 'ledger' AND order_id = 'tt-5770001'").get();
    const before = contribution();
    expect(line()).toEqual({ cost: null, cost_source: null, owner_backfill: null });

    expect(setProductCost(db, LEDGER_STORE, 'tt-9001', { cost: 8 })).toMatchObject({ cost: 8 });
    expect(line()).toEqual({ cost: 8, cost_source: 'owner', owner_backfill: 1 });
    const first = contribution();
    expect(Math.round((first - before) * 100) / 100).toBe(22); // contribution is over costed lines: its 30 in, 8 off

    setProductCost(db, LEDGER_STORE, 'tt-9001', { cost: 12 });
    expect(line()).toEqual({ cost: 8, cost_source: 'owner', owner_backfill: 1 });
    expect(contribution()).toBe(first);
    expect(db.prepare("SELECT cost, source, currency FROM unit_costs WHERE store_id = 'ledger' AND product_id = 'tt-9001' ORDER BY recorded_at, rowid").all()).toEqual([
      { cost: 8, source: 'owner', currency: 'USD' },
      { cost: 12, source: 'owner', currency: 'USD' },
    ]);
    // a Shopify product's cost stays Shopify's
    expect(setProductCost(db, LEDGER_STORE, '8003', { cost: 5 })).toContain('Shopify');
  });

  it('recordUnitCost appends, and the same cost again adds nothing', () => {
    const db = openDb();
    seedLedgerStore(db);
    const at = new Date('2026-11-09T17:00:00Z');
    expect(recordUnitCost(db, LEDGER_STORE, '8001', '8001-1', 11, 'shopify', '2026-11-09', at)).toBe(false); // 11 since Oct 29
    expect(recordUnitCost(db, LEDGER_STORE, '8001', '8001-1', 12, 'shopify', '2026-11-09', at)).toBe(true);
    expect(db.prepare("SELECT cost, effective_from FROM unit_costs WHERE store_id = 'ledger' AND product_id = '8001' ORDER BY effective_from").all()).toEqual([
      { cost: 9, effective_from: '2026-01-01' },
      { cost: 11, effective_from: '2026-10-29' },
      { cost: 12, effective_from: '2026-11-09' },
    ]);
  });
});
