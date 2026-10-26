import { expect, test, vi } from 'vitest';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { retry429, setStoreCurrency } from './common';

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

test("a store's currency changing re-syncs its ad accounts and Amazon from scratch (they were converted into the old one)", () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  const add = db.prepare("INSERT INTO integrations (id, kind, store_id, status, encrypted_credentials, updated_at, cursor) VALUES (?, ?, 'glow', 'connected', '', '', '2026-10-26')");
  for (const kind of ['shopify', 'meta_ads', 'google_ads', 'tiktok_ads', 'amazon']) add.run(`${kind}:glow`, kind);
  const cursors = () => Object.fromEntries(db.prepare("SELECT kind, cursor FROM integrations WHERE store_id = 'glow'").all().map((r) => [r.kind, r.cursor]));
  const currency = String(db.prepare("SELECT currency FROM stores WHERE id = 'glow'").get()?.currency);
  setStoreCurrency(db, 'glow', currency);
  expect(Object.values(cursors())).toEqual(Array(5).fill('2026-10-26'));
  setStoreCurrency(db, 'glow', currency === 'EUR' ? 'GBP' : 'EUR');
  expect(cursors()).toEqual({ shopify: '2026-10-26', meta_ads: null, google_ads: null, tiktok_ads: null, amazon: null });
});
