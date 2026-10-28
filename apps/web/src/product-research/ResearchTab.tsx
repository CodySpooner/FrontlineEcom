import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { PR_RECOMMENDATION_LABEL, PR_STAGE_LABEL, PR_TASK_STATUS_LABEL, type PrRecommendation, type PrReport, type PrReportList, type PrStage, type PrTask, type PrTaskStatus } from '@frontline/shared';
import { useRun, useStopConversation } from '../api/client';
import { activitySteps } from '../agents/activity';
import { agentsUrl } from '../agents/urls';
import { Button, ErrorState, LoadingState } from '../components/ui';
import { ago } from '../lib/format';
import { useChangeStage, usePrAgents, useReports, useRetryTask, useTasks } from './api';
import { Pill, TASK_TONE, TONE } from './Card';
import { Specialists } from './Specialists';

const LIST = 10;
const ACTIVE: PrTaskStatus[] = ['queued', 'running', 'waiting_for_you', 'awaiting_approval'];
const REC_TONE: Record<PrRecommendation, keyof typeof TONE> = { research_further: 'run', request_sample: 'run', shortlist: 'good', monitor: 'muted', reject: 'bad' };
/** The stage a recommendation suggests (decision 5); Monitor is a watch, not a stage. The owner moves it. */
const REC_STAGE: Record<PrRecommendation, PrStage | null> = { research_further: 'researching', request_sample: 'sample_review', shortlist: 'shortlisted', monitor: null, reject: 'rejected' };
const KIND = { measured: 'Measured', research: 'Research', supplier_claim: 'Supplier claim', hypothesis: 'Hypothesis' };
const FIT = { strong: 'Strong', medium: 'Medium', weak: 'Weak' };
const time = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const link = 'cursor-pointer text-[#ff6b76] hover:underline';

const Heading = ({ children }: { children: ReactNode }) => <h3 className="mb-1.5 text-[11px] font-semibold tracking-[.07em] text-muted uppercase">{children}</h3>;

/** A source as given: a link when it is an http(s) address, else its text. */
const Source = ({ s }: { s: string }) =>
  /^https?:\/\/\S+$/i.test(s) ? (
    <a href={s} target="_blank" rel="noopener noreferrer" className="break-all text-[#ff6b76] hover:underline">
      {s}
    </a>
  ) : (
    <span className="break-words">{s}</span>
  );

/** The Research tab (decision 7): the product's tasks in this store, the latest with its run's real activity, then every report. */
export function ResearchTab({ id, store, stage }: { id: string; store: string | null; stage: PrStage | null }) {
  if (!store) return <p className="text-xs text-muted">Research tasks and reports are kept per store: pick a store to see them.</p>;
  return <StoreResearch id={id} store={store} stage={stage} />;
}

