import { useState } from 'react';
import { econInputs, PR_ECON_FIELDS, PR_ECON_LABEL, PR_ECON_PERCENT, unitEconomics, type PrEconField, type PrEconFigures, type PrEconomics, type PrEconOverrides, type PrEconResult } from '@frontline/shared';
import { Button, cx, ErrorState, inputClass, LoadingState, Segmented } from '../components/ui';
import { useEconomics, useSaveEconomics } from './api';
import { Pill } from './Card';
import { fromMinor, minorMoney, toMinor } from './format';

type Scenario = keyof PrEconOverrides;
const SCENARIOS: Scenario[] = ['conservative', 'base', 'optimistic'];
const SCENARIO_LABEL: Record<Scenario, string> = { conservative: 'Conservative', base: 'Base', optimistic: 'Optimistic' };
const FIXED = 'Fixed costs: apps and subscriptions, samples, photography, staff, storage';
type Draft = Record<Scenario, Partial<Record<PrEconField, string>>>;

const pct = (k: PrEconField) => PR_ECON_PERCENT.includes(k);
const labels = (ks: PrEconField[]) => ks.map((k) => PR_ECON_LABEL[k]).join(', ');

/** What a scenario lacks, in decision 13's words. */
export const incomplete = (r: PrEconResult) => (r.missing.length === 1 && r.missing[0] === 'price' ? 'Needs a selling price' : `Incomplete: missing ${labels(r.missing)}`);

/** The owner's typed figures as saved values; text that isn't a figure is an error, never a guess. */
function parse(draft: Draft, currency: string) {
  const values = { base: {}, conservative: {}, optimistic: {} } as PrEconOverrides;
  const errors: string[] = [];
  for (const s of SCENARIOS)
    for (const [k, text] of Object.entries(draft[s]) as [PrEconField, string][]) {
      const t = text.trim();
      if (!t) continue;
      const v = pct(k) ? (/^\d+(\.\d+)?$/.test(t) && Number(t) <= 100 ? Number(t) : null) : toMinor(t, currency);
      if (v === null) errors.push(`${SCENARIO_LABEL[s]}: ${PR_ECON_LABEL[k]} must be ${pct(k) ? 'a percentage from 0 to 100' : 'an amount like 4.50'}`);
      else values[s][k] = v;
    }
  return { values, errors };
}

/** The Economics tab (decision 13): three scenarios' results, and the inputs with where each came from. */
export function EconomicsTab({ id, store }: { id: string; store: string | null }) {
  if (!store) return <p className="text-xs text-muted">Economics are worked out per store, with its price, fees, currency and ship-to: pick a store.</p>;
  return <StoreEconomics id={id} store={store} />;
}

function StoreEconomics({ id, store }: { id: string; store: string }) {
  const q = useEconomics(store, id);
  if (q.isPending) return <LoadingState rows={5} />;
  if (q.isError) return <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />;
  return <Editor key={q.data.updatedAt ?? 'new'} e={q.data} id={id} store={store} />;
}

