// General (ST-16, decisions 8 and 13): the display currency for totals across stores, and the workspace timezone every
// schedule and daily cap runs on. One explicit save through PATCH /api/config: the `app` row and the `workspace` row.
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConfigImpact, ConfigView } from '@frontline/shared';
import { api, json, useConfig, type ApiError } from '../../api/client';
import { cx, ErrorState, inputClass, LoadingState } from '../../components/ui';
import { useSettingsForm } from '../form';
import { SaveBar, SettingRow, SettingsSection } from '../kit';

type Form = { version: number; workspace: number; baseCurrency: string; timezone: string };
const toForm = (v: ConfigView): Form => ({ version: v.versions.app ?? 0, workspace: v.versions.workspace ?? 0, baseCurrency: String(v.values.baseCurrency ?? ''), timezone: String(v.values.timezone ?? '') });
/** Each changed setting in its own document, over the version read. */
const documentsOf = (changes: Partial<Form>, base: Form) => [
  ...(changes.baseCurrency !== undefined ? [{ doc: 'app', version: base.version, set: { baseCurrency: changes.baseCurrency } }] : []),
  ...(changes.timezone !== undefined ? [{ doc: 'workspace', version: base.workspace, set: { timezone: changes.timezone } }] : []),
];
const ZONES = Intl.supportedValuesOf('timeZone');
/** Views that show totals in the display currency: every `fxFor` caller's, and Product Research's All-stores facts. */
const CONVERTED = ['summary', 'campaigns', 'top-products', 'pr', 'usage'];

export function General() {
  const q = useConfig();
  const qc = useQueryClient();
  const codes = useQuery({ queryKey: ['config', 'currencies'], queryFn: () => api<string[]>('/api/config/currencies') });
  const converted = () => CONVERTED.forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));
  const f = useSettingsForm<Form>({
    key: 'general',
    saved: q.data && toForm(q.data),
    labels: { baseCurrency: 'Display currency', timezone: 'Workspace timezone' },
    save: (changes, _version, base) =>
      api<ConfigView>('/api/config', json('PATCH', { documents: documentsOf(changes, base) })).then(
        (v) => (qc.setQueryData(['config', 'view', null], v), { ...toForm(v), changes: v.changes }),
        (e: ApiError) => {
          if (e.current) e.current = toForm(e.current as ConfigView); // the conflict dialog compares the form's fields
          throw e;
        },
      ),
    onSaved: () => (void qc.invalidateQueries({ queryKey: ['config'] }), converted()),
  });
  // The re-rank finished: Product Research's All-stores cards are in the new currency now.
  const applied = f.bar.state === 'applied';
  useEffect(() => {
    if (applied) converted();
  }, [applied]); // eslint-disable-line react-hooks/exhaustive-deps -- once, when the job says applied
  const documents = q.data && f.dirty.length ? documentsOf(f.changes(), toForm(q.data)) : [];
  const impact = useQuery({
    queryKey: ['config', 'impact', documents],
    queryFn: () => api<{ impacts: ConfigImpact[] }>('/api/config/impact', json('POST', { documents })),
    enabled: documents.length > 0,
  });
  if (q.isPending) return <SettingsSection title="Workspace"><LoadingState rows={2} className="px-[18px] pb-4" /></SettingsSection>;
  if (q.isError) return <SettingsSection title="Workspace"><ErrorState message="Couldn't load your settings." onRetry={() => q.refetch()} /></SettingsSection>;
  const d = f.draft!;
  const listed = (all: readonly string[], v: string) => (all.includes(v) || !v ? all : [v, ...all]);
  const texts = documents.length ? (impact.data?.impacts.map((i) => i.text) ?? []) : [];
  return (
    <>
      <SettingsSection title="Workspace">
        <SettingRow setting="baseCurrency" label="Display currency" htmlFor="base-currency" help="Display currency for totals across stores. It doesn't change any store's selling currency." error={f.error('baseCurrency')} changed={f.dirty.includes('baseCurrency')}>
          <select id="base-currency" data-setting="baseCurrency" value={d.baseCurrency} onChange={(e) => f.set('baseCurrency', e.target.value)} className={cx(inputClass, 'py-1.5')}>
            {listed(codes.data ?? [], d.baseCurrency).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow setting="timezone" label="Workspace timezone" htmlFor="workspace-timezone" help="Schedules, the morning digest, quiet hours and every daily cap run on this clock. Times on screen stay on this computer's." error={f.error('timezone')} changed={f.dirty.includes('timezone')}>
          <select id="workspace-timezone" data-setting="timezone" value={d.timezone} onChange={(e) => f.set('timezone', e.target.value)} className={cx(inputClass, 'w-full py-1.5 min-[600px]:w-[260px]')}>
            {listed(ZONES, d.timezone).map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </SettingRow>
      </SettingsSection>
      <SaveBar
        {...f.bar}
        scope="Workspace"
        impact={texts.length ? texts.map((t) => <span key={t} className="mt-0.5 block text-xs">{t}</span>) : undefined}
      />
      {f.dialogs}
    </>
  );
}
