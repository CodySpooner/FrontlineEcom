// SA-88 (the Listings board): the product drawer, opened by `product=` in the URL from a Listings row or a Needs
// attention flag. Its header facts and pills come from the product endpoint (SA-87); its tabs render as their content
// ships (decision 33): Performance (SA-89), Variants and Channels (SA-90) with its product links (SA-91), Costs and
// Refunds (SA-92). Closed, it hands focus back to what opened it.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { SA_METRICS, type Platform, type SaListingRow, type SaMetricId, type SaMetricResult, type SaProductDetail } from '@frontline/shared';
import { useSetCost } from '../api/client';
import { PLATFORM_NAME } from '../components/StoreForm';
import { Button, cx, Dialog, ErrorState, LoadingState, Tabs } from '../components/ui';
import { ago, cents, fmtDay, money, pct } from '../lib/format';
import { useSaContext, useSaLink, useSaListings, useSaProduct } from './api';
import { BarChart } from './BarChart';
import { FilterScope } from './FilterScope';
import { channelsOf } from './Filters';
import { Change, fmtValue } from './KpiStrip';
import { ChannelMark, dash, lone, stock, val } from './ListingsTab';
import { periodParams, type AnalyticsPage } from './state';
import { Unavailable } from './Unavailable';

const TONE = { good: 'border-good/40 text-good', warn: 'border-amber/45 text-amber', red: 'border-red/50 text-[#ff6b77]', muted: 'border-line-2 text-text-2' };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The stock pill: a count only where one is kept, with its cover when there is one (decision 27). */
function stockPill(r: SaListingRow): [string, keyof typeof TONE] {
  const n = `${(r.stock ?? 0).toLocaleString('en-US')} in stock`;
  const cover = r.coverDays == null ? '' : ` · ~${r.coverDays < 1 ? '<1' : Math.round(r.coverDays)} days`;
  switch (r.stockState) {
    case 'out':
      return ['Out of stock', 'red'];
    case 'low':
      return [n + cover, 'warn'];
    case 'not_tracked':
      return ['Stock not tracked', 'muted'];
    case 'fba':
      return ['Stock at Amazon (FBA)', 'muted'];
    case 'supplier':
      return ['Supplier-managed stock', 'muted'];
    default:
      return r.variants > 1 && r.variantsOut ? [`${n} · ${r.variantsOut} variants out`, 'warn'] : [n + cover, 'muted'];
  }
}

const TH = 'border-b border-line px-2 py-1.5 text-[11px] font-semibold whitespace-nowrap text-muted';
const GRID = 'w-full border-collapse text-[12px] tabular-nums [&_td]:border-b [&_td]:border-[#1c1c21] [&_td]:px-2 [&_td]:py-[5px] [&_td]:whitespace-nowrap';
const status = (c: { status: string | null }) => (c.status ? `${c.status.charAt(0).toUpperCase()}${c.status.slice(1)}` : 'Not listed');
/** Where a unit cost came from: a platform, the owner (Unit costs, the drawer's Costs tab) or the demo catalog. */
const costSource = (s: string) => (s === 'owner' ? 'entered by you' : s === 'demo' ? 'demo' : (PLATFORM_NAME[s as Platform] ?? s));

