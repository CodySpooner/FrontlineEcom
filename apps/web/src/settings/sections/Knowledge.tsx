// Knowledge (ST-25, decision 13): the knowledge base's research controls (`kb_controls`) for General or one store, moved
// from the Research Center, and a store's research on a schedule. One explicit save through PUT /api/kb/controls. The
// server enforces each one (apps/server kb/autonomy.ts, kb/maintenance.ts and the research runner); this only sets them.
// Automatic saving (ST-26) isn't a KB control: it inherits, the workspace's or a store's own, through PATCH /api/config.
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AGENT_ROLES, KB_RESEARCH_DEPTHS, KB_TRIGGERS, SETTINGS, settingsUrl, type AgentRole, type ConfigImpact, type ConfigView, type KbControls, type KbControlsState, type KbResearchDepth, type KbTrigger } from '@frontline/shared';
import { api, json, useAutomationActions, useAutomations, useClaudeAccount, useConfig, useKbCategories, useKbControls, type ApiError } from '../../api/client';
import { cx, Dialog, ErrorState, flatButtonClass, inputClass, LoadingState, Switch } from '../../components/ui';
import { useSettingsForm } from '../form';
import { SaveBar, SettingRow, SettingsSection, useScope, type Origin } from '../kit';

const EVERY: Record<string, string> = { '0 9 * * *': 'Every day at 9:00', '0 9 * * 1': 'Every Monday at 9:00', '0 9 1 * *': 'On the 1st of each month at 9:00' };
const AGES = [14, 30, 60, 90, 180, 365];
const KEEP: [string, string][] = [['', 'Always'], ['365', '1 year'], ['180', '6 months'], ['90', '90 days'], ['30', '30 days']];
const ROLES = Object.keys(AGENT_ROLES) as AgentRole[];
const TRIGGERS = Object.keys(KB_TRIGGERS) as KbTrigger[];
const field = cx(inputClass, 'py-1.5 text-[13px]');
const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The controls as edited: the site lists as typed (one per line), with the version read; and Automatic saving. */
type Form = Omit<KbControls, 'trustedDomains' | 'blockedDomains'> & { trustedDomains: string; blockedDomains: string; version: number } & Auto;
const toForm = ({ reservedUsd: _, version, trustedDomains, blockedDomains, ...c }: KbControlsState): Omit<Form, keyof Auto> => ({ ...c, trustedDomains: trustedDomains.join('\n'), blockedDomains: blockedDomains.join('\n'), version: version ?? 0 });
/** What changed, as PUT /api/kb/controls takes it: the site lists split into domains. */
const toBody = ({ trustedDomains, blockedDomains, ...c }: Partial<Form>) => ({ ...c, ...(trustedDomains !== undefined ? { trustedDomains: lines(trustedDomains) } : {}), ...(blockedDomains !== undefined ? { blockedDomains: lines(blockedDomains) } : {}) });
const KB = SETTINGS.filter((s) => s.id.startsWith('kb.'));
const def = (k: keyof KbControls) => KB.find((s) => s.id === `kb.${k}`)!;
type Trim = { pages: number; logs: number; outputs: number; transcripts: number };

const AUTO = 'knowledge.autoSave';
const autoDef = SETTINGS.find((s) => s.id === AUTO)!;
/** Automatic saving as set at this scope (absent: it inherits), with that config document's version. */
type Auto = { autoSave?: boolean; configVersion: number };
const autoOf = (v: ConfigView, store?: string): Auto => ({
  configVersion: (store ? v.versions[`store_caps:${store}`] : v.versions.workspace) ?? 0,
  ...(v.origins[AUTO] === (store ? 'store' : 'workspace') ? { autoSave: v.values[AUTO] as boolean } : {}),
});
/** Its write: the workspace row, or the store's override; `undefined` goes back to the workspace's. */
const autoDoc = (on: boolean | undefined, version: number, store?: string) => ({
  doc: store ? 'store_caps' : 'workspace', ...(store ? { storeId: store } : {}), version, ...(on === undefined ? { unset: [AUTO] } : { set: { [AUTO]: on } }),
});

