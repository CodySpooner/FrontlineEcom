import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SaListings } from '@frontline/shared';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { setProductCost } from '../catalog';
import { seedDemo } from '../demo';
import { insertStore } from '../stores';
import { costMetrics } from './costs';
import { LEDGER_NOW, LEDGER_PERIODS, LEDGER_STORE, seedLedgerStore } from './fixture';
import { listings, listingVariants } from './listings';
import { storePeriod, type StorePeriod } from './period';
import { productDetail } from './product';

const { P1 } = LEDGER_PERIODS;
const p1 = (db: Db, compare = 'previous') => storePeriod(db, LEDGER_STORE, (k) => ({ period: 'custom', from: P1.from, to: P1.to, compare })[k], LEDGER_NOW) as StorePeriod;
const rowOf = (db: Db, store: string, id: string, sp: StorePeriod, filters = {}) => (listings(db, store, { status: 'all' }, sp, { ...filters, product: [id] }) as SaListings).rows[0]!;
const sum = (xs: (number | null)[]) => xs.reduce<number>((a, n) => a + (n ?? 0), 0);

afterEach(() => vi.useRealTimers());

describe('Product detail (SA-87)', () => {
  it("its Listings row, the row's numbers with their comparison, units a day, channels, costs, variants and its insights", () => {
    const db = openDb();
    seedLedgerStore(db);
    const sp = p1(db);
    const d = productDetail(db, LEDGER_STORE, '8001', sp, {}, 'refund_day', LEDGER_NOW)!;
    const row = rowOf(db, LEDGER_STORE, '8001', sp);
    expect(d.row).toEqual(row);
    expect(d.metrics.map((m) => [m.id, m.def, m.value, m.previous?.value, m.change.kind])).toEqual([
      ['units', 'units@1', 7, 3, 'pct'],
      ['net_sales', 'net_sales@1', 179.2, 88, 'pct'],
      ['refunds', 'refunds@1', 32, 0, 'new'],
      ['refund_rate', 'refund_rate@1', row.refundRate.value, 0, 'points'],
      ['contribution_before_ads', 'contribution_before_ads@1', row.contribution.value, 57.56, 'pct'],
      ['cost_coverage', 'cost_coverage@1', 1, 1, 'points'],
    ]);
    expect([d.metrics[1]!.value, d.metrics[1]!.previous]).toEqual([row.netSales.value, row.previousNetSales]);
    expect([d.units.grain, d.units.points.length, sum(d.units.points.map((p) => p.value))]).toEqual(['day', 7, 7]);
    expect(d.costs.fees).toEqual(costMetrics(db, LEDGER_STORE, P1.from, P1.to, 'refund_day', { products: ['8001'] }).fees);
    expect(d.costs.feeRule).toEqual({ percent: 2.9, perOrder: 0.3 });
    expect(d.variants).toEqual(listingVariants(db, LEDGER_STORE, '8001', sp));
    expect(d.channels).toEqual([{ channel: 'site', status: 'active', error: null, syncedAt: expect.any(String), publishedAt: null, units: row.units, netSales: row.netSales, refunds: row.refunds }]);
    expect(d.insights).toEqual([]);
    // the insights about it: its own, a group naming it, a failed listing of it
    const lip = productDetail(db, LEDGER_STORE, '8003', sp, {}, 'refund_day', LEDGER_NOW)!;
    expect([lip.insights.map((i) => i.rule), lip.rules.map((r) => r.id)]).toEqual([['unit_cost@1', 'variant_out@1'], ['unit_cost@1', 'variant_out@1']]); // and only their rules
    expect(productDetail(db, LEDGER_STORE, 'tt-9001', sp, {}, 'refund_day', LEDGER_NOW)!.insights.map((i) => i.rule)).toEqual(['unit_cost@1', 'listing_sync@1']);
  });

  it("a channel it's listed on, one it sold through unlisted; the channel filter; the unit cost in effect", () => {
    const db = openDb();
    seedLedgerStore(db);
    db.prepare("DELETE FROM channel_listings WHERE store_id = ? AND product_id = '8001'").run(LEDGER_STORE);
    db.prepare("INSERT INTO channel_listings (store_id, channel, id, product_id, status, published_at, synced_at) VALUES (?, 'tiktok_shop', 'L1', '8001', 'active', '2026-06-18', '2026-10-20T10:00:00Z')").run(LEDGER_STORE);
    const add = db.prepare('INSERT INTO unit_costs (store_id, product_id, variant_id, cost, source, effective_from, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    add.run(LEDGER_STORE, '8001', null, 9.5, 'shopify', '2026-08-02', '2026-08-02T00:00:00Z');
    add.run(LEDGER_STORE, '8001', 'v-x', 4, 'owner', '2026-09-01', '2026-09-01T00:00:00Z'); // a variant's isn't the product's
    add.run(LEDGER_STORE, '8001', null, 11, 'owner', '2099-01-01', '2026-10-01T00:00:00Z'); // not in effect yet
    const sp = p1(db);
    const d = productDetail(db, LEDGER_STORE, '8001', sp, {}, 'refund_day', LEDGER_NOW)!;
    expect(d.channels.map((c) => [c.channel, c.status, c.publishedAt, c.units.value, c.netSales.value])).toEqual([
      ['site', null, null, 7, 179.2], // sold there, no listing synced
      ['tiktok_shop', 'active', '2026-06-18', 0, 0],
    ]);
    expect(sum(d.channels.map((c) => c.netSales.value))).toBeCloseTo(d.row.netSales.value!, 2);
    expect(d.costs.unitCost).toEqual({ value: 9.5, source: 'shopify', since: '2026-08-02' });

    const f = productDetail(db, LEDGER_STORE, '8001', sp, { channel: ['tiktok_shop'], collection: ['c1'] }, 'refund_day', LEDGER_NOW)!;
    expect([f.channels.map((c) => c.channel), f.metrics[1]!.value, f.row]).toEqual([['tiktok_shop'], 0, rowOf(db, LEDGER_STORE, '8001', sp, { channel: ['tiktok_shop'] })]);
    expect(f.scope).toEqual({ applied: ['channel'], ignored: [{ key: 'collection', reason: 'The drawer shows the one product' }] });
  });

  it("a demo store's product: its row, its share of the store's units a day, no channel split, its catalog cost", () => {
    const db = openDb();
    seedDemo(db, '2026-10-26');
    const sp = storePeriod(db, 'glow', (k) => ({ compare: 'previous' })[k], Date.parse('2026-10-26T15:00:00Z')) as StorePeriod;
    const id = (listings(db, 'glow', {}, sp) as SaListings).rows[0]!.id;
    const d = productDetail(db, 'glow', id, sp, {}, 'refund_day', Date.parse('2026-10-26T15:00:00Z'))!;
    const row = rowOf(db, 'glow', id, sp);
    expect(d.row).toEqual(row);
    expect([d.metrics[1]!.value, d.metrics[1]!.previous, d.metrics[1]!.status]).toEqual([row.netSales.value, row.previousNetSales, 'demo']);
    expect(Math.abs(sum(d.units.points.map((p) => p.value)) - row.units.value!)).toBeLessThanOrEqual(d.units.points.length / 2); // rounded a day
    expect(d.channelsNote).toBe("Demo data isn't split by channel");
    expect(d.channels.every((c) => c.netSales.value === null && c.netSales.reason === 'unsupported')).toBe(true);
    expect(d.costs.unitCost).toMatchObject({ source: 'demo', since: null });
    expect(d.costs.fees.status).toBe('demo');
  });

  it("another store's product is 404; the route answers JSON", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(LEDGER_NOW);
    const db = openDb();
    seedLedgerStore(db);
    seedDemo(db, '2026-10-26');
    const get = (id: string, q = '') => createApp(db).request(`/api/analytics/products/${id}?store=${LEDGER_STORE}&period=custom&from=${P1.from}&to=${P1.to}${q}`);
    const ok = await get('8001');
    expect([ok.status, ((await ok.json()) as { row: { id: string } }).row.id]).toEqual([200, '8001']);
    expect(productDetail(db, LEDGER_STORE, 'glow-p1', p1(db))).toBeUndefined();
    expect((await get('glow-p1')).status).toBe(404);
    for (const q of ['&refunds=whenever', '&filters=nope', '&compare=sideways']) expect((await get('8001', q)).status).toBe(400);
  });
});

