// Spec §8 Customers and retention, on decision 20's store-scoped customer refs. SA-103: why a period has no customer
// to follow (no permission, guest checkouts only, not synced yet) and the fix, instead of a report of zeros.
import { SA_SOURCES, settingsUrl, type SaSourceKind, type SaValue } from '@frontline/shared';
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
