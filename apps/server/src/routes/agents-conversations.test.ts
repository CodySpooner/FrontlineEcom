import { defaultTools, getConfig, getRun, recap } from '@frontline/agents';
import { AGENT_ROLES, type AgentPreset, type AgentRun, type AgentRunDetail, type AgentTypeInfo, type Conversation, type ConversationPage, type CursorPage, type CustomRole } from '@frontline/shared';
import { randomUUID } from 'node:crypto';
import { beforeEach, expect, test } from 'vitest';
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
const idle = () => runManager(db).idle();
/** Opens a glow conversation and waits for its first reply. */
async function open(body: Record<string, unknown> = {}, store = 'glow') {
  const r = await send('POST', `/api/conversations?store=${store}`, { clientRequestId: randomUUID(), type: 'copywriter', message: 'Draft the spring hero line', ...body });
  const json = (await r.json()) as { conversation: Conversation; run: AgentRun; error?: string; field?: string };
  await idle();
  return { status: r.status, ...json };
}
const list = async (query: string, store = 'glow') => (await (await send('GET', `/api/conversations?store=${store}&${query}`)).json()) as ConversationPage;
const said = (runId: string) => getRun(db, runId)!.transcript.flatMap((e) => (e.type === 'text_delta' ? [e.text] : [])).join('');

test('Deploy opens a conversation on the seat default and starts its first turn; a repeated request returns the same', async () => {
  const clientRequestId = randomUUID();
  const first = await open({ clientRequestId, title: 'Spring launch' });
  expect(first.status).toBe(201);
  expect(first.conversation).toMatchObject({ storeId: 'glow', agentId: 'glow:copywriter', type: 'copywriter', title: 'Spring launch', pinned: false, state: 'running' });
  expect(getRun(db, first.run.id)).toMatchObject({ conversationId: first.conversation.id, configId: first.conversation.configId, runtime: 'demo', status: 'done' });
  expect(getConfig(db, first.conversation.configId)).toMatchObject({ runtime: 'demo', tools: defaultTools('copywriter'), knowledge: ['store', 'general'], permissions: { saveFindings: 'off' } });
  const again = await open({ clientRequestId, title: 'Spring launch' });
  expect([again.status, again.conversation.id, again.run.id]).toEqual([200, first.conversation.id, first.run.id]);
  expect((await list('')).total).toBe(1);
  expect(await (await send('GET', `/api/conversations/${first.conversation.id}?store=glow`)).json()).toMatchObject({ id: first.conversation.id, state: 'completed' });
  expect((await open({ title: undefined, message: 'A very long first line that goes on and on about the spring collection and its hero section copy\nmore' })).conversation.title).toBe(
    'A very long first line that goes on and on about the spring collection and its…',
  );
});

test('a config that fails a check is a 400 naming the field, and nothing is created', async () => {
  const fails = async (body: Record<string, unknown>) => {
    const r = await open(body);
    return [r.status, r.field];
  };
  expect(await fails({ config: { tools: [...defaultTools('copywriter'), 'propose_ad_change'] } })).toEqual([400, 'tools']);
  expect(await fails({ config: { tools: ['store_summary', 'compare_stores'] } })).toEqual([400, 'tools']);
  expect(await fails({ type: 'builtin:marketing_strategist', config: { tools: ['store_summary', 'compare_stores'] } })).toEqual([400, 'tools']);
  expect(await fails({ config: { permissions: { budgetUsd: 'abc' } } })).toEqual([400, 'permissions.budgetUsd']);
  expect(await fails({ config: { permissions: { budgetUsd: 2 } } })).toEqual([400, 'permissions.budgetUsd']); // glow is a demo store
  expect(await fails({ config: { permissions: { stopAfterMin: -5 } } })).toEqual([400, 'permissions.stopAfterMin']);
  expect(await fails({ config: { knowledge: ['store', 'peak'] } })).toEqual([400, 'knowledge']);
  expect(await fails({ config: { runtime: 'codex' } })).toEqual([400, 'runtime']);
  expect(db.prepare('SELECT count(*) AS n FROM conversations').get()?.n).toBe(0);
  // The Analytics Specialist may compare stores; a built-in type gets its own narrowed tools.
  expect((await open({ type: 'market_analyst', config: { tools: ['store_summary', 'compare_stores'] } })).status).toBe(201);
  const strategist = await open({ type: 'builtin:marketing_strategist' });
  expect(strategist.conversation).toMatchObject({ agentId: 'glow:market_analyst', type: 'builtin:marketing_strategist' });
  expect(getConfig(db, strategist.conversation.configId)?.tools).not.toContain('WebFetch');
  // A type the store can't use: unknown, or another store's custom role.
  db.prepare(`INSERT INTO agent_custom_roles (id, store_id, base_role, name, created_at) VALUES ('peak-role', 'peak', 'copywriter', 'Peak voice', '2026-10-28')`).run();
  expect((await open({ type: 'peak-role' })).status).toBe(404);
  expect((await open({ type: 'nobody' })).status).toBe(404);
});

