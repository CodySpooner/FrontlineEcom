// UI-07 agent detail: chat, run history, what the squad has learned about the store, and the agent's settings.
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ArrowLeft, Brain, Trash2 } from 'lucide-react';
import { AGENT_ROLES, APPROVAL_KINDS, type Agent, type AgentRole, type Autonomy, type MemoryKind } from '@frontline/shared';
import { useAddMemory, useAgents, useAutomationActions, useAutomations, useCaps, useForgetMemory, useForgetNicheLearning, useMemory, useNicheLearnings, useRun, useRuns, useStores, useUpdateAgent, useUsage } from '../api/client';
import { Portrait } from '../components/Art';
import { Chat } from '../components/Chat';
import { FlowLibrary } from '../components/FlowLibrary';
import { Hero } from '../components/Hero';
import { useStoreSelection } from '../components/StoreFilter';
import { AGENT_STATUS, Badge, Button, buttonClass, EmptyState, ErrorState, LoadingState, Panel, ProgressBar, MEMORY_KINDS, memoryAuthor, RUN_STATUS, Segmented, StatusDot, Switch, Table, Tabs, UsageMeter, XPBar } from '../components/ui';
import { describeTrigger, when } from '../lib/automation';
import { ago, cents, money } from '../lib/format';
import { NAV } from '../nav';

const TABS = [
  { value: 'chat', label: 'Chat' },
  { value: 'history', label: 'History' },
  { value: 'memory', label: 'Memory' },
  { value: 'flows', label: 'Flows' },
  { value: 'settings', label: 'Settings' },
] as const;
type Tab = (typeof TABS)[number]['value'];
// Tabs only some roles have.
const ROLE_TABS: Partial<Record<Tab, AgentRole>> = { flows: 'email_sms' };

export function AgentDetail() {
  const { id = '' } = useParams();
  const agents = useAgents();
  const { name } = useStoreSelection();
  const [params, setParams] = useSearchParams();
  const agent = agents.data?.find((a) => a.id === id);
  const tabs = TABS.filter((t) => !ROLE_TABS[t.value] || ROLE_TABS[t.value] === agent?.role);
  const tab: Tab = tabs.find((t) => t.value === params.get('tab'))?.value ?? 'chat';
  const runs = useRuns(id);
  // The open conversation; until the owner picks one it's ?run= (a deep link) or the latest run.
  const [picked, setThread] = useState<string[]>();
  const linked = params.get('run');
  const thread = picked ?? (linked ? [linked] : runs.data?.[0] ? [runs.data[0].id] : []);

  const role = agent && AGENT_ROLES[agent.role];
  const nav = NAV[1]!;
  const go = (t: Tab) => setParams(t === 'chat' ? {} : { tab: t }, { replace: true });

  if (agents.isPending) return <LoadingState rows={4} className="mt-6" />;
  if (agents.isError) return <ErrorState message="Couldn't load this agent." onRetry={() => agents.refetch()} />;
  if (!agent || !role) {
    return (
      <>
        <Hero title="Agent not found" subtitle="It may belong to a store that was removed." icon={nav.icon} />
        <EmptyState title="No agent here" action={<Link to="/agents" className={buttonClass('primary')}>Back to AI Agents</Link>} />
      </>
    );
  }

  const st = AGENT_STATUS[agent.status];
  return (
    <>
      <Hero title={role.name} subtitle={`${name(agent.storeId)} · Level ${agent.level}`} icon={nav.icon} art="lone" />
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <Link to={`/agents?store=${agent.storeId}`} className="flex items-center gap-1.5 text-[13px] text-muted transition hover:text-white">
          <ArrowLeft className="size-4" />
          All agents
        </Link>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Portrait role={agent.role} rank={agent.rank} className="size-12" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-text-2">
              <StatusDot tone={st.tone} pulse={st.pulse} />
              {st.label}
              <Badge>{AUTONOMY[agent.autonomy ?? 'ask'].label}</Badge>
            </div>
            <p className="mt-1 max-w-xl truncate text-xs text-muted">{role.blurb}</p>
          </div>
        </div>
        <div className="w-full max-w-60">
          <XPBar level={agent.level} rank={agent.rank} xp={agent.levelProgress?.xp ?? 0} next={agent.levelProgress?.needed ?? 100} />
        </div>
      </div>
      <Tabs label="Agent" tabs={tabs} value={tab} onChange={go} />
      <div className="mt-4">
        {tab === 'chat' && <Chat agent={agent} thread={thread} onThread={setThread} />}
        {tab === 'history' && (
          <History
            agentId={agent.id}
            onOpen={(runId) => {
              setThread([runId]);
              go('chat');
            }}
          />
        )}
        {tab === 'memory' && (
          <div className="grid gap-3.5">
            <Memory agent={agent} />
            <NicheLearnings storeId={agent.storeId} />
          </div>
        )}
        {tab === 'flows' && (
          <FlowLibrary
            agent={agent}
            onOpen={(runId) => {
              setThread([runId]);
              go('chat');
            }}
          />
        )}
        {tab === 'settings' && <AgentSettings agent={agent} />}
      </div>
    </>
  );
}

