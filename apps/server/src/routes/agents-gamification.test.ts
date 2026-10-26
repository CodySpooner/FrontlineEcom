import { createRunManager, fakeEngine, getAgent, levelForXp, REFLECTION_PROMPT } from '@frontline/agents';
import type { Achievement, Agent, Commander, LiveMessage, Mission } from '@frontline/shared';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { decide } from '../approvals';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { subscribe } from '../live';
import { getStore } from '../stores';
import { runHooks, toolEnv } from './agents';

let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  app = createApp(db);
});
const get = async <T>(path: string) => (await app.request(path)).json() as Promise<T>;
const xpOf = (id: string) => getAgent(db, id)!.xp;
const tick = () => new Promise((r) => setImmediate(r));

/** Live `xp` messages published while `fn` runs. */
async function xpMessages(fn: () => unknown) {
  const seen: Extract<LiveMessage, { type: 'xp' }>[] = [];
  const off = subscribe((m) => {
    if (m.type === 'xp') seen.push(m);
  });
  await fn();
  off();
  return seen;
}

test('demo squads come with varied levels; new stores start at level 1', async () => {
  const agents = await get<Agent[]>('/api/agents');
  expect(new Set(agents.map((a) => a.level)).size).toBeGreaterThan(3);
  for (const a of agents) expect(a).toMatchObject({ level: levelForXp(a.xp), rank: expect.any(String), levelProgress: { needed: a.level * 100 }, nextLevelXp: 50 * a.level * (a.level + 1) });
  const res = await app.request('/api/stores', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'New Shop', platform: 'shopify', niche: 'pet', currency: 'USD', timezone: 'UTC' }),
  });
  const store = (await res.json()) as { id: string };
  expect(getAgent(db, `${store.id}:copywriter`)).toMatchObject({ xp: 0, level: 1, rank: 'Recruit', levelProgress: { xp: 0, needed: 100 } });
});

test('finished runs and learnings pay the agent once, with live XP messages', async () => {
  const before = xpOf('glow:market_analyst');
  const learning = '[{"kind":"fact","text":"Glow ships mostly to California","evidence":"41% of 30d orders","confidence":0.8}]';
  const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const m = createRunManager({
    db,
    env: toolEnv(db),
    store: (id) => getStore(db, id),
    engine: fakeEngine((input) =>
      input.task === REFLECTION_PROMPT
        ? [{ type: 'text_delta', text: learning }, { type: 'done', sessionId: 's', usage }]
        : [{ call: 'list_orders' }, { type: 'done', sessionId: 's', usage }],
    ),
    ...runHooks(db),
  });
  const seen = await xpMessages(async () => {
    m.start('glow:market_analyst', 'Where do our buyers live?');
    await m.idle();
  });
  expect(seen.map((s) => [s.xp.amount, s.xp.reason])).toEqual([
    [5, 'Learned: Glow ships mostly to California'],
    [10, 'Completed: Where do our buyers live?'],
  ]);
  expect(xpOf('glow:market_analyst')).toBe(before + 15);
});

test('an approved request pays the agent that made it; a denied one does not', async () => {
  const [a, b] = db
    .prepare(`SELECT id, agent_id FROM approvals WHERE status = 'pending' ORDER BY id LIMIT 2`)
    .all()
    .map((r) => ({ id: String(r.id), agent: String(r.agent_id) }));
  const before = [xpOf(a!.agent), xpOf(b!.agent)];
  const seen = await xpMessages(async () => {
    decide(db, a!.id, 'approve');
    decide(db, a!.id, 'approve');
    decide(db, b!.id, 'deny');
    await tick();
  });
  expect(seen).toHaveLength(1);
  expect(seen[0]?.xp).toMatchObject({ agentId: a!.agent, amount: 25, reason: expect.stringContaining('Request approved:') });
  expect(xpOf(a!.agent)).toBe(before[0]! + 25);
  if (a!.agent !== b!.agent) expect(xpOf(b!.agent)).toBe(before[1]);
});

test('missions: 3 per store; completing one pays the commander once', async () => {
  expect(await get<Mission[]>('/api/missions')).toHaveLength(9);
  expect((await get<Mission[]>('/api/missions?stores=glow')).map((m) => m.id.split(':').at(-1))).toEqual(['revenue', 'orders', 'requests']);

  const before = (await get<Commander>('/api/commander')).xp;
  for (const r of db.prepare(`SELECT id FROM approvals WHERE store_id = 'glow' AND status = 'pending'`).all()) decide(db, String(r.id), 'approve');
  await tick();
  const seen = await xpMessages(() => get('/api/missions?stores=glow'));
  expect(seen.map((s) => s.xp.reason)).toContain('Mission complete: Clear all agent requests');
  expect(await xpMessages(() => get('/api/missions?stores=glow'))).toEqual([]);
  expect((await get<Commander>('/api/commander')).xp - before).toBe(seen.reduce((n, s) => n + s.xp.amount, 0));
});

test('achievements unlock from store results and level the commander', async () => {
  const list = await get<Achievement[]>('/api/achievements');
  expect(list).toHaveLength(10);
  const unlocked = list.filter((a) => a.unlockedAt).map((a) => a.id);
  expect(unlocked).toEqual(expect.arrayContaining(['first_sale', 'squad_deployed', 'ten_k_month']));
  expect(unlocked).not.toContain('first_orders');
  const commander = await get<Commander>('/api/commander');
  expect(commander.xp).toBe(list.filter((a) => a.unlockedAt).reduce((n, a) => n + a.xp, 0));
  expect(commander).toMatchObject({ level: levelForXp(commander.xp), rank: expect.any(String), streakDays: expect.any(Number) });
  expect((await get<Commander>('/api/commander')).xp).toBe(commander.xp);
});
