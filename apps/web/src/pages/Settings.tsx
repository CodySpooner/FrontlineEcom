// UI-17 Settings: stores, per-store caps and autopilot, profile, notifications, sound, where the data lives.
import { useState, type FormEvent } from 'react';
import { APPROVAL_KINDS, type Store, type StoreCaps } from '@frontline/shared';
import { useBackupNow, useBackups, useCaps, useRestoreBackup, useSaveCaps, useSettings, useStoreActions, useStores, useUpdateSettings, useUsage } from '../api/client';
import { Hero } from '../components/Hero';
import { nicheName, PLATFORM_NAME, StoreForm } from '../components/StoreForm';
import { Badge, Button, cx, Dialog, ErrorState, Field, inputClass, LoadingState, Panel, Switch, UsageMeter } from '../components/ui';
import { cents, money } from '../lib/format';
import { NAV } from '../nav';

// Only kinds with a $ amount can be checked against a daily cap.
const AUTOPILOT = Object.entries(APPROVAL_KINDS).flatMap(([kind, k]) => (k.autopilot ? [{ kind, label: k.label }] : []));

export function Settings() {
  const nav = NAV.find((n) => n.path === '/settings')!;
  return (
    <>
      <Hero title={nav.title} subtitle={nav.subtitle} icon={nav.icon} art={nav.art} />
      <div className="grid items-start gap-3.5 min-[1100px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid gap-3.5">
          <Stores />
          <Caps />
        </div>
        <div className="grid gap-3.5">
          <Preferences />
        </div>
      </div>
    </>
  );
}

function Stores() {
  const q = useStores();
  const [editing, setEditing] = useState<Store | 'new'>();
  return (
    <Panel
      title="Stores"
      sub="Each store gets its own squad that learns its niche."
      action={
        <Button size="sm" variant="primary" onClick={() => setEditing('new')}>
          Add store
        </Button>
      }
    >
      {q.isPending ? (
        <LoadingState rows={3} />
      ) : q.isError ? (
        <ErrorState message="Couldn't load your stores." onRetry={() => q.refetch()} />
      ) : (
        <ul className="grid gap-2">
          {q.data.map((s) => (
            <StoreRow key={s.id} s={s} onEdit={() => setEditing(s)} />
          ))}
        </ul>
      )}
      <Dialog open={!!editing} onClose={() => setEditing(undefined)} title={editing === 'new' ? 'Add a store' : `Edit ${editing?.name ?? 'store'}`} side="right">
        {editing && <StoreForm key={editing === 'new' ? 'new' : editing.id} store={editing === 'new' ? undefined : editing} onDone={() => setEditing(undefined)} />}
      </Dialog>
    </Panel>
  );
}

function StoreRow({ s, onEdit }: { s: Store; onEdit: () => void }) {
  const { remove } = useStoreActions();
  const [confirm, setConfirm] = useState(false);
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-bg-2 px-3 py-2.5">
      <i aria-hidden className="size-3 shrink-0 rounded-full" style={{ background: s.color }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <b className="text-[14px]">{s.name}</b>
          <Badge tone={s.connected ? 'good' : 'muted'}>{s.connected ? 'Connected' : 'Demo data'}</Badge>
        </div>
        <p className="text-xs text-muted">{[PLATFORM_NAME[s.platform], nicheName(s.niche), s.nicheDetail, s.currency].filter(Boolean).join(' · ')}</p>
        {remove.isError && (
          <p role="alert" className="mt-1 text-xs text-red">
            {remove.error.message}
          </p>
        )}
      </div>
      {confirm ? (
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-text-2">Delete {s.name}? This can't be undone.</span>
          <Button size="sm" onClick={() => setConfirm(false)}>
            Keep
          </Button>
          <Button size="sm" variant="primary" disabled={remove.isPending} onClick={() => remove.mutate(s.id)}>
            Delete store
          </Button>
        </span>
      ) : (
        <span className="flex gap-3 text-xs">
          <button type="button" onClick={onEdit} className="cursor-pointer text-text-2 hover:text-white">
            Edit
          </button>
          <button type="button" onClick={() => setConfirm(true)} className="cursor-pointer text-muted hover:text-red">
            Delete
          </button>
        </span>
      )}
    </li>
  );
}

