// Data & Backups (ST-31, decision 15): exactly what exists on this computer. Where the data, the key and the logs are
// (GET /api/settings, /api/health's keyLocation and dataDirSource), the backups with their kinds, Back up now, a restore
// that says everything it does first, and the retention each kind of data really has (read-only).
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { settingsUrl, type Backup, type BackupKind, type Health } from '@frontline/shared';
import { useBackupNow, useBackups, useHealth, useOpenDataFolder, useRestoreBackup, useSettings } from '../../api/client';
import { Badge, Dialog, ErrorState, flatButtonClass, LoadingState } from '../../components/ui';
import { SettingRow, SettingsSection } from '../kit';

const DATA_FROM: Record<NonNullable<Health['dataDirSource']>, string> = {
  desktop: "The desktop app's folder for your Windows account.",
  env: 'Set by FRONTLINE_DATA_DIR where the server starts.',
  default: 'The default: .data in the folder the server started in (FRONTLINE_DATA_DIR changes it).',
};
const KEY_AT: Record<NonNullable<Health['keyLocation']>, (dir: string) => string> = {
  'safe-storage': () => "Kept by the desktop app in Windows' safe storage for your account, outside the data folder. A copy of the data folder alone can't read your credentials.",
  environment: () => 'Read from FRONTLINE_SECRET_KEY, set where the server starts.',
  'data-dir': (dir) => `In the data folder: ${join(dir, 'secret.key')}. Anyone with a copy of that file and the database can read your credentials.`,
};
const KIND: Record<BackupKind, string> = { daily: 'Daily', manual: 'Manual', 'before-restore': 'Before restore', 'before-update': 'Before update' };
const join = (dir: string, name: string) => `${dir}${dir.includes('\\') ? '\\' : '/'}${name}`;
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const link = 'text-[#ff6b76] hover:underline';

export function Data() {
  return (
    <>
      <Storage />
      <Backups />
      <Retention />
    </>
  );
}

function Storage() {
  const q = useSettings();
  const health = useHealth().data;
  const open = useOpenDataFolder();
  const [copied, setCopied] = useState(false);
  const title = 'Storage';
  const version = health?.version;
  const aside = version && <span className="shrink-0 text-xs text-muted tabular-nums">{version === 'dev' ? 'Development build' : `Version ${version}`}</span>;
  if (q.isPending) return <SettingsSection title={title}><LoadingState rows={3} className="px-[18px] pb-4" /></SettingsSection>;
  if (q.isError) return <SettingsSection title={title}><ErrorState message="Couldn't load your settings." onRetry={() => q.refetch()} /></SettingsSection>;
  const dir = q.data.dataDir;
  return (
    <SettingsSection title={title} help="Everything Frontline keeps is on this computer." aside={aside}>
      <SettingRow label="Data folder" help={health?.dataDirSource ? DATA_FROM[health.dataDirSource] : undefined}>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <code className="min-w-0 rounded-md border border-line bg-bg-2 px-2.5 py-1.5 font-mono text-xs break-all text-text-2" title={dir}>
            {dir}
          </code>
          <button type="button" data-action="data.copy" onClick={() => navigator.clipboard.writeText(dir).then(() => setCopied(true))} className={flatButtonClass('default', 'sm')}>
            {copied ? 'Copied' : 'Copy path'}
          </button>
          <button type="button" data-action="data.open" disabled={open.isPending} onClick={() => open.mutate()} className={flatButtonClass('default', 'sm')}>
            Open folder
          </button>
        </div>
      </SettingRow>
      {open.isError && (
        <p role="alert" className="px-[18px] pb-2 text-xs text-red">
          {open.error.message}
        </p>
      )}
      {/* Paths wrap anywhere: a long one would widen the page on a phone. */}
      <SettingRow label="Credentials key" help={health?.keyLocation && <span className="[overflow-wrap:anywhere]">{KEY_AT[health.keyLocation](dir)}</span>} />
      <SettingRow label="Logs" help={<span className="[overflow-wrap:anywhere]">{`${join(dir, 'logs')}: api.log, and one older copy (api.log.1) once it passes 5 MB.`}</span>} />
    </SettingsSection>
  );
}

