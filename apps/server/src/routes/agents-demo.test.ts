import { listCreatives, listFlowDrafts, listOrderIssues, listPageDrafts } from '@frontline/agents';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { decide } from '../approvals';
import { addDays, localDate } from '../dates';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { runManager } from './agents';

let db: Db;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  createApp(db);
});
const go = async (agentId: string, task: string) => {
  const m = runManager(db);
  const run = m.start(agentId, task);
  if (typeof run === 'string') throw new Error(run);
  await m.idle();
};

test('demo runs do one real, non-blocking piece of each role’s work', async () => {
  const productId = String(db.prepare(`SELECT id FROM products WHERE store_id = 'glow' ORDER BY price LIMIT 1`).get()?.id);
  await go('glow:store_developer', `Draft the product pages for: Cheap thing (productId ${productId}).`);
  await go('glow:store_developer', `Draft the product pages for: Cheap thing (productId ${productId}).`);
  expect(listPageDrafts(db, { storeIds: ['glow'] }).map((d) => [d.productId, d.status])).toEqual([[productId, 'draft']]);
  const [a, b] = db.prepare(`SELECT id FROM products WHERE store_id = 'glow' ORDER BY price DESC LIMIT 2`).all().map((r) => String(r.id));
  await go('glow:store_developer', `New draft product(s) just added to Glow Haus: A (productId ${a}), B (productId ${b}).`);
  expect(listPageDrafts(db, { storeIds: ['glow'] }).map((d) => d.productId).sort()).toEqual([productId, a, b].sort()); // one page per new product

  const orderId = String(db.prepare(`SELECT id FROM orders WHERE store_id = 'glow' ORDER BY created_at LIMIT 1`).get()?.id);
  db.prepare(`UPDATE orders SET fulfillment_status = 'unfulfilled', local_date = ? WHERE store_id = 'glow' AND id = ?`).run(addDays(localDate(), -9), orderId);
  await go('glow:operations', 'Daily order check');
  expect(listOrderIssues(db, { storeIds: ['glow'] }).map((i) => [i.orderId, i.kind])).toContainEqual([orderId, 'late']);
  db.prepare(`UPDATE order_issues SET status = 'resolved' WHERE order_id = ?`).run(orderId);
  await go('glow:operations', 'Daily order check');
  expect(listOrderIssues(db, { storeIds: ['glow'], status: 'open' }).map((i) => i.orderId)).not.toContain(orderId); // resolved stays resolved

  await go('glow:email_sms', 'Plan retention flows');
  expect(listFlowDrafts(db, { storeIds: ['glow'] }).map((f) => f.name)).toEqual(['Checkout abandonment']);

  await go('glow:ad_strategist', 'Review campaigns');
  expect(db.prepare('SELECT count(*) AS n FROM approvals WHERE run_id IS NOT NULL').get()?.n).toBe(0); // demo runs never wait on the owner
});

test('a demo Creative Studio run asks before rendering, like a real one; approved, the render lands in the library', async () => {
  const m = runManager(db);
  const run = m.start('glow:creative_studio', 'Make a 9:16 UGC avatar video ad and save it to the creatives library. Brief: A creator unboxes it in a car.');
  if (typeof run === 'string') throw new Error(run);
  const pending = () => db.prepare(`SELECT id, title FROM approvals WHERE run_id = ? AND status = 'pending'`).get(run.id);
  for (let i = 0; i < 50 && !pending(); i++) await new Promise((r) => setImmediate(r));
  expect(String(pending()?.title)).toMatch(/^Generate 9:16 ugc ad: .+: see the difference$/);
  decide(db, String(pending()!.id), 'approve');
  await m.idle();
  expect(listCreatives(db, { storeIds: ['glow'] })[0]).toMatchObject({ kind: 'ugc', aspect: '9:16', source: 'demo', prompt: 'A creator unboxes it in a car.', credits: 40 });
});

test('demo Ad Variations makes the variations asked for, each with its own hook', async () => {
  const m = runManager(db);
  const run = m.start('glow:creative_studio', 'Make 3 variations of our best ad with different hooks. Make a 1:1 image ad and save it to the creatives library. Brief: Keep the shot.');
  if (typeof run === 'string') throw new Error(run);
  const asked: string[] = [];
  for (let i = 0; i < 200 && asked.length < 3; i++) {
    const p = db.prepare(`SELECT id, title FROM approvals WHERE run_id = ? AND status = 'pending'`).get(run.id);
    if (p) asked.push(String(p.title)), decide(db, String(p.id), 'approve');
    await new Promise((r) => setImmediate(r));
  }
  await m.idle();
  expect(asked.map((t) => t.split(': ').at(-1))).toEqual(['see the difference', 'what everyone is switching to', expect.stringMatching(/^now \$/)]);
});

test("demo actions on a creative card keep the creative's kind: captions on a video make a video", async () => {
  const made = async (task: string) => {
    const m = runManager(db);
    const run = m.start('glow:creative_studio', task);
    if (typeof run === 'string') throw new Error(run);
    const kinds: string[] = [];
    for (let i = 0; i < 200 && !(kinds.length && m.get(run.id)?.status !== 'running' && m.get(run.id)?.status !== 'queued'); i++) {
      const p = db.prepare(`SELECT id, title FROM approvals WHERE run_id = ? AND status = 'pending'`).get(run.id);
      if (p) kinds.push(String(p.title).split(' ')[2]!), decide(db, String(p.id), 'approve');
      await new Promise((r) => setImmediate(r));
    }
    await m.idle();
    return kinds;
  };
  expect(await made('Add on-screen captions to this video ad and save the new version: "Glow: see it". Brief: A creator unboxes it.')).toEqual(['video']);
  expect(await made('Make 3 variations of this 9:16 UGC avatar video ad with different hooks and save them: "Glow". Original brief: In a car.')).toEqual(['ugc', 'ugc', 'ugc']);
});

test("a demo Ask AI question reads the data it's about", async () => {
  const asked = async (q: string) => {
    const m = runManager(db);
    const run = m.start('glow:market_analyst', q);
    if (typeof run === 'string') throw new Error(run);
    await m.idle();
    return m.get(run.id)!.transcript!.flatMap((e) => (e.type === 'tool_call' ? [e.name] : []));
  };
  expect(await asked('Which product sells best this month?')).toEqual(['list_products', 'store_summary']);
  expect(await asked('Are my ads profitable?')).toEqual(['list_campaigns', 'store_summary']);
  expect(await asked('What are competitors charging?')).toEqual(['list_competitors', 'store_summary']);
  expect(await asked('How did we do this week?')).toEqual(['metrics_timeseries', 'store_summary']);
});
