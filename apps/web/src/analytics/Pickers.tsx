// SA-65: the period and comparison pickers (spec §4 Global reporting controls; decision 6). Native Popover menus with
// the dates each choice covers; a custom range on native date inputs, refused with the reason until it's valid.
import { useState, type FormEvent } from 'react';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { comparePeriod, resolvePeriod, SA_COMPARES, SA_MAX_DAYS, SA_PRESETS, validateCustom, type SaComparePeriod, type SaPeriod } from '@frontline/shared';
import { hidePopover, MenuItem, Popover } from '../agents/Popover';
import { buttonClass, cx, inputClass } from '../components/ui';
import { fmtDay } from '../lib/format';
import type { AnalyticsState } from './state';

type Set = (p: Partial<Pick<AnalyticsState, 'period' | 'from' | 'to' | 'compare'>>) => void;

export const ctl = 'inline-flex max-w-full cursor-pointer items-center gap-[7px] rounded-lg border border-line-2 bg-bg-2 px-2.5 py-1.5 text-[12.5px] whitespace-nowrap hover:border-muted/60';
/** "Sep 28 – Oct 27"; years once the range leaves this year ("Oct 28, 2025 – Oct 27, 2026", "Sep 28 – Oct 27, 2025"). */
export function range(from: string, to: string) {
  const [a, b] = [from.slice(0, 4), to.slice(0, 4)];
  const end = fmtDay(to, b !== String(new Date().getFullYear()) || a !== b);
  return from === to ? end : `${fmtDay(from, a !== b)} – ${end}`;
}
const dates = (c: SaComparePeriod | undefined) => (!c ? undefined : 'unavailable' in c ? c.unavailable : range(c.from, c.to));

export function PeriodPicker({ s, set, today, period }: { s: AnalyticsState; set: Set; today: string; period: SaPeriod | string }) {
  const current = typeof period === 'string' ? undefined : period;
  const [from, setFrom] = useState(s.from ?? current?.from ?? today);
  const [to, setTo] = useState(s.to ?? current?.to ?? today);
  const why = validateCustom(from, to, today);
  const apply = (e: FormEvent) => {
    e.preventDefault();
    if (why) return;
    set({ period: 'custom', from, to });
    hidePopover('sa-period');
  };
  return (
    <>
      <button type="button" popoverTarget="sa-period" className={ctl}>
        <CalendarDays aria-hidden className="size-3.5 shrink-0 text-muted" />
        {SA_PRESETS.find((p) => p.id === s.period)!.label}{' '}
        <small className="min-w-0 truncate text-[11.5px] text-muted">{typeof period === 'string' ? period : `${range(period.from, period.to)} · ${period.partial ? 'today so far' : 'full days'}`}</small>
        <ChevronDown aria-hidden className="size-3 shrink-0 text-muted" />
      </button>
      <Popover id="sa-period" label="Period" className="w-[300px]">
        {SA_PRESETS.filter((p) => p.id !== 'custom').map((p) => {
          const r = resolvePeriod(p.id, today) as SaPeriod;
          return (
            <MenuItem key={p.id} popover="sa-period" current={s.period === p.id} onClick={() => set({ period: p.id })}>
              <span className="flex-1">{p.label}</span>{' '}
              <span className="text-[11px] text-muted">{p.includesToday ? `${range(r.from, r.to)} · today so far` : range(r.from, r.to)}</span>
            </MenuItem>
          );
        })}
        <form onSubmit={apply} className="mt-1 grid gap-2 border-t border-line px-2.5 pt-2.5 pb-1.5" aria-label="Custom range">
          <div className="text-[12px] font-semibold text-text-2">Custom range</div>
          <div className="flex items-center gap-2">
            <input type="date" aria-label="From" value={from} max={today} onChange={(e) => setFrom(e.target.value)} className={cx(inputClass, 'min-w-0 flex-1 px-2 py-1.5')} />
            <span className="text-muted">–</span>
            <input type="date" aria-label="To" value={to} max={today} onChange={(e) => setTo(e.target.value)} className={cx(inputClass, 'min-w-0 flex-1 px-2 py-1.5')} />
          </div>
          <p className={cx('text-[11.5px]', why ? 'text-red' : 'text-muted')} role="status">
            {why ?? `Up to ${SA_MAX_DAYS} days, ending today at the latest.`}
          </p>
          <button type="submit" disabled={!!why} className={cx(buttonClass('primary', 'sm'), 'justify-self-end disabled:cursor-not-allowed disabled:opacity-50')}>
            Apply
          </button>
        </form>
      </Popover>
    </>
  );
}

export function ComparePicker({ s, set, period, historyStart }: { s: AnalyticsState; set: Set; period: SaPeriod | string; historyStart?: string }) {
  const of = (mode: AnalyticsState['compare']) => (typeof period === 'string' ? undefined : comparePeriod(period, mode, historyStart));
  return (
    <>
      <button type="button" popoverTarget="sa-compare" className={ctl}>
        {SA_COMPARES.find((c) => c.id === s.compare)!.label}{' '}
        {dates(of(s.compare)) && <small className="min-w-0 truncate text-[11.5px] text-muted">{dates(of(s.compare))}</small>}
        <ChevronDown aria-hidden className="size-3 shrink-0 text-muted" />
      </button>
      <Popover id="sa-compare" label="Comparison" className="w-[300px]">
        {SA_COMPARES.map((c) => (
          <MenuItem key={c.id} popover="sa-compare" current={s.compare === c.id} onClick={() => set({ compare: c.id })}>
            <span className="flex-1">{c.label}</span>{' '}
            {dates(of(c.id)) && <span className="text-[11px] text-muted">{dates(of(c.id))}</span>}
          </MenuItem>
        ))}
      </Popover>
    </>
  );
}
