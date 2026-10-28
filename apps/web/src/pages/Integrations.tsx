// UI-15 Integrations: connect store platforms, ad accounts, analytics, suppliers and creative tools.
// Secrets go in and never come back out: the API only says which secret fields are set.
import { Fragment, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { anotherShop, INTEGRATION_KINDS, type Integration, type IntegrationCategory, type IntegrationKind, type OAuthStart, type Store } from '@frontline/shared';
import { useClaudeAccount, useIntegrationActions, useIntegrations, useOAuth, useOAuthKinds, useStores, useSyncIntegration } from '../api/client';
import { Hero } from '../components/Hero';
import { StoreFilter, useStoreSelection } from '../components/StoreFilter';
import { Button, buttonClass, cx, Dialog, EmptyState, ErrorState, Field, inputClass, LoadingState, Panel, StatusDot, useFocusBack } from '../components/ui';
import { ago, fmtDay } from '../lib/format';
import { importing } from '../lib/sync';
import { NAV } from '../nav';

const CATEGORIES: Record<IntegrationCategory, { title: string; sub: string }> = {
  platform: { title: 'Store Platforms', sub: 'Orders, products and sales sync from each store.' },
  ads: { title: 'Ad Networks', sub: 'Spend, ROAS and campaigns. Agents propose changes; you approve them.' },
  analytics: { title: 'Analytics', sub: 'Sessions and the checkout funnel.' },
  supplier: { title: 'Suppliers', sub: 'Order status, tracking and catalog search.' },
  creative: { title: 'Creative', sub: 'Image and video generation for Ad Creation.' },
};
const KINDS = Object.keys(INTEGRATION_KINDS) as IntegrationKind[];
// ponytail: one-of groups aren't in the shared field list; Shopify needs client ID + secret or an older app's token.
const ONE_OF: Partial<Record<IntegrationKind, { from: string; keys: string[]; note: string }>> = {
  shopify: { from: 'clientId', keys: ['clientId', 'clientSecret', 'accessToken'], note: 'Then either the client ID and secret of your Dev Dashboard app, or the access token of a custom app made before 2026.' },
};
const keyOf = (kind: IntegrationKind, store?: Store) => `${kind}:${store?.id ?? ''}`;

export function Integrations() {
  const nav = NAV.find((n) => n.path === '/integrations')!;
  const { stores, has } = useStoreSelection();
  const q = useIntegrations();
  const [open, setOpen] = useState<{ kind: IntegrationKind; store?: Store }>();
  const byKey = new Map(q.data?.map((i) => [`${i.kind}:${i.storeId ?? ''}`, i]));
  const shown = stores.filter((s) => has(s.id));
  // Store platforms and ad accounts connect to a store, so with none they'd have no rows at all.
  const noStores = useStores().data?.length === 0;
  // Per-store connectors list the selected stores (platform ones only the stores on that platform, or selling on it too);
  // global ones one row.
  const targets = (kind: IntegrationKind) =>
    !INTEGRATION_KINDS[kind].perStore
      ? [undefined]
      : shown.filter((s) => INTEGRATION_KINDS[kind].category !== 'platform' || s.platform === kind || byKey.has(keyOf(kind, s)));

  return (
    <>
      <Hero title={nav.title} subtitle={nav.subtitle} icon={nav.icon} />
      <div className="mb-3.5">
        <StoreFilter />
      </div>
      {q.isPending ? (
        <Panel title="Integrations">
          <LoadingState rows={4} />
        </Panel>
      ) : q.isError ? (
        <Panel title="Integrations">
          <ErrorState message="Couldn't load your connections." onRetry={() => q.refetch()} />
        </Panel>
      ) : (
        <div className="grid gap-3.5">
          {noStores && (
            <Panel title={CATEGORIES.platform.title} sub={CATEGORIES.platform.sub}>
              <EmptyState
                title="No stores yet"
                action={
                  <Link to="/settings" className={buttonClass('primary')}>
                    Add a store
                  </Link>
                }
              >
                Add one in Settings, then connect its platform and ad accounts here.
              </EmptyState>
            </Panel>
          )}
          {Object.entries(CATEGORIES).map(([cat, c]) => {
            const kinds = KINDS.filter((k) => INTEGRATION_KINDS[k].category === cat && targets(k).length);
            if (!kinds.length) return null;
            return (
              <Panel key={cat} title={c.title} sub={c.sub}>
                <div className="grid gap-3 min-[900px]:grid-cols-2 min-[1280px]:grid-cols-3">
                  {kinds.map((kind) => (
                    <section key={kind} className="rounded-lg border border-line bg-bg-2 p-3.5">
                      <h3 className="mb-2.5 text-[14px] font-semibold">{INTEGRATION_KINDS[kind].name}</h3>
                      <ul className="grid grid-cols-1 gap-2">
                        {targets(kind).map((store) => (
                          <Connection key={store?.id ?? 'all'} store={store} i={byKey.get(keyOf(kind, store))} onOpen={() => setOpen({ kind, store })} />
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
                {cat === 'platform' && <AlsoSells stores={shown} onOpen={(kind, store) => setOpen({ kind, store })} />}
              </Panel>
            );
          })}
          <ClaudeCard />
        </div>
      )}
      <Dialog
        open={!!open}
        onClose={() => setOpen(undefined)}
        title={open ? `${INTEGRATION_KINDS[open.kind].name}${open.store ? ` · ${open.store.name}` : ''}` : 'Connect'}
        side="right"
      >
        {open && <ConnectForm key={keyOf(open.kind, open.store)} {...open} current={byKey.get(keyOf(open.kind, open.store))} onDone={() => setOpen(undefined)} />}
      </Dialog>
    </>
  );
}

/** A store can sell on a second platform (a TikTok Shop or Amazon next to its Shopify); core adds those sales to the store's. */
function AlsoSells({ stores, onOpen }: { stores: Store[]; onOpen: (kind: IntegrationKind, store: Store) => void }) {
  const [storeId, setStoreId] = useState('');
  const [kind, setKind] = useState<IntegrationKind>();
  const store = stores.find((s) => s.id === storeId) ?? stores[0];
  const kinds = KINDS.filter((k) => INTEGRATION_KINDS[k].category === 'platform' && k !== store?.platform);
  const pick = kind && kinds.includes(kind) ? kind : kinds[0];
  if (!store || !pick) return null;
  const select = cx(inputClass, 'cursor-pointer py-1.5! text-text');
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
      <span>Also sells on another platform?</span>
      <select aria-label="Platform" value={pick} onChange={(e) => setKind(e.target.value as IntegrationKind)} className={select}>
        {kinds.map((k) => (
          <option key={k} value={k}>
            {INTEGRATION_KINDS[k].name}
          </option>
        ))}
      </select>
      for
      {stores.length > 1 ? (
        <select aria-label="Store" value={store.id} onChange={(e) => setStoreId(e.target.value)} className={select}>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      ) : (
        <span className="text-text-2">{store.name}</span>
      )}
      <Button size="sm" aria-label="Connect another platform" onClick={() => onOpen(pick, store)}>
        Connect
      </Button>
    </div>
  );
}

/** The engine every agent thinks with: the owner's Claude Code login on this computer (no API key). */
export function ClaudeCard() {
  const { q, recheck } = useClaudeAccount();
  return (
    <Panel title="AI" sub="What your agents think with: your Claude Code login on this computer.">
      <div className="grid gap-3 min-[900px]:grid-cols-2 min-[1280px]:grid-cols-3">
        <section className="rounded-lg border border-line bg-bg-2 p-3.5">
          <h3 className="mb-2.5 text-[14px] font-semibold">Claude</h3>
          {q.isPending ? (
            <p className="text-xs text-muted">Checking your Claude login…</p>
          ) : q.isError ? (
            <ErrorState message="Couldn't check your Claude login." onRetry={() => q.refetch()} />
          ) : (
            <>
              <div className="flex items-center gap-2 text-[13px]">
                <StatusDot tone={q.data.signedIn ? 'good' : q.data.error ? 'idle' : 'red'} />
                <span className="min-w-0 flex-1 break-words">
                  {q.data.signedIn ? (q.data.email ? `Signed in as ${q.data.email}` : 'Signed in') : 'Not signed in'}
                  {q.data.subscription && <span className="text-xs text-muted"> · {q.data.subscription}</span>}
                </span>
                <Button size="sm" disabled={recheck.isPending} onClick={() => recheck.mutate()}>
                  {recheck.isPending ? 'Checking…' : 'Check again'}
                </Button>
              </div>
              {q.data.error ? (
                <p className="mt-1 pl-4 text-xs text-muted">{q.data.error}</p>
              ) : (
                !q.data.signedIn && (
                  <p className="mt-1 pl-4 text-xs text-muted">
                    Agents on live stores need it. Run <code className="font-mono text-text-2">claude</code> in a terminal, sign in with{' '}
                    <code className="font-mono text-text-2">/login</code>, then check again.
                  </p>
                )
              )}
              {recheck.isError && (
                <p role="alert" className="mt-1 pl-4 text-xs text-red">
                  {recheck.error.message}
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </Panel>
  );
}

export function Connection({ store, i, onOpen }: { store?: Store; i?: Integration; onOpen: () => void }) {
  const imp = i && importing(i);
  const sync = useSyncIntegration();
  useEffect(() => {
    if (!sync.isSuccess) return;
    const t = setTimeout(sync.reset, 30_000); // the server's loop has run it by then
    return () => clearTimeout(t);
  }, [sync.isSuccess, sync.reset]);
  const status = !i
    ? 'Demo data'
    : i.status === 'error'
      ? 'Sync failed'
      : i.syncedAt
        ? `Synced ${ago(i.syncedAt)}`
        : imp
          ? `Importing history${imp.through ? ` · through ${fmtDay(imp.through, true)}` : '…'}`
          : 'Connected';
  return (
    <li>
      <div className="flex items-center gap-2 text-[13px]">
        <StatusDot tone={!i ? 'idle' : i.status === 'error' ? 'red' : 'good'} pulse={!!imp} />
        {/* A long store name truncates; its status wraps below rather than being cut off with it. */}
        <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1">
          <span className="max-w-full truncate" title={store?.name}>
            {store ? store.name : 'All stores'}
          </span>
          <span className="text-xs text-muted">· {status}</span>
        </span>
        {/* Creative tools (Higgsfield) have nothing to sync. */}
        {i && INTEGRATION_KINDS[i.kind].category !== 'creative' && (
          <Button size="sm" disabled={sync.isPending || sync.isSuccess} onClick={() => sync.mutate(i.id)}>
            {sync.isSuccess ? 'Sync queued' : 'Sync now'}
          </Button>
        )}
        <Button size="sm" onClick={onOpen}>
          {i ? 'Manage' : 'Connect'}
        </Button>
      </div>
      {i?.status === 'error' && i.error && <p className="mt-1 pl-4 text-xs break-words text-red">{i.error}</p>}
      {i?.notice && <p className="mt-1 pl-4 text-xs text-muted">{i.notice}</p>}
      {sync.isError && (
        <p role="alert" className="mt-1 pl-4 text-xs text-red">
          {sync.error.message}
        </p>
      )}
    </li>
  );
}

export function ConnectForm({ kind, store, current, onDone }: { kind: IntegrationKind; store?: Store; current?: Integration; onDone: () => void }) {
  const k = INTEGRATION_KINDS[kind];
  const { save, remove } = useIntegrationActions();
  const oauth = useOAuth();
  const canConnect = !!useOAuthKinds().data?.includes(kind);
  const { refetch } = useIntegrations();
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...current?.settings }));
  const [manual, setManual] = useState(false);
  const [pending, setPending] = useState<OAuthStart & { at: string }>();
  const [landed, setLanded] = useState('');
  const [confirm, setConfirm] = useState(false);
  const disconnect = useFocusBack(confirm);
  const otherShop = !!current && anotherShop(kind, current.settings, values);
  const viaConnect = canConnect && !manual;
  const fields = k.fields.filter((f) => !(viaConnect && f.oauth));
  const oneOf = ONE_OF[kind];
  const isSet = (key: string) => !!current?.secretsSet.includes(key);
  // A blank secret that's already saved is left out, so the server keeps it.
  const filled = () => Object.fromEntries(fields.flatMap((f) => (values[f.key]?.trim() ? [[f.key, values[f.key]!.trim()]] : [])));
  const connect = () =>
    oauth.start.mutate(
      { kind, storeId: store?.id, values: filled() },
      {
        onSuccess: (s) => {
          setPending({ ...s, at: new Date().toISOString() });
          window.open(s.url, '_blank', 'noopener,noreferrer');
        },
      },
    );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (viaConnect && !current) connect();
    else save.mutate({ kind, storeId: store?.id, values: filled() }, { onSuccess: onDone });
  };

  // Loopback: the provider sends the browser back to the API, which saves the integration; watch for it.
  const waiting = pending?.finish === 'loopback';
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(refetch, 2000);
    return () => clearInterval(t);
  }, [waiting, refetch]);
  useEffect(() => {
    if (waiting && current && current.updatedAt > pending.at) onDone();
  }, [waiting, current, pending, onDone]);

  const error = save.error ?? remove.error ?? oauth.start.error ?? oauth.finish.error;
  if (pending)
    return (
      <div className="grid gap-4">
        {pending.finish === 'loopback' ? (
          <p className="text-[13px] text-text-2">Approve {k.name} in the browser window that just opened. This panel closes once it's connected.</p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              oauth.finish.mutate(landed.trim(), { onSuccess: onDone });
            }}
            className="grid gap-3"
          >
            <p className="text-[13px] text-text-2">After you approve, your browser lands on a page that won't load. That's expected: copy its full address and paste it here.</p>
            <Field label="Address your browser landed on">
              <input value={landed} onChange={(e) => setLanded(e.target.value)} required spellCheck={false} autoComplete="off" placeholder={`${pending.redirectUri}?code=…`} className={inputClass} />
            </Field>
            <Button type="submit" variant="primary" disabled={!landed.trim() || oauth.finish.isPending}>
              Finish connecting
            </Button>
          </form>
        )}
        {error && (
          <p role="alert" className="text-xs text-red">
            {error.message}
          </p>
        )}
        <div className="flex items-center justify-between gap-2 border-t border-line pt-4 text-xs">
          <a href={pending.url} target="_blank" rel="noopener noreferrer" className="text-red hover:underline">
            Open the {k.name} page again
          </a>
          <Button onClick={() => setPending(undefined)}>Back</Button>
        </div>
      </div>
    );

  return (
    <form onSubmit={submit} className="grid gap-4">
      <p className="text-xs text-muted">
        {store ? `For ${store.name} only.` : 'Shared by all your stores.'} Saved encrypted on this computer. Secrets are never shown again.
      </p>
      {kind === 'amazon' && store?.platform === 'shopify' && (
        <p className="rounded-lg border border-line bg-bg-2 p-2.5 text-xs text-text-2">
          If {store.name}'s Shopify already imports its Amazon orders (Marketplace Connect), don't connect Amazon here too: those sales would
          count twice.
        </p>
      )}
      {current?.status === 'error' && (
        <p role="alert" className="rounded-lg border border-red/35 bg-red-soft p-2.5 text-xs text-red">
          Last sync failed{current.error ? `: ${current.error}` : '.'} Check the values below and save again.
        </p>
      )}
      {k.help && (
        <details open={!current} className="rounded-lg border border-line bg-bg-2 px-3 py-2 text-xs text-text-2">
          <summary className="cursor-pointer text-[13px] font-semibold text-text">Where to find these</summary>
          <p className="mt-1.5 leading-relaxed">{k.help}</p>
        </details>
      )}
      {fields.map((f) => (
        <Fragment key={f.key}>
          {oneOf?.from === f.key && <p className="-mb-2 text-xs text-text-2">{oneOf.note}</p>}
          <Field label={f.optional && !oneOf?.keys.includes(f.key) ? `${f.label} (optional)` : f.label}>
            <input
              type={f.secret ? 'password' : 'text'}
              autoComplete="off"
              spellCheck={false}
              value={values[f.key] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              required={!f.optional && (!f.secret || !isSet(f.key))}
              placeholder={f.secret && isSet(f.key) ? 'Saved. Leave blank to keep it.' : f.placeholder}
              className={inputClass}
            />
          </Field>
        </Fragment>
      ))}
      {canConnect && (
        <button type="button" onClick={() => setManual((m) => !m)} className="w-fit cursor-pointer text-xs text-muted hover:text-white">
          {manual ? `Use Connect with ${k.name} instead` : 'Paste the tokens manually instead'}
        </button>
      )}
      {otherShop && (
        <p role="status" className="rounded-lg border border-red/35 bg-red-soft p-2.5 text-xs text-red">
          This is another shop: saving drops the old shop's orders, products and unit costs from {store?.name ?? 'this store'}, and the new one syncs
          from scratch.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-red">
          {error.message}
        </p>
      )}
      {confirm && current ? (
        // Keyed: otherwise React reuses the footer's Cancel button as Keep, and autoFocus only fires on mount.
        <div key="confirm" className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
          <span className="mr-auto text-xs text-text-2">Disconnect? Syncing stops until you connect again.</span>
          <Button autoFocus onClick={() => setConfirm(false)}>
            Keep
          </Button>
          <Button variant="primary" disabled={remove.isPending} onClick={() => remove.mutate(current.id, { onSuccess: onDone })}>
            Disconnect
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
          {current && (
            <button ref={disconnect} type="button" onClick={() => setConfirm(true)} className="mr-auto cursor-pointer text-xs text-muted hover:text-red">
              Disconnect
            </button>
          )}
          <Button onClick={onDone}>Cancel</Button>
          {viaConnect && current && (
            <Button disabled={oauth.start.isPending} onClick={(e) => e.currentTarget.form?.reportValidity() && connect()}>
              Reconnect
            </Button>
          )}
          <Button type="submit" variant="primary" disabled={save.isPending || oauth.start.isPending}>
            {current ? 'Save' : viaConnect ? `Connect with ${k.name}` : `Connect ${k.name}`}
          </Button>
        </div>
      )}
    </form>
  );
}
