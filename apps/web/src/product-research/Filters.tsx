import { useState, type ReactNode } from 'react';
import { NICHES, PR_FIT_LABEL, PR_FULFILLMENT_LABEL, PR_STAGE_LABEL, PR_STAGES, type PrDiscovery, type PrFacet, type PrFit, type PrFulfillment, type PrSort, type PrStage, type PrView } from '@frontline/shared';
import { Button, cx, Dialog, Field, inputClass } from '../components/ui';
import { fromMinor, toMinor } from './format';

/** The page's filters (decision 14: persisted as `fe.research.filters`). Money is in minor units of the page currency. */
export interface Filters {
  category?: string;
  source?: string;
  warehouse?: string;
  costMax?: number;
  deliveryMax?: number;
  evidenceDays?: number;
  stage?: PrStage;
  niche?: string;
  supplier?: string;
  unitMax?: number;
  shipMax?: number;
  fit?: PrFit;
  flags?: 'any' | 'none';
  availability?: PrFulfillment | 'unchecked';
  /** Filters whose unknowns are dropped (the chip's "unknown included" switched off). */
  strict?: string[];
}
// Each filter that keeps a product with an unknown value, by the server's `strict` name (discovery.ts LENIENT).
const LENIENT: Partial<Record<keyof Filters, string>> = { category: 'category', warehouse: 'warehouse', costMax: 'cost', deliveryMax: 'delivery', evidenceDays: 'evidence', niche: 'niche', unitMax: 'unit', shipMax: 'ship' };
const STORE_ONLY: (keyof Filters)[] = ['stage', 'fit'];

/** The discovery query string for a scope (`store` null: All stores), the filters, sort, view and search. */
export function discoveryQuery(o: { store: string | null; shipTo: string; view: PrView; sort: PrSort; q: string; filters: Filters }) {
  const p = new URLSearchParams();
  if (o.store) p.set('store', o.store);
  else p.set('shipTo', o.shipTo);
  if (o.q.trim()) p.set('q', o.q.trim());
  p.set('view', o.view);
  p.set('sort', o.sort);
  const strict: string[] = [];
  for (const [k, v] of Object.entries(o.filters) as [keyof Filters, unknown][]) {
    if (k === 'strict' || v === undefined || v === '' || (!o.store && STORE_ONLY.includes(k))) continue;
    p.set(k, String(v));
    if (LENIENT[k] && o.filters.strict?.includes(LENIENT[k])) strict.push(LENIENT[k]);
  }
  if (strict.length) p.set('strict', strict.join(','));
  p.set('limit', '48');
  return p.toString();
}

/** The filters that are set in this scope, for "Clear filters" and the no-match state. */
export const activeFilters = (f: Filters, store: string | null) => (Object.keys(f) as (keyof Filters)[]).filter((k) => k !== 'strict' && f[k] !== undefined && f[k] !== '' && (store || !STORE_ONLY.includes(k)));

const SELECT = 'cursor-pointer border-0 bg-transparent px-1 font-semibold text-text [field-sizing:content] focus:outline-none';

/** A chip from the board (`.chip`): its label, its value control, and "unknown included" while it keeps unknowns. */
function Chip({ label, lenient, filters, set, k, children }: { label: string; lenient?: boolean; filters: Filters; set: (f: Filters) => void; k: keyof Filters; children: ReactNode }) {
  const name = LENIENT[k];
  const on = filters[k] !== undefined && filters[k] !== '';
  const strict = !!name && !!filters.strict?.includes(name);
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full border bg-[#0e0e11] py-1 pr-1.5 pl-2.5 text-xs whitespace-nowrap text-text-2', on ? 'border-red/45' : 'border-[#33333b]')}>
      <label className="flex items-center">
        {label}
        {children}
      </label>
      {lenient && on && name && (
        <button
          type="button"
          aria-pressed={!strict}
          title={strict ? 'Products with an unknown value are hidden. Click to include them.' : 'Products with an unknown value are kept. Click to hide them.'}
          onClick={() => set({ ...filters, strict: strict ? filters.strict!.filter((s) => s !== name) : [...(filters.strict ?? []), name] })}
          className="cursor-pointer rounded-full px-1.5 text-[11px] text-muted hover:text-text"
        >
          {strict ? 'unknown excluded' : 'unknown included'}
        </button>
      )}
    </span>
  );
}

