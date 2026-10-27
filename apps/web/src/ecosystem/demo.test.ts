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

test('Demo midnight starts a new day while preserving yesterday and counting only new order events', () => {
  const before=createDemo(new Date('2026-10-26T23:59:59').getTime()).state;
  const now=new Date('2026-10-27T00:00:01').getTime(), after=advanceDemo(before,1,now);
  expect(after.analytics!.to).toBe('2026-10-27');
  expect(after.analytics!.series).toHaveLength(7);
  expect(after.analytics!.series.at(-2)).toEqual(before.analytics!.series.at(-1));
  expect(after.analytics!.series.at(-1)).toMatchObject({ date: '2026-10-27', orders: 0, revenue: 0, aov: 0 });
  expect(advanceDemo(after,6,now+9000).analytics!.series.at(-1)).toMatchObject({ orders: 1, revenue: 29, aov: 29 });
  expect(before.analytics!.to).toBe('2026-10-26');
});

test('Demo display resumes with seven calendar days after a long idle gap', () => {
  const before=createDemo(new Date('2026-10-26T23:59:59').getTime()).state;
  const after=advanceDemo(before,1,new Date('2026-11-08T00:00:01').getTime());
  expect(after.analytics!.series.map((p)=>p.date)).toEqual(['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06','2026-11-07','2026-11-08']);
  expect(after.analytics!.series.every((p)=>p.orders===0&&p.revenue===0)).toBe(true);
});
