// Domain types and API contracts shared by apps/web, apps/server and packages/agents.
// Additive changes only: never rename or remove a field another lane already uses.

export type Platform = 'shopify' | 'tiktok_shop' | 'etsy' | 'amazon' | 'woocommerce' | 'walmart';

/**
 * Platforms whose connected stores the app adds products to and reprices (approved store.add_products / store.set_price:
 * core's Shopify createProducts / setProductPrice, WooCommerce createWooProducts / setWooProductPrice). Pages and themes
 * are Shopify only. A demo store takes them anywhere as local drafts.
 */
export const PRODUCT_WRITE_PLATFORMS: readonly Platform[] = ['shopify', 'woocommerce'];
/** Platforms whose live prices an approved `store.set_price` can change. */
export const PRICE_WRITE_PLATFORMS: readonly Platform[] = ['shopify', 'woocommerce', 'etsy', 'amazon', 'tiktok_shop'];
/** Platforms whose live product title and description an approved Store Builder product draft can replace. */
export const PRODUCT_PAGE_PLATFORMS: readonly Platform[] = ['shopify', 'woocommerce', 'etsy'];
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
  /**
   * The owner's estimate of platform + payment fees as a % of revenue (e.g. 9.5 on Etsy: 6.5% transaction + 3%
   * processing), subtracted from profit. Omitted = 0.
   */
  feePercent?: number;
  /** Fixed fee per order in the store's currency (e.g. 0.25 on Etsy, 0.30 with Shopify Payments). Omitted = 0. */
  feePerOrder?: number;
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
  product_hunter: { name: 'Product Researcher', blurb: 'Finds winning products from trend data, competitor analysis and market research.' },
  store_developer: { name: 'Store Developer', blurb: 'Builds and optimizes the storefront: theme, pages, CRO and custom features.' },
  creative_studio: { name: 'Creative Strategist', blurb: 'Generates high-converting ads with Higgsfield AI: image, video and UGC.' },
  market_analyst: { name: 'Analytics Specialist', blurb: 'Analyzes competitors, market trends and niche opportunities.' },
  copywriter: { name: 'Copywriter', blurb: 'Writes ad copy, product descriptions and landing pages that convert.' },
  email_sms: { name: 'Email & SMS', blurb: 'Creates automated email and SMS flows, campaigns and retention strategies.' },
  operations: { name: 'Operations', blurb: 'Handles orders, fulfillment, suppliers, customer service and automation.' },
};

export type AgentStatus = 'idle' | 'running' | 'waiting_approval' | 'error' | 'offline';

/** suggest = recommends only; ask = side effects need approval; autopilot = auto-approved within caps (logged). */
export type Autonomy = 'suggest' | 'ask' | 'autopilot';
export const AUTONOMY_LEVELS: Autonomy[] = ['suggest', 'ask', 'autopilot'];

/** One agent = one role working for one store. Every store has its own squad. */
/** GET /api/claude-account: whether Claude Code is signed in on this machine, the login live stores' agents run on. */
export interface ClaudeAccount {
  signedIn: boolean;
  email?: string;
  /** Claude Code's name for the plan, e.g. "Claude Max". */
  subscription?: string;
  /** When it was asked (answers are kept 5 minutes; `?refresh=1` asks again). */
  checkedAt: string;
  /** Why it couldn't be asked (then `signedIn` is false). */
  error?: string;
  /** What the login can run, from the same handshake (decision 9). */
  models?: RuntimeModel[];
}

export interface Agent {
  id: string;
  storeId: string;
  role: AgentRole;
  status: AgentStatus;
  currentTask?: string;
  /** Always set by the API. Disabled agents show as `offline`; "Deploy Agent" enables one. */
  enabled?: boolean;
  /** Always set by the API. */
  autonomy?: Autonomy;
  /** The agent's own daily AI budget, USD, inside the store's. Absent: only the store's cap applies. */
  dailyBudgetUsd?: number;
  /** What its runs spent today (since local midnight), USD: the sum `dailyBudgetUsd` is checked against. Always set by the API. */
  costTodayUsd?: number;
  /**
   * What its runs run on. Always set by the API. `claude`: the owner's Claude Code login with this model (live stores);
   * `demo`: the free scripted engine (demo stores, so exploring never spends Claude usage).
   */
  engine?: { provider: 'claude' | 'demo'; model?: string };
}

/** GET /api/agents?stores=a,b → Agent[] (squads in store order, roles in AGENT_ROLES order). GET /api/agents/:id → Agent. */
export type AgentsResponse = Agent[];

/** PATCH /api/agents/:id body. Response: the updated Agent. */
export interface AgentUpdate {
  enabled?: boolean;
  autonomy?: Autonomy;
  /** USD per day; null removes the agent's own cap. */
  dailyBudgetUsd?: number | null;
}

export interface DailyMetrics {
  storeId: string;
  /** YYYY-MM-DD in the store's timezone. */
  date: string;
  revenue: number;
  adSpend: number;
  /** Cost of goods + shipping + fees + the sales tax/VAT in the orders' totals. Profit = revenue - cogs - adSpend. */
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
  'kb.research': { label: 'Start research' },
  'kb.promote': { label: 'Promote knowledge to General' },
  tool_use: { label: 'Use a connected tool' },
  // Waits that act on nothing outside the app (decisions 5 and 11): a question is answered, never approved or denied.
  question: { label: 'Answer a question' },
  'kb.save': { label: 'Save a finding' },
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
  /**
   * The owner's reason for a denial, e.g. "too expensive": POST /api/approvals/:id/deny takes an optional JSON body
   * { note?: string } (1-300 characters, trimmed; 400 otherwise). Approve takes no body. For a `question`, the owner's
   * answer (POST /api/approvals/:id/answer?store= { text }).
   */
  decisionNote?: string;
  /** The conversation of the run that asked, where a `question` is answered. */
  conversationId?: string;
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
  /** `previous` like the top-level one: all zero for a store with nothing in the previous period (its deltas are then 0). */
  byStore: { storeId: string; totals: MetricTotals; previous: MetricTotals; deltas: MetricDeltas }[];
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
  /**
   * Revenue and orders over the period per sales platform, biggest first, in `currency` (same stores and days as
   * `totals`, which they add up to): a channel next to a store's own platform (TikTok Shop or Amazon next to a Shopify)
   * is split out of that store's. One entry when every store sells on one platform. Set by /api/analytics/summary.
   */
  byPlatform?: { platform: Platform; revenue: number; orders: number }[];
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
  /** Revenue minus product cost and the store's fee % (ad spend and the per-order fee are not allocated per product). */
  profit: number;
  /** The product's stock as on Products (absent for a product no longer in the catalog). */
  inventory?: number;
  inventoryTracked?: boolean;
  status?: ProductStatus;
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
  /**
   * The owner's estimate of platform + payment fees as a % of revenue (e.g. 9.5 on Etsy: 6.5% transaction + 3%
   * processing), subtracted from profit. Default 0.
   */
  feePercent?: number;
  /** Fixed fee per order in the store's currency (e.g. 0.25 on Etsy, 0.30 with Shopify Payments). Default 0. */
  feePerOrder?: number;
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
  /** A squad mission was created, started a step, got a step's deliverable or ended (agents lane). */
  | { type: 'mission'; mission: SquadMission }
  /** A knowledge-base research task started, moved a stage, waits to retry, or ended (knowledge-base lane). */
  | { type: 'kb_task'; task: KbTaskBrief };

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
  /** What the ad is, as its maker described it (KB-20): what ads are compared by. e.g. ugc, demo, testimonial, static. */
  format?: string;
  /** Its opening, as a short label: problem-first, question, social proof. */
  hook?: string;
  angle?: string;
  /** Video length in seconds. */
  lengthS?: number;
  /** e.g. 20% off, free shipping. */
  offer?: string;
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
  /** `research:<kb task id>`: a stage of a knowledge-base research task (KB-12), which reports as the task. */
  mode?: string;
  /** The conversation this run is a turn of. Runs from before conversations, and scheduled or module jobs, have none. */
  conversationId?: string;
  /** A team session's step run (a kind-'team' squad mission): never part of a conversation. */
  teamId?: string;
  /** The agent_configs row it ran with (immutable), when it had one. */
  configId?: string;
  /** What was asked for. */
  runtime?: RuntimeId;
  model?: string;
  effort?: string;
  /** The Codex CLI version it ran on. */
  runtimeVersion?: string;
  /** What actually ran: the init message's model (Claude) or a reroute (Codex). */
  actualModel?: string;
  effortApplied?: string;
  /** Derived from status, error and its pending approvals (decision 5); the API fills it. */
  state?: RunState;
  /** The documents sent with its message. */
  attachments?: RunAttachment[];
  /** In a conversation's thread: the run this one retried or resumed (attempt history). */
  retryOf?: string;
}

/** An external (MCP) tool whose name reads as a read: get_, list_, search_ and the like. */
export const isReadOnly = (toolName: string) => toolName.startsWith('mcp__') && /^(get|list|search|read|fetch|describe|lookup|find)(_|$)/.test(toolName.split('__').at(-1) ?? '');

