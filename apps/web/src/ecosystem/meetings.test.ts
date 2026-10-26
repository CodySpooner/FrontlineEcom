import { expect, test } from 'vitest';
import { AGENT_ROLES, type OfficeSeat, type SquadMission } from '@frontline/shared';
import { kickoff, meetingFinished } from './meetings';
import { appearanceFor } from './characters';
import { DESKS, deskTile, tileKey, walkable } from './world';
import { advanceMotion, startMotion } from './pathfinding';

test('eight participants gather without duplicate seats, then return to their home desks', () => {
  const roles = Object.keys(AGENT_ROLES) as (keyof typeof AGENT_ROLES)[], now = Date.now();
  const seats: OfficeSeat[] = roles.map((role, i) => ({ agentId: `glow:${role}`, deskId: DESKS[i]!.id, displayName: '', appearance: appearanceFor(role), position: null, archived: false, updatedAt: '' }));
  const mission: SquadMission = { id: 'm', storeId: 'glow', title: 'Launch', createdAt: new Date(now).toISOString(), status: 'running', steps: roles.map((role, i) => ({ id: String(i), role, task: 'Work', dependsOn: [], status: 'waiting' })) };
  const plan = kickoff([mission], seats, now)!;
  expect(new Set(Object.values(plan.targets).map(tileKey)).size).toBe(8);
  expect(Object.values(plan.targets).every(walkable)).toBe(true);
  const motions = new Map(seats.map((s) => [s.agentId, startMotion(deskTile(s.deskId), plan.targets[s.agentId]!)]));
  for (let i = 0; i < 3000; i++) advanceMotion(motions, .05);
  expect([...motions.values()].every((m) => m.arrived)).toBe(true);
  const meeting = { plan, elapsed: 0, together: 0 };
  expect(meetingFinished(meeting, true, 3499)).toBe(false);
  expect(meetingFinished(meeting, true, 1)).toBe(true);
  for (const s of seats) motions.get(s.agentId)!.target = deskTile(s.deskId);
  for (let i = 0; i < 3000; i++) advanceMotion(motions, .05);
  expect([...motions.values()].every((m) => m.arrived)).toBe(true);
  expect(kickoff([mission], seats, now + 60001)).toBeUndefined();
});
