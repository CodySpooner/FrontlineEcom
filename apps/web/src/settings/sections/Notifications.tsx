// Notifications (ST-14b, decision 12): what reaches the bell, which also come as Windows toasts, quiet hours, the stores
// to hear about, and Send test. One explicit save through PATCH /api/config (the `app` row).
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { NOTIFICATION_CATEGORIES, type ConfigView, type NotificationCategory } from '@frontline/shared';
import { api, json, useConfig, useStores, type ApiError } from '../../api/client';
import { cx, ErrorState, flatButtonClass, inputClass, LoadingState, Switch } from '../../components/ui';
import { useSettingsForm } from '../form';
import { SaveBar, SettingRow, SettingsSection } from '../kit';

const CATEGORIES = Object.keys(NOTIFICATION_CATEGORIES) as NotificationCategory[];
const OFF = "Off: not kept; turning it back on doesn't bring them back.";
/** What each category covers: every notify() caller of its kind (decision 12). */
const HELP: Record<NotificationCategory, string> = {
  approvals: 'An agent needs your yes or no.',
  agentDone: "An agent's task, Knowledge research, a mission or a team finished.",
  errors: "An agent run, research, a mission or a team failed or got stuck; a store stopped syncing; the daily backup failed; or an approved live change didn't go through.",
  researchAlerts: 'A watched product, niche or offer changed; the Watchlist shows them either way.',
  digest: "Yesterday's numbers and the approvals waiting, once a day around the digest time below.",
  usageAlerts: "A store's AI spend or generation credits today reached the share of its daily cap set below. Once per store, cap and day.",
};
const IDS = [...CATEGORIES.flatMap((c) => [`notifications.${c}`, `notifications.toasts.${c}`]), 'notifications.quietHours', 'notifications.mutedStores', 'notifications.digestHour', 'notifications.usageAlertPct'];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

type Form = { version: number } & Record<string, unknown>;
type Quiet = { from: number; to: number } | null;
const toForm = (v: ConfigView): Form => ({ version: v.versions.app ?? 0, ...Object.fromEntries(IDS.map((id) => [id, v.values[id]])) });

