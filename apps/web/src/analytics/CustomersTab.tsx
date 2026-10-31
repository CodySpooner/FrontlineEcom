// SA-106 (spec §8 Customers and retention): the Customers tab. Customers, new and returning, repeat rate and orders per
// customer with guests counted apart (SA-104); first-order cohorts and customers by country under Q22's thresholds
// (SA-105); and, with no customer to follow, why and the fix (SA-103). Store-wide: the filter scope says so.
import { Users } from 'lucide-react';
import type { SaCustomers, SaValue } from '@frontline/shared';
import { cx, EmptyState, ErrorState, LoadingState } from '../components/ui';
import { fmtDay, money } from '../lib/format';
import { useSaContext, useSaCustomers } from './api';
import { FilterScope } from './FilterScope';
import type { AnalyticsPage } from './state';
import { countryName } from './TrafficTab';
import { Unavailable } from './Unavailable';

type S = AnalyticsPage & { store: string };
const TH = 'pb-1.5 text-right font-medium';
const pct = (n: number) => `${Math.round(n * 100)}%`;
const month = (ym: string) => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** Why there's no customer to follow (no permission, guest checkouts only, not synced yet) and the fix, never zeros. */
export function NoCustomers({ why }: { why: Pick<SaValue, 'reason' | 'note' | 'fix'> }) {
  return (
    <section aria-label="No customer data" className="card p-4">
      <EmptyState icon={Users} title="No customer data for this period">
        <Unavailable value={why} className="justify-center" />
      </EmptyState>
    </section>
  );
}

function Tile({ label, v, fmt }: { label: string; v: SaValue; fmt: (n: number) => string }) {
  return (
    <div className="card flex min-w-0 flex-col gap-1 p-3.5">
      <span className="text-[11.5px] text-muted">{label}</span>
      {v.value == null ? <Unavailable value={v} className="text-[12.5px]" /> : <b className="font-display text-[22px] font-semibold tabular-nums">{fmt(v.value)}</b>}
      {v.value != null && v.note && <span className="text-[11px] text-muted">{v.note}</span>}
    </div>
  );
}

function Cohorts({ d }: { d: SaCustomers }) {
  const span = Math.max(0, ...d.cohorts.map((c) => c.months.length));
  const cell = (n: number | null, of: number | null) => (n == null ? <span className="text-muted">&lt;5</span> : of ? pct(n / of) : n);
  return (
    <section className="card min-w-0 p-4">
      <h2 className="font-display text-base font-semibold tracking-[.02em]">First-order cohorts</h2>
      <div className="mb-3 text-xs text-muted">Customers by the month of their first order, and the share buying again each month after. Under 5 customers is hidden.</div>
      {!d.cohorts.length ? (
        <p className="text-[12.5px] text-muted">No first orders in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table aria-label="First-order cohorts" className="w-full text-[12.5px] tabular-nums">
            <thead>
              <tr className="text-left text-[11px] text-muted">
                <th className="pb-1.5 font-medium">First order</th>
                <th className={TH}>Customers</th>
                {Array.from({ length: span }, (_, i) => (
                  <th key={i} className={TH}>
                    +{i + 1} mo
                  </th>
                ))}
                <th className={TH}>2+ orders</th>
              </tr>
            </thead>
            <tbody>
              {d.cohorts.map((c) => (
                <tr key={c.month} className="border-t border-[#1c1c21] [&>td]:py-[7px]">
                  <td className="pr-3 whitespace-nowrap">{month(c.month)}</td>
                  <td className="text-right">{cell(c.customers, null)}</td>
                  {Array.from({ length: span }, (_, i) => (
                    <td key={i} className="text-right">
                      {i < c.months.length ? cell(c.months[i]!, c.customers) : ''}
                    </td>
                  ))}
                  <td className="text-right">{cell(c.repeat, c.customers)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Countries({ d, currency }: { d: SaCustomers; currency?: string }) {
  const { rows, reason, note } = d.countries;
  const total = rows.reduce((a, r) => a + (r.net_sales ?? 0), 0);
  return (
    <section className="card min-w-0 p-4">
      <h2 className="font-display text-base font-semibold tracking-[.02em]">By country</h2>
      <div className="mb-3 text-xs text-muted">Net sales as on the Sales tab. Countries under 10 customers are grouped.</div>
      {!rows.length ? (
        <p className="text-[12.5px] text-muted">
          {reason && <Unavailable value={{ reason, note }} />}
          {!reason && (note ?? 'No orders in this period.')}
        </p>
      ) : (
        <table aria-label="Customers by country" className="w-full text-[12.5px] tabular-nums">
          <thead>
            <tr className="text-left text-[11px] text-muted">
              <th className="pb-1.5 font-medium">Country</th>
              <th className={TH}>Customers</th>
              <th className={TH}>Net sales</th>
              <th className={cx(TH, 'w-[26%]')}>Share</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id ?? r.kind} className={cx('border-t border-[#1c1c21] [&>td]:py-[7px]', r.kind && 'text-text-2')}>
                <td className="max-w-0 truncate pr-3">{r.id ? countryName(r.id) : r.label}</td>
                <td className="text-right">{r.customers.toLocaleString('en-US')}</td>
                <td className="text-right">{r.net_sales == null ? '–' : money(r.net_sales, currency)}</td>
                <td className="pl-3">
                  {total > 0 && r.net_sales != null && r.net_sales > 0 && (
                    <span className="flex items-center gap-2">
                      <i aria-hidden className="h-1.5 rounded-full bg-red/70" style={{ width: `${Math.min(100, (r.net_sales / total) * 100)}%` }} />
                      <span className="text-[11px] text-muted">{pct(r.net_sales / total)}</span>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function CustomersTab({ s }: { s: S }) {
  const q = useSaCustomers(s);
  const ctx = useSaContext(s.store).data;
  if (q.isError) return <ErrorState message="Couldn't load customers." onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingState rows={3} />;
  const d = q.data;
  const { identified, guest, unknown } = d.orders;
  return (
    <div className="mb-4 grid gap-3.5">
      {d.missing ? (
        <NoCustomers why={d.missing} />
      ) : (
        <section aria-label="Customers" className="grid gap-2">
          <div className="grid grid-cols-2 gap-2.5 min-[900px]:grid-cols-5">
            <Tile label="Customers" v={d.customers} fmt={(n) => n.toLocaleString('en-US')} />
            <Tile label="New" v={d.new} fmt={(n) => n.toLocaleString('en-US')} />
            <Tile label="Returning" v={d.returning} fmt={(n) => n.toLocaleString('en-US')} />
            <Tile label="Repeat rate" v={d.repeat_rate} fmt={pct} />
            <Tile label="Orders per customer" v={d.orders_per_customer} fmt={(n) => n.toFixed(2)} />
          </div>
          {d.since && <p className="text-[11.5px] text-muted">New means no earlier order since {fmtDay(d.since)}, the first synced order.</p>}
        </section>
      )}
      <p className="text-[12px] text-text-2">
        {plural(identified, 'order')} with a customer · {plural(guest, 'guest checkout')}, counted apart
        {unknown > 0 && <> · {plural(unknown, 'order')} synced before customer ids</>}
      </p>
      <FilterScope scope={d.scope} />
      {!d.missing && (
        <div className="grid items-start gap-3.5 min-[1180px]:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <Cohorts d={d} />
          <Countries d={d} currency={ctx?.currency} />
        </div>
      )}
    </div>
  );
}
