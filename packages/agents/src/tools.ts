import type { DatabaseSync } from 'node:sqlite';
import { AGENT_ROLES, PRICE_WRITE_PLATFORMS, PRODUCT_PAGE_PLATFORMS, PRODUCT_WRITE_PLATFORMS, RESEARCH_TABS, type Agent, type AgentRole, type AgentRun, type AgentEvent, type AnalyticsRange, type AnalyticsSummary, type ApprovalAction, type AspectRatio, type CreativeKind, type ApprovalDecision, type ApprovalsHook, type AdSnapshotData, type Competitor, type PriceChange, type ResearchProduct, type ResearchTab, type Store, type StoreCaps, type SupplierProduct, storeHealth } from '@frontline/shared';
import { z } from 'zod';
import { economics, IDLE_CAMPAIGN_STATUSES, reviewCampaigns, thresholds, uncostedShare, type CampaignStats } from './ads';
import { chargeCredits, CREDITS, creditsAsked, creditsToday, demoMedia, listCreatives, saveCreative } from './creatives';
import { agentTags, searchMemory, writeMemory } from './memory';
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
  /** `repeat`: the niche's feed already had this find (same title), so its numbers were refreshed instead. */
  recordFind?: (find: Omit<ResearchProduct, 'id' | 'margin' | 'score' | 'scoreParts'>) => Promise<ResearchProduct & { repeat?: boolean }>;
  /** Renders media on Higgsfield and returns a local URL for it; undefined when Higgsfield isn't connected (demo render). */
  generateMedia?: (req: { kind: Exclude<CreativeKind, 'copy'>; aspect: AspectRatio; prompt: string }, signal?: AbortSignal) => Promise<string | undefined>;
  /** Queues a run for a squadmate (the app's run manager); returns the run or why it can't start. */
  startRun?: (agentId: string, task: string, parentRunId?: string) => AgentRun | string;
  /** Core's supplier catalog search (CJ Dropshipping; demo listings without credentials). */
  searchSuppliers?: (q: string, limit: number) => Promise<SupplierProduct[]>;
  /** Core's research feed (scored trending products). */
  research?: (q: { tab?: ResearchTab; niche?: string; q?: string; limit: number; sample?: 0 }) => Promise<ResearchProduct[]>;
  /** Core's Shopify theme connector; throws a readable error for stores it can't reach (demo, other platforms). */
  themes?: {
    list: (storeId: string) => Promise<Theme[]>;
    /** Text of theme files by name (`*` wildcards); the live theme when `themeId` is omitted. Binary files are null. */
    read: (storeId: string, filenames: string[], themeId?: string) => Promise<{ filename: string; content: string | null }[]>;
    /** Copies the live theme as an unpublished theme named `name` and writes the files to the copy. */
    draft: (storeId: string, name: string, files: { filename: string; body: string }[]) => Promise<Theme>;
    /** Deletes an unpublished theme (a copy `draft` made). */
    remove: (storeId: string, themeId: string) => Promise<unknown>;
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
  return [cols.join(','), ...rows.map((r) => cols.map((c) => String(r[c] ?? '').replaceAll(',', ';').replace(/[\r\n]+/g, ' ')).join(','))].join('\n');
}

