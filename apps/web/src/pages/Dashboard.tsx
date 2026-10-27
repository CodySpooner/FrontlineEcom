// UI-04 Command Center — port of docs/reference/dashboard-mockup-v3.html. The store filter scopes every panel.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useOutletContext } from 'react-router';
import { useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { ArrowRight, Check, CreditCard, RotateCcw, ShoppingBag, ShoppingCart } from 'lucide-react';
import { AGENT_ROLES, APPROVAL_KINDS, type AgentStatus, type AnalyticsRange, type AnalyticsSummary, type ApprovalRequest, type Store, type StoreEventType } from '@frontline/shared';
import { useAgents, useApprovals, useDecide, useEvents, useIntegrations, useMissingCosts, useMissions, useSummary } from '../api/client';
import { AreaChart } from '../components/AreaChart';
import { Portrait } from '../components/Art';
import { ApprovalExtras } from '../components/ApprovalExtras';
import { DenyReason } from '../components/Chat';
import { Hero } from '../components/Hero';
import { DemoMixNote, StoreFilter, UnconvertedNote, useStoreSelection } from '../components/StoreFilter';
import { AGENT_STATUS, Badge, Button, buttonClass, EmptyState, ErrorState, LoadingState, Panel, ProgressBar, Segmented, StatusDot, Tooltip, cx } from '../components/ui';
import { noFeeEstimate } from '../lib/analytics';
import { shownReason } from '../lib/approvals';
import { PERIOD, RANGES, sparkPoints, weekly } from '../lib/chart';
import { ago, cents, fitMoney, fmtDay, money, noBaseline, signedPct } from '../lib/format';
import { importing } from '../lib/sync';
import { NAV } from '../nav';

export function Dashboard() {
  const [range, setRange] = useState<AnalyticsRange>(30);
  const { ids, name } = useStoreSelection();
  const summary = useSummary(ids, range);
  const who = ids.length ? ids.map(name).join(' + ') : 'All stores';
  return (
    <>
      <Hero title={NAV[0]!.title} subtitle={NAV[0]!.subtitle} art={NAV[0]!.art} />
      <div className="mb-3.5 flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
        <StoreFilter />
        <span className="text-xs text-muted">Changes vs the {PERIOD[range].replace('last', 'previous')}</span>
        <div className="min-[620px]:ml-auto">
          <Segmented label="Date range" options={RANGES} value={range} onChange={setRange} />
        </div>
        <UnconvertedNote codes={summary.data?.unconverted} />
        <ImportNote />
        <DemoMixNote />
      </div>
      <Kpis q={summary} />
      <div className="mb-3.5 grid gap-3.5 min-[1100px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel title="Revenue Overview" sub={`${who} · ${PERIOD[range]} · ${range === 365 ? 'weekly' : 'daily'}`}>
          {summary.isError ? (
            <ErrorState message="Couldn't load revenue." onRetry={() => summary.refetch()} />
          ) : !summary.data ? (
            <div className="h-[250px] animate-pulse rounded-lg bg-white/3" />
          ) : (
            <div className={cx('transition-opacity', summary.isPlaceholderData && 'opacity-60')}>
              <RevenueChart s={summary.data} who={who} />
            </div>
          )}
        </Panel>
        <LiveActivity />
      </div>
      <div className="mb-3.5 grid gap-3.5 min-[1100px]:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <AgentsStrip />
        <Requests />
      </div>
      <Missions />
    </>
  );
}

/** UI-43: a newly connected store's order history is still coming in, so its totals are partial for now. */
function ImportNote() {
  const { has, name } = useStoreSelection();
  return (useIntegrations().data ?? []).map((i) => {
    const imp = i.storeId && has(i.storeId) ? importing(i) : undefined;
    return (
      imp && (
        <p key={i.id} className="flex basis-full items-center gap-2 text-xs text-text-2">
          <StatusDot tone="good" pulse />
          {name(i.storeId!)} is importing its order history{imp.through && `, through ${fmtDay(imp.through, true)} so far`}. Totals fill in as it goes.
        </p>
      )
    );
  });
}

function RevenueChart({ s, who }: { s: AnalyticsSummary; who: string }) {
  const daily = s.series.map((d) => ({ date: d.date, value: d.revenue }));
  return <AreaChart points={s.range === 365 ? weekly(daily) : daily} weekly={s.range === 365} partial currency={s.currency} label={`Revenue for ${who}, ${PERIOD[s.range]}: ${money(s.totals.revenue, s.currency)} total`} />;
}

/** What profit takes off revenue for these stores: the fee estimate where set, order tax where core reads it. */
export function profitFormula(stores: Store[]) {
  const fees = stores.some((x) => x.feePercent || x.feePerOrder);
  const tax = stores.some((x) => x.connected && ['shopify', 'woocommerce', 'etsy', 'tiktok_shop'].includes(x.platform));
  return ['Revenue', 'cost of goods', fees && 'your fee estimate', tax && 'sales tax', 'ad spend'].filter(Boolean).join(' − ');
}

function Kpis({ q }: { q: UseQueryResult<AnalyticsSummary> }) {
  // Products the platform has no cost for count their whole price as profit until the owner sets one.
  const { ids, stores, has } = useStoreSelection();
  const atFullPrice = useMissingCosts(ids).data?.length ?? 0;
  const noFees = noFeeEstimate(stores.filter((x) => has(x.id)));
  const grid = 'mb-3.5 grid grid-cols-2 gap-3 min-[620px]:grid-cols-3 min-[1280px]:grid-cols-5';
  if (q.isError)
    return (
      <div className="card mb-3.5">
        <ErrorState message="Couldn't load your numbers." onRetry={() => q.refetch()} />
      </div>
    );
  const s = q.data;
  if (!s)
    return (
      <div className={grid}>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="card h-[94px] animate-pulse" />
        ))}
      </div>
    );
  const { totals: t, deltas: d, previous: p } = s;
  const fresh = (k: keyof typeof t) => noBaseline(p[k], t[k]);
  // Sparklines leave out today: a day in progress reads like a crash at the right edge.
  const series = s.series.slice(0, -1);
  return (
    <div className={cx(grid, 'transition-opacity', q.isPlaceholderData && 'opacity-60')}>
      <Kpi label="Total Revenue" value={fitMoney(t.revenue, s.currency)} d={d.revenue} fresh={fresh('revenue')} series={series.map((p) => p.revenue)} />
      <Kpi
        hero
        label={
          <Tooltip tip={profitFormula(stores.filter((x) => has(x.id)))}>
            <span tabIndex={0} className="cursor-help underline decoration-muted/50 decoration-dotted underline-offset-3">
              Profit
            </span>
          </Tooltip>
        }
        extra={
          atFullPrice > 0 ? (
            <Link to="/analytics" title="These products count their whole price as profit. Set their unit costs in Store Analytics." className="text-red hover:underline">
              {atFullPrice} cost{atFullPrice > 1 ? 's' : ''} missing
            </Link>
          ) : (
            noFees.length > 0 && (
              <Link
                to="/settings"
                title={`No fee estimate for ${noFees.map((x) => x.name).join(', ')}: profit leaves out platform and payment fees. Set one in Settings.`}
                className="text-red hover:underline"
              >
                Fees left out
              </Link>
            )
          )
        }
        value={fitMoney(t.profit, s.currency)}
        negative={t.profit < 0}
        d={d.profit}
        fresh={fresh('profit')}
        series={series.map((p) => p.profit)}
      />
      <Kpi label="Ad Spend" value={fitMoney(t.adSpend, s.currency)} d={d.adSpend} fresh={fresh('adSpend')} series={series.map((p) => p.adSpend)} />
      <Kpi label="ROAS" value={t.adSpend ? `${t.roas.toFixed(1)}×` : '–'} d={d.roas} fresh={fresh('roas')} series={series.map((p) => p.roas)} />
      <Kpi label="Total Orders" extra={`AOV ${cents(t.aov, s.currency)}`} value={t.orders.toLocaleString('en-US')} d={d.orders} fresh={fresh('orders')} series={series.map((p) => p.orders)} />
    </div>
  );
}

