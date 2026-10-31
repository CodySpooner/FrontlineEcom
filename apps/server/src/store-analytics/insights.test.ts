// SA-74: the rule engine's core rules, their minimum samples, and a stale source turning a rule into data health.
import type { SaInsights, SaOverview } from '@frontline/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { LEDGER_NOW, LEDGER_PERIODS, LEDGER_STORE, seedLedgerStore } from './fixture';
import { insights, RULES } from './insights';
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

  it('a stale orders source: the order rules say they were not checked instead of flagging; a failing one says why', () => {
    const { db, run } = setup();
    stock(db, '8001', 3); // would flag on fresh data
    expect(of(run(), 'source_health@1')).toEqual([]);
    db.prepare("UPDATE source_datasets SET last_success_at = '2026-11-09T07:00:00.000Z' WHERE integration_id = 'tiktok_shop:ledger' AND dataset = 'orders'").run();
    const list = run();
    expect(list.filter((i) => i.kind === 'business').map((i) => i.rule)).toEqual(['listing_sync@1']);
    expect(of(list, 'stock_cover@1')).toEqual([{ rule: 'stock_cover@1', kind: 'data_health', tone: 'red', title: 'Low stock cover not checked', detail: 'TikTok Shop orders out of date', evidence: { sources: 1 }, target: { kind: 'sources' } }]);
    expect(of(list, 'refund_rate@1')[0]!.kind).toBe('data_health');
    expect(of(list, 'unit_cost@1')[0]!.kind).toBe('data_health');
    expect(of(list, 'source_health@1')).toEqual([{ rule: 'source_health@1', kind: 'data_health', tone: 'red', title: "TikTok Shop hasn't synced for 10 h", detail: 'orders', evidence: { datasets: 1, lastSuccess: '2026-11-09T07:00:00.000Z' }, target: { kind: 'sources' } }]);

    db.prepare("UPDATE source_datasets SET status = 'failed', error = 'TikTok Shop said 429: too many requests' WHERE integration_id = 'tiktok_shop:ledger'").run();
    expect(of(run(), 'source_health@1')[0]).toMatchObject({ title: 'TikTok Shop sync failing', detail: 'orders · TikTok Shop said 429: too many requests' });
    expect(of(run(), 'stock_cover@1')[0]!.detail).toBe('TikTok Shop orders failing to sync');
  });

  it('every rule is listed with its threshold, sample and datasets; a demo store runs; the route and the Overview count', async () => {
    expect(RULES.map((r) => r.id)).toEqual(['stock_cover@1', 'refund_rate@1', 'unit_cost@1', 'listing_sync@1', 'source_health@1']);
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
    expect(body.insights.map((i) => i.rule)).toEqual(['unit_cost@1', 'listing_sync@1']);
    expect(((await (await app.request(`/api/analytics/overview?${q}`)).json()) as SaOverview).attention).toBe(2);
    expect((await app.request('/api/analytics/insights?store=glow&period=last30')).status).toBe(200);
    expect(JSON.stringify(body)).not.toMatch(/score|confidence/i);
  });
});
