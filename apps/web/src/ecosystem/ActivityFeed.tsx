import { Link } from 'react-router';
import { AGENT_ROLES, type OfficeSeat } from '@frontline/shared';
import { StatusDot } from '../components/ui';
import { ago } from '../lib/format';
import type { AgentOfficeEvent, OfficeState } from './events';

const LABELS: Record<AgentOfficeEvent['type'], string> = { 'task.queued': 'Task queued', 'task.started': 'Task started', 'task.completed': 'Output available', 'task.failed': 'Task failed', 'task.cancelled': 'Task cancelled', 'tool.started': 'Using tool', 'approval.required': 'Needs approval', handoff: 'Work handed over', 'workflow.advanced': 'Team workflow advanced' };
export function ActivityFeed({ office, seats, onFocus }: { office: OfficeState; seats: OfficeSeat[]; onFocus: (id: string) => void }) {
  const name = (id: string) => { const agent = office.agents.find((a) => a.id === id); return seats.find((s) => s.agentId === id)?.displayName || (agent ? `${AGENT_ROLES[agent.role].name} · ${agent.storeId}` : id); };
  return <aside className="eco-feed"><h2><StatusDot tone="good" /> Live Activity</h2><div className="eco-events">
    {!office.events.length && <p>No task activity yet. Assign work to a deployed agent to get started.</p>}
    {office.events.map((e) => <article key={e.id} className={`eco-event ${e.type.includes('failed') ? 'eco-event-error' : ''}`}>
      <header><strong>{LABELS[e.type]}</strong><time dateTime={e.at}>{ago(e.at)}</time></header>
      {seats.some((s) => s.agentId === e.agentId && !s.archived) ? <button onClick={() => onFocus(e.agentId)} title="Focus worker">{name(e.agentId)}</button> : <Link to={`/agents/${encodeURIComponent(e.agentId)}`}>{name(e.agentId)}</Link>}
      {e.toAgentId && <small> → {name(e.toAgentId)}</small>}<p>{e.summary}</p>
      {e.runId && <Link className="eco-event-output" to={`/agents/${encodeURIComponent(e.toAgentId ?? e.agentId)}?run=${e.runId}`}>{e.type === 'approval.required' ? 'Review request' : 'Open task'} →</Link>}
    </article>)}
  </div></aside>;
}
