import { expect, test } from 'vitest';
import { conversationState, INTERRUPTED, runState, storeHealth } from './index';

test('store health: bleeding when losing money, winning from 15% net margin', () => {
  expect(storeHealth({ revenue: 10_000, profit: 2_000 })).toEqual({ status: 'winning', marginPct: 20, bar: 2 / 3 });
  expect(storeHealth({ revenue: 10_000, profit: 1_499 })).toMatchObject({ status: 'winning', marginPct: 15 }); // judged on the margin shown
  expect(storeHealth({ revenue: 10_000, profit: 1_449 })).toMatchObject({ status: 'steady', marginPct: 14.5 });
  expect(storeHealth({ revenue: 10_000, profit: -1 })).toMatchObject({ status: 'bleeding', bar: 0 });
  expect(storeHealth({ revenue: 0, profit: 0 })).toEqual({ status: 'steady', marginPct: 0, bar: 0 });
  expect(storeHealth({ revenue: 100, profit: 60 }).bar).toBe(1);
});

test('run state: the DB status, plus approval and question waits and restart interruptions', () => {
  expect(runState({ status: 'queued' })).toBe('queued');
  expect(runState({ status: 'running' })).toBe('running');
  expect(runState({ status: 'running' }, ['ads.set_budget'])).toBe('awaiting_approval');
  expect(runState({ status: 'running' }, ['question'])).toBe('waiting_for_input');
  expect(runState({ status: 'running' }, ['question', 'kb.save'])).toBe('awaiting_approval');
  expect(runState({ status: 'done' }, ['ads.set_budget'])).toBe('completed'); // a request left open after the run: the run is done
  expect(runState({ status: 'error', error: 'Rate limited' })).toBe('failed');
  expect(runState({ status: 'error', error: INTERRUPTED })).toBe('interrupted');
  expect(runState({ status: 'cancelled' })).toBe('cancelled');
});

test("conversation state: a running run's state, else queued, else the latest run's; idle only with no runs", () => {
  expect(conversationState([])).toBe('idle');
  expect(conversationState(['queued', 'running'])).toBe('running'); // a newer queued send waits on the running reply
  expect(conversationState(['queued', 'awaiting_approval'])).toBe('awaiting_approval');
  expect(conversationState(['waiting_for_input', 'completed'])).toBe('waiting_for_input');
  expect(conversationState(['failed', 'queued'])).toBe('queued');
  expect(conversationState(['failed', 'completed'])).toBe('failed');
  expect(conversationState(['completed', 'interrupted'])).toBe('completed');
  expect(conversationState(['interrupted'])).toBe('interrupted');
  expect(conversationState(['cancelled', 'completed'])).toBe('cancelled');
});
