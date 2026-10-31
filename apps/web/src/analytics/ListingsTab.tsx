// SA-82: the Listings tab (spec §7 Listings table; the Listings board): every listing of the store, 25 a page, filtered
// and sorted over the whole matching set by the API (SA-66, SA-80). Status, search and the tab's own filters live in
// the URL beside the page's; Channel and Collection are the page's filters. A row opens the product drawer through
// `onOpen` (SA-88): without it rows aren't interactive (decision 33). A product with variants expands to them (SA-83);
// Columns adds optional ones (SA-84).
import { Fragment, useDeferredValue, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Columns3, Info, Plus, Search, TriangleAlert } from 'lucide-react';
import { SA_LISTING_FILTERS, SA_LISTING_STATUSES, SA_REASONS, type SaListingRow, type SaListingStatus, type SaValue } from '@frontline/shared';
import { hidePopover, Popover, rove } from '../agents/Popover';
import { Button, buttonClass, cx, ErrorState, LoadingState, Segmented } from '../components/ui';
import { ago, cents, money, pct } from '../lib/format';
import { useSaCollections, useSaContext, useSaListings, useSaVariants } from './api';
import { FilterScope } from './FilterScope';
import { channelsOf, Option, useFilters } from './Filters';
import { range } from './Pickers';
import { periodParams, type AnalyticsPage } from './state';

const STATUS: Record<SaListingStatus, [label: string, note: string]> = {
  active: ['Active', 'that are active now'],
  draft: ['Draft', 'that are drafts now'],
  archived: ['Archived', 'that are archived now'],
  all: ['All', 'in every status'],
};
const STOCK: Record<(typeof SA_LISTING_FILTERS.stock)[number], string> = {
  in_stock: 'In stock',
  low: 'Low cover',
  out: 'Out of stock',
  variants_out: 'Some variants out',
  not_tracked: 'Not tracked',
  fba: 'Amazon FBA',
  supplier: 'Supplier-managed',
};
const SALES: Record<string, string> = { with: 'With sales', none: 'No sales' };
const MORE = [
  ['cost', 'missing', 'Missing unit cost'],
  ['sync', 'failed', 'Failed sync'],
] as const;
/** The board's two-letter channel marks; a site channel takes its platform's. */
const SHORT: Record<string, string> = { shopify: 'SH', woocommerce: 'WC', tiktok_shop: 'TK', amazon: 'AZ', etsy: 'ET', walmart: 'WM' };
const TINT: Record<string, string> = { shopify: 'border-good/35 text-[#b9f0c9]', tiktok_shop: 'border-[#9db4d6]/45 text-[#cbd9ef]' };
const plural = (n: number, unit: string) => `${n.toLocaleString('en-US')} ${unit}${n === 1 ? '' : 's'}`;

const TH = 'border-b border-line bg-[#111114] px-2.5 py-[7px] text-[11px] font-semibold whitespace-nowrap text-muted';
const R = 'text-right';

/** A filter chip opening its menu; `more` is the board's "+ More". */
function Menu({ id, label, value, on, more, children }: { id: string; label: string; value?: string; on: boolean; more?: boolean; children: ReactNode }) {
  return (
    <>
      <button
        type="button"
        popoverTarget={id}
        className={cx('inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-[9px] py-1 text-xs whitespace-nowrap', on ? 'border-red/50 bg-red-soft text-white' : 'border-line-2 bg-bg-2 text-text-2 hover:border-muted/60')}
      >
        {more && <Plus aria-hidden className="size-3 text-muted" />}
        {label}
        {value && <b className="font-semibold text-text">{value}</b>}
        {!more && <ChevronDown aria-hidden className="size-3 text-muted" />}
      </button>
      <Popover id={id} label={label} className="w-[230px]">
        {children}
      </Popover>
    </>
  );
}

