// Automation & Approvals (ST-29, decision 14): pause new automation (the workspace's `automation.paused`, one explicit
// save through PATCH /api/config with its impact) and cancel the runs automations started, a separate action with its
// own confirm. The server reads the pause at each start the app makes by itself (config/automation.ts RUN_STARTS).
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SETTINGS, type AutomationCancelled, type AutomationStatus, type ConfigImpact, type ConfigView } from '@frontline/shared';
import { api, json, useConfig, type ApiError } from '../../api/client';
import { Dialog, ErrorState, flatButtonClass, LoadingState, Switch } from '../../components/ui';
import { ago } from '../../lib/format';
import { useSettingsForm } from '../form';
import { SaveBar, SettingRow, SettingsSection } from '../kit';

/** The pause and the automation runs going; `poll` while the list is on screen. */
export const useAutomationStatus = (poll = false) =>
  useQuery({ queryKey: ['config', 'automation'], queryFn: () => api<AutomationStatus>('/api/config/automation'), refetchInterval: poll ? 10_000 : false });

type Form = { version: number; paused: boolean };
const toForm = (v: ConfigView): Form => ({ version: v.versions.workspace ?? 0, paused: v.values['automation.paused'] === true });
const documentsOf = (changes: Partial<Form>, base: Form) => (changes.paused === undefined ? [] : [{ doc: 'workspace', version: base.version, set: { 'automation.paused': changes.paused } }]);
const PAUSED = SETTINGS.find((s) => s.id === 'automation.paused')!;

export function AutomationApprovals() {
  const q = useConfig();
  const qc = useQueryClient();
  const status = useAutomationStatus(true);
  const [confirm, setConfirm] = useState(false);
  const f = useSettingsForm<Form>({
    key: 'automation',
    saved: q.data && toForm(q.data),
    labels: { paused: PAUSED.label },
    save: (changes, _version, base) =>
      api<ConfigView>('/api/config', json('PATCH', { documents: documentsOf(changes, base) })).then(
        (v) => (qc.setQueryData(['config', 'view', null], v), toForm(v)),
        (e: ApiError) => {
          if (e.current) e.current = toForm(e.current as ConfigView);
          throw e;
        },
      ),
    onSaved: () => void qc.invalidateQueries({ queryKey: ['config'] }),
  });
  const documents = q.data && f.dirty.length ? documentsOf(f.changes(), toForm(q.data)) : [];
  const impact = useQuery({
    queryKey: ['config', 'impact', documents],
    queryFn: () => api<{ impacts: ConfigImpact[] }>('/api/config/impact', json('POST', { documents })),
    enabled: documents.length > 0,
  });
  const title = 'New automation';
  if (q.isPending) return <SettingsSection title={title}><LoadingState rows={2} className="px-[18px] pb-4" /></SettingsSection>;
  if (q.isError) return <SettingsSection title={title}><ErrorState message="Couldn't load your settings." onRetry={() => q.refetch()} /></SettingsSection>;
  const d = f.draft!;
  const s = status.data;
  const running = s?.running ?? [];
  const texts = documents.length ? (impact.data?.impacts.map((i) => i.text) ?? []) : [];
  return (
    <>
      <SettingsSection title={title}>
        <SettingRow
          setting="automation.paused"
          label={PAUSED.label}
          help={
            <>
              {PAUSED.help}
              {s?.paused && s.pausedAt && <span className="mt-0.5 block text-[#f5b754]">{`Paused ${ago(s.pausedAt)}.`}</span>}
            </>
          }
          error={f.error('paused')}
          changed={f.dirty.includes('paused')}
        >
          <label data-setting="automation.paused" className="flex cursor-pointer items-center">
            <Switch aria-label={PAUSED.label} checked={d.paused} onChange={(e) => f.set('paused', e.target.checked)} />
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
      <SaveBar {...f.bar} scope="Workspace" impact={texts.length ? texts.map((t) => <span key={t} className="mt-0.5 block text-xs">{t}</span>) : undefined} />
      {f.dialogs}
      {confirm && <CancelDialog runIds={running.map((r) => r.runId)} onClose={() => setConfirm(false)} />}
    </>
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
