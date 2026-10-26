// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderApp, stubApi } from '../test-utils';
import { AskPalette } from './AskPalette';

const stores = [{ id: 'pawsome', name: 'Pawsome Gear', currency: 'USD' }];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Ask AI palette', () => {
  it('Ctrl+K opens it; typing filters pages, arrows + Enter open one', async () => {
    stubApi((url) => (url.startsWith('/api/stores') ? stores : []));
    renderApp(<AskPalette />);
    expect(screen.queryByRole('combobox')).toBeNull();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = await screen.findByRole('combobox');
    fireEvent.change(input, { target: { value: 'sett' } });
    // First the "ask" row, then the Settings page.
    await screen.findByText('Ask the Market Analyst · Pawsome Gear');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('where').textContent).toBe('/settings');
  });

  it("a question starts the selected store's Market Analyst and opens the chat", async () => {
    const fetch = stubApi((url, init) => {
      if (init?.method === 'POST') return { id: 'r1', agentId: 'pawsome:market_analyst', status: 'queued', transcript: [] };
      if (url.startsWith('/api/stores')) return stores;
    });
    renderApp(<AskPalette />);
    window.dispatchEvent(new Event('frontline:ask'));
    const input = await screen.findByRole('combobox');
    fireEvent.change(input, { target: { value: 'Why is profit down?' } });
    await screen.findByText('Ask the Market Analyst · Pawsome Gear');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/agents/pawsome%3Amarket_analyst?run=r1'));
    expect(fetch).toHaveBeenCalledWith(
      '/api/agents/pawsome%3Amarket_analyst/runs',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ task: 'Why is profit down?' }) }),
    );
  });
});
