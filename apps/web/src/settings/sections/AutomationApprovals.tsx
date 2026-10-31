// Automation & Approvals (ST-29, ST-30, decision 14): pause new automation (the workspace's `automation.paused`) and, in a
// store's scope, its autopilot rules (`autopilot.*`, the store_caps document), in one explicit save through PATCH
// /api/config with its impact; cancel the runs automations started (its own confirm); every schedule with its next run;
// and the approval map (APPROVAL_MAP), which says who decides each kind of action. The server reads the pause at each
// start the app makes by itself (config/automation.ts RUN_STARTS) and autopilot in requestApproval.
import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { APPROVAL_KINDS, APPROVAL_MAP, SETTINGS, settingsUrl, type AutomationCancelled, type AutomationRule, type AutomationStatus, type ConfigImpact, type ConfigView } from '@frontline/shared';
import { api, json, useAutomations, useConfig, type ApiError } from '../../api/client';
import { cx, Dialog, ErrorState, flatButtonClass, inputClass, LoadingState, Switch } from '../../components/ui';
import { describeTrigger, when } from '../../lib/automation';
import { ago } from '../../lib/format';
import { useSettingsForm } from '../form';
import { SaveBar, SettingRow, SettingsSection, useScope } from '../kit';

/** The pause and the automation runs going; `poll` while the list is on screen. */
export const useAutomationStatus = (poll = false) =>
  useQuery({ queryKey: ['config', 'automation'], queryFn: () => api<AutomationStatus>('/api/config/automation'), refetchInterval: poll ? 10_000 : false });

const PAUSED = 'automation.paused';
const def = (id: string) => SETTINGS.find((s) => s.id === id)!;
/** Autopilot's eligible kinds: one registry entry each. A rule stored for any other kind is never shown (or used). */
const AUTOPILOT = SETTINGS.filter((s) => s.id.startsWith('autopilot.')).map((s) => s.id as `autopilot.${string}`);
type Rule = { enabled: boolean; maxUsdPerDay: number } | null;
type Form = { version: number; caps: number; [PAUSED]: boolean } & { [k: `autopilot.${string}`]: Rule };
const toForm = (v: ConfigView, store?: string): Form => ({
  version: v.versions.workspace ?? 0,
  caps: (store && v.versions[`store_caps:${store}`]) || 0,
  [PAUSED]: v.values[PAUSED] === true,
  ...(store ? Object.fromEntries(AUTOPILOT.map((id) => [id, (v.values[id] as Rule) ?? null])) : {}),
});
/** The pause in the workspace document, the rules in the store's, each over its version. */
function documentsOf(changes: Partial<Form>, base: Form, store?: string) {
  const rules = Object.fromEntries(Object.entries(changes).filter(([k]) => k.startsWith('autopilot.')));
  return [
    ...(changes[PAUSED] !== undefined ? [{ doc: 'workspace', version: base.version, set: { [PAUSED]: changes[PAUSED] } }] : []),
    ...(store && Object.keys(rules).length ? [{ doc: 'store_caps', storeId: store, version: base.caps, set: rules }] : []),
  ];
}
const link = 'text-[#ff6b76] hover:underline';

