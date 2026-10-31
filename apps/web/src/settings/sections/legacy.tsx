// Today's Settings panels, moved unchanged into their sections (ST-02) until the items named in each `data-legacy`
// wrapper rebuild them with the settings kit.
import { useState } from 'react';
import { useBackupNow, useBackups, useHealth, useOpenDataFolder, useRestoreBackup, useSettings } from '../../api/client';
import { Badge, Button, ErrorState, LoadingState, Panel } from '../../components/ui';

/** One field of the old Profile panel (Account: the name; General: the base currency): each saves only its own field. */
export function YourData() {
  const q = useSettings();
  const [copied, setCopied] = useState(false);
  const openDir = useOpenDataFolder();
  const version = useHealth().data?.version;
  if (q.isPending) return <Panel title="Your Data"><LoadingState rows={3} /></Panel>;
  if (q.isError) return <Panel title="Your Data"><ErrorState message="Couldn't load your settings." onRetry={() => q.refetch()} /></Panel>;
  const s = q.data;
  return (
    <Panel
      title="Your Data"
      sub="The database and encryption key live on this computer."
      action={version && <span className="shrink-0 text-xs text-muted tabular-nums">{version === 'dev' ? 'Development build' : `Version ${version}`}</span>}
    >
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-[1_1_220px] rounded-md border border-line bg-bg-2 px-2.5 py-1.5 font-mono text-xs break-all text-text-2" title={s.dataDir}>
          {s.dataDir}
        </code>
        <Button size="sm" onClick={() => navigator.clipboard.writeText(s.dataDir).then(() => setCopied(true))}>
          {copied ? 'Copied' : 'Copy path'}
        </Button>
        <Button size="sm" disabled={openDir.isPending} onClick={() => openDir.mutate()}>
          Open folder
        </Button>
      </div>
      {openDir.isError && (
        <p role="alert" className="mt-2 text-xs text-red">
          {openDir.error.message}
        </p>
      )}
      <Backups />
    </Panel>
  );
}

export function Backups() {
  const q = useBackups();
  const now = useBackupNow();
  const restore = useRestoreBackup();
  const [confirm, setConfirm] = useState<string>();
  const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return (
    <div className="mt-4 border-t border-line pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold">Backups</h3>
        <Button size="sm" disabled={now.isPending} onClick={() => now.mutate()}>
          {now.isPending ? 'Backing up…' : 'Back up now'}
        </Button>
      </div>
      {q.isPending ? (
        <LoadingState rows={2} />
      ) : q.isError ? (
        <ErrorState message="Couldn't list the backups." onRetry={() => q.refetch()} />
      ) : !q.data.length ? (
        <p className="text-xs text-muted">No backups yet. One is made every day; the newest 7 are kept.</p>
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-1 text-xs">
          {q.data.map((b) =>
            confirm === b.name ? (
              <li key={b.name} className="flex flex-wrap items-center gap-2 rounded-lg border border-line-2 bg-bg-2 px-2.5 py-2">
                <span className="mr-auto text-text-2">
                  {restore.isPending ? 'Restoring. The app reloads when it is back…' : `Restore the backup from ${when(b.createdAt)}? Your current data is backed up first.`}
                </span>
                {!restore.isPending && (
                  <>
                    <Button size="sm" onClick={() => setConfirm(undefined)}>
                      Keep current
                    </Button>
                    <Button size="sm" variant="primary" onClick={() => restore.mutate(b.name)}>
                      Restore
                    </Button>
                  </>
                )}
              </li>
            ) : (
              <li key={b.name} className="flex items-center gap-2">
                <span className="truncate text-text-2" title={b.name}>
                  {when(b.createdAt)}
                </span>
                {b.name.endsWith('-before-update.db') && <Badge>Before update</Badge>}
                <span className="ml-auto shrink-0 text-muted tabular-nums">{(b.size / 1e6).toFixed(1)} MB</span>
                <button
                  type="button"
                  disabled={restore.isPending}
                  onClick={() => setConfirm(b.name)}
                  aria-label={`Restore the backup from ${when(b.createdAt)}`}
                  className="shrink-0 cursor-pointer text-muted hover:text-white disabled:cursor-default disabled:opacity-50"
                >
                  Restore
                </button>
              </li>
            ),
          )}
        </ul>
      )}
      {(now.error ?? restore.error) && (
        <p role="alert" className="mt-2 text-xs text-red">
          {(now.error ?? restore.error)!.message}
        </p>
      )}
    </div>
  );
}
