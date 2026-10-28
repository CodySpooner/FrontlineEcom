import { randomUUID } from 'node:crypto';
import {
  APP_TOOLS, callTool, createCard, createLink, createResearchTask, decideLink, ensureCategoryPath, getAgent, getCard, getResearchTask, listEvidence, listLinks, listRevisions, RESEARCH_TOOLS, runTools,
  saveSource, updateAgent, type FetchedSource, type ToolContext,
} from '@frontline/agents';
import { AGENT_ROLES, type AgentRole, type KbWorkspace } from '@frontline/shared';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { decide } from '../approvals';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { toolEnv } from '../routes/agents';
import { getStore } from '../stores';

let db: Db;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  createApp(db);
});

const PAGES: Record<string, FetchedSource> = {
  'https://a.test/hooks': { url: 'https://a.test/hooks', status: 'read', title: 'Hook study', text: 'Problem-first hooks held 3-second views 40% longer.' },
  'https://b.test/hooks': { url: 'https://b.test/hooks', status: 'read', title: 'Hook guide', text: 'Lead with the problem.' },
  'https://c.test/paid': { url: 'https://c.test/paid', status: 'paywalled', error: 'The page is behind a paywall' },
};
const call = (name: string, args: unknown, ctx: ToolContext) => callTool(APP_TOOLS.find((t) => t.name === name)!, args, ctx).then((r) => r.output);
/** A tool context for a run of `storeId`'s Market Analyst; with `research`, a stage of a research task into `research`. */
function context(storeId = 'pawsome', research?: { ws: KbWorkspace; categoryId?: string }) {
  const task = research && createResearchTask(db, { ...research, payerId: storeId, role: 'market_analyst', kind: 'topic', origin: 'owner', objective: 'TikTok hooks', budgetUsd: 1 });
  const runId = randomUUID();
  db.prepare(`INSERT INTO agent_runs (id, store_id, agent_id, task, status, mode, created_at) VALUES (?, ?, ?, 'A task', 'running', ?, ?)`).run(
    runId, storeId, `${storeId}:market_analyst`, task ? `research:${task.id}` : null, new Date().toISOString(),
  );
  const ctx = { ...toolEnv(db), runId, store: getStore(db, storeId)!, agent: getAgent(db, `${storeId}:market_analyst`)!, emit: () => {}, kbFetch: async (url: string) => PAGES[url] ?? { url, status: 'failed', error: 'Not found' } } as ToolContext;
  return { ctx, task, runId };
}
const read = (ws: KbWorkspace, url: string) => saveSource(db, ws, { kind: 'url', url, title: PAGES[url]!.title ?? '', status: PAGES[url]!.status, text: PAGES[url]!.text, error: PAGES[url]!.error, fetchedAt: new Date().toISOString() }).id;
const card = (ws: KbWorkspace, title: string, more: Partial<Parameters<typeof createCard>[2]> = {}) =>
  createCard(db, ws, { categoryId: ensureCategoryPath(db, ws, ['Advertising']), title, summary: `${title}, in short`, type: 'strategy', stage: 'hypothesis', status: 'active', authorId: 'owner', origin: 'owner', ...more });
const PROPOSAL = { title: 'Open TikTok ads on the problem', summary: 'Problem-first hooks hold viewers past 3 seconds', type: 'strategy', path: ['Advertising', 'TikTok', 'Hooks'], evidence: 'Held 3-second views 40% longer across 200 pet ads.' };

