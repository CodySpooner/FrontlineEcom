// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AgentRunDetail } from '@frontline/shared';
import { useGoLiveRefresh, useLive, useRun } from './client';

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

  it("refreshes the research feed when a run ends (Product Researcher's finds land there)", () => {
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

describe('useLive notifications', () => {
  it('keeps the bell to the 40 newest, like a refetch, however long the app stays open', () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    const qc = new QueryClient();
    const n = (i: number) => ({ id: `n${i}`, kind: 'run_done', title: `Run ${i}`, createdAt: '2026-10-26T08:00:00Z' });
    qc.setQueryData(['notifications'], Array.from({ length: 40 }, (_, i) => n(i)));
    renderHook(() => useLive(), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> });

    act(() => FakeSocket.all[0]!.onmessage?.({ data: JSON.stringify({ type: 'notification', notification: n(40) }) }));
    const list = qc.getQueryData<{ id: string }[]>(['notifications'])!;
    expect(list).toHaveLength(40);
    expect(list[0]!.id).toBe('n40');
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

describe('useLive run streaming (AA-21)', () => {
  const base = { id: 'r1', storeId: 'glow', agentId: 'glow:copywriter', task: 'Write it', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, createdAt: '2026-10-28T08:00:00Z' };
  const say = (text: string) => ({ type: 'text_delta', text });
  const text = (qc: QueryClient) => (qc.getQueryData<AgentRunDetail>(['run', 'r1'])?.transcript ?? []).map((e) => (e.type === 'text_delta' ? e.text : '')).join('');
  /** The server's copy of r1: GET /api/runs/r1 answers it, as runs.get does (transcript so far and its seq). */
  function setup(server: { current: object }) {
    vi.stubGlobal('WebSocket', FakeSocket);
    const gets: (() => void)[] = [];
    let auto = true;
    vi.stubGlobal('fetch', (path: string) => {
      expect(path).toBe('/api/runs/r1');
      const body = server.current;
      const answer = { ok: true, status: 200, json: async () => body };
      return auto ? Promise.resolve(answer) : new Promise((r) => gets.push(() => r(answer)));
    });
    const qc = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    renderHook(() => (useLive(), useRun('r1')), { wrapper });
    const send = (m: object) => act(() => FakeSocket.all.at(-1)!.onmessage?.({ data: JSON.stringify(m) }));
    const event = (seq: number, e: object) => send({ type: 'run_event', runId: 'r1', agentId: base.agentId, storeId: 'glow', event: e, seq });
    return { qc, send, event, gets, hold: () => (auto = false), release: async () => { await act(async () => gets.splice(0).forEach((g) => g())); } };
  }

  it('appends events in order, skips ones it has, and catches up across a dropped socket without doubling or losing text', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const server = { current: { ...base, status: 'running', transcript: [say('Hel')], seq: 1 } as object };
    const { qc, event, hold, release } = setup(server);
    act(() => FakeSocket.all[0]!.onopen?.());
    await vi.waitFor(() => expect(text(qc)).toBe('Hel'));
    event(2, say('lo'));
    event(2, say('lo')); // a repeat changes nothing
    expect(text(qc)).toBe('Hello');

    // Dropped: events 3 and 4 go nowhere. Back: everything refetches, and event 5 lands before that answer does.
    act(() => FakeSocket.all[0]!.onclose?.());
    server.current = { ...base, status: 'running', transcript: [say('Hello wor')], seq: 4 };
    hold();
    await act(async () => vi.advanceTimersByTimeAsync(3000)); // the reconnect timer
    act(() => FakeSocket.all[1]!.onopen?.());
    event(5, say('ld'));
    await release();
    await vi.waitFor(() => expect(text(qc)).toBe('Hello world'));
    event(5, say('ld'));
    event(6, say('!'));
    expect(text(qc)).toBe('Hello world!');

    // A gap (a retry took back what it said): refetch, and later events wait for that answer.
    server.current = { ...base, status: 'running', transcript: [say('Hi')], seq: 8 };
    event(8, say('ignored: the answer has it'));
    event(9, say(' there'));
    await release();
    await vi.waitFor(() => expect(text(qc)).toBe('Hi there'));
    expect(qc.getQueryData<AgentRunDetail>(['run', 'r1'])!.seq).toBe(9);
  });

  it("polls a live run only while the socket is down", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const server = { current: { ...base, status: 'running', transcript: [], seq: 0 } as object };
    const fetches = vi.fn();
    const { gets } = setup(server);
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', (path: string) => (fetches(path), real(path)));
    void gets;
    act(() => FakeSocket.all[0]!.onopen?.());
    await act(async () => vi.advanceTimersByTimeAsync(6000));
    expect(fetches).not.toHaveBeenCalled();
    act(() => FakeSocket.all[0]!.onclose?.());
    await act(async () => vi.advanceTimersByTimeAsync(2100));
    expect(fetches).toHaveBeenCalledWith('/api/runs/r1');
  });

  it("seeds a copy of a run this client didn't start, so its first events land; an ended one is fetched when shown", () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    const qc = new QueryClient();
    renderHook(() => useLive(), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> });
    const send = (m: object) => act(() => FakeSocket.all[0]!.onmessage?.({ data: JSON.stringify(m) }));
    send({ type: 'run', run: { ...base, id: 'r2', status: 'queued', transcript: [] } });
    send({ type: 'run', run: { ...base, id: 'r2', status: 'running', transcript: [] } });
    send({ type: 'run_event', runId: 'r2', agentId: base.agentId, storeId: 'glow', event: say('Started'), seq: 1 });
    expect(qc.getQueryData(['run', 'r2'])).toMatchObject({ status: 'running', seq: 1, transcript: [say('Started')] });

    send({ type: 'run', run: { ...base, id: 'r3', status: 'done', transcript: [] } });
    expect(qc.getQueryData(['run', 'r3'])).toMatchObject({ status: 'done' });
    expect(qc.getQueryState(['run', 'r3'])!.isInvalidated).toBe(true);
  });
});
