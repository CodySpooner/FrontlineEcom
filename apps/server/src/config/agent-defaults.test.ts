import { randomUUID } from 'node:crypto';
import { agentDefaults, claudeEngine, claudeRuntime, createCard, createRunManager, createTeam, ensureCategoryPath, getConfig, getRun, resolveType, saveConfig, seatDefault, validateConfig } from '@frontline/agents';
import { codexRegistryModels, type AgentRun, type ConfigImpact, type ConfigView, type Conversation, type RuntimeModel } from '@frontline/shared';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { runHooks, runManager, toolEnv } from '../routes/agents';
import { runtimes } from '../routes/agents-runtimes';
import { getStore } from '../stores';

// Settings → Agents & Providers' defaults reach real runs (ST-20, decision 9).
const opus: RuntimeModel = { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium', default: true };
const sonnet: RuntimeModel = { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium' };
// What the login offers: a test takes a model away from it.
const login = vi.hoisted(() => ({ models: [] as RuntimeModel[] }));
vi.mock('../routes/agents-runtimes', async (original) => ({
  ...(await original<typeof import('../routes/agents-runtimes')>()),
  runtimes: async () => [
    claudeRuntime({ signedIn: true, checkedAt: '2026-10-30T10:00:00Z', models: login.models }),
    { runtime: 'codex', connected: true, models: codexRegistryModels(), source: 'registry', checkedAt: '2026-10-30T10:00:00Z' },
  ],
}));

let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  login.models = [opus, sonnet];
  db = openDb();
  seedDemo(db);
  app = createApp(db);
  runManager(db); // made now, on the demo engine tests force: a stubbed FRONTLINE_AGENT_ENGINE never reaches it
});
afterEach(() => vi.unstubAllEnvs());

const send = (method: string, path: string, body?: unknown) => app.request(path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
/** Saves agent defaults for the workspace, or for one store, over the version read now. */
async function save(set: Record<string, unknown>, storeId?: string, unset: string[] = []) {
  const view = (await (await send('GET', `/api/config${storeId ? `?store=${storeId}` : ''}`)).json()) as ConfigView;
  const doc = storeId ? { doc: 'store_caps', storeId, version: view.versions[`store_caps:${storeId}`] } : { doc: 'workspace', version: view.versions.workspace };
  const prefixed = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [`agentDefaults.${k}`, v]));
  const r = await send('PATCH', '/api/config', { documents: [{ ...doc, set: prefixed(set), unset: unset.map((k) => `agentDefaults.${k}`) }] });
  return { status: r.status, body: (await r.json()) as { error?: string; field?: string } };
}
async function converse(storeId: string, type: string, config?: object) {
  const r = await send('POST', `/api/conversations?store=${storeId}`, { clientRequestId: randomUUID(), type, message: 'TikTok hooks for the spring launch', ...(config ? { config } : {}) });
  const json = (await r.json()) as { conversation: Conversation; run: AgentRun; error?: string; field?: string };
  await runManager(db).idle();
  return { status: r.status, ...json, config: json.conversation && getConfig(db, json.conversation.configId) };
}
type Asked = { prompt: string; options: { model?: string; effort?: string; systemPrompt?: string; fallbackModel?: string } };
const ok = { type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: 's', total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } };
/** A run manager on Claude's engine whose query only records what it was asked (`reply`: what it answers). */
function capturing(reply: (n: number) => AsyncIterable<unknown> = () => (async function* () { yield ok; })()) {
  const asked: Asked[] = [];
  const engine = claudeEngine({ query: (params) => (asked.push(params as unknown as Asked), reply(asked.length) as never) });
  return { asked, m: createRunManager({ db, env: toolEnv(db), store: (id) => getStore(db, id), engine, ...runHooks(db) }) };
}
async function run(m: ReturnType<typeof capturing>['m'], agentId: string, conversationId?: string) {
  const r = m.start(agentId, 'TikTok hooks for the spring launch', undefined, undefined, conversationId ? { conversationId } : {});
  if (typeof r === 'string') throw new Error(r);
  await m.idle();
  return getRun(db, r.id)!;
}
/** What a store whose agents run on Claude gets: checked as the route checks it, with nothing run while it's stubbed. */
async function liveDraft(storeId: string) {
  const caps = await runtimes();
  vi.stubEnv('FRONTLINE_AGENT_ENGINE', 'claude');
  try {
    const store = { ...getStore(db, storeId)!, connected: true };
    return validateConfig(store, resolveType(db, storeId, 'copywriter')!, undefined, caps, agentDefaults(db, storeId));
  } finally {
    vi.unstubAllEnvs();
  }
}

