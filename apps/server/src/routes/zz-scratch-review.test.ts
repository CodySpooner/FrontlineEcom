import { costToday, createRunManager, getRun, type Engine, type RunManagerOptions } from '@frontline/agents';
import type { AgentRun } from '@frontline/shared';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { updateCaps } from '../settings';
import { getStore } from '../stores';
import { toolEnv } from './agents';

let db: Db;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  createApp(db);
});
const manager = (o: Partial<RunManagerOptions> = {}) => createRunManager({ db, env: toolEnv(db), store: (id) => getStore(db, id), ...o });
const ok = (r: AgentRun | string) => {
  if (typeof r === 'string') throw new Error(r);
  return r;
};

test('a run queued before midnight spends outside today\'s cap', async () => {
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  const engine: Engine = async function* (input) {
    if (input.task === 'a') {
      await gate;
      return yield { type: 'done', sessionId: 's', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0.02 } };
    }
    input.onSpend?.(5); // way past the $1 cap
    yield { type: 'text_delta', text: 'working' };
    if (input.signal?.aborted) return;
    yield { type: 'done', sessionId: 's2', usage: { inputTokens: 0, outputTokens: 0, costUsd: 5 } };
  };
  const m = manager({ engine });
  updateCaps(db, 'glow', { agentCostPerDay: 1 });
  ok(m.start('glow:copywriter', 'a'));
  const b = ok(m.start('glow:copywriter', 'b')); // queued behind the agent's own run
  const yesterday = new Date();
  yesterday.setHours(0, 0, 0, 0);
  db.prepare('UPDATE agent_runs SET created_at = ? WHERE id = ?').run(new Date(yesterday.getTime() - 3_600_000).toISOString(), b.id);
  open();
  await m.idle();
  console.log('B', getRun(db, b.id)?.status, getRun(db, b.id)?.usage.costUsd, 'costToday', costToday(db, 'glow'));
  console.log('next start', typeof m.start('glow:ad_strategist', 'c'));
  await m.idle();
});
