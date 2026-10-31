// SA-72: the chart's markers: sync failures over 3 hours, price tests and approved changes, one store's only.
import type { SaAnnotation, SaOverview } from '@frontline/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { annotations } from './annotations';
import { LEDGER_NOW, LEDGER_PERIODS, LEDGER_STORE, seedLedgerStore } from './fixture';
import { storePeriod, type StorePeriod } from './period';

const { P1 } = LEDGER_PERIODS; // Oct 26 – Nov 1, New York
afterEach(() => vi.useRealTimers());
const setup = () => {
  const db = openDb();
  seedDemo(db, '2026-11-09');
  seedLedgerStore(db);
  const sp = storePeriod(db, LEDGER_STORE, (k) => ({ period: 'custom', from: P1.from, to: P1.to })[k as 'period'], LEDGER_NOW) as StorePeriod;
  const run = db.prepare('INSERT INTO sync_runs (integration_id, store_id, kind, started_at, finished_at, status) VALUES (?, ?, ?, ?, ?, ?)');
  return { db, sp, run: (id: string, start: string, end: string, status: string) => run.run(id, LEDGER_STORE, id.split(':')[0]!, start, end, status) };
};

describe('annotations (SA-72)', () => {
  it('a failed 6-hour window gives one marker; a 1-hour failure, a failure outside the period and a run still going give none', () => {
    const { db, sp, run } = setup();
    run('meta_ads:ledger', '2026-10-28T10:00:00Z', '2026-10-28T10:01:00Z', 'done');
    run('meta_ads:ledger', '2026-10-28T12:00:00Z', '2026-10-28T12:01:00Z', 'failed'); // 8:00 in New York
    run('meta_ads:ledger', '2026-10-28T13:00:00Z', '2026-10-28T13:01:00Z', 'failed');
    run('meta_ads:ledger', '2026-10-28T15:00:00Z', '2026-10-28T15:01:00Z', 'failed');
    run('meta_ads:ledger', '2026-10-28T17:59:00Z', '2026-10-28T18:00:00Z', 'done');
    run('meta_ads:ledger', '2026-10-29T20:00:00Z', '2026-10-29T20:01:00Z', 'failed'); // 1 h
    run('meta_ads:ledger', '2026-10-29T21:00:00Z', '2026-10-29T21:01:00Z', 'done');
    run('shopify:ledger', '2026-11-05T09:00:00Z', '2026-11-05T09:01:00Z', 'failed'); // after the period
    run('shopify:ledger', '2026-11-05T19:00:00Z', '2026-11-05T19:01:00Z', 'done');
    db.prepare("INSERT INTO sync_runs (integration_id, store_id, kind, started_at, status) VALUES ('tiktok_shop:ledger', 'ledger', 'tiktok_shop', '2026-10-30T00:00:00Z', 'interrupted')").run();
    expect(annotations(db, LEDGER_STORE, sp, LEDGER_NOW)).toEqual<SaAnnotation[]>([{ kind: 'data_health', date: '2026-10-28', text: 'Meta Ads sync failed for 6 h, synced again Oct 28' }]);
  });

  it('a source still failing is a marker from its first failure, on the period when it began before it', () => {
    const { db, sp, run } = setup();
    run('tiktok_shop:ledger', '2026-10-25T12:00:00Z', '2026-10-25T12:01:00Z', 'failed');
    expect(annotations(db, LEDGER_STORE, sp, LEDGER_NOW)).toEqual([{ kind: 'data_health', date: P1.from, text: 'TikTok Shop sync failing for 15 days so far' }]);
  });

  it("price tests and approved changes in the period, this store's only; a price change once, a denied request never", () => {
    const { db, sp } = setup();
    const test = db.prepare('INSERT INTO price_tests (approval_id, store_id, product_id, agent_id, title, from_price, to_price, changed_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    test.run('a-price', LEDGER_STORE, '8001', 'ledger:market_analyst', 'Vitamin C Glow Serum', 32, 34.5, '2026-10-27');
    test.run('g-price', 'glow', 'g1', 'glow:market_analyst', 'Glow Mask', 20, 25, '2026-10-27'); // another store's
    test.run('a-old', LEDGER_STORE, '8001', 'ledger:market_analyst', 'Vitamin C Glow Serum', 30, 32, '2026-10-20'); // before the period
    const ask = db.prepare("INSERT INTO approvals (id, store_id, agent_id, title, reason, action_json, status, created_at, decided_at) VALUES (?, ?, 'x', ?, 'r', ?, ?, '2026-10-29T00:00:00Z', ?)");
    ask.run('a-price', LEDGER_STORE, 'Raise the serum to $34.50', JSON.stringify({ kind: 'store.set_price', payload: {} }), 'approved', '2026-10-27T15:00:00Z');
    ask.run('a-budget', LEDGER_STORE, 'Raise Meta budget to $60/day', JSON.stringify({ kind: 'ads.set_budget', payload: {} }), 'approved', '2026-10-31T03:00:00Z'); // Oct 30 in New York
    ask.run('a-no', LEDGER_STORE, 'Pause the serum ad', JSON.stringify({ kind: 'ads.pause_campaign', payload: {} }), 'denied', '2026-10-29T15:00:00Z');
    ask.run('a-kb', LEDGER_STORE, 'Save a finding', JSON.stringify({ kind: 'kb.save', payload: {} }), 'approved', '2026-10-29T15:00:00Z'); // changes nothing live
    ask.run('g-budget', 'glow', 'Raise budget', JSON.stringify({ kind: 'ads.set_budget', payload: {} }), 'approved', '2026-10-29T15:00:00Z');
    expect(annotations(db, LEDGER_STORE, sp, LEDGER_NOW)).toEqual<SaAnnotation[]>([
      { kind: 'price_test', date: '2026-10-27', text: 'Price $32 → $34.50 on Vitamin C Glow Serum' },
      { kind: 'app_change', date: '2026-10-30', text: 'Approved: Raise Meta budget to $60/day' },
    ]);
  });

  it('GET /api/analytics/annotations reads one store and period; the Overview counts them', async () => {
    vi.useFakeTimers({ now: LEDGER_NOW, toFake: ['Date'] }); // the route's today
    const { db, run } = setup();
    run('meta_ads:ledger', '2026-10-28T12:00:00Z', '2026-10-28T12:01:00Z', 'failed');
    run('meta_ads:ledger', '2026-10-28T17:59:00Z', '2026-10-28T18:00:00Z', 'done');
    const app = createApp(db);
    const q = `store=${LEDGER_STORE}&period=custom&from=${P1.from}&to=${P1.to}`;
    expect(await (await app.request(`/api/analytics/annotations?${q}`)).json()).toEqual([{ kind: 'data_health', date: '2026-10-28', text: 'Meta Ads sync failed for 6 h, synced again Oct 28' }]);
    expect(((await (await app.request(`/api/analytics/overview?${q}`)).json()) as SaOverview).annotations).toBe(1);
    expect((await app.request('/api/analytics/annotations')).status).toBe(400);
    expect((await app.request(`/api/analytics/annotations?store=${LEDGER_STORE}&period=forever`)).status).toBe(400);
  });
});
