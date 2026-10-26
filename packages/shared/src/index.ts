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
  previous: MetricTotals;
  deltas: MetricDeltas;
  /** One point per day, oldest first (UI buckets 1Y into weeks). */
  series: MetricPoint[];
  byStore: { storeId: string; totals: MetricTotals; deltas: MetricDeltas }[];
}

/** POST /api/stores body. Response: the created Store. */
export interface StoreInput {
  name: string;
  platform: Platform;
  niche: Niche;
  nicheDetail?: string;
  /** Default 'USD'. */
  currency?: string;
  /** Default 'America/Chicago'. */
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
}

/** Catalog for the Integrations screen: every field listed is required. `perStore` = connected per store (else global). */
export const INTEGRATION_KINDS: Record<IntegrationKind, { name: string; category: IntegrationCategory; perStore: boolean; fields: IntegrationField[]; /** Setup steps shown next to the form. */ help?: string }> = {
  shopify: { name: 'Shopify', category: 'platform', perStore: true, help: 'Shopify admin → Settings → Apps and sales channels → Develop apps → Create an app → Configure Admin API scopes: read_products, read_inventory, read_orders, read_all_orders (plus write_products if agents may add draft products you approve) → Install app → copy the Admin API access token (shown once).', fields: [
    { key: 'shopDomain', label: 'Shop domain', secret: false, placeholder: 'your-store.myshopify.com' },
    { key: 'accessToken', label: 'Admin API access token', secret: true, placeholder: 'shpat_…' },
  ] },
  tiktok_shop: { name: 'TikTok Shop', category: 'platform', perStore: true, fields: [
    { key: 'appKey', label: 'App key', secret: false },
    { key: 'appSecret', label: 'App secret', secret: true },
    { key: 'accessToken', label: 'Access token', secret: true },
  ] },
  etsy: { name: 'Etsy', category: 'platform', perStore: true, fields: [
    { key: 'shopId', label: 'Shop ID', secret: false },
    { key: 'apiKey', label: 'API keystring', secret: true },
    { key: 'accessToken', label: 'OAuth access token', secret: true },
  ] },
  amazon: { name: 'Amazon SP-API', category: 'platform', perStore: true, fields: [
    { key: 'sellerId', label: 'Seller ID', secret: false },
    { key: 'region', label: 'Region', secret: false, placeholder: 'na | eu | fe' },
    { key: 'clientId', label: 'LWA client ID', secret: false },
    { key: 'clientSecret', label: 'LWA client secret', secret: true },
    { key: 'refreshToken', label: 'Refresh token', secret: true },
  ] },
  woocommerce: { name: 'WooCommerce', category: 'platform', perStore: true, fields: [
    { key: 'siteUrl', label: 'Site URL', secret: false, placeholder: 'https://yourstore.com' },
    { key: 'consumerKey', label: 'Consumer key', secret: true, placeholder: 'ck_…' },
    { key: 'consumerSecret', label: 'Consumer secret', secret: true, placeholder: 'cs_…' },
  ] },
  meta_ads: { name: 'Meta Ads', category: 'ads', perStore: true, help: 'Meta Business Settings → Users → System users → Add (Admin) → Assign assets: the ad account (view performance) → Generate new token with ads_read and ads_mcp_management (agents read through the Meta ads MCP), plus ads_management if agents may make changes you approve → copy it. Ad account ID is in Ads Manager (act_…).', fields: [
    { key: 'adAccountId', label: 'Ad account ID', secret: false, placeholder: 'act_…' },
    { key: 'accessToken', label: 'System user access token', secret: true },
  ] },
  google_ads: { name: 'Google Ads', category: 'ads', perStore: true, fields: [
    { key: 'customerId', label: 'Customer ID', secret: false, placeholder: '123-456-7890' },
    { key: 'clientId', label: 'OAuth client ID', secret: false },
    { key: 'clientSecret', label: 'OAuth client secret', secret: true },
    { key: 'developerToken', label: 'Developer token', secret: true },
    { key: 'refreshToken', label: 'Refresh token', secret: true },
  ] },
  tiktok_ads: { name: 'TikTok Ads', category: 'ads', perStore: true, fields: [
    { key: 'advertiserId', label: 'Advertiser ID', secret: false },
    { key: 'accessToken', label: 'Access token', secret: true },
  ] },
  ga4: { name: 'Google Analytics 4', category: 'analytics', perStore: true, fields: [
    { key: 'propertyId', label: 'Property ID', secret: false },
    { key: 'serviceAccountJson', label: 'Service account JSON', secret: true },
  ] },
  cj: { name: 'CJ Dropshipping', category: 'supplier', perStore: false, fields: [
    { key: 'email', label: 'Account email', secret: false },
    { key: 'apiKey', label: 'API key', secret: true },
  ] },
  higgsfield: { name: 'Higgsfield AI', category: 'creative', perStore: false, help: 'console.higgsfield.ai → API keys → Create key → copy the key ID and the secret (shown once). Generations spend your Higgsfield credits, capped per store per day in Settings.', fields: [
    { key: 'keyId', label: 'Key ID', secret: false },
    { key: 'keySecret', label: 'Key secret', secret: true },
  ] },
};

export type IntegrationStatus = 'connected' | 'error';

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
  /** Read-only: where the local database and key live. */
  dataDir: string;
}

export type SettingsUpdate = { profile?: Partial<Settings['profile']>; sound?: boolean; notifications?: Partial<Settings['notifications']> };

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
