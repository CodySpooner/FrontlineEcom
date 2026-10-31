// Product Research (docs/features/product-research.md, docs/backlog/product-research.md). Every name here starts with Pr:
// the older Research* names belong to the legacy /api/research catalog, which the agents still read.

import type { RuntimeId } from './index';

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

/** POST /api/pr/imports/feed: what one supplier feed added. `undated`: offers with no date in the file (supplier claims). */
export interface PrFeedImport {
  fileId: string;
  duplicate: boolean;
  supplier: string;
  listings: number;
  variants: number;
  offers: number;
  undated: number;
}

/** POST /api/pr/imports/trends: one set per term in the file. `duplicate`: the same file was imported before. */
export interface PrTrendsImport {
  fileId: string;
  duplicate: boolean;
  category: string | null;
  sets: PrSignalSet[];
}

export type PrFit = 'strong' | 'medium' | 'weak' | 'unknown';
export const PR_FIT_LABEL: Record<PrFit, string> = { strong: 'Strong', medium: 'Medium', weak: 'Weak', unknown: 'Unknown' };

/**
 * An eligibility flag (decision 10), from rule checks on the title and category. `restricted` and `avoid` make store
 * fit Weak until dismissed; `brand`, `compatibility` and `review` are warnings. Never a silent exclusion.
 */
export type PrFlagKind = 'brand' | 'compatibility' | 'restricted' | 'review' | 'avoid';
export interface PrFlag {
  /** Stable, e.g. `restricted:batteries`: a dismissal is kept against it. */
  id: string;
  kind: PrFlagKind;
  /** e.g. "Batteries", "Brand: Apple". */
  label: string;
  /** Why: the matched term and where, e.g. `"lithium" in the title`. */
  reason: string;
}
export const PR_FLAG_KIND_LABEL: Record<PrFlagKind, string> = {
  brand: 'Brand or trademark term',
  compatibility: 'Compatibility reference, fit unverified',
  restricted: 'Restricted category',
  review: 'Compliance review',
  avoid: "On the store's avoid list",
};

/** A store's research profile (decision 5). Money in minor units of `priceCurrency`; null = unknown. */
export interface PrStoreProfile {
  storeId: string;
  audience: string | null;
  priceMin: number | null;
  priceMax: number | null;
  priceCurrency: string;
  /** ISO country every cost, delivery time and fulfillment status is for; null until the owner picks one. */
  shipTo: string | null;
  /** True while shipTo is the default from the store's currency. */
  shipToDefault: boolean;
  /** Preferred warehouse countries; empty = no preference. */
  warehouses: string[];
  maxDeliveryDays: number | null;
  avoidCategories: string[];
  avoidTerms: string[];
  includeCategories: string[];
  keywords: string[];
  updatedAt: string | null;
  /** The profile row's version (0 before the first save): PUT /api/pr/profile sends it back (409 stale, 428 without). */
  version?: number;
}

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

/** Discovery sorts (decision 11, 14). `best_fit` is store scope only. Every nullable key sorts nulls last. */
export const PR_SORTS = ['best_fit', 'recent', 'momentum', 'cost'] as const;
export type PrSort = (typeof PR_SORTS)[number];
/** Discovery view tabs, each with a server count. */
export const PR_VIEWS = ['all', 'demand', 'new', 'watchlist', 'flagged'] as const;
export type PrView = (typeof PR_VIEWS)[number];

export interface PrFacet {
  value: string;
  label: string;
  /** Products in the scope with this value. */
  n: number;
}

