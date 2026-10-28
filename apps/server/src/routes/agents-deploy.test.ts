import { claudeEngine, claudeRuntime, conversationPreface, createRunManager, getConfig, getRun } from '@frontline/agents';
import type { AgentRun, Conversation, ConversationDetail, ToolGroup } from '@frontline/shared';
import { randomUUID } from 'node:crypto';
import { beforeEach, expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { getStore } from '../stores';
import { runManager, toolEnv } from './agents';

// Claude signed in on this machine, with two models: what Deploy and "Change runtime or model…" are checked against.
vi.mock('./agents-runtimes', async (original) => ({
  ...(await original<typeof import('./agents-runtimes')>()),
  runtimes: async () => [
    claudeRuntime({
      signedIn: true,
      checkedAt: '2026-10-28T10:00:00Z',
      models: [
        { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium', default: true },
        { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium' },
      ],
    }),
  ],
}));

let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  app = createApp(db);
});

const send = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
async function deploy(body: Record<string, unknown>) {
  const r = await send('POST', '/api/conversations?store=glow', { clientRequestId: randomUUID(), type: 'copywriter', message: 'Draft the spring hero line', ...body });
  const json = (await r.json()) as { conversation: Conversation; run: AgentRun; error?: string; field?: string };
  await runManager(db).idle();
  return { status: r.status, ...json };
}
/** A run manager whose Claude engine records what each query was asked. */
function capturing() {
  const asked: { prompt: string; options: { model?: string; effort?: string; resume?: string; fallbackModel?: string } }[] = [];
  const engine = claudeEngine({
    query: (params) => {
      asked.push(params as (typeof asked)[number]);
      return (async function* () {
        yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: 's', total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } as never;
      })();
    },
  });
  return { asked, m: createRunManager({ db, env: toolEnv(db), store: (id) => getStore(db, id), engine }) };
}
const change = async (id: string, body: object) => {
  const r = await send('POST', `/api/conversations/${id}/config?store=glow`, body);
  return { status: r.status, body: (await r.json()) as ConversationDetail & { error?: string; field?: string } };
};

test("Deploy's choice is what the run gets: the model and effort reach Claude's options exactly", async () => {
  const opened = await deploy({ config: { runtime: 'claude', model: 'claude-sonnet-5-5', effort: 'high' } });
  expect(opened.status).toBe(201);
  expect(getConfig(db, opened.conversation.configId)).toMatchObject({ runtime: 'claude', model: 'claude-sonnet-5-5', effort: 'high' });
  expect(getRun(db, opened.run.id)).toMatchObject({ runtime: 'claude', model: 'claude-sonnet-5-5', effort: 'high' });
  // The same conversation's next turn, on Claude.
  const { asked, m } = capturing();
  m.start('glow:copywriter', 'Shorter, please', undefined, undefined, { conversationId: opened.conversation.id });
  await m.idle();
  expect(asked[0]?.options).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'high' });
  expect(asked[0]?.options).not.toHaveProperty('fallbackModel');
});

test("Deploy lists a type's tools with what they need connected; a switched-off draft stays out of the config", async () => {
  const groups = (await (await send('GET', '/api/tool-groups?store=glow&type=copywriter')).json()) as ToolGroup[];
  expect(groups.find((g) => g.id === 'drafts')?.tools).toEqual(expect.arrayContaining(['draft_page', 'publish_page']));
  expect(groups.find((g) => g.id === 'creatives')).toMatchObject({ integration: { kind: 'higgsfield', connected: false } });
  expect((await send('GET', '/api/tool-groups?store=glow&type=nope')).status).toBe(404);
  const opened = await deploy({ config: { runtime: 'claude', tools: (await (await send('GET', '/api/agent-types?store=glow')).json() as { id: string; contract: { tools: string[] } }[]).find((t) => t.id === 'copywriter')!.contract.tools.filter((t) => t !== 'draft_page') } });
  expect(getConfig(db, opened.conversation.configId)?.tools).not.toContain('draft_page'); // the engine test checks a run's tools follow it
});