test('the list filters by view, type and range, pages by cursor, and searches titles and message text in this store only', async () => {
  const a = await open({ title: 'Spring hero', message: 'Write the turmeric serum hero line' });
  const b = await open({ type: 'ad_strategist', title: 'Budget check', message: 'Check the Meta budgets' });
  const c = await open({ title: 'Old copy', message: 'Rewrite the FAQ' });
  await open({ title: 'Peak turmeric', message: 'Write the turmeric serum hero line' }, 'peak');
  db.prepare(`UPDATE conversations SET last_activity_at = '2026-01-01T00:00:00.000Z' WHERE id = ?`).run(c.conversation.id);
  const ids = (p: CursorPage<Conversation>) => p.items.map((x) => x.id);
  expect(ids(await list(''))).toEqual([b, a, c].map((x) => x.conversation.id));
  expect(ids(await list('range=30'))).toEqual([b, a].map((x) => x.conversation.id));
  expect(ids(await list('type=ad_strategist'))).toEqual([b.conversation.id]);
  const first = await list('limit=2');
  expect([first.items.length, first.total, !!first.next]).toEqual([2, 3, true]);
  expect(ids(await list(`limit=2&cursor=${encodeURIComponent(first.next!)}`))).toEqual([c.conversation.id]);
  expect(ids(await list('q=turmeric'))).toEqual([a.conversation.id]); // message text; Peak's isn't listed
  expect(ids(await list('q=budget'))).toEqual([b.conversation.id]); // title

  await send('PATCH', `/api/conversations/${a.conversation.id}?store=glow`, { pinned: true, title: 'Serum launch' });
  await send('PATCH', `/api/conversations/${b.conversation.id}?store=glow`, { archived: true });
  expect(ids(await list('view=pinned'))).toEqual([a.conversation.id]);
  expect(ids(await list('view=archived'))).toEqual([b.conversation.id]);
  expect(ids(await list(''))).toEqual([a, c].map((x) => x.conversation.id));
  expect(ids(await list('q=serum launch'))).toEqual([a.conversation.id]); // the new title is searchable
  const back = await send('PATCH', `/api/conversations/${b.conversation.id}?store=glow`, { archived: false });
  expect((await back.json()) as Conversation).not.toHaveProperty('archivedAt');
  expect((await send('PATCH', `/api/conversations/${a.conversation.id}?store=glow`, { title: '' })).status).toBe(400);
  expect((await send('GET', '/api/conversations?store=glow&view=old')).status).toBe(400);
});