function Editor({ e, id, store }: { e: PrEconomics; id: string; store: string }) {
  const save = useSaveEconomics(store, id);
  const text = (k: PrEconField, v: number) => (pct(k) ? String(v) : fromMinor(v, e.currency));
  const fromSaved = (): Draft =>
    Object.fromEntries(SCENARIOS.map((s) => [s, Object.fromEntries(Object.entries(e.saved[s]).map(([k, v]) => [k, text(k as PrEconField, v)]))])) as Draft;
  const [draft, setDraft] = useState<Draft>(fromSaved);
  const [scenario, setScenario] = useState<Scenario>('base');
  const { values, errors } = parse(draft, e.currency);
  const mine = { derived: e.derived, saved: values };
  const results = Object.fromEntries(SCENARIOS.map((s) => [s, unitEconomics(econInputs(mine, s))])) as Record<Scenario, PrEconResult>;
  const base = econInputs(mine, 'base');
  const dirty = SCENARIOS.some((s) => PR_ECON_FIELDS.some((k) => values[s][k] !== e.saved[s][k]));
  const money = (m: number) => minorMoney(m, e.currency);
  const shown = (k: PrEconField, v: number | null) => (v === null ? 'Unknown' : pct(k) ? `${v}%` : money(v));
  const cell = (s: Scenario, f: (x: PrEconFigures) => string) => (results[s].figures ? f(results[s].figures!) : 'Incomplete');
  const rows: [string, (x: PrEconFigures) => string][] = [
    ['Contribution before ads', (x) => money(x.before)],
    ['Contribution after ads', (x) => (x.after === null ? 'Needs ad cost' : money(x.after))],
    ['Break-even cost per order', (x) => money(x.before)],
    ['Break-even ROAS', (x) => (x.breakEvenRoas === null ? 'Not meaningful' : `${x.breakEvenRoas.toFixed(2)}×`)],
  ];
  const lacking = [...new Set(SCENARIOS.filter((s) => !results[s].figures).map((s) => incomplete(results[s])))];
  const excluded = PR_ECON_FIELDS.filter((k) => SCENARIOS.some((s) => results[s].excluded.includes(k)));

  return (
    <div className="grid gap-3.5 text-xs">
      <table className="w-full border-collapse">
        <caption className="mb-1.5 text-left text-[11px] text-muted">{`Per order, in ${e.currency}${e.rateDate ? `; the offer converted at the stored rate of ${e.rateDate}` : ''}`}</caption>
        <thead>
          <tr className="text-right text-muted">
            <th />
            {SCENARIOS.map((s) => (
              <th key={s} scope="col" className="px-1 pb-1 font-semibold">
                {SCENARIO_LABEL[s]}
                {s !== 'base' && !Object.keys(values[s]).length && <span className="block font-normal">same as base</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, f]) => (
            <tr key={label} className="border-t border-dashed border-line">
              <th scope="row" className="py-1.5 pr-1 text-left font-normal text-muted">
                {label}
              </th>
              {SCENARIOS.map((s) => (
                <td key={s} className={cx('px-1 text-right', !/\d/.test(cell(s, f)) ? 'text-muted' : s === 'base' ? 'font-semibold text-text' : 'text-text-2')}>
                  {cell(s, f)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid gap-1 text-[11.5px] text-muted">
        {lacking.map((l) => (
          <p key={l} className="text-text-2">
            {l}
          </p>
        ))}
        <p>Break-even ROAS is on order value after discounts, before refunds; not meaningful when the contribution before ads isn't above zero.</p>
        <div>
          <b className="text-text-2">Not included</b>
          <ul className="ml-4 list-disc">
            {excluded.length > 0 && <li>{`${labels(excluded)}: unknown, so left out (figures are excl. them)`}</li>}
            <li>{FIXED}</li>
          </ul>
        </div>
      </div>

      <section className="grid gap-2 border-t border-line pt-3">
        <h3 className="text-[11px] font-semibold tracking-[.07em] text-muted uppercase">Assumptions</h3>
        <Segmented label="Scenario to edit" options={SCENARIOS.map((s) => ({ value: s, label: SCENARIO_LABEL[s] }))} value={scenario} onChange={setScenario} />
        <p className="text-muted">
          {scenario === 'base' ? 'Base starts from verified offers, your store and its settings. Type a figure to use yours.' : 'It starts the same as base: change only what differs.'}
        </p>
        {PR_ECON_FIELDS.map((k) => {
          const own = draft[scenario][k] ?? '';
          const from = scenario === 'base' ? e.derived[k] : null;
          const tag = own.trim() ? (
            <Pill tone="run">Yours</Pill>
          ) : from ? (
            <Pill tone={from.tag === 'verified' ? 'good' : from.tag === 'assumption' ? 'warn' : from.tag === 'owner' ? 'run' : 'muted'}>
              {from.tag === 'verified' ? 'Verified' : from.tag === 'assumption' ? 'Assumption' : from.tag === 'owner' ? 'Yours' : 'Unknown'}
            </Pill>
          ) : (
            <Pill>Same as base</Pill>
          );
          return (
            <label key={k} className="grid grid-cols-[1fr_7rem] items-center gap-x-2 gap-y-0.5">
              <span className="text-text-2">{`${PR_ECON_LABEL[k]} (${pct(k) ? '%' : e.currency})`}</span>
              <input
                className={cx(inputClass, 'py-1 text-right')}
                inputMode="decimal"
                value={own}
                placeholder={scenario === 'base' ? (from!.value === null ? 'Unknown' : text(k, from!.value)) : base[k] === null ? 'Unknown' : text(k, base[k]!)}
                onChange={(ev) => setDraft((d) => ({ ...d, [scenario]: { ...d[scenario], [k]: ev.target.value } }))}
              />
              <span className="col-span-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                {tag}
                {own.trim() ? null : scenario === 'base' ? from!.note : `Base: ${shown(k, base[k])}`}
              </span>
            </label>
          );
        })}
        {errors.length > 0 && (
          <ul role="alert" className="text-red">
            {errors.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        )}
        {save.error && (
          <p role="alert" className="text-red">
            {save.error.message}
          </p>
        )}
        <div className="flex gap-2">
          <Button size="sm" variant="primary" disabled={!dirty || errors.length > 0 || save.isPending} onClick={() => save.mutate(values)}>
            Save assumptions
          </Button>
          <Button size="sm" disabled={!dirty || save.isPending} onClick={() => setDraft(fromSaved())}>
            Discard changes
          </Button>
        </div>
      </section>
    </div>
  );
}
