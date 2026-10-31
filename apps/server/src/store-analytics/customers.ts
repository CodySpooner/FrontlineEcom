// Spec §8 Customers and retention, on decision 20's store-scoped customer refs. SA-103: why a period has no customer
// to follow (no permission, guest checkouts only, not synced yet) and the fix, instead of a report of zeros. SA-104:
// customers, new and returning, repeat rate and orders per customer, guests apart.
import { SA_SOURCES, ratio, settingsUrl, type SaCustomers, type SaFilters, type SaFilterKey, type SaPeriod, type SaSourceKind, type SaValue } from '@frontline/shared';
import type { Db } from '../db';
import { CANONICAL, unread } from './sales';

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
export function customersReport(db: Db, storeId: string, period: SaPeriod, filters: SaFilters = {}): SaCustomers {
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

