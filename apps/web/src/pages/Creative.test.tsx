// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { renderApp, stubApi } from '../test-utils';
import { Creative } from './Creative';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const api = (provider: 'claude' | 'demo', signedIn?: boolean, creatives: object[] = []) =>
  stubApi((url) =>
    url.startsWith('/api/creatives')
      ? creatives
      : url === '/api/stores'
      ? [{ id: 'glow', name: 'Glow Haus', platform: 'shopify', niche: 'beauty', color: '#ff2a3a', currency: 'USD', timezone: 'UTC' }]
      : url === '/api/agents'
        ? [{ id: 'glow:copywriter', storeId: 'glow', role: 'copywriter', status: 'idle', engine: { provider } }]
        : url.startsWith('/api/claude-account')
          ? { signedIn, checkedAt: '2026-10-26T08:00:00Z' }
          : undefined,
  );

describe('Preview', () => {
  it('says what the ad is: format, hook, angle, length and offer (KB-20)', async () => {
    const c = { id: 'c1', storeId: 'glow', agentId: 'glow:copywriter', kind: 'copy', headline: 'Glow in 3 steps', primaryText: 'The routine.', credits: 0, source: 'agent', createdAt: '2026-10-26T08:00:00Z' };
    api('demo', undefined, [{ ...c, format: 'ugc', hook: 'problem-first', angle: 'saves time', lengthS: 15, offer: '20% off' }]);
    renderApp(<Creative />, '/creative?tab=copy');
    expect((await screen.findByLabelText('What the ad is')).textContent).toBe('UGC · Hook: problem-first · Angle: saves time · 15s · Offer: 20% off');
    cleanup();
    api('demo', undefined, [c]);
    renderApp(<Creative />, '/creative?tab=copy');
    await screen.findAllByText('The routine.');
    expect(screen.queryByLabelText('What the ad is')).toBeNull();
  });
});

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
    expect((await screen.findByText(/needs attention/)).closest('a')?.getAttribute('href')).toBe('/settings/integrations');
  });
});
