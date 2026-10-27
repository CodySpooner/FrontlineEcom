import { addEvidence, agentCardError, createCard, detachMerged, earnedStage, listEvidence, listLinks, mergeCards, restoreRevision, suggestLinks, updateCard, type NewKbCard } from '@frontline/agents';
import type { KbCard, KbEvidence, KbLink, KbRevision } from '@frontline/shared';
import { beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';

let db: Db;
let app: ReturnType<typeof createApp>;
const at = '2026-10-27T12:00:00.000Z';
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  app = createApp(db);
  db.prepare(`INSERT INTO kb_categories (id, store_id, name, position, created_at) VALUES ('p-ads', 'pawsome', 'Advertising', 1, ?), ('g-ads', 'glow', 'Advertising', 1, ?), ('p-seo', 'pawsome', 'SEO', 9, ?)`).run(at, at, at);
});
const card = (title: string, extra: Partial<NewKbCard> & { ws?: string | null } = {}) => {
  const { ws = 'pawsome', ...rest } = extra;
  return createCard(db, ws, { categoryId: ws === 'glow' ? 'g-ads' : ws ? 'p-ads' : 'general-advertising', title, type: 'research_finding', stage: 'hypothesis', status: 'active', authorId: 'pawsome:market_analyst', origin: 'research', ...rest });
};
const source = (id: string, url: string, reliability = 'unknown', status = 'read', storeId: string | null = 'pawsome') =>
  db.prepare(`INSERT INTO kb_sources (id, store_id, kind, url, title, status, reliability, created_at) VALUES (?, ?, 'url', ?, ?, ?, ?, ?)`).run(id, storeId, url, `Title ${id}`, status, reliability, at);
const research = (cardId: string, sourceId: string) => addEvidence(db, cardId, { kind: 'research', text: 'The article says so', sourceId, authorId: 'pawsome:market_analyst' });
const measured = (cardId: string, testRef?: string, kind: 'measured' | 'conflict' = 'measured') =>
  addEvidence(db, cardId, { kind, text: 'CTR 2.1% vs 1.4%', metric: 'ctr', value: 2.1, baseline: 1.4, windowFrom: '2026-10-01', windowTo: '2026-10-14', sampleSize: 4000, testRef, authorId: 'system' });
const stage = (id: string) => db.prepare('SELECT stage FROM kb_cards WHERE id = ?').get(id)?.stage;
const reasons = (id: string) => db.prepare('SELECT reason FROM kb_revisions WHERE card_id = ? ORDER BY id').all(id).map((r) => String(r.reason));
const conflicts = () => db.prepare('SELECT card_id, other_card_id, evidence_id, status FROM kb_conflicts ORDER BY created_at, rowid').all();
const req = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
const ok = async <T>(method: string, path: string, body?: unknown, status = 200): Promise<T> => {
  const res = await req(method, path, body);
  const json = res.status === 204 ? undefined : await res.json();
  expect(res.status, JSON.stringify(json)).toBe(status);
  return json as T;
};

