import { useState } from 'react';
import { Link } from 'react-router';
import type { Agent } from '@frontline/shared';
import { useRun, useStartRun } from '../api/client';
import { Button, ErrorState, Field } from '../components/ui';
import type { OfficeState } from './events';

export function TaskComposer({ agent, office }: { agent: Agent; office: OfficeState }) {
  const [task, setTask] = useState('');
  const start = useStartRun(), detail = useRun(start.data?.id ?? '');
  const run = detail.data ?? start.data;
  const approval = run && Object.values(office.approvals).find((a) => a.runId === run.id && a.status === 'pending');
  return <form className="eco-command" onSubmit={(e) => {
    e.preventDefault();
    if (task.trim() && !start.isPending && agent.status !== 'offline') start.mutate({ agentId: agent.id, task: task.trim() }, { onSuccess: () => setTask('') });
  }}>
    <Field label="Task instruction"><textarea autoFocus value={task} onChange={(e) => setTask(e.target.value)} maxLength={4000} rows={4} placeholder="What should this agent accomplish?" /></Field>
    <Button variant="primary" size="sm" type="submit" disabled={!task.trim() || start.isPending || agent.status === 'offline'}>{start.isPending ? 'Assigning…' : 'Start task'}</Button>
    {agent.status === 'offline' && <p>Resume this agent before assigning work.</p>}
    {start.error && <ErrorState message={start.error.message} />}
    {run && <div role="status"><strong>{approval ? 'Awaiting approval' : run.status === 'done' ? 'Task completed' : run.status === 'error' ? 'Task failed' : run.status === 'cancelled' ? 'Task cancelled' : run.status === 'running' ? 'Task running' : 'Task queued'}</strong><p>{run.error ?? run.task}</p><Link to={`/agents/${encodeURIComponent(agent.id)}?run=${run.id}`}>{approval ? 'Review request and task' : 'View task output and progress'} →</Link></div>}
  </form>;
}
