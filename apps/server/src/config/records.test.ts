import { randomBytes } from 'node:crypto';
import { expect, test } from 'vitest';
import { enableDefaultJobs } from '@frontline/agents';
import type { AutomationRule, Integration } from '@frontline/shared';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { updateSecrets } from '../integrations';

const key = randomBytes(32);
const setup = () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  return { db, app: createApp(db, key) };
};
const send = (app: ReturnType<typeof createApp>, method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const changes = (db: Db, like: string) =>
  db.prepare('SELECT actor, scope, store_id, setting, before_json, after_json, detail FROM settings_changes WHERE setting LIKE ? ORDER BY rowid').all(like).map((r) => ({ ...r }));
const version = (db: Db, table: string, id: string) => db.prepare(`SELECT version FROM ${table} WHERE id = ?`).get(id)?.version;

test('automations: POST needs no version; PATCH needs the one read (428 without, 409 stale), names a bad field, and writes change rows', async () => {
  const { db, app } = setup();
  const res = await send(app, 'POST', '/api/automations', { storeId: 'glow', name: 'Brief', trigger: { type: 'schedule', cron: '0 9 * * *' }, action: { type: 'agent_task', agentId: 'glow:market_analyst', task: 'Brief me' } });
  const rule = (await res.json()) as AutomationRule;
  expect([res.status, rule.version]).toEqual([201, 1]);

  const saved = await send(app, 'PATCH', `/api/automations/${rule.id}`, { version: 1, enabled: false, maxRunsPerDay: 2 });
  expect(await saved.json()).toMatchObject({ enabled: false, maxRunsPerDay: 2, version: 2 });
  const stale = await send(app, 'PATCH', `/api/automations/${rule.id}`, { version: 1, name: 'Mine' });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ code: 'stale', current: { enabled: false, version: 2 } });
  expect((await send(app, 'PATCH', `/api/automations/${rule.id}`, { name: 'Mine' })).status).toBe(428);
  for (const [body, field] of [[{ approval: 'yolo' }, 'approval'], [{ trigger: { type: 'schedule', cron: 'every day' } }, 'trigger'], [{ storeId: 'peak' }, 'storeId']] as const) {
    const bad = await send(app, 'PATCH', `/api/automations/${rule.id}`, { version: 2, ...body });
    expect([bad.status, ((await bad.json()) as { field?: string }).field]).toEqual([400, field]);
  }
  expect(changes(db, 'automation.%').filter((r) => r.detail === 'Brief')).toEqual([
    { actor: 'owner', scope: 'store', store_id: 'glow', setting: 'automation.enabled', before_json: 'true', after_json: 'false', detail: 'Brief' },
    { actor: 'owner', scope: 'store', store_id: 'glow', setting: 'automation.maxRunsPerDay', before_json: '3', after_json: '2', detail: 'Brief' },
  ]);
});

test("the system's own rule edits bump the version and write system change rows", () => {
  const { db } = setup();
  const off = db.prepare("SELECT id, name FROM automation_rules WHERE store_id = 'glow' AND enabled = 0").all();
  expect(off.length).toBeGreaterThan(0); // a demo store's default jobs start off
  const before = Number(version(db, 'automation_rules', String(off[0]!.id)));
  expect(enableDefaultJobs(db, 'glow')).toBe(off.length);
  expect(version(db, 'automation_rules', String(off[0]!.id))).toBe(before + 1);
  expect(changes(db, 'automation.enabled')).toEqual(off.map((r) => ({ actor: 'system', scope: 'store', store_id: 'glow', setting: 'automation.enabled', before_json: 'false', after_json: 'true', detail: String(r.name) })));
});

test('integrations: 0 connects, 0 again is 409 exists, an old one 409 stale, none 428; a disconnected row is never recreated; a token refresh moves nothing', async () => {
  const { db, app } = setup();
  const connect = (version: number | undefined, values: Record<string, string>) =>
    send(app, 'PUT', '/api/integrations', { kind: 'cj', values, ...(version === undefined ? {} : { version }) });
  const first = await connect(0, { email: 'ops@shop.test', apiKey: 'tok_not-a-real-secret-1' });
  expect(((await first.json()) as Integration).version).toBe(1);
  const again = await connect(0, { email: 'ops@shop.test', apiKey: 'tok_not-a-real-secret-2' });
  expect(again.status).toBe(409);
  expect(await again.json()).toMatchObject({ code: 'exists', current: { id: 'cj:global', version: 1 } });
  expect((await connect(1, { email: 'buyer@shop.test' })).status).toBe(200); // the key is kept: only the email moved
  expect(version(db, 'integrations', 'cj:global')).toBe(2);
  expect((await connect(1, { email: 'x@shop.test' })).status).toBe(409);
  expect((await connect(undefined, { email: 'x@shop.test' })).status).toBe(428);
  const bad = await connect(undefined, { email: 'x@shop.test', nope: 'y' });
  expect([bad.status, ((await bad.json()) as { field?: string }).field]).toEqual([400, 'nope']); // the body is checked before the version

  updateSecrets(db, key, 'cj:global', { apiKey: 'tok_not-a-real-secret-3' }); // token rotation is bookkeeping
  expect(version(db, 'integrations', 'cj:global')).toBe(2);
  expect((await connect(2, { email: 'buyer@shop.test' })).status).toBe(200); // nothing moved: the version stays
  expect(version(db, 'integrations', 'cj:global')).toBe(2);

  expect((await send(app, 'DELETE', '/api/integrations/cj:global')).status).toBe(204);
  const gone = await connect(2, { email: 'buyer@shop.test', apiKey: 'tok_not-a-real-secret-4' });
  expect([gone.status, await gone.json()]).toEqual([409, expect.objectContaining({ code: 'stale', current: null })]);
  expect(db.prepare("SELECT 1 FROM integrations WHERE id = 'cj:global'").get()).toBeUndefined();

  const rows = changes(db, 'cj.%');
  expect(rows).toEqual([
    { actor: 'owner', scope: 'workspace', store_id: null, setting: 'cj.email', before_json: 'null', after_json: '"ops@shop.test"', detail: null },
    { actor: 'owner', scope: 'workspace', store_id: null, setting: 'cj.apiKey', before_json: null, after_json: null, detail: 'replaced' },
    { actor: 'owner', scope: 'workspace', store_id: null, setting: 'cj.email', before_json: '"ops@shop.test"', after_json: '"buyer@shop.test"', detail: null },
    { actor: 'owner', scope: 'workspace', store_id: null, setting: 'cj.apiKey', before_json: null, after_json: null, detail: 'removed' },
  ]);
  expect(JSON.stringify(db.prepare('SELECT * FROM settings_changes').all())).not.toMatch(/tok_not-a-real-secret/);
});
