import { useState } from 'react';
import { Link } from 'react-router';
import { AGENT_ROLES, OFFICE_DEPARTMENTS, OFFICE_DESKS, type AgentRun, type OfficeSeat, type OfficeStats } from '@frontline/shared';
import { Badge, Button, Field, inputClass } from '../components/ui';
import { cents } from '../lib/format';
import { activeRun, workerActivity, type OfficeState } from './events';
import { WorkerPortrait } from './WorkerPortrait';
import { OfficeLink } from './OfficeLink';

export const recentRuns = (office: OfficeState) => Object.values(office.runs).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200);
export function taskColumn(run: AgentRun, office: OfficeState) {
  if (activeRun(run) && Object.values(office.approvals).some((a) => a.runId === run.id && a.status === 'pending')) return 'Awaiting approval';
  return run.status === 'queued' ? 'Queued' : run.status === 'running' ? 'Running' : run.status === 'done' ? 'Completed' : 'Failed / cancelled';
}

export function OfficeViews({ tab, office, seats, stats, onSelect, preview = false }: { tab: string; office: OfficeState; seats: OfficeSeat[]; stats?: OfficeStats; onSelect: (id: string) => void; preview?: boolean }) {
  const [search, setSearch] = useState('');
  const active = seats.filter((s) => !s.archived), runs = recentRuns(office);
  const name = (id: string) => { const agent = office.agents.find((a) => a.id === id); return seats.find((s) => s.agentId === id)?.displayName || (agent ? AGENT_ROLES[agent.role].name : id); };
  if (tab === 'Department View') return <div className="eco-view"><h2>Departments</h2><div className="eco-departments">{OFFICE_DEPARTMENTS.map((d) => {
    const members = active.filter((s) => OFFICE_DESKS.find((desk) => desk.id === s.deskId)?.department === d.id);
    return <section key={d.id}><header><h3>{d.name}</h3><Badge>{members.length} / {d.desks}</Badge></header><p>{d.desks - members.length} free workstations</p>{members.map((s) => <button key={s.agentId} onClick={() => onSelect(s.agentId)}><span>{name(s.agentId)}</span><small>{workerActivity(office, s.agentId).status.replaceAll('_', ' ')}</small></button>)}</section>;
  })}</div></div>;
  if (tab === 'Agent List') return <div className="eco-view"><h2>Deployed agents · {active.length} / 30</h2><Field label="Find worker"><input type="search" className={inputClass} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, role or store" /></Field><div className="eco-roster">{active.filter((s) => `${name(s.agentId)} ${s.agentId} ${s.deskId}`.toLowerCase().includes(search.toLowerCase())).map((s) => {
    const agent = office.agents.find((a) => a.id === s.agentId), activity = workerActivity(office, s.agentId);
    return <button key={s.agentId} onClick={() => onSelect(s.agentId)}><WorkerPortrait appearance={s.appearance} name={name(s.agentId)} agentId={s.agentId} /><span><strong>{name(s.agentId)}</strong><small>{agent?.storeId} · {s.deskId}</small><small>Level {agent?.level ?? 1} · {activity.status.replaceAll('_', ' ')}</small>{activity.run && activeRun(activity.run) && <small>{activity.run.task.split('\n')[0]}</small>}</span></button>;
  })}</div>{!active.length && <p className="eco-profile-copy">Deploy an agent to fill your first workstation.</p>}</div>;
  if (tab === 'Task Board') return <div className="eco-view"><h2>Task board</h2><p className="eco-profile-copy">Latest 200 runs across store agents. Open a task for its transcript and controls.</p><div className="eco-task-board">{['Queued', 'Running', 'Awaiting approval', 'Completed', 'Failed / cancelled'].map((column) => {
    const tasks = runs.filter((r) => taskColumn(r, office) === column);
    return <section key={column}><h3>{column} <Badge>{tasks.length}</Badge></h3>{!tasks.length && <p>No tasks</p>}{tasks.map((r) => <OfficeLink key={r.id} onPreview={preview ? () => onSelect(r.agentId) : undefined} to={`/agents/${encodeURIComponent(r.agentId)}?run=${r.id}`}><strong>{name(r.agentId)} · {r.storeId}</strong><span>{r.task.split('\n')[0]}</span>{r.error && <small>{r.error}</small>}</OfficeLink>)}</section>;
  })}</div></div>;
  return <div className="eco-view"><h2>Workforce performance</h2><p className="eco-profile-copy">All-time execution totals. Model usage is reported by the existing engine.</p>{stats ? <div className="eco-performance"><div><strong>{stats.completedTasks}</strong><small>Completed tasks</small></div><div><strong>{stats.failedTasks}</strong><small>Failed tasks</small></div><div><strong>{cents(stats.costUsd)}</strong><small>API cost</small></div><div><strong>{(stats.inputTokens + stats.outputTokens).toLocaleString()}</strong><small>Input + output tokens</small></div></div> : <p>Performance totals are unavailable.</p>}
    <h3 className="eco-panel-heading">Per-agent activity · latest 200 runs</h3><div className="eco-table-wrap"><table className="eco-table"><thead><tr><th>Agent</th><th>Completed</th><th>Failed</th><th>Cost</th><th>Tokens</th></tr></thead><tbody>{office.agents.map((a) => {
      const history = runs.filter((r) => r.agentId === a.id);
      return <tr key={a.id}><th>{active.some((s) => s.agentId === a.id) ? <Button size="sm" onClick={() => onSelect(a.id)}>{name(a.id)} · {a.storeId}</Button> : <Link to={`/agents/${encodeURIComponent(a.id)}?tab=history`}>{name(a.id)} · {a.storeId}</Link>}</th><td>{history.filter((r) => r.status === 'done').length}</td><td>{history.filter((r) => r.status === 'error').length}</td><td>{cents(history.reduce((sum, r) => sum + r.usage.costUsd, 0))}</td><td>{history.reduce((sum, r) => sum + r.usage.inputTokens + r.usage.outputTokens, 0).toLocaleString()}</td></tr>;
    })}</tbody></table></div>
  </div>;
}
