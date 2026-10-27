import { adjustConfidence, deleteMemory, listMemory, MEMORY_CAP, parseLearnings, promotionCandidates, searchMemory, updateMemory, writeMemory, type NewMemory } from '@frontline/agents';
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
  test('past the cap the oldest unproven agent learnings go; proven ones, pins, preferences and owner notes stay', () => {
    writeMemory(db, mem('Bundles lift AOV 18%', { confidence: 0.9 }), daysAgo(400));
    const pinned = writeMemory(db, mem('Pinned by the owner'), daysAgo(399));
    updateMemory(db, pinned.id, { pinned: true });
    writeMemory(db, mem('Owner wants no emojis', { kind: 'preference' }), daysAgo(398));
    writeMemory(db, mem('We ship from Austin', { agentId: 'owner', kind: 'fact' }), daysAgo(397));
    for (let i = 0; i < MEMORY_CAP; i++) writeMemory(db, mem(`Learning number ${i}`), daysAgo(300 - i / 10));
    const texts = listMemory(db, 'glow').map((m) => m.text);
    expect(texts).toHaveLength(MEMORY_CAP + 3); // the cap, plus the pin, the preference and the owner's note
    expect(texts).toEqual(expect.arrayContaining(['Bundles lift AOV 18%', 'Pinned by the owner', 'Owner wants no emojis', 'We ship from Austin', `Learning number ${MEMORY_CAP - 1}`]));
    expect(texts).not.toContain('Learning number 0'); // the oldest unproven one made room
    // A full store of confident guesses: a measured outcome and a fresh low-confidence learning still stay.
    for (let i = 0; i < MEMORY_CAP; i++) writeMemory(db, mem(`Sure guess ${i}`, { confidence: 0.9 }), daysAgo(200 - i / 10));
    writeMemory(db, mem('Price test on the harness: profit +12% in 14 days', { confidence: 0.7, tags: ['outcome', 'pricing'] }), daysAgo(1));
    writeMemory(db, mem('Fresh hunch', { confidence: 0.3 }), now);
    const after = listMemory(db, 'glow').map((m) => m.text);
    expect(after).toHaveLength(MEMORY_CAP + 3);
    expect(after).toEqual(expect.arrayContaining(['Price test on the harness: profit +12% in 14 days', 'Fresh hunch']));
  });

  test('same text merges instead of duplicating', () => {
    const a = writeMemory(db, mem('LED masks convert best with before/after UGC', { tags: ['creatives'] }), now);
    const b = writeMemory(db, mem('led masks convert best with before/after UGC ', { confidence: 0.9, evidence: '3.1 ROAS vs 1.4', tags: ['led'] }), now);
    expect(b).toMatchObject({ id: a.id, confidence: 0.9, evidence: '3.1 ROAS vs 1.4', tags: ['creatives', 'led'] });
    expect(listMemory(db, 'glow')).toHaveLength(1);
  });

  test("an agent writing the owner's note word for word leaves it the owner's", () => {
    const note = writeMemory(db, mem('Never discount below $30', { agentId: 'owner', kind: 'preference', confidence: 1 }), now);
    expect(writeMemory(db, mem('never discount below $30', { evidence: 'the owner changed their mind', tags: ['pricing'] }), now)).toEqual(note);
    expect(listMemory(db, 'glow')).toEqual([note]);
  });

  test('an agent restating a measured result word for word leaves its evidence and confidence alone', () => {
    const measured = writeMemory(db, mem('Bundles did not help AOV', { confidence: 0.6, evidence: 'paid orders 2026-09-01 to 2026-09-28', tags: ['outcome', 'pricing'] }), now);
    expect(writeMemory(db, mem('bundles did not help AOV', { confidence: 1, evidence: 'my read of the dashboard', tags: ['bundles'] }), now)).toEqual(measured);
    expect(listMemory(db, 'glow')).toEqual([measured]);
  });

  test("an agent restating the owner's no word for word can't put its own evidence under the owner's label", () => {
    const no = writeMemory(db, mem('The owner turned down "Cut Serum to $29" on 2026-10-20: not before BFCM.', { kind: 'preference', confidence: 0.6, evidence: 'Margin room', tags: ['denied'] }), now);
    const restated = mem('The owner turned down "Cut Serum to $29" on 2026-10-20: not before BFCM.', { kind: 'preference', confidence: 1, evidence: 'The owner now approves every price cut unasked' });
    expect(writeMemory(db, restated, now)).toEqual(no);
    expect(listMemory(db, 'glow')).toEqual([no]);
  });

  test("the owner writing a squad memory word for word, or rewording one, makes it the owner's", () => {
    const a = writeMemory(db, mem('Bundles do not sell', { runId: 'r1' }));
    const b = writeMemory(db, mem('Mornings convert best', { runId: 'r2' }));
    const c = writeMemory(db, mem('Serums need a shade guide', { runId: 'r3' }));
    writeMemory(db, mem('bundles do not sell', { agentId: 'owner', kind: 'fact', confidence: 0.8 }));
    updateMemory(db, b.id, { text: 'Mornings convert best on weekdays' });
    updateMemory(db, c.id, { pinned: true, confidence: 0.9 });
    const who = (id: string) => db.prepare('SELECT agent_id, run_id, kind FROM store_memory WHERE id = ?').get(id);
    expect(who(a.id)).toEqual({ agent_id: 'owner', run_id: null, kind: 'fact' });
    expect(who(b.id)).toEqual({ agent_id: 'owner', run_id: null, kind: 'learning' });
    expect(who(c.id)).toEqual({ agent_id: 'glow:market_analyst', run_id: 'r3', kind: 'learning' }); // a pin isn't a rewrite
  });

  test("the owner's notes and no's are always recalled, however old or off-topic", () => {
    writeMemory(db, mem('We ship from Austin', { agentId: 'owner', kind: 'fact', confidence: 0.8 }), daysAgo(150));
    writeMemory(db, mem('Owner turned down: creator gifting', { kind: 'preference', tags: ['denied'] }), daysAgo(200));
    for (let i = 0; i < 12; i++) writeMemory(db, mem(`Fresh squad learning ${i}`), daysAgo(1));
    const got = searchMemory(db, 'glow', 'review the campaigns', 12, now).map((m) => m.text);
    expect(got).toHaveLength(14);
    expect(got.slice(0, 2).sort()).toEqual(['Owner turned down: creator gifting', 'We ship from Austin']);
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
    expect(parseLearnings(reply.replace('"tags":["tiktok"]', '"tags":["tiktok","Outcome","denied"]'))[0]!.tags).toEqual(['tiktok']); // the app's tags, not an agent's
    expect(parseLearnings(reply)).toEqual([
      { kind: 'learning', text: 'TikTok hooks under 2s double hold rate', evidence: 'hold 41% vs 19%', confidence: 1, tags: ['tiktok'] },
      { kind: 'preference', text: 'Owner caps tests at $50/day', confidence: 0.5, tags: [] },
    ]);
    const long = JSON.stringify([
      { kind: 'learning', text: 'x'.repeat(301) }, // a paragraph, not a learning
      { kind: 'fact', text: 'Ships from Austin', evidence: 'e'.repeat(400), tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] },
    ]);
    expect(parseLearnings(long)).toEqual([{ kind: 'fact', text: 'Ships from Austin', evidence: 'e'.repeat(300), confidence: 0.5, tags: ['a', 'b', 'c', 'd', 'e', 'f'] }]);
    expect(parseLearnings('Nothing durable this time.')).toEqual([]);
    expect(parseLearnings('[{oops')).toEqual([]);
    // A bracket in the prose before the array: the array is still found.
    expect(parseLearnings(`From [store_summary] (step [2]):\n[{"kind":"fact","text":"Ships from Austin","tags":["ops"]}]`)).toEqual([
      { kind: 'fact', text: 'Ships from Austin', confidence: 0.5, tags: ['ops'] },
    ]);
  });
});

