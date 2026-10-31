import { createResearchTask, ensureCategoryPath, saveSource } from '@frontline/agents';
import type { KbControlsState, KbWorkspace } from '@frontline/shared';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { maintain } from '../kb/maintenance';

// Settings → Knowledge (ST-25, decision 13): the KB research controls' fixes and the retention impact.
let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  app = createApp(db);
});
const send = async (method: string, path: string, body?: unknown) => {
  const r = await app.request(path, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  return { status: r.status, body: (r.status === 204 ? {} : await r.json()) as Partial<KbControlsState> & { error?: string; field?: string } };
};
const controls = async (ws = 'pawsome') => (await send('GET', `/api/kb/controls?ws=${ws}`)).body as KbControlsState;

test('deleting or moving a category takes its id out of the controls and moves their version; the next PUT saves', async () => {
  const ads = ensureCategoryPath(db, 'pawsome', ['Advertising']);
  const pricing = ensureCategoryPath(db, 'pawsome', ['Pricing']);
  const psych = ensureCategoryPath(db, 'pawsome', ['Consumer Psychology']);
  const set = await send('PUT', '/api/kb/controls?ws=pawsome', { version: 0, roles: { ad_strategist: [ads], market_analyst: [pricing, psych] }, freshDays: { [ads]: 30, [pricing]: 60 } });
  expect(set.status).toBe(200);

  expect((await send('DELETE', `/api/kb/categories/${ads}?ws=pawsome`)).status).toBe(204);
  // A role left with none of its categories stops researching, rather than widening to its usual areas.
  expect(await controls()).toMatchObject({ version: 2, roles: { market_analyst: [pricing, psych] }, freshDays: { [pricing]: 60 } });
  expect((await controls()).roles).not.toHaveProperty('ad_strategist');

  expect((await send('PATCH', `/api/kb/categories/${pricing}?ws=pawsome`, { parentId: psych })).status).toBe(200);
  expect(await controls()).toMatchObject({ version: 3, roles: { market_analyst: [psych] }, freshDays: {} });

  const next = await send('PUT', '/api/kb/controls?ws=pawsome', { version: 3, dailyBudgetUsd: 5 });
  expect([next.status, next.body.version, next.body.roles, next.body.dailyBudgetUsd]).toEqual([200, 4, { market_analyst: [psych] }, 5]);
});

test('ids left stale by an earlier delete are dropped, not refused; a new unknown one still is', async () => {
  const ads = ensureCategoryPath(db, 'pawsome', ['Advertising']);
  expect((await send('PUT', '/api/kb/controls?ws=pawsome', { version: 0, roles: { ad_strategist: [ads] }, freshDays: { [ads]: 30 } })).status).toBe(200);
  db.prepare('DELETE FROM kb_categories WHERE id = ?').run(ads); // as before ST-25: the controls kept the id
  const r = await send('PUT', '/api/kb/controls?ws=pawsome', { version: 1, review: false });
  expect([r.status, r.body.roles, r.body.freshDays, r.body.review]).toEqual([200, {}, {}, false]);
  expect(await send('PUT', '/api/kb/controls?ws=pawsome', { version: 2, roles: { copywriter: ['nope'] } })).toMatchObject({ status: 400, body: { field: 'kb.roles' } });
});

test("General refuses a store's fields, and keeps its own", async () => {
  for (const [k, v] of [['taskBudgetUsd', 2], ['roles', {}], ['triggers', []], ['depth', 'quick'], ['approval', false], ['dailyBudgetUsd', 4]] as const) {
    expect(await send('PUT', '/api/kb/controls?ws=general', { version: 0, [k]: v })).toEqual({ status: 400, body: { error: `${k} is set per store: General has review, sites, refresh ages and retention`, field: `kb.${k}` } });
  }
  expect((await send('PUT', '/api/kb/controls?ws=general', { version: 0, autonomous: false })).body.field).toBe('kb.autonomous');
  const own = await send('PUT', '/api/kb/controls?ws=general', { version: 0, review: false, trustedDomains: ['example.com'], retentionDays: 365 });
  expect([own.status, own.body.review, own.body.trustedDomains, own.body.retentionDays]).toEqual([200, false, ['example.com'], 365]);
});

test('the retention impact counts what the next pass trims: page text, task logs, step outputs and run transcripts', async () => {
  const DAY = 86_400_000;
  const ago = (n: number) => new Date(Date.now() - n * DAY).toISOString();
  const read = (url: string, days: number) => saveSource(db, 'pawsome', { kind: 'url', url, title: url, status: 'read', text: `Hooks matter. ${url}`, fetchedAt: ago(days) });
  const task = (ws: KbWorkspace, days: number, run: string) => {
    const t = createResearchTask(db, { ws, payerId: 'pawsome', role: 'market_analyst', kind: 'topic', origin: 'owner', objective: `Hooks ${run}`, budgetUsd: 1 });
    db.prepare(`UPDATE kb_tasks SET status = 'done', ended_at = ? WHERE id = ?`).run(ago(days), t.id);
    db.prepare(`INSERT INTO agent_runs (id, store_id, agent_id, task, status, transcript_json, created_at, mode) VALUES (?, 'pawsome', 'pawsome:market_analyst', 'Plan', 'done', '[{"type":"text"}]', ?, 'research')`).run(run, ago(days));
    db.prepare(`INSERT INTO kb_task_steps (task_id, stage, attempt, run_id, status, output_json, started_at, ended_at) VALUES (?, 'planning', 1, ?, 'done', '{"plan":1}', ?, ?)`).run(t.id, run, ago(days), ago(days));
    return t.id;
  };
  read('https://example.com/a', 200);
  read('https://example.com/b', 100);
  read('https://example.com/c', 5);
  task('pawsome', 200, 'r-a');
  task('pawsome', 100, 'r-b');
  task('pawsome', 5, 'r-c');
  task(null, 200, 'r-general'); // General's own retention
  const counts = async (days: number) => (await send('GET', `/api/kb/controls/trim?ws=pawsome&days=${days}`)).body;
  expect(await counts(90)).toEqual({ pages: 2, logs: 2, outputs: 2, transcripts: 2 });
  expect(await counts(150)).toEqual({ pages: 1, logs: 1, outputs: 1, transcripts: 1 });
  expect((await send('GET', '/api/kb/controls/trim?ws=pawsome&days=5')).status).toBe(400);

  // What it said is what the pass then trims, and nothing is left to trim after.
  expect((await send('PUT', '/api/kb/controls?ws=pawsome', { version: 0, retentionDays: 90 })).status).toBe(200);
  expect(maintain(db).trimmed).toEqual({ sources: 2, tasks: 2 });
  expect(Number(db.prepare(`SELECT count(*) AS n FROM agent_runs WHERE id IN ('r-a', 'r-b') AND transcript_json = '[]'`).get()!.n)).toBe(2);
  expect(await counts(90)).toEqual({ pages: 0, logs: 0, outputs: 0, transcripts: 0 });
});
