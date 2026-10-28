// KB-26: the owner's end-to-end workflow (spec §17) on the fake engine, from a research request to agents using what the
// store's own results taught.
import {
  advanceResearch, createCard, createResearchTask, createRunManager, ensureCategoryPath, fakeEngine, getCard, getResearchTask, listEvidence, listLinks, type FakeStep,
  type ResearchDeps, type RunInput,
} from '@frontline/agents';
import type { KbCard } from '@frontline/shared';
import { beforeEach, expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { decide } from '../approvals';
import { addDays } from '../dates';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { toolEnv } from '../routes/agents';
import { getStore } from '../stores';
import { learnFromPerformance } from './performance';

let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  app = createApp(db);
});

const done: FakeStep = { type: 'done', sessionId: 's', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } };
const answer = (o: unknown): FakeStep[] => [{ type: 'text_delta', text: `Here it is.\n\n\`\`\`json\n${JSON.stringify(o)}\n\`\`\`` }, done];
const stageOf = (task: string) => task.match(/^Research task \S+, step (\w+)/)?.[1];
const score = { reliability: 4, evidence: 4, relevance: 5, recency: 4, agreement: 4, usefulness: 5, novelty: 3, applicability: 5, contradictions: [] };
const VIDEO = ['Advertising', 'Creative Strategy', 'Video Hooks'];
const AUDIENCE = ['Advertising', 'Targeting', 'Audience Research'];
const MOTIVES = ['Marketing', 'Consumer Psychology', 'Purchase Motivations'];
const OUT: Record<string, unknown> = {
  planning: { scope: 'Advertising that works for dog travel gear', questions: ['Which hooks, audiences and reasons to buy work?'], queries: ['dog travel gear ad hooks'] },
  discovering: {
    sources: [
      { url: 'https://ads.test/pet-hooks', why: 'A case study of 120 pet ads' },
      { url: 'https://platform.test/lookalikes', why: "The ad platform's audience guide" },
      { url: 'https://research.test/why-owners-buy', why: 'A survey of dog owners' },
    ],
  },
  analyzing: {
    findings: [
      { claim: 'Problem-first hooks hold viewers past 3 seconds', sources: [1] },
      { claim: "Opening on the dog's reaction lifts click-through", detail: 'CTR 1.9% vs 1.2% across 120 pet ads.', sources: [1] },
      { claim: 'Lookalikes of past buyers beat interest targeting', sources: [2] },
      { claim: 'Owners buy travel gear so their dog rides calm and safe', sources: [3] },
    ],
    contradictions: [],
  },
  evaluating: { assessments: [1, 2, 3, 4].map((finding) => ({ finding, ...score, keep: true, why: 'Read and specific' })) },
  extracting: {
    cards: [
      { finding: 1, title: 'Problem-first hooks hold viewers past 3 seconds', summary: 'Open on the problem the gear solves', type: 'strategy', path: VIDEO },
      { finding: 2, title: "Open video ads on the dog's reaction", summary: 'A dog reacting in the first second lifts click-through', type: 'research_finding', path: VIDEO },
      { finding: 3, title: 'Lookalikes of past buyers beat interest targeting', summary: 'Audiences built from buyers convert better than interests', type: 'customer_insight', path: AUDIENCE },
      { finding: 4, title: 'Owners buy so their dog rides calm and safe', summary: 'Safety and calm, not style, move dog owners to buy travel gear', type: 'customer_insight', path: MOTIVES },
    ],
  },
  reporting: { summary: 'Lead with the dog, target past buyers, sell calm and safety.', conclusions: ['Reaction hooks win'], unresolved: ['Does it hold for cats?'], limitations: ['Three sources'], applications: ['Brief the Creative Strategist'] },
};
const PAGES: Record<string, object> = {
  'https://ads.test/pet-hooks': { status: 'read', title: 'Pet ad hooks: 120 ads compared', text: "Problem-first hooks held viewers. Opening on the dog's reaction lifted CTR to 1.9% from 1.2%." },
  'https://platform.test/lookalikes': { status: 'read', title: 'Lookalike audiences', text: 'Lookalikes of past buyers outperform interest targeting.' },
  'https://research.test/why-owners-buy': { status: 'read', title: 'Why dog owners buy travel gear', text: 'Owners buy travel gear so their dog rides calm and safe.' },
};

