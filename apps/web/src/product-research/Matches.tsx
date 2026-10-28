import { PR_FULFILLMENT_LABEL, type PrMatch, type PrMatchAction, type Store } from '@frontline/shared';
import { Button, ErrorState, LoadingState } from '../components/ui';
import { useMatchAction, useMatches, useSearchCj } from './api';
import { Pill, TONE } from './Card';
import { minorMoney } from './format';

const VERDICT: Record<PrMatch['verdict'], [string, keyof typeof TONE]> = { exact: ['Exact match', 'good'], similar: ['Similar', 'warn'], separate: ['Not the same product', 'muted'] };
const Heading = () => <h3 className="text-[11px] font-semibold tracking-[.07em] text-muted uppercase">Other suppliers</h3>;

/** The Suppliers tab's other suppliers (PR-20): listings a merge brought in, candidates with their verdict, CJ search. */
export function Alternatives({ id, store }: { id: string; store: Store | null }) {
  if (!store)
    return (
      <section className="grid gap-1.5 border-t border-line pt-3">
        <Heading />
        <p className="text-muted">Other suppliers are compared on a store's ship-to and currency: pick a store.</p>
      </section>
    );
  return <StoreAlternatives id={id} store={store} />;
}

function StoreAlternatives({ id, store }: { id: string; store: Store }) {
  const q = useMatches(store.id, id);
  const act = useMatchAction(store.id, id);
  const search = useSearchCj(store.id, id);
  if (q.isPending) return <LoadingState rows={3} />;
  if (q.isError) return <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />;
  const m = q.data;
  const on = (listing: string) => (action: PrMatchAction) => act.mutate({ listing, action });
  const open = m.candidates.filter((c) => c.verdict !== 'separate');
  const ruledOut = m.candidates.filter((c) => c.verdict === 'separate');
  const error = act.error ?? search.error;
  return (
    <section aria-label="Other suppliers" className="grid gap-2 border-t border-line pt-3">
      <Heading />
      <p className="text-muted">Exact match only on the same SKU, GTIN or MPN, or your confirmation; everything else is Similar. A merge keeps every listing.</p>
      {m.listings
        .filter((l) => l.mergedFrom)
        .map((l) => (
          <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3">
            <span>
              <b className="text-text">{l.title}</b>
              <span className="text-muted">{` · ${l.supplier} · merged into this product`}</span>
            </span>
            <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => on(l.id)('split')}>
              Separate
            </Button>
          </div>
        ))}
      {open.length ? (
        open.map((c) => <Candidate key={c.listingId} c={c} currency={store.currency} busy={act.isPending} act={on(c.listingId)} />)
      ) : (
        <p className="text-muted">No other supplier's listing matches this product yet.</p>
      )}
      {ruledOut.length > 0 && (
        <details>
          <summary className="cursor-pointer text-muted">{`Not the same product (${ruledOut.length})`}</summary>
          <ul className="mt-1.5 grid gap-1">
            {ruledOut.map((c) => (
              <li key={c.listingId} className="flex items-center justify-between gap-2">
                <span>{`${c.title} · ${c.supplier}`}</span>
                <Button size="sm" variant="ghost" aria-label={`Undo: ${c.title}`} disabled={act.isPending} onClick={() => on(c.listingId)('undo')}>
                  Undo
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {m.cj ? (
        <div>
          <Button size="sm" disabled={search.isPending} onClick={() => search.mutate()}>
            {search.isPending ? 'Searching…' : 'Search CJdropshipping (up to 3 calls)'}
          </Button>
          {search.data && <p role="status" className="mt-1 text-muted">{`${search.data.calls} calls, ${search.data.stored} products stored${search.data.error ? `; stopped: ${search.data.error}` : ''}.`}</p>}
        </div>
      ) : (
        <p className="text-muted">Connect CJdropshipping in Integrations to search its catalog for other suppliers too.</p>
      )}
      {error && (
        <p role="alert" className="text-red">
          {error.message}
        </p>
      )}
    </section>
  );
}

function Candidate({ c, currency, busy, act }: { c: PrMatch; currency: string; busy: boolean; act: (a: PrMatchAction) => void }) {
  const [label, tone] = VERDICT[c.verdict];
  return (
    <div aria-label={`${c.supplier}: ${c.title}`} className="rounded-lg border border-line p-3">
      <div className="flex items-start justify-between gap-2">
        <b className="text-text">{c.title}</b>
        <Pill tone={tone} className="shrink-0">{c.by === 'owner' ? `${label} (yours)` : label}</Pill>
      </div>
      <p className="mt-0.5 text-muted">{[c.supplier, c.category ?? 'Category unknown', c.fixture ? 'Test fixture' : null].filter(Boolean).join(' · ')}</p>
      <p className="mt-1">{`Cost + ship: ${c.costShip === null ? 'Unknown' : minorMoney(c.costShip, currency)}${c.fulfillment ? ` · ${PR_FULFILLMENT_LABEL[c.fulfillment]}` : ''}`}</p>
      <p className="text-muted">{`Matching: ${c.matching.join(', ') || 'nothing'}. Differing: ${c.differing.join(', ') || 'nothing'}.`}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {c.verdict === 'exact' ? (
          <Button size="sm" disabled={busy} onClick={() => act('merge')}>
            Merge into this product
          </Button>
        ) : (
          <Button size="sm" disabled={busy} onClick={() => act('same')}>
            Same product
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => act('not_same')}>
          Not the same
        </Button>
        {c.by === 'owner' && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => act('undo')}>
            Undo
          </Button>
        )}
      </div>
    </div>
  );
}
