// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { renderApp, stubApi } from '../test-utils';
import { Agents } from './Agents';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AI agents', () => {
  it("shows the store's health over the last 30 days above its squad", async () => {
    const fetch = stubApi((url) =>
      url === '/api/stores'
        ? [{ id: 'peak', name: 'Peak Fit', platform: 'shopify', niche: 'fitness', color: '#ff2a3a', currency: 'USD', timezone: 'UTC' }]
        : url.startsWith('/api/analytics/summary')
          ? { totals: { revenue: 1000, profit: 200 } }
          : undefined,
    );
    renderApp(<Agents />, '/agents');
    expect(await screen.findByText('Winning')).toBeTruthy();
    expect(screen.getByText('20% net margin, last 30 days')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Store health' }).getAttribute('aria-valuenow')).toBe('67');
    expect(fetch.mock.calls.map(([url]) => url)).toContain('/api/analytics/summary?stores=peak&range=30');
  });
});
