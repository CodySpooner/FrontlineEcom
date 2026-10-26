import { expect, test } from 'vitest';
import type { Agent, AnalyticsSummary, Store } from '@frontline/shared';
import { createApp } from './app';
import { openDb } from './db';
import { seedDemo } from './demo';

const setup = () => {
  const db = openDb();
  seedDemo(db);
  return { db, app: createApp(db) };
};
const send = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

test('create → get → update → delete a store', async () => {
  const { app } = setup();
  const res = await app.request('/api/stores', send('POST', { name: 'Glow Haus', platform: 'etsy', niche: 'beauty', nicheDetail: 'K-beauty' }));
  expect(res.status).toBe(201);
  const store = (await res.json()) as Store;
  expect(store).toEqual({ id: 'glow-haus', name: 'Glow Haus', platform: 'etsy', niche: 'beauty', nicheDetail: 'K-beauty', currency: 'USD', timezone: 'America/Chicago', color: '#ff2a3a', connected: false });
  const squad = (await (await app.request('/api/agents?stores=glow-haus')).json()) as Agent[];
  expect(squad).toHaveLength(8);

  const dup = (await (await app.request('/api/stores', send('POST', { name: 'Glow Haus', platform: 'etsy', niche: 'beauty' }))).json()) as Store;
  expect(dup.id).toBe('glow-haus-2');

  expect(await (await app.request('/api/stores/glow-haus')).json()).toEqual(store);
  const upd = await app.request('/api/stores/glow-haus', send('PATCH', { name: 'Glow Haus EU', color: '#00ff88' }));
  expect(await upd.json()).toMatchObject({ id: 'glow-haus', name: 'Glow Haus EU', color: '#00ff88', platform: 'etsy' });

  expect((await app.request('/api/stores/glow-haus', { method: 'DELETE' })).status).toBe(204);
  expect((await app.request('/api/stores/glow-haus')).status).toBe(404);
  expect((await app.request('/api/stores/glow-haus', { method: 'DELETE' })).status).toBe(404);
});

test('a new store starts in demo mode with analytics history', async () => {
  const { app } = setup();
  await app.request('/api/stores', send('POST', { name: 'Volt Lab', platform: 'shopify', niche: 'tech' }));
  const s = (await (await app.request('/api/analytics/summary?stores=volt-lab&range=7')).json()) as AnalyticsSummary;
  expect(s.totals.revenue).toBeGreaterThan(0);
  expect(s.series.every((p) => p.orders > 0)).toBe(true);
});

test('invalid store bodies are rejected with a message', async () => {
  const { app } = setup();
  const bad = [
    {},
    { name: '', platform: 'shopify', niche: 'pet' },
    { name: 'X', platform: 'ebay', niche: 'pet' },
    { name: 'X', platform: 'shopify', niche: 'cars' },
    { name: 'X', platform: 'shopify', niche: 'pet', color: 'red' },
    { name: 'X', platform: 'shopify', niche: 'pet', timezone: 'Mars/Base' },
  ];
  for (const body of bad) {
    const res = await app.request('/api/stores', send('POST', body));
    expect(res.status, JSON.stringify(body)).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBeTruthy();
  }
  expect((await app.request('/api/stores', { method: 'POST', body: 'not json' })).status).toBe(400);
  expect((await app.request('/api/stores/nope', send('PATCH', { name: 'Y' }))).status).toBe(404);
  expect((await app.request('/api/stores/pawsome', send('PATCH', { niche: 'cars' }))).status).toBe(400);
});

test('deleting a store removes its metrics', async () => {
  const { db, app } = setup();
  await app.request('/api/stores/peak', { method: 'DELETE' });
  expect(db.prepare("SELECT count(*) AS n FROM daily_metrics WHERE store_id = 'peak'").get()?.n).toBe(0);
});
