// Store Analytics (store-analytics lane, docs/backlog/store-analytics.md): one status vocabulary, the metric
// registry, the source capability record and the period math, shared by the server, the web app and the agents.
// Types are prefixed Sa, constants SA_ (decision 1).

/** A dataset's state for one store (decision 4). Staleness is a separate flag, not a status. */
export type SaDatasetStatus =
  | 'verified'
  | 'available'
  | 'partial'
  | 'needs_credentials'
  | 'needs_permission'
  | 'import'
  | 'failed'
  | 'not_tracked'
  | 'unsupported'
  | 'demo';

/** Why a value is missing or qualified. */
export type SaReason = 'not_tracked' | 'needs_credentials' | 'needs_permission' | 'needs_ingestion' | 'insufficient_history' | 'unsupported' | 'failed' | 'stale';

/** The words every surface shows for a reason: the page, exports, reports and agent tool output. */
export const SA_REASONS: Record<SaReason, string> = {
  not_tracked: 'Not tracked',
  needs_credentials: 'Awaiting connection',
  needs_permission: 'Needs permission',
  needs_ingestion: 'Not synced yet',
  insufficient_history: 'Not enough history',
  unsupported: 'Not supported',
  failed: 'Sync failed',
  stale: 'Out of date',
};

/** The share of a value's inputs that are known, e.g. units sold that have a unit cost (0 to 1). */
export interface SaCoverage {
  share: number;
  /** What the share counts, e.g. "units", "orders", "days". */
  of: string;
}

/** One metric value. A missing value is `null` with a reason, never 0 (decision 4). */
export interface SaValue {
  value: number | null;
  status: 'ok' | 'partial' | 'estimated' | 'demo' | 'unavailable';
  reason?: SaReason;
  note?: string;
  fix?: { label: string; href: string };
  coverage?: SaCoverage;
}

/** The page's global filters. */
export type SaFilterKey = 'channel' | 'product' | 'collection' | 'market' | 'segment';

export const SA_FILTERS: Record<SaFilterKey, string> = { channel: 'Channel', product: 'Product', collection: 'Collection', market: 'Market', segment: 'Segment' };

/** Which of the active filters a panel's numbers apply, and why it leaves out the others. */
export interface SaFilterScope {
  applied: SaFilterKey[];
  ignored: { key: SaFilterKey; reason: string; metric?: string }[];
}