test("the workspace model reaches a new conversation and a run without a config; a store's own wins there only", async () => {
  expect(await save({ model: 'claude-sonnet-5-5', effort: 'high' })).toMatchObject({ status: 200 });
  expect(await save({ model: 'claude-opus-5-5', effort: 'low' }, 'pawsome')).toMatchObject({ status: 200 });
  expect(await liveDraft('glow')).toMatchObject({ runtime: 'claude', model: 'claude-sonnet-5-5', effort: 'high' });
  expect(await liveDraft('pawsome')).toMatchObject({ runtime: 'claude', model: 'claude-opus-5-5', effort: 'low' });

  // Scheduled and background work: a run without a config.
  const { asked, m } = capturing();
  const glow = await run(m, 'glow:market_analyst');
  const pawsome = await run(m, 'pawsome:market_analyst');
  expect(asked.map((a) => [a.options.model, a.options.effort])).toEqual([['claude-sonnet-5-5', 'high'], ['claude-opus-5-5', 'low']]);
  expect([glow, pawsome].map((r) => [r.configId, r.model, r.effort])).toEqual([[undefined, 'claude-sonnet-5-5', 'high'], [undefined, 'claude-opus-5-5', 'low']]);
});

test("a demo store's conversation stays on the demo engine; picking Claude there takes the default model", async () => {
  await save({ model: 'claude-sonnet-5-5', effort: 'high' });
  const plain = await converse('glow', 'copywriter');
  expect([plain.status, plain.config?.runtime, plain.config?.model, getRun(db, plain.run.id)?.runtime]).toEqual([201, 'demo', undefined, 'demo']);

  // Deploy's prefill on a demo store: Claude, at the default model and effort, and the engine gets them.
  const picked = await converse('glow', 'copywriter', { runtime: 'claude' });
  expect(picked.config).toMatchObject({ runtime: 'claude', model: 'claude-sonnet-5-5', effort: 'high' });
  const { asked, m } = capturing();
  await run(m, picked.conversation.agentId, picked.conversation.id);
  expect(asked[0]?.options).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'high' });

  // A Codex default: a demo store still stays on Demo, and Claude picked there takes Claude's own default.
  expect(await save({ runtime: 'codex', model: 'gpt-6-luna', stopAfterMin: 30 })).toMatchObject({ status: 200 });
  expect((await converse('glow', 'copywriter')).config?.runtime).toBe('demo');
  expect((await converse('glow', 'copywriter', { runtime: 'claude' })).config).toMatchObject({ runtime: 'claude', model: 'claude-opus-5-5', effort: 'medium' });
  // A live store's new conversation goes to Codex; work without a config stays on Claude at its own model.
  expect(await liveDraft('glow')).toMatchObject({ runtime: 'codex', model: 'gpt-6-luna', effort: 'high', permissions: { stopAfterMin: 30 } }) // the effort saved earlier, which Luna runs at;
  await run(m, 'glow:market_analyst');
  expect(asked.at(-1)?.options).toMatchObject({ model: 'claude-opus-5-5', effort: 'medium' });
  // A team's participant without a config is a conversation too.
  await save({ runtime: 'claude', model: 'claude-sonnet-5-5', knowledge: 'store' });
  const made = createTeam(db, getStore(db, 'glow')!, { clientRequestId: randomUUID(), title: 'Spring launch', objective: 'Plan the spring launch for the LED mask.', participants: [{ type: 'market_analyst' }] }, await runtimes());
  if ('status' in made) throw new Error(made.error);
  expect(getConfig(db, made.team.participants![0]!.configId)).toMatchObject({ runtime: 'demo', knowledge: ['store'], permissions: { stopAfterMin: 30 } });
});

