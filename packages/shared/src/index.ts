// Domain types and API contracts shared by apps/web, apps/server and packages/agents.
// Additive changes only: never rename or remove a field another lane already uses.

export type Platform = 'shopify' | 'tiktok_shop' | 'etsy' | 'amazon' | 'woocommerce' | 'walmart';
export const PLATFORMS: Platform[] = ['shopify', 'tiktok_shop', 'etsy', 'amazon', 'woocommerce', 'walmart'];

export type Niche = 'beauty' | 'pet' | 'tech' | 'fitness' | 'home' | 'fashion' | 'kids' | 'outdoor' | 'other';
export const NICHES: Niche[] = ['beauty', 'pet', 'tech', 'fitness', 'home', 'fashion', 'kids', 'outdoor', 'other'];

export interface Store {
  id: string;
  name: string;
  platform: Platform;
  niche: Niche;
  /** Free-text sub-niche, e.g. "dog travel gear" or "K-beauty skincare". */
  nicheDetail?: string;
  currency: string;
  timezone: string;
  /** Accent color for charts and chips. */
  color: string;
  /** True when real platform credentials are connected; false = demo data. */
  connected: boolean;
}

export type AgentRole =
  | 'ad_strategist'
  | 'product_hunter'
  | 'store_developer'
  | 'creative_studio'
  | 'market_analyst'
  | 'copywriter'
  | 'email_sms'
  | 'operations';

export const AGENT_ROLES: Record<AgentRole, { name: string; blurb: string }> = {
  ad_strategist: { name: 'Ad Strategist', blurb: 'Creates, manages and optimizes ad campaigns across Meta, TikTok, Google.' },
  product_hunter: { name: 'Product Hunter', blurb: 'Finds winning products from trend data, competitor analysis and market research.' },
  store_developer: { name: 'Store Developer', blurb: 'Builds and optimizes the storefront: theme, pages, CRO and custom features.' },
  creative_studio: { name: 'Creative Studio', blurb: 'Generates high-converting ads with Higgsfield AI: image, video and UGC.' },
  market_analyst: { name: 'Market Analyst', blurb: 'Analyzes competitors, market trends and niche opportunities.' },
  copywriter: { name: 'Copywriter', blurb: 'Writes ad copy, product descriptions and landing pages that convert.' },
  email_sms: { name: 'Email & SMS', blurb: 'Creates automated email and SMS flows, campaigns and retention strategies.' },
  operations: { name: 'Operations', blurb: 'Handles orders, fulfillment, suppliers, customer service and automation.' },
};

export type AgentStatus = 'idle' | 'running' | 'waiting_approval' | 'error' | 'offline';

/** Agent ranks by level: Recruit 1, Operative 5, Specialist 10, Veteran 15, Elite 20, Legend 30. */
export type Rank = 'Recruit' | 'Operative' | 'Specialist' | 'Veteran' | 'Elite' | 'Legend';
export const RANKS: Rank[] = ['Recruit', 'Operative', 'Specialist', 'Veteran', 'Elite', 'Legend'];

/** suggest = recommends only; ask = side effects need approval; autopilot = auto-approved within caps (logged). */
export type Autonomy = 'suggest' | 'ask' | 'autopilot';
export const AUTONOMY_LEVELS: Autonomy[] = ['suggest', 'ask', 'autopilot'];

/** One agent = one role working for one store. Every store has its own squad. */
export interface Agent {
  id: string;
  storeId: string;
  role: AgentRole;
  status: AgentStatus;
  level: number;
  xp: number;
  currentTask?: string;
  /** Always set by the API. Disabled agents show as `offline`; "Deploy Agent" enables one. */
  enabled?: boolean;
  /** Always set by the API. */
  autonomy?: Autonomy;
  /** Always set by the API. */
  rank?: Rank;
  /** Total XP at which the next level starts (same units as `xp`). Always set by the API. */
  nextLevelXp?: number;
  /** XP into the current level / XP the level costs (XP bar). Always set by the API. */
  levelProgress?: { xp: number; needed: number };
}

/** GET /api/agents?stores=a,b → Agent[] (squads in store order, roles in AGENT_ROLES order). GET /api/agents/:id → Agent. */
export type AgentsResponse = Agent[];

/** PATCH /api/agents/:id body. Response: the updated Agent. */
export interface AgentUpdate {
  enabled?: boolean;
  autonomy?: Autonomy;
}

export interface DailyMetrics {
  storeId: string;
  /** YYYY-MM-DD in the store's timezone. */
  date: string;
  revenue: number;
  adSpend: number;
  /** Cost of goods + shipping + fees. Profit = revenue - cogs - adSpend. */
  cogs: number;
  orders: number;
  sessions: number;
}

export type StoreEventType = 'order' | 'add_to_cart' | 'checkout_started' | 'refund';

export interface StoreEvent {
  id: string;
  storeId: string;
  type: StoreEventType;
  amount: number;
  /** ISO timestamp. */
  at: string;
}

export type ApprovalStatus = 'pending' | 'approved' | 'denied';

/**
 * Approval action kinds the app produces, with owner-facing labels. `autopilot`: it carries a USD amount, so the
 * owner can let it auto-approve within a daily cap (StoreCaps.autopilot). Agents may ask for other kinds; the owner
 * applies those by hand.
 */
export const APPROVAL_KINDS: Record<string, { label: string; autopilot?: boolean }> = {
  'ads.set_budget': { label: 'Change ad budgets', autopilot: true },
  'ads.pause_campaign': { label: 'Pause campaigns', autopilot: true },
  'creative.generate': { label: 'Generate ad creatives' },
  'store.add_products': { label: 'Add products' },
  'store.publish_page': { label: 'Publish store pages' },
  'store.publish_theme': { label: 'Publish theme changes' },
  'store.set_price': { label: 'Change prices' },
  'niche.promote_learning': { label: 'Share a learning with the niche' },
  save_niche_pack: { label: 'Save a niche pack' },
  tool_use: { label: 'Use a connected tool' },
};

