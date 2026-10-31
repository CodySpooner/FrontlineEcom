// SA-74, SA-75: the rule engine's rules, their minimum samples, and a stale source turning a rule into data health.
import { readFileSync } from 'node:fs';
import type { SaInsights, SaOverview } from '@frontline/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { LEDGER_NOW, LEDGER_PERIODS, LEDGER_STORE, seedLedgerStore } from './fixture';
import { insights, LATE_HOURS, RULES } from './insights';
import { storePeriod, type StorePeriod } from './period';

const { P1 } = LEDGER_PERIODS;
afterEach(() => vi.useRealTimers());
const setup = () => {
  const db = openDb();
  seedLedgerStore(db);
  const sp = storePeriod(db, LEDGER_STORE, (k) => ({ period: 'custom', from: P1.from, to: P1.to })[k as 'period'], LEDGER_NOW) as StorePeriod;
  return { db, run: () => insights(db, LEDGER_STORE, sp, LEDGER_NOW).insights };
};
const of = (list: SaInsights['insights'], rule: string) => list.filter((i) => i.rule === rule);
const stock = (db: Db, product: string, n: number) => db.prepare('UPDATE products SET inventory = ? WHERE store_id = ? AND id = ?').run(n, LEDGER_STORE, product);

/** A paid order of one line, with money parts, as the fixture seeds them. */
function order(db: Db, id: string, day: string, product: string, qty: number, price: number) {
  db.prepare(
    `INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, cogs, local_date, tax, source_kind, source_id, channel, currency, gross_sales, discounts, shipping, paid_at, source_updated_at, breakdown_at)
     VALUES (?, ?, ?, ?, 'paid', 'fulfilled', 0, ?, 0, 'shopify', ?, 'site', 'USD', ?, 0, 0, ?, ?, ?)`,
  ).run(LEDGER_STORE, id, `${day}T15:00:00Z`, qty * price, day, id, qty * price, `${day}T15:00:00Z`, `${day}T15:00:00Z`, `${day}T15:00:00Z`);
  db.prepare('INSERT INTO order_lines (store_id, order_id, line_id, product_id, variant_id, quantity, gross, discount) VALUES (?, ?, ?, ?, ?, ?, ?, 0)').run(LEDGER_STORE, id, 'l1', product, `${product}-1`, qty, qty * price);
  db.prepare('INSERT INTO order_items (store_id, order_id, product_id, quantity, revenue, cost) VALUES (?, ?, ?, ?, ?, 0)').run(LEDGER_STORE, id, product, qty, qty * price);
}

