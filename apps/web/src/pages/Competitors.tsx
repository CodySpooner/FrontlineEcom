// UI-13 Competitor Intel: who each store watches, the ads they run, their price moves, and the Market Analyst's briefs.
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ArrowDownRight, ArrowUpRight, ExternalLink, Eye, Megaphone, Sparkles } from 'lucide-react';
import type { AdSnapshotData, Competitor, CompetitorSnapshot, PriceChange } from '@frontline/shared';
import { useCompetitorActions, useCompetitors, usePriceChanges, useRuns, useSnapshots, useStartRun } from '../api/client';
import { FixLink } from '../components/Chat';
import { Hero } from '../components/Hero';
import { StoreFilter, useStoreSelection } from '../components/StoreFilter';
import { Badge, Button, cx, EmptyState, ErrorState, inputClass, LoadingState, Panel, RUN_STATUS } from '../components/ui';
import { ago, cents, fmtDay } from '../lib/format';
import { NAV } from '../nav';

const NETWORK = { meta: 'Meta', tiktok: 'TikTok', google: 'Google' };
const DAY = 86_400_000;
const host = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

export function Competitors() {
  const nav = NAV.find((n) => n.path === '/competitors')!;
  const { has } = useStoreSelection();
  const q = useCompetitors();
  const list = (q.data ?? []).filter((c) => has(c.storeId));
  const [picked, setPicked] = useState<string>();
  const sel = list.find((c) => c.id === picked) ?? list[0];

  return (
    <>
      <Hero title={nav.title} subtitle={nav.subtitle} icon={nav.icon} art={nav.art} />
      <div className="mb-3.5">
        <StoreFilter />
      </div>
      <div className="grid items-start gap-3.5 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="grid gap-3.5">
          <Panel title="Tracked Competitors" sub={q.data && `${list.length} rival${list.length === 1 ? '' : 's'} watched`}>
            {q.isPending ? (
              <LoadingState rows={3} />
            ) : q.isError ? (
              <ErrorState message="Couldn't load competitors." onRetry={() => q.refetch()} />
            ) : (
              <>
                {!list.length ? (
                  <EmptyState icon={Eye} title="No competitors tracked">
                    Add a rival below and the squad starts watching their prices and ads.
                  </EmptyState>
                ) : (
                  <ul className="grid gap-2">
                    {list.map((c) => (
                      <CompetitorRow key={c.id} c={c} on={c.id === sel?.id} onPick={() => setPicked(c.id)} />
                    ))}
                  </ul>
                )}
                <AddCompetitor />
              </>
            )}
          </Panel>
          {sel && <Briefs c={sel} />}
        </div>
        <div className="grid gap-3.5">
          <Ads c={sel} />
          <PriceTimeline competitors={q.data ?? []} />
        </div>
      </div>
    </>
  );
}

function CompetitorRow({ c, on, onPick }: { c: Competitor; on: boolean; onPick: () => void }) {
  const { name } = useStoreSelection();
  const { remove } = useCompetitorActions();
  const [confirm, setConfirm] = useState(false);
  return (
    <li className={cx('rounded-lg border bg-bg-2 transition', on ? 'border-red/70' : 'border-line hover:border-line-3')}>
      <button type="button" aria-pressed={on} onClick={onPick} className="block w-full cursor-pointer px-3 pt-2.5 text-left">
        <span className="flex items-baseline justify-between gap-2">
          <b className="text-[14px]">{c.name}</b>
          <span className="text-xs text-muted">{name(c.storeId)}</span>
        </span>
        <span className="mt-0.5 block text-xs text-text-2 tabular-nums">
          {c.productsTracked} products tracked · {c.activeAds} active ad{c.activeAds === 1 ? '' : 's'}
        </span>
        {c.notes && <span className="mt-1 block text-xs text-muted">{c.notes}</span>}
      </button>
      <div className="flex items-center justify-between gap-2 px-3 pt-1 pb-2">
        <a href={c.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs text-muted hover:text-white">
          {host(c.url)}
          <ExternalLink aria-hidden className="size-3" />
        </a>
        {confirm ? (
          <span className="flex items-center gap-1.5">
            <Button size="sm" onClick={() => setConfirm(false)}>
              Keep
            </Button>
            <Button size="sm" variant="primary" disabled={remove.isPending} onClick={() => remove.mutate(c.id)}>
              Stop tracking
            </Button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirm(true)} className="cursor-pointer text-xs text-muted hover:text-red">
            Stop tracking
          </button>
        )}
      </div>
    </li>
  );
}

