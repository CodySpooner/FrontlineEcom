// Product Research (docs/features/product-research.md, docs/backlog/product-research.md). Every name here starts with Pr:
// the older Research* names belong to the legacy /api/research catalog, which the agents still read.

/** Business stages (spec §10), kept apart from a task's execution state. */
export const PR_STAGES = ['discovered', 'researching', 'shortlisted', 'sample_review', 'ready_to_test', 'testing', 'scaled', 'rejected'] as const;
export type PrStage = (typeof PR_STAGES)[number];
export const PR_STAGE_LABEL: Record<PrStage, string> = {
  discovered: 'Discovered',
  researching: 'Researching',
  shortlisted: 'Shortlisted',
  sample_review: 'Sample review',
  ready_to_test: 'Ready to test',
  testing: 'Testing',
  scaled: 'Scaled',
  rejected: 'Rejected',
};

/** Where a listing came from. `fixture` rows are dev-only test data and never count as evidence. */
export type PrOrigin = 'ingest' | 'import' | 'owner_link' | 'agent_find' | 'legacy_sample' | 'fixture';
/** Who stands behind an offer's numbers. Only `live` and `import` can verify fulfillment. */
export type PrProvenance = 'live' | 'import' | 'owner' | 'supplier_claim' | 'fixture';
export type PrSignalOrigin = 'live' | 'import' | 'manual' | 'fixture';
export type PrSignalScope = 'product' | 'query' | 'category';

/** A source's access status (spec §4). `verified` only after a real call with real credentials succeeded. */
export type PrAccess = 'verified' | 'credentials_required' | 'approval_required' | 'authorized_import' | 'manual_only' | 'unsupported';
export const PR_ACCESS_LABEL: Record<PrAccess, string> = {
  verified: 'Verified live integration',
  credentials_required: 'Credentials required',
  approval_required: 'Approval required',
  authorized_import: 'Authorized import',
  manual_only: 'Manual research only',
  unsupported: 'Unsupported',
};
/**
 * Why a source call failed: an auth, quota or schema failure stops the source until the owner acts; a rate limit waits;
 * a timeout or server error retries a little; a bad request (our bug) or a missing item is never retried.
 */
export type PrErrorKind = 'auth' | 'rate_limit' | 'quota' | 'timeout' | 'server' | 'schema' | 'request' | 'not_found';

/** Fulfillment for one destination, variant, quantity and method (decision 8). */
export type PrFulfillment = 'verified' | 'pending' | 'insufficient' | 'not_eligible';
export const PR_FULFILLMENT_LABEL: Record<PrFulfillment, string> = {
  verified: 'Fulfillment verified for selected conditions',
  pending: 'Supplier found—verification pending',
  insufficient: 'Insufficient information',
  not_eligible: 'Not eligible',
};

/** Demand classes (decision 9), in precedence order. With no observation set the product is "Not checked yet". */
export type PrDemandClass = 'insufficient_history' | 'seasonal' | 'isolated_spike' | 'recent_acceleration' | 'sustained' | 'no_clear_pattern';
/** With no set, the UI says "Not checked yet". A seasonal set reads "Seasonal (peak <month>)". */
export const PR_DEMAND_LABEL: Record<PrDemandClass, string> = {
  insufficient_history: 'Insufficient history',
  seasonal: 'Seasonal',
  isolated_spike: 'Isolated spike',
  recent_acceleration: 'Recent acceleration',
  sustained: 'Sustained interest',
  no_clear_pattern: 'No clear pattern',
};
export type PrGranularity = 'day' | 'week' | 'month';

/** One observation set (a Trends series, an order history, a note) with its class (decision 9). */
export interface PrSignalSet {
  id: string;
  /** `google_trends`, `orders`, … */
  platform: string;
  query: string | null;
  region: string | null;
  granularity: PrGranularity | null;
  /** What a value measures, e.g. `interest_over_time`: relative interest 0–100 within this one export. */
  metric: string;
  scope: PrSignalScope;
  origin: PrSignalOrigin;
  periodStart: string | null;
  periodEnd: string | null;
  retrievedAt: string;
  points: number;
  demandClass: PrDemandClass | null;
  /** 1–12, for a seasonal set. */
  peakMonth: number | null;
  momentum: number | null;
  /** Products a query-level set is linked to; `confirmed` false = suggested by a query match, not yet confirmed. */
  links: { productId: string; title: string; confirmed: boolean }[];
}

/** POST /api/pr/imports/trends: one set per term in the file. `duplicate`: the same file was imported before. */
export interface PrTrendsImport {
  fileId: string;
  duplicate: boolean;
  category: string | null;
  sets: PrSignalSet[];
}

export type PrFit = 'strong' | 'medium' | 'weak' | 'unknown';

/** A research report's conclusion (spec §9). */
export const PR_RECOMMENDATIONS = ['research_further', 'request_sample', 'shortlist', 'monitor', 'reject'] as const;
export type PrRecommendation = (typeof PR_RECOMMENDATIONS)[number];
export const PR_RECOMMENDATION_LABEL: Record<PrRecommendation, string> = {
  research_further: 'Research further',
  request_sample: 'Request a sample',
  shortlist: 'Shortlist for testing',
  monitor: 'Monitor',
  reject: 'Reject',
};
