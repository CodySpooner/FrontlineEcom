import { fakeEngine, getAgent, runAgent, type FakeStep } from '@frontline/agents';
import type { AgentEvent } from '@frontline/shared';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { seedCompetitors } from '../competitors';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { getStore } from '../stores';
import { toolEnv } from './agents';

// No real DNS in tests: one name answers with a loopback address; the rest don't resolve, which core's publicFetch lets through.
vi.mock('node:dns/promises', () => ({
  lookup: async (host: string) => (host === 'rival.localtest.me' ? [{ address: '127.0.0.1', family: 4 }] : Promise.reject(new Error('ENOTFOUND'))),
}));

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

test('a shop address on this computer or its network is refused before the app fetches it', async () => {
  const fetched: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => (fetched.push(url), new Response('not found', { status: 404 })));
  const urls = ['http://localhost:4000', 'http://2130706433/', 'http://[::1]/', 'http://192.168.1.1/admin', 'http://172.20.0.5', 'http://10.0.0.2', 'http://169.254.169.254/latest', 'http://router/', 'https://nas.local/'];
  expect(await run(urls.map((u, i) => track(`Shop ${i}`, u)))).toEqual(
    urls.map(() => "Not added: give the shop's public web address (the app reads it from this computer every day, so never a local or private one)."),
  );
  expect(fetched).toEqual([]);
  expect(await run([track('Rival', 'https://10.example.com')])).not.toEqual([expect.stringMatching(/public web address/)]); // a public name
});

test("a public-looking name whose DNS answer is this computer isn't read or tracked", async () => {
  const fetched: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => (fetched.push(url), Response.json({ products: [{ title: 'Trail Harness', variants: [{ price: '39.00', compare_at_price: null }] }] })));
  expect(await run([track('Loop', 'https://rival.localtest.me')])).toEqual([
    "Not added: rival.localtest.me points at this computer or its network, so the app won't read it. Give the shop's public web address.",
  ]);
  expect(fetched).toEqual([]);
  expect(db.prepare(`SELECT 1 FROM competitors WHERE name = 'Loop'`).get()).toBeUndefined();
});

test('every Etsy shop is on etsy.com: one is told from another by its shop', async () => {
  db.prepare(`INSERT INTO competitors (id, store_id, name, url, notes, created_at) VALUES ('e1', 'pawsome', 'Pup Knits', 'https://www.etsy.com/shop/PupKnits', NULL, '2026-10-01T00:00:00Z')`).run();
  expect(await run([track('Pup Knits', 'https://www.etsy.com/de/shop/pupknits?ref=x'), track('Bark Goods', 'https://www.etsy.com/shop/BarkGoods')])).toEqual([
    'Already tracked: etsy.com/shop/pupknits.',
    "Not added: no product prices could be read at etsy.com/shop/barkgoods (an Etsy shop is read with a connected Etsy store's app key, and the address must be its shop page (etsy.com/shop/<name>)). Name it in your answer instead.",
  ]);
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
