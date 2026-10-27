import {
  advanceResearch, cancelResearch, createCard, createResearchTask, createRunManager, ensureCategoryPath, fakeEngine, getCard, getResearchTask, listEvidence, listRuns, refineResearch,
  REFLECTION_PROMPT, retryResearch, writeMemory, type FakeStep, type NewKbTask, type ResearchDeps, type RunInput,
} from '@frontline/agents';
import { KB_TASK_STAGES, type LiveMessage } from '@frontline/shared';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { subscribe } from '../live';
import { advanceKbResearch, runManager, toolEnv } from '../routes/agents';
import { getStore } from '../stores';

let db: Db;
let clock: Date;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  createApp(db);
  clock = new Date();
});

const usage = (costUsd = 0) => ({ inputTokens: 0, outputTokens: 0, costUsd });
const answer = (o: unknown, costUsd = 0): FakeStep[] => [{ type: 'text_delta', text: `Here it is.\n\n\`\`\`json\n${JSON.stringify(o)}\n\`\`\`` }, { type: 'done', sessionId: 's', usage: usage(costUsd) }];
const stageOf = (task: string) => task.match(/^Research task \S+, step (\w+)/)?.[1];
const score = { reliability: 4, evidence: 4, relevance: 5, recency: 4, agreement: 4, usefulness: 5, novelty: 3, applicability: 5, contradictions: [] };
const OUT: Record<string, unknown> = {
  planning: { scope: 'TikTok hooks for a dog travel gear store', questions: ['Which openings hold viewers past 3 seconds?'], queries: ['tiktok ad hooks pet products'] },
  discovering: { sources: [{ url: 'https://a.test/hooks', why: 'A study of 200 ads' }, { url: 'https://b.test/hooks', why: 'A practitioner guide' }, { url: 'https://c.test/paid', why: 'Trade press' }] },
  analyzing: {
    findings: [
      { claim: 'Problem-first hooks hold viewers longer', detail: 'Held 3-second views 40% longer.', sources: [1, 2] },
      { claim: 'Rescue stories lift CTR', sources: [1, 2] },
    ],
    contradictions: [{ text: 'B says offers matter more than hooks', sources: [2] }],
  },
  evaluating: { assessments: [{ finding: 1, ...score, keep: true, why: 'Two sources agree' }, { finding: 2, ...score, evidence: 2, keep: true, why: 'Anecdotes only' }] },
  extracting: {
    cards: [
      { finding: 1, title: 'Open TikTok ads on the problem', summary: 'Problem-first hooks hold viewers past 3 seconds', type: 'strategy', path: ['Advertising', 'TikTok', 'Hooks'], tags: ['tiktok'] },
      { finding: 2, title: 'Rescue stories lift CTR', summary: 'Rescue arcs earn clicks from dog owners', type: 'research_finding', path: ['Advertising', 'TikTok', 'Hooks'] },
    ],
  },
  reporting: { summary: 'Lead with the problem.', conclusions: ['Problem-first hooks win'], unresolved: ['Does it hold for cat gear?'], limitations: ['Two sources'], applications: ['Rewrite the top 3 ads'] },
};
const PAGES: Record<string, object> = {
  'https://a.test/hooks': { status: 'read', title: 'Hook study', text: 'Problem-first hooks held 3-second views 40% longer across 200 pet ads.' },
  'https://b.test/hooks': { status: 'read', title: 'Hook guide', text: 'Lead with the problem. Rescue stories also lift CTR.' },
  'https://c.test/paid': { status: 'paywalled', error: 'The page is behind a paywall' },
};
const TOPIC: NewKbTask = { ws: 'pawsome', payerId: 'pawsome', role: 'market_analyst', kind: 'topic', origin: 'owner', objective: 'TikTok hooks that work for my dog gear store', budgetUsd: 2 };