describe('Costs and Refunds tabs (SA-92)', () => {
  it('the refund lines its Refunds number adds up, by the refunds basis; a demo store has none to list', () => {
    const db = openDb();
    seedLedgerStore(db);
    const sp = p1(db, 'none');
    const serum = productDetail(db, LEDGER_STORE, '8001', sp, {}, 'refund_day', LEDGER_NOW)!;
    // r1016-1 waits for its order (not synced yet) and counts nowhere
    expect(serum.refundLines).toEqual({ rows: [{ id: 'r1005-1', orderId: '#1005', date: '2026-10-29', variant: 'Default', quantity: 1, amount: 32, restocked: true }] });
    expect(sum(serum.refundLines.rows.map((r) => r.amount))).toBe(serum.row.refunds.value);
    // the cream's order is in P1, its refund in P3
    const cream = (basis: 'refund_day' | 'order_day') => productDetail(db, LEDGER_STORE, '8002', sp, {}, basis, LEDGER_NOW)!;
    expect(cream('refund_day').refundLines.rows).toEqual([]);
    expect(cream('order_day').refundLines.rows.map((r) => [r.id, r.date, r.amount])).toEqual([['r1004-1', '2026-11-03', 84]]);
    expect(cream('order_day').row.refunds.value).toBe(84);
    // a refund of the EUR order at its day's rate; an order without money parts isn't counted, so not listed
    db.prepare("INSERT INTO refunds (store_id, id, refund_id, order_id, product_id, variant_id, refunded_at, local_date, merchandise, quantity, restocked, source) VALUES (?, 'r1012-1', 'R1012', '#1012', '8002', '8002-1', '2026-10-30T12:00:00Z', '2026-10-30', 25.55, 1, 0, 'shopify')").run(LEDGER_STORE);
    expect(cream('refund_day').refundLines.rows.map((r) => [r.id, r.amount, r.restocked])).toEqual([['r1012-1', 27.59, false]]);
    expect(cream('refund_day').row.refunds.value).toBe(27.59);
    db.prepare("UPDATE orders SET breakdown_at = NULL, status = 'paid' WHERE store_id = ? AND id = '#1005'").run(LEDGER_STORE);
    const parts = productDetail(db, LEDGER_STORE, '8001', sp, {}, 'refund_day', LEDGER_NOW)!;
    expect([parts.refundLines.rows, parts.row.refunds.value]).toEqual([[], 0]);

    const demo = openDb();
    seedDemo(demo, '2026-10-26');
    const dsp = storePeriod(demo, 'glow', () => undefined, Date.parse('2026-10-26T15:00:00Z')) as StorePeriod;
    const id = (listings(demo, 'glow', {}, dsp) as SaListings).rows[0]!.id;
    expect(productDetail(demo, 'glow', id, dsp)!.refundLines).toEqual({ rows: [], note: 'Demo data has no refund lines' });
  });

  it("an edited cost doesn't change a past period's contribution; the history keeps every cost, newest first", async () => {
    const db = openDb();
    seedLedgerStore(db);
    const sp = p1(db, 'none');
    const contribution = () => productDetail(db, LEDGER_STORE, 'tt-9001', sp, {}, 'refund_day', LEDGER_NOW)!.metrics.find((m) => m.id === 'contribution_before_ads')!.value;
    expect(setProductCost(db, LEDGER_STORE, 'tt-9001', { cost: 8 })).toMatchObject({ cost: 8 });
    const first = contribution();
    expect(first).toBe(20.76); // its one $30 line less the 8 cost and its order's fees
    const res = await createApp(db).request(`/api/products/${LEDGER_STORE}/tt-9001`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cost: 12 }) });
    expect(res.status).toBe(200);
    expect(contribution()).toBe(first);
    const d = productDetail(db, LEDGER_STORE, 'tt-9001', sp, {}, 'refund_day', LEDGER_NOW)!;
    expect(d.costs.history.map((h) => [h.value, h.source, h.variant])).toEqual([[12, 'owner', null], [8, 'owner', null]]);
    expect(productDetail(db, LEDGER_STORE, '8001', sp, {}, 'refund_day', LEDGER_NOW)!.costs.history).toEqual([
      { value: 11, currency: 'USD', source: 'shopify', since: '2026-10-29', recordedAt: '2026-10-29T13:00:00Z', variant: 'Default' },
      { value: 9, currency: 'USD', source: 'shopify', since: '2026-01-01', recordedAt: '2026-01-01T00:00:00Z', variant: 'Default' },
    ]);
    // the refusal the Costs tab shows for a Shopify product
    const shopify = await createApp(db).request(`/api/products/${LEDGER_STORE}/8003`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cost: 5 }) });
    expect([shopify.status, ((await shopify.json()) as { error: string }).error]).toEqual([400, 'Shopify keeps unit costs: set "Cost per item" on the product in Shopify and the next sync brings it here']);
  });
});

