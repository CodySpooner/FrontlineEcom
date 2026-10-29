// Appearance (ST-13, decision 3): reduced motion, which applies right away. The rest follows Windows or lives on the
// AI Ecosystem page, so it's read-only here.
import { Link } from 'react-router';
import { useConfig, useSaveConfig } from '../../api/client';
import { ErrorState, LoadingState, Segmented } from '../../components/ui';
import { ImmediateRow, SettingRow, SettingsSection } from '../kit';

type Motion = 'system' | 'reduce';

export function Appearance() {
  const q = useConfig();
  const save = useSaveConfig();
  if (q.isPending) return <SettingsSection title="Motion"><LoadingState rows={1} className="px-[18px] pb-4" /></SettingsSection>;
  if (q.isError) return <SettingsSection title="Motion"><ErrorState message="Couldn't load your settings." onRetry={() => q.refetch()} /></SettingsSection>;
  const saved = q.data.values['appearance.motion'] as Motion;
  const asked = save.isPending ? (save.variables.documents[0]!.set!['appearance.motion'] as Motion) : saved;
  const pick = (motion: Motion) => {
    if (save.isPending || motion === saved) return;
    save.mutate({ documents: [{ doc: 'personal', version: q.data.versions.personal ?? 0, set: { 'appearance.motion': motion } }] });
  };
  return (
    <>
      <SettingsSection title="Motion" help="Animation across the app and the AI Ecosystem.">
        <ImmediateRow
          setting="appearance.motion"
          label="Motion"
          help="Follow Windows' setting, or always reduce animation."
          state={save.isPending ? 'saving' : save.isError ? 'error' : save.isSuccess ? 'saved' : 'idle'}
          error={save.error?.message}
        >
          <div data-setting="appearance.motion">
            <Segmented<Motion> label="Motion" value={asked} onChange={pick} options={[{ value: 'system', label: 'Follow Windows' }, { value: 'reduce', label: 'Always reduce' }]} />
          </div>
        </ImmediateRow>
      </SettingsSection>
      <SettingsSection title="Theme">
        <SettingRow label="Theme" help="Dark theme only." />
        <SettingRow label="Contrast" help="Windows contrast themes are followed." />
        <SettingRow
          label="AI Ecosystem"
          help={
            <>
              Office theme and low-power mode are on the{' '}
              <Link to="/ecosystem" className="text-text-2 underline underline-offset-2 hover:text-white">
                AI Ecosystem page
              </Link>{' '}
              (this device).
            </>
          }
        />
      </SettingsSection>
    </>
  );
}
