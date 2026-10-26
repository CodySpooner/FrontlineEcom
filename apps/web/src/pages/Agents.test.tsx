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

  it('says how much each agent has learned about the store, linking to its memory', async () => {
    stubApi((url) =>
      url === '/api/stores'
        ? [{ id: 'peak', name: 'Peak Fit', platform: 'shopify', niche: 'fitness', color: '#ff2a3a', currency: 'USD', timezone: 'UTC' }]
        : url === '/api/agents'
          ? ['copywriter', 'ad_strategist'].map((role) => ({ id: `peak:${role}`, storeId: 'peak', role, status: 'idle', level: 2, rank: 'recruit', enabled: true }))
          : url === '/api/stores/peak/memory'
            ? [
                { id: 'm1', storeId: 'peak', agentId: 'peak:copywriter', kind: 'learning', text: 'Short hooks win', confidence: 0.7, tags: [], createdAt: '2026-10-26T08:00:00Z' },
                { id: 'm2', storeId: 'peak', agentId: 'peak:copywriter', kind: 'fact', text: 'Ships from LA', confidence: 0.9, tags: [], createdAt: '2026-10-26T08:00:00Z' },
                { id: 'm3', storeId: 'peak', agentId: 'owner', kind: 'fact', text: 'No discounts', confidence: 1, tags: [], createdAt: '2026-10-26T08:00:00Z' },
              ]
            : url.startsWith('/api/analytics/summary')
              ? { totals: { revenue: 1000, profit: 200 } }
              : undefined,
    );
    renderApp(<Agents />, '/agents');
    const learned = await screen.findByRole('link', { name: '2 things learned about Peak Fit' });
    expect(learned.getAttribute('href')).toBe('/agents/peak%3Acopywriter?tab=memory&by=agent');
    // Nothing learned yet: no line, rather than a "0".
    expect(screen.getAllByRole('link', { name: /learned about/ })).toHaveLength(1);
  });
});

describe('AI agents with no stores', () => {
  it('sends the owner to Settings, where stores are added', async () => {
    stubApi((url) => (url === '/api/stores' || url === '/api/agents' ? [] : undefined));
    renderApp(<Agents />, '/agents');
    expect((await screen.findByRole('link', { name: 'Add a store' })).getAttribute('href')).toBe('/settings');
  });
});
