// SA-22: computeMetricSet and GET /api/analytics/metrics.
import type { SaMetricId, SaMetricSet } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { LEDGER_NOW, LEDGER_PERIODS, LEDGER_STORE, seedLedgerStore } from './fixture';
import { computeMetricSet, parseFilters } from './metric-set';
import { storePeriod, type StorePeriod } from './period';

const { P1 } = LEDGER_PERIODS;
const period = (db: ReturnType<typeof openDb>, q: Record<string, string>, now = LEDGER_NOW) => storePeriod(db, LEDGER_STORE, (k) => q[k], now) as StorePeriod;
const byId = (s: SaMetricSet) => Object.fromEntries(s.metrics.map((m) => [m.id, m]));

describe('computeMetricSet', () => {
  it("gives each metric its value, the previous period's and the change", () => {
    const db = openDb();
    seedLedgerStore(db);
    const ids: SaMetricId[] = ['net_sales', 'orders', 'aov', 'site_conversion', 'ad_spend', 'contribution_after_ads'];
    const set = computeMetricSet(db, { storeId: LEDGER_STORE }, ids, period(db, { period: 'custom', from: P1.from, to: P1.to }));
    expect(set.compare).toEqual({ from: '2026-10-19', to: '2026-10-25', days: 7 });
    const m = byId(set);
    expect(m.net_sales).toMatchObject({ value: 405.4, def: 'net_sales@1', previous: { value: 130 } });
    expect(m.net_sales!.change).toEqual({ kind: 'pct', value: ((405.4 - 130) / 130) * 100 });
    expect(m.orders!.change).toEqual({ kind: 'pct', value: 200 });
    expect(m.site_conversion!.change).toMatchObject({ kind: 'points' });
    expect(m.site_conversion!.change.kind === 'points' && m.site_conversion!.change.value).toBeCloseTo(0, 10);
    expect(m.contribution_after_ads).toMatchObject({ value: 85.33, previous: { value: -55.25 } });
    expect(set.scope).toEqual({ applied: [], ignored: [] });
  });

  it('a comparison before the history start has no previous and no change', () => {
    const db = openDb();
    seedLedgerStore(db);
    const set = computeMetricSet(db, { storeId: LEDGER_STORE }, ['net_sales'], period(db, { period: 'custom', from: '2026-10-19', to: '2026-10-25' }));
    expect(set.compare).toEqual({ unavailable: 'History starts 2026-10-19' });
    expect(set.metrics[0]).toMatchObject({ previous: null, change: { kind: 'unavailable' } });
  });

  it('the channel filter narrows order metrics; store-level ones say they ignore it', () => {
    const db = openDb();
    seedLedgerStore(db);
    const set = computeMetricSet(db, { storeId: LEDGER_STORE }, ['orders', 'net_sales', 'ad_spend', 'contribution_after_ads', 'sessions'], period(db, { period: 'custom', from: P1.from, to: P1.to }), { channel: ['tiktok_shop'] });
    const m = byId(set);
    expect(m.orders).toMatchObject({ value: 1, previous: { value: 1 } }); // tt-5770001; P2's #1011
    expect(m.net_sales!.value).toBe(30);
    expect(m.ad_spend!.value).toBe(140);
    expect(m.contribution_after_ads).toMatchObject({ value: null, status: 'unavailable' });
    expect(set.scope.applied).toEqual(['channel']);
    expect(set.scope.ignored.map((i) => i.metric)).toEqual(['ad_spend', 'contribution_after_ads', 'sessions']);
    // the store's own channel picks up the rest
    expect(byId(computeMetricSet(db, { storeId: LEDGER_STORE }, ['orders'], period(db, { period: 'custom', from: P1.from, to: P1.to }), { channel: ['site'] })).orders!.value).toBe(8);
  });

  it('a filter the computation does not apply yet is named, not silently dropped', () => {
    const db = openDb();
    seedLedgerStore(db);
    const set = computeMetricSet(db, { storeId: LEDGER_STORE }, ['net_sales'], period(db, { period: 'custom', from: P1.from, to: P1.to }), { product: ['8001'] });
    expect(set.metrics[0]!.value).toBe(405.4);
    expect(set.scope).toEqual({ applied: [], ignored: [{ key: 'product', reason: 'Not applied to this metric yet', metric: 'net_sales' }] });
  });

  it("today so far is compared with yesterday up to the same clock time", () => {
    const db = openDb();
    seedLedgerStore(db);
    const order = db.prepare(
      "INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, cogs, local_date, tax, currency, gross_sales, discounts, shipping, paid_at, breakdown_at, duplicate_of) VALUES ('ledger', ?, ?, 20, 'paid', 'fulfilled', 0, '2026-11-08', 0, 'USD', 20, 0, 0, ?, ?, NULL)",
    );
    order.run('#1020', '2026-11-08T15:00:00Z', '2026-11-08T15:00:00Z', '2026-11-09T16:55:00Z'); // 10:00 in New York
    order.run('#1021', '2026-11-08T20:00:00Z', '2026-11-08T20:00:00Z', '2026-11-09T16:55:00Z'); // 15:00: after the cut
    const sp = period(db, { period: 'today' });
    expect(sp.cut).toBe('2026-11-08T17:00:00.000Z'); // noon yesterday, New York
    const m = byId(computeMetricSet(db, { storeId: LEDGER_STORE }, ['orders', 'sessions', 'ad_spend'], sp));
    expect(m.orders!.previous).toMatchObject({ value: 1 });
    expect(m.sessions!.previous).toMatchObject({ value: 50, status: 'estimated' });
    expect(m.ad_spend!.previous).toMatchObject({ value: 10, status: 'estimated' });
  });

  it('a demo store: values demo, the channel filter named as not split', () => {
    const db = openDb();
    seedDemo(db, '2026-10-26');
    const sp = storePeriod(db, 'glow', (k) => ({ period: 'last7' })[k as 'period'], Date.parse('2026-10-26T18:00:00')) as StorePeriod;
    const set = computeMetricSet(db, { storeId: 'glow' }, ['net_sales', 'orders'], sp, { channel: ['site'] });
    expect(set.metrics.map((m) => m.status)).toEqual(['demo', 'demo']);
    expect(set.scope.ignored).toEqual([
      { key: 'channel', reason: "Demo data isn't split by channel", metric: 'net_sales' },
      { key: 'channel', reason: "Demo data isn't split by channel", metric: 'orders' },
    ]);
  });
});