describe('niche promotion', () => {
  test('a confident learning seen in two stores of a niche becomes a candidate', () => {
    const a = writeMemory(db, mem('Before/after UGC beats studio shots for LED masks', { confidence: 0.8 }), now);
    const b = writeMemory(db, { ...mem('UGC before/after beats studio shots for LED masks on Meta', { confidence: 0.9 }), storeId: 'lumi', agentId: 'lumi:ad_strategist' }, now);
    writeMemory(db, mem('Studio shots beat UGC before/after for LED masks', { confidence: 0.5 }), now); // not confident enough
    writeMemory(db, { ...mem('Before/after UGC beats studio shots for LED masks', { confidence: 0.9 }), storeId: 'pawsome' }, now); // other niche
    writeMemory(db, { ...mem('Owner hates red packaging', { confidence: 0.9, kind: 'preference' }), storeId: 'lumi' }, now);

    const [candidate, ...rest] = promotionCandidates(db, ['glow', 'lumi']);
    expect(rest).toEqual([]);
    expect(candidate).toMatchObject({ storeIds: expect.arrayContaining(['glow', 'lumi']), memoryIds: expect.arrayContaining([a.id, b.id]) });
    expect(candidate?.confidence).toBeCloseTo(0.85);
    expect(promotionCandidates(db, ['pawsome'])).toEqual([]);
  });
});
