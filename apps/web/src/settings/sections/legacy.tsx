// Today's Settings panels, moved unchanged into their sections (ST-02) until the items named in each `data-legacy`
// wrapper rebuild them with the settings kit.
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { APPROVAL_KINDS, type StoreCaps, type StoreCapsUpdate } from '@frontline/shared';
import { useBackupNow, useBackups, useCaps, useHealth, useOpenDataFolder, useRestoreBackup, useSaveCaps, useSettings, useStores, useUsage } from '../../api/client';
import { Badge, Button, cx, ErrorState, Field, inputClass, LoadingState, Panel, Switch, UsageMeter } from '../../components/ui';
import { money } from '../../lib/format';

// Only kinds with a $ amount can be checked against a daily cap.
const AUTOPILOT = Object.entries(APPROVAL_KINDS).flatMap(([kind, k]) => (k.autopilot ? [{ kind, label: k.label }] : []));

/** The store comes from `?store=`, so a deep link opens its caps. */
export function Caps() {
  const all = useStores();
  const stores = all.data ?? [];
  const [params, setParams] = useSearchParams();
  const asked = params.get('store');
  const storeId = (asked && stores.some((s) => s.id === asked) ? asked : stores[0]?.id) || '';
  const q = useCaps(storeId);
  return (
    <Panel
      title="Caps & Autopilot"
      sub="Hard limits the agents can't cross. Autopilot lets an agent approve its own action within a daily cap; everything else asks you."
      action={
        stores.length > 1 && (
          <label>
            <span className="sr-only">Store</span>
            <select value={storeId} onChange={(e) => setParams({ store: e.target.value }, { replace: true })} className={cx(inputClass, 'cursor-pointer py-1.5!')}>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )
      }
    >
      {all.data?.length === 0 ? (
        <p className="text-[13px] text-muted">Caps are set per store: add a store above, then set its limits here.</p>
      ) : !storeId || q.isPending ? (
        <LoadingState rows={4} />
      ) : q.isError || !q.data ? (
        <ErrorState message="Couldn't load the caps." onRetry={() => q.refetch()} />
      ) : (
        <CapsForm key={storeId} caps={q.data} />
      )}
    </Panel>
  );
}

export function CapsForm({ caps }: { caps: StoreCaps }) {
  const save = useSaveCaps(caps.storeId);
  const [draft, setDraft] = useState(caps);
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(caps);
  const rule = (kind: string) => draft.autopilot[kind] ?? { enabled: false, maxUsdPerDay: 50 };
  const setRule = (kind: string, r: Partial<StoreCaps['autopilot'][string]>) => setDraft((d) => ({ ...d, autopilot: { ...d.autopilot, [kind]: { ...rule(kind), ...r } } }));
  const usage = useUsage([caps.storeId]).data?.[0];
  const num = (key: 'adSpendChangePerDay' | 'higgsfieldCreditsPerDay', label: string, help: string, used: number | undefined, fmt: (n: number) => string) => (
    <div className="grid content-start gap-2">
      <Field label={label}>
        <input type="number" min={0} max={1_000_000} step="any" value={draft[key]} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.valueAsNumber }))} required className={cx(inputClass, 'w-full min-w-0')} />
        <span className="text-[11px] text-muted">{help}</span>
      </Field>
      {used !== undefined && <UsageMeter label={label} used={used} cap={draft[key] || 0} fmt={fmt} />}
    </div>
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    // Only what changed becomes this store's own value: the rest keeps following the workspace.
    const update: StoreCapsUpdate = { version: caps.version ?? 0 };
    for (const k of ['adSpendChangePerDay', 'higgsfieldCreditsPerDay'] as const) if (draft[k] !== caps[k]) update[k] = draft[k];
    const autopilot = Object.fromEntries(Object.entries(draft.autopilot).filter(([k, r]) => JSON.stringify(r) !== JSON.stringify(caps.autopilot[k])));
    if (Object.keys(autopilot).length) update.autopilot = autopilot;
    save.mutate(update, {
      onSuccess: (c) => {
        setDraft(c);
        setSaved(true);
      },
    });
  };
  return (
    <form onSubmit={submit} onChange={() => setSaved(false)} className="grid gap-5">
      {/* AI usage per day moved to Agents & Providers (ST-23). */}
      <div className="grid gap-3 min-[700px]:grid-cols-2">
        {num('adSpendChangePerDay', 'Ad budget changes ($/day)', 'Most an agent may add or move per day.', usage?.adBudgetAddedUsd, (n) => money(n))}
        {num('higgsfieldCreditsPerDay', 'Higgsfield credits per day', 'For image and video generation.', usage?.credits, (n) => n.toLocaleString('en-US'))}
      </div>
      <fieldset>
        <legend className="mb-1 text-[13px] font-semibold">Autopilot</legend>
        <p className="mb-2 text-xs text-muted">Only for agents set to Autopilot on their page, and only for actions with a dollar amount to check. Off means the agent always asks first.</p>
        <ul className="divide-y divide-line rounded-lg border border-line bg-bg-2">
          {AUTOPILOT.map(({ kind, label }) => {
            const r = rule(kind);
            return (
              <li key={kind} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <label className="flex flex-1 cursor-pointer items-center gap-3">
                  <Switch checked={r.enabled} onChange={(e) => setRule(kind, { enabled: e.target.checked, maxUsdPerDay: r.maxUsdPerDay || 0 })} />
                  <span className="text-[13px]">{label}</span>
                </label>
                <label className={cx('flex items-center gap-2 text-xs text-muted', !r.enabled && 'opacity-50')}>
                  up to $
                  <input
                    type="number"
                    min={0}
                    max={1_000_000}
                    step="any"
                    value={r.maxUsdPerDay}
                    disabled={!r.enabled}
                    required
                    onChange={(e) => setRule(kind, { maxUsdPerDay: e.target.valueAsNumber })}
                    aria-label={`${label}: most per day in dollars`}
                    className={cx(inputClass, 'w-24 py-1!')}
                  />
                  / day
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
      <div className="flex items-center justify-end gap-3">
        {save.isError && (
          <span role="alert" className="mr-auto text-xs text-red">
            {save.error.message}
          </span>
        )}
        {saved && !dirty && <span className="text-xs text-good">Saved</span>}
        <Button onClick={() => setDraft(caps)} disabled={!dirty}>
          Reset
        </Button>
        <Button type="submit" variant="primary" disabled={!dirty || save.isPending}>
          Save caps
        </Button>
      </div>
    </form>
  );
}

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