test('send, retry, resume and stop each act on this conversation, idempotent on their request id', async () => {
  const { conversation, run } = await open();
  const msg = { clientRequestId: randomUUID(), message: 'Shorter please' };
  const sent = (await (await send('POST', `/api/conversations/${conversation.id}/messages?store=glow`, msg)).json()) as AgentRun;
  expect(((await (await send('POST', `/api/conversations/${conversation.id}/messages?store=glow`, msg)).json()) as AgentRun).id).toBe(sent.id);
  await idle();
  expect(getRun(db, sent.id)).toMatchObject({ conversationId: conversation.id, task: 'Shorter please', status: 'done' });

  const add = db.prepare(`INSERT INTO agent_runs (id, store_id, agent_id, task, status, error, session_id, conversation_id, config_id, created_at) VALUES (?, 'glow', 'glow:copywriter', ?, ?, ?, 's', ?, ?, ?)`);
  const row = (id: string, status: string, error: string | null) => add.run(id, 'Again', status, error, conversation.id, conversation.configId, new Date().toISOString());
  row('failed', 'error', 'Claude had a server error. Retry in a few minutes.');
  row('cut', 'error', 'Interrupted by an app restart');
  const act = (runId: string, what: string) => send('POST', `/api/conversations/${conversation.id}/runs/${runId}/${what}?store=glow`, { clientRequestId: randomUUID() });
  expect((await act('cut', 'retry')).status).toBe(409);
  expect((await act('failed', 'resume')).status).toBe(409);
  const retried = (await (await act('failed', 'retry')).json()) as AgentRun;
  const resumed = (await (await act('cut', 'resume')).json()) as AgentRun;
  await idle();
  expect([retried, resumed].map((r) => getRun(db, r.id)?.task)).toEqual(['Again', 'Again']);
  expect((await act(run.id, 'nope')).status).toBe(404);

  row('waiting', 'queued', null);
  expect((await send('POST', `/api/conversations/${conversation.id}/stop?store=glow`, {})).status).toBe(409); // nothing is running
  expect(((await (await send('POST', `/api/conversations/${conversation.id}/stop?store=glow`, { runId: 'waiting' })).json()) as AgentRun).status).toBe('cancelled');

  const thread = (await (await send('GET', `/api/conversations/${conversation.id}/thread?store=glow&limit=3`)).json()) as CursorPage<AgentRunDetail>;
  expect([thread.total, thread.items.length, !!thread.next]).toEqual([7, 3, true]);
  expect(thread.items.map((r) => r.id).at(-1)).toBe('waiting'); // the newest last
  expect(thread.items.at(-1)).toMatchObject({ state: 'cancelled', transcript: [] });
  const older = (await (await send('GET', `/api/conversations/${conversation.id}/thread?store=glow&limit=10&before=${thread.next}`)).json()) as CursorPage<AgentRunDetail>;
  expect(older.items.map((r) => r.id).slice(0, 2)).toEqual([run.id, sent.id]);
  expect(older.next).toBeUndefined();
});

test('Continue in a new conversation takes the run’s store and seat, opens on its recap, and refuses what it must', async () => {
  const legacy = runManager(db).start('glow:copywriter', 'Rewrite the hero headline');
  if (typeof legacy === 'string') throw new Error(legacy);
  await idle();
  const continued = await open({ type: undefined, fromRunId: legacy.id, message: 'Now a shorter one' });
  expect(continued.status).toBe(201);
  expect(continued.conversation).toMatchObject({ agentId: 'glow:copywriter', title: 'Rewrite the hero headline', context: { kind: 'run', id: legacy.id } });
  expect(said(continued.run.id)).toContain('on it — "Earlier work, from a session that has ended"'); // the first turn starts from the recap
  expect((await open({ type: undefined, fromRunId: continued.run.id, message: 'x' })).status).toBe(409); // in a conversation already
  expect((await open({ type: undefined, fromRunId: legacy.id, message: 'x' }, 'peak')).status).toBe(404); // another store's run

  const add = db.prepare(`INSERT INTO agent_runs (id, store_id, agent_id, task, status, transcript_json, created_at) VALUES (?, 'glow', 'glow:market_analyst', ?, 'done', ?, ?)`);
  add.run('all', 'The owner asks the knowledge base: "x"\nThe cards come from every store and General: compare them.', '[]', new Date().toISOString());
  add.run('cmp', 'Compare stores', JSON.stringify([{ type: 'tool_call', id: 't', name: 'compare_stores', input: {} }]), new Date().toISOString());
  for (const id of ['all', 'cmp']) expect((await open({ type: undefined, fromRunId: id, message: 'x' })).status).toBe(409);

  // A run from before the store went live holds demo numbers: the recap leaves it out, and with nothing left, no Continue.
  db.prepare(`INSERT INTO done_once (ref, at) VALUES ('activate:glow', ?)`).run(new Date(Date.now() + 1000).toISOString());
  const refused = await open({ type: undefined, fromRunId: legacy.id, message: 'x' });
  expect([refused.status, refused.error]).toEqual([409, 'That conversation ran on demo data, before the store went live: start a new one.']);
  add.run('after', 'After going live', '[]', new Date(Date.now() + 5000).toISOString());
  expect(recap(db, 'glow', [legacy.id, 'after'])).toMatch(/^Earlier work[^]*The owner asked: After going live/);
  expect(recap(db, 'glow', [legacy.id, 'after'])).not.toContain('Rewrite the hero headline');
});

