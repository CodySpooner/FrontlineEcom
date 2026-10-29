// Product Research (PR-10, design concept A): scope, search, ship-to and sort; the store's research profile; filter
// chips; view tabs with server counts; the source strip; and the product grid. Every number comes from `/api/pr/*`.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router';
import { Plus, Search, TriangleAlert } from 'lucide-react';
import { PR_COMPARE_MAX, PR_SORTS, PR_VIEWS, type PrSort, type PrSourceState, type PrView } from '@frontline/shared';
import { useStores } from '../api/client';
import { useStored } from '../agents/layout';
import { Hero } from '../components/Hero';
import { useStoreSelection } from '../components/StoreFilter';
import { Button, cx, EmptyState, ErrorState, LoadingState, Tabs } from '../components/ui';
import { NAV } from '../nav';
import { useDiscovery, useProfile, useSaveProfile, useSources } from '../product-research/api';
import { ProductCard } from '../product-research/Card';
import { CompareBar } from '../product-research/Compare';
import { Watches } from '../product-research/Watches';
import { activeFilters, discoveryQuery, FilterChips, type Filters } from '../product-research/Filters';
import { countryName, profileLine, sourceItem } from '../product-research/format';
import { DetailPanel, PANEL_TABS, type PanelTab } from '../product-research/Panel';
import { ProfileDialog } from '../product-research/ProfileDialog';
import { ResearchDialog } from '../product-research/ResearchDialog';
import { useRowWindow } from '../product-research/rowWindow';
import { SourceHealth } from '../product-research/SourceHealth';

const VIEW_LABEL: Record<PrView, string> = { all: 'All matches', demand: 'With demand evidence', new: 'Newly discovered', watchlist: 'Watchlist', flagged: 'Flagged' };
const DOT = { good: 'bg-good', warn: 'bg-amber', bad: 'bg-red', muted: 'bg-muted' };
const CHIP = 'inline-flex items-center gap-1.5 rounded-full border border-line-2 bg-bg-2 px-2.5 py-1.5 text-xs whitespace-nowrap text-text-2';
const SELECT = 'cursor-pointer border-0 bg-transparent px-1 text-[13px] text-text [field-sizing:content] focus:outline-none';
const SEG = (on: boolean) => cx('cursor-pointer rounded-md px-2.5 py-1 text-xs font-semibold [field-sizing:content]', on ? 'bg-line text-text' : 'bg-transparent text-muted hover:text-text');
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);