const dash = (v?: SaValue) => (
  <span className="text-muted" title={v?.note ?? (v?.reason && SA_REASONS[v.reason])}>
    –
  </span>
);
const val = (v: SaValue, f: (n: number) => string) => (v.value == null ? dash(v) : <span title={v.note}>{f(v.value)}</span>);

/** Stock now: a count only where one is kept; FBA and supplier stock are never judged (decision 27). */
function stock(r: Pick<SaListingRow, 'stock' | 'stockState' | 'coverDays'> & Partial<Pick<SaListingRow, 'variants' | 'variantsOut'>>): [text: string, tone?: string, title?: string] {
  const n = (r.stock ?? 0).toLocaleString('en-US');
  switch (r.stockState) {
    case 'out':
      return [`${n} · out`, 'text-red'];
    case 'low': {
      const d = r.coverDays ?? 0;
      return [`${n} · ~${d < 1 ? '<1' : Math.round(d)} d`, 'text-amber', `About ${d} days of stock at the last 14 full days' sales`];
    }
    case 'not_tracked':
      return ['Not tracked', 'text-muted'];
    case 'fba':
      return [r.stock == null ? 'FBA' : `${n} · FBA`, 'text-muted', 'Amazon manages this stock (FBA): no cover estimate'];
    case 'supplier':
      return ['Supplier-managed', 'text-muted', 'A supplier filled its recent orders: no count or cover'];
    default:
      return (r.variants ?? 1) > 1 && r.variantsOut ? [`${n} · ${r.variantsOut} out`, 'text-amber'] : [n];
  }
}

/**
 * SA-84: the optional columns, shown and ordered through Columns (`cols=` in the URL), before Synced. Product
 * conversion joins them once a product-views source exists (SA-04).
 */
const COLUMNS: { id: string; label: string; right?: boolean; cell: (r: SaListingRow, currency?: string) => ReactNode }[] = [
  { id: 'sku', label: 'SKU', cell: (r) => r.sku ?? dash() },
  { id: 'collection', label: 'Collection', cell: (r) => (r.collections.length ? <span className="block max-w-[180px] truncate" title={r.collections.join(', ')}>{r.collections.join(', ')}</span> : dash()) },
  { id: 'compare_at', label: 'Compare-at price', right: true, cell: (r, c) => (r.compareAt == null ? dash() : cents(r.compareAt, c)) },
  { id: 'cost_coverage', label: 'Cost coverage', right: true, cell: (r) => val(r.costCoverage, (n) => pct(n * 100)) },
];

const INDENT = { paddingLeft: 62 }; // the board's; an inline style, as the table's cell padding beats a class

/** SA-83: a product's variants under its row (no checkbox, no channels or status of their own) and why sales are missing. */
function VariantRows({ s, id, currency, extra }: { s: AnalyticsPage & { store: string }; id: string; currency?: string; extra: number }) {
  const q = useSaVariants(s.store, id, { ...periodParams(s), compare: 'none' });
  const line = (body: ReactNode) => (
    <tr className="bg-bg-2 text-xs text-muted">
      <td colSpan={10 + extra} style={INDENT}>
        {body}
      </td>
    </tr>
  );
  if (q.isError)
    return line(
      <>
        Couldn't load the variants.{' '}
        <button type="button" onClick={() => q.refetch()} className="cursor-pointer font-semibold text-text-2 hover:text-white">
          Try again
        </button>
      </>,
    );
  if (!q.data) return line('Loading variants…');
  return (
    <>
      {q.data.rows.map((v) => {
        const [text, tone, title] = stock(v);
        return (
          <tr key={v.id} className="bg-bg-2 text-xs text-text-2">
            <td style={INDENT}>
              {v.title ?? v.id}
              {v.sku && <span className="text-muted"> · {v.sku}</span>}
            </td>
            <td />
            <td />
            <td className={R}>{v.price == null ? dash() : cents(v.price, currency)}</td>
            <td className={cx(R, tone)} title={title}>
              {text}
            </td>
            <td className={R}>{val(v.units, (n) => n.toLocaleString('en-US'))}</td>
            <td className={R}>{val(v.netSales, (n) => money(n, currency))}</td>
            <td className={R}>{val(v.refunds, (n) => money(n, currency))}</td>
            <td className={R}>{val(v.contribution, (n) => money(n, currency))}</td>
            {Array.from({ length: extra }, (_, k) => (
              <td key={k} />
            ))}
            <td />
          </tr>
        );
      })}
      {q.data.note && line(q.data.note)}
    </>
  );
}