test('the legacy run route opens a conversation on the seat default; a follow-up lands in the same conversation', async () => {
  const r = await send('POST', '/api/agents/glow%3Acopywriter/runs', { task: 'Write three ad captions\nfor the spring drop' });
  const run = (await r.json()) as AgentRun;
  expect(r.status).toBe(201);
  await idle();
  const conversation = (await (await send('GET', `/api/conversations/${run.conversationId}?store=glow`)).json()) as Conversation;
  expect(conversation).toMatchObject({ title: 'Write three ad captions', agentId: 'glow:copywriter' });
  const config = getConfig(db, conversation.configId)!;
  expect(config.tools).toEqual(defaultTools('copywriter')); // the role's draft tools
  expect(config.tools).toContain('create_creative');
  expect(config.permissions).toEqual({ saveFindings: 'off' }); // no run budget, no Stop after
  const follow = (await (await send('POST', '/api/agents/glow%3Acopywriter/runs', { task: 'Warmer tone', resumeRunId: run.id })).json()) as AgentRun;
  await idle();
  expect(getRun(db, follow.id)).toMatchObject({ conversationId: run.conversationId, sessionId: getRun(db, run.id)!.sessionId, status: 'done' }); // went on in its session
  expect(db.prepare('SELECT count(*) AS n FROM conversations').get()?.n).toBe(1);
});

test("startConversation's module reference must be the store's own record; the first turn points the agent at it", async () => {
  const context = { kind: 'campaign', network: String(db.prepare(`SELECT network FROM campaigns WHERE id = 'glow-c1'`).get()?.network), id: 'glow-c1', name: 'Spring TOF' };
  const opened = await open({ type: 'ad_strategist', message: 'Should I scale this?', context });
  expect(opened.status).toBe(201);
  expect(opened.conversation.context).toEqual(context);
  expect(said(opened.run.id)).toContain(`on it — "The owner opened this from the ${context.network} campaign "Spring TOF" (id glow-c1)"`);
  expect((await open({ type: 'ad_strategist', context: { ...context, id: 'peak-c1' } })).status).toBe(404);
  expect((await open({ type: 'ad_strategist', context: { kind: 'run', id: 'x', name: 'x' } })).field).toBe('context');
});

test('creating and sending share the knowledge base guard: the 11th start in a minute is a 429', async () => {
  const statuses: number[] = [];
  for (let i = 0; i < 11; i++) statuses.push((await send('POST', '/api/conversations?store=glow', { clientRequestId: randomUUID(), type: 'copywriter', message: `Task ${i}` })).status);
  expect(statuses).toEqual([...Array(10).fill(201), 429]);
  await idle();
});

test("the list counts each type under its filters; counts per store say what's going and what waits; types are the store's own", async () => {
  await open({ title: 'One' });
  await open({ title: 'Two' });
  await open({ type: 'builtin:general_researcher', title: 'Three' });
  expect((await list('')).byType).toEqual({ copywriter: 2, 'builtin:general_researcher': 1 });
  expect((await list('limit=1')).byType).toEqual({ copywriter: 2, 'builtin:general_researcher': 1 }); // not just the page

  const { conversation } = await open({ title: 'Busy' });
  const add = db.prepare(`INSERT INTO agent_runs (id, store_id, agent_id, task, status, conversation_id, config_id, created_at) VALUES (?, 'glow', 'glow:copywriter', 'x', ?, ?, ?, '2026-10-28')`);
  add.run('going', 'running', conversation.id, conversation.configId);
  add.run('waits', 'running', (await open({ title: 'Waits' })).conversation.id, conversation.configId);
  db.prepare(`INSERT INTO approvals (id, store_id, agent_id, run_id, title, reason, action_json, status, created_at) VALUES ('ap', 'glow', 'glow:copywriter', 'waits', 't', 'r', '{"kind":"pause_campaign","payload":{}}', 'pending', '2026-10-28')`).run();
  expect(await (await send('GET', '/api/conversations/counts')).json()).toEqual({ glow: { running: 1, waiting: 1 } });
  db.exec(`UPDATE agent_runs SET status = 'done' WHERE id IN ('going', 'waits')`);

  db.prepare(`INSERT INTO agent_custom_roles (id, store_id, base_role, name, created_at) VALUES ('glow-voice', 'glow', 'copywriter', 'Brand voice', '2026-10-28')`).run();
  const types = async (store: string) => ((await (await send('GET', `/api/agent-types?store=${store}`)).json()) as { id: string; name: string }[]).map((t) => t.id);
  expect(await types('glow')).toEqual([...Object.keys(AGENT_ROLES), 'builtin:marketing_strategist', 'builtin:general_researcher', 'glow-voice']);
  expect(await types('peak')).not.toContain('glow-voice');
  expect((await send('GET', '/api/agent-types?store=nope')).status).toBe(404);
});

