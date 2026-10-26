import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AGENT_ROLES, OFFICE_DEPARTMENTS, OFFICE_DESKS, type Agent, type OfficeDepartment, type OfficeSeat } from '@frontline/shared';
import { Button, Dialog, ErrorState, Field, inputClass } from '../components/ui';
import { officeApi } from './api';
import { appearanceFor } from './characters';
import { AppearanceEditor } from './AppearanceEditor';

export function DeployWizard({ agents, seats, onClose }: { agents: Agent[]; seats: OfficeSeat[]; onClose: () => void }) {
  const qc = useQueryClient();
  const active = seats.filter((s) => !s.archived), available = agents.filter((a) => !active.some((s) => s.agentId === a.id));
  const free = OFFICE_DESKS.filter((d) => !active.some((s) => s.deskId === d.id));
  const [agentId, setAgentId] = useState(''), [name, setName] = useState(''), [deskId, setDeskId] = useState('');
  const [department, setDepartment] = useState<OfficeDepartment>('research');
  const [appearance, setAppearance] = useState(appearanceFor(''));
  const agent = available.find((a) => a.id === agentId);
  const deploy = useMutation({ mutationFn: () => officeApi<OfficeSeat>('/api/ecosystem/seats', 'POST', { agentId, deskId, displayName: name.trim(), appearance }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['ecosystem', 'seats'] }); onClose(); } });
  const chooseDepartment = (id: OfficeDepartment) => { setDepartment(id); setDeskId(free.find((d) => d.department === id)?.id ?? ''); };
  return <Dialog open onClose={onClose} title="Deploy Agent">
    <p className="eco-profile-copy">{active.length} / 30 agents deployed. Seat an existing store specialist in your headquarters.</p>
    {!free.length ? <p role="status">Office full. Archive a worker to free a workstation.</p> : !available.length ? <p>No unseated agents. Add a store to create its squad, or restore an archived worker.</p> : <form className="eco-deploy" onSubmit={(e) => { e.preventDefault(); if (agent && deskId && !deploy.isPending) deploy.mutate(); }}>
      <Field label="Agent and specialization"><select className={inputClass} value={agentId} onChange={(e) => {
        setAgentId(e.target.value); const a = available.find((a) => a.id === e.target.value)!;
        const old = seats.find((s) => s.agentId === a.id);
        setName(old?.displayName ?? ''); setAppearance(old?.appearance ?? appearanceFor(a.id));
        chooseDepartment(OFFICE_DEPARTMENTS.find((d) => d.role === a.role)!.id);
      }} required><option value="" disabled>Select a store agent</option>{available.map((a) => <option key={a.id} value={a.id}>{a.storeId} · {AGENT_ROLES[a.role].name}{a.status === 'offline' ? ' (paused)' : ''}</option>)}</select></Field>
      {agent && <>
        <p className="eco-profile-copy">{AGENT_ROLES[agent.role].blurb}<br />{agent.engine?.provider === 'demo' ? 'Free demo engine' : agent.engine?.model ?? 'Existing agent model'} · {agent.autonomy ?? 'ask'} permissions<br /><Link to={`/agents/${encodeURIComponent(agent.id)}?tab=settings`}>Review skills, instructions and agent configuration →</Link></p>
        <div className="eco-form-grid"><Field label="Office name (optional)"><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={AGENT_ROLES[agent.role].name} /></Field>
          <Field label="Department"><select className={inputClass} value={department} onChange={(e) => chooseDepartment(e.target.value as OfficeDepartment)}>{OFFICE_DEPARTMENTS.map((d) => <option key={d.id} value={d.id}>{d.name} · {free.filter((desk) => desk.department === d.id).length} free</option>)}</select></Field>
          <Field label="Workstation"><select className={inputClass} required value={deskId} onChange={(e) => setDeskId(e.target.value)}><option value="" disabled>No available workstation</option>{free.filter((d) => d.department === department).map((d) => <option key={d.id}>{d.id}</option>)}</select></Field></div>
        <h3 className="eco-panel-heading">Character appearance</h3><AppearanceEditor value={appearance} onChange={setAppearance} />
        <p className="eco-profile-copy">Your worker enters through reception and walks to this desk. Existing tasks and approval rules continue unchanged.</p>
      </>}
      {deploy.error && <ErrorState message={deploy.error.message} />}
      <Button type="submit" variant="primary" disabled={!agent || !deskId || deploy.isPending}>{deploy.isPending ? 'Deploying…' : 'Deploy to office'}</Button>
    </form>}
  </Dialog>;
}