function Backups() {
  const q = useBackups();
  const now = useBackupNow();
  const [restoring, setRestoring] = useState<Backup>();
  return (
    <SettingsSection
      title="Backups"
      help="A backup is a copy of the database: settings, stores, conversations, requests, Change History. It leaves out the credentials key, the knowledge files, niche packs, creatives, product images, and the Codex and agent session folders. Checked when the app starts and every hour: one is made when the newest is a day old. The newest 7 are kept, whatever made them."
      aside={
        <button type="button" data-action="backups.now" disabled={now.isPending} onClick={() => now.mutate()} className={flatButtonClass('default', 'sm')}>
          {now.isPending ? 'Backing up…' : 'Back up now'}
        </button>
      }
    >
      {now.error && (
        <p role="alert" className="px-[18px] pb-2 text-xs text-red">
          {now.error.message}
        </p>
      )}
      {q.isPending ? (
        <LoadingState rows={2} className="px-[18px] pb-4" />
      ) : q.isError ? (
        <ErrorState message="Couldn't list the backups." onRetry={() => q.refetch()} />
      ) : !q.data.length ? (
        <p className="border-t border-line px-[18px] py-3 text-[13px] text-muted">No backups yet.</p>
      ) : (
        <ul aria-label="Backups" className="border-t border-line text-[13px]">
          {q.data.map((b) => (
            <li key={b.name} className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-[18px] py-2 last:border-b-0">
              <span className="text-text-2" title={b.name}>
                {when(b.createdAt)}
              </span>
              <Badge>{b.kind ? KIND[b.kind] : 'Snapshot (kind not recorded)'}</Badge>
              <span className="ml-auto text-xs text-muted tabular-nums">{(b.size / 1e6).toFixed(1)} MB</span>
              <button type="button" data-action="backups.restore" onClick={() => setRestoring(b)} aria-label={`Restore the backup from ${when(b.createdAt)}`} className={flatButtonClass('ghost', 'sm')}>
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
      {restoring && <RestoreDialog backup={restoring} onClose={() => setRestoring(undefined)} />}
    </SettingsSection>
  );
}

/** Everything a restore does (decision 2), before it does it; then what to wait for in this build. */
function RestoreDialog({ backup, onClose }: { backup: Backup; onClose: () => void }) {
  const restore = useRestoreBackup();
  const dev = useHealth().data?.version === 'dev';
  return (
    <Dialog open onClose={restore.isPending ? () => {} : onClose} title={`Restore the backup from ${when(backup.createdAt)}?`} width={560}>
      {restore.isPending ? (
        <p role="status" className="text-sm text-text-2">
          {dev
            ? 'Restart the dev server: in a development build the server stops after a restore and stays down. Start pnpm dev again; this page reloads once the server answers.'
            : 'Restoring. The server stops with exit code 75, the desktop app starts it again on the backup, and the window reloads.'}
        </p>
      ) : (
        <ul aria-label="What a restore does" className="ml-4 grid list-disc gap-1 text-[13px] text-text-2">
          <li>Your current data is backed up first, as a Before restore backup, so you can go back.</li>
          <li>Every setting stored in the database returns to the backup&apos;s state, including integrations whose tokens may have changed since.</li>
          <li>Change History returns to the backup&apos;s state too.</li>
          <li>Requests waiting on a connected store or ad account are closed: they may have been carried out since the backup.</li>
          <li>On another computer, every credential stays locked: the key isn&apos;t in a backup.</li>
          <li>Files outside the database (knowledge files, creatives, product images, sessions) stay as they are now.</li>
          <li>{dev ? "The server stops; in this development build you restart it yourself." : 'The server restarts and the window reloads.'}</li>
        </ul>
      )}
      {restore.error && (
        <p role="alert" className="mt-2 text-xs text-red">
          {restore.error.message}
        </p>
      )}
      {!restore.isPending && (
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={flatButtonClass('ghost')}>
            Keep current
          </button>
          <button type="button" onClick={() => restore.mutate(backup.name)} className={flatButtonClass('primary')}>
            Restore
          </button>
        </div>
      )}
    </Dialog>
  );
}

const RETENTION: [string, ReactNode][] = [
  ['Conversations and run transcripts', 'Kept until you delete a conversation. After 90 days a run keeps its text and tool calls, and each tool output is cut to its first 200 characters.'],
  [
    'Knowledge',
    <>
      Each store&apos;s retention in{' '}
      <Link to={settingsUrl('knowledge', { setting: 'kb.retentionDays' })} className={link}>
        Knowledge
      </Link>
      ; it also empties the transcripts of those research runs. Off keeps everything.
    </>,
  ],
  ['Research outputs', 'Kept. Product images are capped at 500 MB, oldest first; the research call log is kept.'],
  ['Operational logs', 'api.log and one older copy, 5 MB each. The live sales feed keeps 7 days.'],
  ['Change History', 'Never pruned, and never holds a secret. A restore takes it back to the backup.'],
  ['Notifications, automation runs', 'Kept.'],
  ['Backups', 'The newest 7, whatever made them.'],
];

function Retention() {
  return (
    <SettingsSection title="Retention" help="How long each kind of data is kept. Only Knowledge has a setting.">
      <dl className="border-t border-line text-[13px]">
        {RETENTION.map(([what, how]) => (
          <div key={what} className="grid gap-0.5 border-b border-line px-[18px] py-2.5 last:border-b-0 min-[700px]:grid-cols-[220px_minmax(0,1fr)] min-[700px]:gap-x-4">
            <dt className="font-medium">{what}</dt>
            <dd className="text-text-2">{how}</dd>
          </div>
        ))}
      </dl>
    </SettingsSection>
  );
}