export function AutomationApprovals() {
  const scope = useScope();
  const store = scope.store;
  const sid = store?.id;
  const q = useConfig(sid);
  const qc = useQueryClient();
  const status = useAutomationStatus(true);
  const [confirm, setConfirm] = useState(false);
  const f = useSettingsForm<Form>({
    key: `automation:${sid ?? 'workspace'}`,
    saved: q.data && toForm(q.data, sid),
    labels: { [PAUSED]: def(PAUSED).label, ...Object.fromEntries(AUTOPILOT.map((id) => [id, `Autopilot: ${def(id).label}`])) },
    save: (changes, _version, base) =>
      api<ConfigView>('/api/config', json('PATCH', { documents: documentsOf(changes, base, sid) })).then(
        (v) => (qc.setQueryData(['config', 'view', sid ?? null], v), { ...toForm(v, sid), changes: v.changes }),
        (e: ApiError) => {
          if (e.current) e.current = toForm(e.current as ConfigView, sid);
          throw e;
        },
      ),
    onSaved: () => void (qc.invalidateQueries({ queryKey: ['config'] }), qc.invalidateQueries({ queryKey: ['caps'] })),
  });
  const documents = q.data && f.dirty.length ? documentsOf(f.changes(), toForm(q.data, sid), sid) : [];
  const impact = useQuery({
    queryKey: ['config', 'impact', documents],
    queryFn: () => api<{ impacts: ConfigImpact[] }>('/api/config/impact', json('POST', { documents })),
    enabled: documents.length > 0,
  });
  const title = 'New automation';
  if (!scope.ready || q.isPending) return <SettingsSection title={title}><LoadingState rows={2} className="px-[18px] pb-4" /></SettingsSection>;
  if (q.isError) return <SettingsSection title={title}><ErrorState message="Couldn't load your settings." onRetry={() => q.refetch()} /></SettingsSection>;
  const d = f.draft!;
  const s = status.data;
  const running = s?.running ?? [];
  const texts = documents.length ? (impact.data?.impacts.map((i) => i.text) ?? []) : [];
  const zone = typeof q.data.values.timezone === 'string' ? q.data.values.timezone : undefined;
  return (
    <>
      <SettingsSection title={title}>
        <SettingRow
          setting={PAUSED}
          label={def(PAUSED).label}
          help={
            <>
              {def(PAUSED).help}
              {s?.paused && s.pausedAt && <span className="mt-0.5 block text-[#f5b754]">{`Paused ${ago(s.pausedAt)}.`}</span>}
            </>
          }
          error={f.error(PAUSED)}
          changed={f.dirty.includes(PAUSED)}
        >
          <label data-setting={PAUSED} className="flex cursor-pointer items-center">
            <Switch aria-label={def(PAUSED).label} checked={d[PAUSED]} onChange={(e) => f.set(PAUSED, e.target.checked)} />
          </label>
        </SettingRow>
      </SettingsSection>
      <SettingsSection
        title="Automation runs going"
        help="Runs that schedules and metric rules started. Pausing doesn't stop them; cancelling does, and what one already changed stays."
        aside={
          <button type="button" data-action="automation.cancel" onClick={() => setConfirm(true)} disabled={!running.length} className={flatButtonClass('ghost')}>
            Cancel running…
          </button>
        }
      >
        {status.isError ? (
          <ErrorState message="Couldn't load the automation runs." onRetry={() => status.refetch()} />
        ) : !s ? (
          <LoadingState rows={1} className="px-[18px] pb-4" />
        ) : running.length ? (
          <ul className="border-t border-line text-[13px]">
            {running.map((r) => (
              <li key={r.runId} className="flex flex-wrap items-baseline gap-x-2 border-b border-line px-[18px] py-2 last:border-b-0">
                <span className="font-medium">{r.ruleName}</span>
                <span className="text-muted">{`${r.storeName} · ${r.status === 'queued' ? 'waiting to start' : 'running'} · started ${ago(r.startedAt)}`}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="border-t border-line px-[18px] py-3 text-[13px] text-muted">None going now.</p>
        )}
      </SettingsSection>
      <Schedules store={sid} zone={zone} />
      <SettingsSection
        title={store ? `${store.name} autopilot` : 'Autopilot'}
        help="An agent set to Autopilot on its page approves its own ad changes within these daily amounts; everything else asks you. Off asks you first."
      >
        {store ? (
          AUTOPILOT.map((id) => {
            const r = d[id] ?? null;
            const label = def(id).label;
            return (
              <SettingRow key={id} setting={id} label={label} help={def(id).help} error={f.error(id)} changed={f.dirty.includes(id)}>
                <span data-setting={id} className="flex items-center gap-3">
                  <label className="flex cursor-pointer items-center">
                    <Switch aria-label={label} checked={!!r?.enabled} onChange={(e) => f.set(id, { enabled: e.target.checked, maxUsdPerDay: r?.maxUsdPerDay || (e.target.checked ? 50 : 0) })} />
                  </label>
                  <label className={cx('flex items-center gap-1.5 text-[13px] text-muted', !r?.enabled && 'opacity-50')}>
                    up to $
                    <input
                      type="number"
                      min={0}
                      max={1_000_000}
                      step="any"
                      value={r?.enabled && Number.isFinite(r.maxUsdPerDay) ? r.maxUsdPerDay : ''}
                      disabled={!r?.enabled}
                      onChange={(e) => f.set(id, { enabled: true, maxUsdPerDay: e.target.valueAsNumber })}
                      aria-label={`${label}: most per day in dollars`}
                      className={cx(inputClass, 'w-24 py-1.5')}
                    />
                    / day
                  </label>
                </span>
              </SettingRow>
            );
          })
        ) : (
          <p className="border-t border-line px-[18px] py-3 text-[13px] text-muted">
            {scope.stores.length ? (
              <>
                Autopilot is set per store:{' '}
                {scope.stores.map((st, i) => (
                  <span key={st.id}>
                    {i > 0 && ' · '}
                    <Link to={settingsUrl('automation', { store: st.id })} className={link}>
                      {st.name}
                    </Link>
                  </span>
                ))}
              </>
            ) : (
              'Autopilot is set per store: add a store first, then set its rules here.'
            )}
          </p>
        )}
      </SettingsSection>
      <ApprovalMap />
      <SaveBar {...f.bar} scope={store ? `Workspace and ${store.name}` : 'Workspace'} impact={texts.length ? texts.map((t) => <span key={t} className="mt-0.5 block text-xs">{t}</span>) : undefined} />
      {f.dialogs}
      {confirm && <CancelDialog runIds={running.map((r) => r.runId)} onClose={() => setConfirm(false)} />}
    </>
  );
}

const APPROVAL = { ask: 'Ask me first', auto: 'Run on its own' };

/** Every rule (the store's in its scope), when it runs next in the workspace zone, and a link to its editor. */
function Schedules({ store, zone }: { store?: string; zone?: string }) {
  const q = useAutomations();
  const { stores } = useScope();
  const rules = (q.data ?? []).filter((r) => !store || r.storeId === store);
  const next = (r: AutomationRule) =>
    !r.enabled ? 'Off' : r.trigger.type !== 'schedule' ? 'When the number moves' : r.nextRunAt ? `Next ${when(r.nextRunAt)}` : `More than 8 days away · ${describeTrigger(r.trigger)}`;
  return (
    <SettingsSection
      title="Schedules"
      help={
        <>
          Rules are made and edited on the{' '}
          <Link to="/automation" className={link}>
            Automation page
          </Link>
          . Schedules run on the workspace clock{zone ? ` (${zone})` : ''}, set in{' '}
          <Link to={settingsUrl('general', { setting: 'timezone' })} className={link}>
            General
          </Link>
          ; times here are this computer&apos;s.
        </>
      }
    >
      {q.isError ? (
        <ErrorState message="Couldn't load the rules." onRetry={() => q.refetch()} />
      ) : q.isPending ? (
        <LoadingState rows={2} className="px-[18px] pb-4" />
      ) : rules.length ? (
        <ul aria-label="Schedules" className="border-t border-line text-[13px]">
          {rules.map((r) => (
            <li key={r.id} className="grid gap-0.5 border-b border-line px-[18px] py-2 last:border-b-0">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{r.name}</span>
                <span className="text-muted">{`${stores.find((s) => s.id === r.storeId)?.name ?? r.storeId} · ${r.enabled ? 'On' : 'Off'}`}</span>
                <Link to={`/automation?rule=${encodeURIComponent(r.id)}`} className={cx(link, 'ml-auto text-xs')}>
                  Edit
                </Link>
              </div>
              <span className="text-text-2">{`${describeTrigger(r.trigger)}${r.trigger.type === 'schedule' && zone ? ` in ${zone}` : ''}`}</span>
              <span className="text-xs text-muted">{`${next(r)} · ${r.action.type === 'kb_research' ? 'KB controls decide approval' : APPROVAL[r.approval]}`}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-t border-line px-[18px] py-3 text-[13px] text-muted">No rules yet.</p>
      )}
    </SettingsSection>
  );
}

/** Decision 14's table: who decides each kind of action, and where that is changed. */
function ApprovalMap() {
  return (
    <SettingsSection title="Approval rules" help="Who decides each kind of action an agent can take, and where it's changed.">
      <SettingRow setting="policy.approvals" label={def('policy.approvals').label} help={def('policy.approvals').help} origin={{ kind: 'policy', text: 'always asks you first, except ad changes you put on autopilot' }} />
      <dl className="border-t border-line text-[13px]">
        {APPROVAL_MAP.map((r) => (
          <div key={r.category} className="grid gap-0.5 border-b border-line px-[18px] py-2.5 last:border-b-0 min-[700px]:grid-cols-[180px_minmax(0,1fr)] min-[700px]:gap-x-4">
            <dt className="font-medium">{r.category}</dt>
            <dd className="grid gap-0.5 text-text-2">
              <span>{r.does}</span>
              {r.decides && <span>{r.decides}</span>}
              {(r.kinds.length > 0 || r.tools.length > 0) && (
                <span className="text-xs text-muted">
                  {[r.kinds.length ? `Requests: ${r.kinds.map((k) => APPROVAL_KINDS[k]?.label ?? k).join(', ')}` : '', r.tools.length ? `Tools: ${r.tools.join(', ')}` : ''].filter(Boolean).join(' · ')}
                </span>
              )}
              {r.where.to && (
                <Link to={r.where.to} className={cx(link, 'w-fit text-xs')}>
                  {r.where.label}
                </Link>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <ul className="grid gap-1 border-t border-line px-[18px] py-3 text-xs text-muted">
        <li>
          <b className="text-text-2">Autonomy:</b> each agent suggests, asks, or is on Autopilot; set on its page in{' '}
          <Link to="/agents" className={link}>
            AI Agents
          </Link>
          .
        </li>
        <li>
          <b className="text-text-2">Automation approval:</b> a rule asks you before it starts its run, or runs on its own; either way the run still asks for the actions above. Set per rule on the{' '}
          <Link to="/automation" className={link}>
            Automation page
          </Link>
          .
        </li>
        <li>
          <b className="text-text-2">Knowledge approval and review:</b> whether self-directed research asks first, and what reaches the knowledge base; in{' '}
          <Link to={settingsUrl('knowledge')} className={link}>
            Knowledge
          </Link>
          .
        </li>
        <li>
          <b className="text-text-2">Saving findings:</b> each agent's Deploy settings choose whether its findings save on their own or ask you; in{' '}
          <Link to="/agents" className={link}>
            AI Agents
          </Link>
          , with the default in{' '}
          <Link to={settingsUrl('knowledge', { setting: 'knowledge.autoSave' })} className={link}>
            Knowledge
          </Link>
          .
        </li>
      </ul>
    </SettingsSection>
  );
}

/** The confirm, then each run's real outcome. */
function CancelDialog({ runIds, onClose }: { runIds: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => api<{ outcomes: AutomationCancelled[] }>('/api/config/automation/cancel-running', json('POST', { runIds })),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['config', 'automation'] }),
  });
  const n = runIds.length;
  return (
    <Dialog open onClose={onClose} title={m.data ? 'Automation runs cancelled' : `Cancel ${n} automation run${n === 1 ? '' : 's'}?`} width={560}>
      {m.data ? (
        <ul className="grid gap-2 text-[13px]">
          {m.data.outcomes.map((o) => (
            <li key={o.runId}>
              <div>
                <span className="font-medium">{o.ruleName}</span> <span className="text-muted">{`· ${o.storeName}`}</span>
              </div>
              <div className="text-text-2">{o.outcome}</div>
              {o.approvals.length > 0 && (
                <ul className="mt-0.5 ml-4 list-disc text-xs text-muted">
                  {o.approvals.map((a) => (
                    <li key={a.id}>{`${a.title}: ${a.status === 'pending' ? 'waiting in Requests' : a.status}`}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-text-2">
          Each one stops at its next step. Requests it made that Frontline carries out stay in Requests for you to decide; nothing it already changed is undone.
        </p>
      )}
      {m.error && (
        <p role="alert" className="mt-2 text-xs text-[#ff6b76]">
          {m.error.message}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        {m.data ? (
          <button type="button" onClick={onClose} className={flatButtonClass('primary')}>
            Done
          </button>
        ) : (
          <>
            <button type="button" onClick={onClose} className={flatButtonClass('ghost')}>
              Keep them
            </button>
            <button type="button" onClick={() => m.mutate()} disabled={m.isPending} className={flatButtonClass('primary')}>
              {m.isPending ? 'Cancelling…' : `Cancel ${n} run${n === 1 ? '' : 's'}`}
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}
