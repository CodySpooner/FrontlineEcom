// SA-98 (spec §8 Sales and order performance): the Sales tab. The net sales bridge with tax and shipping apart and
// orders, AOV, units and cancellations (SA-95); the picked metric's trend and the report's rows by day, week or month;
// net sales by channel, product, collection or country (SA-96); and the orders behind any day or row (SA-97), opened
// from here or from the Overview's trend chart (`orders=from..to`). The refunds view switches every value refunds
// touch, each labelled.
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { SA_BREAKDOWNS, SA_METRICS, SA_REASONS, SA_SALES_GRAINS, SA_SALES_REPORT, type SaBreakdownBy, type SaContext, type SaMetricId, type SaSalesReport, type SaSeriesPoint, type SaValue } from '@frontline/shared';
import { Button, cx, Dialog, ErrorState, LoadingState, Segmented, Table } from '../components/ui';
import { cents, fmtDay, money } from '../lib/format';
import { useSaBreakdown, useSaContext, useSaOrders, useSaSales, useSaSeries } from './api';
import { FilterScope } from './FilterScope';
import { channelsOf } from './Filters';
import { Change, fmtValue, KpiStrip, Value } from './KpiStrip';
import { range } from './Pickers';
import type { AnalyticsPage } from './state';
import { TrendChart } from './TrendChart';
import { Unavailable } from './Unavailable';

type S = AnalyticsPage & { store: string };
const TH = 'pb-1.5 text-right font-medium';
const CHART = [
  { value: 'net_sales', label: 'Net sales' },
  { value: 'orders', label: 'Orders' },
  { value: 'aov', label: 'AOV' },
  { value: 'units', label: 'Units' },
] as const;
const BY: Record<SaBreakdownBy, string> = { channel: 'Channel', product: 'Product', collection: 'Collection', country: 'Country' };

/** The refunds view on a value refunds change (net sales, refunds). */
const Basis = ({ s }: { s: S }) => <span className="ml-1 text-[10.5px] font-medium text-muted">· {s.refunds === 'order_day' ? 'order day' : 'refund day'}</span>;

/** The `orders=from..to` drilldown's URL for a day or a row. */
export const ordersParam = (p: { from: string; to: string }) => (p.from === p.to ? p.from : `${p.from}..${p.to}`);

function Bridge({ s, d, currency }: { s: S; d: SaSalesReport; currency?: string }) {
  const m = (id: SaMetricId) => d.metrics.find((x) => x.id === id)!;
  const step = (id: SaMetricId, sign: string) => (
    <div key={id} className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[11.5px] text-muted">
        {sign && `${sign} `}
        {SA_METRICS[id].label}
        {(id === 'refunds' || id === 'net_sales') && <Basis s={s} />}
      </dt>
      <dd>
        <Value m={m(id)} currency={currency} />
        <span className="text-[11.5px] tabular-nums">
          <Change change={m(id).change} direction={SA_METRICS[id].direction} />
        </span>
      </dd>
    </div>
  );
  const apart = (label: string, v: SaValue) => (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[11.5px] text-muted">{label}</dt>
      <dd>{v.value == null ? <Unavailable value={v} className="text-[12.5px]" /> : <span className="text-[17px] font-semibold tabular-nums">{money(v.value, currency)}</span>}</dd>
    </div>
  );
  return (
    <section aria-label="Net sales bridge" className="card p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-2">
        <h2 className="font-display text-base font-semibold tracking-[.02em]">Net sales bridge</h2>
        <span className="text-xs text-muted">{range(d.period.from, d.period.to)} · excl. tax and shipping</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 min-[900px]:grid-cols-[repeat(4,minmax(0,1fr))_1px_repeat(2,minmax(0,.8fr))]">
        {step('gross_sales', '')}
        {step('discounts', '−')}
        {step('refunds', '−')}
        {step('net_sales', '=')}
        <i aria-hidden className="hidden bg-line min-[900px]:block" />
        {apart('Tax charged (apart)', d.tax)}
        {apart('Shipping charged (apart)', d.shipping)}
      </dl>
      <p className="mt-2.5 text-[11px] text-muted">Tax and shipping are what the period's orders were charged, before refunds; neither is in net sales.</p>
    </section>
  );
}

