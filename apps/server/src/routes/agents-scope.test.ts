import { APP_TOOLS, callTool, claudeEngine, createCard, createConversation, createRunManager, defaultTools, ensureCategoryPath, getAgent, getConfig, resolveType, retrieveKnowledge, runAgent, runTools, seatDefault, writeMemory, type ClaudeEngineOptions, type Engine, type RunInput, type ToolContext } from '@frontline/agents';
import type { AgentConfig, AgentEvent } from '@frontline/shared';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { saveIntegration } from '../integrations';
import { initLog } from '../log';
import { loadKey } from '../secrets';
import { getStore } from '../stores';
import { runHooks, runManager, toolEnv } from './agents';

let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  app = createApp(db);
});

const send = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const config = (agentId: string, tools: string[]): AgentConfig => ({
  id: `cfg-${agentId}`, storeId: agentId.split(':')[0]!, agentId, runtime: 'claude', tools, knowledge: ['store', 'general'], permissions: { saveFindings: 'off' }, createdAt: '2026-10-28',
});
const addConfig = (c: AgentConfig) =>
  db.prepare(`INSERT INTO agent_configs (id, store_id, agent_id, runtime, tools_json, knowledge_json, permissions_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(c.id, c.storeId, c.agentId, c.runtime, JSON.stringify(c.tools), JSON.stringify(c.knowledge), JSON.stringify(c.permissions), c.createdAt);

/**
 * Glow's records, reached by id. Every route here answers 404 when `?store=` names another store, and leaves the record
 * alone. Later items add their routes (and body ids) to this table.
 */
const ROUTES: [method: string, path: string, body?: unknown][] = [
  ['GET', '/api/runs/r1'],
  ['POST', '/api/runs/r1/cancel'],
  ['POST', '/api/approvals/a1/approve'],
  ['POST', '/api/approvals/a2/deny'],
  ['PATCH', '/api/memory/:memory', { text: 'Ships from Ohio in two days' }],
  ['DELETE', '/api/memory/:memory'],
  ['GET', '/api/agents/glow%3Acopywriter'],
  ['PATCH', '/api/agents/glow%3Acopywriter', { autonomy: 'ask' }],
  ['GET', '/api/squad-missions/m1'],
  ['POST', '/api/squad-missions/m1/cancel'],
  ['DELETE', '/api/flow-drafts/f1'],
  // AA-05: conversations require ?store= (decision 13).
  ['GET', '/api/conversations/v1'],
  ['GET', '/api/conversations/v1/thread'],
  ['PATCH', '/api/conversations/v1', { pinned: true }],
  ['POST', '/api/conversations/v1/messages', { clientRequestId: 'req-message-1', message: 'Shorter please' }],
  ['POST', '/api/conversations/v1/runs/r2/retry', { clientRequestId: 'req-retry-1' }],
  ['POST', '/api/conversations/v1/runs/r3/resume', { clientRequestId: 'req-resume-1' }],
  ['POST', '/api/conversations/v1/stop', {}],
  // AA-19: teams (decision 12).
  ['GET', '/api/teams/tm1'],
  ['POST', '/api/teams/tm1/notes', { clientRequestId: 'req-note-1', text: 'Lead with the photo strip' }],
  ['POST', '/api/teams/tm1/participants', { type: 'copywriter' }],
  ['POST', '/api/teams/tm1/steps/plan/resume', { clientRequestId: 'req-team-resume-1' }],
  ['POST', '/api/teams/tm1/cancel', {}],
];

test("by-id routes given another store answer 404 and change nothing; given the record's own store they work", async () => {
  db.exec(`INSERT INTO agent_runs (id, store_id, agent_id, task, status, created_at) VALUES ('r1', 'glow', 'glow:copywriter', 'Draft', 'queued', '2026-10-28');
    INSERT INTO approvals (id, store_id, agent_id, title, reason, action_json, status, created_at) VALUES
      ('a1', 'glow', 'glow:copywriter', 'Try it', 'r', '{"kind":"k","payload":{}}', 'pending', '2026-10-28'),
      ('a2', 'glow', 'glow:copywriter', 'Try it', 'r', '{"kind":"k","payload":{}}', 'pending', '2026-10-28');
    INSERT INTO squad_missions (id, store_id, title, steps_json, created_at) VALUES ('m1', 'glow', 'Launch', '[]', '2026-10-28');
    INSERT INTO flow_drafts (id, store_id, agent_id, name, trigger, messages_json, notes, created_at) VALUES ('f1', 'glow', 'glow:email_sms', 'Welcome', 'signup', '[]', '', '2026-10-28');
    INSERT INTO agent_configs (id, store_id, agent_id, runtime, tools_json, knowledge_json, permissions_json, created_at) VALUES ('cfg1', 'glow', 'glow:copywriter', 'demo', '["store_summary"]', '["store"]', '{"saveFindings":"off"}', '2026-10-28');
    INSERT INTO conversations (id, store_id, config_id, title, created_at, updated_at, last_activity_at) VALUES ('v1', 'glow', 'cfg1', 'Spring copy', '2026-10-28', '2026-10-28', '2026-10-28');
    INSERT INTO squad_missions (id, store_id, title, steps_json, created_at, kind, objective, participants_json, max_concurrent, retries, owner_notes_json) VALUES
      ('tm1', 'glow', 'Spring launch', '[{"id":"plan","kind":"plan","role":"copywriter","configId":"cfg1","task":"Plan the spring launch","dependsOn":[]}]', '2026-10-28', 'team', 'Plan the spring launch', '[{"configId":"cfg1"}]', 2, 2, '[]');
    INSERT INTO agent_runs (id, store_id, agent_id, task, status, error, conversation_id, config_id, created_at) VALUES
      ('r2', 'glow', 'glow:copywriter', 'Draft', 'error', 'boom', 'v1', 'cfg1', '2026-10-28'),
      ('r3', 'glow', 'glow:copywriter', 'Draft', 'error', 'Interrupted by an app restart', 'v1', 'cfg1', '2026-10-28');`);
  const memory = writeMemory(db, { storeId: 'glow', agentId: 'owner', kind: 'fact', text: 'Ships from Ohio', confidence: 0.8 });
  const snapshot = () =>
    ['agent_runs', 'approvals', 'store_memory', 'agents', 'squad_missions', 'flow_drafts', 'conversations'].map((t) => db.prepare(`SELECT * FROM ${t} WHERE store_id = 'glow' ORDER BY id`).all().map((r) => ({ ...r })));
  const before = snapshot();
  const call = async (store: string) => {
    const statuses: { route: string; status: number }[] = [];
    for (const [method, path, body] of ROUTES) statuses.push({ route: `${method} ${path}`, status: (await send(method, `${path.replace(':memory', memory.id)}?store=${store}`, body)).status });
    return statuses;
  };
  expect(await call('peak')).toEqual(ROUTES.map(([method, path]) => ({ route: `${method} ${path}`, status: 404 })));
  expect(snapshot()).toEqual(before);
  expect(((await (await send('GET', '/api/conversations?store=peak')).json()) as { items: unknown[] }).items).toEqual([]);
  expect((await call('glow')).filter((r) => r.status === 404)).toEqual([]);
  await runManager(db).idle();
});

test("tools refuse another store's ids, and retrieval never hands over another store's card", async () => {
  const one = (sql: string) => String(db.prepare(sql).get()!.id);
  db.prepare(`INSERT INTO page_drafts (id, store_id, agent_id, kind, title, html, notes, created_at) VALUES ('pd1', 'peak', 'peak:store_developer', 'page', 'About', '<p>x</p>', '', '2026-10-28')`).run();
  // Ids are unique per store only (demo stores share order numbers): Glow loses its copy, so the id is Peak's alone.
  const only = (table: string) => {
    const id = one(`SELECT id FROM ${table} WHERE store_id = 'peak' LIMIT 1`);
    db.prepare(`DELETE FROM ${table} WHERE store_id = 'glow' AND id = ?`).run(id);
    return id;
  };
  const ids = { order: only('orders'), campaign: only('campaigns'), product: only('products') };
  const agent = getAgent(db, 'glow:operations')!;
  const ctx = { ...toolEnv(db), store: getStore(db, 'glow')!, agent, emit: () => {} } as ToolContext;
  const tool = (name: string) => APP_TOOLS.find((t) => t.name === name)!;
  const outputs = await Promise.all(
    ([
      ['flag_order_issue', { orderId: ids.order, kind: 'late', severity: 'medium', note: 'Order is late by four days, no tracking' }],
      ['propose_ad_change', { campaignId: ids.campaign, change: 'pause', evidence: 'ROAS 0.4 over 14 days, spend $300' }],
      ['propose_price_change', { productId: ids.product, newPrice: 19, evidence: 'converts 3.1% at $29.99 vs competitors at $24' }],
      ['draft_page', { kind: 'product', productId: ids.product, title: 'New page', html: '<p>A better product page</p>', notes: 'Clearer benefits, same price' }],
      ['publish_page', { draftId: 'pd1' }],
    ] as const).map(async ([name, args]) => [name, (await callTool(tool(name), args, ctx)).output]),
  );
  for (const [name, output] of outputs) expect({ name, output }).toEqual({ name, output: expect.stringMatching(/^No (order|campaign|product|draft) \S+ in this store\b/) });

  const card = createCard(db, 'peak', { categoryId: ensureCategoryPath(db, 'peak', ['Advertising']), title: 'Peak ad angles', summary: 's', type: 'strategy', stage: 'hypothesis', status: 'active', authorId: 'owner', origin: 'owner' });
  const found = (ws: string) => retrieveKnowledge(db, { ws, role: 'market_analyst', query: `[kb:${card.id}] Peak ad angles`, limit: 8 }).map((c) => c.id);
  expect(found('glow')).not.toContain(card.id);
  expect(found('peak')).toContain(card.id);
});

/** Fake SDK: records the options it got and asks permission for each tool, reporting the answers as text. */
function recording(tools: [string, object][] = []) {
  const seen: { tools?: unknown; mcpServers?: object } = {};
  const query: NonNullable<ClaudeEngineOptions['query']> = (params) =>
    (async function* () {
      Object.assign(seen, { tools: params.options.tools, mcpServers: params.options.mcpServers });
      for (const [t, toolInput] of tools) {
        const d = await params.options.canUseTool!(t, toolInput as never, { signal: new AbortController().signal } as never);
        yield { type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `${t}=${d?.behavior} ` } } } as never;
      }
      yield { type: 'result', subtype: 'success', is_error: false, result: '', session_id: 's', total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } as never;
    })();
  return { seen, query };
}
const input = (agentId: string, extra: Partial<RunInput> = {}): RunInput => {
  const agent = getAgent(db, agentId)!;
  return { agent, store: getStore(db, agent.storeId)!, task: 't', env: toolEnv(db), ...extra };
};
const said = (events: AgentEvent[]) => events.flatMap((e) => (e.type === 'text_delta' ? [e.text] : [])).join('');

test("WebFetch can't reach the app's own API or anything else on this computer or network; public pages are fine", async () => {
  const { query } = recording([
    ['WebFetch', { url: `http://127.0.0.1:${process.env.API_PORT ?? '8787'}/api/runs?stores=peak`, prompt: 'p' }],
    ['WebFetch', { url: 'http://localhost:5173/api/agents', prompt: 'p' }],
    ['WebFetch', { url: 'http://192.168.1.20/', prompt: 'p' }],
    ['WebFetch', { url: `127.0.0.1:${process.env.API_PORT ?? '8787'}/api/runs`, prompt: 'p' }],
    ['WebFetch', { url: 'http://[::1]/api/runs', prompt: 'p' }],
    ['WebFetch', { url: 'https://www.example.com/pricing', prompt: 'p' }],
  ]);
  const events: AgentEvent[] = [];
  for await (const e of runAgent(input('glow:copywriter'), claudeEngine({ query }))) events.push(e);
  expect(said(events)).toBe('WebFetch=deny WebFetch=deny WebFetch=deny WebFetch=deny WebFetch=deny WebFetch=allow ');
});

