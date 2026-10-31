// SA-66: GET /api/analytics/listings over the ledger fixture plus 64 sale-less products (56 active, 5 draft, 3 archived).
import type { SaFilters, SaListings, SaVariants } from '@frontline/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { costMetrics } from './costs';
import { LEDGER_NOW, LEDGER_PERIODS, LEDGER_STORE, seedLedgerStore } from './fixture';
import { contributions } from './contributions';
import { COVER_WINDOW, coverUnits, listings, listingVariants } from './listings';
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
/** A paid site order of one line on `day`, its supplier named or not. */
function sale(db: Db, id: string, day: string, product: string, qty: number, supplier: string | null = null) {
  db.prepare(
    `INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, supplier, cogs, local_date, tax, source_kind, source_id, channel, currency, gross_sales, discounts, shipping, paid_at, source_updated_at, breakdown_at)
     VALUES (?1, ?2, ?3, ?4, 'paid', 'fulfilled', ?5, 0, ?6, 0, 'shopify', ?2, 'site', 'USD', ?4, 0, 0, ?3, ?3, ?3)`,
  ).run(LEDGER_STORE, id, `${day}T15:00:00Z`, qty * 3, supplier, day);
  db.prepare("INSERT INTO order_lines (store_id, order_id, line_id, product_id, variant_id, quantity, gross, discount) VALUES (?, ?, 'l1', ?, NULL, ?, ?, 0)").run(LEDGER_STORE, id, product, qty, qty * 3);
}

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
        expect([r.netSales, r.units, r.refunds, r.refundRate, r.contribution]).toEqual([s.net_sales, s.units, s.refunds, s.refund_rate, costMetrics(db, LEDGER_STORE, P1.from, P1.to, basis, { products: [r.id] }).contribution_before_ads]);
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

  it('SA-80: each stock state; the stock, sales, cost and sync filters pick from the whole set and the counts follow', () => {
    const db = fixture();
    db.prepare("UPDATE products SET inventory = 3 WHERE store_id = ? AND id = '8001'").run(LEDGER_STORE); // 3 left at its last 14 days' rate
    db.prepare("UPDATE products SET inventory = 0 WHERE store_id = ? AND id = '8002'").run(LEDGER_STORE);
    // x3: 1 left after 4 sold on Nov 5, under the 5 a rate needs: not judged low
    db.prepare("UPDATE products SET inventory = 1 WHERE store_id = ? AND id = 'x3'").run(LEDGER_STORE);
    sale(db, '#x3', '2026-11-05', 'x3', 4);
    db.prepare("UPDATE product_variants SET inventory = 0 WHERE store_id = ? AND id = '8002-1'").run(LEDGER_STORE);
    db.prepare("INSERT INTO product_variants (store_id, product_id, id, title, inventory, inventory_tracked, inventory_policy) VALUES (?, 'x1', 'x1-1', 'Default', 5, 0, 'fba')").run(LEDGER_STORE);
    const q = (query: Record<string, string>) => list(db, { status: 'all', sort: 'title', ...query });
    const ids = (l: SaListings) => l.rows.map((r) => r.id);

    const picked = list(db, { status: 'all', sort: 'title' }, { product: ['8001', '8002', '8003', 'tt-9001', 'x1', 'x2', 'x3'] });
    expect(Object.fromEntries(picked.rows.map((r) => [r.id, [r.stockState, r.variantsOut]]))).toEqual({
      '8001': ['low', 0], '8002': ['out', 1], '8003': ['in_stock', 1], 'tt-9001': ['in_stock', 0], x1: ['fba', 0], x2: ['not_tracked', 0], x3: ['in_stock', 0],
    });
    const sold = coverUnits(db, LEDGER_STORE, p1(db).today, false);
    const cover = (id: string, stock: number) => Math.round((stock / (sold.get(id)! / COVER_WINDOW)) * 10) / 10;
    expect(Object.fromEntries(picked.rows.map((r) => [r.id, r.coverDays]))).toEqual({ '8001': cover('8001', 3), '8002': undefined, '8003': undefined, 'tt-9001': undefined, x1: undefined, x2: undefined, x3: undefined }); // SA-82: only with a rate (the mask sold 2)
    expect(ids(q({ stock: 'low' }))).toEqual(['8001']);
    expect(ids(q({ stock: 'out' }))).toEqual(['8002']);
    expect(ids(q({ stock: 'fba' }))).toEqual(['x1']);
    expect(ids(q({ stock: 'variants_out' }))).toEqual(['8002', '8003']); // Hydra (all out), Overnight (Mint)
    expect(q({ stock: 'not_tracked' })).toMatchObject({ total: 32, counts: { active: 28, draft: 2, archived: 2, all: 32 } });
    expect(q({ stock: 'in_stock' }).total).toBe(33);

    expect(ids(q({ sales: 'with' }))).toEqual(['8002', '8003', 'tt-9001', '8001']);
    expect(q({ sales: 'none' }).total).toBe(64);
    expect(q({ sales: 'any' }).total).toBe(68);
    expect(q({ cost: 'missing' }).total).toBe(66); // the extras, the mask and the scrunchie: the serum and cream have variant costs
    db.prepare("INSERT INTO unit_costs (store_id, product_id, variant_id, cost, currency, source, effective_from, recorded_at) VALUES (?, 'tt-9001', NULL, 4, 'USD', 'owner', '2026-10-01', '2026-10-01')").run(LEDGER_STORE);
    expect(ids(list(db, { status: 'all', cost: 'missing' }, { product: ['8001', '8002', '8003', 'tt-9001'] }))).toEqual(['8003']);
    expect(ids(q({ sync: 'failed' }))).toEqual(['tt-9001']);
    expect(ids(list(db, { status: 'all', sync: 'failed' }, { channel: ['tiktok_shop'] }))).toEqual(['tt-9001']); // SA-82: on that channel
    expect(list(db, { status: 'all', sync: 'failed' }, { channel: ['site'] }).total).toBe(0);
    expect(list(db, { stock: 'in_stock', sales: 'with' })).toMatchObject({ total: 2, counts: { active: 2, draft: 0, archived: 0, all: 2 }, variants: 4, channelListings: 2 });

    expect(list(db, { stock: 'wet' })).toBe('stock must be one of in_stock, low, out, not_tracked, fba, supplier, variants_out');
    expect(list(db, { sales: 'some' })).toBe('sales must be one of any, with, none');
    const demo = openDb();
    seedDemo(demo, '2026-10-26');
    const sp = storePeriod(demo, 'glow', () => undefined, Date.parse('2026-10-26T15:00:00Z')) as StorePeriod;
    expect((listings(demo, 'glow', { cost: 'missing' }, sp) as SaListings).total).toBe(0); // a demo store's costs are its catalog's
  });

  it("SA-81: an untracked product a supplier filled an order for in the last 30 days is supplier-managed: no count, no cover", () => {
    const db = fixture();
    sale(db, '#cj-1', '2026-11-02', 'x2', 1, 'CJ Dropshipping'); // x2, x4: untracked
    sale(db, '#cj-2', '2026-10-09', 'x4', 1, 'CJ Dropshipping'); // 31 days back: too old
    sale(db, '#cj-3', '2026-11-02', 'x3', 1, 'CJ Dropshipping'); // x3 tracks its stock: keeps its count
    sale(db, '#own-1', '2026-11-02', 'x6', 1); // no supplier named
    const rows = list(db, { status: 'all', sort: 'title' }, { product: ['x2', 'x3', 'x4', 'x6'] }).rows;
    expect(rows.map((r) => [r.id, r.stockState, r.stock])).toEqual([['x2', 'supplier', null], ['x3', 'in_stock', 5], ['x4', 'not_tracked', null], ['x6', 'not_tracked', null]]);
    expect(list(db, { status: 'all', stock: 'supplier' }).rows.map((r) => r.id)).toEqual(['x2']);
    expect(list(db, { status: 'all', stock: 'not_tracked' }).total).toBe(31);
  });

  it("SA-83: each variant's sales are the v1 functions' for the lines naming it, adding up to its product's row", () => {
    const db = fixture();
    const v = listingVariants(db, LEDGER_STORE, '8003', p1(db))!;
    expect(v.note).toBeUndefined();
    expect(v.rows.map((r) => [r.title, r.sku, r.price, r.stock, r.stockState])).toEqual([['Berry', 'GH-OLM-BER', 18, 30, 'in_stock'], ['Vanilla', 'GH-OLM-VAN', 18, 27, 'in_stock'], ['Mint', 'GH-OLM-MNT', 18, 0, 'out']]);
    for (const r of v.rows) {
      const slice = { products: ['8003'], variants: [r.id] };
      const s = salesMetrics(db, LEDGER_STORE, P1.from, P1.to, 'refund_day', slice);
      expect([r.units, r.netSales, r.refunds, r.contribution]).toEqual([s.units, s.net_sales, s.refunds, costMetrics(db, LEDGER_STORE, P1.from, P1.to, 'refund_day', slice).contribution_before_ads]);
    }
    const row = list(db, {}, { product: ['8003'] }).rows[0]!;
    const sum = (k: 'units' | 'netSales' | 'refunds') => v.rows.reduce((a, r) => a + r[k].value!, 0);
    expect([sum('units'), sum('netSales'), sum('refunds')]).toEqual([row.units.value, row.netSales.value, row.refunds.value]);
    expect(sum('units')).toBeGreaterThan(0);
  });

  it('SA-83: a sale on rows naming no variant leaves every variant without sales, with the note; a demo store says why; 404 for no such product', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(LEDGER_NOW);
    const db = fixture();
    sale(db, '#v-1', P1.from, '8003', 1);
    db.prepare("UPDATE order_lines SET variant_id = NULL WHERE store_id = ? AND order_id = '#v-1'").run(LEDGER_STORE); // a line naming no variant
    const v = listingVariants(db, LEDGER_STORE, '8003', p1(db))!;
    expect(v.note).toBe('Variant sales not recorded yet');
    for (const r of v.rows) for (const x of [r.units, r.netSales, r.refunds, r.contribution]) expect(x).toEqual({ value: null, status: 'unavailable', reason: 'not_tracked', note: 'Variant sales not recorded yet' });
    expect(v.rows.map((r) => r.stockState)).toEqual(['in_stock', 'in_stock', 'out']); // stock is still known

    const demo = openDb();
    seedDemo(demo, '2026-10-26');
    const sp = storePeriod(demo, 'glow', () => undefined, Date.parse('2026-10-26T15:00:00Z')) as StorePeriod;
    const d = listingVariants(demo, 'glow', 'glow-p3', sp)!;
    expect([d.note, d.rows.length, d.rows[0]!.units.value]).toEqual(["Demo data isn't split by variant", 3, null]);

    const app = createApp(db);
    const get = (id: string, store = LEDGER_STORE) => app.request(`/api/analytics/listings/${id}/variants?store=${store}&period=custom&from=${P1.from}&to=${P1.to}`);
    expect(((await (await get('8003')).json()) as SaVariants).rows.map((r) => r.id)).toEqual(['8003-1', '8003-2', '8003-3']);
    expect((await get('nope')).status).toBe(404);
  });

  it('GET /api/analytics/listings: the page and the SA-80 filters, and 400 for a bad status, sort, page or filter', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(LEDGER_NOW);
    const app = createApp(fixture());
    const get = (q: string) => app.request(`/api/analytics/listings?store=${LEDGER_STORE}&period=custom&from=${P1.from}&to=${P1.to}${q}`);
    const body = (await (await get('&page=3')).json()) as SaListings;
    expect([body.page, body.rows.length, body.rows[0]!.title]).toEqual([3, 10, 'Extra 47']);
    for (const [q, ids] of [['&sync=failed', ['tt-9001']], ['&stock=variants_out&sales=with&cost=missing', ['8003']]] as const) expect(((await (await get(q)).json()) as SaListings).rows.map((r) => r.id)).toEqual(ids);
    for (const q of ['&status=hidden', '&sort=color', '&sort=units:up', '&page=0', '&page=1.5', '&refunds=whenever', '&filters=x', '&stock=wet', '&sales=some', '&cost=all', '&sync=ok']) expect((await get(q)).status).toBe(400);
  });
});