function StoreResearch({ id, store, stage }: { id: string; store: string; stage: PrStage | null }) {
  const tasks = useTasks(store, id);
  const reports = useReports(store, id);
  const agents = usePrAgents(store);
  const [all, setAll] = useState({ tasks: false, reports: false }); // long lists show their first 10 (decision 14)
  if (tasks.isPending || reports.isPending) return <LoadingState rows={4} />;
  if (tasks.isError) return <ErrorState message={tasks.error.message} onRetry={() => void tasks.refetch()} />;
  if (reports.isError) return <ErrorState message={reports.error.message} onRetry={() => void reports.refetch()} />;
  const name = (type: string) => agents.data?.find((a) => a.type === type)?.name ?? (type === 'product_hunter' ? 'Product Researcher' : 'Custom Product Research agent');
  const [latest, ...older] = tasks.data;
  return (
    <div className="grid gap-3.5 text-xs">
      {latest ? (
        <TaskCard t={latest} store={store} agent={name(latest.type)} live />
      ) : (
        <p className="text-muted">No research on this product here yet: Research with an agent starts a task, and its report shows here.</p>
      )}
      {older.length > 0 && (
        <section>
          <Heading>{`Earlier tasks (${older.length})`}</Heading>
          <div className="grid gap-2">
            {(all.tasks ? older : older.slice(0, LIST)).map((t) => (
              <TaskCard key={t.id} t={t} store={store} agent={name(t.type)} />
            ))}
          </div>
          {!all.tasks && older.length > LIST && (
            <Button size="sm" variant="ghost" className="mt-1.5" onClick={() => setAll({ ...all, tasks: true })}>
              {`Show all ${older.length} earlier tasks`}
            </Button>
          )}
        </section>
      )}
      <Specialists id={id} store={store} />
      <section>
        <Heading>{`Reports (${reports.data.length})`}</Heading>
        {reports.data.length ? (
          <div className="grid gap-2">
            {(all.reports ? reports.data : reports.data.slice(0, LIST)).map((r, i) => (
              <ReportCard key={r.id} r={r} id={id} store={store} stage={stage} open={i === 0} />
            ))}
            {!all.reports && reports.data.length > LIST && (
              <Button size="sm" variant="ghost" className="justify-self-start" onClick={() => setAll({ ...all, reports: true })}>
                {`Show all ${reports.data.length} reports`}
              </Button>
            )}
          </div>
        ) : (
          <p className="text-muted">No reports yet. A report is saved by the agent at the end of its task; a run that ends without one says so above.</p>
        )}
      </section>
    </div>
  );
}

/** A task's real state; the live one lists its run's activity, never a scripted list of steps. */
function TaskCard({ t, store, agent, live = false }: { t: PrTask; store: string; agent: string; live?: boolean }) {
  const stop = useStopConversation(store, t.conversationId ?? '');
  const retry = useRetryTask(store);
  const active = ACTIVE.includes(t.status);
  const error = stop.error ?? retry.error;
  return (
    <div className="rounded-[10px] border border-line p-3">
      <div className="flex items-start justify-between gap-2">
        <b className="min-w-0 text-text">{`${agent} · started ${time(t.createdAt)}`}</b>
        <Pill tone={TASK_TONE[t.status]} className="shrink-0 whitespace-nowrap">
          {PR_TASK_STATUS_LABEL[t.status]}
        </Pill>
      </div>
      <p className="mt-0.5 line-clamp-2 text-muted">{`“${t.instructions}”`}</p>
      {t.detail && <p className="mt-1 text-text-2">{t.detail}</p>}
      {t.status === 'finished_without_report' && <p className="mt-1 text-text-2">The agent finished without saving a report: its answer is in the conversation.</p>}
      {live && t.runId && <Activity runId={t.runId} active={active} />}
      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {t.conversationId && (
          <Link to={agentsUrl({ store, conversation: t.conversationId })} className={link}>
            Open conversation in AI Agents
          </Link>
        )}
        {active && t.conversationId && t.runId && (
          <button type="button" disabled={stop.isPending} onClick={() => stop.mutate(t.runId!)} className={link}>
            Cancel run
          </button>
        )}
        {t.canRetry && (
          <Button size="sm" disabled={retry.isPending} onClick={() => retry.mutate({ id: t.id })}>
            Retry
          </Button>
        )}
        <span className="text-muted">{`Updated ${ago(t.updatedAt)}`}</span>
      </p>
      {error && (
        <p role="alert" className="mt-1 text-red">
          {error.message}
        </p>
      )}
    </div>
  );
}

function Activity({ runId, active }: { runId: string; active: boolean }) {
  const run = useRun(runId);
  const steps = run.data ? activitySteps(run.data.transcript) : [];
  if (!steps.length) return run.data ? <p className="mt-2 text-muted">{active ? 'No activity yet.' : 'The run used no tools.'}</p> : null;
  const shown = steps.slice(-6);
  return (
    <ol aria-label="Activity" className="mt-2 grid list-decimal gap-1 pl-4 text-text-2">
      {shown.map((s, i) => (
        <li key={i}>
          {s.icon === 'running' && active ? <b className="text-text">{s.text}</b> : s.text}{' '}
          {s.icon === 'running' && active && <span className="text-muted">now</span>}
          {s.icon === 'failed' && <span className="font-semibold text-red">failed</span>}
          {s.icon === 'warning' && <span className="font-semibold text-[#f5b84a]">needs attention</span>}
        </li>
      ))}
    </ol>
  );
}

