import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Brain, Trash2 } from 'lucide-react';
import { AGENT_ROLES, APPROVAL_KINDS, settingsUrl, type Agent, type AgentRole, type Autonomy, type MemoryKind, type StoreCaps } from '@frontline/shared';
import { useAddMemory, useAgents, useApprovals, useAutomationActions, useAutomations, useCaps, useForgetMemory, useMemory, useRun, useRuns, useStores, useUpdateAgent, useUsage } from '../api/client';
import { ApprovalCard } from '../components/Chat';
import { DemoJobsNote } from '../components/DemoJobsNote';
import { FlowLibrary } from '../components/FlowLibrary';
import { SharedLearnings } from '../components/NicheLearnings';
import { useStoreSelection } from '../components/StoreFilter';
import { nicheName } from '../components/StoreForm';
import { Badge, Button, buttonClass, ConfirmDelete, cx, Dialog, EmptyState, ErrorState, inputClass, LoadingState, Panel, ProgressBar, MEMORY_KINDS, memoryAuthor, RUN_STATUS, Segmented, Switch, Table, Tabs, UsageMeter } from '../components/ui';
import { describeTrigger, when } from '../lib/automation';
import { ago, cents, money } from '../lib/format';
import { capFrom } from '../lib/usage';
import { withParams } from '../knowledge/url';
import { agentsUrl } from './urls';

// An agent seat's settings, memory and run history: the agent-type settings drawer's tabs, and the autopilot rule both
// the Details panel and Deploy read.

const DRAWER_TABS = [
  { value: 'settings', label: 'Settings' },
  { value: 'memory', label: 'Memory' },
  { value: 'history', label: 'History' },
  { value: 'flows', label: 'Flows' },
] as const;
export type DrawerTab = (typeof DRAWER_TABS)[number]['value'];

/** The drawer is URL state (`?settings=<role>&tab=`), so the legacy `?tab=` links can open it (AA-14b). */
export function useAgentSettings() {
  const [params, setParams] = useSearchParams();
  const role = params.get('settings') as AgentRole | null;
  const tab = DRAWER_TABS.find((t) => t.value === params.get('tab'))?.value ?? 'settings';
  const set = (changes: Record<string, string | undefined>) => setParams((p) => withParams(p, changes), { replace: true });
  return { role, tab, open: (r: AgentRole, t: DrawerTab = 'settings') => set({ settings: r, tab: t }), setTab: (t: DrawerTab) => set({ tab: t }), close: () => set({ settings: undefined, tab: undefined }) };
}

/** A seat's settings, memory, run history and (Email & SMS) flows. A run opens in its conversation, or read-only. */
export function SettingsDrawer({ storeId }: { storeId: string }) {
  const { role, tab, setTab, close } = useAgentSettings();
  const navigate = useNavigate();
  const agent = useAgents().data?.find((a) => a.id === `${storeId}:${role}`);
  // What the seat is waiting on, answerable here even when no conversation raised it (a scheduled job, a seeded request).
  const waiting = (useApprovals().data ?? []).filter((a) => a.agentId === agent?.id);
  const tabs = DRAWER_TABS.filter((t) => t.value !== 'flows' || role === 'email_sms');
  const openRun = (run: string) => navigate(agentsUrl({ store: storeId, run }));
  return (
    <Dialog side="right" open={!!role} onClose={close} title={role ? `${AGENT_ROLES[role]?.name ?? 'Agent'} settings` : 'Agent settings'}>
      {!agent ? (
        <LoadingState rows={4} />
      ) : (
        <>
          {waiting.length > 0 && (
            <div className="mb-4 grid gap-2">
              {waiting.map((a) => (
                <ApprovalCard key={a.id} a={a} />
              ))}
            </div>
          )}
          <Tabs label="Agent settings" tabs={tabs} value={tabs.some((t) => t.value === tab) ? tab : 'settings'} onChange={setTab} />
          <div className="mt-4">
            {tab === 'settings' && <AgentSettings agent={agent} />}
            {tab === 'memory' && (
              <div className="grid gap-3.5">
                <Memory agent={agent} />
                <NicheLearnings storeId={agent.storeId} />
              </div>
            )}
            {tab === 'history' && <History agentId={agent.id} onOpen={openRun} />}
            {tab === 'flows' && role === 'email_sms' && <FlowLibrary agent={agent} onOpen={openRun} />}
          </div>
        </>
      )}
    </Dialog>
  );
}