/** One discovery card. Money in minor units of the response's currency; null = Unknown, never 0. */
export interface PrCard {
  id: string;
  title: string;
  /** The listing whose cached image the card shows (`GET /api/pr/listings/:id/image`); null: the neutral icon. */
  imageListing: string | null;
  /** null: "Category unknown" (kept in store scope, decision 5). */
  category: string | null;
  /** The listing the card names ("<source> · <category>", "Your link · <host>"). */
  source: { id: string; label: string; host: string | null; origin: PrOrigin };
  /** Dev fixture data: the "Test fixture" pill. */
  fixture: boolean;
  /** A private row's store id (All stores names the store). */
  privateTo: string | null;
  /** Store scope only. */
  stage: PrStage | null;
  watched: boolean;
  /** Decision 8's "Cost + ship to <country>, excl. duties", from one verified row. */
  costShip: number | null;
  /** null: "Not checked yet" (no ship-to). */
  fulfillment: { status: PrFulfillment; reasons: string[]; checkedAt: string | null } | null;
  /** The conditions the status is for: variant, method, quantity, check date, and the offer's supplier and shipping. */
  conditions: { variant: string | null; method: string | null; quantity: number; checkedAt: string; supplier: string; deliveryMax: number | null; shipsFrom: string | null } | null;
  /** null: "Not checked yet". */
  demand: { cls: PrDemandClass; peakMonth: number | null; platform: string; query: string | null; region: string | null; periodStart: string | null; periodEnd: string | null; scope: PrSignalScope } | null;
  /** Qualifying demand sets (decision 9), the store's own orders included in its scope. */
  demandSets: number;
  /** Store scope only: the fit and its main reason. */
  fit: { fit: PrFit; reason: string } | null;
  /** Flags not dismissed (store scope), or the rule flags (All stores); null = "Not checked yet". */
  flags: { count: number; first: PrFlag | null } | null;
  /** All stores: stores with this product in their pipeline (a History row). */
  storesEvaluating: number;
  /** Store scope: the latest research task's execution state (the footer), never the stage; null: none yet. */
  research: { taskId: string; status: PrTaskStatus; updatedAt: string } | null;
  firstSeenAt: string | null;
  /** Evidence age: the newest retrieved or checked time. */
  evidenceAt: string | null;
}

export interface PrDiscovery {
  items: PrCard[];
  /** Pass back as `cursor` for the next page; null at the end. */
  next: string | null;
  /** Matches in the current view, with every filter applied. */
  total: number;
  counts: Record<PrView, number>;
  facets: { categories: PrFacet[]; sources: PrFacet[]; warehouses: PrFacet[]; suppliers: PrFacet[] };
  currency: string;
  shipTo: string | null;
  /** The destinations this scope can show (All stores: US and the stores' ship-tos). */
  shipTos: string[];
  /** The ECB rates' date the costs were converted with, when any conversion happened. */
  fxDate: string | null;
}

/** One source in the strip and the health view (decision 4), from its adapter and `pr_sources`. */
export interface PrSourceState {
  id: string;
  name: string;
  answers: ('discovery' | 'demand' | 'fulfillment')[];
  access: PrAccess;
  /** What the owner does to connect it, or why it can't be. */
  connect: string;
  /** `pr_sources.status` (ok, error, stopped), null before its first run. */
  status: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  errorKind: PrErrorKind | null;
  /** Products in the scope this source has real data for (fixture rows never count). */
  products: number;
  /** Dev fixture rows from this source in the scope: the strip says "test fixtures (not connected)". */
  fixtures: number;
}

/** The source health view (PR-11): a source's state plus its limits, calls, jobs and coverage. */
export interface PrSourceHealth extends PrSourceState {
  rate: string;
  quota: string;
  /** Scheduled ingestion's interval; null: never scheduled. */
  refreshHours: number | null;
  lastAttemptAt: string | null;
  /** Why the source is stopped and what clears it; null when it isn't. */
  stopped: string | null;
  /** The source's own quota as it last reported it (CJ's daily points). */
  points: { remaining: number; total: number } | null;
  /** Calls since 00:00 UTC per purpose, with the daily cap where there is one. */
  callsToday: { purpose: string; calls: number; cap: number | null }[];
  /** The newest 20 calls (`pr_calls`). */
  ledger: { purpose: string; at: string; ok: boolean }[];
  /** The newest 10 jobs. */
  jobs: { id: string; kind: string; status: string; attempts: number; error: string | null; createdAt: string; finishedAt: string | null; nextAttemptAt: string | null }[];
  /** Products in the scope whose newest offer check from this source is over 7 days old (a re-check is due). */
  stale: number;
  /** "Sync now" works: a scheduled source that is set up. */
  canSync: boolean;
  /** A job is queued or running. */
  syncing: boolean;
}

/** Decision 11's demand evidence: Strong (two or more qualifying sets, or own orders), Moderate (one), None. */
export type PrDemandLevel = 'strong' | 'moderate' | 'none';
export const PR_DEMAND_LEVEL_LABEL: Record<PrDemandLevel, string> = { strong: 'Strong', moderate: 'Moderate', none: 'None' };

