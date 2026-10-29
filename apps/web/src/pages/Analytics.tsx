// UI-11 Store Analytics: where the money comes from (trend, funnel, channels, products, campaigns). The store filter scopes it all.
import { useState } from 'react';
import { Link } from 'react-router';
import type { UseQueryResult } from '@tanstack/react-query';
import { settingsUrl, storeHealth, type AdNetwork, type AnalyticsRange, type AnalyticsSummary, type CampaignStats, type Platform, type Product, type TopProduct } from '@frontline/shared';
import { useCampaigns, useMissingCosts, useSetCost, useStartConversation, useSummary, useTopProducts } from '../api/client';
import { AreaChart } from '../components/AreaChart';
import { Hero } from '../components/Hero';
import { DemoMixNote, StoreFilter, UnconvertedNote, useStoreSelection } from '../components/StoreFilter';
import { PLATFORM_NAME } from '../components/StoreForm';
import { Badge, Button, ErrorState, inputClass, LoadingState, Panel, Segmented, STORE_HEALTH, Table, cx } from '../components/ui';
import { researchHref } from '../knowledge/url';
import { breakEvenRoas, byNetwork, noFeeEstimate, rate, roasTone, times } from '../lib/analytics';
import { PERIOD, RANGES, weekly } from '../lib/chart';
import { cents, fmtDay, money, noBaseline, pct, signedPct } from '../lib/format';
import { stockLeft } from '../lib/stock';
import { NAV } from '../nav';

type Metric = 'revenue' | 'profit' | 'adSpend';
const METRICS: { value: Metric; label: string }[] = [
  { value: 'revenue', label: 'Revenue' },
  { value: 'profit', label: 'Profit' },
  { value: 'adSpend', label: 'Ad spend' },
];
const NETWORK: Record<AdNetwork, string> = { meta: 'Meta', tiktok: 'TikTok', google: 'Google' };
const TONE = { bad: 'text-red', ok: 'text-text', good: 'text-good' };
const num = (n: number) => n.toLocaleString('en-US');

export function Analytics() {
  const nav = NAV[2]!;
  const [range, setRange] = useState<AnalyticsRange>(30);
  const { ids, name } = useStoreSelection();
  const summary = useSummary(ids, range);
  const s = summary.data;
  return (
    <>
      <Hero title={nav.title} subtitle={nav.subtitle} icon={nav.icon} />
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
        <DemoMixNote />
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
      <UnitCosts ids={ids} multi={multi} />
      <Campaigns q={campaigns} be={be} beOf={(id) => breakEvenRoas(s.byStore.find((b) => b.storeId === id)?.totals ?? s.totals)} name={multi ? name : undefined} cur={s.currency} />
      {multi && <ByStore s={s} name={name} />}
    </div>
  );
}

function Trend({ s, be }: { s: AnalyticsSummary; be: number }) {
  const [metric, setMetric] = useState<Metric>('revenue');
  const { stores, has } = useStoreSelection();
  const noFees = noFeeEstimate(stores.filter((x) => has(x.id)));
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
      {metric === 'profit' && noFees.length > 0 && (
        <p className="mb-2 text-xs text-muted">
          Leaves out platform and payment fees for {noFees.map((x) => x.name).join(', ')}: no fee estimate.{' '}
          <Link to={settingsUrl('stores')} className="text-red hover:underline">
            Set one in Settings
          </Link>
        </p>
      )}
      <AreaChart points={s.range === 365 ? weekly(daily) : daily} weekly={s.range === 365} partial currency={s.currency} label={`${label}, ${PERIOD[s.range]}: ${money(s.totals[metric], s.currency)} total`} />
      <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-line pt-3 text-[13px] min-[620px]:grid-cols-4">
        <Stat label="ROAS" value={times(s.totals.roas, s.totals.adSpend)} />
        <Stat label="Break-even ROAS" value={Number.isFinite(be) ? times(be) : 'n/a'} />
        <Stat label="Orders" value={num(s.totals.orders)} />
        <Stat label="Avg. order" value={money(s.totals.aov, s.currency)} />
      </dl>
      <PlatformSplit s={s} />
    </Panel>
  );
}

