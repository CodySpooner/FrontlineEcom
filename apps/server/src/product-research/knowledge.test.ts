import { randomUUID } from 'node:crypto';
import type { PrHistoryRow, PrReportBody, PrTask } from '@frontline/shared';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { runManager } from '../routes/agents';
import { upsertListing } from './catalog';
import { refreshProduct } from './evaluate';
import { saveReport } from './reports';

let db: Db;
let app: ReturnType<typeof createApp>;
let p: string;
let listing: string;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  app = createApp(db);
  ({ productId: p, id: listing } = upsertListing(db, { source: 'cj', sourceRef: '1', title: 'Dog travel water bowl', category: 'Pet Supplies > Travel', origin: 'ingest' }));
  refreshProduct(db, p, new Date());
});
const send = async <T>(method: string, path: string, body?: unknown) => {
  const r = await app.request(path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: (await r.json()) as T };
};
const card = (id: string, store: string | null, title: string, status = 'active') =>
  db
    .prepare(`INSERT INTO kb_cards (id, store_id, category_id, type, status, title, summary, author_id, origin, created_at, updated_at) VALUES (?, ?, 'general-advertising', 'research_finding', ?, ?, ?, 'owner', 'owner', ?, ?)`)
    .run(id, store, status, title, title, new Date().toISOString(), new Date().toISOString());
const task = async () => {
  const t = (await send<PrTask>('POST', '/api/pr/tasks?store=pawsome', { clientRequestId: randomUUID(), productId: p, type: 'product_hunter', mode: 'new', instructions: 'Evaluate it.' })).body;
  await runManager(db).idle();
  return t;
};
const report = (evidence: PrReportBody['evidence']): PrReportBody => ({
  recommendation: 'shortlist', summary: '', purpose: '', customer_problem: '', store_fit: { fit: 'strong', why: '' }, demand_evidence: '', competitors: [], supplier_offers: [],
  risks: [], next_steps: [], evidence, open_questions: [], would_change_if: '', proposals: [], unknown_reasons: {},
});

test("a research run's knowledge is this store's and General's only, active cards, focused on the product, at most 8", async () => {
  for (let i = 0; i < 10; i++) card(`own${i}`, 'pawsome', `Travel water bowl lesson ${i}: dog owners want leak-proof lids`);
  card('general', null, 'Travel water bowl accessories sell before hiking season');
  card('glow', 'glow', 'Travel water bowl for the dog of a Glow Haus customer'); // another store's
  card('unreviewed', 'pawsome', 'Travel water bowl guess nobody accepted', 'proposed');
  card('off-topic', 'pawsome', 'Lipstick shades that sell in autumn');
  const t = await task();
  const used = db.prepare(`SELECT card_id FROM kb_retrievals WHERE run_id = ?`).all(t.runId!).map((r) => String(r.card_id));
  expect(used).toHaveLength(8);
  expect(used.every((id) => id.startsWith('own') || id === 'general')).toBe(true);
  expect(used).not.toContain('glow');
  expect(used).not.toContain('unreviewed');
  expect(used).not.toContain('off-topic');
});

test("a model report's sourced claims become unreviewed findings, deduped; a demo report and unsourced claims feed nothing", async () => {
  const findings = () => db.prepare(`SELECT c.title, c.status, c.origin, c.type, k.name FROM kb_cards c JOIN kb_categories k ON k.id = c.category_id WHERE c.store_id = 'pawsome' ORDER BY c.title`).all().map((r) => [r.title, r.status, r.origin, r.type, r.name]);
  const t = await task(); // the demo engine's own report: nothing reaches the KB
  expect(findings()).toEqual([]);

  card('general', null, 'Hikers carry collapsible bowls');
  db.prepare(`UPDATE pr_tasks SET run_id = 'real' WHERE id = ?`).run(t.id);
  saveReport(db, t.id, report([
    { claim: 'Leak-proof lids are the top request in bowl reviews', kind: 'research', source: 'https://example.com/reviews https://example.org/forum' },
    { claim: 'Hikers carry collapsible bowls', kind: 'research', source: 'https://example.com/hiking' }, // General says it already
    { claim: 'Listed on CJ at $3.42', kind: 'measured', source: `[listing:${listing}]` }, // no web source
    { claim: 'Owners would pay $29', kind: 'hypothesis', source: 'https://example.com/guess' }, // a guess, not a finding
  ]), { runId: 'real', storeId: 'pawsome', scripted: false });
  expect(findings()).toEqual([['Leak-proof lids are the top request in bowl reviews', 'proposed', 'agent', 'hypothesis', 'Findings']]);
  const evidence = () => db.prepare(`SELECT e.text FROM kb_evidence e JOIN kb_cards c ON c.id = e.card_id WHERE c.store_id = 'pawsome'`).all().map((r) => r.text);
  expect(evidence()).toEqual(['[research] https://example.com/reviews https://example.org/forum']);

  // The same claim from a later report is one more observed row on the same card, not a second card.
  const again = await task();
  db.prepare(`UPDATE pr_tasks SET run_id = 'real2' WHERE id = ?`).run(again.id);
  saveReport(db, again.id, report([{ claim: 'Leak-proof lids are the top request in bowl reviews', kind: 'research', source: 'https://example.com/more' }]), { runId: 'real2', storeId: 'pawsome', scripted: false });
  expect(findings()).toHaveLength(1);
  expect(evidence()).toHaveLength(2);
});

test("the owner saves a stage decision to the store's Knowledge Base, apart from findings; only the owner's own decisions, once", async () => {
  const t = await task(); // Discovered → Researching, by the task
  expect((await send('POST', `/api/pr/products/${p}/stage?store=pawsome`, { stage: 'rejected', reason: 'Leaks in two of three samples' })).status).toBe(200);
  const history = async () => (await send<PrHistoryRow[]>('GET', `/api/pr/products/${p}/history?store=pawsome`)).body;
  const row = (await history()).find((h) => h.to === 'rejected')!;
  const url = `/api/pr/products/${p}/history/${row.id}/knowledge?store=pawsome`;
  const first = await send<{ cardId: string }>('POST', url);
  expect(first.status).toBe(201);
  const c = db.prepare(`SELECT c.store_id, c.title, c.summary, c.type, c.stage, c.status, c.origin, k.name FROM kb_cards c JOIN kb_categories k ON k.id = c.category_id WHERE c.id = ?`).get(first.body.cardId)!;
  expect(c).toMatchObject({ store_id: 'pawsome', type: 'user_provided', stage: 'hypothesis', status: 'active', origin: 'owner', name: 'Product decisions', summary: 'Pawsome Gear moved "Dog travel water bowl" to Rejected: Leaks in two of three samples.' });
  expect(String(c.title)).toMatch(/^Dog travel water bowl: Rejected \(/);
  expect(await send('POST', url)).toEqual({ status: 200, body: { cardId: first.body.cardId } });
  expect((await history()).find((h) => h.id === row.id)!.cardId).toBe(first.body.cardId);

  // Not the owner's (a task's automatic move), or not this store's: nothing is saved.
  const auto = (await history()).find((h) => h.by === t.id)!;
  expect((await send('POST', `/api/pr/products/${p}/history/${auto.id}/knowledge?store=pawsome`)).status).toBe(404);
  expect((await send('POST', `/api/pr/products/${p}/history/${row.id}/knowledge?store=glow`)).status).toBe(404);
  expect(Number(db.prepare(`SELECT count(*) AS n FROM kb_cards WHERE store_id = 'glow'`).get()!.n)).toBe(0);
});
