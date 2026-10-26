import { expect, test } from 'vitest';
import type { Store } from '@frontline/shared';
import { createApp } from './app';
import { openDb } from './db';
import { seedDemo } from './demo';

const db = openDb();
seedDemo(db);
const app = createApp(db);

test('health responds ok', async () => {
  const res = await app.request('/api/health');
  expect(await res.json()).toEqual({ ok: true });
});

test('stores lists the demo stores', async () => {
  const res = await app.request('/api/stores');
  const stores = (await res.json()) as Store[];
  expect(stores.map((s) => s.id)).toEqual(['pawsome', 'glow', 'peak']);
  expect(stores[0]).toMatchObject({ name: 'Pawsome Gear', nicheDetail: 'dog travel gear', connected: false });
});
