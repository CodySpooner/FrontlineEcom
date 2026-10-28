import { createRunManager, getConfig, getConversation, getRun } from '@frontline/agents';
import { INTERRUPTED, type Conversation, type LiveMessage, type PrAgentRow, type PrDiscovery, type PrTask } from '@frontline/shared';
import { randomUUID } from 'node:crypto';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { subscribe } from '../live';
import { runManager, toolEnv } from '../routes/agents';
import { upsertListing } from './catalog';
import { refreshProduct } from './evaluate';

let db: Db;
let app: ReturnType<typeof createApp>;
let p: string;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  app = createApp(db);
  p = upsertListing(db, { source: 'cj', sourceRef: '1', title: 'Dog travel water bowl', category: 'Pet Supplies > Travel', url: 'https://cjdropshipping.com/p/1', origin: 'ingest' }).productId;
  refreshProduct(db, p, new Date());
});

const send = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const idle = () => runManager(db).idle();
const task = (body: Record<string, unknown> = {}, store = 'pawsome') =>
  send('POST', `/api/pr/tasks?store=${store}`, { clientRequestId: randomUUID(), productId: p, type: 'product_hunter', mode: 'new', instructions: 'Check the margin at $29 and the shipping to the US.', ...body });
const json = async <T>(r: Response | Promise<Response>) => (await (await r).json()) as T;

