import { expect, test } from 'vitest';
import type { AppNotification, Settings, StoreCaps } from '@frontline/shared';
import { createApp } from './app';
import { approvalsHook } from './approvals';
import { openDb } from './db';
import { seedDemo } from './demo';
import { getSettings, notify, settingsRoutes, updateSettings } from './settings';

const setup = () => {
  const db = openDb();
  seedDemo(db);
  return { db, app: createApp(db) };
};
const send = (method: string, body?: unknown) => ({ method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

test('a display name is 1-40 characters: 41 is refused, naming the field, and changes nothing', async () => {
  const { db, app } = setup();
  const { version } = getSettings(db);
  const res = await app.request('/api/settings', send('PATCH', { version, profile: { name: 'x'.repeat(41) } }));
  expect([res.status, await res.json()]).toEqual([400, { error: 'Your display name must be 1–40 characters.', field: 'profile.name' }]);
  expect(getSettings(db)).toMatchObject({ profile: { name: 'Cody' }, version });
  expect((await app.request('/api/settings', send('PATCH', { version, profile: { name: 'x'.repeat(40) } }))).status).toBe(200);
});

test('settings have defaults, merge nested updates, and reject bad input', async () => {
  const { app } = setup();
  const s = (await (await app.request('/api/settings')).json()) as Settings;
  expect(s).toMatchObject({ profile: { name: 'Cody', plan: 'Pro Plan' }, notifications: { approvals: true, agentDone: true, errors: true } });
  expect(s.dataDir).toBeTruthy();

  const upd = (await (await app.request('/api/settings', send('PATCH', { version: s.version, profile: { name: ' Xody ' }, notifications: { errors: false } }))).json()) as Settings;
  expect(upd).toMatchObject({ profile: { name: 'Xody', plan: 'Pro Plan' }, notifications: { approvals: true, agentDone: true, errors: false }, version: s.version! + 1 });
  expect(await (await app.request('/api/settings')).json()).toEqual(upd);

  for (const body of [{ theme: 'light' }, { profile: { name: '' } }, { profile: { age: 3 } }, { notifications: { spam: true } }, { dataDir: 'C:/' }]) {
    expect((await app.request('/api/settings', send('PATCH', { version: upd.version, ...body }))).status, JSON.stringify(body)).toBe(400);
  }
  // Every write sends the version it read: none is 428; the 0 read before the first save is 409 now, with the settings as they are.
  expect((await app.request('/api/settings', send('PATCH', { baseCurrency: 'USD' }))).status).toBe(428);
  const stale = await app.request('/api/settings', send('PATCH', { version: s.version, baseCurrency: 'USD' }));
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ code: 'exists', current: { baseCurrency: 'USD', version: upd.version } });
  expect(((await (await app.request('/api/settings')).json()) as Settings).baseCurrency).toBe('USD');
});

test('caps default per store, merge autopilot per action kind, validate', async () => {
  const { app } = setup();
  const caps = (await (await app.request('/api/caps?stores=peak')).json()) as StoreCaps[];
  const inherited = { adSpendChangePerDay: 'default', higgsfieldCreditsPerDay: 'default', agentCostPerDay: 'default' };
  expect(caps).toEqual([{ storeId: 'peak', adSpendChangePerDay: 100, higgsfieldCreditsPerDay: 200, agentCostPerDay: 5, autopilot: {}, version: 0, origins: inherited }]);

  await app.request('/api/caps/peak', send('PUT', { version: 0, autopilot: { 'ads.pause_adsets': { enabled: true, maxUsdPerDay: 200 } } }));
  const upd = (await (await app.request('/api/caps/peak', send('PUT', { version: 1, agentCostPerDay: 2.5, autopilot: { 'ads.set_budget': { enabled: false, maxUsdPerDay: 0 } } }))).json()) as StoreCaps;
  expect(upd).toMatchObject({ agentCostPerDay: 2.5, origins: { ...inherited, agentCostPerDay: 'store' }, autopilot: { 'ads.pause_adsets': { enabled: true, maxUsdPerDay: 200 }, 'ads.set_budget': { enabled: false, maxUsdPerDay: 0 } } });
  // defaults are not shared between stores
  expect(((await (await app.request('/api/caps?stores=glow')).json()) as StoreCaps[])[0]!.autopilot).toEqual({});

  for (const body of [{ agentCostPerDay: -1 }, { agentCostPerDay: '5' }, { budget: 1 }, { autopilot: { 'Bad Kind': { enabled: true, maxUsdPerDay: 1 } } }, { autopilot: { 'ads.x': { enabled: 'y', maxUsdPerDay: 1 } } }]) {
    expect((await app.request('/api/caps/peak', send('PUT', { version: 2, ...body }))).status, JSON.stringify(body)).toBe(400);
  }
  expect((await app.request('/api/caps/nope', send('PUT', { version: 0 }))).status).toBe(404);
  expect((await app.request('/api/caps/peak', send('PUT', { agentCostPerDay: 1 }))).status).toBe(428);
});

test('notifications: approvals raise one, prefs silence a kind, mark read', async () => {
  const { db, app } = setup();
  approvalsHook(db).create({ storeId: 'glow', agentId: 'glow:copywriter', title: 'Publish 3 product descriptions', reason: 'SEO score +18', action: { kind: 'store.update_products', payload: {} } });
  notify(db, { kind: 'agent_done', title: 'Analytics Specialist finished the weekly brief', storeId: 'glow' });
  await app.request('/api/settings', send('PATCH', { version: getSettings(db).version, notifications: { errors: false } }));
  expect(notify(db, { kind: 'error', title: 'Shopify sync failed' })).toBeUndefined();

  const all = (await (await app.request('/api/notifications')).json()) as AppNotification[];
  expect(all.map((n) => n.kind)).toEqual(['agent_done', 'approval']);
  expect(all[1]).toMatchObject({ title: 'Publish 3 product descriptions', body: 'SEO score +18', storeId: 'glow' });

  expect(await (await app.request('/api/notifications/read', send('POST', { ids: [all[0]!.id] }))).json()).toEqual({ updated: 1 });
  expect(((await (await app.request('/api/notifications?unread=true')).json()) as AppNotification[]).map((n) => n.id)).toEqual([all[1]!.id]);
  expect(await (await app.request('/api/notifications/read', send('POST', {}))).json()).toEqual({ updated: 1 });
  expect(await (await app.request('/api/notifications?unread=true')).json()).toEqual([]);
  expect((await app.request('/api/notifications/read', send('POST', { ids: 'all' }))).status).toBe(400);
});

test('notifications: approvals and agentDone each silence their own kind, and only it', () => {
  const { db } = setup();
  updateSettings(db, { notifications: { approvals: false } });
  expect(notify(db, { kind: 'approval', title: 'Raise the budget' })).toBeUndefined();
  expect(notify(db, { kind: 'agent_done', title: 'Brief done' })).toBeDefined();
  updateSettings(db, { notifications: { approvals: true, agentDone: false } });
  expect(notify(db, { kind: 'approval', title: 'Raise the budget' })).toBeDefined();
  expect(notify(db, { kind: 'agent_done', title: 'Brief done' })).toBeUndefined();
});

test('open-data-folder opens the data dir and nothing else', async () => {
  const db = openDb();
  const opened: string[] = [];
  const app = settingsRoutes(db, (dir) => void opened.push(dir));
  expect((await app.request('/api/settings/open-data-folder', { method: 'POST' })).status).toBe(204);
  expect(opened).toEqual([getSettings(db).dataDir]);
});