// ponytail: judged by name, like external tools (isReadOnly); anything that doesn't read like a read counts as acting.
const READS = /^(store_summary|compare_stores|metrics_timeseries|research_feed|squad_log|review_campaigns|WebSearch|WebFetch)$|^(list|search|read|fetch|get)_/;
/** A tool call that may have changed something (saved, proposed, assigned, asked the owner). */
export const hasEffects = (tool: string) => !READS.test(tool) && !isReadOnly(tool);

/** The interrupted run's error text: a run cut off by an app restart. */
export const INTERRUPTED = 'Interrupted by an app restart';

/** A run's state for the owner: the DB statuses plus approval and question waits and restart interruptions. */
export type RunState = 'queued' | 'running' | 'awaiting_approval' | 'waiting_for_input' | 'completed' | 'failed' | 'cancelled' | 'interrupted';

/** A conversation's state comes from its runs; `idle` only when it has none. */
export type ConversationState = RunState | 'idle';

/** `pending`: the action kinds of the run's pending approvals. */
export function runState(run: { status: RunStatus; error?: string }, pending: string[] = []): RunState {
  if (run.status === 'running') return pending.some((k) => k !== 'question') ? 'awaiting_approval' : pending.length ? 'waiting_for_input' : 'running';
  if (run.status === 'error') return run.error === INTERRUPTED ? 'interrupted' : 'failed';
  return ({ queued: 'queued', done: 'completed', cancelled: 'cancelled' } as const)[run.status];
}

/** `states`: the conversation's run states, newest first. A running run wins over a newer queued one. */
export function conversationState(states: RunState[]): ConversationState {
  return states.find((s) => s === 'running' || s === 'awaiting_approval' || s === 'waiting_for_input') ?? (states.includes('queued') ? 'queued' : (states[0] ?? 'idle'));
}

export type RuntimeId = 'claude' | 'codex' | 'demo';

export interface RuntimeModel {
  /** The resolved id runs record (never an alias). */
  id: string;
  label: string;
  description?: string;
  /** The effort ids this model takes, as its runtime names them; empty when it takes none. */
  efforts: string[];
  defaultEffort?: string;
  /** The runtime's default model on this login. */
  default?: boolean;
  /** Discovery left this model's effort fields out, so `efforts` come from the app's registry. */
  effortsFromRegistry?: boolean;
}

/** GET /api/runtimes: what each runtime can run on this machine, checked without a model turn. */
export interface RuntimeCapabilities {
  runtime: RuntimeId;
  connected: boolean;
  /** Why it can't be used, as the action the owner takes: "Install the Codex CLI", "Set up Codex". */
  reason?: string;
  account?: string;
  models: RuntimeModel[];
  /** `registry`: discovery failed or left fields out, so the lists come from the app's registry (`registryVersion`). */
  source: 'discovered' | 'registry';
  registryVersion?: string;
  /** The installed CLI's version (Codex). */
  version?: string;
  checkedAt: string;
}

export type KnowledgeScope = 'store' | 'general';

/** Limits and switches of one configured agent. Empty budget or Stop after: no limit of its own. */
export interface AgentPermissions {
  /** USD for one run (Claude only). */
  budgetUsd?: number;
  /** Minutes before a run is stopped, not counting owner waits (required for Codex). */
  stopAfterMin?: number;
  /** save_finding: absent, asks the owner, or saves as Unreviewed. */
  saveFindings: 'off' | 'ask' | 'auto';
}

/**
 * A configured agent (agent_configs): never edited in place. A conversation points at one; "Change runtime or model"
 * writes a new one. Names and limits only, never credentials.
 */
export interface AgentConfig {
  id: string;
  storeId: string;
  /** The `store:role` seat: its autonomy and daily budget are the ceiling. */
  agentId: string;
  /** An agent_custom_roles id or a `builtin:` type. */
  customRoleId?: string;
  runtime: RuntimeId;
  model?: string;
  effort?: string;
  /** The run's tools: its type's tools minus switched-off drafts, compare_stores only when opted in. */
  tools: string[];
  knowledge: KnowledgeScope[];
  permissions: AgentPermissions;
  createdAt: string;
}

/** A custom role: a name and extra instructions on a built-in role's seat, tools and permissions (narrowing only). */
export interface CustomRole {
  id: string;
  /** Absent: every store. */
  storeId?: string;
  baseRole: AgentRole;
  name: string;
  description: string;
  instructions: string;
  /** Absent: the base role's tools. */
  tools?: string[];
  createdAt: string;
  archivedAt?: string;
}

/** A saved deploy configuration. The built-in "Default" preset of each type is defined in code and never stored. */
export interface AgentPreset {
  id: string;
  /** Absent: every store. */
  storeId?: string;
  name: string;
  config: {
    role: AgentRole;
    customRoleId?: string;
    runtime?: RuntimeId;
    model?: string;
    effort?: string;
    tools?: string[];
    knowledge?: KnowledgeScope[];
    permissions?: AgentPermissions;
    objective?: string;
  };
  builtin?: boolean;
  createdAt: string;
}

/** What a module opened the conversation about (decision 14), checked against the conversation's store. */
export type ConversationContext =
  | { kind: 'campaign'; network: string; id: string; name: string }
  /** Continue in a new conversation: the run it continues (its recap opens the first turn). */
  | { kind: 'run'; id: string; name: string };

