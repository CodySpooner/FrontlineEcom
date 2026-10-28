// UI-09 Product Research: browse scored products by tab, save them to lists, send winners to a store (as an approval).
import { useDeferredValue, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Baby, Bookmark, Cpu, Dumbbell, Lamp, Package, PawPrint, Search, Shirt, Sparkles, Tent, TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react';
import { NICHES, PRODUCT_WRITE_PLATFORMS, type Niche, type ProductList, type ResearchProduct, type ResearchSource, type ResearchTab } from '@frontline/shared';
import { useAddToStore, useListActions, useLists, useResearch, useStartRun, useSupplierSearch } from '../api/client';
import { FixLink } from '../components/Chat';
import { Hero } from '../components/Hero';
import { useStoreSelection } from '../components/StoreFilter';
import { byHand } from '../components/StoreForm';
import { Badge, Button, ConfirmDelete, cx, Dialog, EmptyState, ErrorState, LoadingState, Panel, ProgressBar, Tabs } from '../components/ui';
import { cents } from '../lib/format';
import { customNiches } from '../lib/niche';
import { NAV } from '../nav';

type Tab = ResearchTab | 'lists';
const TABS: { value: Tab; label: string }[] = [
  { value: 'trending', label: 'Trending' },
  { value: 'high_margin', label: 'High Margin' },
  { value: 'low_competition', label: 'Low Competition' },
  { value: 'tiktok_viral', label: 'TikTok Viral' },
  { value: 'shopify_winners', label: 'Shopify Winners' },
  { value: 'lists', label: 'My Lists' },
];

// ponytail: demo data has no images, so each product shows its niche's icon; real connectors fill `image`.
const NICHE_ICON: Record<Niche, LucideIcon> = { beauty: Sparkles, pet: PawPrint, tech: Cpu, fitness: Dumbbell, home: Lamp, fashion: Shirt, kids: Baby, outdoor: Tent, other: Package };
const SOURCE: Record<ResearchSource, string> = { tiktok: 'TikTok', shopify: 'Shopify', amazon: 'Amazon', aliexpress: 'AliExpress' };
const SAVED = 'Saved';
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function Research() {
  const nav = NAV[3]!;
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.value === params.get('tab'))?.value ?? 'trending';
  const [niche, setNiche] = useState('');
  const [q, setQ] = useState('');
  const query = useDeferredValue(q.trim());
  const [open, setOpen] = useState<ResearchProduct>();
  const saved = useSaved();

  const { ids, stores } = useStoreSelection();
  // Research isn't per store, so the page has no store filter: with several stores, say whose Product Hunter runs.
  const [storeId, setStoreId] = useState('');
  const store = stores.find((s) => s.id === storeId) ?? stores.find((s) => s.id === ids[0]) ?? stores[0];
  // A custom-niche store narrows to its own finds (`other:<slug>` → its own words); "Other" still lists every custom niche's.
  const custom = customNiches(stores);
  const start = useStartRun();
  const navigate = useNavigate();
  const research = () =>
    store &&
    start.mutate(
      { agentId: `${store.id}:product_hunter`, task: `Find 5 new winning ${niche ? `${custom.get(niche) ?? niche} ` : ''}products for this store, with margin, trend and competition for each.` },
      { onSuccess: (r) => navigate(`/agents/${encodeURIComponent(r.agentId)}?run=${r.id}`) },
    );

  return (
    <>
      <Hero title={nav.title} subtitle={nav.subtitle} icon={nav.icon} />
      <Tabs label="Research" tabs={TABS} value={tab} onChange={(t) => setParams(t === 'trending' ? {} : { tab: t }, { replace: true })} />
      {tab !== 'lists' && (
        <div className="my-4 flex flex-wrap items-center gap-2">
          <label className="relative min-w-56 flex-1 min-[900px]:max-w-80">
            <span className="sr-only">Search products</span>
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search products or categories"
              className="w-full rounded-lg border border-line-2 bg-bg-2 py-2 pr-3 pl-9 text-[13px] placeholder:text-muted focus:border-red/60 focus:outline-none"
            />
          </label>
          <label>
            <span className="sr-only">Niche</span>
            <select value={niche} onChange={(e) => setNiche(e.target.value)} className="cursor-pointer rounded-lg border border-line-2 bg-bg-2 px-3 py-2 text-[13px] focus:border-red/60 focus:outline-none">
              <option value="">All niches</option>
              {NICHES.map((n) => (
                <option key={n} value={n}>
                  {cap(n)}
                </option>
              ))}
              {[...custom].map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {stores.length > 1 && (
            <label className="ml-auto">
              <span className="sr-only">Store for AI Research</span>
              <select value={store?.id ?? ''} onChange={(e) => setStoreId(e.target.value)} className="cursor-pointer rounded-lg border border-line-2 bg-bg-2 px-3 py-2 text-[13px] focus:border-red/60 focus:outline-none">
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Button variant="primary" className={cx(stores.length < 2 && 'ml-auto')} disabled={!store || start.isPending} onClick={research} title={store && `Ask ${store.name}'s Product Researcher to find new winners`}>
            <Sparkles className="size-4" />
            AI Research
          </Button>
          {start.isError && (
            <p role="alert" className="w-full text-right text-xs text-red">
              {start.error.message} <FixLink message={start.error.message} agentId={start.variables?.agentId ?? ''} />
            </p>
          )}
        </div>
      )}
      {tab === 'lists' ? (
        <Lists onOpen={setOpen} saved={saved} />
      ) : (
        <Results tab={tab} niche={niche} q={query} onOpen={setOpen} saved={saved} onClear={() => (setQ(''), setNiche(''))} />
      )}
      <ProductDialog product={open} onClose={() => setOpen(undefined)} />
    </>
  );
}

/** The bookmark on a card = membership in the "Saved" list (created on first save). */
function useSaved() {
  const lists = useLists().data ?? [];
  const { create, toggle } = useListActions();
  const list = lists.find((l) => l.name === SAVED);
  return {
    has: (id: string) => !!list?.productIds.includes(id),
    toggle: async (id: string) => {
      const l = list ?? (await create.mutateAsync(SAVED));
      toggle.mutate({ listId: l.id, productId: id, on: !l.productIds.includes(id) });
    },
  };
}
type Saved = ReturnType<typeof useSaved>;

function Results({ tab, niche, q, onOpen, saved, onClear }: { tab: ResearchTab; niche: string; q: string; onOpen: (p: ResearchProduct) => void; saved: Saved; onClear: () => void }) {
  const { stores } = useStoreSelection();
  // Every store live: the sample catalog is only noise next to the Product Hunter's finds (with a demo store left, it stays, labelled).
  const r = useResearch(tab, niche, q, stores.length > 0 && stores.every((s) => s.connected));
  if (r.isPending) return <LoadingState rows={4} />;
  if (r.isError) return <ErrorState message="Couldn't load research." onRetry={() => r.refetch()} />;
  if (!r.data.items.length && tab === 'trending' && !niche && !q) {
    return (
      <EmptyState icon={Search} title="No finds yet">
        Ask the Product Researcher with AI Research: what it finds for your stores lands here.
      </EmptyState>
    );
  }
  if (!r.data.items.length) {
    return (
      <EmptyState icon={Search} title="No products match" action={<Button onClick={onClear}>Clear filters</Button>}>
        Try another niche or a broader search.
      </EmptyState>
    );
  }
  return (
    <>
      {/* The grid's heading: product cards are h3s, as they are under each list's title in My Lists. */}
      <h2 className="mb-3 text-xs font-normal text-muted">{`${r.data.total} product${r.data.total === 1 ? '' : 's'}, best first`}</h2>
      <Grid className={cx(r.isPlaceholderData && 'opacity-60')}>
        {r.data.items.map((p) => (
          <ProductCard key={p.id} p={p} onOpen={() => onOpen(p)} saved={saved} />
        ))}
      </Grid>
    </>
  );
}

/** A row from the sample catalog every install starts with (made-up trend and competition), not an agent's find.
 *  Said only once a real store is connected: in demo mode it's all sample. */
const useSample = (p: ResearchProduct) => useStoreSelection().stores.some((s) => s.connected) && !!p.sample;

const Grid = ({ className, children }: { className?: string; children: ReactNode }) => (
  <div className={cx('grid grid-cols-1 gap-3.5 transition-opacity min-[560px]:grid-cols-2 min-[1000px]:grid-cols-3 min-[1280px]:grid-cols-4', className)}>{children}</div>
);

function ProductCard({ p, onOpen, saved }: { p: ResearchProduct; onOpen: () => void; saved: Saved }) {
  const Icon = NICHE_ICON[p.niche];
  const on = saved.has(p.id);
  const sample = useSample(p);
  return (
    <article className="card flex flex-col overflow-hidden">
      <div className="relative grid h-[150px] place-items-center border-b border-line bg-[radial-gradient(circle_at_50%_45%,rgb(255_42_58/.16),transparent_70%)]">
        {p.image ? <img src={p.image} alt="" loading="lazy" className="size-full object-cover" /> : <Icon aria-hidden className="size-14 text-text-2/60" strokeWidth={1.2} />}
        <span className="absolute top-2.5 left-2.5 rounded-md bg-red-fill px-2 py-0.5 text-[11px] font-bold text-white shadow-glow">AI Score {p.score}</span>
        <button
          type="button"
          aria-pressed={on}
          aria-label={on ? `Remove ${p.title} from ${SAVED}` : `Save ${p.title}`}
          onClick={() => saved.toggle(p.id)}
          className={cx('absolute top-2 right-2 grid size-8 cursor-pointer place-items-center rounded-lg bg-bg/70 transition hover:text-white', on ? 'text-red' : 'text-text-2')}
        >
          <Bookmark className="size-4" fill={on ? 'currentColor' : 'none'} />
        </button>
      </div>
      <div className="flex flex-1 flex-col p-3.5">
        <h3 className="text-[14px] leading-snug font-semibold">{p.title}</h3>
        <p className="mt-0.5 text-xs text-muted">
          {p.category} · {SOURCE[p.source]}
          {sample && ' · Sample data'}
        </p>
        <div className="mt-2.5 flex flex-wrap items-baseline gap-x-2">
          <b className="font-display text-lg tabular-nums">{cents(p.price)}</b>
          {p.compareAt > p.price && <s className="text-xs text-muted tabular-nums">{cents(p.compareAt)}</s>}
          {/* An arrow, not a bare "+248%" beside a struck-through price, where it reads as a markup. */}
          <span className={cx('ml-auto inline-flex items-center gap-0.5 text-xs font-semibold whitespace-nowrap tabular-nums', p.trend > 0 ? 'text-good' : 'text-muted')} title="Demand growth, last 30 days">
            {p.trend < 0 ? <TrendingDown className="size-3.5" aria-hidden="true" /> : <TrendingUp className="size-3.5" aria-hidden="true" />}
            {demand(p.trend)}
            <span className="sr-only"> demand</span>
          </span>
        </div>
        <p className="mt-0.5 text-xs text-muted">
          {Math.round(p.margin)}% margin · ships in {p.shippingDays}d
        </p>
        <Button size="sm" className="mt-3" onClick={onOpen}>
          View Details
        </Button>
      </div>
    </article>
  );
}

function Lists({ onOpen, saved }: { onOpen: (p: ResearchProduct) => void; saved: Saved }) {
  const lists = useLists();
  const all = useResearch(undefined, '', '');
  const { remove } = useListActions();
  if (lists.isPending || all.isPending) return <LoadingState rows={3} className="mt-4" />;
  if (lists.isError || all.isError) return <ErrorState message="Couldn't load your lists." onRetry={() => (lists.refetch(), all.refetch())} />;
  if (!lists.data.length) {
    return (
      <EmptyState icon={Bookmark} title="No lists yet">
        Bookmark a product to save it, or make a list from a product's details.
      </EmptyState>
    );
  }
  const byId = new Map(all.data.items.map((p) => [p.id, p]));
  return (
    <div className="mt-4 grid gap-4">
      {lists.data.map((l) => {
        const items = l.productIds.map((id) => byId.get(id)).filter((p) => !!p);
        return (
          <Panel
            key={l.id}
            title={l.name}
            sub={`${items.length} product${items.length === 1 ? '' : 's'}`}
            action={
              <ConfirmDelete question="Delete this list?" confirm="Delete list" busy={remove.isPending} onConfirm={() => remove.mutate(l.id)}>
                {(open, ref) => (
                  <Button ref={ref} size="sm" disabled={remove.isPending} onClick={open} aria-label={`Delete list ${l.name}`}>
                    Delete list
                  </Button>
                )}
              </ConfirmDelete>
            }
          >
            {items.length ? (
              <Grid>
                {items.map((p) => (
                  <ProductCard key={p.id} p={p} onOpen={() => onOpen(p)} saved={saved} />
                ))}
              </Grid>
            ) : (
              <p className="text-[13px] text-muted">Empty. Add products from their details.</p>
            )}
          </Panel>
        );
      })}
    </div>
  );
}

const PARTS: { key: keyof ResearchProduct['scoreParts']; label: string; weight: number }[] = [
  { key: 'margin', label: 'Margin', weight: 35 },
  { key: 'trend', label: 'Trend', weight: 25 },
  { key: 'competition', label: 'Low competition', weight: 25 },
  { key: 'shipping', label: 'Fast shipping', weight: 15 },
];

function ProductDialog({ product: p, onClose }: { product?: ResearchProduct; onClose: () => void }) {
  return (
    <Dialog open={!!p} onClose={onClose} title={p?.title ?? 'Product'}>
      {p && <ProductDetails key={p.id} p={p} />}
    </Dialog>
  );
}

export function ProductDetails({ p }: { p: ResearchProduct }) {
  const lists = useLists().data ?? [];
  const { create, toggle } = useListActions();
  const [name, setName] = useState('');
  const { ids, stores } = useStoreSelection();
  const [storeId, setStoreId] = useState(ids[0] ?? stores[0]?.id ?? '');
  const add = useAddToStore();
  // An approved request would do nothing on a store the app can't write to.
  const manual = byHand(stores.find((s) => s.id === storeId), PRODUCT_WRITE_PLATFORMS);
  const sample = useSample(p);

  const newList = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(name.trim(), {
      onSuccess: (l: ProductList) => {
        setName('');
        toggle.mutate({ listId: l.id, productId: p.id, on: true });
      },
    });
  };

  return (
    <div className="grid gap-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-muted">
          {p.category} · {SOURCE[p.source]} · {(p.nicheDetail && customNiches(stores).get(`other:${p.nicheDetail}`)) || cap(p.niche)}
        </p>
        <Badge tone="red">AI Score {p.score}</Badge>
      </div>
      {sample && (
        <p className="-mt-2 text-xs text-text-2">Sample data: made-up demand and competition from the demo catalog, not a find for your stores. AI Research brings real ones.</p>
      )}
      <dl className="grid grid-cols-3 gap-3 text-[13px]">
        <Fact label="Cost" value={cents(p.cost)} />
        <Fact label="Sell at" value={cents(p.price)} />
        {p.compareAt > p.price && <Fact label="Compare at" value={cents(p.compareAt)} />}
        <Fact label="Margin" value={`${Math.round(p.margin)}%`} />
        <Fact label="Demand, 30 days" value={demand(p.trend)} />
        <Fact label="Ships in" value={`${p.shippingDays} days`} />
      </dl>
      <section>
        <h3 className="mb-2 text-[13px] font-semibold">Why it scores {p.score}</h3>
        <div className="grid gap-2.5">
          {PARTS.map((part) => (
            <div key={part.key} className="grid grid-cols-[156px_minmax(0,1fr)_32px] items-center gap-3 text-xs">
              <span className="text-text-2">
                {part.label} <span className="text-muted">· {part.weight}%</span>
              </span>
              <ProgressBar value={p.scoreParts[part.key] / 100} label={part.label} />
              <span className="text-right text-text-2 tabular-nums">{p.scoreParts[part.key]}</span>
            </div>
          ))}
        </div>
      </section>
      <Suppliers p={p} />
      <section>
        <h3 className="mb-2 text-[13px] font-semibold">Lists</h3>
        <div className="flex flex-wrap gap-2">
          {lists.map((l) => (
            <label key={l.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-line-2 px-2.5 py-1.5 text-xs text-text-2">
              <input type="checkbox" className="accent-red" checked={l.productIds.includes(p.id)} onChange={(e) => toggle.mutate({ listId: l.id, productId: p.id, on: e.target.checked })} />
              {l.name}
            </label>
          ))}
        </div>
        <form onSubmit={newList} className="mt-2 flex gap-2">
          <label htmlFor="new-list" className="sr-only">
            New list name
          </label>
          <input
            id="new-list"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="New list, e.g. Q4 gifts"
            className="flex-1 rounded-lg border border-line-2 bg-bg-2 px-3 py-1.5 text-[13px] placeholder:text-muted focus:border-red/60 focus:outline-none"
          />
          <Button size="sm" type="submit" disabled={!name.trim() || create.isPending}>
            Create and add
          </Button>
        </form>
      </section>
      <section className="border-t border-line pt-4">
        <h3 className="mb-2 text-[13px] font-semibold">Add to a store</h3>
        {add.isSuccess ? (
          <p className="text-[13px] text-text-2">
            {/* Core hands back the request already pending for this product (the owner's or an agent's) instead of a second. */}
            {Date.parse(add.data.createdAt) < add.submittedAt - 5_000
              ? `${stores.find((s) => s.id === storeId)?.name} already has a request waiting for this product.`
              : `Sent to ${stores.find((s) => s.id === storeId)?.name}'s Product Researcher.`}{' '}
            <Link to="/" className="text-red hover:underline">
              Approve it on the Dashboard
            </Link>
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <label>
              <span className="sr-only">Store</span>
              <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className="cursor-pointer rounded-lg border border-line-2 bg-bg-2 px-3 py-2 text-[13px] focus:border-red/60 focus:outline-none">
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            {manual ? (
              <span className="text-xs text-text-2">The app can't add products to {manual} stores yet. Add it in {manual} by hand.</span>
            ) : (
              <>
                <Button variant="primary" disabled={!storeId || add.isPending} onClick={() => add.mutate({ productId: p.id, storeId })}>
                  Request to add
                </Button>
                <span className="text-xs text-muted">Nothing changes until you approve it.</span>
              </>
            )}
          </div>
        )}
        {add.isError && (
          <p role="alert" className="mt-2 text-xs text-red">
            {add.error.message}
          </p>
        )}
      </section>
    </div>
  );
}

/** CJ Dropshipping matches for the product, with the margin left at our sell price (before shipping). */
function Suppliers({ p }: { p: ResearchProduct }) {
  const [look, setLook] = useState(false);
  const q = useSupplierSearch(look ? p.title : '');
  return (
    <section>
      <h3 className="mb-2 text-[13px] font-semibold">Suppliers</h3>
      {!look ? (
        <Button size="sm" onClick={() => setLook(true)}>
          <Search className="size-3.5" />
          Find on CJ Dropshipping
        </Button>
      ) : q.isPending ? (
        <LoadingState rows={2} />
      ) : q.isError ? (
        <ErrorState message="Couldn't search CJ Dropshipping." onRetry={() => q.refetch()} />
      ) : !q.data.length ? (
        <p className="text-[13px] text-muted">No CJ Dropshipping match for this product.</p>
      ) : (
        <>
          <ul className="grid gap-2">
            {q.data.map((s) => (
              <li key={s.id} className="flex items-center gap-3 rounded-lg border border-line bg-bg-2 px-3 py-2">
                {s.image && <img src={s.image} alt="" className="size-10 shrink-0 rounded-md object-cover" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px]">{s.title}</p>
                  <p className="text-xs text-muted">
                    SKU {s.sku} · {s.listed.toLocaleString('en-US')} sellers list it
                  </p>
                </div>
                <div className="text-right tabular-nums">
                  <b className="text-[13px]">{cents(s.price)}</b>
                  <p className="text-xs text-muted">{Math.round((1 - s.price / p.price) * 100)}% margin before shipping</p>
                </div>
              </li>
            ))}
          </ul>
          {q.data.some((s) => s.demo) && (
            <p className="mt-1.5 text-xs text-muted">
              Demo matches.{' '}
              <Link to="/integrations" className="text-red hover:underline">
                Connect CJ Dropshipping
              </Link>{' '}
              for live prices.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** Demand growth, signed: an agent's find can be falling ("−12%"). */
const demand = (t: number) => (t < 0 ? '−' : '+') + Math.abs(Math.round(t)) + '%';

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-bg-2 px-3 py-2">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="mt-0.5 font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