function Trend({ s, ctx, onOrders }: { s: S; ctx?: SaContext; onOrders: (p: SaSeriesPoint) => void }) {
  const [metric, setMetric] = useState<SaMetricId>('net_sales');
  const [table, setTable] = useState(false);
  const q = useSaSeries(s, metric);
  const label = SA_METRICS[metric].label;
  return (
    <section className="card min-w-0 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5">
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold tracking-[.02em]">
            {label}
            {metric === 'net_sales' && <Basis s={s} />}
          </h2>
          <div className="text-xs text-muted">Pick a {q.data?.grain ?? 'day'} for its orders</div>
        </div>
        <div className="w-[264px] max-w-full">
          <Segmented quiet label="Chart metric" options={[...CHART]} value={metric} onChange={(v) => setMetric(v as SaMetricId)} />
        </div>
      </div>
      {q.isError ? (
        <ErrorState message="Couldn't load the trend." onRetry={() => q.refetch()} />
      ) : !q.data || q.data.metric !== metric ? (
        <LoadingState rows={3} />
      ) : (
        <TrendChart series={q.data} label={label} currency={ctx?.currency} table={table} onPick={onOrders} />
      )}
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
        <FilterScope scope={q.data?.scope} />
        <Button size="sm" variant="ghost" className="ml-auto" aria-pressed={table} onClick={() => setTable(!table)}>
          {table ? 'Chart' : 'Table'}
        </Button>
      </div>
    </section>
  );
}

