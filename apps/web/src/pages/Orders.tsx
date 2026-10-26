// UI-12 Orders & Fulfillment: a queue of orders that need the owner, then every order across the selected stores.
import { useDeferredValue, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronDown, ChevronUp, CircleCheck, CircleHelp, Clock, ExternalLink, Factory, MapPin, PackageCheck, PackageSearch, RotateCcw, Search, Truck, type LucideIcon } from 'lucide-react';
import type { FulfillmentStatus, OrderIssue, OrderIssueKind, OrderStatus } from '@frontline/shared';
import { useOrderIssues, useOrders, useSetIssueStatus, useStartRun, type OrderQuery } from '../api/client';
import { FixLink } from '../components/Chat';
import { Hero } from '../components/Hero';
import { StoreFilter, useStoreSelection } from '../components/StoreFilter';
import { Badge, Button, Chip, cx, EmptyState, ErrorState, inputClass, LoadingState, Panel, Segmented, Table } from '../components/ui';
import { ago, cents } from '../lib/format';
import { orderIssues, type Issue, type IssueKind } from '../lib/orders';
import { NAV } from '../nav';

const FULFILL: Record<FulfillmentStatus, { label: string; icon: LucideIcon }> = {
  unfulfilled: { label: 'Unfulfilled', icon: Clock },
  in_transit: { label: 'In transit', icon: Truck },
  fulfilled: { label: 'Fulfilled', icon: PackageCheck },
  delivered: { label: 'Delivered', icon: CircleCheck },
};
const ISSUE_ICON: Record<IssueKind, LucideIcon> = { late: Clock, refunded: RotateCcw, tracking: PackageSearch };
const AGENT_ISSUE_ICON: Record<OrderIssueKind, LucideIcon> = { late: Clock, stuck: Truck, refund: RotateCcw, supplier: Factory, address: MapPin, other: CircleHelp };
const PAYMENT: { value: OrderStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'paid', label: 'Paid' },
  { value: 'refunded', label: 'Refunded' },
];
const PAGE = 50;
const SHOWN = 5;
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function Orders() {
  const nav = NAV.find((n) => n.path === '/orders')!;
  const { ids } = useStoreSelection();
  return (
    <>
      <Hero title={nav.title} subtitle={nav.subtitle} icon={nav.icon} art={nav.art} />
      <div className="mb-3.5">
        <StoreFilter />
      </div>
      <div className="grid gap-3.5">
        <Issues ids={ids} />
        <OrderList key={ids.join()} ids={ids} />
      </div>
    </>
  );
}

type Row = { key: string; agent: OrderIssue } | { key: string; check: Issue };
const SEVERITY = { high: 0, medium: 1, low: 2 };

/**
 * What needs the owner: issues the Operations agent flagged (most urgent first), then problems the page spots itself
 * among open and in-transit orders (oldest 200 of each) that the agent hasn't flagged yet.
 */
function Issues({ ids }: { ids: string[] }) {
  const { stores } = useStoreSelection();
  const flagged = useOrderIssues(ids);
  const open = useOrders(ids, { fulfillment: 'unfulfilled', sort: 'createdAt', dir: 'asc', limit: 200 });
  const transit = useOrders(ids, { fulfillment: 'in_transit', sort: 'createdAt', dir: 'asc', limit: 200 });
  const [all, setAll] = useState(false);
  const qs = [flagged, open, transit];

  let body: ReactNode;
  let sub = 'Late, stuck, refunded but still open, or shipped without tracking.';
  if (qs.some((q) => q.isPending)) body = <LoadingState rows={2} />;
  else if (qs.some((q) => q.isError)) body = <ErrorState message="Couldn't check orders for problems." onRetry={() => qs.forEach((q) => q.refetch())} />;
  else {
    const agent = (flagged.data ?? []).filter((i) => i.status === 'open').sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity]);
    // An order the agent flagged (open or already resolved by the owner) isn't re-raised by the page's own checks.
    const seen = new Set(flagged.data?.map((i) => `${i.storeId}:${i.orderId}`));
    const rows: Row[] = [
      ...agent.map((i) => ({ key: i.id, agent: i })),
      ...orderIssues([...(open.data?.items ?? []), ...(transit.data?.items ?? [])], Date.now(), new Set(stores.filter((s) => s.platform === 'amazon').map((s) => s.id)))
        .filter((i) => !seen.has(`${i.order.storeId}:${i.order.id}`))
        .map((i) => ({ key: `${i.order.storeId}:${i.order.id}`, check: i })),
    ];
    if (rows.length) sub = `${rows.length} order${rows.length === 1 ? '' : 's'} with a problem`;
    body = !rows.length ? (
      <p className="text-[13px] text-muted">All clear: nothing late, stuck at a supplier or untracked.</p>
    ) : (
      <>
        <ul className="grid gap-2">{(all ? rows : rows.slice(0, SHOWN)).map((r) => ('agent' in r ? <AgentIssue key={r.key} i={r.agent} /> : <CheckIssue key={r.key} i={r.check} />))}</ul>
        {rows.length > SHOWN && (
          <Button size="sm" className="mt-3" onClick={() => setAll(!all)}>
            {all ? 'Show fewer' : `Show all ${rows.length}`}
          </Button>
        )}
      </>
    );
  }
  return (
    <Panel title="Needs You" sub={sub}>
      {body}
    </Panel>
  );
}

