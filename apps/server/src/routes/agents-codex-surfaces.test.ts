import { advanceMissions, codexEngine, createConversation, createRunManager, createTeam, fakeCodex, fakeEngine, getConfig, getRun, getTeam, resolveType, seatDefault, TEAM_PLAN, TEAM_SYNTHESIS, type FakeCodexChild, type RunManager, type ToolEnv } from '@frontline/agents';
import type { AgentRole, RuntimeCapabilities } from '@frontline/shared';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { upsertListing } from '../product-research/catalog';
import { refreshProduct } from '../product-research/evaluate';
import { getTask, startTask } from '../product-research/tasks';
import { getStore } from '../stores';
import { toolEnv } from './agents';

let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  app = createApp(db);
});
const config = { runtime: 'codex' as const, model: 'gpt-6.1-sol', effort: 'low', permissions: { stopAfterMin: 2, saveFindings: 'off' as const } };
const caps: RuntimeCapabilities[] = [{ runtime: 'codex', connected: true, models: [{ id: config.model, label: 'Sol', efforts: ['low'], defaultEffort: 'low', default: true }], source: 'discovered', checkedAt: '2026-10-28T00:00:00Z' }];
const finish = (child: FakeCodexChild, text = 'Done.') => {
  child.write({ type: 'thread.started', thread_id: 'surface-thread' });
  child.write({ type: 'item.completed', item: { id: 'answer', type: 'agent_message', text } });
  child.write({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 2 } });
  child.exit(0);
};
const call = async (child: FakeCodexChild, name: string, args = {}) => {
  const response = await app.request('/api/codex/mcp', {
    method: 'POST',
    headers: { authorization: `Bearer ${child.env.FRONTLINE_MCP_TOKEN}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  expect(response.status).toBe(200);
  const body = await response.json() as { result: { content: { text: string }[]; isError?: boolean }; error?: unknown };
  expect(body.error).toBeUndefined();
  expect(body.result.isError).not.toBe(true);
  return body.result.content.map((c) => c.text).join('\n');
};
const fence = (value: unknown) => `\n\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;
function manager(script: (child: FakeCodexChild) => unknown, env: Partial<ToolEnv> = {}) {
  const fake = fakeCodex(script);
  const codex = codexEngine({ home: mkdtempSync(join(tmpdir(), 'codex-surfaces-')), mcpUrl: () => 'http://127.0.0.1:1/api/codex/mcp', spawn: fake.spawn });
  const m: RunManager = createRunManager({
    db, env: { ...toolEnv(db), ...env }, store: (id) => getStore(db, id),
    engine: (input) => input.config?.runtime === 'codex' ? codex(input) : fakeEngine((i) => {
      const member = [...i.task.matchAll(/^- id (\S+):/gm)][1]?.[1];
      return [
        { type: 'text_delta', text: i.task.startsWith(TEAM_PLAN) ? fence({ tasks: [{ id: 'copy', assignee: member, task: 'Read the store summary and write one hero line.' }] }) : 'The member checked Glow; use the LED mask headline.' },
        { type: 'done', sessionId: 'demo-lead', usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 } },
      ];
    })(input),
    onRun: (run) => void (['done', 'error', 'cancelled'].includes(run.status) && advanceMissions(db, m.start)),
  });
  return { m, fake };
}
function conversation(role: AgentRole) {
  const store = getStore(db, 'glow')!;
  const type = resolveType(db, store.id, role)!;
  return createConversation(db, store, type, { ...seatDefault(store, type), ...config }, { title: 'Codex surface check' });
}

test('a Codex team member uses its real MCP endpoint and contributes to the demo lead synthesis', async () => {
  const { m, fake } = manager(async (child) => {
    await child.turn;
    expect(JSON.parse(await call(child, 'store_summary'))).toHaveProperty('totals');
    finish(child, fence({ summary: 'Lead with the LED mask.', output: 'Your evening glow, simplified.', evidence: [], open_questions: [], disagrees_with: [] }));
  });
  const made = createTeam(db, getStore(db, 'glow')!, { clientRequestId: randomUUID(), title: 'Codex team check', objective: 'Write a headline from the store summary.', participants: [{ type: 'market_analyst' }, { type: 'copywriter', config }] }, caps);
  if ('status' in made) throw new Error(made.error);
  advanceMissions(db, m.start);
  await m.idle();
  const team = getTeam(db, made.team.id)!;
  expect(team.status).toBe('done');
  expect(team.steps.map((s) => s.status)).toEqual(['done', 'done', 'done']);
  const member = getRun(db, team.steps[1]!.runId!)!;
  expect(member).toMatchObject({ runtime: 'codex', configId: team.participants![1]!.configId, status: 'done', usage: { costUsd: 0 } });
  expect(m.get(member.id)!.transcript).toContainEqual(expect.objectContaining({ type: 'tool_call', name: 'store_summary' }));
  expect(getRun(db, team.steps[2]!.runId!)!.task).toContain('Your evening glow, simplified.');
  expect(getRun(db, team.steps[2]!.runId!)!.task.startsWith(TEAM_SYNTHESIS)).toBe(true);
  expect(fake.spawned).toHaveLength(1);
});

test('Product Research accepts a signed-in Codex config with Stop after, and its task reaches MCP', async () => {
  const { productId } = upsertListing(db, { source: 'cj', sourceRef: 'codex-check', title: 'Travel dog water bowl', category: 'Pet Supplies', origin: 'ingest' });
  refreshProduct(db, productId);
  const { m, fake } = manager(async (child) => {
    expect(await child.turn).toContain(`for product ${productId}`);
    expect(JSON.parse(await call(child, 'store_summary'))).toHaveProperty('totals');
    finish(child, 'The supplier shipping cost is still unknown.');
  });
  const result = startTask(db, m, getStore(db, 'pawsome')!, { clientRequestId: randomUUID(), productId, type: 'product_hunter', mode: 'new', instructions: 'Check the margin and US shipping.', config }, caps);
  if ('error' in result) throw new Error(result.error);
  expect(result.status).toBe(201);
  await m.idle();
  expect(getTask(db, result.task.id, 'pawsome')).toMatchObject({ status: 'finished_without_report' });
  expect(getConfig(db, getRun(db, result.task.runId!)!.configId!)).toMatchObject(config);
  expect(getRun(db, result.task.runId!)).toMatchObject({ status: 'done', runtime: 'codex' });
  expect(m.get(result.task.runId!)!.transcript).toContainEqual(expect.objectContaining({ type: 'tool_call', name: 'store_summary' }));
  expect(fake.spawned).toHaveLength(1);
});

test('Store Developer reads a theme, drafts a copy, and waits for its publish approval through MCP', async () => {
  const files = [{ filename: 'sections/main-product.liquid', body: '<div>Clearer product heading</div>' }];
  const read = vi.fn(async () => [{ filename: files[0]!.filename, content: '<div>Old heading</div>' }]);
  const draft = vi.fn(async () => ({ id: '9', name: 'Frontline: Clearer heading', role: 'UNPUBLISHED', processing: false, previewUrl: 'https://glow.example/?preview_theme_id=9' }));
  let reply = '';
  const { m, fake } = manager(async (child) => {
    await child.turn;
    expect(await call(child, 'read_theme_files', { filenames: [files[0]!.filename] })).toContain('Old heading');
    reply = await call(child, 'draft_theme_change', { title: 'Clearer heading', summary: 'The product title needs clearer visual hierarchy.', files });
    finish(child);
  }, { themes: { list: async () => [], read, draft, remove: async () => {} } });
  const c = conversation('store_developer');
  const run = m.start(c.agentId, 'Improve the product heading.', undefined, undefined, { conversationId: c.id });
  if (typeof run === 'string') throw new Error(run);
  await vi.waitFor(() => expect(m.get(run.id)!.transcript.some((e) => e.type === 'approval_request')).toBe(true));
  const pending = m.get(run.id)!.transcript.find((e) => e.type === 'approval_request');
  if (pending?.type !== 'approval_request') throw new Error('Missing theme approval');
  expect(pending.approval.action).toMatchObject({ kind: 'store.publish_theme', payload: { themeId: '9', files: [files[0]!.filename] } });
  expect(read).toHaveBeenCalledWith('glow', [files[0]!.filename], undefined);
  expect(draft).toHaveBeenCalledWith('glow', 'Frontline: Clearer heading', files);
  expect(m.get(run.id)!.status).toBe('running');
  const denied = await app.request(`/api/approvals/${pending.approval.id}/deny?store=glow`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'deny' }) });
  expect(denied.status).toBe(200);
  await m.idle();
  expect(reply).toContain('Denied');
  expect(getRun(db, run.id)!.status).toBe('done');
  expect(fake.spawned).toHaveLength(1);
});
