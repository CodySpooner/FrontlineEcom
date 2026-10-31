// SA-103: why a period has no customer to follow, and the fix.
import { describe, expect, it } from 'vitest';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { insertStore } from '../stores';
import { customersMissing } from './customers';
import { LEDGER_PERIODS, LEDGER_STORE, seedLedgerStore } from './fixture';

const { P1 } = LEDGER_PERIODS;
const FIX = { label: 'Check Shopify', href: '/settings/integrations?store=ledger' };
const ledger = () => {
  const db = openDb();
  seedLedgerStore(db);
  return db;
};

describe('customersMissing (SA-103)', () => {
  it('orders synced before customer ids: not synced yet, with the fix; one customer ref and there is nothing to explain', () => {
    const db = ledger();
    expect(customersMissing(db, LEDGER_STORE, P1.from, P1.to)).toEqual({ reason: 'needs_ingestion', note: 'These orders were synced before customer ids were read; the next full sync adds them', fix: FIX });
    db.prepare("UPDATE orders SET customer_ref = 'c_1', customer_state = 'identified' WHERE store_id = 'ledger' AND id = '#1003'").run();
    expect(customersMissing(db, LEDGER_STORE, P1.from, P1.to)).toBeNull();
    // a copy's ref doesn't count: the order it copies is what's counted
    db.prepare("UPDATE orders SET customer_ref = NULL WHERE id = '#1003'").run();
    db.prepare("UPDATE orders SET customer_ref = 'c_2' WHERE store_id = 'ledger' AND id = '#1009'").run();
    expect(customersMissing(db, LEDGER_STORE, P1.from, P1.to)?.reason).toBe('needs_ingestion');
  });

  it("Shopify's latest customer probe denied: needs permission, and where to allow it", () => {
    const db = ledger();
    const done = db.prepare("INSERT INTO done_once (ref, at) VALUES (?, '2026-11-09T00:00:00Z')");
    for (const r of ['sa-probe:shopify:ledger:customer:2026-11-08', 'sa-probe:shopify:ledger:customer:2026-11-08:denied', 'sa-probe:shopify:ledger:country:2026-11-09']) done.run(r);
    expect(customersMissing(db, LEDGER_STORE, P1.from, P1.to)).toEqual({
      reason: 'needs_permission',
      note: "Shopify hasn't allowed reading the orders' customer (protected customer data)",
      fix: { label: 'Allow customer data for Shopify', href: FIX.href },
    });
    done.run('sa-probe:shopify:ledger:customer:2026-11-09'); // allowed since
    expect(customersMissing(db, LEDGER_STORE, P1.from, P1.to)?.reason).toBe('needs_ingestion');
  });

  it('guest checkouts only: says so, with no link to fix (it is a checkout setting)', () => {
    const db = ledger();
    db.prepare("UPDATE orders SET customer_state = 'guest' WHERE store_id = 'ledger'").run();
    expect(customersMissing(db, LEDGER_STORE, P1.from, P1.to)).toEqual({
      reason: 'not_tracked',
      note: 'Every order in this period was a guest checkout, so there is no customer to follow. Customer accounts at checkout give repeat buyers an id.',
    });
    db.prepare("UPDATE orders SET customer_state = 'unavailable' WHERE store_id = 'ledger' AND id = '#1003'").run();
    expect(customersMissing(db, LEDGER_STORE, P1.from, P1.to)?.reason).toBe('needs_ingestion');
  });

  it("no orders in the period, none synced yet, or a source that sends no customer ids", () => {
    const db = ledger();
    expect(customersMissing(db, LEDGER_STORE, '2025-01-01', '2025-01-07')).toBeNull();
    insertStore(db, { id: 'amz1', name: 'Amz', platform: 'amazon', niche: 'home', currency: 'USD', timezone: 'America/New_York', color: '#ff2a3a', connected: true });
    expect(customersMissing(db, 'amz1', P1.from, P1.to)).toEqual({ reason: 'unsupported', note: 'Amazon withholds buyer ids from sellers.' });
    insertStore(db, { id: 'woo1', name: 'Woo', platform: 'woocommerce', niche: 'home', currency: 'USD', timezone: 'America/New_York', color: '#ff2a3a', connected: true });
    expect(customersMissing(db, 'woo1', P1.from, P1.to)).toMatchObject({ reason: 'needs_credentials', fix: { label: 'Check WooCommerce' } });
    const demo = openDb();
    seedDemo(demo, '2026-10-26');
    expect(customersMissing(demo, 'glow', '2026-10-19', '2026-10-25')).toEqual({ reason: 'unsupported', note: 'Demo stores have no customer ids (owner question Q20).' });
  });
});
