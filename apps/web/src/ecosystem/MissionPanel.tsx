import { useState } from 'react';
import { OfficeLink } from './OfficeLink';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AGENT_ROLES, type NewSquadMission, type SquadMission } from '@frontline/shared';
import { useStores } from '../api/client';
import { Badge, Button, Dialog, ErrorState, Field, LoadingState, inputClass } from '../components/ui';
import { officeApi } from './api';
import type { OfficeState } from './events';

export function MissionPanel({ office, create, onCreate, onCloseCreate, onPreview }: { office: OfficeState; create: boolean; onCreate: () => void; onCloseCreate: () => void; onPreview?: (id: string) => void }) {
  const [selected, setSelected] = useState('');
  const missions = Object.values(office.missions).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const mission = missions.find((m) => m.id === selected) ?? missions[0];
  const stages = mission?.steps.filter((s) => s.status === 'running' || s.status === 'queued' || s.status === 'waiting') ?? [];
  return <section className="eco-missions" aria-label="Team missions">
    <header><h2>TEAM MISSIONS</h2><Button size="sm" disabled={!!onPreview} onClick={onCreate}>Create Team</Button></header>
    {!mission ? <p className="eco-profile-copy">Launch a coordinated mission for your store squad. Each stage uses real agent tasks and dependencies.</p> : <>
      <Field label="Mission"><select className={inputClass} value={mission.id} onChange={(e) => setSelected(e.target.value)}>{missions.map((m) => <option key={m.id} value={m.id}>{m.title} · {m.storeId} · {m.status}</option>)}</select></Field>
      <p className="eco-profile-copy"><Badge>{mission.status}</Badge> · Current stage: {stages.length ? stages.map((s) => AGENT_ROLES[s.role].name).join(', ') : mission.status === 'done' ? 'All deliverables ready' : 'Needs attention'}<br />{mission.steps.filter((s) => s.status === 'done').length} completed · {stages.length} pending / active · {mission.steps.filter((s) => ['blocked', 'error', 'cancelled'].includes(s.status)).length} blocked</p>
      <div className="eco-mission-steps">{mission.steps.map((s) => <details key={s.id}><summary><span>{AGENT_ROLES[s.role].name}</span><Badge>{s.status}</Badge></summary><p>{s.task}</p>{s.dependsOn.length > 0 && <small>Depends on: {s.dependsOn.join(', ')}</small>}{s.note && <p className="eco-blocker">{s.note}</p>}{s.deliverable && <p><strong>Deliverable:</strong> {s.deliverable}</p>}<OfficeLink onPreview={onPreview && (() => onPreview(`${mission.storeId}:${s.role}`))} to={`/agents/${encodeURIComponent(`${mission.storeId}:${s.role}`)}${s.runId ? `?run=${s.runId}` : ''}`}>{s.runId ? 'Open task and output' : 'View assigned agent'} →</OfficeLink></details>)}</div>
      <details className="eco-mission-history"><summary>Collaboration history</summary>{office.events.filter((e) => e.type === 'handoff' && mission.steps.some((s) => s.runId === e.runId)).map((e) => <p key={e.id}>{e.agentId} → {e.toAgentId}: {e.summary.split('\n')[0]}</p>)}</details>
    </>}
    {create && <CreateTeam onClose={onCloseCreate} onCreated={(m) => { setSelected(m.id); onCloseCreate(); }} />}
  </section>;
}

function CreateTeam({ onClose, onCreated }: { onClose: () => void; onCreated: (mission: SquadMission) => void }) {
  const stores = useStores();
  const templates = useQuery({ queryKey: ['ecosystem', 'mission-templates'], queryFn: () => officeApi<Omit<NewSquadMission, 'storeId'>[]>('/api/squad-missions/templates') });
  const [storeId, setStoreId] = useState(''), [index, setIndex] = useState(0), [title, setTitle] = useState('');
  const template = templates.data?.[index];
  const start = useMutation({ mutationFn: () => officeApi<SquadMission>('/api/squad-missions', 'POST', { ...template, storeId, title: title.trim() || template!.title }), onSuccess: onCreated });
  return <Dialog open onClose={onClose} title="Create Team Mission">
    {stores.isPending || templates.isPending ? <LoadingState /> : stores.isError || templates.isError ? <ErrorState message="Could not load stores or mission templates." onRetry={() => { stores.refetch(); templates.refetch(); }} /> : <form className="eco-deploy" onSubmit={(e) => { e.preventDefault(); if (storeId && template && !start.isPending) start.mutate(); }}>
      <Field label="Store"><select required className={inputClass} value={storeId} onChange={(e) => setStoreId(e.target.value)}><option value="" disabled>Select store</option>{stores.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      <Field label="Team workflow"><select className={inputClass} value={index} onChange={(e) => { setIndex(Number(e.target.value)); setTitle(''); }}>{templates.data?.map((t, i) => <option key={t.title} value={i}>{t.title}</option>)}</select></Field>
      <Field label="Mission name (optional)"><input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} minLength={3} maxLength={100} placeholder={template?.title} /></Field>
      <p className="eco-profile-copy">The store's existing agents execute these dependent steps using their current model, permissions and budgets. Deployed participants gather at headquarters for a brief kickoff.</p>
      {template?.steps.map((s) => <details className="eco-template-step" key={s.id}><summary>{AGENT_ROLES[s.role].name} · {s.dependsOn?.length ? `after ${s.dependsOn.join(', ')}` : 'starts first'}</summary><p>{s.task}</p></details>)}
      {start.error && <ErrorState message={start.error.message} />}
      <Button type="submit" variant="primary" disabled={!storeId || !template || start.isPending}>{start.isPending ? 'Starting mission…' : 'Start team mission'}</Button>
    </form>}
  </Dialog>;
}
