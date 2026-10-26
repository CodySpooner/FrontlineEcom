import type { DatabaseSync } from 'node:sqlite';
import { AGENT_ROLES, PRICE_WRITE_PLATFORMS, PRODUCT_PAGE_PLATFORMS, PRODUCT_WRITE_PLATFORMS, RESEARCH_TABS, type Agent, type AgentRole, type AgentRun, type AgentEvent, type AnalyticsRange, type AnalyticsSummary, type ApprovalAction, type AspectRatio, type CreativeKind, type ApprovalDecision, type ApprovalsHook, type AdSnapshotData, type Competitor, type PriceChange, type ResearchProduct, type ResearchTab, type Store, type StoreCaps, type SupplierProduct, storeHealth } from '@frontline/shared';
import { z } from 'zod';
import { economics, reviewCampaigns, thresholds, type CampaignStats } from './ads';
import { chargeCredits, CREDITS, creditsAsked, creditsToday, demoMedia, listCreatives, saveCreative } from './creatives';
import { searchMemory, writeMemory } from './memory';
import { addNicheLearning, listNicheLearnings, nicheKey, saveNichePack } from './niche';
import { getPageDraft, listPageDrafts, savePageDraft, unsafeHtml } from './pages';
import { listFlowDrafts, saveFlowDraft } from './flows';
import { flagOrderIssue, listOrderIssues } from './issues';
import { ROLES, type ExternalMcpKind, type ToolName } from './roles';
import { runGist } from './runs';

export interface Theme {
  id: string;
  name: string;
  /** MAIN = the live theme. */
  role: string;
  processing: boolean;
  previewUrl: string;
}

/** What the server hands a run so its tools can read and act on app data. */
export interface ToolEnv {
  db: DatabaseSync;
  /** Core's analytics summary for this store (the math lives in apps/server). */
  summary: (storeId: string, range: AnalyticsRange) => AnalyticsSummary;
  /** The same over every store, converted to the owner's base currency (`currency`), with `byStore`. */
  portfolio?: (range: AnalyticsRange) => AnalyticsSummary;
  approvals: ApprovalsHook;
  /** Core's decide(): lets autopilot approve within its cap. Without it every request waits for the owner. */
  decide?: (id: string, decision: ApprovalDecision) => unknown;
  /** Core's per-store caps; `autopilot[kind]` is the owner's autopilot rule for that action kind. */
  caps?: (storeId: string) => StoreCaps;
  /** Core's exchange rate: `amount` of `currency` in USD (caps are USD); undefined when there's no rate. */
  toUsd?: (amount: number, currency: string) => Promise<number | undefined>;
  /** Core's competitor tracking for a store: who, their recent price moves, and ads seen lately. */
  competitors?: (storeId: string) => { competitors: Competitor[]; priceChanges: PriceChange[]; ads: (AdSnapshotData & { competitor: string })[] };
  /** Official MCP servers the store has connected (never in demo mode: no credentials, no servers). */
  externalMcp?: (storeId: string) => Partial<Record<ExternalMcpKind, ExternalMcp>>;
  /** Adds a product found on the web to core's research feed; returns it with its AI score. */
  recordFind?: (find: Omit<ResearchProduct, 'id' | 'margin' | 'score' | 'scoreParts'>) => Promise<ResearchProduct>;
  /** Renders media on Higgsfield and returns a local URL for it; undefined when Higgsfield isn't connected (demo render). */
  generateMedia?: (req: { kind: Exclude<CreativeKind, 'copy'>; aspect: AspectRatio; prompt: string }, signal?: AbortSignal) => Promise<string | undefined>;
  /** Queues a run for a squadmate (the app's run manager); returns the run or why it can't start. */
  startRun?: (agentId: string, task: string, parentRunId?: string) => AgentRun | string;
  /** Core's supplier catalog search (CJ Dropshipping; demo listings without credentials). */
  searchSuppliers?: (q: string, limit: number) => Promise<SupplierProduct[]>;
  /** Core's research feed (scored trending products). */
  research?: (q: { tab?: ResearchTab; niche?: string; q?: string; limit: number }) => Promise<ResearchProduct[]>;
  /** Core's Shopify theme connector; throws a readable error for stores it can't reach (demo, other platforms). */
  themes?: {
    list: (storeId: string) => Promise<Theme[]>;
    /** Text of theme files by name (`*` wildcards); the live theme when `themeId` is omitted. Binary files are null. */
    read: (storeId: string, filenames: string[], themeId?: string) => Promise<{ filename: string; content: string | null }[]>;
    /** Copies the live theme as an unpublished theme named `name` and writes the files to the copy. */
    draft: (storeId: string, name: string, files: { filename: string; body: string }[]) => Promise<Theme>;
  };
  runId?: string;
}

/** A remote MCP server over HTTP (the Agent SDK's `{ type: 'http' }` config). */
export interface ExternalMcp {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}

export interface ToolContext extends ToolEnv {
  store: Store;
  agent: Agent;
  /** Pushes an event into the run's stream (approval requests, memories). */
  emit: (event: AgentEvent) => void;
  signal?: AbortSignal;
}

export interface AppTool<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: ToolName;
  description: string;
  input: Shape;
  run: (args: z.infer<z.ZodObject<Shape>>, ctx: ToolContext) => Promise<string>;
}

const defineTool = <Shape extends z.ZodRawShape>(t: AppTool<Shape>) => t as unknown as AppTool;

/** Rows as compact CSV: cheaper in tokens than JSON, and models read it fine. */
function csv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '(none)';
  const cols = Object.keys(rows[0]!);
  return [cols.join(','), ...rows.map((r) => cols.map((c) => String(r[c] ?? '').replaceAll(',', ';')).join(','))].join('\n');
}

