import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SA_METRICS, renderMetricsDoc } from './store-analytics';

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
