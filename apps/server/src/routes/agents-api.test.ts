import type { AgentRun, AgentRunDetail, StoreMemory } from '@frontline/shared';
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

describe('runs', () => {
  test('start, read, list, and continue the conversation', async () => {
    const res = await send('POST', '/api/agents/glow%3Acopywriter/runs', { task: '  Draft 3 headlines  ' });
    expect(res.status).toBe(201);
    const run = (await res.json()) as AgentRun;
    expect(run).toMatchObject({ agentId: 'glow:copywriter', storeId: 'glow', task: 'Draft 3 headlines', status: 'queued' });
    await runManager(db).idle();
    const detail = (await (await send('GET', `/api/runs/${run.id}`)).json()) as AgentRunDetail;
    expect(detail).toMatchObject({ status: 'done', transcript: [{ type: 'tool_call' }, { type: 'tool_result' }, { type: 'text_delta' }, { type: 'done' }] });

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