/** The detail panel's header and Overview (PR-12): the card, plus what only the panel shows. */
export interface PrProductDetail {
  card: PrCard;
  currency: string;
  shipTo: string | null;
  /** The named listing's first variant SKU, and its page (http(s) only). */
  sku: string | null;
  url: string | null;
  /** Decision 11, each part on its own; there is no combined score. */
  assessment: {
    /** Store scope only. */
    fit: { fit: PrFit; reasons: string[] } | null;
    demand: { level: PrDemandLevel; sets: number; ownOrders: boolean };
    /** Open flags (store scope) or the rule flags (All stores); null: not checked yet. */
    flags: PrFlag[] | null;
    confidence: { level: 'low' | 'medium' | 'high'; count: number; has: { demand: boolean; offer: boolean; economics: boolean; report: boolean } };
    /** Store scope: the base scenario (decision 13); null in All stores. */
    economics: { currency: string; result: PrEconResult } | null;
    /** Store scope: the latest non-demo report's risks and proposals (Risk and Differentiation); null without one. */
    report: { createdAt: string; risks: string[]; proposals: PrReportBody['proposals'] } | null;
  };
  /** Store scope: the owner's notes on the product in this store (owner-provided, never evidence). */
  notes: string | null;
  /** Store scope: who handles it in the pipeline (the owner's text). */
  owner?: string | null;
  /** An agent find's own numbers (decision 2): shown collapsed as "Agent's estimates (not evidence)", never used. */
  agentEstimates: Record<string, unknown> | null;
  /** All stores: the stores with this product in their pipeline, and its stage there. */
  stores: { id: string; name: string; stage: PrStage }[];
}

/** The Demand tab: every set that speaks for the product (with its stored points), suggested query-level sets, notes. */
export interface PrDemandTab {
  sets: (PrSignalSet & { series: { at: string; value: number }[] })[];
  /** Query-level sets a search matched to this product, waiting for the owner's Confirm / Not this product. */
  suggested: PrSignalSet[];
  /** Store scope: manual notes (TikTok Creative Center), never evidence. */
  notes: { id: string; platform: string; note: string; url: string; observedAt: string }[];
}

/** One current offer row on the Suppliers tab, with its own status for its destination and quantity (decision 8). */
export interface PrOffer {
  id: string;
  /** Its series (listing, variant, supplier, destination): what an offer watch follows across checks. */
  key: string;
  supplier: string;
  variant: string | null;
  sku: string | null;
  destination: string | null;
  quantity: number;
  method: string | null;
  /** Minor units of `currency`; null: unknown (never 0). */
  unitCost: number | null;
  shipCost: number | null;
  currency: string | null;
  deliveryMin: number | null;
  deliveryMax: number | null;
  processingDays: number | null;
  moq: number | null;
  shipsFrom: string | null;
  stock: { warehouse: string | null; units: number | null }[];
  provenance: string;
  checkedAt: string;
  status: PrFulfillment;
  reasons: string[];
}

/** A History row: a stage change, watch, flag dismissal, merge or separation, offer or evidence change. */
export interface PrHistoryRow {
  id: string;
  storeId: string;
  kind: string;
  from: string | null;
  to: string | null;
  reason: string | null;
  /** "owner", or the research task id. */
  by: string;
  at: string;
  /** PR-23: the Knowledge Base card an owner's stage decision was saved as. */
  cardId?: string;
}

/**
 * A pasted product link's preview (decision 12). `read` and `redirected` carry what the page showed; `existing` is a
 * listing the store already has (no fetch); every other outcome says what it is and offers to enter details by hand.
 */
export type PrPreviewOutcome = 'read' | 'existing' | 'redirected' | 'unavailable' | 'ambiguous' | 'robots' | 'login' | 'paywall' | 'unsupported' | 'too_large' | 'failed';
export interface PrPreviewProduct {
  name: string;
  sku: string | null;
  /** The page's price (minor units), never verified. */
  price: { amount: number; currency: string } | null;
}
export interface PrPreview {
  outcome: PrPreviewOutcome;
  /** The outcome in words: "Read from the public page", "Redirected to shop.example/p/2", "The page asks to sign in". */
  message: string;
  /** Exactly as pasted; `canonicalUrl` drops the fragment and tracking parameters (the duplicate check's key). */
  url: string;
  canonicalUrl: string;
  finalUrl: string | null;
  host: string;
  retrievedAt: string | null;
  /** The store's private `owner_link` listing (or the existing one), and the listing whose cached image to show. */
  listingId: string | null;
  productId: string | null;
  imageListing: string | null;
  title: string | null;
  price: PrPreviewProduct['price'];
  sku: string | null;
  brand: string | null;
  variants: string[];
  /** What the page didn't show: "Shipping not shown on the page", … */
  missing: string[];
  /** `ambiguous` with several Product blocks: the owner picks one or enters the details. */
  candidates: PrPreviewProduct[];
}
/** What the owner corrected or added to a preview: kept as owner-provided, never as what the page said (spec §8). */
export interface PrOwnerDetails {
  title?: string;
  price?: { amount: number; currency: string };
  variants?: string[];
  notes?: string;
}
/** One preview field with where it came from. */
export type PrPreviewField<T> = { value: T; origin: 'page' | 'owner' } | null;