test('the tools endpoint groups the config by access and says whether the integration behind a group is connected', async () => {
  const { conversation } = await open({ type: 'ad_strategist', message: 'Check the campaigns' });
  const groups = async () => (await (await send('GET', `/api/conversations/${conversation.id}/tools?store=glow`)).json()) as { id: string; access: string; tools: string[]; integration?: { kind: string; connected: boolean } }[];
  const first = await groups();
  expect(first.map((g) => [g.id, g.access])).toEqual([['data', 'read'], ['web', 'read'], ['knowledge', 'on'], ['drafts', 'approval'], ['squad', 'on'], ['meta_ads', 'approval']]);
  expect(first.find((g) => g.id === 'drafts')!.tools).toEqual(['propose_ad_change']);
  expect(first.find((g) => g.id === 'data')!.tools).toContain('list_campaigns');
  expect(first.at(-1)!.integration).toEqual({ kind: 'meta_ads', connected: false });
  db.prepare(`INSERT INTO integrations (id, kind, store_id, encrypted_credentials, updated_at) VALUES ('i1', 'meta_ads', 'glow', '', '2026-10-28')`).run();
  expect((await groups()).at(-1)!.integration).toEqual({ kind: 'meta_ads', connected: true });
  expect((await send('GET', `/api/conversations/${conversation.id}/tools?store=peak`)).status).toBe(404);
});

test('rename, pin, archive, search and reopen keep the messages, the type, the store and the id', async () => {
  const { conversation, run } = await open({ type: 'copywriter', message: 'Draft the spring hero line' });
  const second = (await (await send('POST', `/api/conversations/${conversation.id}/messages?store=glow`, { clientRequestId: randomUUID(), message: 'Shorter, please' })).json()) as AgentRun;
  await idle();
  const patch = async (body: object) => (await (await send('PATCH', `/api/conversations/${conversation.id}?store=glow`, body)).json()) as Conversation;
  await patch({ title: 'Spring hero line, final' });
  await patch({ pinned: true });
  await patch({ archived: true });
  expect((await list('')).items.map((c) => c.id)).not.toContain(conversation.id);
  expect((await list('view=archived&q=shorter')).items.map((c) => c.id)).toEqual([conversation.id]); // follow-up text is searchable
  const back = await patch({ archived: false });
  expect(back).toMatchObject({ id: conversation.id, storeId: 'glow', agentId: 'glow:copywriter', type: 'copywriter', configId: conversation.configId, title: 'Spring hero line, final', pinned: true });
  expect(back.archivedAt).toBeUndefined();
  expect((await list('')).items.map((c) => c.id)).toContain(conversation.id);
  const thread = (await (await send('GET', `/api/conversations/${conversation.id}/thread?store=glow`)).json()) as CursorPage<AgentRunDetail>;
  expect(thread.items.map((r) => [r.id, r.task])).toEqual([
    [run.id, 'Draft the spring hero line'],
    [second.id, 'Shorter, please'],
  ]);
});

