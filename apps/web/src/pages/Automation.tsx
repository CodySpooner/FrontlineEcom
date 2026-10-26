// UI-14 Automation: rules (schedule or metric trigger → agent task, approval policy, daily cap) and the log of what they did.
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { CalendarClock, History, Plus, TrendingDown, Zap } from 'lucide-react';
import { AGENT_ROLES, type ActionKind, type AgentRole, type AutomationRule, type AutomationRunStatus, type AutomationTrigger, type MetricTotals } from '@frontline/shared';
import { useActionLog, useApprovals, useAutomationActions, useAutomationRuns, useAutomations } from '../api/client';
import { ApprovalCard } from '../components/Chat';
import { Hero } from '../components/Hero';
import { StoreFilter, useStoreSelection } from '../components/StoreFilter';
import { Badge, Button, cx, Dialog, EmptyState, ErrorState, Field, inputClass, LoadingState, Panel, Segmented, Switch } from '../components/ui';
import { describeChange, describeTrigger, METRICS, parseCron, toCron, WEEKDAYS, when, type Schedule } from '../lib/automation';
import { ago } from '../lib/format';
import { NAV } from '../nav';

type MetricTrigger = Extract<AutomationTrigger, { type: 'metric' }>;

// Only what needs the owner gets color; a normal start stays grey.
const RUN: Record<AutomationRunStatus, { label: string; tone: 'red' | 'muted' }> = {
  started: { label: 'Started', tone: 'muted' },
  awaiting_approval: { label: 'Needs you', tone: 'red' },
  denied: { label: 'Denied', tone: 'muted' },
  skipped: { label: 'Skipped', tone: 'muted' },
  failed: { label: 'Failed', tone: 'red' },
};
const APPROVAL = {
  ask: { label: 'Ask me first', help: 'Each time it fires you get an approval request; the agent starts when you approve.' },
  auto: { label: 'Run on its own', help: 'The agent starts right away. Anything that spends money or changes the store still asks you.' },
};
const roleOf = (agentId: string) => agentId.split(':')[1] as AgentRole;

export function Automation() {
  const nav = NAV.find((n) => n.path === '/automation')!;
  const { has } = useStoreSelection();
  const q = useAutomations();
  const rules = (q.data ?? []).filter((r) => has(r.storeId));
  const [editing, setEditing] = useState<AutomationRule | 'new'>();
  const newRule = (
    <Button variant="primary" size="sm" onClick={() => setEditing('new')}>
      <Plus className="size-4" />
      New rule
    </Button>
  );
  return (
    <>
      <Hero title={nav.title} subtitle={nav.subtitle} icon={nav.icon} art={nav.art} />
      <div className="mb-3.5">
        <StoreFilter />
      </div>
      <div className="grid items-start gap-3.5 min-[1100px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="Rules" sub={q.data && `${rules.filter((r) => r.enabled).length} of ${rules.length} on`} action={rules.length > 0 && newRule}>
          {q.isPending ? (
            <LoadingState rows={4} />
          ) : q.isError ? (
            <ErrorState message="Couldn't load your rules." onRetry={() => q.refetch()} />
          ) : !rules.length ? (
            <EmptyState icon={Zap} title="No rules yet" action={newRule}>
              A rule hands an agent a task on a schedule, or when a number like ROAS moves.
            </EmptyState>
          ) : (
            <ul className="grid gap-2">
              {rules.map((r) => (
                <RuleRow key={r.id} r={r} onEdit={() => setEditing(r)} />
              ))}
            </ul>
          )}
        </Panel>
        <div className="grid gap-3.5">
          <RunLog rules={q.data ?? []} />
          <ActionLog />
        </div>
      </div>
      <Dialog open={!!editing} onClose={() => setEditing(undefined)} title={editing === 'new' ? 'New rule' : 'Edit rule'} side="right">
        {editing && <RuleEditor key={editing === 'new' ? 'new' : editing.id} rule={editing === 'new' ? undefined : editing} onDone={() => setEditing(undefined)} />}
      </Dialog>
    </>
  );
}

