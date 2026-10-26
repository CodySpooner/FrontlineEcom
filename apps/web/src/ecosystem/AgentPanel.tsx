import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AGENT_ROLES, OFFICE_DEPARTMENTS, OFFICE_DESKS, type Agent, type OfficeSeat } from '@frontline/shared';
import { useCancelRun, useRuns, useUpdateAgent } from '../api/client';
import { Badge, Button, Dialog, ErrorState, LoadingState, XPBar, buttonClass } from '../components/ui';
import { ago, cents } from '../lib/format';
import { activeRun, workerActivity, type OfficeState } from './events';
import { WorkerPortrait } from './WorkerPortrait';
import { TaskComposer } from './TaskComposer';
import { officeApi } from './api';
import { SeatEditor } from './SeatEditor';

export function AgentPanel({ agent, seat, office, onClose, onFocus, assignInitially = false }: { agent: Agent; seat: OfficeSeat; office: OfficeState; onClose: () => void; onFocus: () => void; assignInitially?: boolean }) {
  const [assign, setAssign] = useState(assignInitially);
  const [customize, setCustomize] = useState(false);
  const qc = useQueryClient();
  const archive = useMutation({ mutationFn: () => officeApi(`/api/ecosystem/seats/${encodeURIComponent(agent.id)}`, 'DELETE'), onSuccess: () => { qc.invalidateQueries({ queryKey: ['ecosystem', 'seats'] }); onClose(); } });
  const history = useRuns(agent.id), cancel = useCancelRun(), update = useUpdateAgent();
  const current = update.data ?? agent;
  const activity = workerActivity({ ...office, agents: office.agents.map((a) => a.id === agent.id ? current : a) }, agent.id);
  const role = AGENT_ROLES[agent.role], name = seat.displayName || role.name;
  const department = OFFICE_DEPARTMENTS.find((d) => d.id === OFFICE_DESKS.find((d) => d.id === seat.deskId)?.department);
  const runs = history.data ?? [], recent = office.events.find((e) => e.agentId === agent.id);
  const base = `/agents/${encodeURIComponent(agent.id)}`;
  return <Dialog open onClose={onClose} title={name} side="right">
    <div className="eco-profile"><WorkerPortrait appearance={seat.appearance} name={name} /><div><Badge>{department?.name}</Badge><h3>{role.name}</h3><p>{agent.storeId} · {seat.deskId}</p><p>Level {agent.level} · {agent.rank ?? 'Recruit'} · {agent.xp} XP</p></div></div>
    <p className="eco-profile-copy">{role.blurb}</p>
    {agent.costTodayUsd !== undefined && <p className="eco-profile-copy">AI spend today: <strong>{cents(agent.costTodayUsd)}</strong>{agent.dailyBudgetUsd !== undefined && <> of {cents(agent.dailyBudgetUsd)} daily limit</>} · since local midnight, across all runs.</p>}
    {agent.levelProgress && <XPBar level={agent.level} rank={agent.rank} xp={agent.levelProgress.xp} next={agent.levelProgress.needed} />}
    <dl className="eco-details"><dt>Model</dt><dd>{agent.engine?.provider === 'demo' ? 'Demo engine · no API cost' : agent.engine?.model ?? 'Managed by the agent engine'}</dd><dt>Permissions</dt><dd>{agent.autonomy ?? 'ask'} · existing approval policy</dd><dt>Status</dt><dd>{activity.status.replaceAll('_', ' ')}</dd><dt>Current task</dt><dd>{activity.run && activeRun(activity.run) ? activity.run.task : 'No active task'}</dd>{activity.tool && <><dt>Current tool</dt><dd>{activity.tool}</dd></>}{recent && <><dt>Latest activity</dt><dd>{recent.summary}<small>{ago(recent.at)}</small></dd></>}</dl>
    <div className="eco-panel-actions">
      <Link className={buttonClass('primary', 'sm')} to={base}>Chat with Agent</Link>
      <Button size="sm" onClick={() => setAssign(!assign)} aria-expanded={assign}>Assign Task</Button>
      <Link className={buttonClass('ghost', 'sm')} to={`${base}?tab=history`}>View Activity History</Link>
      <Link className={buttonClass('ghost', 'sm')} to={`${base}?tab=settings`}>Configure Agent</Link>
      <Button size="sm" onClick={onFocus}>Focus Camera</Button>
      <Button size="sm" onClick={() => setCustomize(!customize)} aria-expanded={customize}>Customize Worker</Button>
      <Button size="sm" disabled={update.isPending} onClick={() => update.mutate({ id: agent.id, enabled: current.status === 'offline' })}>{current.status === 'offline' ? 'Resume agent' : 'Pause agent'}</Button>
      {activity.run && activeRun(activity.run) && <Button size="sm" disabled={cancel.isPending} onClick={() => cancel.mutate(activity.run!.id)}>Cancel task</Button>}
    </div>
    {assign && <TaskComposer agent={current} office={office} />}
    {customize && <SeatEditor seat={seat} onSaved={() => setCustomize(false)} />}
    {(cancel.error || update.error) && <ErrorState message={(cancel.error ?? update.error)!.message} />}
    {cancel.isSuccess && <p role="status" className="eco-profile-copy">Task cancelled.</p>}
    <Button size="sm" disabled={archive.isPending} onClick={() => archive.mutate()}>Archive office worker</Button>
    <p className="eco-profile-copy">Archiving frees this desk. The agent, its tasks and history stay available.</p>
    {archive.error && <ErrorState message={archive.error.message} />}
    <h3 className="eco-panel-heading">Communication history</h3>
    {!office.events.some((e) => e.type === 'handoff' && (e.agentId === agent.id || e.toAgentId === agent.id)) && <p className="eco-profile-copy">No task handoffs in the recent history.</p>}
    {office.events.filter((e) => e.type === 'handoff' && (e.agentId === agent.id || e.toAgentId === agent.id)).slice(0, 8).map((e) => <Link className="eco-history" key={e.id} to={`/agents/${encodeURIComponent(e.toAgentId!)}?run=${e.runId}`}><span>{e.summary}</span><small>{e.agentId} → {e.toAgentId} · {ago(e.at)}</small></Link>)}
    <h3 className="eco-panel-heading">Recent performance · latest 50 runs</h3>
    {history.isPending ? <LoadingState rows={2} /> : history.isError ? <ErrorState onRetry={() => history.refetch()} /> : <>
      <div className="eco-performance"><div><strong>{runs.filter((r) => r.status === 'done').length}</strong><small>Completed</small></div><div><strong>{runs.filter((r) => r.status === 'error').length}</strong><small>Failed</small></div><div><strong>{cents(runs.reduce((sum, r) => sum + r.usage.costUsd, 0))}</strong><small>Cost</small></div><div><strong>{runs.reduce((sum, r) => sum + r.usage.inputTokens + r.usage.outputTokens, 0).toLocaleString()}</strong><small>Tokens</small></div></div>
      <h3 className="eco-panel-heading">Task outputs</h3>
      {!runs.length && <p className="eco-profile-copy">No task history yet.</p>}
      {runs.slice(0, 8).map((r) => <Link className="eco-history" key={r.id} to={`${base}?run=${r.id}`}><span>{r.task}</span><small>{r.status} · {ago(r.createdAt)}</small><b>View Task Output →</b></Link>)}
    </>}
  </Dialog>;
}
