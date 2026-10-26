# Backlog — core lane (`apps/server/**` except `src/routes/agents*`, `packages/shared/**`, `apps/desktop/**`, root config)

Every endpoint's request/response types go in `packages/shared` first (additive only). Demo mode must keep working
with zero credentials. Never log or return secrets. API binds to 127.0.0.1.

## Inbox
<!-- other lanes append requests here: - [ ] (from <lane>) <request> -->
- [ ] (from agents) Store Builder publishing (AGT-26): approved `store.publish_page` on connected Shopify stores only notifies the owner. When the connector can push it, export e.g. `publishProductPage(db, key, storeId, productId, { title, descriptionHtml, seoTitle?, seoDescription? })` (productUpdate) and `publishPage(db, key, storeId, { title, bodyHtml })` (pageCreate, needs `write_content`) and I'll call them from `publishDraft`. FYI migration 15 (agents lane) adds `page_drafts`.
- [ ] (from agents) FYI migration 14 (agents lane) adds table `niche_learnings`; no action needed.
- [x] (from ui) For UI-11 Store Analytics. These are stubbed in `apps/web/src/api/stubs.ts`, and the interfaces there are the proposed shapes; the page shows an "Estimated" badge until each lands. (1) Funnel: add `funnel: { sessions, addToCarts, checkouts, orders }` (period totals from daily_metrics) to `AnalyticsSummary`, which is additive. (2) `GET /api/analytics/campaigns?stores=&range=` → `CampaignStats[]` `{ network, id, storeId, name, status, dailyBudget, spend, revenue, roas, purchases, clicks, impressions }`, biggest spend first. It's the same query as agents' `list_campaigns`, and channels are grouped by network client-side. (3) `GET /api/analytics/top-products?stores=&range=&limit=` → `{ storeId, productId, title, image?, units, revenue, profit }[]`. This needs order line items; demo stores can derive them.
- [x] (from agents) FYI migration 12 (agents lane) adds `agent_runs.parent_run_id`; no action needed. The scheduler's `RunTask` call is unchanged (`start(agentId, task)`).
- [x] (from agents) Approved `store.add_products` now adds draft products to demo stores (agents lane, `routes/agents-actions.ts`). For connected Shopify stores the owner only gets a notification: when the connector can `productCreate` (needs `write_products` in the custom-app scopes/help text), export e.g. `createProducts(db, key, storeId, products[])` and I'll call it from `addProducts`.
- [x] (from agents) Meta Ads integration help: agents now use Meta's official MCP (`https://mcp.facebook.com/ads`) with the stored token, which needs the `ads_mcp_management` permission in addition to `ads_read` (and `ads_management` for changes the owner approves). Please add those to the `meta_ads` help text. Also for AGT-15: a `higgsfield` integration kind (its MCP `mcp.higgsfield.ai/mcp` is OAuth) — tell me the field name the token lands in.
- [x] (from agents) FYI: agents appended migration 7 (`agent_runs`) to `MIGRATIONS`, and two `LiveMessage` variants in shared (`run`, `run_event`). `apps/server/src/routes/agents.ts` calls your `notify()` for finished/failed runs and `getCaps().agentCostPerDay` before starting one.
- [x] (from agents) FYI: agents lane appended migration 4 (`store_memory` + `store_memory_fts` FTS5 + sync triggers) to `MIGRATIONS` in `db.ts`. Next agents migrations (agent_runs, xp_events) will be appended the same way — rebase before adding yours to avoid number clashes.
- [x] (from agents) CORE-04: after inserting a store in POST /api/stores, call `createSquad(db, store)` from `@frontline/agents` (idempotent; ids `<storeId>:<role>`). Startup already runs `ensureSquads(db)` via `agentRoutes(db)`, mounted in `app.ts` (one line, agents lane).

## Items
- [x] CORE-01 SQLite layer on `node:sqlite` (`DatabaseSync`): data dir from `FRONTLINE_DATA_DIR` (default `./.data`),
      numbered SQL migrations run at startup, tables from DESIGN.md §6 that Phase 1 needs. Tests use an in-memory DB.
- [x] CORE-02 Demo generator: 3 seeded stores (Pawsome Gear pet/Shopify, Glow Haus beauty/Shopify, Peak Fit
      fitness/TikTok Shop), 2 years of daily metrics with trend + weekly seasonality + noise, products, orders, campaigns,
      pending approvals; deterministic seed; `demo` flag per store. (`dashboard-mockup-v3.html` has a seeded generator to start from.)
- [x] CORE-03 Analytics API: `GET /api/analytics/summary?stores=a,b&range=7|30|90|365` → totals (revenue, profit, ad
      spend, ROAS, orders, AOV), previous-period deltas, daily series per metric, per-store breakdown. Tests for the math.
- [x] CORE-04 Stores API: list/get/create/update/delete with platform + niche; on create call the agents lane's
      `createSquad(store)` (stub until it exists).
