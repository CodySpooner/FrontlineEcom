// Domain types and API contracts shared by apps/web, apps/server and packages/agents.
// Additive changes only: never rename or remove a field another lane already uses.

export type Platform = 'shopify' | 'tiktok_shop' | 'etsy' | 'amazon' | 'woocommerce' | 'walmart';

export type Niche = 'beauty' | 'pet' | 'tech' | 'fitness' | 'home' | 'fashion' | 'kids' | 'outdoor' | 'other';

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

/** One agent = one role working for one store. Every store has its own squad. */
export interface Agent {
  id: string;
  storeId: string;
  role: AgentRole;
  status: AgentStatus;
  level: number;
  xp: number;
  currentTask?: string;
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

export interface ApprovalRequest {
  id: string;
  storeId: string;
  agentId: string;
  /** Short imperative, e.g. "Pause 2 losing ad sets". */
  title: string;
  /** Evidence, e.g. "Losing $45/day for 4 days straight". */
  reason: string;
  action: { kind: string; payload: unknown };
  status: ApprovalStatus;
  createdAt: string;
}