/** Links a run a squadmate assigned (`assign_task`) back to the run that assigned it. */
function AssignedBy({ runId }: { runId: string }) {
  const parent = useRun(runId).data;
  if (!parent) return null;
  const role = AGENT_ROLES[parent.agentId.split(':')[1] as AgentRole];
  return (
    <Link to={`/agents/${encodeURIComponent(parent.agentId)}?run=${runId}`} className="mt-1 inline-block rounded-md border border-line-2 px-1.5 py-0.5 text-[11px] text-text-2 hover:border-red/60 hover:text-white">
      Assigned by {role?.name ?? 'a squadmate'}
    </Link>
  );
}

function History({ agentId, onOpen }: { agentId: string; onOpen: (runId: string) => void }) {
  const runs = useRuns(agentId);
  const now = Date.now();
  return (
    <Panel title="Run history" sub="Every task this agent worked on, newest first.">
      {runs.isPending ? (
        <LoadingState rows={4} />
      ) : runs.isError ? (
        <ErrorState message="Couldn't load the history." onRetry={() => runs.refetch()} />
      ) : !runs.data.length ? (
        <EmptyState title="No runs yet">Tasks you give this agent in Chat show up here.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Task</th>
              <th>Status</th>
              <th>Started</th>
              <th className="text-right!">Cost</th>
            </tr>
          </thead>
          <tbody>
            {runs.data.map((r) => (
              <tr key={r.id}>
                <td className="max-w-[420px]">
                  <button type="button" onClick={() => onOpen(r.id)} className="block max-w-full cursor-pointer truncate text-left hover:text-red" title="Open in chat">
                    {r.task}
                  </button>
                  {r.parentRunId && <AssignedBy runId={r.parentRunId} />}
                </td>
                <td>
                  <Badge tone={RUN_STATUS[r.status].tone}>{RUN_STATUS[r.status].label}</Badge>
                </td>
                <td className="text-muted">{ago(r.startedAt ?? r.createdAt, now)}</td>
                <td className="text-right text-muted">{cents(r.usage.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Panel>
  );
}

/** Owner-approved learnings every store in this niche sees (promoted from one store's memory). */
function NicheLearnings({ storeId }: { storeId: string }) {
  const store = useStores().data?.find((s) => s.id === storeId);
  // ponytail: custom ("other") niches key on a slug of nicheDetail computed in packages/agents; asked agents for ?store= so we don't copy it.
  const niche = store && store.niche !== 'other' ? store.niche : '';
  const q = useNicheLearnings(niche);
  const forget = useForgetNicheLearning();
  const { name } = useStoreSelection();
  if (!niche) return null;
  return (
    <Panel title={`Shared with all ${niche} stores`} sub="Learnings you approved for the whole niche. Every squad in it sees them.">
      {q.isPending ? (
        <LoadingState rows={2} />
      ) : q.isError ? (
        <ErrorState message="Couldn't load the niche learnings." onRetry={() => q.refetch()} />
      ) : !q.data.length ? (
        <p className="text-[13px] text-muted">None yet. When an agent finds something every {niche} store should know, it asks you to share it here.</p>
      ) : (
        <ul className="grid gap-2">
          {q.data.map((l) => (
            <li key={l.id} className="flex items-start justify-between gap-4 rounded-lg border border-line bg-bg-2 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-[13px]">{l.text}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {l.storeId && `Learned in ${name(l.storeId)} · `}
                  {ago(l.createdAt, Date.now())}
                  {l.evidence && ` · ${l.evidence}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => forget.mutate(l.id)}
                disabled={forget.isPending}
                aria-label={`Stop sharing: ${l.text}`}
                className="cursor-pointer rounded-md p-1.5 text-muted transition hover:bg-panel-2 hover:text-red"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Memory({ agent }: { agent: Agent }) {
  const { name } = useStoreSelection();
  const mem = useMemory(agent.storeId);
  const add = useAddMemory(agent.storeId);
  const forget = useForgetMemory(agent.storeId);
  const [kind, setKind] = useState<MemoryKind>('fact');
  const [text, setText] = useState('');

  const teach = (e: FormEvent) => {
    e.preventDefault();
    add.mutate({ kind, text: text.trim() }, { onSuccess: () => setText('') });
  };

  return (
    <Panel title={`What the squad knows about ${name(agent.storeId)}`} sub="Shared by every agent on this store. Agents add learnings as they work; you can teach them too.">
      <form onSubmit={teach} className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented label="Kind" options={MEMORY_KINDS} value={kind} onChange={setKind} />
        <label htmlFor="mem-text" className="sr-only">
          What should the squad know?
        </label>
        <input
          id="mem-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          minLength={5}
          maxLength={300}
          placeholder="e.g. Our best customers are first-time dog owners"
          className="min-w-60 flex-1 rounded-lg border border-line-2 bg-bg-2 px-3 py-2 text-[13px] placeholder:text-muted focus:border-red/60 focus:outline-none"
        />
        <Button type="submit" variant="primary" disabled={text.trim().length < 5 || add.isPending}>
          Teach the squad
        </Button>
        {add.isError && (
          <p role="alert" className="w-full text-xs text-red">
            {add.error.message}
          </p>
        )}
      </form>
      {mem.isPending ? (
        <LoadingState rows={3} />
      ) : mem.isError ? (
        <ErrorState message="Couldn't load what the squad knows." onRetry={() => mem.refetch()} />
      ) : !mem.data.length ? (
        <EmptyState icon={Brain} title="Nothing learned yet">
          As agents work on this store they save what worked and why. Add the first fact above.
        </EmptyState>
      ) : (
        <ul className="grid gap-2">
          {mem.data.map((m) => (
            <li key={m.id} className="grid grid-cols-[minmax(0,1fr)_120px_auto] items-center gap-4 rounded-lg border border-line bg-bg-2 px-3 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[11px] text-muted">
                  <Badge tone={m.agentId === agent.id ? 'red' : 'muted'}>{MEMORY_KINDS.find((k) => k.value === m.kind)?.label}</Badge>
                  {memoryAuthor(m.agentId)} · {ago(m.createdAt, Date.now())}
                </div>
                <p className="mt-1 text-[13px]">{m.text}</p>
                {m.evidence && <p className="mt-0.5 text-xs text-muted">{m.evidence}</p>}
              </div>
              <div>
                <div className="mb-1 text-right text-[11px] text-muted tabular-nums">{Math.round(m.confidence * 100)}% sure</div>
                <ProgressBar value={m.confidence} label="Confidence" />
              </div>
              <button
                type="button"
                onClick={() => forget.mutate(m.id)}
                disabled={forget.isPending}
                aria-label={`Forget: ${m.text}`}
                className="cursor-pointer rounded-md p-1.5 text-muted transition hover:bg-panel-2 hover:text-red"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

const AUTONOMY: Record<Autonomy, { label: string; help: string }> = {
  suggest: { label: 'Suggest', help: 'Recommends only. Never acts on the store.' },
  ask: { label: 'Ask first', help: 'Acts, but anything that spends, publishes or changes the store waits for your approval.' },
  autopilot: { label: 'Autopilot', help: "Approves its own actions within the store's autopilot caps. Everything is logged." },
};

function AgentSettings({ agent }: { agent: Agent }) {
  const update = useUpdateAgent();
  const caps = useCaps(agent.storeId).data;
  const usage = useUsage([agent.storeId]).data?.[0];
  const autonomy = agent.autonomy ?? 'ask';
  const autopilotKinds = Object.entries(caps?.autopilot ?? {}).filter(([, v]) => v.enabled);
  return (
    <div className="grid gap-4 min-[1100px]:grid-cols-2">
      <Panel title="Deployment">
        <label className="flex cursor-pointer items-center justify-between gap-4">
          <span>
            <span className="block text-[13px] font-semibold">Deployed</span>
            <span className="block text-xs text-muted">Off = the agent stops taking tasks for this store. Its memory stays.</span>
          </span>
          <Switch checked={agent.enabled !== false} disabled={update.isPending} onChange={(e) => update.mutate({ id: agent.id, enabled: e.target.checked })} />
        </label>
        <div className="mt-5">
          <div className="mb-2 text-[13px] font-semibold">Autonomy</div>
          <Segmented
            label="Autonomy"
            options={Object.entries(AUTONOMY).map(([value, a]) => ({ value: value as Autonomy, label: a.label }))}
            value={autonomy}
            onChange={(v) => update.mutate({ id: agent.id, autonomy: v })}
          />
          <p className="mt-2 text-xs text-muted">{AUTONOMY[autonomy].help}</p>
        </div>
        {update.isError && (
          <p role="alert" className="mt-3 text-xs text-red">
            {update.error.message}
          </p>
        )}
      </Panel>
      <Panel title="Store caps" sub="Hard limits every agent on this store respects." action={<Link to="/settings" className={buttonClass('ghost', 'sm')}>Edit caps</Link>}>
        {!caps ? (
          <LoadingState rows={3} />
        ) : (
          <dl className="grid gap-2.5 text-[13px]">
            <Cap label="Ad budget changes" value={`${money(caps.adSpendChangePerDay)}/day`}>
              {usage && <UsageMeter label="Ad budget changes" used={usage.adBudgetAddedUsd} cap={caps.adSpendChangePerDay} fmt={(n) => money(n)} />}
            </Cap>
            <Cap label="AI usage" value={`${money(caps.agentCostPerDay)}/day`}>
              {usage && <UsageMeter label="AI usage" used={usage.agentCostUsd} cap={caps.agentCostPerDay} fmt={(n) => cents(n)} />}
            </Cap>
            <Cap label="Higgsfield credits" value={`${caps.higgsfieldCreditsPerDay.toLocaleString('en-US')}/day`}>
              {usage && <UsageMeter label="Higgsfield credits" used={usage.credits} cap={caps.higgsfieldCreditsPerDay} fmt={(n) => n.toLocaleString('en-US')} />}
            </Cap>
            <Cap
              label="Autopilot actions"
              value={autopilotKinds.length ? autopilotKinds.map(([k, v]) => `${APPROVAL_KINDS[k]?.label ?? k} ≤ ${money(v.maxUsdPerDay)}/day`).join(', ') : 'None — everything asks first'}
            />
          </dl>
        )}
      </Panel>
      <Schedule agent={agent} />
    </div>
  );
}

function Schedule({ agent }: { agent: Agent }) {
  const q = useAutomations();
  const { toggle } = useAutomationActions();
  const rules = (q.data ?? []).filter((r) => r.action.agentId === agent.id);
  return (
    <Panel
      title="Schedule"
      sub="Automation rules that hand this agent a task."
      action={
        <Link to="/automation" className={buttonClass('ghost', 'sm')}>
          {rules.length ? 'Manage rules' : 'New rule'}
        </Link>
      }
      className="min-[1100px]:col-span-2"
    >
      {q.isPending ? (
        <LoadingState rows={2} />
      ) : q.isError ? (
        <ErrorState message="Couldn't load the rules." onRetry={() => q.refetch()} />
      ) : !rules.length ? (
        <p className="text-xs text-muted">No rules yet: this agent works when you or another agent asks.</p>
      ) : (
        <ul className="divide-y divide-line">
          {rules.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold">{r.name}</span>
                <span className="block text-xs text-muted">{[describeTrigger(r.trigger), r.enabled && r.nextRunAt && `next ${when(r.nextRunAt)}`].filter(Boolean).join(' · ')}</span>
                <span className="block truncate text-xs text-text-2" title={r.action.task}>
                  {r.action.task}
                </span>
              </span>
              <label className="flex shrink-0 cursor-pointer">
                <span className="sr-only">{r.name} on</span>
                <Switch checked={r.enabled} disabled={toggle.isPending} onChange={(e) => toggle.mutate({ id: r.id, enabled: e.target.checked })} />
              </label>
            </li>
          ))}
        </ul>
      )}
      {toggle.isError && (
        <p role="alert" className="mt-2 text-xs text-red">
          {toggle.error.message}
        </p>
      )}
    </Panel>
  );
}

function Cap({ label, value, children }: { label: string; value: string; children?: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1.5 border-b border-line pb-2.5 last:border-b-0 last:pb-0">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-semibold text-text-2 tabular-nums">{value}</dd>
      {children && <dd className="col-span-2">{children}</dd>}
    </div>
  );
}
