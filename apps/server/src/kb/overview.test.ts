import { createResearchTask, getResearchTask, openConflict, saveSource } from '@frontline/agents';
import type { KbCard, KbOverview, KbSourceBrief, KbTaskBrief } from '@frontline/shared';
import { beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';

let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  app = createApp(db);
});
const req = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
const ok = async <T>(method: string, path: string, body?: unknown, status = 200): Promise<T> => {
  const res = await req(method, path, body);
  const json = res.status === 204 ? undefined : await res.json();
  expect(res.status, JSON.stringify(json)).toBe(status);
  return json as T;
};
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();
/** A card in `ws` under `path`, at `stage`, made `age` days ago. */
const card = async (ws: string, path: string[], title: string, stage = 'hypothesis', age = 0) => {
  const c = await ok<KbCard>('POST', '/api/kb/cards', { ws, category: path, title }, 201);
  db.prepare('UPDATE kb_cards SET stage = ?, created_at = ? WHERE id = ?').run(stage, daysAgo(age), c.id);
  return c;
};
const overview = (ws: string) => ok<KbOverview>('GET', `/api/kb/overview?ws=${ws}`);
const none = { hypothesis: 0, supported: 0, tested: 0, validated: 0 };

describe('Research Center overview', () => {
  test('the tiles, the map by root category and stage, and the gaps, for one workspace or all', async () => {
    // Made out of order (General first, Pricing before Advertising): the sorting and the merge decide the order.
    await card('general', ['Advertising'], 'Pain relief outsells gain', 'tested', 120);
    await card('pawsome', ['Pricing'], 'Bundles beat discounts');
    await card('pawsome', ['Pricing'], 'Charm prices still work', 'hypothesis', 200);
    const gone = await card('pawsome', ['Pricing'], 'Old idea');
    await ok('PATCH', `/api/kb/cards/${gone.id}?ws=pawsome`, { status: 'archived' });
    const won = await card('pawsome', ['Advertising', 'Video hooks'], 'Problem-first hooks win', 'validated');
    await card('pawsome', ['Advertising', 'Video hooks'], 'UGC beats studio footage');
    await card('pawsome', ['Advertising'], 'Open on the reaction', 'supported', 100);
    await card('glow', ['SEO'], 'Long titles rank', 'hypothesis', 10);

    const paw = await overview('pawsome');
    expect(paw).toMatchObject({ cards: 5, thisWeek: 3, validated: 1, hypotheses: 3, supported: 1, stale: 2, conflicts: 0, running: 0, queued: 0, researchers: 0, sources: 0 });
    const adv = db.prepare(`SELECT id FROM kb_categories WHERE store_id = 'pawsome' AND name = 'Advertising'`).get()!.id;
    const pricing = db.prepare(`SELECT id FROM kb_categories WHERE store_id = 'pawsome' AND name = 'Pricing'`).get()!.id;
    expect(paw.map).toEqual([
      { ws: 'pawsome', categoryId: adv, name: 'Advertising', stages: { ...none, hypothesis: 1, supported: 1, validated: 1 } },
      { ws: 'pawsome', categoryId: pricing, name: 'Pricing', stages: { ...none, hypothesis: 2 } },
    ]);
    // Weakest first: only hypotheses, then mostly stale, then nothing measured.
    expect(paw.gaps).toEqual([
      { ws: 'pawsome', categoryId: pricing, name: 'Pricing', reason: 'only hypotheses' },
      { ws: 'pawsome', categoryId: adv, name: 'Advertising', reason: '0 measured' },
    ]);
    db.prepare(`INSERT INTO kb_evidence (id, card_id, kind, text, metric, value, test_ref, author_id, created_at) VALUES ('e1', ?, 'measured', 'ROAS 2.6 vs 1.5', 'roas', 2.6, 't1', 'owner', ?)`).run(won.id, daysAgo(0));
    expect((await overview('pawsome')).gaps.map((g) => g.name)).toEqual(['Pricing']);

    // All workspaces adds up same-named roots, each linking to the workspace holding most of them.
    const all = await overview('all');
    expect(all).toMatchObject({ cards: 7, thisWeek: 3, validated: 1, hypotheses: 4, stale: 3 });
    expect(all.map.map((m) => [m.name, m.ws, Object.values(m.stages).reduce((a, b) => a + b)])).toEqual([
      ['Advertising', 'pawsome', 4],
      ['Pricing', 'pawsome', 2],
      ['SEO', 'glow', 1],
    ]);
    expect(all.gaps.map((g) => [g.ws, g.name, g.reason])).toEqual([
      ['pawsome', 'Pricing', 'only hypotheses'],
      ['glow', 'SEO', 'only hypotheses'],
      ['general', 'Advertising', '1 of 1 stale'],
    ]);
    expect(await overview('general')).toMatchObject({ cards: 1, stale: 1, map: [{ name: 'Advertising', stages: { ...none, tested: 1 } }] });
    expect((await req('GET', '/api/kb/overview?ws=nope')).status).toBe(400);
    expect((await req('GET', '/api/kb/overview')).status).toBe(400);
  });

  test('research now: running and queued tasks, the agents running them, and the sources read into the workspace', async () => {
    const task = (ws: string | null, payerId: string, role: 'market_analyst' | 'ad_strategist', status: string) => {
      const t = createResearchTask(db, { ws, payerId, role, kind: 'topic', origin: 'owner', objective: `Hooks ${status} ${role}`, budgetUsd: 1 });
      db.prepare('UPDATE kb_tasks SET status = ? WHERE id = ?').run(status, t.id);
    };
    task('pawsome', 'pawsome', 'market_analyst', 'running');
    task('pawsome', 'pawsome', 'market_analyst', 'running');
    task('pawsome', 'pawsome', 'ad_strategist', 'running');
    task('pawsome', 'pawsome', 'ad_strategist', 'queued');
    task('pawsome', 'pawsome', 'ad_strategist', 'done');
    task(null, 'glow', 'market_analyst', 'running');
    const at = new Date().toISOString();
    saveSource(db, 'pawsome', { kind: 'text', title: 'Notes', status: 'read', text: 'Hooks matter', fetchedAt: at });
    saveSource(db, null, { kind: 'text', title: 'General notes', status: 'read', text: 'Hooks matter a lot', fetchedAt: at });
    expect(await overview('pawsome')).toMatchObject({ running: 3, queued: 1, researchers: 2, sources: 1 });
    expect(await overview('all')).toMatchObject({ running: 4, queued: 1, researchers: 3, sources: 2 });
    // The Sources tab lists every workspace's sources in All workspaces.
    expect((await ok<KbSourceBrief[]>('GET', '/api/kb/sources?ws=all')).map((s) => s.title)).toEqual(['General notes', 'Notes']);
  });

  test('discoveries: cards that moved up to Validated this week and open conflicts, newest first; Keep both closes a conflict', async () => {
    const won = await card('pawsome', ['Advertising'], 'Problem-first hooks win', 'validated');
    const old = await card('pawsome', ['Advertising'], 'Old win', 'validated');
    const ugc = await card('pawsome', ['Advertising'], 'UGC beats studio footage');
    const other = await card('glow', ['Advertising'], 'Glow secret', 'validated');
    const moved = (id: string, age: number) =>
      db.prepare(`INSERT INTO kb_revisions (card_id, actor, reason, snapshot_json, created_at) VALUES (?, 'app', 'Moved up to Validated: 2 independent measured tests', '{}', ?)`).run(id, daysAgo(age));
    moved(won.id, 2);
    moved(old.id, 9);
    moved(other.id, 1);
    moved(ugc.id, 1); // moved up, then back down: no longer Validated
    openConflict(db, { storeId: 'pawsome', cardId: ugc.id, otherCardId: won.id, note: 'Research says UGC wins; EXP-14 says studio' }, new Date(Date.now() - DAY));

    const d = (await overview('pawsome')).discoveries;
    expect(d.map((x) => [x.kind, x.card.title])).toEqual([
      ['conflict', 'UGC beats studio footage'],
      ['validated', 'Problem-first hooks win'],
    ]);
    expect(d[0]).toMatchObject({ kind: 'conflict', note: 'Research says UGC wins; EXP-14 says studio', other: { id: won.id, title: 'Problem-first hooks win' } });
    expect(d[1]).toMatchObject({ kind: 'validated', reason: '2 independent measured tests', card: { id: won.id, path: ['Advertising'] } });
    expect((await overview('pawsome')).conflicts).toBe(1);

    const conflict = d[0]!.kind === 'conflict' ? d[0]!.id : '';
    expect((await req('PATCH', `/api/kb/conflicts/${conflict}?ws=glow`, { status: 'kept_both' })).status).toBe(404);
    expect(await ok('PATCH', `/api/kb/conflicts/${conflict}?ws=pawsome`, { status: 'resolved' }, 400)).toEqual({ error: 'status must be kept_both' });
    await ok('PATCH', `/api/kb/conflicts/${conflict}?ws=pawsome`, { status: 'kept_both' }, 204);
    expect(await overview('pawsome')).toMatchObject({ conflicts: 0, discoveries: [{ kind: 'validated' }] });
    expect(db.prepare('SELECT status, resolved_at FROM kb_conflicts WHERE id = ?').get(conflict)).toMatchObject({ status: 'kept_both', resolved_at: expect.any(String) });
  });

  test('Refine: a finished task again with a changed request, as a new task pointing back; a going one is refused', async () => {
    const t = createResearchTask(db, { ws: 'pawsome', payerId: 'pawsome', role: 'market_analyst', kind: 'topic', origin: 'owner', objective: 'Hooks', budgetUsd: 1, brief: { depth: 'quick' } });
    expect(await ok('POST', `/api/kb/research/tasks/${t.id}/refine`, { objective: 'Hooks for travel crates' }, 409)).toEqual({ error: 'Only a finished task can be refined' });
    db.prepare(`UPDATE kb_tasks SET status = 'done' WHERE id = ?`).run(t.id);
    expect(await ok('POST', `/api/kb/research/tasks/${t.id}/refine`, { objective: 'no' }, 400)).toEqual({ error: 'objective must be 3-500 characters' });
    expect(await ok('POST', `/api/kb/research/tasks/${t.id}/refine`, { budgetUsd: 50 }, 400)).toEqual({ error: 'budgetUsd must be between $0.10 and $20' });
    expect((await req('POST', '/api/kb/research/tasks/nope/refine', {})).status).toBe(404);
    const r = await ok<KbTaskBrief>('POST', `/api/kb/research/tasks/${t.id}/refine`, { objective: ' Hooks for travel crates ', budgetUsd: 2 }, 201);
    expect(r).toMatchObject({ storeId: 'pawsome', role: 'market_analyst', objective: 'Hooks for travel crates' });
    expect(getResearchTask(db, r.id)).toMatchObject({ refinedFrom: t.id, budgetUsd: 2, kind: 'topic', brief: { depth: 'quick' } });
    // Nothing changed: the same request again.
    const same = await ok<KbTaskBrief>('POST', `/api/kb/research/tasks/${t.id}/refine`, {}, 201);
    expect(getResearchTask(db, same.id)).toMatchObject({ objective: 'Hooks', budgetUsd: 1, refinedFrom: t.id });
  });
});