/** One row of the Research a Product dialog (decision 6): an eligible agent type in the store, with its state. */
export interface PrAgentRow {
  /** `product_hunter` (the seat) or a custom role id built on it. */
  type: string;
  name: string;
  custom: boolean;
  /** That type's most recent config in the store, else the seat default; this page never picks a model. */
  runtime: RuntimeId;
  model: string | null;
  effort: string | null;
  /** That config's budget for one run (USD); null: none set. */
  budgetUsd: number | null;
  state: 'available' | 'busy' | 'not_ready';
  /** Not ready: why, as the owner's next step. */
  reason: string | null;
  /** Busy: the running conversation, its queued turns, and whether the store's slots (`perStore`, Settings' run limit) are full. */
  busy: { conversationId: string; title: string; queued: number; slotsFull: boolean; perStore?: number } | null;
}

/** A research task's status, derived from its run (decision 6), never stored. */
export type PrTaskStatus = 'not_started' | 'queued' | 'running' | 'waiting_for_you' | 'awaiting_approval' | 'report_ready' | 'finished_without_report' | 'interrupted' | 'failed' | 'cancelled';
export const PR_TASK_STATUS_LABEL: Record<PrTaskStatus, string> = {
  not_started: 'Not started',
  queued: 'Queued',
  running: 'Running',
  waiting_for_you: 'Waiting for you',
  awaiting_approval: 'Awaiting approval',
  report_ready: 'Report ready',
  finished_without_report: 'Finished without a report',
  interrupted: 'Interrupted (app restarted)',
  failed: 'Failed',
  cancelled: 'Cancelled',
};
export const PR_TASK_STATUSES = Object.keys(PR_TASK_STATUS_LABEL) as PrTaskStatus[];
export interface PrTask {
  id: string;
  storeId: string;
  productId: string;
  listingId: string | null;
  url: string | null;
  /** Exactly as typed. */
  instructions: string;
  template: string | null;
  mode: 'new' | 'queue' | 'separate';
  type: string;
  conversationId: string | null;
  runId: string | null;
  status: PrTaskStatus;
  /** Not started: the refusal; Queued: "behind <conversation>" or "waiting for a store slot"; Failed: the error. */
  detail: string | null;
  /** Retry is offered for Not started, Interrupted and Failed. */
  canRetry: boolean;
  createdAt: string;
  /** The run's last change (ended, started, queued), else the task's. */
  updatedAt: string;
}

/** A report's evidence kinds (decision 7): measured by the app or a tool, research from a named source, the supplier's word, or judgment. */
export const PR_EVIDENCE_KINDS = ['measured', 'research', 'supplier_claim', 'hypothesis'] as const;
export type PrEvidenceKind = (typeof PR_EVIDENCE_KINDS)[number];
/** The report's list fields: an empty one carries its reason in `unknown_reasons`. */
export const PR_REPORT_LISTS = ['competitors', 'supplier_offers', 'risks', 'next_steps', 'evidence', 'open_questions', 'proposals'] as const;
export type PrReportList = (typeof PR_REPORT_LISTS)[number];

/** What save_research_report stores, as the agent gave it (decision 7). Proposals are never evidence. */
export interface PrReportBody {
  recommendation: PrRecommendation;
  summary: string;
  purpose: string;
  customer_problem: string;
  store_fit: { fit: 'strong' | 'medium' | 'weak'; why: string };
  demand_evidence: string;
  competitors: { name: string; price?: string; source: string }[];
  supplier_offers: { offer: string; provenance: string }[];
  risks: string[];
  next_steps: string[];
  evidence: { claim: string; kind: PrEvidenceKind; source: string }[];
  open_questions: string[];
  would_change_if: string;
  proposals: { kind: 'ad_angle' | 'differentiation'; text: string }[];
  unknown_reasons: Partial<Record<PrReportList, string>>;
}

