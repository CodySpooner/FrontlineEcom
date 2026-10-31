// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import type { KbControlsState } from '@frontline/shared';
import { renderApp, stubApi } from '../test-utils';
import { ResearchControls } from './Controls';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const STORES = [{ id: 'pawsome', name: 'Pawsome Gear', connected: false, platform: 'shopify', niche: 'pets', color: '#f00', currency: 'USD', timezone: 'UTC' }];
const OFF: KbControlsState = {
  autonomous: false, roles: {}, triggers: ['conflict', 'anomaly', 'gap', 'stale'], taskBudgetUsd: 1, dailyBudgetUsd: 3, depth: 'standard', approval: true, review: true, trustedDomains: [], blockedDomains: [], freshDays: {}, retentionDays: null, reservedUsd: 0,
};
const render = (ws = 'pawsome', controls: KbControlsState = OFF) => {
  const fetch = stubApi((url) => {
    if (url === '/api/stores') return STORES;
    if (url.startsWith('/api/kb/controls')) return controls;
  });
  renderApp(<ResearchControls ws={ws} />);
  return { fetch };
};

describe('ResearchControls', () => {
  it("says what's on and what's reserved today", async () => {
    render();
    expect(await screen.findByText('Off: agents research only when you or a task asks.')).toBeTruthy();
    cleanup();
    render('pawsome', { ...OFF, autonomous: true, reservedUsd: 0.4 });
    expect(await screen.findByText('On: $0.40 of $3.00 reserved today')).toBeTruthy();
  });

  // The controls themselves moved to Settings → Knowledge (ST-25): its tests are in settings/sections/Knowledge.test.tsx.
  it('Controls opens Settings → Knowledge on the workspace: the store, or General', async () => {
    render();
    expect((await screen.findByRole('link', { name: 'Controls' })).getAttribute('href')).toBe('/settings/knowledge?store=pawsome');
    cleanup();
    render('general');
    expect((await screen.findByRole('link', { name: 'Controls' })).getAttribute('href')).toBe('/settings/knowledge');
  });

  it('All workspaces has none of its own', async () => {
    const { fetch } = render('all');
    expect(await screen.findByText('Pick a workspace to see its research controls.')).toBeTruthy();
    expect(fetch.mock.calls.some(([u]) => String(u).startsWith('/api/kb/controls'))).toBe(false);
  });
});
