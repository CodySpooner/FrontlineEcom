import { randomUUID } from 'node:crypto';
import { createConversation, createRunManager, fakeEngine, getConfig, resolveType, seatDefault } from '@frontline/agents';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { toolEnv } from '../routes/agents';
import { updateCaps } from '../settings';
import { getStore } from '../stores';

// Agents & Providers → AI usage per day (ST-23): its help says Codex and demo runs add nothing to the cap, but once it's
// used up no new run starts on the store, Codex and demo included. This keeps that sentence tied to runs.ts.
let db: Db;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  createApp(db);
});

/** A Claude run that spent `usd` today on the store. */
const spent = (store: string, usd: number) => {
  const now = new Date().toISOString();
  db.prepare("INSERT INTO agent_runs (id, store_id, agent_id, task, status, cost_usd, created_at, ended_at) VALUES (?, ?, ?, 'T', 'done', ?, ?, ?)").run(randomUUID(), store, `${store}:market_analyst`, usd, now, now);
};

test("a used-up AI cap refuses a Codex run and a demo run on its store", () => {
  const m = createRunManager({ db, env: toolEnv(db), store: (id) => getStore(db, id), engine: fakeEngine() });
  updateCaps(db, 'glow', { agentCostPerDay: 1 });
  spent('glow', 1);
  const store = getStore(db, 'glow')!;
  const type = resolveType(db, 'glow', 'copywriter')!;
  const c = createConversation(db, store, type, { ...seatDefault(store, type), runtime: 'codex', model: 'gpt-6.1-sol', effort: 'low', permissions: { stopAfterMin: 20, saveFindings: 'off' } }, { title: 'Codex check' });
  expect(getConfig(db, c.configId)?.runtime).toBe('codex');
  expect(m.start(c.agentId, 'Draft the spring hero line', undefined, undefined, { conversationId: c.id })).toBe("Today's AI budget for this store ($1) is used up. Raise it in Settings.");

  expect(getStore(db, 'peak')?.connected).toBeFalsy(); // demo data: its runs are on the demo engine
  updateCaps(db, 'peak', { agentCostPerDay: 0.5 });
  spent('peak', 0.5);
  expect(m.start('peak:copywriter', 'Draft a product line')).toBe("Today's AI budget for this store ($0.5) is used up. Raise it in Settings.");
  expect(typeof m.start('pawsome:copywriter', 'Draft a product line')).toBe('object'); // another store's cap is its own
});
