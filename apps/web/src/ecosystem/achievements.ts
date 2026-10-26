import type { OfficeSeat, OfficeStats } from '@frontline/shared';

export function officeAchievements(seats: OfficeSeat[], stats: OfficeStats) {
  return [
    { id: 'first-worker', name: 'First Agent Deployed', value: seats.length, target: 1 },
    { id: 'first-team', name: 'First Team Created', value: stats.teamsCreated, target: 1 },
    { id: 'first-mission', name: 'First Completed Mission', value: stats.completedMissions, target: 1 },
    { id: 'first-handoff', name: 'First Agent Collaboration', value: stats.handoffs, target: 1 },
    { id: 'ten-missions', name: 'Ten Successful Missions', value: stats.completedMissions, target: 10 },
    { id: 'full-office', name: 'Full Office · 30 Agents', value: stats.fullOffice ? 30 : seats.filter((s) => !s.archived).length, target: 30 },
    { id: 'hundred-tasks', name: 'One Hundred Completed Tasks', value: stats.completedTasks, target: 100 },
  ].map((a) => ({ ...a, earned: a.value >= a.target }));
}
