import { randomUUID } from 'node:crypto';
import { APP_TOOLS, callTool, createCard, createLink, createRunManager, ensureCategoryPath, ftsQuery, getAgent, getCard, retrieveKnowledge, saveSource, addEvidence, type Engine, type ToolContext } from '@frontline/agents';
import type { AgentRole, KbWorkspace } from '@frontline/shared';
import { beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app';
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
const usage = { inputTokens: 1, outputTokens: 1, costUsd: 0.01 };
const card = (ws: KbWorkspace, title: string, more: Partial<Parameters<typeof createCard>[2]> & { path?: string[]; blockedRoles?: readonly string[] } = {}) => {
  const { path = ['Advertising'], blockedRoles, ...rest } = more;
  const c = createCard(db, ws, { categoryId: ensureCategoryPath(db, ws, path), title, summary: `${title}, in short`, type: 'strategy', stage: 'hypothesis', status: 'active', authorId: 'owner', origin: 'owner', ...rest });
  if (blockedRoles) db.prepare('UPDATE kb_cards SET blocked_roles = ? WHERE id = ?').run(JSON.stringify(blockedRoles), c.id);
  return c;
};
const titles = (ws: KbWorkspace, role: AgentRole, query: string, limit = 10) => retrieveKnowledge(db, { ws, role, query, limit }).map((c) => c.title);
const counts = (id: string) => db.prepare('SELECT used_count AS used, cited_count AS cited FROM kb_cards WHERE id = ?').get(id);
const rows = (id: string) => db.prepare('SELECT kind, store_id, agent_id FROM kb_retrievals WHERE card_id = ? ORDER BY id').all(id).map((r) => `${r.kind} ${r.store_id} ${r.agent_id}`);
/** Runs `agentId` on `task` through the run manager; the engine answers `answer` and records the prompt it got. */
async function run(agentId: string, task: string, answer = 'Done.') {
  let prompt = '';
  const engine: Engine = async function* (input) {
    prompt = input.systemPrompt ?? '';
    // In two pieces, as an engine streams it: a citation can be split across them.
    const cut = answer.includes('[kb:') ? answer.indexOf('[kb:') + 5 : 0;
    yield { type: 'text_delta', text: answer.slice(0, cut) };
    yield { type: 'text_delta', text: answer.slice(cut) };
    yield { type: 'done', sessionId: 's', usage };
  };
  const m = createRunManager({ db, env: toolEnv(db), store: (id) => getStore(db, id), engine });
  const r = m.start(agentId, task);
  if (typeof r === 'string') throw new Error(r);
  await m.idle();
  return { prompt, runId: r.id };
}

describe('retrieval in real tasks', () => {
  test('the words of a task, as a keyword query: any of them, common words left out', () => {
    expect(ftsQuery('Which TikTok hooks work for our anxious dogs? TikTok!')).toBe('"which" OR "tiktok" OR "hooks" OR "work" OR "anxious" OR "dogs"');
    expect(ftsQuery('do it for the')).toBeUndefined();
    expect(ftsQuery('"quotes" AND (stars*)')).toBe('"quotes" OR "stars"');
  });

  test("a later task gets the cards an earlier one saved, once accepted: its store's first, then General, hypotheses labelled; never another store's, unreviewed, archived or blocked ones", async () => {
    // What an earlier research task filed: proposed until the owner accepts it.
    const saved = card('pawsome', 'Problem-first hooks win', { summary: 'Open TikTok ads on the anxious dog, not the product.', stage: 'validated', status: 'proposed', origin: 'research' });
    const general = card(null, 'TikTok hooks for anxious dogs decide the first three seconds');
    card('glow', 'TikTok hooks for anxious skin');
    card('pawsome', 'TikTok hooks archived for dogs', { status: 'archived' });
    card('pawsome', 'TikTok hooks blocked for dogs', { blockedRoles: ['ad_strategist'] });
    card('pawsome', 'TikTok hooks nobody may use', { blockedRoles: ['*'] });
    card('pawsome', 'Shipping boxes cost less in bulk');

    let { prompt } = await run('pawsome:ad_strategist', 'TikTok hooks for anxious dogs');
    expect(prompt).toContain('# Relevant knowledge');
    expect(prompt).not.toContain(saved.id);
    db.prepare(`UPDATE kb_cards SET status = 'active' WHERE id = ?`).run(saved.id);

    ({ prompt } = await run('pawsome:ad_strategist', 'TikTok hooks for anxious dogs'));
    const own = prompt.indexOf(`- [kb:${saved.id}] Problem-first hooks win (Validated): Open TikTok ads on the anxious dog, not the product.`);
    const shared = prompt.indexOf(`- [kb:${general.id}] TikTok hooks for anxious dogs decide the first three seconds (Hypothesis, unproven): `);
    // The General card matches more words, and still comes after the store's own.
    expect(own).toBeGreaterThan(-1);
    expect(shared).toBeGreaterThan(own);
    expect(prompt.slice(own - 40, own)).toContain('This store:');
    expect(prompt.slice(own, shared)).toContain("General (holds across the owner's stores):");
    for (const hidden of ['skin', 'archived', 'blocked', 'nobody', 'Shipping boxes']) expect(prompt).not.toContain(hidden);
    // After the fixed layers and the store's memory, before the date.
    expect(prompt.indexOf('# Relevant knowledge')).toBeGreaterThan(prompt.indexOf('# Store profile'));
    expect(prompt.indexOf('Today is')).toBeGreaterThan(prompt.indexOf('# Relevant knowledge'));

    // Another role may see the blocked card; a task with nothing to match gets no section.
    expect((await run('pawsome:market_analyst', 'TikTok hooks for anxious dogs')).prompt).toContain('TikTok hooks blocked for dogs');
    expect((await run('pawsome:ad_strategist', 'Daily briefing')).prompt).not.toContain('# Relevant knowledge');
  });

  test('ranking: relevance, then stage, recency, the role’s own areas, use, reliable sources and linked cards', () => {
    const same = (title: string, more: Parameters<typeof card>[2] = {}) => card('pawsome', title, { summary: 'Bundles lift order value', ...more });
    // Stage: the same words, Validated first (made second, so it isn't first by chance).
    same('Bundles B');
    same('Bundles A', { stage: 'validated' });
    expect(titles('pawsome', 'operations', 'bundles order value')).toEqual(['Bundles A', 'Bundles B']);
    db.prepare('DELETE FROM kb_cards').run();

    // Recency: touched this month first.
    const old = same('Bundles old');
    same('Bundles new');
    db.prepare(`UPDATE kb_cards SET updated_at = '2025-01-01T00:00:00.000Z' WHERE id = ?`).run(old.id);
    expect(titles('pawsome', 'operations', 'bundles order value')).toEqual(['Bundles new', 'Bundles old']);
    db.prepare('DELETE FROM kb_cards').run();

    // Role: an Email & SMS agent gets the email card first, an Ad Strategist the advertising one.
    same('Bundles ads', { path: ['Advertising'] });
    same('Bundles email', { path: ['Retention', 'Email flows'] });
    expect(titles('pawsome', 'ad_strategist', 'bundles order value')).toEqual(['Bundles ads', 'Bundles email']);
    expect(titles('pawsome', 'email_sms', 'bundles order value')).toEqual(['Bundles email', 'Bundles ads']);
    db.prepare('DELETE FROM kb_cards').run();

    // Use: a citation counts twice what a retrieval does.
    const used = same('Bundles used');
    const cited = same('Bundles cited');
    db.prepare('UPDATE kb_cards SET used_count = 2 WHERE id = ?').run(used.id);
    db.prepare('UPDATE kb_cards SET cited_count = 2 WHERE id = ?').run(cited.id);
    expect(titles('pawsome', 'operations', 'bundles order value')).toEqual(['Bundles cited', 'Bundles used']);
    db.prepare('DELETE FROM kb_cards').run();

    // Reliable sources: backed by platform docs that were read first, not ones behind a paywall (both Supported, so the stage doesn't decide it).
    const unread = same('Bundles paywalled', { stage: 'supported', stageByOwner: true });
    const backed = same('Bundles documented');
    for (const [c, status] of [[unread, 'paywalled'], [backed, 'read']] as const) {
      const src = saveSource(db, 'pawsome', { kind: 'url', url: `https://docs.test/${status}`, title: 'Bundles docs', status, text: 'Bundles lift order value.', fetchedAt: new Date().toISOString() });
      db.prepare(`UPDATE kb_sources SET reliability = 'platform_docs' WHERE id = ?`).run(src.id);
      addEvidence(db, c.id, { kind: 'research', text: 'The docs say so.', sourceId: src.id, authorId: 'owner' });
    }
    expect(titles('pawsome', 'operations', 'bundles order value')).toEqual(['Bundles documented', 'Bundles paywalled']);
    db.prepare('DELETE FROM kb_cards').run();

    // Linked: a card confirmed as linked to a top match comes along, though it shares no word; a suggested link doesn't.
    const top = same('Bundles win');
    const why = card('pawsome', 'Three-packs feel like a deal', { summary: 'Shoppers read a 3-pack as savings' });
    const maybe = card('pawsome', 'Gift wrap sells', { summary: 'Wrapped items sell at holidays' });
    createLink(db, 'pawsome', { from: top.id, to: why.id, type: 'supports', why: 'Same test', authorId: 'owner', status: 'confirmed' });
    createLink(db, 'pawsome', { from: top.id, to: maybe.id, type: 'related_to', why: 'Maybe', authorId: 'app', status: 'suggested' });
    // Nor an archived card, or one the role may not use, however linked.
    for (const [title, more] of [['Gone', { status: 'archived' as const }], ['Hidden', { blockedRoles: ['operations'] }]] as const) {
      const c = card('pawsome', title, { summary: 'Not for this agent', ...more });
      createLink(db, 'pawsome', { from: c.id, to: top.id, type: 'related_to', why: 'Same test', authorId: 'owner', status: 'confirmed' });
    }
    expect(titles('pawsome', 'operations', 'bundles order value')).toEqual(['Bundles win', 'Three-packs feel like a deal']);
    // At most `limit`.
    expect(titles('pawsome', 'operations', 'bundles order value', 1)).toEqual(['Bundles win']);
  });

  test('a card named as [kb:<id>] in the task comes first, sharing a word or not, if the agent may use it', async () => {
    const named = card('pawsome', 'Shipping boxes cost less in bulk');
    const general = card(null, 'Gift notes lift reviews');
    const hooks = card('pawsome', 'Problem-first hooks win');
    const gone = card('pawsome', 'Old idea', { status: 'archived' });
    const blocked = card('pawsome', 'Secret margin', { blockedRoles: ['ad_strategist'] });
    const other = card('glow', 'Glow secret');
    expect(retrieveKnowledge(db, { ws: 'pawsome', role: 'ad_strategist', query: `Use [kb:${named.id}] for our hooks`, limit: 2 }).map((c) => c.title)).toEqual(['Shipping boxes cost less in bulk', 'Problem-first hooks win']);
    // No other words needed; General ones too, after the store's own. Named twice, or matching too, it still comes once.
    expect(titles('pawsome', 'ad_strategist', `[kb:${general.id}] [kb:${named.id}]`)).toEqual(['Shipping boxes cost less in bulk', 'Gift notes lift reviews']);
    expect(titles('pawsome', 'ad_strategist', `[kb:${named.id}] [kb:${named.id}] shipping boxes`)).toEqual(['Shipping boxes cost less in bulk']);
    expect(titles('pawsome', 'ad_strategist', `[kb:${gone.id}] [kb:${blocked.id}] [kb:${other.id}] [kb:made-up]`)).toEqual([]);
    const { prompt } = await run('pawsome:ad_strategist', `Use [kb:${named.id}] to plan the week`);
    expect(prompt).toContain(`- [kb:${named.id}] Shipping boxes cost less in bulk (Hypothesis, unproven)`);
    expect(prompt).not.toContain(hooks.id);
  });

  test("search_knowledge ranks the same way and logs what it returned; each card counts once per run however often it's retrieved", async () => {
    const a = card('pawsome', 'TikTok hooks for dog gear', { stage: 'supported' });
    const b = card(null, 'TikTok hooks in general', { stage: 'validated' }); // the better match, still after the store's own
    const runId = randomUUID();
    db.prepare(`INSERT INTO agent_runs (id, store_id, agent_id, task, status, created_at) VALUES (?, 'pawsome', 'pawsome:market_analyst', 'A task', 'running', ?)`).run(runId, new Date().toISOString());
    const ctx = { ...toolEnv(db), runId, store: getStore(db, 'pawsome')!, agent: getAgent(db, 'pawsome:market_analyst')!, emit: () => {} } as ToolContext;
    const search = (query: string) => callTool(APP_TOOLS.find((t) => t.name === 'search_knowledge')!, { query }, ctx).then((r) => r.output);
    const out = await search('tiktok hooks');
    expect(out.split('\n').slice(2).map((l) => l.split(',')[1])).toEqual(['TikTok hooks for dog gear', 'TikTok hooks in general']); // after the framing line and the header
    await search('hooks');
    expect(rows(a.id)).toEqual(['search pawsome pawsome:market_analyst', 'search pawsome pawsome:market_analyst']);
    expect(counts(a.id)).toEqual({ used: 1, cited: 0 });
    expect(counts(b.id)).toEqual({ used: 1, cited: 0 });
  });

  test('cards the prompt had no room for are not logged as used', async () => {
    const big = Array.from({ length: 8 }, (_, i) => card('pawsome', `Anxious dog hooks ${i}`, { summary: `Anxious dog hooks ${'y'.repeat(6000)}` }));
    const { prompt } = await run('pawsome:ad_strategist', 'Anxious dog hooks');
    const shown = big.filter((c) => prompt.includes(`[kb:${c.id}]`)).length;
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(8);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM kb_retrievals WHERE kind = 'prompt'`).get()).toEqual({ n: shown });
  });

  test('citations: [kb:<id>] in an answer is logged and counted once per run; prompt use counts too; unknown and other stores’ ids are ignored', async () => {
    const a = card('pawsome', 'Problem-first hooks win for anxious dogs');
    const other = card('glow', 'Glow secret');
    const answer = `Lead with the problem [kb:${a.id}]. As [kb:${a.id}] says. Not [kb:${other.id}] or [kb:made-up].`;
    const { runId } = await run('pawsome:ad_strategist', 'Hooks for anxious dogs', answer);
    expect(rows(a.id)).toEqual(['prompt pawsome pawsome:ad_strategist', 'cited pawsome pawsome:ad_strategist']);
    expect(db.prepare('SELECT run_id FROM kb_retrievals WHERE card_id = ?').all(a.id).map((r) => r.run_id)).toEqual([runId, runId]);
    expect(counts(a.id)).toEqual({ used: 1, cited: 1 });
    expect(counts(other.id)).toEqual({ used: 0, cited: 0 });
    await run('pawsome:copywriter', 'Hooks for anxious dogs', `See [kb:${a.id}].`);
    expect(counts(a.id)).toEqual({ used: 2, cited: 2 });
    expect(getCard(db, a.id)).toMatchObject({ usedCount: 2, citedCount: 2 });
  });
});
