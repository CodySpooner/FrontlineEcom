import { describe, expect, it } from 'vitest';
import { openDb } from '../db';
import { insertStore } from '../stores';
import { historyStart, sameClock, storePeriod } from './period';

const setup = (demo = false, timezone = 'America/New_York') => {
  const db = openDb();
  insertStore(db, { id: 's1', name: 'Glow Haus', platform: 'shopify', niche: 'beauty', currency: 'USD', timezone, color: '#ff2a3a', connected: !demo }, demo);
  return db;
};
const q = (o: Record<string, string>) => (k: string) => o[k];
const at = (iso: string) => Date.parse(iso);

describe('storePeriod', () => {
  it("dates the period in the store's own zone, with its abbreviation", () => {
    const db = setup();
    db.prepare("INSERT INTO daily_metrics (store_id, date) VALUES ('s1', '2025-01-01')").run();
    // 02:00 UTC on Oct 28 is still Oct 27 in New York
    const p = storePeriod(db, 's1', q({}), at('2026-10-28T02:00:00Z'));
    expect(p).toMatchObject({ today: '2026-10-27', zone: 'America/New_York', zoneAbbr: 'ET', period: { from: '2026-09-27', to: '2026-10-26', days: 30 } });
    expect(p).toMatchObject({ compare: { from: '2026-08-28', to: '2026-09-26' } });
  });

  it("labels a demo store's days as this computer's", () => {
    const p = storePeriod(setup(true), 's1', q({}));
    expect(p).toMatchObject({ zoneLabel: "This computer's time (demo data)" });
    expect((p as { zone?: string }).zone).toBeUndefined();
  });

  it('has no comparison before the first order or daily total', () => {
    const db = setup();
    db.prepare("INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, local_date) VALUES ('s1', '#1', '2026-09-10T12:00:00Z', 10, 'paid', 'fulfilled', '2026-09-10')").run();
    expect(historyStart(db, 's1')).toBe('2026-09-10');
    expect(storePeriod(db, 's1', q({}), at('2026-10-28T16:00:00Z'))).toMatchObject({ compare: { unavailable: 'History starts 2026-09-10' } });
  });

  it("cuts today's comparison day at the same local clock time, across a DST change", () => {
    const db = setup();
    db.prepare("INSERT INTO daily_metrics (store_id, date) VALUES ('s1', '2025-01-01')").run();
    // Nov 1 2026 is New York's DST end (25 h). At 15:30 EST (20:30 UTC), the previous day (EDT) is cut at 15:30 EDT = 19:30 UTC.
    const p = storePeriod(db, 's1', q({ period: 'today' }), at('2026-11-01T20:30:00Z'));
    expect(p).toMatchObject({ today: '2026-11-01', period: { partial: true }, compare: { from: '2026-10-31', to: '2026-10-31' }, cut: '2026-10-31T19:30:00.000Z' });
    // 15.5 local hours of a 25-hour day (00:00 EDT = 04:00 UTC, so 16.5 elapsed hours)
    expect((p as { fraction: number }).fraction).toBeCloseTo(16.5 / 25, 6);
  });

  it('works on the DST start day (23 h)', () => {
    // Mar 8 2026 02:00 EST → 03:00 EDT. At 12:00 EDT (16:00 UTC) 11 of 23 hours have gone by.
    const db = setup();
    db.prepare("INSERT INTO daily_metrics (store_id, date) VALUES ('s1', '2025-01-01')").run();
    const p = storePeriod(db, 's1', q({ period: 'today' }), at('2026-03-08T16:00:00Z'));
    expect((p as { fraction: number }).fraction).toBeCloseTo(11 / 23, 6);
    expect(p).toMatchObject({ cut: '2026-03-07T17:00:00.000Z' }); // 12:00 EST
    expect(sameClock('2026-03-07', at('2026-03-08T16:00:00Z'), 'America/New_York')).toBe(at('2026-03-07T17:00:00Z'));
  });

  it('refuses unknown presets, compare modes and bad custom ranges', () => {
    const db = setup();
    expect(storePeriod(db, 's1', q({ period: 'last45' }))).toMatch(/^period must be one of/);
    expect(storePeriod(db, 's1', q({ compare: 'week' }))).toBe('compare must be previous, year or none');
    expect(storePeriod(db, 's1', q({ period: 'custom', from: '2023-01-01', to: '2025-01-01' }), at('2026-10-28T16:00:00Z'))).toBe('A range can be at most 730 days.');
  });
});