// Steps 8-9: the store's settled 28-day periods (performance.test.ts) as of `today`.
const today = '2026-10-27';
const PERIODS = [{ from: '2026-07-13' }, { from: '2026-08-10' }];
function campaign(id: string, name: string, roas: number) {
  db.prepare(`INSERT INTO campaigns (network, id, store_id, name, status, daily_budget) VALUES ('meta', ?, 'pawsome', ?, 'active', 50)`).run(id, name);
  const day = db.prepare(`INSERT INTO campaign_daily (network, campaign_id, date, spend, revenue, purchases, clicks, impressions) VALUES ('meta', ?, ?, 100, ?, ?, 1000, 50000)`);
  for (const p of PERIODS) for (let i = 0; i < 28; i++) day.run(id, addDays(p.from, i), 100 * roas, i % 7 < 2 ? 3 : 2); // 64 purchases a period
}

test("§17: research to cards under the exact paths, linked, used by the Creative Strategist, launched only with approval, and the store's results fed back", async () => {
  // Before: what the owner already knows. The store's Ad Strategist is its advertising research agent.
  const known = createCard(db, 'pawsome', { categoryId: ensureCategoryPath(db, 'pawsome', VIDEO), title: 'Problem-first hooks hold viewers past 3 seconds', summary: 'Open on the problem the gear solves', type: 'strategy', stage: 'hypothesis', status: 'active', authorId: 'owner', origin: 'owner' });
  const general = createCard(db, null, { categoryId: ensureCategoryPath(db, null, ['Advertising']), title: 'Pain beats gain in video hooks', summary: 'Loss-framed openings hold viewers better', type: 'business_principle', stage: 'supported', status: 'active', authorId: 'owner', origin: 'owner' });

  const prompts: RunInput[] = [];
  const m = createRunManager({
    db, env: toolEnv(db), store: (id) => getStore(db, id),
    engine: fakeEngine((input) => {
      prompts.push(input);
      const stage = stageOf(input.task);
      if (stage) return answer(OUT[stage]);
      if (input.agent.role === 'creative_studio') {
        const cite = input.systemPrompt?.match(/(\[kb:[\w-]+\]) Open video ads on the dog's reaction/)?.[1];
        return [{ type: 'text_delta', text: `Concept 1: open on the dog's reaction ${cite}. Concept 2: sell the calm ride.` }, done];
      }
      if (input.task.startsWith('Pause')) return [{ call: 'propose_ad_change', input: { campaignId: 'broad', change: 'pause', evidence: 'ROAS 1.5 vs 3.0 on the reaction campaign, 60 purchases each' } }, done];
      return [{ type: 'text_delta', text: 'Planned.' }, done];
    }),
  });
  const deps: ResearchDeps = { start: m.start, fetch: async (url) => ({ url, status: 'failed', error: 'Not found', ...PAGES[url] }) as never, engineAvailable: () => true, now: () => new Date() };

  // 1. Research request.
  const task = createResearchTask(db, { ws: 'pawsome', payerId: 'pawsome', role: 'ad_strategist', kind: 'topic', origin: 'owner', objective: 'Research advertising strategies that are working for this niche.', budgetUsd: 2 });
  // 2-3. Research execution and knowledge extraction: each stage once, the sources read, the known finding checked against.
  for (let i = 0; i < 40; i++) {
    await m.idle();
    if (!(await advanceResearch(db, deps)).length) break;
  }
  const t = getResearchTask(db, task.id)!;
  expect(t.status).toBe('done');
  expect(t.sources.map((s) => [s.title, s.status])).toEqual([
    ['Pet ad hooks: 120 ads compared', 'read'],
    ['Lookalike audiences', 'read'],
    ['Why dog owners buy travel gear', 'read'],
  ]);
  expect(listEvidence(db, known.id).map((e) => [e.kind, e.source?.title])).toEqual([['research', 'Pet ad hooks: 120 ads compared']]); // no duplicate card

  // 4. Knowledge organization: cards under the business, at exactly these paths, each backed by what it read.
  const filed = db.prepare(`SELECT id FROM kb_cards WHERE store_id = 'pawsome' AND origin = 'research' ORDER BY title`).all().map((r) => getCard(db, String(r.id))!);
  expect(filed.map((c) => [c.title, c.path, c.status])).toEqual([
    ['Lookalikes of past buyers beat interest targeting', AUDIENCE, 'proposed'],
    ["Open video ads on the dog's reaction", VIDEO, 'proposed'],
    ['Owners buy so their dog rides calm and safe', MOTIVES, 'proposed'],
  ]);
  for (const c of filed) expect(listEvidence(db, c.id).some((e) => e.kind === 'research' && e.source?.status === 'read')).toBe(true);

  // 5. Relationships: proposed by the app, and on the artboard with the new cards.
  const reaction = filed[1]!;
  const links = listLinks(db, 'pawsome').filter((l) => l.authorId === 'app');
  expect(links.some((l) => l.status === 'suggested' && [l.fromId, l.toId].sort().join() === [reaction.id, known.id].sort().join())).toBe(true);
  const board = (await (await app.request('/api/kb/cards?ws=pawsome&general=1')).json()) as { items: KbCard[] };
  expect(board.items.map((c) => c.id)).toEqual(expect.arrayContaining([...filed.map((c) => c.id), known.id, general.id]));
  expect(((await (await app.request('/api/kb/links?ws=pawsome&general=1')).json()) as { id: string }[]).map((l) => l.id)).toEqual(expect.arrayContaining(links.map((l) => l.id)));
  // The owner accepts the findings.
  expect((await app.request('/api/kb/cards/bulk', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ws: 'pawsome', ids: filed.map((c) => c.id), patch: { status: 'active' } }) })).status).toBe(200);

  // 6. Agent knowledge retrieval: the Creative Studio gets the store's findings and General knowledge before it writes.
  const brief = m.start('pawsome:creative_studio', 'Develop advertising concepts for our dog travel gear: video hooks, who to show them to, and why owners buy.');
  expect(typeof brief).toBe('object');
  await m.idle();
  const creative = prompts.find((p) => p.agent.role === 'creative_studio')!.systemPrompt!;
  expect(creative).toContain('# Relevant knowledge');
  for (const c of [reaction, filed[2]!, general]) expect(creative).toContain(`[kb:${c.id}] ${c.title}`);
  expect(getCard(db, reaction.id)!.citedCount).toBe(1); // its answer cited the card

  // 7. Real-world execution: the store is connected; a consequential change waits for the owner, and nothing moves until then.
  db.prepare(`UPDATE stores SET demo = 0, connected = 1 WHERE id = 'pawsome'`).run();
  for (const table of ['daily_metrics', 'campaigns', 'orders', 'products']) db.prepare(`DELETE FROM ${table} WHERE store_id = 'pawsome'`).run();
  db.prepare(`UPDATE approvals SET status = 'denied' WHERE store_id = 'pawsome' AND status = 'pending'`).run();
  db.prepare(`INSERT INTO integrations (id, kind, store_id, status, encrypted_credentials, updated_at, synced_at) VALUES ('meta_ads:pawsome', 'meta_ads', 'pawsome', 'connected', 'x', ?1, ?1)`).run(`${today}T12:00:00Z`);
  campaign('reaction', 'Dog reaction hooks', 3);
  campaign('broad', 'Broad interests', 1.5);
  m.start('pawsome:ad_strategist', 'Pause what the reaction campaign beats.');
  const asked = await vi.waitFor(() => {
    const a = db.prepare(`SELECT id, title FROM approvals WHERE store_id = 'pawsome' AND status = 'pending'`).get();
    if (!a) throw new Error('no request yet');
    return a;
  });
  expect(db.prepare(`SELECT status FROM campaigns WHERE id = 'broad'`).get()).toEqual({ status: 'active' });
  decide(db, String(asked.id), 'deny');
  await m.idle();
  expect(db.prepare(`SELECT status FROM campaigns WHERE id = 'broad'`).get()).toEqual({ status: 'active' });

  // 8-9. Performance analysis and knowledge feedback: two settled periods of the store's own results become a lesson,
  // with how strong the evidence is.
  learnFromPerformance(db, today);
  const lesson = getCard(db, String(db.prepare(`SELECT id FROM kb_cards WHERE store_id = 'pawsome' AND origin = 'performance' AND title LIKE '%Dog reaction hooks%'`).get()!.id))!;
  expect(lesson).toMatchObject({ type: 'performance_lesson', stage: 'validated', path: ['Advertising', 'Campaign results'] });
  expect(lesson.summary).toBe("ROAS 3.00 vs 1.50 for the store's other Meta campaigns, 2026-07-13 to 2026-08-09: +100% (95% range +41% to +183%), on 64 purchases.");
  expect(listEvidence(db, lesson.id).map((e) => [e.kind, e.windowFrom])).toEqual(PERIODS.map((p) => ['measured', p.from]));

  // 10. Continuous improvement: a later task gets the store's measured lesson beside the research.
  m.start('pawsome:ad_strategist', "Plan next month's Meta campaigns: which campaigns and hooks should get more budget?");
  await m.idle();
  expect(prompts.at(-1)!.systemPrompt).toContain(`[kb:${lesson.id}] ${lesson.title} (Validated)`);
});