const r2 = (n: number) => Math.round(n * 100) / 100;
/** The first of the last `days` dates, today included, in the zone the store's data is dated in: a connected shop's own, else this machine's (demo data). */
const since = (days: number, store: Store) => {
  const d = new Date(`${new Date().toLocaleDateString('en-CA', store.connected ? { timeZone: store.timezone } : {})}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1 - days);
  return d.toISOString().slice(0, 10);
};
/** `days` × 24 hours ago, to compare with timestamps (an order's age). */
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
/**
 * Why a store change can't be asked for: the store is connected on a platform the app doesn't write it to yet (shared
 * PRODUCT_WRITE_PLATFORMS for products and other pages, PRODUCT_PAGE_PLATFORMS for product pages, PRICE_WRITE_PLATFORMS
 * for prices; `onStore` in apps/server/src/routes/agents.ts), so an approval would only fail. Undefined when it can.
 */
const noStoreWrites = (store: Store, platforms = PRODUCT_WRITE_PLATFORMS) =>
  store.connected && !platforms.includes(store.platform)
    ? `Not sent: the app doesn't change ${store.platform} stores yet, so approving it would do nothing. Put the change in your answer so the owner can make it by hand.`
    : undefined;
/** An amount in the store's currency, as the owner reads it on a request: $40 for USD stores, 40 EUR otherwise. */
export const cash = (n: number, currency: string) => (currency === 'USD' ? `$${n}` : `${n} ${currency}`);

/** `amount` of the store's currency in USD (the owner's caps are USD), to the cent; undefined when core has no rate. */
const inUsd = async (ctx: ToolContext, amount: number) =>
  ctx.store.currency === 'USD' || !amount ? amount : ctx.toUsd?.(amount, ctx.store.currency).then((n) => n && Math.round(n * 100) / 100);

/** Research and supplier prices are USD: a first line saying so (with the rate) for stores priced in another currency. */
async function usdNote(ctx: ToolContext) {
  const cur = ctx.store.currency;
  if (cur === 'USD') return '';
  const usd = await ctx.toUsd?.(1, cur);
  return `# Amounts in USD${usd ? ` (1 USD = ${r2(1 / usd)} ${cur})` : ''}; this store sells in ${cur}.\n`;
}

export const APP_TOOLS: AppTool[] = [
  defineTool({
    name: 'store_summary',
    description: 'Revenue, profit, ad spend, ROAS, orders and AOV for the last N days, with the previous period, % deltas and store health (net margin: bleeding / steady / winning).',
    input: { range: z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(365)]).default(30).describe('days') },
    run: async ({ range }, ctx) => {
      const s = ctx.summary(ctx.store.id, range);
      return JSON.stringify({ from: s.from, to: s.to, currency: ctx.store.currency, totals: s.totals, previous: s.previous, deltasPct: s.deltas, health: storeHealth(s.totals) });
    },
  }),
  defineTool({
    name: 'compare_stores',
    description:
      "All of the owner's stores side by side over the last N days, in one currency: revenue, profit, net margin, ad spend, ROAS, orders, health and revenue change vs the period before (CSV). For questions across stores.",
    input: { range: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30).describe('days') },
    run: async ({ range }, ctx) => {
      const p = ctx.portfolio?.(range);
      if (!p) return 'Not available in this run.';
      const stores = new Map(ctx.db.prepare('SELECT id, name, platform, niche, currency FROM stores').all().map((s) => [String(s.id), s]));
      // Stores whose currency has no exchange rate are missing from the amounts (they'd read as zero): name them instead.
      const left = (id: string) => p.unconverted?.includes(String(stores.get(id)?.currency)) ?? false;
      const skipped = p.byStore.filter((s) => left(s.storeId)).map((s) => stores.get(s.storeId)?.name ?? s.storeId);
      const rows = p.byStore
        .filter((s) => !left(s.storeId))
        .map(({ storeId, totals: t, deltas: d }) => {
          const s = stores.get(storeId);
          const health = storeHealth(t);
          return {
            store: `${s?.name ?? storeId}${storeId === ctx.store.id ? ' (this store)' : ''}`, platform: s?.platform, niche: s?.niche,
            revenue: r2(t.revenue), profit: r2(t.profit), margin_pct: health.marginPct, ad_spend: r2(t.adSpend), roas: t.roas, orders: t.orders,
            revenue_change_pct: d.revenue, health: health.status,
          };
        })
        .sort((a, b) => b.revenue - a.revenue);
      const note = skipped.length ? `; left out, no exchange rate yet: ${skipped.join(', ')}` : '';
      return `${p.from} to ${p.to}, amounts in ${p.currency ?? 'USD'}${note}\n${csv(rows)}`;
    },
  }),
  defineTool({
    name: 'metrics_timeseries',
    description:
      'Daily revenue, ad spend, COGS, fees (the estimate set for the store), profit (revenue - ad spend - COGS - fees), orders, sessions, add-to-carts and checkouts for the last N days (CSV, oldest first).',
    input: { days: z.number().int().min(1).max(365).default(30) },
    run: async ({ days }, ctx) =>
      csv(
        ctx.db
          .prepare(
            `SELECT date, round(revenue, 2) AS revenue, round(ad_spend, 2) AS ad_spend, round(cogs, 2) AS cogs, round(fees, 2) AS fees,
               round(revenue - ad_spend - cogs - fees, 2) AS profit, orders, sessions, add_to_carts, checkouts
             FROM (SELECT d.*, d.revenue * s.fee_percent / 100 + d.orders * s.fee_per_order AS fees FROM daily_metrics d JOIN stores s ON s.id = d.store_id
                   WHERE d.store_id = ? AND d.date >= ?)
             ORDER BY date`,
          )
          .all(ctx.store.id, since(days, ctx.store)),
      ),
  }),
  defineTool({
    name: 'list_products',
    description:
      'The store catalog, best sellers first: price, compare-at, unit cost, margin % (after unit cost and the fee % set for the store), inventory ("not tracked" when the platform does not count its stock, e.g. dropshipped: not sold out), status, and units / revenue from paid orders in the last 30 days (CSV).',
    input: { status: z.enum(['active', 'draft', 'archived']).optional(), limit: z.number().int().min(1).max(500).default(100) },
    run: async ({ status, limit }, ctx) =>
      csv(
        ctx.db
          .prepare(
            `SELECT p.id, p.title, p.price, p.compare_at, p.cost,
               round(100.0 * (p.price * (1 - (SELECT fee_percent FROM stores WHERE id = p.store_id) / 100.0) - p.cost) / nullif(p.price, 0), 1) AS margin_pct,
               CASE WHEN p.inventory_tracked THEN p.inventory ELSE 'not tracked' END AS inventory, p.status,
               coalesce(s.units, 0) AS units_30d, round(coalesce(s.revenue, 0), 2) AS revenue_30d
             FROM products p LEFT JOIN (
               SELECT i.product_id, sum(i.quantity) AS units, sum(i.revenue) AS revenue
               FROM order_items i JOIN orders o ON o.store_id = i.store_id AND o.id = i.order_id
               WHERE i.store_id = ? AND o.status = 'paid' AND o.local_date >= ? GROUP BY i.product_id
             ) s ON s.product_id = p.id
             WHERE p.store_id = ? ${status ? 'AND p.status = ?' : ''} ORDER BY revenue_30d DESC, p.title LIMIT ?`,
          )
          .all(...([ctx.store.id, since(30, ctx.store), ctx.store.id, ...(status ? [status] : []), limit] as string[])),
      ),
  }),
  defineTool({
    name: 'list_orders',
    description:
      'Orders from the last N days, newest first, with fulfillment status, supplier and tracking (CSV), plus counts per fulfillment status and a ' +
      'scorecard per supplier over all orders in the window (unfulfilled 3+ days, in transit 10+ days, refunded, open issues).',
    input: {
      days: z.number().int().min(1).max(90).default(14),
      fulfillment: z.enum(['unfulfilled', 'fulfilled', 'in_transit', 'delivered']).optional(),
      limit: z.number().int().min(1).max(500).default(100),
    },
    run: async ({ days, fulfillment, limit }, ctx) => {
      // Real orders carry the shop's own date (local_date); demo ones only a timestamp.
      const from = since(days, ctx.store);
      const counts = ctx.db
        .prepare('SELECT fulfillment_status AS status, count(*) AS n FROM orders WHERE store_id = ? AND coalesce(local_date, substr(created_at, 1, 10)) >= ? GROUP BY 1 ORDER BY 2 DESC')
        .all(ctx.store.id, from);
      const rows = ctx.db
        .prepare(
          `SELECT id, created_at, total, status, fulfillment_status, supplier, tracking FROM orders
           WHERE store_id = ? AND coalesce(local_date, substr(created_at, 1, 10)) >= ? ${fulfillment ? 'AND fulfillment_status = ?' : ''} ORDER BY created_at DESC LIMIT ?`,
        )
        .all(...([ctx.store.id, from, ...(fulfillment ? [fulfillment] : []), limit] as string[]));
      const suppliers = ctx.db
        .prepare(
          `SELECT coalesce(o.supplier, '(none)') AS supplier, count(*) AS orders,
             sum(o.fulfillment_status = 'unfulfilled' AND o.created_at < ?) AS unfulfilled_3d_plus,
             sum(o.fulfillment_status = 'in_transit' AND o.created_at < ?) AS in_transit_10d_plus,
             sum(o.status = 'refunded') AS refunded,
             sum(EXISTS (SELECT 1 FROM order_issues i WHERE i.store_id = o.store_id AND i.order_id = o.id AND i.status = 'open')) AS open_issues
           FROM orders o WHERE o.store_id = ? AND coalesce(o.local_date, substr(o.created_at, 1, 10)) >= ? GROUP BY 1 ORDER BY 2 DESC`,
        )
        .all(ago(3), ago(10), ctx.store.id, from);
      return [
        `counts: ${counts.map((c) => `${c.status} ${c.n}`).join(', ') || 'none'}`,
        '# By supplier',
        csv(suppliers),
        '# Orders',
        csv(rows),
      ].join('\n');
    },
  }),
  defineTool({
    name: 'list_campaigns',
    description: 'Ad campaigns with totals over the last N days: spend, revenue, ROAS, purchases, CPA, clicks, impressions, CTR (CSV, biggest spend first).',
    input: { days: z.number().int().min(1).max(90).default(7) },
    run: async ({ days }, ctx) => {
      const rows = ctx.db
        .prepare(
          `SELECT c.network, c.id, c.name, c.status, c.daily_budget, coalesce(sum(d.spend), 0) AS spend, coalesce(sum(d.revenue), 0) AS revenue,
             coalesce(sum(d.purchases), 0) AS purchases, coalesce(sum(d.clicks), 0) AS clicks, coalesce(sum(d.impressions), 0) AS impressions
           FROM campaigns c LEFT JOIN campaign_daily d ON d.network = c.network AND d.campaign_id = c.id AND d.date >= ?
           WHERE c.store_id = ? GROUP BY c.network, c.id ORDER BY spend DESC`,
        )
        .all(since(days, ctx.store), ctx.store.id);
      return csv(
        rows.map((r) => {
          const [spend, revenue, purchases, clicks, impressions] = [r.spend, r.revenue, r.purchases, r.clicks, r.impressions].map(Number) as number[];
          return {
            ...r,
            spend: r2(spend!),
            revenue: r2(revenue!),
            roas: spend ? r2(revenue! / spend) : 0,
            cpa: purchases ? r2(spend! / purchases) : '',
            ctr_pct: impressions ? r2((100 * clicks!) / impressions) : '',
          };
        }),
      );
    },
  }),
  defineTool({
    name: 'list_competitors',
    description: "Tracked competitors of this store, their recent price changes, and the ads they are running (three CSV sections).",
    input: {},
    run: async (_, ctx) => {
      if (!ctx.competitors) return 'Competitor tracking is not available.';
      const { competitors, priceChanges, ads } = ctx.competitors(ctx.store.id);
      const name = new Map(competitors.map((c) => [c.id, c.name]));
      return [
        '# Competitors',
        csv(competitors.map((c) => ({ name: c.name, url: c.url, products_tracked: c.productsTracked, active_ads: c.activeAds, notes: c.notes ?? '' }))),
        '# Price changes (newest first)',
        csv(priceChanges.map((p) => ({ competitor: name.get(p.competitorId) ?? p.competitorId, product: p.product, from: p.from, to: p.to, change_pct: r2(p.changePct), at: p.at.slice(0, 10) }))),
        '# Recent ads',
        csv(ads.map((a) => ({ competitor: a.competitor, network: a.network, format: a.format, headline: a.headline, body: a.body, cta: a.cta ?? '', first_seen: a.firstSeen, last_seen: a.lastSeen }))),
      ].join('\n');
    },
  }),
  defineTool({
    name: 'record_product_find',
    description:
      'Add a product you found (web, marketplaces, supplier sites) to the research feed so it gets the same AI score as the feed and the owner sees it there. Returns the scored row. Use real numbers; estimate trend/competition only with a stated basis.',
    input: {
      title: z.string().min(3).max(120),
      category: z.string().min(2).max(60),
      source: z.enum(['tiktok', 'shopify', 'amazon', 'aliexpress']).describe('where you saw it selling'),
      cost: z.number().positive().describe('supplier cost incl. shipping, USD'),
      price: z.number().positive().describe('suggested sell price, USD'),
      compareAt: z.number().positive().describe('USD'),
      trend: z.number().describe('demand growth over the last 30 days, %'),
      competition: z.number().min(0).max(100).describe('0-100, lower = fewer competing sellers/ads'),
      shippingDays: z.number().int().min(1).max(60),
      image: z.string().url().optional(),
    },
    run: async (find, ctx) => {
      if (!ctx.recordFind) return 'The research feed is not available.';
      const p = await ctx.recordFind({ ...find, niche: ctx.store.niche });
      return `Added to the research feed as ${p.id}: AI score ${p.score} (margin ${p.scoreParts.margin}, trend ${p.scoreParts.trend}, competition ${p.scoreParts.competition}, shipping ${p.scoreParts.shipping}), margin ${p.margin}%.`;
    },
  }),
  defineTool({
    name: 'search_suppliers',
    description:
      'Supplier listings (CJ Dropshipping) for a product keyword: SKU, title, supplier price in USD before shipping (lowest variant) and how many sellers list it (CSV). Use it for a real cost before pricing a candidate.',
    input: { q: z.string().min(2).max(80), limit: z.number().int().min(1).max(20).optional() },
    run: async ({ q, limit }, ctx) => {
      if (!ctx.searchSuppliers) return 'Supplier search is not available.';
      const rows = await ctx.searchSuppliers(q, limit ?? 10);
      if (!rows.length) return `No supplier listings for "${q}".`;
      const table = csv(rows.map((p) => ({ sku: p.sku, title: p.title, price_usd: p.price, listed_by_sellers: p.listed })));
      return `${rows[0]!.demo ? '# Demo supplier data (CJ is not connected)\n' : ''}${await usdNote(ctx)}${table}`;
    },
  }),
  defineTool({
    name: 'research_feed',
    description:
      'Trending product candidates with cost, price (USD), margin %, 30-day demand trend %, competition (0-100, lower is better), shipping days and AI score (CSV, best first). Defaults to the store niche.',
    input: {
      tab: z.enum(RESEARCH_TABS as [ResearchTab, ...ResearchTab[]]).optional(),
      q: z.string().optional().describe('search title/category'),
      anyNiche: z.boolean().default(false).describe('search outside the store niche'),
      limit: z.number().int().min(1).max(100).default(25),
    },
    run: async ({ tab, q, anyNiche, limit }, ctx) => {
      if (!ctx.research) return 'The research feed is not available.';
      const items = await ctx.research({ tab, q, limit, ...(anyNiche ? {} : { niche: ctx.store.niche }) });
      return (await usdNote(ctx)) + csv(
        items.map((p) => ({ id: p.id, title: p.title, category: p.category, source: p.source, cost: p.cost, price: p.price, compare_at: p.compareAt, margin_pct: p.margin, trend_pct: p.trend, competition: p.competition, shipping_days: p.shippingDays, score: p.score })),
      );
    },
  }),
  defineTool({
    name: 'squad_log',
    description:
      "What this store's squad did in the last N days: requests to the owner with the decision, finished runs with the gist of each answer, and the measured outcomes of approved changes (CSV).",
    input: { days: z.number().int().min(1).max(30).default(7) },
    run: async ({ days }, ctx) => {
      // Timestamps (UTC), not store dates: a store-local date would cut its early morning. A live store's log starts
      // when it went live: what the squad did on demo data before isn't its track record.
      const live = String(ctx.db.prepare('SELECT at FROM done_once WHERE ref = ?').get(`activate:${ctx.store.id}`)?.at ?? '');
      const from = [ago(days), live].sort().at(-1)!;
      const who = (agentId: string) => AGENT_ROLES[agentId.split(':')[1] as AgentRole]?.name ?? agentId;
      const requests = ctx.db
        .prepare(`SELECT created_at, agent_id, title, status, json_extract(action_json, '$.auto') AS auto FROM approvals WHERE store_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 50`)
        .all(ctx.store.id, from)
        .map((r) => ({ date: String(r.created_at).slice(0, 10), agent: who(String(r.agent_id)), title: r.title, decision: r.auto ? 'auto-approved' : r.status }));
      const runs = ctx.db
        .prepare(`SELECT created_at, agent_id, task, transcript_json FROM agent_runs WHERE store_id = ? AND status = 'done' AND created_at >= ? ORDER BY created_at DESC LIMIT 40`)
        .all(ctx.store.id, from)
        .map((r) => ({ date: String(r.created_at).slice(0, 10), agent: who(String(r.agent_id)), task: String(r.task).slice(0, 120), gist: runGist(JSON.parse(String(r.transcript_json))) ?? '' }));
      // What the outcome checks measured for approved changes (did they work), from the squad's memory.
      const outcomes = ctx.db
        .prepare(`SELECT created_at, agent_id, text FROM store_memory WHERE store_id = ? AND created_at >= ? AND tags LIKE '%"outcome"%' ORDER BY created_at DESC LIMIT 20`)
        .all(ctx.store.id, from)
        .map((r) => ({ date: String(r.created_at).slice(0, 10), agent: who(String(r.agent_id)), result: r.text }));
      return `requests:\n${csv(requests)}\n\nruns:\n${csv(runs)}\n\noutcomes:\n${csv(outcomes)}`;
    },
  }),
  defineTool({
    name: 'list_creatives',
    description: "The store's creatives library, newest first: ads and copy the Creative Studio and Copywriter saved, ready to launch (CSV).",
    input: { kind: z.enum(['image', 'video', 'ugc', 'copy']).optional(), limit: z.number().int().min(1).max(100).default(20) },
    run: async ({ kind, limit }, ctx) =>
      csv(
        listCreatives(ctx.db, { storeIds: [ctx.store.id], ...(kind ? { kind } : {}), limit }).map((c) => ({
          id: c.id, created: c.createdAt.slice(0, 10), kind: c.kind, aspect: c.aspect ?? '', headline: c.headline, primary_text: c.primaryText, cta: c.cta ?? '',
          // ponytail: demo renders are data: URLs; the owner previews media in the app, agents only need to know it exists.
          media: c.mediaUrl ? c.source : 'none',
        })),
      ),
  }),
  defineTool({
    name: 'create_creative',
    description:
      'Save an ad to the creatives library. kind "copy" saves ad copy right away. image/video/ugc generate media: costs generation credits (image 2, video 20, ugc 40), checks the daily credit cap and asks the owner first.',
    input: {
      kind: z.enum(['image', 'video', 'ugc', 'copy']),
      headline: z.string().min(2).max(80),
      primaryText: z.string().min(2).max(500).describe('the ad body copy'),
      cta: z.string().max(30).optional(),
      prompt: z.string().max(1000).optional().describe('visual brief for media kinds: subject, setting, style, motion, hook in the first second'),
      aspect: z.enum(['1:1', '4:5', '9:16', '16:9']).default('1:1'),
    },
    run: async ({ kind, headline, primaryText, cta, prompt, aspect }, ctx) => {
      const base = { storeId: ctx.store.id, agentId: ctx.agent.id, ...(ctx.runId ? { runId: ctx.runId } : {}), kind, headline, primaryText, ...(cta ? { cta } : {}) };
      if (kind === 'copy') return `Saved ad copy to the library (${saveCreative(ctx.db, { ...base, credits: 0, source: 'agent' }).id}).`;
      if (!prompt) return 'Not generated: media needs a prompt (the visual brief).';
      const credits = CREDITS[kind];
      const used = creditsToday(ctx.db, ctx.store.id);
      const asked = creditsAsked(ctx.db, ctx.store.id);
      const cap = ctx.caps?.(ctx.store.id).higgsfieldCreditsPerDay ?? Infinity;
      if (used + asked + credits > cap) {
        return `Not generated: it needs ${credits} credits and ${used} of today's ${cap}-credit cap are used${asked ? ` (${asked} more asked, waiting on the owner)` : ''}. Suggest it for tomorrow instead.`;
      }
      const { approved, message } = await requestApproval(ctx, {
        title: `Generate ${aspect} ${kind} ad: ${headline}`.slice(0, 80),
        reason: `${credits} generation credits (${used}/${cap} used today). Brief: ${prompt}`.slice(0, 400),
        action: { kind: 'creative.generate', payload: { kind, aspect, prompt, headline, primaryText, cta, credits } },
      });
      if (!approved) return message;
      // Other renders may have been approved while this one waited.
      const now = creditsToday(ctx.db, ctx.store.id);
      if (now + credits > cap) return `${message}, but not generated: other renders used ${now} of today's ${cap}-credit cap meanwhile. Suggest it for tomorrow instead.`;
      // ponytail: charged before the render, so a failure after Higgsfield took it (timeout, download) still counts; a
      // request it refused counts too, on the cap's side.
      chargeCredits(ctx.db, ctx.store.id, credits);
      let mediaUrl: string | undefined;
      try {
        mediaUrl = await ctx.generateMedia?.({ kind, aspect, prompt }, ctx.signal);
      } catch (e) {
        return `${message}, but generation failed: ${(e as Error).message}. Nothing was saved; its ${credits} credits still count toward today's cap (Higgsfield may have charged them), so don't retry it unasked.`;
      }
      if (mediaUrl) {
        const saved = saveCreative(ctx.db, { ...base, aspect, prompt, credits, source: 'higgsfield', mediaUrl });
        return `${message}. Rendered on Higgsfield and saved to the library (${saved.id}).`;
      }
      const saved = saveCreative(ctx.db, { ...base, aspect, prompt, credits, source: 'demo', mediaUrl: demoMedia(ctx.store, { kind, aspect, headline, cta }) });
      return `${message}. Higgsfield isn't connected, so this is a demo render, saved to the library (${saved.id}).`;
    },
  }),
  defineTool({
    name: 'list_flows',
    description: "The store's flow library: email/SMS flows already drafted, newest first, with their trigger and steps (CSV).",
    input: {},
    run: async (_, ctx) =>
      csv(
        listFlowDrafts(ctx.db, { storeIds: [ctx.store.id] }).map((f) => ({
          name: f.name, drafted: f.createdAt.slice(0, 10), trigger: f.trigger, steps: f.messages.length,
          channels: [...new Set(f.messages.map((m) => m.channel))].join('+'), last_step_hours: Math.max(...f.messages.map((m) => m.delayHours)),
        })),
      ),
  }),
  defineTool({
    name: 'draft_flow',
    description:
      'Save an email/SMS flow to the flow library for the owner to set up in their email/SMS tool (nothing is sent from here). A newer draft with the same name replaces the old one.',
    input: {
      name: z.string().min(3).max(80).describe('e.g. "Checkout abandonment"'),
      trigger: z.string().min(10).max(300).describe('entry event, timing and exclusions'),
      messages: z
        .array(
          z.object({
            delayHours: z.number().min(0).max(24 * 120),
            channel: z.enum(['email', 'sms']),
            subject: z.string().max(80).optional(),
            preview: z.string().max(120).optional(),
            body: z.string().min(10).max(4000).describe('email: content bullets or full copy; sms: the full text with opt-out'),
            offer: z.string().max(120).optional(),
          }),
        )
        .min(1)
        .max(8),
      notes: z.string().min(10).max(1000).describe('why this flow and its sizing: triggers/month × conversion × AOV'),
    },
    run: async (f, ctx) => {
      if (f.messages.some((m) => m.channel === 'email' && !m.subject)) return 'Every email step needs a subject.';
      const flow = saveFlowDraft(ctx.db, { storeId: ctx.store.id, agentId: ctx.agent.id, ...(ctx.runId ? { runId: ctx.runId } : {}), ...f });
      return `Saved "${flow.name}" (${flow.messages.length} steps) to the flow library. The owner sets it up in their email/SMS tool.`;
    },
  }),
  defineTool({
    name: 'list_order_issues',
    description:
      "The store's order issue queue (CSV): open issues first, then resolved ones with the owner's resolution, which says what actually fixed it.",
    input: { status: z.enum(['open', 'resolved']).optional(), limit: z.number().int().min(1).max(200).default(50) },
    run: async ({ status, limit }, ctx) =>
      csv(
        listOrderIssues(ctx.db, { storeIds: [ctx.store.id], ...(status ? { status } : {}), limit }).map((i) => ({
          order_id: i.orderId, kind: i.kind, severity: i.severity, status: i.status, opened: i.createdAt.slice(0, 10), resolved: i.resolvedAt?.slice(0, 10) ?? '',
          note: i.note, suggested_action: i.suggestedAction ?? '', resolution: i.resolution ?? '',
        })),
      ),
  }),
  defineTool({
    name: 'flag_order_issue',
    description:
      "Put an order problem in the owner's issue queue (Orders & Fulfillment): late or stuck shipments, refund requests, supplier problems, bad addresses. One open issue per order and kind; flagging it again at a higher severity raises the open one, otherwise returns it.",
    input: {
      orderId: z.string(),
      kind: z.enum(['late', 'stuck', 'refund', 'supplier', 'address', 'other']),
      severity: z.enum(['low', 'medium', 'high']).describe('high = customer already waiting past the promise or money at risk'),
      note: z.string().min(10).max(500).describe('the facts: days since order, fulfillment status, supplier, tracking'),
      suggestedAction: z.string().max(300).optional().describe('the next step, e.g. "Email CJ for tracking; offer the customer 10% if not shipped by Friday"'),
    },
    run: async ({ orderId, ...i }, ctx) => {
      if (!ctx.db.prepare('SELECT 1 FROM orders WHERE store_id = ? AND id = ?').get(ctx.store.id, orderId)) return `No order ${orderId} in this store. Use list_orders for ids.`;
      const { issue, created, raised } = flagOrderIssue(ctx.db, { storeId: ctx.store.id, agentId: ctx.agent.id, orderId, ...i });
      if (created) return `Flagged order ${orderId} (${i.kind}, ${i.severity}) in the issue queue (${issue.id}).`;
      return raised ? `Raised order ${orderId}'s open ${i.kind} issue (${issue.id}) to ${i.severity}.` : `Order ${orderId} already has an open ${i.kind} issue (${issue.id}): ${issue.note}`;
    },
  }),
  defineTool({
    name: 'list_themes',
    description: "The store's Shopify themes (CSV). role MAIN is the live one; preview_url opens the storefront with that theme.",
    input: {},
    run: async (_, ctx) => {
      if (!ctx.themes) return 'Theme editing is not available in this run.';
      try {
        return csv((await ctx.themes.list(ctx.store.id)).map((t) => ({ id: t.id, name: t.name, role: t.role, processing: t.processing, preview_url: t.previewUrl })));
      } catch (e) {
        return (e as Error).message;
      }
    },
  }),
  defineTool({
    name: 'read_theme_files',
    description: 'Read theme files by name, e.g. "sections/main-product.liquid" or "templates/*.json". The live theme unless themeId is given.',
    input: { filenames: z.array(z.string().min(3).max(200)).min(1).max(20), themeId: z.string().optional() },
    run: async ({ filenames, themeId }, ctx) => {
      if (!ctx.themes) return 'Theme editing is not available in this run.';
      try {
        const files = await ctx.themes.read(ctx.store.id, filenames, themeId);
        // ponytail: 15k characters per file keeps a run's context sane; a bigger file is cut, read it on its own if needed.
        const text = (c: string | null) => (c === null ? '(binary)' : c.length > 15_000 ? `${c.slice(0, 15_000)}\n… (cut at 15,000 of ${c.length} characters)` : c);
        return files.map((f) => `=== ${f.filename} ===\n${text(f.content)}`).join('\n\n') || 'No matching files.';
      } catch (e) {
        return (e as Error).message;
      }
    },
  }),
  defineTool({
    name: 'draft_theme_change',
    description:
      'Change the storefront theme safely: copies the live theme, writes your files to the copy and asks the owner to publish it, with a preview link. ' +
      'Send whole files (read them first). The live theme is never edited; layout/ and config/ stay with the owner.',
    input: {
      title: z.string().min(5).max(60).describe('e.g. "Sticky add-to-cart on mobile"'),
      summary: z.string().min(10).max(400).describe('what changes for shoppers and why, with the evidence'),
      files: z
        .array(
          z.object({
            filename: z.string().regex(/^(?!.*\.\.)(sections|snippets|templates|blocks|assets|locales)\/[\w.\-/]+$/, 'only sections/, snippets/, templates/, blocks/, assets/ or locales/ files'),
            body: z.string().min(1).max(200_000),
          }),
        )
        .min(1)
        .max(20),
    },
    run: async ({ title, summary, files }, ctx) => {
      if (!ctx.themes) return 'Theme editing is not available in this run.';
      if (ctx.agent.autonomy === 'suggest') return 'Not sent: your autonomy is "suggest". Put the change in your answer instead.'; // before copying a theme for nothing
      // Each draft is a full copy of the live theme (Shopify keeps 20 themes at most): one waiting at a time.
      const pending = ctx.db
        .prepare(`SELECT 1 FROM approvals WHERE store_id = ? AND status = 'pending' AND json_extract(action_json, '$.kind') = 'store.publish_theme'`)
        .get(ctx.store.id);
      if (pending) return 'Not sent: a theme change is already waiting for the owner. One at a time.';
      let copy: Theme;
      try {
        copy = await ctx.themes.draft(ctx.store.id, `Frontline: ${title}`.slice(0, 50), files);
      } catch (e) {
        return `Not sent: ${(e as Error).message}`;
      }
      const { approved, message } = await requestApproval(ctx, {
        title: `Publish theme change: ${title}`.slice(0, 80),
        reason: `${summary} Preview: ${copy.previewUrl} . Publishing makes the copy "${copy.name}" the live theme; edits made to the live theme after ${new Date().toISOString().slice(0, 10)} are not in it.`,
        action: { kind: 'store.publish_theme', payload: { themeId: copy.id, name: copy.name, previewUrl: copy.previewUrl, files: files.map((f) => f.filename) } },
      });
      return approved ? `${message}. "${copy.name}" goes live now; compare the same funnel stage over an equal window before calling it.` : message;
    },
  }),
  defineTool({
    name: 'draft_page',
    description:
      'Save a complete page draft to the Store Builder for the owner to review: a product page (kind product + productId from list_products) or a store page (about, FAQ, shipping, landing). Nothing goes live until publish_page is approved.',
    input: {
      kind: z.enum(['product', 'page']),
      productId: z.string().optional().describe('required for kind product'),
      title: z.string().min(2).max(120),
      html: z.string().min(20).max(20_000).describe('the page body as clean HTML: headings, paragraphs, lists; no scripts or styles'),
      seoTitle: z.string().max(70).optional(),
      seoDescription: z.string().max(160).optional(),
      notes: z.string().min(10).max(1000).describe('change list: what changed vs the live page and why, with the numbers'),
    },
    run: async ({ kind, productId, ...d }, ctx) => {
      if (kind === 'product' && !productId) return 'productId is required for a product page.';
      const bad = unsafeHtml(d.html);
      if (bad) return `Not saved: ${bad} in a storefront page. Use headings, paragraphs, lists, tables, images and http(s) links only.`;
      if (productId && !ctx.db.prepare('SELECT 1 FROM products WHERE store_id = ? AND id = ?').get(ctx.store.id, productId)) return `No product ${productId} in this store. Use list_products for ids.`;
      // One page per product at a time: overlapping page changes can't be judged apart (14 days of sales after publishing).
      const prior = kind === 'product' ? listPageDrafts(ctx.db, { storeIds: [ctx.store.id], limit: 1000 }).find((d) => d.productId === productId && d.status !== 'rejected') : undefined;
      if (prior && prior.status !== 'published') return `Not saved: this product already has a page draft ${prior.status === 'draft' ? 'in' : `${prior.status} in`} Store Builder (${prior.id}). The owner publishes or rejects it first; work on another product.`;
      if (prior?.publishedAt && prior.publishedAt.slice(0, 10) >= since(29, ctx.store)) return `Not saved: this product's page went live on ${prior.publishedAt.slice(0, 10)} and is judged after 14 days of sales; work on another product.`;
      const draft = savePageDraft(ctx.db, { storeId: ctx.store.id, agentId: ctx.agent.id, ...(ctx.runId ? { runId: ctx.runId } : {}), kind, ...(productId ? { productId } : {}), ...d });
      return `Saved draft ${draft.id} to the Store Builder. When it's ready, ask to publish it with publish_page.`;
    },
  }),
  defineTool({
    name: 'publish_page',
    description: 'Ask the owner to publish a Store Builder draft to the store. Waits for the decision; on approval it goes live on the store.',
    input: { draftId: z.string() },
    run: async ({ draftId }, ctx) => {
      const d = getPageDraft(ctx.db, draftId);
      if (!d || d.storeId !== ctx.store.id) return `No draft ${draftId} in this store.`;
      if (d.status !== 'draft' && d.status !== 'rejected') return `That draft is already ${d.status}.`;
      const no = noStoreWrites(ctx.store, d.kind === 'product' && d.productId ? PRODUCT_PAGE_PLATFORMS : PRODUCT_WRITE_PLATFORMS);
      if (no) return no;
      const { approved, message } = await requestApproval(ctx, {
        title: `Publish "${d.title}"`.slice(0, 80),
        reason: d.notes.slice(0, 400),
        action: { kind: 'store.publish_page', payload: { draftId: d.id, title: d.title, ...(d.productId ? { productId: d.productId } : {}) } },
      });
      return approved ? `${message}. Publishing it now.` : message;
    },
  }),
  defineTool({
    name: 'promote_niche_learning',
    description:
      "Propose sharing a learning that has held up in this store with every store of the same niche: once the owner approves, all their agents see it. Only for durable, evidence-backed findings that aren't specific to this store's brand or products.",
    input: {
      text: z.string().min(10).max(300).describe('one sentence, true for any store in this niche'),
      evidence: z.string().min(10).max(300).describe('the numbers, the period and where it was learned'),
    },
    run: async ({ text, evidence }, ctx) => {
      const niche = nicheKey(ctx.store);
      if (listNicheLearnings(ctx.db, niche, 1000).some((l) => l.text.toLowerCase() === text.trim().toLowerCase())) return 'Already shared with this niche.';
      const label = ctx.store.niche === 'other' ? ctx.store.nicheDetail : ctx.store.niche;
      const { approved, message } = await requestApproval(ctx, {
        title: `Share a learning with all ${label} stores`.slice(0, 80),
        reason: `${text} Evidence: ${evidence}`.slice(0, 400),
        action: { kind: 'niche.promote_learning', payload: { niche, text, evidence } },
      });
      if (!approved) return message;
      addNicheLearning(ctx.db, { niche, text, evidence, storeId: ctx.store.id });
      return `${message}. Every ${label} store's squad now sees it.`;
    },
  }),
  defineTool({
    name: 'assign_task',
    description:
      "Hand a concrete task to another agent of this store's squad. It runs right away on the store's AI budget. Include the numbers they need and what done looks like. At most 3 per run; a task assigned to you can't be passed on.",
    input: {
      role: z.enum(Object.keys(AGENT_ROLES) as [AgentRole, ...AgentRole[]]),
      task: z.string().min(10).max(1500),
    },
    run: async ({ role, task }, ctx) => {
      if (!ctx.startRun || !ctx.runId) return 'Assigning tasks is not available here.';
      if (role === ctx.agent.role) return 'That is your own role: do it yourself.';
      if (ctx.db.prepare('SELECT parent_run_id FROM agent_runs WHERE id = ?').get(ctx.runId)?.parent_run_id) {
        return 'This task was assigned to you, so it cannot be passed on. Do it, or say what is blocking it.';
      }
      if (Number(ctx.db.prepare('SELECT count(*) AS n FROM agent_runs WHERE parent_run_id = ?').get(ctx.runId)?.n) >= 3) return 'Not assigned: 3 tasks per run is the limit.';
      const name = AGENT_ROLES[role].name;
      const run = ctx.startRun(`${ctx.store.id}:${role}`, `${task}\n\n(Assigned by the ${AGENT_ROLES[ctx.agent.role].name}.)`, ctx.runId);
      return typeof run === 'string' ? `Not assigned to the ${name}: ${run}` : `Assigned to the ${name} (run ${run.id}, ${run.status}).`;
    },
  }),
  defineTool({
    name: 'review_campaigns',
    description:
      'Judge every campaign against break-even ROAS (from 30-day margin after product cost and the fee estimate set for the store): verdict scale / hold / cut / pause / learning (not enough spend yet) / paused, with a suggested daily budget. Start every ad review here.',
    input: { days: z.number().int().min(3).max(30).default(7) },
    run: async ({ days }, ctx) => {
      const econ = economics(ctx.db, ctx.store.id, since(30, ctx.store));
      const t = thresholds(econ);
      const rows = campaignStats(ctx, days);
      return [
        `margin after cost and fees ${r2(econ.margin * 100)}%, AOV ${r2(econ.aov)}, break-even ROAS ${r2(t.breakEven)}, target ROAS ${r2(t.target)}, max CPA ${r2(t.maxCpa)} (30 days); campaigns over ${days} days:`,
        csv(
          reviewCampaigns(rows, econ).map((c) => ({
            network: c.network, id: c.id, name: c.name, status: c.status, daily_budget: c.dailyBudget, spend: r2(c.spend), roas: c.roas, cpa: c.cpa ?? '',
            purchases: c.purchases, verdict: c.verdict, suggested_budget: c.suggestedBudget,
          })),
        ),
      ].join('\n');
    },
  }),
  defineTool({
    name: 'propose_ad_change',
    description:
      "Ask the owner to pause a campaign or change its daily budget, with the evidence. Checks the store's daily cap on added ad spend, then waits for the decision. Applied to the ad account once approved.",
    input: {
      campaignId: z.string(),
      change: z.enum(['pause', 'budget']),
      newDailyBudget: z.number().min(1).optional().describe('required for budget'),
      evidence: z.string().min(10).max(400).describe('the numbers and window, e.g. "7d ROAS 3.4 vs break-even 2.1, 41 purchases"'),
    },
    run: async ({ campaignId, change, newDailyBudget, evidence }, ctx) => {
      const c = ctx.db.prepare('SELECT * FROM campaigns WHERE id = ? AND store_id = ?').get(campaignId, ctx.store.id);
      if (!c) return `No campaign ${campaignId} in this store. Use review_campaigns for ids.`;
      const waiting = ctx.db
        .prepare(`SELECT title FROM approvals WHERE store_id = ? AND status = 'pending' AND json_extract(action_json, '$.kind') IN ('ads.set_budget', 'ads.pause_campaign') AND json_extract(action_json, '$.payload.campaignId') = ?`)
        .get(ctx.store.id, campaignId);
      if (waiting) return `Not sent: "${waiting.title}" is already waiting for the owner. One change per campaign at a time.`;
      const from = Number(c.daily_budget);
      if (change === 'budget' && newDailyBudget === undefined) return 'newDailyBudget is required for a budget change.';
      const to = change === 'pause' ? 0 : Math.round(newDailyBudget!);
      // Autopilot caps bound the budget a change touches (a pause stops all of it); the added-spend cap counts raises only.
      // ponytail: no rate → no amount, so the caps can't be checked and autopilot can't take it: the owner decides.
      const usd = await inUsd(ctx, change === 'pause' ? from : Math.abs(to - from));
      const addedUsd = to > from ? usd : 0;
      const cap = ctx.caps?.(ctx.store.id).adSpendChangePerDay;
      const addedToday = addedUsd ? budgetAddedToday(ctx.db, ctx.store.id) : 0;
      if (cap !== undefined && addedUsd && addedToday + addedUsd > cap) {
        const more = ctx.store.currency === 'USD' ? '' : ` (${cash(to - from, ctx.store.currency)})`;
        return `Not sent: +$${addedUsd}${more}/day would pass the owner's $${cap}/day cap on added ad spend ($${addedToday} already approved today). Propose a smaller step.`;
      }
      const amount = usd !== undefined ? { amountUsd: usd } : {};
      const { approved, message } = await requestApproval(ctx, {
        title: (change === 'pause' ? `Pause ${c.name}` : `${to > from ? 'Raise' : 'Lower'} ${c.name} budget ${cash(from, ctx.store.currency)} → ${cash(to, ctx.store.currency)}/day`).slice(0, 80),
        reason: evidence,
        autopilot: true,
        action: change === 'pause'
          ? { kind: 'ads.pause_campaign', payload: { network: c.network, campaignId, from }, ...amount }
          : { kind: 'ads.set_budget', payload: { network: c.network, campaignId, from, to, ...(addedUsd !== undefined ? { addedUsd } : {}) }, ...amount },
      });
      return approved ? `${message}. It will be applied to the ad account.` : message;
    },
  }),
  defineTool({
    name: 'propose_price_change',
    description:
      "Ask the owner to test a new price for a product, with the evidence. Applied to the store once approved, then judged on the product's profit (after unit cost and the store's fee %) in the 14 days after vs the 14 before.",
    input: {
      productId: z.string(),
      newPrice: z.number().positive(),
      compareAt: z.number().positive().optional().describe('new compare-at price; omit to keep the current one'),
      evidence: z.string().min(10).max(400).describe('the numbers and window, e.g. "converts 3.1% at $29.99 vs competitors at $34-39, margin 62%"'),
    },
    run: async ({ productId, newPrice, compareAt, evidence }, ctx) => {
      const no = noStoreWrites(ctx.store, PRICE_WRITE_PLATFORMS);
      if (no) return no;
      const p = ctx.db.prepare('SELECT * FROM products WHERE store_id = ? AND id = ?').get(ctx.store.id, productId);
      if (!p) return `No product ${productId} in this store. Use list_products for ids.`;
      const [from, to] = [Number(p.price), r2(newPrice)];
      const $ = (n: number) => cash(n, ctx.store.currency);
      if (to === from) return `${$(to)} is already the price.`;
      // The lowest price that still covers the unit and the store's fee estimate. ponytail: the per-order fee is counted
      // per unit, so a multi-unit order's floor is a little high.
      const fees = ctx.store.feePercent || ctx.store.feePerOrder;
      const floor = p.cost == null ? undefined : r2((Number(p.cost) + (ctx.store.feePerOrder ?? 0)) / (1 - (ctx.store.feePercent ?? 0) / 100));
      if (floor !== undefined && to <= floor) return `Not sent: ${$(to)} is at or below the unit cost${fees ? ' plus fees' : ''} (${$(floor)}).`;
      if (Math.abs(to - from) / from > 0.3) return 'Not sent: test within ±30% of the current price, one step at a time.';
      if (compareAt !== undefined && compareAt <= to) return 'compareAt must be above the new price.';
      if (compareAt !== undefined && ctx.store.connected && ctx.store.platform === 'etsy') return 'Not sent: Etsy has no compare-at price. Propose the price alone; a sale is set in Etsy Shop Manager (Marketing → Sales and discounts).';
      // Overlapping tests on one product can't be judged apart.
      const running = ctx.db.prepare('SELECT changed_on FROM price_tests WHERE store_id = ? AND product_id = ? AND changed_on >= ?').get(ctx.store.id, productId, since(29, ctx.store));
      if (running) return `Not sent: a price test on this product has been running since ${running.changed_on}; it is judged after 14 days of sales.`;
      const pending = ctx.db
        .prepare(`SELECT 1 FROM approvals WHERE store_id = ? AND status = 'pending' AND json_extract(action_json, '$.kind') = 'store.set_price' AND json_extract(action_json, '$.payload.productId') = ?`)
        .get(ctx.store.id, productId);
      if (pending) return 'Not sent: a price change for this product is already waiting for the owner.';
      const { approved, message } = await requestApproval(ctx, {
        title: `Price ${String(p.title)} ${$(from)} → ${$(to)}`.slice(0, 80),
        reason: evidence,
        action: { kind: 'store.set_price', payload: { productId, title: String(p.title), from, to, ...(compareAt ? { compareAt: r2(compareAt) } : {}) } },
      });
      return approved ? `${message}. It will be applied to the store and judged on 14 days of sales after vs before.` : message;
    },
  }),
  defineTool({
    name: 'search_memory',
    description: 'What the squad has learned about this store, most relevant first.',
    input: { query: z.string().describe('what you need to know'), k: z.number().int().min(1).max(20).default(8) },
    run: async ({ query, k }, ctx) => {
      const found = searchMemory(ctx.db, ctx.store.id, query, k);
      return found.map((m) => `- ${m.text}${m.evidence ? ` Evidence: ${m.evidence}.` : ''} (${m.kind}, confidence ${m.confidence})`).join('\n') || '(nothing yet)';
    },
  }),
  defineTool({
    name: 'write_memory',
    description: 'Save one durable thing learned about this store so the whole squad knows it next time.',
    input: {
      kind: z.enum(['fact', 'learning', 'preference']),
      text: z.string().min(5).max(300).describe('one sentence'),
      evidence: z.string().max(300).optional().describe('the numbers or source behind it'),
      confidence: z.number().min(0).max(1),
      tags: z.array(z.string()).max(6).optional(),
    },
    run: async (args, ctx) => {
      const memory = writeMemory(ctx.db, { ...args, storeId: ctx.store.id, agentId: ctx.agent.id, ...(ctx.runId ? { runId: ctx.runId } : {}) });
      ctx.emit({ type: 'memory_written', memory });
      return 'Saved.';
    },
  }),
  defineTool({
    name: 'request_approval',
    description:
      'Ask the owner to approve an action that spends money, publishes, or changes a live store, ad account or customer-facing system. Waits for the decision.',
    input: {
      title: z.string().max(80).describe('short imperative, e.g. "Pause 2 losing ad sets"'),
      reason: z.string().max(400).describe('the evidence with numbers and period'),
      kind: z
        .string()
        .max(40)
        .describe("action type. Carried out by the app: store.add_products with payload {products: [{researchProductId?, title, price, compareAt?, cost}]} (amounts in the store's currency), save_niche_pack. Anything else (e.g. price_test, customer_message) the owner applies by hand."),
      payload: z.record(z.string(), z.unknown()).describe('everything needed to carry the action out'),
      amount: z.number().min(0).optional().describe("money at stake per day in the store's currency (budget added, spend, refund total); lets autopilot decide within the owner's cap"),
    },
    run: async ({ title, reason, kind, payload, amount }, ctx) => {
      // The app carries these out on approval: only their own tool, which checks the numbers and caps, may ask.
      if (OWN_TOOL[kind]) return `Not sent: ${kind} requests come from ${OWN_TOOL[kind]}, which checks the numbers and the owner's caps. Use it instead.`;
      const no = kind === 'store.add_products' && noStoreWrites(ctx.store);
      if (no) return no;
      const amountUsd = amount === undefined ? undefined : await inUsd(ctx, amount);
      // Nothing in the app carries some kinds out (price tests, customer messages...): the owner does, so say so up front.
      const manual = !ACTIONS[kind] && !OUTLIVE_RUN.includes(kind);
      const why = manual ? `${reason} (You apply this one yourself; the agent lists the steps.)` : reason;
      const { approved, message } = await requestApproval(ctx, { title, reason: why, action: { kind, payload, ...(amountUsd !== undefined ? { amountUsd } : {}) } });
      if (!approved) return message;
      if (manual) return `${message}. This app can't carry out "${kind}" itself: end your answer with numbered steps the owner can follow to do it.`;
      const outcome = await ACTIONS[kind]?.(payload);
      return `${message}${outcome ? `. ${outcome}` : ''}`;
    },
  }),
];

