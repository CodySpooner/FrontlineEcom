import { Link } from 'react-router';
import { PR_RECOMMENDATION_LABEL, type PrOutcomeProduct, type PrOutcomes } from '@frontline/shared';
import { Button, ErrorState, LoadingState } from '../components/ui';
import { useOutcomes, useSaveOutcome } from './api';
import { minorMoney } from './format';

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const kb = (cardId: string) => `/knowledge?card=${encodeURIComponent(cardId)}`;

/**
 * Outcomes (PR-25, spec §12): what happened after the research in this store, beside what was assumed, with the
 * context it happened in. Read-only: nothing here changes the research.
 */
export function Outcomes({ id, store }: { id: string; store: string }) {
  const q = useOutcomes(id, store);
  return (
    <section aria-label="Outcomes" className="border-t border-line pt-3.5">
      <h3 className="mb-1.5 text-[11px] font-semibold tracking-[.07em] text-muted uppercase">Outcomes</h3>
      {q.isPending ? <LoadingState rows={2} /> : q.isError ? <ErrorState message={q.error.message} onRetry={() => void q.refetch()} /> : <Body id={id} store={store} o={q.data} />}
    </section>
  );
}

function Body({ id, store, o }: { id: string; store: string; o: PrOutcomes }) {
  const m = (minor: number) => minorMoney(minor, o.currency);
  return (
    <div className="grid gap-2 text-text-2">
      {o.research && <p>{`Research said: ${PR_RECOMMENDATION_LABEL[o.research.recommendation]} (${day(o.research.at)}).`}</p>}
      {o.products.length > 0 && <p>{o.assumed ? `Assumed (base economics): ${m(o.assumed.price)} selling price, ${m(o.assumed.contribution)} contribution before ads per order.` : 'No base economics to compare with: set them in Economics.'}</p>}
      {o.products.length ? (
        o.products.map((p) => <Product key={p.storeProductId} id={id} store={store} p={p} o={o} />)
      ) : (
        <p className="text-muted">Outcomes show once the product is in the store: prepare a draft product from the test brief, or link it as already in your store.</p>
      )}
      {o.experiments.map((e) => (
        <p key={e.id}>{`Experiment ${e.label}: ${e.status}${e.result ? `, ${e.result}` : ''}`}</p>
      ))}
      {o.lessons.length > 0 && (
        <ul aria-label="Lessons" className="grid gap-0.5">
          {o.lessons.map((l) => (
            <li key={l.cardId}>
              <Link to={kb(l.cardId)} className="text-red hover:underline">
                {l.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Product({ id, store, p, o }: { id: string; store: string; p: PrOutcomeProduct; o: PrOutcomes }) {
  const save = useSaveOutcome(id, store);
  const m = (minor: number) => minorMoney(minor, o.currency);
  const s = p.observed;
  return (
    <article aria-label={`Outcome: ${p.title ?? 'a removed store product'}`} className="grid gap-1 rounded-lg border border-line p-3">
      <p>
        <b className="text-text">{p.title ?? 'No longer in the store'}</b>
        {p.status && ` · ${p.status[0]!.toUpperCase()}${p.status.slice(1)}`}
        {p.test ? ` · added through an approved request on ${p.test.addedOn}` : ''}
      </p>
      <p className="text-muted">{`${p.period.from} to ${p.period.to}`}</p>
      {!s ? (
        <p>A demo store's orders are generated: they never count as outcomes.</p>
      ) : !s.units ? (
        <p>No paid orders in this period yet.</p>
      ) : (
        <>
          <p>{`${s.units} sold, ${m(s.revenue)} revenue, ${s.uncosted ? 'profit unknown (no unit cost)' : `${m(s.profit)} profit after unit cost and store fees`}.`}</p>
          <p>
            {`Per unit: ${s.pricePerUnit === null ? '—' : m(s.pricePerUnit)} revenue${o.assumed ? ` (assumed ${m(o.assumed.price)})` : ''}, `}
            {`${s.profitPerUnit === null ? 'unknown' : m(s.profitPerUnit)} profit before shipping, returns and ads${o.assumed ? ` (assumed ${m(o.assumed.contribution)} contribution before ads)` : ''}.`}
          </p>
        </>
      )}
      <p className="text-muted">
        {`Context: offer ${p.offer ? `${m(p.offer.price)}${p.offer.compareAt ? ` (compare at ${m(p.offer.compareAt)})` : ''}` : 'unknown'}, inventory ${p.inventory ?? 'unknown'}, audience ${o.audience ?? 'not set'}; creative and ad spend aren't tracked per product. Sales alone don't show the product caused the result.`}
      </p>
      {p.cardId ? (
        <Link to={kb(p.cardId)} className="text-red hover:underline">
          In the Knowledge Base
        </Link>
      ) : (
        s?.units ? (
          <Button size="sm" className="justify-self-start" disabled={save.isPending} onClick={() => save.mutate({ storeProductId: p.storeProductId })}>
            Save outcome to Knowledge Base
          </Button>
        ) : null
      )}
      {save.error && (
        <p role="alert" className="text-red">
          {save.error.message}
        </p>
      )}
    </article>
  );
}
