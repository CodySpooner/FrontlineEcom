import { describe, expect, it } from 'vitest';
import type { Integration } from '@frontline/shared';
import { importing } from './sync';

const shopify: Integration = { id: 'i1', kind: 'shopify', storeId: 'peak', status: 'connected', settings: {}, secretsSet: ['accessToken'], updatedAt: '2026-10-26T08:00:00Z' };

describe('importing', () => {
  it("says how far Shopify's first import has got", () => {
    expect(importing({ ...shopify, backfill: { through: '2025-03-04', done: false } })).toEqual({ through: '2025-03-04' });
  });

  it('is on, without a date, for a platform whose first sync has not finished', () => {
    expect(importing({ ...shopify, kind: 'etsy' })).toEqual({});
  });

  it('is off once synced, after a failed sync, and for non-platform connectors', () => {
    expect(importing({ ...shopify, syncedAt: '2026-10-26T09:00:00Z', backfill: { through: '2026-10-26', done: true } })).toBeUndefined();
    expect(importing({ ...shopify, status: 'error' })).toBeUndefined();
    expect(importing({ ...shopify, kind: 'meta_ads' })).toBeUndefined();
  });
});