- [x] CORE-05 Live events: WebSocket `/api/live` broadcasting `StoreEvent`s; demo emitter generates realistic orders /
      add-to-carts / checkouts per store; `GET /api/events?stores=&limit=` for the initial feed.
- [x] CORE-06 Approvals API: `GET /api/approvals?status=pending`, `POST /api/approvals/:id/approve|deny`; emits over
      `/api/live`; exposes an in-process hook so the agents lane can create requests and await decisions.
- [x] CORE-07 Secrets: encrypted credential store (AES-256-GCM, key file in the data dir; Electron safeStorage later),
      `integrations` table, API that reports status but never returns secret values.
- [x] CORE-08 Shopify connector: Admin GraphQL (custom-app access token first, OAuth later): shop, orders, products,
      inventory; incremental sync into SQLite on an interval; switches the store from demo to real. Fixture-based tests.
- [x] CORE-09 Meta Ads connector: Marketing API insights per ad account/campaign (spend, purchases, purchase value,
      clicks, impressions); map ad accounts → stores; feed `ad_spend`.
- [x] CORE-10 Google Ads + GA4 connectors (spend/conversions; sessions/funnel).
- [x] CORE-11 TikTok Shop + TikTok Ads connectors.
- [x] CORE-12 Etsy + Amazon SP-API connectors (read-only analytics first).
- [ ] CORE-13 Suppliers: CJ Dropshipping / DSers — product sourcing + order status (read first).
- [x] CORE-14 Products & Orders API for the UI (filters, pagination, sort).
- [x] CORE-15 Research feed: trending products dataset (demo) with scoring (margin, competition, trend, shipping),
      tabs as filters, saved lists API.
- [x] CORE-16 Competitors: competitors per store, price snapshots, ad snapshots; API.
- [x] CORE-17 Automation scheduler: rules (schedule cron | metric threshold) → action (agent task) with approval policy
      and caps; run log; survives restarts.
- [x] CORE-18 Electron shell `apps/desktop`: starts the server in a utilityProcess, loads the web build (dev: Vite URL),
      single instance, frameless window with themed title bar, tray, safeStorage for secrets. Check `node:sqlite` under
      Electron's Node; fall back to better-sqlite3 if needed.
- [ ] CORE-19 Packaging: electron-builder Windows installer + icon from brand; `pnpm package`.
- [x] CORE-20 Settings + budget caps + notifications API.
- [ ] CORE-21 Health: `/api/health` with connector statuses, structured logs to the data dir.
- [ ] CORE-22 OAuth connect flows: "Connect" buttons that run Etsy (PKCE), TikTok Shop (auth code) and Google Ads OAuth through a
      127.0.0.1 redirect and store the tokens, so owners don't have to mint refresh tokens by hand.

## Blocked