const facetOptions = (facets: PrFacet[]) => facets.map((f) => <option key={f.value} value={f.value}>{`${f.label} (${f.n})`}</option>);

/** Money typed in the page currency: "15" → 1500 minor units, a blank → no filter. */
function MoneyInput({ label, value, currency, onChange, className }: { label: string; value: number | undefined; currency: string; onChange: (v: number | undefined) => void; className?: string }) {
  const [text, setText] = useState(fromMinor(value ?? null, currency));
  return (
    <input
      aria-label={label}
      inputMode="decimal"
      placeholder="Any"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const v = toMinor(e.target.value, currency);
        if (v !== null || !e.target.value.trim()) onChange(v ?? undefined);
      }}
      className={className}
    />
  );
}

const DAYS = [7, 10, 12, 15, 20, 30];
const AGES = [[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'Last year']] as const;
const num = (v: string) => (v ? Number(v) : undefined);

/** The chip row: Category, Source, Warehouse, Cost + shipping, Delivery, Evidence age, Stage (store scope), More filters. */
export function FilterChips({ d, filters, set, store, currency }: { d: PrDiscovery | undefined; filters: Filters; set: (f: Filters) => void; store: string | null; currency: string }) {
  const [more, setMore] = useState(false);
  const f = d?.facets;
  const chip = { filters, set };
  const pick = (k: keyof Filters) => (v: string | number | undefined) => set({ ...filters, [k]: v === '' ? undefined : v });
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Chip label="Category" k="category" lenient {...chip}>
        <select aria-label="Category" value={filters.category ?? ''} onChange={(e) => pick('category')(e.target.value)} className={SELECT}>
          <option value="">Any</option>
          {facetOptions(f?.categories ?? [])}
        </select>
      </Chip>
      <Chip label="Source" k="source" {...chip}>
        <select aria-label="Source" value={filters.source ?? ''} onChange={(e) => pick('source')(e.target.value)} className={SELECT}>
          <option value="">Any</option>
          {facetOptions(f?.sources ?? [])}
        </select>
      </Chip>
      <Chip label="Warehouse" k="warehouse" lenient {...chip}>
        <select aria-label="Warehouse" value={filters.warehouse ?? ''} onChange={(e) => pick('warehouse')(e.target.value)} className={SELECT}>
          <option value="">Any</option>
          {facetOptions(f?.warehouses ?? [])}
        </select>
      </Chip>
      <Chip label="Cost + shipping, excl. duties ≤" k="costMax" lenient {...chip}>
        <MoneyInput key={currency} label="Cost + shipping, excl. duties at most" value={filters.costMax} currency={currency} onChange={pick('costMax')} className={cx(SELECT, 'w-14')} />
      </Chip>
      <Chip label="Delivery ≤" k="deliveryMax" lenient {...chip}>
        <select aria-label="Delivery at most" value={filters.deliveryMax ?? ''} onChange={(e) => pick('deliveryMax')(num(e.target.value))} className={SELECT}>
          <option value="">Any</option>
          {DAYS.map((n) => (
            <option key={n} value={n}>{`${n} days`}</option>
          ))}
        </select>
      </Chip>
      <Chip label="Evidence age" k="evidenceDays" lenient {...chip}>
        <select aria-label="Evidence age" value={filters.evidenceDays ?? ''} onChange={(e) => pick('evidenceDays')(num(e.target.value))} className={SELECT}>
          <option value="">Any</option>
          {AGES.map(([n, l]) => (
            <option key={n} value={n}>
              {l}
            </option>
          ))}
        </select>
      </Chip>
      {store && (
        <Chip label="Stage" k="stage" {...chip}>
          <select aria-label="Stage" value={filters.stage ?? ''} onChange={(e) => pick('stage')(e.target.value)} className={SELECT}>
            <option value="">Any</option>
            {PR_STAGES.map((s) => (
              <option key={s} value={s}>
                {PR_STAGE_LABEL[s]}
              </option>
            ))}
          </select>
        </Chip>
      )}
      <Button size="sm" onClick={() => setMore(true)}>
        More filters
      </Button>
      {d && <span className="ml-auto text-xs text-muted">{`${d.total.toLocaleString('en-US')} match · filtered and sorted on the server`}</span>}
      <MoreFilters open={more} onClose={() => setMore(false)} d={d} filters={filters} set={set} store={store} currency={currency} />
    </div>
  );
}

