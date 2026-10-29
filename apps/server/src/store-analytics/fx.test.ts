// SA-53: decision 19's day rates: stored per day, then used by multi-store totals and ad spend.
import { describe, expect, it } from 'vitest';
import { loadRows } from '../analytics';
import { backfillRate } from '../connectors/common';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { refreshFx } from '../fx';
import { convertOn, rateOn } from './fx';

describe('rateOn (SA-53)', () => {
  const db = openDb();
  const put = db.prepare('INSERT INTO fx_rates (date, currency, rate) VALUES (?, ?, ?)');
  put.run('2026-10-23', 'USD', 1.16); // Friday
  put.run('2026-10-26', 'USD', 1.17); // Monday
  put.run('2026-10-26', 'GBP', 0.87);

  it("a weekend uses Friday's rate; a published day its own", () => {
    expect([rateOn(db, '2026-10-24', 'USD'), rateOn(db, '2026-10-25', 'USD'), rateOn(db, '2026-10-26', 'USD')]).toEqual([1.16, 1.16, 1.17]);
    expect(rateOn(db, '2026-10-25', 'EUR')).toBe(1);
  });

  it('nothing in the 7 days before: null, never the latest', () => {
    expect(rateOn(db, '2026-11-02', 'USD')).toBe(1.17); // 7 days after Monday's
    expect(rateOn(db, '2026-11-05', 'USD')).toBeNull(); // a 10-day gap
    expect(rateOn(db, '2026-10-22', 'USD')).toBeNull(); // before the first stored day
    expect(convertOn(db, '2026-10-25', 'USD', 'GBP')).toBeNull(); // no GBP that Friday
    expect(convertOn(db, '2026-10-26', 'USD', 'GBP')).toBeCloseTo(0.87 / 1.17);
  });
});

describe('day rates in use (SA-53)', () => {
  const day = (date: string, usd: number) => `<Cube time='${date}'><Cube currency='USD' rate='${usd}'/></Cube>`;
  const feed = (urls: string[], hist = true) =>
    (async (url: string) => {
      urls.push(url);
      if (url.includes('eurofxref-daily')) return new Response(`<Cube>${day('2026-10-26', 1.2)}</Cube>`);
      if (url.includes('eurofxref-hist')) return hist ? new Response(`<Cube>${day('2026-10-26', 1.2)}${day('2026-10-23', 1.1)}</Cube>`) : new Response('', { status: 503 });
      return new Response('', { status: 503 });
    }) as typeof fetch;

  it('refreshFx stores the day; the first run loads the history, retried after a failure, then never again', async () => {
    const db = openDb();
    const urls: string[] = [];
    await refreshFx(db, feed(urls, false));
    expect([rateOn(db, '2026-10-26', 'USD'), rateOn(db, '2026-10-23', 'USD')]).toEqual([1.2, null]);
    await refreshFx(db, feed(urls));
    expect(rateOn(db, '2026-10-23', 'USD')).toBe(1.1);
    await refreshFx(db, feed(urls));
    expect(urls.filter((u) => u.includes('eurofxref-hist'))).toHaveLength(2);
  });

  it("multi-store totals and ad spend convert each day at that day's rate", async () => {
    const db = openDb();
    seedDemo(db, '2026-10-26');
    db.prepare("UPDATE stores SET currency = 'EUR' WHERE id = 'glow'").run();
    await refreshFx(db, feed([]));
    const rows = (ids: string[]) => Object.fromEntries(loadRows(db, ids, 7, '2026-10-26').filter((r) => r.storeId === 'glow').map((r) => [r.date, r.revenue]));
    const [own, both] = [rows(['glow']), rows(['glow', 'pawsome'])];
    expect(both['2026-10-23']).toBeCloseTo(own['2026-10-23']! * 1.1);
    expect(both['2026-10-25']).toBeCloseTo(own['2026-10-25']! * 1.1); // Sunday: Friday's
    expect(both['2026-10-26']).toBeCloseTo(own['2026-10-26']! * 1.2);
    // A EUR ad account on the USD store: each day its own rate, a re-read (no history download) too.
    const urls: string[] = [];
    const on = await backfillRate(db, 'pawsome', 'EUR', 1.2, feed(urls), false);
    expect([on('2026-10-23'), on('2026-10-26'), on('2026-10-10')]).toEqual([1.1, 1.2, 1.2]); // no stored day: today's, as before
    expect(urls).toEqual([]);
  });
});
