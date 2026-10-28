// KB-25 security and ops pass: request limits, workspace isolation on every KB route, the log, backup and restore.
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addEvidence, createCard, createLink, ensureCategoryPath, getCard, listCards, saveSource, type NewKbCard } from '@frontline/agents';
import type { KbWorkspace } from '@frontline/shared';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { backupNow } from '../backups';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { initLog } from '../log';

let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  app = createApp(db);
});
afterEach(() => vi.useRealTimers());
const send = (method: string, path: string, body?: string) => app.request(path, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body }) });
const MB = 1_048_576;

describe('request limits', () => {
  test('a body over 1 MB is refused unread; research from an uploaded document may carry up to 15 MB', async () => {
    const big = (bytes: number) => JSON.stringify({ ws: 'pawsome', title: 'x'.repeat(bytes) });
    const card = await send('POST', '/api/kb/cards', big(MB + 10));
    expect(card.status).toBe(413);
    expect(await card.json()).toEqual({ error: 'The request is too large.' });
    expect((await send('POST', '/api/research/lists', big(MB + 10))).status).toBe(413);
    expect((await send('POST', '/api/kb/cards', big(MB - 100))).status).toBe(400); // read, and refused for what it says
    expect((await send('POST', '/api/kb/research/tasks', big(14 * MB))).status).toBe(400);
    expect((await send('POST', '/api/kb/research/tasks', big(15 * MB + 10))).status).toBe(413);
    expect((await send('PATCH', '/api/kb/cards/x?ws=pawsome', big(2 * MB))).status).toBe(413);
  });

  test('at most 10 agent-run starts and 300 changes a minute; reading is never limited', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const ask = () => send('POST', '/api/kb/ask', JSON.stringify({ ws: 'pawsome', question: 'Which hooks work?' }));
    for (let i = 0; i < 12; i++) expect((await send('POST', '/api/kb/ask', '{}')).status).toBe(400); // refused: nothing started
    for (let i = 0; i < 10; i++) expect((await ask()).status).toBe(200);
    const over = await ask();
    expect(over.status).toBe(429);
    expect(await over.json()).toEqual({ error: 'Too many requests at once: wait a minute and try again.' });
    expect((await send('POST', '/api/kb/research/tasks/t1/retry')).status).toBe(429);
    expect((await send('POST', '/api/kb/research/tasks/t1/refine', '{}')).status).toBe(429);
    expect((await send('POST', '/api/kb/research/tasks', '{}')).status).toBe(429);
    expect((await send('GET', '/api/kb/cards?ws=pawsome')).status).toBe(200);
    expect((await send('DELETE', '/api/kb/views/v1?ws=pawsome')).status).toBe(404); // changes count apart
    vi.advanceTimersByTime(60_000);
    expect((await ask()).status).toBe(200);

    for (let i = 0; i < 299; i++) await send('DELETE', '/api/kb/views/v1?ws=pawsome'); // with the ask, 300 changes
    expect((await send('PUT', '/api/kb/positions?ws=pawsome', '{}')).status).toBe(429);
    expect((await send('POST', '/api/research/lists', '{}')).status).toBe(429);
    expect((await send('GET', '/api/research')).status).toBe(200);
    // Each app (and so each test) counts on its own.
    expect((await createApp(db).request('/api/kb/ask', { method: 'POST', body: '{}' })).status).toBe(400);
  });
});

const card = (d: Db, ws: KbWorkspace, title: string, more: Partial<NewKbCard> = {}) =>
  createCard(d, ws, { categoryId: ensureCategoryPath(d, ws, ['Advertising']), title, type: 'strategy', stage: 'hypothesis', status: 'active', authorId: 'owner', origin: 'owner', ...more });