export function Notifications() {
  const q = useConfig();
  const stores = useStores().data ?? [];
  const qc = useQueryClient();
  const f = useSettingsForm<Form>({
    key: 'notifications',
    saved: q.data && toForm(q.data),
    labels: {
      ...Object.fromEntries(CATEGORIES.flatMap((c) => [[`notifications.${c}`, NOTIFICATION_CATEGORIES[c]], [`notifications.toasts.${c}`, `${NOTIFICATION_CATEGORIES[c]}: Windows toast`]])),
      'notifications.digestHour': 'Digest time',
      'notifications.usageAlertPct': 'Usage alert at',
    },
    save: (changes, version) =>
      api<ConfigView>('/api/config', json('PATCH', { documents: [{ doc: 'app', version, set: changes }] })).then(
        (v) => (qc.setQueryData(['config', 'view', null], v), { ...toForm(v), changes: v.changes }),
        (e: ApiError) => {
          if (e.current) e.current = toForm(e.current as ConfigView); // the conflict dialog compares the form's fields
          throw e;
        },
      ),
    onSaved: () => void qc.invalidateQueries({ queryKey: ['config', 'view'] }),
  });
  if (q.isPending) return <SettingsSection title="What you hear about"><LoadingState rows={4} className="px-[18px] pb-4" /></SettingsSection>;
  if (q.isError) return <SettingsSection title="What you hear about"><ErrorState message="Couldn't load your settings." onRetry={() => q.refetch()} /></SettingsSection>;
  const d = f.draft!;
  const quiet = d['notifications.quietHours'] as Quiet;
  const muted = (d['notifications.mutedStores'] as string[]) ?? [];
  const row = (id: string) => ({ setting: id, error: f.error(id), changed: f.dirty.includes(id) });
  return (
    <>
      <SettingsSection title="What you hear about" help="Each lands in the bell, and as a Windows toast when Frontline isn't the focused window. Info (a store going live, a connection back, a change not applied) always shows.">
        {CATEGORIES.map((c) => {
          const on = d[`notifications.${c}`] !== false;
          return (
            <SettingRow key={c} {...row(`notifications.${c}`)} label={NOTIFICATION_CATEGORIES[c]} help={`${HELP[c]} ${OFF}`}>
              <label data-setting={`notifications.${c}`} className="flex items-center gap-2 text-xs text-text-2">
                Bell
                <Switch aria-label={NOTIFICATION_CATEGORIES[c]} checked={on} onChange={(e) => f.set(`notifications.${c}`, e.target.checked)} />
              </label>
              <label data-setting={`notifications.toasts.${c}`} className={cx('flex items-center gap-2 text-xs', on ? 'text-text-2' : 'text-muted')}>
                Windows toast
                <Switch aria-label={`${NOTIFICATION_CATEGORIES[c]}: Windows toast`} checked={on && d[`notifications.toasts.${c}`] !== false} disabled={!on} onChange={(e) => f.set(`notifications.toasts.${c}`, e.target.checked)} />
              </label>
            </SettingRow>
          );
        })}
      </SettingsSection>
      <SettingsSection title="When and where">
        <SettingRow {...row('notifications.digestHour')} label="Digest time" htmlFor="digest-hour" help="Around this hour in the workspace timezone: the check runs every 10 minutes, or the first check after it if Frontline was closed.">
          <select id="digest-hour" data-setting="notifications.digestHour" value={d['notifications.digestHour'] as number} onChange={(e) => f.set('notifications.digestHour', Number(e.target.value))} className={cx(inputClass, 'py-1.5')}>
            {HOURS.map((h) => <option key={h} value={h}>{hh(h)}</option>)}
          </select>
        </SettingRow>
        <SettingRow {...row('notifications.usageAlertPct')} label="Usage alert at" htmlFor="usage-alert-pct" help="The share of a store's daily AI budget or credit cap that sends a usage alert, from 50 to 100%.">
          <span data-setting="notifications.usageAlertPct" className="flex items-center gap-1.5 text-xs text-text-2">
            <input id="usage-alert-pct" type="number" min={50} max={100} value={d['notifications.usageAlertPct'] as number} onChange={(e) => f.set('notifications.usageAlertPct', e.target.valueAsNumber)} className={cx(inputClass, 'w-20 py-1.5')} />
            %
          </span>
        </SettingRow>
        <SettingRow {...row('notifications.quietHours')} label="Quiet hours" help="No Windows toasts between these hours, in the workspace timezone. They're not sent, not held; the bell still gets everything.">
          <div data-setting="notifications.quietHours" className="flex flex-wrap items-center gap-2 text-xs text-text-2">
            {quiet && (
              <>
                <select aria-label="Quiet from" value={quiet.from} onChange={(e) => f.set('notifications.quietHours', { ...quiet, from: Number(e.target.value) })} className={cx(inputClass, 'py-1.5')}>
                  {HOURS.map((h) => <option key={h} value={h}>{hh(h)}</option>)}
                </select>
                to
                <select aria-label="Quiet until" value={quiet.to} onChange={(e) => f.set('notifications.quietHours', { ...quiet, to: Number(e.target.value) })} className={cx(inputClass, 'py-1.5')}>
                  {HOURS.map((h) => <option key={h} value={h}>{hh(h)}</option>)}
                </select>
              </>
            )}
            <label className="flex items-center">
              <Switch aria-label="Quiet hours" checked={!!quiet} onChange={(e) => f.set('notifications.quietHours', e.target.checked ? { from: 22, to: 7 } : null)} />
            </label>
          </div>
        </SettingRow>
        <SettingRow {...row('notifications.mutedStores')} label="Stores to notify me about" help={`An unticked store's notifications are dropped, info aside. ${OFF}`}>
          <div data-setting="notifications.mutedStores" className="flex flex-wrap gap-x-4 gap-y-1.5 text-[13px]">
            {!stores.length && <span className="text-xs text-muted">No stores yet.</span>}
            {stores.map((s) => (
              <label key={s.id} className="flex items-center gap-1.5">
                <input type="checkbox" checked={!muted.includes(s.id)} onChange={(e) => f.set('notifications.mutedStores', e.target.checked ? muted.filter((id) => id !== s.id) : [...muted, s.id])} className="accent-red" />
                {s.name}
              </label>
            ))}
          </div>
        </SettingRow>
      </SettingsSection>
      <SendTest />
      <SaveBar {...f.bar} scope="Your notifications" />
      {f.dialogs}
    </>
  );
}

/** POST /api/notifications/test: one info notification through the saved toast rules, and what the server decided. */
function SendTest() {
  const [category, setCategory] = useState<NotificationCategory>('approvals');
  const qc = useQueryClient();
  const send = useMutation({
    mutationFn: (c: NotificationCategory) => api<{ bell: string; toast: string }>('/api/notifications/test', json('POST', { category: c })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  return (
    <SettingsSection title="Send a test" help="One test notification in the bell, under the saved toast and quiet-hours rules of the category you pick.">
      <div data-action="notifications.test" className="flex flex-wrap items-center gap-2 border-t border-line px-[18px] py-3">
        <select aria-label="Test category" value={category} onChange={(e) => setCategory(e.target.value as NotificationCategory)} className={cx(inputClass, 'py-1.5')}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{NOTIFICATION_CATEGORIES[c]}</option>)}
        </select>
        <button type="button" onClick={() => send.mutate(category)} disabled={send.isPending} className={flatButtonClass()}>
          {send.isPending ? 'Sending…' : 'Send test'}
        </button>
        {send.data && (
          <p role="status" className="basis-full text-xs text-text-2">
            {send.data.bell} · {send.data.toast}
            {!window.desktop && <span className="block text-muted">Windows toasts only appear in the installed desktop app.</span>}
          </p>
        )}
        {send.isError && (
          <p role="alert" className="basis-full text-xs text-red">
            {send.error.message}
          </p>
        )}
      </div>
    </SettingsSection>
  );
}
