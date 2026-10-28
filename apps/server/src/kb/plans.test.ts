// KB-25: the knowledge base's hot paths read through indexes, so a big KB never stalls the API (node:sqlite is synchronous).
import { createCard, createLink, ensureCategoryPath, saveSource, addEvidence, retrieveKnowledge } from '@frontline/agents';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { maintain } from './maintenance';

let db: Db;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
});

// Reading everything on purpose (All workspaces, the category tree behind refresh ages) scans by nature, as do the
// tables that stay a handful of rows per workspace: the owner's saved views, planned tests and controls.
const everything = (sql: string) => !/\bWHERE\b/i.test(sql) || /\bWHERE 1 = 1\b/.test(sql);
const TINY = new Set(['kb_views', 'kb_experiments', 'kb_controls']);

/** Every statement `fn` prepares, with the tables its plan scans whole (an FTS table's own lookup excepted). */
async function scans(fn: () => unknown) {
  const seen = new Set<string>();
  const prepare = db.prepare.bind(db);
  db.prepare = ((sql: string) => (seen.add(sql), prepare(sql))) as typeof db.prepare;
  try {
    await fn();
  } finally {
    db.prepare = prepare;
  }
  const out: Record<string, string[]> = {};
  for (const sql of seen) {
    if (!/^\s*(SELECT|WITH)/i.test(sql) || !/\bkb_/.test(sql) || everything(sql)) continue;
    const plan = prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => String(r.detail)); // unbound parameters are NULL
    for (const d of plan) {
      const [, table, how] = /^SCAN (\w+)(.*)$/.exec(d) ?? [];
      if (table && /^(kb_|ads$|ad_daily$)/.test(table) && !TINY.has(table) && !/VIRTUAL TABLE|USING (COVERING )?INDEX/.test(how!)) (out[table] ??= []).push(sql.replace(/\s+/g, ' '));
    }
  }
  return out;
}

test('the KB read routes, retrieval and the hourly pass scan no table whole', async () => {
  const app = createApp(db);
  const cat = ensureCategoryPath(db, 'pawsome', ['Advertising', 'Hooks']);
  const a = createCard(db, 'pawsome', { categoryId: cat, title: 'Problem-first hooks win', summary: 'Hooks on the problem', type: 'strategy', stage: 'supported', status: 'active', authorId: 'owner', origin: 'owner' });
  const b = createCard(db, null, { categoryId: ensureCategoryPath(db, null, ['Advertising']), title: 'Pain beats gain', type: 'strategy', stage: 'hypothesis', status: 'active', authorId: 'owner', origin: 'owner' });
  createLink(db, 'pawsome', { from: a.id, to: b.id, type: 'supports', why: 'Same idea', authorId: 'owner', status: 'confirmed' });
  const src = saveSource(db, 'pawsome', { kind: 'url', url: 'https://a.test/x', title: 'Study', status: 'read', text: 'Hooks.', fetchedAt: new Date().toISOString() });
  addEvidence(db, a.id, { kind: 'research', text: 'A study', sourceId: src.id, authorId: 'owner' });
  const get = async (path: string) => expect((await app.request(path)).status, path).toBe(200);
  const found = await scans(async () => {
    for (const path of [
      '/api/kb/workspaces', '/api/kb/overview?ws=pawsome', '/api/kb/overview?ws=general', '/api/kb/sources?ws=pawsome&general=1', '/api/kb/views?ws=pawsome',
      '/api/kb/controls?ws=pawsome', '/api/kb/research/tasks?ws=pawsome', '/api/kb/categories?ws=pawsome', '/api/kb/cards?ws=pawsome&general=1',
      '/api/kb/cards?ws=pawsome&general=1&q=hooks', '/api/kb/cards?ws=all&q=hooks', `/api/kb/cards/${a.id}?ws=pawsome`, `/api/kb/cards/${a.id}/evidence?ws=pawsome`,
      `/api/kb/cards/${a.id}/revisions?ws=pawsome`, `/api/kb/cards/${a.id}/experiments?ws=pawsome`, '/api/kb/campaigns?ws=pawsome', '/api/kb/links?ws=pawsome&general=1',
      '/api/kb/positions?ws=pawsome',
    ]) await get(path);
    retrieveKnowledge(db, { ws: 'pawsome', role: 'market_analyst', query: 'Which hooks work?', limit: 12 });
    maintain(db);
  });
  expect(found).toEqual({});
});
