import { createCard, ensureCategoryPath, getCard, learn, listEvidence, saveCreative } from '@frontline/agents';
import type { KbCampaign, KbExperiment, KbWorkspace } from '@frontline/shared';
import { beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app';
import { addDays } from '../dates';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { storeDay } from '../routes/agents-outcomes';
import { evaluateExperiments } from './experiments';

let db: Db;
let app: ReturnType<typeof createApp>;
let today: string;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  app = createApp(db);
  // peak as a real store, as its first sync leaves it, its ad account synced just now.
  db.prepare(`UPDATE stores SET demo = 0, connected = 1 WHERE id = 'peak'`).run();
  for (const t of ['daily_metrics', 'campaigns', 'orders', 'products']) db.prepare(`DELETE FROM ${t} WHERE store_id = 'peak'`).run();
  db.prepare(`INSERT INTO integrations (id, kind, store_id, status, encrypted_credentials, updated_at, synced_at) VALUES ('meta_ads:peak', 'meta_ads', 'peak', 'connected', 'x', ?1, ?1)`).run(new Date().toISOString());
  today = storeDay(db, 'peak');
});

const W = () => ({ from: addDays(today, 1), to: addDays(today, 28) });
const card = (ws: KbWorkspace = 'peak', more: Partial<Parameters<typeof createCard>[2]> = {}) =>
  createCard(db, ws, { categoryId: ensureCategoryPath(db, ws, ['Advertising']), title: 'Dog-car ads beat broad ones', summary: 'Owners who drive buy more', type: 'strategy', stage: 'hypothesis', status: 'active', authorId: 'owner', origin: 'owner', ...more });
type Ad = { spend: number; revenue: number; purchases: number; clicks?: number; impressions?: number };
/** A campaign's totals over the 28 days from `from`. */
function campaign(id: string, t: Ad, from = W().from) {
  db.prepare(`INSERT OR IGNORE INTO campaigns (network, id, store_id, name, status, daily_budget) VALUES ('meta', ?, 'peak', ?, 'active', 50)`).run(id, `Campaign ${id}`);
  const share = (n: number, i: number) => Math.floor((n * (i + 1)) / 28) - Math.floor((n * i) / 28);
  for (let i = 0; i < 28; i++)
    db.prepare(`INSERT INTO campaign_daily (network, campaign_id, date, spend, revenue, purchases, clicks, impressions) VALUES ('meta', ?, ?, ?, ?, ?, ?, ?)`).run(
      id, addDays(from, i), t.spend / 28, t.revenue / 28, share(t.purchases, i), share(t.clicks ?? 1000, i), share(t.impressions ?? 50_000, i),
    );
}
/** An ad in `campaignId` made from `creative`, with its totals over the window. */
function ad(id: string, campaignId: string, creative: string, t: Ad) {
  db.prepare(`INSERT OR IGNORE INTO campaigns (network, id, store_id, name, status, daily_budget) VALUES ('meta', ?, 'peak', ?, 'active', 50)`).run(campaignId, `Campaign ${campaignId}`);
  db.prepare(`INSERT INTO ads (network, id, campaign_id, group_id, name, status, creative_id) VALUES ('meta', ?, ?, 's1', ?, 'active', ?)`).run(id, campaignId, `Ad ${id}`, creative);
  db.prepare(`INSERT INTO ad_daily (network, ad_id, date, spend, revenue, purchases, clicks, impressions) VALUES ('meta', ?, ?, ?, ?, ?, ?, ?)`).run(id, W().from, t.spend, t.revenue, t.purchases, t.clicks ?? 0, t.impressions ?? 0);
}
const creative = (headline: string, hook?: string) => saveCreative(db, { storeId: 'peak', agentId: 'peak:creative_studio', kind: 'copy', headline, primaryText: `${headline}, the copy`, credits: 0, source: 'agent', ...(hook ? { hook } : {}) }).id;
const DOG = { spend: 2800, revenue: 8400, purchases: 60 }; // ROAS 3
const BROAD = { spend: 2800, revenue: 4200, purchases: 60 }; // ROAS 1.5

