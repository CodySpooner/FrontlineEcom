import { expect, test } from 'vitest';
import type { ActionLogEntry } from '@frontline/shared';
import { logAction } from './actions';
import { createApp } from './app';
import { openDb } from './db';
import { seedDemo } from './demo';

test('logAction records the outcome and rethrows; /api/actions lists newest first per store', async () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  expect(await logAction(db, 'glow', 'price_change', '111', { price: 19.9 }, async () => 'done')).toBe('done');
  await expect(logAction(db, 'glow', 'ad_pause', 'meta:1', { status: 'PAUSED' }, async () => { throw new Error('Meta: token expired'); })).rejects.toThrow('token expired');
  await logAction(db, 'peak', 'page_publish', 'About us', { title: 'About us' }, async () => {});

  const app = createApp(db);
  const get = async (q: string) => (await (await app.request(`/api/actions${q}`)).json()) as ActionLogEntry[];
  const glow = await get('?stores=glow');
  expect(glow.map(({ at: _, id: __, ...a }) => a)).toEqual([
    { storeId: 'glow', action: 'ad_pause', target: 'meta:1', detail: { status: 'PAUSED' }, ok: false, error: 'Meta: token expired' },
    { storeId: 'glow', action: 'price_change', target: '111', detail: { price: 19.9 }, ok: true },
  ]);
  expect((await get('')).map((a) => a.storeId)).toEqual(['peak', 'glow', 'glow']);
  expect(await get('?limit=1')).toHaveLength(1);
});
