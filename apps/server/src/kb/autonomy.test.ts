import { createCard, createResearchTask, ensureCategoryPath, learn, type NewKbCard } from '@frontline/agents';
import type { KbControlsState, KbTaskDetail, KbWorkspace } from '@frontline/shared';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { startScheduler } from '../automations';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { autonomousResearch, reservedUsd, scheduledResearch } from './autonomy';

let db: Db;
let app: ReturnType<typeof createApp>;
let advance: ReturnType<typeof vi.fn<() => void>>;
let claude: boolean;
beforeEach(() => {
  // The app's clock: tasks and approvals stamp new Date(), and the guards count days back from it.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-27T12:00:00Z'));
  db = openDb();
  seedDemo(db);
  app = createApp(db);
  advance = vi.fn<() => void>();
  claude = true;
});
afterEach(() => vi.useRealTimers());

const DAY = 86_400_000;
const deps = () => ({ engineAvailable: () => claude, advance });
const scan = () => autonomousResearch(db, deps());
/** PUT /api/kb/controls sends the version it read (settings ST-08b). */
const withVersion = async (method: string, path: string, body: unknown) =>
  method === 'PUT' && path.startsWith('/api/kb/controls') && body && typeof body === 'object' && !Array.isArray(body) && !('version' in body)
    ? { ...body, version: ((await (await app.request(path)).json()) as { version?: number }).version ?? 0 }
    : body;
const req = async (method: string, path: string, body?: unknown) => {
  body = await withVersion(method, path, body);
  const res = await app.request(path, { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) });
  return { status: res.status, body: res.status === 204 ? undefined : await res.json() };
};
const controls = async (body: Record<string, unknown>, ws = 'peak') => {
  const r = await req('PUT', `/api/kb/controls?ws=${ws}`, body);
  expect(r.status).toBe(200);
  return r.body as KbControlsState;
};
/** Self-directed research on for peak's ad strategist, straight to work unless `more` says otherwise. */
const on = (more: Record<string, unknown> = {}) => controls({ autonomous: true, roles: { ad_strategist: [] }, approval: false, ...more });
const card = (more: Partial<NewKbCard> = {}, ws: KbWorkspace = 'peak') =>
  createCard(db, ws, {
    categoryId: ensureCategoryPath(db, ws, ['Advertising', 'Hooks']), title: 'Problem-first hooks win', summary: 'They hold viewers', type: 'strategy', stage: 'supported', status: 'active',
    authorId: 'owner', origin: 'owner', ...more,
  });
const tasks = () => db.prepare(`SELECT * FROM kb_tasks ORDER BY rowid`).all();
const recommended = () =>
  db.prepare(`SELECT * FROM approvals WHERE json_extract(action_json, '$.kind') = 'kb.research' ORDER BY rowid`).all().map((r) => ({ ...(r as Record<string, string>), id: String(r.id), reason: String(r.reason), action: JSON.parse(String(r.action_json)) }));
const later = (days: number) => vi.setSystemTime(Date.now() + days * DAY);
const conflict = (cardId: string, taskId: string | null = null) =>
  db.prepare(`INSERT INTO kb_conflicts (id, store_id, card_id, note, status, task_id, created_at) VALUES (?, 'peak', ?, 'A test found the opposite', 'open', ?, ?)`).run(`k-${cardId}`, cardId, taskId, new Date().toISOString());