export interface ApprovalAction {
  kind: string;
  payload: unknown;
  /** Money at stake per day in USD (budget change, spend, refunds), when the agent can say. */
  amountUsd?: number;
  /** True when autopilot approved it within the store's cap for this kind (StoreCaps.autopilot), no owner click. */
  auto?: boolean;
}

export interface ApprovalRequest {
  id: string;
  storeId: string;
  agentId: string;
  /** Short imperative, e.g. "Pause 2 losing ad sets". */
  title: string;
  /** Evidence, e.g. "Losing $45/day for 4 days straight". */
  reason: string;
  action: ApprovalAction;
  status: ApprovalStatus;
  createdAt: string;
  runId?: string;
  /** ISO timestamp, set when approved or denied. */
  decidedAt?: string;
}

// ---------------------------------------------------------------------------------------------------------------------
// API contracts (core lane). Every endpoint's request/response shape lives here.

/** Dashboard ranges in days: 7D / 30D / 90D / 1Y. */
export type AnalyticsRange = 7 | 30 | 90 | 365;
export const ANALYTICS_RANGES: AnalyticsRange[] = [7, 30, 90, 365];

/** Profit = revenue - cogs - adSpend. ROAS = revenue / adSpend (0 when no spend). AOV = revenue / orders (0 when no orders). */
export interface MetricTotals {
  revenue: number;
  profit: number;
  adSpend: number;
  roas: number;
  orders: number;
  aov: number;
}

export type StoreHealthStatus = 'winning' | 'steady' | 'bleeding';

/**
 * Store health (DESIGN §8): net margin = profit ÷ revenue over the period. Bleeding = losing money, Winning = 15%+ net
 * margin, else Steady. `bar` fills 0..1 at 30% margin. One definition for the dashboard badges and the agents.
 */
// ponytail: fixed thresholds; per-niche targets if beauty-style 30% margins make every other niche look bad.
export function storeHealth({ revenue, profit }: Pick<MetricTotals, 'revenue' | 'profit'>): { status: StoreHealthStatus; marginPct: number; bar: number } {
  const marginPct = revenue > 0 ? Math.round((1000 * profit) / revenue) / 10 : 0;
  const status = profit < 0 ? 'bleeding' : marginPct >= 15 ? 'winning' : 'steady';
  return { status, marginPct, bar: Math.min(1, Math.max(0, marginPct / 30)) };
}

/** Percent change vs the previous period of the same length, e.g. 18.4 = +18.4%. 0 when the previous value is 0. */
export type MetricDeltas = MetricTotals;

export interface MetricPoint extends MetricTotals {
  /** YYYY-MM-DD. */
  date: string;
}

/** GET /api/analytics/summary?stores=a,b&range=7|30|90|365 (stores omitted = all stores). */
export interface AnalyticsSummary {
  range: AnalyticsRange;
  storeIds: string[];
  /** First and last day of the selected period, YYYY-MM-DD, inclusive. */
  from: string;
  to: string;
  totals: MetricTotals;
  /** The preceding period of the same length. While today is in progress, its last day counts up to the same time of day. */
  previous: MetricTotals;
  deltas: MetricDeltas;
  /** One point per day, oldest first (UI buckets 1Y into weeks). */
  series: MetricPoint[];
  byStore: { storeId: string; totals: MetricTotals; deltas: MetricDeltas }[];
  /** Period totals. Sessions, add to carts and checkouts come from GA4 (or demo data); 0 until it is connected. */
  funnel: Funnel;
  /**
   * ISO code of every amount in this response: the store's own currency for one store, Settings.baseCurrency for
   * several (converted at ECB reference rates). /api/analytics/campaigns and /top-products with the same stores use it too.
   * Always set by /api/analytics/summary; treat a missing value as USD.
   */
  currency?: string;
  /**
   * Store currencies with no exchange rate into `currency` (not published by the ECB, or rates not fetched yet).
   * Stores in them are left out of every amount here (and of /campaigns and /top-products for the same stores);
   * open such a store alone to see it in its own currency. Absent when everything converted.
   */
  unconverted?: string[];
}

export interface Funnel {
  sessions: number;
  addToCarts: number;
  checkouts: number;
  orders: number;
}

export type AdNetwork = 'meta' | 'tiktok' | 'google';

/** GET /api/analytics/campaigns?stores=&range= → CampaignStats[] over the period, biggest spend first. */
export interface CampaignStats {
  network: AdNetwork;
  id: string;
  storeId: string;
  name: string;
  /** Network statuses folded: deleted/removed → archived, anything else running or in review → active. */
  status: 'active' | 'paused' | 'archived';
  dailyBudget: number;
  spend: number;
  revenue: number;
  roas: number;
  purchases: number;
  clicks: number;
  impressions: number;
}

/** GET /api/analytics/top-products?stores=&range=&limit= → TopProduct[], best revenue first (paid orders in the period). */
export interface TopProduct {
  storeId: string;
  productId: string;
  title: string;
  image?: string;
  units: number;
  revenue: number;
  /** Revenue minus product cost (ad spend is not allocated per product). */
  profit: number;
}

/**
 * GET /api/suppliers/products?q=&limit= → SupplierProduct[] from the CJ Dropshipping catalog (name or SKU search).
 * Without a CJ connection the matches come from the demo research catalog and carry `demo: true`.
 */
