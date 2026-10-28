import { randomUUID } from 'node:crypto';
import { APP_TOOLS, callTool, createCard, ensureCategoryPath, getAgent, getCard, once, type ToolContext } from '@frontline/agents';
import type { KbOverview, KbWorkspace } from '@frontline/shared';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { decide } from '../approvals';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { toolEnv } from '../routes/agents';
import { getStore } from '../stores';
import { drafter, proposeKbPromotions } from './promote';

let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  app = createApp(db);
});

const card = (ws: KbWorkspace, title: string, more: Partial<Parameters<typeof createCard>[2]> & { path?: string[] } = {}) => {
  const { path = ['Advertising', 'TikTok'], ...rest } = more;
  return createCard(db, ws, { categoryId: ensureCategoryPath(db, ws, path), title, summary: `${title}, in short`, type: 'strategy', stage: 'hypothesis', status: 'active', authorId: 'owner', origin: 'owner', ...rest });
};
const promotions = () =>
  db
    .prepare(`SELECT id, store_id, agent_id, title, reason, status, action_json FROM approvals WHERE json_extract(action_json, '$.kind') = 'kb.promote' ORDER BY rowid`)
    .all()
    .map((r) => Object.assign(r, { action: JSON.parse(String(r.action_json)) as { kind: string; payload: Record<string, unknown> } }));
const generalCard = (title: string) => db.prepare('SELECT id FROM kb_cards WHERE store_id IS NULL AND title = ?').get(title)?.id as string | undefined;
const derived = (id: string) => db.prepare(`SELECT from_id, store_id, status FROM kb_links WHERE to_id = ? AND type = 'derived_from'`).all(id);
/** A tool call in a run of `storeId`'s Market Analyst. */
function propose(args: unknown, storeId = 'pawsome') {
  const runId = randomUUID();
  db.prepare(`INSERT INTO agent_runs (id, store_id, agent_id, task, status, created_at) VALUES (?, ?, ?, 'A task', 'running', ?)`).run(runId, storeId, `${storeId}:market_analyst`, new Date().toISOString());
  const ctx = { ...toolEnv(db), runId, store: getStore(db, storeId)!, agent: getAgent(db, `${storeId}:market_analyst`)!, emit: () => {} } as ToolContext;
  return callTool(APP_TOOLS.find((t) => t.name === 'propose_general')!, args, ctx).then((r) => r.output);
}
const draft = { title: 'Problem-first hooks win', summary: 'Ads that open on the problem beat product shots', why: 'It held across 200 ads, and nothing in it is about dogs.' };
const req = (path: string, init?: { method: string; body?: unknown }) =>
  app.request(path, init && { method: init.method, headers: { 'content-type': 'application/json' }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });

