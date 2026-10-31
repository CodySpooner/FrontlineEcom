// The v1 Overview as its pieces ship (SA-70 on), above the legacy view until SA-79 replaces it.
import { useState } from 'react';
import { SA_METRICS, type SaAnnotation, type SaContext, type SaMetricId, type SaOverview } from '@frontline/shared';
import { Button, cx, ErrorState, LoadingState, Segmented } from '../components/ui';
import { fmtDay, money } from '../lib/format';
import { useSaAnnotations, useSaContext, useSaOverview, useSaSeries } from './api';
import { FilterScope } from './FilterScope';
import { channelsOf } from './Filters';
import { KpiStrip } from './KpiStrip';
import type { AnalyticsState } from './state';
import { TrendChart, type Mark } from './TrendChart';

/** The chart's quick picks; a tile picks any of the six. Contribution is after ads with ad data, else before (Q15). */
const SEGMENTS = [
  { value: 'net_sales', label: 'Net sales' },
  { value: 'orders', label: 'Orders' },
  { value: 'contribution', label: 'Contribution' },
];
const SWATCH = ['bg-red', 'bg-[#9db4d6]', 'bg-[#6f6f78]', 'bg-[#4a4a53]'];
const SOURCE: Record<SaAnnotation['kind'], string> = { price_test: 'price test', app_change: 'approved in the app', data_health: 'data health, not a sales change' };

function TrendPanel({ s, ctx, o, chart, onChart }: { s: AnalyticsState; ctx?: SaContext; o: SaOverview; chart: string; onChart: (k: string) => void }) {
  const hasAds = o.metrics.find((m) => m.id === 'ad_spend')?.value != null;
  const metric = (chart === 'contribution' ? (hasAds ? 'contribution_after_ads' : 'contribution_before_ads') : chart) as SaMetricId;
  const series = useSaSeries(s, metric);
  const notes = useSaAnnotations(s);
  const [table, setTable] = useState(false);
  const label = SA_METRICS[metric].label;
  const d = series.data;
  const names = ctx ? channelsOf(ctx) : [];
  let k = 0; // derived markers are numbered in date order, data health is "!"
  const marks: Mark[] = (notes.data ?? []).map((a) => (a.kind === 'data_health' ? { date: a.date, label: '!', red: true } : { date: a.date, label: String(++k) }));
  const options = SEGMENTS.some((x) => x.value === chart) ? SEGMENTS : [...SEGMENTS, { value: chart, label }];
  return (
    // Panel's header, but wrapping: the segment drops under the title on a phone
    <section className="card min-w-0 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5">
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold tracking-[.02em]">{label}</h2>
          {d && <div className="text-xs text-muted">{`${d.grain === 'day' ? 'Daily' : 'Weekly'} · ${d.period.partial ? 'today so far (partial)' : 'today (partial) not included'} · ${o.zoneLabel}`}</div>}
        </div>
        <div className="w-[264px] max-w-full">
          <Segmented quiet label="Chart metric" options={options} value={chart} onChange={onChart} />
        </div>
      </div>
      <div className="mb-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11.5px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <i aria-hidden className="inline-block w-3.5 border-t-2 border-red" /> {fmtDay(o.period.from)} – {fmtDay(o.period.to)}
        </span>
        {o.compare && 'from' in o.compare && (
          <span className="inline-flex items-center gap-1.5">
            <i aria-hidden className="inline-block w-3.5 border-t-2 border-dashed border-[#6f6f78]" /> {fmtDay(o.compare.from)} – {fmtDay(o.compare.to)}
          </span>
        )}
        {(metric === 'net_sales' || metric === 'orders') && o.channels.length > 0 && (
          <span className="inline-flex flex-wrap gap-3 tabular-nums min-[900px]:ml-auto">
            {o.channels.map((c, i) => (
              <span key={c.channel} className="inline-flex items-center gap-1.5">
                <i aria-hidden className={`inline-block size-[9px] rounded-[2px] ${SWATCH[Math.min(i, SWATCH.length - 1)]}`} />
                {names.find((n) => n.id === c.channel)?.label ?? c.channel} {c.net_sales.value == null ? '–' : money(c.net_sales.value, ctx?.currency)} · {c.orders.value ?? '–'} orders
              </span>
            ))}
          </span>
        )}
        {(metric === 'net_sales' || metric === 'orders') && !o.channels.length && o.channelsNote && <span className="min-[900px]:ml-auto">{o.channelsNote}</span>}
      </div>
      {series.isError ? (
        <ErrorState message="Couldn't load the trend." onRetry={() => series.refetch()} />
      ) : !d ? (
        <LoadingState rows={3} />
      ) : (
        // the data's own label: the last metric's series stays up while the next one loads
        <TrendChart series={d} label={SA_METRICS[d.metric].label} currency={ctx?.currency} table={table} marks={marks} />
      )}
      {notes.isError ? (
        <p className="mt-1 text-xs text-muted">
          Couldn't load the chart's markers.{' '}
          <button type="button" className="cursor-pointer underline hover:text-white" onClick={() => notes.refetch()}>
            Retry
          </button>
        </p>
      ) : (
        !!notes.data?.length && (
          <div className="mt-1 grid gap-[3px] text-xs text-text-2">
            <span className="text-muted">Context only, not a cause</span>
            {notes.data.map((a, i) => (
              <span key={i}>
                <b className={cx('font-mono', marks[i]!.red ? 'text-[#ff6b77]' : 'text-[#f0f0f2]')}>{marks[i]!.label}</b> {fmtDay(a.date)} · {a.text} <span className="text-muted">· {SOURCE[a.kind]}</span>
              </span>
            ))}
          </div>
        )
      )}
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
        <FilterScope scope={d?.scope} />
        <Button size="sm" variant="ghost" className="ml-auto" aria-pressed={table} onClick={() => setTable(!table)}>
          {table ? 'Chart' : 'Table'}
        </Button>
      </div>
    </section>
  );
}

export function Overview({ s, tabs }: { s: AnalyticsState; tabs: string[] }) {
  const o = useSaOverview(s);
  const ctx = useSaContext(s.store);
  const [chart, setChart] = useState('net_sales');
  if (o.isError) return <ErrorState message="Couldn't load the Overview." onRetry={() => o.refetch()} />;
  if (!o.data) return <LoadingState rows={2} />;
  return (
    <div className="mb-4 grid gap-3.5">
      <section aria-label="Key numbers" className="grid gap-2">
        <KpiStrip metrics={o.data.metrics} ctx={ctx.data} tabs={tabs} selected={chart === 'contribution' ? 'contribution_after_ads' : (chart as SaMetricId)} onSelect={(id) => setChart(id === 'contribution_after_ads' ? 'contribution' : id)} />
        <FilterScope scope={o.data.scope} />
      </section>
      <TrendPanel s={s} ctx={ctx.data} o={o.data} chart={chart} onChart={setChart} />
    </div>
  );
}
