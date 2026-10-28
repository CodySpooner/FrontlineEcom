import { useState } from 'react';
import { Link } from 'react-router';
import { AGENT_ROLES, PR_SPECIALIST_ASKS, type AgentRole, type PrSpecialistAsk, type SquadMission } from '@frontline/shared';
import { useCreateTeam, useTeam } from '../api/client';
import { agentsUrl } from '../agents/urls';
import { Button, ErrorState, LoadingState } from '../components/ui';
import { useAddLink, useLinks, useSpecialistTeam } from './api';
import { Pill, TONE } from './Card';

const STATUS: Record<SquadMission['status'], [string, keyof typeof TONE]> = { running: ['Working', 'run'], done: ['Done', 'good'], blocked: ['Stopped: a task failed', 'bad'], cancelled: ['Stopped by you', 'muted'] };
const role = (r: AgentRole) => AGENT_ROLES[r]?.name ?? r;

/**
 * "Ask a specialist" (PR-24): a team on the AI Agents team engine, Product Researcher leading and the specialist
 * contributing, started from stored facts; its assignments, outputs and consolidated answer stay linked here.
 */
export function Specialists({ id, store }: { id: string; store: string }) {
  const [ask, setAsk] = useState<PrSpecialistAsk | null>(null);
  const plan = useSpecialistTeam(id, store, ask);
  const create = useCreateTeam(store);
  const link = useAddLink(id, store);
  const teams = (useLinks(id, store).data?.links ?? []).filter((l) => l.kind === 'team');
  const start = () =>
    plan.data && create.mutate({ clientRequestId: crypto.randomUUID(), ...plan.data }, { onSuccess: (t) => link.mutate({ kind: 'team', refId: t.id }, { onSuccess: () => setAsk(null) }) });
  const error = create.error?.message ?? (link.error && `The team started but isn't linked here (${link.error.message}): find it in AI Agents.`);
  return (
    <section aria-label="Ask a specialist">
      <h3 className="mb-1.5 text-[11px] font-semibold tracking-[.07em] text-muted uppercase">Ask a specialist</h3>
      <p className="mb-1.5 text-muted">A team in AI Agents: Product Researcher leads and consolidates, the specialist contributes. What they send back is a proposal, not evidence.</p>
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(PR_SPECIALIST_ASKS) as PrSpecialistAsk[]).map((k) => (
          <Button key={k} size="sm" aria-pressed={ask === k} onClick={() => setAsk(ask === k ? null : k)}>
            {`${PR_SPECIALIST_ASKS[k].who}: ${PR_SPECIALIST_ASKS[k].label.toLowerCase()}`}
          </Button>
        ))}
      </div>
      {ask &&
        (plan.isPending ? (
          <LoadingState rows={2} />
        ) : plan.isError ? (
          <ErrorState message={plan.error.message} onRetry={() => void plan.refetch()} />
        ) : (
          <div className="mt-2 grid gap-1.5 rounded-lg border border-line p-3">
            <p className="text-muted">The team's objective, from stored data only:</p>
            <p className="whitespace-pre-wrap text-text-2">{plan.data.objective}</p>
            <Button size="sm" variant="primary" className="justify-self-start" disabled={create.isPending || link.isPending} onClick={start}>
              Start team
            </Button>
          </div>
        ))}
      {error && (
        <p role="alert" className="mt-1 text-red">
          {error}
        </p>
      )}
      {teams.map((l) => (
        <TeamSummary key={l.refId} store={store} id={l.refId} />
      ))}
    </section>
  );
}

function TeamSummary({ store, id }: { store: string; id: string }) {
  const q = useTeam(store, id);
  if (q.isPending) return <LoadingState rows={2} />;
  if (q.isError) return <p className="mt-2 text-muted">{`A team that can't be read: ${q.error.message}`}</p>;
  const t = q.data;
  const [label, tone] = STATUS[t.status];
  const tasks = t.steps.filter((s) => s.kind === 'task');
  const synthesis = t.steps.find((s) => s.kind === 'synthesis');
  const consolidated = synthesis?.contribution?.summary ?? synthesis?.deliverable;
  return (
    <article aria-label={`Team: ${t.title}`} className="mt-2 grid gap-1 rounded-lg border border-line p-3">
      <div className="flex items-start justify-between gap-2">
        <b className="text-text">{t.title}</b>
        <Pill tone={tone} className="shrink-0">
          {label}
        </Pill>
      </div>
      <p className="text-muted">{`With ${(t.participants ?? []).map((p) => p.name ?? p.type).join(', ')}`}</p>
      {tasks.length ? (
        <ul aria-label="Assignments" className="grid gap-0.5">
          {tasks.map((s) => (
            <li key={s.id} className="text-text-2">
              <b className="text-text">{role(s.role)}</b>
              {`: ${s.task}`}
              <span className="text-muted">{` · ${s.status}${s.contribution?.summary ?? s.deliverable ? ` → ${s.contribution?.summary ?? s.deliverable}` : ''}`}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">The lead is planning the assignments.</p>
      )}
      <p className="text-text-2">{consolidated ? `Consolidated: ${consolidated}` : 'No consolidated answer yet.'}</p>
      {t.conversationId && (
        <Link to={agentsUrl({ store, conversation: t.conversationId })} className="text-red hover:underline">
          Open the team in AI Agents
        </Link>
      )}
    </article>
  );
}
