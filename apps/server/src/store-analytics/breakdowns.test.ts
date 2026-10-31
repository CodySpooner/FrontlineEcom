import type { SaSalesBreakdown } from '@frontline/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import { openDb } from '../db';
import { salesBreakdown } from './breakdowns';
import { LEDGER_NOW, LEDGER_PERIODS, LEDGER_STORE, seedLedgerStore } from './fixture';
import { storePeriod } from './period';

afterEach(() => vi.useRealTimers());

const { from, to } = LEDGER_PERIODS.P1;
function setup() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(LEDGER_NOW);
  const db = openDb();
  seedLedgerStore(db);
  const app = createApp(db);
  const get = async (by: string, q = '') => (await app.request(`/api/analytics/sales/breakdown?store=${LEDGER_STORE}&period=custom&from=${from}&to=${to}&by=${by}${q}`)).json() as Promise<SaSalesBreakdown>;
  return { db, get };
}
const table = (b: SaSalesBreakdown) => b.rows.map((r) => [r.label, r.net_sales, r.units, r.kind ?? null]);

describe('sales breakdowns (SA-96)', () => {
  it('by channel and by product: P1 by hand, adding up to 405.40 and 14 units', async () => {
    const { db, get } = setup();
    expect(table(await get('channel'))).toEqual([
      ['site', 375.4, 13, null],
      ['tiktok_shop', 30, 1, null],
    ]);
    expect(table(await get('channel', `&filters=${encodeURIComponent('{"channel":["tiktok_shop"]}')}`))).toEqual([['tiktok_shop', 30, 1, null]]);
    // serum 28.80 + 32 + 86.40 + 32 + 32 − #1005's refund 32; cream 84 + 54 (€) + 42; mask 32.40 − 16.20 refunded
    expect(table(await get('product'))).toEqual([
      ['Hydra Barrier Night Cream', 180, 4, null],
      ['Vitamin C Glow Serum', 179.2, 7, null],
      ['Silk Sleep Scrunchie Set', 30, 1, null],
      ['Overnight Lip Mask', 16.2, 2, null],
    ]);
    // A refund line naming no product: the products can't place it, so it's Unknown
    db.prepare("UPDATE refunds SET product_id = NULL WHERE store_id = ? AND id = 'r1003-1'").run(LEDGER_STORE);
    expect(table(await get('product')).slice(2)).toEqual([
      ['Overnight Lip Mask', 32.4, 2, null],
      ['Silk Sleep Scrunchie Set', 30, 1, null],
      ['Unknown', -16.2, 0, 'unknown'],
    ]);
  });

  it('by collection: each counts its products, the serum in two (overlap); the scrunchie in none', async () => {
    const { db, get } = setup();
    // a collection whose products sold nothing in the period has no row
    db.prepare("INSERT INTO products (store_id, id, title, price) VALUES (?, 'x1', 'New Toner', 20)").run(LEDGER_STORE);
    db.prepare("INSERT INTO product_collections (store_id, collection_id, product_id, title, source) VALUES (?, 'c-new', 'x1', 'New in', 'shopify')").run(LEDGER_STORE);
    const b = await get('collection');
    expect(table(b)).toEqual([
      ['Face care', 359.2, 11, null],
      ['Best sellers', 195.4, 9, null],
      ['Not in a collection', 30, 1, 'none'],
      ['Lip care', 16.2, 2, null],
    ]);
    expect(b.overlap).toBe(true);
    db.prepare("DELETE FROM product_collections WHERE store_id = ? AND collection_id = 'c-best'").run(LEDGER_STORE);
    expect((await get('collection')).overlap).toBeUndefined();
    db.prepare('DELETE FROM product_collections WHERE store_id = ?').run(LEDGER_STORE);
    expect(await get('collection')).toMatchObject({ rows: [], reason: 'needs_ingestion' });
  });

  it("by country where recorded, the rest Unknown; none recorded says why: Shopify's denied probe or not tracked", async () => {
    const { db, get } = setup();
    expect(await get('country')).toMatchObject({ rows: [], reason: 'not_tracked' });
    db.prepare("INSERT INTO done_once (ref, at) VALUES (?, 'x'), (?, 'x')").run(`sa-probe:shopify:${LEDGER_STORE}:country:2026-11-09`, `sa-probe:shopify:${LEDGER_STORE}:country:2026-11-09:denied`);
    expect(await get('country')).toMatchObject({ rows: [], reason: 'needs_permission' });
    db.prepare("INSERT INTO done_once (ref, at) VALUES (?, 'x')").run(`sa-probe:shopify:${LEDGER_STORE}:country:2026-11-10`);
    expect((await get('country')).reason).toBe('not_tracked');

    db.prepare("UPDATE orders SET country = 'US' WHERE store_id = ? AND id IN ('#1003', '#1004')").run(LEDGER_STORE);
    db.prepare("UPDATE orders SET country = 'CA' WHERE store_id = ? AND id = '#1008'").run(LEDGER_STORE);
    // US 68 + 84 − 6.80 − #1003's refund 16.20; CA 96 − 9.60; the other orders 405.40 − 129 − 86.40
    expect(table(await get('country'))).toEqual([
      ['US', 129, 5, null],
      ['CA', 86.4, 3, null],
      ['Unknown', 190, 6, 'unknown'],
    ]);
    // the channel filter narrows the countries too: TikTok Shop's one order has none
    expect(table(await get('country', `&filters=${encodeURIComponent('{"channel":["tiktok_shop"]}')}`))).toEqual([]);
  });

  it('past the top rows, the rest are one row; a demo store and a bad `by` say so', async () => {
    const { db, get } = setup();
    const sp = storePeriod(db, LEDGER_STORE, (k) => ({ period: 'custom', from, to })[k], LEDGER_NOW);
    if (typeof sp === 'string') throw new Error(sp);
    expect(table(salesBreakdown(db, { storeId: LEDGER_STORE }, sp, {}, 'refund_day', 'product', 2)).slice(2)).toEqual([['2 more', 46.2, 3, 'more']]);
    const demo = openDb();
    const { seedDemo } = await import('../demo');
    seedDemo(demo, '2026-10-26');
    expect(salesBreakdown(demo, { storeId: 'glow' }, sp, {}, 'refund_day', 'channel')).toMatchObject({ rows: [], note: "Demo data isn't split by channel" });
    expect((await createApp(db).request(`/api/analytics/sales/breakdown?store=${LEDGER_STORE}&by=variant`)).status).toBe(400);
  });
});