/**
 * Asks the owner and waits. `suggest` agents may not ask. With `autopilot` (only tools that compute the amount
 * themselves pass it), `autopilot` agents approve themselves when the owner enabled autopilot for this action kind on
 * the store and the amount at stake fits what is left of today's cap for that kind (logged on the request as `auto` +
 * a note in the reason).
 */
export async function requestApproval(ctx: ToolContext, req: { title: string; reason: string; action: ApprovalAction; autopilot?: boolean }) {
  const { agent } = ctx;
  if (agent.autonomy === 'suggest') return { approved: false, message: 'Not sent: your autonomy is "suggest". Put the recommendation in your answer instead.' };
  // Going live wiped the demo rows this run read and expired its requests; one more would act on the live store.
  if (!ctx.store.connected && ctx.db.prepare('SELECT connected FROM stores WHERE id = ?').get(ctx.store.id)?.connected === 1) {
    return { approved: false, message: 'Not sent: the store went live during this run, so the demo numbers behind it are gone. Stop here; the owner can ask again on real data.' };
  }
  const { kind, amountUsd: amount } = req.action;
  const rule = req.autopilot && agent.autonomy === 'autopilot' ? ctx.caps?.(ctx.store.id).autopilot[kind] : undefined;
  const cap = rule?.enabled ? rule.maxUsdPerDay : 0;
  const used = rule?.enabled ? autopilotUsedToday(ctx.db, ctx.store.id, kind) : 0;
  const auto = !!rule?.enabled && ctx.decide !== undefined && amount !== undefined && used + amount <= cap;
  const request = ctx.approvals.create({
    storeId: ctx.store.id,
    agentId: agent.id,
    ...(ctx.runId ? { runId: ctx.runId } : {}),
    title: req.title,
    reason: auto ? `${req.reason} [autopilot: $${amount} of $${cap}/day cap, $${used} used before]` : req.reason,
    action: auto ? { ...req.action, auto: true } : req.action,
  });
  if (auto) ctx.decide!(request.id, 'approve');
  else ctx.emit({ type: 'approval_request', approval: request });
  // What the app carries out on approval (OUTLIVE_RUN) doesn't hold the run, and its Claude process, for days.
  const later = !auto && OUTLIVE_RUN.includes(kind) ? new Promise<undefined>((r) => setTimeout(() => r(undefined), PATIENCE_MS).unref?.()) : undefined;
  const decided = await abortable(later ? Promise.race([ctx.approvals.decision(request.id), later]) : ctx.approvals.decision(request.id), ctx.signal);
  if (!decided) return { approved: false, message: `Waiting for the owner: ${req.title}. The app carries it out once approved; don't wait for it, finish your answer.` };
  if (auto) ctx.emit({ type: 'approval_request', approval: decided });
  return decided.status === 'approved'
    ? { approved: true, message: `${auto ? 'Auto-approved (autopilot)' : 'Approved by the owner'}: ${req.title}` }
    : { approved: false, message: `Denied by the owner: ${req.title}. Do not do it; suggest an alternative if useful.` };
}

