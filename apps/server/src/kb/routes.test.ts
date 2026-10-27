import type { KbCard, KbCardBrief, KbCategoryCount, KbTaskBrief, KbView, Page } from '@frontline/shared';
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
const create = (ws: string, title: string, extra: Record<string, unknown> = {}) => ok<KbCard>('POST', '/api/kb/cards', { ws, category: ['Advertising'], title, ...extra }, 201);
const list = (qs: string) => ok<Page<KbCardBrief>>('GET', `/api/kb/cards?${qs}`).then((p) => p.items.map((c) => c.title));
const revisions = (id: string) => db.prepare('SELECT actor, reason FROM kb_revisions WHERE card_id = ? ORDER BY id').all(id).map((r) => `${r.actor}: ${r.reason}`);

describe('workspaces', () => {
  test('counts the visible cards (proposed + active) in General and each store; empty ones are left out', async () => {
    await create('general', 'Hooks decide the first 3 seconds');
    await create('pawsome', 'Rescue stories pull clicks');
    const gone = await create('pawsome', 'Old idea');
    await ok('PATCH', `/api/kb/cards/${gone.id}?ws=pawsome`, { status: 'archived' });
    expect(await ok('GET', '/api/kb/workspaces')).toEqual({ general: 1, pawsome: 1 });
  });
});

describe('artboard positions', () => {
  test("each workspace keeps its own places, a General card included; other stores' cards and bad numbers are refused", async () => {
    const own = await create('pawsome', 'Rescue stories pull clicks');
    const general = await create('general', 'Hooks decide the first 3 seconds');
    const other = await create('glow', 'Glow secret');
    await ok('PUT', '/api/kb/positions?ws=pawsome', { [own.id]: { x: 40, y: 60 }, [general.id]: { x: 300, y: 44 } }, 204);
    await ok('PUT', '/api/kb/positions?ws=pawsome', { [own.id]: { x: 48, y: 60 } }, 204);
    await ok('PUT', '/api/kb/positions?ws=general', { [general.id]: { x: 16, y: 44 } }, 204);
    expect(await ok('GET', '/api/kb/positions?ws=pawsome')).toEqual({ [own.id]: { x: 48, y: 60 }, [general.id]: { x: 300, y: 44 } });
    expect(await ok('GET', '/api/kb/positions?ws=general')).toEqual({ [general.id]: { x: 16, y: 44 } });
    expect((await req('PUT', '/api/kb/positions?ws=pawsome', { [other.id]: { x: 1, y: 1 } })).status).toBe(404);
    expect((await req('PUT', '/api/kb/positions?ws=general', { [own.id]: { x: 1, y: 1 } })).status).toBe(404);
    expect((await req('PUT', '/api/kb/positions?ws=pawsome', { [own.id]: { x: 'left', y: 1 } })).status).toBe(400);
    expect((await req('PUT', '/api/kb/positions?ws=all', {})).status).toBe(400);
    expect(await ok('GET', '/api/kb/positions?ws=pawsome')).toEqual({ [own.id]: { x: 48, y: 60 }, [general.id]: { x: 300, y: 44 } });
  });
});