describe('workspace isolation on every KB route', () => {
  test("another store's knowledge never shows, and its ids are refused, wherever a workspace is named", async () => {
    // Glow Haus's knowledge, each piece marked.
    const area = ensureCategoryPath(db, 'glow', ['SECRET-GLOW area']);
    const g = card(db, 'glow', 'SECRET-GLOW serum hooks', { categoryId: area });
    const g2 = card(db, 'glow', 'Serum hooks never work', { categoryId: area });
    const gSource = saveSource(db, 'glow', { kind: 'url', url: 'https://glow.test/secret', title: 'SECRET-GLOW page', status: 'read', text: 'Serum.', fetchedAt: new Date().toISOString() });
    const gEvidence = addEvidence(db, g.id, { kind: 'research', text: 'SECRET-GLOW evidence', sourceId: gSource.id, authorId: 'owner' });
    const gLink = createLink(db, 'glow', { from: g.id, to: g2.id, type: 'contradicts', why: 'SECRET-GLOW why', authorId: 'owner', status: 'confirmed' });
    const gConflict = String(db.prepare('SELECT id FROM kb_conflicts WHERE card_id IN (?, ?)').get(g.id, g2.id)!.id);
    db.prepare(`INSERT INTO kb_views (id, store_id, name, state_json, created_at) VALUES ('gv', 'glow', 'SECRET-GLOW view', '{}', ?)`).run(new Date().toISOString());
    expect((await send('PUT', '/api/kb/positions?ws=glow', JSON.stringify({ [g.id]: { x: 1, y: 2 } }))).status).toBe(204);
    const p = card(db, 'pawsome', 'Pet hooks');
    const before = JSON.stringify(db.prepare('SELECT * FROM kb_cards c LEFT JOIN kb_links l ON l.from_id = c.id WHERE c.store_id = ?').all('glow'));

    const read = async (path: string) => {
      const r = await send('GET', path);
      expect(r.status, path).toBe(200);
      return r.text();
    };
    for (const ws of ['pawsome', 'general']) {
      for (const path of [
        `/api/kb/overview?ws=${ws}`, `/api/kb/sources?ws=${ws}&general=1`, `/api/kb/views?ws=${ws}`, `/api/kb/research/tasks?ws=${ws}`, `/api/kb/categories?ws=${ws}&general=1`,
        `/api/kb/cards?ws=${ws}&general=1`, `/api/kb/cards?ws=${ws}&general=1&q=SECRET-GLOW serum`, `/api/kb/campaigns?ws=${ws}`, `/api/kb/links?ws=${ws}&general=1`, `/api/kb/positions?ws=${ws}`,
        `/api/kb/controls?ws=${ws}`,
      ]) expect(await read(path), path).not.toMatch(/SECRET-GLOW|glow\.test/);
    }
    // The marks are real: Glow Haus and All workspaces see them.
    expect(await read('/api/kb/cards?ws=glow')).toContain('SECRET-GLOW serum hooks');
    expect(await read('/api/kb/sources?ws=all')).toContain('SECRET-GLOW page');

    const refused: [string, string, unknown, number][] = [
      ['PATCH', `/api/kb/conflicts/${gConflict}?ws=pawsome`, { status: 'kept_both' }, 404],
      ['PATCH', `/api/kb/sources/${gSource.id}?ws=pawsome`, { reliability: 'research' }, 404],
      ['DELETE', '/api/kb/views/gv?ws=pawsome', undefined, 404],
      ['POST', `/api/kb/cards/${g.id}/promote?ws=pawsome`, undefined, 404],
      ['POST', `/api/kb/cards/${g.id}/detach?ws=pawsome`, { from: g2.id }, 404],
      ['GET', `/api/kb/cards/${g.id}/revisions?ws=pawsome&general=1`, undefined, 404],
      ['POST', `/api/kb/cards/${g.id}/revisions/1/restore?ws=pawsome`, undefined, 404],
      ['GET', `/api/kb/cards/${g.id}/evidence?ws=pawsome&general=1`, undefined, 404],
      ['POST', `/api/kb/cards/${g.id}/evidence?ws=pawsome`, { kind: 'research', text: 'More of it' }, 404],
      ['POST', `/api/kb/cards/${p.id}/evidence?ws=pawsome`, { kind: 'research', text: 'More of it', sourceId: gSource.id }, 400],
      ['DELETE', `/api/kb/evidence/${gEvidence.id}?ws=pawsome`, undefined, 404],
      ['GET', `/api/kb/cards/${g.id}/experiments?ws=pawsome&general=1`, undefined, 404],
      ['POST', `/api/kb/cards/${g.id}/experiments?ws=pawsome`, {}, 404],
      ['PATCH', `/api/kb/links/${gLink.id}?ws=pawsome`, { status: 'rejected' }, 404],
      ['DELETE', `/api/kb/links/${gLink.id}?ws=pawsome`, undefined, 404],
      ['POST', '/api/kb/links', { ws: 'pawsome', from: p.id, to: g.id, type: 'supports', why: 'They agree' }, 404],
      ['PUT', '/api/kb/positions?ws=pawsome', { [g.id]: { x: 5, y: 5 } }, 404],
      ['POST', '/api/kb/cards/bulk', { ws: 'pawsome', ids: [g.id], patch: { status: 'archived' } }, 404],
      ['PATCH', `/api/kb/cards/${p.id}?ws=pawsome`, { categoryId: area }, 400],
      ['POST', '/api/kb/categories', { ws: 'pawsome', name: 'Inside', parentId: area }, 400],
      ['PATCH', `/api/kb/categories/${area}?ws=pawsome`, { name: 'Mine now' }, 404],
      ['DELETE', `/api/kb/categories/${area}?ws=pawsome`, undefined, 404],
    ];
    for (const [method, path, body, status] of refused) expect((await send(method, path, body === undefined ? undefined : JSON.stringify(body))).status, `${method} ${path}`).toBe(status);
    expect(JSON.stringify(db.prepare('SELECT * FROM kb_cards c LEFT JOIN kb_links l ON l.from_id = c.id WHERE c.store_id = ?').all('glow'))).toBe(before);
    expect(db.prepare('SELECT status FROM kb_conflicts WHERE id = ?').get(gConflict)).toEqual({ status: 'open' });
    expect(db.prepare('SELECT count(*) AS n FROM kb_evidence WHERE card_id = ? OR source_id = ?').get(p.id, gSource.id)).toEqual({ n: 1 });
  });
});