export function Research() {
  const nav = NAV.find((n) => n.path === '/research')!;
  const [params, setParams] = useSearchParams();
  const { isPending: storesLoading } = useStores();
  const { ids, stores, name } = useStoreSelection();
  const [last, setLast] = useStored('fe.research.page', { store: '', view: 'all', sort: '' });
  const [filters, setFilters] = useStored<Filters>('fe.research.filters', {});
  const [allShipTo, setAllShipTo] = useStored('fe.research.shipTo', 'US');
  const [trays, setTrays] = useStored<Record<string, string[]>>('fe.research.compare', {}); // the comparison tray, per store
  const set = (k: string, v: string | null) =>
    setParams(
      (p) => {
        if (v) p.set(k, v);
        else p.delete(k);
        return p;
      },
      { replace: true },
    );

  // Scope: the URL's store, else the last one used here, else the store picked in the app's store filter.
  const scopeId = params.get('store') || last.store || ids[0] || stores[0]?.id || 'all';
  const store = stores.find((s) => s.id === scopeId) ?? null;
  const pickScope = (id: string, keepProduct = false) => (set('store', id), keepProduct || set('product', null), setLast({ ...last, store: id }));
  const viewParam = params.get('view') || last.view;
  const view: PrView = PR_VIEWS.includes(viewParam as PrView) ? (viewParam as PrView) : 'all';
  const sortParam = params.get('sort') || last.sort;
  const sort: PrSort = PR_SORTS.includes(sortParam as PrSort) && (store || sortParam !== 'best_fit') ? (sortParam as PrSort) : store ? 'best_fit' : 'recent';
  const q = params.get('q') ?? '';
  const [text, setText] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => text.trim() !== q && set('q', text.trim() || null), 250);
    return () => clearTimeout(t);
  });
  const product = params.get('product');
  const [lastTab, setLastTab] = useStored<PanelTab>('fe.research.tab', 'overview');
  const tabParam = params.get('tab') as PanelTab | null;
  const tab: PanelTab = tabParam && PANEL_TABS.includes(tabParam) ? tabParam : PANEL_TABS.includes(lastTab) ? lastTab : 'overview';

  const profile = useProfile(store?.id ?? null);
  const saveShipTo = useSaveProfile(store?.id ?? '');
  const sources = useSources(store?.id ?? null);
  const discovery = useDiscovery(discoveryQuery({ store: store?.id ?? null, shipTo: allShipTo, view, sort, q, filters }));
  const first = discovery.data?.pages[0];
  const items = discovery.data?.pages.flatMap((p) => p.items) ?? [];
  const currency = first?.currency ?? store?.currency ?? 'USD';
  const shipTo = store ? (profile.data?.shipTo ?? null) : allShipTo;
  const tray = store ? (trays[store.id] ?? []) : [];
  const setTray = (ids: string[]) => store && setTrays({ ...trays, [store.id]: ids });
  const [editProfile, setEditProfile] = useState(false);
  const [health, setHealth] = useState(false);
  const [researching, setResearching] = useState<{ product?: { id: string; title: string }; template?: string } | null>(null);

  // `/` focuses search; Esc closes the open product and returns focus to its card (a dialog handles its own Esc).
  const search = useRef<HTMLInputElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === '/' && !typing(e.target)) return void (e.preventDefault(), search.current?.focus());
      if (e.key === 'Escape' && product && !document.querySelector('dialog[open]')) closePanel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  // Closing the panel returns focus to its card.
  const closePanel = () => {
    if (product) grid.current?.querySelector<HTMLElement>(`[data-card="${CSS.escape(product)}"]`)?.focus();
    set('product', null);
  };
  // Arrow keys move through the grid by its own column count; Enter opens the product.
  const onCardKey = (i: number) => (e: KeyboardEvent<HTMLElement>) => {
    const cols = getComputedStyle(grid.current!).gridTemplateColumns.split(' ').filter(Boolean).length || 1;
    const to = ({ ArrowRight: i + 1, ArrowLeft: i - 1, ArrowDown: i + cols, ArrowUp: i - cols } as Record<string, number>)[e.key];
    const next = to === undefined ? undefined : items[to]?.id;
    if (e.key === 'Enter') set('product', items[i]!.id);
    else if (next) grid.current?.querySelector<HTMLElement>(`[data-card="${CSS.escape(next)}"]`)?.focus();
    else return;
    e.preventDefault();
  };
  const win = useRowWindow(grid, items.length);
  // The next 48 cards load when "Show more" scrolls near the viewport (or on its click).
  const more = useRef<HTMLButtonElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = discovery;
  useEffect(() => {
    const b = more.current;
    if (!b || typeof IntersectionObserver === 'undefined') return;
    const o = new IntersectionObserver(([e]) => e?.isIntersecting && !isFetchingNextPage && void fetchNextPage(), { rootMargin: '600px' });
    o.observe(b);
    return () => o.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const shipTos = [...new Set([...(first?.shipTos ?? []), ...(shipTo ? [shipTo] : [])])];
  const problems = (sources.data ?? []).filter((s) => !s.fixtures && (s.errorKind || s.status === 'stopped'));
  const set_ = activeFilters(filters, store?.id ?? null);
  const clear = () => (setFilters({}), setText(''), set('q', null));

  if (storesLoading) return <LoadingState rows={6} />;
  return (
    <>
      <Hero title={nav.title} subtitle={nav.subtitle} icon={nav.icon} />
      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <div role="group" aria-label="Scope" className="inline-flex rounded-[9px] border border-line-2 bg-bg-2 p-[3px]">
          <button type="button" aria-pressed={!store} onClick={() => pickScope('all')} className={SEG(!store)}>
            All stores
          </button>
          {stores.length === 1 ? (
            <button type="button" aria-pressed={!!store} onClick={() => pickScope(stores[0]!.id)} className={SEG(!!store)}>
              {stores[0]!.name}
            </button>
          ) : (
            stores.length > 1 && (
              <select aria-label="Store" value={store?.id ?? ''} onChange={(e) => pickScope(e.target.value)} className={SEG(!!store)}>
                {!store && (
                  <option value="" disabled>
                    A store…
                  </option>
                )}
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )
          )}
        </div>
        <label className="relative max-w-[360px] min-w-56 flex-[1_1_224px]">
          <span className="sr-only">Search products</span>
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input
            ref={search}
            type="search"
            value={text}
            maxLength={200}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search products, categories or supplier SKUs"
            className="min-h-9 w-full rounded-lg border border-line-2 bg-bg-2 py-2 pr-3 pl-9 text-[13px] placeholder:text-muted focus:border-red/60 focus:outline-none"
          />
        </label>
        <label className={CHIP}>
          Ship to
          <select
            aria-label="Ship to"
            value={shipTo ?? ''}
            disabled={!!store && (!profile.data || saveShipTo.isPending)}
            onChange={(e) => (store ? saveShipTo.mutate({ shipTo: e.target.value, version: profile.data?.version ?? 0 }) : setAllShipTo(e.target.value))}
            className={SELECT}
          >
            {!shipTo && <option value="">Not set: pick it in the profile</option>}
            {shipTos.map((c) => (
              <option key={c} value={c}>
                {countryName(c)}
              </option>
            ))}
          </select>
        </label>
        <label className={CHIP}>
          Sort
          <select aria-label="Sort" value={sort} onChange={(e) => (set('sort', e.target.value), setLast({ ...last, sort: e.target.value }))} className={SELECT}>
            {store && <option value="best_fit">{`Best fit for ${store.name}`}</option>}
            <option value="recent">Recently discovered</option>
            <option value="momentum">Strongest observed momentum</option>
            <option value="cost">Lowest verified cost + shipping (excl. duties)</option>
          </select>
        </label>
        {stores.length > 0 && (
          <Button variant="primary" className="ml-auto h-9 py-0!" onClick={() => setResearching({})}>
            <Plus aria-hidden className="size-4" />
            Research a Product
          </Button>
        )}
      </div>

      {store && profile.data && (
        <p className="mt-3 text-[12.5px] text-text-2">
          Ranked for <b className="text-text">{store.name}</b>
          {profileLine(store, profile.data).map((part) => ` · ${part}`)} ·{' '}
          <button type="button" onClick={() => setEditProfile(true)} className="cursor-pointer text-red hover:underline">
            Edit research profile
          </button>
        </p>
      )}
      {store && profile.isError && (
        <p role="alert" className="mt-3 text-[12.5px] text-text-2">
          {`The research profile didn't load (${profile.error.message}): ranking and Ship to wait for it. `}
          <button type="button" onClick={() => void profile.refetch()} className="cursor-pointer text-red hover:underline">
            Try again
          </button>
        </p>
      )}
      {store && profile.data && editProfile && <ProfileDialog open onClose={() => setEditProfile(false)} store={store.id} storeName={store.name} profile={profile.data} />}

      <FilterChips d={first} filters={filters} set={setFilters} store={store?.id ?? null} currency={currency} />

      <div className="mt-3.5">
        <Tabs
          label="Product views"
          variant="underline"
          tabs={PR_VIEWS.map((v) => ({ value: v, label: VIEW_LABEL[v], count: first?.counts[v] }))}
          value={view}
          onChange={(v) => (set('view', v === 'all' ? null : v), setLast({ ...last, view: v }))}
        />
      </div>

      {sources.data && (
        <div aria-label="Sources" className="mt-2.5 flex flex-wrap gap-x-[18px] gap-y-2 text-xs text-text-2">
          {sources.data.map((s) => {
            const it = sourceItem(s);
            return (
              <span key={s.id} className="inline-flex items-center gap-1.5" title={s.access === 'verified' ? undefined : s.connect}>
                <i aria-hidden className={cx('size-[7px] shrink-0 rounded-full', DOT[it.tone])} />
                {it.text}
              </span>
            );
          })}
          <button type="button" onClick={() => setHealth(true)} className="cursor-pointer text-red hover:underline">
            Source health
          </button>
        </div>
      )}
      <SourceHealth open={health} onClose={() => setHealth(false)} store={store?.id ?? null} />
      {problems.map((s) => (
        <p key={s.id} role="status" className="mt-2.5 flex items-start gap-2 rounded-lg border border-red/30 bg-red/8 px-3 py-2 text-[12.5px] text-text-2">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-red" />
          {s.errorKind === 'auth'
            ? `${s.name} is disconnected: ${s.lastError ?? 'its credentials were refused'}. Reconnect it in Integrations.`
            : `${s.name} isn't answering (${s.lastError ?? s.status}). ${s.lastSuccessAt ? `Its products are from its last successful sync, ${new Date(s.lastSuccessAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}` : 'It has never synced'}; other sources are unaffected.`}
        </p>
      ))}

      {store && <CompareBar store={store} ids={tray} setIds={setTray} shipTo={shipTo} />}
      {view === 'watchlist' && <Watches store={store} categories={first?.facets.categories ?? []} onOpen={(id) => set('product', id)} />}

      <div className="mt-4 flex items-start gap-4">
        <section aria-label="Products" className="min-w-0 flex-[999_1_520px]">
        {discovery.isPending ? (
          <LoadingState rows={6} />
        ) : discovery.isError ? (
          <ErrorState message={discovery.error.message} onRetry={() => void discovery.refetch()} />
        ) : !items.length ? (
          set_.length || q ? (
            <EmptyState title="No products match these filters" action={<Button onClick={clear}>Clear filters</Button>}>
              {`Set: ${[...(q ? [`search "${q}"`] : []), ...set_].join(', ')}.`}
            </EmptyState>
          ) : view !== 'all' ? (
            <EmptyState title={`Nothing in ${VIEW_LABEL[view]} yet`} action={<Button onClick={() => set('view', null)}>Show all matches</Button>}>
              {view === 'demand'
                ? 'Products show here once they have a qualifying demand set (an imported Trends CSV with enough history, or your own orders).'
                : view === 'watchlist'
                  ? "Products you watch show here: use Watch in a product's panel."
                  : 'Products show here as they qualify.'}
            </EmptyState>
          ) : (
            <FirstUse sources={sources.data ?? []} onResearch={stores.length ? () => setResearching({}) : undefined} />
          )
        ) : (
          <>
            <div ref={grid} className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3.5">
              {win.above > 0 && <div aria-hidden className="col-span-full" style={{ height: win.above * win.pitch - win.gap }} />}
              {items.slice(win.from, win.to).map((c, k) => (
                <ProductCard
                  key={c.id}
                  c={c}
                  store={store?.name ?? null}
                  scope={store?.id ?? null}
                  currency={currency}
                  shipTo={first?.shipTo ?? shipTo}
                  storeName={name}
                  selected={c.id === product}
                  onOpen={() => set('product', c.id)}
                  onKeyDown={onCardKey(win.from + k)}
                />
              ))}
              {win.below > 0 && <div aria-hidden className="col-span-full" style={{ height: win.below * win.pitch - win.gap }} />}
            </div>
            {hasNextPage && (
              <div className="mt-4 flex justify-center">
                <Button ref={more} onClick={() => void fetchNextPage()} disabled={isFetchingNextPage}>
                  {isFetchingNextPage ? 'Loading…' : 'Show more'}
                </Button>
              </div>
            )}
          </>
        )}
        </section>
        {product && (
          <DetailPanel
            key={product}
            id={product}
            store={store}
            stores={stores}
            shipTo={allShipTo}
            tab={tab}
            setTab={(t) => (set('tab', t === 'overview' ? null : t), setLastTab(t))}
            onClose={closePanel}
            onAssigned={(id) => pickScope(id, true)}
            onResearch={(p, template) => setResearching({ product: p, ...(template ? { template } : {}) })}
            compare={{ on: tray.includes(product), full: tray.length >= PR_COMPARE_MAX, toggle: () => setTray(tray.includes(product) ? tray.filter((x) => x !== product) : [...tray, product]) }}
          />
        )}
      </div>
      {researching && (
        <ResearchDialog
          stores={stores}
          store={store?.id ?? null}
          {...(researching.product ? { product: researching.product } : {})}
          {...(researching.template ? { template: researching.template } : {})}
          onClose={() => setResearching(null)}
          // The task's store and product: its card footer and panel show where it is.
          onStarted={(t) => (setResearching(null), pickScope(t.storeId, true), set('product', t.productId), set('tab', 'research'))}
        />
      )}
    </>
  );
}

/** First use: nothing to show and nothing connected that would bring products. What each source needs, from the server. */
function FirstUse({ sources, onResearch }: { sources: PrSourceState[]; onResearch?: () => void }) {
  const connected = sources.filter((s) => s.access === 'verified');
  return (
    <EmptyState title={connected.length ? 'No products yet' : 'No product sources connected yet'}>
      <span className="block max-w-[640px] text-left">
        {connected.length ? `${connected.map((s) => s.name).join(', ')} ${connected.length === 1 ? 'is' : 'are'} connected but no products have arrived yet. ` : 'Products appear here once a source brings them in. '}
        To add one:
      </span>
      <ul className="mt-2 grid max-w-[640px] gap-1.5 text-left text-[12.5px]">
        {sources
          // The sources that bring supplier products in: not demand-only, and not manual notes (a note needs a product).
          .filter((s) => s.access !== 'verified' && s.access !== 'manual_only' && s.answers.some((q) => q !== 'demand'))
          .map((s) => (
            <li key={s.id}>
              <b className="text-text">{s.name}:</b> {s.connect}
            </li>
          ))}
      </ul>
      {onResearch && (
        <p className="mt-3 max-w-[640px] text-left text-[12.5px]">
          <b className="text-text">Research a Product works now:</b> paste any product link and an agent researches it for one of your stores.{' '}
          <button type="button" onClick={onResearch} className="cursor-pointer text-red hover:underline">
            Research a Product
          </button>
        </p>
      )}
    </EmptyState>
  );
}
