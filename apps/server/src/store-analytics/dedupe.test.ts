// SA-51: markChannelCopies against the ledger fixture's duplicate cases.
import { describe, expect, it } from 'vitest';
import { rebuildRevenue } from '../connectors/common';
import { openDb } from '../db';
import { dedupeSummary, markChannelCopies } from './dedupe';
import { LEDGER_ORDERS, LEDGER_PERIODS, LEDGER_STORE, seedLedgerStore } from './fixture';
import { reconcile } from './reconcile';

const marks = (db: ReturnType<typeof openDb>) =>
  Object.fromEntries(db.prepare('SELECT id, duplicate_of AS d FROM orders WHERE store_id = ? AND duplicate_of IS NOT NULL').all(LEDGER_STORE).map((r) => [String(r.id), String(r.d)]));
const revenue = (db: ReturnType<typeof openDb>) => db.prepare('SELECT date, revenue, orders FROM daily_metrics WHERE store_id = ? ORDER BY date').all(LEDGER_STORE);
const days = LEDGER_ORDERS.map((o) => o.day);

describe('markChannelCopies (SA-51)', () => {
  it("recomputes the fixture's marks from scratch, and its revenue with them", () => {
    const db = openDb();
    seedLedgerStore(db);
    const [expected, seeded] = [marks(db), revenue(db)];
    expect(expected).toEqual({ '#1009': 'tt-5770001', '#1010': 'tt-5770099' }); // matched by TikTok's id; an unmatched copy inside the covered days
    db.prepare('UPDATE orders SET duplicate_of = NULL WHERE store_id = ?').run(LEDGER_STORE);
    rebuildRevenue(db, LEDGER_STORE, days);
    expect(revenue(db)).not.toEqual(seeded); // counted twice while unmarked
    markChannelCopies(db, LEDGER_STORE);
    expect(marks(db)).toEqual(expected); // #1011 (Oct 21, before TikTok Shop's sync covers) still counts
    expect(revenue(db)).toEqual(seeded);
    markChannelCopies(db, LEDGER_STORE); // nothing changes the second time
    expect(marks(db)).toEqual(expected);
  });

  it('a store with no marketplace integration marks nothing', () => {
    const db = openDb();
    seedLedgerStore(db);
    db.prepare("DELETE FROM integrations WHERE id = 'tiktok_shop:ledger'").run();
    markChannelCopies(db, LEDGER_STORE);
    expect(marks(db)).toEqual({});
  });

  it("Amazon as a channel: its channel_daily days; no channel order id is still a copy", () => {
    const db = openDb();
    seedLedgerStore(db);
    db.prepare("INSERT INTO integrations (id, kind, store_id, status, settings_json, encrypted_credentials, updated_at) VALUES ('amazon:ledger', 'amazon', 'ledger', 'connected', '{}', '', '2026-11-09')").run();
    db.prepare("INSERT INTO channel_daily (store_id, channel, date, revenue, orders) VALUES ('ledger', 'amazon', '2026-11-01', 64, 2)").run();
    db.prepare("UPDATE orders SET channel = 'amazon', channel_order_id = '113-77' WHERE store_id = 'ledger' AND id = '#1013'").run();
    db.prepare("UPDATE orders SET channel = 'amazon' WHERE store_id = 'ledger' AND id = '#1014'").run();
    db.prepare("UPDATE orders SET channel = 'amazon', channel_order_id = '113-01' WHERE store_id = 'ledger' AND id = '#1008'").run(); // Oct 29: no Amazon day
    markChannelCopies(db, LEDGER_STORE);
    expect(marks(db)).toMatchObject({ '#1013': 'amz-113-77', '#1014': 'amazon' });
    expect(marks(db)['#1008']).toBeUndefined();
  });
});

describe('dedupeSummary (SA-52)', () => {
  const { P1, P2 } = LEDGER_PERIODS;

  it("P1: one copy matched by id, one left out without a match; P2: one counted outside TikTok Shop's days", () => {
    const db = openDb();
    seedLedgerStore(db);
    expect(dedupeSummary(db, LEDGER_STORE, P1.from, P1.to)).toEqual({
      channels: [{ channel: 'tiktok_shop', matched: 1, unmatched: 1, outside: 0, ids: { matched: ['#1009'], unmatched: ['#1010'], outside: [] } }],
      unmapped: 0,
      unmappedIds: [],
      lines: ['1 TikTok Shop orders matched, 0 counted twice', '1 copy left out without a match'],
    });
    expect(dedupeSummary(db, LEDGER_STORE, P2.from, P2.to)).toEqual({
      channels: [{ channel: 'tiktok_shop', matched: 0, unmatched: 0, outside: 1, ids: { matched: [], unmatched: [], outside: ['#1011'] } }], // Oct 21
      unmapped: 0,
      unmappedIds: [],
      lines: ["1 TikTok Shop orders counted from Shopify, outside the days TikTok Shop has synced"],
    });
  });

  it('orders from an unmapped app get the warning, never a mark; reconcile carries the summary', () => {
    const db = openDb();
    seedLedgerStore(db);
    db.prepare("UPDATE orders SET channel = 'other' WHERE store_id = 'ledger' AND id IN ('#1013', '#1014')").run();
    markChannelCopies(db, LEDGER_STORE);
    const r = reconcile(db, LEDGER_STORE, P1.from, P1.to, 'refund_day');
    expect(r.dedupe).toMatchObject({ unmapped: 2 });
    expect(r.dedupe!.lines.at(-1)).toBe("2 orders from other sales-channel apps may duplicate a marketplace's: they're never matched automatically");
    expect(marks(db)['#1013']).toBeUndefined();
  });
});