function campaignStats(ctx: ToolContext, days: number): CampaignStats[] {
  return ctx.db
    .prepare(
      `SELECT c.network, c.id, c.name, c.status, c.daily_budget, coalesce(sum(d.spend), 0) AS spend, coalesce(sum(d.revenue), 0) AS revenue,
         coalesce(sum(d.purchases), 0) AS purchases
       FROM campaigns c LEFT JOIN campaign_daily d ON d.network = c.network AND d.campaign_id = c.id AND d.date >= ?
       WHERE c.store_id = ? GROUP BY c.network, c.id ORDER BY spend DESC`,
    )
    .all(since(days, ctx.store), ctx.store.id)
    .map((r) => ({ network: String(r.network), id: String(r.id), name: String(r.name), status: String(r.status), dailyBudget: Number(r.daily_budget), spend: Number(r.spend), revenue: Number(r.revenue), purchases: Number(r.purchases) }));
}

/** Daily ad budget added by approved or pending budget changes for this store since local midnight. */
export function budgetAddedToday(db: DatabaseSync, storeId: string): number {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const row = db
    .prepare(
      `SELECT coalesce(sum(coalesce(json_extract(action_json, '$.payload.addedUsd'), json_extract(action_json, '$.amountUsd'))), 0) AS added FROM approvals
       WHERE store_id = ? AND json_extract(action_json, '$.kind') = 'ads.set_budget' AND status != 'denied' AND created_at >= ?`,
    )
    .get(storeId, midnight.toISOString());
  return Number(row?.added ?? 0);
}

