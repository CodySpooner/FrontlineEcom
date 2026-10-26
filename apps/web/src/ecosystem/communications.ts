import type { AgentOfficeEvent, OfficeState } from './events';
import { nearestFree } from './pathfinding';
import { tileKey, type Tile } from './world';

export type Handoff = AgentOfficeEvent & { toAgentId: string };
export function recentHandoff(state: OfficeState, agentId: string, now = Date.now()): Handoff | undefined {
  return state.events.find((e): e is Handoff => e.type === 'handoff' && e.agentId === agentId && !!e.toAgentId && e.toAgentId !== agentId && now - Date.parse(e.at) >= 0 && now - Date.parse(e.at) < 60000);
}
export interface Visit { event: Handoff; target: Tile; elapsed: number; atDesk: number }
export function startVisit(event: Handoff, receiver: Tile, occupied: Set<string>): Visit | undefined {
  const target = nearestFree(receiver, new Set([...occupied, tileKey(receiver)]));
  return target ? { event, target, elapsed: 0, atDesk: 0 } : undefined;
}
export function visitFinished(visit: Visit, arrived: boolean, delta: number) {
  visit.elapsed += delta;
  if (arrived) visit.atDesk += delta;
  return visit.atDesk >= 3000 || visit.elapsed >= 90000;
}
