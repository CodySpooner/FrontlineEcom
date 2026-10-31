// ST-26 (decision 13): Automatic saving, read at each automatic save by its callers: an agent's save_finding in a
// conversation set to save Automatically, and a Product Research report's claims. The owner's own saves never ask.
import { randomUUID } from 'node:crypto';
import { autoSave, createConversation, createRunManager, fakeEngine, getRun, resolveType, seatDefault, type FakeStep } from '@frontline/agents';
import type { AgentRun, ApprovalRequest, ConfigView, PrReportBody, PrTask } from '@frontline/shared';
import { beforeEach, expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { runHooks, runManager, toolEnv } from '../routes/agents';
import { upsertListing } from '../product-research/catalog';
import { refreshProduct } from '../product-research/evaluate';
import { saveReport } from '../product-research/reports';
import { getStore } from '../stores';

let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  app = createApp(db);
});

const send = async (method: string, path: string, body?: unknown) => {
  const r = await app.request(path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: (await r.json()) as ConfigView & { error?: string } };
};
/** Automatic saving set for the workspace, or one store's own (`undefined`: back to the workspace's). */
async function setAutoSave(on: boolean | undefined, storeId?: string) {
  const v = (await send('GET', `/api/config${storeId ? `?store=${storeId}` : ''}`)).body;
  const version = (storeId ? v.versions[`store_caps:${storeId}`] : v.versions.workspace) ?? 0;
  const doc = { doc: storeId ? 'store_caps' : 'workspace', ...(storeId ? { storeId } : {}), version, ...(on === undefined ? { unset: ['knowledge.autoSave'] } : { set: { 'knowledge.autoSave': on } }) };
  expect((await send('PATCH', '/api/config', { documents: [doc] })).status).toBe(200);
}
const done: FakeStep = { type: 'done', sessionId: 's1', usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 } };
const find = (title: string) => ({ title, summary: `Seen in the data: ${title.toLowerCase()}.`, tag: 'research', sources: ['https://example.com/a'] });
const cards = () => db.prepare(`SELECT id, title, status, author_id, run_id FROM kb_cards WHERE origin = 'agent' ORDER BY title`).all().map((r) => ({ ...r }));
const asked = (runId: string) => getRun(db, runId)?.transcript.find((e) => e.type === 'approval_request')?.approval as ApprovalRequest | undefined;

/** A Copywriter conversation on `storeId` set to save findings Automatically; each turn saves the finding its task names, then says it. */
function conversation(storeId = 'glow') {
  const engine = fakeEngine((i) => {
    const title = /Save: (.+)$/.exec(i.task)?.[1];
    return title ? [{ call: 'save_finding', input: find(title) }, { type: 'text_delta', text: `${title} [research]: https://example.com/a` }, done] : [done];
  });
  const m = createRunManager({ db, env: toolEnv(db), store: (id) => getStore(db, id), engine, ...runHooks(db) });
  const store = getStore(db, storeId)!;
  const type = resolveType(db, storeId, 'copywriter')!;
  const draft = seatDefault(store, type);
  const c = createConversation(db, store, type, { ...draft, permissions: { ...draft.permissions, saveFindings: 'auto' } }, { title: 'Spring' });
  return { m, turn: (title: string) => m.start(c.agentId, `Save: ${title}`, undefined, undefined, { conversationId: c.id }) as AgentRun };
}

test('a conversation saving Automatically files an unreviewed card with its run, agent and sources; with Automatic saving off, its next save asks and the cards stay', async () => {
  const chat = conversation();
  const first = chat.turn('Buyers want before-and-after photos');
  await chat.m.idle();
  const saved = cards();
  expect(saved).toEqual([{ id: expect.any(String), title: 'Buyers want before-and-after photos', status: 'proposed', author_id: first.agentId, run_id: first.id }]);
  expect(db.prepare('SELECT text, run_id FROM kb_evidence WHERE card_id = ?').all(String(saved[0]!.id)).map((r) => ({ ...r }))).toEqual([{ text: '[research] https://example.com/a', run_id: first.id }]);

  await setAutoSave(false);
  const next = chat.turn('Bundles lift serum order value');
  const a = await vi.waitFor(() => asked(next.id) ?? Promise.reject(new Error('not yet')));
  expect(a).toMatchObject({ title: 'Bundles lift serum order value', action: { kind: 'kb.save' } });
  expect(cards()).toEqual(saved);
  await send('POST', `/api/approvals/${a.id}/deny`, {});
  await chat.m.idle();
  expect(cards()).toEqual(saved);
});

