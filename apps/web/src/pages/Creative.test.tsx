// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { renderApp, stubApi } from '../test-utils';
import { Creative } from './Creative';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const api = (provider: 'claude' | 'demo', signedIn?: boolean) =>
  stubApi((url) =>
    url === '/api/stores'
      ? [{ id: 'glow', name: 'Glow Haus', platform: 'shopify', niche: 'beauty', color: '#ff2a3a', currency: 'USD', timezone: 'UTC' }]
      : url === '/api/agents'
        ? [{ id: 'glow:copywriter', storeId: 'glow', role: 'copywriter', status: 'idle', engine: { provider } }]
        : url.startsWith('/api/claude-account')
          ? { signedIn, checkedAt: '2026-10-26T08:00:00Z' }
          : undefined,
  );

describe('Claude integration chip', () => {
  it("says the copy is demo when the store's agent runs on the demo engine", async () => {
    const fetch = api('demo');
    renderApp(<Creative />, '/creative?tab=copy');
    expect(await screen.findByText(/demo copy/)).toBeTruthy();
    expect(fetch.mock.calls.some(([url]) => String(url).startsWith('/api/claude-account'))).toBe(false);
  });

  it('flags a signed-out Claude login on a live store', async () => {
    api('claude', false);
    renderApp(<Creative />, '/creative?tab=copy');
    expect((await screen.findByText(/needs attention/)).closest('a')?.getAttribute('href')).toBe('/integrations');
  });
});