export interface SupplierProduct {
  supplier: 'cj';
  id: string;
  sku: string;
  title: string;
  image?: string;
  /** Supplier price in USD, before shipping (lowest variant). */
  price: number;
  /** How many sellers list it on CJ, a demand signal. */
  listed: number;
  demo?: boolean;
}

/** POST /api/stores body. Response: the created Store. */
export interface StoreInput {
  name: string;
  platform: Platform;
  niche: Niche;
  nicheDetail?: string;
  /** Default 'USD'. */
  currency?: string;
  /** Default: the timezone of the machine running the app. */
  timezone?: string;
  /** Default red accent. */
  color?: string;
}

/** PATCH /api/stores/:id body. Response: the updated Store. */
export type StoreUpdate = Partial<StoreInput>;

/** GET /api/events?stores=a,b&limit=20 → StoreEvent[] newest first (default limit 20, max 200). */
export type EventsResponse = StoreEvent[];

export type ApprovalDecision = 'approve' | 'deny';

/** What an agent passes to create an approval request (core fills id, status, createdAt). */
export interface NewApprovalRequest {
  storeId: string;
  agentId: string;
  runId?: string;
  title: string;
  reason: string;
  action: ApprovalAction;
}

/**
 * In-process approvals hook the server hands to the agents engine.
 * `create` stores + broadcasts a pending request; `decision` resolves when the owner approves or denies it.
 */
export interface ApprovalsHook {
  create(input: NewApprovalRequest): ApprovalRequest;
  decision(id: string): Promise<ApprovalRequest>;
}

/** Messages on the `/api/live` WebSocket (JSON, one per frame). New `type`s may be added; ignore unknown ones. */
export type LiveMessage =
  | { type: 'event'; event: StoreEvent }
  | { type: 'approval'; approval: ApprovalRequest }
  | { type: 'notification'; notification: AppNotification }
  /** An agent run was queued, started or finished (agents lane). */
  | { type: 'run'; run: AgentRun }
  /** One streamed event of a running agent (text, tool calls, approvals, memories, done/error). */
  | { type: 'run_event'; runId: string; agentId: string; storeId: string; event: AgentEvent }
  /** XP was earned (toast); `levelUp` when it crossed a level (burst). No agentId = the commander. */
  | { type: 'xp'; xp: XpEvent; levelUp?: { level: number; rank: Rank } };

/** Error body for any non-2xx API response. */
export interface ApiError {
  error: string;
}

export type MemoryKind = 'fact' | 'learning' | 'preference';

/** Something an agent learned about its store. Ranked by relevance × recency × confidence. */
export interface StoreMemory {
  id: string;
  storeId: string;
  agentId: string;
  kind: MemoryKind;
  text: string;
  /** What backs it up, e.g. "Hook A: 3.1 ROAS over 5 days vs 1.4 for hook B". */
  evidence?: string;
  /** 0..1 */
  confidence: number;
  tags: string[];
  createdAt: string;
  /** Owner-pinned: always in the agents' prompt, whatever the task. */
  pinned?: boolean;
}

/** GET /api/missions?stores= → Mission[]: 3 per store, regenerated daily. XP goes to the commander once complete. */
export interface Mission {
  id: string;
  storeId: string;
  title: string;
  progress: number;
  target: number;
  xp: number;
}

/** GET /api/achievements → Achievement[] (whole catalog; unlocked ones carry unlockedAt). */
export interface Achievement {
  id: string;
  title: string;
  description: string;
  xp: number;
  unlockedAt?: string;
}

/** GET /api/commander → the owner's level (XP from missions + achievements) and profit streak in days. */
export interface Commander {
  level: number;
  xp: number;
  rank: Rank;
  levelProgress: { xp: number; needed: number };
  streakDays: number;
}

export interface XpEvent {
  id: string;
  storeId?: string;
  /** Omitted = the commander. */
  agentId?: string;
  amount: number;
  reason: string;
  createdAt: string;
}

export type CreativeKind = 'image' | 'video' | 'ugc' | 'copy';
export type AspectRatio = '1:1' | '4:5' | '9:16' | '16:9';

/**
 * The creatives library. GET /api/creatives?stores=&kind=&limit= → Creative[] newest first; DELETE /api/creatives/:id → 204.
 * Agents add to it with the create_creative tool (media kinds spend generation credits and need approval; copy doesn't).
 */
/** Generation credits per creative kind, counted against the store's `higgsfieldCreditsPerDay` cap. */
export const CREDITS: Record<CreativeKind, number> = { image: 2, video: 20, ugc: 40, copy: 0 };

export interface Creative {
  id: string;
  storeId: string;
  agentId: string;
  runId?: string;
  kind: CreativeKind;
  /** Media kinds only. */
  aspect?: AspectRatio;
  /** The visual brief given to the generator. */
  prompt?: string;
  headline: string;
  primaryText: string;
  cta?: string;
  /** Image/video URL; a data: URL for demo renders. */
  mediaUrl?: string;
  /** Generation credits spent (0 for copy). */
  credits: number;
  /** demo = simulated render (no Higgsfield connected); agent = written copy. */
  source: 'demo' | 'higgsfield' | 'agent';
  createdAt: string;
}

export type RunStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

/** One task given to an agent. A follow-up chat message is a new run that resumes the previous run's session. */
export interface AgentRun {
  id: string;
  storeId: string;
  agentId: string;
  task: string;
  status: RunStatus;
  /** Set when the run finished; pass the run id as `resumeRunId` to continue the conversation. */
  sessionId?: string;
  usage: RunUsage;
  error?: string;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  /** Set when a squadmate assigned this task (`assign_task`): the run that assigned it. */
  parentRunId?: string;
}

export type KnowledgeKind = 'playbook' | 'platform' | 'niche';

