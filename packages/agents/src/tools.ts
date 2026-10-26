import type { DatabaseSync } from 'node:sqlite';
import { RESEARCH_TABS, type Agent, type AgentEvent, type AnalyticsRange, type AnalyticsSummary, type ApprovalAction, type ApprovalDecision, type ApprovalsHook, type ResearchProduct, type ResearchTab, type Store, type StoreCaps } from '@frontline/shared';
import { z } from 'zod';
import { searchMemory, writeMemory } from './memory';
import { saveNichePack } from './niche';
import { ROLES, type ToolName } from './roles';

/** What the server hands a run so its tools can read and act on app data. */
export interface ToolEnv {
  db: DatabaseSync;
  /** Core's analytics summary for this store (the math lives in apps/server). */
  summary: (storeId: string, range: AnalyticsRange) => AnalyticsSummary;
  approvals: ApprovalsHook;
  /** Core's decide(): lets autopilot approve within its cap. Without it every request waits for the owner. */
  decide?: (id: string, decision: ApprovalDecision) => unknown;
  /** Core's per-store caps; `autopilot[kind]` is the owner's autopilot rule for that action kind. */
  caps?: (storeId: string) => StoreCaps;
  /** Core's research feed (scored trending products). */
  research?: (q: { tab?: ResearchTab; niche?: string; q?: string; limit: number }) => Promise<ResearchProduct[]>;
  runId?: string;
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
const since = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

export const APP_TOOLS: AppTool[] = [
  defineTool({
    name: 'store_summary',
    description: 'Revenue, profit, ad spend, ROAS, orders and AOV for the last N days, with the previous period and % deltas.',
    input: { range: z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(365)]).default(30).describe('days') },
    run: async ({ range }, ctx) => {
      const s = ctx.summary(ctx.store.id, range);
      return JSON.stringify({ from: s.from, to: s.to, currency: ctx.store.currency, totals: s.totals, previous: s.previous, deltasPct: s.deltas });
    },
  }),
  defineTool({
    name: 'metrics_timeseries',
    description: 'Daily revenue, ad spend, COGS, orders, sessions, add-to-carts and checkouts for the last N days (CSV, oldest first).',
    input: { days: z.number().int().min(1).max(365).default(30) },
    run: async ({ days }, ctx) =>
      csv(
        ctx.db
          .prepare(
            `SELECT date, round(revenue, 2) AS revenue, round(ad_spend, 2) AS ad_spend, round(cogs, 2) AS cogs, orders, sessions, add_to_carts, checkouts
             FROM daily_metrics WHERE store_id = ? AND date >= ? ORDER BY date`,
          )
          .all(ctx.store.id, since(days)),
      ),
  }),
  defineTool({
    name: 'list_products',
    description: 'The store catalog: price, compare-at, unit cost, gross margin %, inventory and status (CSV).',
    input: { status: z.enum(['active', 'draft', 'archived']).optional(), limit: z.number().int().min(1).max(500).default(100) },
    run: async ({ status, limit }, ctx) =>
      csv(
        ctx.db
          .prepare(
            `SELECT id, title, price, compare_at, cost, round(100.0 * (price - cost) / nullif(price, 0), 1) AS margin_pct, inventory, status
             FROM products WHERE store_id = ? ${status ? 'AND status = ?' : ''} ORDER BY title LIMIT ?`,
          )
          .all(...([ctx.store.id, ...(status ? [status] : []), limit] as string[])),
      ),
  }),
  defineTool({
    name: 'list_orders',
    description: 'Orders from the last N days, newest first, with fulfillment status, supplier and tracking (CSV), plus counts per fulfillment status.',
    input: {
      days: z.number().int().min(1).max(90).default(14),
      fulfillment: z.enum(['unfulfilled', 'fulfilled', 'in_transit', 'delivered']).optional(),
      limit: z.number().int().min(1).max(500).default(100),
    },
    run: async ({ days, fulfillment, limit }, ctx) => {
      const from = since(days);
      const counts = ctx.db
        .prepare('SELECT fulfillment_status AS status, count(*) AS n FROM orders WHERE store_id = ? AND created_at >= ? GROUP BY 1 ORDER BY 2 DESC')
        .all(ctx.store.id, from);
      const rows = ctx.db
        .prepare(
          `SELECT id, created_at, total, status, fulfillment_status, supplier, tracking FROM orders
           WHERE store_id = ? AND created_at >= ? ${fulfillment ? 'AND fulfillment_status = ?' : ''} ORDER BY created_at DESC LIMIT ?`,
        )
        .all(...([ctx.store.id, from, ...(fulfillment ? [fulfillment] : []), limit] as string[]));
      return `counts: ${counts.map((c) => `${c.status} ${c.n}`).join(', ') || 'none'}\n${csv(rows)}`;
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
        .all(since(days), ctx.store.id);
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
    name: 'research_feed',
    description:
      'Trending product candidates with cost, price, margin %, 30-day demand trend %, competition (0-100, lower is better), shipping days and AI score (CSV, best first). Defaults to the store niche.',
    input: {
      tab: z.enum(RESEARCH_TABS as [ResearchTab, ...ResearchTab[]]).optional(),
      q: z.string().optional().describe('search title/category'),
      anyNiche: z.boolean().default(false).describe('search outside the store niche'),
      limit: z.number().int().min(1).max(100).default(25),
    },
    run: async ({ tab, q, anyNiche, limit }, ctx) => {
      if (!ctx.research) return 'The research feed is not available.';
      const items = await ctx.research({ tab, q, limit, ...(anyNiche ? {} : { niche: ctx.store.niche }) });
      return csv(
        items.map((p) => ({ id: p.id, title: p.title, category: p.category, source: p.source, cost: p.cost, price: p.price, compare_at: p.compareAt, margin_pct: p.margin, trend_pct: p.trend, competition: p.competition, shipping_days: p.shippingDays, score: p.score })),
      );
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
      const memory = writeMemory(ctx.db, { ...args, storeId: ctx.store.id, agentId: ctx.agent.id });
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
      kind: z.string().max(40).describe('action type, e.g. pause_ad_set, change_budget, publish_page, add_product'),
      payload: z.record(z.string(), z.unknown()).describe('everything needed to carry the action out'),
      amountUsd: z.number().min(0).optional().describe("money at stake per day in USD (budget added, spend, refund total); lets autopilot decide within the owner's cap"),
    },
    run: async ({ title, reason, kind, payload, amountUsd }, ctx) => {
      const { approved, message } = await requestApproval(ctx, { title, reason, action: { kind, payload, ...(amountUsd !== undefined ? { amountUsd } : {}) } });
      if (!approved) return message;
      const outcome = await ACTIONS[kind]?.(payload);
      return `${message}${outcome ? `. ${outcome}` : ''}`;
    },
  }),
];

/**
 * Asks the owner and waits. `suggest` agents may not ask. `autopilot` agents approve themselves when the owner
 * enabled autopilot for this action kind on the store and the amount at stake fits what is left of today's
 * cap for that kind (logged on the request as `auto` + a note in the reason).
 */
export async function requestApproval(ctx: ToolContext, req: { title: string; reason: string; action: ApprovalAction }) {
  const { agent } = ctx;
  if (agent.autonomy === 'suggest') return { approved: false, message: 'Not sent: your autonomy is "suggest". Put the recommendation in your answer instead.' };
  const { kind, amountUsd: amount } = req.action;
  const rule = agent.autonomy === 'autopilot' ? ctx.caps?.(ctx.store.id).autopilot[kind] : undefined;
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
  const decided = await abortable(ctx.approvals.decision(request.id), ctx.signal);
  if (auto) ctx.emit({ type: 'approval_request', approval: decided });
  return decided.status === 'approved'
    ? { approved: true, message: `${auto ? 'Auto-approved (autopilot)' : 'Approved by the owner'}: ${req.title}` }
    : { approved: false, message: `Denied by the owner: ${req.title}. Do not do it; suggest an alternative if useful.` };
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
