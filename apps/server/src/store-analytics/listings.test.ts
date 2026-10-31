// SA-66: GET /api/analytics/listings over the ledger fixture plus 64 sale-less products (56 active, 5 draft, 3 archived).
import type { SaFilters, SaListings } from '@frontline/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { costMetrics } from './costs';
import { LEDGER_NOW, LEDGER_PERIODS, LEDGER_STORE, seedLedgerStore } from './fixture';
import { contributions } from './contributions';
import { listings } from './listings';
import { computeMetricSet } from './metric-set';
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

  it("SA-67: a demo store lists its seeded catalog with the period's demo sales split across it, adding up to the store's", () => {
    const db = openDb();
    seedDemo(db, '2026-10-26');
    const sp = storePeriod(db, 'glow', () => undefined, Date.parse('2026-10-26T15:00:00Z')) as StorePeriod;
    const l = listings(db, 'glow', {}, sp) as SaListings;
    expect(l.total).toBe(Number(db.prepare("SELECT count(*) AS n FROM products WHERE store_id = 'glow' AND status = 'active'").get()!.n));
    expect(l.rows.find((r) => r.variants === 3)).toMatchObject({ variantsOut: 0, channels: [{ channel: 'site', status: 'active', error: null }, { channel: 'tiktok_shop', status: 'active', error: null }] });
    for (const r of l.rows) for (const v of [r.netSales, r.units, r.refunds, r.contribution]) expect(v.status).toBe('demo');
    const store = salesMetrics(db, 'glow', sp.period.from, sp.period.to);
    const sum = (f: (r: SaListings['rows'][number]) => number | null) => l.rows.reduce((a, r) => a + f(r)!, 0);
    expect(sum((r) => r.netSales.value)).toBeCloseTo(store.net_sales.value!, 0);
    expect(Math.abs(sum((r) => r.units.value) - store.units.value!)).toBeLessThanOrEqual(l.rows.length);
    const units = l.rows.map((r) => r.units.value!);
    expect(units).toEqual([...units].sort((a, b) => b - a));
    expect(listings(db, 'glow', { sort: 'net_sales' }, sp)).toEqual(listings(db, 'glow', { sort: 'net_sales' }, sp)); // stable between loads
    expect(listings(db, 'glow', {}, sp, { channel: ['site'] })).toMatchObject({ scope: { applied: [], ignored: [{ key: 'channel', reason: "Demo data isn't split by channel" }] } });
  });

  it("SA-78: each row's net sales over the comparison: its change is What moved's; a demo store's add up to the KPI's, today cut too", () => {
    const db = fixture();
    const l = list(db, { sort: 'net_sales' });
    const moved = contributions(db, { storeId: LEDGER_STORE }, p1(db)).rows.filter((r) => r.kind === 'product');
    expect(moved.length).toBe(4);
    for (const m of moved) {
      const r = l.rows.find((x) => x.id === m.id)!;
      expect(Math.round((r.netSales.value! - r.previousNetSales!.value!) * 100) / 100).toBe(m.change);
    }
    const none = storePeriod(db, LEDGER_STORE, (k) => ({ period: 'custom', from: P1.from, to: P1.to, compare: 'none' })[k], LEDGER_NOW) as StorePeriod;
    expect((listings(db, LEDGER_STORE, {}, none) as SaListings).rows.some((r) => 'previousNetSales' in r)).toBe(false);

    const demo = openDb();
    seedDemo(demo, '2026-10-26');
    for (const period of ['last30', 'today']) {
      const sp = storePeriod(demo, 'glow', (k) => ({ period })[k], Date.parse('2026-10-26T15:00:00Z')) as StorePeriod;
      const rows = (listings(demo, 'glow', {}, sp) as SaListings).rows;
      const kpi = computeMetricSet(demo, { storeId: 'glow' }, ['net_sales'], sp).metrics[0]!.previous!.value!;
      expect(rows.reduce((a, r) => a + r.previousNetSales!.value!, 0)).toBeCloseTo(kpi, 0);
      expect(rows[0]!.previousNetSales!.status).toBe('demo');
    }
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