describe('the confidence ladder', () => {
  test('one weak source keeps a Hypothesis; two independent read sources make it Research-Supported', () => {
    const c = card('Rescue stories pull clicks');
    source('s1', 'https://blog.vendor.test/a');
    source('s2', 'https://blog.vendor.test/b'); // the same site: not independent
    source('s3', 'https://forum.test/thread');
    source('s4', 'https://paywalled.test/x', 'publication', 'paywalled'); // never read: counts for nothing
    research(c.id, 's1');
    expect(stage(c.id)).toBe('hypothesis');
    research(c.id, 's2');
    research(c.id, 's4');
    expect(stage(c.id)).toBe('hypothesis');
    research(c.id, 's3');
    expect(stage(c.id)).toBe('supported');
    expect(reasons(c.id).at(-1)).toBe('Moved up to Research-Supported: 2 independent read sources');
  });

  test('one reliable source is enough for Research-Supported', () => {
    const c = card('Meta recommends broad targeting');
    source('docs', 'https://www.facebook.com/business/help/1', 'platform_docs');
    research(c.id, 'docs');
    expect(stage(c.id)).toBe('supported');
    expect(earnedStage(db, c.id).reason).toBe('a reliable read source');
  });

  test('measured evidence makes it Experimentally Tested; two independent tests make it Validated', () => {
    const c = card('Bundles lift AOV');
    measured(c.id, 'test-1');
    expect(stage(c.id)).toBe('tested');
    measured(c.id, 'test-1'); // the same test again
    expect(stage(c.id)).toBe('tested');
    measured(c.id, 'test-2');
    expect(stage(c.id)).toBe('validated');
    expect(reasons(c.id).slice(1)).toEqual(['Moved up to Experimentally Tested: 1 measured test', 'Moved up to Validated: 2 independent measured tests']);
  });

  test('contradicting evidence flags a conflict and moves the card down', () => {
    const c = card('Bundles lift AOV');
    measured(c.id, 'test-1');
    measured(c.id, 'test-2');
    const against = measured(c.id, 'test-3', 'conflict');
    expect(stage(c.id)).toBe('tested');
    expect(reasons(c.id).at(-1)).toBe('Moved down to Experimentally Tested: contradicting evidence');
    expect(conflicts()).toEqual([{ card_id: c.id, other_card_id: null, evidence_id: listEvidence(db, c.id).at(-1)!.id, status: 'open' }]);
    expect(against.stage).toBe('tested');
  });

  test("the owner's stage is never moved by the app, though a conflict is still flagged", () => {
    const c = card('Bundles lift AOV');
    updateCard(db, c.id, { stage: 'validated' }, 'owner');
    measured(c.id, 'test-1', 'conflict');
    expect(stage(c.id)).toBe('validated');
    expect(conflicts()).toHaveLength(1);
  });

  test('a Validated Insight that drops below Validated goes back to its earlier type', () => {
    const c = card('Bundles lift AOV', { type: 'strategy' });
    measured(c.id, 'test-1');
    measured(c.id, 'test-2');
    updateCard(db, c.id, { type: 'validated_insight' }, 'owner');
    measured(c.id, 'test-3', 'conflict');
    expect(db.prepare('SELECT stage, type FROM kb_cards WHERE id = ?').get(c.id)).toEqual({ stage: 'tested', type: 'strategy' });
  });

  test('agents may only propose Hypotheses and Research-Supported cards, never Validated Insights or User-Provided ones', () => {
    expect(agentCardError({ type: 'research_finding', stage: 'hypothesis' })).toBeUndefined();
    expect(agentCardError({ type: 'strategy', stage: 'supported' })).toBeUndefined();
    expect(agentCardError({ type: 'research_finding', stage: 'tested' })).toMatch(/stage/);
    expect(agentCardError({ type: 'research_finding', stage: 'validated' })).toMatch(/stage/);
    expect(agentCardError({ type: 'validated_insight', stage: 'hypothesis' })).toMatch(/type/);
    expect(agentCardError({ type: 'user_provided', stage: 'hypothesis' })).toMatch(/type/);
  });
});

describe('evidence routes', () => {
  test('the owner adds and removes evidence; the stage follows; bad input and wrong workspaces are refused', async () => {
    const c = card('Bundles lift AOV');
    source('docs', 'https://help.shopify.test/bundles', 'platform_docs');
    const after = await ok<KbCard>('POST', `/api/kb/cards/${c.id}/evidence?ws=pawsome`, { kind: 'research', text: 'Shopify docs say bundles lift AOV', sourceId: 'docs' }, 201);
    expect(after.stage).toBe('supported');
    const list = await ok<KbEvidence[]>('GET', `/api/kb/cards/${c.id}/evidence?ws=pawsome`);
    expect(list).toMatchObject([{ kind: 'research', authorId: 'owner', source: { id: 'docs', url: 'https://help.shopify.test/bundles', reliability: 'platform_docs', status: 'read' } }]);
    expect((await req('POST', `/api/kb/cards/${c.id}/evidence?ws=pawsome`, { kind: 'rumour', text: 'xyz' })).status).toBe(400);
    expect((await req('POST', `/api/kb/cards/${c.id}/evidence?ws=pawsome`, { kind: 'measured', text: 'xyz', windowFrom: 'yesterday' })).status).toBe(400);
    source('other', 'https://x.test', 'unknown', 'read', 'glow');
    expect((await req('POST', `/api/kb/cards/${c.id}/evidence?ws=pawsome`, { kind: 'research', text: 'xyz', sourceId: 'other' })).status).toBe(400);
    expect((await req('POST', `/api/kb/cards/${c.id}/evidence?ws=glow`, { kind: 'observed', text: 'xyz' })).status).toBe(404);
    expect((await req('GET', `/api/kb/cards/${c.id}/evidence?ws=glow`)).status).toBe(404);
    expect((await req('DELETE', `/api/kb/evidence/${list[0]!.id}?ws=glow`)).status).toBe(404);
    expect((await ok<KbCard>('DELETE', `/api/kb/evidence/${list[0]!.id}?ws=pawsome`)).stage).toBe('hypothesis');
  });
});