describe('promote to General', () => {
  test("propose_general asks the owner with the general draft; approved, it's a General card Derived From the store's, asked once", async () => {
    const c = card('pawsome', 'Pawsome car hooks win', { summary: 'Pawsome Gear ads that open on a car-anxious dog beat product shots', stage: 'validated' });
    const asked = propose({ card: c.id, ...draft });
    await vi.waitFor(() => expect(promotions()).toHaveLength(1));
    expect(promotions()[0]).toMatchObject({
      store_id: 'pawsome',
      agent_id: 'pawsome:market_analyst',
      title: 'Promote to General: Pawsome car hooks win',
      reason: draft.why,
      status: 'pending',
      action: { kind: 'kb.promote', payload: { cardId: c.id, title: draft.title, summary: draft.summary } },
    });
    expect(await propose({ card: c.id, ...draft })).toBe('Already waiting for the owner: a General version of this card was proposed.');
    decide(db, String(promotions()[0]!.id), 'approve');
    expect(await asked).toBe('Approved by the owner: Promote to General: Pawsome car hooks win');
    await vi.waitFor(() => expect(generalCard(draft.title)).toBeTruthy());
    // A Hypothesis in General: one store's evidence isn't evidence it holds in others. Its category path comes along.
    expect(getCard(db, generalCard(draft.title)!)).toMatchObject({ storeId: null, path: ['Advertising', 'TikTok'], summary: draft.summary, stage: 'hypothesis', status: 'active', type: 'strategy', origin: 'promotion', authorId: 'pawsome:market_analyst' });
    expect(derived(c.id)).toEqual([{ from_id: generalCard(draft.title), store_id: 'pawsome', status: 'confirmed' }]);
    expect(await propose({ card: c.id, ...draft })).toBe(`Already in General as "${draft.title}".`);
  });

  test('propose_general takes only an accepted card of the store itself', async () => {
    const general = card(null, 'Shared already');
    const other = card('glow', 'Glow note');
    const proposed = card('pawsome', 'Not reviewed', { status: 'proposed' });
    const archived = card('pawsome', 'Old idea', { status: 'archived' });
    expect(await propose({ card: general.id, ...draft })).toBe('"Shared already" is General already.');
    expect(await propose({ card: other.id, ...draft })).toBe(`No card ${other.id} here. Use search_knowledge for ids.`);
    expect(await propose({ card: proposed.id, ...draft })).toBe('"Not reviewed" is proposed: only an accepted card can be promoted.');
    expect(await propose({ card: archived.id, ...draft })).toBe('"Old idea" is archived: only an accepted card can be promoted.');
    expect(promotions()).toEqual([]);
  });

  test("approving acts on the store's own card only, and joins a General card of the same title instead of making a second", async () => {
    const c = card('pawsome', 'Car hooks');
    const glow = card('glow', 'Glow hooks');
    const same = card(null, 'problem-first hooks WIN');
    const ask = (storeId: string, cardId: string) => {
      const id = randomUUID();
      db.prepare(`INSERT INTO approvals (id, store_id, agent_id, title, reason, action_json, status, created_at) VALUES (?, ?, ?, 'Promote', 'Why', ?, 'pending', ?)`).run(
        id, storeId, `${storeId}:market_analyst`, JSON.stringify({ kind: 'kb.promote', payload: { cardId, ...draft } }), new Date().toISOString(),
      );
      decide(db, id, 'approve');
    };
    ask('pawsome', glow.id); // pawsome's request can't promote glow's card
    ask('pawsome', c.id);
    await vi.waitFor(() => expect(derived(c.id)).toHaveLength(1));
    expect(derived(c.id)).toEqual([{ from_id: same.id, store_id: 'pawsome', status: 'confirmed' }]);
    expect(derived(glow.id)).toEqual([]);
    expect(db.prepare('SELECT count(*) AS n FROM kb_cards WHERE store_id IS NULL').get()).toEqual({ n: 1 });
  });

  test("the owner's Promote to General starts the card's own agent (else the Analytics Specialist) drafting; the demo engine drafts without the store's name", async () => {
    const c = card('pawsome', 'Car hooks win at Pawsome Gear', { summary: 'At Pawsome Gear, open on the car-anxious dog', authorId: 'pawsome:copywriter' });
    const res = await req(`/api/kb/cards/${c.id}/promote?ws=pawsome`, { method: 'POST' });
    expect(res.status).toBe(202);
    const { runId, agentId } = (await res.json()) as { runId: string; agentId: string };
    expect(agentId).toBe('pawsome:copywriter');
    expect(String(db.prepare('SELECT task FROM agent_runs WHERE id = ?').get(runId)?.task)).toMatch(new RegExp(`^Promote \\[kb:${c.id}\\] to the owner's General knowledge: `));
    await vi.waitFor(() => expect(promotions()).toHaveLength(1));
    expect(promotions()[0]!.action.payload).toMatchObject({ cardId: c.id, title: 'Car hooks win at this store', summary: 'At this store, open on the car-anxious dog' });
    expect(await (await req(`/api/kb/cards/${c.id}/promote?ws=pawsome`, { method: 'POST' })).json()).toEqual({ error: 'Already waiting for your call' });
    decide(db, String(promotions()[0]!.id), 'deny'); // lets the demo run finish
    // Kept in the store, the owner can still ask again later.
    expect((await req(`/api/kb/cards/${c.id}/promote?ws=pawsome`, { method: 'POST' })).status).toBe(202);
    await vi.waitFor(() => expect(promotions()).toHaveLength(2));
    decide(db, String(promotions()[1]!.id), 'deny');

    // A card without an agent author goes to the Market Analyst.
    const own = card('pawsome', 'Owner note');
    const r2 = (await (await req(`/api/kb/cards/${own.id}/promote?ws=pawsome`, { method: 'POST' })).json()) as { agentId: string };
    expect(r2.agentId).toBe('pawsome:market_analyst');
    await vi.waitFor(() => expect(promotions()).toHaveLength(3));
    decide(db, String(promotions()[2]!.id), 'deny');
  });

  test("the drafter is an agent of the card's own store that wrote it, else the Analytics Specialist", () => {
    expect(drafter({ storeId: 'pawsome', authorId: 'pawsome:copywriter' })).toBe('pawsome:copywriter');
    for (const authorId of ['owner', 'glow:copywriter', 'pawsome:intern', 'research']) expect(drafter({ storeId: 'pawsome', authorId })).toBe('pawsome:market_analyst');
  });

  test('Promote to General: errors', async () => {
    const general = card(null, 'Shared');
    const glow = card('glow', 'Glow note');
    const archived = card('pawsome', 'Old idea', { status: 'archived' });
    const status = async (id: string, ws: string) => {
      const r = await req(`/api/kb/cards/${id}/promote?ws=${ws}`, { method: 'POST' });
      return [r.status, ((await r.json()) as { error: string }).error];
    };
    expect(await status(general.id, 'general')).toEqual([400, 'Only a store card can be promoted']);
    expect(await status(general.id, 'pawsome')).toEqual([404, 'card not found']);
    expect(await status(glow.id, 'pawsome')).toEqual([404, 'card not found']);
    expect(await status(archived.id, 'pawsome')).toEqual([409, 'Only an accepted card can be promoted']);
    const done = card('pawsome', 'Done before');
    const g = card(null, 'Done before, in general');
    db.prepare(`INSERT INTO kb_links (id, store_id, from_id, to_id, type, why, status, author_id, created_at) VALUES ('l1', 'pawsome', ?, ?, 'derived_from', 'Promoted', 'confirmed', 'owner', ?)`).run(g.id, done.id, new Date().toISOString());
    expect(await status(done.id, 'pawsome')).toEqual([409, 'Already in General as "Done before, in general"']);
    // Derived From another store card, or only suggested from a General one, isn't promoted.
    const fresh = card('pawsome', 'Not yet general');
    const at = new Date().toISOString();
    db.prepare(`INSERT INTO kb_links (id, store_id, from_id, to_id, type, why, status, author_id, created_at) VALUES ('l2', 'pawsome', ?, ?, 'derived_from', 'Mine', 'confirmed', 'owner', ?)`).run(card('pawsome', 'A store card').id, fresh.id, at);
    db.prepare(`INSERT INTO kb_links (id, store_id, from_id, to_id, type, why, status, author_id, created_at) VALUES ('l3', 'pawsome', ?, ?, 'derived_from', 'Maybe', 'suggested', 'app', ?)`).run(card(null, 'A general card').id, fresh.id, at);
    expect((await req(`/api/kb/cards/${fresh.id}/promote?ws=pawsome`, { method: 'POST' })).status).toBe(202);
    await vi.waitFor(() => expect(promotions()).toHaveLength(1));
    decide(db, String(promotions()[0]!.id), 'deny');
  });

  test("the owner edits the draft before approving: only a pending promotion of the workspace's, within the card limits", async () => {
    const c = card('pawsome', 'Car hooks');
    void propose({ card: c.id, ...draft });
    await vi.waitFor(() => expect(promotions()).toHaveLength(1));
    const id = String(promotions()[0]!.id);
    const edit = (body: unknown, ws = 'pawsome', pid = id) => req(`/api/kb/promotions/${pid}?ws=${ws}`, { method: 'PATCH', body });
    expect((await edit({ title: 'x' })).status).toBe(400);
    expect(await (await edit({ title: 'Hooks', summary: 'y'.repeat(601) })).json()).toEqual({ error: 'summary must be at most 600 characters' });
    expect((await edit({ title: 'Lead with the problem', summary: 'Open ads on the problem' }, 'glow')).status).toBe(404);
    const other = db.prepare(`SELECT id, store_id FROM approvals WHERE status = 'pending' AND json_extract(action_json, '$.kind') != 'kb.promote' LIMIT 1`).get()!;
    expect((await edit({ title: 'Lead with the problem', summary: 'Open ads on the problem' }, String(other.store_id), String(other.id))).status).toBe(404);
    const res = await edit({ title: 'Lead with the problem', summary: 'Open ads on the problem', body: 'Shown in the first 3 seconds.' });
    expect(res.status).toBe(200);
    expect(promotions()[0]!.action.payload).toEqual({ cardId: c.id, title: 'Lead with the problem', summary: 'Open ads on the problem', body: 'Shown in the first 3 seconds.' });
    decide(db, id, 'approve');
    await vi.waitFor(() => expect(generalCard('Lead with the problem')).toBeTruthy());
    expect(getCard(db, generalCard('Lead with the problem')!)).toMatchObject({ summary: 'Open ads on the problem', body: 'Shown in the first 3 seconds.' });
    expect((await edit({ title: 'Again', summary: 'Too late now' })).status).toBe(404);
  });

  test('the same card found on its own in 2+ live stores is offered for General once, drafted from the strongest; demo stores never count', async () => {
    for (const id of ['pawsome', 'glow']) {
      db.prepare('UPDATE stores SET connected = 1 WHERE id = ?').run(id);
      once(db, `activate:${id}`);
    }
    // Glow's comes first from the database: the stronger one leads all the same.
    card('glow', 'Problem-first hooks win on TikTok ads', { summary: 'Open on the problem, not the product' });
    const lead = card('pawsome', 'Problem-first hooks win on TikTok', { summary: 'Open on the problem, not the product', stage: 'supported', authorId: 'pawsome:ad_strategist' });
    card('peak', 'Problem-first hooks win on TikTok', { summary: 'Open on the problem, not the product' }); // a demo store
    db.prepare(`UPDATE stores SET connected = 1 WHERE id = 'peak'`).run(); // connected, but not live yet
    card('pawsome', 'Bundles lift order value');
    card('glow', 'Bundles lift order value', { status: 'archived' });
    card('glow', 'Bundles of hooks for email flows'); // one word in common
    // Already General, or waiting for the owner: not offered again.
    const shipped = card('pawsome', 'Free shipping over 50 lifts AOV');
    card('glow', 'Free shipping over 50 lifts AOV');
    db.prepare(`INSERT INTO kb_links (id, store_id, from_id, to_id, type, why, status, author_id, created_at) VALUES ('l1', 'pawsome', ?, ?, 'derived_from', 'Promoted', 'confirmed', 'owner', ?)`).run(card(null, 'Free shipping lifts AOV').id, shipped.id, new Date().toISOString());
    const asked = card('pawsome', 'Gift notes lift reviews');
    card('glow', 'Gift notes lift reviews');
    db.prepare(`INSERT INTO approvals (id, store_id, agent_id, title, reason, action_json, status, created_at) VALUES ('p1', 'pawsome', 'pawsome:market_analyst', 'Promote', 'Why', ?, 'pending', ?)`).run(JSON.stringify({ kind: 'kb.promote', payload: { cardId: asked.id, ...draft } }), new Date().toISOString());
    const start = vi.fn(() => ({ id: 'r1' }));
    proposeKbPromotions(db, start);
    proposeKbPromotions(db, start);
    expect(start.mock.calls).toEqual([['pawsome:ad_strategist', expect.stringMatching(new RegExp(`^Promote \\[kb:${lead.id}\\] to the owner's General knowledge \\(found on its own in Pawsome Gear and Glow Haus\\): `))]]);
  });

  test('a waiting promotion is a discovery for its store and All workspaces, not for General or another store', async () => {
    const c = card('pawsome', 'Car hooks');
    void propose({ card: c.id, ...draft });
    await vi.waitFor(() => expect(promotions()).toHaveLength(1));
    const found = async (ws: string) => ((await (await req(`/api/kb/overview?ws=${ws}`)).json()) as KbOverview).discoveries.filter((d) => d.kind === 'promotion');
    expect(await found('pawsome')).toEqual([{ kind: 'promotion', id: promotions()[0]!.id, at: expect.any(String), title: draft.title, card: expect.objectContaining({ id: c.id, title: 'Car hooks' }) }]);
    expect(await found('all')).toHaveLength(1);
    expect(await found('general')).toEqual([]);
    expect(await found('glow')).toEqual([]);
    decide(db, String(promotions()[0]!.id), 'deny');
    expect(await found('pawsome')).toEqual([]);
  });
});