/** A run manager on the fake engine: each stage answers with `script[stage]`, else its OUT. `seen` has every run's input. */
function setup(script: Record<string, (input: RunInput) => FakeStep[]> = {}, pages = PAGES, more: Partial<ResearchDeps> = {}) {
  const seen: RunInput[] = [];
  const m = createRunManager({
    db, env: toolEnv(db), store: (id) => getStore(db, id),
    engine: fakeEngine((input) => {
      seen.push(input);
      const stage = stageOf(input.task) ?? '';
      return (script[stage] ?? (() => answer(OUT[stage])))(input);
    }),
  });
  const deps: ResearchDeps = { start: m.start, fetch: async (url) => ({ url, status: 'failed', error: 'Not found', ...pages[url] }) as never, engineAvailable: () => true, now: () => clock, ...more };
  /** Lets runs finish and advances, until nothing moves (or a retry waits out its backoff). */
  const settle = async () => {
    for (let i = 0; i < 40; i++) {
      await m.idle();
      if (!(await advanceResearch(db, deps)).length) return;
    }
    throw new Error('research never settled');
  };
  return { m, deps, seen, settle };
}
const runsOf = (taskId: string) => listRuns(db, { limit: 100 }).filter((r) => r.mode === `research:${taskId}`).reverse();
const stagesRun = (taskId: string) => runsOf(taskId).map((r) => stageOf(r.task));

