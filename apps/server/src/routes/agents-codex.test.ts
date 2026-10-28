import { CODEX_FEATURES_OFF, claudeRuntime, codexEngine, createConversation, createRunManager, fakeEngine, fakeCodex, getConfig, getRun, resolveType, seatDefault, type Engine, type FakeCodexChild } from '@frontline/agents';
import { CODEX_ULTRA, type AgentRun, type Conversation } from '@frontline/shared';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { saveIntegration } from '../integrations';
import { initLog } from '../log';
import { loadKey } from '../secrets';
import { getStore } from '../stores';
import { runHooks, runManager, toolEnv } from './agents';

// Claude and Codex signed in on this machine: what Deploy and "Change runtime or model…" are checked against.
vi.mock('./agents-runtimes', async (original) => ({
  ...(await original<typeof import('./agents-runtimes')>()),
  runtimes: async () => [
    claudeRuntime({ signedIn: true, checkedAt: '2026-10-28T10:00:00Z', models: [{ id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', default: true }] }),
    {
      runtime: 'codex',
      connected: true,
      models: [{ id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], defaultEffort: 'low', default: true }],
      source: 'discovered',
      version: '0.163.0',
      checkedAt: '2026-10-28T10:00:00Z',
    },
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
/** What Codex sends the run-scoped MCP endpoint, as the run's bearer. */
const mcp = (token: string, body: object) =>
  app.request('/api/codex/mcp', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...body }),
  });
const deploy = async (config: object) => {
  const r = await send('POST', '/api/conversations?store=glow', { clientRequestId: randomUUID(), type: 'copywriter', message: 'Draft the spring hero line', config });
  return { status: r.status, ...((await r.json()) as { conversation: Conversation; error?: string; field?: string }) };
};

/** A run manager whose Codex conversations run on a fake codex (`script`); other runs on the demo engine. */
function codexRuns(script: (child: FakeCodexChild) => unknown, perStore = 2) {
  const fake = fakeCodex(script);
  const codex = codexEngine({ home: mkdtempSync(join(tmpdir(), 'codex-home-')), mcpUrl: () => 'http://127.0.0.1:8847/api/codex/mcp', spawn: fake.spawn, version: async () => '0.163.0' });
  const engine: Engine = (input) => (input.config?.runtime === 'codex' ? codex : fakeEngine())(input);
  const m = createRunManager({ db, env: toolEnv(db), store: (id) => getStore(db, id), engine, perStore, ...runHooks(db) });
  return { fake, m };
}
/** A Codex conversation for one of glow's seats, with every tool of its type except `off`. */
function conversation(role: 'copywriter' | 'ad_strategist', off: string[] = []) {
  const store = getStore(db, 'glow')!;
  const type = resolveType(db, 'glow', role)!;
  const base = seatDefault(store, type);
  return createConversation(db, store, type, { ...base, runtime: 'codex', model: 'gpt-6.1-sol', effort: 'low', tools: base.tools.filter((t) => !off.includes(t)), permissions: { stopAfterMin: 20, saveFindings: 'off' } }, { title: 'Codex check' });
}
const turn = (m: ReturnType<typeof codexRuns>['m'], c: Conversation, task = 'Draft the spring hero line') => {
  const run = m.start(c.agentId, task, undefined, undefined, { conversationId: c.id });
  if (typeof run === 'string') throw new Error(run);
  return run;
};
const finish = (child: FakeCodexChild) => {
  child.write({ type: 'thread.started', thread_id: 'thread-1' });
  child.write({ type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: 'Done.' } });
  child.write({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 2 } });
  child.exit(0);
};

test('Deploy refuses a Codex config with a budget, without Stop after, or at ultra (with its reason), and the config change route refuses ultra too', async () => {
  expect(await deploy({ runtime: 'codex', permissions: { budgetUsd: 2, stopAfterMin: 20 } })).toMatchObject({ status: 400, field: 'permissions.budgetUsd' });
  expect(await deploy({ runtime: 'codex' })).toMatchObject({ status: 400, field: 'permissions.stopAfterMin', error: 'Codex needs a "Stop after" limit: dollar caps don\'t apply to it.' });
  expect(await deploy({ runtime: 'codex', effort: 'ultra', permissions: { stopAfterMin: 20 } })).toMatchObject({ status: 400, field: 'effort', error: CODEX_ULTRA });
  const ok = await deploy({ runtime: 'codex', permissions: { stopAfterMin: 20 } });
  expect(ok.status).toBe(201);
  expect(getConfig(db, ok.conversation.configId)).toMatchObject({ runtime: 'codex', model: 'gpt-6.1-sol', effort: 'low', permissions: { stopAfterMin: 20 } });
  const claude = await deploy({ runtime: 'claude', permissions: { budgetUsd: 2 } });
  await runManager(db).idle();
  const change = (body: object) => send('POST', `/api/conversations/${claude.conversation.id}/config?store=glow`, body);
  expect(await (await change({ runtime: 'codex', effort: 'ultra', stopAfterMin: 20 })).json()).toMatchObject({ field: 'effort', error: CODEX_ULTRA });
  expect(await (await change({ runtime: 'codex' })).json()).toMatchObject({ field: 'permissions.stopAfterMin' });
  const moved = (await (await change({ runtime: 'codex', stopAfterMin: 15 })).json()) as { config: { runtime: string; permissions: object } };
  expect(moved.config).toMatchObject({ runtime: 'codex', permissions: { stopAfterMin: 15 } });
  expect(moved.config.permissions).not.toHaveProperty('budgetUsd');
});

test("a Codex run's endpoint lists only its own tools (a switched-off draft is missing), every outside feature is off, and an ended run's token gets 401", async () => {
  let token = '';
  let tools: string[] = [];
  const { fake, m } = codexRuns(async (child) => {
    await child.turn;
    token = child.env.FRONTLINE_MCP_TOKEN!;
    const listed = (await (await mcp(token, { method: 'tools/list' })).json()) as { result: { tools: { name: string }[] } };
    tools = listed.result.tools.map((t) => t.name);
    finish(child);
  });
  const run = turn(m, conversation('copywriter', ['draft_page']));
  await m.idle();
  expect(getRun(db, run.id)).toMatchObject({ status: 'done', runtime: 'codex', model: 'gpt-6.1-sol', effort: 'low', runtimeVersion: '0.163.0', usage: { inputTokens: 10, outputTokens: 2, costUsd: 0 } });
  expect(tools).toContain('create_creative');
  expect(tools).not.toContain('draft_page');
  const args = fake.spawned[0]!.args;
  for (const f of CODEX_FEATURES_OFF) expect(args).toContain(`features.${f}=false`);
  expect(args).toContain('features.multi_agent=false');
  expect(args).toEqual(expect.arrayContaining(['mcp_servers.frontline.url="http://127.0.0.1:8847/api/codex/mcp"', 'mcp_servers.frontline.bearer_token_env_var="FRONTLINE_MCP_TOKEN"', 'mcp_servers.frontline.tool_timeout_sec=86400']));
  expect(args.join(' ')).not.toContain(token);
  expect((await mcp(token, { method: 'tools/list' })).status).toBe(401);
  expect((await mcp(randomBytes(32).toString('hex'), { method: 'tools/list' })).status).toBe(401);
});

test("an approval asked over MCP shows in the run's transcript and frees its slot; stopping the run then leaves nothing pending", async () => {
  db.prepare("UPDATE stores SET niche = 'other', niche_detail = 'pickleball paddles' WHERE id = 'glow'").run();
  let child!: FakeCodexChild;
  const { m } = codexRuns(async (c) => {
    child = c;
    await c.turn;
    c.write({ type: 'thread.started', thread_id: 'thread-1' });
    // Codex waits in the tool until the owner decides or the run ends.
    void mcp(c.env.FRONTLINE_MCP_TOKEN!, {
      method: 'tools/call',
      params: { name: 'request_approval', arguments: { title: 'Save the pickleball niche pack', reason: 'What sells in this niche', kind: 'save_niche_pack', payload: { markdown: '# Pickleball paddles' } } },
    });
  }, 1);
  const run = turn(m, conversation('copywriter'));
  await vi.waitFor(() => expect(m.get(run.id)!.transcript.some((e) => e.type === 'approval_request')).toBe(true));
  expect(m.get(run.id)!.transcript.find((e) => e.type === 'tool_call')).toMatchObject({ name: 'request_approval' });
  expect(db.prepare("SELECT count(*) AS n FROM approvals WHERE run_id = ? AND status = 'pending'").get(run.id)?.n).toBe(1);
  // One run at a time for this store, and the waiting one doesn't hold it: another agent's run goes through.
  const other = m.start('glow:ad_strategist', 'Check the budgets') as AgentRun;
  await vi.waitFor(() => expect(getRun(db, other.id)?.status).toBe('done'));
  expect(getRun(db, run.id)?.status).toBe('running');
  m.cancel(run.id);
  await m.idle();
  expect(getRun(db, run.id)?.status).toBe('cancelled');
  expect(child.signalCode).toBe('SIGKILL');
  expect(db.prepare("SELECT count(*) AS n FROM approvals WHERE run_id = ? AND status = 'pending'").get(run.id)?.n).toBe(0);
});

test("the secrets test's Codex case: the child's env is the allowlist, its argv holds no secret, and the MCP token lives only in memory", async () => {
  const metaToken = `EAAG${randomBytes(12).toString('hex')}`;
  const saved = process.env.FRONTLINE_SECRET_KEY;
  const secretKey = randomBytes(32).toString('base64');
  process.env.FRONTLINE_SECRET_KEY = secretKey;
  try {
    const dir = mkdtempSync(join(tmpdir(), 'frontline-secrets-'));
    initLog(dir);
    const key = loadKey(dir);
    app = createApp(db, key);
    saveIntegration(db, key, { kind: 'meta_ads', storeId: 'glow', values: { adAccountId: 'act_1', accessToken: metaToken } });
    let token = '';
    const { fake, m } = codexRuns(async (child) => {
      await child.turn;
      token = child.env.FRONTLINE_MCP_TOKEN!;
      await mcp(token, { method: 'tools/call', params: { name: 'store_summary', arguments: {} } });
      finish(child);
    });
    const c = conversation('ad_strategist');
    const run = turn(m, c, 'Check the ads');
    await m.idle();
    const child = fake.spawned[0]!;
    expect(Object.keys(child.env).sort()).toEqual(['CODEX_HOME', 'FRONTLINE_MCP_TOKEN', 'PATH', 'SYSTEMROOT', 'USERPROFILE'].filter((k) => !['PATH', 'SYSTEMROOT', 'USERPROFILE'].includes(k) || process.env[k]));
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const argv = child.args.join(' ');
    for (const secret of [metaToken, secretKey, key.toString('hex'), token]) expect(argv.includes(secret)).toBe(false);
    expect(argv).not.toContain('meta_ads'); // the store's external servers are Claude only for now
    expect(getRun(db, run.id)!.transcript.some((e) => e.type === 'tool_result')).toBe(true); // the tool really ran over MCP
    const places = [
      JSON.stringify(db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(run.id)),
      JSON.stringify(db.prepare('SELECT * FROM agent_configs').all()),
      await (await send('GET', `/api/runs/${run.id}`)).text(),
      await (await send('GET', `/api/conversations/${c.id}/thread?store=glow`)).text(),
      existsSync(join(dir, 'logs', 'api.log')) ? readFileSync(join(dir, 'logs', 'api.log'), 'utf8') : '',
    ];
    for (const place of places) for (const secret of [metaToken, secretKey, token]) expect(place.includes(secret)).toBe(false);
  } finally {
    if (saved === undefined) delete process.env.FRONTLINE_SECRET_KEY;
    else process.env.FRONTLINE_SECRET_KEY = saved;
  }
});