test("a run's config narrows its app tools, Claude built-ins and external servers; compare_stores is opt-in", async () => {
  const names = (c?: Pick<AgentConfig, 'tools'>) => runTools('market_analyst', undefined, c).map((t) => t.name);
  expect(names()).toContain('compare_stores'); // runs without a config keep today's tools
  expect(names({ tools: defaultTools('market_analyst') })).not.toContain('compare_stores');
  expect(names({ tools: [...defaultTools('market_analyst'), 'compare_stores'] })).toContain('compare_stores');
  expect(runTools('store_developer', undefined, { tools: defaultTools('store_developer').filter((t) => t !== 'draft_page') }).map((t) => t.name)).not.toContain('draft_page'); // a draft switch off
  expect(defaultTools('ad_strategist')).toContain('meta_ads');

  const key = randomBytes(32);
  saveIntegration(db, key, { kind: 'meta_ads', storeId: 'peak', values: { adAccountId: 'act_1', accessToken: 'tok-123' } });
  const seen = async (c?: AgentConfig) => {
    const r = recording();
    for await (const _ of runAgent(input('peak:market_analyst', { env: toolEnv(db, () => key), ...(c ? { config: c } : {}) }), claudeEngine({ query: r.query })));
    return { tools: r.seen.tools, servers: Object.keys(r.seen.mcpServers ?? {}) };
  };
  expect(await seen()).toEqual({ tools: ['WebSearch', 'WebFetch'], servers: ['frontline', 'meta_ads'] });
  expect(await seen(config('peak:market_analyst', ['store_summary', 'search_knowledge', 'WebSearch']))).toEqual({ tools: ['WebSearch'], servers: ['frontline'] });

  // The run manager hands the run's config to the engine.
  let got: AgentConfig | undefined;
  const engine: Engine = async function* (i) {
    got = i.config;
    yield { type: 'done', sessionId: 's', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } };
  };
  const c = config('glow:copywriter', ['store_summary']);
  addConfig(c);
  const m = createRunManager({ db, env: toolEnv(db), store: (id) => getStore(db, id), engine });
  m.start('glow:copywriter', 'Draft', undefined, undefined, { configId: c.id });
  await m.idle();
  expect(got).toEqual({ ...c, runtime: 'claude' });
});