export function Knowledge() {
  const scope = useScope();
  const store = scope.store;
  const ws = store?.id ?? 'general';
  const qc = useQueryClient();
  const q = useKbControls(scope.ready ? ws : undefined);
  const cfg = useConfig(store?.id);
  const workspace = useConfig();
  const top = (useKbCategories(ws).data ?? []).filter((k) => k.parentId === null && k.storeId === (store?.id ?? null));
  // The agents on the demo engine (FRONTLINE_AGENT_ENGINE): self-directed research needs Claude, so it can't turn on.
  const forced = useClaudeAccount().q.data?.forced;
  const f = useSettingsForm<Form>({
    key: `knowledge:${ws}`,
    saved: q.data && cfg.data && { ...toForm(q.data), ...autoOf(cfg.data, store?.id) },
    labels: { ...Object.fromEntries(KB.map((s) => [s.id.slice(3), s.label])), autoSave: autoDef.label },
    // Two documents, two writes: Automatic saving first, then the controls. Each one saved leaves the draft at once.
    // ponytail: a controls 409 after Automatic saving saved lists it in the conflict too; one write when it matters.
    save: async (all, version, base) => {
      const { autoSave, ...changes } = all;
      let done = base;
      if ('autoSave' in all) {
        const v = await api<ConfigView>('/api/config', json('PATCH', { documents: [autoDoc(autoSave, base.configVersion, store?.id)] })).catch((e: ApiError) => {
          if (e.field === AUTO) e.field = 'autoSave';
          if (e.current) e.current = { ...base, ...autoOf(e.current as ConfigView, store?.id) };
          throw e;
        });
        qc.setQueryData(['config', 'view', store?.id ?? null], v);
        done = { ...done, ...autoOf(v, store?.id) };
      }
      if (!Object.keys(changes).length) return done;
      const c = await api<KbControlsState>(`/api/kb/controls?ws=${encodeURIComponent(ws)}`, json('PUT', { version, ...toBody(changes) })).catch((e: ApiError) => {
        e.field = e.field?.replace(/^kb\./, ''); // the row's own key
        if (e.current) e.current = { ...done, ...toForm(e.current as KbControlsState) };
        throw e;
      });
      qc.setQueryData(['kb', 'controls', ws], c);
      return { ...done, ...toForm(c) };
    },
    onSaved: () => void (qc.invalidateQueries({ queryKey: ['kb'] }), qc.invalidateQueries({ queryKey: ['config'] })),
  });
  // Lowering retention: what the next pass would trim, then a confirm (decision 13).
  const was = q.data?.retentionDays ?? null;
  const keep = f.draft?.retentionDays ?? null;
  const lowers = f.dirty.includes('retentionDays') && keep !== null && (was === null || keep < was);
  const trim = useQuery({ queryKey: ['kb', 'trim', ws, keep], queryFn: () => api<Trim>(`/api/kb/controls/trim?ws=${encodeURIComponent(ws)}&days=${keep}`), enabled: lowers });
  const [confirm, setConfirm] = useState(false);
  // The workspace's Automatic saving: how many stores follow it (decision 4).
  const documents = !store && f.draft && f.dirty.includes('autoSave') ? [autoDoc(f.draft.autoSave, f.draft.configVersion)] : [];
  const impact = useQuery({
    queryKey: ['config', 'impact', documents],
    queryFn: () => api<{ impacts: ConfigImpact[] }>('/api/config/impact', json('POST', { documents })),
    enabled: documents.length > 0,
  });
  const title = store ? "Agents' own research" : 'Research findings and sources';
  if (!scope.ready || q.isPending || cfg.isPending || workspace.isPending) return <SettingsSection title={title}><LoadingState rows={4} className="px-[18px] pb-4" /></SettingsSection>;
  if (q.isError || cfg.isError || workspace.isError) return <SettingsSection title={title}><ErrorState message="Couldn't load the research controls." onRetry={() => (q.refetch(), cfg.refetch(), workspace.refetch())} /></SettingsSection>;

  const d = f.draft!;
  // A store's own Automatic saving, or the workspace's it follows (Use workspace default goes back to it).
  const inherited = workspace.data.values[AUTO] !== false;
  const autoOrigin: Origin | undefined = !store ? undefined : d.autoSave === undefined ? { kind: 'workspace' } : { kind: 'store', workspace: inherited ? 'on' : 'off', same: d.autoSave === inherited, onUse: () => f.set('autoSave', undefined) };
  const saves = documents.length ? impact.data?.impacts.map((i) => `${autoDef.label}: ${i.text}`) : undefined;
  const row = (k: keyof KbControls) => ({ setting: `kb.${k}`, label: def(k).label, help: def(k).help, error: f.error(k), changed: f.dirty.includes(k) });
  const t = trim.data;
  const trims = lowers && t ? `The next hourly pass trims the text of ${count(t.pages, 'fetched page')}, ${count(t.logs, 'research log')}, ${count(t.outputs, 'step output')} and ${count(t.transcripts, 'run transcript')} older than ${keep} days. Sources, tasks and reports stay.` : undefined;
  const role = (r: AgentRole, cats: string[] | undefined) => f.set('roles', Object.fromEntries([...Object.entries(d.roles).filter(([x]) => x !== r), ...(cats ? [[r, cats]] : [])]));
  return (
    <>
      {store ? (
        <SettingsSection title="Agents' own research" help="Agents research gaps in what they know, within these budgets. Changes take effect at the next hourly pass.">
          <SettingRow {...row('autonomous')} origin={forced ? { kind: 'env', text: 'the agents are on the demo engine here, and self-directed research needs Claude' } : undefined}>
            <label data-setting="kb.autonomous" className="flex cursor-pointer items-center">
              <Switch aria-label={def('autonomous').label} checked={d.autonomous} disabled={forced} onChange={(e) => f.set('autonomous', e.target.checked)} />
            </label>
          </SettingRow>
          <SettingRow {...row('approval')}>
            <label data-setting="kb.approval" className="flex cursor-pointer items-center">
              <Switch aria-label={def('approval').label} checked={d.approval} onChange={(e) => f.set('approval', e.target.checked)} />
            </label>
          </SettingRow>
          <SettingRow {...row('triggers')}>
            <Group setting="kb.triggers" legend={def('triggers').label}>
              {TRIGGERS.map((x) => (
                <Check key={x} label={KB_TRIGGERS[x]} on={d.triggers.includes(x)} onChange={() => f.set('triggers', TRIGGERS.filter((y) => (y === x ? !d.triggers.includes(x) : d.triggers.includes(y))))} />
              ))}
            </Group>
          </SettingRow>
          <SettingRow {...row('roles')}>
            <Group setting="kb.roles" legend={def('roles').label}>
              {ROLES.map((r) => (
                <div key={r} className="grid gap-1">
                  <Check label={AGENT_ROLES[r].name} on={!!d.roles[r]} onChange={() => role(r, d.roles[r] ? undefined : [])} />
                  {d.roles[r] && (
                    <div className="grid gap-1 pl-5">
                      {top.map((k) => (
                        <Check key={k.id} label={k.name} on={d.roles[r]!.includes(k.id)} onChange={() => role(r, d.roles[r]!.includes(k.id) ? d.roles[r]!.filter((x) => x !== k.id) : [...d.roles[r]!, k.id])} />
                      ))}
                      {!d.roles[r]!.length && <p className="text-[11px] text-muted">No category ticked: its usual areas.</p>}
                    </div>
                  )}
                </div>
              ))}
            </Group>
          </SettingRow>
          {(['taskBudgetUsd', 'dailyBudgetUsd'] as const).map((k) => (
            <SettingRow key={k} {...row(k)} htmlFor={`kb-${k}`}>
              <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
                $
                <input id={`kb-${k}`} data-setting={`kb.${k}`} type="number" min={k === 'taskBudgetUsd' ? 0.25 : d.taskBudgetUsd} max={k === 'taskBudgetUsd' ? 5 : 50} step={0.25} value={d[k]} onChange={(e) => f.set(k, e.target.valueAsNumber)} className={cx(field, 'w-[110px]')} />
              </span>
            </SettingRow>
          ))}
          <SettingRow {...row('depth')} htmlFor="kb-depth">
            <select id="kb-depth" data-setting="kb.depth" value={d.depth} onChange={(e) => f.set('depth', e.target.value as KbResearchDepth)} className={field}>
              {(Object.entries(KB_RESEARCH_DEPTHS) as [KbResearchDepth, { label: string }][]).map(([x, { label }]) => (
                <option key={x} value={x}>
                  {label}
                </option>
              ))}
            </select>
          </SettingRow>
        </SettingsSection>
      ) : (
        <SettingsSection title="Agents' own research" help="It runs on a store's agents and AI budget: pick a store under Editing to turn it on." />
      )}
      <SettingsSection title="Research findings and sources" help="Review and sites apply to research that starts after you save; refresh ages and retention at the next hourly pass.">
        <SettingRow {...row('review')}>
          <label data-setting="kb.review" className="flex cursor-pointer items-center">
            <Switch aria-label={def('review').label} checked={d.review} onChange={(e) => f.set('review', e.target.checked)} />
          </label>
        </SettingRow>
        {(['trustedDomains', 'blockedDomains'] as const).map((k) => (
          <SettingRow key={k} {...row(k)} htmlFor={`kb-${k}`}>
            <textarea id={`kb-${k}`} data-setting={`kb.${k}`} rows={3} placeholder="example.com, one per line" value={d[k]} onChange={(e) => f.set(k, e.target.value)} className={cx(field, 'w-[260px] max-w-full')} />
          </SettingRow>
        ))}
        <SettingRow {...row('freshDays')}>
          {top.length ? (
            <Group setting="kb.freshDays" legend={def('freshDays').label}>
              {top.map((k) => (
                <label key={k.id} className="flex items-center justify-between gap-3 text-[13px] text-text-2">
                  {k.name}
                  <select
                    value={d.freshDays[k.id] ?? ''}
                    onChange={(e) => f.set('freshDays', Object.fromEntries([...Object.entries(d.freshDays).filter(([id]) => id !== k.id), ...(e.target.value ? [[k.id, Number(e.target.value)]] : [])]))}
                    className={cx(field, 'w-36 shrink-0')}
                  >
                    {/* With its own age in effect, the area's usual one isn't known here. */}
                    <option value="">{q.data.freshDays[k.id] ? 'Usual for its area' : `Usual (${k.freshDays} days)`}</option>
                    {[...new Set([...AGES, ...(d.freshDays[k.id] ? [d.freshDays[k.id]!] : [])])].sort((a, b) => a - b).map((n) => (
                      <option key={n} value={n}>{`${n} days`}</option>
                    ))}
                  </select>
                </label>
              ))}
            </Group>
          ) : (
            <span className="text-[13px] text-muted">No categories yet.</span>
          )}
        </SettingRow>
        <SettingRow {...row('retentionDays')} htmlFor="kb-retention">
          <select id="kb-retention" data-setting="kb.retentionDays" value={d.retentionDays ?? ''} onChange={(e) => f.set('retentionDays', e.target.value ? Number(e.target.value) : null)} className={field}>
            {KEEP.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </SettingRow>
      </SettingsSection>
      <SettingsSection title={store ? 'Automatic saving' : 'Automatic saving · default for all stores'} help={store ? undefined : 'For every store that uses the workspace default.'}>
        <SettingRow setting={AUTO} label={autoDef.label} help={autoDef.help} origin={autoOrigin} error={f.error('autoSave')} changed={f.dirty.includes('autoSave')}>
          <label data-setting={AUTO} className="flex cursor-pointer items-center">
            <Switch aria-label={autoDef.label} checked={d.autoSave ?? inherited} onChange={(e) => f.set('autoSave', e.target.checked)} />
          </label>
        </SettingRow>
        <p className="border-t border-line px-[18px] py-3 text-xs text-muted">
          Which knowledge new conversations read is set on{' '}
          <Link to={settingsUrl('agents', { store: store?.id, setting: 'agentDefaults.knowledge' })} className="text-[13px] text-[#ff6b76] hover:underline">
            Agents & Providers
          </Link>
          .
        </p>
      </SettingsSection>
      {store && (
        <SettingsSection title="Research on a schedule" help={`Each runs as Knowledge research on ${store.name}. KB controls decide approval: with "${def('approval').label}" on, each one waits for you.`}>
          <Schedules ws={store.id} />
        </SettingsSection>
      )}
      <SaveBar
        {...f.bar}
        onSave={() => (lowers ? setConfirm(true) : f.bar.onSave())}
        scope={store?.name ?? (f.dirty.every((k) => k === 'autoSave') ? 'Workspace defaults' : 'General knowledge')}
        impact={trims || saves?.length ? [...(saves ?? []), ...(trims ? [trims] : [])].map((x) => <span key={x} className="mt-0.5 block text-xs">{x}</span>) : undefined}
      />
      <Dialog open={confirm} onClose={() => setConfirm(false)} title="Keep less research data?">
        <p className="text-sm text-text-2">{trims ?? 'Counting what the next pass trims…'}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={() => setConfirm(false)} className={flatButtonClass('ghost')}>
            Cancel
          </button>
          <button type="button" disabled={!trims} onClick={() => (setConfirm(false), f.bar.onSave())} className={flatButtonClass('primary')}>
            Keep {keep} days
          </button>
        </div>
      </Dialog>
      {f.dialogs}
    </>
  );
}

/** A store's research automations: a topic, its researcher and how often. They save at once, outside the form. */
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
  const small = flatButtonClass('default', 'sm');
  return (
    <div data-action="kb.schedule" className="grid gap-3 border-t border-line px-[18px] py-3 text-[13px]">
      {rules.length ? (
        <ul aria-label="Scheduled research" className="grid gap-1.5">
          {rules.map((r) => (
            <li key={r.id} className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 text-text-2">{`${r.trigger.type === 'schedule' ? (EVERY[r.trigger.cron] ?? r.trigger.cron) : 'On a metric'}: ${r.action.task} · ${AGENT_ROLES[r.action.agentId.split(':')[1] as AgentRole]?.name ?? r.action.agentId}`}</span>
              <button type="button" disabled={act.remove.isPending} onClick={() => act.remove.mutate(r.id)} className={small}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">No research on a schedule.</p>
      )}
      <fieldset aria-label="Add a schedule" className="grid gap-2 min-[700px]:grid-cols-[1fr_auto_auto_auto] min-[700px]:items-end">
        <label className="grid gap-1 text-xs text-muted">
          Topic
          <input value={topic} maxLength={500} onChange={(e) => setTopic(e.target.value)} className={field} />
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Researcher
          <select value={role} onChange={(e) => setRole(e.target.value as AgentRole)} className={field}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {AGENT_ROLES[r].name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-muted">
          How often
          <select value={cron} onChange={(e) => setCron(e.target.value)} className={field}>
            {Object.entries(EVERY).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={topic.trim().length < 3 || act.save.isPending} onClick={add} className={small}>
          Add
        </button>
      </fieldset>
      {act.save.error && (
        <p role="alert" className="text-xs text-red">
          {act.save.error.message}
        </p>
      )}
    </div>
  );
}

const Group = ({ setting, legend, children }: { setting: string; legend: string; children: ReactNode }) => (
  <fieldset data-setting={setting} aria-label={legend} className="grid gap-1.5">
    {children}
  </fieldset>
);
const Check = ({ label, on, onChange }: { label: string; on: boolean; onChange: () => void }) => (
  <label className="flex cursor-pointer items-center gap-2 text-[13px] text-text-2">
    <input type="checkbox" checked={on} onChange={onChange} className="accent-red" />
    {label}
  </label>
);