describe('links', () => {
  test('the owner links two cards (confirmed, with why); duplicates and other stores are refused', async () => {
    const a = card('Rescue stories pull clicks');
    const g = card('Hooks decide the first three seconds', { ws: null });
    const other = card('Glow secret', { ws: 'glow' });
    const link = await ok<KbLink>('POST', '/api/kb/links', { ws: 'pawsome', from: a.id, to: g.id, type: 'applied_to', why: 'Our rescue hook applies the 3-second rule' }, 201);
    expect(link).toMatchObject({ storeId: 'pawsome', status: 'confirmed', authorId: 'owner', type: 'applied_to' });
    expect((await req('POST', '/api/kb/links', { ws: 'pawsome', from: a.id, to: g.id, type: 'applied_to', why: 'again' })).status).toBe(409);
    expect((await req('POST', '/api/kb/links', { ws: 'pawsome', from: a.id, to: other.id, type: 'supports', why: 'same idea' })).status).toBe(404);
    expect((await req('POST', '/api/kb/links', { ws: 'general', from: g.id, to: a.id, type: 'supports', why: 'same idea' })).status).toBe(404);
    expect((await req('POST', '/api/kb/links', { ws: 'pawsome', from: a.id, to: a.id, type: 'supports', why: 'same idea' })).status).toBe(400);
    expect((await req('POST', '/api/kb/links', { ws: 'pawsome', from: a.id, to: g.id, type: 'likes', why: 'same idea' })).status).toBe(400);
    expect((await ok<KbLink[]>('GET', `/api/kb/links?ws=pawsome&general=1&card=${a.id}`)).map((l) => l.id)).toContain(link.id);
    expect(await ok<KbLink[]>('GET', '/api/kb/links?ws=glow&general=1')).toEqual([]);
    expect((await req('PATCH', `/api/kb/links/${link.id}?ws=glow`, { status: 'rejected' })).status).toBe(404);
    expect((await req('DELETE', `/api/kb/links/${link.id}?ws=pawsome`)).status).toBe(204);
  });

  test('a confirmed "contradicts" link opens a conflict', async () => {
    const a = card('Rescue stories pull clicks');
    const b = card('Product demos beat stories');
    await ok<KbLink>('POST', '/api/kb/links', { ws: 'pawsome', from: a.id, to: b.id, type: 'contradicts', why: 'Opposite results on the same audience' }, 201);
    expect(conflicts()).toEqual([{ card_id: a.id, other_card_id: b.id, evidence_id: null, status: 'open' }]);
  });
});

describe('the suggester', () => {
  test('a new card gets suggested links to related cards in its store and in General, never to another store', () => {
    const same = card('Problem first hooks lift click through rate on TikTok');
    card('Problem first hooks lift click through rate on TikTok ads', { ws: 'glow' });
    const general = card('Problem first hooks lift click through rate', { ws: null });
    card('Free shipping over fifty dollars', { categoryId: 'p-seo' });
    const fresh = card('Problem first hooks raise click through rate for pet TikTok');
    const links = listLinks(db, 'pawsome', true, fresh.id);
    expect(links.map((l) => [l.toId, l.type, l.status, l.authorId]).sort()).toEqual(
      [
        [general.id, 'builds_upon', 'suggested', 'app'],
        [same.id, 'related_to', 'suggested', 'app'],
      ].sort(),
    );
    expect(links.find((l) => l.toId === same.id)!.why).toMatch(/^Same topic: .*hooks/);
    expect(links.every((l) => l.storeId === 'pawsome')).toBe(true);
  });

  test('accepting or rejecting a suggestion sticks: a rejected one is never suggested again', async () => {
    const a = card('Problem first hooks lift click through rate on TikTok');
    const b = card('Problem first hooks raise click through rate for pet TikTok');
    const [link] = listLinks(db, 'pawsome', false, b.id);
    expect(await ok<KbLink>('PATCH', `/api/kb/links/${link!.id}?ws=pawsome`, { status: 'rejected' })).toMatchObject({ status: 'rejected' });
    expect(suggestLinks(db, b.id)).toEqual([]);
    expect(listLinks(db, 'pawsome', false, a.id)).toEqual([]);
  });

  test('a possible contradiction is suggested and opens a conflict; rejecting it closes the conflict', async () => {
    const a = card('Problem first hooks lift click through rate on TikTok');
    const b = card('Problem first hooks do not lift click through rate on TikTok');
    const [link] = listLinks(db, 'pawsome', false, b.id);
    expect(link).toMatchObject({ fromId: b.id, toId: a.id, type: 'contradicts', status: 'suggested' });
    expect(conflicts()).toEqual([{ card_id: b.id, other_card_id: a.id, evidence_id: null, status: 'open' }]);
    await ok('PATCH', `/api/kb/links/${link!.id}?ws=pawsome`, { status: 'rejected' });
    expect(conflicts()).toMatchObject([{ status: 'resolved' }]);
  });

  test('cards citing the same source are linked when the evidence lands; at most three suggestions per card', () => {
    source('s1', 'https://study.test/a');
    const a = card('Rescue stories pull clicks');
    const b = card('Shelter partnerships build trust');
    research(a.id, 's1');
    research(b.id, 's1');
    expect(listLinks(db, 'pawsome', false, b.id)).toMatchObject([{ fromId: b.id, toId: a.id, type: 'related_to', why: 'Both cite "Title s1"' }]);
    for (let i = 0; i < 6; i++) card(`Problem first hooks lift click through rate variant ${i}`);
    const many = card('Problem first hooks lift click through rate variant x');
    expect(listLinks(db, 'pawsome', false, many.id).filter((l) => l.fromId === many.id).length).toBe(3);
  });
});