test('credentials never appear in a run row, a config, the run API or the server log, whether the run succeeds or fails', async () => {
  const token = `EAAG${randomBytes(12).toString('hex')}`;
  const saved = process.env.FRONTLINE_SECRET_KEY;
  const secretKey = randomBytes(32).toString('base64');
  process.env.FRONTLINE_SECRET_KEY = secretKey;
  try {
    const dir = mkdtempSync(join(tmpdir(), 'frontline-secrets-'));
    initLog(dir);
    const key = loadKey(dir);
    app = createApp(db, key);
    saveIntegration(db, key, { kind: 'meta_ads', storeId: 'peak', values: { adAccountId: 'act_1', accessToken: token } });
    const store = getStore(db, 'peak')!;
    const type = resolveType(db, 'peak', 'ad_strategist')!;
    const conversation = createConversation(db, store, type, { ...seatDefault(store, type), runtime: 'claude' }, { title: 'Ad check' });
    const c = getConfig(db, conversation.configId)!;
    let fail = false;
    const servers: unknown[] = [];
    const query: NonNullable<ClaudeEngineOptions['query']> = (params) =>
      (async function* () {
        servers.push(params.options.mcpServers);
        yield { type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Checked the ads.' } } } as never;
        const usage = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
        yield (fail
          ? { type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['MCP server meta_ads failed'], session_id: 's2', total_cost_usd: 0, usage }
          : { type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: 's1', total_cost_usd: 0, usage }) as never;
      })();
    const m = createRunManager({ db, env: toolEnv(db, () => key), store: (id) => getStore(db, id), engine: claudeEngine({ query }), ...runHooks(db) });
    const runIds: string[] = [];
    for (const failing of [false, true]) {
      fail = failing;
      const run = m.start('peak:ad_strategist', 'Check the ads', undefined, undefined, { conversationId: conversation.id });
      if (typeof run === 'string') throw new Error(run);
      runIds.push(run.id);
      await m.idle();
    }
    expect(JSON.stringify(servers.map((s) => (s as { meta_ads?: unknown }).meta_ads))).toContain(token); // the token really went to the SDK...
    const places = [
      ...runIds.map((id) => JSON.stringify(db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(id))),
      JSON.stringify(db.prepare('SELECT * FROM agent_configs').all()),
      ...(await Promise.all(runIds.map(async (id) => (await send('GET', `/api/runs/${id}`)).text()))),
      ...(await Promise.all([`/api/conversations/${conversation.id}?store=peak`, `/api/conversations/${conversation.id}/thread?store=peak`, '/api/conversations?store=peak'].map(async (url) => (await send('GET', url)).text()))),
      existsSync(join(dir, 'logs', 'api.log')) ? readFileSync(join(dir, 'logs', 'api.log'), 'utf8') : '',
    ];
    expect(places[1]).toContain('"status":"error"'); // ...and the failing run did fail
    for (const place of places) expect(place.includes(token) || place.includes(secretKey) || place.includes(key.toString('hex'))).toBe(false); // ...and went nowhere else
  } finally {
    if (saved === undefined) delete process.env.FRONTLINE_SECRET_KEY;
    else process.env.FRONTLINE_SECRET_KEY = saved;
  }
});
