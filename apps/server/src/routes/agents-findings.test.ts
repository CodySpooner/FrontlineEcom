import { captureFinding, createCard, createConversation, createRunManager, ensureCategoryPath, fakeEngine, getRun, resolveType, retrieveKnowledge, runTools, seatDefault, type FakeStep } from '@frontline/agents';
import { blockFinding, type AgentRun, type ApprovalRequest, type KbWorkspace } from '@frontline/shared';
import { beforeEach, expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { getStore } from '../stores';
import { runHooks, toolEnv } from './agents';

let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  app = createApp(db);
});

const TASK = 'Write the spring hero line';
const done: FakeStep = { type: 'done', sessionId: 's1', usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 } };
const card = (ws: KbWorkspace, title: string, more: { status?: 'active' | 'archived'; verifiedAt?: string } = {}) => {
  const c = createCard(db, ws, { categoryId: ensureCategoryPath(db, ws, ['Content']), title, summary: `${title}, in short`, type: 'strategy', stage: 'hypothesis', status: more.status ?? 'active', authorId: 'owner', origin: 'owner' });
  if (more.verifiedAt) db.prepare('UPDATE kb_cards SET verified_at = ?, created_at = ? WHERE id = ?').run(more.verifiedAt, more.verifiedAt, c.id);
  return c;
};
const rows = (cardId: string) => db.prepare('SELECT kind, text, run_id FROM kb_evidence WHERE card_id = ?').all(cardId).map((r) => ({ ...r }));
const findings = () => db.prepare(`SELECT id, title, status, origin, run_id, verified_at FROM kb_cards WHERE origin = 'agent'`).all().map((r) => ({ ...r }));
const review = (on: boolean) => db.prepare('INSERT INTO kb_controls (store_id, settings_json, updated_at) VALUES (?, ?, ?)').run('glow', JSON.stringify({ review: on }), new Date().toISOString());
const CLAIMS = ['Buyers want before-and-after photos', 'Bundles lift serum order value', 'Night routines sell LED masks', 'Free shipping near forty dollars converts', 'Video demos beat static images on mobile', 'Gift sets peak before holidays'];
const find = (n: number) => ({ title: CLAIMS[n - 1]!, summary: `Seen in the data: ${CLAIMS[n - 1]!.toLowerCase()}.`, tag: 'research', sources: ['https://example.com/a'] });
/** A glow Copywriter conversation saving findings `mode`, whose turn runs `steps` on the scripted engine (the reflection turn doesn't). */
function saving(mode: 'off' | 'ask' | 'auto', steps: FakeStep[], tail: FakeStep[] = [done]) {
  const m = createRunManager({ db, env: toolEnv(db), store: (id) => getStore(db, id), engine: fakeEngine((i) => (i.task.endsWith(TASK) ? [...steps, ...tail] : [done])), ...runHooks(db) });
  const store = getStore(db, 'glow')!;
  const type = resolveType(db, 'glow', 'copywriter')!;
  const draft = seatDefault(store, type);
  const c = createConversation(db, store, type, { ...draft, permissions: { ...draft.permissions, saveFindings: mode } }, { title: 'Spring' });
  const run = m.start(c.agentId, TASK, undefined, undefined, { conversationId: c.id }) as AgentRun;
  return { m, c, run };
}
const outputs = (runId: string) => getRun(db, runId)!.transcript.flatMap((e) => (e.type === 'tool_result' ? [e.output] : []));

test('a [research] block with two URLs becomes a hypothesis card with one observed row holding the tag and both URLs, no source and no verified_at', () => {
  const block = 'Spring buyers want proof before they buy [research]. Two forums say so: https://forum.example/a and https://reviews.example/b.\n\nShow a 4-week photo strip.';
  const f = blockFinding(block);
  expect(f).toMatchObject({ title: 'Spring buyers want proof before they buy.', tag: 'research', sources: ['https://forum.example/a', 'https://reviews.example/b'], body: block });
  const saved = captureFinding(db, 'glow', f, { agentId: 'glow:copywriter', runId: 'r1' });
  expect(saved).toMatchObject({ kind: 'saved', card: { storeId: 'glow', stage: 'hypothesis', status: 'proposed', origin: 'agent' } });
  if (saved.kind === 'refused') throw new Error(saved.reason);
  expect(rows(saved.card.id)).toEqual([{ kind: 'observed', text: '[research] https://forum.example/a https://reviews.example/b', run_id: 'r1' }]);
  expect(findings()).toEqual([expect.objectContaining({ verified_at: null, run_id: 'r1' })]);
  expect(db.prepare('SELECT count(*) AS n FROM kb_sources').get()?.n).toBe(0);
});

