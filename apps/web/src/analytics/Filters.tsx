// SA-68: the page's filters (spec §4; decision 4): Channel, Product and Collection in one popover (Market and Segment
// arrive in SA-107), each applied value a removable chip. Every panel applies a filter or names it (FilterScope).
import { useDeferredValue, useState, type ReactNode } from 'react';
import { Check, ListFilter, X } from 'lucide-react';
import { SA_FILTERS, type SaContext, type SaFilterKey, type SaFilters, type Store } from '@frontline/shared';
import { Popover } from '../agents/Popover';
import { PLATFORM_NAME } from '../components/StoreForm';
import { cx, inputClass } from '../components/ui';
import { useSaCollections, useSaListings } from './api';
import { ctl } from './Pickers';
import type { useAnalyticsState } from './state';

type S = ReturnType<typeof useAnalyticsState>;
const SALES = new Set(['shopify', 'woocommerce', 'etsy', 'amazon', 'tiktok_shop']);
const SITES = new Set(['shopify', 'woocommerce']);

/** The store's sales channels as the channel filter names them: its own ("site" for a web store), then the others it sells on. */
export function channelsOf(ctx: Pick<SaContext, 'platform' | 'channels'>) {
  const own = PLATFORM_NAME[ctx.platform as Store['platform']] ?? ctx.platform;
  return [
    SITES.has(ctx.platform) ? { id: 'site', label: `${own} site` } : { id: ctx.platform, label: own },
    ...ctx.channels.filter((c) => SALES.has(c.kind) && c.kind !== ctx.platform).map((c) => ({ id: c.kind, label: c.name })),
  ];
}

const any = (f: SaFilters) => Object.values(f).some((v) => v?.length);

function useFilters(s: S) {
  const toggle = (k: SaFilterKey, v: string) => {
    const cur = s.filters[k] ?? [];
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
    s.set({ filters: { ...s.filters, [k]: next.length ? next : undefined }, page: 1 });
  };
  return { toggle, has: (k: SaFilterKey, v: string) => !!s.filters[k]?.includes(v) };
}

function Option({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      data-item
      role="menuitemcheckbox"
      aria-checked={on}
      onClick={onClick}
      className={cx('flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] outline-none hover:bg-panel-2 hover:text-white focus-visible:bg-panel-2 focus-visible:text-white', on ? 'text-white' : 'text-text-2')}
    >
      <span aria-hidden className={cx('grid size-3.5 shrink-0 place-items-center rounded-[4px] border', on ? 'border-red bg-red text-white' : 'border-line-2')}>
        {on && <Check className="size-2.5" strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

const Group = ({ title, children }: { title: string; children: ReactNode }) => (
  <div role="group" aria-label={title} className="border-b border-line px-1 py-1.5 last:border-0">
    <div className="px-1.5 pb-1 font-display text-[11px] font-semibold tracking-[.15em] text-muted uppercase">{title}</div>
    {children}
  </div>
);

export function FiltersButton({ s, ctx }: { s: S; ctx?: SaContext }) {
  const { toggle, has } = useFilters(s);
  const [q, setQ] = useState('');
  const term = useDeferredValue(q.trim());
  // ponytail: the product search is the listings API's first 8 by title; nothing is fetched until something is typed.
  const found = useSaListings(term ? s.store : undefined, { status: 'all', sort: 'title', q: term });
  const collections = useSaCollections(s.store);
  return (
    <>
      <button type="button" popoverTarget="sa-filters" className={cx(ctl, any(s.filters) && 'border-red/50')}>
        <ListFilter aria-hidden className="size-3.5 shrink-0 text-muted" />
        Filters
      </button>
      <Popover id="sa-filters" label="Filters" className="w-[300px] p-0">
        <Group title={SA_FILTERS.channel}>
          {(ctx ? channelsOf(ctx) : []).map((c) => (
            <Option key={c.id} on={has('channel', c.id)} onClick={() => toggle('channel', c.id)}>
              {c.label}
            </Option>
          ))}
        </Group>
        <Group title={SA_FILTERS.product}>
          <input aria-label="Search products" placeholder="Search title, SKU, product ID" value={q} onChange={(e) => setQ(e.target.value)} className={cx(inputClass, 'mb-1 w-full px-2.5 py-1.5 text-[12.5px]')} />
          {!term ? (
            <p className="px-1.5 py-1 text-[11.5px] text-muted">Type to find a product.</p>
          ) : found.data?.rows.length === 0 ? (
            <p className="px-1.5 py-1 text-[11.5px] text-muted">No product matches “{term}”.</p>
          ) : (
            found.data?.rows.slice(0, 8).map((p) => (
              <Option key={p.id} on={has('product', p.id)} onClick={() => toggle('product', p.id)}>
                {p.title}
              </Option>
            ))
          )}
        </Group>
        <Group title={SA_FILTERS.collection}>
          {collections.data?.length === 0 ? (
            <p className="px-1.5 py-1 text-[11.5px] text-muted">No collections synced for this store.</p>
          ) : (
            collections.data?.map((c) => (
              <Option key={c.id} on={has('collection', c.id)} onClick={() => toggle('collection', c.id)}>
                {c.title ?? c.id}
              </Option>
            ))
          )}
        </Group>
      </Popover>
    </>
  );
}

/** The applied filters as chips, each removable, and Clear all. Nothing while none apply. */
export function FilterChips({ s, ctx }: { s: S; ctx?: SaContext }) {
  const { toggle } = useFilters(s);
  const picked = s.filters.product ?? [];
  const products = useSaListings(picked.length ? s.store : undefined, { status: 'all', filters: JSON.stringify({ product: picked }) });
  const collections = useSaCollections(s.filters.collection?.length ? s.store : undefined);
  if (!any(s.filters)) return null;
  const name = (k: SaFilterKey, v: string) =>
    (k === 'channel' && ctx && channelsOf(ctx).find((c) => c.id === v)?.label) ||
    (k === 'product' && products.data?.rows.find((p) => p.id === v)?.title) ||
    (k === 'collection' && collections.data?.find((c) => c.id === v)?.title) ||
    v;
  const chips = (Object.keys(SA_FILTERS) as SaFilterKey[]).flatMap((k) => (s.filters[k] ?? []).map((v) => ({ k, v, label: `${SA_FILTERS[k]}: ${name(k, v)}` })));
  return (
    <div className="flex basis-full flex-wrap items-center gap-1.5" aria-label="Applied filters" role="group">
      {chips.map((c) => (
        <span key={`${c.k}:${c.v}`} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-red/50 bg-red/10 py-1 pr-1 pl-2.5 text-xs whitespace-nowrap text-white">
          <span className="truncate">{c.label}</span>
          <button type="button" aria-label={`Remove ${c.label}`} onClick={() => toggle(c.k, c.v)} className="cursor-pointer rounded p-0.5 text-muted hover:text-white">
            <X aria-hidden className="size-3" />
          </button>
        </span>
      ))}
      <button type="button" onClick={() => s.set({ filters: {}, page: 1 })} className="cursor-pointer px-1 text-xs font-semibold text-muted hover:text-white">
        Clear all
      </button>
    </div>
  );
}
