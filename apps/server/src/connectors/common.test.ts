import { expect, test, vi } from 'vitest';
import { retry429 } from './common';

test('a rate-limited sync request waits Retry-After and asks again; it gives up after 5 tries', async () => {
  const statuses = [429, 429, 200];
  const asked: number[] = [];
  const fetchFn = (async () => {
    asked.push(Date.now());
    return new Response(null, { status: statuses.shift() ?? 429, headers: { 'retry-after': '2' } });
  }) as unknown as typeof fetch;
  vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
  try {
    const ok = retry429(fetchFn)('https://openapi.etsy.com/v3/x');
    await vi.advanceTimersByTimeAsync(4000);
    expect((await ok).status).toBe(200);
    expect(asked.slice(1).map((t, i) => t - asked[i]!)).toEqual([2000, 2000]);

    const limited = retry429(fetchFn)('https://openapi.etsy.com/v3/x');
    await vi.advanceTimersByTimeAsync(8000);
    expect((await limited).status).toBe(429);
    expect(asked).toHaveLength(8);
  } finally {
    vi.useRealTimers();
  }
});
