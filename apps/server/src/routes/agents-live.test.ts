import { createRunManager, getRun, type RunManager } from '@frontline/agents';
import type { AgentEvent, AgentRun } from '@frontline/shared';
import { beforeEach, expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { getStore } from '../stores';
import { toolEnv } from './agents';

let db: Db;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  createApp(db); // deploys the squads
});

const done: AgentEvent = { type: 'done', sessionId: 's1', usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 } };
function manager(engine: () => AsyncIterable<AgentEvent>, live: { seq: number; event: AgentEvent }[] = []): RunManager {
  return createRunManager({ db, store: (id) => getStore(db, id), env: toolEnv(db), engine, onEvent: (_run, event, seq) => live.push({ seq, event }) });
}

test("the live feed numbers each run's events, and a running run reads with its transcript so far and that number; a queued one reads 0", async () => {
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  const live: { seq: number; event: AgentEvent }[] = [];
  const m = manager(async function* () {
    yield { type: 'text_delta', text: 'Hel' };
    await gate;
    yield { type: 'text_delta', text: 'lo' };
    yield done;
  }, live);
  const first = m.start('glow:copywriter', 'Say hello') as AgentRun;
  const second = m.start('glow:copywriter', 'Say it again') as AgentRun; // one run per agent: this one waits
  await vi.waitFor(() => expect(live.map((l) => l.seq)).toEqual([1]));
  // A client that refetches now gets everything up to event 1, and appends from event 2 on.
  expect(m.get(first.id)).toMatchObject({ status: 'running', transcript: [{ type: 'text_delta', text: 'Hel' }], seq: 1 });
  expect(m.get(second.id)).toMatchObject({ status: 'queued', transcript: [], seq: 0 });
  open();
  await m.idle();
  expect(live.map((l) => l.seq)).toEqual([1, 2, 3, 1, 2, 3]); // each run counts its own: Hel, lo, done
  expect(m.get(first.id)!.seq).toBeUndefined(); // ended: the stored transcript is the whole of it
  expect(m.get(first.id)!.transcript).toEqual([{ type: 'text_delta', text: 'Hello' }, done]);
});

test('an engine that dies mid-run reads as a lost connection with a retry; other throws keep their message', async () => {
  const dies = (message: string) =>
    manager(async function* () {
      yield { type: 'text_delta', text: 'Working' };
      throw new Error(message);
    });
  const m = dies('socket hang up');
  const run = m.start('glow:copywriter', 'Write it') as AgentRun;
  await m.idle();
  expect(getRun(db, run.id)).toMatchObject({ status: 'error', error: 'Lost the connection to Claude (socket hang up). Retry in a few minutes.' });
  const other = dies('Unexpected token in JSON');
  const second = other.start('glow:ad_strategist', 'Plan it') as AgentRun;
  await other.idle();
  expect(getRun(db, second.id)!.error).toBe('Unexpected token in JSON');
});