function RuleRow({ r, onEdit }: { r: AutomationRule; onEdit: () => void }) {
  const { name } = useStoreSelection();
  const { toggle, remove } = useAutomationActions();
  const [confirm, setConfirm] = useState(false);
  const Icon = r.trigger.type === 'schedule' ? CalendarClock : TrendingDown;
  const meta = [
    APPROVAL[r.approval].label,
    `max ${r.maxRunsPerDay}/day`,
    r.trigger.type === 'metric' && `${r.cooldownHours} h cooldown`,
    r.enabled && r.nextRunAt && `next ${when(r.nextRunAt)}`,
    r.lastFiredAt && `last fired ${ago(r.lastFiredAt)}`,
  ].filter(Boolean);
  return (
    <li className="flex gap-3 rounded-lg border border-line bg-bg-2 px-3 py-2.5">
      <Icon aria-hidden className={cx('mt-0.5 size-4 shrink-0', r.enabled ? 'text-red' : 'text-muted')} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <b className="text-[14px]">{r.name}</b>
          <span className="text-xs text-muted">{name(r.storeId)}</span>
        </div>
        <p className="text-[13px] text-text-2">
          {describeTrigger(r.trigger)} → {AGENT_ROLES[roleOf(r.action.agentId)]?.name ?? r.action.agentId}
        </p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="text-xs text-muted">{meta.join(' · ')}</span>
          {confirm ? (
            <span className="flex items-center gap-1.5">
              <Button size="sm" onClick={() => setConfirm(false)}>
                Keep
              </Button>
              <Button size="sm" variant="primary" disabled={remove.isPending} onClick={() => remove.mutate(r.id)}>
                Delete rule
              </Button>
            </span>
          ) : (
            <span className="flex gap-3 text-xs">
              <button type="button" onClick={onEdit} className="cursor-pointer text-text-2 hover:text-white">
                Edit
              </button>
              <button type="button" onClick={() => setConfirm(true)} className="cursor-pointer text-muted hover:text-red">
                Delete
              </button>
            </span>
          )}
        </div>
        {(toggle.isError || remove.isError) && (
          <p role="alert" className="mt-1 text-xs text-red">
            {(toggle.error ?? remove.error)?.message}
          </p>
        )}
      </div>
      <label className="flex h-fit cursor-pointer">
        <span className="sr-only">{r.name} on</span>
        <Switch checked={r.enabled} disabled={toggle.isPending} onChange={(e) => toggle.mutate({ id: r.id, enabled: e.target.checked })} />
      </label>
    </li>
  );
}