function Kpi({ label, extra, value, d, fresh, series, hero, negative }: { label: ReactNode; extra?: ReactNode; value: string; d: number; fresh?: boolean; series: number[]; hero?: boolean; negative?: boolean }) {
  const up = Math.round(d * 10) >= 0; // same rounding as signedPct, so "+0.0%" is never red
  return (
    <div
      className={cx(
        'grid min-w-0 grid-cols-[auto_minmax(0,84px)] gap-x-2 px-4 py-3.5',
        hero ? 'rounded-xl border border-red/55 bg-[linear-gradient(180deg,rgb(255_42_58/.16),#121215_78%)] shadow-[0_0_26px_-12px_rgb(255_42_58/.45)]' : 'card',
      )}
    >
      <div className="col-span-2 flex justify-between gap-2 text-[13px] text-text-2">
        {label}
        {extra && <span className="truncate text-muted">{extra}</span>}
      </div>
      <div className={cx('col-start-1 row-start-2 mt-1 font-display text-[25px] leading-tight font-bold whitespace-nowrap', negative && 'text-red')}>{value}</div>
      <div className={cx('col-start-1 row-start-3 mt-0.5 text-[13px] font-semibold', fresh ? 'text-muted' : up ? 'text-good' : 'text-red')}>
        {fresh ? 'New' : signedPct(d)}
        <span className="sr-only">{fresh ? ', nothing in the previous period to compare with' : ' vs previous period'}</span>
      </div>
      <svg className="col-start-2 row-span-2 row-start-2 h-[34px] w-full self-center overflow-visible" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={sparkPoints(series)} fill="none" stroke={fresh ? 'var(--color-muted)' : up ? 'var(--color-good)' : 'var(--color-red)'} strokeWidth="1.8" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

/** Re-renders every `ms` so relative times ("2 min ago") stay fresh. */
function useTick(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

const EVENT: Record<StoreEventType, { label: string; icon: typeof ShoppingBag; cls: string }> = {
  order: { label: 'New Order', icon: ShoppingBag, cls: 'border-good/25 bg-good/9 text-good' },
  add_to_cart: { label: 'Add to Cart', icon: ShoppingCart, cls: 'border-line-2 bg-white/4 text-text-2' },
  checkout_started: { label: 'Checkout Started', icon: CreditCard, cls: 'border-red/35 bg-red-soft text-red' },
  refund: { label: 'Refund', icon: RotateCcw, cls: 'border-red/35 bg-red-soft text-red' },
};

export function LiveActivity() {
  const { ids, name, currency } = useStoreSelection();
  const online = useOutletContext<boolean | undefined>() ?? true;
  const q = useEvents(ids);
  useTick(30_000);
  const list = (q.data ?? []).slice(0, 5);
  return (
    <Panel
      title="Live Store Activity"
      action={
        <span className={cx('flex items-center gap-[7px] text-xs', online ? 'text-good' : 'text-muted')}>
          <StatusDot tone={online ? 'good' : 'idle'} pulse={online} />
          {online ? 'Live' : 'Reconnecting…'}
        </span>
      }
    >
      {q.isPending ? (
        <LoadingState rows={5} />
      ) : q.isError ? (
        <ErrorState message="Couldn't load store activity." onRetry={() => q.refetch()} />
      ) : !list.length ? (
        <EmptyState title="Quiet for now">New orders and carts show up here the moment they happen.</EmptyState>
      ) : (
        <ul>
          {list.map((e) => {
            const t = EVENT[e.type];
            return (
              <li key={e.id} className="grid animate-rise grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-2.5 border-t border-line py-[9px] first:border-t-0">
                <div className={cx('grid size-9 place-items-center rounded-[10px] border', t.cls)}>
                  <t.icon className="size-[18px]" strokeWidth={1.8} />
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold">{t.label}</div>
                  <div className="truncate text-xs text-muted">
                    {name(e.storeId)} · {ago(e.at)}
                  </div>
                </div>
                <div className="font-display text-sm font-bold tabular-nums">{cents(e.amount, currency(e.storeId))}</div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

const STATUS_ORDER: Record<AgentStatus, number> = { waiting_approval: 0, running: 1, error: 2, idle: 3, offline: 4 };
const TONE_TEXT = { good: 'text-good', red: 'text-red', idle: 'text-muted' };

function AgentsStrip() {
  const { ids, stores, has, name } = useStoreSelection();
  const q = useAgents();
  const mine = (q.data ?? []).filter((a) => has(a.storeId));
  const shown = [...mine].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]).slice(0, 5);
  const working = mine.filter((a) => a.status === 'running').length;
  const multi = ids.length !== 1 && stores.length > 1;
  return (
    <Panel
      title="AI Agents"
      sub={mine.length ? `${working} of ${mine.length} working` : undefined}
      action={
        <Link to="/agents" className="flex items-center gap-1 text-xs font-semibold whitespace-nowrap text-red hover:underline">
          View all agents <ArrowRight className="size-3.5" />
        </Link>
      }
    >
      {q.isPending ? (
        <LoadingState rows={2} />
      ) : q.isError ? (
        <ErrorState message="Couldn't reach your agents." onRetry={() => q.refetch()} />
      ) : !shown.length ? (
        <EmptyState
          title="No agents yet"
          action={
            <Link to="/settings" className={buttonClass('primary')}>
              Add a store
            </Link>
          }
        >
          Add a store and its squad deploys automatically.
        </EmptyState>
      ) : (
        // One row only: cards that don't fit land in zero-height rows and are clipped (least urgent last, see the sort).
        <ul className="grid grid-cols-[repeat(auto-fit,minmax(125px,1fr))] grid-rows-[auto] auto-rows-[0] gap-x-2.5 overflow-hidden">
          {shown.map((a) => {
            const st = AGENT_STATUS[a.status];
            const role = AGENT_ROLES[a.role].name;
            return (
              <li key={a.id} className="rounded-[10px] border border-line bg-bg-2 p-2.5">
                <div className="flex items-center gap-[9px]">
                  <Portrait role={a.role} rank={a.rank} />
                  <div className="min-w-0">
                    <div className="text-xs leading-tight font-semibold">{role}</div>
                    <div className={cx('mt-[3px] flex items-center gap-1.5 text-[11px] whitespace-nowrap', TONE_TEXT[st.tone])}>
                      <StatusDot tone={st.tone} pulse={st.pulse} />
                      {st.label}
                    </div>
                  </div>
                </div>
                <div className="mt-[9px] line-clamp-2 min-h-[2.7em] text-xs text-muted">
                  {multi && <span className="text-text-2">{name(a.storeId)} · </span>}
                  {a.currentTask ?? 'Ready for tasks.'}
                </div>
                <div className="mt-1.5">{a.status === 'running' ? <ProgressBar scan label={`${role} working`} /> : <div className="h-1 rounded bg-grid" />}</div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function Missions() {
  const { has, name } = useStoreSelection();
  const q = useMissions();
  const [more, setMore] = useState(false);
  const all = (q.data ?? []).filter((m) => has(m.storeId));
  const isDone = (m: { progress: number; target: number }) => m.progress >= m.target;
  const done = all.filter(isDone).length;
  // Open missions first: that's what the owner can still act on. Two rows of 4 until asked (3+ stores have more).
  const sorted = [...all].sort((a, b) => Number(isDone(a)) - Number(isDone(b)));
  const list = more ? sorted : sorted.slice(0, 8);
  return (
    <Panel title="Daily Missions" action={all.length > 0 && <span className="text-xs text-muted">{`${done}/${all.length} complete`}</span>}>
      {q.isPending ? (
        <LoadingState rows={2} />
      ) : q.isError ? (
        <ErrorState message="Couldn't load missions." onRetry={() => q.refetch()} />
      ) : !list.length ? (
        <EmptyState title="No missions today">New missions drop every morning.</EmptyState>
      ) : (
        <ul className="grid gap-x-5 gap-y-3.5 min-[620px]:grid-cols-2 min-[1280px]:grid-cols-4">
          {list.map((m) => {
            const complete = isDone(m);
            return (
              <li key={m.id} className="min-w-0">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className={cx('flex min-w-0 items-center gap-1.5 text-[13px] font-semibold', complete && 'text-muted')}>
                    {complete && <Check className="size-3.5 shrink-0 text-good" aria-label="Complete" />}
                    <span className="truncate">{m.title}</span>
                  </span>
                  <Badge tone={complete ? 'good' : 'red'}>+{m.xp} XP</Badge>
                </div>
                <ProgressBar value={m.progress / m.target} tone={complete ? 'good' : 'red'} label={m.title} />
                <div className="mt-1 text-[11px] text-muted tabular-nums">
                  {name(m.storeId)} · {m.progress.toLocaleString('en-US')} / {m.target.toLocaleString('en-US')}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {sorted.length > 8 && (
        <Button size="sm" className="mt-3" onClick={() => setMore(!more)}>
          {more ? 'Show fewer' : `Show all ${sorted.length}`}
        </Button>
      )}
    </Panel>
  );
}

export function Requests() {
  const { has, name } = useStoreSelection();
  const qc = useQueryClient();
  const q = useApprovals();
  const agents = useAgents().data ?? [];
  const decide = useDecide();
  const [verdicts, setVerdicts] = useState<Record<string, 'approve' | 'deny'>>({});
  const [failed, setFailed] = useState<string>();
  const [denying, setDenying] = useState<string>();
  // Backing out of a reason field unmounts it: focus returns to that request's Deny, not the top of the page.
  const [backed, setBacked] = useState<string>();
  const ul = useRef<HTMLUListElement>(null);
  const list = (q.data ?? []).filter((a) => has(a.storeId));
  const waiting = list.filter((a) => !verdicts[a.id]).length;

  const act = (id: string, verdict: 'approve' | 'deny', note?: string) => {
    // Deciding swaps the row's buttons for its verdict: focus moves on to the next request still waiting, not the top of the page.
    const i = list.findIndex((a) => a.id === id);
    const next = [...list.slice(i + 1), ...list.slice(0, i).reverse()].find((a) => !verdicts[a.id]);
    [...(ul.current?.querySelectorAll<HTMLButtonElement>('[data-approve]') ?? [])].find((b) => b.dataset.approve === next?.id)?.focus();
    setFailed(undefined);
    setDenying(undefined);
    setVerdicts((v) => ({ ...v, [id]: verdict }));
    decide.mutateAsync({ id, verdict, note }).then(
      // Leave the verdict on screen for a beat, then drop the row.
      () => setTimeout(() => qc.setQueryData<ApprovalRequest[]>(['approvals', 'pending'], (old = []) => old.filter((a) => a.id !== id)), 900),
      () => {
        setVerdicts(({ [id]: _, ...rest }) => rest);
        setFailed(id);
      },
    );
  };

  return (
    <Panel title="Agent Requests" action={!q.isPending && <span className="text-xs text-muted">{waiting ? `${waiting} waiting` : 'all clear'}</span>}>
      {q.isPending ? (
        <LoadingState rows={3} />
      ) : q.isError ? (
        <ErrorState message="Couldn't load requests." onRetry={() => q.refetch()} />
      ) : !list.length ? (
        <EmptyState icon={Check} title="All clear">
          Your agents will check in here.
        </EmptyState>
      ) : (
        <ul ref={ul}>
          {list.map((a) => {
            const v = verdicts[a.id];
            const role = agents.find((g) => g.id === a.agentId)?.role;
            return (
              <li key={a.id} className={cx('grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-2 border-t border-line py-[11px] transition-opacity duration-300 first:border-t-0 first:pt-0.5', v && 'opacity-55')}>
                <div className="min-w-0">
                  <div className="font-display text-[11px] font-bold tracking-[.12em] text-red uppercase">
                    {role ? AGENT_ROLES[role].name : 'Agent'} · {name(a.storeId)}
                  </div>
                  <div className="mt-0.5 text-[13px] font-semibold">{a.title}</div>
                  <div className="mt-0.5 text-xs text-muted">
                    {APPROVAL_KINDS[a.action.kind] && (
                      <span className="text-text-2">
                        {APPROVAL_KINDS[a.action.kind]!.label}
                        {shownReason(a) && ' · '}
                      </span>
                    )}
                    {shownReason(a)}
                    {a.action.amountUsd !== undefined && <span className="ml-1.5 font-semibold whitespace-nowrap text-text-2">· {money(a.action.amountUsd)}/day at stake</span>}
                  </div>
                  <ApprovalExtras action={a.action} storeId={a.storeId} />
                  {failed === a.id && (
                    <div role="alert" className="mt-1 text-xs text-red">
                      Couldn't send that. Try again.
                    </div>
                  )}
                </div>
                {v ? (
                  <span className={cx('font-display text-xs font-bold tracking-widest uppercase', v === 'approve' ? 'text-good' : 'text-red')}>{v === 'approve' ? 'Approved' : 'Denied'}</span>
                ) : denying === a.id ? (
                  <DenyReason title={a.title} onDeny={(note) => act(a.id, 'deny', note)} onBack={() => (setDenying(undefined), setBacked(a.id))} className="col-span-2" />
                ) : (
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="primary" aria-label={`Approve: ${a.title}`} onClick={() => act(a.id, 'approve')} data-approve={a.id}>
                      Approve
                    </Button>
                    <Button size="sm" aria-label={`Deny: ${a.title}`} onClick={() => setDenying(a.id)} autoFocus={backed === a.id}>
                      Deny
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Autopiloted />
    </Panel>
  );
}

const DAY_MS = 86_400_000;

/** What autopilot approved on its own (within the agent's cap) in the last 24h, so the owner can see it acted. */
function Autopiloted() {
  const { has, name } = useStoreSelection();
  const all = (useApprovals('approved').data ?? []).filter((a) => a.action.auto && has(a.storeId) && Date.now() - Date.parse(a.decidedAt ?? a.createdAt) < DAY_MS);
  const list = all.slice(0, 3);
  if (!list.length) return null;
  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="mb-1.5 font-display text-[11px] font-semibold tracking-[.15em] text-muted uppercase">Autopilot · last 24h</div>
      <ul className="grid gap-1.5">
        {list.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-2 text-xs">
            <span className="min-w-0 truncate text-text-2">
              {a.title} <span className="text-muted">· {name(a.storeId)}</span>
            </span>
            <Badge tone="good">Auto-approved</Badge>
          </li>
        ))}
      </ul>
      {all.length > list.length && <p className="mt-1.5 text-xs text-muted">{`+${all.length - list.length} more in the last 24h`}</p>}
    </div>
  );
}
