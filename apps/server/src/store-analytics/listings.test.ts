// SA-66: GET /api/analytics/listings over the ledger fixture plus 64 sale-less products (56 active, 5 draft, 3 archived).
import type { SaFilters, SaListings } from '@frontline/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { costMetrics } from './costs';
import { LEDGER_NOW, LEDGER_PERIODS, LEDGER_STORE, seedLedgerStore } from './fixture';
import { listings } from './listings';
import { storePeriod, type StorePeriod } from './period';
import { salesMetrics } from './sales';

const { P1 } = LEDGER_PERIODS;
const extra = (i: number) => `Extra ${String(i).padStart(2, '0')}`;

function fixture() {
  const db = openDb();
  seedLedgerStore(db);
  const prod = db.prepare('INSERT INTO products (store_id, id, title, price, inventory, inventory_tracked, status) VALUES (?, ?, ?, ?, 5, ?, ?)');
  for (let i = 1; i <= 64; i++) prod.run(LEDGER_STORE, `x${i}`, extra(i), i, i % 2, i <= 56 ? 'active' : i <= 61 ? 'draft' : 'archived');
  return db;
}
const p1 = (db: Db, refunds = 'refund_day') => storePeriod(db, LEDGER_STORE, (k) => ({ period: 'custom', from: P1.from, to: P1.to })[k], LEDGER_NOW) as StorePeriod;
const list = (db: Db, q: Record<string, string> = {}, filters: SaFilters = {}, basis: 'refund_day' | 'order_day' = 'refund_day') => listings(db, LEDGER_STORE, q, p1(db), filters, basis) as SaListings;
const titles = (l: SaListings) => l.rows.map((r) => r.title);

afterEach(() => vi.useRealTimers());

