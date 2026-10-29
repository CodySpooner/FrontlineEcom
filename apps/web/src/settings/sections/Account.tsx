// Account (ST-12, decision 17): the one owner's display name, and what Frontline doesn't have on this computer.
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { machineZone, settingsUrl, type Settings } from '@frontline/shared';
import { useSettings, useUpdateSettings, type ApiError } from '../../api/client';
import { cx, ErrorState, inputClass, LoadingState } from '../../components/ui';
import { useSettingsForm } from '../form';
import { SaveBar, SettingRow, SettingsSection } from '../kit';

type Form = { version: number; 'profile.name': string };
const toForm = (s: Settings): Form => ({ version: s.version ?? 0, 'profile.name': s.profile.name });

export function Account() {
  const q = useSettings();
  const qc = useQueryClient();
  const update = useUpdateSettings();
  const f = useSettingsForm<Form>({
    key: 'account',
    saved: q.data && toForm(q.data),
    labels: { 'profile.name': 'Display name' },
    save: (changes, version) =>
      update.mutateAsync({ version, profile: { name: changes['profile.name'] } }).then(toForm, (e: ApiError) => {
        if (e.current) e.current = toForm(e.current as Settings); // the conflict dialog compares the form's fields
        throw e;
      }),
    onSaved: () => void qc.invalidateQueries({ queryKey: ['settings'] }),
  });
  if (q.isPending) return <SettingsSection title="Profile"><LoadingState rows={2} className="px-[18px] pb-4" /></SettingsSection>;
  if (q.isError) return <SettingsSection title="Profile"><ErrorState message="Couldn't load your settings." onRetry={() => q.refetch()} /></SettingsSection>;
  return (
    <>
      <SettingsSection title="Profile" help="How Frontline shows you.">
        <SettingRow setting="profile.name" label="Display name" htmlFor="profile-name" help="Shown on the profile chip. 1–40 characters." error={f.error('profile.name')} changed={f.dirty.includes('profile.name')}>
          <input id="profile-name" data-setting="profile.name" value={f.draft!['profile.name']} onChange={(e) => f.set('profile.name', e.target.value)} maxLength={40} className={cx(inputClass, 'w-full min-[600px]:w-[260px]')} />
        </SettingRow>
        <SettingRow
          label="Timezone"
          help={
            <>
              Times on screen use this computer's timezone ({machineZone()}). Schedules use the{' '}
              <Link to={settingsUrl('general', { setting: 'timezone' })} className="text-text-2 underline underline-offset-2 hover:text-white">
                workspace timezone
              </Link>
              .
            </>
          }
        />
      </SettingsSection>
      <SettingsSection title="On this computer">
        <SettingRow label="Sign-in" help="Frontline has one owner on this computer: there's no sign-in, team or billing." />
        <SettingRow label="Language" help="English only." />
      </SettingsSection>
      <SaveBar {...f.bar} scope="Your account" />
      {f.dialogs}
    </>
  );
}