/** SA-89 (the Listings board): the mini metrics, units a day, the Rule card, the channel table and the price line. */
function Performance({ d, currency, platform, channel }: { d: SaProductDetail; currency?: string; platform?: string; channel: (id: string) => string }) {
  const [table, setTable] = useState(false);
  const m = (id: SaMetricId) => d.metrics.find((x) => x.id === id)!;
  const [net, units, contribution, refunds, rate] = (['net_sales', 'units', 'contribution_before_ads', 'refunds', 'refund_rate'] as const).map(m);
  const tile = (x: SaMetricResult, label: string, line: ReactNode) => (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="text-[13.5px] font-semibold tabular-nums">{x.value == null ? <Unavailable value={x} className="text-[12px]" /> : fmtValue(x.id, x.value, currency)}</dd>
      <span className="text-[11px] text-muted">{line}</span>
    </div>
  );
  const flag = d.insights[0];
  const rule = flag && d.rules.find((r) => r.id === flag.rule);
  const label = `Units sold per ${d.units.grain}`;
  const { unitCost: uc, fees, feeRule } = d.costs;
  return (
    <div className="flex flex-col gap-3.5">
      <dl className="grid grid-cols-2 gap-2.5 min-[480px]:grid-cols-4">
        {tile(net!, 'Net sales', <Change change={net!.change} direction={SA_METRICS.net_sales.direction} />)}
        {tile(units!, 'Units', <Change change={units!.change} direction={SA_METRICS.units.direction} />)}
        {tile(contribution!, 'Contribution before ads', net!.value && contribution!.value != null ? `${Math.round((contribution!.value / net!.value) * 100)}% of net sales` : null)}
        {tile(refunds!, 'Refunds', units!.value != null && rate!.value != null ? `${Math.round(units!.value * rate!.value).toLocaleString('en-US')} units · ${pct(rate!.value * 100)}` : null)}
      </dl>
      <div>
        <div className="mb-1 flex flex-wrap items-center gap-3.5 text-[11.5px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <i aria-hidden className="size-[9px] rounded-[2px] bg-red" />
            {label}
          </span>
          {/* SA-04: no connected source reports views per product */}
          <span className="ml-auto inline-flex items-center gap-1" title="No connected source reports views per product, so there's no product conversion">
            Product views: <span className="text-text-2">not tracked</span>
            <Info aria-hidden className="size-3" />
          </span>
          <Button size="sm" variant="ghost" aria-pressed={table} onClick={() => setTable(!table)}>
            {table ? 'Chart' : 'Table'}
          </Button>
        </div>
        <BarChart points={d.units.points} grain={d.units.grain} label={label} table={table} />
      </div>
      {flag && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-line-2 bg-[#121216] px-3.5 py-3">
          <div className="flex items-center gap-2">
            <span className="rounded-[5px] bg-[#24242a] px-1.5 py-0.5 text-[9.5px] font-bold tracking-[.08em] text-text-2 uppercase">{flag.kind === 'data_health' ? 'Data health' : 'Rule'}</span>
            <b className="text-[13px] font-semibold">{rule?.name ?? flag.title}</b>
          </div>
          <p className="text-[11.5px] leading-normal text-text-2">
            {flag.detail}.{rule && ` Flags when ${rule.when.charAt(0).toLowerCase()}${rule.when.slice(1)}.`}
          </p>
        </div>
      )}
      <div>
        <table aria-label="Channels" className={GRID}>
          <thead>
            <tr>
              <th className={cx(TH, 'text-left')}>Channel</th>
              <th className={cx(TH, 'text-left')}>Publication</th>
              <th className={cx(TH, 'text-right')}>Units</th>
              <th className={cx(TH, 'text-right')}>Net sales</th>
              <th className={cx(TH, 'text-right')}>Refunds</th>
            </tr>
          </thead>
          <tbody>
            {d.channels.map((c) => (
              <tr key={c.channel}>
                <td>
                  <span className="inline-flex items-center gap-1.5">
                    <ChannelMark channel={c.channel} platform={platform} />
                    {channel(c.channel)}
                  </span>
                </td>
                <td className={cx(c.status === 'failed' && 'text-red', !c.status && 'text-muted')} title={c.error ?? undefined}>
                  {status(c)}
                  {c.status && c.publishedAt && ` · since ${fmtDay(c.publishedAt)}`}
                </td>
                <td className="text-right">{val(c.units, (n) => n.toLocaleString('en-US'))}</td>
                <td className="text-right">{val(c.netSales, (n) => money(n, currency))}</td>
                <td className="text-right">{val(c.refunds, (n) => money(n, currency))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {d.channelsNote && <p className="mt-1.5 text-[11px] text-muted">{d.channelsNote}.</p>}
      </div>
      <p className="text-[11px] text-text-2 tabular-nums">
        Price <b className="text-text">{cents(d.row.price, currency)}</b>
        {' · '}
        {uc ? (
          <>
            unit cost <b className="text-text">{cents(uc.value, currency)}</b>{' '}
            <span className="text-muted">
              ({costSource(uc.source)}
              {uc.since && `, since ${fmtDay(uc.since)}`})
            </span>
          </>
        ) : (
          <span className="text-muted">no unit cost</span>
        )}
        {' · '}
        fees{' '}
        {fees.value == null ? (
          <span className="text-muted" title={fees.note}>
            not available
          </span>
        ) : fees.status === 'ok' ? (
          <>
            <b className="text-text">{money(fees.value, currency)}</b> <span className="text-muted">(recorded)</span>
          </>
        ) : (
          <span title={fees.note}>
            <b className="text-text">
              {feeRule.percent}% + {cents(feeRule.perOrder, currency)}
            </b>{' '}
            <span className="text-muted">(estimate)</span>
          </span>
        )}
      </p>
    </div>
  );
}

/** SA-90: each variant's SKU, price, stock state and period sales. */
function Variants({ d, currency }: { d: SaProductDetail; currency?: string }) {
  return (
    <div>
      <table aria-label="Variants" className={GRID}>
        <thead>
          <tr>
            <th className={cx(TH, 'text-left')}>Variant</th>
            <th className={cx(TH, 'text-right')}>Price</th>
            <th className={cx(TH, 'text-right')}>Stock</th>
            <th className={cx(TH, 'text-right')}>Units</th>
            <th className={cx(TH, 'text-right')}>Net sales</th>
            <th className={cx(TH, 'text-right')}>Refunds</th>
          </tr>
        </thead>
        <tbody>
          {d.variants.rows.map((v) => {
            const [text, tone, title] = stock(v);
            return (
              <tr key={v.id}>
                <td className="whitespace-normal!">
                  {v.title ?? v.id}
                  {v.sku && <span className="text-muted"> · {v.sku}</span>}
                </td>
                <td className="text-right">{v.price == null ? dash() : cents(v.price, currency)}</td>
                <td className={cx('text-right', tone)} title={title}>
                  {text}
                </td>
                <td className="text-right">{val(v.units, (n) => n.toLocaleString('en-US'))}</td>
                <td className="text-right">{val(v.netSales, (n) => money(n, currency))}</td>
                <td className="text-right">{val(v.refunds, (n) => money(n, currency))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {d.variants.note && <p className="mt-1.5 text-[11px] text-muted">{d.variants.note}.</p>}
    </div>
  );
}

/**
 * SA-91 (decision 22): the channel products rolled into this one and how each link was made, the owner's to unlink; a
 * product listed only on another channel can be linked to a store product found by search.
 */
function Links({ s, d, own, platform, channel }: { s: AnalyticsPage & { store: string }; d: SaProductDetail; own?: string; platform?: string; channel: (id: string) => string }) {
  const m = useSaLink(s.store);
  const [q, setQ] = useState('');
  const solo = lone(d.row.channels, own);
  const found = useSaListings(solo && q.trim() ? s.store : undefined, { ...periodParams(s), q: q.trim(), status: 'all' }).data;
  const hits = found?.rows.filter((r) => r.id !== d.row.id && !lone(r.channels, own)).slice(0, 5);
  if (!d.links.length && !solo) return null;
  return (
    <div className="mt-3.5 flex flex-col gap-1.5 text-[12px]">
      {d.links.map((k) => (
        <div key={k.channelProductId} className="flex items-center gap-1.5">
          <ChannelMark channel={k.channel} platform={platform} />
          <span>{k.title ?? k.channelProductId}</span>
          <span className="text-muted">
            · {channel(k.channel)} product {k.channelProductId},{' '}
            {k.method === 'owner' ? `linked by you on ${fmtDay(k.createdAt.slice(0, 10))}` : `linked by ${channel(k.channel)}'s own product id`}
          </span>
          {k.method === 'owner' && (
            <Button size="sm" variant="ghost" className="ml-auto" disabled={m.isPending} onClick={() => m.mutate({ channelProductId: k.channelProductId })}>
              Unlink
            </Button>
          )}
        </div>
      ))}
      {solo && (
        <>
          <p className="text-muted">Listed on {channel(solo)} only. If it's the same item as a store product, link it: its listings and sales then count there.</p>
          <input
            type="search"
            aria-label="Find the store product"
            placeholder="Find the store product by title, ID or SKU"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-8 rounded-lg border border-line-2 bg-bg-2 px-2.5 text-[12px] outline-none placeholder:text-muted focus:border-red/60"
          />
          {hits?.map((r) => (
            <div key={r.id} className="flex items-center gap-2">
              <span>{r.title}</span>
              <span className="text-muted">{r.id}</span>
              <Button size="sm" variant="ghost" className="ml-auto" disabled={m.isPending} onClick={() => m.mutate({ channelProductId: d.row.id, productId: r.id })}>
                Link
              </Button>
            </div>
          ))}
          {hits && !hits.length && <p className="text-muted">No store product matches.</p>}
        </>
      )}
      {m.error && <p className="text-red">{m.error.message}</p>}
    </div>
  );
}

/** SA-90: each channel's listing status, its error, publish and sync times, and its period sales. */
function Channels({ d, currency, platform, channel, children }: { d: SaProductDetail; currency?: string; platform?: string; channel: (id: string) => string; children?: ReactNode }) {
  return (
    <div>
      <table aria-label="Channel listings" className={GRID}>
        <thead>
          <tr>
            <th className={cx(TH, 'text-left')}>Channel</th>
            <th className={cx(TH, 'text-left')}>Status</th>
            <th className={cx(TH, 'text-left')}>Last synced</th>
            <th className={cx(TH, 'text-right')}>Units</th>
            <th className={cx(TH, 'text-right')}>Net sales</th>
            <th className={cx(TH, 'text-right')}>Refunds</th>
          </tr>
        </thead>
        <tbody>
          {d.channels.map((c) => (
            <tr key={c.channel}>
              <td>
                <span className="inline-flex items-center gap-1.5">
                  <ChannelMark channel={c.channel} platform={platform} />
                  {channel(c.channel)}
                </span>
              </td>
              <td className="whitespace-normal!">
                <span className={cx(c.status === 'failed' && 'text-red', !c.status && 'text-muted')}>{status(c)}</span>
                {/* the platform's own publish date only; a first sync isn't one */}
                {c.status && c.publishedAt && <span className="text-muted"> · since {fmtDay(c.publishedAt)}</span>}
                {c.error && <span className="block text-[11px] text-red">{c.error}</span>}
              </td>
              <td className="text-muted">{c.syncedAt ? ago(c.syncedAt) : dash()}</td>
              <td className="text-right">{val(c.units, (n) => n.toLocaleString('en-US'))}</td>
              <td className="text-right">{val(c.netSales, (n) => money(n, currency))}</td>
              <td className="text-right">{val(c.refunds, (n) => money(n, currency))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {d.channelsNote && <p className="mt-1.5 text-[11px] text-muted">{d.channelsNote}.</p>}
      {children}
    </div>
  );
}

/** SA-92: the unit cost now and as recorded, and the owner's edit: orders with a cost keep it (decision 15). */
function Costs({ s, d, currency }: { s: AnalyticsPage & { store: string }; d: SaProductDetail; currency?: string }) {
  const save = useSetCost();
  const qc = useQueryClient();
  const [cost, setCost] = useState('');
  const uc = d.costs.unitCost;
  return (
    <div className="flex flex-col gap-3 text-[12px]">
      <p className="text-text-2">
        Unit cost{' '}
        {uc ? (
          <>
            <b className="text-text">{cents(uc.value, currency)}</b>{' '}
            <span className="text-muted">
              ({costSource(uc.source)}
              {uc.since && `, since ${fmtDay(uc.since)}`})
            </span>
          </>
        ) : (
          <span className="text-muted">not recorded</span>
        )}
      </p>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ storeId: s.store, id: d.row.id, cost: Number(cost) }, { onSuccess: () => (setCost(''), qc.invalidateQueries({ queryKey: ['sa', s.store] })) });
        }}
      >
        <input
          type="number"
          min="0"
          step="0.01"
          aria-label="New unit cost"
          placeholder="New unit cost"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          className="h-8 w-36 rounded-lg border border-line-2 bg-bg-2 px-2.5 tabular-nums outline-none placeholder:text-muted focus:border-red/60"
        />
        <Button size="sm" type="submit" disabled={!cost || save.isPending}>
          Save cost
        </Button>
      </form>
      {save.error && <p className="text-red">{save.error.message}</p>}
      <p className="text-[11px] text-muted">Orders that have a cost keep it, so past periods' contribution doesn't move; orders without one take this cost.</p>
      {d.costs.history.length > 0 && (
        <table aria-label="Unit cost history" className={GRID}>
          <thead>
            <tr>
              <th className={cx(TH, 'text-left')}>Since</th>
              <th className={cx(TH, 'text-right')}>Cost</th>
              <th className={cx(TH, 'text-left')}>Source</th>
              <th className={cx(TH, 'text-left')}>Variant</th>
            </tr>
          </thead>
          <tbody>
            {d.costs.history.map((h, i) => (
              <tr key={i}>
                <td>{fmtDay(h.since)}</td>
                <td className="text-right">{cents(h.value, h.currency ?? currency)}</td>
                <td>{costSource(h.source)}</td>
                <td className={cx(!h.variant && 'text-muted')}>{h.variant ?? 'All variants'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** SA-92: the refund lines its Refunds number adds up, newest first. */
function Refunds({ d, currency }: { d: SaProductDetail; currency?: string }) {
  const { rows, note } = d.refundLines;
  if (note || !rows.length) return <p className="text-[12px] text-muted">{note ? `${note}.` : 'No refunds in this period.'}</p>;
  return (
    <table aria-label="Refund lines" className={GRID}>
      <thead>
        <tr>
          <th className={cx(TH, 'text-left')}>Day</th>
          <th className={cx(TH, 'text-left')}>Order</th>
          <th className={cx(TH, 'text-left')}>Variant</th>
          <th className={cx(TH, 'text-right')}>Units</th>
          <th className={cx(TH, 'text-right')}>Amount</th>
          <th className={cx(TH, 'text-left')}>Restocked</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td>{fmtDay(r.date)}</td>
            <td>{r.orderId}</td>
            <td>{r.variant ?? dash()}</td>
            <td className="text-right">{r.quantity ?? dash()}</td>
            <td className="text-right">{cents(r.amount, currency)}</td>
            <td>{r.restocked == null ? dash() : r.restocked ? 'Yes' : 'No'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ProductDrawer({ s, id }: { s: AnalyticsPage & { store: string }; id: string }) {
  const ctx = useSaContext(s.store).data;
  const q = useSaProduct(s.store, id, periodParams(s));
  // what opened it (a row, a flag): focus goes back there once the drawer is gone
  const opener = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => () => opener.current?.focus(), []);
  const [tab, setTab] = useState<'performance' | 'variants' | 'channels' | 'costs' | 'refunds'>('performance');
  const d = q.data;
  const r = d?.row;
  const label = (c: string) => (c === 'site' ? 'site' : ((ctx && channelsOf(ctx).find((x) => x.id === c)?.label) ?? PLATFORM_NAME[c as Platform] ?? c));
  const channel = (c: string) => (c === 'site' ? ((ctx && channelsOf(ctx)[0]?.label) ?? 'Site') : label(c));
  const tabs = d && [
    { value: 'performance' as const, label: 'Performance' },
    { value: 'variants' as const, label: 'Variants', count: d.variants.rows.length },
    { value: 'channels' as const, label: 'Channels', count: d.channels.length },
    { value: 'costs' as const, label: 'Costs' },
    { value: 'refunds' as const, label: 'Refunds' },
  ];
  const pill = (text: string, tone: keyof typeof TONE, title?: string) => (
    <span key={text} title={title} className={cx('inline-flex items-center rounded-full border px-2 py-px text-[11px] font-semibold whitespace-nowrap', TONE[tone])}>
      {text}
    </span>
  );
  return (
    <Dialog
      open
      side="right"
      width={560}
      onClose={() => s.set({ product: undefined })}
      title={r?.title ?? 'Product'}
      subtitle={r && [r.sku, r.category, ctx && `${PLATFORM_NAME[ctx.platform as Platform] ?? ctx.platform} product ${r.id}`].filter(Boolean).join(' · ')}
      lead={r && (r.image ? <img src={r.image} alt="" className="size-14 shrink-0 rounded-[10px] object-cover" /> : <span aria-hidden className="size-14 shrink-0 rounded-[10px] border border-[#2e2e35] bg-[linear-gradient(140deg,#2b2b31,#1b1b20)]" />)}
      meta={
        r && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {d.channels.map((c) => c.status && pill(`${cap(c.status)} on ${label(c.channel)}`, c.status === 'active' ? 'good' : c.status === 'failed' ? 'red' : 'muted', c.error ?? undefined))}
            {pill(...stockPill(r))}
            {r.syncedAt && pill(`Synced ${ago(r.syncedAt)}`, 'muted')}
          </div>
        )
      }
    >
      {q.isError ? (
        <ErrorState message="Couldn't load this product." onRetry={() => q.refetch()} />
      ) : !d ? (
        <LoadingState rows={6} />
      ) : (
        <div className="flex flex-col gap-3.5">
          <Tabs variant="underline" label="Product sections" tabs={tabs!} value={tab} onChange={setTab} className="-mx-5 -mt-5 px-5" />
          <div role="tabpanel" aria-label={tabs!.find((t) => t.value === tab)!.label}>
            {tab === 'performance' && <Performance d={d} currency={ctx?.currency} platform={ctx?.platform} channel={channel} />}
            {tab === 'variants' && <Variants d={d} currency={ctx?.currency} />}
            {tab === 'channels' && (
              <Channels d={d} currency={ctx?.currency} platform={ctx?.platform} channel={channel}>
                <Links s={s} d={d} own={ctx && channelsOf(ctx)[0]?.id} platform={ctx?.platform} channel={channel} />
              </Channels>
            )}
            {tab === 'costs' && <Costs s={s} d={d} currency={ctx?.currency} />}
            {tab === 'refunds' && <Refunds d={d} currency={ctx?.currency} />}
          </div>
          <FilterScope scope={d.scope} />
        </div>
      )}
    </Dialog>
  );
}