/**
 * Knowledge Base: an expertise layer the agents read. GET /api/knowledge → KnowledgeDoc[] (no markdown);
 * GET /api/knowledge/:kind/:key → KnowledgeDoc with markdown; PUT it `{ markdown }` (1–50,000 chars) → the saved doc;
 * DELETE → back to the shipped version (400 for custom niche packs). Store memory: /api/stores/:id/memory; niche learnings: /api/niche-learnings.
 */
export interface KnowledgeDoc {
  kind: KnowledgeKind;
  /** Role, platform or niche id; custom niche packs are `other:<slug>` (same key as niche learnings). */
  key: string;
  title: string;
  /** A pack the Market Analyst drafted for this owner's custom niche (in the data dir). */
  custom?: boolean;
  /** The owner edited the shipped layer (PUT); DELETE goes back to the shipped one. */
  edited?: boolean;
  chars: number;
  markdown?: string;
}

/** One step of an email/SMS flow. */
export interface FlowMessage {
  /** Hours after the trigger (or the previous step). */
  delayHours: number;
  channel: 'email' | 'sms';
  /** Email only. */
  subject?: string;
  preview?: string;
  body: string;
  /** e.g. "10% code WELCOME10, step 3 only". */
  offer?: string;
}

/**
 * An email/SMS flow designed by the Email & SMS agent, for the owner to set up in their email/SMS tool (no sending
 * integration yet). GET /api/flow-drafts?stores=&limit= → FlowDraft[] newest first; DELETE /api/flow-drafts/:id → 204.
 */
export interface FlowDraft {
  id: string;
  storeId: string;
  agentId: string;
  runId?: string;
  /** e.g. "Checkout abandonment"; a newer draft of the same name replaces the old one. */
  name: string;
  /** e.g. "Checkout started, no order within 1 hour; exclude buyers in the last 30 days". */
  trigger: string;
  messages: FlowMessage[];
  /** Why this flow, sized with the numbers. */
  notes: string;
  createdAt: string;
}

export type OrderIssueKind = 'late' | 'stuck' | 'refund' | 'supplier' | 'address' | 'other';
export type OrderIssueStatus = 'open' | 'resolved';

/**
 * Orders & Fulfillment issue queue, flagged by the Operations agent. GET /api/order-issues?stores=&status=&limit= →
 * OrderIssue[] (open first, newest first); PATCH /api/order-issues/:id { status, resolution? } → OrderIssue.
 */
export interface OrderIssue {
  id: string;
  storeId: string;
  orderId: string;
  agentId: string;
  kind: OrderIssueKind;
  severity: 'low' | 'medium' | 'high';
  /** What is wrong, with the facts (days since order, status, carrier). */
  note: string;
  suggestedAction?: string;
  status: OrderIssueStatus;
  resolution?: string;
  createdAt: string;
  resolvedAt?: string;
}

export type PageDraftKind = 'product' | 'page';
/** draft → pending (publish requested) → published, or rejected. approved = approved, but a connected store needs it applied by hand. */
export type PageDraftStatus = 'draft' | 'pending' | 'approved' | 'published' | 'rejected';

/**
 * A Store Developer draft (Store Builder). GET /api/page-drafts?stores=&status=&limit= → PageDraft[] newest first;
 * GET /api/page-drafts/:id; POST /api/page-drafts/:id/publish → PageDraft (the owner publishes: approves the pending
 * request (202), or publishes a draft directly; 409 if already approved/published); DELETE /api/page-drafts/:id → 204.
 */
export interface PageDraft {
  id: string;
  storeId: string;
  agentId: string;
  runId?: string;
  kind: PageDraftKind;
  /** kind product: the product the page is for. */
  productId?: string;
  title: string;
  /** Page body HTML written by the agent: render sandboxed / sanitized. */
  html: string;
  seoTitle?: string;
  seoDescription?: string;
  /** Change list: what changed and why, with the numbers. */
  notes: string;
  status: PageDraftStatus;
  /** The latest publish request for this draft. */
  approvalId?: string;
  createdAt: string;
  publishedAt?: string;
}

/**
 * An owner-approved learning shared by every store of a niche (shown in their agents' prompts).
 * GET /api/niche-learnings?niche= → NicheLearning[] newest first; DELETE /api/niche-learnings/:id → 204.
 */
export interface NicheLearning {
  id: string;
  /** The store niche, or `other:<slug of nicheDetail>` for custom niches. */
  niche: string;
  text: string;
  evidence?: string;
  /** The store it was learned in. */
  storeId?: string;
  createdAt: string;
}

/**
 * POST /api/agents/:id/runs → 201 AgentRun (409 when the agent is offline, the store's AI budget is spent, or
 * resumeRunId isn't this agent's). GET /api/runs?stores=&agent=&limit= → AgentRun[] newest first.
 * GET /api/runs/:id → AgentRunDetail (live transcript while running). POST /api/runs/:id/cancel → AgentRun.
 * Live updates arrive on /api/live as `run` / `run_event`.
 */
export interface StartRunInput {
  task: string;
  /** Continue that run's conversation (chat follow-up). */
  resumeRunId?: string;
}

/**
 * GET /api/stores/:id/memory?q= → StoreMemory[] newest first. POST /api/stores/:id/memory → 201 StoreMemory
 * (owner-written, agentId 'owner'). PATCH /api/memory/:id with any subset → StoreMemory. DELETE /api/memory/:id → 204.
 */
export interface MemoryInput {
  kind: MemoryKind;
  /** 5–300 chars, one sentence. */
  text: string;
  evidence?: string;
  /** 0–1, default 0.8 for owner-written. */
  confidence?: number;
  tags?: string[];
  /** PATCH only: pin/unpin. */
  pinned?: boolean;
}

