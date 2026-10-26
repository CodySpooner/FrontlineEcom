import { expect, test } from 'vitest';
import { emptyOffice } from './events';
import { recentHandoff, startVisit, visitFinished, type Handoff } from './communications';
import { DESKS, deskTile, tileKey, walkable } from './world';
import { findPath } from './pathfinding';

test('only recent real handoffs trigger visits; historical and self events stay in history', () => {
  const office = emptyOffice(), now = Date.now();
  office.events = [{ id: 'h1', type: 'handoff', agentId: 'sender', toAgentId: 'receiver', runId: 'r1', summary: 'Use the approved copy', at: new Date(now).toISOString() }];
  expect(recentHandoff(office, 'sender', now)?.summary).toBe('Use the approved copy');
  expect(recentHandoff(office, 'sender', now + 60001)).toBeUndefined();
  office.events[0]!.toAgentId = 'sender';
  expect(recentHandoff(office, 'sender', now)).toBeUndefined();
});
test('visitors use a free adjacent tile, can reach all departments and leave after delivery', () => {
  const event = { id: 'h', toAgentId: 'receiver' } as Handoff;
  const reserved = new Set(DESKS.map((d) => tileKey(deskTile(d.id))));
  for (const desk of DESKS) {
    const receiver = deskTile(desk.id), visit = startVisit(event, receiver, reserved)!;
    expect(walkable(visit.target)).toBe(true);
    expect(reserved.has(tileKey(visit.target))).toBe(false);
    expect(findPath({ x: 17, y: 26 }, visit.target).length).toBeGreaterThan(0);
    expect(visitFinished(visit, false, 5000)).toBe(false);
    expect(visitFinished(visit, true, 2999)).toBe(false);
    expect(visitFinished(visit, true, 1)).toBe(true);
  }
});
