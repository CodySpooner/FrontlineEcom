import type { Agent, AgentRun, ApprovalRequest, LiveMessage, SquadMission } from '@frontline/shared';
import type { Animation } from './characters';

export type OfficeStatus = 'idle' | 'queued' | 'planning' | 'running' | 'using_tool' | 'collaborating' | 'awaiting_approval' | 'completed' | 'failed' | 'offline';
export interface AgentOfficeEvent {
  id: string;
  type: 'task.queued' | 'task.started' | 'task.completed' | 'task.failed' | 'task.cancelled' | 'tool.started' | 'approval.required' | 'handoff' | 'workflow.advanced';
  agentId: string;
  runId: string;
  at: string;
  summary: string;
  toAgentId?: string;
  approvalId?: string;
  missionId?: string;
}
interface ToolActivity { calls: Record<string, string>; resolved: string[] }
export interface OfficeState {
  agents: Agent[];
  runs: Record<string, AgentRun>;
  approvals: Record<string, ApprovalRequest>;
  tools: Record<string, ToolActivity>;
  events: AgentOfficeEvent[];
  missions: Record<string, SquadMission>;
}
export const emptyOffice = (): OfficeState => ({ agents: [], runs: {}, approvals: {}, tools: {}, events: [], missions: {} });
export const activeRun = (run: AgentRun) => run.status === 'running' || run.status === 'queued';
const ORDER = { queued: 0, running: 1, done: 2, error: 2, cancelled: 2 };
const EVENT = { queued: 'task.queued', running: 'task.started', done: 'task.completed', error: 'task.failed', cancelled: 'task.cancelled' } as const;
function event(state: OfficeState, entry: AgentOfficeEvent): OfficeState {
  if (state.events.some((e) => e.id === entry.id)) return state;
  return { ...state, events: [...state.events, entry].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 100) };
}
function runEvent(state: OfficeState, run: AgentRun): OfficeState {
  if (!run || !Object.hasOwn(ORDER, run.status) || typeof run.id !== 'string' || typeof run.agentId !== 'string') return state;
  const old = state.runs[run.id];
  if (old && (ORDER[run.status] < ORDER[old.status] || (!activeRun(old) && old.status !== run.status))) return state;
  state = { ...state, runs: { ...state.runs, [run.id]: run } };
  return event(state, { id: `${run.id}:${run.status}`, type: EVENT[run.status], agentId: run.agentId, runId: run.id,
    at: run.endedAt ?? run.startedAt ?? run.createdAt, summary: run.error ?? run.task });
}
function approvalEvent(state: OfficeState, approval: ApprovalRequest): OfficeState {
  const old = state.approvals[approval.id];
  if (old && old.status !== 'pending' && approval.status === 'pending') return state;
  state = { ...state, approvals: { ...state.approvals, [approval.id]: approval } };
  return approval.status !== 'pending' ? state : event(state, { id: `approval:${approval.id}`, type: 'approval.required', agentId: approval.agentId,
    runId: approval.runId ?? '', approvalId: approval.id, at: approval.createdAt, summary: approval.title });
}
function handoffs(state: OfficeState): OfficeState {
  for (const run of Object.values(state.runs)) {
    const parent = run.parentRunId && state.runs[run.parentRunId];
    if (parent) state = event(state, { id: `handoff:${run.id}`, type: 'handoff', agentId: parent.agentId, toAgentId: run.agentId, runId: run.id, at: run.createdAt, summary: run.task });
  }
  return state;
}
export function applyOfficeMessage(state: OfficeState, message: LiveMessage, now = new Date().toISOString()): OfficeState {
  if (message.type === 'mission') return missionEvent(state, message.mission, now);
  if (message.type === 'run') return handoffs(runEvent(state, message.run));
  if (message.type === 'approval') return approvalEvent(state, message.approval);
  if (message.type !== 'run_event') return state;
  const run = state.runs[message.runId];
  if (!run || !activeRun(run)) return state;
  const e = message.event, old = state.tools[run.id] ?? { calls: {}, resolved: [] };
  if (e.type === 'tool_result') {
    if (old.resolved.includes(e.id)) return state;
    return { ...state, tools: { ...state.tools, [run.id]: { ...old, resolved: [...old.resolved, e.id] } } };
  }
  if (e.type === 'approval_request') return approvalEvent(state, e.approval);
  if (e.type !== 'tool_call' || old.calls[e.id] || old.resolved.includes(e.id)) return state;
  state = { ...state, tools: { ...state.tools, [run.id]: { ...old, calls: { ...old.calls, [e.id]: e.name } } } };
  return event(state, { id: `${run.id}:tool:${e.id}`, type: 'tool.started', agentId: run.agentId, runId: run.id, at: now, summary: e.name });
}
function missionEvent(state: OfficeState, mission: SquadMission, at = mission.createdAt): OfficeState {
  const old = state.missions[mission.id];
  if (old && ['done', 'cancelled'].includes(old.status) && mission.status !== old.status) return state;
  // A delayed snapshot must not rewind a step that has already finished.
  if (old && old.steps.some((step) => { const next = mission.steps.find((s) => s.id === step.id); return ['done', 'error', 'cancelled'].includes(step.status) && next?.runId === step.runId && next?.status !== step.status; })) return state;
  state = { ...state, missions: { ...state.missions, [mission.id]: mission } };
  const step = mission.steps.find((s) => s.status === 'running') ?? mission.steps.at(-1);
  if (!step) return state;
  return event(state, { id: `mission:${mission.id}:${mission.steps.map((s) => `${s.id}:${s.status}:${s.runId ?? ''}`).join(',')}`, type: 'workflow.advanced', missionId: mission.id,
    agentId: `${mission.storeId}:${step.role}`, runId: step.runId ?? '', at, summary: `${mission.title} · ${mission.steps.filter((s) => s.status === 'done').length}/${mission.steps.length} steps complete · ${mission.status}` });
}
export function mergeOfficeSnapshot(state: OfficeState, agents: Agent[], runs: AgentRun[], approvals: ApprovalRequest[], missions: SquadMission[] = []): OfficeState {
  state = { ...state, agents };
  for (const run of runs) state = runEvent(state, run);
  for (const approval of approvals) state = approvalEvent(state, approval);
  for (const mission of missions) state = missionEvent(state, mission);
  return handoffs(state);
}
export function workerActivity(state: OfficeState, agentId: string, now = Date.now()): { status: OfficeStatus; animation: Animation; run?: AgentRun; tool?: string } {
  const agent = state.agents.find((a) => a.id === agentId);
  const runs = Object.values(state.runs).filter((r) => r.agentId === agentId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const run = runs.find((r) => r.status === 'running') ?? runs.find((r) => r.status === 'queued') ?? runs[0];
  if (!agent || agent.status === 'offline') return { status: 'offline', animation: 'sit', run };
  if (agent.status === 'waiting_approval' || Object.values(state.approvals).some((a) => a.agentId === agentId && a.status === 'pending')) return { status: 'awaiting_approval', animation: 'approval', run };
  if (run?.status === 'queued') return { status: 'queued', animation: 'idle', run };
  if (run?.status === 'running') {
    const tools = state.tools[run.id];
    const tool = tools && Object.entries(tools.calls).filter(([id]) => !tools.resolved.includes(id)).at(-1)?.[1];
    return { status: tool ? 'using_tool' : 'running', animation: tool === 'assign_task' ? 'talk' : tool ? 'think' : 'work', run, tool };
  }
  if (run?.status === 'error' || agent.status === 'error') return { status: 'failed', animation: 'error', run };
  if (run?.status === 'done' && now - Date.parse(run.endedAt ?? '') < 2000) return { status: 'completed', animation: 'complete', run };
  return { status: agent.status === 'running' ? 'running' : 'idle', animation: agent.status === 'running' ? 'work' : 'sit', run };
}