describe('the controls', () => {
  test('a workspace starts with self-directed research off, findings to review, and nothing reserved', async () => {
    expect((await req('GET', '/api/kb/controls?ws=peak')).body).toEqual({
      autonomous: false, roles: {}, triggers: ['conflict', 'anomaly', 'gap', 'stale'], taskBudgetUsd: 1, dailyBudgetUsd: 3, depth: 'standard', approval: true, review: true,
      trustedDomains: [], blockedDomains: [], freshDays: {}, retentionDays: null, reservedUsd: 0, version: 0,
    });
    expect((await req('GET', '/api/kb/controls?ws=all')).status).toBe(400);
  });

  test('saves what changed and keeps the rest', async () => {
    const hooks = ensureCategoryPath(db, 'peak', ['Advertising']);
    const c = await controls({ autonomous: true, roles: { ad_strategist: [hooks], market_analyst: [] }, triggers: ['gap'], blockedDomains: [' Reddit.com '], trustedDomains: ['ads.tiktok.com'] });
    expect(c).toMatchObject({ autonomous: true, roles: { ad_strategist: [hooks], market_analyst: [] }, triggers: ['gap'], blockedDomains: ['reddit.com'], trustedDomains: ['ads.tiktok.com'], approval: true, taskBudgetUsd: 1 });
    expect((await controls({ dailyBudgetUsd: 10 })).roles).toEqual({ ad_strategist: [hooks], market_analyst: [] });
    expect((await req('GET', '/api/kb/controls?ws=general')).body).toMatchObject({ autonomous: false, roles: {} }); // its own
  });

  const bad: [string, Record<string, unknown>, string, string?][] = [
    ['an object', [] as unknown as Record<string, unknown>, 'body must be an object'],
    ['on/off', { autonomous: 'yes' }, 'autonomous, approval and review must be true or false'],
    ['roles', { roles: { boss: [] } }, 'roles must map agent roles to category ids'],
    ['own categories', { roles: { ad_strategist: ['nope'] } }, "roles' categories must be this workspace's top-level categories"],
    ['triggers', { triggers: ['moon'] }, 'triggers must be some of conflict, anomaly, gap, stale'],
    ['a task budget', { taskBudgetUsd: 9 }, 'taskBudgetUsd must be between $0.25 and $5'],
    ['a daily budget', { dailyBudgetUsd: 0.5 }, 'dailyBudgetUsd must be between the task budget and $50'],
    ['a depth', { depth: 'abyss' }, 'depth must be quick, standard or deep'],
    ['domains', { blockedDomains: ['https://reddit.com/r/x'] }, 'trustedDomains and blockedDomains must be domain names, like example.com'],
    ['a store, for General', { autonomous: true }, 'Self-directed research runs on a store: its agents and AI budget. Turn it on for a store.', 'general'],
  ];
  test.each(bad)('needs %s', async (_, body, error, ws = 'peak') => {
    expect(await req('PUT', `/api/kb/controls?ws=${ws}`, body)).toMatchObject({ status: 400, body: { error } });
  });

  test('General keeps its review and domains', async () => {
    expect(await controls({ review: false, blockedDomains: ['pinterest.com'] }, 'general')).toMatchObject({ review: false, blockedDomains: ['pinterest.com'] });
  });
});

