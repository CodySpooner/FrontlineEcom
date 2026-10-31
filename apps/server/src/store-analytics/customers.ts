// Spec §8 Customers and retention, on decision 20's store-scoped customer refs. SA-103: why a period has no customer
// to follow (no permission, guest checkouts only, not synced yet) and the fix, instead of a report of zeros. SA-104:
// customers, new and returning, repeat rate and orders per customer, guests apart. SA-105: first-order cohorts and
// customers by country, under the privacy thresholds (Q22).
import { SA_SOURCES, ratio, settingsUrl, type SaCohort, type SaCustomerCountry, type SaCustomers, type SaFilters, type SaFilterKey, type SaPeriod, type SaSourceKind, type SaValue } from '@frontline/shared';
import type { Db } from '../db';
import { salesBreakdown } from './breakdowns';
import type { StorePeriod } from './period';
import { CANONICAL, unread, type RefundBasis } from './sales';

export type Missing = Pick<SaValue, 'reason' | 'note' | 'fix'>;

/** Null when some order in [from, to] has a customer ref, or there's no order to have one. */
export function customersMissing(db: Db, storeId: string, from: string, to: string): Missing | null {
  const store = db.prepare('SELECT platform, demo FROM stores WHERE id = ?').get(storeId)!;
  const kind = (store.demo ? 'demo' : store.platform) as SaSourceKind;
  const source = SA_SOURCES[kind];
  const read = source?.datasets.customers;
  if (read?.support !== 'supported') return { reason: 'unsupported', note: read?.reason ?? 'This platform sends no customer ids' };
  const fix = { label: `Check ${source.name}`, href: settingsUrl('integrations', { store: storeId }) };
  const none = unread(db, storeId);
  if (none) return { reason: none.reason, note: none.note ?? 'No orders synced yet', fix };

  const c = db
    .prepare(
      `SELECT count(*) AS n, count(o.customer_ref) AS refs, count(*) FILTER (WHERE o.customer_state = 'guest') AS guests
       FROM orders o WHERE o.store_id = ? AND o.local_date BETWEEN ? AND ? AND ${CANONICAL}`,
    )
    .get(storeId, from, to)!;
  if (Number(c.refs) || !Number(c.n)) return null;
  // Shopify reads customer ids only while its daily probe of them passes (SA-32); the latest verdict decides.
  const probe = db.prepare('SELECT ref FROM done_once WHERE ref GLOB ? ORDER BY ref DESC LIMIT 1').get(`sa-probe:${kind}:${storeId}:customer:*`)?.ref;
  if (String(probe ?? '').endsWith(':denied'))
    return { reason: 'needs_permission', note: `${source.name} hasn't allowed reading the orders' customer (protected customer data)`, fix: { label: `Allow customer data for ${source.name}`, href: fix.href } };
  if (Number(c.guests) === Number(c.n)) return { reason: 'not_tracked', note: 'Every order in this period was a guest checkout, so there is no customer to follow. Customer accounts at checkout give repeat buyers an id.' };
  return { reason: 'needs_ingestion', note: 'These orders were synced before customer ids were read; the next full sync adds them', fix };
}

const value = (v: number | null, status: SaValue['status'], extra: Omit<SaValue, 'value' | 'status'> = {}): SaValue => ({ value: v, status, ...extra });

/** Store-wide: the page's filters don't narrow customers, and the scope says so. */
export function customersReport(db: Db, storeId: string, period: SaPeriod, filters: SaFilters = {}): Omit<SaCustomers, 'cohorts' | 'countries'> {
  const { from, to } = period;
  const keys = (Object.keys(filters) as SaFilterKey[]).filter((k) => filters[k]?.length);
  const scope = { applied: [], ignored: keys.map((key) => ({ key, reason: 'Customers are counted store-wide' })) };
  const since = db.prepare('SELECT min(local_date) AS d FROM orders WHERE store_id = ?').get(storeId)?.d;
  const rows = db.prepare(`SELECT o.customer_ref AS ref, o.customer_state AS state FROM orders o WHERE o.store_id = ? AND o.local_date BETWEEN ? AND ? AND ${CANONICAL}`).all(storeId, from, to);
  const orders = { identified: 0, guest: 0, unknown: 0 };
  const count = new Map<string, number>();
  for (const r of rows) {
    if (r.ref != null) orders.identified++, count.set(String(r.ref), (count.get(String(r.ref)) ?? 0) + 1);
    else if (r.state === 'guest') orders.guest++;
    else orders.unknown++;
  }
  const base = { period, since: since == null ? null : String(since), orders, scope };
  const missing = customersMissing(db, storeId, from, to);
  if (missing) {
    const none = value(null, 'unavailable', missing);
    return { ...base, customers: none, new: none, returning: none, repeat_rate: none, orders_per_customer: none, missing };
  }

  // A customer with a counted order before the period returns; the rest are new since the first synced order.
  const before = new Set(
    db
      .prepare(`SELECT DISTINCT o.customer_ref AS ref FROM orders o WHERE o.store_id = ? AND o.local_date < ? AND o.customer_ref IS NOT NULL AND ${CANONICAL}`)
      .all(storeId, from)
      .map((r) => String(r.ref)),
  );
  const customers = count.size;
  const returning = [...count.keys()].filter((r) => before.has(r)).length;
  const repeat = [...count.values()].filter((n) => n > 1).length;
  // Orders synced before customer ids may hide customers: partial, with the share whose buyer is known.
  const known = orders.identified + orders.guest;
  const coverage = known < rows.length ? { coverage: { share: known / rows.length, of: 'orders' }, note: `${orders.unknown} ${orders.unknown === 1 ? 'order' : 'orders'} synced before customer ids` } : {};
  const status: SaValue['status'] = known < rows.length ? 'partial' : 'ok';
  const rate = (v: number | null) => (v == null ? value(null, 'unavailable', { note: 'No customers in this period' }) : value(v, status, coverage));
  return {
    ...base,
    customers: value(customers, status, coverage),
    new: value(customers - returning, status, { ...coverage, note: [coverage.note, 'Counted from the first synced order: an earlier buyer counts as new'].filter(Boolean).join('; ') }),
    returning: value(returning, status, coverage),
    repeat_rate: rate(ratio(repeat, customers)),
    orders_per_customer: rate(ratio(orders.identified, customers)),
  };
}

