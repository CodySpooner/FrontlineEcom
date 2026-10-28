// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderApp, reply, stubApi } from '../test-utils';
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
    // First the "ask" rows (the Market Analyst, the knowledge base), then the Settings page.
    await screen.findByText('Ask the Market Analyst · Pawsome Gear');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('where').textContent).toBe('/settings');
  });

  it("opens with a question started elsewhere, such as a knowledge card's Use in a task, for that card's store only", async () => {
    stubApi((url) => (url.startsWith('/api/stores') ? [{ id: 'glow', name: 'Glow Haus', currency: 'USD' }, ...stores] : []));
    renderApp(<AskPalette />);
    window.dispatchEvent(new CustomEvent('frontline:ask', { detail: { q: 'Use [kb:c1] to ', storeId: 'pawsome' } }));
    const input = (await screen.findByRole('combobox')) as HTMLInputElement;
    expect(input.value).toBe('Use [kb:c1] to ');
    expect(await screen.findByText('Ask the Market Analyst · Pawsome Gear')).toBeTruthy();
    expect(screen.queryByText('Ask the Market Analyst · Glow Haus')).toBeNull();
    // A General card's: every store in view.
    fireEvent.keyDown(input, { key: 'Escape' });
    window.dispatchEvent(new CustomEvent('frontline:ask', { detail: { q: 'Use [kb:g1] to ' } }));
    expect(await screen.findByText('Ask the Market Analyst · Glow Haus')).toBeTruthy();
    expect(screen.getByText('Ask the Market Analyst · Pawsome Gear')).toBeTruthy();
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

  it("asks the knowledge base: the store's Market Analyst answers from its cards, in its chat", async () => {
    const fetch = stubApi((url, init) => {
      if (url === '/api/kb/ask') return { measured: [], research: [], unproven: [], run: { id: 'r9', agentId: 'pawsome:market_analyst', status: 'queued', transcript: [] } };
      if (url.startsWith('/api/stores')) return stores;
    });
    renderApp(<AskPalette />);
    window.dispatchEvent(new Event('frontline:ask'));
    const input = await screen.findByRole('combobox');
    fireEvent.change(input, { target: { value: 'Which hooks work? ' } });
    fireEvent.click(await screen.findByText('Ask the knowledge base · Pawsome Gear'));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/agents/pawsome%3Amarket_analyst?run=r9'));
    expect(fetch).toHaveBeenCalledWith('/api/kb/ask', expect.objectContaining({ method: 'POST', body: JSON.stringify({ ws: 'pawsome', question: 'Which hooks work?' }) }));
  });

  it("says plainly when the knowledge base doesn't know, and offers to research it", async () => {
    stubApi((url) => (url === '/api/kb/ask' ? { measured: [], research: [], unproven: [] } : url.startsWith('/api/stores') ? stores : undefined));
    renderApp(<AskPalette />);
    window.dispatchEvent(new Event('frontline:ask'));
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'Live shopping?' } });
    fireEvent.click(await screen.findByText('Ask the knowledge base · Pawsome Gear'));
    const status = await within(screen.getByRole('dialog')).findByRole('status');
    expect(status.textContent).toBe('The knowledge base doesn\'t know yet: no card answers "Live shopping?". Research it');
    fireEvent.click(screen.getByRole('link', { name: 'Research it' }));
    expect(screen.getByTestId('where').textContent).toBe('/knowledge?view=research&ws=pawsome&ask=Live+shopping%3F');
  });

  it('with several stores in view, offers each Market Analyst, so the question goes where the owner picks', async () => {
    const fetch = stubApi((url, init) => {
      if (init?.method === 'POST') return { id: 'r2', agentId: 'glow:market_analyst', status: 'queued', transcript: [] };
      if (url.startsWith('/api/stores')) return [...stores, { id: 'glow', name: 'Glow Haus', currency: 'USD' }];
    });
    renderApp(<AskPalette />);
    window.dispatchEvent(new Event('frontline:ask'));
    const input = await screen.findByRole('combobox');
    fireEvent.change(input, { target: { value: 'Which ads should I pause?' } });
    await screen.findByText('Ask the Market Analyst · Glow Haus');
    expect(screen.getByText('Ask the Market Analyst · Pawsome Gear')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/agents/glow%3Amarket_analyst/runs', expect.objectContaining({ method: 'POST' })));
  });

  it("with several stores in view, the knowledge base is also asked across all workspaces, the first store's Market Analyst answering", async () => {
    const fetch = stubApi((url) => {
      if (url === '/api/kb/ask') return reply({ error: "Today's budget for this agent ($0.3) is used up. Raise it in its settings." }, 409);
      if (url.startsWith('/api/stores')) return [...stores, { id: 'glow', name: 'Glow Haus', currency: 'USD' }];
    });
    renderApp(<AskPalette />);
    window.dispatchEvent(new Event('frontline:ask'));
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'Which hooks work?' } });
    expect(await screen.findByText('Ask the knowledge base · Glow Haus')).toBeTruthy();
    fireEvent.click(screen.getByText('Ask the knowledge base · All workspaces'));
    fireEvent.click(await screen.findByRole('link', { name: "Raise the agent's budget" }));
    expect(screen.getByTestId('where').textContent).toBe('/agents/pawsome%3Amarket_analyst?tab=settings');
    expect(fetch).toHaveBeenCalledWith('/api/kb/ask', expect.objectContaining({ body: JSON.stringify({ ws: 'all', question: 'Which hooks work?', payerId: 'pawsome' }) }));
  });

  it("a budget refusal links to the agent's settings and closes the palette on the way", async () => {
    stubApi((url, init) => {
      if (init?.method === 'POST') return reply({ error: "Today's budget for this agent ($0.3) is used up. Raise it in its settings." }, 409);
      if (url.startsWith('/api/stores')) return stores;
    });
    renderApp(<AskPalette />);
    window.dispatchEvent(new Event('frontline:ask'));
    const input = await screen.findByRole('combobox');
    fireEvent.change(input, { target: { value: 'Why is profit down?' } });
    await screen.findByText('Ask the Market Analyst · Pawsome Gear');
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('link', { name: "Raise the agent's budget" }));
    expect(screen.getByTestId('where').textContent).toBe('/agents/pawsome%3Amarket_analyst?tab=settings');
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});