/** A run with its transcript (consecutive text deltas merged into one). */
export interface AgentRunDetail extends AgentRun {
  transcript: AgentEvent[];
}

export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** Normalized stream event of one agent run, the same for the fake and the Claude engine. Every run ends with exactly one `done` or `error`. */
export type AgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; output: string; isError: boolean }
  | { type: 'approval_request'; approval: ApprovalRequest }
  | { type: 'memory_written'; memory: StoreMemory }
  /** `sessionId` continues the conversation when passed back as `resume`. */
  | { type: 'done'; sessionId: string; usage: RunUsage }
  | { type: 'error'; message: string };

// ---------------------------------------------------------------------------------------------------------------------
// Integrations (core lane). Secret values never leave the server; the API only says which secret fields are set.

export type IntegrationKind = 'shopify' | 'tiktok_shop' | 'etsy' | 'amazon' | 'woocommerce' | 'meta_ads' | 'google_ads' | 'tiktok_ads' | 'ga4' | 'cj' | 'higgsfield';

export type IntegrationCategory = 'platform' | 'ads' | 'analytics' | 'supplier' | 'creative';

export interface IntegrationField {
  key: string;
  label: string;
  /** Secret fields are encrypted at rest and never returned by the API. */
  secret: boolean;
  placeholder?: string;
  /** Filled by the Connect button (OAuth); the owner can still paste it. Leave it out of POST /api/integrations/oauth/start. */
  oauth?: boolean;
  /** May stay empty when saving; Connect may still need it. */
  optional?: boolean;
}

/**
 * POST /api/integrations/oauth/start { kind, storeId?, values } → OAuthStart, where `values` are the fields without
 * `oauth`. Open `url` in the browser. finish 'loopback': the browser comes back to the API, which saves the integration
 * (poll GET /api/integrations). finish 'paste': the browser lands on `redirectUri` (a page that won't load), and the owner
 * pastes that full address into POST /api/integrations/oauth/finish { url } → Integration (400 { error } otherwise).
 * GET /api/integrations/oauth → IntegrationKind[] that support Connect.
 */
export interface OAuthStart {
  url: string;
  finish: 'loopback' | 'paste';
  redirectUri: string;
}