describe('the research runner', () => {
  test('a topic task runs each stage once in order, reads what it can, and stores proposed, source-backed cards with a report', async () => {
    const { seen, settle } = setup({ discovering: () => [{ call: 'store_summary' }, ...answer(OUT.discovering)] });
    const t = createResearchTask(db, TOPIC, clock);
    expect(t).toMatchObject({ status: 'queued', stage: 'created', storeId: 'pawsome', payerId: 'pawsome' });
    await settle();
    const d = getResearchTask(db, t.id)!;
    expect(d).toMatchObject({ status: 'done', stage: 'reporting', spentUsd: 0 });
    expect(d.steps.map((s) => `${s.stage}:${s.status}`)).toEqual(KB_TASK_STAGES.map((s) => `${s}:done`));
    // The agent stages are ordinary runs of the task's agent, in research mode, each naming the task; none reflects.
    expect(stagesRun(t.id)).toEqual(['planning', 'discovering', 'analyzing', 'evaluating', 'extracting', 'reporting']);
    expect(runsOf(t.id).every((r) => r.agentId === 'pawsome:market_analyst' && r.task.includes(t.id))).toBe(true);
    expect(seen.every((i) => i.mode === 'research')).toBe(true);
    expect(seen.some((i) => i.task === REFLECTION_PROMPT)).toBe(false);
    // Retrieving read two sources and kept why the third wasn't; the analyst saw only what was read, fenced as data.
    expect(d.sources.map((s) => [s.url, s.status])).toEqual([['https://a.test/hooks', 'read'], ['https://b.test/hooks', 'read'], ['https://c.test/paid', 'paywalled']]);
    expect(d.log.map((l) => l.message)).toContain("Couldn't read https://c.test/paid: The page is behind a paywall");
    const analyzing = seen.find((i) => stageOf(i.task) === 'analyzing')!.task;
    expect(analyzing).toMatch(/\[S1\] Hook study[\s\S]*<<<SOURCE [0-9a-f]{8}: untrusted data from https:\/\/a\.test\/hooks/);
    expect(analyzing).toContain('> Problem-first hooks held 3-second views');
    expect(analyzing).not.toContain('c.test/paid');
    // Proposed cards under the three-level path, each with its sources as research evidence. Both have two read sources,
    // but the one the evaluation rated weak stays a Hypothesis.
    const cards = db.prepare('SELECT id, title, status, stage, type, origin, author_id FROM kb_cards WHERE task_id = ? ORDER BY title').all(t.id);
    expect(cards).toMatchObject([
      { title: 'Open TikTok ads on the problem', status: 'proposed', stage: 'supported', type: 'strategy', origin: 'research', author_id: 'pawsome:market_analyst' },
      { title: 'Rescue stories lift CTR', status: 'proposed', stage: 'hypothesis', type: 'research_finding', origin: 'research' },
    ]);
    const [hooks, rescue] = cards.map((c) => getCard(db, String(c.id))!);
    expect([hooks!.path, rescue!.path]).toEqual([['Advertising', 'TikTok', 'Hooks'], ['Advertising', 'TikTok', 'Hooks']]);
    expect(listEvidence(db, hooks!.id).map((e) => [e.kind, e.text, e.source?.title])).toEqual([
      ['research', 'Problem-first hooks hold viewers longer: Held 3-second views 40% longer.', 'Hook study'],
      ['research', 'Problem-first hooks hold viewers longer: Held 3-second views 40% longer.', 'Hook guide'],
    ]);
    expect(d.findings.map((f) => [f.title, f.status, f.cardId, f.assessment?.evidence])).toEqual([
      ['Open TikTok ads on the problem', 'stored', hooks!.id, 4],
      ['Rescue stories lift CTR', 'stored', rescue!.id, 2],
    ]);
    expect(d.report).toEqual({
      ...(OUT.reporting as object),
      created: [{ id: hooks!.id, title: hooks!.title }, { id: rescue!.id, title: rescue!.title }],
      updated: [],
      failedSources: [{ url: 'https://c.test/paid', status: 'paywalled', error: 'The page is behind a paywall' }],
      conflicts: ['B says offers matter more than hooks'],
      errors: [],
    });
  });

  test('a source task reads the given link and pasted text with no discovery run; General research gets a store-neutral prompt', async () => {
    writeMemory(db, { storeId: 'pawsome', agentId: 'pawsome:market_analyst', kind: 'fact', text: 'Bundles of three sell best for us', confidence: 0.9 });
    createCard(db, 'pawsome', { categoryId: ensureCategoryPath(db, 'pawsome', ['Advertising']), title: 'Pawsome-only hook note', type: 'strategy', stage: 'hypothesis', status: 'active', authorId: 'owner', origin: 'owner' });
    const { seen, settle } = setup();
    const inbox = ensureCategoryPath(db, null, ['Research inbox']);
    const t = createResearchTask(db, { ...TOPIC, ws: null, kind: 'source', objective: 'What does this guide say about hooks?', brief: { urls: ['https://b.test/hooks'], text: 'Our notes: problem-first openings worked in May.' }, categoryId: inbox }, clock);
    await settle();
    expect(getResearchTask(db, t.id)).toMatchObject({ status: 'done', storeId: null, payerId: 'pawsome' });
    expect(stagesRun(t.id)).toEqual(['planning', 'analyzing', 'evaluating', 'extracting', 'reporting']);
    expect(getResearchTask(db, t.id)!.sources.map((s) => [s.title, s.status])).toEqual([['Hook guide', 'read'], ['Pasted text', 'read']]);
    const planning = seen.find((i) => stageOf(i.task) === 'planning')!;
    expect(planning.systemPrompt).toContain('General knowledge base');
    for (const leak of ['Bundles of three', 'Pawsome Gear', 'dog travel gear', 'Pawsome-only hook note']) expect(`${planning.systemPrompt}\n${planning.task}`).not.toContain(leak);
    expect(db.prepare('SELECT category_id FROM kb_cards WHERE task_id = ? AND store_id IS NULL').all(t.id)).toEqual([{ category_id: inbox }, { category_id: inbox }]);
  });

  test('a card a stage files itself (propose_card) is in the report, and the same card drafted later merges into it', async () => {
    const proposal = { title: 'Open TikTok ads on the problem', summary: 'Problem-first hooks hold viewers past 3 seconds', type: 'strategy', path: ['Advertising'], evidence: 'Held 3-second views 40% longer.' };
    const { settle } = setup({
      analyzing: () => {
        const a = String(db.prepare(`SELECT id FROM kb_sources WHERE url = 'https://a.test/hooks'`).get()!.id);
        return [{ call: 'propose_card', input: { ...proposal, sources: [a] } }, ...answer(OUT.analyzing)];
      },
    });
    const t = createResearchTask(db, TOPIC, clock);
    await settle();
    const d = getResearchTask(db, t.id)!;
    const filed = db.prepare('SELECT id, title FROM kb_cards WHERE task_id = ? ORDER BY rowid').all(t.id);
    expect(filed.map((c) => c.title)).toEqual(['Open TikTok ads on the problem', 'Rescue stories lift CTR']);
    expect(d.findings.map((f) => [f.title, f.status, f.cardId])).toEqual([['Open TikTok ads on the problem', 'merged', filed[0]!.id], ['Rescue stories lift CTR', 'stored', filed[1]!.id]]);
    expect(d.report).toMatchObject({ created: filed, updated: [] });
  });

  test('a finding the knowledge base already holds adds its evidence to that card; one the owner archived is not proposed again', async () => {
    const cat = ensureCategoryPath(db, 'pawsome', ['Advertising']);
    const near = createCard(db, 'pawsome', { categoryId: cat, title: 'TikTok ads: open on the problem', summary: 'Problem-first hooks keep viewers past 3 seconds', type: 'strategy', stage: 'hypothesis', status: 'active', authorId: 'owner', origin: 'owner' });
    createCard(db, 'pawsome', { categoryId: cat, title: 'Rescue stories lift CTR', type: 'strategy', stage: 'hypothesis', status: 'archived', authorId: 'owner', origin: 'owner' });
    const weak = { assessments: [{ finding: 1, ...score, evidence: 2, keep: true, why: 'Thin' }, { finding: 2, ...score, keep: true, why: 'Fine' }] };
    const { settle } = setup({ evaluating: () => answer(weak) });
    const t = createResearchTask(db, TOPIC, clock);
    await settle();
    const d = getResearchTask(db, t.id)!;
    expect(d.findings.map((f) => [f.title, f.status, f.cardId ?? null])).toEqual([['Open TikTok ads on the problem', 'merged', near.id], ['Rescue stories lift CTR', 'discarded', null]]);
    expect(d.report).toMatchObject({ created: [], updated: [{ id: near.id, title: near.title }] });
    expect(listEvidence(db, near.id).map((e) => e.source?.title)).toEqual(['Hook study', 'Hook guide']);
    expect(getCard(db, near.id)!.stage).toBe('supported'); // the weak verdict was on this task's finding, not on the owner's card
    expect(db.prepare('SELECT count(*) AS n FROM kb_cards WHERE task_id = ?').get(t.id)!.n).toBe(0);
  });

  test("a finding the evaluation found contested stays a Hypothesis, however many sources it has; one it didn't keep is dropped", async () => {
    const contested = { assessments: [{ finding: 1, ...score, contradictions: ['B says offers matter more'], keep: true, why: 'Disputed' }, { finding: 2, ...score, keep: false, why: 'Off topic' }] };
    const { settle } = setup({ evaluating: () => answer(contested) });
    const t = createResearchTask(db, TOPIC, clock);
    await settle();
    expect(db.prepare('SELECT title, stage FROM kb_cards WHERE task_id = ?').all(t.id)).toEqual([{ title: 'Open TikTok ads on the problem', stage: 'hypothesis' }]);
    expect(getResearchTask(db, t.id)!.findings.map((f) => f.status)).toEqual(['stored', 'discarded']);
  });

  test("an answer that doesn't fit is tried again after a growing wait, then the task fails", async () => {
    const { settle } = setup({ analyzing: () => [{ type: 'text_delta', text: 'Hooks matter a lot, I think.' }, { type: 'done', sessionId: 's', usage: usage() }] });
    const t = createResearchTask(db, TOPIC, clock);
    await settle();
    expect(getResearchTask(db, t.id)).toMatchObject({ status: 'running', stage: 'analyzing', attempt: 1, nextTryAt: new Date(clock.getTime() + 30_000).toISOString() });
    expect(getResearchTask(db, t.id)!.log.at(-1)!.message).toBe("Analyzing failed: the answer wasn't one JSON object. Trying again in 30 s (attempt 2 of 3).");
    clock = new Date(clock.getTime() + 29_000);
    await settle();
    expect(stagesRun(t.id).filter((s) => s === 'analyzing')).toHaveLength(1); // still waiting
    clock = new Date(clock.getTime() + 2_000);
    await settle();
    expect(getResearchTask(db, t.id)).toMatchObject({ attempt: 2, nextTryAt: new Date(clock.getTime() + 60_000).toISOString() });
    clock = new Date(clock.getTime() + 61_000);
    await settle();
    const d = getResearchTask(db, t.id)!;
    expect(d).toMatchObject({ status: 'failed', error: "Analyzing failed 3 times: the answer wasn't one JSON object." });
    expect(d.steps.filter((s) => s.stage === 'analyzing').map((s) => s.status)).toEqual(['failed', 'failed', 'failed']);
    expect(db.prepare('SELECT count(*) AS n FROM kb_cards WHERE task_id = ?').get(t.id)!.n).toBe(0);
  });

  test("an answer of the wrong shape, or citing a source that wasn't read, is tried again; each stage has its own 3 attempts", async () => {
    const once = (bad: unknown) => (input: RunInput) => answer(input.task.includes('(attempt 1)') ? bad : OUT[stageOf(input.task)!]);
    const { settle } = setup({ planning: once({ scope: 'x', questions: [] }), analyzing: once({ findings: [{ claim: 'Hooks matter', sources: [3] }] }) });
    const t = createResearchTask(db, TOPIC, clock);
    for (let i = 0; i < 3; i++) {
      await settle();
      clock = new Date(clock.getTime() + 31_000);
    }
    const d = getResearchTask(db, t.id)!;
    expect(d.status).toBe('done');
    expect(d.log.filter((l) => l.level === 'warn' && l.stage !== 'retrieving').map((l) => l.message)).toEqual([
      expect.stringMatching(/^Planning failed: the answer didn't fit \(questions: .+\)\. Trying again in 30 s \(attempt 2 of 3\)\.$/),
      'Analyzing failed: the answer cites source 3, but 2 sources were read. Trying again in 30 s (attempt 2 of 3).',
    ]);
  });

  test('a long-winded answer is trimmed to fit, not refused (a real planning run wrote a 600+ character scope)', async () => {
    const wordy = { scope: 'x'.repeat(2000), questions: Array.from({ length: 12 }, (_, i) => `Question ${i + 1}?`), queries: ['q'] };
    const { seen, settle } = setup({ planning: () => answer(wordy) });
    const t = createResearchTask(db, TOPIC, clock);
    await settle();
    expect(getResearchTask(db, t.id)!.status).toBe('done');
    const discovering = seen.find((i) => stageOf(i.task) === 'discovering')!.task;
    expect(discovering).toContain(`Plan: ${'x'.repeat(599)}…`);
    expect(discovering).not.toContain('x'.repeat(600));
    expect(discovering).toContain('- Question 8?');
    expect(discovering).not.toContain('Question 9?');
  });

  test('when every source fails, the task fails with a report of why and makes no cards', async () => {
    const { settle } = setup({}, { 'https://c.test/paid': PAGES['https://c.test/paid']! });
    const t = createResearchTask(db, TOPIC, clock);
    await settle();
    const d = getResearchTask(db, t.id)!;
    expect(d).toMatchObject({ status: 'failed', stage: 'retrieving', error: 'None of the sources could be read.' });
    expect(d.report?.failedSources.map((f) => [f.url, f.status])).toEqual([['https://a.test/hooks', 'failed'], ['https://b.test/hooks', 'failed'], ['https://c.test/paid', 'paywalled']]);
    expect(stagesRun(t.id)).toEqual(['planning', 'discovering']);
    expect(db.prepare('SELECT count(*) AS n FROM kb_cards WHERE task_id = ?').get(t.id)!.n).toBe(0);
  });

  test("each stage spends at most what the task has left; once it's spent, the task stops", async () => {
    const { seen, settle } = setup({ planning: () => answer(OUT.planning, 0.75), discovering: () => answer(OUT.discovering, 0.3) });
    const t = createResearchTask(db, { ...TOPIC, budgetUsd: 1 }, clock);
    await settle();
    expect(seen.map((i) => [stageOf(i.task), i.budgetUsd])).toEqual([['planning', 1], ['discovering', 0.25]]);
    expect(getResearchTask(db, t.id)).toMatchObject({ status: 'failed', stage: 'analyzing', spentUsd: 1.05, error: 'The research used its whole budget ($1.00) before analyzing.' });
  });

  test("a stage that fails after spending the rest of the budget isn't tried again", async () => {
    const { settle } = setup({ planning: () => answer(OUT.planning, 0.75), discovering: () => [{ type: 'text_delta', text: 'No JSON here' }, { type: 'done', sessionId: 's', usage: usage(0.3) }] });
    const t = createResearchTask(db, { ...TOPIC, budgetUsd: 1 }, clock);
    await settle();
    expect(getResearchTask(db, t.id)).toMatchObject({ status: 'failed', stage: 'discovering', error: 'The research used its whole budget ($1.00) before discovering finished.' });
  });

  test('cancel stops the stage running and nothing more starts', async () => {
    // A stage that only ends when it's cancelled.
    const m = createRunManager({ db, env: toolEnv(db), store: (id) => getStore(db, id), engine: (input) => (async function* () { await new Promise((ok) => input.signal!.addEventListener('abort', ok)); })() });
    const deps: ResearchDeps = { start: m.start, fetch: async (url) => ({ url, status: 'failed' }), engineAvailable: () => true, now: () => clock };
    const t = createResearchTask(db, TOPIC, clock);
    await advanceResearch(db, deps);
    expect(cancelResearch(db, t.id, m.cancel, clock)).toMatchObject({ status: 'cancelled' });
    await m.idle();
    await advanceResearch(db, deps);
    expect(getResearchTask(db, t.id)).toMatchObject({ status: 'cancelled', stage: 'planning' });
    expect(runsOf(t.id).map((r) => `${stageOf(r.task)}:${r.status}`)).toEqual(['planning:cancelled']);
    expect(cancelResearch(db, t.id, m.cancel, clock)).toBeUndefined(); // already over
  });

  test('cancel while reading stops reading, and the step stays stopped', async () => {
    let t: { id: string } | undefined;
    const read: string[] = [];
    const { m, settle } = setup({}, PAGES, {
      fetch: async (url) => {
        read.push(url);
        cancelResearch(db, t!.id, m.cancel, clock);
        return { url, status: 'read', title: 'Hook study', text: 'Problem-first hooks win.' };
      },
    });
    t = createResearchTask(db, TOPIC, clock);
    await settle();
    expect(read).toEqual(['https://a.test/hooks']);
    expect(getResearchTask(db, t.id)).toMatchObject({ status: 'cancelled', stage: 'retrieving' });
    expect(getResearchTask(db, t.id)!.steps.filter((s) => s.stage === 'retrieving').map((s) => s.status)).toEqual(['failed']);
  });

  test('after an app restart it goes on from the last finished stage, adopting the retry of the run it was waiting on', async () => {
    const first = setup();
    const t = createResearchTask(db, TOPIC, clock);
    await advanceResearch(db, first.deps);
    await first.m.idle();
    await advanceResearch(db, first.deps); // planning done, discovering started
    await first.m.idle();
    const [, discovering] = runsOf(t.id);
    db.prepare(`UPDATE agent_runs SET status = 'running', ended_at = NULL WHERE id = ?`).run(discovering!.id); // the app stopped mid-run
    const second = setup(); // a new run manager: the restart retries the interrupted run, in research mode
    await second.settle();
    expect(getResearchTask(db, t.id)).toMatchObject({ status: 'done' });
    expect(stagesRun(t.id)).toEqual(['planning', 'discovering', 'discovering', 'analyzing', 'evaluating', 'extracting', 'reporting']);
    expect(getResearchTask(db, t.id)!.steps.filter((s) => s.stage === 'planning' || s.stage === 'discovering').map((s) => `${s.stage}:${s.status}`)).toEqual(['planning:done', 'discovering:done']);
  });

  test('a code stage the app stopped during runs again from the start', async () => {
    const { settle } = setup();
    const t = createResearchTask(db, TOPIC, clock);
    db.prepare(`UPDATE kb_tasks SET status = 'running', stage = 'deduping' WHERE id = ?`).run(t.id);
    db.prepare(`INSERT INTO kb_task_steps (task_id, stage, attempt, status, started_at) VALUES (?, 'deduping', 1, 'running', ?)`).run(t.id, clock.toISOString());
    db.prepare(`INSERT INTO kb_findings (id, task_id, title, data_json, created_at) VALUES ('left', ?, 'Half-kept', '{}', ?)`).run(t.id, clock.toISOString());
    await settle();
    const d = getResearchTask(db, t.id)!;
    expect(d.steps.map((s) => `${s.stage}:${s.status}`)).toEqual(['deduping:failed', 'deduping:done', 'storing:done', 'linking:done', 'reporting:done']);
    expect(d.findings).toEqual([]);
  });

  test("a stage that finished just before the app stopped isn't run again", async () => {
    const { settle } = setup();
    const t = createResearchTask(db, TOPIC, clock);
    db.prepare(`UPDATE kb_tasks SET status = 'running', stage = 'linking' WHERE id = ?`).run(t.id);
    db.prepare(`INSERT INTO kb_task_steps (task_id, stage, attempt, status, output_json, started_at, ended_at) VALUES (?, 'linking', 1, 'done', '{}', ?, ?)`).run(t.id, clock.toISOString(), clock.toISOString());
    await settle();
    expect(getResearchTask(db, t.id)!.steps.map((s) => `${s.stage}:${s.status}`)).toEqual(['linking:done', 'reporting:done']);
  });

  test("a stage's run turned down as it left the queue waits an hour without using an attempt", async () => {
    const { settle } = setup();
    const t = createResearchTask(db, TOPIC, clock);
    db.prepare(`UPDATE kb_tasks SET status = 'running', stage = 'planning' WHERE id = ?`).run(t.id);
    db.prepare(`INSERT INTO agent_runs (id, store_id, agent_id, task, status, error, mode, created_at) VALUES ('r1', 'pawsome', 'pawsome:market_analyst', 'Research', 'error', ?, ?, ?)`).run(
      "Today's AI budget for this store ($5) is used up. Raise it in Settings.", `research:${t.id}`, clock.toISOString(),
    );
    db.prepare(`INSERT INTO kb_task_steps (task_id, stage, attempt, run_id, status, started_at) VALUES (?, 'planning', 1, 'r1', 'running', ?)`).run(t.id, clock.toISOString());
    await settle();
    const d = getResearchTask(db, t.id)!;
    expect(d).toMatchObject({ status: 'running', attempt: 0, nextTryAt: new Date(clock.getTime() + 3_600_000).toISOString(), steps: [] });
    expect(d.log.at(-1)!.message).toBe("Waiting: Today's AI budget for this store ($5) is used up. Raise it in Settings.");
  });

  test('Retry goes on from the stage that failed; Refine starts a new task linked to the first', async () => {
    let failures = 4;
    const { settle } = setup({ analyzing: () => (failures-- > 0 ? [{ type: 'error', message: 'Overloaded' }] : answer(OUT.analyzing)) });
    const t = createResearchTask(db, TOPIC, clock);
    for (let i = 0; i < 3; i++) {
      await settle();
      clock = new Date(clock.getTime() + 120_000);
    }
    expect(getResearchTask(db, t.id)).toMatchObject({ status: 'failed', error: 'Analyzing failed 3 times: Overloaded' });
    expect(retryResearch(db, 'nope', clock)).toBeUndefined();
    expect(retryResearch(db, t.id, clock)).toMatchObject({ status: 'running', stage: 'analyzing' });
    expect(retryResearch(db, t.id, clock)).toBeUndefined(); // only a failed or cancelled task
    await settle(); // the fourth try fails too, and is tried again: Retry counts afresh
    clock = new Date(clock.getTime() + 31_000);
    await settle();
    expect(getResearchTask(db, t.id)).toMatchObject({ status: 'done' });
    expect(stagesRun(t.id)).toEqual(['planning', 'discovering', 'analyzing', 'analyzing', 'analyzing', 'analyzing', 'analyzing', 'evaluating', 'extracting', 'reporting']);

    const r = refineResearch(db, t.id, { objective: 'TikTok hooks for cat gear', brief: { lookFor: 'cat owners' }, budgetUsd: 3 }, clock)!;
    expect(r).toMatchObject({ status: 'queued', stage: 'created', objective: 'TikTok hooks for cat gear' });
    expect(getResearchTask(db, r.id)).toMatchObject({ refinedFrom: t.id, kind: 'topic', role: 'market_analyst', budgetUsd: 3, brief: { lookFor: 'cat owners' } });
    expect(getResearchTask(db, t.id)).toMatchObject({ status: 'done', objective: TOPIC.objective });
    await settle();
    expect(stagesRun(r.id)[0]).toBe('planning');
  });

  test("without an engine that can research, the task fails at once and says why", async () => {
    const { settle } = setup({}, PAGES, { engineAvailable: () => false });
    const t = createResearchTask(db, TOPIC, clock);
    await settle();
    expect(getResearchTask(db, t.id)).toMatchObject({ status: 'failed', stage: 'planning', error: expect.stringMatching(/^Research needs Claude/) });
    expect(runsOf(t.id)).toEqual([]);
  });

  test("a stage its agent can't take yet waits an hour without using an attempt", async () => {
    const { settle } = setup();
    db.prepare('UPDATE agents SET enabled = 0 WHERE id = ?').run('pawsome:market_analyst');
    const t = createResearchTask(db, TOPIC, clock);
    await settle();
    expect(getResearchTask(db, t.id)).toMatchObject({ status: 'running', stage: 'planning', attempt: 0, nextTryAt: new Date(clock.getTime() + 3_600_000).toISOString() });
    expect(getResearchTask(db, t.id)!.log.at(-1)!.message).toBe('Waiting: This agent is offline. Redeploy it first.');
  });

  test('in the app, a stage ending moves its task on, and pays no XP or notification of its own', async () => {
    const t = createResearchTask(db, TOPIC);
    db.prepare(`UPDATE kb_tasks SET status = 'running', stage = 'planning' WHERE id = ?`).run(t.id);
    const run = runManager(db).start('pawsome:market_analyst', `Research task ${t.id}, step planning (attempt 1).`, undefined, undefined, { mode: `research:${t.id}` });
    if (typeof run === 'string') throw new Error(run);
    db.prepare(`INSERT INTO kb_task_steps (task_id, stage, attempt, run_id, status, started_at) VALUES (?, 'planning', 1, ?, 'running', ?)`).run(t.id, run.id, new Date().toISOString());
    // The demo engine's answer isn't the stage's JSON, so the step fails and waits to try again: the task moved.
    await vi.waitFor(() => expect(getResearchTask(db, t.id)).toMatchObject({ attempt: 1, steps: [{ status: 'failed' }] }));
    expect(db.prepare('SELECT count(*) AS n FROM xp_events WHERE ref = ?').get(`run:${run.id}`)!.n).toBe(0);
    expect(db.prepare(`SELECT count(*) AS n FROM notifications WHERE kind = 'agent_done'`).get()!.n).toBe(0);
  });

  test('in the app, the task streams as it moves and the owner hears how it ended (here: no Claude, so it fails)', async () => {
    const seen: LiveMessage[] = [];
    const off = subscribe((m) => seen.push(m));
    const t = createResearchTask(db, TOPIC);
    advanceKbResearch(db);
    await vi.waitFor(() => expect(getResearchTask(db, t.id)?.status).toBe('failed'));
    off();
    expect(seen.filter((m) => m.type === 'kb_task').map((m) => m.type === 'kb_task' && m.task)).toMatchObject([{ id: t.id, status: 'failed' }]);
    expect(db.prepare(`SELECT kind, title, body, store_id, link FROM notifications WHERE title LIKE 'Research%'`).all()).toMatchObject([
      { kind: 'error', title: `Research failed: ${TOPIC.objective}`, body: expect.stringMatching(/^Research needs Claude/), store_id: 'pawsome', link: '/knowledge' },
    ]);
  });
});
