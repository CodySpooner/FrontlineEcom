import { expect, test } from 'vitest';
import { advanceDemo, createDemo, demoStats } from './demo';
import { workerActivity } from './events';

test('thirty distinct local workers cover execution states and generate handoffs without network I/O', () => {
  const now = Date.now(), demo = createDemo(now);
  expect(new Set(demo.seats.map((s) => s.agentId)).size).toBe(30);
  expect(new Set(demo.seats.map((s) => s.deskId)).size).toBe(30);
  expect(new Set(demo.seats.map((s) => s.appearance.archetype)).size).toBeGreaterThanOrEqual(7);
  expect(new Set(demo.seats.map((s) => JSON.stringify(s.appearance))).size).toBe(30);
  expect(demo.state.agents.map((a) => workerActivity(demo.state, a.id, now).status)).toEqual(expect.arrayContaining(['idle', 'queued', 'running', 'using_tool', 'awaiting_approval', 'completed', 'failed', 'offline']));
  let state = demo.state;
  for (let tick = 0; tick < 6; tick++) state = advanceDemo(state, tick, now + tick * 1500);
  expect(state.events.some((e) => e.type === 'handoff')).toBe(true);
  expect(state.runs['demo-cycle-0']?.status).toBe('done');
  expect(demo.state.runs['demo-cycle-0']).toBeUndefined();
  expect(demoStats(state).costUsd).toBe(0);
});