/** The store's autopilot rules that are on, for kinds autopilot may take (APPROVAL_KINDS[kind].autopilot). */
const storeRules = (caps?: StoreCaps) => Object.entries(caps?.autopilot ?? {}).filter(([k, v]) => v.enabled && APPROVAL_KINDS[k]?.autopilot);

/**
 * The rules a run is auto-approved under: only with the seat on autopilot (read live: requestApproval reads it when
 * called) and propose_ad_change among the run's tools. Empty: spending always asks first.
 */
export const autopilotRules = (autonomy: Autonomy | undefined, caps: StoreCaps | undefined, tools: string[]) => (autonomy === 'autopilot' && tools.includes('propose_ad_change') ? storeRules(caps) : []);

/** Approvals and budget's lines (the Details panel; Deploy's spending row reads the same rules). */
export const approvalLines = (rules: ReturnType<typeof autopilotRules>) => [
  'Publishing, live-store edits and contacting customers always ask you first.',
  ...(rules.length ? rules.map(([k, v]) => `${APPROVAL_KINDS[k]?.label ?? k} up to ${money(v.maxUsdPerDay)}/day is auto-approved (autopilot)`) : ['Spending always asks you first.']),
];

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
                  <Badge tone={RUN_STATUS[r.state ?? r.status].tone}>{RUN_STATUS[r.state ?? r.status].label}</Badge>
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

/** The learnings shared with this agent's store's niche. */
export function NicheLearnings({ storeId }: { storeId: string }) {
  const store = useStores().data?.find((s) => s.id === storeId);
  if (!store) return null;
  return <SharedLearnings by={{ store: storeId }} niche={store.niche === 'other' ? store.nicheDetail || 'your niche' : nicheName(store.niche)} />;
}

