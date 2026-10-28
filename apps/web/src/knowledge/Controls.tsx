// The Research Center's self-directed research line and its controls (KB-22): whether a store's agents research on their
// own, who and for which categories, on what triggers and budget, whether each task waits for approval and its findings
// for review, the sites to prefer or never read, and research on a schedule (automations with a research action). The
// server enforces each one (apps/server kb/autonomy.ts and the research runner); this only sets them.
import { useState, type FormEvent, type ReactNode } from 'react';
import { AGENT_ROLES, KB_RESEARCH_DEPTHS, KB_TRIGGERS, type AgentRole, type KbControls, type KbResearchDepth, type KbTrigger } from '@frontline/shared';
import { useAutomationActions, useAutomations, useKbCategories, useKbControls, useSaveKbControls } from '../api/client';
import { Button, cx, inputClass } from '../components/ui';

const EVERY: Record<string, string> = { '0 9 * * *': 'Every day at 9:00', '0 9 * * 1': 'Every Monday at 9:00', '0 9 1 * *': 'On the 1st of each month at 9:00' };
const small = 'h-7 cursor-pointer rounded-md border border-line-2 bg-panel-2 px-2.5 text-xs text-text-2 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-50';
const field = cx(inputClass, 'h-8 w-full py-0 text-xs');
const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
const ROLES = Object.keys(AGENT_ROLES) as AgentRole[];

/** `ws`: a store, general, or all (which has no controls of its own). */
export function ResearchControls({ ws }: { ws: string }) {
  const controls = useKbControls(ws === 'all' ? undefined : ws);
  const [open, setOpen] = useState(false);
  if (ws === 'all') return <p className="text-xs text-muted">Pick a workspace to see its research controls.</p>;
  const c = controls.data;
  const line = !c
    ? 'Loading…'
    : ws === 'general'
      ? "Self-directed research runs on a store's agents and AI budget: pick a store to turn it on."
      : c.autonomous
        ? `On: $${c.reservedUsd.toFixed(2)} of $${c.dailyBudgetUsd.toFixed(2)} reserved today`
        : 'Off: agents research only when you or a task asks.';
  return (
    <>
      <p className="flex items-baseline justify-between gap-2 text-xs">
        <span className={c?.autonomous ? 'text-text-2' : 'text-muted'}>{line}</span>
        {c && !open && (
          <button type="button" onClick={() => setOpen(true)} className={small}>
            Controls
          </button>
        )}
      </p>
      {open && c && <ControlsForm key={ws} ws={ws} c={c} onDone={() => setOpen(false)} />}
      {open && ws !== 'general' && <Schedules ws={ws} />}
    </>
  );
}