test("dedupe: a live store card gets one more row and isn't refreshed (past its freshness age); a General card takes nothing; an archived one refuses", () => {
  const old = card('glow', 'Spring buyers want proof', { verifiedAt: '2025-01-01T00:00:00.000Z' });
  const f = { title: 'Spring buyers want proof', summary: 'They ask for photos.', tag: 'hypothesis' as const, sources: [`[kb:${old.id}]`] };
  expect(captureFinding(db, 'glow', f, { agentId: 'glow:copywriter', runId: 'r1' })).toMatchObject({ kind: 'added', card: { id: old.id } });
  expect(rows(old.id)).toEqual([{ kind: 'observed', text: `[hypothesis] [kb:${old.id}]`, run_id: 'r1' }]);
  expect(db.prepare('SELECT verified_at FROM kb_cards WHERE id = ?').get(old.id)?.verified_at).toBe('2025-01-01T00:00:00.000Z');
  expect(db.prepare(`SELECT count(*) AS n FROM kb_revisions WHERE card_id = ? AND reason LIKE 'Refreshed%'`).get(old.id)?.n).toBe(0);
  const general = card(null, 'Problem-first hooks beat brand stories');
  expect(captureFinding(db, 'glow', { title: 'Problem-first hooks beat brand stories', summary: 'Seen again.', tag: 'untagged', sources: [] }, { agentId: 'glow:copywriter', runId: 'r2' })).toMatchObject({ kind: 'general', card: { id: general.id } });
  expect(rows(general.id)).toEqual([]);
  card('glow', 'Discounts cheapen the brand', { status: 'archived' });
  expect(captureFinding(db, 'glow', { title: 'Discounts cheapen the brand', summary: 'Seen again.', tag: 'untagged', sources: [] }, { agentId: 'glow:copywriter', runId: 'r3' })).toEqual({ kind: 'refused', reason: 'the owner archived or rejected a card that says this ("Discounts cheapen the brand")' });
  expect(findings()).toEqual([]);
});

