import { useState } from 'react';
import { AGENT_ROLES, type Agent, type OfficeSeat } from '@frontline/shared';
import { Badge, Button, Dialog, Field, inputClass } from '../components/ui';
import { workerActivity, type OfficeState } from './events';
import { WorkerPortrait } from './WorkerPortrait';

export function DemoAgentPanel({ agent, seat, office, onClose, onSimulate }: { agent: Agent; seat: OfficeSeat; office: OfficeState; onClose: () => void; onSimulate: (id: string, task: string) => void }) {
  const [task, setTask] = useState('');
  return <Dialog open onClose={onClose} title={seat.displayName}><Badge>DEMO WORKER · SIMULATED</Badge><div className="eco-profile"><WorkerPortrait appearance={seat.appearance} name={seat.displayName} /><div><h3>{AGENT_ROLES[agent.role].name}</h3><p>{seat.deskId} · Level {agent.level}</p></div></div><p className="eco-profile-copy">This example worker uses a local animation scenario. No model calls, store changes or saved task records.</p><p>{workerActivity(office, agent.id).status.replaceAll('_', ' ')}</p><form className="eco-command" onSubmit={(e) => { e.preventDefault(); if (task.trim()) { onSimulate(agent.id, task.trim()); setTask(''); } }}><Field label="Demo task"><input className={inputClass} maxLength={4000} value={task} onChange={(e) => setTask(e.target.value)} placeholder="Try a simulated instruction" /></Field><Button type="submit" size="sm" disabled={!task.trim()}>Simulate task</Button></form><h3 className="eco-panel-heading">Simulated task history</h3>{Object.values(office.runs).filter((r) => r.agentId === agent.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8).map((r) => <p className="eco-profile-copy" key={r.id}>{r.task}<br /><Badge>{r.status}</Badge>{r.status === 'done' && <small> · Example output ready; no business action executed.</small>}</p>)}</Dialog>;
}