describe('KB agent tools', () => {
  test('research runs get the research tools; every role gets search_knowledge, recommend_research and propose_general, and no research-only tool, otherwise', () => {
    expect(runTools('copywriter', 'research').map((t) => t.name).sort()).toEqual(['add_evidence', 'fetch_source', 'propose_card', 'search_knowledge', 'suggest_link']);
    for (const role of Object.keys(AGENT_ROLES) as AgentRole[]) {
      const names = runTools(role).map((t) => t.name);
      expect(names, role).toEqual(expect.arrayContaining(['search_knowledge', 'recommend_research', 'propose_general']));
      expect(names.filter((n) => RESEARCH_TOOLS.includes(n) && n !== 'search_knowledge'), role).toEqual([]);
    }
  });

  test('fetch_source reads through the safe reader into the research task, and says so when a page could not be read', async () => {
    const { ctx, task } = context('pawsome', { ws: 'pawsome' });
    const out = await call('fetch_source', { url: 'https://a.test/hooks' }, ctx);
    const [, id] = out.match(/^Source (\S+): "Hook study"/) ?? [];
    expect(id).toBeTruthy();
    expect(out).toMatch(/<<<SOURCE [0-9a-f]{8}: untrusted data[\s\S]*> Problem-first hooks held/);
    expect(await call('fetch_source', { url: 'https://c.test/paid' }, ctx)).toMatch(/was not read \(paywalled\)[\s\S]*Don't cite it/);
    expect(getResearchTask(db, task!.id)!.sources.map((s) => [s.id === id, s.status])).toEqual([[true, 'read'], [false, 'paywalled']]);
    expect(db.prepare('SELECT store_id FROM kb_sources WHERE id = ?').get(id!)).toEqual({ store_id: 'pawsome' });
    expect(await call('fetch_source', { url: 'https://a.test/hooks' }, context().ctx)).toBe('Reading sources is only available in research.');
    expect(toolEnv(db).kbFetch).toBeTypeOf('function'); // the app's runs read through the KB-11 reader
    // Only a web address: anything else is never fetched or kept as a source.
    const before = db.prepare('SELECT count(*) AS n FROM kb_sources').get()!.n;
    for (const url of ['javascript:alert(1)', 'file:///C:/Windows/notepad.exe']) expect(await call('fetch_source', { url }, ctx)).toMatch(/http or https/);
    expect(db.prepare('SELECT count(*) AS n FROM kb_sources').get()!.n).toBe(before);
  });

  test("propose_card files a proposed card that its read sources move up the ladder; forbidden types and stages, and unread sources, are refused", async () => {
    const { ctx, task } = context('pawsome', { ws: 'pawsome' });
    const [a, b, paid] = [read('pawsome', 'https://a.test/hooks'), read('pawsome', 'https://b.test/hooks'), read('pawsome', 'https://c.test/paid')];
    expect(await call('propose_card', { ...PROPOSAL, type: 'validated_insight', sources: [a] }, ctx)).toMatch(/^Not filed: type validated_insight/);
    expect(await call('propose_card', { ...PROPOSAL, stage: 'tested', sources: [a] }, ctx)).toMatch(/^Not filed: stage must be hypothesis or supported/);
    expect(await call('propose_card', { ...PROPOSAL, sources: [a, paid] }, ctx)).toBe(`Not filed: source ${paid} was not read (paywalled). Cite only sources you read.`);
    expect(await call('propose_card', { ...PROPOSAL, sources: ['nope'] }, ctx)).toBe('Not filed: no source nope in this research. Read it with fetch_source first.');
    expect(db.prepare('SELECT count(*) AS n FROM kb_cards').get()!.n).toBe(0);

    const out = await call('propose_card', { ...PROPOSAL, stage: 'supported', sources: [a, b] }, ctx);
    const c = getCard(db, out.match(/\(([0-9a-f-]{36})\)/)![1]!)!;
    expect(out).toBe(`Filed "${c.title}" (${c.id}) for the owner's review, at Research-Supported.`);
    expect(c).toMatchObject({ storeId: 'pawsome', status: 'proposed', stage: 'supported', type: 'strategy', origin: 'research', authorId: 'pawsome:market_analyst', taskId: task!.id, path: ['Advertising', 'TikTok', 'Hooks'] });
    expect(listEvidence(db, c.id).map((e) => [e.kind, e.source?.title, e.text])).toEqual([['research', 'Hook study', PROPOSAL.evidence], ['research', 'Hook guide', PROPOSAL.evidence]]);
    // One source, and not a reliable one: a Hypothesis, whatever it asked for.
    const one = await call('propose_card', { ...PROPOSAL, title: 'Rescue stories lift CTR', summary: 'Rescue arcs earn clicks from dog owners', stage: 'supported', sources: [a] }, ctx);
    expect(one).toMatch(/for the owner's review, at Hypothesis\.$/);
    // It starts at Hypothesis and only moves up: no "moved down" from the stage it asked for.
    expect(listRevisions(db, one.match(/\(([0-9a-f-]{36})\)/)![1]!).map((r) => r.reason)).not.toContainEqual(expect.stringMatching(/Moved down/));
    // A task given a category files there, whatever path the agent gave.
    const inbox = ensureCategoryPath(db, 'pawsome', ['Research inbox']);
    const filedTo = await call('propose_card', { ...PROPOSAL, title: 'Captions in the first frame', summary: 'Burned-in captions hold silent viewers', sources: [a] }, context('pawsome', { ws: 'pawsome', categoryId: inbox }).ctx);
    expect(getCard(db, filedTo.match(/\(([0-9a-f-]{36})\)/)![1]!)!.categoryId).toBe(inbox);
  });

  test("propose_card adds to a card that already says it, leaving the owner's words alone, and leaves one the owner archived", async () => {
    const { ctx } = context('pawsome', { ws: 'pawsome' });
    const a = read('pawsome', 'https://a.test/hooks');
    const mine = card('pawsome', PROPOSAL.title, { summary: 'My own words', body: 'My notes', stage: 'hypothesis' });
    expect(await call('propose_card', { ...PROPOSAL, sources: [a] }, ctx)).toBe(`Already in the knowledge base: added your evidence to "${PROPOSAL.title}" (${mine.id}), now Hypothesis.`);
    expect(getCard(db, mine.id)).toMatchObject({ summary: 'My own words', body: 'My notes', status: 'active', authorId: 'owner' });
    expect(listEvidence(db, mine.id)).toHaveLength(1);
    card('pawsome', 'Rescue stories lift CTR', { status: 'archived' });
    expect(await call('propose_card', { ...PROPOSAL, title: 'Rescue stories lift CTR', sources: [a] }, ctx)).toBe('Not filed: the owner archived or rejected a card that says this ("Rescue stories lift CTR"). Leave it.');
    expect(db.prepare('SELECT count(*) AS n FROM kb_cards').get()!.n).toBe(2);
  });

  test("add_evidence adds read sources to a live card in the research's workspace; evidence against opens a conflict; an owner-set stage stays", async () => {
    const { ctx } = context('pawsome', { ws: 'pawsome' });
    const [a, b] = [read('pawsome', 'https://a.test/hooks'), read('pawsome', 'https://b.test/hooks')];
    const c = card('pawsome', 'Discounts beat free shipping');
    const out = await call('add_evidence', { card: c.id, text: 'Two studies back it.', sources: [a, b] }, ctx);
    expect(out).toBe(`Added to "Discounts beat free shipping": now Research-Supported.`);
    expect(await call('add_evidence', { card: c.id, text: 'A third says the opposite.', sources: [a], against: true }, ctx)).toBe(
      'Added to "Discounts beat free shipping": now Hypothesis. A conflict is open for the owner.',
    );
    expect(db.prepare(`SELECT count(*) AS n FROM kb_conflicts WHERE card_id = ? AND status = 'open'`).get(c.id)!.n).toBe(1);
    const held = card('pawsome', 'Owner says tested', { stage: 'tested', stageByOwner: true });
    expect(await call('add_evidence', { card: held.id, text: 'Two studies back it.', sources: [a, b] }, ctx)).toBe('Added to "Owner says tested": now Experimentally Tested.');
    const elsewhere = card('glow', 'Glow note');
    expect(await call('add_evidence', { card: elsewhere.id, text: 'Two studies back it.', sources: [a] }, ctx)).toBe(`No card ${elsewhere.id} here. Use search_knowledge for ids.`);
    const paid = read('pawsome', 'https://c.test/paid');
    expect(await call('add_evidence', { card: c.id, text: 'Two studies back it.', sources: [paid] }, ctx)).toBe(`Not added: source ${paid} was not read (paywalled). Cite only sources you read.`);
    const gone = card('pawsome', 'Old idea', { status: 'archived' });
    expect(await call('add_evidence', { card: gone.id, text: 'Two studies back it.', sources: [a] }, ctx)).toBe('"Old idea" is archived: leave it.');
  });

  test('suggest_link suggests a link for the owner, never one they rejected or one already there', async () => {
    const { ctx } = context('pawsome', { ws: 'pawsome' });
    // Unrelated titles: createCard suggests links between similar ones by itself.
    const [x, y, z] = [card('pawsome', 'Problem-first hooks'), card('pawsome', 'Bundles raise order value'), card(null, 'Shipping times matter')];
    const why = 'Both are about the first seconds of an ad.';
    expect(await call('suggest_link', { from: x.id, to: y.id, type: 'supports', why }, ctx)).toBe('Suggested: "Problem-first hooks" supports "Bundles raise order value", for the owner to accept.');
    expect(listLinks(db, 'pawsome')).toMatchObject([{ fromId: x.id, toId: y.id, type: 'supports', status: 'suggested', authorId: 'pawsome:market_analyst' }]);
    expect(await call('suggest_link', { from: y.id, to: x.id, type: 'related_to', why }, ctx)).toBe('Those cards are already linked.');
    decideLink(db, createLink(db, 'pawsome', { from: x.id, to: z.id, type: 'related_to', why, authorId: 'pawsome:market_analyst', status: 'suggested' }).id, 'rejected');
    expect(await call('suggest_link', { from: z.id, to: x.id, type: 'builds_upon', why }, ctx)).toBe('The owner rejected a link between those cards: leave it.');
    expect(await call('suggest_link', { from: x.id, to: x.id, type: 'related_to', why }, ctx)).toBe("A card can't link to itself.");
    expect(await call('suggest_link', { from: x.id, to: card('glow', 'Glow note').id, type: 'related_to', why }, ctx)).toMatch(/^No card \S+ here/);
  });

  test("search_knowledge finds the store's and General's accepted cards, never another store's, unreviewed, archived or blocked ones; hypotheses are labelled", async () => {
    card('pawsome', 'TikTok hooks for dog gear', { stage: 'supported' });
    card(null, 'TikTok hooks in general');
    card('glow', 'TikTok hooks for skincare');
    card('pawsome', 'TikTok hooks unreviewed', { status: 'proposed' });
    card('pawsome', 'TikTok hooks archived', { status: 'archived' });
    db.prepare(`UPDATE kb_cards SET blocked_roles = '["market_analyst"]' WHERE id = ?`).run(card('pawsome', 'TikTok hooks blocked').id);
    const out = await call('search_knowledge', { query: 'tiktok hooks' }, context().ctx);
    expect(out.split('\n')[0]).toBe('id,title,stage,type,where,summary');
    expect(out).toContain('TikTok hooks for dog gear,Research-Supported,strategy,this store');
    expect(out).toContain('TikTok hooks in general,Hypothesis (unproven),strategy,General');
    for (const hidden of ['skincare', 'unreviewed', 'archived', 'blocked']) expect(out).not.toContain(hidden);
    // Research into General reads General only.
    const general = await call('search_knowledge', { query: 'tiktok hooks' }, context('pawsome', { ws: null }).ctx);
    expect(general).toContain('TikTok hooks in general');
    expect(general).not.toContain('dog gear');
    expect(await call('search_knowledge', { query: 'nothing like this' }, context().ctx)).toBe('(none)');
  });

  test('recommend_research asks the owner; approving starts the research, paid by the store, with the agent as its origin', async () => {
    const asked = () => db.prepare(`SELECT id, title, reason, action_json FROM approvals WHERE status = 'pending' AND json_extract(action_json, '$.kind') = 'kb.research'`).all();
    const ask = { objective: 'Which TikTok hooks work for dog travel gear?', why: 'Our TikTok CTR fell 30% this month.', lookFor: 'hooks with numbers', budgetUsd: 1.5 };
    const pending = call('recommend_research', ask, context().ctx);
    await vi.waitFor(() => expect(asked()).toHaveLength(1));
    const [a] = asked();
    expect(a).toMatchObject({ title: `Research: ${ask.objective}`, reason: `${ask.why} Up to $1.50 of AI usage.` });
    expect(JSON.parse(String(a!.action_json))).toEqual({ kind: 'kb.research', payload: { ws: 'pawsome', role: 'market_analyst', objective: ask.objective, brief: { lookFor: ask.lookFor }, budgetUsd: 1.5 } });
    expect(await call('recommend_research', ask, context().ctx)).toBe('Already waiting for the owner: the same research was recommended.');
    decide(db, String(a!.id), 'approve');
    expect(await pending).toBe(`Approved by the owner: Research: ${ask.objective}. It's queued and runs on its own; its cards come to the owner for review.`);
    await vi.waitFor(() => expect(db.prepare('SELECT store_id, payer_id, role, kind, origin, objective, budget_usd, status FROM kb_tasks').all()).toEqual([
      // It fails at once here: tests have no Claude.
      { store_id: 'pawsome', payer_id: 'pawsome', role: 'market_analyst', kind: 'topic', origin: 'agent', objective: ask.objective, budget_usd: 1.5, status: 'failed' },
    ]));
    // A failed task may be asked again; one done or under way isn't.
    void call('recommend_research', ask, context().ctx);
    await vi.waitFor(() => expect(asked()).toHaveLength(1));
    decide(db, String(asked()[0]!.id), 'deny');
    db.prepare(`UPDATE kb_tasks SET status = 'done'`).run();
    expect(await call('recommend_research', ask, context().ctx)).toBe('Already researched, or under way: search_knowledge has what it found.');
    // What holds across stores goes to General.
    void call('recommend_research', { ...ask, objective: 'What holds across all pet stores?', general: true }, context().ctx);
    await vi.waitFor(() => expect(asked().map((r) => JSON.parse(String(r.action_json)).payload.ws)).toEqual([null]));
    decide(db, String(asked()[0]!.id), 'approve');
    await vi.waitFor(() => expect(db.prepare(`SELECT store_id, payer_id FROM kb_tasks WHERE objective LIKE 'What holds%'`).get()).toEqual({ store_id: null, payer_id: 'pawsome' }));
    updateAgent(db, 'pawsome:market_analyst', { autonomy: 'suggest' });
    expect(await call('recommend_research', { ...ask, objective: 'Another question entirely?' }, context().ctx)).toMatch(/^Not sent: your autonomy is "suggest"/);
  });

describe("the workspace's research controls (KB-22)", () => {
  const controls = (ws: KbWorkspace, settings: object) =>
    db.prepare(`INSERT INTO kb_controls (store_id, settings_json, updated_at) VALUES (?, ?, ?)`).run(ws, JSON.stringify(settings), new Date().toISOString());

  test("fetch_source passes the workspace's blocked domains to the safe reader", async () => {
    controls('pawsome', { blockedDomains: ['reddit.com'] });
    const { ctx } = context('pawsome', { ws: 'pawsome' });
    const kbFetch = vi.fn(async (url: string) => ({ url, status: 'blocked_domain', error: "reddit.com is on this workspace's blocked list" }) as FetchedSource);
    expect(await call('fetch_source', { url: 'https://www.reddit.com/r/dogs' }, { ...ctx, kbFetch })).toMatch(/was not read \(blocked_domain\)/);
    expect(kbFetch).toHaveBeenCalledWith('https://www.reddit.com/r/dogs', { blocked: ['reddit.com'] });
  });

  test('with review off, propose_card files an accepted card', async () => {
    controls('pawsome', { review: false });
    const { ctx } = context('pawsome', { ws: 'pawsome' });
    const out = await call('propose_card', { ...PROPOSAL, sources: [read('pawsome', 'https://a.test/hooks')] }, ctx);
    expect(out).toMatch(/^Filed "Open TikTok ads on the problem" \([0-9a-f-]{36}\), accepted \(this workspace doesn't review research\), at Hypothesis\.$/);
    expect(getCard(db, out.match(/\(([0-9a-f-]{36})\)/)![1]!)!.status).toBe('active');
  });
});
});
