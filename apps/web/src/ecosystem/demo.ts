import { AGENT_ROLES, type Agent, type AgentRole, type AgentRun, type OfficeSeat, type OfficeStats, type SquadMission } from '@frontline/shared';
import { appearanceFor } from './characters';
import { activeRun, applyOfficeMessage, emptyOffice, mergeOfficeSnapshot, type OfficeState } from './events';
import { DESKS, deskTile } from './world';

const roles = Object.keys(AGENT_ROLES) as AgentRole[];
export function createDemo(now = Date.now()) {
  const at = new Date(now).toISOString();
  const agents: Agent[] = DESKS.map((_, i) => ({ id: `demo-${Math.floor(i / 8)}:${roles[i % 8]}`, storeId: `demo-${Math.floor(i / 8)}`, role: roles[i % 8]!, status: i % 10 === 7 ? 'offline' : 'idle', level: 1 + i, xp: i * 100, engine: { provider: 'demo' } }));
  const seats: OfficeSeat[] = agents.map((a, i) => ({ agentId: a.id, deskId: DESKS[i]!.id, displayName: `${AGENT_ROLES[a.role].name} ${Math.floor(i / 8) + 1}`, appearance: appearanceFor(a.id), position: i < 3 ? null : deskTile(DESKS[i]!.id), archived: false, updatedAt: at }));
  const runs: AgentRun[] = agents.flatMap((a, i) => [0, 7, 9].includes(i % 10) ? [] : [{ id: `demo-seed-${i}`, agentId: a.id, storeId: a.storeId, task: `Demo: ${AGENT_ROLES[a.role].blurb}`, status: i % 10 === 1 ? 'queued' : i % 10 === 5 ? 'done' : i % 10 === 6 ? 'error' : 'running', createdAt: at, endedAt: [5, 6].includes(i % 10) ? at : undefined, error: i % 10 === 6 ? 'Demo integration needs attention' : undefined, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } }]);
  let state = mergeOfficeSnapshot(emptyOffice(), agents, runs, []);
  for (const [i, a] of agents.entries()) {
    if ([3, 8].includes(i % 10)) state.tools[`demo-seed-${i}`] = { calls: { tool: i % 10 === 8 ? 'assign_task' : 'read_products' }, resolved: [] };
    if (i % 10 === 4) state = applyOfficeMessage(state, { type: 'approval', approval: { id: `demo-approval-${i}`, agentId: a.id, storeId: a.storeId, runId: `demo-seed-${i}`, title: 'Demo: review a proposed campaign', reason: 'Simulated review step', action: { kind: 'store.publish_page', payload: {} }, status: 'pending', createdAt: at } });
  }
  state = addDemoMeeting(state, 'demo-kickoff', at);
  return { state, seats };
}
function addDemoMeeting(state: OfficeState, id: string, at: string) {
  for (const old of Object.values(state.missions)) if (old.status === 'running') state = applyOfficeMessage(state, { type: 'mission', mission: { ...old, status: 'done', steps: old.steps.map((s) => ({ ...s, status: 'done', deliverable: 'Simulated deliverable ready' })) } }, at);
  const mission: SquadMission = { id, storeId: 'demo-0', title: 'Demo: launch a new product', createdAt: at, status: 'running', steps: state.agents.slice(0, 6).map((a, i) => ({ id: `step-${i}`, role: a.role, task: `Demo: ${AGENT_ROLES[a.role].blurb}`, dependsOn: i ? [`step-${i - 1}`] : [], status: i ? 'waiting' : 'running' })) };
  return applyOfficeMessage(state, { type: 'mission', mission }, at);
}
/** A local event source only: this module never calls the backend. */
export function advanceDemo(state: OfficeState, tick: number, now = Date.now()): OfficeState {
  const at = new Date(now).toISOString(), index = Math.floor(tick / 6) % state.agents.length, agent = state.agents[index]!;
  const id = `demo-cycle-${Math.floor(tick / 6)}`, phase = tick % 6;
  let run = state.runs[id];
  if (phase === 0) {
    state = { ...state, agents: state.agents.map((a) => a.id === agent.id ? { ...a, status: 'idle' } : a) };
    run = { id, agentId: agent.id, storeId: agent.storeId, task: `Demo: prepare ${AGENT_ROLES[agent.role].name.toLowerCase()} findings`, status: 'queued', createdAt: at, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } };
  }
  if (run) {
    if (phase === 1) run = { ...run, status: 'running', startedAt: at };
    if (phase === 5) run = { ...run, status: 'done', endedAt: at };
    state = applyOfficeMessage(state, { type: 'run', run }, at);
    if (phase === 2 || phase === 3) state = applyOfficeMessage(state, { type: 'run_event', agentId: agent.id, storeId: agent.storeId, runId: id, event: phase === 2 ? { type: 'tool_call', id: 'demo-tool', name: 'read_products', input: {} } : { type: 'tool_result', id: 'demo-tool', output: 'Simulated product findings', isError: false } }, at);
    if (phase === 3) {
      const receiver = state.agents[(index + 1) % state.agents.length]!;
      state = applyOfficeMessage(state, { type: 'run', run: { ...run, id: `${id}-child`, agentId: receiver.id, storeId: receiver.storeId, parentRunId: id, task: 'Demo: validate the research findings', status: 'done', createdAt: at, endedAt: at } }, at);
    }
  }
  for (const manual of Object.values(state.runs)) if (manual.id.startsWith('demo-manual-') && activeRun(manual) && now - Date.parse(manual.createdAt) >= 4000) state = applyOfficeMessage(state, { type: 'run', run: { ...manual, status: 'done', endedAt: at } }, at);
  if (tick > 0 && tick % 30 === 0) state = addDemoMeeting(state, `demo-kickoff-${tick}`, at);
  return { ...state, runs: Object.fromEntries(Object.values(state.runs).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200).map((r) => [r.id, r])), missions: Object.fromEntries(Object.values(state.missions).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10).map((m) => [m.id, m])) };
}
export function demoStats(state: OfficeState): OfficeStats {
  const runs = Object.values(state.runs), completedTasks = runs.filter((r) => r.status === 'done').length, failedTasks = runs.filter((r) => r.status === 'error').length;
  return { activeTasks: runs.filter(activeRun).length, completedTasks, failedTasks, successRate: completedTasks + failedTasks ? completedTasks / (completedTasks + failedTasks) : null, activeTeams: Object.values(state.missions).filter((m) => m.status === 'running').length, inputTokens: 0, outputTokens: 0, costUsd: 0, teamsCreated: Object.keys(state.missions).length, completedMissions: Object.values(state.missions).filter((m) => m.status === 'done').length, handoffs: runs.filter((r) => r.parentRunId).length, fullOffice: true };
}
