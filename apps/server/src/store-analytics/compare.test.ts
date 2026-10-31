import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SaListings } from '@frontline/shared';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { compareProducts } from './compare';
import { LEDGER_NOW, LEDGER_PERIODS, LEDGER_STORE, seedLedgerStore } from './fixture';
import { listings } from './listings';
import { storePeriod, type StorePeriod } from './period';

const { P1 } = LEDGER_PERIODS;
const p1 = (db: Db) => storePeriod(db, LEDGER_STORE, (k) => ({ period: 'custom', from: P1.from, to: P1.to, compare: 'none' })[k], LEDGER_NOW) as StorePeriod;
/** The Listings table's row for each id, over every status. */
const tableRows = (db: Db, store: string, sp: StorePeriod, filters = {}) => new Map((listings(db, store, { status: 'all' }, sp, filters) as SaListings).rows.map((r) => [r.id, r]));

afterEach(() => vi.useRealTimers());

describe('Compare (SA-86)', () => {
  it("2 to 4 products in the order asked, each its Listings row (an archived one too), with one set of definitions", () => {
    const db = openDb();
    seedLedgerStore(db);
    db.prepare("UPDATE products SET status = 'archived' WHERE store_id = ? AND id = '8002'").run(LEDGER_STORE);
    const sp = p1(db);
    const out = compareProducts(db, LEDGER_STORE, '8003,8002,8001,8003', sp, { channel: ['site'] }, 'refund_day');
    if ('error' in out) throw new Error(out.error);
    const table = tableRows(db, LEDGER_STORE, sp, { channel: ['site'] });
    expect(out.rows.map((r) => r.id)).toEqual(['8003', '8002', '8001']);
    expect(out.rows).toEqual(['8003', '8002', '8001'].map((id) => table.get(id)));
    expect(out.rows[0]!.netSales.value).not.toBe(table.get('8001')!.netSales.value); // not one product's numbers thrice
    expect([out.period, out.definitions, out.scope.applied]).toEqual([sp.period, ['units@1', 'net_sales@1', 'refunds@1', 'refund_rate@1', 'contribution_before_ads@1', 'cost_coverage@1'], ['product', 'channel']]);
  });

  it("a demo store's products by its fixed shares, as in the table", () => {
    const db = openDb();
    seedDemo(db, '2026-10-26');
    const sp = storePeriod(db, 'glow', () => undefined, Date.parse('2026-10-26T15:00:00Z')) as StorePeriod;
    const table = tableRows(db, 'glow', sp);
    const ids = [...table.keys()].slice(0, 2);
    const out = compareProducts(db, 'glow', ids.join(','), sp, {}, 'refund_day');
    if ('error' in out) throw new Error(out.error);
    expect(out.rows).toEqual(ids.map((id) => table.get(id)));
    expect(out.rows.map((r) => r.netSales.status)).toEqual(['demo', 'demo']);
  });

  it("fewer than 2, more than 4 or another store's product is refused; the route answers JSON", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(LEDGER_NOW);
    const db = openDb();
    seedLedgerStore(db);
    seedDemo(db, '2026-10-26');
    const sp = p1(db);
    for (const q of [undefined, '', '8001', '8001,8001', '8001,8002,8003,tt-9001,x'])
      expect(compareProducts(db, LEDGER_STORE, q, sp, {}, 'refund_day')).toEqual({ error: 'products must name 2 to 4 different products', status: 400 });
    expect(compareProducts(db, LEDGER_STORE, '8001,glow-p1', sp, {}, 'refund_day')).toEqual({ error: 'A product is not in this store', status: 404 });

    const app = createApp(db);
    const get = (q: string) => app.request(`/api/analytics/compare?store=${LEDGER_STORE}&period=custom&from=${P1.from}&to=${P1.to}${q}`);
    const ok = await get('&products=8001,8002,8003,tt-9001');
    expect([ok.status, ((await ok.json()) as { rows: { id: string }[] }).rows.map((r) => r.id)]).toEqual([200, ['8001', '8002', '8003', 'tt-9001']]);
    expect((await get('&products=8001,glow-p1')).status).toBe(404);
    for (const q of ['&products=8001', '&products=8001,8002&refunds=whenever', '&products=8001,8002&filters=nope']) expect((await get(q)).status).toBe(400);
  });
});
