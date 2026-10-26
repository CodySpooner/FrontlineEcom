# Backlog — ui lane (`apps/web/**`)

Match `docs/reference/ui-reference.webp` and `docs/reference/dashboard-mockup-v3.html`. Fonts bundled, no CDNs, no
external images (the app must work offline). Use `lucide-react` for icons, `@tanstack/react-query` for server state,
`react-router` for routes, `recharts` (or hand-rolled SVG) for charts, `motion` for animation. Verify every screen in
Orca's browser against the reference before ticking it.

## Inbox
<!-- other lanes append requests here: - [ ] (from <lane>) <request> -->
- [ ] (from agents) Niche learnings (shared `NicheLearning`): `GET /api/niche-learnings?niche=` (newest first) and `DELETE /api/niche-learnings/:id`. Owner-approved learnings every store of a niche sees; a small "Shared with all <niche> stores" list with delete fits the agent memory view. Approvals of kind `niche.promote_learning` carry `payload {niche, text, evidence}`.
- [ ] (from agents) Agents can now hand tasks to squadmates (`assign_task`): `AgentRun.parentRunId` is set on runs another agent assigned (task text ends with "(Assigned by the <Role>.)"). Worth an "Assigned by <Role>" chip in run history / the agent's activity, linking to the parent run.
- [ ] (from agents) Creatives: `Creative.mediaUrl` can now be a local URL `/api/creatives/media/<file>.(jpg|png|webp|mp4)` with `source: 'higgsfield'` (real renders, saved locally) besides the demo `data:image/svg+xml` ones. `kind` video/ugc with an `.mp4` URL needs a `<video controls muted playsInline>`; images stay `<img>`.
- [x] (from agents) For UI-10 Creative Studio: `GET /api/creatives?stores=&kind=image|video|ugc|copy&limit=` → `Creative[]` newest first (`Creative` in shared: headline, primaryText, cta, aspect, prompt, `mediaUrl` — demo renders are `data:image/svg+xml` URLs you can put in an `<img>` — credits, source `demo|higgsfield|agent`), `DELETE /api/creatives/:id`. "Generate" = start a run for the store's Creative Studio (`POST /api/agents/<store>:creative_studio/runs {task: 'Make a 9:16 video ad for …'}`); it asks approval (`action.kind: 'creative.generate'`, `payload.credits`) before spending credits, then the creative appears in the library. Ad Copy tab = same with `<store>:copywriter`.
- [x] (from core) Desktop app (CORE-18, run `pnpm desktop`) is frameless: the page's top bar is the title bar and Windows' min/max/close buttons sit on top of the page (top-right, 40px tall) — right now they cover the profile chip. When `navigator.windowControlsOverlay?.visible` (only true in the desktop app): give the header strip `app-region: drag` (its buttons/inputs/menus `app-region: no-drag`) and keep the controls' area clear, e.g. `padding-right: calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))`.
- [ ] (from core) For UI-14 Automation: `GET /api/automations?stores=` → `AutomationRule[]` (with `nextRunAt` for schedules), `POST /api/automations` (`AutomationRuleInput`), `PATCH /api/automations/:id` (any subset, e.g. `{ enabled: false }`), `DELETE /api/automations/:id`; run log `GET /api/automations/runs?stores=&rule=` → `AutomationRun[]` (started | awaiting_approval | denied | skipped | failed, with `detail`). Cron is 5-field local time; 400s carry a readable `error`.
- [x] (from agents) Gamification API is live (types in shared): `GET /api/missions?stores=` → `Mission[]` (your stub's shape — `Mission` is now in shared, delete the stub), `GET /api/commander` → `Commander {level, xp, rank, levelProgress {xp, needed}, streakDays}` (top-bar chip), `GET /api/achievements` → `Achievement[]` (whole catalog, `unlockedAt` on unlocked). Agents now carry `rank`, `nextLevelXp` (total XP where the next level starts, as you asked; `xp` is total XP) and `levelProgress {xp, needed}` (XP into the current level / its cost — use this for a bar that resets each level). Curve: level L→L+1 costs 100·L XP. `/api/live` sends `{type:'xp', xp: XpEvent, levelUp?: {level, rank}}` — XP toast, level-up burst (no `xp.agentId` = commander). — missions/commander/levels wired; toast + burst land with the XP feedback item. Refetch missions/commander on `xp`/`approval`/`run` messages.
- [x] (from agents) Agent chat/runs API is live (see `StartRunInput` / `MemoryInput` docs in shared): `POST /api/agents/:id/runs {task, resumeRunId?}` → 201 `AgentRun` (409 `{error}` when offline / store AI budget spent — show the message); follow-up chat = same call with `resumeRunId` = previous run id. `GET /api/runs/:id` → `AgentRunDetail` with `transcript` (also mid-run), then append `/api/live` `run_event`s for that `runId` (`text_delta` stream; `tool_call`/`tool_result` = "used store_summary" chips; `approval_request` inline approve/deny; `memory_written` = "learned: …" toast). `POST /api/runs/:id/cancel`. History: `GET /api/runs?agent=<id>` / `?stores=`. Memory tab: `GET /api/stores/:id/memory?q=`, `POST` (owner adds a preference/fact), `PATCH`/`DELETE /api/memory/:id`.
- [ ] (from core) For UI-13 Competitor Intel: `GET /api/competitors?stores=` → `Competitor[]` (productsTracked, activeAds), `POST /api/competitors { storeId, name, url, notes? }`, `DELETE /api/competitors/:id`; `GET /api/competitors/:id/snapshots?kind=ad|price` → `CompetitorSnapshot[]` (ad: network, format, headline, body, cta, firstSeen/lastSeen); `GET /api/competitors/price-changes?stores=` → `PriceChange[]` for the timeline. Demo stores come with 2 rivals each.
- [x] (from agents) Agent runs are live: `/api/live` now carries `{type:'run', run: AgentRun}` (queued/running/done/error/cancelled) and `{type:'run_event', runId, agentId, storeId, event: AgentEvent}` (text_delta stream, tool_call/tool_result, approval_request, memory_written, done/error). Agents show `status: 'running'` + `currentTask` while working. HTTP routes to start/cancel/chat come next (AGT-12, I'll post them here).
- [x] (from core) FYI: `pnpm dev` could leave the API down (Vite proxy ECONNREFUSED): `tsx watch` restarts on any stdin data and `pnpm --parallel` pipes stdin, so the server never bound. Fixed on main (server dev script is now `node --watch --import tsx`). Rebase; kill any stale `tsx watch` processes from your worktree.
- [ ] (from core) For UI-17 Settings / UI-20 bell: `GET/PATCH /api/settings` (`Settings`: profile name/plan for the top-bar chip, sound, notification prefs, read-only dataDir); `GET /api/caps?stores=`, `PUT /api/caps/:storeId` (`StoreCaps`, autopilot per action kind); `GET /api/notifications?unread=true` → `AppNotification[]`, `POST /api/notifications/read { ids? }`; new ones arrive on `/api/live` as `{ type: 'notification' }`.
- [x] (from agents) Approvals now may carry `action.amountUsd` ($ at stake per day — show it on request cards) and `action.auto: true` (autopilot approved it within the store's cap — show an "Auto-approved" badge, these arrive already `approved`). Autopilot needs both: the agent on `autonomy: 'autopilot'` (`PATCH /api/agents/:id`) and core's `StoreCaps.autopilot[kind]` enabled for that action kind (`PUT /api/caps/:storeId`). Kinds agents use: `change_budget`, `pause_ad_set`, `publish_page`, `add_product`, `tool_use`, `save_niche_pack`. — cards + autopilot list done; per-kind caps editing lands with UI-17.
- [x] (from core) For UI-09 Product Research: `GET /api/research?tab=trending|high_margin|low_competition|tiktok_viral|shopify_winners&niche=&q=` → `Page<ResearchProduct>` (score + `scoreParts` for the details modal; no images in demo data — use a category placeholder). Lists: `GET/POST /api/research/lists`, `DELETE /api/research/lists/:id`, `PUT|DELETE /api/research/lists/:id/items/:productId`. Add to store: `POST /api/research/:id/add-to-store { storeId }` → 201 `ApprovalRequest`.
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
- [x] UI-05 Hero art: per-page header art in the reference style (hooded/armored figure, red rim light, skyline,
      diagonal texture) as inline SVG/CSS; one shared component with per-page variants.
- [x] UI-06 AI Agents page: store tabs; squad grid (8 roles): portrait, name, status, level + XP bar, blurb, Configure /
      Chat; Deploy Agent (enable a disabled role).
- [x] UI-07 Agent detail: chat panel with streaming text + collapsible tool steps + inline approval cards; run history;
      memory list (learnings with confidence); settings (enabled, autonomy, caps, schedule).
- [x] UI-08 Agent portraits: 8 distinct SVG characters (hooded, visor helmet, horned helm, masked, cyber-ninja, …), red
      glowing eyes; rank frames (Recruit → Legend).
- [x] UI-09 Product Research: tabs (Trending, High Margin, Low Competition, TikTok Viral, Shopify Winners, My Lists),
      AI Research button, Filters, product cards (image, AI Score badge, price vs compare-at, margin %), details modal,
      save to list, "Add to store" (creates approval).
- [x] UI-10 Creative Studio (Ad Creation): tabs (Generate Ads, UGC Avatars, Video to Video, Image Studio, Ad Variations,
      Ad Copy), prompt + Enhance with AI + aspect ratio, Generate with Higgsfield (credit cost), preview player, gallery,
      action row (Edit, Variations, Captions, Export, Save to Library), integration badges.
- [x] UI-11 Store Analytics: revenue/profit chart, funnel, top products, channels, campaigns table (ROAS-colored).
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
- 2026-10-26 — UI-05: hero scenes per page (duo, squad, scan rings, pulse line, lone) + red page icon by the title
- 2026-10-26 — UI-06: AI Agents page — store tabs (?store= deep link), squad grid with portrait/status/LV+XP/blurb, Configure/Chat links, Deploy Agent dialog + per-card Deploy; `Tabs` + `buttonClass` primitives
- 2026-10-26 — UI-07: Agent detail — chat over runs (resume, live stream, Stop, tool steps, inline approvals, learnings), run history, squad memory (teach / forget, confidence), settings (deployed, autonomy, store caps). Schedule waits on agents (inbox).
- 2026-10-26 — Inbox: real missions (open first, all-scope count), agent rank + level progress bars, commander level in the profile chip, live refetch on xp/approval/run; stubs.ts deleted
- 2026-10-26 — UI-08: 8 role characters (horned, visor, hood, crest, ram, masked, ninja, heavy) as one SVG sprite; rank frames Recruit → Legend on every portrait
- 2026-10-26 — UI-09: Product Research — 5 research tabs + My Lists (?tab=), search + niche filter, scored product cards (niche icon until images), bookmark → Saved list, details dialog (score breakdown, lists, Request to add → approval), AI Research → store's Product Hunter chat
- 2026-10-26 — Inbox: desktop title bar — with the window-controls overlay visible, the hero strip is the drag region (controls no-drag) and pads right past Windows' caption buttons (CSS verified in Chrome; not yet seen in Electron)
- 2026-10-26 — UI-10: Creative Studio — 6 tool tabs (?tab=), brief + Enhance + aspect, Generate with Higgsfield (credit price; asks approval via Creative Studio agent) / Write with Claude (Copywriter), preview (img/video), library gallery, actions (Edit in Studio, Variations, Captions, Export/Copy text, Delete), library refreshes on run end
- 2026-10-26 — UI-11: Store Analytics — range + store filter, revenue/profit/ad-spend trend with ROAS/break-even/orders/AOV, conversion funnel, channels, top products, campaigns table (ROAS colored vs each store's break-even), by-store table. Funnel/campaigns/top-products are stubbed in api/stubs.ts (marked Estimated) until core's endpoints land (requested). Tooltip no longer widens the page when hidden.
- 2026-10-26 — Inbox: run history shows an "Assigned by <Role>" chip on delegated runs, linking to the parent run (`/agents/:id?run=` deep-links a conversation); creative videos play muted + inline, Export keeps the real file extension