/** Catalog for the Integrations screen: every field listed is required. `perStore` = connected per store (else global). */
export const INTEGRATION_KINDS: Record<IntegrationKind, { name: string; category: IntegrationCategory; perStore: boolean; fields: IntegrationField[]; /** Setup steps shown next to the form. */ help?: string }> = {
  shopify: { name: 'Shopify', category: 'platform', perStore: true, help: 'Shopify admin → Settings → Apps and sales channels → Develop apps → Build apps in Dev Dashboard → Create app → new version with Admin API scopes read_products, read_inventory, read_orders, read_all_orders (plus write_products and write_online_store_pages if agents may add products, change prices and publish pages you approve, and read_themes and write_themes if the Store Developer may edit a copy of your theme) → Release → Install on your store → Settings: copy the client ID and secret. The app must be in the same organization as the store. Already have a custom app made before 2026? Paste its Admin API access token instead.', fields: [
    { key: 'shopDomain', label: 'Shop domain', secret: false, placeholder: 'your-store.myshopify.com' },
    { key: 'clientId', label: 'Client ID', secret: false, optional: true },
    { key: 'clientSecret', label: 'Client secret', secret: true, optional: true },
    { key: 'accessToken', label: 'Admin API access token (older custom apps)', secret: true, placeholder: 'shpat_…', optional: true },
  ] },
  tiktok_shop: { name: 'TikTok Shop', category: 'platform', perStore: true, help: 'TikTok Shop Partner Center → App & Service → create a custom app with Order and Product read scopes, and set its redirect URL to https://localhost/frontline-oauth → copy the App key, App secret and the authorization link. Press Connect, approve your shop, then paste the address the browser lands on (the page itself will not load).', fields: [
    { key: 'appKey', label: 'App key', secret: false },
    { key: 'appSecret', label: 'App secret', secret: true },
    { key: 'authLink', label: 'Authorization link', secret: false, optional: true, placeholder: 'https://services.tiktokshop.com/open/authorize?service_id=…' },
    { key: 'accessToken', label: 'Access token', secret: true, oauth: true },
    { key: 'refreshToken', label: 'Refresh token', secret: true, oauth: true },
  ] },
  etsy: { name: 'Etsy', category: 'platform', perStore: true, help: 'etsy.com/developers → Create a new app → copy the keystring and shared secret, and add https://localhost/frontline-oauth as a callback URL. Enter them with your shop ID, press Connect, approve in the browser, then paste the address the browser lands on (the page itself will not load). The app renews the access token itself (it lasts an hour).', fields: [
    { key: 'shopId', label: 'Shop ID', secret: false },
    { key: 'apiKey', label: 'API keystring', secret: true },
    { key: 'sharedSecret', label: 'Shared secret', secret: true },
    { key: 'accessToken', label: 'OAuth access token', secret: true, oauth: true },
    { key: 'refreshToken', label: 'OAuth refresh token', secret: true, oauth: true },
  ] },
  amazon: { name: 'Amazon SP-API', category: 'platform', perStore: true, help: 'Seller Central → Apps and Services → Develop Apps → add a private app with the Selling Partner Insights role → copy the LWA client ID and secret → Authorize app → copy the refresh token. Region: na (US, CA, MX, BR), eu (Europe, UK, India, Middle East) or fe (Japan, Australia, Singapore). Marketplace ID, e.g. ATVPDKIKX0DER for amazon.com. Daily sales and order counts only for now.', fields: [
    { key: 'sellerId', label: 'Seller ID', secret: false },
    { key: 'region', label: 'Region', secret: false, placeholder: 'na | eu | fe' },
    { key: 'marketplaceId', label: 'Marketplace ID', secret: false, placeholder: 'ATVPDKIKX0DER' },
    { key: 'clientId', label: 'LWA client ID', secret: false },
    { key: 'clientSecret', label: 'LWA client secret', secret: true },
    { key: 'refreshToken', label: 'Refresh token', secret: true },
  ] },
  woocommerce: { name: 'WooCommerce', category: 'platform', perStore: true, help: 'WordPress admin → WooCommerce → Settings → Advanced → REST API → Add key → Permissions: Read → copy the consumer key and secret (shown once). The site must use https and pretty permalinks (not Plain).', fields: [
    { key: 'siteUrl', label: 'Site URL', secret: false, placeholder: 'https://yourstore.com' },
    { key: 'consumerKey', label: 'Consumer key', secret: true, placeholder: 'ck_…' },
    { key: 'consumerSecret', label: 'Consumer secret', secret: true, placeholder: 'cs_…' },
  ] },
  meta_ads: { name: 'Meta Ads', category: 'ads', perStore: true, help: 'Meta Business Settings → Users → System users → Add (Admin) → Assign assets: the ad account (view performance) → Generate new token with ads_read and ads_mcp_management (agents read through the Meta ads MCP), plus ads_management if agents may make changes you approve → copy it. Ad account ID is in Ads Manager (act_…).', fields: [
    { key: 'adAccountId', label: 'Ad account ID', secret: false, placeholder: 'act_…' },
    { key: 'accessToken', label: 'System user access token', secret: true },
  ] },
  google_ads: { name: 'Google Ads', category: 'ads', perStore: true, help: 'Google Ads → Tools → API Center: apply for a developer token. Google Cloud console → enable the Google Ads API → Credentials → OAuth client ID (Desktop app) → client ID + secret. Enter them and press Connect, then sign in with a Google account that has direct access to the ad account. Customer ID is top right in Google Ads.', fields: [
    { key: 'customerId', label: 'Customer ID', secret: false, placeholder: '123-456-7890' },
    { key: 'clientId', label: 'OAuth client ID', secret: false },
    { key: 'clientSecret', label: 'OAuth client secret', secret: true },
    { key: 'developerToken', label: 'Developer token', secret: true },
    { key: 'refreshToken', label: 'Refresh token', secret: true, oauth: true },
  ] },
  tiktok_ads: { name: 'TikTok Ads', category: 'ads', perStore: true, help: 'TikTok API for Business (business-api.tiktok.com) → My apps → create a developer app with Ads Management and Reporting read scopes → authorize it for your ad account → copy the long-lived access token. Advertiser ID is in TikTok Ads Manager next to the account name.', fields: [
    { key: 'advertiserId', label: 'Advertiser ID', secret: false },
    { key: 'accessToken', label: 'Access token', secret: true },
  ] },
  ga4: { name: 'Google Analytics 4', category: 'analytics', perStore: true, help: 'Google Cloud console → enable the Google Analytics Data API → IAM → Service accounts → Create → Keys → Add key (JSON) → paste the whole file. Then GA4 Admin → Property access management → add the service account email as Viewer. Property ID is in GA4 Admin → Property details.', fields: [
    { key: 'propertyId', label: 'Property ID', secret: false },
    { key: 'serviceAccountJson', label: 'Service account JSON', secret: true },
  ] },
  cj: { name: 'CJ Dropshipping', category: 'supplier', perStore: false, help: 'CJ Dropshipping → My CJ → Authorization → API → generate an API key. Read-only for now: order status and tracking for orders your stores send to CJ.', fields: [
    { key: 'email', label: 'Account email', secret: false },
    { key: 'apiKey', label: 'API key', secret: true },
  ] },
  higgsfield: { name: 'Higgsfield AI', category: 'creative', perStore: false, help: 'console.higgsfield.ai → API keys → Create key → copy the key ID and the secret (shown once). Generations spend your Higgsfield credits, capped per store per day in Settings.', fields: [
    { key: 'keyId', label: 'Key ID', secret: false },
    { key: 'keySecret', label: 'Key secret', secret: true },
  ] },
};

export type IntegrationStatus = 'connected' | 'error';

/**
 * GET /api/backups → Backup[] (newest first); POST /api/backups → Backup (201). The API keeps a daily snapshot of its
 * database in <data dir>/backups (the newest 7).
 * POST /api/backups/:name/restore → 202 { restarting: true }: the current data is backed up first (undo), then the API
 * restarts on the snapshot (the desktop app does this by itself; wait for /api/health, then reload). 404 unknown
 * name, 400 { error } for a damaged snapshot or one from a newer app version.
 */
export interface Backup {
  name: string;
  /** Bytes. */
  size: number;
  createdAt: string;
}

export type ActionKind = 'ad_budget' | 'ad_pause' | 'product_create' | 'price_change' | 'product_page_publish' | 'page_publish' | 'theme_duplicate' | 'theme_files' | 'theme_publish';

/**
 * GET /api/actions?stores=&limit= → ActionLogEntry[], newest first (limit default 50, max 200). Every write to a live
 * store or ad account is recorded here with its outcome, whoever triggered it (approval, autopilot, automation).
 */
export interface ActionLogEntry {
  id: number;
  storeId: string;
  action: ActionKind;
  /** What it touched: "meta:<campaign id>", a product id, a page title. */
  target: string;
  /** The change, e.g. { dailyBudget: 40 } or { price: 19.9 }. */
  detail: Record<string, unknown>;
  ok: boolean;
  error?: string;
  at: string;
}

