# Frontline Ecom — Build Plan

Three Claude workers build in parallel lanes (`ui`, `core`, `agents`, see CLAUDE.md). Each lane's ordered backlog is in
`docs/backlog/<lane>.md`. Phases are milestones, not gates: a lane moves on as soon as its own items are done, using stubs
for anything another lane hasn't shipped yet.

## Phase 0 — Skeleton (done by coordinator, 2026-10-26)
pnpm workspace; `apps/web` (Vite + React + Tailwind v4, theme tokens, logo, sidebar shell), `apps/server` (Hono, health +
demo stores), `packages/shared` (domain types); `pnpm check` green; docs; three Orca workers launched.

## Phase 1 — Foundations → M1 "Command Center on demo data"
- ui: UI-01 design system, UI-02 app shell + routing, UI-03 data layer, UI-04 Dashboard
- core: CORE-01 SQLite, CORE-02 demo generator, CORE-03 analytics API, CORE-04 stores API, CORE-05 live events, CORE-06 approvals API
- agents: AGT-01 engine (fake + Claude), AGT-02 roles, AGT-06 squads, AGT-03 first playbooks
**M1 acceptance:** `pnpm dev` → Dashboard matches the reference/mockup: store filter + ranges drive KPIs/chart from the
API; live feed ticks over WebSocket; agent strip shows each store's squad; approving a request updates the API.

## Phase 2 — Agents alive → M2 "Talk to your squad"
- ui: UI-06 AI Agents page, UI-07 agent detail + chat, UI-08 portraits, UI-18 store health badges, UI-20 notifications
- core: CORE-07 secrets, CORE-14 products/orders API, CORE-15 research feed, CORE-20 settings/caps
- agents: AGT-04 platform packs, AGT-05 niche packs, AGT-07 prompt assembly, AGT-08 memory + learning, AGT-09 tools,
  AGT-10 approvals, AGT-11 run manager, AGT-12 API routes
**M2 acceptance:** from the UI, chat with Glow Haus's Market Analyst (fake engine in tests, real engine in a smoke run);
its answer cites store data via tools; it writes a learning to store memory; a side-effect request pauses for approval;
approval resumes it.

## Phase 3 — Real business data → M3 "Plug in a real store"
- core: CORE-08 Shopify, CORE-09 Meta Ads, CORE-10 Google Ads + GA4, CORE-11 TikTok, CORE-12 Etsy/Amazon, CORE-13 suppliers, CORE-16 competitors
- agents: AGT-14 external MCPs, AGT-15 creative pipeline (Higgsfield), AGT-16 Product Hunter pipeline, AGT-17 Ad Strategist pipeline
- ui: UI-09 Product Research, UI-10 Creative Studio, UI-11 Store Analytics, UI-12 Orders, UI-13 Competitor Intel, UI-15 Integrations
**M3 acceptance:** with a Shopify custom-app token and a Meta ad account, a store switches from demo to real data;
Product Hunter shortlists products; Creative Studio generates an ad through Higgsfield after approval.

## Phase 4 — Desktop + automation → M4 "Installable app"
- core: CORE-17 automation scheduler, CORE-18 Electron shell, CORE-19 Windows installer, CORE-21 health/logs
- agents: AGT-18 scheduled agent jobs
- ui: UI-14 Automation, UI-16 Knowledge Base, UI-17 Settings, UI-19 Ask AI palette, UI-21 onboarding
**M4 acceptance:** `pnpm package` produces a Windows installer; the installed app starts offline in demo mode; a daily
Product Hunter job runs on schedule and posts its shortlist as requests.

## Phase 5 — Depth and polish (ongoing)
UI-22/23, AGT-19/20, perf, accessibility, more niche packs, docs. When a backlog runs dry,
each worker compares the app against DESIGN.md and the reference and writes new items.
