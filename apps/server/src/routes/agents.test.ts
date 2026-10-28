import { createSquad, listAgents } from '@frontline/agents';
import { AGENT_ROLES, type Agent } from '@frontline/shared';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { insertStore } from '../stores';

let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDb();
  seedDemo(db, '2026-10-26');
  app = createApp(db);
});

const get = async (path: string) => (await app.request(path)).json();
const patch = (id: string, body: unknown) =>
  app.request(`/api/agents/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('every demo store gets a full squad on startup', async () => {
  const agents = (await get('/api/agents')) as Agent[];
  expect(agents).toHaveLength(3 * 8);
  expect(agents.slice(0, 8).map((a) => a.id)).toEqual(Object.keys(AGENT_ROLES).map((r) => `pawsome:${r}`));
  expect(agents[0]).toMatchObject({ storeId: 'pawsome', role: 'ad_strategist', enabled: true, autonomy: 'ask' });
});

test('filters by store', async () => {
  const agents = (await get('/api/agents?stores=glow,peak')) as Agent[];
  expect(new Set(agents.map((a) => a.storeId))).toEqual(new Set(['glow', 'peak']));
});

test('an agent with a pending request is waiting on the owner', async () => {
  const pending = db.prepare(`SELECT agent_id, title FROM approvals WHERE status = 'pending' ORDER BY created_at LIMIT 1`).get()!;
  const id = String(pending.agent_id);
  expect(await get(`/api/agents/${encodeURIComponent(id)}`)).toMatchObject({ status: 'waiting_approval', currentTask: pending.title });
  db.prepare(`UPDATE approvals SET status = 'approved' WHERE agent_id = ?`).run(id);
  expect(await get(`/api/agents/${encodeURIComponent(id)}`)).toMatchObject({ status: 'idle' });
});

test("an agent whose last run failed shows the error until a newer run finishes", async () => {
  const runAt = (id: string, status: string, at: string, error: string | null = null) =>
    db.prepare(`INSERT INTO agent_runs (id, agent_id, store_id, task, status, error, created_at) VALUES (?, 'glow:copywriter', 'glow', 't', ?, ?, ?)`).run(id, status, error, at);
  runAt('r1', 'done', '2026-10-25T08:00:00Z');
  runAt('r2', 'error', '2026-10-26T08:00:00Z', "Claude isn't signed in on this computer.");
  expect(await get('/api/agents/glow%3Acopywriter')).toMatchObject({ status: 'error', currentTask: "Last run failed: Claude isn't signed in on this computer." });
  runAt('r3', 'done', '2026-10-26T09:00:00Z');
  expect(await get('/api/agents/glow%3Acopywriter')).toMatchObject({ status: 'idle' });
});

test('disable, re-deploy and change autonomy', async () => {
  const off = await patch('glow:copywriter', { enabled: false });
  expect(await off.json()).toMatchObject({ enabled: false, status: 'offline' });
  const on = await patch('glow:copywriter', { enabled: true, autonomy: 'autopilot' });
  expect(await on.json()).toMatchObject({ enabled: true, status: 'idle', autonomy: 'autopilot' });
});

test('rejects bad updates and unknown agents', async () => {
  expect((await patch('glow:copywriter', { autonomy: 'yolo' })).status).toBe(400);
  expect((await patch('glow:copywriter', { enabled: 'yes' })).status).toBe(400);
  expect((await patch('nope:copywriter', { enabled: true })).status).toBe(404);
  expect((await app.request('/api/agents/nope')).status).toBe(404);
});

test('createSquad is idempotent and keeps settings', () => {
  insertStore(db, { id: 'kids', name: 'Tiny Trek', platform: 'etsy', niche: 'kids', currency: 'USD', timezone: 'America/Chicago', color: '#fff', connected: false });
  expect(createSquad(db, { id: 'kids' })).toHaveLength(8);
  db.prepare(`UPDATE agents SET autonomy = 'autopilot', enabled = 0 WHERE id = 'kids:operations'`).run();
  createSquad(db, { id: 'kids' });
  expect(listAgents(db, ['kids']).find((a) => a.role === 'operations')).toMatchObject({ autonomy: 'autopilot', enabled: false });
});