describe('insight rules (SA-74)', () => {
  it('stock cover: under 10 days at the last 14 days rate flags; under 5 units sold there is no rate', () => {
    const { db, run } = setup();
    expect(of(run(), 'stock_cover@1')).toEqual([]);
    stock(db, '8001', 3); // the serum sold 7 in Oct 26 – Nov 8: 0.5 a day, 6 days
    stock(db, '8002', 1); // the cream sold 4: under the minimum sample
    expect(of(run(), 'stock_cover@1')).toEqual([
      { rule: 'stock_cover@1', kind: 'business', tone: 'warn', title: 'Vitamin C Glow Serum: ~6 days of stock', detail: '3 left · 0.5 sold a day over the last 14 days', evidence: { stock: 3, units: 7, days: 14, cover: 6 }, target: { kind: 'product', id: '8001' } },
    ]);
  });

  it('refund rate: over twice the store average flags from 30 units; the mask at 50% of 2 units does not', () => {
    const { db, run } = setup();
    expect(of(run(), 'refund_rate@1')).toEqual([]);
    order(db, '#2001', '2026-10-27', '8001', 100, 30);
    order(db, '#2002', '2026-10-27', '8002', 30, 42);
    db.prepare("INSERT INTO refunds (store_id, id, refund_id, order_id, product_id, variant_id, refunded_at, local_date, merchandise, quantity, restocked, source) VALUES (?, 'r2002', 'R2002', '#2002', '8002', '8002-1', '2026-10-28T15:00:00Z', '2026-10-28', 378, 9, 1, 'shopify')").run(LEDGER_STORE);
    // store: (1 mask + 1 serum + 9 cream) of 144 units = 7.6%; the cream: 9 of 34
    expect(of(run(), 'refund_rate@1')).toEqual([
      { rule: 'refund_rate@1', kind: 'business', tone: 'red', title: 'Hydra Barrier Night Cream: 26.5% of units refunded', detail: '9 of 34 units · store average 7.6%', evidence: { refunded: 9, units: 34, rate: 9 / 34, store: 11 / 144 }, target: { kind: 'product', id: '8002' } },
    ]);
  });

  it('no unit cost: the products sold without one, and their share of units', () => {
    const { run } = setup();
    expect(of(run(), 'unit_cost@1')).toEqual([
      { rule: 'unit_cost@1', kind: 'business', tone: 'warn', title: '2 products have no unit cost', detail: '21% of units sold · left out of contribution', evidence: { products: 2, uncosted: 3, units: 14 }, target: { kind: 'products', ids: ['8003', 'tt-9001'] } },
    ]);
  });

  it('a failed listing sync, per channel', () => {
    const { run } = setup();
    expect(of(run(), 'listing_sync@1')).toEqual([
      { rule: 'listing_sync@1', kind: 'business', tone: 'info', title: '1 TikTok Shop listing failed to sync', detail: 'Silk Sleep Scrunchie Set · Main image is under 600 px', evidence: { listings: 1 }, target: { kind: 'listings', channel: 'tiktok_shop' } },
    ]);
  });

  it('a stale orders source: a rule that would flag on it is held back as data health; one with nothing to say stays quiet', () => {
    const { db, run } = setup();
    stock(db, '8001', 3); // would flag on fresh data
    expect(of(run(), 'source_health@1')).toEqual([]);
    db.prepare("UPDATE source_datasets SET last_success_at = '2026-11-09T07:00:00.000Z' WHERE integration_id = 'tiktok_shop:ledger' AND dataset = 'orders'").run();
    const list = run();
    expect(list.filter((i) => i.kind === 'business').map((i) => i.rule)).toEqual(['listing_sync@1', 'variant_out@1']); // they read no orders
    expect(of(list, 'stock_cover@1')).toEqual([{ rule: 'stock_cover@1', kind: 'data_health', tone: 'red', title: 'Low stock cover held back', detail: '1 flag waiting for TikTok Shop orders (out of date)', evidence: { flags: 1, sources: 1 }, target: { kind: 'sources' } }]);
    expect(of(list, 'unit_cost@1')[0]!.kind).toBe('data_health');
    expect(of(list, 'refund_rate@1')).toEqual([]); // nothing to hold back
    expect(of(list, 'source_health@1')).toEqual([{ rule: 'source_health@1', kind: 'data_health', tone: 'red', title: "TikTok Shop hasn't synced for 10 h", detail: 'orders', evidence: { datasets: 1, lastSuccess: '2026-11-09T07:00:00.000Z' }, target: { kind: 'sources' } }]);

    db.prepare("UPDATE source_datasets SET status = 'failed', error = 'TikTok Shop said 429: too many requests' WHERE integration_id = 'tiktok_shop:ledger'").run();
    expect(of(run(), 'source_health@1')[0]).toMatchObject({ title: 'TikTok Shop sync failing', detail: 'orders · TikTok Shop said 429: too many requests' });
    expect(of(run(), 'stock_cover@1')[0]!.detail).toBe('1 flag waiting for TikTok Shop orders (failing to sync)');
  });

  it('every rule is listed with its threshold, sample and datasets; a demo store runs; the route and the Overview count', async () => {
    expect(RULES.map((r) => r.id)).toEqual([
      'stock_cover@1', 'refund_rate@1', 'unit_cost@1', 'listing_sync@1', 'product_down@1', 'ads_contribution@1', 'conversion_down@1', 'late_fulfillment@1', 'variant_out@1', 'unmapped_orders@1', 'source_health@1',
    ]);
    expect(RULES[0]).toMatchObject({ when: "Tracked stock covers under 10 days at the last 14 full days' sales rate", minSample: '5 units sold in those 14 days' });
    vi.useFakeTimers({ now: LEDGER_NOW, toFake: ['Date'] });
    const db = openDb();
    seedDemo(db, '2026-11-09');
    seedLedgerStore(db);
    const app = createApp(db);
    const q = `store=${LEDGER_STORE}&period=custom&from=${P1.from}&to=${P1.to}`;
    const body = (await (await app.request(`/api/analytics/insights?${q}`)).json()) as SaInsights;
    expect(body.rules.map((r) => r.id)).toEqual(RULES.map((r) => r.id));
    expect(body.rules[0]).not.toHaveProperty('run');
    expect(body.insights.map((i) => i.rule)).toEqual(['unit_cost@1', 'listing_sync@1', 'variant_out@1']);
    expect(((await (await app.request(`/api/analytics/overview?${q}`)).json()) as SaOverview).attention).toBe(3);
    expect((await app.request('/api/analytics/insights?store=glow&period=last30')).status).toBe(200);
    expect(JSON.stringify(body)).not.toMatch(/score|confidence/i);
  });
});

