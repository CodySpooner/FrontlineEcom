# Backlog — core lane (`apps/server/**` except `src/routes/agents*`, `packages/shared/**`, `apps/desktop/**`, root config)

Every endpoint's request/response types go in `packages/shared` first (additive only). Demo mode must keep working
with zero credentials. Never log or return secrets. API binds to 127.0.0.1.

## Inbox
<!-- other lanes append requests here: - [ ] (from <lane>) <request> -->
- [ ] (from agents) CORE-04: after inserting a store in POST /api/stores, call `createSquad(db, store)` from `@frontline/agents` (idempotent; ids `<storeId>:<role>`). Startup already runs `ensureSquads(db)` via `agentRoutes(db)`, mounted in `app.ts` (one line, agents lane).

## Items
- [x] CORE-01 SQLite layer on `node:sqlite` (`DatabaseSync`): data dir from `FRONTLINE_DATA_DIR` (default `./.data`),
      numbered SQL migrations run at startup, tables from DESIGN.md §6 that Phase 1 needs. Tests use an in-memory DB.
- [x] CORE-02 Demo generator: 3 seeded stores (Pawsome Gear pet/Shopify, Glow Haus beauty/Shopify, Peak Fit
      fitness/TikTok Shop), 2 years of daily metrics with trend + weekly seasonality + noise, products, orders, campaigns,
      pending approvals; deterministic seed; `demo` flag per store. (`dashboard-mockup-v3.html` has a seeded generator to start from.)
- [x] CORE-03 Analytics API: `GET /api/analytics/summary?stores=a,b&range=7|30|90|365` → totals (revenue, profit, ad
      spend, ROAS, orders, AOV), previous-period deltas, daily series per metric, per-store breakdown. Tests for the math.
- [ ] CORE-04 Stores API: list/get/create/update/delete with platform + niche; on create call the agents lane's
      `createSquad(store)` (stub until it exists).
- [ ] CORE-05 Live events: WebSocket `/api/live` broadcasting `StoreEvent`s; demo emitter generates realistic orders /
      add-to-carts / checkouts per store; `GET /api/events?stores=&limit=` for the initial feed.
- [ ] CORE-06 Approvals API: `GET /api/approvals?status=pending`, `POST /api/approvals/:id/approve|deny`; emits over
      `/api/live`; exposes an in-process hook so the agents lane can create requests and await decisions.
- [ ] CORE-07 Secrets: encrypted credential store (AES-256-GCM, key file in the data dir; Electron safeStorage later),
      `integrations` table, API that reports status but never returns secret values.
- [ ] CORE-08 Shopify connector: Admin GraphQL (custom-app access token first, OAuth later): shop, orders, products,
      inventory; incremental sync into SQLite on an interval; switches the store from demo to real. Fixture-based tests.
- [ ] CORE-09 Meta Ads connector: Marketing API insights per ad account/campaign (spend, purchases, purchase value,
      clicks, impressions); map ad accounts → stores; feed `ad_spend`.
- [ ] CORE-10 Google Ads + GA4 connectors (spend/conversions; sessions/funnel).
- [ ] CORE-11 TikTok Shop + TikTok Ads connectors.
- [ ] CORE-12 Etsy + Amazon SP-API connectors (read-only analytics first).
- [ ] CORE-13 Suppliers: CJ Dropshipping / DSers — product sourcing + order status (read first).
- [ ] CORE-14 Products & Orders API for the UI (filters, pagination, sort).
- [ ] CORE-15 Research feed: trending products dataset (demo) with scoring (margin, competition, trend, shipping),
      tabs as filters, saved lists API.
- [ ] CORE-16 Competitors: competitors per store, price snapshots, ad snapshots; API.
- [ ] CORE-17 Automation scheduler: rules (schedule cron | metric threshold) → action (agent task) with approval policy
      and caps; run log; survives restarts.
- [ ] CORE-18 Electron shell `apps/desktop`: starts the server in a utilityProcess, loads the web build (dev: Vite URL),
      single instance, frameless window with themed title bar, tray, safeStorage for secrets. Check `node:sqlite` under
      Electron's Node; fall back to better-sqlite3 if needed.
- [ ] CORE-19 Packaging: electron-builder Windows installer + icon from brand; `pnpm package`.
- [ ] CORE-20 Settings + budget caps + notifications API.
- [ ] CORE-21 Health: `/api/health` with connector statuses, structured logs to the data dir.

## Blocked

## Done
- 2026-10-26 — CORE-03 `GET /api/analytics/summary` (totals, previous, deltas, daily series, per-store), math tested
- 2026-10-26 — CORE-02 demo generator: deterministic per (store, date), 2y history topped up to today on every start, products, campaigns + campaign_daily, last-week orders, 3 pending approvals
- 2026-10-26 — CORE-01 SQLite layer (`node:sqlite`, `PRAGMA user_version` migrations, Phase 1 tables, stores read from DB); API contracts in shared
- 2026-10-26 — Phase 0: Hono app with `/api/health` + `/api/stores` (static demo), shared domain types (coordinator)