describe('saved artboard views', () => {
  test('save, list and delete per workspace; another workspace never sees them', async () => {
    const state = { q: 'hooks', general: false, camera: { x: -40, y: 10, scale: 0.8 }, collapsed: ['p-ads'] };
    const v = await ok<KbView>('POST', '/api/kb/views', { ws: 'pawsome', name: ' Hooks only ', state }, 201);
    expect(v).toMatchObject({ storeId: 'pawsome', name: 'Hooks only', state });
    expect((await ok<KbView[]>('GET', '/api/kb/views?ws=pawsome')).map((x) => x.name)).toEqual(['Hooks only']);
    expect(await ok('GET', '/api/kb/views?ws=glow')).toEqual([]);
    expect(await ok('GET', '/api/kb/views?ws=general')).toEqual([]);
    expect((await req('POST', '/api/kb/views', { ws: 'pawsome', name: '', state })).status).toBe(400);
    expect((await req('POST', '/api/kb/views', { ws: 'pawsome', name: 'x', state: { camera: { x: 'far' } } })).status).toBe(400);
    expect((await req('DELETE', `/api/kb/views/${v.id}?ws=glow`)).status).toBe(404);
    await ok('DELETE', `/api/kb/views/${v.id}?ws=pawsome`, undefined, 204);
    expect(await ok('GET', '/api/kb/views?ws=pawsome')).toEqual([]);
  });

  test("a Library view keeps its filters (strings only)", async () => {
    const state = { q: '', general: true, filters: { stage: 'tested', sort: 'title', dir: 'asc' } };
    expect(await ok<KbView>('POST', '/api/kb/views', { ws: 'pawsome', name: 'Tested', state }, 201)).toMatchObject({ state });
    expect((await req('POST', '/api/kb/views', { ws: 'pawsome', name: 'Bad', state: { filters: { stage: 3 } } })).status).toBe(400);
    expect((await req('POST', '/api/kb/views', { ws: 'pawsome', name: 'Bad', state: { filters: ['stage'] } })).status).toBe(400);
  });
});

describe('sources', () => {
  test("lists a workspace's sources by title, General's too when asked; never another store's", async () => {
    const add = db.prepare(`INSERT INTO kb_sources (id, store_id, kind, url, title, status, reliability, fetched_at, created_at) VALUES (?, ?, 'url', ?, ?, 'read', 'platform_docs', '2026-10-01', '2026-10-01')`);
    add.run('s1', 'pawsome', 'https://b.test', 'TikTok ads guide');
    add.run('s2', 'pawsome', 'https://a.test', 'Meta ad library');
    add.run('s3', null, 'https://c.test', 'Hook study');
    add.run('s4', 'glow', 'https://d.test', 'Glow secret');
    expect(await ok('GET', '/api/kb/sources?ws=pawsome')).toEqual([
      { id: 's2', url: 'https://a.test', title: 'Meta ad library', status: 'read', reliability: 'platform_docs', fetchedAt: '2026-10-01' },
      { id: 's1', url: 'https://b.test', title: 'TikTok ads guide', status: 'read', reliability: 'platform_docs', fetchedAt: '2026-10-01' },
    ]);
    expect((await ok<{ id: string }[]>('GET', '/api/kb/sources?ws=pawsome&general=1')).map((s) => s.id)).toEqual(['s3', 's2', 's1']);
    expect((await ok<{ id: string }[]>('GET', '/api/kb/sources?ws=general')).map((s) => s.id)).toEqual(['s3']);
    expect((await req('GET', '/api/kb/sources?ws=nope')).status).toBe(400);
  });
});

describe('research tasks for the dock', () => {
  test('lists the open tasks of a workspace (or all), newest first', async () => {
    const task = (id: string, storeId: string | null, status: string, at: string) =>
      db.prepare(`INSERT INTO kb_tasks (id, store_id, payer_id, role, kind, origin, objective, status, stage, budget_usd, created_at) VALUES (?, ?, 'pawsome', 'market_analyst', 'topic', 'owner', ?, ?, 'discovering', 1, ?)`).run(id, storeId, `Objective ${id}`, status, at);
    task('t1', 'pawsome', 'running', '2026-10-27T10:00:00Z');
    task('t2', 'pawsome', 'queued', '2026-10-27T11:00:00Z');
    task('t3', 'pawsome', 'done', '2026-10-27T12:00:00Z');
    task('t4', null, 'running', '2026-10-27T09:00:00Z');
    task('t5', 'glow', 'running', '2026-10-27T09:30:00Z');
    expect((await ok<KbTaskBrief[]>('GET', '/api/kb/research/tasks?ws=pawsome&open=1')).map((t) => t.id)).toEqual(['t2', 't1']);
    expect((await ok<KbTaskBrief[]>('GET', '/api/kb/research/tasks?ws=pawsome')).map((t) => t.id)).toEqual(['t3', 't2', 't1']);
    expect((await ok<KbTaskBrief[]>('GET', '/api/kb/research/tasks?ws=general&open=1')).map((t) => t.id)).toEqual(['t4']);
    expect((await ok<KbTaskBrief[]>('GET', '/api/kb/research/tasks?ws=all&open=1')).map((t) => t.id)).toEqual(['t2', 't1', 't5', 't4']);
    expect((await ok<KbTaskBrief[]>('GET', '/api/kb/research/tasks?ws=pawsome&open=1'))[0]).toMatchObject({ storeId: 'pawsome', payerId: 'pawsome', role: 'market_analyst', objective: 'Objective t2', status: 'queued', stage: 'discovering' });
  });
});