describe('triggers', () => {
  test('off by default: a gap starts nothing', async () => {
    card({ stage: 'hypothesis' });
    expect(scan()).toEqual([]);
    expect(tasks()).toEqual([]);
  });

  test('a gap the responsible role covers starts a task on its own, at the workspace depth and task budget', async () => {
    card({ stage: 'hypothesis' });
    await on({ depth: 'quick', taskBudgetUsd: 0.75 });
    const [r] = scan();
    expect(r).toMatchObject({ storeId: 'peak', trigger: 'gap', task: { role: 'ad_strategist', storeId: 'peak', status: 'queued' } });
    const t = (await req('GET', `/api/kb/research/tasks/${r!.task!.id}`)).body as KbTaskDetail;
    expect(t).toMatchObject({
      objective: 'Advertising for a fitness store: which of its findings hold up?', origin: 'autonomous', kind: 'topic', budgetUsd: 0.75,
      brief: { depth: 'quick', trigger: { kind: 'gap', subject: ensureCategoryPath(db, 'peak', ['Advertising']) } },
    });
    expect(t.log[0]).toMatchObject({ message: 'Queued on its own (Knowledge gap: everything in Advertising is a Hypothesis)' });
    expect(advance).toHaveBeenCalledTimes(1);
  });

  test('with approval required, it waits in Agents recommend; approved, it runs as self-directed research', async () => {
    card({ stage: 'hypothesis' });
    await on({ approval: true });
    scan();
    expect(tasks()).toEqual([]);
    const [a] = recommended();
    expect(a).toMatchObject({ store_id: 'peak', agent_id: 'peak:ad_strategist', status: 'pending', title: 'Research: Advertising for a fitness store: which of its findings hold up?' });
    expect(a!.reason).toBe('Knowledge gap: everything in Advertising is a Hypothesis. Up to $1.00 of AI usage.');
    expect(a!.action.payload).toMatchObject({ ws: 'peak', role: 'ad_strategist', origin: 'autonomous', budgetUsd: 1, brief: { depth: 'standard', trigger: { kind: 'gap' } } });
    expect(a!.action.payload.estimateUsd).toBeUndefined(); // nothing finished yet to estimate from
    expect((await req('POST', `/api/approvals/${a!.id}/approve`)).status).toBe(200);
    await vi.waitFor(() => expect(tasks()).toHaveLength(1));
    expect(tasks()[0]).toMatchObject({ origin: 'autonomous', role: 'ad_strategist', budget_usd: 1, objective: 'Advertising for a fitness store: which of its findings hold up?' });
    expect(JSON.parse(String(tasks()[0]!.brief_json))).toMatchObject({ depth: 'standard', trigger: { kind: 'gap' } });
  });

  test('a recommendation carries what research like it has cost', async () => {
    for (const spent of [0.4, 0.6]) {
      const t = createResearchTask(db, { ws: 'peak', payerId: 'peak', role: 'ad_strategist', kind: 'topic', origin: 'owner', objective: `Old research ${spent}`, budgetUsd: 1 });
      db.prepare(`UPDATE kb_tasks SET status = 'done', spent_usd = ? WHERE id = ?`).run(spent, t.id);
    }
    card({ stage: 'hypothesis' });
    await on({ approval: true });
    scan();
    expect(recommended()[0]!.action.payload.estimateUsd).toBe(0.5);
  });

  test('stale cards, contradictions and performance anomalies, each when its trigger is on', async () => {
    const stale = card({ title: 'Broad targeting wins' });
    db.prepare(`UPDATE kb_cards SET verified_at = ?, created_at = ? WHERE id = ?`).run(new Date(Date.now() - 100 * DAY).toISOString(), new Date(Date.now() - 100 * DAY).toISOString(), stale.id);
    const disputed = card({ title: 'Offers beat hooks' });
    conflict(disputed.id);
    const reading = { storeId: 'peak', subject: 'campaign:meta:dog', name: 'The "Dog" campaign (Meta)', metric: 'roas', label: 'ROAS', vs: "the store's other Meta campaigns", value: 3, baseline: 1, k: 50, kBase: 50, n: 50, unit: 'purchases', show: String, confounds: [], path: ['Advertising', 'Campaigns'] };
    learn(db, { ...reading, ref: 'r1', from: '2026-09-01', to: '2026-09-28' });
    // Old as it is, a lesson isn't stale research: the next period's numbers re-read it.
    db.prepare(`UPDATE kb_cards SET verified_at = ?, created_at = ? WHERE origin = 'performance'`).run(new Date(Date.now() - 120 * DAY).toISOString(), new Date(Date.now() - 120 * DAY).toISOString());
    const objectives = async (triggers: string[]) => {
      db.prepare('DELETE FROM kb_tasks').run();
      await on({ triggers });
      return scan().map((r) => [r.trigger, r.task!.objective]);
    };
    expect(await objectives(['stale'])).toEqual([['stale', 'Is it still true? "Broad targeting wins"']]);
    expect(await objectives(['conflict'])).toEqual([['conflict', 'Settle the disagreement on "Offers beat hooks": A test found the opposite']]);
    expect(await objectives(['anomaly'])).toEqual([['anomaly', 'Why does this happen, and how do we use it? "The "Dog" campaign (Meta): ROAS above the store\'s other Meta campaigns"']]);
    // Past its category's age, not a fixed one: given 180 days, Advertising's 100-day-old card is still fresh.
    await controls({ freshDays: { [ensureCategoryPath(db, 'peak', ['Advertising'])]: 180 } });
    expect(await objectives(['stale'])).toEqual([]);
    expect(await objectives([])).toEqual([]);
  });

  test("a role only answers for its categories: none set means its usual areas; off, it doesn't research", async () => {
    card({ stage: 'hypothesis', categoryId: ensureCategoryPath(db, 'peak', ['Fulfilment']) });
    await on();
    expect(scan()).toEqual([]); // the ad strategist's areas are advertising
    await controls({ roles: { operations: [ensureCategoryPath(db, 'peak', ['Advertising'])] } });
    expect(scan()).toEqual([]); // the categories it was given, not the gap's
    await controls({ roles: { operations: [] } });
    expect(scan()).toMatchObject([{ task: { role: 'operations' } }]);
    db.prepare('DELETE FROM kb_tasks').run();
    await controls({ roles: { market_analyst: [ensureCategoryPath(db, 'peak', ['Fulfilment'])] } });
    expect(scan()).toMatchObject([{ task: { role: 'market_analyst' } }]);
  });

  test('never on the demo engine, and never for a store that has it off', async () => {
    card({ stage: 'hypothesis' });
    await on();
    claude = false;
    expect(scan()).toEqual([]);
    claude = true;
    await controls({ autonomous: false });
    expect(scan()).toEqual([]);
  });
});

