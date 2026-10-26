// UI-11 Store Analytics: where the money comes from (trend, funnel, channels, products, campaigns). The store filter scopes it all.
import { useState } from 'react';
import { Link } from 'react-router';
import type { UseQueryResult } from '@tanstack/react-query';
import { storeHealth, type AdNetwork, type AnalyticsRange, type AnalyticsSummary, type CampaignStats, type TopProduct } from '@frontline/shared';
import { useCampaigns, useSummary, useTopProducts } from '../api/client';
import { AreaChart } from '../components/AreaChart';
import { Hero } from '../components/Hero';
import { StoreFilter, UnconvertedNote, useStoreSelection } from '../components/StoreFilter';
import { Badge, ErrorState, LoadingState, Panel, Segmented, STORE_HEALTH, Table, cx } from '../components/ui';
import { breakEvenRoas, byNetwork, rate, roasTone } from '../lib/analytics';
import { PERIOD, RANGES, weekly } from '../lib/chart';
import { fmtDay, money, noBaseline, signedPct } from '../lib/format';
import { NAV } from '../nav';

type Metric = 'revenue' | 'profit' | 'adSpend';
const METRICS: { value: Metric; label: string }[] = [
  { value: 'revenue', label: 'Revenue' },
  { value: 'profit', label: 'Profit' },
  { value: 'adSpend', label: 'Ad spend' },
];
const NETWORK: Record<AdNetwork, string> = { meta: 'Meta', tiktok: 'TikTok', google: 'Google' };
const TONE = { bad: 'text-red', ok: 'text-text', good: 'text-good' };
const times = (n: number) => `${n.toFixed(2)}×`;
const pct = (n: number) => `${n.toFixed(1)}%`;
const num = (n: number) => n.toLocaleString('en-US');

export function Analytics() {
  const nav = NAV[2]!;
  const [range, setRange] = useState<AnalyticsRange>(30);
  const { ids, name } = useStoreSelection();
  const summary = useSummary(ids, range);
  const s = summary.data;
  return (
    <>
      <Hero title={nav.title} subtitle={nav.subtitle} icon={nav.icon} art={nav.art} />
      <div className="mb-3.5 flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
        <StoreFilter />
        {s && (
          <span className="text-xs text-muted">
            {fmtDay(s.from)} – {fmtDay(s.to)} · changes vs the {PERIOD[range].replace('last', 'previous')}
          </span>
        )}
        <div className="min-[620px]:ml-auto">
          <Segmented label="Date range" options={RANGES} value={range} onChange={setRange} />
        </div>
        <UnconvertedNote codes={s?.unconverted} />
      </div>
      {summary.isError ? (
        <ErrorState message="Couldn't load analytics." onRetry={() => summary.refetch()} />
      ) : !s ? (
        <LoadingState rows={6} />
      ) : (
        <Report s={s} ids={ids} name={name} dim={summary.isPlaceholderData} />
      )}
    </>
  );
}

function Report({ s, ids, name, dim }: { s: AnalyticsSummary; ids: string[]; name: (id: string) => string; dim: boolean }) {
  const campaigns = useCampaigns(ids, s.range);
  const be = breakEvenRoas(s.totals);
  const multi = s.byStore.length > 1;
  return (
    <div className={cx('grid gap-3.5 transition-opacity', dim && 'opacity-60')}>
      <div className="grid gap-3.5 min-[1100px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Trend s={s} be={be} />
        <FunnelPanel s={s} />
      </div>
      <div className="grid gap-3.5 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Channels q={campaigns} be={be} cur={s.currency} />
        <TopProducts ids={ids} range={s.range} name={multi ? name : undefined} cur={s.currency} />
      </div>
      <Campaigns q={campaigns} be={be} beOf={(id) => breakEvenRoas(s.byStore.find((b) => b.storeId === id)?.totals ?? s.totals)} name={multi ? name : undefined} cur={s.currency} />
      {multi && <ByStore s={s} name={name} />}
    </div>
  );
}