function Rows({ s, d, currency, grain, onGrain, onOrders }: { s: S; d: SaSalesReport; currency?: string; grain: string; onGrain: (g: string) => void; onOrders: (r: { from: string; to: string }) => void }) {
  const cols = SA_SALES_REPORT;
  return (
    <section className="card min-w-0 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5">
        <h2 className="font-display text-base font-semibold tracking-[.02em]">By {grain}</h2>
        <div className="w-[220px] max-w-full">
          <Segmented quiet label="Rows by" options={SA_SALES_GRAINS.map((g) => ({ value: g, label: g[0]!.toUpperCase() + g.slice(1) }))} value={grain} onChange={onGrain} />
        </div>
      </div>
      <Table aria-label={`Sales by ${grain}`}>
        <thead>
          <tr>
            <th>{grain[0]!.toUpperCase() + grain.slice(1)}</th>
            {cols.map((id) => (
              <th key={id} className="text-right!">
                {SA_METRICS[id].label}
                {(id === 'refunds' || id === 'net_sales') && <Basis s={s} />}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {d.rows.map((r) => (
            <tr key={r.from}>
              <td className="whitespace-nowrap">
                <button type="button" onClick={() => onOrders(r)} title="Its orders" className="cursor-pointer underline decoration-line-3 underline-offset-[3px] hover:text-white">
                  {r.from === r.to ? fmtDay(r.from) : range(r.from, r.to)}
                </button>
                {r.partial && <span className="text-muted"> · so far</span>}
              </td>
              {cols.map((id) => (
                <td key={id} className="text-right tabular-nums">
                  {r.values[id].value == null ? <span className="text-muted">–</span> : fmtValue(id, r.values[id].value!, currency)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
    </section>
  );
}

function Breakdown({ s, ctx, by, onBy }: { s: S; ctx?: SaContext; by: SaBreakdownBy; onBy: (b: string) => void }) {
  const q = useSaBreakdown(s, by);
  const d = q.data?.by === by ? q.data : undefined;
  const names = ctx ? channelsOf(ctx) : [];
  const total = d?.total.net_sales.value;
  const label = (r: NonNullable<typeof d>['rows'][number]) => (by === 'channel' && r.id ? (names.find((n) => n.id === r.id)?.label ?? r.label) : r.label);
  return (
    <section className="card min-w-0 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5">
        <h2 className="font-display text-base font-semibold tracking-[.02em]">
          Net sales by {BY[by].toLowerCase()}
          <Basis s={s} />
        </h2>
        <div className="w-[320px] max-w-full">
          <Segmented quiet label="Break down by" options={SA_BREAKDOWNS.map((b) => ({ value: b, label: BY[b] }))} value={by} onChange={onBy} />
        </div>
      </div>
      {q.isError ? (
        <ErrorState message="Couldn't load the breakdown." onRetry={() => q.refetch()} />
      ) : !d ? (
        <LoadingState rows={4} />
      ) : !d.rows.length ? (
        <p className="text-[12.5px] text-muted">
          {d.reason && <b className="font-semibold text-text-2">{SA_REASONS[d.reason]}: </b>}
          {d.note ?? 'No sales in this period.'}
        </p>
      ) : (
        <table aria-label={`Net sales by ${by}`} className="w-full text-[12.5px] tabular-nums">
          <thead>
            <tr className="text-left text-[11px] text-muted">
              <th className="pb-1.5 font-medium">{BY[by]}</th>
              <th className={TH}>Net sales</th>
              <th className={cx(TH, 'w-[28%]')}>Share</th>
              <th className={TH}>Units</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.map((r) => {
              const share = total && r.net_sales != null ? r.net_sales / total : null;
              return (
                <tr key={`${r.kind ?? 'row'}${r.id}`} className={cx('border-t border-[#1c1c21]', r.kind && 'text-text-2')}>
                  <td className="max-w-0 truncate py-[7px] pr-3">
                    {by === 'product' && r.id && !r.kind ? (
                      <button type="button" onClick={() => s.set({ product: r.id! })} className="cursor-pointer text-left hover:text-white hover:underline">
                        {label(r)}
                      </button>
                    ) : (
                      label(r)
                    )}
                  </td>
                  <td className="py-[7px] text-right">{r.net_sales == null ? '–' : money(r.net_sales, ctx?.currency)}</td>
                  <td className="py-[7px] pl-3">
                    {share != null && share > 0 && (
                      <span className="flex items-center gap-2">
                        <i aria-hidden className="h-1.5 rounded-full bg-red/70" style={{ width: `${Math.min(100, share * 100)}%` }} />
                        <span className="text-[11px] text-muted">{share < 0.005 ? '<1%' : `${Math.round(share * 100)}%`}</span>
                      </span>
                    )}
                  </td>
                  <td className="py-[7px] text-right">{r.units ?? '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {d?.overlap && <p className="mt-2 text-[11px] text-muted">A product in several collections counts in each, so these add up to more than the total.</p>}
      {d?.rows.some((r) => r.kind === 'unknown') && <p className="mt-2 text-[11px] text-muted">Unknown: what the rows can't place, so they add up to the total.</p>}
      <div className="mt-2">
        <FilterScope scope={d?.scope} />
      </div>
    </section>
  );
}

/** SA-97: the orders behind a day or row, adding up to its net sales; a copy is listed but not counted. */
function Orders({ s, from, to, ctx, onClose }: { s: S; from: string; to: string; ctx?: SaContext; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const q = useSaOrders(s, from, to, page);
  const d = q.data;
  const currency = ctx?.currency;
  const names = ctx ? channelsOf(ctx) : [];
  const m = (v: number | null) => (v == null ? <span className="text-muted">–</span> : cents(v, currency));
  const total = d?.total.value;
  return (
    <Dialog
      open
      onClose={onClose}
      title="Orders"
      subtitle={`${from === to ? fmtDay(from) : range(from, to)}${total != null ? ` · they add up to ${money(total, currency)} net sales` : ''}`}
      width={900}
      footer={
        d && d.count > d.pageSize ? (
          <div className="flex items-center gap-2 text-[12px] text-muted">
            {(d.page - 1) * d.pageSize + 1}–{Math.min(d.count, d.page * d.pageSize)} of {d.count}
            <Button size="sm" variant="ghost" className="ml-auto" disabled={page === 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <Button size="sm" variant="ghost" disabled={d.page * d.pageSize >= d.count} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="overflow-x-auto px-5 py-4">
        {q.isError ? (
          <ErrorState message="Couldn't load the orders." onRetry={() => q.refetch()} />
        ) : !d ? (
          <LoadingState rows={5} />
        ) : !d.rows.length ? (
          <p className="text-[12.5px] text-muted">{d.note ? `${d.note}.` : 'No orders behind this.'}</p>
        ) : (
          <table aria-label="Orders" className="w-full text-[12.5px] whitespace-nowrap tabular-nums">
            <thead>
              <tr className="text-left text-[11px] text-muted">
                <th className="pb-1.5 font-medium">Order</th>
                <th className="pb-1.5 pl-3 font-medium">Placed</th>
                <th className="pb-1.5 pl-3 font-medium">Channel</th>
                <th className="pb-1.5 pl-3 font-medium">Status</th>
                <th className={TH}>Gross</th>
                <th className={TH}>Discounts</th>
                <th className={TH}>Tax</th>
                <th className={TH}>Shipping</th>
                <th className={TH}>
                  Refunds
                  <Basis s={s} />
                </th>
                <th className={TH}>Net</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.id} className={cx('border-t border-[#1c1c21] [&>td]:py-[7px] [&>td+td]:pl-3', r.duplicateOf && 'text-muted')}>
                  <td>{r.id}</td>
                  <td>
                    {fmtDay(r.date)}
                    {!r.placed && <span className="text-muted"> · refund only</span>}
                  </td>
                  <td>{names.find((n) => n.id === r.channel)?.label ?? r.channel}</td>
                  <td className="capitalize">{r.status}</td>
                  <td className="text-right">
                    {m(r.gross)}
                    {r.estimated && <span className="ml-1 text-[10.5px] text-amber">est.</span>}
                  </td>
                  <td className="text-right">{m(r.discounts)}</td>
                  <td className="text-right">{m(r.tax)}</td>
                  <td className="text-right">{m(r.shipping)}</td>
                  <td className="text-right">{m(r.refunds)}</td>
                  <td className="text-right font-semibold">{r.duplicateOf ? <span className="font-normal">Copy of {r.duplicateOf}, not counted</span> : m(r.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Dialog>
  );
}

export function SalesTab({ s }: { s: S }) {
  const [params, setParams] = useSearchParams();
  const put = (k: string, v: string | undefined) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (v) n.set(k, v);
      else n.delete(k);
      return n;
    });
  const asked = params.get('grain') ?? '';
  const q = useSaSales(s, (SA_SALES_GRAINS as readonly string[]).includes(asked) ? asked : undefined);
  const ctx = useSaContext(s.store).data;
  const by = (SA_BREAKDOWNS as readonly string[]).includes(params.get('by') ?? '') ? (params.get('by') as SaBreakdownBy) : 'channel';
  const [from, to] = params.get('orders')?.split('..') ?? [];
  if (q.isError) return <ErrorState message="Couldn't load the Sales report." onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingState rows={3} />;
  const d = q.data;
  const open = (p: { from: string; to: string }) => put('orders', ordersParam(p));
  return (
    <div className="mb-4 grid gap-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-[12px] text-muted">Refunds count on</span>
        <div className="w-[230px]">
          <Segmented
            quiet
            label="Refunds count on"
            options={[
              { value: 'refund_day', label: 'Refund day' },
              { value: 'order_day', label: "Order's day" },
            ]}
            value={s.refunds}
            onChange={(v) => s.set({ refunds: v as typeof s.refunds })}
          />
        </div>
        <span className="text-[11.5px] text-muted">Changes refunds and net sales, each labelled.</span>
      </div>
      <Bridge s={s} d={d} currency={ctx?.currency} />
      <section aria-label="Orders and units" className="grid gap-2">
        <KpiStrip metrics={d.metrics.filter((m) => ['orders', 'aov', 'units', 'cancelled_orders'].includes(m.id))} ctx={ctx} tabs={[]} />
        <FilterScope scope={d.scope} />
      </section>
      <Trend s={s} ctx={ctx} onOrders={open} />
      <div className="grid items-start gap-3.5 min-[1180px]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Rows s={s} d={d} currency={ctx?.currency} grain={d.grain} onGrain={(g) => put('grain', g)} onOrders={open} />
        <Breakdown s={s} ctx={ctx} by={by} onBy={(b) => put('by', b === 'channel' ? undefined : b)} />
      </div>
      {from && <Orders key={`${from}${to}`} s={s} from={from} to={to ?? from} ctx={ctx} onClose={() => put('orders', undefined)} />}
    </div>
  );
}