describe('loop guards', () => {
  test('one task per workspace per pass', async () => {
    card({ stage: 'hypothesis', categoryId: ensureCategoryPath(db, 'peak', ['Media buying']) });
    conflict(card({ title: 'Offers beat hooks' }).id);
    await on({ dailyBudgetUsd: 10 });
    expect(scan()).toHaveLength(1);
    expect(scan()).toHaveLength(1); // the next pass takes the next one
    expect(tasks().map((t) => JSON.parse(String(t.brief_json)).trigger.kind)).toEqual(['conflict', 'gap']);
  });

  test("what self-directed research made doesn't start more of it", async () => {
    const auto = createResearchTask(db, { ws: 'peak', payerId: 'peak', role: 'ad_strategist', kind: 'topic', origin: 'autonomous', objective: 'Hooks', budgetUsd: 1 });
    db.prepare(`UPDATE kb_tasks SET status = 'done', created_at = ? WHERE id = ?`).run(new Date(Date.now() - 30 * DAY).toISOString(), auto.id);
    const own = card({ stage: 'hypothesis', taskId: auto.id, origin: 'research' }); // its cards: an "only hypotheses" gap
    db.prepare(`UPDATE kb_cards SET verified_at = ? WHERE id = ?`).run(new Date(Date.now() - 100 * DAY).toISOString(), own.id); // and stale
    await on();
    expect(scan()).toEqual([]);
  });

  test("a contradiction research found doesn't start research", async () => {
    const t = createResearchTask(db, { ws: 'peak', payerId: 'peak', role: 'ad_strategist', kind: 'topic', origin: 'owner', objective: 'Hooks', budgetUsd: 1 });
    db.prepare(`UPDATE kb_tasks SET status = 'done' WHERE id = ?`).run(t.id);
    conflict(card().id, t.id);
    await on();
    expect(scan()).toEqual([]);
  });

  test('a card and trigger cool down for 14 days, whether it ran or the owner dismissed it', async () => {
    const c = card({ title: 'Offers beat hooks' });
    conflict(c.id);
    await on({ dailyBudgetUsd: 50 });
    expect(scan()).toHaveLength(1);
    db.prepare(`UPDATE kb_tasks SET status = 'done'`).run();
    later(13);
    expect(scan()).toEqual([]);
    later(2);
    expect(scan()).toHaveLength(1);
    db.prepare('DELETE FROM kb_tasks').run();
    await controls({ approval: true });
    later(15);
    scan();
    const [a] = recommended();
    expect((await req('POST', `/api/approvals/${a!.id}/deny`)).status).toBe(200);
    later(1);
    expect(scan()).toEqual([]);
  });

  test('the same topic open or just researched in the workspace is reused, not done again', async () => {
    card({ stage: 'hypothesis' });
    const t = createResearchTask(db, { ws: 'peak', payerId: 'peak', role: 'market_analyst', kind: 'topic', origin: 'owner', objective: 'advertising for a fitness store: which of its findings hold up?', budgetUsd: 1 });
    await on();
    expect(scan()).toEqual([]);
    db.prepare(`UPDATE kb_tasks SET status = 'done', ended_at = ? WHERE id = ?`).run(new Date().toISOString(), t.id);
    expect(scan()).toEqual([]);
    later(2);
    expect(scan()).toHaveLength(1);
  });

  test("the daily budget holds what the last 24 hours reserved, recommendations waiting included", async () => {
    card({ stage: 'hypothesis', categoryId: ensureCategoryPath(db, 'peak', ['Media buying']) });
    conflict(card({ title: 'Offers beat hooks' }).id);
    await on({ taskBudgetUsd: 1, dailyBudgetUsd: 1.5 });
    expect(scan()).toHaveLength(1);
    expect(scan()).toEqual([]);
    expect(((await req('GET', '/api/kb/controls?ws=peak')).body as KbControlsState).reservedUsd).toBe(1);
    later(1.01);
    await controls({ approval: true });
    expect(scan()).toHaveLength(1);
    expect(recommended()).toHaveLength(1);
    expect(reservedUsd(db, 'peak')).toBe(1); // yesterday's task is out of the window; the recommendation waiting is in
  });
});