/** USD autopilot already approved for this store and action kind since local midnight. */
function autopilotUsedToday(db: DatabaseSync, storeId: string, kind: string): number {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const row = db
    .prepare(
      `SELECT coalesce(sum(json_extract(action_json, '$.amountUsd')), 0) AS used FROM approvals
       WHERE store_id = ? AND json_extract(action_json, '$.kind') = ? AND json_extract(action_json, '$.auto') = 1 AND created_at >= ?`,
    )
    .get(storeId, kind, midnight.toISOString());
  return Number(row?.used ?? 0);
}

/** How long a run waits on an OUTLIVE_RUN request before it finishes and leaves the request with the owner. */
const PATIENCE_MS = 10 * 60_000;

/** Approval kinds the server carries out when approved (apps/server/src/routes/agents.ts), whether or not the run that asked is still alive. */
export const OUTLIVE_RUN = ['store.add_products', 'store.publish_page', 'store.publish_theme', 'store.set_price', 'ads.set_budget', 'ads.pause_campaign'];

/** Request kinds only their own tool may create (request_approval refuses them). */
const OWN_TOOL: Record<string, string> = {
  'ads.set_budget': 'propose_ad_change',
  'ads.pause_campaign': 'propose_ad_change',
  'store.set_price': 'propose_price_change',
  'store.publish_page': 'publish_page',
  'store.publish_theme': 'draft_theme_change',
  'creative.generate': 'create_creative',
  'niche.promote_learning': 'promote_niche_learning',
  tool_use: 'calling the connected tool itself',
  'automation.run': 'the Automation screen',
};