/** GET /api/health → Health. `ok` means the API is up; connector problems are listed here, not fatal. */
export interface Health {
  ok: true;
  uptimeSec: number;
  connectors: { id: string; kind: IntegrationKind; storeId?: string; status: IntegrationStatus; error?: string; syncedAt?: string }[];
}

/** GET /api/integrations?stores=a,b → Integration[] (global ones always included). */
export interface Integration {
  id: string;
  kind: IntegrationKind;
  /** Absent for global integrations. */
  storeId?: string;
  status: IntegrationStatus;
  /** Last connector error, when status = 'error'. */
  error?: string;
  /** Non-secret field values, e.g. { shopDomain }. */
  settings: Record<string, string>;
  /** Keys of secret fields that are stored. Values are never returned. */
  secretsSet: string[];
  updatedAt: string;
  /** Last successful sync (connectors that sync data). */
  syncedAt?: string;
}

/**
 * PUT /api/integrations body → the saved Integration. One integration per (kind, store); saving again updates it.
 * When updating, omitted secret fields keep their stored value.
 */
export interface IntegrationInput {
  kind: IntegrationKind;
  storeId?: string;
  values: Record<string, string>;
}

// ---------------------------------------------------------------------------------------------------------------------
// Products & orders (core lane).

/** One page of a list endpoint. `?offset=&limit=` (default limit 50, max 200). */
export interface Page<T> {
  items: T[];
  /** Total matching rows across all pages. */
  total: number;
  offset: number;
  limit: number;
}

export type ProductStatus = 'active' | 'draft' | 'archived';

/** GET /api/products?stores=&q=&status=&sort=title|price|inventory|margin&dir=asc|desc → Page<Product>. */
export interface Product {
  id: string;
  storeId: string;
  title: string;
  image?: string;
  price: number;
  compareAt?: number;
  /** Unit cost incl. shipping. */
  cost: number;
  inventory: number;
  status: ProductStatus;
  /** (price - cost) / price × 100. */
  margin: number;
}

export type OrderStatus = 'paid' | 'refunded';
export type FulfillmentStatus = 'unfulfilled' | 'fulfilled' | 'in_transit' | 'delivered';

/** GET /api/orders?stores=&q=&status=&fulfillment=&sort=createdAt|total&dir=asc|desc → Page<Order>. Key = storeId + id. */
export interface Order {
  /** Platform order number, e.g. "#1042" (unique per store). */
  id: string;
  storeId: string;
  createdAt: string;
  total: number;
  status: OrderStatus;
  fulfillmentStatus: FulfillmentStatus;
  supplier?: string;
  tracking?: string;
}

// ---------------------------------------------------------------------------------------------------------------------
// Product research (core lane).

export type ResearchSource = 'tiktok' | 'shopify' | 'amazon' | 'aliexpress';

/** Product Research tabs (My Lists uses the lists endpoints). */
export type ResearchTab = 'trending' | 'high_margin' | 'low_competition' | 'tiktok_viral' | 'shopify_winners';
export const RESEARCH_TABS: ResearchTab[] = ['trending', 'high_margin', 'low_competition', 'tiktok_viral', 'shopify_winners'];

/** GET /api/research?tab=&niche=&q=&offset=&limit= → Page<ResearchProduct> (no tab = best AI score first). GET /api/research/:id. */
export interface ResearchProduct {
  id: string;
  title: string;
  /** Display category, e.g. "Health & Beauty". */
  category: string;
  niche: Niche;
  image?: string;
  source: ResearchSource;
  /** Supplier cost incl. shipping. */
  cost: number;
  /** Suggested sell price. */
  price: number;
  compareAt: number;
  /** (price - cost) / price × 100. */
  margin: number;
  /** Demand growth over the last 30 days, %. */
  trend: number;
  /** 0–100, lower = fewer competing sellers/ads. */
  competition: number;
  shippingDays: number;
  /** AI Score 0–100 = 35% margin + 25% trend + 25% low competition + 15% fast shipping. */
  score: number;
  /** Each factor scored 0–100, for the details view. */
  scoreParts: { margin: number; trend: number; competition: number; shipping: number };
}

/**
 * Saved research lists. GET /api/research/lists → ProductList[]; POST /api/research/lists { name } → ProductList;
 * DELETE /api/research/lists/:id; PUT|DELETE /api/research/lists/:id/items/:productId → ProductList.
 */
export interface ProductList {
  id: string;
  name: string;
  productIds: string[];
  createdAt: string;
}

/** POST /api/research/:id/add-to-store body → 201 ApprovalRequest for that store's Product Hunter. */
export interface AddToStoreInput {
  storeId: string;
}

// ---------------------------------------------------------------------------------------------------------------------
// Settings, budget caps, notifications (core lane).

/** GET /api/settings → Settings; PATCH /api/settings with any subset (nested objects merge) → Settings. */
export interface Settings {
  profile: { name: string; plan: string };
  /** UI sound effects (mission sting, XP). Off by default. */
  sound: boolean;
  /** Which events create notifications. */
  notifications: { approvals: boolean; agentDone: boolean; errors: boolean };
  /** ISO code that multi-store totals are converted to (default USD). */
  baseCurrency: string;
  /** Read-only: where the local database and key live. */
  dataDir: string;
}

export type SettingsUpdate = { profile?: Partial<Settings['profile']>; sound?: boolean; notifications?: Partial<Settings['notifications']>; baseCurrency?: string };

/**
 * Per-store hard caps the agents must respect. GET /api/caps?stores= → StoreCaps[] (defaults until saved);
 * PUT /api/caps/:storeId with any subset → StoreCaps.
 */
