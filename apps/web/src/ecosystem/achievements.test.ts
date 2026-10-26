import { expect, test } from 'vitest';
import { officeAchievements } from './achievements';
import { createDemo, demoStats } from './demo';

test('milestones require recorded outcomes and full-office history survives archiving', () => {
  const demo = createDemo(), stats = { ...demoStats(demo.state), completedMissions: 0, completedTasks: 99, teamsCreated: 0, handoffs: 0, fullOffice: false };
  const initial = officeAchievements(demo.seats.slice(0, 1), stats);
  expect(initial.filter((a) => a.earned).map((a) => a.id)).toEqual(['first-worker']);
  const completed = officeAchievements(demo.seats.map((s) => ({ ...s, archived: true })), { ...stats, completedMissions: 10, completedTasks: 100, teamsCreated: 10, handoffs: 1, fullOffice: true });
  expect(completed.every((a) => a.earned)).toBe(true);
});