describe('GET /api/analytics/metrics', () => {
  it('serves a set, refuses an unknown metric, bad filters and a bad refund basis', async () => {
    const db = openDb();
    seedDemo(db);
    const app = createApp(db);
    const res = await app.request('/api/analytics/metrics?store=glow&metrics=net_sales,orders&period=last7');
    expect(res.status).toBe(200);
    const set = (await res.json()) as SaMetricSet;
    expect(set.metrics.map((m) => m.id)).toEqual(['net_sales', 'orders']);
    expect(set.period.preset).toBe('last7');
    expect((await app.request('/api/analytics/metrics?store=glow&metrics=profit')).status).toBe(400);
    expect((await app.request('/api/analytics/metrics?store=glow&filters=channel:site')).status).toBe(400);
    expect((await app.request(`/api/analytics/metrics?store=glow&filters=${encodeURIComponent('{"color":["red"]}')}`)).status).toBe(400);
    expect((await app.request('/api/analytics/metrics?store=glow&refunds=whenever')).status).toBe(400);
    expect((await app.request('/api/analytics/metrics?store=glow&period=forever')).status).toBe(400);
    // no metrics= gives every metric
    expect(((await (await app.request('/api/analytics/metrics?store=glow')).json()) as SaMetricSet).metrics).toHaveLength(18);
  });

  it('parseFilters', () => {
    expect(parseFilters(undefined)).toEqual({});
    expect(parseFilters('{"channel":["site","tiktok_shop"]}')).toEqual({ channel: ['site', 'tiktok_shop'] });
    expect(parseFilters('{"channel":"site"}')).toBe('filters.channel must be a list of ids');
    expect(parseFilters('[1]')).toBe('filters must be an object of lists');
  });
});

describe('the collection filter (SA-47)', () => {
  const ids: SaMetricId[] = ['orders', 'gross_sales', 'discounts', 'refunds', 'net_sales', 'aov', 'units', 'refund_rate', 'fees', 'sessions'];
  const p1 = (db: ReturnType<typeof openDb>) => period(db, { period: 'custom', from: P1.from, to: P1.to });

  it('counts only the matching lines; store-level metrics say they ignore it', () => {
    const db = openDb();
    seedLedgerStore(db);
    const set = computeMetricSet(db, { storeId: LEDGER_STORE }, ids, p1(db), { collection: ['c-lips'] });
    const v = Object.fromEntries(set.metrics.map((m) => [m.id, m.value]));
    // #1003's mask line only: 2 × 18 less its 3.60, one refunded (16.20) on Oct 28
    expect(v).toMatchObject({ orders: 1, gross_sales: 36, discounts: 3.6, refunds: 16.2, net_sales: 16.2, aov: 32.4, units: 2, refund_rate: 0.5 });
    // #1003's estimated fee (2.9% of 71.09 + 0.30) × the mask's 32.40 of its 61.20
    expect(v.fees).toBe(1.25);
    expect(byId(set).fees!.note).toContain("Pro-rated by the matching lines' share");
    expect(set.scope.applied).toEqual(['collection']);
    expect(set.scope.ignored).toEqual([{ key: 'collection', reason: 'Store level: not split by collection', metric: 'sessions' }]);
  });

  it('a product in two selected collections counts once', () => {
    const db = openDb();
    seedLedgerStore(db);
    const m = byId(computeMetricSet(db, { storeId: LEDGER_STORE }, ['orders', 'units', 'gross_sales'], p1(db), { collection: ['c-lips', 'c-best'] }));
    // serum or mask: #1003 (68), #1005 (32), #1008 (96), #1013, #1014 (32 each); #1009 and #1010 are copies
    expect([m.orders!.value, m.units!.value, m.gross_sales!.value]).toEqual([5, 9, 260]);
  });

  it("collections never synced: the filter isn't applied and says why", () => {
    const db = openDb();
    seedLedgerStore(db);
    db.prepare('DELETE FROM product_collections').run();
    const set = computeMetricSet(db, { storeId: LEDGER_STORE }, ['net_sales'], p1(db), { collection: ['c-lips'] });
    expect(set.metrics[0]!.value).toBe(405.4);
    expect(set.scope).toEqual({ applied: [], ignored: [{ key: 'collection', reason: "Collections aren't synced for this store yet", metric: 'net_sales' }] });
  });

  it('GET /api/analytics/collections lists them with their product counts', async () => {
    const db = openDb();
    seedLedgerStore(db);
    const app = createApp(db);
    expect(await (await app.request(`/api/analytics/collections?store=${LEDGER_STORE}`)).json()).toEqual([
      { id: 'c-best', title: 'Best sellers', source: 'shopify', products: 2 },
      { id: 'c-face', title: 'Face care', source: 'shopify', products: 2 },
      { id: 'c-lips', title: 'Lip care', source: 'shopify', products: 1 },
    ]);
  });
});