describe('cards', () => {
  test("the owner's card is User-Provided and active, filed under a path made as needed, with a first revision", async () => {
    const c = await create('pawsome', 'Rescue stories pull clicks', { category: ['advertising', 'Creative Strategy', 'Video Hooks'], summary: 'Dog owners stop for rescue arcs', tags: ['tiktok', ' hooks '] });
    expect(c).toMatchObject({ storeId: 'pawsome', path: ['Advertising', 'Creative Strategy', 'Video Hooks'], type: 'user_provided', stage: 'hypothesis', status: 'active', authorId: 'owner', origin: 'owner', tags: ['tiktok', 'hooks'], pinned: false });
    expect(revisions(c.id)).toEqual(['owner: Created']);
    const again = await create('pawsome', 'Second card', { category: ['Advertising', 'creative strategy', 'Video Hooks'] });
    expect(again.categoryId).toBe(c.categoryId); // the path is reused, not duplicated
    const general = await create('general', 'Hooks decide the first 3 seconds');
    expect(general).toMatchObject({ storeId: null, categoryId: 'general-advertising', path: ['Advertising'] });
  });

  test('bad input is refused with a reason', async () => {
    const bad = async (body: Record<string, unknown>, error: RegExp) => {
      const res = await req('POST', '/api/kb/cards', { ws: 'pawsome', category: ['Advertising'], title: 'A fine title', ...body });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(error);
    };
    await bad({ title: 'ab' }, /title/);
    await bad({ type: 'rumour' }, /type/);
    await bad({ stage: 'certain' }, /stage/);
    await bad({ type: 'validated_insight' }, /Validated Insight/);
    await bad({ tags: ['x'.repeat(41)] }, /tags/);
    await bad({ category: [] }, /category/);
    await bad({ ws: 'nowhere' }, /ws/);
    await bad({ category: undefined, categoryId: 'general-advertising' }, /category/); // General's category, a store's card
  });

  test('the same title twice in a workspace is a conflict', async () => {
    await create('general', 'Hooks decide the first 3 seconds');
    expect((await req('POST', '/api/kb/cards', { ws: 'general', category: ['Advertising'], title: 'hooks decide the first 3 seconds' })).status).toBe(409);
  });

  test('the list filters by every §13 field, sorts and pages', async () => {
    const a = await create('pawsome', 'Rescue stories pull clicks', { category: ['Advertising', 'Creative Strategy'], tags: ['tiktok'], stage: 'supported', summary: 'Emotional open' });
    await create('pawsome', 'Free shipping over $50', { category: ['Sales & Pricing'], tags: ['offer'] });
    await create('general', 'Hooks decide the first 3 seconds', { tags: ['tiktok'] });
    await create('glow', 'Glow secret');
    db.prepare(`UPDATE kb_cards SET author_id = 'pawsome:ad_strategist', origin = 'research', created_at = '2026-01-05T00:00:00Z', verified_at = '2026-02-01T00:00:00Z' WHERE id = ?`).run(a.id);
    db.prepare(`INSERT INTO kb_sources (id, store_id, kind, url, status, created_at) VALUES ('s1', 'pawsome', 'url', 'https://a.test', 'read', '2026-01-01')`).run();
    db.prepare(`INSERT INTO kb_evidence (id, card_id, kind, text, source_id, metric, author_id, created_at) VALUES ('e1', ?, 'research', 'x', 's1', 'ctr', 'owner', '2026-01-01')`).run(a.id);

    expect(await list('ws=pawsome&sort=title&dir=asc')).toEqual(['Free shipping over $50', 'Rescue stories pull clicks']);
    expect(await list('ws=pawsome&general=1&sort=title&dir=asc')).toEqual(['Free shipping over $50', 'Hooks decide the first 3 seconds', 'Rescue stories pull clicks']);
    expect(await list('ws=general')).toEqual(['Hooks decide the first 3 seconds']);
    expect((await list('ws=all')).sort()).toEqual(['Free shipping over $50', 'Glow secret', 'Hooks decide the first 3 seconds', 'Rescue stories pull clicks']);
    expect(await list('ws=pawsome&q=emotional')).toEqual(['Rescue stories pull clicks']);
    expect(await list(`ws=pawsome&category=${a.categoryId}`)).toEqual(['Rescue stories pull clicks']);
    const advertising = db.prepare(`SELECT id FROM kb_categories WHERE store_id = 'pawsome' AND name = 'Advertising'`).get()?.id;
    expect(await list(`ws=pawsome&category=${advertising}`)).toEqual(['Rescue stories pull clicks']); // the subtree
    expect(await list('ws=pawsome&agent=ad_strategist')).toEqual(['Rescue stories pull clicks']);
    expect(await list('ws=pawsome&agent=owner')).toEqual(['Free shipping over $50']);
    expect(await list('ws=pawsome&source=s1')).toEqual(['Rescue stories pull clicks']);
    expect(await list('ws=pawsome&createdTo=2026-01-31')).toEqual(['Rescue stories pull clicks']);
    expect(await list('ws=pawsome&verifiedFrom=2026-01-15')).toEqual(['Rescue stories pull clicks']);
    expect(await list('ws=pawsome&stage=supported,validated')).toEqual(['Rescue stories pull clicks']);
    expect(await list('ws=pawsome&type=user_provided&sort=title')).toEqual(['Rescue stories pull clicks', 'Free shipping over $50']);
    expect(await list('ws=pawsome&metric=ctr')).toEqual(['Rescue stories pull clicks']);
    expect(await list('ws=pawsome&general=1&tag=tiktok&sort=title&dir=asc')).toEqual(['Hooks decide the first 3 seconds', 'Rescue stories pull clicks']);
    const page = await ok<Page<KbCardBrief>>('GET', '/api/kb/cards?ws=pawsome&general=1&sort=title&dir=asc&offset=1&limit=1');
    expect(page).toMatchObject({ total: 3, offset: 1, limit: 1 });
    expect(page.items.map((c) => c.title)).toEqual(['Hooks decide the first 3 seconds']);
    expect((await req('GET', '/api/kb/cards?ws=pawsome&stage=sure')).status).toBe(400);
    expect((await req('GET', '/api/kb/cards')).status).toBe(400);
  });

  test('every change is a revision with its reason; the manual controls all work and reverse', async () => {
    const c = await create('pawsome', 'Rescue stories pull clicks');
    const patch = (body: Record<string, unknown>) => ok<KbCard>('PATCH', `/api/kb/cards/${c.id}?ws=pawsome`, body);
    expect(await patch({ summary: 'Emotional open', reason: 'Clearer' })).toMatchObject({ summary: 'Emotional open' });
    expect(await patch({ pinned: true })).toMatchObject({ pinned: true });
    expect(await patch({ blockedRoles: ['*'] })).toMatchObject({ blockedRoles: ['*'] });
    expect(await patch({ blockedRoles: ['copywriter', 'ad_strategist'] })).toMatchObject({ blockedRoles: ['copywriter', 'ad_strategist'] });
    expect(await patch({ blockedRoles: [] })).toMatchObject({ blockedRoles: [] });
    expect(await patch({ researchMarked: true })).toMatchObject({ researchMarked: true });
    expect(await patch({ status: 'archived' })).toMatchObject({ status: 'archived' });
    expect(await patch({ status: 'active' })).toMatchObject({ status: 'active' });
    expect(await patch({ status: 'rejected', reason: 'Wrong niche' })).toMatchObject({ status: 'rejected' });
    expect(await patch({ status: 'active' })).toMatchObject({ status: 'active' });
    expect(await patch({ stage: 'validated', type: 'validated_insight' })).toMatchObject({ stage: 'validated', type: 'validated_insight' });
    expect((await req('PATCH', `/api/kb/cards/${c.id}?ws=pawsome`, { blockedRoles: ['janitor'] })).status).toBe(400);
    expect((await req('PATCH', `/api/kb/cards/${c.id}?ws=pawsome`, { status: 'merged' })).status).toBe(400);
    expect(revisions(c.id)).toEqual([
      'owner: Created',
      'owner: Edited summary: Clearer',
      'owner: Pinned',
      'owner: Blocked from every agent',
      'owner: Blocked from copywriter, ad_strategist',
      'owner: Unblocked',
      'owner: Marked for research',
      'owner: Archived',
      'owner: Restored',
      'owner: Rejected: Wrong niche',
      'owner: Restored',
      'owner: Edited type, stage',
    ]);
  });

  test('bulk: one change to many cards of a workspace at once, each with its revision; all or nothing', async () => {
    const [x, y] = [await create('pawsome', 'Rescue stories pull clicks'), await create('pawsome', 'Bundles beat discounts')];
    const g = await create('general', 'Hooks decide the first 3 seconds');
    const bulk = (ws: string, ids: string[], patch: object) => req('POST', '/api/kb/cards/bulk', { ws, ids, patch });
    expect(await ok('POST', '/api/kb/cards/bulk', { ws: 'pawsome', ids: [x.id, y.id], patch: { researchMarked: true } })).toEqual({ updated: 2 });
    await ok('POST', '/api/kb/cards/bulk', { ws: 'pawsome', ids: [x.id, y.id], patch: { blockedRoles: ['*'], category: ['Advertising', 'Hooks'] } });
    for (const id of [x.id, y.id]) expect(await ok<KbCard>('GET', `/api/kb/cards/${id}?ws=pawsome`)).toMatchObject({ researchMarked: true, blockedRoles: ['*'], path: ['Advertising', 'Hooks'] });
    expect(revisions(x.id)).toHaveLength(3);
    // A card of another workspace, a field bulk can't set, a bad value: nothing changes.
    expect((await bulk('pawsome', [x.id, g.id], { status: 'archived' })).status).toBe(404);
    expect((await bulk('pawsome', [x.id], { title: 'Same title' })).status).toBe(400);
    expect((await bulk('pawsome', [x.id], { status: 'merged' })).status).toBe(400);
    expect((await bulk('pawsome', [], { status: 'archived' })).status).toBe(400);
    expect((await bulk('all', [x.id], { status: 'archived' })).status).toBe(400);
    expect((await ok<KbCard>('GET', `/api/kb/cards/${x.id}?ws=pawsome`)).status).toBe('active');
    await ok('POST', '/api/kb/cards/bulk', { ws: 'general', ids: [g.id], patch: { status: 'archived' } });
    expect((await ok<KbCard>('GET', `/api/kb/cards/${g.id}?ws=general`)).status).toBe('archived');
    // A merged card comes back by detaching, not by a status.
    await ok('POST', `/api/kb/cards/${x.id}/merge?ws=pawsome`, { from: y.id });
    expect((await bulk('pawsome', [x.id, y.id], { status: 'active' })).status).toBe(409);
    expect((await ok<KbCard>('GET', `/api/kb/cards/${y.id}?ws=pawsome`)).status).toBe('merged');
  });

  test('accepting a proposed card makes it active', async () => {
    const c = await create('pawsome', 'Rescue stories pull clicks');
    db.prepare(`UPDATE kb_cards SET status = 'proposed' WHERE id = ?`).run(c.id);
    expect(await ok<KbCard>('PATCH', `/api/kb/cards/${c.id}?ws=pawsome`, { status: 'active' })).toMatchObject({ status: 'active' });
    expect(revisions(c.id).at(-1)).toBe('owner: Accepted');
  });

  test('merging keeps both histories: the evidence moves over, marked, and the other card points at the kept one', async () => {
    const keep = await create('pawsome', 'Rescue stories pull clicks', { tags: ['tiktok'] });
    const drop = await create('pawsome', 'Rescue arcs stop the scroll', { tags: ['hooks'] });
    db.prepare(`INSERT INTO kb_evidence (id, card_id, kind, text, author_id, created_at) VALUES ('e1', ?, 'observed', 'x', 'owner', '2026-01-01')`).run(drop.id);
    const merged = await ok<KbCard>('POST', `/api/kb/cards/${keep.id}/merge?ws=pawsome`, { from: drop.id });
    expect(merged.tags).toEqual(['tiktok', 'hooks']);
    expect(db.prepare(`SELECT card_id, merged_from FROM kb_evidence WHERE id = 'e1'`).get()).toEqual({ card_id: keep.id, merged_from: drop.id });
    expect(await ok<KbCard>('GET', `/api/kb/cards/${drop.id}?ws=pawsome`)).toMatchObject({ status: 'merged', mergedInto: keep.id });
    expect(revisions(keep.id).at(-1)).toBe('owner: Merged in "Rescue arcs stop the scroll"');
    expect(revisions(drop.id).at(-1)).toBe('owner: Merged into "Rescue stories pull clicks"');
    expect((await req('POST', `/api/kb/cards/${keep.id}/merge?ws=pawsome`, { from: keep.id })).status).toBe(400);
  });

  test("another workspace's card is a 404 on every by-id route", async () => {
    const c = await create('pawsome', 'Rescue stories pull clicks');
    const other = await create('glow', 'Glow secret');
    const general = await create('general', 'Hooks decide the first 3 seconds');
    for (const ws of ['glow', 'general']) {
      expect((await req('GET', `/api/kb/cards/${c.id}?ws=${ws}`)).status).toBe(404);
      expect((await req('GET', `/api/kb/cards/${c.id}?ws=${ws}&general=1`)).status).toBe(404);
      expect((await req('PATCH', `/api/kb/cards/${c.id}?ws=${ws}`, { pinned: true })).status).toBe(404);
      expect((await req('POST', `/api/kb/cards/${c.id}/merge?ws=${ws}`, { from: other.id })).status).toBe(404);
    }
    expect((await req('POST', `/api/kb/cards/${c.id}/merge?ws=pawsome`, { from: other.id })).status).toBe(404); // across stores
    expect((await req('POST', `/api/kb/cards/${c.id}/merge?ws=pawsome`, { from: general.id })).status).toBe(404); // General into a store
    expect((await req('PATCH', `/api/kb/cards/${general.id}?ws=pawsome&general=1`, { pinned: true })).status).toBe(404); // writes name the card's own workspace
    expect((await req('PATCH', `/api/kb/cards/${c.id}?ws=all`, { pinned: true })).status).toBe(400);
    expect(await ok<KbCard>('GET', `/api/kb/cards/${general.id}?ws=pawsome&general=1`)).toMatchObject({ id: general.id });
    expect(await ok<KbCard>('GET', `/api/kb/cards/${c.id}?ws=all`)).toMatchObject({ id: c.id }); // ?card= deep links
    expect(db.prepare('SELECT pinned FROM kb_cards WHERE id = ?').get(c.id)?.pinned).toBe(0);
  });
});