test('the impact counts runs going and queued runs with a config as keeping theirs, and queued runs without one', async () => {
  const config = saveConfig(db, getStore(db, 'glow')!, resolveType(db, 'glow', 'copywriter')!, seatDefault(getStore(db, 'glow')!, resolveType(db, 'glow', 'copywriter')!)).id;
  const add = (status: string, configId: string | null) =>
    db.prepare('INSERT INTO agent_runs (id, store_id, agent_id, task, status, config_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), 'glow', 'glow:copywriter', 'T', status, configId, '2026-10-30T09:00:00Z');
  for (const [status, configId] of [['running', null], ['running', config], ['queued', config], ['queued', null], ['queued', null], ['done', null]] as const) add(status, configId);
  const impact = async (doc: object) => ((await (await send('POST', '/api/config/impact', { documents: [doc] })).json()) as { impacts: ConfigImpact[] }).impacts;

  expect(await impact({ doc: 'store_caps', storeId: 'glow', version: 0, set: { 'agentDefaults.model': 'claude-sonnet-5-5', 'agentDefaults.effort': 'high' } })).toEqual([
    { setting: 'agentDefaults.model', storeId: 'glow', text: 'Applies to new runs on Glow Haus; 3 running runs keep their settings' },
    { setting: 'agentDefaults.model', storeId: 'glow', text: '2 queued runs on Glow Haus will use the new default' },
  ]);
  // The workspace's: each store that takes it, once; "stop after" alone reaches no queued run without a config.
  await save({ model: 'claude-opus-5-5' }, 'peak');
  expect((await impact({ doc: 'workspace', version: 1, set: { 'agentDefaults.stopAfterMin': 20 } })).map((i) => i.text)).toEqual([
    'Applies to new runs on Glow Haus; 3 running runs keep their settings',
    'Applies to new runs on Pawsome Gear',
    'Applies to new runs on Peak Fit',
  ]);
  expect((await impact({ doc: 'workspace', version: 1, set: { 'agentDefaults.model': 'claude-sonnet-5-5' } })).map((i) => i.storeId)).toEqual(['glow', 'glow', 'pawsome']);
});

test('store only leaves General out of retrieval, for a run without a config and a new conversation', async () => {
  const card = (ws: string | null, title: string) => createCard(db, ws, { categoryId: ensureCategoryPath(db, ws, ['Advertising']), title, summary: `${title}, in short`, type: 'strategy', stage: 'hypothesis', status: 'active', authorId: 'owner', origin: 'owner' });
  const own = card('glow', 'TikTok hooks for spring launches');
  const general = card(null, 'TikTok hooks for any launch');
  const { asked, m } = capturing();
  await run(m, 'glow:ad_strategist');
  expect([own.id, general.id].map((id) => asked[0]!.options.systemPrompt!.includes(`[kb:${id}]`))).toEqual([true, true]);

  await save({ knowledge: 'store' });
  await run(m, 'glow:ad_strategist');
  expect([own.id, general.id].map((id) => asked[1]!.options.systemPrompt!.includes(`[kb:${id}]`))).toEqual([true, false]);
  const opened = await converse('glow', 'ad_strategist');
  expect(opened.config?.knowledge).toEqual(['store']);
  await run(m, opened.conversation.agentId, opened.conversation.id);
  expect([own.id, general.id].map((id) => asked[2]!.options.systemPrompt!.includes(`[kb:${id}]`))).toEqual([true, false]);
});

test('"stop after" reaches new conversations only', async () => {
  const before = await converse('glow', 'copywriter');
  expect(await save({ stopAfterMin: 30 })).toMatchObject({ status: 200 });
  const after = await converse('glow', 'copywriter');
  expect([before.config?.permissions.stopAfterMin, after.config?.permissions.stopAfterMin]).toEqual([undefined, 30]);
  expect(getConfig(db, before.conversation.configId)?.permissions).toEqual({ saveFindings: 'off' }); // its config row never changes
  // What Deploy sends is the owner's: no "stop after" there means none.
  expect((await converse('glow', 'copywriter', { permissions: { saveFindings: 'ask' } })).config?.permissions).toEqual({ saveFindings: 'ask' });
});

test('a run already going keeps what it started with; one starting later reads the new default', async () => {
  await save({ model: 'claude-sonnet-5-5' });
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const { asked, m } = capturing((n) => (async function* () { if (n === 1) await gate; yield ok; })());
  const going = m.start('glow:market_analyst', 'Weekly check');
  if (typeof going === 'string') throw new Error(going);
  await vi.waitFor(() => expect(asked).toHaveLength(1));
  await save({ model: 'claude-opus-5-5' });
  release();
  await m.idle();
  const later = await run(m, 'glow:copywriter');
  expect([getRun(db, going.id)?.model, later.model]).toEqual(['claude-sonnet-5-5', 'claude-opus-5-5']);
  expect(asked.map((a) => a.options.model)).toEqual(['claude-sonnet-5-5', 'claude-opus-5-5']);
});

test("unset is the old behaviour: the login's default for a conversation, the agents' model for a run without a config; FRONTLINE_AGENT_MODEL wins", async () => {
  const { asked, m } = capturing();
  const plain = async () => [(await run(m, 'glow:market_analyst')).model, asked.at(-1)!.options.effort, await liveDraft('glow')];
  const old = await plain();
  expect(old).toEqual(['claude-opus-5-5', 'medium', expect.objectContaining({ model: 'claude-opus-5-5', effort: 'medium', knowledge: ['store', 'general'], permissions: { saveFindings: 'off' } })]);
  await save({ model: 'claude-sonnet-5-5', effort: 'high', knowledge: 'store', stopAfterMin: 15 });
  expect((await plain())[0]).toBe('claude-sonnet-5-5');
  await save({}, undefined, ['model', 'effort', 'knowledge', 'stopAfterMin']);
  expect(await plain()).toEqual(old);
  expect(agentDefaults(db, 'glow')).toEqual({});

  await save({ model: 'claude-sonnet-5-5' });
  vi.stubEnv('FRONTLINE_AGENT_MODEL', 'claude-haiku-4-5-20251001');
  await run(m, 'glow:market_analyst');
  expect(asked.at(-1)!.options.model).toBe('claude-haiku-4-5-20251001');
});

test('an unavailable default model fails the run with where to change it, and nothing else is tried', async () => {
  await save({ model: 'claude-sonnet-5-5' });
  login.models = [opus]; // the login no longer offers it
  const gone = "Sonnet 5.5 isn't available on your Claude login. Change the default in Settings → Agents & Providers.";
  // Deploy's prefill names it on the model field.
  expect(await converse('glow', 'copywriter', { runtime: 'claude' })).toMatchObject({ status: 400, field: 'model', error: gone });

  const { asked, m } = capturing(() =>
    (async function* () {
      yield { type: 'assistant', parent_tool_use_id: null, error: 'model_not_found', message: { id: 'm1', content: [] } };
      yield { ...ok, subtype: 'error_during_execution', is_error: true, errors: [] };
    })(),
  );
  const failed = await run(m, 'glow:market_analyst');
  expect([failed.status, failed.error]).toEqual(['error', gone]);
  expect(asked.map((a) => [a.options.model, a.options.fallbackModel])).toEqual([['claude-sonnet-5-5', undefined]]);
  // Every such run fails alike until it's changed: the owner hears it once a day.
  await run(m, 'glow:copywriter');
  expect(db.prepare("SELECT title, body, link FROM notifications WHERE kind = 'error'").all().map((r) => ({ ...r }))).toEqual([{ title: 'Analytics Specialist hit an error', body: gone, link: '/settings/agents#agentDefaults.model' }]);
});

test('a save is checked against what the runtimes offer: a model not on the login, an effort it lacks, Codex without "stop after"', async () => {
  expect(await save({ model: 'claude-nope' })).toEqual({ status: 400, body: { error: `"claude-nope" isn't on your Claude login's model list.`, field: 'agentDefaults.model' } });
  expect(await save({ effort: 'ultra' })).toEqual({ status: 400, body: { error: 'Opus 5.5 runs at Low, Medium, High, Extra high, Max.', field: 'agentDefaults.effort' } });
  expect(await save({ runtime: 'codex' })).toEqual({ status: 400, body: { error: 'Codex needs a "Stop after" limit: dollar caps don\'t apply to it.', field: 'agentDefaults.stopAfterMin' } });
  expect((await save({ runtime: 'codex', stopAfterMin: 30, effort: 'ultra' })).body.field).toBe('agentDefaults.effort');
  expect(await save({ model: 5 })).toEqual({ status: 400, body: { error: 'Default model must be valid text up to 100 characters', field: 'agentDefaults.model' } });
  expect(agentDefaults(db, 'glow')).toEqual({}); // nothing refused was written

  // A store's own model is checked against the workspace's runtime.
  expect(await save({ runtime: 'codex', stopAfterMin: 30 })).toMatchObject({ status: 200 });
  expect(await save({ model: 'claude-sonnet-5-5' }, 'glow')).toEqual({ status: 400, body: { error: `"claude-sonnet-5-5" isn't on your Codex login's model list.`, field: 'agentDefaults.model' } });
  expect(await save({ runtime: 'claude', model: 'claude-sonnet-5-5' }, 'glow')).toMatchObject({ status: 200 });
  expect([agentDefaults(db, 'glow'), agentDefaults(db, 'peak')]).toEqual([
    { runtime: 'claude', model: 'claude-sonnet-5-5', stopAfterMin: 30 },
    { runtime: 'codex', stopAfterMin: 30 },
  ]);
});
