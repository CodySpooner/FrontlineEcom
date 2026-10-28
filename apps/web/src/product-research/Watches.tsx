import { useState } from 'react';
import type { PrFacet, PrWatch, PrWatchPrefs, Store } from '@frontline/shared';
import { Button, ErrorState, inputClass, LoadingState } from '../components/ui';
import { useAddWatch, useCheckWatch, useUnwatch, useWatches, useWatchPrefs } from './api';
import { Pill } from './Card';

const KIND: Record<PrWatch['kind'], string> = { product: 'Product', listing: 'Product', niche: 'Niche', offer: 'Offer' };
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

/** The Watchlist view's watches (PR-21): checked every 12 hours, with their last check, what it covered and the newest alerts. */
export function Watches({ store, categories, onOpen }: { store: Store | null; categories: PrFacet[]; onOpen: (id: string) => void }) {
  const sid = store?.id ?? null;
  const q = useWatches(sid);
  const add = useAddWatch(sid);
  const [niche, setNiche] = useState('');
  if (q.isPending) return <LoadingState rows={2} />;
  if (q.isError) return <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />;
  return (
    <section aria-label="Watches" className="mt-3 grid gap-2 rounded-[10px] border border-line bg-panel p-3 text-xs text-text-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[13px] font-semibold text-text">What you watch</h2>
          <p className="text-muted">Checked every 12 hours. One alert per change, also in the bell unless research alerts are off in Settings.</p>
        </div>
        <form className="flex items-center gap-1.5" onSubmit={(e) => (e.preventDefault(), niche && add.mutate({ kind: 'niche', targetId: niche }, { onSuccess: () => setNiche('') }))}>
          <select aria-label="Niche to watch" value={niche} onChange={(e) => setNiche(e.target.value)} className={`${inputClass} py-1.5 text-xs`}>
            <option value="">A niche…</option>
            {categories
              .filter((c) => c.label !== 'Category unknown')
              .map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
          </select>
          <Button size="sm" type="submit" disabled={!niche || add.isPending}>
            Watch niche
          </Button>
        </form>
      </div>
      {add.error && (
        <p role="alert" className="text-red">
          {add.error.message}
        </p>
      )}
      {q.data.length ? (
        q.data.map((w) => <WatchRow key={w.id} w={w} store={sid} onOpen={onOpen} />)
      ) : (
        <p className="text-muted">Nothing watched yet: watch a product from its panel, an offer from its Suppliers tab, or a niche here.</p>
      )}
    </section>
  );
}

function WatchRow({ w, store, onOpen }: { w: PrWatch; store: string | null; onOpen: (id: string) => void }) {
  const check = useCheckWatch(store);
  const unwatch = useUnwatch(store);
  const save = useWatchPrefs(store);
  const [prefs, setPrefs] = useState(w.prefs);
  const own = w.storeId === store;
  const busy = check.isPending || unwatch.isPending || save.isPending;
  const error = check.error ?? unwatch.error ?? save.error;
  const flag = (k: Exclude<keyof PrWatchPrefs, 'priceChangePct'>, label: string) => (
    <label className="inline-flex items-center gap-1.5">
      <input type="checkbox" checked={prefs[k]} onChange={(e) => setPrefs({ ...prefs, [k]: e.target.checked })} className="accent-red" />
      {label}
    </label>
  );
  return (
    <article aria-label={`Watch: ${w.label}`} className="rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="flex flex-wrap items-center gap-1.5">
          <Pill tone="muted">{KIND[w.kind]}</Pill>
          {w.productId ? (
            <button type="button" onClick={() => onOpen(w.productId!)} className="cursor-pointer font-semibold text-text hover:underline">
              {w.label}
            </button>
          ) : (
            <b className="text-text">{w.label}</b>
          )}
          {!w.storeId && <span className="text-muted">· All-stores list</span>}
        </span>
        {own ? (
          <span className="flex gap-1.5">
            <Button size="sm" disabled={busy} onClick={() => check.mutate({ id: w.id })}>
              {check.isPending ? 'Checking…' : 'Check now'}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => unwatch.mutate({ id: w.id })}>
              Stop watching
            </Button>
          </span>
        ) : (
          <span className="text-muted">Change it in All stores</span>
        )}
      </div>
      <p className="mt-1 text-muted">
        {w.lastSuccessAt ? `Last successful check ${when(w.lastSuccessAt)}` : w.lastCheckedAt ? 'No successful check yet' : 'Not checked yet: the first check records the starting point'}
      </p>
      {w.coverage && <p className="text-[#f5b84a]">{`Partial coverage: ${w.coverage}`}</p>}
      {w.lastError && w.lastCheckedAt && <p className="text-[#ff5a66]">{`Last check failed ${when(w.lastCheckedAt)}: ${w.lastError}`}</p>}
      {w.alerts.length > 0 && (
        <ul aria-label="Alerts" className="mt-1.5 grid gap-1 border-t border-line pt-1.5">
          {w.alerts.map((a) => (
            <li key={a.id}>
              <b className="text-text">{a.title}</b>
              <span className="text-muted">{`${a.body ? ` · ${a.body}` : ''} · ${when(a.createdAt)}`}</span>
            </li>
          ))}
        </ul>
      )}
      {own && w.kind !== 'niche' && (
        <details className="mt-1.5">
          <summary className="cursor-pointer text-muted">Alert on</summary>
          <form
            className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5"
            onSubmit={(e) => (e.preventDefault(), save.mutate({ id: w.id, prefs }))}
          >
            <label className="inline-flex items-center gap-1.5">
              Cost + ship moves by
              <input
                type="number"
                min={1}
                max={100}
                required
                value={prefs.priceChangePct}
                onChange={(e) => setPrefs({ ...prefs, priceChangePct: e.target.valueAsNumber })}
                className={`${inputClass} w-16 py-1 text-xs`}
              />
              % or more
            </label>
            {flag('stockOut', 'Out of stock')}
            {flag('shippingChange', 'Shipping change')}
            {flag('newEvidence', 'New evidence')}
            <Button size="sm" type="submit" disabled={busy || JSON.stringify(prefs) === JSON.stringify(w.prefs)}>
              Save
            </Button>
          </form>
        </details>
      )}
      {w.kind === 'niche' && <p className="mt-1 text-muted">Alerts when a new product appears in this category.</p>}
      {error && (
        <p role="alert" className="mt-1 text-red">
          {error.message}
        </p>
      )}
    </article>
  );
}