export interface StoreCaps {
  storeId: string;
  /** Max USD/day of ad budget agents may add or move. */
  adSpendChangePerDay: number;
  /** Max Higgsfield credits/day for creative generation. */
  higgsfieldCreditsPerDay: number;
  /** Max USD/day of AI usage for this store's agents. */
  agentCostPerDay: number;
  /** Autopilot per action kind (e.g. 'ads.pause_adsets'): auto-approve within maxUsdPerDay. Absent = ask. */
  autopilot: Record<string, { enabled: boolean; maxUsdPerDay: number }>;
}

export type StoreCapsUpdate = Partial<Omit<StoreCaps, 'storeId'>>;

/** Today's usage (since local midnight) against the store's caps: the same counters that block a run, a render or a budget change. */
export interface StoreUsage {
  storeId: string;
  agentCostUsd: number;
  credits: number;
  /** Daily ad budget added by approved or pending budget changes. */
  adBudgetAddedUsd: number;
}

export type NotificationKind = 'approval' | 'agent_done' | 'error' | 'info';

/** GET /api/notifications?unread=true&limit= → AppNotification[] newest first. POST /api/notifications/read { ids? } (no ids = all) → { updated }. */
export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  storeId?: string;
  /** In-app route to open, e.g. "/agents/glow:market_analyst". */
  link?: string;
  createdAt: string;
  readAt?: string;
}

/** What server code passes to notify(). */
export type NewNotification = Omit<AppNotification, 'id' | 'createdAt' | 'readAt'>;

// ---------------------------------------------------------------------------------------------------------------------
// Competitor intel (core lane).

/** GET /api/competitors?stores= → Competitor[]; POST /api/competitors (CompetitorInput) → Competitor; DELETE /api/competitors/:id. */
export interface Competitor {
  id: string;
  storeId: string;
  name: string;
  url: string;
  notes?: string;
  createdAt: string;
  /** Distinct products with price snapshots. */
  productsTracked: number;
  /** Ads seen in the last 3 days. */
  activeAds: number;
}

export interface CompetitorInput {
  storeId: string;
  name: string;
  url: string;
  notes?: string;
}

export interface PriceSnapshotData {
  product: string;
  price: number;
  compareAt?: number;
}

export interface AdSnapshotData {
  network: 'meta' | 'tiktok' | 'google';
  format: 'image' | 'video' | 'carousel';
  headline: string;
  body: string;
  cta?: string;
  /** YYYY-MM-DD. */
  firstSeen: string;
  lastSeen: string;
  landingUrl?: string;
}

/**
 * GET /api/competitors/:id/snapshots?kind=price|ad&limit= → CompetitorSnapshot[] newest first.
 * POST /api/competitors/:id/snapshots { kind, data } → CompetitorSnapshot (agents and scrapers record what they see).
 */
export type CompetitorSnapshot = { id: string; competitorId: string; capturedAt: string } & (
  | { kind: 'price'; data: PriceSnapshotData }
  | { kind: 'ad'; data: AdSnapshotData }
);

/** GET /api/competitors/price-changes?stores=&limit= → PriceChange[] newest first (derived from consecutive price snapshots). */
export interface PriceChange {
  competitorId: string;
  storeId: string;
  product: string;
  from: number;
  to: number;
  /** (to - from) / from × 100. */
  changePct: number;
  at: string;
}

// ---------------------------------------------------------------------------------------------------------------------
// Automation (core lane). Rules: trigger → agent task, with an approval policy and a daily cap.

export type AutomationTrigger =
  /** 5-field cron in the owner's local time, e.g. "0 9 * * *" = every day 09:00. */
  | { type: 'schedule'; cron: string }
  /** Fires when the store's metric over the last `windowDays` crosses `value` (checked every 15 min, then `cooldownHours`). */
  | { type: 'metric'; metric: keyof MetricTotals; op: '<' | '>'; value: number; windowDays: number };

export interface AutomationAction {
  type: 'agent_task';
  /** `<storeId>:<role>`, must belong to the rule's store. */
  agentId: string;
  task: string;
}

/**
 * GET /api/automations?stores= → AutomationRule[]; POST /api/automations (AutomationRuleInput) → AutomationRule;
 * PATCH /api/automations/:id (any subset) → AutomationRule; DELETE /api/automations/:id.
 */
export interface AutomationRule {
  id: string;
  storeId: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  action: AutomationAction;
  /** 'auto' starts the agent right away; 'ask' creates an approval request first. */
  approval: 'auto' | 'ask';
  /** Hard cap on fires per local day. */
  maxRunsPerDay: number;
  /** Metric rules: minimum hours between fires. */
  cooldownHours: number;
  createdAt: string;
  lastFiredAt?: string;
  /** Schedule rules: next fire time (ISO), when within 8 days. */
  nextRunAt?: string;
}

export interface AutomationRuleInput {
  storeId: string;
  name: string;
  trigger: AutomationTrigger;
  action: AutomationAction;
  /** Default true. */
  enabled?: boolean;
  /** Default 'ask'. */
  approval?: 'auto' | 'ask';
  /** Default 3. */
  maxRunsPerDay?: number;
  /** Default 24. */
  cooldownHours?: number;
}

export type AutomationRunStatus = 'started' | 'awaiting_approval' | 'denied' | 'skipped' | 'failed';

/** GET /api/automations/runs?stores=&rule=&limit= → AutomationRun[] newest first (the run log). */
export interface AutomationRun {
  id: string;
  ruleId: string;
  storeId: string;
  firedAt: string;
  status: AutomationRunStatus;
  /** Why it fired / was skipped / failed. */
  detail?: string;
  /** Agent run started by this fire. */
  runId?: string;
  approvalId?: string;
}