const IssueRow = ({ icon: Icon, children, action }: { icon: LucideIcon; children: ReactNode; action: ReactNode }) => (
  <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-bg-2 px-3 py-2.5">
    <Icon aria-hidden className="size-4 shrink-0 text-red" />
    <div className="min-w-0 flex-1">{children}</div>
    {action}
  </li>
);

export function AgentIssue({ i }: { i: OrderIssue }) {
  const { name } = useStoreSelection();
  const set = useSetIssueStatus();
  const [resolving, setResolving] = useState(false);
  const [fix, setFix] = useState('');
  return (
    <IssueRow
      icon={AGENT_ISSUE_ICON[i.kind]}
      action={
        resolving ? (
          // The Operations agent reads resolved issues with this note: it says what actually fixed it.
          <form
            onSubmit={(e) => {
              e.preventDefault();
              set.mutate({ id: i.id, status: 'resolved', resolution: fix.trim() });
            }}
            className="flex basis-full flex-wrap items-center gap-2"
          >
            <input
              value={fix}
              onChange={(e) => setFix(e.target.value)}
              maxLength={500}
              autoFocus
              aria-label={`What fixed ${i.orderId}`}
              placeholder="What fixed it? Operations learns from this (optional)"
              className={cx(inputClass, 'min-w-0 flex-1 py-1.5')}
            />
            <Button size="sm" onClick={() => setResolving(false)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" variant="primary" disabled={set.isPending}>
              Resolve
            </Button>
            {set.isError && (
              <p role="alert" className="basis-full text-xs text-red">
                {set.error.message}
              </p>
            )}
          </form>
        ) : (
          <Button size="sm" onClick={() => setResolving(true)}>
            Mark resolved
          </Button>
        )
      }
    >
      <p className="flex flex-wrap items-center gap-x-2 text-[13px]">
        <b>{i.orderId}</b>
        {i.severity === 'high' && <Badge tone="red">Urgent</Badge>}
        <span className="text-muted">
          {name(i.storeId)} · flagged by Operations {ago(i.createdAt, Date.now())}
        </span>
      </p>
      <p className="text-xs text-text-2">{i.note}</p>
      {i.suggestedAction && <p className="mt-0.5 text-xs text-muted">Suggested: {i.suggestedAction}</p>}
    </IssueRow>
  );
}

function CheckIssue({ i: { order: o, kind, detail } }: { i: Issue }) {
  const { name, currency } = useStoreSelection();
  const start = useStartRun();
  return (
    <IssueRow
      icon={ISSUE_ICON[kind]}
      action={
        start.data ? (
          <Link to={`/agents/${encodeURIComponent(start.data.agentId)}`} className="text-xs text-red hover:underline">
            Operations is on it
          </Link>
        ) : (
          <Button
            size="sm"
            disabled={start.isPending}
            onClick={() =>
              start.mutate({ agentId: `${o.storeId}:operations`, task: `Order ${o.id} (${cents(o.total, currency(o.storeId))}${o.supplier ? `, ${o.supplier}` : ''}): ${detail}. Find out why and fix it, or tell me what to do.` })
            }
          >
            Hand to Operations
          </Button>
        )
      }
    >
      <p className="text-[13px]">
        <b>{o.id}</b>
        <span className="text-muted">
          {' '}
          · {name(o.storeId)} · {cents(o.total, currency(o.storeId))} · {when(o.createdAt)}
        </span>
      </p>
      <p className="text-xs text-text-2">{detail}</p>
      {start.isError && (
        <p role="alert" className="mt-1 text-xs text-red">
          {start.error.message} <FixLink message={start.error.message} agentId={start.variables?.agentId ?? ''} />
        </p>
      )}
    </IssueRow>
  );
}

function OrderList({ ids }: { ids: string[] }) {
  const { name, currency } = useStoreSelection();
  const [fulfillment, setFulfillment] = useState<FulfillmentStatus | ''>('');
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [q, setQ] = useState('');
  const query = useDeferredValue(q.trim());
  const [sort, setSort] = useState<Required<Pick<OrderQuery, 'sort' | 'dir'>>>({ sort: 'createdAt', dir: 'desc' });
  const [offset, setOffset] = useState(0);
  const orders = useOrders(ids, { fulfillment: fulfillment || undefined, status: status || undefined, q: query, ...sort, offset, limit: PAGE });
  // Any filter change starts again at page 1.
  const reset =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setOffset(0);
    };
  const filtered = !!(fulfillment || status || query);

  const sortHead = (by: 'createdAt' | 'total', label: string, right?: boolean) => (
    <th aria-sort={sort.sort === by ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={right ? 'text-right!' : undefined}>
      <button
        type="button"
        onClick={() => reset(setSort)({ sort: by, dir: sort.sort === by && sort.dir === 'desc' ? 'asc' : 'desc' })}
        className="inline-flex cursor-pointer items-center gap-1 uppercase hover:text-white"
      >
        {label}
        {sort.sort === by && (sort.dir === 'asc' ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />)}
      </button>
    </th>
  );

  return (
    <Panel title="All Orders" sub={orders.data ? `${orders.data.total.toLocaleString('en-US')} order${orders.data.total === 1 ? '' : 's'}${filtered ? ' match' : ''}` : undefined}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Fulfillment" className="flex flex-wrap gap-1.5">
          <Chip on={!fulfillment} onClick={() => reset(setFulfillment)('')}>
            All
          </Chip>
          {(Object.keys(FULFILL) as FulfillmentStatus[]).map((f) => (
            <Chip key={f} on={fulfillment === f} onClick={() => reset(setFulfillment)(f)}>
              {FULFILL[f].label}
            </Chip>
          ))}
        </div>
        <Segmented label="Payment" options={PAYMENT} value={status} onChange={reset(setStatus)} />
        <label className="relative min-w-52 flex-1 min-[1100px]:ml-auto min-[1100px]:max-w-72">
          <span className="sr-only">Search orders</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={q}
            onChange={(e) => reset(setQ)(e.target.value)}
            placeholder="Order #, tracking or supplier"
            className="w-full rounded-lg border border-line-2 bg-bg-2 py-2 pr-3 pl-9 text-[13px] placeholder:text-muted focus:border-red/60 focus:outline-none"
          />
        </label>
      </div>
      {orders.isPending ? (
        <LoadingState rows={6} />
      ) : orders.isError ? (
        <ErrorState message="Couldn't load orders." onRetry={() => orders.refetch()} />
      ) : !orders.data.items.length ? (
        <EmptyState
          icon={PackageSearch}
          title={filtered ? 'No orders match' : 'No orders yet'}
          action={
            filtered && (
              <Button onClick={() => (setFulfillment(''), setStatus(''), setQ(''), setOffset(0))}>
                Clear filters
              </Button>
            )
          }
        >
          {filtered ? 'Try another status or search.' : 'Orders show up here as soon as a store sells something.'}
        </EmptyState>
      ) : (
        <div className={orders.isPlaceholderData ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          <Table>
            <thead>
              <tr>
                <th>Order</th>
                {sortHead('createdAt', 'Placed')}
                <th>Payment</th>
                <th>Fulfillment</th>
                <th>Supplier</th>
                <th>Tracking</th>
                {sortHead('total', 'Total', true)}
              </tr>
            </thead>
            <tbody>
              {orders.data.items.map((o) => {
                const F = FULFILL[o.fulfillmentStatus];
                return (
                  <tr key={`${o.storeId}:${o.id}`}>
                    <td className="whitespace-nowrap">
                      <b className="font-semibold">{o.id}</b>
                      {ids.length !== 1 && <div className="text-xs text-muted">{name(o.storeId)}</div>}
                    </td>
                    <td className="whitespace-nowrap text-text-2">{when(o.createdAt)}</td>
                    <td>{o.status === 'refunded' ? <Badge tone="red">Refunded</Badge> : <span className="text-text-2">Paid</span>}</td>
                    <td>
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-text-2">
                        <F.icon aria-hidden className="size-3.5" />
                        {F.label}
                      </span>
                    </td>
                    <td className="whitespace-nowrap text-text-2">{o.supplier ?? '–'}</td>
                    <td className="font-mono text-xs text-text-2">
                      {o.tracking && o.trackingUrl ? (
                        <a href={o.trackingUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 hover:text-white">
                          {o.tracking}
                          <ExternalLink aria-hidden className="size-3" />
                        </a>
                      ) : (
                        (o.tracking ?? '–')
                      )}
                    </td>
                    <td className="text-right font-semibold">{cents(o.total, currency(o.storeId))}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted">
            <span className="tabular-nums">
              {offset + 1}–{offset + orders.data.items.length} of {orders.data.total.toLocaleString('en-US')}
            </span>
            <div className="flex gap-2">
              <Button size="sm" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                Previous
              </Button>
              <Button size="sm" disabled={offset + PAGE >= orders.data.total} onClick={() => setOffset(offset + PAGE)}>
                Next
              </Button>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}
