import { adjustConfidence, deleteMemory, listMemory, parseLearnings, promotionCandidates, searchMemory, updateMemory, writeMemory, type NewMemory } from '@frontline/agents';
import { beforeEach, describe, expect, test } from 'vitest';
import { openDb, type Db } from '../db';
import { insertStore } from '../stores';

let db: Db;
const now = new Date('2026-10-26T12:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
const store = (id: string, niche: 'beauty' | 'pet') =>
  insertStore(db, { id, name: id, platform: 'shopify', niche, currency: 'USD', timezone: 'America/Chicago', color: '#fff', connected: false });
const mem = (text: string, extra: Partial<NewMemory> = {}): NewMemory => ({ storeId: 'glow', agentId: 'glow:market_analyst', kind: 'learning', text, confidence: 0.6, ...extra });

beforeEach(() => {
  db = openDb();
  store('glow', 'beauty');
  store('lumi', 'beauty');
  store('pawsome', 'pet');
});

describe('store memory', () => {
  test('same text merges instead of duplicating', () => {
    const a = writeMemory(db, mem('LED masks convert best with before/after UGC', { tags: ['creatives'] }), now);
    const b = writeMemory(db, mem('led masks convert best with before/after UGC ', { confidence: 0.9, evidence: '3.1 ROAS vs 1.4', tags: ['led'] }), now);
    expect(b).toMatchObject({ id: a.id, confidence: 0.9, evidence: '3.1 ROAS vs 1.4', tags: ['creatives', 'led'] });
    expect(listMemory(db, 'glow')).toHaveLength(1);
  });

  test('ranks by relevance × recency × confidence', () => {
    const led = writeMemory(db, mem('LED face masks convert best with before/after UGC'), now);
    const pref = writeMemory(db, mem('Owner wants weekly reports on Monday mornings', { kind: 'preference', confidence: 0.9 }), now);
    const old = writeMemory(db, mem('Serums sell well in winter', { confidence: 0.9 }), daysAgo(200));
    writeMemory(db, { ...mem('LED masks are the top pet product'), storeId: 'pawsome' }, now);

    expect(searchMemory(db, 'glow', 'Which creatives work for LED masks?', 8, now).map((m) => m.id)).toEqual([led.id, pref.id, old.id]);
    expect(searchMemory(db, 'glow', '', 8, now).map((m) => m.id)).toEqual([pref.id, led.id, old.id]);
    expect(searchMemory(db, 'glow', 'mask', 1, now)).toHaveLength(1);
    expect(db.prepare('SELECT last_used_at FROM store_memory WHERE id = ?').get(led.id)?.last_used_at).toBe(now.toISOString());
  });

  test('edits and deletes keep the search index in sync; deleting a store drops its memory', () => {
    const m = writeMemory(db, mem('Free shipping threshold at $50 lifts AOV'), now);
    updateMemory(db, m.id, { text: 'Bundles of three lift AOV the most' });
    expect(searchMemory(db, 'glow', 'shipping threshold', 8, now)[0]).toMatchObject({ text: 'Bundles of three lift AOV the most' });
    expect(db.prepare(`SELECT count(*) AS n FROM store_memory_fts WHERE store_memory_fts MATCH 'shipping'`).get()?.n).toBe(0);
    expect(db.prepare(`SELECT count(*) AS n FROM store_memory_fts WHERE store_memory_fts MATCH 'bundles'`).get()?.n).toBe(1);
    expect(deleteMemory(db, m.id)).toBe(true);
    expect(db.prepare(`SELECT count(*) AS n FROM store_memory_fts WHERE store_memory_fts MATCH 'bundles'`).get()?.n).toBe(0);
    writeMemory(db, mem('Gift sets sell in December'), now);
    db.prepare(`DELETE FROM stores WHERE id = 'glow'`).run();
    expect(listMemory(db, 'glow')).toEqual([]);
  });

  test('pinned memories lead the list and are always in the prompt set, on top of k', () => {
    const old = writeMemory(db, mem('Never discount the LED mask below $79', { kind: 'preference', confidence: 0.3 }), daysAgo(400));
    for (const t of ['Serum bundles lift AOV', 'Ice rollers sell in summer', 'UGC beats studio shots']) writeMemory(db, mem(t), now);
    expect(searchMemory(db, 'glow', 'summer ice', 2, now).map((m) => m.text)).not.toContain(old.text);
    expect(updateMemory(db, old.id, { pinned: true })).toMatchObject({ pinned: true });
    expect(searchMemory(db, 'glow', 'summer ice', 2, now).map((m) => m.text)).toEqual([old.text, 'Ice rollers sell in summer', expect.any(String)]);
    expect(listMemory(db, 'glow')[0]?.id).toBe(old.id);
    expect(updateMemory(db, old.id, { pinned: false })).not.toHaveProperty('pinned');
  });

  test('outcome feedback moves confidence within 0..1', () => {
    const m = writeMemory(db, mem('Hook B beats hook A', { confidence: 0.8 }), now);
    expect(adjustConfidence(db, m.id, 0.5)?.confidence).toBe(1);
    expect(adjustConfidence(db, m.id, -1.5)?.confidence).toBe(0);
  });
});

describe('reflection', () => {
  test('parses learnings out of a chatty reply and drops bad items', () => {
    const reply = `Here you go:\n\`\`\`json\n[
      {"kind":"learning","text":"TikTok hooks under 2s double hold rate","evidence":"hold 41% vs 19%","confidence":1.4,"tags":["tiktok"]},
      {"kind":"opinion","text":"bad kind"},
      {"kind":"fact","text":"   "},
      {"kind":"preference","text":"Owner caps tests at $50/day"}
    ]\n\`\`\``;
    expect(parseLearnings(reply)).toEqual([
      { kind: 'learning', text: 'TikTok hooks under 2s double hold rate', evidence: 'hold 41% vs 19%', confidence: 1, tags: ['tiktok'] },
      { kind: 'preference', text: 'Owner caps tests at $50/day', confidence: 0.5, tags: [] },
    ]);
    expect(parseLearnings('Nothing durable this time.')).toEqual([]);
    expect(parseLearnings('[{oops')).toEqual([]);
  });
});

describe('niche promotion', () => {
  test('a confident learning seen in two stores of a niche becomes a candidate', () => {
    const a = writeMemory(db, mem('Before/after UGC beats studio shots for LED masks', { confidence: 0.8 }), now);
    const b = writeMemory(db, { ...mem('UGC before/after beats studio shots for LED masks on Meta', { confidence: 0.9 }), storeId: 'lumi', agentId: 'lumi:ad_strategist' }, now);
    writeMemory(db, mem('Studio shots beat UGC before/after for LED masks', { confidence: 0.5 }), now); // not confident enough
    writeMemory(db, { ...mem('Before/after UGC beats studio shots for LED masks', { confidence: 0.9 }), storeId: 'pawsome' }, now); // other niche
    writeMemory(db, { ...mem('Owner hates red packaging', { confidence: 0.9, kind: 'preference' }), storeId: 'lumi' }, now);

    const [candidate, ...rest] = promotionCandidates(db, 'beauty');
    expect(rest).toEqual([]);
    expect(candidate).toMatchObject({ storeIds: expect.arrayContaining(['glow', 'lumi']), memoryIds: expect.arrayContaining([a.id, b.id]) });
    expect(candidate?.confidence).toBeCloseTo(0.85);
    expect(promotionCandidates(db, 'pet')).toEqual([]);
  });
});