/** One saved report. `demo`: the demo engine's scripted example, never research (shown without a recommendation). */
export interface PrReport {
  id: string;
  taskId: string;
  runId: string;
  conversationId: string | null;
  runtime: string | null;
  demo: boolean;
  createdAt: string;
  body: PrReportBody;
}

/** Unit economics (decision 13): money in minor units of the view's currency, rates in %. null = unknown, never 0. */
export const PR_ECON_FIELDS = ['price', 'discountPct', 'supplierCost', 'shipping', 'feePercent', 'feePerOrder', 'duties', 'returnRatePct', 'refundPct', 'returnCost', 'otherCosts', 'adCost'] as const;
export type PrEconField = (typeof PR_ECON_FIELDS)[number];
export const PR_ECON_PERCENT: PrEconField[] = ['discountPct', 'feePercent', 'returnRatePct', 'refundPct'];
export const PR_ECON_LABEL: Record<PrEconField, string> = {
  price: 'Selling price',
  discountPct: 'Discount',
  supplierCost: 'Supplier cost',
  shipping: 'Shipping',
  feePercent: 'Store fees',
  feePerOrder: 'Store fee per order',
  duties: 'Duties',
  returnRatePct: 'Return rate',
  refundPct: 'Refunded on a return',
  returnCost: 'Cost per return',
  otherCosts: 'Other variable costs',
  adCost: 'Advertising cost per order',
};
/** Unknown → "Incomplete: missing …", no figures. */
export const PR_ECON_REQUIRED: PrEconField[] = ['price', 'supplierCost', 'shipping', 'feePercent', 'feePerOrder'];
/** Unknown → left out, the result says "excl. …". */
export const PR_ECON_OPTIONAL: PrEconField[] = ['duties', 'returnCost', 'otherCosts'];
/** verified: a live or imported offer (with its date); owner: the owner's figure or store setting; assumption: a default the owner can change. */
export type PrEconTag = 'verified' | 'owner' | 'assumption';
export interface PrEconInput {
  value: number | null;
  /** null: unknown. */
  tag: PrEconTag | null;
  note: string | null;
}
export interface PrEconFigures {
  /** The price after discount: what ad platforms report as order value. */
  orderValue: number;
  refunds: number;
  netRevenue: number;
  fees: number;
  variableCosts: number;
  /** Expected contribution before advertising, also the break-even acquisition cost per order. */
  before: number;
  /** null: no advertising cost per order. */
  after: number | null;
  /** On order value after discounts, before refunds; null when `before` is not above zero. */
  breakEvenRoas: number | null;
}
export interface PrEconResult {
  missing: PrEconField[];
  excluded: PrEconField[];
  /** null while a required input is unknown. */
  figures: PrEconFigures | null;
}

/** Decision 13 for one scenario. Refunds come off revenue once; fees are on the discounted price and not refunded. */
export function unitEconomics(i: Record<PrEconField, number | null>): PrEconResult {
  const missing = PR_ECON_REQUIRED.filter((k) => i[k] === null);
  const returns = (i.returnRatePct ?? 0) / 100;
  // With no returns, an unknown cost per return changes nothing.
  const excluded = PR_ECON_OPTIONAL.filter((k) => i[k] === null && !(k === 'returnCost' && returns === 0));
  if (missing.length) return { missing, excluded, figures: null };
  const orderValue = Math.round(i.price! * (1 - (i.discountPct ?? 0) / 100));
  const refunds = Math.round((returns * orderValue * (i.refundPct ?? 100)) / 100);
  const netRevenue = orderValue - refunds;
  const fees = Math.round((orderValue * i.feePercent!) / 100) + i.feePerOrder!;
  const variableCosts = i.supplierCost! + i.shipping! + fees + (i.duties ?? 0) + Math.round(returns * (i.returnCost ?? 0)) + (i.otherCosts ?? 0);
  const before = netRevenue - variableCosts;
  return {
    missing,
    excluded,
    figures: { orderValue, refunds, netRevenue, fees, variableCosts, before, after: i.adCost === null ? null : before - i.adCost, breakEvenRoas: before > 0 ? Math.round((orderValue / before) * 100) / 100 : null },
  };
}