/** A named thread with one agent type in one store. Its store never changes; its title can. */
export interface Conversation {
  id: string;
  storeId: string;
  configId: string;
  /** The seat (`store:role`) it runs on. */
  agentId: string;
  /** Its type: the config's custom role (a `builtin:` or saved one) when set, else the seat's role. */
  type: string;
  title: string;
  context?: ConversationContext;
  pinned: boolean;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  state: ConversationState;
  /** Set on a team's own conversation: listed under Teams, never in the type groups. */
  teamId?: string;
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
/** A page of a list read newest first: pass `next` back as `cursor` (`before` for a thread) for the next one. */
export interface CursorPage<T> {
  items: T[];
  next?: string;
  /** Rows matching the filters across all pages. */
  total: number;
}

/** What the Deploy dialog chose; anything left out is the seat default's (decision 9). Unknown keys are ignored. */
export interface ConversationConfigInput {
  runtime?: RuntimeId;
  model?: string;
  effort?: string;
  tools?: string[];
  knowledge?: KnowledgeScope[];
  permissions?: Partial<AgentPermissions>;
}

/**
 * Conversations (`?store=` required on each; another store's record is a 404):
 * - POST /api/conversations (CreateConversationInput) → 201 { conversation, run }, 200 for a repeated clientRequestId;
 *   400 { error, field } for a config that fails validation;
 * - GET /api/conversations?view=active|archived|pinned&type=&range=<days>&q=&cursor=&limit= → CursorPage<Conversation>,
 *   last activity first; `type` is a role, a custom role id or 'team';
 * - GET /api/conversations/:id → Conversation; GET /api/conversations/:id/thread?before=&limit= → CursorPage of its
 *   runs (AgentRunDetail), oldest first within the page, pages going back from the newest;
 * - PATCH /api/conversations/:id ({ title?, pinned?, archived? }) → Conversation;
 * - POST /api/conversations/:id/messages (SendMessageInput) → 201 AgentRun, queued behind a reply that is going;
 * - POST /api/conversations/:id/runs/:runId/retry and …/resume ({ clientRequestId }) → 201 AgentRun; resume only an
 *   interrupted run (409 otherwise);
 * - POST /api/conversations/:id/stop ({ runId? }) → AgentRun: the running reply, or that queued message.
 */
export interface CreateConversationInput {
  /** Made when the dialog or composer opens; a repeat returns what the first request made. */
  clientRequestId: string;
  /** The type: a role (its seat), or a `builtin:` or custom role id (its base role's seat). */
  type?: string;
  /** Continue in a new conversation from this run (with no conversation): its store and seat, never the UI's. */
  fromRunId?: string;
  /** The first message (the objective). */
  message: string;
  /** Defaults to the message's first line. */
  title?: string;
  /** A module's reference, checked against the store. */
  context?: ConversationContext;
  config?: ConversationConfigInput;
  /** Sent with the first message. */
  attachments?: AttachmentUpload[];
}

/**
 * POST /api/teams?store= (decision 12): the lead first. A participant runs on `config` (as Deploy's), or borrows
 * `fromConversationId`'s config and recap when `config` is left out. Teams: GET /api/teams/:id, POST …/cancel,
 * …/notes (TeamNoteInput), …/participants (TeamParticipantInput, until the lead has planned), and
 * …/steps/:step/resume ({ clientRequestId }) for an interrupted step. Each takes `?store=`.
 */
export interface CreateTeamInput {
  clientRequestId: string;
  title: string;
  objective: string;
  participants: TeamParticipantInput[];
  /** USD, counting Claude participants only. */
  budgetUsd?: number;
  /** Tasks at once, ≥ 1; kept to the store's limit of 2. Default 2. */
  maxConcurrent?: number;
  /** Retries per task, 0–2. Default 2. */
  retries?: number;
}

export interface TeamParticipantInput {
  type: string;
  config?: ConversationConfigInput;
  fromConversationId?: string;
}

/** "To: Lead" while the team runs: a note the synthesis receives. A repeated id is ignored. */
export interface TeamNoteInput {
  clientRequestId: string;
  text: string;
}

/** GET /api/conversations/:id/tools?store= → the config's tools by kind of access, with the integration behind a group. */
export interface ToolGroup {
  id: string;
  name: string;
  /** read: reads only; approval: its drafts and changes need your approval; on: works inside the app. */
  access: 'read' | 'approval' | 'on';
  tools: string[];
  /** The integration (or its MCP server) the group needs, and whether this store has it connected. */
  integration?: { kind: IntegrationKind; connected: boolean };
}

/** GET /api/conversations/:id?store= → the conversation with the config it runs on. */
export interface ConversationDetail extends Conversation {
  config: AgentConfig;
}

/** GET /api/conversations?store= answers a page plus each type's count under the same filters ('team' for teams). */
export interface ConversationPage extends CursorPage<Conversation> {
  byType: Record<string, number>;
}

/** GET /api/conversations/counts → per store, conversations with a reply going (or queued) and those waiting on the owner. */
export type ConversationCounts = Record<string, { running: number; waiting: number }>;

/** GET /api/agent-types?store= → the types a store can talk to, in list order: roles, built-in types, its custom roles. */
export interface AgentTypeInfo {
  id: string;
  name: string;
  description: string;
  baseRole: AgentRole;
  /** What its prompt is built from, shown under "Role instructions and checks". */
  contract: RoleContract;
}

/** A type's contract (decision 2). Every type's workflow opens and its checks end with the same steps. */
export interface RoleContract {
  responsibility: string;
  kpi: string;
  workflow: string[];
  /** The tools the type may be given (a deploy can switch drafts off). */
  tools: string[];
  knowledge: string[];
  outputs: string[];
  checks: string[];
  /** A custom role's own instructions, on top of its base role's contract. */
  instructions?: string;
}

/** POST /api/custom-roles?store= body → 201 CustomRole. `tools` narrows the base role's; `allStores` saves it for every store. */
export interface CreateCustomRoleInput {
  name: string;
  description?: string;
  instructions?: string;
  baseRole: AgentRole;
  tools?: string[];
  allStores?: boolean;
}

export interface SendMessageInput {
  clientRequestId: string;
  message: string;
  attachments?: AttachmentUpload[];
}

/** A document sent with a message (decision 11): pdf, txt, md, csv or html, up to 10 MB in all per message. */
export interface AttachmentUpload {
  name: string;
  /** The file, base64. */
  data: string;
}

/** An attachment as its run keeps it: read when sent, the original file not kept. A retry sends the same text. */
export interface RunAttachment {
  name: string;
  /** Its extension: pdf, txt, md, csv or html. */
  type: string;
  /** Bytes. */
  size: number;
  /** The extracted text, cut to ATTACHMENT_TEXT characters. */
  text: string;
  /** The text was longer and only its start is kept (the chip says so, and so does the agent's block). */
  cut?: boolean;
}

export const ATTACHMENT_TEXT = 20_000;

/** A knowledge card a run used: in its prompt (the `knowledge` event), found with search_knowledge, or cited. */
export interface KnowledgeRef {
  id: string;
  title: string;
  stage: KbStage;
  /** null: General. */
  storeId: string | null;
}

/** GET /api/conversations/:id/knowledge?store= → KnowledgeUse[]: the cards its latest started run used, this store's and General's only. */
export interface KnowledgeUse extends KnowledgeRef {
  how: ('prompt' | 'search' | 'cited')[];
}

/** GET /api/conversations/:id/findings?store= → the cards its runs saved findings to (decision 11), newest first. */
export interface ConversationFinding extends KnowledgeRef {
  status: KbCardStatus;
  at: string;
}

/** POST /api/runs/:id/findings?store=: Save to Knowledge Base on a reply, anchored on its text block (not the selection). */
export interface SaveFindingInput {
  /** The reply's text block: its text split where approval cards sit, empty parts left out. */
  block: number;
  /** 5–160 characters. */
  title: string;
  /** 10–600 characters. */
  summary: string;
}

/** What a save did: a new card (`saved`), a row on the store card that says it (`added`), or nothing (`general`: it's in General). */
export interface FindingSaved {
  result: 'saved' | 'added' | 'general';
  card: KnowledgeRef & { status: KbCardStatus };
}

/** A finding's evidence tag: its block's first one, else untagged. */
export type FindingTag = 'measured' | 'research' | 'hypothesis' | 'untagged';

const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).replace(/\s+\S*$/, '')}…`);
const cleanLine = (l: string) => l.replace(/[*`]|(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu, '').replace(/^\s*(?:[-•>]|\d+\.)\s+/, '').trim();

/** The first sentence of the text's first line of prose (headings, rules and list markers skipped), cut to `max`. */
export function gist(text: string, max = 160): string | undefined {
  const line = text
    .split('\n')
    .map(cleanLine)
    .find((l) => l && !l.startsWith('#') && !/^[-=|: ]+$/.test(l));
  if (!line) return undefined;
  return clip(line.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? line, max);
}

/**
 * A reply block as a finding, with no model call (decision 11): the title is its first sentence (160 characters), the
 * summary its prose (600), the body the block itself; the tag and the URLs and [kb:id]s it cites go in the evidence row.
 */
