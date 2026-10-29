// Store Analytics ingestion helpers (SA-12): what each connector read did, per dataset (decision 23).
import { createHash } from 'node:crypto';
import type { SaDataset } from '@frontline/shared';
import { once, type Db } from '../db';
import { scrubError, secretsOf } from '../store-analytics/sources';

/** A read that worked (over the days it covers, when it has days), failed, or was refused for a missing optional scope. */
export type ReadOutcome = { status: 'available' | 'partial'; from?: string; to?: string; note?: string } | { status: 'failed' | 'needs_permission'; error: string };

/**
 * Records one dataset's read in `source_datasets`: the try, and on success the last success and the covered days
 * (widened, never narrowed: an incremental read covers the days since the last one). A failure keeps both and stores
 * the error scrubbed of the integration's credentials.
 */
export function noteRead(db: Db, key: Buffer, integration: string, dataset: SaDataset, outcome: ReadOutcome, now = new Date()) {
  const at = now.toISOString();
  if ('error' in outcome) {
    db.prepare(
      `INSERT INTO source_datasets (integration_id, dataset, store_id, status, last_try_at, error) VALUES (?1, ?2, (SELECT store_id FROM integrations WHERE id = ?1), ?5, ?3, ?4)
       ON CONFLICT (integration_id, dataset) DO UPDATE SET status = excluded.status, last_try_at = excluded.last_try_at, error = excluded.error`,
    ).run(integration, dataset, at, scrubError(outcome.error, secretsOf(db, key, integration)), outcome.status);
    return;
  }
  db.prepare(
    `INSERT INTO source_datasets (integration_id, dataset, store_id, status, last_try_at, last_success_at, covered_from, covered_to, error)
       VALUES (?1, ?2, (SELECT store_id FROM integrations WHERE id = ?1), ?3, ?4, ?4, ?5, ?6, ?7)
     ON CONFLICT (integration_id, dataset) DO UPDATE SET status = excluded.status, last_try_at = excluded.last_try_at, last_success_at = excluded.last_success_at, error = excluded.error,
       covered_from = coalesce(min(covered_from, excluded.covered_from), covered_from, excluded.covered_from),
       covered_to = coalesce(max(covered_to, excluded.covered_to), covered_to, excluded.covered_to)`,
  ).run(integration, dataset, outcome.status, at, outcome.from ?? null, outcome.to ?? null, outcome.note ?? null); // a partial read says what's left
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Notes a read's outcome and passes it on: a failed read is noted, then rethrown (the caller still decides whether it
 * stops the sync). A read that resolves `undefined` asked nothing this time (a report still being made) and isn't noted.
 */
export async function noted<T>(db: Db, key: Buffer, integration: string, dataset: SaDataset, read: Promise<T>, outcome: (v: Exclude<T, undefined>) => ReadOutcome = () => ({ status: 'available' })) {
  try {
    const v = await read;
    if (v !== undefined) noteRead(db, key, integration, dataset, outcome(v as Exclude<T, undefined>));
    return v;
  } catch (e) {
    noteRead(db, key, integration, dataset, { status: 'failed', error: message(e) });
    throw e;
  }
}

/** For a sync's outer catch: the datasets it was still reading failed with its error. */
export function noteFailed(db: Db, key: Buffer, integration: string, datasets: Iterable<SaDataset>, e: unknown) {
  for (const d of datasets) noteRead(db, key, integration, d, { status: 'failed', error: message(e) });
}

/**
 * SA-26 (decision 15): a product's (or variant's) unit cost from a day on, in the store's currency. Append-only: a new
 * cost never rewrites a past one, and the same cost again records nothing. True when a row was added.
 */
export function recordUnitCost(db: Db, storeId: string, productId: string, variantId: string | null, cost: number, source: string, effectiveFrom: string, now = new Date()) {
  const last = db.prepare('SELECT cost FROM unit_costs WHERE store_id = ? AND product_id = ? AND variant_id IS ? ORDER BY effective_from DESC, recorded_at DESC LIMIT 1').get(storeId, productId, variantId);
  if (last && Number(last.cost) === cost) return false;
  db.prepare('INSERT INTO unit_costs (store_id, product_id, variant_id, cost, currency, source, effective_from, recorded_at) VALUES (?, ?, ?, ?, (SELECT currency FROM stores WHERE id = ?), ?, ?, ?)').run(
    storeId, productId, variantId, cost, storeId, source, effectiveFrom, now.toISOString(),
  );
  return true;
}

/**
 * Decision 20: a store-scoped customer ref. The platform's customer id is hashed with the store and platform, so the
 * same buyer is one ref within a store and unrelated across stores; nothing personal is kept.
 */
export const customerRef = (storeId: string, kind: string, platformId: string) => `c_${createHash('sha256').update(`${storeId}|${kind}|${platformId}`).digest('hex').slice(0, 24)}`;

/**
 * SA-32: whether an optional field may be read, probed once a day per integration with `probe` (a one-order query
 * asking only for it). Any failure counts as denied until tomorrow's probe; the verdict is kept in `done_once`.
 */
export async function probeField(db: Db, integration: string, field: string, today: string, probe: () => Promise<unknown>) {
  const ref = `sa-probe:${integration}:${field}:${today}`;
  if (once(db, ref)) await probe().catch(() => once(db, `${ref}:denied`));
  return !db.prepare('SELECT 1 FROM done_once WHERE ref = ?').get(`${ref}:denied`);
}