test('"Change runtime or model…" writes a new config, and the next turn starts a new session from the recap', async () => {
  const opened = await deploy({});
  expect(getConfig(db, opened.conversation.configId)?.runtime).toBe('demo');
  expect((await change(opened.conversation.id, { runtime: 'claude', model: 'claude-sonnet-9' })).body).toMatchObject({ field: 'model' });
  const moved = await change(opened.conversation.id, { runtime: 'claude', model: 'claude-sonnet-5-5', effort: 'low' });
  expect(moved.status).toBe(200);
  expect(moved.body.configId).not.toBe(opened.conversation.configId);
  expect(moved.body.config).toMatchObject({ runtime: 'claude', model: 'claude-sonnet-5-5', effort: 'low', tools: getConfig(db, opened.conversation.configId)!.tools });
  // The next turn starts a new provider session, from the recap.
  const { asked, m } = capturing();
  const run = m.start('glow:copywriter', 'Now a shorter one', undefined, undefined, { conversationId: opened.conversation.id });
  await m.idle();
  expect(typeof run === 'string' ? run : getRun(db, run.id)).toMatchObject({ configId: moved.body.configId, model: 'claude-sonnet-5-5', effort: 'low' });
  expect(asked[0]?.options.resume).toBeUndefined();
  expect(asked[0]?.prompt).toMatch(/^This continues "Draft the spring hero line"\. Earlier work[\s\S]*The owner asked: Draft the spring hero line[\s\S]*Now: Now a shorter one$/);
  // A budget doesn't move to a runtime that bills no dollars.
  const priced = await deploy({ config: { runtime: 'claude', permissions: { budgetUsd: 2 } } });
  expect((await change(priced.conversation.id, { runtime: 'demo' })).body.config.permissions).toEqual({ saveFindings: 'off' });
  expect((await send('POST', `/api/conversations/${priced.conversation.id}/config?store=peak`, { runtime: 'demo' })).status).toBe(404);
});

test('a pre-go-live run is left out of the Change-runtime recap; a conversation with nothing after it is refused', async () => {
  const opened = await deploy({ message: 'Demo-era question' });
  db.prepare('UPDATE agent_runs SET created_at = ? WHERE id = ?').run('2026-01-01T00:00:00Z', opened.run.id);
  db.prepare(`INSERT INTO done_once (ref, at) VALUES ('activate:glow', ?)`).run('2026-02-01T00:00:00Z');
  expect(await change(opened.conversation.id, { runtime: 'claude' })).toMatchObject({ status: 409, body: { error: 'That conversation ran on demo data, before the store went live: start a new one.' } });
  // A live-era turn in the same conversation (written as the old build would have).
  const insert = db.prepare(
    `INSERT INTO agent_runs (id, store_id, agent_id, task, status, conversation_id, config_id, runtime, created_at, transcript_json) VALUES (?, 'glow', 'glow:copywriter', ?, 'done', ?, ?, 'demo', ?, ?)`,
  );
  insert.run('live-1', 'Live-era question', opened.conversation.id, opened.conversation.configId, '2026-03-01T00:00:00Z', JSON.stringify([{ type: 'text_delta', text: 'Live answer.' }]));
  expect((await change(opened.conversation.id, { runtime: 'claude' })).status).toBe(200);
  const preface = conversationPreface(db, opened.conversation.id)!;
  expect(preface).toContain('> The owner asked: Live-era question\n> You answered: Live answer.');
  expect(preface).not.toContain('The owner asked: Demo-era question'); // the title stays
});

test("the runtime can't change while a reply is going", async () => {
  const opened = await deploy({});
  db.prepare(`UPDATE agent_runs SET status = 'running' WHERE id = ?`).run(opened.run.id);
  expect(await change(opened.conversation.id, { runtime: 'claude' })).toMatchObject({ status: 409, body: { error: expect.stringMatching(/^Wait for the reply to finish/) } });
});
