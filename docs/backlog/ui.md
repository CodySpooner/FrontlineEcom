# Backlog — ui lane (`apps/web/**`)

Match `docs/reference/ui-reference.webp` and `docs/reference/dashboard-mockup-v3.html`. Fonts bundled, no CDNs, no
external images (the app must work offline). Use `lucide-react` for icons, `@tanstack/react-query` for server state,
`react-router` for routes, `recharts` (or hand-rolled SVG) for charts, `motion` for animation. Verify every screen in
Orca's browser against the reference before ticking it.

## Inbox
<!-- other lanes append requests here: - [ ] (from <lane>) <request> -->
- [ ] (from agents) Agent runs are live: `/api/live` now carries `{type:'run', run: AgentRun}` (queued/running/done/error/cancelled) and `{type:'run_event', runId, agentId, storeId, event: AgentEvent}` (text_delta stream, tool_call/tool_result, approval_request, memory_written, done/error). Agents show `status: 'running'` + `currentTask` while working. HTTP routes to start/cancel/chat come next (AGT-12, I'll post them here).
- [ ] (from core) For UI-17 Settings / UI-20 bell: `GET/PATCH /api/settings` (`Settings`: profile name/plan for the top-bar chip, sound, notification prefs, read-only dataDir); `GET /api/caps?stores=`, `PUT /api/caps/:storeId` (`StoreCaps`, autopilot per action kind); `GET /api/notifications?unread=true` → `AppNotification[]`, `POST /api/notifications/read { ids? }`; new ones arrive on `/api/live` as `{ type: 'notification' }`.
- [x] (from agents) Approvals now may carry `action.amountUsd` ($ at stake per day — show it on request cards) and `action.auto: true` (autopilot approved it within the store's cap — show an "Auto-approved" badge, these arrive already `approved`). Autopilot needs both: the agent on `autonomy: 'autopilot'` (`PATCH /api/agents/:id`) and core's `StoreCaps.autopilot[kind]` enabled for that action kind (`PUT /api/caps/:storeId`). Kinds agents use: `change_budget`, `pause_ad_set`, `publish_page`, `add_product`, `tool_use`, `save_niche_pack`. — cards + autopilot list done; per-kind caps editing lands with UI-17.
- [ ] (from core) For UI-09 Product Research: `GET /api/research?tab=trending|high_margin|low_competition|tiktok_viral|shopify_winners&niche=&q=` → `Page<ResearchProduct>` (score + `scoreParts` for the details modal; no images in demo data — use a category placeholder). Lists: `GET/POST /api/research/lists`, `DELETE /api/research/lists/:id`, `PUT|DELETE /api/research/lists/:id/items/:productId`. Add to store: `POST /api/research/:id/add-to-store { storeId }` → 201 `ApprovalRequest`.
- [ ] (from core) For UI-12 Orders / product lists: `GET /api/products?stores=&q=&status=&sort=title|price|inventory|margin&dir=` and `GET /api/orders?stores=&q=&status=&fulfillment=&sort=createdAt|total&dir=` → `Page<T>` (`items,total,offset,limit`; `?offset=&limit=` max 200). Order key = storeId + id.
- [ ] (from core) For UI-15 Integrations: `INTEGRATION_KINDS` in shared lists every integration with its form fields (`secret: true` → password input). `GET /api/integrations?stores=` → `Integration[]` (settings + `secretsSet`, never secret values), `PUT /api/integrations` `{ kind, storeId?, values }` (omitted secrets keep their stored value, so editing doesn't require retyping tokens), `DELETE /api/integrations/:id`.
- [x] (from core) Phase 1 API is live on main (types in `packages/shared`): `GET/POST /api/stores`, `GET/PATCH/DELETE /api/stores/:id`; `GET /api/analytics/summary?stores=a,b&range=7|30|90|365` → `AnalyticsSummary` (totals, previous, deltas %, daily `series`, `byStore`); `GET /api/events?stores=&limit=` → `StoreEvent[]` newest first; WebSocket `/api/live` → `LiveMessage` (`event` | `approval`); `GET /api/approvals?status=pending&stores=`, `POST /api/approvals/:id/approve|deny` (409 if already decided). Errors are `{ error }`. Store `connected: false` = demo data. You can delete the matching stubs.
- [x] (from agents) Squads API is live: `GET /api/agents?stores=a,b` → `Agent[]` (8 per store, `<storeId>:<role>` ids, `enabled`, `autonomy`, `status` incl. `waiting_approval` + `currentTask` = the pending request title), `GET /api/agents/:id` (encodeURIComponent the id), `PATCH /api/agents/:id` `{ enabled?, autonomy? }` → Agent (Deploy Agent = `{ enabled: true }`). Types: `Agent`, `AgentUpdate`, `Autonomy` in shared.

## Items
- [x] UI-01 Design system: tokens (already in index.css) + components: Card, Button (primary red glow / ghost), Chip,
      Segmented control, Badge, StatusDot (pulsing), ProgressBar/XPBar, Tooltip, Table, Empty/Loading/Error states, Modal/Drawer.
- [x] UI-02 App shell: sidebar (12 sections + icons, red active pill, System Status card, collapses to icons < 900px),
      page hero header (title, subtitle), top bar (Ask AI search, bell with count, profile chip), store switcher
      (All stores / any subset, persisted), routes for all 12 sections with placeholder pages.
- [x] UI-03 Data layer: typed API client using `packages/shared` contracts, react-query hooks, WebSocket hook for
      `/api/live`. Until core ships an endpoint, put a typed stub in one file (`src/api/stubs.ts`) and delete it when the real one lands.
- [x] UI-04 Dashboard (port the mockup): KPI cards w/ sparklines + deltas (Revenue, Profit hero, Ad Spend, ROAS, Orders, AOV),
      Revenue Overview area chart (7D/30D/90D/1Y, hover tooltip, weekly buckets for 1Y), Live Store Activity, AI Agents
      strip, Agent Requests (approve/deny → API, optimistic), Daily Missions. Store filter drives everything.
- [ ] UI-05 Hero art: per-page header art in the reference style (hooded/armored figure, red rim light, skyline,
      diagonal texture) as inline SVG/CSS; one shared component with per-page variants.
- [ ] UI-06 AI Agents page: store tabs; squad grid (8 roles): portrait, name, status, level + XP bar, blurb, Configure /
      Chat; Deploy Agent (enable a disabled role).
- [ ] UI-07 Agent detail: chat panel with streaming text + collapsible tool steps + inline approval cards; run history;
      memory list (learnings with confidence); settings (enabled, autonomy, caps, schedule).
- [ ] UI-08 Agent portraits: 8 distinct SVG characters (hooded, visor helmet, horned helm, masked, cyber-ninja, …), red
      glowing eyes; rank frames (Recruit → Legend).
- [ ] UI-09 Product Research: tabs (Trending, High Margin, Low Competition, TikTok Viral, Shopify Winners, My Lists),
      AI Research button, Filters, product cards (image, AI Score badge, price vs compare-at, margin %), details modal,
      save to list, "Add to store" (creates approval).
- [ ] UI-10 Creative Studio (Ad Creation): tabs (Generate Ads, UGC Avatars, Video to Video, Image Studio, Ad Variations,
      Ad Copy), prompt + Enhance with AI + aspect ratio, Generate with Higgsfield (credit cost), preview player, gallery,
      action row (Edit, Variations, Captions, Export, Save to Library), integration badges.
- [ ] UI-11 Store Analytics: revenue/profit chart, funnel, top products, channels, campaigns table (ROAS-colored).
- [ ] UI-12 Orders & Fulfillment: orders table (filters, status chips, supplier, tracking), issues queue.
- [ ] UI-13 Competitor Intel: competitors list, ad snapshots grid, price-change timeline, analyst briefs.
- [ ] UI-14 Automation: rules list + editor (trigger → action → approval policy/cap), run log.
- [ ] UI-15 Integrations: connector cards with status + connect forms (token fields never echo secrets back).
- [ ] UI-16 Knowledge Base: playbooks, platform/niche packs, store memory browser (search, pin, edit, delete).
- [ ] UI-17 Settings: profile, stores (add/edit: name, platform, niche, sub-niche, currency, color), caps, notifications, sound.
- [ ] UI-18 Gamification layer: commander level in top bar, XP toasts, level-up burst, achievements modal/page,
      missions widget, store health badges (Winning/Steady/Bleeding). Respect prefers-reduced-motion.
- [ ] UI-19 Ask AI palette (Ctrl+K): questions → selected store's Market Analyst chat; also jump-to-page commands.
- [ ] UI-20 Notification center (bell): approvals, agent finished, errors; mark read.
- [ ] UI-21 Onboarding: first run → explore demo, or add store → pick niche → meet your squad.
- [ ] UI-22 Polish: 1280–1920 first, usable to 900px; focus rings, keyboard nav, AA contrast; run styleseed-design-review.
- [ ] UI-24 Store Builder: the Store Developer agent's workspace — pages/sections it's building, change list, previews,
      approve to publish (DESIGN.md §4.6).
- [ ] UI-23 Tests (vitest + @testing-library/react + jsdom): KPI formatting, store filter, approvals flow, chart range bucketing.

## Blocked

## Done
- 2026-10-26 — Phase 0 skeleton shell + BrandLogo approximation (coordinator)
- 2026-10-26 — UI-01..04: design-system primitives (+ /dev/ui gallery), app shell with 12 routes + persisted store filter,
  typed data layer on the real API (react-query + /api/live; only missions stubbed in `src/api/stubs.ts`), Dashboard ported from mockup v3
- 2026-10-26 — Inbox: request cards show $/day at stake, "Autopilot · last 24h" list of auto-approved actions, profile chip from `/api/settings`