test("a store's own value wins over the workspace's, both ways, and only for that store", async () => {
  await setAutoSave(false, 'glow');
  expect([autoSave(db, 'glow'), autoSave(db, 'peak')]).toEqual([false, true]);
  const glow = conversation('glow');
  const run = glow.turn('Night routines sell LED masks');
  await vi.waitFor(() => expect(asked(run.id)).toBeDefined());
  await send('POST', `/api/approvals/${asked(run.id)!.id}/deny`, {});
  await glow.m.idle();

  await setAutoSave(false);
  await setAutoSave(true, 'glow');
  expect([autoSave(db, 'glow'), autoSave(db, 'peak')]).toEqual([true, false]);
  const again = glow.turn('Gift sets peak before holidays');
  await glow.m.idle();
  expect(asked(again.id)).toBeUndefined();
  expect(cards().map((c) => [c.title, c.status])).toEqual([['Gift sets peak before holidays', 'proposed']]);

  await setAutoSave(undefined, 'glow'); // Use workspace default
  expect(autoSave(db, 'glow')).toBe(false);
});

test("with Automatic saving off, a Product Research report files no card and keeps its claims; the owner's own save from a reply still saves", async () => {
  const { productId } = upsertListing(db, { source: 'cj', sourceRef: '1', title: 'Dog travel water bowl', category: 'Pet Supplies > Travel', origin: 'ingest' });
  refreshProduct(db, productId, new Date());
  const created = await app.request('/api/pr/tasks?store=pawsome', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientRequestId: randomUUID(), productId, type: 'product_hunter', mode: 'new', instructions: 'Evaluate it.' }) });
  const t = (await created.json()) as PrTask;
  await runManager(db).idle();
  db.prepare(`UPDATE pr_tasks SET run_id = 'real' WHERE id = ?`).run(t.id);
  await setAutoSave(false, 'pawsome');
  const claim = { claim: 'Leak-proof lids are the top request in bowl reviews', kind: 'research' as const, source: 'https://example.com/reviews' };
  const report: PrReportBody = {
    recommendation: 'shortlist', summary: '', purpose: '', customer_problem: '', store_fit: { fit: 'strong', why: '' }, demand_evidence: '', competitors: [], supplier_offers: [],
    risks: [], next_steps: [], evidence: [claim], open_questions: [], would_change_if: '', proposals: [], unknown_reasons: {},
  };
  saveReport(db, t.id, report, { runId: 'real', storeId: 'pawsome', scripted: false });
  expect(db.prepare(`SELECT count(*) AS n FROM kb_cards WHERE store_id = 'pawsome' AND origin = 'agent'`).get()?.n).toBe(0);
  expect(JSON.parse(String(db.prepare(`SELECT report_json FROM pr_reports WHERE run_id = 'real'`).get()?.report_json)).evidence).toEqual([claim]);

  // The owner's "Save to Knowledge Base" on a finished reply never asks.
  await setAutoSave(false);
  const chat = conversation();
  const run = chat.turn('Video demos beat static images on mobile');
  await vi.waitFor(() => expect(asked(run.id)).toBeDefined());
  await send('POST', `/api/approvals/${asked(run.id)!.id}/deny`, {});
  await chat.m.idle();
  const r = await app.request(`/api/runs/${run.id}/findings?store=glow`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ block: 0, title: 'Video demos beat static images', summary: 'Mobile buyers watch the demo first.' }) });
  expect(r.status).toBe(201);
  expect(await r.json()).toMatchObject({ result: 'saved', card: { title: 'Video demos beat static images', storeId: 'glow' } });
});
