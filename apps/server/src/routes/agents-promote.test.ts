import { listNicheLearnings, once, writeMemory } from '@frontline/agents';
import type { Niche } from '@frontline/shared';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { decide } from '../approvals';
import { openDb, type Db } from '../db';
import { insertStore } from '../stores';
import { proposeNichePromotions } from './agents-gamification';

let db: Db;
const store = (id: string, niche: Niche, connected: boolean) =>
  insertStore(db, { id, name: id, platform: 'shopify', niche, currency: 'USD', timezone: 'America/Chicago', color: '#fff', connected });
const learn = (storeId: string, text: string, confidence = 0.8) => writeMemory(db, { storeId, agentId: `${storeId}:ad_strategist`, kind: 'learning', text, confidence });
const requests = () => db.prepare(`SELECT id, store_id, action_json FROM approvals WHERE json_extract(action_json, '$.kind') = 'niche.promote_learning'`).all();

beforeEach(() => {
  db = openDb();
  store('glow', 'beauty', true);
  store('lumi', 'beauty', true);
  store('pawsome', 'pet', true);
  store('pawdemo', 'pet', false);
  createApp(db); // the approval executors; going live runs before the learnings below exist
});

test('a learning two live stores of a niche found on their own is offered to the whole niche, once; approved, the niche has it', async () => {
  learn('glow', 'Before/after UGC beats studio shots for LED masks');
  learn('lumi', 'Before/after UGC beats studio shots for serums', 0.75);
  learn('glow', 'Owner prefers Tuesday launches', 0.9); // only one store
  proposeNichePromotions(db);
  proposeNichePromotions(db);
  const [r, ...more] = requests();
  expect(more).toEqual([]);
  expect(r!.store_id).toBe('glow');
  expect(JSON.parse(String(r!.action_json)).payload).toEqual({ niche: 'beauty', text: 'Before/after UGC beats studio shots for LED masks', evidence: 'Held in glow, lumi' });
  decide(db, String(r!.id), 'approve');
  await new Promise((done) => setImmediate(done));
  expect(listNicheLearnings(db, 'beauty').map((l) => l.text)).toEqual(['Before/after UGC beats studio shots for LED masks']);
});

test('a learning offered once is not offered again when another store words it more confidently', async () => {
  learn('glow', 'Before/after UGC beats studio shots for LED masks');
  learn('lumi', 'Before/after UGC beats studio shots for serums', 0.75);
  proposeNichePromotions(db);
  decide(db, String(requests()[0]!.id), 'deny');
  learn('lumi', 'Before/after UGC beats studio shots for serums', 0.95); // now the group's lead wording
  proposeNichePromotions(db);
  expect(requests()).toHaveLength(1);
});

test("a connected store that hasn't gone live yet still holds demo learnings: they don't count", () => {
  store('nova', 'beauty', true); // synced after startup; activateConnectedStores hasn't run for it
  learn('glow', 'Serum bundles lift AOV by a fifth');
  learn('nova', 'Serum bundles lift AOV by a fifth');
  proposeNichePromotions(db);
  expect(requests()).toEqual([]);
});

test('custom niches share by their own name: candle stores with each other, not with every custom store', () => {
  for (const [id, detail] of [['wick', 'Soy candles'], ['flame', 'soy candles'], ['ink', 'Fountain pens']] as const) {
    insertStore(db, { id, name: id, platform: 'shopify', niche: 'other', nicheDetail: detail, currency: 'USD', timezone: 'America/Chicago', color: '#fff', connected: true });
    once(db, `activate:${id}`);
    learn(id, 'Gift sets sell best in the two weeks before Mother’s Day');
  }
  proposeNichePromotions(db);
  const [r, ...more] = requests();
  expect(more).toEqual([]);
  expect(JSON.parse(String(r!.action_json)).payload).toMatchObject({ niche: 'other:soy-candles', evidence: expect.stringMatching(/^Held in (wick, flame|flame, wick)$/) });
});

test("a demo store's simulated learning doesn't count toward sharing", () => {
  learn('pawsome', 'Lick mats sell best bundled with a spatula');
  learn('pawdemo', 'Lick mats sell best bundled with a spatula');
  proposeNichePromotions(db);
  expect(requests()).toEqual([]);
});