describe('reversing automated decisions', () => {
  test('restoring a revision brings the card back as it was, as a new revision, and the app leaves that stage alone', async () => {
    const c = card('Bundles lift AOV');
    measured(c.id, 'test-1');
    const revs = await ok<KbRevision[]>('GET', `/api/kb/cards/${c.id}/revisions?ws=pawsome`);
    expect(revs.map((r) => r.reason)).toEqual(['Moved up to Experimentally Tested: 1 measured test', 'Created']);
    const first = revs.at(-1)!;
    expect(first.snapshot).toMatchObject({ title: 'Bundles lift AOV', stage: 'hypothesis' });
    const back = await ok<KbCard>('POST', `/api/kb/cards/${c.id}/revisions/${first.id}/restore?ws=pawsome`);
    expect(back.stage).toBe('hypothesis');
    expect(reasons(c.id).at(-1)).toBe(`Restored revision ${first.id}`);
    measured(c.id, 'test-2');
    expect(stage(c.id)).toBe('hypothesis');
    expect((await req('POST', `/api/kb/cards/${c.id}/revisions/${first.id}/restore?ws=glow`)).status).toBe(404);
    expect((await req('POST', `/api/kb/cards/${c.id}/revisions/99999/restore?ws=pawsome`)).status).toBe(404);
  });

  test('detaching a merged card gives it back its evidence and its place, and both stages are weighed again', async () => {
    const keep = card('Bundles lift AOV');
    const from = card('Bundles raise order value');
    measured(from.id, 'test-1');
    measured(from.id, 'test-2');
    mergeCards(db, keep.id, from.id, 'owner');
    expect(stage(keep.id)).toBe('validated');
    const back = await ok<KbCard>('POST', `/api/kb/cards/${keep.id}/detach?ws=pawsome`, { from: from.id });
    expect(back).toMatchObject({ id: from.id, status: 'active', stage: 'validated' });
    expect(back.mergedInto).toBeUndefined();
    expect(stage(keep.id)).toBe('hypothesis');
    expect(listEvidence(db, from.id)).toHaveLength(2);
    expect(reasons(keep.id).at(-1)).toBe('Moved down to Hypothesis: evidence removed');
    expect(reasons(from.id)).toContain('Detached from "Bundles lift AOV"');
    expect(detachMerged(db, keep.id, from.id, 'owner')).toBeUndefined(); // nothing merged any more
  });

  test('a card merged into a card that is merged again can still be detached from where its evidence went', () => {
    const a = card('Bundles lift AOV');
    const b = card('Bundles raise order value');
    const c = card('Bundles grow basket size');
    measured(c.id, 'test-1');
    mergeCards(db, b.id, c.id, 'owner');
    mergeCards(db, a.id, b.id, 'owner');
    detachMerged(db, a.id, b.id, 'owner');
    expect(listEvidence(db, b.id)).toEqual([]);
    expect(detachMerged(db, a.id, c.id, 'owner')).toMatchObject({ id: c.id, status: 'active', stage: 'tested' });
    expect(listEvidence(db, c.id)).toHaveLength(1);
  });
});
