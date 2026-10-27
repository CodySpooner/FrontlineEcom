// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useGoLiveRefresh, useLive } from './client';

class FakeSocket {
  static all: FakeSocket[] = [];
  onopen?: () => void;
  onclose?: () => void;
  onmessage?: (e: { data: string }) => void;
  constructor() {
    FakeSocket.all.push(this);
  }
  close() {}
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  FakeSocket.all = [];
});

describe('useLive', () => {
  it('says it is offline while dropped and refetches everything once back, not on the first connect', () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
    const qc = new QueryClient();
    const refetch = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useLive(), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> });

    FakeSocket.all[0]!.onopen?.();
    expect(refetch).not.toHaveBeenCalled();

    expect(result.current).toBe(true);

    act(() => FakeSocket.all[0]!.onclose?.());
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(3000));
    expect(FakeSocket.all).toHaveLength(2);
    act(() => FakeSocket.all[1]!.onopen?.());
    expect(refetch).toHaveBeenCalledWith();
    expect(result.current).toBe(true);
  });

  it('refreshes products when an approved request changes them (prices, added products)', () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    const qc = new QueryClient();
    const refetch = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useLive(), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> });
    const approval = { id: 'a1', storeId: 'peak', agentId: 'peak:product_hunter', title: 'Price Ab Roller $27.99 → $24.99', reason: 'x', action: { kind: 'store.set_price', payload: {} }, createdAt: '2026-10-26T08:00:00Z' };

    act(() => FakeSocket.all[0]!.onmessage?.({ data: JSON.stringify({ type: 'approval', approval: { ...approval, status: 'pending' } }) }));
    expect(refetch).not.toHaveBeenCalledWith({ queryKey: ['products'] });
    act(() => FakeSocket.all[0]!.onmessage?.({ data: JSON.stringify({ type: 'approval', approval: { ...approval, status: 'approved' } }) }));
    expect(refetch).toHaveBeenCalledWith({ queryKey: ['products'] });
  });

  it("refreshes the store's memory when a request is denied (the squad remembers the no)", () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    const qc = new QueryClient();
    const refetch = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useLive(), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> });
    const approval = { id: 'a2', storeId: 'glow', agentId: 'glow:ad_strategist', title: 'Raise budget', reason: 'x', action: { kind: 'ads.set_budget', payload: {} }, createdAt: '2026-10-26T08:00:00Z' };

    act(() => FakeSocket.all[0]!.onmessage?.({ data: JSON.stringify({ type: 'approval', approval: { ...approval, status: 'approved' } }) }));
    expect(refetch).not.toHaveBeenCalledWith({ queryKey: ['memory', 'glow'] });
    act(() => FakeSocket.all[0]!.onmessage?.({ data: JSON.stringify({ type: 'approval', approval: { ...approval, status: 'denied' } }) }));
    expect(refetch).toHaveBeenCalledWith({ queryKey: ['memory', 'glow'] });
  });

  it("adds a live event only to the activity feeds whose stores it belongs to, so busy stores can't crowd out a quiet one", () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    const qc = new QueryClient();
    qc.setQueryData(['events', []], []);
    qc.setQueryData(['events', ['peak']], []);
    renderHook(() => useLive(), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> });
    const event = { id: 'e1', storeId: 'glow', type: 'add_to_cart', title: 'Add to Cart', at: '2026-10-26T08:00:00Z' };

    act(() => FakeSocket.all[0]!.onmessage?.({ data: JSON.stringify({ type: 'event', event }) }));
    expect(qc.getQueryData(['events', []])).toEqual([event]);
    expect(qc.getQueryData(['events', ['peak']])).toEqual([]);
  });

  it("refreshes the research feed when a run ends (Product Hunter's finds land there)", () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    const qc = new QueryClient();
    const refetch = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useLive(), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> });
    const run = { id: 'r1', agentId: 'peak:product_hunter', storeId: 'peak', task: 'Find 5 products', startedAt: '2026-10-26T08:00:00Z' };

    act(() => FakeSocket.all[0]!.onmessage?.({ data: JSON.stringify({ type: 'run', run: { ...run, status: 'running' } }) }));
    expect(refetch).not.toHaveBeenCalledWith({ queryKey: ['research'] });
    act(() => FakeSocket.all[0]!.onmessage?.({ data: JSON.stringify({ type: 'run', run: { ...run, status: 'done', endedAt: '2026-10-26T08:01:00Z' } }) }));
    expect(refetch).toHaveBeenCalledWith({ queryKey: ['research'] });
  });

  it("refreshes the knowledge base when a run ends (an approved niche pack is saved by the run that asked)", () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    const qc = new QueryClient();
    const refetch = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useLive(), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> });
    const run = { id: 'r1', agentId: 'zen:market_analyst', storeId: 'zen', task: 'Draft a niche pack', startedAt: '2026-10-26T08:00:00Z' };

    act(() => FakeSocket.all[0]!.onmessage?.({ data: JSON.stringify({ type: 'run', run: { ...run, status: 'running' } }) }));
    expect(refetch).not.toHaveBeenCalledWith({ queryKey: ['knowledge'] });
    act(() => FakeSocket.all[0]!.onmessage?.({ data: JSON.stringify({ type: 'run', run: { ...run, status: 'done', endedAt: '2026-10-26T08:05:00Z' } }) }));
    expect(refetch).toHaveBeenCalledWith({ queryKey: ['knowledge'] });
  });
});

describe('useGoLiveRefresh', () => {
  it("refetches everything once when a store's first sync lands (its demo data was swapped for real)", async () => {
    const shopify = { id: 'i1', kind: 'shopify', storeId: 's1', status: 'connected', fields: {}, createdAt: '2026-10-26T08:00:00Z' };
    let server: object = shopify;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([server]), { headers: { 'content-type': 'application/json' } })));
    const qc = new QueryClient();
    const refetch = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useGoLiveRefresh(), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> });
    await vi.waitFor(() => expect(qc.getQueryData(['integrations'])).toBeTruthy());
    expect(refetch).not.toHaveBeenCalled();

    server = { ...shopify, syncedAt: '2026-10-26T09:00:00Z' };
    act(() => qc.setQueryData(['integrations'], [server]));
    await vi.waitFor(() => expect(refetch).toHaveBeenCalledWith());
    server = { ...shopify, syncedAt: '2026-10-26T09:15:00Z' };
    act(() => qc.setQueryData(['integrations'], [server]));
    await new Promise((r) => setTimeout(r, 50));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