function Trend({ s, be }: { s: AnalyticsSummary; be: number }) {
  const [metric, setMetric] = useState<Metric>('revenue');
  const daily = s.series.map((d) => ({ date: d.date, value: d[metric] }));
  const d = s.deltas[metric];
  const fresh = noBaseline(s.previous[metric], s.totals[metric]);
  const tone = fresh || metric === 'adSpend' || Math.abs(d) < 0.05 ? 'text-muted' : d > 0 ? 'text-good' : 'text-red';
  const label = METRICS.find((m) => m.value === metric)!.label;
  return (
    <Panel
      title="Revenue & Profit"
      sub={`${PERIOD[s.range]} · ${s.range === 365 ? 'weekly' : 'daily'}`}
      action={<Segmented label="Metric" options={METRICS} value={metric} onChange={setMetric} />}
    >
      <p className="mb-2 flex items-baseline gap-2">
        <b className="font-display text-2xl tabular-nums">{money(s.totals[metric], s.currency)}</b>
        <span className={cx('text-xs font-semibold tabular-nums', tone)}>{fresh ? 'New' : signedPct(d)}</span>
        <span className="text-xs text-muted">{fresh ? 'nothing in the previous period' : 'vs previous period'}</span>
      </p>
      <AreaChart points={s.range === 365 ? weekly(daily) : daily} weekly={s.range === 365} partial currency={s.currency} label={`${label}, ${PERIOD[s.range]}: ${money(s.totals[metric], s.currency)} total`} />
      <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-line pt-3 text-[13px] min-[620px]:grid-cols-4">
        <Stat label="ROAS" value={times(s.totals.roas)} />
        <Stat label="Break-even ROAS" value={Number.isFinite(be) ? times(be) : 'n/a'} />
        <Stat label="Orders" value={num(s.totals.orders)} />
        <Stat label="Avg. order" value={money(s.totals.aov, s.currency)} />
      </dl>
    </Panel>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div>
    <dt className="text-xs text-muted">{label}</dt>
    <dd className="font-semibold tabular-nums">{value}</dd>
  </div>
);

function FunnelPanel({ s }: { s: AnalyticsSummary }) {
  const f = s.funnel;
  const steps: [string, number][] = [
    ['Sessions', f.sessions],
    ['Added to cart', f.addToCarts],
    ['Reached checkout', f.checkouts],
    ['Ordered', f.orders],
  ];
  return (
    <Panel title="Conversion Funnel" sub={f.sessions ? `${pct(rate(f.orders, f.sessions))} of sessions place an order` : `${num(f.orders)} orders`}>
      {!f.sessions ? (
        <p className="text-[13px] text-muted">
          Sessions, carts and checkouts come from Google Analytics.{' '}
          <Link to="/integrations" className="text-red hover:underline">
            Connect GA4
          </Link>{' '}
          to see where shoppers drop off.
        </p>
      ) : (
        <ol className="grid gap-4">
          {steps.map(([label, n], i) => (
            <li key={label}>
              <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[13px]">
                <span className="text-text-2">{label}</span>
                <span className="tabular-nums">
                  {i > 0 && <span className="mr-2 text-xs text-muted">{pct(rate(n, steps[i - 1]![1]))} of previous</span>}
                  <b>{num(n)}</b>
                </span>
              </div>
              <div className="h-2 rounded-full bg-white/5">
                <div className="h-full min-w-1 rounded-full bg-red" style={{ width: `${rate(n, f.sessions)}%` }} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

type Campaigns = UseQueryResult<CampaignStats[]>;

function Channels({ q, be, cur }: { q: Campaigns; be: number; cur?: string }) {
  const ch = byNetwork(q.data ?? []);
  const top = Math.max(1, ...ch.map((c) => c.revenue));
  return (
    <Panel title="Channels" sub="Ad-attributed revenue by network">
      {q.isPending ? (
        <LoadingState rows={3} />
      ) : q.isError ? (
        <ErrorState message="Couldn't load campaigns." onRetry={() => q.refetch()} />
      ) : !ch.length ? (
        <p className="text-[13px] text-muted">No ad campaigns in this period.</p>
      ) : (
        <ul className="grid gap-4">
          {ch.map((c) => (
            <li key={c.network}>
              <div className="mb-1.5 flex items-baseline justify-between text-[13px]">
                <span className="font-semibold">{NETWORK[c.network]}</span>
                <b className="tabular-nums">{money(c.revenue, cur)}</b>
              </div>
              <div className="h-2 rounded-full bg-white/5">
                <div className="h-full rounded-full bg-red" style={{ width: `${rate(c.revenue, top)}%` }} />
              </div>
              <div className="mt-1 flex justify-between text-xs text-muted tabular-nums">
                <span>
                  {money(c.spend, cur)} spend · {num(c.purchases)} purchases
                </span>
                <span className={TONE[roasTone(c.roas, be)]}>{times(c.roas)} ROAS</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function TopProducts({ ids, range, name, cur }: { ids: string[]; range: AnalyticsRange; name?: (id: string) => string; cur?: string }) {
  const q = useTopProducts(ids, range, 5);
  return (
    <Panel title="Top Products" sub={`Best 5 by revenue, ${PERIOD[range]}`}>
      {q.isPending ? (
        <LoadingState rows={4} />
      ) : q.isError ? (
        <ErrorState message="Couldn't load products." onRetry={() => q.refetch()} />
      ) : (
        <TopTable rows={q.data} name={name} cur={cur} />
      )}
    </Panel>
  );
}

function TopTable({ rows, name, cur }: { rows: TopProduct[]; name?: (id: string) => string; cur?: string }) {
  if (!rows.length) return <p className="text-[13px] text-muted">No product sales in this period.</p>;
  return (
    <Table>
      <thead>
        <tr>
          <th>Product</th>
          <th className="text-right!">Units</th>
          <th className="text-right!">Revenue</th>
          <th className="text-right!">Profit</th>
          <th className="text-right!">Margin</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.storeId + p.productId}>
            <td className="max-w-[280px]">
              <div className="truncate" title={p.title}>
                {p.title}
              </div>
              {name && <div className="text-xs text-muted">{name(p.storeId)}</div>}
            </td>
            <td className="text-right">{num(p.units)}</td>
            <td className="text-right">{money(p.revenue, cur)}</td>
            <td className="text-right">{money(p.profit, cur)}</td>
            <td className="text-right text-text-2">{pct(rate(p.profit, p.revenue))}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** Each campaign is judged against its own store's break-even (margins differ per store); `be` is the blended one. */
function Campaigns({ q, be, beOf, name, cur }: { q: Campaigns; be: number; beOf: (storeId: string) => number; name?: (id: string) => string; cur?: string }) {
  const cs = q.data ?? [];
  return (
    <Panel title="Campaigns" sub={`${cs.length} campaigns, biggest spend first`}>
      {q.isPending ? (
        <LoadingState rows={4} />
      ) : q.isError ? (
        <ErrorState message="Couldn't load campaigns." onRetry={() => q.refetch()} />
      ) : !cs.length ? (
        <p className="text-[13px] text-muted">No ad campaigns in this period.</p>
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Status</th>
                <th className="text-right!">Budget/day</th>
                <th className="text-right!">Spend</th>
                <th className="text-right!">Revenue</th>
                <th className="text-right!">ROAS</th>
                <th className="text-right!">Purchases</th>
                <th className="text-right!">CPA</th>
                <th className="text-right!">CTR</th>
              </tr>
            </thead>
            <tbody>
              {cs.map((c) => (
                <tr key={c.network + c.id}>
                  <td className="whitespace-nowrap">
                    <div>{c.name}</div>
                    <div className="text-xs text-muted">
                      {NETWORK[c.network]}
                      {name && ` · ${name(c.storeId)}`}
                    </div>
                  </td>
                  <td>{c.status === 'active' ? <span className="text-text-2">Active</span> : <Badge>{c.status === 'paused' ? 'Paused' : 'Archived'}</Badge>}</td>
                  <td className="text-right">{money(c.dailyBudget, cur)}</td>
                  <td className="text-right">{money(c.spend, cur)}</td>
                  <td className="text-right">{money(c.revenue, cur)}</td>
                  <td className={cx('text-right font-semibold', TONE[roasTone(c.roas, beOf(c.storeId))])}>{times(c.roas)}</td>
                  <td className="text-right">{num(c.purchases)}</td>
                  <td className="text-right">{c.purchases ? money(c.spend / c.purchases, cur) : '–'}</td>
                  <td className="text-right">{pct(rate(c.clicks, c.impressions))}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="mt-3 text-xs text-muted">
            {Number.isFinite(be) ? (
              <>
                {name ? `Each campaign is judged against its store's break-even ROAS (${times(be)} blended)` : `Break-even ROAS is ${times(be)} at your margin`}:{' '}
                <span className="text-red">red</span> campaigns lose money, <span className="text-good">green</span> ones clear 1.5× break-even.
              </>
            ) : (
              'No gross margin this period, so every campaign loses money.'
            )}
          </p>
        </>
      )}
    </Panel>
  );
}

function ByStore({ s, name }: { s: AnalyticsSummary; name: (id: string) => string }) {
  return (
    <Panel title="By Store" sub={`Each store, ${PERIOD[s.range]}`}>
      <Table>
        <thead>
          <tr>
            <th>Store</th>
            <th>Health</th>
            <th className="text-right!">Revenue</th>
            <th className="text-right!">Change</th>
            <th className="text-right!">Profit</th>
            <th className="text-right!">Ad spend</th>
            <th className="text-right!">ROAS</th>
            <th className="text-right!">Orders</th>
          </tr>
        </thead>
        <tbody>
          {[...s.byStore]
            .sort((a, b) => b.totals.revenue - a.totals.revenue)
            .map(({ storeId, totals: t, previous: p, deltas: d }) => {
              const h = storeHealth(t);
              return (
                <tr key={storeId}>
                  <td>{name(storeId)}</td>
                  <td>
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      <Badge tone={STORE_HEALTH[h.status].tone}>{STORE_HEALTH[h.status].label}</Badge>
                      <span className="text-xs text-muted">{h.marginPct < 0 ? '−' : ''}{Math.abs(h.marginPct)}% net margin</span>
                    </span>
                  </td>
                  <td className="text-right">{money(t.revenue, s.currency)}</td>
                  <td className={cx('text-right', noBaseline(p.revenue, t.revenue) || Math.abs(d.revenue) < 0.05 ? 'text-muted' : d.revenue > 0 ? 'text-good' : 'text-red')}>
                    {noBaseline(p.revenue, t.revenue) ? 'New' : signedPct(d.revenue)}
                  </td>
                  <td className="text-right">{money(t.profit, s.currency)}</td>
                  <td className="text-right">{money(t.adSpend, s.currency)}</td>
                  <td className="text-right">{times(t.roas)}</td>
                  <td className="text-right">{num(t.orders)}</td>
                </tr>
              );
            })}
        </tbody>
      </Table>
    </Panel>
  );
}
