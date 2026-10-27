import { kbGoLive, kbRow, kbScope } from '@frontline/agents';
import { KB_GENERAL_CATEGORIES } from '@frontline/shared';
import { beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app';
import { switchToReal } from '../connectors/common';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { insertStore } from '../stores';

let db: Db;
const at = '2026-10-27T12:00:00.000Z';
const store = (id: string) => insertStore(db, { id, name: id, platform: 'shopify', niche: 'pet', currency: 'USD', timezone: 'America/Chicago', color: '#fff', connected: false });
const category = (id: string, storeId: string | null, name: string, parentId: string | null = null) =>
  db.prepare('INSERT INTO kb_categories (id, store_id, parent_id, name, created_at) VALUES (?, ?, ?, ?, ?)').run(id, storeId, parentId, name, at);
const card = (id: string, storeId: string | null, title: string, extra: { categoryId?: string; origin?: string; summary?: string } = {}) =>
  db
    .prepare(
      `INSERT INTO kb_cards (id, store_id, category_id, type, title, summary, author_id, origin, created_at, updated_at)
       VALUES (?, ?, ?, 'research_finding', ?, ?, 'owner', ?, ?, ?)`,
    )
    .run(id, storeId, extra.categoryId ?? 'general-advertising', title, extra.summary ?? '', extra.origin ?? 'owner', at, at);
const ids = (sql: string, params: (string | null)[] = []) => db.prepare(sql).all(...params).map((r) => String(r.id));

beforeEach(() => {
  db = openDb();
  store('pawsome');
  store('glow');
});

describe('knowledge base schema', () => {
  test('the 16 General categories are seeded once, in the spec order', () => {
    const rows = db.prepare('SELECT name, store_id, parent_id FROM kb_categories ORDER BY position').all();
    expect(rows.map((r) => r.name)).toEqual([...KB_GENERAL_CATEGORIES]);
    expect(rows.every((r) => r.store_id === null && r.parent_id === null)).toBe(true);
    expect(KB_GENERAL_CATEGORIES).toHaveLength(16);
  });

  test('a General category or card saved twice is refused, though NULL is in the key; a store may reuse the name', () => {
    expect(() => category('dup', null, 'advertising')).toThrow(/UNIQUE/);
    category('sub1', null, 'Video Hooks', 'general-advertising');
    expect(() => category('sub2', null, 'video hooks', 'general-advertising')).toThrow(/UNIQUE/);
    category('pet-ads', 'pawsome', 'Advertising');
    card('c1', null, 'Problem-first hooks win');
    expect(() => card('c2', null, 'problem-first hooks win')).toThrow(/UNIQUE/);
    card('c3', 'pawsome', 'Problem-first hooks win', { categoryId: 'pet-ads' });
  });

  test('agent runs can carry a mode', () => {
    db.prepare(`INSERT INTO agent_runs (id, store_id, agent_id, task, mode, created_at) VALUES ('r1', 'pawsome', 'pawsome:market_analyst', 't', 'research', ?)`).run(at);
    expect(db.prepare(`SELECT mode FROM agent_runs WHERE id = 'r1'`).get()?.mode).toBe('research');
  });

  test('cards are found by full-text search, and edits keep the index in step', () => {
    card('c1', null, 'Problem-first hooks', { summary: 'Open on the pain point' });
    const search = (q: string) => ids('SELECT c.id FROM kb_cards_fts f JOIN kb_cards c ON c.seq = f.rowid WHERE kb_cards_fts MATCH ?', [q]);
    expect(search('pain')).toEqual(['c1']);
    db.prepare(`UPDATE kb_cards SET summary = 'Lead with the outcome' WHERE id = 'c1'`).run();
    expect(search('pain')).toEqual([]);
    expect(search('outcome')).toEqual(['c1']);
    db.prepare(`DELETE FROM kb_cards WHERE id = 'c1'`).run();
    expect(search('outcome')).toEqual([]);
  });

  test("deleting a store takes its categories, cards, links and evidence with it, and leaves General's", () => {
    category('pet-ads', 'pawsome', 'Advertising');
    category('pet-hooks', 'pawsome', 'Video Hooks', 'pet-ads');
    card('p1', 'pawsome', 'Dog owners click on rescue stories', { categoryId: 'pet-hooks' });
    card('g1', null, 'Hooks decide the first 3 seconds');
    db.prepare(`INSERT INTO kb_links (id, store_id, from_id, to_id, type, author_id, created_at) VALUES ('l1', 'pawsome', 'p1', 'g1', 'builds_upon', 'owner', ?)`).run(at);
    db.prepare(`INSERT INTO kb_evidence (id, card_id, kind, text, author_id, created_at) VALUES ('e1', 'p1', 'observed', 'x', 'owner', ?)`).run(at);
    db.prepare(`DELETE FROM stores WHERE id = 'pawsome'`).run();
    expect(ids('SELECT id FROM kb_cards')).toEqual(['g1']);
    expect(ids(`SELECT id FROM kb_categories WHERE store_id IS NOT NULL`)).toEqual([]);
    expect(ids('SELECT id FROM kb_links')).toEqual([]);
    expect(ids('SELECT id FROM kb_evidence')).toEqual([]);
  });
});

describe('workspace scoping', () => {
  beforeEach(() => {
    category('pet-ads', 'pawsome', 'Advertising');
    category('glow-ads', 'glow', 'Advertising');
    card('g1', null, 'General card');
    card('p1', 'pawsome', 'Pawsome card', { categoryId: 'pet-ads' });
    card('b1', 'glow', 'Glow card', { categoryId: 'glow-ads' });
  });
  const visible = (ws: string | null | 'all', general?: boolean) => {
    const s = kbScope(ws, general);
    return ids(`SELECT id FROM kb_cards WHERE ${s.sql} ORDER BY id`, s.params);
  };

  test("a store sees its own cards, plus General only when asked, and never another store's", () => {
    expect(visible('pawsome')).toEqual(['p1']);
    expect(visible('pawsome', true)).toEqual(['g1', 'p1']);
    expect(visible('glow', true)).toEqual(['b1', 'g1']);
  });

  test('General sees only General, and "all" (owner search, Research Center) sees everything', () => {
    expect(visible(null)).toEqual(['g1']);
    expect(visible(null, true)).toEqual(['g1']);
    expect(visible('all')).toEqual(['b1', 'g1', 'p1']);
  });

  test("a by-id lookup from the wrong workspace finds nothing, so routes answer 404", () => {
    expect(kbRow(db, 'kb_cards', 'p1', 'pawsome')?.id).toBe('p1');
    expect(kbRow(db, 'kb_cards', 'p1', 'glow')).toBeUndefined();
    expect(kbRow(db, 'kb_cards', 'p1', 'glow', true)).toBeUndefined();
    expect(kbRow(db, 'kb_cards', 'p1', null)).toBeUndefined();
    expect(kbRow(db, 'kb_cards', 'g1', 'glow')).toBeUndefined();
    expect(kbRow(db, 'kb_cards', 'g1', 'glow', true)?.id).toBe('g1');
    expect(kbRow(db, 'kb_categories', 'glow-ads', 'pawsome', true)).toBeUndefined();
    expect(kbRow(db, 'kb_cards', 'nope', 'all')).toBeUndefined();
  });
});

describe('going live', () => {
  test('purges what came from demo data, keeps owner cards and web research, and cancels open research', () => {
    category('pet-ads', 'pawsome', 'Advertising');
    card('own', 'pawsome', 'Owner note', { categoryId: 'pet-ads' });
    card('web', 'pawsome', 'Read on the web', { categoryId: 'pet-ads', origin: 'research' });
    card('chat', 'pawsome', 'Said in a normal run', { categoryId: 'pet-ads', origin: 'agent' });
    card('lesson', 'pawsome', 'Learned from demo ads', { categoryId: 'pet-ads', origin: 'performance' });
    card('gen', null, 'General research');
    card('other', 'glow', 'Another store', { origin: 'agent', categoryId: 'general-advertising' });
    db.prepare(`INSERT INTO kb_sources (id, store_id, kind, url, status, created_at) VALUES ('s1', 'pawsome', 'url', 'https://a.test', 'read', ?)`).run(at);
    db.prepare(`INSERT INTO kb_evidence (id, card_id, kind, text, source_id, author_id, created_at) VALUES ('e-web', 'web', 'research', 'x', 's1', 'pawsome:market_analyst', ?)`).run(at);
    db.prepare(
      `INSERT INTO kb_observations (id, store_id, ref, subject, metric, value, window_from, window_to, created_at)
       VALUES ('o1', 'pawsome', 'ads:1', 'campaign:meta:1', 'roas', 2.1, '2026-10-01', '2026-10-20', ?)`,
    ).run(at);
    db.prepare(`INSERT INTO kb_evidence (id, card_id, kind, text, observation_id, author_id, created_at) VALUES ('e-demo', 'web', 'measured', 'x', 'o1', 'system', ?)`).run(at);
    const task = (id: string, status: string, storeId: string | null = 'pawsome') =>
      db.prepare(`INSERT INTO kb_tasks (id, store_id, payer_id, role, kind, origin, objective, status, budget_usd, created_at) VALUES (?, ?, 'pawsome', 'market_analyst', 'topic', 'owner', 'o', ?, 1, ?)`).run(id, storeId, status, at);
    task('t-open', 'running');
    task('t-queued', 'queued');
    task('t-done', 'done');
    task('t-general', 'queued', null);

    expect(kbGoLive(db, 'pawsome')).toEqual({ cards: 2, measurements: 1, tasks: 2 });
    expect(ids('SELECT id FROM kb_cards ORDER BY id')).toEqual(['gen', 'other', 'own', 'web']);
    expect(ids('SELECT id FROM kb_evidence')).toEqual(['e-web']);
    expect(ids(`SELECT id FROM kb_tasks WHERE status = 'cancelled' ORDER BY id`)).toEqual(['t-open', 't-queued']);
  });

  test('the go-live notification counts the purge', async () => {
    db = openDb();
    seedDemo(db);
    const app = createApp(db);
    await app.request('/api/agents');
    db.prepare(`INSERT INTO kb_categories (id, store_id, name, created_at) VALUES ('g-ads', 'glow', 'Advertising', ?)`).run(at);
    card('chat', 'glow', 'Said in a normal run', { categoryId: 'g-ads', origin: 'agent' });
    switchToReal(db, 'glow');
    await app.request('/api/agents');
    expect(db.prepare(`SELECT body FROM notifications WHERE title = 'Glow Haus: the squad starts fresh on real numbers'`).get()?.body).toMatch(/1 knowledge card/);
  });
});