describe('ops', () => {
  test("a failing KB request logs its path and error, never its query or body", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'frontline-log-'));
    initLog(dir);
    const prepare = db.prepare;
    db.prepare = (() => {
      throw new Error('database is locked');
    }) as unknown as typeof db.prepare;
    try {
      expect((await send('GET', '/api/kb/cards?ws=pawsome&q=sk-live-query-123')).status).toBe(500);
      expect((await send('POST', '/api/kb/cards', JSON.stringify({ ws: 'pawsome', title: 'sk-live-body-456' }))).status).toBe(500);
    } finally {
      db.prepare = prepare;
    }
    const lines = readFileSync(join(dir, 'logs', 'api.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, string>);
    expect(lines.map((l) => [l.level, l.msg, l.method, l.path])).toEqual([
      ['error', 'request failed', 'GET', '/api/kb/cards'],
      ['error', 'request failed', 'POST', '/api/kb/cards'],
    ]);
    expect(lines[0]!.error).toContain('database is locked');
    expect(JSON.stringify(lines)).not.toMatch(/sk-live/);
  });

  test('knowledge persists across restarts: closed and opened again, the cards, links and search are as they were', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'frontline-kb-restart-')), 'frontline.db');
    const before = openDb(file);
    const a = card(before, null, 'Problem-first hooks win', { summary: 'Hooks on the problem hold viewers' });
    const b = card(before, null, 'Pain beats gain');
    createLink(before, null, { from: a.id, to: b.id, type: 'supports', why: 'Same idea', authorId: 'owner', status: 'confirmed' });
    before.close();
    const after = openDb(file);
    expect(getCard(after, a.id)).toMatchObject({ title: 'Problem-first hooks win', path: ['Advertising'] });
    expect(listCards(after, null, { q: 'viewers' }).items.map((c) => c.id)).toEqual([a.id]);
    expect(after.prepare('SELECT from_id, to_id, status FROM kb_links').all()).toEqual([{ from_id: a.id, to_id: b.id, status: 'confirmed' }]);
    after.close();
  });

  test("a backup holds the knowledge base, and restoring it brings back cards, their evidence and sources, links and search", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'frontline-kb-backup-'));
    const file = join(dir, 'frontline.db');
    const live = openDb(file);
    const a = card(live, null, 'Problem-first hooks win', { summary: 'Hooks on the problem hold viewers' });
    const b = card(live, null, 'Pain beats gain');
    const src = saveSource(live, null, { kind: 'url', url: 'https://a.test/hooks', title: 'Hook study', status: 'read', text: 'Hooks matter.', fetchedAt: new Date().toISOString() });
    addEvidence(live, a.id, { kind: 'research', text: 'A study', sourceId: src.id, authorId: 'owner' });
    createLink(live, null, { from: a.id, to: b.id, type: 'supports', why: 'Same idea', authorId: 'owner', status: 'confirmed' });
    const snap = await backupNow(live, join(dir, 'backups'));
    live.prepare('DELETE FROM kb_cards').run();
    live.close();
    copyFileSync(join(dir, 'backups', snap.name), `${file}.restore`);
    const restored = openDb(file);
    expect(getCard(restored, a.id)).toMatchObject({ title: 'Problem-first hooks win', summary: 'Hooks on the problem hold viewers' });
    expect(listCards(restored, null, { q: 'viewers' }).items.map((c) => c.id)).toEqual([a.id]);
    expect(restored.prepare('SELECT e.text, s.title FROM kb_evidence e JOIN kb_sources s ON s.id = e.source_id WHERE e.card_id = ?').all(a.id)).toEqual([{ text: 'A study', title: 'Hook study' }]);
    expect(restored.prepare('SELECT from_id, to_id, type FROM kb_links').all()).toEqual([{ from_id: a.id, to_id: b.id, type: 'supports' }]);
    restored.close();
  });
});