test('a new task opens a product conversation with the four-part message; a repeat returns the same task', async () => {
  const rows = await json<PrAgentRow[]>(send('GET', '/api/pr/agents?store=pawsome'));
  expect(rows).toEqual([expect.objectContaining({ type: 'product_hunter', name: 'Product Researcher', custom: false, runtime: 'demo', state: 'available', reason: null, busy: null })]);
  const seen: LiveMessage[] = [];
  const stop = subscribe((m) => void seen.push(m));
  const clientRequestId = randomUUID();
  const long = `Is it worth testing?\n${'x'.repeat(5_900)}`;
  const first = await task({ clientRequestId, instructions: long });
  expect(first.status).toBe(201);
  const t = (await first.json()) as PrTask;
  expect(t).toMatchObject({ storeId: 'pawsome', productId: p, mode: 'new', type: 'product_hunter', instructions: long, canRetry: false });
  const conversation = getConversation(db, t.conversationId!)!;
  expect(conversation).toMatchObject({ storeId: 'pawsome', agentId: 'pawsome:product_hunter', title: 'Research: Dog travel water bowl', context: { kind: 'product', id: p, name: 'Dog travel water bowl' } });
  const message = getRun(db, t.runId!)!.task;
  expect(message.length).toBeLessThan(20_000);
  expect(message).toContain(`Research task ${t.id} for product ${p}`);
  expect(message).toContain(`## The owner's instructions\nIs it worth testing?\n${'x'.repeat(5_900)}`); // verbatim
  expect(message).toMatch(/## Product facts\n[\s\S]*> - \[listing:[\w-]+\] Listing: Dog travel water bowl · source cj/); // a reference a report can cite
  expect(message).toMatch(/## Earlier in Pawsome Gear\n[\s\S]*> Stage: Discovered/);
  // Decision 5's one automatic move, recorded as the task's.
  expect(db.prepare(`SELECT from_stage, to_stage, by FROM pr_stage_history WHERE store_id = 'pawsome' AND product_id = ? AND kind = 'stage'`).all(p).map((r) => ({ ...r }))).toEqual([{ from_stage: 'discovered', to_stage: 'researching', by: t.id }]);

  const again = await task({ clientRequestId, instructions: long });
  expect(again.status).toBe(200);
  expect(((await again.json()) as PrTask).runId).toBe(t.runId);
  await idle();
  const list = await json<PrTask[]>(send('GET', `/api/pr/tasks?store=pawsome&product=${p}`));
  expect(list.map((x) => [x.id, x.status])).toEqual([[t.id, 'report_ready']]); // the scripted engine's report (T5)
  stop();
  expect(seen).toContainEqual({ type: 'research_task', storeId: 'pawsome', taskId: t.id, productId: p }); // the page refetches (T8)
  expect((await send('GET', `/api/pr/tasks/${t.id}?store=glow`)).status).toBe(404); // another store's task
});

test('a repeat whose run never started starts it, with the same task', async () => {
  db.prepare('UPDATE agents SET enabled = 0 WHERE id = ?').run('pawsome:product_hunter');
  expect((await json<PrAgentRow[]>(send('GET', '/api/pr/agents?store=pawsome')))[0]).toMatchObject({ state: 'not_ready', reason: 'The Product Researcher is turned off in AI Agents.' });
  const clientRequestId = randomUUID();
  const refused = await task({ clientRequestId });
  expect(refused.status).toBe(409);
  const t = (await refused.json()) as PrTask;
  expect(t).toMatchObject({ status: 'not_started', detail: 'This agent is offline. Redeploy it first.', runId: null, conversationId: null, canRetry: true, error: 'Not started: This agent is offline. Redeploy it first.' });
  expect(db.prepare('SELECT count(*) AS n FROM conversations').get()!.n).toBe(0); // nothing half-made

  db.prepare('UPDATE agents SET enabled = 1 WHERE id = ?').run('pawsome:product_hunter');
  const started = await task({ clientRequestId, instructions: 'Only the supplier check, please.' }); // the owner fixed the draft
  expect(started.status).toBe(201);
  const s = (await started.json()) as PrTask;
  expect(s).toMatchObject({ id: t.id, detail: null, instructions: 'Only the supplier check, please.' });
  expect(getRun(db, s.runId!)!.task).toContain("## The owner's instructions\nOnly the supplier check, please.");
  expect(db.prepare('SELECT count(*) AS n FROM pr_tasks').get()!.n).toBe(1);
});

test('the store, type and conversation checks', async () => {
  const glow = await json<{ conversation: Conversation }>(send('POST', '/api/conversations?store=glow', { clientRequestId: randomUUID(), type: 'product_hunter', message: 'Find a serum' }));
  const copy = await json<{ conversation: Conversation }>(send('POST', '/api/conversations?store=pawsome', { clientRequestId: randomUUID(), type: 'copywriter', message: 'A hero line' }));
  await idle();
  const refusal = async (body: Record<string, unknown>, store?: string) => {
    const r = await task(body, store);
    return [r.status, ((await r.json()) as { error: string }).error];
  };
  expect(await refusal({ mode: 'queue', conversationId: glow.conversation.id })).toEqual([404, 'Conversation not found']); // another store's
  expect(await refusal({ mode: 'separate', conversationId: copy.conversation.id })).toEqual([409, "That conversation is another agent type's."]);
  expect(await refusal({ type: 'copywriter' })).toEqual([409, 'Only the Product Researcher or a custom role built on it can research products.']);
  expect(await refusal({ type: 'builtin:general_researcher' })).toEqual([409, 'Only the Product Researcher or a custom role built on it can research products.']);
  expect(await refusal({ type: 'nope' })).toEqual([404, 'Agent type not found']);
  expect(await refusal({ productId: 'missing' })).toEqual([404, 'Product not found']);
  expect(await refusal({ instructions: ' ' })).toEqual([400, 'Say what to research (up to 6,000 characters)']);
  expect(await refusal({ config: { runtime: 'codex' } })).toEqual([400, expect.any(String)]); // Deploy's own check, on its field
  expect((await send('POST', '/api/pr/tasks', {})).status).toBe(400); // a store is required
  expect(db.prepare('SELECT count(*) AS n FROM pr_tasks').get()!.n).toBe(1); // only the config refusal was kept, as Not started

  db.prepare(`INSERT INTO agent_custom_roles (id, store_id, base_role, name, created_at) VALUES ('scout', NULL, 'product_hunter', 'Travel gear scout', '2026-10-28')`).run();
  expect((await json<PrAgentRow[]>(send('GET', '/api/pr/agents?store=pawsome'))).map((r) => [r.type, r.custom])).toEqual([['product_hunter', false], ['scout', true]]);
  expect((await task({ type: 'scout' })).status).toBe(201);
});

test('a busy agent both ways: queue after its conversation, or a separate one on the same config', async () => {
  const first = await json<PrTask>(task());
  await idle();
  const c = getConversation(db, first.conversationId!)!;
  // The conversation is mid-turn (a row the manager isn't running, so the queued turns below go ahead in the test).
  db.prepare(`INSERT INTO agent_runs (id, store_id, agent_id, task, status, conversation_id, config_id, created_at) VALUES ('going', 'pawsome', 'pawsome:product_hunter', 'x', 'running', ?, ?, ?)`).run(c.id, c.configId, new Date().toISOString());
  expect((await json<PrAgentRow[]>(send('GET', '/api/pr/agents?store=pawsome')))[0]).toMatchObject({ state: 'busy', busy: { conversationId: c.id, title: c.title, queued: 0, slotsFull: false } });

  const queued = await json<PrTask>(task({ mode: 'queue', conversationId: c.id, instructions: 'Then compare the CA shipping.' }));
  const separate = await json<PrTask>(task({ mode: 'separate', conversationId: c.id }));
  expect(queued.conversationId).toBe(c.id);
  expect(getRun(db, queued.runId!)!.task).toContain('Then compare the CA shipping.');
  expect(separate.conversationId).not.toBe(c.id);
  const beside = getConversation(db, separate.conversationId!)!;
  expect(beside.configId).not.toBe(c.configId);
  expect(getRun(db, separate.runId!)).toMatchObject({ runtime: getRun(db, first.runId!)!.runtime });
  await idle();

  // The queue line, derived from the run: behind the conversation's running turn, else waiting for a store slot.
  db.prepare(`UPDATE agent_runs SET status = 'queued' WHERE id IN (?, ?)`).run(queued.runId, separate.runId);
  const read = (id: string) => json<PrTask>(send('GET', `/api/pr/tasks/${id}?store=pawsome`));
  expect(await read(queued.id)).toMatchObject({ status: 'queued', detail: `Behind "${c.title}"`, canRetry: false });
  expect(await read(separate.id)).toMatchObject({ status: 'queued', detail: 'Waiting for a free store slot (2 per store)' });
  db.prepare(`UPDATE agent_runs SET status = 'done' WHERE id IN ('going', ?, ?)`).run(queued.runId, separate.runId);
});

test('an app restart mid-run leaves the task Interrupted; Retry goes on in its conversation', async () => {
  const t = await json<PrTask>(task());
  await idle();
  db.prepare(`UPDATE agent_runs SET status = 'running', ended_at = NULL WHERE id = ?`).run(t.runId);
  createRunManager({ db, env: toolEnv(db), store: () => undefined }); // a restart: in-flight runs died with the process
  const cut = await json<PrTask>(send('GET', `/api/pr/tasks/${t.id}?store=pawsome`));
  expect(cut).toMatchObject({ status: 'interrupted', canRetry: true });

  const retried = await send('POST', `/api/pr/tasks/${t.id}/retry?store=pawsome`, {});
  expect(retried.status).toBe(201);
  const again = (await retried.json()) as PrTask;
  expect(again).toMatchObject({ id: t.id, conversationId: t.conversationId });
  expect(again.runId).not.toBe(t.runId);
  expect(getRun(db, again.runId!)!.task).toBe(getRun(db, t.runId!)!.task);
  await idle();
  expect((await json<PrTask>(send('GET', `/api/pr/tasks/${t.id}?store=pawsome`))).status).toBe('report_ready'); // the retry's run reported
  expect((await send('POST', `/api/pr/tasks/${t.id}/retry?store=pawsome`, {})).status).toBe(409); // nothing to retry
});

test("the discovery Research filter and the card footer show the latest task's state, the same as the task", async () => {
  const t = await json<PrTask>(task());
  await idle();
  db.prepare('DELETE FROM pr_reports WHERE task_id = ?').run(t.id); // the scripted report: the run ends without one
  const products = (q: string, store = 'pawsome') => send('GET', `/api/pr/products?store=${store}&${q}`);
  const footer = async (status: string) => {
    const page = await json<PrDiscovery>(products(`research=${status}`));
    return page.items.find((c) => c.id === p)?.research?.status;
  };
  const run = db.prepare('UPDATE agent_runs SET status = ?, error = ? WHERE id = ?');
  const ask = (kind: string) => db.prepare(`INSERT INTO approvals (id, store_id, agent_id, run_id, title, reason, action_json, status, created_at) VALUES (?, 'pawsome', 'pawsome:product_hunter', ?, 't', 'r', ?, 'pending', '2026-10-28')`).run(randomUUID(), t.runId, JSON.stringify({ kind, payload: {} }));
  const clear = () => db.prepare('DELETE FROM approvals WHERE run_id = ?').run(t.runId);
  const cases: [string, () => void][] = [
    ['finished_without_report', () => {}],
    ['queued', () => run.run('queued', null, t.runId)],
    ['running', () => run.run('running', null, t.runId)],
    ['waiting_for_you', () => ask('question')],
    ['awaiting_approval', () => (clear(), ask('pause_campaign'))],
    ['interrupted', () => (clear(), run.run('error', INTERRUPTED, t.runId))],
    ['failed', () => run.run('error', 'Claude had a server error.', t.runId)],
    ['cancelled', () => run.run('cancelled', null, t.runId)],
    ['report_ready', () => {
      run.run('done', null, t.runId);
      db.prepare(`INSERT INTO pr_reports (id, store_id, task_id, product_id, run_id, runtime, engine, recommendation, report_json, created_at) VALUES ('r1', 'pawsome', ?, ?, ?, 'demo', 'fake', 'monitor', '{}', '2026-10-28')`).run(t.id, p, t.runId);
    }],
  ];
  for (const [status, stage] of cases) {
    stage();
    expect([status, await footer(status)]).toEqual([status, status]);
    expect((await json<PrTask>(send('GET', `/api/pr/tasks/${t.id}?store=pawsome`))).status).toBe(status);
  }
  db.prepare('UPDATE pr_tasks SET run_id = NULL WHERE id = ?').run(t.id);
  expect(await footer('not_started')).toBe('not_started');
  expect(await footer('none')).toBeUndefined(); // it has a task
  const none = await json<PrDiscovery>(products('research=none', 'glow'));
  expect(none.items.find((c) => c.id === p)).toMatchObject({ research: null }); // another store: no task there
  expect((await products('research=none', 'all')).status).toBe(400); // kept per store
  expect((await products('research=done')).status).toBe(400);
});

test('T7: the 11th research start in a minute gets 429; a refused one counts for none', async () => {
  db.prepare('UPDATE agents SET enabled = 0 WHERE id = ?').run('pawsome:product_hunter');
  expect((await task()).status).toBe(409); // refused: starts nothing, so it isn't counted
  db.prepare('UPDATE agents SET enabled = 1 WHERE id = ?').run('pawsome:product_hunter');
  for (let i = 0; i < 10; i++) expect((await task()).status).toBe(201);
  expect((await task()).status).toBe(429);
  await idle();
});

test("a link the page wouldn't give is researched from the owner's details, kept as owner-entered", async () => {
  const bad = await task({ productId: undefined, url: 'https://shop.test/p/9?utm_source=x' });
  expect([bad.status, ((await bad.json()) as { field: string }).field]).toEqual([400, 'link']);
  const r = await task({ productId: undefined, url: 'https://shop.test/p/9?utm_source=x', owner: { title: 'Collapsible dog bowl', price: { amount: 1299, currency: 'USD' } } });
  expect(r.status).toBe(201);
  const t = (await r.json()) as PrTask;
  const l = db.prepare('SELECT store_id, origin, title, canonical_url, transform_json FROM pr_listings WHERE id = ?').get(t.listingId!)!;
  expect({ ...l }).toEqual({ store_id: 'pawsome', origin: 'owner_link', title: 'Collapsible dog bowl', canonical_url: 'https://shop.test/p/9', transform_json: '{"ownerEntered":true}' });
  expect(getRun(db, t.runId!)!.task).toContain('> - Preview title (owner-provided): Collapsible dog bowl');
  // The same link again uses that listing.
  const again = (await json<PrTask>(task({ productId: undefined, url: 'https://shop.test/p/9', owner: { title: 'Another name' } })));
  expect([again.productId, again.listingId]).toEqual([t.productId, t.listingId]);
  await idle();
});

test("a new task runs on the config its row shows: the type's latest in the store", async () => {
  await json(send('POST', '/api/conversations?store=pawsome', { clientRequestId: randomUUID(), type: 'product_hunter', message: 'Scout travel bowls', config: { knowledge: ['store'], permissions: { saveFindings: 'ask' } } }));
  await idle();
  const t = await json<PrTask>(task());
  expect(getConfig(db, getConversation(db, t.conversationId!)!.configId)).toMatchObject({ runtime: 'demo', knowledge: ['store'], permissions: { saveFindings: 'ask' } });
  await idle();
});
