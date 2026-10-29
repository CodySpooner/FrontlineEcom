// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp, reply } from '../test-utils';
import { Analytics, TABS } from './Analytics';

function stub(stores: unknown[]) {
  const fetch = vi.fn(async (url: string) => {
    if (url === '/api/stores') return reply(stores);
    if (url.startsWith('/api/analytics/context')) return reply({ storeId: 'a', name: 'Store A', demo: true });
    return new Promise<Response>(() => {}); // the legacy view's reads stay loading
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('Store Analytics shell (SA-62)', () => {
  it('lists only the registered tabs; an unregistered tab in the URL opens Overview', async () => {
    stub([{ id: 'a', name: 'Store A' }]);
    renderApp(<Analytics />, '/analytics?store=a&tab=customers');
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(TABS.map((t) => t.label));
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Overview');
    expect(screen.getByRole('tabpanel', { name: 'Overview' })).toBeTruthy();
    expect(await screen.findAllByText('Demo data')).toHaveLength(2); // the store's context says demo (strip, or page under 640px)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Store Analytics');
  });

  it('zero stores: an empty state that links to adding one, and no analytics request', async () => {
    const fetch = stub([]);
    renderApp(<Analytics />, '/analytics');
    const add = await screen.findByRole('link', { name: 'Add a store' });
    expect(add.getAttribute('href')).toContain('/settings');
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/stores', undefined));
    expect(fetch.mock.calls.filter(([u]) => String(u).startsWith('/api/analytics'))).toEqual([]);
    expect(screen.queryByRole('tablist')).toBeNull();
  });
});
