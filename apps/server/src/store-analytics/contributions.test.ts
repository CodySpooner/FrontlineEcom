// SA-73: What moved net sales: each product's share of the change, adding up to the KPI's change exactly.
import type { SaFilters, SaMoved } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { contributions } from './contributions';
import { LEDGER_NOW, LEDGER_PERIODS, LEDGER_STORE, seedLedgerStore } from './fixture';
import { overview } from './overview';
import { storePeriod, type StorePeriod } from './period';

const { P1, P3 } = LEDGER_PERIODS;
const sp = (db: Db, store: string, q: Record<string, string>) => storePeriod(db, store, (k) => q[k], LEDGER_NOW) as StorePeriod;
const cents = (n: number) => Math.round(n * 100);
/** The rows add up to the change, and the change is the Overview KPI's. */
function identity(db: Db, store: string, period: StorePeriod, m: SaMoved, filters: SaFilters = {}) {
  expect(cents(m.rows.reduce((a, r) => a + r.change, 0))).toBe(cents(m.change!));
  const kpi = overview(db, { storeId: store }, period, filters).metrics.find((x) => x.id === 'net_sales')!;
  expect(cents(m.change!)).toBe(cents(kpi.value! - kpi.previous!.value!));
}

describe('contributions (SA-73)', () => {
  it('each product vs the previous week, with its channel split or stock note; one with no earlier sales is new', () => {
    const db = openDb();
    seedLedgerStore(db);
    const p1 = sp(db, LEDGER_STORE, { period: 'custom', from: P1.from, to: P1.to });
    const m = contributions(db, { storeId: LEDGER_STORE }, p1);
    expect(m.change).toBe(275.4); // $405.40 vs $130
    expect(m.rows).toEqual([
      { kind: 'product', id: '8002', title: 'Hydra Barrier Night Cream', image: null, change: 138, note: '38 left in stock' }, // site only
      { kind: 'product', id: '8001', title: 'Vitamin C Glow Serum', image: null, change: 91.2, note: 'site +$119 · TikTok Shop −$28' },
      { kind: 'product', id: 'tt-9001', title: 'Silk Sleep Scrunchie Set', image: null, change: 30, note: '10 left in stock', new: true },
      { kind: 'product', id: '8003', title: 'Overnight Lip Mask', image: null, change: 16.2, note: 'Mint out of stock', new: true },
    ]);
    identity(db, LEDGER_STORE, p1, m);

    const serum = { product: ['8001'] };
    const one = contributions(db, { storeId: LEDGER_STORE }, p1, serum);
    expect(one.rows.map((r) => [r.id, r.change])).toEqual([['8001', 91.2]]);
    identity(db, LEDGER_STORE, p1, one, serum);
  });

  it('a fall: the top two down, the rest combined, rows in the board order', () => {
    const db = openDb();
    seedLedgerStore(db);
    const p3 = sp(db, LEDGER_STORE, { period: 'custom', from: P3.from, to: P3.to }); // only #1004's late refund: −$84
    const m = contributions(db, { storeId: LEDGER_STORE }, p3);
    expect(m.change).toBe(-489.4);
    expect(m.rows.map((r) => [r.kind, r.title, r.change])).toEqual([
      ['others', '2 other products', -46.2],
      ['product', 'Vitamin C Glow Serum', -179.2],
      ['product', 'Hydra Barrier Night Cream', -264],
    ]);
    identity(db, LEDGER_STORE, p3, m);
  });

  it('what no product line carries is its own row, so the sum still holds', () => {
    const db = openDb();
    seedLedgerStore(db);
    db.prepare("INSERT INTO refunds (store_id, id, refund_id, order_id, refunded_at, local_date, merchandise, source) VALUES (?, 'r-goodwill', 'RG', '#1008', '2026-10-30T15:00:00Z', '2026-10-30', 10, 'shopify')").run(LEDGER_STORE);
    const p1 = sp(db, LEDGER_STORE, { period: 'custom', from: P1.from, to: P1.to });
    const m = contributions(db, { storeId: LEDGER_STORE }, p1);
    expect(m.change).toBe(265.4);
    expect(m.rows.find((r) => r.kind === 'unattributed')).toEqual({ kind: 'unattributed', title: 'Not on a product line', note: 'Order-level amounts and rounding', change: -10 });
    identity(db, LEDGER_STORE, p1, m);
  });

  it('a demo store adds up too, today included; no comparison means no split', () => {
    const db = openDb();
    seedDemo(db, '2026-11-09');
    let split = 0;
    for (const q of [{ period: 'last30' }, { period: 'today' }, { period: 'last7', compare: 'year' }] as Record<string, string>[]) {
      const period = sp(db, 'glow', q);
      const m = contributions(db, { storeId: 'glow' }, period);
      if (m.change == null) {
        expect(m.note).toBeTruthy(); // a year back is before the demo history
        continue;
      }
      expect(m.rows.filter((r) => r.kind === 'product').length).toBeLessThanOrEqual(6);
      identity(db, 'glow', period, m);
      split++;
    }
    expect(split).toBeGreaterThanOrEqual(2);
    expect(contributions(db, { storeId: 'glow' }, sp(db, 'glow', { period: 'last30', compare: 'none' }))).toMatchObject({ change: null, note: 'No comparison period', rows: [] });
  });

  it('GET /api/analytics/contributions', async () => {
    const db = openDb();
    seedDemo(db);
    const app = createApp(db);
    const res = await app.request('/api/analytics/contributions?store=glow&period=last30');
    expect(res.status).toBe(200);
    expect(((await res.json()) as SaMoved).rows.length).toBeGreaterThan(0);
    expect((await app.request('/api/analytics/contributions?store=glow&refunds=sometimes')).status).toBe(400);
  });
});
