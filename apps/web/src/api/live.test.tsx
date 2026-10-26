// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useLive } from './client';

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
});
