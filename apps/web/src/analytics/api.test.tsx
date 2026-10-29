// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp, reply, stubApi } from '../test-utils';
import { useSaContext } from './api';
import { useAnalyticsState } from './state';

const STORES = [{ id: 'a', name: 'Store A' }, { id: 'b', name: 'Store B' }, { id: 'c', name: 'Store C' }];

function Probe() {
  const s = useAnalyticsState();
  const ctx = useSaContext(s.store);
  return (
    <div>
      <p data-testid="state">{JSON.stringify({ store: s.store, tab: s.tab, period: s.period, compare: s.compare, refunds: s.refunds, filters: s.filters, page: s.page, product: s.product })}</p>
      <p data-testid="ctx">{s.noStores ? 'no stores' : !s.store ? 'no store' : ctx.isPending ? 'loading' : ctx.data?.name}</p>
      <button onClick={() => s.set({ store: 'b' })}>B</button>
      <button onClick={() => s.set({ period: 'last7', page: 3, product: '8001', filters: { channel: ['site'] } })}>Narrow</button>
    </div>
  );
}
const state = () => JSON.parse(screen.getByTestId('state').textContent!);

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('Store Analytics URL state and hooks (SA-61)', () => {
  it("a store switch shows the new store's loading state, then its data, never the old store's late reply", async () => {
    const pending: Record<string, (r: Response) => void> = {};
    const fetch = vi.fn(async (url: string, _init?: RequestInit) =>
      url === '/api/stores' ? reply(STORES) : new Promise<Response>((done) => (pending[new URL(url, 'http://x').searchParams.get('store')!] = done)),
    );
    vi.stubGlobal('fetch', fetch);
    renderApp(<Probe />, '/analytics?store=a');
    await waitFor(() => expect(pending.a).toBeDefined());
    expect(screen.getByTestId('ctx').textContent).toBe('loading');
    fireEvent.click(screen.getByText('B'));
    await waitFor(() => expect(pending.b).toBeDefined());
    expect(screen.getByTestId('ctx').textContent).toBe('loading');
    await act(async () => {
      pending.a!(reply({ name: 'Store A' })); // A answers late
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(screen.getByTestId('ctx').textContent).toBe('loading');
    act(() => pending.b!(reply({ name: 'Store B' })));
    await waitFor(() => expect(screen.getByTestId('ctx').textContent).toBe('Store B'));
    // Keyed by store, with react-query's signal passed on.
    const [, init] = fetch.mock.calls.find(([u]) => String(u).startsWith('/api/analytics/context?store=b'))!;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("a store whose data is on screen gives way to the next store's loading state, not its own numbers", async () => {
    const pending: Record<string, (r: Response) => void> = {};
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === '/api/stores' ? reply(STORES) : new Promise<Response>((done) => (pending[new URL(url, 'http://x').searchParams.get('store')!] = done)))));
    renderApp(<Probe />, '/analytics?store=a');
    await waitFor(() => expect(pending.a).toBeDefined());
    act(() => pending.a!(reply({ name: 'Store A' })));
    await waitFor(() => expect(screen.getByTestId('ctx').textContent).toBe('Store A'));
    fireEvent.click(screen.getByText('B'));
    await waitFor(() => expect(state().store).toBe('b'));
    expect(screen.getByTestId('ctx').textContent).toBe('loading');
  });

  it('no store, no request: zero stores say so and nothing asks the analytics API', async () => {
    const fetch = stubApi((url) => (url === '/api/stores' ? [] : { name: 'never' }));
    renderApp(<Probe />, '/analytics');
    await waitFor(() => expect(screen.getByTestId('ctx').textContent).toBe('no stores'));
    expect(fetch.mock.calls.filter(([u]) => String(u).startsWith('/api/analytics'))).toEqual([]);
  });

  it("the store falls back to this page's last store, then the app-wide pick, then the first; picking never writes the app-wide one", async () => {
    stubApi((url) => (url === '/api/stores' ? STORES : { name: 'x' }));
    localStorage.setItem('fe.stores', JSON.stringify(['c']));
    renderApp(<Probe />, '/analytics');
    await waitFor(() => expect(state().store).toBe('c'));
    cleanup();
    localStorage.setItem('fe.analytics.store', JSON.stringify('b'));
    renderApp(<Probe />, '/analytics');
    await waitFor(() => expect(state().store).toBe('b'));
    cleanup();
    localStorage.clear();
    renderApp(<Probe />, '/analytics');
    await waitFor(() => expect(state().store).toBe('a'));
    fireEvent.click(screen.getByText('B'));
    await waitFor(() => expect(state().store).toBe('b'));
    expect(localStorage.getItem('fe.analytics.store')).toBe('"b"');
    expect(localStorage.getItem('fe.stores')).toBe('[]'); // the provider's own default, never this page's pick
  });

  it("the URL holds the state, so a reload keeps it; another store drops the first one's product, filters and page", async () => {
    stubApi((url) => (url === '/api/stores' ? STORES : { name: 'x' }));
    renderApp(<Probe />, '/analytics?store=a&tab=sales&compare=year&refunds=order_day&period=bogus');
    await waitFor(() => expect(state()).toMatchObject({ store: 'a', tab: 'sales', period: 'last30', compare: 'year', refunds: 'order_day', page: 1 }));
    fireEvent.click(screen.getByText('Narrow'));
    await waitFor(() => expect(state()).toMatchObject({ period: 'last7', page: 3, product: '8001', filters: { channel: ['site'] } }));
    const url = screen.getByTestId('where').textContent!;
    cleanup();
    renderApp(<Probe />, url);
    await waitFor(() => expect(state()).toMatchObject({ store: 'a', tab: 'sales', period: 'last7', compare: 'year', refunds: 'order_day', page: 3, product: '8001', filters: { channel: ['site'] } }));
    fireEvent.click(screen.getByText('B'));
    await waitFor(() => expect(state()).toEqual({ store: 'b', tab: 'sales', period: 'last7', compare: 'year', refunds: 'order_day', filters: {}, page: 1 }));
  });
});
