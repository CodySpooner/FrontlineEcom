// The v1 Overview as its pieces ship (SA-70 on), above the legacy view until SA-79 replaces it.
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { changeOf, SA_COMPARES, SA_METRICS, type SaAnnotation, type SaContext, type SaInsightTarget, type SaMetricId, type SaOverview, type SaValue } from '@frontline/shared';
import { Button, cx, ErrorState, LoadingState, Panel, Segmented } from '../components/ui';
import { fmtDay, money } from '../lib/format';
import { useSaAnnotations, useSaContext, useSaContributions, useSaInsights, useSaListings, useSaOverview, useSaSeries } from './api';
import { FilterScope } from './FilterScope';
import { FindingCard, RulesDialog, type Investigate } from './FindingCard';
import { channelsOf } from './Filters';
import { Change, KpiStrip } from './KpiStrip';
import { periodParams, type AnalyticsPage, type AnalyticsState } from './state';
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

/** SA-73: each product's share of the net sales change, as a diverging bar scaled to the largest move. */
function MovedPanel({ s, ctx }: { s: AnalyticsState; ctx?: SaContext }) {
  const q = useSaContributions(s);
  const m = q.data;
  const signed = (v: number) => (v > 0 ? '+' : '') + money(v, ctx?.currency);
  const max = Math.max(0, ...(m?.rows.map((r) => Math.abs(r.change)) ?? []));
  const vs = SA_COMPARES.find((c) => c.id === s.compare)?.label;
  return (
    <Panel
      title="What moved net sales"
      sub={m && (m.change == null ? m.note : <><b className={cx('font-semibold tabular-nums', m.change > 0 ? 'text-good' : m.change < 0 ? 'text-red' : 'text-text-2')}>{signed(m.change)}</b> {vs}</>)}
      className="flex flex-col"
    >
      {q.isError ? (
        <ErrorState message="Couldn't load what moved." onRetry={() => q.refetch()} />
      ) : !m ? (
        <LoadingState rows={4} />
      ) : m.change == null ? null : !m.rows.length ? (
        <p className="text-[13px] text-muted">No product's net sales changed.</p>
      ) : (
        <ul aria-label="Net sales change by product">
          {m.rows.map((r) => (
            <li key={r.id ?? r.kind} className="grid grid-cols-[minmax(0,1fr)_40px_56px] items-center gap-2.5 border-t border-[#1d1d22] py-[3px] text-[12.5px] first:border-t-0 min-[480px]:grid-cols-[minmax(0,1fr)_80px_64px]">
              <span className="flex min-w-0 items-center gap-2.5">
                {r.image ? <img src={r.image} alt="" loading="lazy" className="size-[30px] shrink-0 rounded-[7px] object-cover" /> : <span aria-hidden className="size-[30px] shrink-0 rounded-[7px] border border-[#2e2e35] bg-[linear-gradient(140deg,#2b2b31,#1b1b20)]" />}
                <span className="min-w-0">
                  <b className="block truncate font-medium">{r.title}</b>
                  <span className="block truncate text-[11px] text-muted">
                    {r.new && <span className="text-text-2">New · </span>}
                    {r.note}
                  </span>
                </span>
              </span>
              <span aria-hidden className="relative h-2.5 before:absolute before:inset-y-[-3px] before:left-1/2 before:w-px before:bg-line-3">
                <i className={cx('absolute inset-y-0 rounded-[3px]', r.change > 0 ? 'bg-good' : 'bg-red')} style={max ? { left: r.change > 0 ? '50%' : `${50 - (Math.abs(r.change) / max) * 50}%`, width: `${(Math.abs(r.change) / max) * 50}%` } : undefined} />
              </span>
              <b className={cx('text-right font-semibold tabular-nums', r.change > 0 ? 'text-good' : 'text-red')}>{signed(r.change)}</b>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-[#1d1d22] pt-2">
        <span className="rounded-[5px] bg-[rgba(127,178,255,.13)] px-1.5 py-0.5 text-[9.5px] font-bold tracking-[.08em] text-[#a9d2ff] uppercase">Observed</span>
        <span className="text-xs text-muted">Each product's share of the change, not its cause.</span>
        <FilterScope scope={m?.scope} />
      </div>
    </Panel>
  );
}

const DOT = { warn: 'bg-amber', red: 'bg-red', info: 'bg-[#7fb2ff]' };
const ROW = 'flex w-full items-center gap-2.5 border-t border-line px-4 py-[9px] text-left text-[12.5px]';

/** Where a flag's target is looked into. One with no screen yet (Listings, SA-82) has none: no dead link (decision 33). */
function useInvestigate(s: AnalyticsPage, onChart: (k: string) => void) {
  const [, setParams] = useSearchParams();
  return (t: SaInsightTarget): Investigate | undefined => {
    if (t.kind === 'product' || t.kind === 'products') {
      const ids = t.kind === 'product' ? [t.id] : t.ids;
      return { onClick: () => s.set({ filters: { ...s.filters, product: ids }, page: 1 }), title: ids.length === 1 ? 'Show this product only' : 'Show these products only' };
    }
    if (t.kind === 'sources') return { onClick: () => setParams((p) => (p.set('panel', 'sources'), p)), title: 'Open Data sources' };
    if (t.kind === 'metric') return { onClick: () => onChart(t.id === 'contribution_after_ads' ? 'contribution' : t.id), title: `Chart ${SA_METRICS[t.id].label.toLowerCase()}` };
    if (t.kind === 'orders') return { to: '/orders' };
  };
}

/** SA-76: the rule engine's flags, each opening where it can be looked into; How flags work lists every rule. */
function AttentionPanel({ s, onChart }: { s: AnalyticsPage; onChart: (k: string) => void }) {
  const q = useSaInsights(s);
  const go = useInvestigate(s, onChart);
  const [how, setHow] = useState(false);
  const d = q.data?.insights && q.data;
  return (
    <section className="card min-w-0 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="font-display text-base font-semibold tracking-[.02em] whitespace-nowrap">Needs attention</h2>
        {d && (
          <span className="rounded-full border border-line-2 px-2 py-px text-[11px] font-semibold text-text-2 tabular-nums">
            {d.insights.length}
            <span className="sr-only"> flags</span>
          </span>
        )}
        {d && (
          <button type="button" className="ml-auto cursor-pointer text-xs whitespace-nowrap underline decoration-line-3 underline-offset-3 hover:text-white" onClick={() => setHow(true)}>
            How flags work
          </button>
        )}
      </div>
      {q.isError ? (
        <ErrorState message="Couldn't load the flags." onRetry={() => q.refetch()} />
      ) : !d ? (
        <LoadingState rows={3} />
      ) : !d.insights.length ? (
        <p className="text-[13px] text-muted">No rule flagged anything in this period.</p>
      ) : (
        <ul className="-mx-4 -mb-4">
          {d.insights.map((i, k) => {
            const to = go(i.target);
            const body = (
              <>
                <i aria-hidden className={cx('size-[7px] shrink-0 rounded-full', DOT[i.tone])} />
                <span className="min-w-0 flex-1">
                  <b className="block font-medium">{i.title}</b>
                  <span className="block text-[11px] text-muted">
                    {i.kind === 'data_health' && 'Data health · '}
                    {i.detail}
                  </span>
                </span>
                {to && <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted" />}
              </>
            );
            return (
              <li key={k}>
                {!to ? (
                  <div className={ROW}>{body}</div>
                ) : 'to' in to ? (
                  <Link to={to.to} className={cx(ROW, 'hover:bg-panel-2')}>
                    {body}
                  </Link>
                ) : (
                  <button type="button" onClick={to.onClick} title={to.title} className={cx(ROW, 'cursor-pointer hover:bg-panel-2')}>
                    {body}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {d && <RulesDialog rules={d.rules} open={how} onClose={() => setHow(false)} />}
    </section>
  );
}

const TH = 'pb-1.5 text-right font-medium';

/** SA-78: the period's four best sellers by net sales: the Listings table's own rows (listings API), so the numbers agree. */
function TopProducts({ s, ctx }: { s: AnalyticsPage; ctx?: SaContext }) {
  const q = useSaListings(s.store, { ...periodParams(s), status: 'active', sort: 'net_sales:desc' });
  const rows = q.data?.rows?.slice(0, 4);
  const val = (v: SaValue, f: (n: number) => string) => (v.value == null ? '–' : f(v.value));
  return (
    // the board's header: "by net sales" beside the title
    <section className="card flex min-w-0 flex-col p-4">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="font-display text-base font-semibold tracking-[.02em]">Top products</h2>
        <span className="text-xs text-muted">by net sales</span>
      </div>
      {q.isError ? (
        <ErrorState message="Couldn't load the top products." onRetry={() => q.refetch()} />
      ) : !rows ? (
        <LoadingState rows={4} />
      ) : !rows.length ? (
        <p className="text-[13px] text-muted">No active products.</p>
      ) : (
        <table className="w-full text-[12.5px] tabular-nums">
          <thead>
            <tr className="text-left text-[11px] text-muted">
              <th className="pb-1.5 font-medium">Product</th>
              <th className={TH}>Units</th>
              <th className={TH}>Net sales</th>
              <th className={TH}>Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-[#1d1d22]">
                <td className="w-full max-w-0 py-[5px]">
                  <span className="flex min-w-0 items-center gap-2.5">
                    {r.image ? <img src={r.image} alt="" loading="lazy" className="size-[26px] shrink-0 rounded-[6px] max-[479px]:hidden object-cover" /> : <span aria-hidden className="size-[26px] shrink-0 rounded-[6px] max-[479px]:hidden border border-[#2e2e35] bg-[linear-gradient(140deg,#2b2b31,#1b1b20)]" />}
                    <b className="truncate font-medium">{r.title}</b>
                  </span>
                </td>
                <td className="pl-3 text-right">{val(r.units, (n) => n.toLocaleString('en-US'))}</td>
                <td className="pl-3 text-right whitespace-nowrap">{val(r.netSales, (n) => money(n, ctx?.currency))}</td>
                <td className="pl-3 text-right whitespace-nowrap">{r.previousNetSales ? <Change change={changeOf(r.netSales.value, r.previousNetSales.value, 'money')} direction="up" /> : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-auto pt-2">
        <FilterScope scope={q.data?.scope} />
      </div>
    </section>
  );
}

const RANK = { red: 0, warn: 1, info: 2 };

/** SA-77: the finding card with the most urgent flag (red first, then the rules' order). */
function Finding({ s, onChart }: { s: AnalyticsPage; onChart: (k: string) => void }) {
  const q = useSaInsights(s);
  const go = useInvestigate(s, onChart);
  const d = q.data?.insights && q.data;
  if (!d)
    return <section className="card min-w-0 p-4">{q.isError ? <ErrorState message="Couldn't load the finding." onRetry={() => q.refetch()} /> : <LoadingState rows={3} />}</section>;
  const top = [...d.insights].sort((a, b) => RANK[a.tone] - RANK[b.tone])[0];
  return <FindingCard insight={top} rules={d.rules} investigate={top && go(top.target)} />;
}

export function Overview({ s, tabs }: { s: AnalyticsPage; tabs: string[] }) {
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
      <div className="grid items-stretch gap-3.5 min-[1180px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <TrendPanel s={s} ctx={ctx.data} o={o.data} chart={chart} onChart={setChart} />
        <MovedPanel s={s} ctx={ctx.data} />
      </div>
      <div className="grid items-stretch gap-3.5 min-[1180px]:grid-cols-[minmax(0,1.1fr)_minmax(0,1.2fr)_minmax(0,1fr)]">
        <AttentionPanel s={s} onChart={setChart} />
        <TopProducts s={s} ctx={ctx.data} />
        <Finding s={s} onChart={setChart} />
      </div>
    </div>
  );
}
