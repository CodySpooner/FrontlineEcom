// UI-07 agent detail: chat, run history, what the squad has learned about the store, and the agent's settings.
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { AGENT_ROLES, type AgentRole } from '@frontline/shared';
import { useAgents, useApprovals, useRuns } from '../api/client';
import { Portrait } from '../components/Art';
import { ApprovalCard, Chat } from '../components/Chat';
import { FlowLibrary } from '../components/FlowLibrary';
import { Hero } from '../components/Hero';
import { useStoreSelection } from '../components/StoreFilter';
import { AGENT_STATUS, Badge, buttonClass, EmptyState, ErrorState, LoadingState, StatusDot, Tabs } from '../components/ui';
import { cents, modelName } from '../lib/format';
import { NAV } from '../nav';
import { AgentSettings, AUTONOMY, History, Memory, NicheLearnings } from '../agents/settings';

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
  // What it's waiting on, answerable here even when no chat run raised it (a scheduled job, a seeded demo request).
  // One raised in the open conversation already sits in the chat.
  const waiting = (useApprovals().data ?? []).filter((a) => a.agentId === id && !(tab === 'chat' && a.runId && thread.includes(a.runId)));

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
      <Hero title={role.name} subtitle={name(agent.storeId)} icon={nav.icon} />
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <Link to={`/agents?store=${agent.storeId}`} className="flex items-center gap-1.5 text-[13px] text-muted transition hover:text-white">
          <ArrowLeft className="size-4" />
          All agents
        </Link>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Portrait role={agent.role} className="size-12" />
          <div className="min-w-0">
            {/* Wraps when the badges outgrow a narrow window. */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-2">
              <span className="flex items-center gap-2 whitespace-nowrap">
                <StatusDot tone={st.tone} pulse={st.pulse} />
                {st.label}
              </span>
              <Badge>{AUTONOMY[agent.autonomy ?? 'ask'].label}</Badge>
              {agent.dailyBudgetUsd !== undefined && <Badge>AI ≤ {cents(agent.dailyBudgetUsd)}/day</Badge>}
              {/* Scripted answers on demo stores: never touches the owner's Claude plan. */}
              {agent.engine?.provider === 'demo' && <Badge>Demo engine</Badge>}
              {agent.engine?.provider === 'claude' && <Badge>{agent.engine.model ? `Claude ${modelName(agent.engine.model)}` : 'Claude'}</Badge>}
            </div>
            <p className="mt-1 max-w-xl text-xs text-muted">{role.blurb}</p>
          </div>
        </div>
      </div>
      {waiting.length > 0 && (
        <div className="mb-4 grid gap-2">
          {waiting.map((a) => (
            <ApprovalCard key={a.id} a={a} />
          ))}
        </div>
      )}
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
