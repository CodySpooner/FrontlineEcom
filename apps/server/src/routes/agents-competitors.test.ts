import { fakeEngine, getAgent, runAgent, type FakeStep } from '@frontline/agents';
import type { AgentEvent } from '@frontline/shared';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { seedCompetitors } from '../competitors';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { getStore } from '../stores';
import { toolEnv } from './agents';

let db: Db;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  seedCompetitors(db);
  createApp(db);
  // A Shopify storefront's public catalog; any other site has none.
  vi.stubGlobal('fetch', async (url: string) => {
    const u = new URL(url);
    if (u.hostname === 'rival.example.com' && u.pathname === '/products.json') return Response.json({ products: [{ title: 'Trail Harness', variants: [{ price: '39.00', compare_at_price: null }] }] });
    if (u.hostname === 'rival.example.com' && u.pathname === '/meta.json') return Response.json({ currency: 'USD' });
    return new Response('not found', { status: 404 });
  });
});
afterEach(() => vi.unstubAllGlobals());

async function run(steps: FakeStep[]) {
  const agent = getAgent(db, 'pawsome:market_analyst')!;
  const out: string[] = [];
  for await (const e of runAgent({ agent, store: getStore(db, 'pawsome')!, task: 't', env: toolEnv(db) }, fakeEngine(() => steps)) as AsyncIterable<AgentEvent>) {
    if (e.type === 'tool_result') out.push(e.output);
  }
  return out;
}
const track = (name: string, url: string): FakeStep => ({ call: 'track_competitor', input: { name, url, why: 'Sells the same harnesses at $35-45' } });

test('the Market Analyst starts tracking a competitor shop and reads its prices at once', async () => {
  const out = await run([
    track('Rival', 'https://rival.example.com'),
    track('Rival again', 'https://www.rival.example.com/collections/all'),
    track('A blog', 'https://blog.example.org'),
    { call: 'list_competitors', input: { q: 'trail harness' } },
  ]);
  expect(out.slice(0, 3)).toEqual([
    'Tracking Rival (rival.example.com): 1 product price read. list_competitors with q compares them.',
    'Already tracked: rival.example.com.',
    'Not added: no product prices could be read at blog.example.org (the app reads Shopify, WooCommerce and Etsy shops). Name it in your answer instead.',
  ]);
  expect(out[3]).toContain('\nRival,Trail Harness,39,,USD,');
  expect(db.prepare(`SELECT name, notes FROM competitors WHERE store_id = 'pawsome' AND name IN ('Rival', 'A blog')`).all()).toEqual([
    { name: 'Rival', notes: 'Market Analyst: Sells the same harnesses at $35-45' },
  ]);
  expect(db.prepare(`SELECT body FROM notifications WHERE store_id = 'pawsome' AND title = 'Now tracking Rival'`).get()?.body).toBe(
    "Market Analyst: Sells the same harnesses at $35-45 Remove it in Competitor Intel if it isn't one.",
  );
});

test('a store tracks 10 competitors at most; with none, list_competitors says who adds them', async () => {
  const add = db.prepare(`INSERT INTO competitors (id, store_id, name, url, notes, created_at) VALUES (?, 'pawsome', ?, ?, NULL, '2026-10-01T00:00:00Z')`);
  for (let i = 0; i < 8; i++) add.run(`c${i}`, `Shop ${i}`, `https://shop${i}.example.com`); // next to its 2 demo ones
  expect(await run([track('Rival', 'https://rival.example.com')])).toEqual([
    'Not added: this store already tracks 10 competitors. Name this one in your answer so the owner can swap it in.',
  ]);
  db.prepare(`DELETE FROM competitors WHERE store_id = 'pawsome'`).run();
  expect((await run([{ call: 'list_competitors' }]))[0]).toContain(
    "\n# Recent ads (none recorded: the app doesn't read ad libraries, so this says nothing about whether they advertise)\n(none)",
  );
  expect((await run([{ call: 'list_competitors' }]))[0]).toMatch(
    /^# Competitors \(none tracked yet: the Market Analyst adds them with track_competitor, the owner in Competitor Intel\)\n\(none\)\n/,
  );
});