function Memory({ agent }: { agent: Agent }) {
  const { name } = useStoreSelection();
  const mem = useMemory(agent.storeId);
  const add = useAddMemory(agent.storeId);
  const forget = useForgetMemory(agent.storeId);
  const [kind, setKind] = useState<MemoryKind>('fact');
  const [text, setText] = useState('');
  // The squad card's "N learned" link opens on this agent's own (`by=agent`); the store's memory is shared by all.
  const [params] = useSearchParams();
  const [by, setBy] = useState<'all' | 'agent'>(params.get('by') === 'agent' ? 'agent' : 'all');
  const mine = mem.data?.filter((m) => m.agentId === agent.id) ?? [];
  const mixed = mine.length > 0 && mine.length < (mem.data?.length ?? 0);

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
        <>
          {mixed && (
            <div className="mb-3">
              <Segmented
                label="Whose"
                options={[
                  { value: 'all' as const, label: `Everyone (${mem.data.length})` },
                  { value: 'agent' as const, label: `${AGENT_ROLES[agent.role].name} (${mine.length})` },
                ]}
                value={by}
                onChange={setBy}
              />
            </div>
          )}
          <ul className="grid gap-2">
            {(by === 'agent' && mixed ? mine : mem.data).map((m) => (
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
                <ConfirmDelete question="Forget this memory?" confirm="Forget memory" busy={forget.isPending} onConfirm={() => forget.mutate(m.id)}>
                  {(open, ref) => (
                    <button
                      ref={ref}
                      type="button"
                      onClick={open}
                      disabled={forget.isPending}
                      aria-label={`Forget: ${m.text}`}
                      className="cursor-pointer rounded-md p-1.5 text-muted transition hover:bg-panel-2 hover:text-red"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </ConfirmDelete>
              </li>
            ))}
          </ul>
        </>
      )}
      {forget.isError && (
        <p role="alert" className="mt-2 text-xs text-red">
          {forget.error.message}
        </p>
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
  const autopilotKinds = storeRules(caps);
  return (
    // Two columns only when its container is wide (the old page), one in the drawer.
    <div className="@container">
      <div className="grid gap-4 @3xl:grid-cols-2">
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
          <AgentBudget agent={agent} storeCap={caps?.agentCostPerDay} />
          {update.isError && (
            <p role="alert" className="mt-3 text-xs text-red">
              {update.error.message}
            </p>
          )}
        </Panel>
        <Panel title="Store caps" sub="Hard limits every agent on this store respects." action={<Link to={settingsUrl('agents', { store: agent.storeId, setting: 'caps.agentCostPerDay' })} className={buttonClass('ghost', 'sm')}>Edit caps</Link>}>
          {!caps ? (
            <LoadingState rows={3} />
          ) : (
            <dl className="grid gap-2.5 text-[13px]">
              <Cap label="Ad budget changes" value={`${money(caps.adSpendChangePerDay)}/day`} from={capFrom(caps, 'adSpendChangePerDay')}>
                {usage && <UsageMeter label="Ad budget changes" used={usage.adBudgetAddedUsd} cap={caps.adSpendChangePerDay} fmt={(n) => money(n)} />}
              </Cap>
              <Cap label="AI usage" value={`${money(caps.agentCostPerDay)}/day`} from={capFrom(caps, 'agentCostPerDay')}>
                {usage && <UsageMeter label="AI usage" used={usage.agentCostUsd} cap={caps.agentCostPerDay} fmt={(n) => cents(n)} />}
              </Cap>
              <Cap label="Higgsfield credits" value={`${caps.higgsfieldCreditsPerDay.toLocaleString('en-US')}/day`} from={capFrom(caps, 'higgsfieldCreditsPerDay')}>
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
    </div>
  );
}

/** The agent's own daily AI budget inside the store's cap (AGT-90). Blank removes it. */
export function AgentBudget({ agent, storeCap }: { agent: Agent; storeCap?: number }) {
  const update = useUpdateAgent();
  const [value, setValue] = useState(agent.dailyBudgetUsd?.toString() ?? '');
  const budget = value.trim() === '' ? null : Number(value);
  const valid = budget === null || (Number.isFinite(budget) && budget >= 0 && budget <= 1000);
  const changed = budget !== (agent.dailyBudgetUsd ?? null);
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (valid && changed) update.mutate({ id: agent.id, dailyBudgetUsd: budget });
  };
  return (
    <form onSubmit={save} className="mt-5">
      <label htmlFor={`budget-${agent.id}`} className="mb-2 block text-[13px] font-semibold">
        Daily AI budget
      </label>
      <div className="flex items-center gap-2">
        <input
          id={`budget-${agent.id}`}
          type="number"
          min={0}
          max={1000}
          step={0.01}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="No own limit"
          className={cx(inputClass, 'w-36 py-1! tabular-nums')}
        />
        <Button type="submit" size="sm" disabled={!valid || !changed || update.isPending}>
          Save budget
        </Button>
      </div>
      {agent.dailyBudgetUsd !== undefined && agent.costTodayUsd !== undefined && (
        <div className="mt-2.5">
          <UsageMeter label="This agent's AI usage" used={agent.costTodayUsd} cap={agent.dailyBudgetUsd} fmt={(n) => cents(n)} />
        </div>
      )}
      <p className="mt-2 text-xs text-muted">
        USD per day, inside the store's AI cap{storeCap !== undefined && ` of ${money(storeCap)}/day`}. Blank: only the store's cap applies.
      </p>
      {update.isError && (
        <p role="alert" className="mt-1 text-xs text-red">
          {update.error.message}
        </p>
      )}
    </form>
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
      className="@3xl:col-span-2"
    >
      {q.isPending ? (
        <LoadingState rows={2} />
      ) : q.isError ? (
        <ErrorState message="Couldn't load the rules." onRetry={() => q.refetch()} />
      ) : !rules.length ? (
        <p className="text-xs text-muted">No rules yet: this agent works when you or another agent asks.</p>
      ) : (
        <>
          <DemoJobsNote rules={rules} />
          <ul className="divide-y divide-line">
            {rules.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold">{r.name}</span>
                  <span className="block text-xs text-text-2">{[describeTrigger(r.trigger), r.enabled && r.nextRunAt && `next ${when(r.nextRunAt)}`].filter(Boolean).join(' · ')}</span>
                  <span className="block truncate text-xs text-muted" title={r.action.task}>
                    {r.action.task}
                  </span>
                </span>
                <label className="flex shrink-0 cursor-pointer">
                  <span className="sr-only">{r.name} on</span>
                  <Switch checked={r.enabled} disabled={toggle.isPending} onChange={(e) => toggle.mutate({ id: r.id, enabled: e.target.checked, version: r.version ?? 0 })} />
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      {toggle.isError && (
        <p role="alert" className="mt-2 text-xs text-red">
          {toggle.error.message}
        </p>
      )}
    </Panel>
  );
}

function Cap({ label, value, from, children }: { label: string; value: string; from?: { text: string; to: string }; children?: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1.5 border-b border-line pb-2.5 last:border-b-0 last:pb-0">
      <dt className="text-muted">
        {label}
        {from && (
          <>
            {' · '}
            <Link to={from.to} className="text-xs hover:text-white hover:underline">
              {from.text}
            </Link>
          </>
        )}
      </dt>
      <dd className="text-right font-semibold text-text-2 tabular-nums">{value}</dd>
      {children && <dd className="col-span-2">{children}</dd>}
    </div>
  );
}
