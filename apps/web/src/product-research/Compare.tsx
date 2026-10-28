import { useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import {
  econInputs,
  PR_COMPARE_FIELDS,
  PR_COMPARE_MAX,
  PR_DEMAND_LEVEL_LABEL,
  PR_ECON_LABEL,
  PR_ECON_PERCENT,
  PR_FIT_LABEL,
  PR_FULFILLMENT_LABEL,
  PR_STAGE_LABEL,
  unitEconomics,
  type PrCompareField,
  type PrComparison,
  type PrEconomics,
  type PrProductDetail,
  type Store,
} from '@frontline/shared';
import { Button, cx, Dialog, inputClass } from '../components/ui';
import { useComparisons, useCompared, useDeleteComparison, useSaveComparison } from './api';
import { countryName, fromMinor, joinItems, minorMoney, toMinor } from './format';

type Figures = Partial<Record<PrCompareField, string>>;
type Cell = ReactNode | { missing: string };
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const pct = (k: PrCompareField) => PR_ECON_PERCENT.includes(k);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The comparison tray (store scope): the products the owner added from the panel, and the store's saved comparisons. */
export function CompareBar({ store, ids, setIds, shipTo }: { store: Store; ids: string[]; setIds: (ids: string[]) => void; shipTo: string | null }) {
  const saved = useComparisons(store.id);
  const { details } = useCompared(store.id, ids);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<PrComparison | null>(null);
  if (!ids.length && !saved.data?.length) return null;
  return (
    <div role="region" aria-label="Comparison" className="mt-3 flex flex-wrap items-center gap-2 rounded-[10px] border border-line bg-panel px-3 py-2 text-xs text-text-2">
      <b className="text-text">{`Compare ${ids.length} of ${PR_COMPARE_MAX}`}</b>
      {ids.map((id, i) => {
        const title = details[i]?.data?.card.title ?? 'Loading…';
        return (
          <span key={id} className="inline-flex max-w-[220px] items-center gap-1 rounded-full border border-line-2 py-0.5 pr-1 pl-2.5">
            <span className="truncate">{title}</span>
            <button type="button" aria-label={`Remove ${title} from the comparison`} onClick={() => setIds(ids.filter((x) => x !== id))} className="cursor-pointer rounded-full p-0.5 text-muted hover:text-text">
              <X aria-hidden className="size-3" />
            </button>
          </span>
        );
      })}
      <span className="ml-auto flex gap-2">
        <Button size="sm" variant="primary" disabled={ids.length < 2} title={ids.length < 2 ? 'Add at least 2 products from their panel' : undefined} onClick={() => setOpen(true)}>
          Open comparison
        </Button>
        {!!saved.data?.length && (
          <Button size="sm" onClick={() => setOpen(true)}>
            {`Saved comparisons (${saved.data.length})`}
          </Button>
        )}
      </span>
      {open && (
        <CompareDialog
          store={store}
          ids={ids}
          setIds={setIds}
          shipTo={shipTo}
          saved={saved.data ?? []}
          loaded={loaded}
          onLoad={(c) => (c && setIds(c.productIds), setLoaded(c))}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

interface Props {
  store: Store;
  ids: string[];
  setIds: (ids: string[]) => void;
  shipTo: string | null;
  saved: PrComparison[];
  loaded: PrComparison | null;
  onLoad: (c: PrComparison | null) => void;
}

function CompareDialog({ onClose, ...p }: Props & { onClose: () => void }) {
  const rateDate = useCompared(p.store.id, p.ids).economics.map((q) => q.data?.rateDate).find(Boolean);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Compare products"
      width={1080}
      subtitle={`Ship to ${p.shipTo ? countryName(p.shipTo) : 'not set'} · ${p.store.currency} · figures as of ${day(new Date().toISOString())}${rateDate ? ` · exchange rate of ${rateDate}` : ''}`}
    >
      <CompareBody key={p.loaded?.id ?? 'new'} {...p} />
    </Dialog>
  );
}

function CompareBody({ store, ids, setIds, shipTo, saved, loaded, onLoad }: Props) {
  const cur = store.currency;
  const text = (k: PrCompareField, v: number) => (pct(k) ? String(v) : fromMinor(v, cur));
  const [draft, setDraft] = useState<Figures>(() => Object.fromEntries(Object.entries(loaded?.figures ?? {}).map(([k, v]) => [k, text(k as PrCompareField, v)])));
  const [name, setName] = useState(loaded?.name ?? '');
  const save = useSaveComparison(store.id, loaded?.id ?? null);
  const remove = useDeleteComparison(store.id);
  const { details, economics } = useCompared(store.id, ids);

  // The shared figures as typed; text that isn't a figure is an error, never a guess.
  const figures: Partial<Record<PrCompareField, number>> = {};
  const errors: string[] = [];
  for (const [k, t] of Object.entries(draft) as [PrCompareField, string][]) {
    if (!t.trim()) continue;
    const v = pct(k) ? (/^\d+(\.\d+)?$/.test(t.trim()) && Number(t) <= 100 ? Number(t) : null) : toMinor(t, cur);
    if (v === null) errors.push(`${PR_ECON_LABEL[k]} must be ${pct(k) ? 'a percentage from 0 to 100' : 'an amount like 4.50'}`);
    else figures[k] = v;
  }
  const money = (m: number) => minorMoney(m, cur);
  const inputs = (e: PrEconomics) => ({ ...econInputs(e, 'base'), ...figures });
  const own = economics.map((q) => q.data && econInputs(q.data, 'base'));
  // Left to each product's own figure where those differ: the comparison isn't like for like until the owner sets one.
  const differs = PR_COMPARE_FIELDS.filter((k) => figures[k] === undefined && new Set(own.map((i) => (i ? String(i[k]) : null)).filter((x) => x !== null)).size > 1);
  const moved = loaded && (loaded.destination !== shipTo || loaded.currency !== cur);

  const rows: [string, (d: PrProductDetail, e: PrEconomics | undefined) => Cell][] = [
    ['Stage', (d) => (d.card.stage ? PR_STAGE_LABEL[d.card.stage] : { missing: 'Not in this store' })],
    ['Store fit', (d) => (d.assessment.fit ? `${PR_FIT_LABEL[d.assessment.fit.fit]}: ${d.assessment.fit.reasons[0] ?? ''}` : { missing: 'Not assessed yet' })],
    [
      'Demand evidence',
      (d) =>
        d.assessment.demand.level === 'none'
          ? { missing: 'No qualifying demand set' }
          : [PR_DEMAND_LEVEL_LABEL[d.assessment.demand.level], plural(d.assessment.demand.sets, 'set'), d.assessment.demand.ownOrders ? 'incl. your orders' : null].filter(Boolean).join(' · '),
    ],
    [
      'Cost + ship, excl. duties',
      (d) => (d.card.costShip === null ? { missing: d.card.fulfillment?.reasons[0] ?? 'No verified offer' } : `${money(d.card.costShip)} · ${PR_FULFILLMENT_LABEL[d.card.fulfillment!.status]}`),
    ],
    ['Supplier', (d) => (d.card.conditions ? `${d.card.conditions.supplier} · checked ${day(d.card.conditions.checkedAt)}` : { missing: 'No offer for this ship-to' })],
    [
      'Shipping',
      (d) => {
        const c = d.card.conditions;
        if (!c) return { missing: 'No offer for this ship-to' };
        return [c.method ?? 'Method unknown', c.deliveryMax === null ? 'delivery time missing' : `up to ${c.deliveryMax} days`, c.shipsFrom ? `from ${countryName(c.shipsFrom)}` : 'origin missing'].join(' · ');
      },
    ],
    [
      'Risks',
      (d) => {
        const f = d.assessment.flags;
        if (!f) return { missing: 'Not checked yet' };
        const all = [...f.map((x) => x.label), ...(d.assessment.report?.risks ?? [])];
        return all.length ? joinItems(all) : 'No flags found (rule checks only), no report risks';
      },
    ],
    ['Evidence confidence', (d) => `${d.assessment.confidence.level[0]!.toUpperCase()}${d.assessment.confidence.level.slice(1)} (${d.assessment.confidence.count} of 4)`],
    ['Selling price', (_, e) => (!e ? { missing: 'Loading' } : econInputs(e, 'base').price === null ? { missing: 'Needs a selling price' } : money(econInputs(e, 'base').price!))],
    [
      'Contribution before ads',
      (_, e) => {
        if (!e) return { missing: 'Loading' };
        const r = unitEconomics(inputs(e));
        return r.figures ? money(r.figures.before) : { missing: r.missing.map((k) => PR_ECON_LABEL[k]).join(', ') };
      },
    ],
    [
      'Contribution after ads',
      (_, e) => {
        const f = e && unitEconomics(inputs(e)).figures;
        return !f ? { missing: 'Needs the figures above' } : f.after === null ? { missing: 'Needs ad cost' } : money(f.after);
      },
    ],
    [
      'Break-even ROAS',
      (_, e) => {
        const f = e && unitEconomics(inputs(e)).figures;
        return !f ? { missing: 'Needs the figures above' } : f.breakEvenRoas === null ? 'Not meaningful' : `${f.breakEvenRoas.toFixed(2)}×`;
      },
    ],
    [
      'Left out of the figures',
      (_, e) => {
        const x = e && unitEconomics(inputs(e)).excluded;
        return x?.length ? x.map((k) => PR_ECON_LABEL[k]).join(', ') : 'Nothing';
      },
    ],
  ];
  const show = (c: Cell) => (c && typeof c === 'object' && 'missing' in c ? <span className="text-muted italic">{`Missing: ${c.missing}`}</span> : c);

  return (
    <div className="grid gap-4 text-xs text-text-2">
      {moved && (
        <p role="status" className="rounded-lg border border-line-2 px-3 py-2">
          {`Saved for ${loaded.destination ? countryName(loaded.destination) : 'no ship-to'} in ${loaded.currency}; the store now ships to ${shipTo ? countryName(shipTo) : 'no country'} in ${cur}, so these figures are for that.`}
        </p>
      )}
      {ids.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] table-fixed border-collapse">
            <thead>
              <tr>
                <th className="w-[150px]" />
                {ids.map((id, i) => {
                  const title = details[i]?.data?.card.title ?? (details[i]?.isError ? 'Not found' : 'Loading…');
                  return (
                    <th key={id} scope="col" className="px-2 pb-2 text-left align-top text-[13px] font-semibold text-text">
                      <span className="flex items-start justify-between gap-1">
                        {title}
                        <button type="button" aria-label={`Remove ${title} from the comparison`} onClick={() => setIds(ids.filter((x) => x !== id))} className="cursor-pointer p-0.5 text-muted hover:text-text">
                          <X aria-hidden className="size-3.5" />
                        </button>
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, f]) => (
                <tr key={label} className="border-t border-dashed border-line">
                  <th scope="row" className="py-1.5 pr-2 text-left align-top font-normal text-muted">
                    {label}
                  </th>
                  {ids.map((id, i) => {
                    const d = details[i]?.data;
                    return (
                      <td key={id} className="px-2 py-1.5 align-top">
                        {d ? show(f(d, economics[i]?.data)) : show({ missing: details[i]?.isError ? 'This product is no longer in the catalog' : 'Loading' })}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-muted">No products in the comparison: add them with Compare in a product's panel, or open a saved comparison.</p>
      )}

      <section className="grid gap-2 border-t border-line pt-3">
        <h3 className="text-[11px] font-semibold tracking-[.07em] text-muted uppercase">Assumptions for every product</h3>
        <p className="text-muted">Price, supplier cost, shipping, duties and other costs stay each product's own. Set a figure here to use it for all of them; empty uses each product's own (its Economics tab).</p>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
          {PR_COMPARE_FIELDS.map((k) => (
            <label key={k} className="grid gap-1">
              <span>{`${PR_ECON_LABEL[k]} (${pct(k) ? '%' : cur})`}</span>
              <input className={cx(inputClass, 'text-right')} inputMode="decimal" placeholder="Each product's own" value={draft[k] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} />
            </label>
          ))}
        </div>
        {differs.length > 0 && <p className="text-text">{`Not like for like yet: the products' own ${differs.map((k) => PR_ECON_LABEL[k].toLowerCase()).join(', ')} differ. Set one figure above to compare them on the same terms.`}</p>}
        {errors.length > 0 && (
          <ul role="alert" className="text-red">
            {errors.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        )}
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({ name: name.trim(), productIds: ids, figures }, { onSuccess: (c) => onLoad(c) });
          }}
        >
          <label className="grid gap-1">
            Name
            <input className={cx(inputClass, 'w-[240px]')} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <Button size="sm" variant="primary" type="submit" disabled={!name.trim() || !ids.length || errors.length > 0 || save.isPending}>
            {loaded ? 'Save changes' : 'Save comparison'}
          </Button>
          {loaded && (
            <Button size="sm" variant="ghost" onClick={() => onLoad(null)}>
              Start a new one
            </Button>
          )}
        </form>
        {(save.error ?? remove.error) && (
          <p role="alert" className="text-red">
            {(save.error ?? remove.error)!.message}
          </p>
        )}
      </section>

      {saved.length > 0 && (
        <section className="grid gap-1.5 border-t border-line pt-3">
          <h3 className="text-[11px] font-semibold tracking-[.07em] text-muted uppercase">Saved comparisons</h3>
          <ul className="grid gap-1.5">
            {saved.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2">
                <b className={cx(c.id === loaded?.id ? 'text-red' : 'text-text')}>{c.name}</b>
                <span className="text-muted">{`${plural(c.productIds.length, 'product')} · saved ${day(c.updatedAt)}`}</span>
                <span className="ml-auto flex gap-1.5">
                  <Button size="sm" disabled={c.id === loaded?.id} onClick={() => onLoad(c)}>
                    Open
                  </Button>
                  <Button size="sm" variant="ghost" aria-label={`Delete ${c.name}`} disabled={remove.isPending} onClick={() => remove.mutate({ id: c.id }, { onSuccess: () => c.id === loaded?.id && onLoad(null) })}>
                    Delete
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