describe('listings (SA-66)', () => {
  it('counts each status; pages of 25 sorted over every match (units ↓, then title); page 3 is the last 10', () => {
    const db = fixture();
    const l = list(db);
    expect(l.counts).toEqual({ active: 60, draft: 5, archived: 3, all: 68 });
    expect([l.total, l.pageSize, l.sort, l.variants, l.channelListings]).toEqual([60, 25, 'units:desc', 62, 4]); // the mask's 3 variants; 56 products are their own
    expect(titles(l).slice(0, 5)).toEqual(['Vitamin C Glow Serum', 'Hydra Barrier Night Cream', 'Overnight Lip Mask', 'Silk Sleep Scrunchie Set', 'Extra 01']);
    expect(l.rows.slice(0, 4).map((r) => r.units.value)).toEqual([7, 4, 2, 1]);
    const page3 = list(db, { page: '3' });
    expect(titles(page3)).toEqual(Array.from({ length: 10 }, (_, i) => extra(47 + i)));
    expect(page3.rows[0]).toMatchObject({ units: { value: 0, status: 'ok' }, netSales: { value: 0 }, stock: 5 });
    expect(list(db, { page: '4' }).rows).toEqual([]);
    expect(list(db, { status: 'draft' }).rows.map((r) => r.id)).toEqual(['x57', 'x58', 'x59', 'x60', 'x61']);
    expect(list(db, { status: 'all' }).total).toBe(68);
  });

  it('sorts by net sales, refunds, title, price and stock over the whole set', () => {
    const db = fixture();
    const net = list(db, { sort: 'net_sales' });
    expect(net.rows.slice(0, 4).map((r) => [r.title, r.netSales.value])).toEqual([
      ['Hydra Barrier Night Cream', 180], // 84 + €50 at 1.08 + 42
      ['Vitamin C Glow Serum', 179.2],
      ['Silk Sleep Scrunchie Set', 30],
      ['Overnight Lip Mask', 16.2], // 32.4 less the 16.2 refunded
    ]);
    expect(list(db, { sort: 'refunds' }).rows.slice(0, 3).map((r) => r.refunds.value)).toEqual([32, 16.2, 0]);
    expect(titles(list(db, { sort: 'net_sales:asc', page: '3' })).slice(-4)).toEqual(['Overnight Lip Mask', 'Silk Sleep Scrunchie Set', 'Vitamin C Glow Serum', 'Hydra Barrier Night Cream']);
    expect(titles(list(db, { sort: 'title' })).slice(0, 2)).toEqual(['Extra 01', 'Extra 02']);
    expect(list(db, { sort: 'price:desc' }).rows[0]!.price).toBe(56);
    // untracked stock (the even extras) sorts last either way
    const stock = list(db, { sort: 'stock:asc', page: '3' });
    expect(stock.rows.at(-1)!.stock).toBeNull();
    expect(list(db, { sort: 'stock:desc' }).rows[0]!.stock).toBe(120);
  });

  it("each row's sales are the v1 functions' for that product (the sort's totals agree), refunds on either basis", () => {
    const db = fixture();
    for (const basis of ['refund_day', 'order_day'] as const) {
      const rows = list(db, {}, {}, basis).rows.slice(0, 4);
      for (const r of rows) {
        const s = salesMetrics(db, LEDGER_STORE, P1.from, P1.to, basis, { products: [r.id] });
        expect([r.netSales, r.units, r.refunds, r.contribution]).toEqual([s.net_sales, s.units, s.refunds, costMetrics(db, LEDGER_STORE, P1.from, P1.to, basis, { products: [r.id] }).contribution_before_ads]);
      }
      for (const sort of ['units', 'net_sales', 'refunds'] as const) {
        const values = list(db, { sort }, {}, basis).rows.map((r) => ({ units: r.units, net_sales: r.netSales, refunds: r.refunds })[sort].value!);
        expect(values).toEqual([...values].sort((a, b) => b - a));
      }
    }
  });

  it("the state now: SKU for one variant, variants out, every channel's listing state and error", () => {
    const db = fixture();
    const by = Object.fromEntries(list(db).rows.map((r) => [r.id, r]));
    expect(by['8001']).toMatchObject({ sku: 'GH-VCS-30', variants: 1, variantsOut: 0, price: 32, compareAt: 38, stock: 120, channels: [{ channel: 'site', status: 'active', error: null }], syncedAt: '2026-11-09T16:55:00.000Z' });
    expect(by['8003']).toMatchObject({ sku: null, variants: 3, variantsOut: 1 });
    expect(by['tt-9001']!.channels).toEqual([{ channel: 'tiktok_shop', status: 'failed', error: 'Main image is under 600 px' }]);
  });

  it('searches title, SKU and product id (case-insensitive, wildcards literal); counts follow the search', () => {
    const db = fixture();
    expect(titles(list(db, { q: 'serum' }))).toEqual(['Vitamin C Glow Serum']);
    expect(titles(list(db, { q: 'gh-olm-mnt' }))).toEqual(['Overnight Lip Mask']);
    expect(titles(list(db, { q: '8002' }))).toEqual(['Hydra Barrier Night Cream']);
    expect(list(db, { q: '%' }).total).toBe(0);
    expect(list(db, { q: 'extra 6' }).counts).toEqual({ active: 0, draft: 2, archived: 3, all: 5 }); // 60 to 64
  });

  it('the product and collection filters pick the rows, the channel filter their sales; each named in the scope', () => {
    const db = fixture();
    const l = list(db, {}, { product: ['8001', '8003'], collection: ['c-best'], channel: ['tiktok_shop'], market: ['US'] });
    expect(titles(l)).toEqual(['Overnight Lip Mask', 'Vitamin C Glow Serum']); // no TikTok Shop units: a tie, by title
    expect(l.rows.map((r) => r.units.value)).toEqual([0, 0]);
    expect(l.scope).toEqual({ applied: ['product', 'collection', 'channel'], ignored: [{ key: 'market', reason: 'Not applied to listings yet' }] });
    expect(list(db, {}, { channel: ['tiktok_shop'] }).rows[0]).toMatchObject({ title: 'Silk Sleep Scrunchie Set', units: { value: 1 } });
    db.prepare('DELETE FROM product_collections').run();
    expect(list(db, {}, { collection: ['c-best'] })).toMatchObject({ total: 60, scope: { ignored: [{ key: 'collection', reason: "Collections aren't synced for this store yet" }] } });
  });

  it("a demo store's rows never show the store's totals as a product's", () => {
    const db = openDb();
    seedDemo(db, '2026-10-26');
    const l = listings(db, 'glow', {}, storePeriod(db, 'glow', () => undefined, Date.parse('2026-10-26T15:00:00Z')) as StorePeriod) as SaListings;
    expect(l.total).toBeGreaterThan(0);
    expect(l.rows[0]!.netSales).toMatchObject({ value: null, status: 'unavailable' });
  });

  it('GET /api/analytics/listings: the page, and 400 for a bad status, sort or page', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(LEDGER_NOW);
    const app = createApp(fixture());
    const get = (q: string) => app.request(`/api/analytics/listings?store=${LEDGER_STORE}&period=custom&from=${P1.from}&to=${P1.to}${q}`);
    const body = (await (await get('&page=3')).json()) as SaListings;
    expect([body.page, body.rows.length, body.rows[0]!.title]).toEqual([3, 10, 'Extra 47']);
    for (const q of ['&status=hidden', '&sort=color', '&sort=units:up', '&page=0', '&page=1.5', '&refunds=whenever', '&filters=x']) expect((await get(q)).status).toBe(400);
  });
});
