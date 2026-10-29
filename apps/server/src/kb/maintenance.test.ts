import { addEvidence, createCard, createResearchTask, ensureCategoryPath, saveSource, sourceForAgent, type NewKbCard } from '@frontline/agents';
import type { KbCard, KbCategoryCount, KbOverview, KbWorkspace } from '@frontline/shared';
import { beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { maintain } from './maintenance';

let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  app = createApp(db);
});
const DAY = 86_400_000;
const ago = (n: number) => new Date(Date.now() - n * DAY).toISOString();
/** PUT /api/kb/controls sends the version it read (settings ST-08b). */
const withVersion = async (method: string, path: string, body: unknown) =>
  method === 'PUT' && path.startsWith('/api/kb/controls') && body && typeof body === 'object' && !Array.isArray(body) && !('version' in body)
    ? { ...body, version: ((await (await app.request(path)).json()) as { version?: number }).version ?? 0 }
    : body;
const ok = async <T,>(method: string, path: string, body?: unknown, status = 200): Promise<T> => {
  body = await withVersion(method, path, body);
  const res = await app.request(path, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  const json = res.status === 204 ? undefined : await res.json();
  expect(res.status, JSON.stringify(json)).toBe(status);
  return json as T;
};
const card = (ws: KbWorkspace, path: string[], title: string, more: Partial<NewKbCard> = {}) =>
  createCard(db, ws, { categoryId: ensureCategoryPath(db, ws, path), title, type: 'strategy', stage: 'hypothesis', status: 'active', authorId: 'owner', origin: 'owner', ...more });
/** Last checked (and made) `days` ago. */
const age = (id: string, days: number) => db.prepare('UPDATE kb_cards SET created_at = ?, verified_at = ? WHERE id = ?').run(ago(days), ago(days), id);
const categoryId = (ws: string, name: string) => String(db.prepare('SELECT id FROM kb_categories WHERE coalesce(store_id, ?) = ? AND name = ?').get('general', ws, name)!.id);
const overview = (ws: string) => ok<KbOverview>('GET', `/api/kb/overview?ws=${ws}`);
const links = (type: string) => db.prepare('SELECT id, from_id, to_id, status, author_id FROM kb_links WHERE type = ? ORDER BY rowid').all(type);

describe('freshness by category', () => {
  test("each top-level category's usual age by its area; the owner's choice for one; subcategories follow their top", async () => {
    ensureCategoryPath(db, 'pawsome', ['Advertising', 'Video hooks']);
    ensureCategoryPath(db, 'pawsome', ['Consumer Psychology']);
    ensureCategoryPath(db, 'pawsome', ['Pricing']);
    const days = async (ws: string) => Object.fromEntries((await ok<KbCategoryCount[]>('GET', `/api/kb/categories?ws=${ws}`)).map((c) => [c.name, c.freshDays]));
    // Ad platforms move fast, how people decide slowly.
    expect(await days('pawsome')).toMatchObject({ Advertising: 45, 'Video hooks': 45, 'Consumer Psychology': 180, Pricing: 90 });
    await ok('PUT', '/api/kb/controls?ws=pawsome', { freshDays: { [categoryId('pawsome', 'Advertising')]: 14 } });
    expect(await days('pawsome')).toMatchObject({ Advertising: 14, 'Video hooks': 14, Pricing: 90 });
    expect(await days('general')).toMatchObject({ Advertising: 45 }); // General's own
    expect(await ok('PUT', '/api/kb/controls?ws=pawsome', { freshDays: { [categoryId('pawsome', 'Video hooks')]: 30 } }, 400)).toMatchObject({
      error: "freshDays must map this workspace's top-level categories to 7-730 days",
    });
    expect(await ok('PUT', '/api/kb/controls?ws=pawsome', { freshDays: { [categoryId('pawsome', 'Pricing')]: 3 } }, 400)).toMatchObject({ error: expect.stringMatching(/^freshDays/) });
    expect(await ok('PUT', '/api/kb/controls?ws=pawsome', { retentionDays: 5 }, 400)).toMatchObject({ error: 'retentionDays must be 30-3650 days, or null to keep everything' });
  });

  test('needs refresh and Knowledge gaps follow it, and each card says when it needs checking again', async () => {
    const broad = card('pawsome', ['Advertising'], 'Broad targeting wins', { stage: 'tested' });
    age(broad.id, 50);
    const seen = Date.parse(String(db.prepare('SELECT verified_at FROM kb_cards WHERE id = ?').get(broad.id)!.verified_at));
    const refreshBy = async () => (await ok<KbCard>('GET', `/api/kb/cards/${broad.id}?ws=pawsome`)).refreshBy;
    expect(await refreshBy()).toBe(new Date(seen + 45 * DAY).toISOString());
    age(card('pawsome', ['Pricing'], 'Bundles beat discounts').id, 50);
    expect(await overview('pawsome')).toMatchObject({ stale: 1, gaps: [{ name: 'Pricing', reason: 'only hypotheses' }, { name: 'Advertising', reason: '1 of 1 stale' }] });
    await ok('PUT', '/api/kb/controls?ws=pawsome', { freshDays: { [categoryId('pawsome', 'Advertising')]: 60, [categoryId('pawsome', 'Pricing')]: 30 } });
    expect(await overview('pawsome')).toMatchObject({ stale: 1, gaps: [{ name: 'Pricing', reason: 'only hypotheses' }, { name: 'Advertising', reason: '0 measured' }] });
    expect(await refreshBy()).toBe(new Date(seen + 60 * DAY).toISOString());
  });

  test('a card past its age that gets new evidence is Refreshed: in its history, and a discovery this week', async () => {
    const old = card('pawsome', ['Advertising'], 'Broad targeting wins');
    age(old.id, 60);
    const fresh = card('pawsome', ['Pricing'], 'Bundles beat discounts');
    age(fresh.id, 60);
    const disputed = card('pawsome', ['Advertising'], 'Interest stacks win');
    age(disputed.id, 60);
    addEvidence(db, old.id, { kind: 'research', text: 'Meta still finds buyers on broad in 2026', authorId: 'pawsome:market_analyst' });
    addEvidence(db, fresh.id, { kind: 'research', text: 'Bundles lift AOV', authorId: 'pawsome:market_analyst' });
    addEvidence(db, disputed.id, { kind: 'conflict', text: 'A test found the opposite', authorId: 'owner' }); // a conflict, not a refresh
    const reasons = (id: string) => db.prepare('SELECT reason FROM kb_revisions WHERE card_id = ? ORDER BY id').all(id).map((r) => r.reason);
    expect(reasons(old.id)).toEqual(['Created', 'Refreshed: new research evidence after 60 days']);
    expect(reasons(fresh.id)).toEqual(['Created']);
    expect(reasons(disputed.id).some((r) => String(r).startsWith('Refreshed'))).toBe(false);
    expect((await overview('pawsome')).discoveries.filter((d) => d.kind === 'refreshed')).toEqual([
      { kind: 'refreshed', at: expect.any(String), reason: 'new research evidence after 60 days', card: expect.objectContaining({ id: old.id }) },
    ]);
  });
});

describe('the maintenance pass', () => {
  test('suggests merging a near-duplicate into the stronger card; Merge settles it', async () => {
    const summary = 'Opening on the pain point holds viewers longer';
    const dup = card('pawsome', ['Advertising', 'Video hooks'], 'Problem-first hooks beat product-first hooks in video', { summary });
    // Made later, but further up the ladder: it's the one kept.
    const keep = card('pawsome', ['Advertising'], 'Problem-first hooks beat product-first hooks', { summary, stage: 'supported' });
    card('pawsome', ['Advertising'], 'Problem-first hooks beat product-first hooks, archived', { summary, status: 'archived' }); // not live
    card('pawsome', ['Advertising'], 'Problem-first hooks beat product-first hooks on TikTok', { summary: 'The pain point sells' }); // close (54% of words), not the same
    card('glow', ['Advertising'], 'Problem-first hooks beat product-first hooks', { summary }); // another store's
    card(null, ['Advertising'], 'Problem-first hooks beat product-first hooks', { summary }); // General's
    card('pawsome', ['Advertising'], 'Broad targeting wins', { summary: 'Meta finds the buyers' });

    expect(maintain(db)).toMatchObject({ duplicates: 1, contradictions: 0 });
    expect(links('duplicates')).toEqual([{ id: expect.any(String), from_id: dup.id, to_id: keep.id, status: 'suggested', author_id: 'app' }]);
    expect(maintain(db)).toMatchObject({ duplicates: 0 }); // once
    const found = (await overview('pawsome')).discoveries.filter((d) => d.kind === 'duplicate');
    expect(found).toEqual([
      { kind: 'duplicate', id: links('duplicates')[0]!.id, at: expect.any(String), why: expect.stringMatching(/^Possible duplicate: /), card: expect.objectContaining({ id: dup.id }), other: expect.objectContaining({ id: keep.id }) },
    ]);
    await ok('POST', `/api/kb/cards/${keep.id}/merge?ws=pawsome`, { from: dup.id });
    expect((await overview('pawsome')).discoveries.filter((d) => d.kind === 'duplicate')).toEqual([]);
  });

  test('the same stage keeps the older card; Not the same is remembered', async () => {
    const summary = 'Opening on the pain point holds viewers longer';
    const newer = card('pawsome', ['Advertising'], 'Problem-first hooks beat product-first hooks, again', { summary });
    const older = card('pawsome', ['Advertising'], 'Problem-first hooks beat product-first hooks', { summary });
    age(older.id, 3); // made first, though filed second
    maintain(db);
    const [link] = links('duplicates');
    expect(link).toMatchObject({ from_id: newer.id, to_id: older.id });
    await ok('PATCH', `/api/kb/links/${link!.id}?ws=pawsome`, { status: 'rejected' });
    expect((await overview('pawsome')).discoveries.filter((d) => d.kind === 'duplicate')).toEqual([]);
    expect(maintain(db)).toMatchObject({ duplicates: 0 });
  });

  test("finds a contradiction that wasn't caught when the cards were made: a link and an open conflict, once", async () => {
    const yes = card('pawsome', ['Advertising'], 'Broad targeting wins for pet gear', { summary: 'Meta finds the buyers on its own' });
    const no = card('pawsome', ['Advertising'], "Broad targeting doesn't win for pet gear", { summary: 'Meta finds the buyers on its own' });
    // As if made before this check, or edited since: nothing links them.
    db.prepare('DELETE FROM kb_links').run();
    db.prepare('DELETE FROM kb_conflicts').run();
    expect(maintain(db)).toMatchObject({ duplicates: 0, contradictions: 1 });
    expect(links('contradicts')).toEqual([{ id: expect.any(String), from_id: no.id, to_id: yes.id, status: 'suggested', author_id: 'app' }]);
    expect(db.prepare(`SELECT card_id, other_card_id, status, note FROM kb_conflicts`).all()).toEqual([
      { card_id: no.id, other_card_id: yes.id, status: 'open', note: expect.stringMatching(/^Possible contradiction: /) },
    ]);
    const conflict = String(db.prepare('SELECT id FROM kb_conflicts').get()!.id);
    await ok('PATCH', `/api/kb/conflicts/${conflict}?ws=pawsome`, { status: 'kept_both' }, 204);
    expect(maintain(db)).toMatchObject({ contradictions: 0 });
    expect(db.prepare(`SELECT count(*) AS n FROM kb_conflicts WHERE status = 'open'`).get()!.n).toBe(0);
  });
});

describe('data retention', () => {
  test("trims fetched text and finished research's logs past the workspace's age, and keeps the rest", async () => {
    const read = (url: string, ws: KbWorkspace, days: number) =>
      saveSource(db, ws, { kind: 'url', url, title: url, status: 'read', text: `Hooks matter. ${url} `.repeat(40), fetchedAt: ago(days) });
    const old = read('https://example.com/old', 'pawsome', 100);
    const recent = read('https://example.com/new', 'pawsome', 5);
    const general = read('https://example.com/general', null, 100);
    const task = (ws: KbWorkspace, days: number, run: string) => {
      const t = createResearchTask(db, { ws, payerId: 'pawsome', role: 'market_analyst', kind: 'topic', origin: 'owner', objective: `Hooks ${run}`, budgetUsd: 1 });
      db.prepare(`UPDATE kb_tasks SET status = 'done', ended_at = ?, report_json = '{"summary":"Hooks matter"}' WHERE id = ?`).run(ago(days), t.id);
      db.prepare(`INSERT INTO agent_runs (id, store_id, agent_id, task, status, transcript_json, created_at, mode) VALUES (?, 'pawsome', 'pawsome:market_analyst', 'Plan', 'done', '[{"type":"text"}]', ?, 'research')`).run(run, ago(days));
      db.prepare(`INSERT INTO kb_task_steps (task_id, stage, attempt, run_id, status, output_json, started_at, ended_at) VALUES (?, 'planning', 1, ?, 'done', '{"plan":1}', ?, ?)`).run(t.id, run, ago(days), ago(days));
      db.prepare(`INSERT INTO kb_task_log (task_id, stage, level, message, at) VALUES (?, 'planning', 'info', 'Planned', ?)`).run(t.id, ago(days));
      return t.id;
    };
    const oldTask = task('pawsome', 100, 'r-old');
    const recentTask = task('pawsome', 5, 'r-new');
    const requeued = task('pawsome', 100, 'r-requeued');
    db.prepare(`UPDATE kb_tasks SET status = 'queued' WHERE id = ?`).run(requeued); // failed, then tried again: its outputs carry on
    const text = (id: string) => db.prepare('SELECT text FROM kb_sources WHERE id = ?').get(id)!.text;
    const kept = (id: string, run: string) => ({
      log: db.prepare('SELECT message FROM kb_task_log WHERE task_id = ? ORDER BY id').all(id).map((r) => r.message),
      output: db.prepare('SELECT output_json FROM kb_task_steps WHERE task_id = ?').get(id)!.output_json,
      transcript: db.prepare('SELECT transcript_json FROM agent_runs WHERE id = ?').get(run)!.transcript_json,
      report: db.prepare('SELECT report_json FROM kb_tasks WHERE id = ?').get(id)!.report_json,
    });
    const untouched = { log: ['Queued', 'Planned'], output: '{"plan":1}', transcript: '[{"type":"text"}]', report: '{"summary":"Hooks matter"}' };

    // Kept until the owner sets an age.
    expect(maintain(db)).toMatchObject({ trimmed: { sources: 0, tasks: 0 } });
    expect(text(old.id)).toBeTruthy();

    await ok('PUT', '/api/kb/controls?ws=pawsome', { retentionDays: 90 });
    expect(maintain(db)).toMatchObject({ trimmed: { sources: 1, tasks: 1 } });
    expect(text(old.id)).toBeNull();
    expect(db.prepare('SELECT url, title, excerpt, content_hash, status FROM kb_sources WHERE id = ?').get(old.id)).toEqual({
      url: 'https://example.com/old', title: 'https://example.com/old', excerpt: old.excerpt, content_hash: expect.any(String), status: 'read',
    });
    expect(sourceForAgent(db, old.id)).toBe("Source https://example.com/old was read, but its text is no longer kept (the workspace's data retention). Fetch it again to read it.");
    expect(text(recent.id)).toBeTruthy();
    expect(text(general.id)).toBeTruthy(); // General keeps everything until its own age is set
    expect(kept(oldTask, 'r-old')).toEqual({ log: ['Log trimmed: this workspace keeps research logs 90 days'], output: null, transcript: '[]', report: '{"summary":"Hooks matter"}' });
    expect(kept(recentTask, 'r-new')).toEqual(untouched);
    expect(kept(requeued, 'r-requeued')).toEqual(untouched);
    expect(maintain(db)).toMatchObject({ trimmed: { sources: 0, tasks: 0 } }); // once
    // Fetched again, it reads in full.
    expect(text(read('https://example.com/old', 'pawsome', 0).id)).toBeTruthy();
    // General's own age.
    await ok('PUT', '/api/kb/controls?ws=general', { retentionDays: 30 });
    expect(maintain(db)).toMatchObject({ trimmed: { sources: 1, tasks: 0 } });
    expect(text(general.id)).toBeNull();
  });
});
