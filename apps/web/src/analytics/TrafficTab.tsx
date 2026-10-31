// SA-102 (spec §8 Traffic and conversion): the Traffic & Conversion tab. Sessions and site conversion as /metrics gives
// them, their trend, the site funnel as its source reports it (SA-100: a step rate only between steps counted the same
// way), sessions by source, device or country (`traffic_by=`), and a marketplace's own traffic, apart from the site's.
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { SA_METRICS, SA_REASONS, SA_SOURCES, SA_TRAFFIC_BREAKDOWNS, ratio, type SaContext, type SaMetricId, type SaTraffic, type SaTrafficBy } from '@frontline/shared';
import { Button, cx, ErrorState, LoadingState, Segmented } from '../components/ui';
import { useSaContext, useSaSeries, useSaTraffic } from './api';
import { FilterScope } from './FilterScope';
import { fmtValue, KpiStrip } from './KpiStrip';
import type { AnalyticsPage } from './state';
import { TrendChart } from './TrendChart';
import { Unavailable } from './Unavailable';

type S = AnalyticsPage & { store: string };
const TH = 'pb-1.5 text-right font-medium';
const CHART = [
  { value: 'sessions', label: 'Sessions' },
  { value: 'site_conversion', label: 'Site conversion' },
] as const;
const BY: Record<SaTrafficBy, string> = { source: 'Source', device: 'Device', country: 'Country' };
const count = (n: number) => fmtValue('sessions', n);
const pct = (n: number) => (n < 0.005 ? '<1%' : `${Math.round(n * 100)}%`);