const r2 = (n: number) => Math.round(n * 100) / 100;
/** The first of the last `days` dates, today included, in the zone the store's data is dated in: a connected shop's own, else this machine's (demo data). */
/** The store's today: a connected shop's own day, demo data's this machine's. */
const today = (store: Store) => new Date().toLocaleDateString('en-CA', store.connected ? { timeZone: store.timezone } : {});
const since = (days: number, store: Store) => {
  const d = new Date(`${today(store)}T00:00:00Z`);
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
/** Why a product can't take a price or page change: not in the store, or archived (core's daily catalog pass archives deleted ones). */
const productGone = (ctx: ToolContext, productId: string) => {
  const status = ctx.db.prepare('SELECT status FROM products WHERE store_id = ? AND id = ?').get(ctx.store.id, productId)?.status;
  if (status === undefined) return `No product ${productId} in this store. Use list_products for ids.`;
  if (status === 'archived') return `Product ${productId} is archived (deleted or trashed on the platform). Pick an active product from list_products.`;
  // A channel next to the store (core's `tt-`/`amz-` products): the app writes to the store's own platform only, where
  // that product doesn't exist, so an approved change would fail.
  const channel = productId.startsWith('tt-') && ctx.store.platform !== 'tiktok_shop' ? 'TikTok Shop' : productId.startsWith('amz-') && ctx.store.platform !== 'amazon' ? 'Amazon' : undefined;
  if (channel) return `Product ${productId} sells on ${channel}, next to the store, and the app only changes the ${ctx.store.platform} store. Put the change in your answer for the owner to make on ${channel}.`;
};

const noStoreWrites = (store: Store, platforms = PRODUCT_WRITE_PLATFORMS) =>
  store.connected && !platforms.includes(store.platform)
    ? `Not sent: the app doesn't change ${store.platform} stores yet, so approving it would do nothing. Put the change in your answer so the owner can make it by hand.`
    : undefined;
/**
 * The lowest price that still covers a unit costing `cost` and the store's fee estimate. A cost of 0 is one nobody set
 * (Shopify's empty "Cost per item"; Etsy and TikTok Shop send none): no floor to check. ponytail: the per-order fee is
 * counted per unit, so a multi-unit order's floor is a little high.
 */
const priceFloor = (store: Store, cost: number) => (cost > 0 ? r2((cost + (store.feePerOrder ?? 0)) / (1 - (store.feePercent ?? 0) / 100)) : undefined);
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
    description:
      'Revenue, profit, ad spend, ROAS, orders and AOV for the last N days, with the previous period, % deltas and store health (net margin: bleeding / steady / winning), ' +
      'plus amazonChannel / tiktokShop when the store also sells on Amazon / TikTok Shop as a channel.',
    input: { range: z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(365)]).default(30).describe('days') },
    run: async ({ range }, ctx) => {
      const s = ctx.summary(ctx.store.id, range);
      // Amazon as an extra channel (core's channel_daily) is in these totals, as in metrics_timeseries (see there).
      const amazon = ctx.store.platform === 'amazon' ? undefined
        : ctx.db.prepare(`SELECT round(sum(revenue), 2) AS revenue, sum(orders) AS orders FROM channel_daily WHERE store_id = ? AND channel = 'amazon' AND date BETWEEN ? AND ?`).get(ctx.store.id, s.from, s.to);
      const amazonChannel = Number(amazon?.revenue) || Number(amazon?.orders)
        ? { revenue: Number(amazon!.revenue), orders: Number(amazon!.orders), note: "In the totals. Profit counts an estimate of its costs (the store's own cost ratio plus Amazon's 15% referral fee); ROAS and AOV count its sales, which the store's ads mostly didn't drive: take it out for the site's own ROAS and AOV." }
        : undefined;
      // TikTok Shop next to the site (`tt-` orders, core's CORE-82) is in the totals too, with its own product costs.
      const tt = ctx.store.platform === 'tiktok_shop' ? undefined
        : ctx.db.prepare(`SELECT round(sum(total), 2) AS revenue, count(*) AS orders FROM orders WHERE store_id = ? AND id GLOB 'tt-*' AND status = 'paid' AND local_date BETWEEN ? AND ?`).get(ctx.store.id, s.from, s.to);
      const tiktokShop = Number(tt?.orders)
        ? { revenue: Number(tt!.revenue), orders: Number(tt!.orders), note: "In the totals, with its own product costs. Its buyers shopped on TikTok Shop, not the site: take it out for the site's own AOV and conversion." }
        : undefined;
      // Lines with no unit cost (never entered; TikTok Shop and Etsy carry none of their own) count their whole price as profit.
      const uncosted = uncostedShare(ctx.db, ctx.store.id, s.from);
      const profitNote = uncosted >= 0.1
        ? `${Math.round(uncosted * 100)}% of this window's product sales have no unit cost set, so profit, margin and health read high. Say so next to any profit figure; the owner enters costs in Analytics.`
        : undefined;
      return JSON.stringify({ from: s.from, to: s.to, currency: ctx.store.currency, totals: s.totals, previous: s.previous, deltasPct: s.deltas, health: storeHealth(s.totals), ...(profitNote && { profitNote }), ...(amazonChannel && { amazonChannel }), ...(tiktokShop && { tiktokShop }) });
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
      const stores = new Map(ctx.db.prepare('SELECT id, name, platform, niche, currency, connected FROM stores').all().map((s) => [String(s.id), s]));
      const name = (id: string) => String(stores.get(id)?.name ?? id);
      // A live store next to demo stores' sample numbers would be ranked against made-up sales (core's digest drops them too).
      const demo = (id: string) => ctx.store.connected && !Number(stores.get(id)?.connected);
      // Stores whose currency has no exchange rate are missing from the amounts (they'd read as zero): name them instead.
      const left = (id: string) => !demo(id) && (p.unconverted?.includes(String(stores.get(id)?.currency)) ?? false);
      const skipped = p.byStore.filter((s) => left(s.storeId)).map((s) => name(s.storeId));
      const sample = p.byStore.filter((s) => demo(s.storeId)).map((s) => name(s.storeId));
      const rows = p.byStore
        .filter((s) => !left(s.storeId) && !demo(s.storeId))
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
      // Sales with no unit cost count their whole price as profit: such a store ranks above what it earns.
      const high = p.byStore.filter((s) => !left(s.storeId) && !demo(s.storeId) && uncostedShare(ctx.db, s.storeId, p.from) >= 0.1).map((s) => name(s.storeId));
      const note = (skipped.length ? `; left out, no exchange rate yet: ${skipped.join(', ')}` : '') + (sample.length ? `; left out, demo data: ${sample.join(', ')}` : '')
        + (high.length ? `; profit reads high (10%+ of sales have no unit cost set): ${high.join(', ')}` : '');
      return `${p.from} to ${p.to}, amounts in ${p.currency ?? 'USD'}${note}\n${csv(rows)}`;
    },
  }),
  defineTool({
    name: 'metrics_timeseries',
    description:
      'Daily revenue, ad spend, COGS (product cost plus the sales tax/VAT collected on orders), fees (the estimate set for the store), profit (revenue - ad spend - COGS - fees), orders, sessions, add-to-carts and checkouts for the last N days (CSV, oldest first; the row for today is marked "(today so far)"), plus amazon_revenue and amazon_orders when the store also sells on Amazon as a channel.',
    input: { days: z.number().int().min(1).max(365).default(30) },
    run: async ({ days }, ctx) => {
      const rows = ctx.db
        .prepare(
          `SELECT date, round(revenue, 2) AS revenue, round(ad_spend, 2) AS ad_spend, round(cogs, 2) AS cogs, round(fees, 2) AS fees,
             round(revenue - ad_spend - cogs - fees, 2) AS profit, orders, sessions, add_to_carts, checkouts, amazon_revenue, amazon_orders, tiktok_orders
           FROM (SELECT d.*, d.revenue * s.fee_percent / 100 + d.orders * s.fee_per_order AS fees,
                   round(coalesce(c.revenue, 0), 2) AS amazon_revenue, coalesce(c.orders, 0) AS amazon_orders,
                   (SELECT count(*) FROM orders o WHERE o.store_id = d.store_id AND o.local_date = d.date AND o.status = 'paid' AND +o.id GLOB 'tt-*') AS tiktok_orders
                 FROM daily_metrics d JOIN stores s ON s.id = d.store_id
                 LEFT JOIN channel_daily c ON c.store_id = d.store_id AND c.date = d.date AND c.channel = 'amazon'
                 WHERE d.store_id = ? AND d.date >= ?)
           ORDER BY date`,
        )
        .all(ctx.store.id, since(days, ctx.store));
      // Only Shopify and GA4 report the whole funnel (Amazon: sessions only): an unreported step reads as 0, not as no traffic.
      // Settled days only: GA4 and Amazon report a day or two late, so the newest days can still be 0.
      const total = (k: string) => rows.slice(0, -2).reduce((n, r) => n + Number(r[k]), 0);
      const missing = total('orders') ? ['sessions', 'add_to_carts', 'checkouts'].filter((k) => !total(k)) : [];
      const note = missing.length ? `(${missing.join(', ')}: not reported for this store, so 0 means no data, not no traffic.)\n` : '';
      // The newest days of a step the store does report: a 0 beside that day's orders is a late report, not lost traffic.
      const steps = ['sessions', 'add_to_carts', 'checkouts'].filter((k) => !missing.includes(k) && total(k));
      for (const r of rows.slice(-2)) if (Number(r.orders)) for (const k of steps) if (!Number(r[k])) r[k] = 'not reported yet';
      // Traffic that starts mid-window (GA4 connected later, TikTok's 30 days of visitors): orders before it have no
      // sessions to convert from, and counting them inflates conversion (core's funnel leaves them out the same way).
      const first = missing.includes('sessions') ? -1 : rows.findIndex((r) => Number(r.sessions) > 0);
      const late = first > 0 && rows.slice(0, first).some((r) => Number(r.orders) > 0);
      // Amazon as an extra channel (core's channel_daily) is in revenue and orders but not in this store's sessions, and the
      // store's ads mostly send shoppers to its own site. An Amazon store's own sales are the whole store: no split.
      const amazon = ctx.store.platform !== 'amazon' && rows.some((r) => Number(r.amazon_orders) || Number(r.amazon_revenue));
      if (!amazon) for (const r of rows) delete r.amazon_revenue, delete r.amazon_orders;
      // TikTok Shop next to the site (`tt-` orders, core's CORE-82) is in orders, with its own costs, but not in sessions.
      const tiktok = ctx.store.platform !== 'tiktok_shop' && rows.some((r) => Number(r.tiktok_orders));
      if (!tiktok) for (const r of rows) delete r.tiktok_orders;
      // Today's row counts up through the day: read as a whole day, every morning would look like a collapse.
      const last = rows.at(-1);
      if (last?.date === today(ctx.store)) last.date = `${String(last.date)} (today so far)`;
      const split = amazon
        ? "(revenue and orders include Amazon's sales as a channel (amazon_revenue, amazon_orders): its shoppers aren't in sessions, its product costs aren't in cogs, and the store's ads mostly drive its own site, so take them out for conversion, margin and MER.)\n"
        : '';
      const tt = tiktok ? "(orders include TikTok Shop's (tiktok_orders): its shoppers aren't in sessions, so take them out for conversion.)\n" : '';
      const uncosted = uncostedShare(ctx.db, ctx.store.id, since(days, ctx.store)); // as store_summary's profitNote
      const costs = uncosted >= 0.1 ? `(${Math.round(uncosted * 100)}% of these days' product sales have no unit cost set, so cogs reads low and profit high.)\n` : '';
      return note + costs + (late ? `(sessions start on ${rows[first]!.date}: work out conversion from that day on; earlier orders have no traffic data.)\n` : '') + split + tt + csv(rows);
    },
  }),
  defineTool({
    name: 'list_products',
    description:
      'The store catalog, best sellers first: price, compare-at, unit cost ("not set" when nobody entered one; margin then blank), margin % (after unit cost and the fee estimate set for the store: its % plus its per-order fee, as if one unit per order), inventory ("not tracked" when the platform does not count its stock, e.g. dropshipped: not sold out), status, and units / revenue from paid orders in the last `days` days (default 30), revenue net of Amazon refunds (CSV).',
    input: {
      status: z.enum(['active', 'draft', 'archived']).optional().describe('default: active and draft (archived = deleted or trashed on the platform)'),
      days: z.number().int().min(1).max(90).default(30).describe('sales window, e.g. 7 for the week'),
      limit: z.number().int().min(1).max(500).default(100),
    },
    run: async ({ status, days, limit }, ctx) =>
      amazonUnsplit(ctx, days) +
      csv(
        ctx.db
          .prepare(
            `SELECT p.id, p.title, p.price, p.compare_at, iif(p.cost > 0, p.cost, 'not set') AS cost,
               iif(p.cost > 0, round(100.0 * (p.price * (1 - (SELECT fee_percent FROM stores WHERE id = p.store_id) / 100.0) - (SELECT fee_per_order FROM stores WHERE id = p.store_id) - p.cost) / nullif(p.price, 0), 1), NULL) AS margin_pct,
               CASE WHEN p.inventory_tracked THEN p.inventory ELSE 'not tracked' END AS inventory, p.status,
               coalesce(s.units, 0) AS units_${days}d, round(coalesce(s.revenue, 0), 2) AS revenue_${days}d
             FROM products p LEFT JOIN (
               SELECT product_id, sum(units) AS units, sum(revenue) AS revenue FROM (
                 SELECT i.product_id, i.quantity AS units, i.revenue
                 FROM order_items i JOIN orders o ON o.store_id = i.store_id AND o.id = i.order_id
                 WHERE i.store_id = ? AND o.status = 'paid' AND o.local_date >= ?
                 -- core's refund lines, off their order's day as on the dashboard (a TikTok refund on a mixed order names no product, so it lands on none). ponytail: units stay gross (a refund line has no quantity).
                 UNION ALL SELECT r.product_id, 0, -r.amount
                 FROM amazon_refunds r JOIN orders o ON o.store_id = r.store_id AND o.id = r.order_id
                 WHERE r.store_id = ? AND o.status = 'paid' AND o.local_date >= ?
               ) GROUP BY product_id
             ) s ON s.product_id = p.id
             WHERE p.store_id = ? ${status ? 'AND p.status = ?' : "AND p.status != 'archived'"} ORDER BY revenue_${days}d DESC, p.title LIMIT ?`,
          )
          .all(...([ctx.store.id, since(days, ctx.store), ctx.store.id, since(days, ctx.store), ctx.store.id, ...(status ? [status] : []), limit] as string[])),
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
      stale: z.boolean().optional().describe('only orders unfulfilled 3+ days or in transit 10+ days, oldest first (cancelled and refunded ones left out)'),
      limit: z.number().int().min(1).max(500).default(100),
    },
    run: async ({ days, fulfillment, stale, limit }, ctx) => {
      // Real orders carry the shop's own date (local_date); demo ones only a timestamp.
      const from = since(days, ctx.store);
      const counts = ctx.db
        .prepare('SELECT fulfillment_status AS status, count(*) AS n FROM orders WHERE store_id = ? AND coalesce(local_date, substr(created_at, 1, 10)) >= ? GROUP BY 1 ORDER BY 2 DESC')
        .all(ctx.store.id, from);
      // Newest first, a busy store's late orders fall past the limit: `stale` lists just those, the oldest (worst) first.
      const rows = ctx.db
        .prepare(
          `SELECT id, created_at, total, status, fulfillment_status, supplier, tracking FROM orders
           WHERE store_id = ? AND coalesce(local_date, substr(created_at, 1, 10)) >= ? ${fulfillment ? 'AND fulfillment_status = ?' : ''}
           ${stale ? `AND status != 'refunded' AND ((fulfillment_status = 'unfulfilled' AND created_at < ?) OR (fulfillment_status = 'in_transit' AND created_at < ?))` : ''}
           ORDER BY created_at ${stale ? 'ASC' : 'DESC'} LIMIT ?`,
        )
        .all(...([ctx.store.id, from, ...(fulfillment ? [fulfillment] : []), ...(stale ? [ago(3), ago(10)] : []), limit] as string[]));
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
        `# Orders${rows.length === limit && !stale ? ` (the newest ${limit}; older ones are cut: stale true lists the late ones, oldest first)` : ''}`,
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
           WHERE c.store_id = ? GROUP BY c.network, c.id ${LIVE_CAMPAIGNS} ORDER BY spend DESC`,
        )
        .all(since(days, ctx.store), ctx.store.id);
      return idleNote(ctx, rows.length) + csv(
        rows.map((r) => {
          const [spend, revenue, purchases, clicks, impressions] = [r.spend, r.revenue, r.purchases, r.clicks, r.impressions].map(Number) as number[];
          return {
            ...r,
            daily_budget: Number(r.daily_budget) > 0 ? r.daily_budget : 'none (lifetime or ad set budgets)',
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
    description:
      "Tracked competitors of this store, their recent price changes, and the ads they are running (three CSV sections). With q, a product keyword: " +
      'their current prices for the products whose name contains it (a fourth section), held prices included.',
    input: { q: z.string().min(2).max(80).optional().describe("a product keyword, e.g. 'harness': competitors' current prices for matching products") },
    run: async ({ q }, ctx) => {
      if (!ctx.competitors) return 'Competitor tracking is not available.';
      const { competitors, priceChanges, ads } = ctx.competitors(ctx.store.id);
      const name = new Map(competitors.map((c) => [c.id, c.name]));
      return [
        '# Competitors',
        csv(competitors.map((c) => ({ name: c.name, url: c.url, products_tracked: c.productsTracked, active_ads: c.activeAds, notes: c.notes ?? '' }))),
        // A competitor shop prices in its own currency: 39 EUR next to this store's 39 USD isn't the same price.
        `# Price changes (newest first, in the competitor's currency; blank when its site didn't say. This store sells in ${ctx.store.currency}. A price that held isn't here: pass q for current prices)`,
        csv(priceChanges.map((p) => ({ competitor: name.get(p.competitorId) ?? p.competitorId, product: p.product, from: p.from, to: p.to, currency: p.currency ?? '', change_pct: r2(p.changePct), at: p.at.slice(0, 10) }))),
        '# Recent ads',
        csv(ads.map((a) => ({ competitor: a.competitor, network: a.network, format: a.format, headline: a.headline, body: a.body, cta: a.cta ?? '', first_seen: a.firstSeen, last_seen: a.lastSeen }))),
        // A product's newest snapshot is its price now: the watcher writes one when it first sees it and on every change.
        ...(q
          ? [
              `# Current prices for "${q}" (in the competitor's currency; since = when it was first seen at that price)`,
              csv(
                ctx.db
                  .prepare(
                    `SELECT c.name AS competitor, s.data_json ->> '$.product' AS product, s.data_json ->> '$.price' AS price, s.data_json ->> '$.compareAt' AS compare_at,
                       s.data_json ->> '$.currency' AS currency, substr(max(s.captured_at), 1, 10) AS since
                     FROM competitor_snapshots s JOIN competitors c ON c.id = s.competitor_id
                     WHERE c.store_id = ? AND s.kind = 'price' AND instr(lower(s.data_json ->> '$.product'), lower(?)) > 0
                     GROUP BY s.competitor_id, s.data_json ->> '$.product' ORDER BY competitor, product LIMIT 30`,
                  )
                  .all(ctx.store.id, q),
              ),
            ]
          : []),
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
      // A custom niche's finds carry its slug, so each custom niche's feed is its own (core's niche_detail).
      const nicheDetail = nicheKey(ctx.store).split(':')[1];
      const p = await ctx.recordFind({ ...find, niche: ctx.store.niche, ...(nicheDetail ? { nicheDetail } : {}) });
      return `${p.repeat ? `Already in the research feed as ${p.id}; refreshed its numbers` : `Added to the research feed as ${p.id}`}: AI score ${p.score} (margin ${p.scoreParts.margin}, trend ${p.scoreParts.trend}, competition ${p.scoreParts.competition}, shipping ${p.scoreParts.shipping}), margin ${p.margin}%.`;
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
      // Demo listings are made from the sample research catalog: a live store's cost must not come from them.
      if (rows[0]!.demo && ctx.store.connected) {
        return "CJ Dropshipping isn't connected, so there's no real supplier price (the demo listings are left out for a live store). Ask the owner to connect it in Integrations, or take a real cost from a supplier's own page if you can browse.";
      }
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
      // The sample catalog every install starts with has made-up trend and competition: a live store works from real finds only.
      const live = ctx.store.connected;
      const items = await ctx.research({ tab, q, limit, ...(live ? { sample: 0 as const } : {}), ...(anyNiche ? {} : { niche: nicheKey(ctx.store) }) }); // other:<slug> for a custom niche
      if (live && !items.length) return 'No finds yet (the built-in sample catalog is left out for a live store). Find products with WebSearch, cost them with search_suppliers and record them with record_product_find.';
      return (await usdNote(ctx)) + csv(
        items.map((p) => ({ id: p.id, title: p.title, category: p.category, source: p.source, cost: p.cost, price: p.price, compare_at: p.compareAt, margin_pct: p.margin, trend_pct: p.trend, competition: p.competition, shipping_days: p.shippingDays, score: p.score })),
      );
    },
  }),
  defineTool({
    name: 'squad_log',
    description:
      "What this store's squad did in the last N days: requests to the owner with the decision (\"approved but not applied\" when the app couldn't make the change), finished runs with the gist of each answer, and the measured outcomes of approved changes (CSV).",
    input: { days: z.number().int().min(1).max(30).default(7) },
    run: async ({ days }, ctx) => {
      // Timestamps (UTC), not store dates: a store-local date would cut its early morning. A live store's log starts
      // when it went live: what the squad did on demo data before isn't its track record.
      const live = String(ctx.db.prepare('SELECT at FROM done_once WHERE ref = ?').get(`activate:${ctx.store.id}`)?.at ?? '');
      const from = [ago(days), live].sort().at(-1)!;
      const who = (agentId: string) => AGENT_ROLES[agentId.split(':')[1] as AgentRole]?.name ?? agentId;
      const requests = ctx.db
        .prepare(
          `SELECT created_at, agent_id, title, status, json_extract(action_json, '$.auto') AS auto, EXISTS (SELECT 1 FROM done_once WHERE ref = 'not-applied:' || approvals.id) AS skipped
           FROM approvals WHERE store_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 50`,
        )
        .all(ctx.store.id, from)
        // Approved isn't shipped: the app skips a change whose numbers moved since, and a platform write can fail.
        .map((r) => ({ date: String(r.created_at).slice(0, 10), agent: who(String(r.agent_id)), title: r.title, decision: `${r.auto ? 'auto-approved' : r.status}${r.skipped ? ' but not applied' : ''}` }));
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
      'Save an ad to the creatives library. kind "copy" saves ad copy right away. image/video/ugc generate media: costs generation credits (image 2, video 20, ugc 40), checks the daily credit cap and asks the owner first. ' +
      "aspect frames images; Higgsfield's video models take none and render in their own frame.",
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
      // Without Higgsfield the render is a demo picture: on a live store that's credits for an ad nobody can run.
      if (ctx.store.connected && !ctx.db.prepare(`SELECT 1 FROM integrations WHERE kind = 'higgsfield'`).get()) {
        return "Not generated: Higgsfield isn't connected, so the app could only make a placeholder, not an ad you can run. Save the copy with kind \"copy\" and put the visual brief in your answer; the owner connects Higgsfield in Integrations.";
      }
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
        // Higgsfield's video endpoints have no aspect setting (its OpenAPI, checked 2026-10-26): not labelled one it wasn't made in.
        const framed = kind === 'image';
        const saved = saveCreative(ctx.db, { ...base, ...(framed ? { aspect } : {}), prompt, credits, source: 'higgsfield', mediaUrl });
        const frame = framed ? '' : ` Higgsfield's video models take no aspect ratio, so it's in the model's own frame, not necessarily ${aspect}: check it before running it as a ${aspect} ad.`;
        return `${message}. Rendered on Higgsfield and saved to the library (${saved.id}).${frame}`;
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
            body: z.string().min(10).max(4000).describe('email: content bullets or full copy; sms: the full text with opt-out ("Reply STOP to opt out"), 320 characters at most'),
            offer: z.string().max(120).optional(),
          }),
        )
        .min(1)
        .max(8),
      notes: z.string().min(10).max(1000).describe('why this flow and its sizing: triggers/month × conversion × AOV'),
    },
    run: async (f, ctx) => {
      if (f.messages.some((m) => m.channel === 'email' && !m.subject)) return 'Every email step needs a subject.';
      // An SMS step is pasted into the owner's SMS tool as written: carriers and the TCPA want the opt-out in it, and each
      // 153 characters past 160 is another billed segment.
      const sms = f.messages.filter((m) => m.channel === 'sms');
      if (sms.some((m) => !/\bstop\b/i.test(m.body))) return 'Every SMS step needs its opt-out in the text, e.g. "Reply STOP to opt out" (carriers and the TCPA require it).';
      if (sms.some((m) => m.body.length > 320)) return 'Keep each SMS step to 320 characters (2 segments): every segment past that is billed again.';
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
      // The owner resolved it lately while the order still reads late ("emailed CJ, ships Friday"): the daily check would
      // reopen it every morning until the order catches up. Again only once it's worse.
      const done = ctx.db
        .prepare(
          `SELECT resolved_at, severity, resolution FROM order_issues r WHERE store_id = ? AND order_id = ? AND kind = ? AND status = 'resolved' AND resolved_at >= ?
             AND NOT EXISTS (SELECT 1 FROM order_issues o WHERE o.store_id = r.store_id AND o.order_id = r.order_id AND o.kind = r.kind AND o.status = 'open')
           ORDER BY resolved_at DESC LIMIT 1`,
        )
        .get(ctx.store.id, orderId, i.kind, ago(3));
      const rank = ['low', 'medium', 'high'];
      if (done && rank.indexOf(i.severity) <= rank.indexOf(String(done.severity)))
        return `The owner resolved order ${orderId}'s ${i.kind} issue on ${String(done.resolved_at).slice(0, 10)}: "${String(done.resolution ?? '')}". Not flagged again within 3 days of that unless it got worse (a higher severity).`;
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
      if (autonomyNow(ctx) === 'suggest') return 'Not sent: your autonomy is "suggest". Put the change in your answer instead.'; // before copying a theme for nothing
      // Each draft is a full copy of the live theme (Shopify keeps 20 themes at most): one waiting at a time.
      const pending = ctx.db
        .prepare(`SELECT 1 FROM approvals WHERE store_id = ? AND status = 'pending' AND json_extract(action_json, '$.kind') = 'store.publish_theme'`)
        .get(ctx.store.id);
      if (pending) return 'Not sent: a theme change is already waiting for the owner. One at a time.';
      // Each is judged on store conversion in the 14 days after it went live: a second one inside that window muddies both.
      const recent = ctx.db
        .prepare(`SELECT a.title, o.at FROM done_once o JOIN approvals a ON o.ref = 'theme-live:' || a.id WHERE a.store_id = ? AND o.at >= ? ORDER BY o.at DESC LIMIT 1`)
        .get(ctx.store.id, ago(15));
      if (recent) {
        const [name, on] = [String(recent.title).replace(/^Publish theme change: /, ''), String(recent.at).slice(0, 10)];
        return `Not sent: the theme change "${name}" went live on ${on} and is judged on the 14 days of conversion after it. Put this one in your answer, or draft it once that window is over.`;
      }
      let copy: Theme;
      try {
        copy = await ctx.themes.draft(ctx.store.id, `Frontline: ${title}`.slice(0, 50), files);
      } catch (e) {
        return `Not sent: ${(e as Error).message}`;
      }
      const hosts = outsideHosts(files.map((f) => f.body));
      const { approved, message } = await requestApproval(ctx, {
        title: `Publish theme change: ${title}`.slice(0, 80),
        reason: `${hosts.length ? `It loads from outside Shopify: ${hosts.join(', ')}. ` : ''}${summary} Preview: ${copy.previewUrl} . Publishing makes the copy "${copy.name}" the live theme; edits made to the live theme after ${new Date().toISOString().slice(0, 10)} are not in it.`,
        action: { kind: 'store.publish_theme', payload: { themeId: copy.id, name: copy.name, previewUrl: copy.previewUrl, files: files.map((f) => f.filename) } },
      });
      // No request was made (the agent was set to "suggest" during the copy, say): nothing would ever delete the copy.
      if (message.startsWith('Not sent')) await ctx.themes.remove(ctx.store.id, copy.id).catch(() => {});
      return approved ? `${message}. "${copy.name}" goes live as the app publishes it (the owner hears if that fails); compare the same funnel stage over an equal window before calling it.` : message;
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
      if (kind === 'page') productId = undefined; // a store page is no product's: publishing it must not rename or activate one
      // publish_page would refuse it: a draft that can never go live from here only waits in the Store Builder.
      if (ctx.store.connected && !(kind === 'product' ? PRODUCT_PAGE_PLATFORMS : PRODUCT_WRITE_PLATFORMS).includes(ctx.store.platform)) {
        return `Not saved: the app can't publish ${kind === 'product' ? 'product' : 'store'} pages to ${ctx.store.platform} stores yet. Put the page in your answer so the owner can add it by hand.`;
      }
      const bad = unsafeHtml(d.html);
      if (bad) return `Not saved: ${bad} in a storefront page. Use headings, paragraphs, lists, tables, images and http(s) links only.`;
      // Themes show titles as they are, and the platform refuses one with a tag at publish (core's hasTag).
      if ([d.title, d.seoTitle].some((t) => t && /<[a-z!/?]/i.test(t))) return 'Not saved: the title and SEO title are plain text; no HTML tags.';
      const gone = productId && productGone(ctx, productId);
      if (gone) return gone;
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
      const gone = d.productId && productGone(ctx, d.productId);
      if (gone) return `Not sent: ${gone}`;
      const test = d.productId && ctx.db.prepare('SELECT changed_on FROM price_tests WHERE store_id = ? AND product_id = ? AND changed_on >= ?').get(ctx.store.id, d.productId, since(29, ctx.store));
      if (test) return `Not sent: a price test on this product has been running since ${String(test.changed_on)} and is judged on the same 14 days of sales; the page couldn't be told apart. The draft waits in Store Builder.`;
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
      // A demo store's numbers are seeded: what they "prove" mustn't reach a live store's squad. Alone in demo mode it's fine.
      const live = ctx.db.prepare('SELECT niche, niche_detail FROM stores WHERE connected = 1').all();
      if (!ctx.store.connected && live.some((s) => nicheKey({ niche: s.niche as Store['niche'], nicheDetail: String(s.niche_detail ?? '') }) === niche)) {
        return "Not sent: this store runs on demo data, and a learning shared with its niche reaches the owner's live stores too.";
      }
      if (listNicheLearnings(ctx.db, niche, 1000).some((l) => l.text.toLowerCase() === text.trim().toLowerCase())) return 'Already shared with this niche.';
      const pending = ctx.db
        .prepare(`SELECT 1 FROM approvals WHERE status = 'pending' AND json_extract(action_json, '$.kind') = 'niche.promote_learning' AND json_extract(action_json, '$.payload.niche') = ? AND lower(json_extract(action_json, '$.payload.text')) = ?`)
        .get(niche, text.trim().toLowerCase());
      if (pending) return 'Already waiting for the owner: the same learning was proposed for this niche.';
      const label = ctx.store.niche === 'other' ? ctx.store.nicheDetail : ctx.store.niche;
      const { approved, message } = await requestApproval(ctx, {
        title: `Share a learning with all ${label} stores`.slice(0, 80),
        reason: `${text} Evidence: ${evidence}`, // both are shared as written: not cut
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
      // A run retried after a restart (runs.ts links `retry:<old>:<new>`) carries on its earlier attempt: the same role
      // isn't handed the work again, and the limit counts both.
      const attempts = [
        ctx.runId,
        ...ctx.db.prepare(`SELECT substr(ref, 7, length(ref) - 7 - length(?1)) AS id FROM done_once WHERE ref LIKE 'retry:%:' || ?1`).all(ctx.runId).map((r) => String(r.id)),
      ];
      const assigned = ctx.db.prepare('SELECT id, agent_id, parent_run_id, status FROM agent_runs WHERE parent_run_id IN (SELECT value FROM json_each(?))').all(JSON.stringify(attempts));
      if (assigned.length >= 3) return 'Not assigned: 3 tasks per run is the limit.';
      const name = AGENT_ROLES[role].name;
      const before = assigned.find((r) => r.parent_run_id !== ctx.runId && r.agent_id === `${ctx.store.id}:${role}`);
      if (before) return `Already assigned to the ${name} before the app restarted (run ${before.id}, ${before.status}): don't assign it again.`;
      const run = ctx.startRun(`${ctx.store.id}:${role}`, `${task}\n\n(Assigned by the ${AGENT_ROLES[ctx.agent.role].name}.)`, ctx.runId);
      return typeof run === 'string' ? `Not assigned to the ${name}: ${run}` : `Assigned to the ${name} (run ${run.id}, ${run.status}).`;
    },
  }),
  defineTool({
    name: 'review_campaigns',
    description:
      'Judge every campaign against break-even ROAS (from 30-day margin after product cost, sales tax and the fee estimate set for the store): verdict scale / hold / cut / pause / learning (not enough spend yet) / paused, with a suggested daily budget. Start every ad review here.',
    input: { days: z.number().int().min(3).max(30).default(7) },
    run: async ({ days }, ctx) => {
      const econ = economics(ctx.db, ctx.store.id, since(30, ctx.store));
      const t = thresholds(econ);
      const rows = campaignStats(ctx, days);
      // Losing campaigns come out as "scale" when break-even ROAS reads low. ponytail: no per-product list.
      const uncosted = uncostedShare(ctx.db, ctx.store.id, since(30, ctx.store));
      return [
        `margin after cost, tax and fees ${r2(econ.margin * 100)}%, AOV ${r2(econ.aov)}, break-even ROAS ${r2(t.breakEven)}, target ROAS ${r2(t.target)}, max CPA ${r2(t.maxCpa)} (${econ.catalog ? 'no sales in 30 days: from the active products\' prices and unit costs' : '30 days'}); campaigns over ${days} days:`,
        uncosted >= 0.1
          ? `(${Math.round(uncosted * 100)}% of the last 30 days' product sales have no unit cost set, so margin reads high and break-even ROAS low: don't scale on these verdicts until the owner fills in costs (Shopify "Cost per item", else Products here). Products that truly cost nothing, like digital ones, are fine.)`
          : '',
        idleNote(ctx, rows.length).trimEnd(),
        csv(
          // No campaign daily budget (synced as 0): a lifetime budget or ad set budgets, which can't be set from here.
          reviewCampaigns(rows, econ).map((c) => ({
            network: c.network, id: c.id, name: c.name, status: c.status, daily_budget: c.dailyBudget > 0 ? c.dailyBudget : 'none (lifetime or ad set budgets)',
            spend: r2(c.spend), roas: c.roas, cpa: c.cpa ?? '', purchases: c.purchases, verdict: c.verdict,
            suggested_budget: c.dailyBudget > 0 || c.verdict === 'pause' ? c.suggestedBudget : '',
          })),
        ),
      ]
        .filter(Boolean)
        .join('\n');
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
        .prepare(`SELECT id, title, created_at FROM approvals WHERE store_id = ? AND status = 'pending' AND json_extract(action_json, '$.kind') IN ('ads.set_budget', 'ads.pause_campaign') AND json_extract(action_json, '$.payload.campaignId') = ?`)
        .get(ctx.store.id, campaignId);
      // A live store's request over 4 days old is never applied (its numbers moved), so a fresh one replaces it (below,
      // once the fresh one passed every check) instead of being blocked by it.
      const replace =
        waiting && ctx.store.connected && ctx.decide && autonomyNow(ctx) !== 'suggest' && String(waiting.created_at) < ago(4) ? String(waiting.id) : undefined;
      if (waiting && !replace) return `Not sent: "${waiting.title}" is already waiting for the owner. One change per campaign at a time.`;
      // A change that changes nothing would still be judged (and win XP) on whatever else moved ROAS in the days after.
      if (IDLE_CAMPAIGN_STATUSES.includes(String(c.status))) {
        return `Not sent: ${String(c.name)} is ${String(c.status)}, so ${change === 'pause' ? 'there is nothing to pause' : 'a budget change does nothing until the owner turns it back on in the ad manager'}.`;
      }
      const from = Number(c.daily_budget);
      if (change === 'budget' && newDailyBudget === undefined) return 'newDailyBudget is required for a budget change.';
      // Core's budget writer refuses these (on TikTok it would replace the lifetime total).
      if (change === 'budget' && !(from > 0)) return `Not sent: ${String(c.name)} has no daily budget of its own (a lifetime budget, or budgets on its ad sets), so it can't be changed from here. Pause it, or say what to change in the ad manager.`;
      const to = change === 'pause' ? 0 : Math.round(newDailyBudget!);
      if (change === 'budget' && to === from) return `Not sent: ${cash(to, ctx.store.currency)}/day is already its budget.`;
      // A big jump restarts the network's learning phase and the winner with it (the playbook: 20-30% every 48-72 h).
      const most = Math.max(Math.floor(from * 1.3), from + 1); // whole amounts: a $3 budget can still go to $4
      if (to > most) {
        return `Not sent: raise a budget at most 30% at a time (${cash(from, ctx.store.currency)} → up to ${cash(most, ctx.store.currency)}/day); a bigger jump restarts the network's learning. Raise again once it has held for 3 days.`;
      }
      // A change is judged on the 3 days after it, and delivery takes 48-72 h to settle after a budget edit: one at a
      // time. A pause can always go: it stops a loss.
      const recent =
        change === 'budget' &&
        ctx.db
          .prepare(
            `SELECT decided_at FROM approvals WHERE store_id = ? AND status = 'approved' AND json_extract(action_json, '$.kind') = 'ads.set_budget'
               AND json_extract(action_json, '$.payload.campaignId') = ? AND decided_at >= ? AND NOT EXISTS (SELECT 1 FROM done_once WHERE ref = 'not-applied:' || approvals.id)
             ORDER BY decided_at DESC LIMIT 1`,
          )
          .get(ctx.store.id, campaignId, ago(3));
      if (recent) {
        return `Not sent: ${String(c.name)}'s budget was changed on ${String(recent.decided_at).slice(0, 10)}. It needs 48-72 h to settle and is judged on the 3 days after, so propose the next step once those are over (a pause can go now).`;
      }
      // Autopilot caps bound the budget a change touches (a pause stops all of it); the added-spend cap counts raises only.
      // ponytail: no rate → no amount, so the caps can't be checked and autopilot can't take it: the owner decides. Same
      // for a pause with no campaign budget (ad set or lifetime budgets, synced as 0): what it stops is unknown, not $0.
      const usd = change === 'pause' && !(from > 0) ? undefined : await inUsd(ctx, change === 'pause' ? from : Math.abs(to - from));
      const addedUsd = to > from ? usd : 0;
      const cap = ctx.caps?.(ctx.store.id).adSpendChangePerDay;
      const addedToday = addedUsd ? budgetAddedToday(ctx.db, ctx.store.id) : 0;
      if (cap !== undefined && addedUsd && addedToday + addedUsd > cap) {
        const more = ctx.store.currency === 'USD' ? '' : ` (${cash(to - from, ctx.store.currency)})`;
        return `Not sent: +$${addedUsd}${more}/day would pass the owner's $${cap}/day cap on added ad spend ($${addedToday} already approved today). Propose a smaller step.`;
      }
      const amount = usd !== undefined ? { amountUsd: usd } : {};
      if (replace) {
        // Only while it still waits: the owner may have decided it during the rate lookup above.
        const expired = ctx.db
          .prepare(`UPDATE approvals SET reason = reason || ? WHERE id = ? AND status = 'pending'`)
          .run(' [Expired: asked over 4 days ago; a fresh request replaced it.]', replace).changes;
        if (!expired) return `Not sent: the owner just decided "${waiting!.title}". Look again next run.`;
        ctx.decide!(replace, 'deny');
      }
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
      "Ask the owner to test a new price for a product, with the evidence. Applied to the store once approved, then judged on the product's profit (after unit cost and the store's fee estimate) in the 14 days after vs the 14 before.",
    input: {
      productId: z.string(),
      newPrice: z.number().positive(),
      compareAt: z.number().positive().optional().describe('new compare-at price; omit to keep the current one'),
      evidence: z.string().min(10).max(400).describe('the numbers and window, e.g. "converts 3.1% at $29.99 vs competitors at $34-39, margin 62%"'),
    },
    run: async ({ productId, newPrice, compareAt, evidence }, ctx) => {
      const no = noStoreWrites(ctx.store, PRICE_WRITE_PLATFORMS);
      if (no) return no;
      const gone = productGone(ctx, productId);
      if (gone) return gone;
      const p = ctx.db.prepare('SELECT * FROM products WHERE store_id = ? AND id = ?').get(ctx.store.id, productId)!;
      const [from, to] = [Number(p.price), r2(newPrice)];
      const $ = (n: number) => cash(n, ctx.store.currency);
      if (to === from) return `${$(to)} is already the price.`;
      const fees = ctx.store.feePercent || ctx.store.feePerOrder;
      const costed = Number(p.cost) > 0;
      const floor = priceFloor(ctx.store, Number(p.cost));
      if (floor !== undefined && to <= floor) return `Not sent: ${$(to)} is at or below the unit cost${fees ? ' plus fees' : ''} (${$(floor)}).`;
      if (Math.abs(to - from) / from > 0.3) return 'Not sent: test within ±30% of the current price, one step at a time.';
      if (compareAt !== undefined && compareAt <= to) return 'compareAt must be above the new price.';
      const sale = NO_COMPARE_AT[ctx.store.platform];
      if (compareAt !== undefined && ctx.store.connected && sale) return `Not sent: ${sale} Propose the price alone.`;
      // Core's TikTok writer refuses a product that isn't live (draft, under review, deactivated).
      if (ctx.store.connected && ctx.store.platform === 'tiktok_shop' && p.status !== 'active') return `Not sent: TikTok Shop only reprices live products, and ${String(p.title)} is ${String(p.status)}.`;
      // Overlapping tests on one product can't be judged apart.
      const running = ctx.db.prepare('SELECT changed_on FROM price_tests WHERE store_id = ? AND product_id = ? AND changed_on >= ?').get(ctx.store.id, productId, since(29, ctx.store));
      if (running) return `Not sent: a price test on this product has been running since ${running.changed_on}; it is judged after 14 days of sales.`;
      // A new product page is judged on the same 14-days-before-vs-after profit: a price change in it can't be told apart.
      const page = ctx.db
        .prepare('SELECT published_at FROM page_drafts WHERE store_id = ? AND product_id = ? AND published_at >= ? ORDER BY published_at DESC LIMIT 1')
        .get(ctx.store.id, productId, since(29, ctx.store));
      if (page) return `Not sent: this product's new page went live on ${String(page.published_at).slice(0, 10)} and is judged on 14 days of sales after it; a price test now couldn't be told apart.`;
      const pending = ctx.db
        .prepare(`SELECT 1 FROM approvals WHERE store_id = ? AND status = 'pending' AND json_extract(action_json, '$.kind') = 'store.set_price' AND json_extract(action_json, '$.payload.productId') = ?`)
        .get(ctx.store.id, productId);
      if (pending) return 'Not sent: a price change for this product is already waiting for the owner.';
      const { approved, message } = await requestApproval(ctx, {
        title: `Price ${String(p.title)} ${$(from)} → ${$(to)}`.slice(0, 80),
        reason: costed ? evidence : `${evidence} No unit cost is set for this product, so the app can't check the new price covers it, and its profit is judged before product cost.`,
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
      if (wentLive(ctx)) return "Not saved: the store went live during this run, so the demo numbers behind it are gone.";
      const memory = writeMemory(ctx.db, { ...args, tags: agentTags(args.tags), storeId: ctx.store.id, agentId: ctx.agent.id, ...(ctx.runId ? { runId: ctx.runId } : {}) });
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
      if (kind === 'store.add_products') {
        // The app skips a product it can't create and adds one priced below its cost: say so before the owner approves.
        const products = (Array.isArray(payload.products) ? payload.products : []) as { title?: unknown; price?: unknown; cost?: unknown }[];
        if (!products.length || products.some((p) => typeof p?.title !== 'string' || !p.title.trim() || !(typeof p.price === 'number' && p.price > 0))) {
          return "Not sent: payload.products needs each product's title and a price above 0, in the store's currency.";
        }
        const fees = ctx.store.feePercent || ctx.store.feePerOrder;
        for (const p of products) {
          const floor = priceFloor(ctx.store, Number(p.cost) || 0);
          const $ = (n: number) => cash(n, ctx.store.currency);
          if (floor !== undefined && Number(p.price) <= floor) return `Not sent: "${String(p.title).trim()}" at ${$(Number(p.price))} is at or below its unit cost${fees ? ' plus fees' : ''} (${$(floor)}).`;
        }
        // Two approvals for one product would add it twice: one request per product at a time.
        const titles = products.map((p) => String(p.title).trim().toLowerCase());
        // Approving it would make a second, empty copy of a product the store already sells.
        const listed = ctx.db
          .prepare(`SELECT title FROM products WHERE store_id = ? AND status != 'archived' AND lower(trim(title)) IN (SELECT value FROM json_each(?)) LIMIT 1`)
          .get(ctx.store.id, JSON.stringify(titles));
        if (listed) return `Not sent: "${String(listed.title)}" is already in the store's catalog (list_products).`;
        const waiting = ctx.db
          .prepare(
            `SELECT a.title FROM approvals a, json_each(a.action_json, '$.payload.products') p WHERE a.store_id = ? AND a.status = 'pending'
               AND json_extract(a.action_json, '$.kind') = 'store.add_products' AND lower(trim(json_extract(p.value, '$.title'))) IN (SELECT value FROM json_each(?)) LIMIT 1`,
          )
          .get(ctx.store.id, JSON.stringify(titles));
        if (waiting) return `Not sent: "${String(waiting.title)}" already asks to add that product and is waiting for the owner.`;
      }
      if (kind === 'save_niche_pack') {
        if (ctx.store.niche !== 'other' || !ctx.store.nicheDetail) return 'Not sent: only a store in a custom niche saves a niche pack, and only its own.';
        payload = { ...payload, slug: ctx.store.nicheDetail }; // every store of that niche loads it: never another niche's
        reason = `${reason}\n\n${String(payload.markdown ?? '')}`; // what the owner approves is what gets saved
      }
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

/** The agent's autonomy now: `ctx.agent` is the run's copy, and the owner may have taken it off autopilot since. */
const autonomyNow = (ctx: ToolContext) => String(ctx.db.prepare('SELECT autonomy FROM agents WHERE id = ?').get(ctx.agent.id)?.autonomy ?? ctx.agent.autonomy);

/**
 * Hosts outside Shopify's own that theme files reference (src/href/url(), protocol-relative included): a theme runs
 * scripts, and the preview looks the same with a skimmer in it. ponytail: literal URLs only; a script that assembles
 * one at runtime isn't seen, so a list here is a warning, its absence no guarantee.
 */
export const outsideHosts = (bodies: string[]) =>
  [...new Set(bodies.flatMap((b) => [...b.matchAll(/(?:https?:)?\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)].map((m) => m[1]!.toLowerCase())))]
    .filter((h) => !/(^|\.)(shopify\.com|shopifycdn\.com|shopifycloud\.com|myshopify\.com|shopifysvc\.com)$/.test(h))
    .sort();

/**
 * Asks the owner and waits. `suggest` agents may not ask. With `autopilot` (only tools that compute the amount
 * themselves pass it), `autopilot` agents approve themselves when the owner enabled autopilot for this action kind on
 * the store and the amount at stake fits what is left of today's cap for that kind (logged on the request as `auto` +
 * a note in the reason).
 */
/** The store's first real sync landed during this run (core's switchToReal): the demo rows it read are gone. */
const wentLive = (ctx: ToolContext) => !ctx.store.connected && ctx.db.prepare('SELECT connected FROM stores WHERE id = ?').get(ctx.store.id)?.connected === 1;

export async function requestApproval(ctx: ToolContext, req: { title: string; reason: string; action: ApprovalAction; autopilot?: boolean }) {
  const { agent } = ctx;
  const autonomy = autonomyNow(ctx);
  if (autonomy === 'suggest') return { approved: false, message: 'Not sent: your autonomy is "suggest". Put the recommendation in your answer instead.' };
  // Going live wiped the demo rows this run read and expired its requests; one more would act on the live store.
  if (wentLive(ctx)) {
    return { approved: false, message: 'Not sent: the store went live during this run, so the demo numbers behind it are gone. Stop here; the owner can ask again on real data.' };
  }
  const { kind, amountUsd: amount } = req.action;
  const rule = req.autopilot && autonomy === 'autopilot' ? ctx.caps?.(ctx.store.id).autopilot[kind] : undefined;
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

/**
 * A years-old ad account lists hundreds of paused campaigns: the ones off with no spend in the window are left out (a
 * campaign that is on but spends nothing stays: something is wrong with it).
 */
// sum(), not the alias: in HAVING SQLite reads `spend` as one campaign_daily row's column.
const LIVE_CAMPAIGNS = `HAVING coalesce(sum(d.spend), 0) > 0 OR c.status NOT IN (${IDLE_CAMPAIGN_STATUSES.map((s) => `'${s}'`).join(', ')})`;
const idleNote = (ctx: ToolContext, shown: number) => {
  const left = Number(ctx.db.prepare('SELECT count(*) AS n FROM campaigns WHERE store_id = ?').get(ctx.store.id)?.n) - shown;
  return left > 0 ? `(${left} paused or archived campaigns with no spend in the window left out)\n` : '';
};

/** Amazon as an extra channel (core's channel_daily) comes as daily totals: say its sales aren't in per-product numbers. */
function amazonUnsplit(ctx: ToolContext, days: number): string {
  if (ctx.store.platform === 'amazon') return '';
  const r = ctx.db
    .prepare(`SELECT sum(orders) AS orders, round(sum(revenue), 2) AS revenue FROM channel_daily WHERE store_id = ? AND channel = 'amazon' AND date >= ?`)
    .get(ctx.store.id, since(days, ctx.store));
  return Number(r?.orders)
    ? `(units_${days}d and revenue_${days}d are this store's own orders: its ${Number(r!.orders)} Amazon channel orders (${Number(r!.revenue)} ${ctx.store.currency}) in ${days} days aren't split by product, so a product can sell there and show 0 here.)\n`
    : '';
}

function campaignStats(ctx: ToolContext, days: number): CampaignStats[] {
  return ctx.db
    .prepare(
      `SELECT c.network, c.id, c.name, c.status, c.daily_budget, coalesce(sum(d.spend), 0) AS spend, coalesce(sum(d.revenue), 0) AS revenue,
         coalesce(sum(d.purchases), 0) AS purchases
       FROM campaigns c LEFT JOIN campaign_daily d ON d.network = c.network AND d.campaign_id = c.id AND d.date >= ?
       WHERE c.store_id = ? GROUP BY c.network, c.id ${LIVE_CAMPAIGNS} ORDER BY spend DESC`,
    )
    .all(since(days, ctx.store), ctx.store.id)
    .map((r) => ({ network: String(r.network), id: String(r.id), name: String(r.name), status: String(r.status), dailyBudget: Number(r.daily_budget), spend: Number(r.spend), revenue: Number(r.revenue), purchases: Number(r.purchases) }));
}

/** Daily ad budget added by budget changes approved since local midnight, or still waiting (whenever asked: approving it adds it today). */
export function budgetAddedToday(db: DatabaseSync, storeId: string): number {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const row = db
    .prepare(
      `SELECT coalesce(sum(coalesce(json_extract(action_json, '$.payload.addedUsd'), json_extract(action_json, '$.amountUsd'))), 0) AS added FROM approvals
       WHERE store_id = ? AND json_extract(action_json, '$.kind') = 'ads.set_budget' AND (status = 'pending' OR (status = 'approved' AND decided_at >= ?))`,
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
export const OUTLIVE_RUN = ['store.add_products', 'store.publish_page', 'store.publish_theme', 'store.set_price', 'ads.set_budget', 'ads.pause_campaign', 'niche.promote_learning'];

/** Platforms whose price writer (core's connectors) refuses a compare-at price, and where the owner sets a sale instead. */
const NO_COMPARE_AT: Partial<Record<Store['platform'], string>> = {
  etsy: 'Etsy has no compare-at price; a sale is set in Etsy Shop Manager (Marketing → Sales and discounts).',
  amazon: 'Amazon has no compare-at price here; a sale price is set in Seller Central.',
  tiktok_shop: 'TikTok Shop has no compare-at price here; a discount is run from Seller Center → Promotions.',
};

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