function AddCompetitor() {
  const { ids, stores } = useStoreSelection();
  const { add } = useCompetitorActions();
  const [storeId, setStoreId] = useState('');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const store = storeId || ids[0] || stores[0]?.id || '';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate({ storeId: store, name: name.trim(), url: url.trim() }, { onSuccess: () => (setName(''), setUrl('')) });
  };
  return (
    <form onSubmit={submit} className="mt-4 grid gap-2 border-t border-line pt-4">
      <h3 className="text-[13px] font-semibold">Track a competitor</h3>
      <div className="grid gap-2 min-[620px]:grid-cols-2">
        <label className="grid gap-1 text-xs text-muted">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} placeholder="e.g. Wag & Wander" className={cx(inputClass, 'text-text')} />
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Website
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} required placeholder="https://…" className={cx(inputClass, 'text-text')} />
        </label>
      </div>
      <p className="text-xs text-muted">Prices are checked daily for Shopify and WooCommerce stores, and for Etsy shops (etsy.com/shop/…) once you connect an Etsy store.</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid flex-1 gap-1 text-xs text-muted">
          For store
          <select value={store} onChange={(e) => setStoreId(e.target.value)} className={cx(inputClass, 'cursor-pointer text-text')}>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" disabled={!name.trim() || !url.trim() || add.isPending}>
          Start tracking
        </Button>
      </div>
      {add.isError && (
        <p role="alert" className="text-xs text-red">
          {add.error.message}
        </p>
      )}
    </form>
  );
}

const daysRunning = (a: AdSnapshotData) => Math.round((Date.parse(a.lastSeen) - Date.parse(a.firstSeen)) / DAY) + 1;