const Unknown = ({ k, filters, set }: { k: keyof Filters; filters: Filters; set: (f: Filters) => void }) => {
  const name = LENIENT[k]!;
  const strict = !!filters.strict?.includes(name);
  return (
    <label className="flex items-center gap-1.5 text-[11.5px] text-muted">
      <input type="checkbox" checked={!strict} onChange={() => set({ ...filters, strict: strict ? filters.strict!.filter((s) => s !== name) : [...(filters.strict ?? []), name] })} />
      Unknown included
    </label>
  );
};

/** Niche, supplier, supplier cost, shipping cost, store fit, flags and availability for the destination. */
function MoreFilters({ open, onClose, d, filters, set, store, currency }: { open: boolean; onClose: () => void; d: PrDiscovery | undefined; filters: Filters; set: (f: Filters) => void; store: string | null; currency: string }) {
  const pick = (k: keyof Filters) => (v: string | number | undefined) => set({ ...filters, [k]: v === '' ? undefined : v });
  return (
    <Dialog open={open} onClose={onClose} title="More filters" side="right" subtitle="Applied on the server as you change them">
      <div className="grid gap-4 p-5">
        <Field label="Niche">
          <select value={filters.niche ?? ''} onChange={(e) => pick('niche')(e.target.value)} className={inputClass}>
            <option value="">Any</option>
            {NICHES.filter((n) => n !== 'other').map((n) => (
              <option key={n} value={n}>
                {n.charAt(0).toUpperCase() + n.slice(1)}
              </option>
            ))}
          </select>
        </Field>
        {filters.niche && <Unknown k="niche" filters={filters} set={set} />}
        <Field label="Supplier">
          <select value={filters.supplier ?? ''} onChange={(e) => pick('supplier')(e.target.value)} className={inputClass}>
            <option value="">Any</option>
            {facetOptions(d?.facets.suppliers ?? [])}
          </select>
        </Field>
        <Field label={`Supplier cost at most (${currency})`}>
          <MoneyInput key={currency} label={`Supplier cost at most (${currency})`} value={filters.unitMax} currency={currency} onChange={pick('unitMax')} className={inputClass} />
        </Field>
        {filters.unitMax !== undefined && <Unknown k="unitMax" filters={filters} set={set} />}
        <Field label={`Shipping cost at most (${currency})`}>
          <MoneyInput key={currency} label={`Shipping cost at most (${currency})`} value={filters.shipMax} currency={currency} onChange={pick('shipMax')} className={inputClass} />
        </Field>
        {filters.shipMax !== undefined && <Unknown k="shipMax" filters={filters} set={set} />}
        {store && (
          <Field label="Store fit">
            <select value={filters.fit ?? ''} onChange={(e) => pick('fit')(e.target.value)} className={inputClass}>
              <option value="">Any</option>
              {(Object.keys(PR_FIT_LABEL) as PrFit[]).map((v) => (
                <option key={v} value={v}>
                  {PR_FIT_LABEL[v]}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Flags">
          <select value={filters.flags ?? ''} onChange={(e) => pick('flags')(e.target.value)} className={inputClass}>
            <option value="">Any</option>
            <option value="none">No flags found</option>
            <option value="any">Has a flag</option>
          </select>
        </Field>
        <Field label={`Availability for ${d?.shipTo ?? 'the destination'}`}>
          <select value={filters.availability ?? ''} onChange={(e) => pick('availability')(e.target.value)} className={inputClass}>
            <option value="">Any</option>
            {(Object.keys(PR_FULFILLMENT_LABEL) as PrFulfillment[]).map((v) => (
              <option key={v} value={v}>
                {PR_FULFILLMENT_LABEL[v]}
              </option>
            ))}
            <option value="unchecked">Not checked yet</option>
          </select>
        </Field>
      </div>
    </Dialog>
  );
}