describe('Platform link ids (SA-93)', () => {
  it("its stored handle and the store integration's shop, normalized; a malformed or missing one gives none", () => {
    const db = openDb();
    seedLedgerStore(db);
    const sp = p1(db, 'none');
    const ids = (store: string, id: string) => productDetail(db, store, id, sp, {}, 'refund_day', LEDGER_NOW)!.platformIds;
    db.prepare("UPDATE products SET handle = 'vitamin-c-glow-serum' WHERE store_id = ? AND id = '8001'").run(LEDGER_STORE);
    expect(ids(LEDGER_STORE, '8001')).toEqual({ handle: 'vitamin-c-glow-serum', shopHost: 'ledger-test.myshopify.com', siteUrl: null, marketplaceId: null });
    const settings = (id: string, v: Record<string, string>) => db.prepare('UPDATE integrations SET settings_json = ? WHERE id = ?').run(JSON.stringify(v), id);
    settings(`shopify:${LEDGER_STORE}`, { shopDomain: 'admin.shopify.com/store/ledger-test' });
    expect(ids(LEDGER_STORE, '8002')).toEqual({ handle: null, shopHost: 'ledger-test.myshopify.com', siteUrl: null, marketplaceId: null });
    settings(`shopify:${LEDGER_STORE}`, { shopDomain: 'ledger.example.com' });
    expect(ids(LEDGER_STORE, '8002').shopHost).toBeNull();

    const store = (id: string, platform: 'woocommerce' | 'amazon', v: Record<string, string>) => {
      insertStore(db, { id, name: id, platform, niche: 'beauty', currency: 'USD', timezone: 'America/New_York', color: '#ff2a3a', connected: true });
      db.prepare("INSERT INTO integrations (id, kind, store_id, status, settings_json, encrypted_credentials, updated_at) VALUES (?, ?, ?, 'connected', ?, '', 'x')").run(`${platform}:${id}`, platform, id, JSON.stringify(v));
      db.prepare("INSERT INTO products (store_id, id, title, price) VALUES (?, 'p', 'P', 10)").run(id);
    };
    store('woo', 'woocommerce', { siteUrl: 'https://shop.example.com/store/' });
    store('woo-http', 'woocommerce', { siteUrl: 'http://shop.example.com' });
    store('amz', 'amazon', { sellerId: 'A2SELLER', marketplaceId: ' atvpdkikx0der ' });
    expect([ids('woo', 'p').siteUrl, ids('woo-http', 'p').siteUrl, ids('amz', 'p').marketplaceId, ids('amz', 'p').shopHost]).toEqual(['https://shop.example.com/store', null, 'ATVPDKIKX0DER', null]);
  });
});