/** The owner's figures per scenario. Base: over the derived inputs; the others: over base ("same as base" otherwise). */
export type PrEconOverrides = Record<'base' | 'conservative' | 'optimistic', Partial<Record<PrEconField, number>>>;
/** GET /api/pr/products/:id/economics. PUT takes a PrEconOverrides that replaces `saved`. */
export interface PrEconomics {
  currency: string;
  /** The stored exchange rate's date when the offer was quoted in another currency. */
  rateDate: string | null;
  /** The inputs before the owner's figures, with their provenance. */
  derived: Record<PrEconField, PrEconInput>;
  saved: PrEconOverrides;
  updatedAt: string | null;
}

/** A scenario's inputs: the derived ones, then the owner's base figures, then that scenario's own. */
export function econInputs(e: Pick<PrEconomics, 'derived' | 'saved'>, scenario: keyof PrEconOverrides): Record<PrEconField, number | null> {
  return Object.fromEntries(PR_ECON_FIELDS.map((k) => [k, e.saved[scenario][k] ?? e.saved.base[k] ?? e.derived[k].value])) as Record<PrEconField, number | null>;
}

/** A comparison holds up to this many of a store's products (PR-19). */
export const PR_COMPARE_MAX = 4;
/** The economics inputs a comparison sets once for every product; price, supplier cost, shipping, duties and other costs stay each product's own. */
export const PR_COMPARE_FIELDS = ['discountPct', 'feePercent', 'feePerOrder', 'returnRatePct', 'refundPct', 'returnCost', 'adCost'] as const satisfies readonly PrEconField[];
export type PrCompareField = (typeof PR_COMPARE_FIELDS)[number];
/** POST /api/pr/comparisons (PUT …/:id replaces one): the products and the owner's shared figures. */
export interface PrComparisonInput {
  name: string;
  productIds: string[];
  figures: Partial<Record<PrCompareField, number>>;
}
/** A saved comparison: each product's own figures are read again when it is opened. */
export interface PrComparison extends PrComparisonInput {
  id: string;
  /** The store's ship-to and currency when it was saved; every product is compared on the same ones. */
  destination: string | null;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

/** PR-20: Exact only on a shared SKU, GTIN or MPN, or the owner's word; Separate is the owner's "not the same product". */
export type PrMatchVerdict = 'exact' | 'similar' | 'separate';
/** Another listing that may be this product from another supplier, with what matches and what differs. */
export interface PrMatch {
  listingId: string;
  productId: string;
  title: string;
  supplier: string;
  category: string | null;
  fixture: boolean;
  verdict: PrMatchVerdict;
  by: 'rule' | 'owner';
  matching: string[];
  differing: string[];
  /** Its cost + ship to the store's ship-to (minor units) and fulfillment status; null: unknown. */
  costShip: number | null;
  fulfillment: PrFulfillment | null;
}
/** GET /api/pr/products/:id/matches (store scope). */
export interface PrMatches {
  /** This product's own listings; `mergedFrom` is set on the ones a merge brought in (Separate moves them back). */
  listings: { id: string; title: string; supplier: string; mergedFrom: string | null }[];
  candidates: PrMatch[];
  /** "Already in your store": the linked store products, and possible ones the owner confirms or rules out. */
  inStore: { id: string; title: string; linked: boolean; matching: string[] }[];
  /** CJdropshipping is connected, so its catalog can be searched (at most 3 calls a search). */
  cj: boolean;
}
export const PR_MATCH_ACTIONS = ['same', 'not_same', 'undo', 'merge', 'split'] as const;
export type PrMatchAction = (typeof PR_MATCH_ACTIONS)[number];

/** PR-21: what a watch alerts on; a field it doesn't set takes this default. */
export interface PrWatchPrefs {
  /** Cost + ship moved by at least this percentage (1–100). */
  priceChangePct: number;
  stockOut: boolean;
  newEvidence: boolean;
  shippingChange: boolean;
}
export const PR_WATCH_PREFS: PrWatchPrefs = { priceChangePct: 10, stockOut: true, newEvidence: true, shippingChange: true };
export type PrWatchKind = 'product' | 'listing' | 'niche' | 'offer';
export type PrAlertKind = 'price' | 'stock_out' | 'new_evidence' | 'shipping' | 'new_products';
export interface PrAlert {
  id: string;
  kind: PrAlertKind;
  title: string;
  body: string | null;
  createdAt: string;
}
/** GET /api/pr/watches: the scope's watches (a store's list and the owner's all-stores list), with their checks. */
export interface PrWatch {
  id: string;
  /** null: the owner's all-stores list. */
  storeId: string | null;
  kind: PrWatchKind;
  targetId: string;
  /** A product's title, a niche's category, or an offer's supplier, listing and destination. */
  label: string;
  productId: string | null;
  prefs: PrWatchPrefs;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  /** What the last check couldn't cover, e.g. "CJdropshipping isn't connected: compared with stored offers only". */
  coverage: string | null;
  /** The newest alerts, at most 5. */
  alerts: PrAlert[];
}

/** PR-22: the test brief, an owner form. A field the owner hasn't written is prefilled only from stored data, or empty. */
export const PR_BRIEF_FIELDS = ['targetCustomer', 'offerHypothesis', 'creativeConcepts', 'measurementPlan', 'budgetAssumptions', 'decisionCriteria'] as const;
export type PrBriefField = (typeof PR_BRIEF_FIELDS)[number];
export const PR_BRIEF_LABEL: Record<PrBriefField, string> = {
  targetCustomer: 'Target customer',
  offerHypothesis: 'Offer hypothesis',
  creativeConcepts: 'Creative concepts',
  measurementPlan: 'Measurement plan',
  budgetAssumptions: 'Budget assumptions',
  decisionCriteria: 'Decision criteria',
};
/** GET/PUT /api/pr/products/:id/brief?store= (store scope). */
export interface PrBrief {
  fields: Record<PrBriefField, string>;
  /** Where a prefilled field came from, e.g. "Proposal: report of Oct 28, 2026" (absent: the owner's text, or empty). */
  from: Partial<Record<PrBriefField, string>>;
  /** null: not saved yet (the fields are the prefill). */
  updatedAt: string | null;
}
/** GET /api/pr/products/:id/links?store=: what the product led to in the store, and the store's experiments to link. */
export interface PrLinks {
  /** `team`: an "Ask a specialist" team (PR-24); its refId is the team id. */
  links: { kind: 'store_product' | 'experiment' | 'team'; refId: string; label: string; at: string }[];
  experiments: { id: string; label: string }[];
}

/** PR-24: "Ask a specialist", a team on the AI Agents team engine that Product Researcher leads. */
export const PR_SPECIALIST_ASKS = {
  positioning: { type: 'ad_strategist', label: 'Positioning', who: 'Ad Strategist' },
  measurement: { type: 'market_analyst', label: 'Measurement plan', who: 'Analytics Specialist' },
} as const;
export type PrSpecialistAsk = keyof typeof PR_SPECIALIST_ASKS;
/** GET /api/pr/products/:id/specialist?store=&ask=: the team to start (POST /api/teams), from stored data only. */
export interface PrSpecialistTeam {
  title: string;
  objective: string;
  participants: { type: string }[];
}

/**
 * GET /api/pr/products/:id/outcomes?store= (PR-25, spec §12): what happened after the research, read-only; the
 * research itself is never edited. Money in minor units of the store's currency.
 */
export interface PrOutcomes {
  currency: string;
  /** The latest model report's recommendation: what the research said at the time. */
  research: { recommendation: PrRecommendation; at: string } | null;
  /** The owner's base economics; null while incomplete. */
  assumed: { price: number; contribution: number; breakEvenRoas: number | null } | null;
  audience: string | null;
  products: PrOutcomeProduct[];
  experiments: { id: string; label: string; status: string; result: string | null }[];
  /** Knowledge Base cards linked to the product: saved decisions and outcomes. */
  lessons: { cardId: string; title: string; stage: string }[];
}
export interface PrOutcomeProduct {
  storeProductId: string;
  /** null: no longer in the store. */
  title: string | null;
  status: string | null;
  /** Added through an approved request (`product_tests`). */
  test: { addedOn: string; approvalId: string; judgedAt: string | null } | null;
  period: { from: string; to: string };
  /** The store's offer and inventory as they are now. */
  offer: { price: number; compareAt: number | null } | null;
  inventory: number | null;
  /** Paid orders in the period, profit after unit cost and store fees (no shipping, returns or ads). null on a demo store. */
  observed: { units: number; revenue: number; profit: number; uncosted: boolean; pricePerUnit: number | null; profitPerUnit: number | null } | null;
  /** This period's saved Knowledge Base card. */
  cardId?: string;
}
