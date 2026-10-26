import type { Agent, AgentRun, AgentRunDetail, StoreMemory, StoreUsage } from '@frontline/shared';
import { OUTLIVE_RUN } from '@frontline/agents';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { runManager } from './agents';

let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  app = createApp(db);
});

const send = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

test('each agent says what its runs run on: the demo engine in tests and on demo stores, Claude and its model when on', async () => {
  const engine = async () => ((await (await send('GET', '/api/agents/glow%3Amarket_analyst')).json()) as Agent).engine;
  expect(await engine()).toEqual({ provider: 'demo' });
  // The Claude card: forced onto the demo engine (as tests are), it says so instead of starting the CLI.
  expect(await (await send('GET', '/api/claude-account')).json()).toMatchObject({ signedIn: false, error: expect.stringContaining('demo engine') });
  const saved = { engine: process.env.FRONTLINE_AGENT_ENGINE, model: process.env.FRONTLINE_AGENT_MODEL };
  try {
    Object.assign(process.env, { FRONTLINE_AGENT_ENGINE: 'claude', FRONTLINE_AGENT_MODEL: 'claude-sonnet-5-5' });
    expect(await engine()).toEqual({ provider: 'claude', model: 'claude-sonnet-5-5' });
    expect(((await (await send('GET', '/api/agents?stores=glow')).json()) as Agent[]).every((a) => a.engine?.provider === 'claude')).toBe(true);
  } finally {
    for (const [k, v] of [['FRONTLINE_AGENT_ENGINE', saved.engine], ['FRONTLINE_AGENT_MODEL', saved.model]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

describe('runs', () => {
  test('start, read, list, and continue the conversation', async () => {
    const res = await send('POST', '/api/agents/glow%3Acopywriter/runs', { task: '  Draft 3 headlines  ' });
    expect(res.status).toBe(201);
    const run = (await res.json()) as AgentRun;
    expect(run).toMatchObject({ agentId: 'glow:copywriter', storeId: 'glow', task: 'Draft 3 headlines', status: 'queued' });
    await runManager(db).idle();
    const detail = (await (await send('GET', `/api/runs/${run.id}`)).json()) as AgentRunDetail;
    expect(detail).toMatchObject({ status: 'done', transcript: [{ type: 'tool_call' }, { type: 'tool_result' }, { type: 'tool_call' }, { type: 'tool_result' }, { type: 'text_delta' }, { type: 'done' }] });

    const follow = (await (await send('POST', '/api/agents/glow%3Acopywriter/runs', { task: 'Shorter', resumeRunId: run.id })).json()) as AgentRun;
    await runManager(db).idle();
    const listed = (await (await send('GET', '/api/runs?agent=glow%3Acopywriter')).json()) as AgentRun[];
    expect(listed.map((r) => r.id)).toEqual([follow.id, run.id]);
    expect(listed[0]?.sessionId).toBe(detail.sessionId);
    expect(((await (await send('GET', '/api/runs?stores=peak')).json()) as AgentRun[]).length).toBe(0);
  });

  test('errors', async () => {
    expect((await send('POST', '/api/agents/glow%3Acopywriter/runs', { task: '' })).status).toBe(400);
    expect((await send('POST', '/api/agents/glow%3Anobody/runs', { task: 'x' })).status).toBe(404);
    await send('PATCH', '/api/agents/glow%3Acopywriter', { enabled: false });
    const offline = await send('POST', '/api/agents/glow%3Acopywriter/runs', { task: 'x' });
    expect([offline.status, await offline.json()]).toEqual([409, { error: 'This agent is offline. Redeploy it first.' }]);
    expect((await send('GET', '/api/runs/nope')).status).toBe(404);
    expect((await send('POST', '/api/runs/nope/cancel')).status).toBe(404);
  });
});

describe('memory', () => {
  test('owner adds, searches, edits and deletes store memory', async () => {
    const res = await send('POST', '/api/stores/glow/memory', { kind: 'preference', text: 'Never discount below 20% margin', tags: ['pricing'] });
    expect(res.status).toBe(201);
    const memory = (await res.json()) as StoreMemory;
    expect(memory).toMatchObject({ storeId: 'glow', agentId: 'owner', confidence: 0.8, tags: ['pricing'] });

    expect(((await (await send('GET', '/api/stores/glow/memory?q=PRICING')).json()) as StoreMemory[]).map((m) => m.id)).toEqual([memory.id]);
    expect(((await (await send('GET', '/api/stores/glow/memory?q=shipping')).json()) as StoreMemory[]).length).toBe(0);

    expect(await (await send('PATCH', `/api/memory/${memory.id}`, { confidence: 0.5 })).json()).toMatchObject({ confidence: 0.5, text: memory.text });
    expect((await send('PATCH', `/api/memory/${memory.id}`, { confidence: 2 })).status).toBe(400);
    expect(await (await send('PATCH', `/api/memory/${memory.id}`, { pinned: true })).json()).toMatchObject({ pinned: true });
    expect((await send('PATCH', `/api/memory/${memory.id}`, { pinned: 'yes' })).status).toBe(400);
    expect((await send('DELETE', `/api/memory/${memory.id}`)).status).toBe(204);
    expect((await send('DELETE', `/api/memory/${memory.id}`)).status).toBe(404);
  });

  test('validation and unknown stores', async () => {
    expect((await send('POST', '/api/stores/glow/memory', { kind: 'rumor', text: 'Something long enough' })).status).toBe(400);
    expect((await send('POST', '/api/stores/glow/memory', { kind: 'fact', text: 'hi' })).status).toBe(400);
    expect((await send('GET', '/api/stores/nope/memory')).status).toBe(404);
    expect((await send('PATCH', '/api/memory/nope', { confidence: 0.4 })).status).toBe(404);
  });
});

test("usage: today's AI cost, credits and added ad budget per store, the counters the caps check", async () => {
  const now = new Date().toISOString();
  const usage = async () => (await (await send('GET', '/api/usage?stores=glow')).json()) as StoreUsage[];
  const before = await usage();
  expect(before.map((u) => u.storeId)).toEqual(['glow']);
  db.prepare(`INSERT INTO agent_runs (id, store_id, agent_id, task, cost_usd, created_at) VALUES ('u1', 'glow', 'glow:copywriter', 't', 0.25, ?)`).run(now);
  db.prepare(`INSERT INTO agent_runs (id, store_id, agent_id, task, cost_usd, created_at) VALUES ('u2', 'glow', 'glow:copywriter', 't', 9, '2020-01-01T00:00:00Z')`).run();
  db.prepare(`INSERT INTO creative_credits (store_id, credits, created_at) VALUES ('glow', 2, ?)`).run(now);
  const budget = (id: string, status: string) =>
    db.prepare(`INSERT INTO approvals (id, store_id, agent_id, title, reason, action_json, status, created_at) VALUES (?, 'glow', 'glow:ad_strategist', 't', 'r', ?, ?, ?)`)
      .run(id, JSON.stringify({ kind: 'ads.set_budget', payload: {}, amountUsd: 12 }), status, now);
  budget('u4', 'pending');
  budget('u5', 'denied');
  const [after] = await usage();
  expect(after!.agentCostUsd - before[0]!.agentCostUsd).toBeCloseTo(0.25);
  expect(after!.credits - before[0]!.credits).toBe(2);
  expect(after!.adBudgetAddedUsd - before[0]!.adBudgetAddedUsd).toBe(12);
  expect(((await (await send('GET', '/api/usage')).json()) as StoreUsage[]).length).toBeGreaterThan(1);
});

test('every kind the server carries out on approval outlives its run (a restart must not expire it)', () => {
  const src = readFileSync(fileURLToPath(new URL('./agents.ts', import.meta.url)), 'utf8');
  const executed = [...src.matchAll(/a\.action\.kind === '([\w.]+)'/g)].map((m) => m[1]);
  expect(executed.length).toBeGreaterThan(4);
  expect(executed.filter((k) => !OUTLIVE_RUN.includes(k!))).toEqual([]);
});