const req = async (path: string, init?: { method: string; body?: unknown }) => {
  const res = await app.request(path, init && { method: init.method, ...(init.body !== undefined ? { body: JSON.stringify(init.body), headers: { 'content-type': 'application/json' } } : {}) });
  return { status: res.status, body: res.status === 204 ? undefined : await res.json() };
};
const plan = (cardId: string, more: Record<string, unknown> = {}, ws = 'peak') =>
  req(`/api/kb/cards/${cardId}/experiments?ws=${ws}`, {
    method: 'POST',
    body: { metric: 'roas', variants: [{ label: 'Broad', campaigns: ['meta:broad'], creatives: [] }, { label: 'Dog car', campaigns: ['meta:dog'], creatives: [] }], ...W(), minSample: 30, ...more },
  });
/** The store's ad account synced `days` after the window ended (30 settles it). */
const syncedAfter = (days: number) => db.prepare(`UPDATE integrations SET synced_at = ? WHERE id = 'meta_ads:peak'`).run(`${addDays(W().to, days + 1)}T12:00:00Z`);

describe('planning a test', () => {
  test("from a card: A against B on a metric, a window, a minimum sample; due when the window's attribution settles", async () => {
    campaign('dog', DOG);
    campaign('broad', BROAD);
    const c = card();
    const r = await plan(c.id);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ cardId: c.id, storeId: 'peak', metric: 'roas', ...W(), minSample: 30, status: 'planned', due: addDays(W().to, 30) });
    expect((await req(`/api/kb/cards/${c.id}/experiments?ws=peak`)).body).toEqual([r.body]);
  });

  test('a General card is tested on a store it names', async () => {
    campaign('dog', DOG);
    campaign('broad', BROAD);
    const g = card(null);
    expect(await plan(g.id, {}, 'general')).toMatchObject({ status: 400, body: { error: 'A General card is tested on a store: storeId must be one' } });
    expect(await plan(g.id, { storeId: 'peak' }, 'general')).toMatchObject({ status: 201, body: { cardId: g.id, storeId: 'peak' } });
  });

  const bad: [string, Record<string, unknown>, string][] = [
    ['a metric it has', { metric: 'cpm' }, 'metric must be one of roas, ctr, cvr'],
    ['dates in order', { from: addDays(new Date().toISOString().slice(0, 10), 9), to: addDays(new Date().toISOString().slice(0, 10), 2) }, 'from and to must be dates (YYYY-MM-DD), from first'],
    ['a window not over yet', { from: '2026-01-01', to: '2026-01-28' }, 'A test is planned before its window ends: pick an end date from today on'],
    ['a minimum sample', { minSample: 0 }, 'minSample must be a whole number from 30'],
    ['two sides', { variants: [{ label: 'A', campaigns: ['meta:dog'] }] }, 'variants must be [A, B]'],
    ['labels', { variants: [{ label: ' ', campaigns: ['meta:broad'] }, { label: 'B', campaigns: ['meta:dog'] }] }, 'each variant needs a label (up to 40 characters)'],
    ['short labels', { variants: [{ label: 'x'.repeat(41), campaigns: ['meta:broad'] }, { label: 'B', campaigns: ['meta:dog'] }] }, 'each variant needs a label (up to 40 characters)'],
    ['something on each side', { variants: [{ label: 'A', campaigns: [], creatives: [] }, { label: 'B', campaigns: ['meta:dog'] }] }, '"A" needs a campaign or a creative'],
    ["the store's own campaigns", { variants: [{ label: 'A', campaigns: ['meta:nope'] }, { label: 'B', campaigns: ['meta:dog'] }] }, "campaigns must be this store's, as network:id"],
    ["the store's own creatives", { variants: [{ label: 'A', creatives: ['nope'] }, { label: 'B', campaigns: ['meta:dog'] }] }, "creatives must be this store's library creatives"],
    ['nothing on both sides', { variants: [{ label: 'A', campaigns: ['meta:dog', 'meta:broad'] }, { label: 'B', campaigns: ['meta:dog'] }] }, 'A campaign or creative can only be on one side'],
    ['no creative on both sides', { variants: [{ label: 'A', campaigns: ['meta:broad'], creatives: ['k'] }, { label: 'B', campaigns: ['meta:dog'], creatives: ['k'] }] }, 'A campaign or creative can only be on one side'],
  ];
  test.each(bad)('needs %s', async (_, more, error) => {
    campaign('dog', DOG);
    campaign('broad', BROAD);
    db.prepare(`INSERT INTO creatives (id, store_id, agent_id, kind, headline, primary_text, credits, source, created_at) VALUES ('k', 'peak', 'peak:copywriter', 'copy', 'h', 'p', 0, 'agent', ?)`).run(new Date().toISOString());
    expect(await plan(card().id, more)).toEqual({ status: 400, body: { error } });
  });

  test('not on a demo store, nor on a card that is archived', async () => {
    const demo = card('pawsome');
    expect(await plan(demo.id, {}, 'pawsome')).toEqual({ status: 409, body: { error: "Tests read a store's real ad numbers: this is a demo store. Connect its ad account first." } });
    expect(await plan(card('peak', { status: 'archived' }).id)).toEqual({ status: 409, body: { error: 'Only an active or unreviewed card can be tested' } });
  });

  test('a planned test can be cancelled; one with a result cannot', async () => {
    campaign('dog', DOG);
    campaign('broad', BROAD);
    const c = card();
    const [a, b] = [(await plan(c.id)).body as KbExperiment, (await plan(c.id)).body as KbExperiment];
    expect((await req(`/api/kb/experiments/${a.id}?ws=pawsome`, { method: 'DELETE' })).status).toBe(404);
    expect((await req(`/api/kb/experiments/${a.id}?ws=peak`, { method: 'DELETE' })).status).toBe(204);
    syncedAfter(30);
    evaluateExperiments(db);
    expect(await req(`/api/kb/experiments/${b.id}?ws=peak`, { method: 'DELETE' })).toEqual({ status: 409, body: { error: 'Only a planned test can be cancelled: its result is evidence now' } });
    expect(((await req(`/api/kb/cards/${c.id}/experiments?ws=peak`)).body as KbExperiment[]).map((e) => e.id)).toEqual([b.id]);
  });
});