function ControlsForm({ ws, c, onDone }: { ws: string; c: KbControls; onDone: () => void }) {
  const store = ws !== 'general';
  const save = useSaveKbControls();
  const top = (useKbCategories(ws).data ?? []).filter((k) => k.parentId === null && k.storeId === (store ? ws : null));
  const [on, setOn] = useState(c.autonomous);
  const [approval, setApproval] = useState(c.approval);
  const [review, setReview] = useState(c.review);
  const [triggers, setTriggers] = useState(new Set(c.triggers));
  const [roles, setRoles] = useState(c.roles);
  const [task, setTask] = useState(c.taskBudgetUsd);
  const [daily, setDaily] = useState(c.dailyBudgetUsd);
  const [depth, setDepth] = useState<KbResearchDepth>(c.depth);
  const [trusted, setTrusted] = useState(c.trustedDomains.join('\n'));
  const [blocked, setBlocked] = useState(c.blockedDomains.join('\n'));
  const toggle = <T,>(set: Set<T>, x: T) => new Set(set.has(x) ? [...set].filter((y) => y !== x) : [...set, x]);
  const role = (r: AgentRole, cats: string[] | undefined) => setRoles(({ [r]: _, ...rest }) => (cats ? { ...rest, [r]: cats } : rest));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const sites = { trustedDomains: lines(trusted), blockedDomains: lines(blocked) };
    const own = { autonomous: on, approval, triggers: (Object.keys(KB_TRIGGERS) as KbTrigger[]).filter((t) => triggers.has(t)), roles, taskBudgetUsd: task, dailyBudgetUsd: daily, depth };
    save.mutate({ ws, review, ...sites, ...(store ? own : {}) }, { onSuccess: onDone });
  };
  return (
    <form aria-label="Research controls" onSubmit={submit} className="grid gap-2.5 rounded-lg border border-line-2 bg-panel p-3 text-xs">
      {store && (
        <>
          <Check label="Agents research on their own" on={on} onChange={() => setOn(!on)} />
          <Check label="Ask me before each task" on={approval} onChange={() => setApproval(!approval)} />
          <Group legend="Triggers">
            {(Object.entries(KB_TRIGGERS) as [KbTrigger, string][]).map(([t, label]) => (
              <Check key={t} label={label} on={triggers.has(t)} onChange={() => setTriggers(toggle(triggers, t))} />
            ))}
          </Group>
          <Group legend="Who researches">
            {ROLES.map((r) => (
              <div key={r} className="grid gap-1">
                <Check label={AGENT_ROLES[r].name} on={!!roles[r]} onChange={() => role(r, roles[r] ? undefined : [])} />
                {roles[r] && (
                  <div className="grid gap-1 pl-5">
                    {top.map((k) => (
                      <Check key={k.id} label={k.name} on={roles[r]!.includes(k.id)} onChange={() => role(r, [...toggle(new Set(roles[r]), k.id)])} />
                    ))}
                    {!roles[r]!.length && <p className="text-[11px] text-muted">No category ticked: its usual areas.</p>}
                  </div>
                )}
              </div>
            ))}
          </Group>
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1 text-muted">
              Per task (USD)
              <input type="number" min={0.25} max={5} step={0.25} value={task} onChange={(e) => setTask(Number(e.target.value))} className={field} />
            </label>
            <label className="grid gap-1 text-muted">
              Per day (USD)
              <input type="number" min={task} max={50} step={0.25} value={daily} onChange={(e) => setDaily(Number(e.target.value))} className={field} />
            </label>
            <label className="col-span-2 grid gap-1 text-muted">
              Depth
              <select value={depth} onChange={(e) => setDepth(e.target.value as KbResearchDepth)} className={field}>
                {(Object.entries(KB_RESEARCH_DEPTHS) as [KbResearchDepth, { label: string }][]).map(([d, { label }]) => (
                  <option key={d} value={d}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </>
      )}
      <Check label="Findings wait for my review" on={review} onChange={() => setReview(!review)} />
      <label className="grid gap-1 text-muted">
        Trusted sites (one per line)
        <textarea rows={2} value={trusted} onChange={(e) => setTrusted(e.target.value)} className={cx(inputClass, 'w-full py-1 text-xs')} />
      </label>
      <label className="grid gap-1 text-muted">
        Blocked sites (one per line)
        <textarea rows={2} value={blocked} onChange={(e) => setBlocked(e.target.value)} className={cx(inputClass, 'w-full py-1 text-xs')} />
      </label>
      {save.error && (
        <p role="alert" className="text-red">
          {save.error.message}
        </p>
      )}
      <div className="flex gap-2">
        <Button size="sm" variant="primary" type="submit" disabled={save.isPending}>
          Save
        </Button>
        <Button size="sm" type="button" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** A store's research automations: a topic, its researcher and how often. */
function Schedules({ ws }: { ws: string }) {
  const rules = (useAutomations().data ?? []).filter((r) => r.storeId === ws && r.action.type === 'kb_research');
  const act = useAutomationActions();
  const [topic, setTopic] = useState('');
  const [role, setRole] = useState<AgentRole>('market_analyst');
  const [cron, setCron] = useState('0 9 * * 1');
  const add = () =>
    act.save.mutate(
      { storeId: ws, name: topic.trim().slice(0, 80), trigger: { type: 'schedule', cron }, action: { type: 'kb_research', agentId: `${ws}:${role}`, task: topic.trim() }, approval: 'auto', maxRunsPerDay: 1 },
      { onSuccess: () => setTopic('') },
    );
  return (
    <div className="grid gap-1.5 text-xs">
      {rules.length ? (
        <ul aria-label="Scheduled research" className="grid gap-1">
          {rules.map((r) => (
            <li key={r.id} className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 text-text-2">{`${r.trigger.type === 'schedule' ? (EVERY[r.trigger.cron] ?? r.trigger.cron) : 'On a metric'}: ${r.action.task} · ${AGENT_ROLES[r.action.agentId.split(':')[1] as AgentRole]?.name ?? r.action.agentId}`}</span>
              <button type="button" disabled={act.remove.isPending} onClick={() => act.remove.mutate(r.id)} className={cx(small, 'h-6 px-2 text-[11px]')}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">No research on a schedule.</p>
      )}
      <Group legend="Add a schedule">
        <label className="grid gap-1 text-muted">
          Topic
          <input value={topic} maxLength={500} onChange={(e) => setTopic(e.target.value)} className={field} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-muted">
            Researcher
            <select value={role} onChange={(e) => setRole(e.target.value as AgentRole)} className={field}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {AGENT_ROLES[r].name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-muted">
            How often
            <select value={cron} onChange={(e) => setCron(e.target.value)} className={field}>
              {Object.entries(EVERY).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
        {act.save.error && (
          <p role="alert" className="text-red">
            {act.save.error.message}
          </p>
        )}
        <div>
          <button type="button" disabled={topic.trim().length < 3 || act.save.isPending} onClick={add} className={small}>
            Add
          </button>
        </div>
      </Group>
    </div>
  );
}

const Group = ({ legend, children }: { legend: string; children: ReactNode }) => (
  <fieldset className="grid gap-1.5 rounded-md border border-line p-2">
    <legend className="px-1 text-[11px] font-semibold text-text-2">{legend}</legend>
    {children}
  </fieldset>
);
const Check = ({ label, on, onChange }: { label: string; on: boolean; onChange: () => void }) => (
  <label className="flex cursor-pointer items-center gap-2 text-text-2">
    <input type="checkbox" checked={on} onChange={onChange} className="accent-red" />
    {label}
  </label>
);