function Ads({ c }: { c?: Competitor }) {
  const q = useSnapshots(c?.id ?? '', 'ad');
  // Snapshots repeat an ad each time it's seen; keep the latest sighting per headline.
  const ads = [...new Map((q.data ?? []).map((s) => [s.kind === 'ad' ? s.data.headline : s.id, s] as const)).values()].filter(
    (s): s is Extract<CompetitorSnapshot, { kind: 'ad' }> => s.kind === 'ad',
  );
  return (
    <Panel title={c ? `${c.name}'s Ads` : 'Competitor Ads'} sub="What they're running. Ads that run for weeks are usually their winners.">
      {!c ? (
        <p className="text-[13px] text-muted">Pick a competitor to see their ads.</p>
      ) : q.isPending ? (
        <LoadingState rows={3} />
      ) : q.isError ? (
        <ErrorState message="Couldn't load their ads." onRetry={() => q.refetch()} />
      ) : !ads.length ? (
        <EmptyState icon={Megaphone} title="No ads seen yet">
          Ads show up here once the squad spots {c.name} advertising.
        </EmptyState>
      ) : (
        <ul className="grid gap-3 min-[700px]:grid-cols-2">
          {ads.map(({ id, data: a }) => {
            const days = daysRunning(a);
            return (
              <li key={id} className="flex flex-col rounded-lg border border-line bg-bg-2 p-3.5">
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  <Badge>{NETWORK[a.network]}</Badge>
                  <Badge>{a.format}</Badge>
                  {days >= 14 && <Badge tone="red">Running {days} days</Badge>}
                </div>
                <h3 className="text-[14px] leading-snug font-semibold">{a.headline}</h3>
                <p className="mt-1 line-clamp-3 text-[13px] text-text-2">{a.body}</p>
                <div className="mt-auto flex items-center justify-between gap-2 pt-3 text-xs text-muted">
                  <span>
                    {fmtDay(a.firstSeen)} – {fmtDay(a.lastSeen)}
                    {days < 14 && ` · ${days} day${days === 1 ? '' : 's'}`}
                  </span>
                  {a.cta &&
                    (a.landingUrl ? (
                      <a href={a.landingUrl} target="_blank" rel="noreferrer noopener" className="rounded-md border border-line-2 px-2 py-0.5 text-text-2 hover:text-white">
                        {a.cta}
                      </a>
                    ) : (
                      <span className="rounded-md border border-line-2 px-2 py-0.5 text-text-2">{a.cta}</span>
                    ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function PriceTimeline({ competitors }: { competitors: Competitor[] }) {
  const { ids, name, currency } = useStoreSelection();
  const q = usePriceChanges(ids);
  const rival = new Map(competitors.map((c) => [c.id, c.name]));
  const changes = q.data ?? [];
  const days = new Map<string, PriceChange[]>();
  for (const p of changes) {
    const d = new Date(p.at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    days.set(d, [...(days.get(d) ?? []), p]);
  }
  return (
    <Panel title="Price Moves" sub="Competitor price changes, newest first. A rival cutting price is the one to watch.">
      {q.isPending ? (
        <LoadingState rows={4} />
      ) : q.isError ? (
        <ErrorState message="Couldn't load price changes." onRetry={() => q.refetch()} />
      ) : !changes.length ? (
        <p className="text-[13px] text-muted">No price changes spotted yet.</p>
      ) : (
        <ol className="grid gap-4">
          {[...days].map(([day, ps]) => (
            <li key={day}>
              <h3 className="mb-1.5 font-display text-[11px] font-semibold tracking-[.12em] text-muted uppercase">{day}</h3>
              <ul className="grid gap-1.5 border-l border-line-2 pl-3.5">
                {ps.map((p) => {
                  const cut = p.to < p.from;
                  const Icon = cut ? ArrowDownRight : ArrowUpRight;
                  return (
                    <li key={`${p.competitorId}:${p.product}:${p.at}`} className="flex flex-wrap items-baseline justify-between gap-x-3 text-[13px]">
                      <span className="min-w-0">
                        <b className="font-semibold">{rival.get(p.competitorId) ?? 'A competitor'}</b>
                        <span className="text-text-2"> · {p.product}</span>
                        <span className="text-xs text-muted"> · vs {name(p.storeId)}</span>
                      </span>
                      <span className="flex items-center gap-2 tabular-nums">
                        {/* ponytail: the rival's own currency isn't captured yet (core inbox); the store watching it is the likelier match than USD. */}
                        <span className="text-muted line-through">{cents(p.from, currency(p.storeId))}</span>
                        <b>{cents(p.to, currency(p.storeId))}</b>
                        <span className={cx('inline-flex w-[68px] items-center justify-end gap-0.5 text-xs font-semibold', cut ? 'text-red' : 'text-muted')}>
                          <Icon aria-hidden className="size-3.5" />
                          {cut ? 'Cut' : 'Up'} {Math.abs(p.changePct).toFixed(0)}%
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

/** The store's Market Analyst runs (it reads competitors with its list_competitors tool), plus a one-click brief. */
function Briefs({ c }: { c: Competitor }) {
  const { name } = useStoreSelection();
  const agentId = `${c.storeId}:market_analyst`;
  const runs = useRuns(agentId);
  const start = useStartRun();
  const brief = () =>
    start.mutate({
      agentId,
      task: `Brief me on our competitor ${c.name} (${c.url}): what they changed on price and ads lately, what seems to be working for them, and 2-3 moves we should make. Use list_competitors.`,
    });
  return (
    <Panel title="Analyst Briefs" sub={`${name(c.storeId)}'s Market Analyst`}>
      <Button variant="primary" className="w-full" disabled={start.isPending} onClick={brief}>
        <Sparkles className="size-4" />
        Brief me on {c.name}
      </Button>
      {start.isError && (
        <p role="alert" className="mt-2 text-xs text-red">
          {start.error.message} <FixLink message={start.error.message} agentId={start.variables?.agentId ?? ''} />
        </p>
      )}
      <div className="mt-4">
        {runs.isPending ? (
          <LoadingState rows={2} />
        ) : runs.isError ? (
          <ErrorState message="Couldn't load briefs." onRetry={() => runs.refetch()} />
        ) : !runs.data.length ? (
          <p className="text-[13px] text-muted">No briefs yet. Ask for one above.</p>
        ) : (
          <ul className="grid gap-2">
            {runs.data.slice(0, 5).map((r) => (
              <li key={r.id}>
                <Link to={`/agents/${encodeURIComponent(agentId)}?run=${r.id}`} className="block rounded-lg border border-line bg-bg-2 px-3 py-2 transition hover:border-line-3">
                  <span className="line-clamp-2 text-[13px]">{r.task}</span>
                  <span className="mt-1 flex items-center gap-2 text-xs text-muted">
                    <Badge tone={RUN_STATUS[r.status].tone}>{RUN_STATUS[r.status].label}</Badge>
                    {ago(r.createdAt, Date.now())}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