/** Sales by platform: a store with a second channel (a TikTok Shop or Amazon next to its site), or stores on different ones. */
export function PlatformSplit({ s }: { s: AnalyticsSummary }) {
  const ps = s.byPlatform ?? [];
  if (ps.length < 2) return null;
  const total = ps.reduce((n, p) => n + p.revenue, 0);
  return (
    <div className="mt-3 border-t border-line pt-3">
      <h3 className="mb-2 text-xs text-muted">Sales by platform</h3>
      <ul className="grid gap-x-6 gap-y-3 min-[620px]:grid-cols-2">
        {ps.map((p) => (
          <li key={p.platform}>
            <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[13px]">
              <span className="font-semibold">{PLATFORM_NAME[p.platform]}</span>
              <b className="tabular-nums">{money(p.revenue, s.currency)}</b>
            </div>
            <div className="h-2 rounded-full bg-white/5">
              <div className="h-full min-w-1 rounded-full bg-red" style={{ width: `${rate(p.revenue, total)}%` }} />
            </div>
            <div className="mt-1 flex justify-between text-xs text-muted tabular-nums">
              <span>{`${num(p.orders)} order${p.orders === 1 ? '' : 's'}`}</span>
              <span>{`${pct(rate(p.revenue, total))} of sales`}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div>
    <dt className="text-xs text-muted">{label}</dt>
    <dd className="font-semibold tabular-nums">{value}</dd>
  </div>
);

export function FunnelPanel({ s }: { s: AnalyticsSummary }) {
  const f = s.funnel;
  const { stores, has } = useStoreSelection();
  // Without GA4, a connected Shopify store's sessions come from ShopifyQL (the app's read_reports scope), and a TikTok
  // Shop's from its shop performance (the TikTok Shop Analytics scope).
  const connected = (platform: Platform) => stores.some((x) => has(x.id) && x.connected && x.platform === platform);
  const shopify = connected('shopify');
  const tiktok = connected('tiktok_shop');
  const all: [string, number][] = [
    ['Sessions', f.sessions],
    ['Added to cart', f.addToCarts],
    ['Reached checkout', f.checkouts],
    ['Ordered', f.orders],
  ];
  // A middle step at 0 while orders came in isn't reported (Amazon has no cart or checkout data): leave it out.
  const steps = all.filter(([, n], i) => n > 0 || i === 0 || i === all.length - 1 || !f.orders);
  // GA4's carts and checkouts are event counts (Shopify's are sessions), so a step can outnumber the one before it.
  const events = steps.some(([, n], i) => i > 0 && n > steps[i - 1]![1]);
  return (
    <Panel title="Conversion Funnel" sub={f.sessions ? `${pct(rate(f.orders, f.sessions))} of sessions place an order` : `${num(f.orders)} orders`}>
      {!f.sessions ? (
        <p className="text-[13px] text-muted">
          Sessions, carts and checkouts come from Google Analytics.{' '}
          <Link to={settingsUrl('integrations')} className="text-red hover:underline">
            Connect GA4
          </Link>{' '}
          to see where shoppers drop off.
          {shopify && " A Shopify store can use Shopify's own reports instead: add the read_reports scope (with Level 2 protected customer data) to your Shopify app."}
          {tiktok && " A TikTok Shop store's visitors can come from TikTok: add the TikTok Shop Analytics scope to your TikTok Shop app."}
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
                <div className="h-full min-w-1 rounded-full bg-red" style={{ width: `${Math.min(100, rate(n, f.sessions))}%` }} />
              </div>
            </li>
          ))}
          {steps.length < all.length && <li className="text-xs text-muted">Steps the platform doesn't report are left out.</li>}
          {events && (
            <li className="text-xs text-muted">
              Carts and checkouts count GA4's add-to-cart and checkout events, not sessions: a shopper who adds several items counts more than once.
            </li>
          )}
          {/* Core counts only orders its sessions cover (not days before traffic data, nor Amazon sold next to the site),
              so those aren't a drop-off. */}
          {f.orders < s.totals.orders && (
            <li className="text-xs text-muted">
              Ordered only counts orders these sessions cover (not other channels, or days without traffic data): {num(f.orders)} of{' '}
              {num(s.totals.orders)}.
            </li>
          )}
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
                <span className={c.spend ? TONE[roasTone(c.roas, be)] : undefined}>{times(c.roas, c.spend)} ROAS</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function TopProducts({ ids, range, name, cur }: { ids: string[]; range: AnalyticsRange; name?: (id: string) => string; cur?: string }) {
  const q = useTopProducts(ids, range, 5);
  return (
    <Panel title="Top Products" sub={`Best 5 by revenue, ${PERIOD[range]}`}>
      {q.isPending ? (
        <LoadingState rows={4} />
      ) : q.isError ? (
        <ErrorState message="Couldn't load products." onRetry={() => q.refetch()} />
      ) : (
        <TopTable rows={q.data} name={name} cur={cur} stock={(p) => stockLeft(p.inventory === undefined ? undefined : { ...p, inventory: p.inventory }, p.units, range)} />
      )}
    </Panel>
  );
}

/** Products the platform reports no cost for (Etsy, TikTok Shop, Woo without COGS): their profit is the whole price until set. */
export function UnitCosts({ ids, multi }: { ids: string[]; multi: boolean }) {
  // ponytail: first 200 products per call; page through when a store's catalog outgrows that.
  const missing = useMissingCosts(ids).data ?? [];
  if (!missing.length) return null;
  return (
    <Panel
      title="Unit costs"
      sub={`${missing.length} product${missing.length === 1 ? ' has' : 's have'} no unit cost, so ${missing.length === 1 ? 'its' : 'their'} whole price counts as profit. Enter what each costs you, shipping included.`}
    >
      <ul className="divide-y divide-line">
        {missing.slice(0, 8).map((p) => (
          <CostRow key={p.storeId + p.id} p={p} multi={multi} thumbs={missing.some((x) => x.image)} />
        ))}
      </ul>
      {missing.length > 8 && <p className="mt-2 text-xs text-muted">{missing.length - 8} more show up here as you fill these in.</p>}
    </Panel>
  );
}

function CostRow({ p, multi, thumbs }: { p: Product; multi: boolean; thumbs: boolean }) {
  const save = useSetCost();
  const { name, currency } = useStoreSelection();
  const [value, setValue] = useState('');
  const cost = Number(value);
  const valid = value.trim() !== '' && Number.isFinite(cost) && cost > 0;
  return (
    <li className="py-2.5 first:pt-0 last:pb-0">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) save.mutate({ storeId: p.storeId, id: p.id, cost });
        }}
        className="flex flex-wrap items-center gap-x-3 gap-y-1.5"
      >
        {thumbs && <Thumb src={p.image} />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold" title={p.title}>
            {p.title}
          </span>
          <span className="block text-xs text-muted">
            {multi && `${name(p.storeId)} · `}sells for {cents(p.price, currency(p.storeId))}
          </span>
        </span>
        <input
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Unit cost"
          aria-label={`Unit cost of ${p.title}`}
          className={cx(inputClass, 'w-28 text-right tabular-nums')}
        />
        <Button type="submit" size="sm" disabled={!valid || save.isPending}>
          Save cost
        </Button>
      </form>
      {save.isError && (
        <p role="alert" className="mt-1 text-xs text-red">
          {save.error.message}
        </p>
      )}
    </li>
  );
}

/** A product's photo at row size. Lists render it only when some product has one; a blank tile keeps titles aligned. */
const Thumb = ({ src }: { src?: string }) =>
  src ? <img data-thumb src={src} alt="" loading="lazy" className="size-9 shrink-0 rounded-md bg-panel-2 object-cover" /> : <span data-thumb aria-hidden className="size-9 shrink-0 rounded-md bg-panel-2" />;

export function TopTable({ rows, name, cur, stock }: { rows: TopProduct[]; name?: (id: string) => string; cur?: string; stock: (p: TopProduct) => ReturnType<typeof stockLeft> }) {
  if (!rows.length) return <p className="text-[13px] text-muted">No product sales in this period.</p>;
  const thumbs = rows.some((p) => p.image);
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
        {rows.map((p) => {
          const st = stock(p);
          return (
            <tr key={p.storeId + p.productId}>
              <td className="max-w-[280px]">
                <div className="flex items-center gap-2.5">
                  {thumbs && <Thumb src={p.image} />}
                  <div className="min-w-0">
                    <div className="truncate" title={p.title}>
                      {p.title}
                    </div>
                    {(name || st) && (
                      <div className="text-xs text-muted">
                        {name?.(p.storeId)}
                        {name && st && ' · '}
                        {st && <span className={cx(st.low && 'text-red')}>{st.label}</span>}
                      </div>
                    )}
                  </div>
                </div>
              </td>
              <td className="text-right">{num(p.units)}</td>
              <td className="text-right">{money(p.revenue, cur)}</td>
              <td className="text-right">{money(p.profit, cur)}</td>
              <td className="text-right text-text-2">{pct(rate(p.profit, p.revenue))}</td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

/** Opens an Ad Strategist conversation about the campaign (decision 14): the agent reads it from the store's own data. */
function AskStrategist({ c }: { c: CampaignStats }) {
  const { start, isPending, error } = useStartConversation(c.storeId);
  const ask = () =>
    start({ type: 'ad_strategist', title: `${c.name}: what next`, objective: `Review the ${NETWORK[c.network]} campaign "${c.name}" and tell me what to do next.`, context: { kind: 'campaign', network: c.network, id: c.id, name: c.name } });
  return (
    <>
      <button type="button" aria-label={`Ask Ad Strategist about ${c.name}`} disabled={isPending} onClick={ask} className="cursor-pointer hover:text-white hover:underline disabled:opacity-60">
        Ask Ad Strategist
      </button>
      {error && <span className="block whitespace-normal text-[#ff6b76]">{error.message}</span>}
    </>
  );
}

/** Each campaign is judged against its own store's break-even (margins differ per store); `be` is the blended one. */
export function Campaigns({ q, be, beOf, name, cur }: { q: Campaigns; be: number; beOf: (storeId: string) => number; name?: (id: string) => string; cur?: string }) {
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
                      {' · '}
                      <Link to={researchHref(c.storeId, `How to make the "${c.name}" ${NETWORK[c.network]} campaign more profitable`)} className="hover:text-white hover:underline">
                        Research this<span className="sr-only">: {c.name}</span>
                      </Link>
                      {' · '}
                      <AskStrategist c={c} />
                    </div>
                  </td>
                  <td>{c.status === 'active' ? <span className="text-text-2">Active</span> : <Badge>{c.status === 'paused' ? 'Paused' : 'Archived'}</Badge>}</td>
                  <td className="text-right">
                    {/* Synced as 0: a lifetime budget, budgets on its ad sets, or archived (core's setCampaignBudget refuses these). */}
                    {c.dailyBudget ? (
                      money(c.dailyBudget, cur)
                    ) : (
                      <span className="text-muted" title={c.status === 'archived' ? undefined : 'No daily budget of its own: a lifetime budget, or budgets on its ad sets'}>
                        –
                      </span>
                    )}
                  </td>
                  <td className="text-right">{money(c.spend, cur)}</td>
                  <td className="text-right">{money(c.revenue, cur)}</td>
                  <td className={cx('text-right font-semibold', c.spend ? TONE[roasTone(c.roas, beOf(c.storeId))] : 'text-muted')}>{times(c.roas, c.spend)}</td>
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
            ) : Number.isNaN(be) ? (
              "No sales this period, so there's no break-even to judge campaigns against yet."
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
                  <td className="text-right">{times(t.roas, t.adSpend)}</td>
                  <td className="text-right">{num(t.orders)}</td>
                </tr>
              );
            })}
        </tbody>
      </Table>
    </Panel>
  );
}