describe('schedules', () => {
  const rule = (storeId = 'peak') =>
    req('POST', '/api/automations', { storeId, name: 'Weekly trends', trigger: { type: 'schedule', cron: '0 9 * * 1' }, action: { type: 'kb_research', agentId: `${storeId}:market_analyst`, task: 'What is new in home fitness this week?' } });

  test('an automation can research, under the same controls', async () => {
    const r = await rule();
    expect(r).toMatchObject({ status: 201, body: { action: { type: 'kb_research', agentId: 'peak:market_analyst', task: 'What is new in home fitness this week?' } } });
    expect((await req('POST', '/api/automations', { storeId: 'peak', name: 'x', trigger: { type: 'schedule', cron: '0 9 * * 1' }, action: { type: 'kb_research', agentId: 'peak:market_analyst', task: 'no' } })).body).toEqual({ error: 'action.task must be 3-500 characters for research' });
    const id = (r.body as { id: string }).id;
    expect(scheduledResearch(db, id, 'scheduled (0 9 * * 1)', deps())).toEqual({ status: 'skipped', detail: 'Self-directed research is off for Peak Fit' });
    await on();
    expect(scheduledResearch(db, id, 'scheduled (0 9 * * 1)', deps())).toEqual({ status: 'skipped', detail: "The Analytics Specialist doesn't research on its own in Peak Fit" });
    await controls({ roles: { market_analyst: [] } });
    const ran = scheduledResearch(db, id, 'scheduled (0 9 * * 1)', deps());
    expect(ran).toEqual({ status: 'started', detail: 'Research queued: What is new in home fitness this week?' });
    expect(tasks()[0]).toMatchObject({ origin: 'autonomous', role: 'market_analyst', objective: 'What is new in home fitness this week?' });
    expect(JSON.parse(String(tasks()[0]!.brief_json)).trigger).toEqual({ kind: 'schedule', subject: id });
    expect(scheduledResearch(db, id, 'scheduled (0 9 * * 1)', deps())).toEqual({ status: 'skipped', detail: 'Already researching or just researched in Peak Fit: "What is new in home fitness this week?"' });
    // A week on, the same topic runs again: a schedule repeats, it doesn't cool down like a trigger.
    db.prepare(`UPDATE kb_tasks SET status = 'done', ended_at = ?`).run(new Date().toISOString());
    later(7);
    expect(scheduledResearch(db, id, 'scheduled (0 9 * * 1)', deps()).status).toBe('started');
    claude = false;
    expect(scheduledResearch(db, id, 'scheduled (0 9 * * 1)', deps())).toEqual({ status: 'skipped', detail: 'Self-directed research needs Claude: the agents are on the demo engine here' });
    claude = true;
    await controls({ approval: true });
    db.prepare('DELETE FROM kb_tasks').run();
    expect(scheduledResearch(db, id, 'scheduled (0 9 * * 1)', deps())).toEqual({ status: 'started', detail: 'Recommended: waiting for your approval in the Research Center' });
  });

  test('the scheduler hands a research rule to the controls', async () => {
    const id = ((await rule()).body as { id: string }).id;
    db.prepare(`UPDATE automation_rules SET checked_at = ? WHERE id = ?`).run(new Date(2026, 9, 26, 8, 59).toISOString(), id); // a Monday, local time
    const research = vi.fn(() => ({ status: 'skipped' as const, detail: 'Self-directed research is off for Peak Fit' }));
    const run = vi.fn();
    const s = startScheduler(db, run, { everyMs: 1e9, now: () => new Date(2026, 9, 26, 9, 0, 30), research });
    s.stop();
    expect(research).toHaveBeenCalledWith(id, 'scheduled (0 9 * * 1)');
    expect(run).not.toHaveBeenCalled();
    expect(db.prepare('SELECT status, detail FROM automation_runs WHERE rule_id = ?').get(id)).toEqual({ status: 'skipped', detail: 'Self-directed research is off for Peak Fit' });
  });
});

