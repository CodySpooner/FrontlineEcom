import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSquad } from '@frontline/agents';
import { OFFICE_DESKS, type OfficeSeat } from '@frontline/shared';
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
  const look = { ...first.appearance, color: '#4488ff', outfit: 'hoodie', hair: 3 };
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
  expect((await deploy(agents[30], OFFICE_DESKS[0]!.id)).status).toBe(201);
});

test('validates untrusted inputs and refuses unknown desks and agents', async () => {
  for (const body of [null, [], {}, { agentId: 'one:copywriter', deskId: 'research-99' }, { agentId: 'one:copywriter', deskId: 'research-1', appearance: {} }]) expect((await send('POST', '', body)).status).toBe(400);
  expect((await deploy('missing')).status).toBe(404);
  await deploy();
  for (const body of [null, {}, { archived: false }, { deskId: null }, { position: { x: 36, y: 0 } }, { position: { x: 0.5, y: 1 } }, { displayName: 'x'.repeat(61) }, { appearance: { color: 'url(evil)' } }]) expect((await send('PATCH', '/one:copywriter', body)).status).toBe(400);
  expect((await send('DELETE', '/missing')).status).toBe(404);
});
