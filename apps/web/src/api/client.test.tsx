// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCancelRun } from './client';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const failWith = async (fetch: () => Promise<Response>) => {
  vi.stubGlobal('fetch', vi.fn(fetch));
  const qc = new QueryClient();
  const { result } = renderHook(() => useCancelRun(), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> });
  result.current.mutate('r1');
  await waitFor(() => expect(result.current.isError).toBe(true));
  return result.current.error!.message;
};

describe('api errors the owner reads', () => {
  it("says the app's server couldn't be reached, not the browser's \"Failed to fetch\"", async () => {
    expect(await failWith(() => Promise.reject(new TypeError('Failed to fetch')))).toBe("Couldn't reach the app's server: it may be restarting. Try again in a moment.");
  });

  it("keeps the server's own words, and without any says it failed in plain words", async () => {
    expect(await failWith(async () => new Response(JSON.stringify({ error: 'Run not found' }), { status: 404 }))).toBe('Run not found');
    expect(await failWith(async () => new Response('oops', { status: 500 }))).toBe("The app's server couldn't do that (error 500). Try again in a moment.");
  });
});
