import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SA_METRICS, changeOf, combineStatus, comparePeriod, ratio, renderMetricsDoc, resolvePeriod, validateCustom, type SaPeriod } from './store-analytics';

describe('periods', () => {
  const p = (x: ReturnType<typeof resolvePeriod>) => x as SaPeriod;

  it('ends the default presets yesterday, as full days', () => {
    expect(resolvePeriod('last30', '2026-10-28')).toEqual({ preset: 'last30', from: '2026-09-28', to: '2026-10-27', days: 30, partial: false });
    expect(resolvePeriod('yesterday', '2026-10-28')).toMatchObject({ from: '2026-10-27', to: '2026-10-27', days: 1 });
  });

  it('includes today only in today, mtd and ytd, flagged partial', () => {
    expect(resolvePeriod('today', '2026-10-28')).toMatchObject({ from: '2026-10-28', days: 1, partial: true });
    expect(resolvePeriod('ytd', '2026-10-28')).toMatchObject({ from: '2026-01-01', to: '2026-10-28', partial: true });
    // mtd on the 1st is today alone
    expect(resolvePeriod('mtd', '2026-11-01')).toEqual({ preset: 'mtd', from: '2026-11-01', to: '2026-11-01', days: 1, partial: true });
  });

  it('takes last month whole, across a year end', () => {
    expect(resolvePeriod('last_month', '2027-01-15')).toMatchObject({ from: '2026-12-01', to: '2026-12-31', days: 31 });
    expect(resolvePeriod('last_month', '2028-03-01')).toMatchObject({ from: '2028-02-01', to: '2028-02-29', days: 29 });
  });

  it('refuses a custom range over 730 days, reversed, after today or malformed', () => {
    expect(validateCustom('2024-10-28', '2026-10-27', '2026-10-28')).toBeUndefined(); // 730 days
    expect(validateCustom('2024-10-27', '2026-10-27', '2026-10-28')).toBe('A range can be at most 730 days.'); // 731
    expect(validateCustom('2026-10-10', '2026-10-01', '2026-10-28')).toBe('The start is after the end.');
    expect(validateCustom('2026-10-10', '2026-10-29', '2026-10-28')).toBe('The range ends after today.');
    expect(validateCustom('2026-02-30', '2026-03-01', '2026-10-28')).toBe('Dates must be YYYY-MM-DD.');
    expect(resolvePeriod('custom', '2026-10-28', { from: '2024-10-27', to: '2026-10-27' })).toBe('A range can be at most 730 days.');
    expect(resolvePeriod('custom', '2026-10-28', { from: '2026-10-01', to: '2026-10-28' })).toMatchObject({ days: 28, partial: true });
  });

  it('compares with the days just before, or the same dates a year back (Feb 29 → Feb 28)', () => {
    const last30 = p(resolvePeriod('last30', '2026-10-28'));
    expect(comparePeriod(last30, 'previous', '2020-01-01')).toEqual({ from: '2026-08-29', to: '2026-09-27', days: 30 });
    const leap = p(resolvePeriod('custom', '2028-03-10', { from: '2028-02-29', to: '2028-03-06' }));
    expect(comparePeriod(leap, 'year', '2020-01-01')).toEqual({ from: '2027-02-28', to: '2027-03-06', days: 7 });
    expect(comparePeriod(last30, 'none', '2020-01-01')).toBeUndefined();
  });

  it('has no comparison before the history starts, never a zero-filled one', () => {
    const last30 = p(resolvePeriod('last30', '2026-10-28'));
    expect(comparePeriod(last30, 'previous', '2026-09-01')).toEqual({ unavailable: 'History starts 2026-09-01' });
    expect(comparePeriod(last30, 'year', undefined)).toEqual({ unavailable: 'No history yet' });
  });
});

describe('changes and ratios', () => {
  it('handles zero, negative and missing baselines', () => {
    expect(changeOf(120, 0, 'money')).toEqual({ kind: 'new' });
    expect(changeOf(0, 0, 'money')).toEqual({ kind: 'pct', value: 0 });
    expect(changeOf(50, -100, 'money')).toEqual({ kind: 'pct', value: 150 }); // (50 − −100) ÷ |−100|
    expect(changeOf(-150, -100, 'money')).toEqual({ kind: 'pct', value: -50 });
    expect(changeOf(null, 10, 'money')).toEqual({ kind: 'unavailable' });
    expect(changeOf(10, null, 'count')).toEqual({ kind: 'unavailable' });
  });

  it('changes ratios in percentage points', () => {
    const c = changeOf(0.0179, 0.0177, 'ratio');
    expect(c.kind).toBe('points');
    expect((c as { value: number }).value).toBeCloseTo(0.02, 10); // 1.79% vs 1.77% = +0.02 pts
  });

  it('divides summed parts and has no ratio over zero', () => {
    expect(ratio(30, 1200)).toBe(0.025);
    expect(ratio(30, 0)).toBeNull();
    expect(ratio(null, 5)).toBeNull();
  });

  it('takes the weakest status', () => {
    expect(combineStatus('ok', 'estimated', 'partial')).toBe('estimated');
    expect(combineStatus('ok', 'unavailable', 'demo')).toBe('unavailable');
    expect(combineStatus()).toBe('ok');
  });
});

const DOC = new URL('../../../docs/features/store-analytics-metrics.md', import.meta.url);

/**
 * Each id@version's formula, hashed when it shipped. A changed formula needs a new version (and a new line here),
 * never an edited hash: reports and findings saved under the old version must still mean what they said.
 */
const FROZEN: Record<string, string> = {
  'net_sales@1': '6154e34604aa',
  'gross_sales@1': '83737f4286c6',
  'discounts@1': '3cad6bde5b8e',
  'refunds@1': 'd8edf2fef81e',
  'orders@1': '1d1b5558fc3f',
  'aov@1': 'f7462577b6fd',
  'units@1': 'ddfb45f8c3c0',
  'cancelled_orders@1': '2e13696098c7',
  'refund_rate@1': '78f06cd88337',
  'sessions@1': '7ef345f8be6c',
  'site_conversion@1': 'ffe9bbf95040',
  'ad_spend@1': '9b7ebafd7bee',
  'platform_roas@1': 'f5c6af0ec03a',
  'contribution_before_ads@1': 'dbe189fed7b2',
  'contribution_after_ads@1': '5cac37a27096',
  'cost_coverage@1': 'a0c58fbee784',
  'fees@1': '7d7f78cd5dcc',
  'stock_cover@1': '26d2f6e9e879',
};

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 12);

describe('SA_METRICS', () => {
  it('keeps every id@version formula frozen', () => {
    for (const x of Object.values(SA_METRICS)) {
      const key = `${x.id}@${x.version}`;
      expect(FROZEN[key], `${key} is new: add its hash to FROZEN`).toBeDefined();
      expect(hash(x.formula), `${key}'s formula changed: give it a new version instead`).toBe(FROZEN[key]);
    }
  });

  it('keys each metric by its own id', () => {
    for (const [k, x] of Object.entries(SA_METRICS)) expect(x.id).toBe(k);
  });

  it('matches the committed metrics doc', () => {
    const doc = renderMetricsDoc();
    if (process.env.UPDATE_METRICS_DOC) writeFileSync(DOC, doc);
    expect(readFileSync(DOC, 'utf8').replace(/\r\n/g, '\n'), 'regenerate: UPDATE_METRICS_DOC=1 pnpm exec vitest run packages/shared/src/store-analytics.test.ts').toBe(doc);
  });
});