/** One report as the agent saved it. A demo report is labelled and shows no recommendation (decision 7). */
function ReportCard({ r, id, store, stage, open }: { r: PrReport; id: string; store: string; stage: PrStage | null; open: boolean }) {
  const b = r.body;
  const move = useChangeStage(id, store);
  const to = r.demo ? null : REC_STAGE[b.recommendation];
  const unknown = (k: PrReportList) => <p className="text-muted italic">{`Unknown: ${b.unknown_reasons[k] ?? 'not given'}`}</p>;
  const list = (title: string, k: PrReportList, items: ReactNode[]) => (
    <div>
      <b className="text-text">{title}</b>
      {items.length ? <ul className="ml-4 list-disc">{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : unknown(k)}
    </div>
  );
  const text = (title: string, value: string) => (
    <div>
      <b className="text-text">{title}</b>
      <p className="whitespace-pre-line">{value}</p>
    </div>
  );
  return (
    <details open={open} className="rounded-[10px] border border-line p-3">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-2">
        {r.demo ? <Pill tone="warn">Demo engine · scripted example, not research</Pill> : <Pill tone={REC_TONE[b.recommendation]}>{PR_RECOMMENDATION_LABEL[b.recommendation]}</Pill>}
        <span className="shrink-0 text-muted">{time(r.createdAt)}</span>
      </summary>
      <div className="mt-2 grid gap-2 text-text-2">
        <p className="whitespace-pre-line">{b.summary}</p>
        {!r.demo && (
          <>
            {text('Purpose', b.purpose)}
            {text('Customer problem', b.customer_problem)}
            {text(`Store fit: ${FIT[b.store_fit.fit]}`, b.store_fit.why)}
            {text('Demand evidence', b.demand_evidence)}
            {list('Competitors', 'competitors', b.competitors.map((c) => <>{[c.name, c.price].filter(Boolean).join(' · ')} · <Source s={c.source} /></>))}
            {list('Supplier offers', 'supplier_offers', b.supplier_offers.map((o) => <><Source s={o.offer} /> · {o.provenance}</>))}
            {list('Risks', 'risks', b.risks)}
            {list('Evidence', 'evidence', b.evidence.map((e) => <>{e.claim} <span className="text-muted">{`[${KIND[e.kind]}]`}</span> · <Source s={e.source} /></>))}
            {list('Open questions', 'open_questions', b.open_questions)}
            {text('Would change if', b.would_change_if)}
            {list('Next steps', 'next_steps', b.next_steps)}
            {list('Proposals, not evidence', 'proposals', b.proposals.map((p) => `${p.kind === 'ad_angle' ? 'Ad angle' : 'Differentiation'}: ${p.text}`))}
          </>
        )}
        {to && to !== stage && (
          <div>
            <Button size="sm" disabled={move.isPending} onClick={() => move.mutate({ stage: to, reason: `Report of ${time(r.createdAt)}: ${PR_RECOMMENDATION_LABEL[b.recommendation]}` })}>
              {`Move to ${PR_STAGE_LABEL[to]}`}
            </Button>
            {move.error && (
              <p role="alert" className="mt-1 text-red">
                {move.error.message}
              </p>
            )}
          </div>
        )}
        {r.conversationId && (
          <Link to={agentsUrl({ store, conversation: r.conversationId, run: r.runId })} className={link}>
            Open conversation in AI Agents
          </Link>
        )}
      </div>
    </details>
  );
}