/** Actions the agents lane carries out itself once approved. Store/ad actions arrive with the connectors. */
const ACTIONS: Record<string, (payload: Record<string, unknown>) => Promise<string>> = {
  save_niche_pack: async ({ slug, markdown }) => {
    if (typeof slug !== 'string' || typeof markdown !== 'string' || !markdown.trim()) return 'Not saved: the payload needs slug and markdown.';
    saveNichePack(slug, markdown);
    return 'Niche pack saved; stores in this niche use it from their next run.';
  },
};

/** The app tools a role may use (its allowlist minus anything not built yet). */
export const toolsFor = (role: Agent['role']) => APP_TOOLS.filter((t) => ROLES[role].tools.includes(t.name));

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('Cancelled'));
    signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true });
    promise.then(resolve, reject);
  });
}

/** Validates args against the tool schema (defaults applied) and runs it. Errors come back as text for the model. */
export async function callTool(tool: AppTool, args: unknown, ctx: ToolContext): Promise<{ output: string; isError: boolean }> {
  const parsed = z.object(tool.input).safeParse(args ?? {});
  if (!parsed.success) return { output: `Invalid input: ${parsed.error.message}`, isError: true };
  try {
    return { output: await tool.run(parsed.data, ctx), isError: false };
  } catch (err) {
    return { output: err instanceof Error ? err.message : String(err), isError: true };
  }
}

/** Minimal async queue: tools and the engine both push, the run drains in order. */
export function channel<T>() {
  const items: T[] = [];
  let wake: (() => void) | undefined;
  let done = false;
  let failure: unknown;
  return {
    push: (item: T) => {
      items.push(item);
      wake?.();
    },
    end: (err?: unknown) => {
      done = true;
      failure = err;
      wake?.();
    },
    async *drain(): AsyncGenerator<T> {
      for (;;) {
        if (items.length) yield items.shift()!;
        else if (done) {
          if (failure) throw failure;
          return;
        } else await new Promise<void>((r) => (wake = r));
      }
    },
  };
}
