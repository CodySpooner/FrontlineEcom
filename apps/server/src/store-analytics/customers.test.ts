// SA-103: why a period has no customer to follow, and the fix.
import type { SaCustomers } from '@frontline/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { insertStore } from '../stores';
import { customerCohorts, customersMissing, customersReport } from './customers';
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

/**
 * SA-105's store, built for Q22's thresholds ($10 orders). US: u1-u10, exactly 10 customers; CA c1-c3, GB g1-g2,
 * MX m1-m2 (7 together, each under 10); one guest order with no country. August's cohort is u1-u6, 5 of whom
 * (exactly 5) buy again in September and 2 in October; September's is 4 (CA and g1); October's 7.
 */
function cohortStore(twiceInAugust = false) {
  const db = openDb();
  insertStore(db, { id: 'cust', name: 'Cust', platform: 'shopify', niche: 'home', currency: 'USD', timezone: 'America/New_York', color: '#ff2a3a', connected: true });
  const ins = db.prepare(
    `INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, cogs, local_date, tax, source_kind, channel, currency, gross_sales, discounts, shipping, paid_at, breakdown_at, customer_ref, customer_state, country)
     VALUES ('cust', ?, ?, 10, 'paid', 'fulfilled', 0, ?, 0, 'shopify', 'site', 'USD', 10, 0, 0, ?, ?, ?, ?, ?)`,
  );
  let n = 0;
  const buy = (day: string, ref: string | null, country: string | null) => {
    const at = `${day}T15:00:00Z`;
    ins.run(`#${++n}`, at, day, at, at, ref, ref ? 'identified' : 'guest', country);
  };
  const us = (i: number) => `u${i}`;
  for (let i = 1; i <= 6; i++) buy('2026-08-05', us(i), 'US');
  if (twiceInAugust) buy('2026-08-20', 'u6', 'US');
  for (let i = 1; i <= 5; i++) buy('2026-09-05', us(i), 'US');
  for (const r of ['c1', 'c2', 'c3']) buy('2026-09-10', r, 'CA');
  buy('2026-09-10', 'g1', 'GB');
  for (const i of [1, 2]) buy('2026-10-05', us(i), 'US');
  for (let i = 7; i <= 10; i++) buy('2026-10-10', us(i), 'US');
  buy('2026-10-10', 'g2', 'GB');
  for (const r of ['m1', 'm2']) buy('2026-10-10', r, 'MX');
  buy('2026-10-12', null, null);
  return db;
}

describe('cohorts and countries (SA-105, Q22)', () => {
  afterEach(() => vi.useRealTimers());

  it('monthly first-order cohorts followed to the period end; a cell under 5 and a cohort under 5 hidden, exactly 5 shown', () => {
    expect(customerCohorts(cohortStore(), 'cust', '2026-08-01', '2026-10-31')).toEqual([
      { month: '2026-08', customers: 6, months: [5, null], repeat: 5 },
      { month: '2026-09', customers: null, months: [null], repeat: null },
      { month: '2026-10', customers: 7, months: [], repeat: null },
    ]);
    // u6 buying twice in August repeats, without a later month's order
    expect(customerCohorts(cohortStore(true), 'cust', '2026-08-01', '2026-10-31')[0]).toEqual({ month: '2026-08', customers: 6, months: [5, null], repeat: 6 });
    // a period from September: August's buyers aren't a cohort of it, and u1-u5's September orders aren't first orders
    expect(customerCohorts(cohortStore(), 'cust', '2026-09-01', '2026-10-31').map((c) => [c.month, c.customers])).toEqual([['2026-09', null], ['2026-10', 7]]);
  });

  it("countries: the Sales tab's net sales with customers; under 10 merge into Other, exactly 10 shown; Unknown apart", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-11-09T17:00:00Z'));
    const app = createApp(cohortStore());
    const q = 'store=cust&period=custom&from=2026-08-01&to=2026-10-31';
    const r = (await (await app.request(`/api/analytics/customers?${q}`)).json()) as SaCustomers;
    expect(r.countries).toEqual({
      rows: [
        { id: 'US', label: 'US', customers: 10, net_sales: 170 },
        { id: null, label: 'Other (3 countries)', customers: 7, net_sales: 70, kind: 'other' },
        { id: null, label: 'Unknown', customers: 0, net_sales: 10, kind: 'unknown' },
      ],
    });
    const sales = (await (await app.request(`/api/analytics/sales/breakdown?${q}&by=country`)).json()) as { total: { net_sales: { value: number } } };
    expect(r.countries.rows.reduce((a, x) => a + x.net_sales!, 0)).toBe(sales.total.net_sales.value);
    expect(r.cohorts.map((c) => c.month)).toEqual(['2026-08', '2026-09', '2026-10']);
  });

  it('no customer to follow: no cohorts, no countries; the no-data state says why', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(LEDGER_NOW);
    const r = (await (await createApp(ledger()).request(`/api/analytics/customers?store=${LEDGER_STORE}&period=custom&from=${P1.from}&to=${P1.to}`)).json()) as SaCustomers;
    expect([r.missing?.reason, r.cohorts, r.countries]).toEqual(['needs_ingestion', [], { rows: [] }]);
  });
});