export function RunLog({ rules }: { rules: AutomationRule[] }) {
  const { has, name } = useStoreSelection();
  const q = useAutomationRuns();
  const pending = useApprovals().data;
  const rule = new Map(rules.map((r) => [r.id, r]));
  const runs = (q.data ?? []).filter((x) => has(x.storeId));
  return (
    <Panel title="Run Log" sub="What your rules did, newest first.">
      {q.isPending ? (
        <LoadingState rows={3} />
      ) : q.isError ? (
        <ErrorState message="Couldn't load the run log." onRetry={() => q.refetch()} />
      ) : !runs.length ? (
        <EmptyState icon={Zap} title="Nothing has fired yet">
          Turn a rule on. Every start, skip and approval request lands here.
        </EmptyState>
      ) : (
        <ol className="grid gap-2">
          {runs.map((x) => {
            const r = rule.get(x.ruleId);
            const ask = x.status === 'awaiting_approval' ? pending?.find((a) => a.id === x.approvalId) : undefined;
            return (
              <li key={x.id} className="rounded-lg border border-line bg-bg-2 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <b className="truncate text-[13px]">{r?.name ?? 'Deleted rule'}</b>
                  <Badge tone={RUN[x.status].tone}>{RUN[x.status].label}</Badge>
                </div>
                <p className="text-xs text-muted">
                  {name(x.storeId)} · {ago(x.firedAt)}
                </p>
                {x.detail && <p className="mt-1 text-[13px] text-text-2">{x.detail}</p>}
                {x.runId && r && (
                  <Link to={`/agents/${encodeURIComponent(r.action.agentId)}?run=${x.runId}`} className="mt-1 inline-block text-xs text-red hover:underline">
                    Open the run
                  </Link>
                )}
                {ask ? (
                  <div className="mt-2">
                    <ApprovalCard a={ask} />
                  </div>
                ) : (
                  x.status === 'awaiting_approval' && (
                    <Link to="/" className="mt-1 inline-block text-xs text-red hover:underline">
                      Review it on the Dashboard
                    </Link>
                  )
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}

const ACTION: Record<ActionKind, string> = {
  ad_budget: 'Ad budget changed',
  ad_pause: 'Ad paused',
  product_create: 'Products added',
  price_change: 'Price changed',
  product_page_publish: 'Product page published',
  page_publish: 'Page published',
  theme_duplicate: 'Theme copied',
  theme_files: 'Theme files edited',
  theme_publish: 'Theme published',
  theme_delete: 'Theme draft deleted',
};

/** What actually ran against a live store or ad account, whoever triggered it. */
function ActionLog() {
  const { ids, name } = useStoreSelection();
  const q = useActionLog(ids);
  return (
    <Panel title="Executed Actions" sub="Every change made to a live store or ad account, with its outcome.">
      {q.isPending ? (
        <LoadingState rows={3} />
      ) : q.isError ? (
        <ErrorState message="Couldn't load the action log." onRetry={() => q.refetch()} />
      ) : !q.data.length ? (
        <EmptyState icon={History} title="Nothing changed on a live store yet">
          Once a store is connected, approved and autopilot changes show up here.
        </EmptyState>
      ) : (
        <ol className="grid gap-2">
          {q.data.map((a) => (
            <li key={a.id} className="rounded-lg border border-line bg-bg-2 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <b className="truncate text-[13px]">{ACTION[a.action] ?? a.action}</b>
                {!a.ok && <Badge tone="red">Failed</Badge>}
              </div>
              <p className="text-xs text-muted">
                {name(a.storeId)} · {when(a.at)}
              </p>
              <p className="mt-1 truncate text-[13px] text-text-2" title={a.target}>
                {[a.target, describeChange(a.detail)].filter(Boolean).join(' · ')}
              </p>
              {a.error && <p className="mt-1 text-xs text-red">{a.error}</p>}
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

function RuleEditor({ rule, onDone }: { rule?: AutomationRule; onDone: () => void }) {
  const { ids, stores } = useStoreSelection();
  const { save } = useAutomationActions();
  const [storeId, setStoreId] = useState(rule?.storeId ?? ids[0] ?? stores[0]?.id ?? '');
  const [name, setName] = useState(rule?.name ?? '');
  const [role, setRole] = useState<AgentRole>(rule ? roleOf(rule.action.agentId) : 'market_analyst');
  const [task, setTask] = useState(rule?.action.task ?? '');
  const [kind, setKind] = useState<AutomationTrigger['type']>(rule?.trigger.type ?? 'schedule');
  const [cron, setCron] = useState(rule?.trigger.type === 'schedule' ? rule.trigger.cron : '0 9 * * *');
  const [metric, setMetric] = useState<MetricTrigger>(rule?.trigger.type === 'metric' ? rule.trigger : { type: 'metric', metric: 'roas', op: '<', value: 2, windowDays: 3 });
  const [approval, setApproval] = useState(rule?.approval ?? 'ask');
  const [maxRunsPerDay, setMax] = useState(rule?.maxRunsPerDay ?? 3);
  const [cooldownHours, setCooldown] = useState(rule?.cooldownHours ?? 24);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(
      {
        id: rule?.id,
        storeId,
        name: name.trim(),
        trigger: kind === 'schedule' ? { type: 'schedule', cron: cron.trim() } : metric,
        action: { type: 'agent_task', agentId: `${storeId}:${role}`, task: task.trim() },
        approval,
        maxRunsPerDay,
        cooldownHours,
      },
      { onSuccess: onDone },
    );
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} placeholder="e.g. Morning ROAS check" className={inputClass} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Store">
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)} disabled={!!rule} className={cx(inputClass, 'cursor-pointer disabled:cursor-default disabled:opacity-60')}>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Agent">
          <select value={role} onChange={(e) => setRole(e.target.value as AgentRole)} className={cx(inputClass, 'cursor-pointer')}>
            {Object.entries(AGENT_ROLES).map(([r, a]) => (
              <option key={r} value={r}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Task">
        <textarea value={task} onChange={(e) => setTask(e.target.value)} required maxLength={4000} rows={4} placeholder="What the agent should do each time the rule fires." className={cx(inputClass, 'resize-y')} />
      </Field>

      <fieldset className="grid gap-2">
        <legend className="mb-1.5 text-[13px] font-semibold">When</legend>
        <Segmented
          label="Trigger"
          options={[
            { value: 'schedule', label: 'On a schedule' },
            { value: 'metric', label: 'When a number moves' },
          ]}
          value={kind}
          onChange={setKind}
        />
        {kind === 'schedule' ? (
          <ScheduleField cron={cron} onChange={setCron} />
        ) : (
          <>
            <MetricField t={metric} onChange={setMetric} />
            <Field label="Wait between fires (hours)">
              <input type="number" min={0} max={720} step={1} value={cooldownHours} onChange={(e) => setCooldown(e.target.valueAsNumber)} required className={cx(inputClass, 'w-28')} />
            </Field>
          </>
        )}
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="mb-1.5 text-[13px] font-semibold">Approval</legend>
        <Segmented label="Approval" options={Object.entries(APPROVAL).map(([value, a]) => ({ value: value as 'ask' | 'auto', label: a.label }))} value={approval} onChange={setApproval} />
        <p className="text-xs text-muted">{APPROVAL[approval].help}</p>
        <Field label="At most this many times a day">
          <input type="number" min={1} max={100} step={1} value={maxRunsPerDay} onChange={(e) => setMax(e.target.valueAsNumber)} required className={cx(inputClass, 'w-28')} />
        </Field>
      </fieldset>

      {save.isError && (
        <p role="alert" className="text-xs text-red">
          {save.error.message}
        </p>
      )}
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={save.isPending}>
          {rule ? 'Save rule' : 'Create rule'}
        </Button>
      </div>
    </form>
  );
}

function ScheduleField({ cron, onChange }: { cron: string; onChange: (cron: string) => void }) {
  const parsed = parseCron(cron);
  const [custom, setCustom] = useState(!parsed);
  const s: Schedule = parsed ?? { every: 'day', time: '09:00', weekday: 1 };
  const set = (x: Partial<Schedule>) => onChange(toCron({ ...s, ...x }));
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Field label="Repeat" className="flex-1">
          <select
            value={custom ? 'custom' : s.every}
            onChange={(e) => {
              const v = e.target.value;
              setCustom(v === 'custom');
              if (v !== 'custom') set({ every: v as Schedule['every'] });
            }}
            className={cx(inputClass, 'cursor-pointer')}
          >
            <option value="day">Every day</option>
            <option value="weekdays">Weekdays</option>
            <option value="week">Once a week</option>
            <option value="custom">Custom (cron)</option>
          </select>
        </Field>
        {!custom && s.every === 'week' && (
          <Field label="On" className="flex-1">
            <select value={s.weekday} onChange={(e) => set({ weekday: +e.target.value })} className={cx(inputClass, 'cursor-pointer')}>
              {WEEKDAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </Field>
        )}
        {custom ? (
          <Field label="Cron" className="flex-1">
            <input value={cron} onChange={(e) => onChange(e.target.value)} required placeholder="0 9 * * *" className={cx(inputClass, 'font-mono')} />
          </Field>
        ) : (
          <Field label="At">
            <input type="time" value={s.time} onChange={(e) => e.target.value && set({ time: e.target.value })} required className={cx(inputClass, '[color-scheme:dark]')} />
          </Field>
        )}
      </div>
      <p className="text-xs text-muted">{custom ? 'Five fields in your local time: minute, hour, day of month, month, weekday.' : describeTrigger({ type: 'schedule', cron })}</p>
    </>
  );
}

function MetricField({ t, onChange }: { t: MetricTrigger; onChange: (t: MetricTrigger) => void }) {
  const set = (x: Partial<MetricTrigger>) => onChange({ ...t, ...x });
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Metric">
          <select value={t.metric} onChange={(e) => set({ metric: e.target.value as keyof MetricTotals })} className={cx(inputClass, 'cursor-pointer')}>
            {Object.entries(METRICS).map(([k, m]) => (
              <option key={k} value={k}>
                {m.label.charAt(0).toUpperCase() + m.label.slice(1)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Fires when it">
          <select value={t.op} onChange={(e) => set({ op: e.target.value as MetricTrigger['op'] })} className={cx(inputClass, 'cursor-pointer')}>
            <option value="<">drops below</option>
            <option value=">">goes above</option>
          </select>
        </Field>
        <Field label="Value">
          <input type="number" step="any" value={t.value} onChange={(e) => set({ value: e.target.valueAsNumber })} required className={inputClass} />
        </Field>
        <Field label="Over the last (days)">
          <input type="number" min={1} max={90} step={1} value={t.windowDays} onChange={(e) => set({ windowDays: e.target.valueAsNumber })} required className={inputClass} />
        </Field>
      </div>
      {Number.isFinite(t.value) && Number.isFinite(t.windowDays) && <p className="text-xs text-muted">{describeTrigger(t)}. Checked every 15 minutes.</p>}
    </>
  );
}
