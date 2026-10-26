import { expect, test } from 'vitest';
import type { Agent, AgentEvent, AgentRun, ApprovalRequest, LiveMessage, SquadMission } from '@frontline/shared';
import { applyOfficeMessage, emptyOffice, mergeOfficeSnapshot, workerActivity } from './events';

const agent: Agent = { id: 'glow:copywriter', storeId: 'glow', role: 'copywriter', status: 'idle', level: 1, xp: 0 };
const run: AgentRun = { id: 'r1', agentId: agent.id, storeId: 'glow', task: 'Write headlines', status: 'running', createdAt: '2026-10-26T10:00:00Z', startedAt: '2026-10-26T10:00:01Z', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } };
const live = (event: AgentEvent): LiveMessage => ({ type: 'run_event', runId: run.id, agentId: agent.id, storeId: agent.storeId, event });

test('reconnect snapshots and duplicated or reordered run events never regress terminal state', () => {
  let state = mergeOfficeSnapshot(emptyOffice(), [agent], [run], []);
  const done = { ...run, status: 'done' as const, endedAt: '2026-10-26T10:01:00Z' };
  state = applyOfficeMessage(state, { type: 'run', run: done });
  state = applyOfficeMessage(state, { type: 'run', run: done });
  state = mergeOfficeSnapshot(state, [agent], [{ ...run, status: 'queued' }], []);
  state = applyOfficeMessage(state, { type: 'run', run });
  expect(state.runs.r1?.status).toBe('done');
  expect(state.events.filter((e) => e.type === 'task.completed')).toHaveLength(1);
  expect(workerActivity(state, agent.id, Date.parse(done.endedAt) + 100).animation).toBe('complete');
  expect(workerActivity(state, agent.id, Date.parse(done.endedAt) + 3000).status).toBe('idle');
  state = applyOfficeMessage(state, live({ type: 'tool_call', id: 'late', name: 'old_tool', input: {} }));
  expect(state.tools.r1).toBeUndefined();
});

test('tool results arriving before calls do not resurrect old tool activity', () => {
  let state = mergeOfficeSnapshot(emptyOffice(), [agent], [run], []);
  state = applyOfficeMessage(state, live({ type: 'tool_result', id: 't1', output: 'done', isError: false }));
  state = applyOfficeMessage(state, live({ type: 'tool_call', id: 't1', name: 'old_tool', input: {} }));
  expect(workerActivity(state, agent.id).tool).toBeUndefined();
  const call = live({ type: 'tool_call', id: 't2', name: 'read_products', input: {} });
  state = applyOfficeMessage(applyOfficeMessage(state, call), call);
  expect(workerActivity(state, agent.id)).toMatchObject({ status: 'using_tool', tool: 'read_products' });
  expect(state.events.filter((e) => e.type === 'tool.started')).toHaveLength(1);
  state = applyOfficeMessage(state, live({ type: 'tool_result', id: 't2', output: 'products', isError: false }));
  expect(workerActivity(state, agent.id).status).toBe('running');
});

test('approval decisions survive stale pending snapshots; actual parent links alone make handoffs', () => {
  const approval: ApprovalRequest = { id: 'a1', agentId: agent.id, storeId: 'glow', runId: run.id, title: 'Publish copy', reason: 'Ready', action: { kind: 'store.publish_page', payload: {} }, status: 'pending', createdAt: run.createdAt };
  let state = mergeOfficeSnapshot(emptyOffice(), [agent], [run], [approval]);
  expect(workerActivity(state, agent.id).status).toBe('awaiting_approval');
  state = applyOfficeMessage(state, { type: 'approval', approval: { ...approval, status: 'denied' } });
  state = mergeOfficeSnapshot(state, [agent], [run], [approval]);
  expect(workerActivity(state, agent.id).status).toBe('running');
  const child = { ...run, id: 'child', agentId: 'glow:operations', parentRunId: run.id };
  state = mergeOfficeSnapshot(state, [agent], [child, run], []);
  state = mergeOfficeSnapshot(state, [agent], [child, run], []);
  expect(state.events.filter((e) => e.type === 'handoff')).toMatchObject([{ agentId: agent.id, toAgentId: child.agentId, runId: 'child' }]);
});

test('an old run cannot replace a newer active task, and disabled agents stay offline', () => {
  const newer = { ...run, id: 'new', createdAt: '2026-10-26T11:00:00Z' };
  let state = mergeOfficeSnapshot(emptyOffice(), [agent], [run, newer], []);
  state = applyOfficeMessage(state, { type: 'run', run: { ...run, status: 'error' } });
  expect(workerActivity(state, agent.id).run?.id).toBe('new');
  state = { ...state, agents: [{ ...agent, status: 'offline' }] };
  expect(workerActivity(state, agent.id).status).toBe('offline');
});

test('mission progress deduplicates across reconnects and rejects old step snapshots', () => {
  const mission: SquadMission = { id: 'm1', storeId: 'glow', title: 'Launch', createdAt: run.createdAt, status: 'running', steps: [{ id: 'copy', role: 'copywriter', task: 'Write', dependsOn: [], status: 'running', runId: 'r1' }] };
  let state = mergeOfficeSnapshot(emptyOffice(), [agent], [run], [], [mission]);
  const done: SquadMission = { ...mission, status: 'done', steps: [{ ...mission.steps[0]!, status: 'done', deliverable: 'Headline ready' }] };
  state = applyOfficeMessage(state, { type: 'mission', mission: done });
  state = applyOfficeMessage(state, { type: 'mission', mission: done });
  state = mergeOfficeSnapshot(state, [agent], [run], [], [mission]);
  expect(state.missions.m1).toEqual(done);
  expect(state.events.filter((e) => e.type === 'workflow.advanced')).toHaveLength(2);
});