test.each([true, false])('review %s: an Automatically save is proposed and retrieval skips it; an approved Ask-me save follows the setting and says which', async (on) => {
  review(on);
  const auto = saving('auto', [{ call: 'save_finding', input: find(1) }]);
  await auto.m.idle();
  expect(outputs(auto.run.id)[0]).toMatch(/^Saved as Unreviewed: Buyers want before-and-after photos \(/);
  expect(findings()).toEqual([expect.objectContaining({ status: 'proposed' })]);
  expect(retrieveKnowledge(db, { ws: 'glow', role: 'copywriter', query: 'before after photos', limit: 8 })).toEqual([]);
  expect(getRun(db, auto.run.id)!.transcript.find((e) => e.type === 'kb_written')).toMatchObject({ card: { title: 'Buyers want before-and-after photos', status: 'proposed' }, added: false });
  const ask = saving('ask', [{ call: 'save_finding', input: find(2) }]);
  const asked = await vi.waitFor(() => {
    const a = getRun(db, ask.run.id)?.transcript.find((e) => e.type === 'approval_request')?.approval as ApprovalRequest | undefined;
    if (!a) throw new Error('not yet');
    return a;
  });
  expect(asked).toMatchObject({ title: 'Bundles lift serum order value', action: { kind: 'kb.save' }, conversationId: ask.c.id });
  expect(await (await app.request(`/api/conversations/${ask.c.id}?store=glow`)).json()).toMatchObject({ state: 'awaiting_approval' });
  expect((await app.request(`/api/approvals/${asked.id}/approve`, { method: 'POST' })).status).toBe(200);
  await ask.m.idle();
  expect(outputs(ask.run.id)[0]).toMatch(on ? /^Saved as Unreviewed: / : /^Saved as Active: /);
  expect(findings().find((f) => f.title === 'Bundles lift serum order value')).toMatchObject({ status: on ? 'proposed' : 'active' });
});

test('Ask me: Skip saves nothing. Off: the tool is absent. The cap is 5 a run', async () => {
  const ask = saving('ask', [{ call: 'save_finding', input: find(1) }]);
  await vi.waitFor(() => expect(getRun(db, ask.run.id)?.transcript.some((e) => e.type === 'approval_request')).toBe(true));
  const a = getRun(db, ask.run.id)!.transcript.find((e) => e.type === 'approval_request')!;
  if (a.type !== 'approval_request') throw new Error();
  await app.request(`/api/approvals/${a.approval.id}/deny`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  await ask.m.idle();
  expect(outputs(ask.run.id)).toEqual(['Not saved: the owner skipped it. Go on.']);
  const off = saving('off', [{ call: 'save_finding', input: find(1) }]);
  await off.m.idle();
  expect(outputs(off.run.id)).toEqual(['Tool save_finding is not available']);
  expect(runTools('copywriter', undefined, { tools: [], permissions: { saveFindings: 'off' } }).map((t) => t.name)).not.toContain('save_finding');
  const many = saving('auto', [1, 2, 3, 4, 5, 6].map((n) => ({ call: 'save_finding', input: find(n) })));
  await many.m.idle();
  expect(outputs(many.run.id).at(-1)).toBe('Not saved: a run saves 5 findings at most, and this one has.');
  expect(findings()).toHaveLength(5);
});

test('a finding saved before the run is cut short stays saved', async () => {
  const steps: FakeStep[] = [{ call: 'save_finding', input: find(1) }, { call: 'ask_owner', input: { question: 'Which product leads the spring line?' } }];
  const { m, run } = saving('auto', steps);
  await vi.waitFor(() => expect(findings()).toHaveLength(1));
  m.cancel(run.id);
  await m.idle();
  expect(getRun(db, run.id)!.status).toBe('cancelled'); // stopped while it waited on the owner
  expect(findings()).toEqual([expect.objectContaining({ title: 'Buyers want before-and-after photos', run_id: run.id })]);
});

test('Save to Knowledge Base on a reply: the anchored block, the owner\'s title and summary, the review setting; store-scoped and checked', async () => {
  const reply = 'Lead with the photo strip [measured]. It lifted add-to-cart: https://shop.example/report.';
  const { m, run, c } = saving('off', [{ type: 'text_delta', text: reply }]);
  await m.idle();
  const save = (body: unknown, store = 'glow', id = run.id) => app.request(`/api/runs/${id}/findings?store=${store}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const ok = { block: 0, title: 'Photo strips lift add-to-cart', summary: 'A before-and-after strip lifted add-to-cart.' };
  expect((await save(ok, 'peak')).status).toBe(404);
  expect((await save({ ...ok, title: 'Hi' })).status).toBe(400);
  expect((await save({ ...ok, block: 3 })).status).toBe(404);
  const r = await save(ok);
  expect(r.status).toBe(201);
  const saved = (await r.json()) as { result: string; card: { id: string; status: string } };
  expect(saved).toMatchObject({ result: 'saved', card: { title: 'Photo strips lift add-to-cart', status: 'proposed', storeId: 'glow' } });
  expect(rows(saved.card.id)).toEqual([{ kind: 'observed', text: '[measured] https://shop.example/report', run_id: run.id }]);
  expect(db.prepare('SELECT body FROM kb_cards WHERE id = ?').get(saved.card.id)?.body).toBe(reply);
  expect(await (await save(ok)).json()).toMatchObject({ result: 'added', card: { id: saved.card.id } });
  expect(await (await app.request(`/api/conversations/${c.id}/findings?store=glow`)).json()).toEqual([expect.objectContaining({ id: saved.card.id, status: 'proposed' })]);
  // Review off: the owner's save is accepted.
  review(false);
  const r2 = await save({ ...ok, title: 'Photo strips beat spec lists', summary: 'Shoppers trust photos over specifications.' });
  expect(await r2.json()).toMatchObject({ result: 'saved', card: { status: 'active' } });
});

test("going live removes the demo store's findings: its finding cards, and the rows it added to cards that stay", async () => {
  const kept = card('glow', 'Spring buyers want proof');
  const { m } = saving('auto', [{ call: 'save_finding', input: find(1) }, { call: 'save_finding', input: { ...find(2), title: 'Spring buyers want proof' } }]);
  await m.idle();
  expect([findings().length, rows(kept.id).length]).toEqual([1, 1]);
  db.prepare('UPDATE stores SET connected = 1, demo = 0 WHERE id = ?').run('glow');
  createApp(db); // activation runs at startup
  expect([findings().length, rows(kept.id).length]).toEqual([0, 0]);
});