export function ListingsTab({ s, onOpen }: { s: AnalyticsPage & { store: string }; onOpen?: (id: string) => void }) {
  const [params, setParams] = useSearchParams();
  const ctx = useSaContext(s.store).data;
  const collections = useSaCollections(s.store);
  const { toggle, has } = useFilters(s);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const flip = (id: string) => setExpanded((x) => (x.has(id) ? new Set([...x].filter((y) => y !== id)) : new Set([...x, id])));
  const get = (k: string) => params.get(k) ?? '';
  /** One of the tab's own keys (empty leaves the URL), back to page 1; typing in search replaces the history entry. */
  const put = (k: string, v: string) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (v) n.set(k, v);
        else n.delete(k);
        if (k !== 'cols') n.delete('page');
        return n;
      },
      { replace: k === 'q' },
    );
  const cols = [...new Set(get('cols').split(','))].flatMap((id) => COLUMNS.filter((c) => c.id === id));
  const setCols = (ids: string[]) => put('cols', ids.join(','));
  const move = (i: number, by: -1 | 1) => {
    const ids = cols.map((c) => c.id);
    [ids[i], ids[i + by]] = [ids[i + by]!, ids[i]!];
    setCols(ids);
  };
  const status = (SA_LISTING_STATUSES as readonly string[]).includes(get('status')) ? (get('status') as SaListingStatus) : 'active';
  const term = useDeferredValue(get('q').trim());
  // no comparison: the table has no change column
  const q = useSaListings(s.store, { ...periodParams(s), compare: 'none', status, q: term, sort: s.sort, page: String(s.page), stock: get('stock'), sales: get('sales'), cost: get('cost'), sync: get('sync') });
  const d = q.data;
  const cur = ctx?.currency;
  const channels = ctx ? channelsOf(ctx) : [];
  const name = (id: string) => channels.find((c) => c.id === id)?.label ?? id;
  const more = MORE.filter(([k]) => get(k)).length;
  const many = (picked: string[] | undefined, label: (v: string) => string) => (!picked?.length ? undefined : picked.length === 1 ? label(picked[0]!) : String(picked.length));

  const [key, dir = key === 'title' ? 'asc' : 'desc'] = (s.sort ?? 'units').split(':');
  const sortable = (k: string, label: string, right?: boolean) => {
    const on = key === k;
    const next = `${k}:${on ? (dir === 'asc' ? 'desc' : 'asc') : k === 'title' ? 'asc' : 'desc'}`;
    return (
      <th aria-sort={on ? (dir === 'asc' ? 'ascending' : 'descending') : undefined} className={cx(TH, right ? R : 'text-left', on && 'text-text')}>
        <button type="button" onClick={() => s.set({ sort: next === 'units:desc' ? undefined : next, page: 1 })} className="cursor-pointer hover:text-white">
          {label}
          {on && (dir === 'asc' ? ' ↑' : ' ↓')}
        </button>
      </th>
    );
  };

  let body: ReactNode;
  if (q.isError) body = <ErrorState message="Couldn't load the listings." onRetry={() => q.refetch()} />;
  else if (!d) body = <LoadingState rows={8} />;
  else if (!d.rows.length) body = <p className="card p-6 text-center text-[13px] text-muted">No {status === 'all' ? '' : `${STATUS[status][0].toLowerCase()} `}listings match.</p>;
  else {
    const first = (d.page - 1) * d.pageSize + 1;
    const last = Math.min(d.page * d.pageSize, d.total);
    body = (
      <>
        <div className="card overflow-x-auto p-0">
          <table aria-label="Listings" className="w-full border-collapse text-[12.5px] tabular-nums [&_td]:border-b [&_td]:border-[#1c1c21] [&_td]:px-2.5 [&_td]:py-[7px] [&_td]:whitespace-nowrap">
            <thead>
              <tr>
                {sortable('title', 'Product')}
                <th className={cx(TH, 'text-left')}>Channels</th>
                <th className={cx(TH, 'text-left')}>Status</th>
                {sortable('price', 'Price', true)}
                {sortable('stock', 'Stock', true)}
                {sortable('units', 'Units', true)}
                {sortable('net_sales', 'Net sales', true)}
                {sortable('refunds', 'Refunds', true)}
                <th className={cx(TH, R)}>Contribution</th>
                {cols.map((c) => (
                  <th key={c.id} className={cx(TH, c.right ? R : 'text-left')}>
                    {c.label}
                  </th>
                ))}
                <th className={cx(TH, 'text-left')}>Synced</th>
              </tr>
            </thead>
            <tbody onKeyDown={onOpen && ((e) => rove(e, 'tr[tabindex]'))}>
              {d.rows.map((r, i) => {
                const none = r.units.value === 0 && r.netSales.value === 0;
                const [text, tone, title] = stock(r);
                const failed = r.channels.filter((c) => c.status === 'failed');
                const sub = [r.sku, plural(r.variants, 'variant'), r.variants > 1 && r.variantsOut > 0 && `${r.variantsOut} out of stock`].filter(Boolean).join(' · ');
                const open = expanded.has(r.id);
                return (
                  <Fragment key={r.id}>
                    <tr
                      tabIndex={onOpen && (i ? -1 : 0)}
                      onClick={onOpen && (() => onOpen(r.id))}
                      onKeyDown={onOpen && ((e) => e.target === e.currentTarget && e.key === 'Enter' && onOpen(r.id))}
                      className={cx(onOpen && 'cursor-pointer outline-none hover:bg-white/2 focus-visible:bg-red-soft')}
                    >
                      <td className="max-w-[340px]">
                        <span className="flex min-w-0 items-center gap-2.5">
                          {r.variants > 1 && (
                            <button
                              type="button"
                              aria-expanded={open}
                              aria-label={`${open ? 'Hide' : 'Show'} the variants of ${r.title}`}
                              onClick={(e) => (e.stopPropagation(), flip(r.id))}
                              className="-mr-1 grid size-5 shrink-0 cursor-pointer place-items-center rounded text-muted hover:text-white"
                            >
                              {open ? <ChevronDown aria-hidden className="size-3.5" /> : <ChevronRight aria-hidden className="size-3.5" />}
                            </button>
                          )}
                          {r.image ? <img src={r.image} alt="" loading="lazy" className="size-[30px] shrink-0 rounded-[7px] object-cover" /> : <span aria-hidden className="size-[30px] shrink-0 rounded-[7px] border border-[#2e2e35] bg-[linear-gradient(140deg,#2b2b31,#1b1b20)]" />}
                          <span className="min-w-0">
                            <b className="block truncate font-medium">{r.title}</b>
                            <span className="block truncate text-[11px] text-muted">{sub}</span>
                          </span>
                        </span>
                      </td>
                      <td>
                        <span className="flex gap-1">
                          {r.channels.map((c, k) => {
                            const kind = c.channel === 'site' ? (ctx?.platform ?? '') : c.channel;
                            return (
                              <span key={k} title={`${name(c.channel)} · ${c.status}`} className={cx('inline-flex h-4 w-5 items-center justify-center rounded border bg-[#22222a] text-[9.5px] font-bold', TINT[kind] ?? 'border-line-2 text-text-2')}>
                                {SHORT[kind] ?? c.channel.slice(0, 2).toUpperCase()}
                              </span>
                            );
                          })}
                        </span>
                      </td>
                      <td>
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <i aria-hidden className={cx('size-1.5 rounded-full', r.status === 'active' ? 'bg-good' : 'bg-muted')} />
                          {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                        </span>
                      </td>
                      <td className={R}>{cents(r.price, cur)}</td>
                      <td className={cx(R, tone)} title={title}>
                        {text}
                      </td>
                      <td className={cx(R, none && 'text-muted')}>{val(r.units, (n) => n.toLocaleString('en-US'))}</td>
                      <td className={R}>{none ? <span className="text-muted">No sales</span> : val(r.netSales, (n) => money(n, cur))}</td>
                      <td className={R}>
                        {none ? dash() : val(r.refunds, (n) => money(n, cur))}
                        {!none && r.refundRate.value != null && <span className="ml-1.5 text-muted">{pct(r.refundRate.value * 100)}</span>}
                      </td>
                      <td className={R}>
                        {none ? (
                          dash()
                        ) : r.contribution.value == null && r.contribution.reason === 'not_tracked' ? (
                          <span title={r.contribution.note} className="rounded-full border border-amber/45 px-2 py-px text-[11px] font-semibold text-amber">
                            No unit cost
                          </span>
                        ) : (
                          val(r.contribution, (n) => money(n, cur))
                        )}
                      </td>
                      {cols.map((c) => (
                        <td key={c.id} className={cx(c.right && R)}>
                          {c.cell(r, cur)}
                        </td>
                      ))}
                      <td>
                        {failed.length ? (
                          <span className="inline-flex items-center gap-1 text-red" title={failed.map((c) => `${name(c.channel)}: ${c.error ?? 'failed'}`).join('\n')}>
                            <TriangleAlert aria-hidden className="size-3" />
                            Failed
                          </span>
                        ) : r.syncedAt ? (
                          <span className="text-muted">{ago(r.syncedAt).replace(' ago', '')}</span>
                        ) : (
                          dash()
                        )}
                      </td>
                    </tr>
                    {open && <VariantRows s={s} id={r.id} currency={cur} extra={cols.length} />}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 py-2 text-xs text-muted">
          <span>
            {first}–{last} of {plural(d.total, `${status === 'all' ? '' : `${status} `}listing`)} · {plural(d.variants, 'variant')} · {plural(d.channelListings, 'channel listing')}
          </span>
          <span className="ml-auto flex gap-1.5">
            <Button size="sm" disabled={d.page <= 1} onClick={() => s.set({ page: d.page - 1 })}>
              Previous
            </Button>
            <Button size="sm" disabled={last >= d.total} onClick={() => s.set({ page: d.page + 1 })}>
              Next
            </Button>
          </span>
        </div>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          quiet
          label="Listing status"
          options={SA_LISTING_STATUSES.map((v) => ({
            value: v,
            label: (
              <>
                {STATUS[v][0]} <span className="font-medium text-muted">{d?.counts[v].toLocaleString('en-US')}</span>
              </>
            ),
          }))}
          value={status}
          onChange={(v) => put('status', v === 'active' ? '' : v)}
        />
        <label className="flex w-60 max-w-full items-center gap-2 rounded-[9px] border border-line-2 bg-bg-2 px-2.5 py-1.5 text-muted focus-within:border-red/60">
          <Search aria-hidden className="size-3.5 shrink-0" />
          <input aria-label="Search listings" placeholder="Search title, SKU, product ID" value={get('q')} onChange={(e) => put('q', e.target.value)} className="min-w-0 flex-1 bg-transparent text-[12.5px] text-text outline-none placeholder:text-muted" />
        </label>
        <Menu id="sa-listings-channel" label="Channel" value={many(s.filters.channel, name) ?? 'All'} on={!!s.filters.channel?.length}>
          {channels.map((c) => (
            <Option key={c.id} on={has('channel', c.id)} onClick={() => toggle('channel', c.id)}>
              {c.label}
            </Option>
          ))}
        </Menu>
        <Menu id="sa-listings-stock" label="Stock" value={STOCK[get('stock') as keyof typeof STOCK] ?? 'Any'} on={!!get('stock')}>
          {(['', ...SA_LISTING_FILTERS.stock] as const).map((v) => (
            <Option key={v} radio on={get('stock') === v} onClick={() => (put('stock', v), hidePopover('sa-listings-stock'))}>
              {v ? STOCK[v] : 'Any'}
            </Option>
          ))}
        </Menu>
        <Menu id="sa-listings-sales" label="Sales" value={SALES[get('sales')] ?? 'Any'} on={!!SALES[get('sales')]}>
          {['', 'with', 'none'].map((v) => (
            <Option key={v} radio on={get('sales') === v} onClick={() => (put('sales', v), hidePopover('sa-listings-sales'))}>
              {SALES[v] ?? 'Any'}
            </Option>
          ))}
        </Menu>
        <Menu id="sa-listings-collection" label="Collection" value={many(s.filters.collection, (v) => collections.data?.find((c) => c.id === v)?.title ?? v) ?? 'Any'} on={!!s.filters.collection?.length}>
          {collections.data?.length === 0 ? (
            <p className="px-2.5 py-1.5 text-[11.5px] text-muted">No collections synced for this store.</p>
          ) : (
            collections.data?.map((c) => (
              <Option key={c.id} on={has('collection', c.id)} onClick={() => toggle('collection', c.id)}>
                {c.title ?? c.id}
              </Option>
            ))
          )}
        </Menu>
        <Menu id="sa-listings-more" label="More" value={more ? String(more) : undefined} on={more > 0} more>
          {MORE.map(([k, v, label]) => (
            <Option key={k} on={get(k) === v} onClick={() => put(k, get(k) === v ? '' : v)}>
              {label}
            </Option>
          ))}
        </Menu>
        <button type="button" popoverTarget="sa-listings-columns" className={cx(buttonClass('ghost', 'sm'), 'ml-auto')}>
          <Columns3 aria-hidden className="size-3.5" />
          Columns
        </button>
        <Popover id="sa-listings-columns" label="Columns" align="end" className="w-[240px]">
          {[...cols, ...COLUMNS.filter((c) => !cols.includes(c))].map((c) => {
            const i = cols.indexOf(c);
            const arrow = 'grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-muted outline-none hover:bg-panel-2 hover:text-white focus-visible:bg-panel-2 focus-visible:text-white disabled:cursor-default disabled:opacity-30';
            return (
              <div key={c.id} className="flex items-center">
                <div className="min-w-0 flex-1">
                  <Option on={i >= 0} onClick={() => setCols(i >= 0 ? cols.filter((x) => x !== c).map((x) => x.id) : [...cols.map((x) => x.id), c.id])}>
                    {c.label}
                  </Option>
                </div>
                {i >= 0 && (
                  <>
                    <button type="button" role="menuitem" data-item aria-label={`Move ${c.label} up`} disabled={i === 0} onClick={() => move(i, -1)} className={arrow}>
                      <ArrowUp aria-hidden className="size-3" />
                    </button>
                    <button type="button" role="menuitem" data-item aria-label={`Move ${c.label} down`} disabled={i === cols.length - 1} onClick={() => move(i, 1)} className={arrow}>
                      <ArrowDown aria-hidden className="size-3" />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </Popover>
      </div>
      {d && (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <Info aria-hidden className="size-3 shrink-0" />
          Listings {STATUS[status][1]}, with their sales from {range(d.period.from, d.period.to)}. Status and stock are current; sales, refunds and contribution are for the period.
        </p>
      )}
      {body}
      <FilterScope scope={d?.scope} />
    </div>
  );
}
