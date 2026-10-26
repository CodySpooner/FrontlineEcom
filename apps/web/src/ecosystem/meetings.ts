import type { OfficeSeat, SquadMission } from '@frontline/shared';
import { nearestFree } from './pathfinding';
import { deskTile, tileKey, type Tile } from './world';

export interface MeetingPlan { id: string; title: string; targets: Record<string, Tile> }
export function kickoff(missions: SquadMission[], seats: OfficeSeat[], now = Date.now()): MeetingPlan | undefined {
  for (const mission of [...missions].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    if (now - Date.parse(mission.createdAt) < 0 || now - Date.parse(mission.createdAt) >= 60000) continue;
    const ids = [...new Set(mission.steps.map((s) => `${mission.storeId}:${s.role}`))].filter((id) => seats.some((s) => s.agentId === id && !s.archived));
    if (ids.length < 2) continue;
    const occupied = new Set(seats.filter((s) => !s.archived).map((s) => tileKey(deskTile(s.deskId))));
    const targets: Record<string, Tile> = {};
    ids.forEach((id, i) => { const target = nearestFree({ x: i % 2 ? 19 : 14, y: 10 + Math.floor(i / 2) * 2 }, occupied)!; targets[id] = target; occupied.add(tileKey(target)); });
    return { id: mission.id, title: mission.title, targets };
  }
}
export interface Meeting { plan: MeetingPlan; elapsed: number; together: number }
export function meetingFinished(meeting: Meeting, allArrived: boolean, delta: number) {
  meeting.elapsed += delta;
  if (allArrived) meeting.together += delta;
  return meeting.together >= 3500 || meeting.elapsed >= 60000;
}