describe('categories', () => {
  const cats = (qs: string) => ok<KbCategoryCount[]>('GET', `/api/kb/categories?${qs}`);
  const add = (ws: string, name: string, parentId?: string) => ok<KbCategoryCount>('POST', '/api/kb/categories', { ws, name, parentId }, 201);

  test('a tree of any depth per workspace, with card counts', async () => {
    const ads = await add('pawsome', 'Advertising');
    const creative = await add('pawsome', 'Creative Strategy', ads.id);
    const hooks = await add('pawsome', 'Video Hooks', creative.id);
    const deeper = await add('pawsome', 'Openers', hooks.id);
    await create('pawsome', 'Rescue stories pull clicks', { categoryId: hooks.id, category: undefined });
    const tree = await cats('ws=pawsome');
    expect(tree.map((c) => [c.name, c.parentId, c.cards])).toEqual([
      ['Advertising', null, 0],
      ['Creative Strategy', ads.id, 0],
      ['Video Hooks', creative.id, 1],
      ['Openers', hooks.id, 0],
    ]);
    expect(deeper.storeId).toBe('pawsome');
    expect((await cats('ws=general')).length).toBe(16);
    expect((await cats('ws=pawsome&general=1')).length).toBe(20);
    expect((await cats('ws=glow')).length).toBe(0);
  });

  test('names are unique per parent, parents stay in the workspace, and a move never makes a loop', async () => {
    const ads = await add('pawsome', 'Advertising');
    const hooks = await add('pawsome', 'Video Hooks', ads.id);
    expect((await req('POST', '/api/kb/categories', { ws: 'pawsome', name: 'advertising' })).status).toBe(409);
    expect((await req('POST', '/api/kb/categories', { ws: 'pawsome', name: 'Pet stuff', parentId: 'general-advertising' })).status).toBe(400);
    expect((await req('POST', '/api/kb/categories', { ws: 'pawsome', name: '' })).status).toBe(400);
    expect((await req('PATCH', `/api/kb/categories/${ads.id}?ws=pawsome`, { parentId: hooks.id })).status).toBe(400);
    expect(await ok<KbCategoryCount>('PATCH', `/api/kb/categories/${hooks.id}?ws=pawsome`, { name: 'Hooks', parentId: null })).toMatchObject({ name: 'Hooks', parentId: null });
  });

  test('a category holding cards (anywhere below) cannot be deleted; an empty one goes with its children', async () => {
    const ads = await add('pawsome', 'Advertising');
    const hooks = await add('pawsome', 'Video Hooks', ads.id);
    const c = await create('pawsome', 'Rescue stories pull clicks', { categoryId: hooks.id, category: undefined });
    expect((await req('DELETE', `/api/kb/categories/${ads.id}?ws=pawsome`)).status).toBe(409);
    db.prepare('DELETE FROM kb_cards WHERE id = ?').run(c.id);
    expect((await req('DELETE', `/api/kb/categories/${ads.id}?ws=pawsome`)).status).toBe(204);
    expect(await cats('ws=pawsome')).toEqual([]);
  });

  test("another workspace's category is a 404", async () => {
    const ads = await add('pawsome', 'Advertising');
    expect((await req('PATCH', `/api/kb/categories/${ads.id}?ws=glow`, { name: 'X' })).status).toBe(404);
    expect((await req('DELETE', `/api/kb/categories/${ads.id}?ws=general`)).status).toBe(404);
    expect((await req('PATCH', `/api/kb/categories/general-advertising?ws=pawsome`, { name: 'X' })).status).toBe(404);
  });
});