function Caps() {
  const stores = useStores().data ?? [];
  const [picked, setPicked] = useState('');
  const storeId = picked || stores[0]?.id || '';
  const q = useCaps(storeId);
  return (
    <Panel
      title="Caps & Autopilot"
      sub="Hard limits the agents can't cross. Autopilot lets an agent approve its own action within a daily cap; everything else asks you."
      action={
        stores.length > 1 && (
          <label>
            <span className="sr-only">Store</span>
            <select value={storeId} onChange={(e) => setPicked(e.target.value)} className={cx(inputClass, 'cursor-pointer py-1.5')}>
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
      {!storeId || q.isPending ? (
        <LoadingState rows={4} />
      ) : q.isError || !q.data ? (
        <ErrorState message="Couldn't load the caps." onRetry={() => q.refetch()} />
      ) : (
        <CapsForm key={storeId} caps={q.data} />
      )}
    </Panel>
  );
}

function CapsForm({ caps }: { caps: StoreCaps }) {
  const save = useSaveCaps(caps.storeId);
  const [draft, setDraft] = useState(caps);
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(caps);
  const rule = (kind: string) => draft.autopilot[kind] ?? { enabled: false, maxUsdPerDay: 50 };
  const setRule = (kind: string, r: Partial<StoreCaps['autopilot'][string]>) => setDraft((d) => ({ ...d, autopilot: { ...d.autopilot, [kind]: { ...rule(kind), ...r } } }));
  const usage = useUsage([caps.storeId]).data?.[0];
  const num = (key: 'adSpendChangePerDay' | 'higgsfieldCreditsPerDay' | 'agentCostPerDay', label: string, help: string, used: number | undefined, fmt: (n: number) => string) => (
    <div className="grid content-start gap-2">
      <Field label={label}>
        <input type="number" min={0} max={1_000_000} step="any" value={draft[key]} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.valueAsNumber }))} required className={inputClass} />
        <span className="text-[11px] text-muted">{help}</span>
      </Field>
      {used !== undefined && <UsageMeter label={label} used={used} cap={draft[key] || 0} fmt={fmt} />}
    </div>
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const { storeId: _, ...update } = draft;
    save.mutate(update, { onSuccess: () => setSaved(true) });
  };
  return (
    <form onSubmit={submit} onChange={() => setSaved(false)} className="grid gap-5">
      <div className="grid gap-3 min-[700px]:grid-cols-3">
        {num('adSpendChangePerDay', 'Ad budget changes ($/day)', 'Most an agent may add or move per day.', usage?.adBudgetAddedUsd, (n) => money(n))}
        {num('higgsfieldCreditsPerDay', 'Higgsfield credits per day', 'For image and video generation.', usage?.credits, (n) => n.toLocaleString('en-US'))}
        {num('agentCostPerDay', 'AI usage ($/day)', "This store's agents stop for the day past it.", usage?.agentCostUsd, (n) => cents(n))}
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
                  <Switch checked={r.enabled} onChange={(e) => setRule(kind, { enabled: e.target.checked })} />
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
                    onChange={(e) => setRule(kind, { maxUsdPerDay: e.target.valueAsNumber })}
                    aria-label={`${label}: most per day in dollars`}
                    className={cx(inputClass, 'w-24 py-1')}
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

function Preferences() {
  const q = useSettings();
  const update = useUpdateSettings();
  const [name, setName] = useState<string>();
  const [base, setBase] = useState<string>();
  const [copied, setCopied] = useState(false);
  if (q.isPending) return <Panel title="Profile"><LoadingState rows={3} /></Panel>;
  if (q.isError) return <Panel title="Profile"><ErrorState message="Couldn't load your settings." onRetry={() => q.refetch()} /></Panel>;
  const s = q.data;
  const shown = name ?? s.profile.name;
  const cur = base ?? s.baseCurrency;
  const dirty = shown.trim() !== s.profile.name || cur.toUpperCase() !== s.baseCurrency;
  const toggle = (label: string, help: string, checked: boolean, patch: (v: boolean) => Parameters<typeof update.mutate>[0]) => (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-2">
      <span>
        <span className="block text-[13px]">{label}</span>
        <span className="block text-xs text-muted">{help}</span>
      </span>
      <Switch checked={checked} disabled={update.isPending} onChange={(e) => update.mutate(patch(e.target.checked))} />
    </label>
  );
  return (
    <>
      <Panel title="Profile" sub={s.profile.plan}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate(
              { profile: { name: shown.trim() }, baseCurrency: cur.trim().toUpperCase() },
              {
                onSuccess: () => {
                  setName(undefined);
                  setBase(undefined);
                },
              },
            );
          }}
          className="grid gap-3"
        >
          <Field label="Your name">
            <input value={shown} onChange={(e) => setName(e.target.value)} required maxLength={40} className={inputClass} />
          </Field>
          <Field label="Base currency">
            <input value={cur} onChange={(e) => setBase(e.target.value)} required pattern="[A-Za-z]{3}" maxLength={3} placeholder="USD" className={cx(inputClass, 'uppercase')} />
            <span className="text-[11px] text-muted">Totals across stores are converted to this. One store shows its own currency.</span>
          </Field>
          <Button type="submit" variant="primary" className="justify-self-end" disabled={!dirty || !shown.trim() || update.isPending}>
            Save
          </Button>
        </form>
      </Panel>
      <Panel title="Notifications" sub="What lands in the bell.">
        <div className="divide-y divide-line">
          {toggle('Approvals', 'An agent needs your yes or no.', s.notifications.approvals, (v) => ({ notifications: { approvals: v } }))}
          {toggle('Agent finished', 'A task you started is done.', s.notifications.agentDone, (v) => ({ notifications: { agentDone: v } }))}
          {toggle('Errors', 'A run or a connector failed.', s.notifications.errors, (v) => ({ notifications: { errors: v } }))}
          {toggle('Sound', 'Mission and XP sounds.', s.sound, (v) => ({ sound: v }))}
        </div>
        {update.isError && (
          <p role="alert" className="mt-2 text-xs text-red">
            {update.error.message}
          </p>
        )}
      </Panel>
      <Panel title="Your Data" sub="The database and encryption key live on this computer.">
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-bg-2 px-2.5 py-1.5 font-mono text-xs text-text-2" title={s.dataDir}>
            {s.dataDir}
          </code>
          <Button size="sm" onClick={() => navigator.clipboard.writeText(s.dataDir).then(() => setCopied(true))}>
            {copied ? 'Copied' : 'Copy path'}
          </Button>
        </div>
        <Backups />
      </Panel>
    </>
  );
}

function Backups() {
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
        <ul className="grid gap-1 text-xs">
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
                <span className="ml-auto text-muted tabular-nums">{(b.size / 1e6).toFixed(1)} MB</span>
                <button
                  type="button"
                  disabled={restore.isPending}
                  onClick={() => setConfirm(b.name)}
                  aria-label={`Restore the backup from ${when(b.createdAt)}`}
                  className="cursor-pointer text-muted hover:text-white disabled:cursor-default disabled:opacity-50"
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