## Done
- 2026-10-26 — Inbox (ui UI-11, 2/2): `order_items` (migration 16) filled by the Shopify / TikTok Shop / Etsy syncs, and `GET /api/analytics/top-products?stores=&range=&limit=` → `TopProduct[]`; demo stores split their period revenue across active products
- 2026-10-26 — Fix: Shopify orders query cost was ~2177 points (> Shopify's 1000 max, so real syncs would fail); page size 25 → 10 orders (872), cost math documented
- 2026-10-26 — Inbox (ui UI-11, 1/2): `AnalyticsSummary.funnel` (sessions / add to carts / checkouts / orders) and `GET /api/analytics/campaigns?stores=&range=` → `CampaignStats[]` (shared types `Funnel`, `AdNetwork`, `CampaignStats`)
- 2026-10-26 — CORE-12 (2/2) Amazon SP-API connector (read-only analytics): LWA token → Sales API orderMetrics (daily, store timezone, offsets DST-correct) → new `channel_daily` table (migration 13); revenue rebuild now sums platform orders + channel totals
- 2026-10-26 — CORE-12 (1/2) Etsy connector: Open API v3 (`x-api-key` keystring:secret), hourly token renewal with rotating refresh tokens saved encrypted, paid receipts → orders/revenue, listings newest-changed first with early stop
- 2026-10-26 — CORE-11 (2/2) TikTok Shop connector: signed Partner API 202309 requests, access token renewed with the refresh token and saved encrypted, first authorized shop, products + paid orders (tt- ids) → shared revenue rebuild with Shopify
- 2026-10-26 — CORE-11 (1/2) TikTok Ads connector: Marketing API v1.3 daily AUCTION_CAMPAIGN report in 30-day chunks + campaign list → campaigns/campaign_daily (network `tiktok`) → ad_spend; 28-day re-pull
- 2026-10-26 — CORE-10 Google Ads (API v26, GAQL search, OAuth refresh token; campaigns + campaign_daily → ad_spend, 30-day re-pull) and GA4 (Data API, service-account JWT, read-only; owns sessions / add_to_carts / checkouts); both in the sync loop, help text in the catalog
- 2026-10-26 — Inbox: Shopify `createProducts` (priced drafts via productCreate + productVariantsBulkUpdate, `write_products` in help); Meta help lists `ads_mcp_management` / `ads_management`; `higgsfield` integration kind (global, key ID + secret for api.higgsfield.ai)
- 2026-10-26 — CORE-18 Electron shell `apps/desktop` (`pnpm desktop`): API in a utilityProcess on a free localhost port serving the web build (`FRONTLINE_DEV_URL` = load Vite instead), single instance, frameless window with themed native controls, close-to-tray, data in `%APPDATA%/Frontline Ecom/data`, credentials key in safeStorage (unreadable key → owner can reset; connectors then ask for tokens again instead of crashing). `node:sqlite` + FTS5 verified under Electron 44 (Node 24.21): no better-sqlite3 fallback needed
- 2026-10-26 — CORE-17 automation scheduler: rules (5-field local cron | metric threshold over N days) → agent task via the run manager; approval `ask` (approvals hook) or `auto`; daily cap + cooldown; run log; survives restarts (persisted `checked_at`, 24h catch-up, pending approvals re-attached); `GET/POST /api/automations`, `PATCH/DELETE /api/automations/:id`, `GET /api/automations/runs`
- 2026-10-26 — CORE-16 competitors: `competitors` + `competitor_snapshots` (price | ad), `GET/POST /api/competitors`, `DELETE /api/competitors/:id`, `GET/POST /api/competitors/:id/snapshots`, `GET /api/competitors/price-changes`; demo rivals for the 3 demo stores
- 2026-10-26 — Fix: `pnpm dev` API never started (tsx watch restarts on stdin data under `pnpm --parallel`); server dev now `node --watch --import tsx`. Verified Command Center on the real API in the browser.
- 2026-10-26 — CORE-09 Meta Ads connector: campaigns + daily campaign insights (spend, de-duplicated purchases/value, clicks, impressions), 730-day backfill in 90-day chunks then 28-day attribution re-pull, `daily_metrics.ad_spend` rebuilt across networks; shared `switchToReal`/`rebuildAdSpend`
- 2026-10-26 — CORE-08 Shopify connector: Admin GraphQL (custom-app token, myshopify.com-only host), incremental products/orders sync by `updated_at` (2y backfill), daily revenue/orders/cogs rebuilt per store-local day, first sync wipes demo rows and flips the store to connected, errors surface on the integration; sync loop every 30s (stale 10 min / on credential change)
- 2026-10-26 — CORE-20 `GET/PATCH /api/settings`, `GET /api/caps` + `PUT /api/caps/:storeId` (budget caps + per-action autopilot), notifications table + `notify()` (live broadcast, honors prefs), `GET /api/notifications`, `POST /api/notifications/read`; approvals raise a notification
- 2026-10-26 — CORE-15 research feed: 30-product demo dataset, `scoreProduct` (margin/trend/competition/shipping), tabs as filters, niche + search, saved lists API, "add to store" → Product Hunter approval
- 2026-10-26 — CORE-14 `GET /api/products` + `GET /api/orders` (store filter, `q` search, status filters, whitelisted sort, `Page<T>` pagination)
- 2026-10-26 — CORE-07 secrets: AES-256-GCM (row-bound AAD) with `secret.key` in the data dir, `integrations` table, `GET/PUT /api/integrations`, `DELETE /api/integrations/:id`, `INTEGRATION_KINDS` catalog in shared; secret values never returned
- 2026-10-26 — CORE-06 approvals: `GET /api/approvals?status=&stores=`, `POST /api/approvals/:id/approve|deny` (404/409), broadcasts on `/api/live`, in-process `approvalsHook(db)` (`create` + awaitable `decision`)
- 2026-10-26 — CORE-05 `/api/live` WebSocket (`LiveMessage`), `GET /api/events`, demo emitter (8–25s, weighted by store size, backfills a quiet feed, prunes >7d)
- 2026-10-26 — CORE-04 stores CRUD (`GET/POST /api/stores`, `GET/PATCH/DELETE /api/stores/:id`), validation, new stores start in demo mode with history and get a squad via `createSquad`
- 2026-10-26 — CORE-03 `GET /api/analytics/summary` (totals, previous, deltas, daily series, per-store), math tested
- 2026-10-26 — CORE-02 demo generator: deterministic per (store, date), 2y history topped up to today on every start, products, campaigns + campaign_daily, last-week orders, 3 pending approvals
- 2026-10-26 — CORE-01 SQLite layer (`node:sqlite`, `PRAGMA user_version` migrations, Phase 1 tables, stores read from DB); API contracts in shared
- 2026-10-26 — Phase 0: Hono app with `/api/health` + `/api/stores` (static demo), shared domain types (coordinator)