describe('evaluating a test', () => {
  let n = 0;
  const evaluate = async (b: Ad, a: Ad, more: Record<string, unknown> = {}) => {
    campaign('dog', b);
    campaign('broad', a);
    const c = card('peak', { title: `Dog-car ads beat broad ones (${++n})` });
    const e = (await plan(c.id, more)).body as KbExperiment;
    syncedAfter(30);
    evaluateExperiments(db);
    return { c: getCard(db, c.id)!, e: ((await req(`/api/kb/cards/${c.id}/experiments?ws=peak`)).body as KbExperiment[])[0]!, evidence: listEvidence(db, c.id), id: e.id };
  };

  test('B beat A outside the noise: it worked, measured evidence from the test, and the card is Experimentally Tested', async () => {
    const { c, e, evidence, id } = await evaluate(DOG, BROAD);
    expect(e).toMatchObject({ status: 'worked' });
    expect(e.result).toBe(`Test of "Dog car" against "Broad", ${W().from} to ${W().to}: ROAS 3.00 vs 1.50: +100% (95% range +40% to +186%), on 60 and 60 purchases. "Dog car" did better: it worked.`);
    expect(evidence).toMatchObject([{ kind: 'measured', text: e.result, metric: 'roas', value: 3, baseline: 1.5, ...{ windowFrom: W().from, windowTo: W().to }, sampleSize: 60, testRef: `exp:${id}`, authorId: 'app' }]);
    expect(c.stage).toBe('tested');
    evaluateExperiments(db);
    expect(listEvidence(db, c.id)).toHaveLength(1);
  });

  test('B did worse: it failed, conflict evidence, and a conflict opens', async () => {
    const { c, e, evidence } = await evaluate(BROAD, DOG);
    expect(e.status).toBe('failed');
    expect(e.result).toMatch(/: -50% \(95% range -65% to -28%\), on 60 and 60 purchases\. "Dog car" did worse: the claim failed here\.$/);
    expect(evidence.map((x) => x.kind)).toEqual(['conflict']);
    expect(db.prepare(`SELECT count(*) AS n FROM kb_conflicts WHERE card_id = ? AND status = 'open'`).get(c.id)?.n).toBe(1);
  });

  test('inside the noise, or short of its minimum sample: inconclusive, observed evidence', async () => {
    expect((await evaluate({ ...DOG, revenue: 4600 }, BROAD)).e).toMatchObject({ status: 'inconclusive', result: expect.stringMatching(/Inside the noise or multiple-comparison threshold: inconclusive\.$/) });
    db.prepare('DELETE FROM campaign_daily').run();
    const short = await evaluate(DOG, BROAD, { minSample: 61 });
    expect(short.e.result).toBe(`Test of "Dog car" against "Broad", ${W().from} to ${W().to}: ROAS 3.00 vs 1.50. Inconclusive: each side needed 61 purchases; "Broad" had 60, "Dog car" 60.`);
    expect(short.evidence.map((x) => x.kind)).toEqual(['observed']);
    expect(short.c.stage).toBe('hypothesis');
  });

  test('click-through and conversion rates', async () => {
    expect((await evaluate({ ...DOG, clicks: 1500 }, BROAD, { metric: 'ctr', minSample: 100 })).e.result).toMatch(/click-through rate 3\.00% vs 2\.00%: \+50% .*on 1500 and 1000 clicks\. "Dog car" did better/);
    db.prepare('DELETE FROM campaign_daily').run();
    expect((await evaluate({ ...BROAD, clicks: 500 }, BROAD, { metric: 'cvr' })).e.result).toMatch(/conversion rate 12\.00% vs 6\.00%: \+100% /);
  });

  test("it waits for the window's attribution to settle, and for real numbers", async () => {
    campaign('dog', DOG);
    campaign('broad', BROAD);
    const c = card();
    await plan(c.id);
    syncedAfter(29);
    evaluateExperiments(db);
    expect(listEvidence(db, c.id)).toEqual([]);
    syncedAfter(30);
    db.prepare(`UPDATE stores SET demo = 1 WHERE id = 'peak'`).run();
    evaluateExperiments(db);
    expect(listEvidence(db, c.id)).toEqual([]);
    db.prepare(`UPDATE stores SET demo = 0 WHERE id = 'peak'`).run();
    evaluateExperiments(db);
    expect(listEvidence(db, c.id)).toHaveLength(1);
  });

  test("a creative's side is its ads' results, outside the side's own campaigns: nothing counted twice", async () => {
    const [hook, plain] = [creative('Problem-first'), creative('Product shot')];
    campaign('broad', BROAD);
    ad('a1', 'broad', hook, { spend: 1000, revenue: 9000, purchases: 50 }); // in a campaign on the other side: still its own
    ad('a2', 'mixed', hook, { spend: 1000, revenue: 3000, purchases: 20 });
    ad('a3', 'mixed', plain, { spend: 1000, revenue: 1000, purchases: 30 });
    const c = card();
    await plan(c.id, { variants: [{ label: 'Product shot', campaigns: [], creatives: [plain] }, { label: 'Problem-first', campaigns: ['meta:broad'], creatives: [hook] }], minSample: 30 });
    syncedAfter(30);
    evaluateExperiments(db);
    // B = campaign broad (2800 → 4200) + a2 (a1 is inside broad): 6200 / 3800; A = a3: 1.00.
    expect(listEvidence(db, c.id)[0]!.text).toMatch(/ROAS 1\.89 vs 1\.00: \+89% .*on 80 and 30 purchases/);
  });
});

