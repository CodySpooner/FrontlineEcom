// UI-06 AI Agents: one store's squad at a time — portrait, status, level + XP, what it does, and Deploy for idle roles.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { MessageSquare, Plus, Settings2, Users } from 'lucide-react';
import { AGENT_ROLES, type Agent } from '@frontline/shared';
import { useAgents, useStores, useUpdateAgent } from '../api/client';
import { Portrait } from '../components/Art';
import { Hero } from '../components/Hero';
import { useStoreSelection } from '../components/StoreFilter';
import { AGENT_STATUS, Badge, Button, buttonClass, cx, Dialog, EmptyState, ErrorState, LoadingState, StatusDot, Tabs, XPBar } from '../components/ui';
import { NAV } from '../nav';

const NAV_AGENTS = NAV[1]!;

export function Agents() {
  const stores = useStores();
  const agents = useAgents();
  const { ids } = useStoreSelection();
  const [params, setParams] = useSearchParams();
  const [picking, setPicking] = useState(false);
  const deploy = useUpdateAgent();

  const list = stores.data ?? [];
  // Deep-linkable (?store=); otherwise the first store picked in the global filter, else the first store.
  const storeId = list.find((s) => s.id === params.get('store'))?.id ?? ids[0] ?? list[0]?.id;
  const store = list.find((s) => s.id === storeId);
  const squad = (agents.data ?? []).filter((a) => a.storeId === storeId);
  const idle = squad.filter((a) => a.enabled === false);
  const working = squad.filter((a) => a.status === 'running').length;
  const needsYou = squad.filter((a) => a.status === 'waiting_approval').length;

  const enable = (a: Agent) => deploy.mutate({ id: a.id, enabled: true });

  return (
    <>
      <Hero title={NAV_AGENTS.title} subtitle={NAV_AGENTS.subtitle} icon={NAV_AGENTS.icon} art={NAV_AGENTS.art} />
      {stores.isPending || agents.isPending ? (
        <LoadingState rows={4} />
      ) : stores.isError || agents.isError ? (
        <ErrorState message="Couldn't load your squads." onRetry={() => (stores.isError ? stores.refetch() : agents.refetch())} />
      ) : !store ? (
        <EmptyState icon={Users} title="No stores yet" action={<Link to="/integrations" className={buttonClass('primary')}>Connect a store</Link>}>
          Each store gets its own squad of eight agents.
        </EmptyState>
      ) : (
        <>
          <Tabs label="Store" tabs={list.map((s) => ({ value: s.id, label: s.name, color: s.color }))} value={store.id} onChange={(id) => setParams({ store: id }, { replace: true })} />
          <div className="my-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] text-muted">
              <b className="font-semibold text-text-2">{squad.length - idle.length} of {squad.length}</b> deployed · {working} working
              {needsYou > 0 && <span className="text-red"> · {needsYou} need{needsYou === 1 ? 's' : ''} you</span>}
            </p>
            <Button variant="primary" onClick={() => setPicking(true)}>
              <Plus className="size-4" strokeWidth={2.2} />
              Deploy Agent
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-3.5 min-[620px]:grid-cols-2 min-[1100px]:grid-cols-3 min-[1280px]:grid-cols-4">
            {squad.map((a) => (
              <AgentCard key={a.id} a={a} onDeploy={() => enable(a)} deploying={deploy.isPending && deploy.variables?.id === a.id} failed={deploy.isError && deploy.variables?.id === a.id} />
            ))}
          </div>
          <Dialog open={picking} onClose={() => setPicking(false)} title={`Deploy to ${store.name}`}>
            {idle.length ? (
              <ul className="grid gap-2.5">
                {idle.map((a) => (
                  <li key={a.id} className="flex items-center gap-3">
                    <Portrait role={a.role} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold">{AGENT_ROLES[a.role].name}</div>
                      <div className="truncate text-xs text-muted">{AGENT_ROLES[a.role].blurb}</div>
                    </div>
                    <Button size="sm" variant="primary" disabled={deploy.isPending} aria-label={`Deploy ${AGENT_ROLES[a.role].name}`} onClick={() => enable(a)}>
                      Deploy
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={Users} title="Full squad deployed">
                All {squad.length} agents are working for {store.name}.
              </EmptyState>
            )}
          </Dialog>
        </>
      )}
    </>
  );
}

function AgentCard({ a, onDeploy, deploying, failed }: { a: Agent; onDeploy: () => void; deploying: boolean; failed: boolean }) {
  const role = AGENT_ROLES[a.role];
  const off = a.enabled === false;
  const st = AGENT_STATUS[a.status];
  const to = `/agents/${encodeURIComponent(a.id)}`;
  return (
    <article className="card flex flex-col gap-3 p-3.5">
      <Portrait role={a.role} rank={a.rank} className={cx('h-[132px] w-full', off && 'opacity-40 grayscale')} />
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-display text-[15px] leading-tight font-semibold">{role.name}</h2>
        {off ? (
          <Badge>Not deployed</Badge>
        ) : (
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-text-2">
            <StatusDot tone={st.tone} pulse={st.pulse} />
            {st.label}
          </span>
        )}
      </div>
      <XPBar level={a.level} rank={a.rank} xp={a.levelProgress?.xp ?? 0} next={a.levelProgress?.needed ?? 100} />
      <p className="line-clamp-3 min-h-[3lh] text-xs text-muted">{role.blurb}</p>
      {a.currentTask && !off && (
        <p className="truncate text-xs text-text-2" title={a.currentTask}>
          <span className="text-muted">Now:</span> {a.currentTask}
        </p>
      )}
      {failed && (
        <p role="alert" className="text-xs text-red">
          Couldn't deploy. Try again.
        </p>
      )}
      <div className="mt-auto grid grid-cols-2 gap-2">
        {off ? (
          <Button size="sm" variant="primary" className="col-span-2" disabled={deploying} onClick={onDeploy} aria-label={`Deploy ${role.name}`}>
            {deploying ? 'Deploying…' : 'Deploy'}
          </Button>
        ) : (
          <>
            <Link to={`${to}?tab=settings`} className={buttonClass('ghost', 'sm')} aria-label={`Configure ${role.name}`}>
              <Settings2 className="size-3.5" strokeWidth={2} />
              Configure
            </Link>
            <Link to={to} className={buttonClass('ghost', 'sm')} aria-label={`Chat with ${role.name}`}>
              <MessageSquare className="size-3.5" strokeWidth={2} />
              Chat
            </Link>
          </>
        )}
      </div>
    </article>
  );
}
