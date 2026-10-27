import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSquad } from '@frontline/agents';
import { OFFICE_DESKS, OFFICE_GRID, type OfficeSeat, type OfficeStats } from '@frontline/shared';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { createStore } from '../stores';

let db: Db;
let app: ReturnType<typeof createApp>;
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'frontline-office-'));
  db = openDb(join(dir, 'test.db'));
  for (const name of ['One', 'Two', 'Three', 'Four']) createSquad(db, createStore(db, { name, platform: 'shopify', niche: 'pet', currency: 'USD', color: '#ff2a3a' }));
  app = createApp(db);
});
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
const send = (method: string, path = '', body?: unknown) => app.request(`/api/ecosystem/seats${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const deploy = (agentId = 'one:copywriter', deskId = 'research-1') => send('POST', '', { agentId, deskId });

test('seats, looks and positions survive reopen; archiving frees only the seat', async () => {
  const r = await deploy();
  expect(r.status).toBe(201);
  const first = await r.json() as OfficeSeat;
  const look = { ...first.appearance, color: '#4488ff', outfit: 'hoodie', hair: 3, archetype: 'netrunner', accent: '#55ffee', gear: 'reactor', variant: 7 };
  expect((await send('PATCH', '/one:copywriter', { displayName: '  Nova  ', appearance: look, position: { x: 4, y: 3 } })).status).toBe(200);
  db.prepare("INSERT INTO agent_runs (id,store_id,agent_id,task,status,created_at) VALUES ('history','one','one:copywriter','Existing task','done','2026-10-26T00:00:00Z')").run();
  db.close(); db = openDb(join(dir, 'test.db')); app = createApp(db);
  expect(await (await send('GET')).json()).toMatchObject([{ displayName: 'Nova', appearance: look, position: { x: 4, y: 3 } }]);
  expect((await deploy('one:operations')).status).toBe(409);
  expect((await send('DELETE', '/one:copywriter')).status).toBe(200);
  expect((await deploy('one:operations')).status).toBe(201);
  expect(db.prepare("SELECT id FROM agent_runs WHERE id = 'history'").get()).toBeTruthy();
  expect(db.prepare("SELECT id FROM agents WHERE id = 'one:copywriter'").get()).toBeTruthy();
  expect((await deploy('one:copywriter', 'creative-1')).status).toBe(201);
  expect(await (await send('GET')).json()).toEqual(expect.arrayContaining([expect.objectContaining({ agentId: 'one:copywriter', displayName: 'Nova', archived: false, position: null })]));
});

test('capacity and uniqueness cannot be bypassed by duplicate deployment or moves', async () => {
  const agents = db.prepare('SELECT id FROM agents ORDER BY id').all().map((a) => String(a.id));
  expect(OFFICE_DESKS).toHaveLength(30);
  for (const [i, desk] of OFFICE_DESKS.entries()) expect((await deploy(agents[i], desk.id)).status).toBe(201);
  expect((await deploy(agents[30], 'research-1')).status).toBe(409);
  expect((await deploy(agents[0], 'research-2')).status).toBe(409);
  expect((await send('PATCH', `/${agents[0]}`, { deskId: OFFICE_DESKS[1]!.id })).status).toBe(409);
  await send('DELETE', `/${agents[0]}`);
  expect(await (await app.request('/api/ecosystem/stats')).json()).toMatchObject({ fullOffice: true });
  expect((await deploy(agents[30], OFFICE_DESKS[0]!.id)).status).toBe(201);
});

test('validates untrusted inputs and refuses unknown desks and agents', async () => {
  for (const body of [null, [], {}, { agentId: 'one:copywriter', deskId: 'research-99' }, { agentId: 'one:copywriter', deskId: 'research-1', appearance: {} }]) expect((await send('POST', '', body)).status).toBe(400);
  expect((await deploy('missing')).status).toBe(404);
  await deploy();
  for (const body of [null, {}, { archived: false }, { deskId: null }, { position: { x: OFFICE_GRID.width, y: 0 } }, { position: { x: 0.5, y: 1 } }, { displayName: 'x'.repeat(61) }, { appearance: { color: 'url(evil)' } }]) expect((await send('PATCH', '/one:copywriter', body)).status).toBe(400);
  expect((await send('DELETE', '/missing')).status).toBe(404);
  const legacy = { color: '#4488ff', outfit: 'jacket', accessory: 'none', hair: 0, skin: 0 };
  for (const extra of [{ archetype: 'unknown' }, { gear: 'weapon' }, { accent: '#fff' }, { variant: -1 }, { variant: 8 }, { variant: 1.5 }]) expect((await send('PATCH', '/one:copywriter', { appearance: { ...legacy, ...extra } })).status).toBe(400);
  expect((await send('PATCH', '/one:copywriter', { appearance: legacy })).status).toBe(200);
});

test('statistics count durable runs beyond the recent feed and exclude cancellations from success', async () => {
  expect(await (await app.request('/api/ecosystem/stats')).json()).toMatchObject({ activeTasks: 0, successRate: null, costUsd: 0 });
  const insert = db.prepare("INSERT INTO agent_runs (id,store_id,agent_id,task,status,created_at,input_tokens,output_tokens,cost_usd) VALUES (?,'one','one:copywriter','Task',?,'2026-10-26',10,5,0.1)");
  for (let i = 0; i < 210; i++) insert.run(String(i), 'done');
  for (const status of ['error', 'cancelled', 'running', 'queued']) insert.run(status, status);
  db.prepare("INSERT INTO squad_missions (id,store_id,title,steps_json,created_at) VALUES ('m','one','Launch','[]','2026-10-26')").run();
  const stats = await (await app.request('/api/ecosystem/stats')).json() as OfficeStats;
  expect(stats).toMatchObject({ activeTasks: 2, completedTasks: 210, failedTasks: 1, successRate: 210 / 211, activeTeams: 1, inputTokens: 2140, outputTokens: 1070 });
  expect(stats.costUsd).toBeCloseTo(21.4);
  db.prepare("UPDATE squad_missions SET steps_json = ? WHERE id = 'm'").run(JSON.stringify([{ id: 'one', runId: '0', role: 'copywriter', task: 'Write', dependsOn: [] }, { id: 'two', runId: '1', role: 'operations', task: 'Check', dependsOn: ['one'] }]));
  db.prepare("UPDATE agent_runs SET parent_run_id = '0', agent_id = 'one:operations' WHERE id = '1'").run();
  expect(await (await app.request('/api/ecosystem/stats')).json()).toMatchObject({ teamsCreated: 1, completedMissions: 1, handoffs: 1 });
  db.prepare("UPDATE agent_runs SET status = 'error' WHERE id = '1'").run();
  expect(await (await app.request('/api/ecosystem/stats')).json()).toMatchObject({ completedMissions: 0 });
  db.prepare("UPDATE agent_runs SET error = 'Interrupted by an app restart' WHERE id = '1'").run();
  db.prepare("INSERT INTO done_once (ref, at) VALUES ('retry:1:2', '2026-10-26')").run();
  expect(await (await app.request('/api/ecosystem/stats')).json()).toMatchObject({ completedMissions: 1 });
  db.prepare("UPDATE squad_missions SET steps_json = ? WHERE id = 'm'").run(JSON.stringify([{ id: 'one', role: 'copywriter', task: 'Write', dependsOn: [], cancelled: true }]));
  expect(await (await app.request('/api/ecosystem/stats')).json()).toMatchObject({ completedMissions: 0 });
});
