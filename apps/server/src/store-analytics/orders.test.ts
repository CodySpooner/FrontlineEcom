import type { SaOrders, SaSalesReport } from '@frontline/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { LEDGER_NOW, LEDGER_PERIODS, LEDGER_STORE, seedLedgerStore } from './fixture';
import { orderRecords } from './orders';
import { storePeriod } from './period';

afterEach(() => vi.useRealTimers());

function setup() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(LEDGER_NOW);
  const db = openDb();
  seedLedgerStore(db);
  const app = createApp(db);
  const get = async <T = SaOrders,>(path: string) => {
    const res = await app.request(`/api/analytics/${path}`);
    expect(res.status).toBe(200);
    return (await res.json()) as T;
  };
  const range = (from: string, to: string, q = '') => `store=${LEDGER_STORE}&period=custom&from=${from}&to=${to}${q}`;
  return { db, app, get, range };
}
const sum = (o: SaOrders) => Math.round(o.rows.reduce((s, r) => s + (r.net ?? 0), 0) * 100) / 100;

describe('order records (SA-97)', () => {
  it("P1's orders by hand: copies listed but adding nothing, test and unpaid orders absent, no customer data", async () => {
    const { get, range } = setup();
    const o = await get(`orders?${range(LEDGER_PERIODS.P1.from, LEDGER_PERIODS.P1.to)}`);
    expect([o.count, o.total.value, sum(o)]).toEqual([11, 405.4, 405.4]);
    expect(o.rows.map((r) => [r.id, r.date, r.net, r.duplicateOf])).toEqual([
      ['#1014', '2026-11-01', 32, null],
      ['#1013', '2026-11-01', 32, null],
      ['#1010', '2026-10-31', null, 'tt-5770099'],
      ['tt-5770001', '2026-10-30', 30, null],
      ['#1015', '2026-10-30', 42, null],
      ['#1012', '2026-10-30', 54, null], // €50 at 1.08
      ['#1009', '2026-10-30', null, 'tt-5770001'],
      ['#1008', '2026-10-29', 86.4, null],
      ['#1005', '2026-10-28', 0, null], // cancelled: its 32 refunded the next day
      ['#1004', '2026-10-27', 84, null], // refunded Nov 3, outside P1
      ['#1003', '2026-10-26', 45, null],
    ]);
    expect(o.rows.at(-1)).toEqual({
      id: '#1003', date: '2026-10-26', channel: 'site', status: 'paid', currency: 'USD', placed: true, estimated: false,
      gross: 68, discounts: 6.8, tax: 4.9, shipping: 4.99, refunds: 16.2, net: 45, duplicateOf: null,
    });
    expect(o.rows.find((r) => r.id === '#1012')).toMatchObject({ currency: 'EUR', gross: 54, channel: 'site' });
    expect(o.rows.find((r) => r.id === 'tt-5770001')!.channel).toBe('tiktok_shop');
  });

  it("each day's rows add up to that day's net sales, on either refunds basis; a refund of an earlier order is its own row", async () => {
    const { get, range } = setup();
    for (const basis of ['', '&refunds=order_day']) {
      for (const p of ['P1', 'P3'] as const) {
        const report = await get<SaSalesReport>(`sales?${range(LEDGER_PERIODS[p].from, LEDGER_PERIODS[p].to, basis)}`);
        for (const day of report.rows) {
          const o = await get(`orders?${range(day.from, day.to, basis)}`);
          expect([day.from, basis, sum(o)]).toEqual([day.from, basis, day.values.net_sales.value]);
          expect(o.total.value).toBe(day.values.net_sales.value);
        }
      }
    }
    // Nov 3: #1004's full refund; its order was placed Oct 27
    expect((await get(`orders?${range('2026-11-03', '2026-11-03')}`)).rows).toEqual([
      { id: '#1004', date: '2026-10-27', channel: 'site', status: 'refunded', currency: 'USD', placed: false, estimated: false, gross: null, discounts: null, tax: null, shipping: null, refunds: 84, net: -84, duplicateOf: null },
    ]);
  });

  it('a product filter counts only its lines (no order-level tax or shipping); an order without money parts is estimated', async () => {
    const { db, get, range } = setup();
    const { from, to } = LEDGER_PERIODS.P1;
    // the serum: #1003's serum line 32 − 3.20 (the refunded mask isn't the serum), #1005 32 − 32, #1008, #1013, #1014; #1009 a copy
    const serum = await get(`orders?${range(from, to, `&filters=${encodeURIComponent('{"product":["8001"]}')}`)}`);
    expect(serum.rows.map((r) => [r.id, r.net])).toEqual([['#1014', 32], ['#1013', 32], ['#1009', null], ['#1008', 86.4], ['#1005', 0], ['#1003', 28.8]]);
    expect([sum(serum), serum.total.value, serum.rows.at(-1)!.tax, serum.rows.at(-1)!.shipping]).toEqual([179.2, 179.2, null, null]);

    db.prepare("UPDATE orders SET breakdown_at = NULL, total = 40 WHERE store_id = ? AND id = '#1013'").run(LEDGER_STORE);
    const o = await get(`orders?${range(from, to)}`);
    // total 40 less tax 2.56
    expect(o.rows.find((r) => r.id === '#1013')).toMatchObject({ estimated: true, gross: 37.44, discounts: null, tax: 2.56, shipping: null, net: 37.44 });
    expect(sum(o)).toBe(o.total.value);
  });

  it("a refund converts at its own day's rate; an order in a currency with no rate that day has no money and isn't counted", async () => {
    const { db, get, range } = setup();
    const { from, to } = LEDGER_PERIODS.P1;
    db.prepare("INSERT INTO refunds (store_id, id, refund_id, order_id, product_id, refunded_at, local_date, merchandise, quantity, source) VALUES (?, 'r1012-1', 'R1012', '#1012', '8002', '2026-10-30T12:00:00Z', '2026-10-30', 25.55, 1, 'shopify')").run(LEDGER_STORE);
    // €25.55 at 1.08
    expect((await get(`orders?${range(from, to)}`)).rows.find((r) => r.id === '#1012')).toMatchObject({ gross: 54, refunds: 27.59, net: 26.41 });
    db.prepare("DELETE FROM refunds WHERE store_id = ? AND id = 'r1012-1'").run(LEDGER_STORE);
    db.prepare("UPDATE orders SET currency = 'JPY' WHERE store_id = ? AND id = '#1012'").run(LEDGER_STORE);
    const o = await get(`orders?${range(from, to)}`);
    expect(o.rows.find((r) => r.id === '#1012')).toMatchObject({ currency: 'JPY', gross: null, discounts: null, net: null });
    expect([sum(o), o.total.value]).toEqual([351.4, 351.4]);
  });

  it('pages of 50 (here 4) over every row; a demo store has none; a bad page is 400', async () => {
    const { db, app, range } = setup();
    const sp = storePeriod(db, LEDGER_STORE, (k) => ({ period: 'custom', from: LEDGER_PERIODS.P1.from, to: LEDGER_PERIODS.P1.to })[k], LEDGER_NOW);
    if (typeof sp === 'string') throw new Error(sp);
    const page = (n: number) => orderRecords(db, { storeId: LEDGER_STORE }, sp, {}, 'refund_day', n, 4);
    expect([1, 2, 3, 4].map((n) => page(n).rows.map((r) => r.id).join(' '))).toEqual(['#1014 #1013 #1010 tt-5770001', '#1015 #1012 #1009 #1008', '#1005 #1004 #1003', '']);
    expect(page(3).count).toBe(11);
    const demo = openDb();
    seedDemo(demo, '2026-10-26');
    expect(orderRecords(demo, { storeId: 'glow' }, sp, {}, 'refund_day', 1)).toMatchObject({ count: 0, rows: [], note: 'Demo data has no order records' });
    for (const p of ['0', '1.5', 'x']) expect((await app.request(`/api/analytics/orders?${range(LEDGER_PERIODS.P1.from, LEDGER_PERIODS.P1.to)}&page=${p}`)).status).toBe(400);
  });
});