/** An ISO country code as its name (the code when the browser can't name it). */
export function countryName(code: string) {
  if (!/^[A-Z]{2}$/.test(code)) return code;
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** A breakdown value as people read it: a country code as its name, anything else capitalised (`unknown` → Unknown). */
const named = (by: SaTrafficBy, v: string) => (by === 'country' && v !== 'unknown' ? countryName(v) : v[0]!.toUpperCase() + v.slice(1));

const Bar = ({ share }: { share: number }) => (
  <span className="flex items-center gap-2">
    <i aria-hidden className="h-1.5 rounded-full bg-red/70" style={{ width: `${Math.min(100, share * 100)}%` }} />
    <span className="text-[11px] text-muted">{pct(share)}</span>
  </span>
);

function Trend({ s, ctx }: { s: S; ctx?: SaContext }) {
  const [metric, setMetric] = useState<SaMetricId>('sessions');
  const [table, setTable] = useState(false);
  const q = useSaSeries(s, metric);
  const label = SA_METRICS[metric].label;
  return (
    <section className="card min-w-0 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5">
        <h2 className="font-display text-base font-semibold tracking-[.02em]">{label}</h2>
        <div className="w-[240px] max-w-full">
          <Segmented quiet label="Chart metric" options={[...CHART]} value={metric} onChange={(v) => setMetric(v as SaMetricId)} />
        </div>
      </div>
      {q.isError ? (
        <ErrorState message="Couldn't load the trend." onRetry={() => q.refetch()} />
      ) : !q.data || q.data.metric !== metric ? (
        <LoadingState rows={3} />
      ) : (
        <TrendChart series={q.data} label={label} currency={ctx?.currency} table={table} />
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

function Funnel({ d }: { d: SaTraffic }) {
  const first = d.steps[0]!;
  const events = d.steps.some((x) => x.unit === 'events');
  return (
    <section className="card min-w-0 p-4">
      <div className="mb-3">
        <h2 className="font-display text-base font-semibold tracking-[.02em]">Site funnel</h2>
        {d.source && <div className="text-xs text-muted">Counted in sessions{events && ' and events'}, as {SA_SOURCES[d.source].name} reports them</div>}
      </div>
      {d.steps.every((x) => x.value.value == null) ? (
        <Unavailable value={first.value} className="text-[12.5px]" />
      ) : (
        <table aria-label="Site funnel" className="w-full text-[12.5px] tabular-nums">
          <thead>
            <tr className="text-left text-[11px] text-muted">
              <th className="pb-1.5 font-medium">Step</th>
              <th className={TH}>Count</th>
              <th className={cx(TH, 'w-[32%]')}>Of sessions</th>
            </tr>
          </thead>
          <tbody>
            {d.steps.map((x) => {
              const v = x.value.value;
              const share = x.id !== 'sessions' && x.unit === first.unit && v != null && first.value.value ? v / first.value.value : null;
              return (
                <tr key={x.id} className="border-t border-[#1c1c21] [&>td]:py-[7px]">
                  <td className="pr-3">
                    {x.label}
                    {v != null && x.value.note && <div className="text-[11px] text-muted">{x.value.note}</div>}
                  </td>
                  <td className="text-right">{v == null ? <Unavailable value={x.value} className="justify-end text-[12px]" /> : count(v)}</td>
                  <td className="pl-3">{share != null && <Bar share={share} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {events && <p className="mt-2 text-[11px] text-muted">Carts and checkouts are event counts here, not sessions, so they get no rate against sessions.</p>}
    </section>
  );
}

function Breakdown({ d, by, onBy }: { d: SaTraffic; by: SaTrafficBy; onBy: (b: string) => void }) {
  const b = d.breakdowns[by];
  const total = b.rows.reduce((a, r) => a + r.sessions, 0);
  const rates = b.rows.some((r) => r.purchase_sessions != null);
  return (
    <section className="card min-w-0 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5">
        <h2 className="font-display text-base font-semibold tracking-[.02em]">Sessions by {BY[by].toLowerCase()}</h2>
        <div className="w-[260px] max-w-full">
          <Segmented quiet label="Sessions by" options={SA_TRAFFIC_BREAKDOWNS.map((x) => ({ value: x, label: BY[x] }))} value={by} onChange={onBy} />
        </div>
      </div>
      {!b.rows.length ? (
        <p className="text-[12.5px] text-muted">
          {b.reason && <b className="font-semibold text-text-2">{SA_REASONS[b.reason]}: </b>}
          {b.note ?? 'No sessions in this period.'}
        </p>
      ) : (
        <table aria-label={`Sessions by ${by}`} className="w-full text-[12.5px] tabular-nums">
          <thead>
            <tr className="text-left text-[11px] text-muted">
              <th className="pb-1.5 font-medium">{BY[by]}</th>
              <th className={TH}>Sessions</th>
              <th className={cx(TH, 'w-[28%]')}>Share</th>
              {rates && <th className={TH}>Conversion</th>}
            </tr>
          </thead>
          <tbody>
            {b.rows.map((r) => {
              const rate = r.purchase_sessions == null ? null : ratio(r.purchase_sessions, r.sessions);
              return (
                <tr key={r.value} className={cx('border-t border-[#1c1c21] [&>td]:py-[7px]', r.value === 'unknown' && 'text-text-2')}>
                  <td className="max-w-0 truncate pr-3">{named(by, r.value)}</td>
                  <td className="text-right">{count(r.sessions)}</td>
                  <td className="pl-3">{total > 0 && r.sessions > 0 && <Bar share={r.sessions / total} />}</td>
                  {rates && <td className="text-right">{rate == null ? '–' : fmtValue('site_conversion', rate)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {b.rows.some((r) => r.value === 'unknown') && <p className="mt-2 text-[11px] text-muted">Unknown: sessions the source couldn't place, so the rows add up to its sessions.</p>}
    </section>
  );
}

export function TrafficTab({ s }: { s: S }) {
  const [params, setParams] = useSearchParams();
  const asked = params.get('traffic_by') ?? '';
  const by = (SA_TRAFFIC_BREAKDOWNS as readonly string[]).includes(asked) ? (asked as SaTrafficBy) : 'source';
  const q = useSaTraffic(s);
  const ctx = useSaContext(s.store).data;
  if (q.isError) return <ErrorState message="Couldn't load traffic." onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingState rows={3} />;
  const d = q.data;
  const onBy = (b: string) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (b === 'source') n.delete('traffic_by');
      else n.set('traffic_by', b);
      return n;
    });
  return (
    <div className="mb-4 grid gap-3.5">
      <section aria-label="Sessions and conversion" className="grid gap-2">
        <KpiStrip metrics={d.metrics} ctx={ctx} tabs={[]} />
        <FilterScope scope={d.scope} />
      </section>
      <Trend s={s} ctx={ctx} />
      <div className="grid items-start gap-3.5 min-[1180px]:grid-cols-2">
        <Funnel d={d} />
        <Breakdown d={d} by={by} onBy={onBy} />
      </div>
      {d.channels.length > 0 && (
        <section aria-label="Marketplace traffic" className="card min-w-0 p-4">
          <h2 className="font-display text-base font-semibold tracking-[.02em]">Marketplace traffic</h2>
          <div className="mb-2 text-xs text-muted">Each marketplace's own count, never added to the site's sessions</div>
          <ul className="grid gap-1.5 text-[12.5px]">
            {d.channels.map((c) => (
              <li key={c.channel} className="flex flex-wrap items-baseline gap-x-2">
                <span>
                  {SA_SOURCES[c.channel].name} {c.label.toLowerCase()}
                </span>
                {c.value.value == null ? (
                  <Unavailable value={c.value} className="text-[12px]" />
                ) : (
                  <>
                    <b className="font-semibold tabular-nums">{count(c.value.value)}</b>
                    {c.value.note && <span className="text-[11px] text-muted">{c.value.note}</span>}
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