describe('insight rules (SA-75)', () => {
  it('product sales down: 30% or more against the comparison, from 20 units sold there', () => {
    const { db, run } = setup();
    expect(of(run(), 'product_down@1')).toEqual([]);
    order(db, '#2101', '2026-10-21', '8002', 30, 42); // the cream: $1,302 and 31 units in P2, $180 in P1
    order(db, '#2102', '2026-10-21', '8003', 10, 18); // the mask: down 91%, but 10 units: under the sample
    expect(of(run(), 'product_down@1')).toEqual([
      { rule: 'product_down@1', kind: 'business', tone: 'warn', title: 'Hydra Barrier Night Cream: net sales down 86%', detail: '$180 vs $1,302 · 31 units before', evidence: { net_sales: 180, previous: 1302, previousUnits: 31 }, target: { kind: 'product', id: '8002' } },
    ]);
  });

  it('ad spend up while contribution after ads fell', () => {
    const { db, run } = setup();
    expect(of(run(), 'ads_contribution@1')).toEqual([]); // $20 a day in both weeks
    db.prepare("UPDATE campaign_daily SET spend = 60 WHERE campaign_id = 'm1' AND date BETWEEN ? AND ?").run(P1.from, P1.to);
    const [i] = of(run(), 'ads_contribution@1');
    expect(i).toMatchObject({ kind: 'business', evidence: { ad_spend: 420, previousAdSpend: 140 }, target: { kind: 'metric', id: 'contribution_after_ads' } });
    expect(i!.title).toMatch(/^Ad spend up 200\.0% while contribution after ads fell /);
    expect(i!.evidence.contribution as number).toBeLessThan(i!.evidence.previousContribution as number);
  });

  it('conversion down 15% or more, only with 500 sessions in each period', () => {
    const { db, run } = setup();
    expect(of(run(), 'conversion_down@1')).toEqual([]);
    db.prepare('UPDATE daily_metrics SET purchase_sessions = 1 WHERE store_id = ? AND date BETWEEN ? AND ?').run(LEDGER_STORE, P1.from, P1.to);
    expect(of(run(), 'conversion_down@1')).toEqual([
      { rule: 'conversion_down@1', kind: 'business', tone: 'warn', title: 'Site conversion down to 1.00% from 2.00%', detail: '1.00 pts lower · 700 sessions', evidence: { site_conversion: 0.01, previous: 0.02, sessions: 700, previousSessions: 700 }, target: { kind: 'metric', id: 'site_conversion' } },
    ]);
    db.prepare('UPDATE daily_metrics SET sessions = 50 WHERE store_id = ?').run(LEDGER_STORE);
    expect(of(run(), 'conversion_down@1')).toEqual([]); // 350 sessions a week
  });

  it("late fulfillment: paid and not shipped after the Orders page's 48 hours", () => {
    expect(LATE_HOURS).toBe(Number(/LATE_HOURS = (\d+)/.exec(readFileSync(new URL('../../../web/src/lib/orders.ts', import.meta.url), 'utf8'))![1]));
    const { db, run } = setup();
    order(db, '#3001', '2026-11-06', '8001', 1, 32); // Nov 6 15:00 UTC: 74 h before now
    order(db, '#3002', '2026-11-09', '8001', 1, 32); // 2 h before now
    db.prepare("UPDATE orders SET fulfillment_status = 'unfulfilled' WHERE id IN ('#3001', '#3002')").run();
    db.prepare("UPDATE orders SET created_at = '2026-11-09T15:00:00Z' WHERE id = '#3002'").run();
    expect(of(run(), 'late_fulfillment@1')).toEqual([
      { rule: 'late_fulfillment@1', kind: 'business', tone: 'red', title: '1 order not shipped after 48 h', detail: '#3001, placed Nov 6', evidence: { orders: 1, hours: 48 }, target: { kind: 'orders' } },
    ]);
  });

  it('a variant out of stock, or a one-variant product', () => {
    const { db, run } = setup();
    db.prepare("UPDATE product_variants SET inventory = 0 WHERE store_id = ? AND id = '8002-1'").run(LEDGER_STORE);
    expect(of(run(), 'variant_out@1').map((i) => [i.title, i.detail])).toEqual([
      ['Hydra Barrier Night Cream: out of stock', 'Tracked stock at 0'],
      ['Overnight Lip Mask: Mint out of stock', '1 of 3 variants'],
    ]);
  });

  it('orders from an unmapped sales-channel app may duplicate: data health', () => {
    const { db, run } = setup();
    expect(of(run(), 'unmapped_orders@1')).toEqual([]);
    order(db, '#4001', '2026-10-28', '8001', 1, 32);
    db.prepare("UPDATE orders SET channel = 'other' WHERE id = '#4001'").run();
    expect(of(run(), 'unmapped_orders@1')).toEqual([
      { rule: 'unmapped_orders@1', kind: 'data_health', tone: 'warn', title: '1 order from other sales-channel apps may be counted twice', detail: 'Shopify recorded it for an app the store has no integration for; never matched automatically', evidence: { orders: 1 }, target: { kind: 'sources' } },
    ]);
  });
});