/** Q22: the smallest cohort cell and country group shown. */
export const MIN_CELL = 5;
export const MIN_GROUP = 10;
const shown = (n: number) => (n < MIN_CELL ? null : n);
const monthNo = (day: string) => Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1;

/** Customers by the month of their first counted order (since the first synced one) inside [from, to], followed to `to`. */
export function customerCohorts(db: Db, storeId: string, from: string, to: string): SaCohort[] {
  const rows = db
    .prepare(
      `WITH f AS (SELECT o.customer_ref AS ref, min(o.local_date) AS first FROM orders o WHERE o.store_id = ?1 AND o.customer_ref IS NOT NULL AND o.local_date <= ?3 AND ${CANONICAL} GROUP BY 1)
       SELECT f.ref, f.first, o.local_date AS day FROM f JOIN orders o ON o.store_id = ?1 AND o.customer_ref = f.ref AND o.local_date <= ?3 AND ${CANONICAL} WHERE f.first >= ?2`,
    )
    .all(storeId, from, to);
  const refs = new Map<string, { first: string; orders: number; later: Set<number> }>();
  for (const r of rows) {
    const c = refs.get(String(r.ref)) ?? refs.set(String(r.ref), { first: String(r.first), orders: 0, later: new Set() }).get(String(r.ref))!;
    c.orders++;
    c.later.add(monthNo(String(r.day)) - monthNo(c.first));
  }
  const cohorts = new Map<string, { first: string; orders: number; later: Set<number> }[]>();
  for (const c of refs.values()) cohorts.set(c.first.slice(0, 7), [...(cohorts.get(c.first.slice(0, 7)) ?? []), c]);
  return [...cohorts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, cs]) => {
      const span = monthNo(to) - monthNo(`${month}-01`);
      const months = Array.from({ length: span }, (_, i) => cs.filter((c) => c.later.has(i + 1)).length);
      const repeat = cs.filter((c) => c.orders > 1).length;
      return cs.length < MIN_CELL
        ? { month, customers: null, months: months.map(() => null), repeat: null }
        : { month, customers: cs.length, months: months.map(shown), repeat: shown(repeat) };
    });
}

/** The Sales tab's net sales by country, with each country's customers; countries under 10 customers merge into Other. */
export function customerCountries(db: Db, storeId: string, sp: StorePeriod, basis: RefundBasis): SaCustomers['countries'] {
  const b = salesBreakdown(db, { storeId }, sp, {}, basis, 'country', 300);
  if (!b.rows.length) return { rows: [], ...(b.reason && { reason: b.reason }), ...(b.note && { note: b.note }) };
  const { from, to } = sp.period;
  const per = new Map(
    db
      .prepare(`SELECT o.country AS c, count(DISTINCT o.customer_ref) AS n FROM orders o WHERE o.store_id = ? AND o.local_date BETWEEN ? AND ? AND ${CANONICAL} GROUP BY 1`)
      .all(storeId, from, to)
      .map((r) => [r.c == null ? null : String(r.c), Number(r.n)]),
  );
  const rows: SaCustomerCountry[] = [];
  const other = { customers: 0, net_sales: 0 as number | null, n: 0 };
  for (const r of b.rows) {
    if (r.kind === 'unknown') rows.push({ id: null, label: 'Unknown', customers: per.get(null) ?? 0, net_sales: r.net_sales, kind: 'unknown' });
    else if ((per.get(r.id) ?? 0) >= MIN_GROUP) rows.push({ id: r.id, label: r.label, customers: per.get(r.id)!, net_sales: r.net_sales });
    else {
      other.n++;
      other.customers += per.get(r.id) ?? 0;
      other.net_sales = other.net_sales == null || r.net_sales == null ? null : Math.round((other.net_sales + r.net_sales) * 100) / 100;
    }
  }
  const at = rows.findIndex((r) => r.kind === 'unknown');
  if (other.n) rows.splice(at < 0 ? rows.length : at, 0, { id: null, label: `Other (${other.n} ${other.n === 1 ? 'country' : 'countries'})`, customers: other.customers, net_sales: other.net_sales, kind: 'other' });
  return { rows };
}

