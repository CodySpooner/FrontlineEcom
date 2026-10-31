// SA-103: why a period has no customer to follow, and the fix.
import type { SaCustomers } from '@frontline/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { insertStore } from '../stores';
import { customersMissing, customersReport } from './customers';
import { LEDGER_NOW, LEDGER_PERIODS, LEDGER_STORE, seedLedgerStore } from './fixture';

const { P1, P2 } = LEDGER_PERIODS;
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

/**
 * The ledger's buyers: a (#1001 in P2; #1003, #1008 in P1), b (#1005), c (#1012, #1013), t (TikTok Shop's own order),
 * d (#1002, P2). Guests #1004 and #1015; #1014 synced before customer ids. The copy #1009 and test order #1006 carry
 * refs that never count.
 */
function withCustomers(db: ReturnType<typeof openDb>) {
  const set = db.prepare("UPDATE orders SET customer_ref = ?, customer_state = ? WHERE store_id = 'ledger' AND id = ?");
  for (const [id, ref] of [['#1001', 'c_a'], ['#1003', 'c_a'], ['#1008', 'c_a'], ['#1005', 'c_b'], ['#1012', 'c_c'], ['#1013', 'c_c'], ['tt-5770001', 'c_t'], ['#1002', 'c_d'], ['#1009', 'c_x'], ['#1006', 'c_z']] as const) set.run(ref, 'identified', id);
  for (const id of ['#1004', '#1015']) set.run(null, 'guest', id);
  return db;
}

describe('customersReport (SA-104)', () => {
  it('P1: customers, new since the first synced order, returning, repeat rate, orders per customer; guests apart; partial while an order predates ids', () => {
    const r = customersReport(withCustomers(ledger()), LEDGER_STORE, { ...P1, preset: 'custom', days: 7, partial: false });
    expect(r.orders).toEqual({ identified: 6, guest: 2, unknown: 1 });
    expect(r.since).toBe('2026-10-20');
    const part = { status: 'partial', coverage: { share: 8 / 9, of: 'orders' } };
    expect(r.customers).toEqual({ value: 4, ...part, note: '1 order synced before customer ids' });
    expect(r.new).toEqual({ value: 3, ...part, note: '1 order synced before customer ids; Counted from the first synced order: an earlier buyer counts as new' });
    expect(r.returning).toMatchObject({ value: 1, status: 'partial' }); // a, who bought in P2
    expect(r.repeat_rate).toMatchObject({ value: 0.5, status: 'partial' }); // a and c
    expect(r.orders_per_customer).toMatchObject({ value: 1.5, status: 'partial' });
    expect(r.missing).toBeUndefined();
    expect(r.scope).toEqual({ applied: [], ignored: [] });
  });

  it("every order's buyer known: ok; a period's first buyers are all new", () => {
    const db = withCustomers(ledger());
    db.prepare("UPDATE orders SET customer_ref = 'c_e', customer_state = 'identified' WHERE id = '#1014'").run();
    const p1 = customersReport(db, LEDGER_STORE, { ...P1, preset: 'custom', days: 7, partial: false });
    expect([p1.customers, p1.new.value]).toEqual([{ value: 5, status: 'ok' }, 4]);
    expect(p1.new.note).toBe('Counted from the first synced order: an earlier buyer counts as new');
    db.prepare("UPDATE orders SET customer_ref = 'c_f', customer_state = 'identified' WHERE id = '#1011'").run();
    // from Oct 20, a's first order's day: still new
    const p2 = customersReport(db, LEDGER_STORE, { from: '2026-10-20', to: P2.to, preset: 'custom', days: 6, partial: false });
    expect([p2.customers.value, p2.new.value, p2.returning.value, p2.repeat_rate.value, p2.orders_per_customer.value]).toEqual([3, 3, 0, 0, 1]);
    // an earlier order that doesn't count (a test order) doesn't make b returning
    db.prepare("UPDATE orders SET status = 'test', customer_ref = 'c_b' WHERE id = '#1002'").run();
    expect(customersReport(db, LEDGER_STORE, { ...P1, preset: 'custom', days: 7, partial: false }).new.value).toBe(4);
  });

  it('no customer to follow: every value unavailable with the reason, the order counts still shown; no orders: no customers, no rate', () => {
    const db = ledger();
    db.prepare("UPDATE orders SET customer_state = 'guest' WHERE store_id = 'ledger'").run();
    const r = customersReport(db, LEDGER_STORE, { ...P1, preset: 'custom', days: 7, partial: false });
    expect(r.missing?.reason).toBe('not_tracked');
    expect(r.customers).toEqual({ value: null, status: 'unavailable', ...r.missing });
    expect(r.orders).toEqual({ identified: 0, guest: 9, unknown: 0 });
    const empty = customersReport(db, LEDGER_STORE, { from: '2025-01-01', to: '2025-01-07', preset: 'custom', days: 7, partial: false });
    expect([empty.customers, empty.repeat_rate]).toEqual([{ value: 0, status: 'ok' }, { value: null, status: 'unavailable', note: 'No customers in this period' }]);
  });

  describe('GET /api/analytics/customers', () => {
    afterEach(() => vi.useRealTimers());
    it('the report for the period; filters are named as not applying', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(LEDGER_NOW);
      const app = createApp(withCustomers(ledger()));
      const res = await app.request(`/api/analytics/customers?store=${LEDGER_STORE}&period=custom&from=${P1.from}&to=${P1.to}&filters=${encodeURIComponent('{"channel":["site"]}')}`);
      expect(res.status).toBe(200);
      const r = (await res.json()) as SaCustomers;
      expect([r.period.from, r.period.to, r.customers.value]).toEqual([P1.from, P1.to, 4]);
      expect(r.scope).toEqual({ applied: [], ignored: [{ key: 'channel', reason: 'Customers are counted store-wide' }] });
    });
  });
});