test("a custom role narrows its base role's tools, runs on its seat with its own name and instructions, and stays the store's", async () => {
  const make = async (body: object, store = 'glow') => {
    const r = await send('POST', `/api/custom-roles?store=${store}`, body);
    return { status: r.status, ...((await r.json()) as CustomRole & { field?: string }) };
  };
  expect((await make({ name: 'Voice', baseRole: 'copywriter', tools: ['list_products', 'propose_ad_change'] })).field).toBe('tools');
  expect((await make({ name: ' ', baseRole: 'copywriter' })).field).toBe('name');
  expect((await make({ name: 'Voice', baseRole: 'builtin:general_researcher' })).field).toBe('baseRole');
  const voice = await make({ name: 'Brand Voice', description: 'Keeps every line on brand.', instructions: 'Never use exclamation marks.', baseRole: 'copywriter', tools: ['list_products', 'search_memory', 'write_memory'] });
  expect(voice).toMatchObject({ status: 201, storeId: 'glow', baseRole: 'copywriter', name: 'Brand Voice', tools: ['list_products', 'search_memory', 'write_memory'] });
  const types = async (store: string) => (await (await send('GET', `/api/agent-types?store=${store}`)).json()) as AgentTypeInfo[];
  expect((await types('glow')).find((t) => t.id === voice.id)?.contract).toMatchObject({ tools: ['search_memory', 'write_memory', 'list_products'], instructions: 'Never use exclamation marks.' });
  // Another store can't open, archive or list it (decision 13).
  expect((await open({ type: voice.id }, 'peak')).status).toBe(404);
  expect((await send('PATCH', `/api/custom-roles/${voice.id}?store=peak`, { archived: true })).status).toBe(404);
  expect((await types('peak')).map((t) => t.id)).not.toContain(voice.id);

  const { conversation, run } = await open({ type: voice.id, message: 'A hero line for the LED mask' });
  expect(conversation).toMatchObject({ agentId: 'glow:copywriter', type: voice.id });
  expect(getConfig(db, conversation.configId)!.tools).toEqual(['search_memory', 'write_memory', 'list_products']);
  expect(db.prepare(`SELECT title FROM notifications WHERE title LIKE '%finished' ORDER BY rowid DESC`).get()?.title).toBe('Brand Voice finished');
  expect(getRun(db, run.id)!.status).toBe('done');

  // Archived: no longer offered, while its conversation keeps it.
  expect(await (await send('PATCH', `/api/custom-roles/${voice.id}?store=glow`, { archived: true })).json()).toMatchObject({ archivedAt: expect.any(String) });
  expect((await types('glow')).map((t) => t.id)).not.toContain(voice.id);
  expect((await open({ type: voice.id })).status).toBe(404);
  expect(((await (await send('POST', `/api/conversations/${conversation.id}/messages?store=glow`, { clientRequestId: randomUUID(), message: 'Shorter' })).json()) as AgentRun).status).toBe('queued');
  // One for every store.
  const shared = await make({ name: 'Launch Copy', baseRole: 'copywriter', allStores: true });
  expect(shared.storeId).toBeUndefined();
  expect((await types('peak')).map((t) => t.id)).toContain(shared.id);
});

test("presets: each type's Default first, then the owner's saved ones for it, checked as a deploy is", async () => {
  const presets = async (type: string, store = 'glow') => {
    const r = await send('GET', `/api/presets?store=${store}&type=${encodeURIComponent(type)}`);
    return r.status === 200 ? ((await r.json()) as AgentPreset[]) : r.status;
  };
  expect(await presets('ad_strategist')).toEqual([
    { id: 'default:ad_strategist', name: 'Campaign planning', builtin: true, createdAt: '', config: { role: 'ad_strategist', tools: defaultTools('ad_strategist'), knowledge: ['store', 'general'], permissions: { saveFindings: 'off' } } },
  ]);
  expect(await presets('builtin:general_researcher')).toMatchObject([{ name: 'Web research', config: { role: 'market_analyst', customRoleId: 'builtin:general_researcher', tools: ['store_summary', 'search_memory', 'write_memory', 'search_knowledge', 'WebSearch', 'WebFetch'] } }]);
  expect(await presets('nope')).toBe(404);

  const save = async (body: object, store = 'glow') => {
    const r = await send('POST', `/api/presets?store=${store}`, body);
    return { status: r.status, ...((await r.json()) as AgentPreset & { field?: string }) };
  };
  expect((await save({ name: 'Too much', type: 'copywriter', config: { tools: ['propose_ad_change'] } })).field).toBe('tools');
  expect((await save({ name: '', type: 'copywriter' })).field).toBe('name');
  expect((await save({ name: 'X', type: 'nope' })).status).toBe(404);
  const tight = await save({ name: 'Tight budget', type: 'ad_strategist', objective: 'Cut wasted spend on {product}', config: { tools: ['store_summary', 'review_campaigns'], permissions: { stopAfterMin: 15 }, colour: 'red' } });
  expect(tight).toMatchObject({ status: 201, storeId: 'glow', name: 'Tight budget', config: { role: 'ad_strategist', tools: ['store_summary', 'review_campaigns'], knowledge: ['store', 'general'], permissions: { stopAfterMin: 15, saveFindings: 'off' }, objective: 'Cut wasted spend on {product}' } });
  expect(tight.config).not.toHaveProperty('runtime'); // none chosen
  expect(tight.config).not.toHaveProperty('colour');
  await save({ name: 'Everywhere', type: 'ad_strategist', allStores: true });
  expect(((await presets('ad_strategist')) as AgentPreset[]).map((p) => p.name)).toEqual(['Campaign planning', 'Everywhere', 'Tight budget']);
  expect(((await presets('ad_strategist', 'peak')) as AgentPreset[]).map((p) => p.name)).toEqual(['Campaign planning', 'Everywhere']);
  expect(((await presets('copywriter')) as AgentPreset[]).map((p) => p.name)).toEqual(['Copywriting']);
});