describe('the Campaigns library', () => {
  test('each campaign with its numbers, dates, ads, ad sets, creatives, tests and the lessons read from it or its ads', async () => {
    const hook = creative('Problem-first', 'problem-first');
    campaign('dog', DOG, addDays(W().from, 28)); // ran last: listed first
    campaign('broad', BROAD);
    ad('a1', 'dog', hook, { spend: 100, revenue: 300, purchases: 3 });
    db.prepare(`INSERT INTO ads (network, id, campaign_id, group_id, name, status) VALUES ('meta', 'a2', 'dog', 's2', 'Plain', 'active'), ('meta', 'a3', 'dog', 's1', 'Plain 2', 'active')`).run();
    db.prepare(`INSERT INTO campaigns (network, id, store_id, name, status, daily_budget) VALUES ('meta', 'idle', 'peak', 'Never ran', 'paused', 10)`).run();
    const reading = { storeId: 'peak', subject: 'ad:meta:a1', name: 'The "Ad a1" ad (Meta)', metric: 'roas', label: 'ROAS', vs: 'the other ads in its ad set', value: 3, baseline: 1, k: 50, kBase: 50, n: 50, unit: 'purchases', show: String, confounds: [], path: ['Creative'] };
    learn(db, { ...reading, ref: 'r2', from: '2026-02-01', to: '2026-02-28' });
    learn(db, { ...reading, ref: 'r1', from: '2026-01-01', to: '2026-01-28' });
    const lesson = db.prepare(`SELECT id, title FROM kb_cards WHERE origin = 'performance'`).get() as { id: string; title: string };
    // Archived cards aren't listed: a lesson, and a test's card.
    learn(db, { ...reading, ref: 'r3', subject: 'campaign:meta:dog', name: 'The "Campaign dog" campaign (Meta)', from: '2026-01-01', to: '2026-01-28' });
    db.prepare(`UPDATE kb_cards SET status = 'archived' WHERE title LIKE 'The "Campaign dog" campaign%'`).run();
    const gone = card('peak', { title: 'Archived after its test' });
    await plan(gone.id, { variants: [{ label: 'A', campaigns: ['meta:broad'] }, { label: 'B', campaigns: ['meta:dog'] }] });
    db.prepare(`UPDATE kb_cards SET status = 'archived' WHERE id = ?`).run(gone.id);
    const tested = card();
    const e = (await plan(tested.id, { variants: [{ label: 'A', campaigns: ['meta:broad'] }, { label: 'B', creatives: [hook] }] })).body as KbExperiment;
    const list = (await req('/api/kb/campaigns?ws=peak')).body as KbCampaign[];
    expect(list.map((x) => x.id)).toEqual(['dog', 'broad', 'idle']);
    const dog = list[0]!;
    expect(dog).toMatchObject({
      network: 'meta', storeId: 'peak', name: 'Campaign dog', status: 'active', from: addDays(W().from, 28), to: addDays(W().from, 55),
      spend: 2800, revenue: 8400, purchases: 60, clicks: 1000, impressions: 50_000, ads: 3, groups: 2,
      creatives: [{ id: hook, headline: 'Problem-first', primaryText: 'Problem-first, the copy', hook: 'problem-first' }],
      experiments: [{ id: e.id, cardId: tested.id, status: 'planned', ...W() }, expect.objectContaining({ cardId: gone.id })], // newest first
    });
    expect(dog.cards).toEqual([
      { id: lesson.id, title: 'The "Ad a1" ad (Meta): ROAS above the other ads in its ad set', stage: 'validated', from: '2026-02-01', to: '2026-02-28' }, // its latest window
      { id: tested.id, title: tested.title, stage: 'hypothesis', ...W() },
    ]);
    expect(list[2]).toMatchObject({ id: 'idle', spend: 0, ads: 0, groups: 0, creatives: [], experiments: [], cards: [] });
    expect(list[2]!.from).toBeUndefined();
    expect((await req('/api/kb/campaigns?ws=general')).body).toEqual([]);
    expect(((await req('/api/kb/campaigns?ws=all')).body as KbCampaign[]).some((x) => x.storeId === 'pawsome')).toBe(true);
    expect((await req('/api/kb/campaigns?ws=nope')).status).toBe(400);
  });
});


test.each([1, 29])('planning refuses a minimum sample of %s', async (minSample) => {
  campaign('dog', DOG); campaign('broad', BROAD);
  expect(await plan(card().id, { minSample })).toMatchObject({ status: 400, body: { error: 'minSample must be a whole number from 30' } });
});

test('a legacy minimum of one cannot turn a tiny sample into measured evidence', async () => {
  campaign('dog', { spend: 10, revenue: 100, purchases: 20 });
  campaign('broad', { spend: 10, revenue: 1, purchases: 1 });
  const c = card();
  const e = (await plan(c.id)).body as KbExperiment;
  const row = db.prepare('SELECT plan_json FROM kb_experiments WHERE id = ?').get(e.id)!;
  db.prepare('UPDATE kb_experiments SET plan_json = ? WHERE id = ?').run(JSON.stringify({ ...JSON.parse(String(row.plan_json)), minSample: 1 }), e.id);
  syncedAfter(30);
  evaluateExperiments(db);
  expect(listEvidence(db, c.id)[0]).toMatchObject({ kind: 'observed', text: expect.stringContaining('each side needed 30 purchases') });
});