export function blockFinding(text: string): { title: string; summary: string; body: string; tag: FindingTag; sources: string[] } {
  const tag = (/\[(measured|research|hypothesis)\]/i.exec(text)?.[1]?.toLowerCase() ?? 'untagged') as FindingTag;
  const urls = (text.match(/https?:\/\/[^\s<>()[\]"']+/g) ?? []).map((u) => u.replace(/[.,;:!?]+$/, ''));
  const cards = [...text.matchAll(/\[kb:([\w-]+)\]/gi)].map((m) => `[kb:${m[1]}]`);
  const prose = text
    .replace(/\[([^\]]+)\]\((?:https?:[^)]+)\)/g, '$1')
    .replace(/ ?\[(?:kb:[\w-]+|measured|research|hypothesis)\]/gi, '');
  const summary = prose
    .split('\n')
    .map(cleanLine)
    .filter((l) => l && !/^[-=|: ]+$/.test(l))
    .map((l) => l.replace(/^#+\s*/, ''))
    .join(' ');
  return { title: gist(prose) ?? '', summary: clip(summary, 600), body: text.trim(), tag, sources: [...new Set([...urls, ...cards])] };
}

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
  /** What it made, found by run_id (decision 14): in a conversation's thread and GET /api/runs/:id. */
  deliverables?: RunDeliverable[];
}

/** Something a run made, linked to where it lives: a creative, a page or flow draft, the campaign its ad request is about. */
export interface RunDeliverable {
  kind: 'creative' | 'page_draft' | 'flow_draft' | 'campaign';
  id: string;
  title: string;
  /** A creative's kind, for its library tab. */
  creativeKind?: CreativeKind;
}

/**
 * Squad mission: a multi-agent plan over ordinary agent runs. A step starts once every step it depends on is done, as
 * the child run (`parentRunId`) of the first one, with their final answers in its brief.
 * GET /api/squad-missions?stores=a,b → SquadMission[] (newest first); GET /api/squad-missions/:id → SquadMission;
 * POST /api/squad-missions NewSquadMission → 201 SquadMission (its first steps start right away);
 * GET /api/squad-missions/templates → Omit<NewSquadMission, 'storeId'>[].
 */
export interface SquadMission {
  id: string;
  storeId: string;
  title: string;
  createdAt: string;
  /** `done`: every step is; `blocked`: a step failed or was cancelled and nothing is running any more; `cancelled`: the owner called it off. */
  status: 'running' | 'done' | 'blocked' | 'cancelled';
  steps: SquadMissionStep[];
  /** 'team': a team session (decision 12). Plain missions leave the team fields out. */
  kind?: 'team';
  objective?: string;
  /** The lead first. `fromConversationId`: the conversation that lent its config and recap. */
  participants?: { configId: string; fromConversationId?: string }[];
  /** Counts Claude participants only. */
  budgetUsd?: number;
  maxConcurrent?: number;
  /** Retries per task, 0–2. */
  retries?: number;
  /** The team's own conversations row: its pin, archive, title and follow-ups. */
  conversationId?: string;
  /** "To: Lead" notes while the team runs; `id` is the note's client_request_id. */
  ownerNotes?: { id: string; text: string; at: string }[];
}

/** A team task's shared record, parsed from the fenced JSON its answer ends with. */
export interface TeamContribution {
  summary: string;
  output: string;
  evidence: string[];
  openQuestions: string[];
  disagreesWith: string[];
}

export interface SquadMissionStep {
  id: string;
  role: AgentRole;
  task: string;
  /** Step ids it waits on, always listed before it. */
  dependsOn: string[];
  /** `waiting`: not started (a step it needs isn't done, or `note` says why it couldn't start); `blocked`: a step it needs failed. Else its run's status. */
  status: 'waiting' | 'blocked' | RunStatus;
  /** Its run (GET /api/runs/:id) once started. */
  runId?: string;
  /** The first line of its final answer, once done. */
  deliverable?: string;
  /** Why it couldn't start yet (e.g. today's AI budget is used up); it's tried again as other runs finish. */
  note?: string;
  /** Team steps only (decision 12). */
  kind?: 'plan' | 'task' | 'synthesis';
  configId?: string;
  expected?: string;
  attempts?: number;
  nextTryAt?: string;
  contribution?: TeamContribution;
  unresolved?: string[];
  /** Its run was cut off by an app restart: the owner resumes it (decision 12). */
  interrupted?: boolean;
}

export interface NewSquadMission {
  storeId: string;
  title: string;
  steps: { id: string; role: AgentRole; task: string; dependsOn?: string[] }[];
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
  /** At run start: the knowledge cards placed in its prompt or, on a resumed session, its user turn (decision 11). */
  | { type: 'knowledge'; cards: KnowledgeRef[] }
  /** save_finding saved a finding: a new card, or (`added`) one more row on the store card that already said it. */
  | { type: 'kb_written'; card: KnowledgeRef & { status: KbCardStatus }; added: boolean }
  /** A line for the reply's activity, e.g. the run didn't run on what was asked (decision 9). */
  | { type: 'notice'; text: string }
  /** `sessionId` continues the conversation when passed back as `resume`. */
  | { type: 'done'; sessionId: string; usage: RunUsage }
  /** `usage`: what the run spent before it stopped, when the engine reports it. */
  | { type: 'error'; message: string; usage?: RunUsage; sessionId?: string /* the conversation, when it got one (a run cut off by its turn or budget limit) */; code?: string /* the SDK error code or result subtype */ };

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
  shopify: { name: 'Shopify', category: 'platform', perStore: true, help: 'Shopify admin → Settings → Apps and sales channels → Develop apps → Build apps in Dev Dashboard → Create app → new version with Admin API scopes read_products, read_inventory, read_orders, read_all_orders (plus write_products and write_online_store_pages if agents may add products, change prices and publish pages you approve, read_themes and write_themes if the Store Developer may edit a copy of your theme, and read_reports with Level 2 protected customer data for the sessions funnel when GA4 is not connected) → Release → Install on your store → Settings: copy the client ID and secret. The app must be in the same organization as the store. Already have a custom app made before 2026? Paste its Admin API access token instead.', fields: [
    { key: 'shopDomain', label: 'Shop domain', secret: false, placeholder: 'your-store.myshopify.com or admin.shopify.com/store/your-store' },
    { key: 'clientId', label: 'Client ID', secret: false, optional: true },
    { key: 'clientSecret', label: 'Client secret', secret: true, optional: true },
    { key: 'accessToken', label: 'Admin API access token (older custom apps)', secret: true, placeholder: 'shpat_…', optional: true },
  ] },
  tiktok_shop: { name: 'TikTok Shop', category: 'platform', perStore: true, help: 'TikTok Shop Partner Center → App & Service → create a custom app with Order and Product read scopes (and Return & Refund Basic, to take refunds off sales; Product Modify, to apply approved price changes; TikTok Shop Analytics, for visitors on the funnel), and set its redirect URL to https://localhost/frontline-oauth → copy the App key, App secret and the authorization link. Press Connect, approve your shop, then paste the address the browser lands on (the page itself will not load).', fields: [
    { key: 'appKey', label: 'App key', secret: false },
    { key: 'appSecret', label: 'App secret', secret: true },
    { key: 'authLink', label: 'Authorization link', secret: false, optional: true, placeholder: 'https://services.tiktokshop.com/open/authorize?service_id=…' },
    { key: 'shop', label: 'Shop (when several shops authorized the app)', secret: false, optional: true, placeholder: 'Shop name, code or ID' },
    { key: 'accessToken', label: 'Access token', secret: true, oauth: true },
    { key: 'refreshToken', label: 'Refresh token', secret: true, oauth: true },
  ] },
  etsy: { name: 'Etsy', category: 'platform', perStore: true, help: 'etsy.com/developers → Create a new app → copy the keystring and shared secret, and add https://localhost/frontline-oauth as a callback URL. Enter them with your shop ID, press Connect, approve in the browser, then paste the address the browser lands on (the page itself will not load). The app renews the access token itself (it lasts an hour). The same app key reads the prices of Etsy shops you track as competitors.', fields: [
    { key: 'shopId', label: 'Shop ID', secret: false },
    { key: 'apiKey', label: 'API keystring', secret: true },
    { key: 'sharedSecret', label: 'Shared secret', secret: true },
    { key: 'accessToken', label: 'OAuth access token', secret: true, oauth: true },
    { key: 'refreshToken', label: 'OAuth refresh token', secret: true, oauth: true },
  ] },
  amazon: { name: 'Amazon SP-API', category: 'platform', perStore: true, help: 'Seller Central → Apps and Services → Develop Apps → add a private app with the Selling Partner Insights role (and Product Listing, for the product list of an Amazon store; Amazon Fulfillment, for FBA stock; Inventory and Order Tracking, for its orders; Finance and Accounting, to take its refunds off sales) → copy the LWA client ID and secret → Authorize app → copy the refresh token. Region: na (US, CA, MX, BR), eu (Europe, UK, India, Middle East) or fe (Japan, Australia, Singapore). Marketplace ID, e.g. ATVPDKIKX0DER for amazon.com. Daily sales, order counts and sessions, and the listings and orders of an Amazon store.', fields: [
    { key: 'sellerId', label: 'Seller ID', secret: false },
    { key: 'region', label: 'Region', secret: false, placeholder: 'na | eu | fe' },
    { key: 'marketplaceId', label: 'Marketplace ID', secret: false, placeholder: 'ATVPDKIKX0DER' },
    { key: 'clientId', label: 'LWA client ID', secret: false },
    { key: 'clientSecret', label: 'LWA client secret', secret: true },
    { key: 'refreshToken', label: 'Refresh token', secret: true },
  ] },
  woocommerce: { name: 'WooCommerce', category: 'platform', perStore: true, help: 'WordPress admin → WooCommerce → Settings → Advanced → REST API → Add key → Permissions: Read (Read/Write if agents may add products and change prices you approve) → copy the consumer key and secret (shown once). The site must use https and pretty permalinks (not Plain). For real profit, turn on Cost of Goods Sold (Settings → Advanced → Features) and enter product costs. To let the Store Developer publish pages you approve, also add your WordPress username and an application password (Users → Profile → Application Passwords).', fields: [
    { key: 'siteUrl', label: 'Site URL', secret: false, placeholder: 'https://yourstore.com' },
    { key: 'consumerKey', label: 'Consumer key', secret: true, placeholder: 'ck_…' },
    { key: 'consumerSecret', label: 'Consumer secret', secret: true, placeholder: 'cs_…' },
    // Secret so that adding them doesn't count as another shop (a changed setting restarts the backfill).
    { key: 'wpUser', label: 'WordPress username (to publish pages)', secret: true, optional: true },
    { key: 'wpAppPassword', label: 'WordPress application password', secret: true, placeholder: 'abcd efgh ijkl mnop qrst uvwx', optional: true },
  ] },
  meta_ads: { name: 'Meta Ads', category: 'ads', perStore: true, help: 'Meta Business Settings → Users → System users → Add (Admin) → Assign assets: the ad account (view performance) → Generate new token (expiration: Never; a 60-day one stops syncing when it lapses) with ads_read and ads_mcp_management (agents read through the Meta ads MCP), plus ads_management if agents may make changes you approve → copy it. Ad account ID is in Ads Manager (act_…).', fields: [
    { key: 'adAccountId', label: 'Ad account ID', secret: false, placeholder: 'act_…' },
    { key: 'accessToken', label: 'System user access token', secret: true },
  ] },
  google_ads: { name: 'Google Ads', category: 'ads', perStore: true, help: 'Google Ads → Tools → API Center: apply for a developer token. Google Cloud console → enable the Google Ads API → Credentials → OAuth client ID (Desktop app) → client ID + secret. In Google Auth Platform → Audience press Publish app: while it is in Testing the sign-in lapses every 7 days. Enter them and press Connect, then sign in with a Google account that has access to the ad account. Customer ID is top right in Google Ads. If you get to the ad account through a manager account, also enter the manager account ID.', fields: [
    { key: 'customerId', label: 'Customer ID', secret: false, placeholder: '123-456-7890' },
    { key: 'managerId', label: 'Manager account ID', secret: false, placeholder: '123-456-7890', optional: true },
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
  cj: { name: 'CJ Dropshipping', category: 'supplier', perStore: false, help: 'In CJ: Apps → install "API" (under Others) → My CJ → Authorization → API → Add API, Type API Key → copy the key from the "API Key & MCP Token" column. Read-only: order status and tracking for orders your stores send to CJ, plus product, stock and shipping-quote lookups for Product Research. The API needs only the key; the email is optional.', fields: [
    { key: 'email', label: 'Account email', secret: false, optional: true },
    { key: 'apiKey', label: 'API key', secret: true },
  ] },
  higgsfield: { name: 'Higgsfield AI', category: 'creative', perStore: false, help: 'console.higgsfield.ai → API keys → Create key → copy the key ID and the secret (shown once). Generations spend your Higgsfield credits, capped per store per day in Settings.', fields: [
    { key: 'keyId', label: 'Key ID', secret: false },
    { key: 'keySecret', label: 'Key secret', secret: true },
  ] },
};

/** The settings that name which shop an integration reads (another one there means the old shop's data goes). */
const SHOP_KEYS: Partial<Record<IntegrationKind, string[]>> = { shopify: ['shopDomain'], tiktok_shop: ['shop'], etsy: ['shopId'], amazon: ['sellerId', 'marketplaceId'], woocommerce: ['siteUrl'] };
const bareShop = (v = '') => v.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');

/**
 * Whether saving `now` over `was` connects another shop: the server then drops the old shop's orders, products and unit
 * costs, and the connect form warns first. A blank side (TikTok's optional shop) is unknown, not another shop.
 */
export const anotherShop = (kind: IntegrationKind, was: Record<string, string | undefined>, now: Record<string, string | undefined>) =>
  (SHOP_KEYS[kind] ?? []).some((k) => bareShop(was[k]) && bareShop(now[k]) && bareShop(was[k]) !== bareShop(now[k]));

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

export type ActionKind = 'ad_budget' | 'ad_pause' | 'product_create' | 'price_change' | 'product_page_publish' | 'page_publish' | 'theme_duplicate' | 'theme_files' | 'theme_publish' | 'theme_delete';

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
  /** The installed app's version, e.g. "0.1.3" (Settings shows it); "dev" when run from the repo. */
  version?: string;
  connectors: { id: string; kind: IntegrationKind; storeId?: string; status: IntegrationStatus; error?: string; syncedAt?: string }[];
}

/**
 * GET /api/integrations?stores=a,b → Integration[] (global ones always included).
 * POST /api/integrations/:id/sync → 202: "sync now" (e.g. after fixing what an error names); it runs within 30 s.
 */
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
  /**
   * A store platform's order-history import. While it runs, `through` is the YYYY-MM-DD it has reached (oldest first,
   * by last-updated date) and `done` is false: only Shopify saves its import page by page, so only Shopify reports it
   * mid-way. Once the first sync has finished, `done` is true and `through` is that day. Absent before either, and for
   * other kinds.
   */
  backfill?: { through: string; done: boolean };
  /**
   * Worth knowing but not an error. Today: an ad account (Meta, Google, TikTok) or GA4 property that reports its days in another
   * timezone than its store's, so its daily spend or sessions and the store's daily sales cover different hours.
   */
  notice?: string;
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
  /**
   * Unit cost incl. shipping. Where the platform has none (Etsy, TikTok Shop, Woo without COGS) the owner sets it with
   * PATCH /api/products/:storeId/:id { cost } → Product; past orders of it are re-priced. 400 on a connected Shopify
   * store (costs live in Shopify).
   */
  cost: number;
  inventory: number;
  /**
   * false when the platform doesn't track this product's stock (Shopify "Track quantity" off, Woo "Manage stock" off,
   * common when dropshipping): `inventory` is then 0 and means nothing, not sold out. Omitted = tracked.
   */
  inventoryTracked?: boolean;
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
  /** Where to follow `tracking`: the carrier's page when the platform gives one, else 17TRACK (finds the carrier from the number). */
  trackingUrl?: string;
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
  /** With niche 'other': the custom niche's slug (nicheSlug of the store's nicheDetail), so each custom niche's finds stay its own. */
  nicheDetail?: string;
  /** From the sample catalog every install starts with (made-up numbers), not an agent's find. `GET /api/research?sample=0` leaves these out. */
  sample?: true;
  image?: string;
  source: ResearchSource;
  /** Supplier cost incl. shipping. */
  cost: number;
  /** Suggested sell price. */
  price: number;
  /** The 'was' price sellers show; 0 when they show none (an agent's find, AGT-206). */
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
  /** Which events create notifications. */
  /** `digest`: a morning summary (8:00 local) of yesterday across stores and the approvals waiting. */
  notifications: { approvals: boolean; agentDone: boolean; errors: boolean; digest: boolean };
  /** ISO code that multi-store totals are converted to (default USD). */
  baseCurrency: string;
  /** Read-only: where the local database and key live (plus logs/ and backups/). POST /api/settings/open-data-folder → 204 opens it in Explorer. */
  dataDir: string;
}

export type SettingsUpdate = { profile?: Partial<Settings['profile']>; notifications?: Partial<Settings['notifications']>; baseCurrency?: string };

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

/**
 * A host on this computer or its network (localhost, private IPv4 ranges, IPv6 literals, dotless or .local-style names),
 * as `new URL(...).hostname` gives it (any IPv4 notation comes out dotted): the app never fetches one as a competitor.
 */
export const isPrivateHost = (hostname: string) =>
  !hostname.includes('.') || hostname.startsWith('[') || /^(127|10|0|192\.168|169\.254|172\.(1[6-9]|2\d|3[01]))\.[\d.]+$|\.(local|localhost|internal|lan|home|arpa)$/i.test(hostname);

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
  /** The competitor shop's own currency (ISO code), when its source gives it. */
  currency?: string;
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
  /** The competitor shop's currency (ISO code), from the newer snapshot; absent when its source didn't give one. */
  currency?: string;
}

// ---------------------------------------------------------------------------------------------------------------------
// Automation (core lane). Rules: trigger → agent task, with an approval policy and a daily cap.

export type AutomationTrigger =
  /** 5-field cron in the owner's local time, e.g. "0 9 * * *" = every day 09:00. */
  | { type: 'schedule'; cron: string }
  /**
   * Fires when the store's metric over the trailing `windowDays` x 24 h (today so far plus the uncovered share of the
   * oldest day) crosses `value` (checked every 15 min, then `cooldownHours`).
   */
  | { type: 'metric'; metric: keyof MetricTotals; op: '<' | '>'; value: number; windowDays: number };

export interface AutomationAction {
  /** `kb_research`: the agent researches `task` (3-500 characters), under its workspace's research controls (KB-22). */
  type: 'agent_task' | 'kb_research';
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

// AI Ecosystem
export const OFFICE_DEPARTMENTS = [
  { id: 'executive', name: 'Executive Headquarters', desks: 2, role: null },
  { id: 'research', name: 'Product Research', desks: 4, role: 'product_hunter' },
  { id: 'advertising', name: 'Advertising', desks: 4, role: 'ad_strategist' },
  { id: 'creative', name: 'Creative Studio', desks: 4, role: 'creative_studio' },
  { id: 'development', name: 'Store Development', desks: 3, role: 'store_developer' },
  { id: 'analytics', name: 'Analytics', desks: 3, role: 'market_analyst' },
  { id: 'copywriting', name: 'Copywriting', desks: 3, role: 'copywriter' },
  { id: 'operations', name: 'Operations', desks: 3, role: 'operations' },
  { id: 'retention', name: 'Email & SMS', desks: 2, role: 'email_sms' },
  { id: 'integrations', name: 'Integrations & Automation', desks: 2, role: null },
] as const;
export type OfficeDepartment = (typeof OFFICE_DEPARTMENTS)[number]['id'];
export const OFFICE_DESKS = OFFICE_DEPARTMENTS.flatMap((d) => Array.from({ length: d.desks }, (_, i) => ({ id: `${d.id}-${i + 1}`, department: d.id })));
export const OFFICE_GRID = { width: 64, height: 48 };
export const OFFICE_ARCHETYPES = ['operator', 'netrunner', 'android', 'mech', 'executive', 'punk', 'pilot', 'engineer'] as const;
export const OFFICE_GEAR = ['cyberarm', 'reactor', 'cape', 'antenna', 'belt'] as const;
export interface OfficeAppearance {
  color: string;
  hair: number;
  skin: number;
  outfit: 'jacket' | 'suit' | 'hoodie';
  accessory: 'none' | 'headset' | 'glasses';
  archetype?: (typeof OFFICE_ARCHETYPES)[number];
  accent?: string;
  gear?: (typeof OFFICE_GEAR)[number];
  variant?: number;
}
export interface OfficeSeat {
  agentId: string;
  deskId: string;
  displayName: string;
  appearance: OfficeAppearance;
  position: { x: number; y: number } | null;
  archived: boolean;
  updatedAt: string;
}

export interface OfficeStats {
  activeTasks: number;
  completedTasks: number;
  failedTasks: number;
  successRate: number | null;
  activeTeams: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

// ---------------------------------------------------------------------------------------------------------------------
// Knowledge Base & Research Intelligence (knowledge-base lane, docs/backlog/knowledge-base.md).

/** A knowledge workspace: one store's id, or `null` for General. `'all'` is the owner-only scope of search and the Research Center. */
export type KbWorkspace = string | null;

export const KB_CARD_TYPES = {
  research_finding: 'Research Finding',
  business_principle: 'Business Principle',
  strategy: 'Strategy',
  hypothesis: 'Hypothesis',
  experiment: 'Experiment',
  validated_insight: 'Validated Insight',
  performance_lesson: 'Performance Lesson',
  competitor_intel: 'Competitor Intelligence',
  customer_insight: 'Customer Insight',
  playbook: 'Process / Playbook',
  user_provided: 'User-Provided Knowledge',
} as const;
export type KbCardType = keyof typeof KB_CARD_TYPES;

/** The confidence ladder, lowest first: how well a claim is supported, not how sure an agent sounds. */
export const KB_STAGES = { hypothesis: 'Hypothesis', supported: 'Research-Supported', tested: 'Experimentally Tested', validated: 'Validated' } as const;
export type KbStage = keyof typeof KB_STAGES;

/** Research and agent writes start `proposed` (shown "Unreviewed", never given to agents) until accepted. */
export type KbCardStatus = 'proposed' | 'active' | 'archived' | 'rejected' | 'merged';

export const KB_LINK_TYPES = {
  supports: 'Supports',
  contradicts: 'Contradicts',
  builds_upon: 'Builds Upon',
  derived_from: 'Derived From',
  validated_by: 'Validated By',
  applied_to: 'Applied To',
  related_to: 'Related To',
  /** The maintenance pass's merge suggestion (KB-23): `from` says what `to` says. */
  duplicates: 'Duplicates',
} as const;
export type KbLinkType = keyof typeof KB_LINK_TYPES;
/** `suggested` links are the app's guesses, drawn dotted until the owner accepts or rejects them. */
export type KbLinkStatus = 'suggested' | 'confirmed' | 'rejected';

/** MEASURED (the store's own numbers), RESEARCH (a read source), OBSERVED (a pattern seen, not tested), CONFLICT (evidence against). */
export type KbEvidenceKind = 'measured' | 'research' | 'observed' | 'conflict';

/** What happened when a source was fetched. Only `read` sources may back a finding. */
export type KbSourceStatus = 'read' | 'blocked_robots' | 'blocked_domain' | 'paywalled' | 'login' | 'unsupported' | 'too_large' | 'failed';
export const KB_SOURCE_RELIABILITY = {
  platform_docs: 'Platform docs',
  research: 'Research or academic',
  publication: 'Established publication',
  vendor: 'Vendor blog',
  forum: 'Forum',
  unknown: 'Unknown',
} as const;
export type KbSourceReliability = keyof typeof KB_SOURCE_RELIABILITY;

/** The General categories seeded once (spec §3), in this order. Owners add their own, at any depth. */
export const KB_GENERAL_CATEGORIES = [
  'Advertising',
  'Marketing',
  'Creative Strategy',
  'Analytics & Data',
  'Product Research',
  'Conversion Optimization',
  'Consumer Psychology',
  'Branding',
  'SEO',
  'E-Commerce Operations',
  'Financial & Profitability Analysis',
  'Customer Retention',
  'Competitor Research',
  'Sales & Pricing',
  'Business Strategy',
  'Automation & AI Workflows',
] as const;

/** A node of a workspace's category tree (any depth). Cards are drawn in one frame per category, path "A › B › C". */
export interface KbCategory {
  id: string;
  storeId: string | null;
  parentId: string | null;
  name: string;
  position: number;
  createdAt: string;
}

/** GET /api/kb/categories?ws=general|<storeId>[&general=1] → KbCategory[], each with its own visible card count (proposed + active). */
export interface KbCategoryCount extends KbCategory {
  cards: number;
  /** Days its cards stay fresh: its top-level category's, as the owner set it or that area's usual (KB-23). */
  freshDays: number;
}

/** Where a card came from. `agent` = an ordinary run; going live purges `agent` and `performance` cards of demo stores. */
export type KbOrigin = 'owner' | 'research' | 'agent' | 'performance' | 'promotion';

/** A card as lists and the artboard show it. GET /api/kb/cards/:id adds the long fields (KbCard). */
export interface KbCardBrief {
  id: string;
  storeId: string | null;
  categoryId: string;
  /** Category names, root first: ['Advertising', 'Creative Strategy', 'Video Hooks']. */
  path: string[];
  type: KbCardType;
  stage: KbStage;
  status: KbCardStatus;
  mergedInto?: string;
  title: string;
  summary: string;
  tags: string[];
  /** 'owner' or the agent's id (`<storeId>:<role>`). */
  authorId: string;
  origin: KbOrigin;
  runId?: string;
  taskId?: string;
  pinned: boolean;
  /** Roles that may not use it; ['*'] = every role. */
  blockedRoles: string[];
  researchMarked: boolean;
  usedCount: number;
  citedCount: number;
  verifiedAt?: string;
  /** When it needs checking again: last checked (or made) plus its category's refresh age (KB-23). */
  refreshBy?: string;
  /** With a search (`q`): the best matching passage, each matching word between \u0002 and \u0003 (KB-24). */
  highlight?: string;
  createdAt: string;
  updatedAt: string;
}

/** GET /api/kb/cards/:id?ws=general|<storeId>|all[&general=1] → KbCard; another workspace's id is a 404. */
export interface KbCard extends KbCardBrief {
  /** The detailed explanation. */
  body: string;
  /** Why it matters to the business. */
  relevance: string;
  /** How agents apply it. */
  application: string;
  /** Platforms, industries, audiences or circumstances it applies to. */
  appliesTo: string;
  /** Where it may not work. */
  limits: string;
}

/**
 * GET /api/kb/cards?ws=general|<storeId>|all → Page<KbCardBrief>. Filters (all optional): general=1 (a store's list plus
 * General), q (keyword search), category (that category and everything under it), agent (author id or role), source,
 * createdFrom/createdTo, verifiedFrom/verifiedTo (YYYY-MM-DD), stage, type, status (comma lists; status defaults to
 * proposed,active), metric (has evidence on it), tag (comma list, any), sort=updated|created|title|stage|verified|used,
 * dir=asc|desc, offset, limit (1-1000, default 200).
 */
export interface KbCardQuery {
  q?: string;
  general?: boolean;
  category?: string;
  agent?: string;
  source?: string;
  createdFrom?: string;
  createdTo?: string;
  verifiedFrom?: string;
  verifiedTo?: string;
  stage?: KbStage[];
  type?: KbCardType[];
  status?: KbCardStatus[];
  metric?: string;
  tag?: string[];
  /** With `q`, the best match first unless a sort is chosen (`relevance`; without `q` it's `updated`). */
  sort?: 'updated' | 'created' | 'title' | 'stage' | 'verified' | 'used' | 'relevance';
  dir?: 'asc' | 'desc';
  offset?: number;
  limit?: number;
}

/** One card an answer may use, with the sources behind it (KB-24). */
export interface KbAskCard {
  card: KbCardBrief;
  sources: KbSourceBrief[];
}
/**
 * POST /api/kb/ask {ws: general|all|<storeId>, question (3-500), payerId?} → KbAskAnswer (KB-24). The cards matching the
 * question in the owner's scope, by what backs them: the stores' own numbers, read sources, or nothing yet. With any,
 * `run` is the answer: `payerId`'s Market Analyst (a store workspace's own) writing from those cards only. With none,
 * nothing runs: the knowledge base doesn't know.
 */
export interface KbAskAnswer {
  measured: KbAskCard[];
  research: KbAskCard[];
  unproven: KbAskCard[];
  run?: AgentRun;
}

/**
 * POST /api/kb/cards {ws: 'general'|<storeId>, ...} → 201 KbCard (the owner's: User-Provided unless a type is given, active).
 * The category is `categoryId` (in that workspace) or `category`, a path created as needed. Text fields: title 3-160,
 * summary ≤600, the long ones ≤8000; tags ≤12 of 1-40 characters.
 */
export interface KbCardInput {
  categoryId?: string;
  category?: string[];
  title: string;
  summary?: string;
  body?: string;
  relevance?: string;
  application?: string;
  appliesTo?: string;
  limits?: string;
  tags?: string[];
  type?: KbCardType;
  stage?: KbStage;
}

/**
 * PATCH /api/kb/cards/:id?ws=general|<storeId> → KbCard. Each call is one revision; `reason` is kept with it. `status`:
 * 'active' accepts a proposed card or brings back an archived or rejected one. Merging is POST /api/kb/cards/:id/merge {from}.
 */
export interface KbCardPatch extends Partial<KbCardInput> {
  pinned?: boolean;
  blockedRoles?: string[];
  researchMarked?: boolean;
  status?: 'active' | 'archived' | 'rejected';
  reason?: string;
}

/**
 * GET /api/kb/positions?ws= → where the owner dragged cards on that workspace's artboard, by card id, relative to the
 * card's frame. PUT (the same shape, some cards) saves them → 204. A General card has its own place in each store.
 */
export type KbPositions = Record<string, { x: number; y: number }>;

/** What a saved artboard view brings back: the filters, the camera and which frames are collapsed. */
export interface KbViewState {
  q?: string;
  general?: boolean;
  camera?: { x: number; y: number; scale: number };
  collapsed?: string[];
  /** A Library view: its filter and sort query params (KbCardQuery names). An artboard view has none. */
  filters?: Record<string, string>;
}

/** GET /api/kb/views?ws= → KbView[] newest first; POST /api/kb/views {ws, name, state} → 201; DELETE /api/kb/views/:id?ws= → 204. */
export interface KbView {
  id: string;
  storeId: string | null;
  name: string;
  state: KbViewState;
  createdAt: string;
}

/** A research task's stages in order: agent runs, then the app's own dedupe, store and link steps, then the report. */
export const KB_TASK_STAGES = ['planning', 'discovering', 'retrieving', 'analyzing', 'evaluating', 'extracting', 'deduping', 'storing', 'linking', 'reporting'] as const;
export type KbTaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

/** GET /api/kb/research/tasks?ws=<general|storeId|all>[&open=1] → KbTaskBrief[] newest first; open = queued or running. */
export interface KbTaskBrief {
  id: string;
  /** Where the findings go (null = General). */
  storeId: string | null;
  /** Whose agent and AI budget run it. */
  payerId: string;
  role: AgentRole;
  objective: string;
  status: KbTaskStatus;
  /** One of KB_TASK_STAGES, or 'created' before the first. */
  stage: string;
  createdAt: string;
  startedAt?: string;
  /** Why it failed. */
  error?: string;
}

/** How far New research goes: the most sources it reads, and the budget the form suggests for it. */
export const KB_RESEARCH_DEPTHS = {
  quick: { label: 'Quick', sources: 3, budgetUsd: 0.5 },
  standard: { label: 'Standard', sources: 5, budgetUsd: 1.5 },
  deep: { label: 'Deep', sources: 8, budgetUsd: 3 },
} as const;
export type KbResearchDepth = keyof typeof KB_RESEARCH_DEPTHS;

/** What the owner gave a research task: links and pasted text to read (a source task), and what to look for. */
export interface KbResearchBrief {
  urls?: string[];
  text?: string;
  lookFor?: string;
  /** A topic task's depth (none = deep). */
  depth?: KbResearchDepth;
  /** Uploaded documents: read and kept as sources when the task was made. */
  documentIds?: string[];
  /** What started self-directed research (KB-22): a trigger and its card, category or automation rule. */
  trigger?: { kind: KbTrigger | 'schedule'; subject: string };
}

/**
 * POST /api/kb/research/tasks → 201 KbTaskBrief: Research From Source, or New research. The agent works on its store's AI
 * budget and files to General or that store (`ws`), never another. Sources are up to 8 links, pasted text (≤ 200,000
 * characters) or a document (a PDF, text, markdown, transcript, CSV or HTML file, in base64, ≤ 10 MB). With none, the
 * `objective` (New research) makes a topic task that searches the web, as far as `depth` says. GET
 * /api/kb/research/tasks/:id → KbTaskDetail; POST …/:id/cancel and …/:id/retry → KbTaskBrief, 409 when it can't. POST
 * …/:id/refine {objective?, budgetUsd?} → 201 KbTaskBrief: a finished task again as a new one (`refinedFrom`).
 */
export interface KbSourceResearchInput {
  agentId: string;
  ws: string;
  /** The research request; for a source task, it names the task (else `lookFor` or the sources do). */
  objective?: string;
  depth?: KbResearchDepth;
  urls?: string[];
  text?: string;
  document?: { name: string; data: string };
  lookFor?: string;
  categoryId?: string;
  budgetUsd: number;
}

/** The evaluating stage's verdict on one finding, against spec §5's criteria: 1 (poor) to 5 (strong). */
export interface KbAssessment {
  reliability: number;
  evidence: number;
  relevance: number;
  recency: number;
  agreement: number;
  usefulness: number;
  novelty: number;
  applicability: number;
  /** Where sources disagree; a contested finding stays a Hypothesis. */
  contradictions: string[];
  keep: boolean;
  why: string;
}

/** A research task's final report: the agent's conclusions, then what the app recorded. */
export interface KbResearchReport {
  summary: string;
  conclusions: string[];
  unresolved: string[];
  limitations: string[];
  /** Ways to apply it to the business. */
  applications: string[];
  created: { id: string; title: string }[];
  updated: { id: string; title: string }[];
  failedSources: { url: string; status: KbSourceStatus; error?: string }[];
  conflicts: string[];
  errors: string[];
}

/** A research task in full: its stages' attempts, the execution log, what it read and found, and the report. */
export interface KbTaskDetail extends KbTaskBrief {
  kind: 'source' | 'topic';
  origin: 'owner' | 'agent' | 'autonomous';
  brief: KbResearchBrief;
  categoryId?: string;
  /** Failed attempts at the current stage (3 fail the task). */
  attempt: number;
  /** When the next attempt may start (after a failure, or while its agent can't take it). */
  nextTryAt?: string;
  budgetUsd: number;
  spentUsd: number;
  /** The task this one refines. */
  refinedFrom?: string;
  endedAt?: string;
  steps: { stage: string; attempt: number; runId?: string; status: 'running' | 'done' | 'failed'; startedAt: string; endedAt?: string }[];
  log: { stage: string; level: 'info' | 'warn' | 'error'; message: string; at: string }[];
  sources: KbSourceBrief[];
  findings: { id: string; title: string; status: 'pending' | 'stored' | 'merged' | 'rejected' | 'discarded'; cardId?: string; assessment?: KbAssessment }[];
  report?: KbResearchReport;
}

/** GET /api/kb/workspaces → visible cards (proposed + active) per workspace, keyed 'general' or a store id; missing = 0. */
export type KbWorkspaceCounts = Record<string, number>;

/** POST /api/kb/categories {ws, name, parentId?} → 201; PATCH /api/kb/categories/:id?ws= {name?, parentId?, position?}; DELETE → 204, or 409 while it holds cards. */
export interface KbCategoryInput {
  name: string;
  parentId?: string | null;
  position?: number;
}

/**
 * A source in full. PATCH /api/kb/sources/:id?ws= {reliability} → KbSource: the owner's rating, kept when the source is
 * fetched again. `excerpt` is the start of the readable text ('' when it wasn't read; `error` says why).
 */
export interface KbSource extends KbSourceBrief {
  kind: 'url' | 'text' | 'document';
  publishedAt?: string;
  excerpt: string;
  error?: string;
  reliabilityByOwner: boolean;
  createdAt: string;
}

/** The source behind a piece of evidence, as the card shows it. */
/** GET /api/kb/sources?ws=<general|storeId>[&general=1] → KbSourceBrief[] by title: the Library's source filter. */
export interface KbSourceBrief {
  id: string;
  url?: string;
  title: string;
  status: KbSourceStatus;
  reliability: KbSourceReliability;
  fetchedAt?: string;
}

/**
 * GET /api/kb/cards/:id/evidence?ws=[&general=1] → KbEvidence[] (oldest first). POST /api/kb/cards/:id/evidence?ws=
 * (KbEvidenceInput) → 201 KbCard, its stage re-weighed; DELETE /api/kb/evidence/:id?ws= → KbCard.
 */
export interface KbEvidence {
  id: string;
  cardId: string;
  kind: KbEvidenceKind;
  text: string;
  source?: KbSourceBrief;
  /** The performance reading it came from (KB-19). */
  observationId?: string;
  metric?: string;
  value?: number;
  baseline?: number;
  windowFrom?: string;
  windowTo?: string;
  sampleSize?: number;
  /** The test it came from; Validated needs two different ones. */
  testRef?: string;
  /** The card it came with in a merge: POST /api/kb/cards/:id/detach {from} gives it back. */
  mergedFrom?: string;
  authorId: string;
  runId?: string;
  taskId?: string;
  createdAt: string;
}

/** text 3-1000; sourceId a source of the workspace; windows YYYY-MM-DD; sampleSize a whole number. */
export interface KbEvidenceInput {
  kind: KbEvidenceKind;
  text: string;
  sourceId?: string;
  metric?: string;
  value?: number;
  baseline?: number;
  windowFrom?: string;
  windowTo?: string;
  sampleSize?: number;
  testRef?: string;
}

/**
 * GET /api/kb/links?ws=[&general=1][&card=] → KbLink[] (rejected ones left out). POST /api/kb/links {ws, from, to, type, why}
 * → 201 (the owner's, confirmed); PATCH /api/kb/links/:id?ws= {status: 'confirmed'|'rejected'}; DELETE → 204. A link between
 * a store card and a General one belongs to the store.
 */
export interface KbLink {
  id: string;
  storeId: string | null;
  fromId: string;
  toId: string;
  type: KbLinkType;
  /** Why the cards are linked, shown when the line is clicked. */
  why: string;
  status: KbLinkStatus;
  score?: number;
  /** 'owner', 'app' (the suggester) or an agent id. */
  authorId: string;
  createdAt: string;
  decidedAt?: string;
}

export interface KbLinkInput {
  from: string;
  to: string;
  type: KbLinkType;
  why: string;
}

/** GET /api/kb/cards/:id/revisions?ws=[&general=1] → KbRevision[] newest first; POST .../revisions/:rev/restore?ws= → KbCard. */
export interface KbRevision {
  id: number;
  cardId: string;
  actor: string;
  reason: string;
  createdAt: string;
  /** The card as it was after this change. */
  snapshot: Pick<KbCard, 'title' | 'summary' | 'body' | 'relevance' | 'application' | 'appliesTo' | 'limits' | 'tags' | 'categoryId' | 'type' | 'stage' | 'status'>;
}

/** Evidence against a card, or two cards that disagree. Kept until the owner decides; never forced into one conclusion. */
export interface KbConflict {
  id: string;
  storeId: string | null;
  cardId: string;
  otherCardId?: string;
  evidenceId?: string;
  note: string;
  status: 'open' | 'resolved' | 'kept_both';
  /** Found by this research task: such conflicts don't start research again. */
  taskId?: string;
  createdAt: string;
  resolvedAt?: string;
}

/** A Research Center discovery: a card that moved up to Validated this week, or a conflict waiting for the owner. */
/**
 * A store card's General version waiting for the owner: the payload of a 'kb.promote' approval (KB-18). POST
 * /api/kb/cards/:id/promote?ws=<storeId> → 202 {runId, agentId}: the agent drafting it. PATCH
 * /api/kb/promotions/:approvalId?ws=<storeId> {title, summary, body} → the approval with the owner's edit.
 */
export interface KbPromotion {
  cardId: string;
  title: string;
  summary: string;
  body?: string;
}

export type KbDiscovery =
  | { kind: 'validated'; at: string; reason: string; card: KbCardBrief }
  | { kind: 'conflict'; id: string; at: string; note: string; card: KbCardBrief; other?: KbCardBrief }
  /** A General version of `card` waiting for the owner (approval `id`), titled `title`. */
  | { kind: 'promotion'; id: string; at: string; title: string; card: KbCardBrief }
  /** The maintenance pass found `card` saying what `other` says (suggested link `id`): merge it in, or say they differ. */
  | { kind: 'duplicate'; id: string; at: string; why: string; card: KbCardBrief; other: KbCardBrief }
  /** A card past its category's age that new evidence checked again. */
  | { kind: 'refreshed'; at: string; reason: string; card: KbCardBrief };

/**
 * GET /api/kb/overview?ws=general|<storeId>|all → the Research Center, from the visible cards (proposed + active).
 * PATCH /api/kb/conflicts/:id?ws= {status: 'kept_both'} → 204: the owner keeps both sides.
 */
/** What a test compares (KB-21). Each is read with its count's noise: purchases, clicks, purchases. */
export const KB_TEST_METRICS = { roas: 'ROAS', ctr: 'Click-through rate', cvr: 'Conversion rate (purchases per click)' } as const;
export type KbTestMetric = keyof typeof KB_TEST_METRICS;

/** One side of a test: campaigns (`network:id`) and library creatives (their ads' results, outside those campaigns). */
export interface KbTestVariant {
  label: string;
  campaigns: string[];
  creatives: string[];
}

/**
 * A test of a card's claim on a store's ad numbers (KB-21). B is what the card says works, A the control. Once `due`
 * (the window's end + 30 days of attribution) the app reads it and writes the result on the card: worked = measured
 * evidence (a test on the ladder), failed = conflict evidence, inconclusive = observed.
 * GET /api/kb/cards/:id/experiments?ws= → KbExperiment[] (newest first); POST {storeId? (a General card), metric,
 * variants: [A, B], from, to, minSample} → 201; DELETE /api/kb/experiments/:id?ws= → 204 while planned.
 */
export interface KbExperiment {
  id: string;
  cardId: string;
  storeId: string;
  metric: KbTestMetric;
  variants: [KbTestVariant, KbTestVariant];
  from: string;
  to: string;
  /** Purchases (ROAS, conversion rate) or clicks (click-through rate) each variant needs. */
  minSample: number;
  status: 'planned' | 'worked' | 'failed' | 'inconclusive';
  /** The reading, once evaluated. */
  result?: string;
  due: string;
  createdAt: string;
}
export type NewKbExperiment = Pick<KbExperiment, 'metric' | 'variants' | 'from' | 'to' | 'minSample'> & { storeId?: string };

/**
 * GET /api/kb/campaigns?ws= (a store or all; General has none): the Library's Campaigns section (KB-21). A field the
 * synced data doesn't link (products, audiences) is left out here and shown as "not linked".
 */
export interface KbCampaign {
  network: string;
  id: string;
  storeId: string;
  name: string;
  status: string;
  /** First and last day with spend. */
  from?: string;
  to?: string;
  spend: number;
  revenue: number;
  purchases: number;
  clicks: number;
  impressions: number;
  ads: number;
  /** Ad sets / ad groups its ads run in; their audiences aren't synced. */
  groups: number;
  /** Library creatives its ads were made from. */
  creatives: Pick<Creative, 'id' | 'headline' | 'primaryText' | 'format' | 'hook' | 'angle' | 'offer'>[];
  /** Tests that included it or its creatives, newest first. */
  experiments: Pick<KbExperiment, 'id' | 'cardId' | 'status' | 'from' | 'to'>[];
  /** Cards learned from it, its ads or its tests, with the window measured. */
  cards: { id: string; title: string; stage: KbStage; from: string; to: string }[];
}

/** What a store's performance learning (KB-19) reads from, and what it can't yet: in KbOverview.performance. */
/** What starts self-directed research (KB-22), in the order a pass looks at them. */
export const KB_TRIGGERS = {
  conflict: 'Contradictions',
  anomaly: 'Performance anomalies',
  gap: 'Knowledge gaps',
  stale: 'Stale cards',
} as const;
export type KbTrigger = keyof typeof KB_TRIGGERS;

/** A workspace's research controls (KB-22). General has no self-directed research: it runs on a store's agents. */
export interface KbControls {
  /** Self-directed research: off unless the owner turns it on. */
  autonomous: boolean;
  /** The roles that may research on their own, each with the top-level categories it answers for (none: its usual areas). */
  roles: Partial<Record<AgentRole, string[]>>;
  triggers: KbTrigger[];
  taskBudgetUsd: number;
  /** What self-directed research may reserve in 24 hours: each task's budget, recommendations waiting included. */
  dailyBudgetUsd: number;
  depth: KbResearchDepth;
  /** Each self-directed task waits in "Agents recommend" for the owner's approval. */
  approval: boolean;
  /** Research findings start Unreviewed (decision 11); off, they start accepted. */
  review: boolean;
  /** Sites discovery prefers. */
  trustedDomains: string[];
  /** Sites never read (a domain blocks its subdomains). */
  blockedDomains: string[];
  /** Days a card stays fresh, by this workspace's top-level category id (KB-23); one not here keeps its area's usual age. */
  freshDays: Record<string, number>;
  /** Days fetched page text and finished research's logs are kept (the sources, tasks and reports stay); null keeps them. */
  retentionDays: number | null;
}
/** GET /api/kb/controls?ws= (general or a store): the controls, and what self-directed research reserved in the last 24 hours. PUT takes any of KbControls' fields. */
export interface KbControlsState extends KbControls {
  reservedUsd: number;
}

export interface KbPerformance {
  storeId: string;
  /** Demo numbers are never learned from. */
  demo: boolean;
  /** What it learns from, e.g. 'Campaign results: ROAS and click-through rate'. */
  on: string[];
  /** What isn't enabled, and why. */
  off: string[];
  /** Its Performance Lesson cards. */
  lessons: number;
}

export interface KbOverview {
  cards: number;
  /** Made in the last 7 days. */
  thisWeek: number;
  validated: number;
  hypotheses: number;
  supported: number;
  /** 90+ days since last verified (or made). */
  stale: number;
  /** Open conflicts. */
  conflicts: number;
  running: number;
  queued: number;
  /** Agents running research now. */
  researchers: number;
  sources: number;
  /** Root categories, largest first, by stage. All workspaces adds up same-named ones (`ws` holds most of them). */
  map: { ws: string; categoryId: string; name: string; stages: Record<KbStage, number> }[];
  /** Newest first, at most 8. */
  discoveries: KbDiscovery[];
  /** Root categories with weak evidence, weakest first, at most 5: 'only hypotheses', 'N of M stale', '0 measured'. */
  gaps: { ws: string; categoryId: string; name: string; reason: string }[];
  /** Each store in the workspace (none for General). */
  performance: KbPerformance[];
}

export * from './runtime-registry';
export * from './research';
