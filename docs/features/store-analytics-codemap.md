# Store Analytics — app and data audit (Stage One)

Audit of the current Analytics page and the data behind it, done 2026-10-28 before the Store Analytics redesign. Paths
are repo-relative; line numbers drift, so search for the named symbol. "Missing" means the data is not stored anywhere.

## Ground truth that shapes the redesign

- **No live-verified connector.** Shopify, WooCommerce, TikTok Shop, Amazon, Meta and TikTok Ads are mock-tested only
  (`apps/server/src/connectors/*.test.ts`). Sync runs every 2 min (Shopify/Woo) or 10 min (others), 730-day backfill.
- **Demo stores are generated** (`apps/server/src/demo.ts` `demoDay`) and API responses carry no demo flag. The UI
  can't label demo numbers today.
- **No cross-channel order dedupe.** A TikTok Shop or Amazon order that also lands in Shopify is counted twice.
- **Formulas are duplicated.** `apps/server/src/analytics.ts` (`summarize`, `campaignStats`, `topProducts`) and the
  agent tools (`packages/agents/src/tools.ts` `metrics_timeseries`, `list_products`; `packages/agents/src/ads.ts`;
  `apps/server/src/routes/agents-actions.ts`) each run their own SQL. They can disagree, and agents may quote a
  different number than the page.
- **Store scoping is by `?stores=`** on localhost. No users or permissions (see `settings-codemap.md`).

## Current page — `apps/web/src/pages/Analytics.tsx`

- One long page: Hero, `StoreFilter` (multi-store chips, global `fe.stores` in localStorage), `Segmented` range
  7/30/90/365, Trend (`AreaChart`: revenue, profit, ad spend, ROAS, break-even ROAS, orders, AOV), PlatformSplit,
  FunnelPanel, Channels, TopProducts, UnitCosts/CostRow, Campaigns (AskStrategist, "Research this"), ByStore.
- No custom range, no compare picker, no timezone or freshness display, no catalog table, no product drawer.
- Query keys include stores + range, so a late response can't overwrite a newer one. `api()` passes no AbortSignal;
  `keepPreviousData` dims the old data while loading.
- Tests (`Analytics.test.tsx`) pin `.bg-red.rounded-full`, "Ask Ad Strategist about <name>", "Research <name>",
  "Unit cost of <title>". Update them deliberately when the page is replaced.
- UI kit to reuse: `components/ui.tsx` (Panel, Tabs, Segmented, Badge, Table styling, Dialog drawer, EmptyState,
  LoadingState, ErrorState, Tooltip). Charts are hand-written SVG.

## Server — `apps/server/src/analytics.ts`, routes in `app.ts`

- Endpoints: `GET /api/analytics/summary|campaigns|top-products`, params `stores` and `range` only. No freshness field.
- Revenue = order totals **including tax and shipping**, net of refunds; refunds are dated to the **order day**, not the
  refund day.
- Profit is one tier: revenue − (COGS + tax + fee% + per-order fee + Amazon referral `AMAZON_REFERRAL = 0.15`
  hard-coded) − ad spend. Store fee settings: `stores.fee_percent`, `fee_per_order`.
- Conversion = funnel orders ÷ sessions, computed in the web layer.
- FX (`fx.ts`): every historical day converts at **today's** rate.

## Data — `apps/server/src/db.ts`

| Table | Holds | Gaps |
| --- | --- | --- |
| `daily_metrics` | per-store daily revenue, orders, sessions, ad spend | sessions only where the platform reports them |
| `channel_daily` | per-channel daily split | Amazon only |
| `orders` | status paid/refunded, total, tax, cogs, fx_rate | no customer id, discounts, shipping, fulfillment dates, source/UTM |
| `order_items` | units and revenue per product | no variant |
| `amazon_refunds` | Amazon + TikTok Shop refunds | no Shopify return reasons or restocks |
| `products` | current title, price, cost, stock (first variant only) | no variants, no price/cost/stock history |
| `campaigns`, `campaign_daily`, `ads`, `ad_daily` | ad structure and daily spend/results | platform attribution only |
| `integrations` | status, error, `synced_at`, cursor | no sync-run log |
| `automation_rules`, `events`, `notifications` | metric-threshold rules on `MetricTotals` keys | |

Missing entirely: customers, variants, inventory/cost history, discounts, shipping, payouts and real fees, fulfillment
timestamps, per-order attribution, annotations, saved views, sync-run history, order dedupe keys.

## Handoffs that already exist

- Conversations: `useStartConversation` → `POST /api/conversations?store=`; context kinds campaign, product, run only.
- Ask palette: `frontline:ask` event. Knowledge Base: `POST /api/kb/cards`, `researchHref`.
- Approvals; squad missions (`/api/squad-missions`); automations; notifications and the daily digest.

## Feasibility by module

| Module | Status | What it needs |
| --- | --- | --- |
| Overview (sales, orders, AOV) | Available | metric definitions layer; dedupe; tax-excluded net sales |
| Listings & Products | Partial | variant table; channel-listing rows; current vs period labelling |
| Sales | Available | refund dating by refund day; FX per day |
| Traffic & Conversion | Needs credentials | sessions per store; site only for Shopify |
| Customers | Missing | customer ids on orders → new vs returning, repeat, LTV |
| Marketing | Needs credentials | Meta/TikTok Ads tokens; attribution stays platform-reported |
| Profitability | Partial | cost coverage %, fee estimates flagged, Amazon fee from data not 15% |
| Operations | Partial | stock cover derivable now; fulfillment time needs fulfillment dates; stock history |
| Insights & Reports | Partial | shared formulas so agents and page agree; annotations, saved views, alerts storage |

## Fix before building UI on top

1. One metric-definition module (versioned, e.g. Net sales v1) used by routes **and** agent tools.
2. Order dedupe by source ids across channels, with a count shown ("244 matched, 0 counted twice").
3. Freshness per source from `integrations.synced_at` plus a sync-run log; demo flag in responses.
4. Refunds by refund day; FX by day; tax and shipping separated from net sales.
5. AbortSignal in `api()` so store/range switches cancel stale requests.

Concept boards: Design canvas "Store Analytics Concepts" (https://claude.ai/artifact/AzpvBeTJDFRCLfbf5JynrM).
