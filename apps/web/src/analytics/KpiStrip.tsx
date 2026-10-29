// SA-70: the Overview's six KPI tiles (the Overview board): the value, its change against the comparison and the
// registry's definition line, or the value's coverage line when it covers less than everything. A value with no number
// says why (<Unavailable>, never 0). With `onSelect` a click picks the chart's metric; "Breakdown →" appears once its tab
// exists.
import { Link, useSearchParams } from 'react-router';
import { Info } from 'lucide-react';
import { SA_METRICS, type SaChange, type SaContext, type SaMetric, type SaMetricId, type SaMetricResult } from '@frontline/shared';
import { cx, Tooltip } from '../components/ui';
import { cents, money } from '../lib/format';
import { Unavailable } from './Unavailable';

/** The tab each tile's breakdown opens. */
export const BREAKDOWN: Partial<Record<SaMetricId, string>> = { net_sales: 'sales', orders: 'sales', aov: 'sales', site_conversion: 'traffic', ad_spend: 'marketing', contribution_after_ads: 'profitability' };
const ADS = new Set(['meta_ads', 'google_ads', 'tiktok_ads']);

/** A value in its unit: $48,920 (AOV to the cent), 1,086, 1.79%, 2.40×, 5 d. */
export function fmtValue(id: SaMetricId, v: number, currency = 'USD') {
  const unit = SA_METRICS[id].unit;
  if (unit === 'money') return id === 'aov' ? cents(v, currency) : money(v, currency);
  if (unit === 'ratio') return `${(v * 100).toFixed(2)}%`;
  if (unit === 'multiple') return `${v.toFixed(2)}×`;
  if (unit === 'days') return `${Math.round(v)} d`;
  return Math.round(v).toLocaleString('en-US');
}

/** "▲ 12.4%", "▼ 0.02 pts", "New"; nothing without a comparison. Better is green, worse red, ad spend neutral. */
function Change({ change, direction }: { change: SaChange; direction: SaMetric['direction'] }) {
  if (change.kind === 'unavailable') return null;
  if (change.kind === 'new') return <span className="text-text-2">New</span>;
  const r = Math.round(change.value * (change.kind === 'points' ? 100 : 10)) / (change.kind === 'points' ? 100 : 10);
  const tone = r === 0 || direction === 'neutral' ? 'text-text-2' : (r > 0) === (direction === 'up') ? 'text-good' : 'text-red';
  return (
    <span className={tone}>
      {r > 0 ? '▲' : r < 0 ? '▼' : ''} {change.kind === 'points' ? `${Math.abs(r).toFixed(2)} pts` : `${Math.abs(r).toFixed(1)}%`}
    </span>
  );
}

/** The tile's last line: what the value covers when it's less than all of it (amber under 95%), else its definition. */
function line(m: SaMetricResult, ctx?: SaContext): { text: string; warn?: boolean } {
  if (m.coverage && m.coverage.share < 1) return { text: `${Math.floor(m.coverage.share * 100)}% of ${m.coverage.of}`, warn: m.coverage.share < 0.95 };
  const ads = ctx?.channels.filter((c) => ADS.has(c.kind)).map((c) => c.name);
  if (m.id === 'ad_spend' && ads?.length) return { text: ads.join(' + ') };
  return { text: SA_METRICS[m.id].line };
}

function Value({ m, currency }: { m: SaMetricResult; currency?: string }) {
  if (m.value == null) return <Unavailable value={m} className="min-h-[26px] text-[12.5px]" />;
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-[21px] leading-tight font-semibold tracking-[-.015em] tabular-nums">{fmtValue(m.id, m.value, currency)}</span>
      {(m.status === 'estimated' || m.status === 'partial') && <span className="text-[10.5px] font-medium text-amber">{m.status}</span>}
    </span>
  );
}

export function KpiStrip({ metrics, ctx, selected, onSelect, tabs }: { metrics: SaMetricResult[]; ctx?: SaContext; selected?: SaMetricId; onSelect?: (id: SaMetricId) => void; tabs: string[] }) {
  const [params] = useSearchParams();
  const tabHref = (tab: string) => {
    const p = new URLSearchParams(params);
    p.set('tab', tab);
    return `?${p}`;
  };
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line min-[720px]:grid-cols-3 min-[1180px]:grid-cols-6">
      {metrics.map((m) => {
        const def = SA_METRICS[m.id];
        const on = m.id === selected;
        const l = line(m, ctx);
        const tab = BREAKDOWN[m.id];
        return (
          <div key={m.id} onClick={onSelect && (() => onSelect(m.id))} className={cx('flex min-w-0 flex-col gap-[3px] px-3.5 pt-3 pb-[11px]', on ? 'bg-[#18181c] shadow-[inset_0_-2px_0_var(--color-red)]' : 'bg-[#121215]', onSelect && !on && 'cursor-pointer hover:bg-[#151518]')}>
            <span className="flex min-w-0 items-center gap-[5px] text-[11.5px] whitespace-nowrap text-muted">
              <span className="truncate">{def.label}</span>
              <Tooltip tip={def.formula}>
                <span tabIndex={0} aria-label={`How ${def.label.toLowerCase()} is worked out`} className="inline-flex" onClick={(e) => e.stopPropagation()}>
                  <Info aria-hidden className="size-3" />
                </span>
              </Tooltip>
            </span>
            {onSelect ? (
              <button type="button" aria-pressed={on} className="cursor-pointer text-left outline-none focus-visible:ring-1 focus-visible:ring-red/60">
                <Value m={m} currency={ctx?.currency} />
              </button>
            ) : (
              <Value m={m} currency={ctx?.currency} />
            )}
            <span className="flex flex-wrap items-center gap-x-1.5 text-[11.5px] whitespace-nowrap tabular-nums">
              <Change change={m.change} direction={def.direction} />
              {m.previous?.value != null && <span className="text-muted">vs {fmtValue(m.id, m.previous.value, ctx?.currency)}</span>}
            </span>
            <span className={cx('truncate text-[11px]', l.warn ? 'text-amber' : 'text-muted')}>{l.text}</span>
            {tab && tabs.includes(tab) && (
              <Link to={tabHref(tab)} onClick={(e) => e.stopPropagation()} className="text-[11px] font-semibold text-muted hover:text-white">
                Breakdown →
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}
