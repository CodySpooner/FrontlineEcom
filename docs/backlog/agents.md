# Backlog — agents lane (`packages/agents/**`, `apps/server/src/routes/agents*.ts`)

Read the `claude-api` skill before writing engine code (Agent SDK: `query()`, streaming, `resume`, `canUseTool`,
`mcpServers`). Study `C:/dev/_reference/t3code/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts` and
`packages/contracts/src/orchestrationV2.ts` for a battle-tested way to drive it (MIT — keep the notice on ported code).
Tests always use the FakeEngine; at most one short real-engine smoke run per task.

## Inbox
<!-- other lanes append requests here: - [ ] (from <lane>) <request> -->
- [ ] (from core) Done: `createProducts(db, key, storeId, [{ title, price, compareAt?, cost? }], fetch?)` in `apps/server/src/connectors/shopify.ts` creates priced DRAFT products in Shopify and inserts them locally; returns `{ id, title }[]`, throws a readable error (catch → notify). Key: `loadKey(dataDir())` from `secrets.ts`/`db.ts`. Higgsfield: integration kind `higgsfield` (global): `getCredentials(db, key, 'higgsfield')` → `{ keyId, keySecret }`; call the REST API `https://api.higgsfield.ai` with `Authorization: Key ${keyId}:${keySecret}` (server-side only). Its hosted MCP signs in with browser OAuth, which a local app can't hold, so use REST. Meta help now asks for `ads_mcp_management` (+ `ads_management` for approved changes).
- [ ] (from ui) Demo mode: give the fake engine's default script a little more than an echo — one real read-only tool call
      (e.g. `analytics_summary`), a `memory_written` now and then, and text streamed with small delays — so the Agent chat
      (UI-07) shows tool steps and learnings with zero credentials. Also: an agent `schedule` (standing task + cadence) for
      the Settings tab, when you get to it.
- [x] (from ui) AGT-13: please put the level curve on `Agent` — `nextLevelXp` (XP that fills the bar at the current level, same units
      as `xp`) and `rank` (Recruit … Legend). The AI Agents page uses a linear stand-in (`nextLevelXp` in `apps/web/src/api/stubs.ts`).
- [ ] (from core) Scheduler for AGT-18 is live (`apps/server/src/automations.ts`, started in `index.ts` with `runManager(db).start`). Jobs are rows in `automation_rules`: create them with `POST /api/automations` `{ storeId, name, trigger: { type: 'schedule', cron: '0 8 * * *' } | { type: 'metric', metric, op, value, windowDays }, action: { type: 'agent_task', agentId, task }, approval: 'auto'|'ask', maxRunsPerDay }` (or insert the same columns). The task text gets an `(Automation "name": reason.)` suffix.
- [x] (from core) `list_competitors` can be implemented now: `listCompetitors(db, storeIds)` and `priceChanges(db, storeIds, limit)` in `apps/server/src/competitors.ts`, raw rows in `competitors` / `competitor_snapshots` (kind price|ad, `data_json`). Market Analyst can record what it finds with `addSnapshot(db, competitorId, { kind, data })` (types `PriceSnapshotData` / `AdSnapshotData` in shared) or `POST /api/competitors/:id/snapshots`.
- [x] (from ui) `GET /api/missions` → `Mission[]` for every store, `Mission { id, storeId, title, progress, target, xp }` (add
      `Mission` to `packages/shared`). The Dashboard's Daily Missions panel uses a stub in `apps/web/src/api/stubs.ts` until it lands.
- [x] (from core) For AGT-10/11: `getCaps(db, storeId)` (`apps/server/src/settings.ts`) → `StoreCaps` (adSpendChangePerDay, higgsfieldCreditsPerDay, agentCostPerDay, `autopilot[actionKind] = { enabled, maxUsdPerDay }`) — the owner edits these in Settings. `notify(db, { kind: 'agent_done' | 'error' | 'info', title, body?, storeId?, link? })` creates a bell notification (approvals already notify on create).
- [x] (from core) For AGT-16: research data is in `research_products` (see `apps/server/src/research.ts`); `scoreProduct()` is exported. Product Hunter can insert new finds there (same columns) and they show in the UI feed. Approved `store.add_products` approvals carry `payload.products[]` (researchProductId, title, price, compareAt, cost) — executing them (adding to the store) is yours.
- [x] (from core) For AGT-09 tools, core's data functions are plain sync functions over `Db` you can wrap/inject from `routes/agents.ts`: `summarize(loadRows(db, storeIds, range, to), {range, to, storeIds})` (`analytics.ts`), `listProducts` / `listOrders(db, storeIds, q)` → `Page<T>` (`catalog.ts`, `q` = query-param getter), `listEvents` (`live.ts`), `listApprovals` (`approvals.ts`). Or call the HTTP API. Tell core if you want a different shape.
- [x] (from core) Approvals hook is live for AGT-10: `import { approvalsHook } from '../approvals'` in `apps/server/src/routes/agents.ts` → `approvalsHook(db)` implements `ApprovalsHook` from shared (`create(input)` stores + broadcasts; `await decision(id)` resolves on approve/deny). Live bus: `subscribe`/`publish` from `apps/server/src/live.ts` (add new `LiveMessage` types in shared, e.g. agent status/run events).
- [x] (from core) FYI: core's SQLite schema already has an `agents` table (id, store_id, role, enabled, autonomy, level, xp, settings_json; UNIQUE(store_id, role)) — see `apps/server/src/db.ts`. Seeded demo approvals use agent ids `<storeId>:<role>` (e.g. `peak:ad_strategist`); please use the same id format for squads, or tell core in its Inbox. Need more tables (agent_runs, store_memory + FTS5, xp_events…)? Ask in core's Inbox and core adds a migration, or add one yourself by appending to `MIGRATIONS`.

## Items
- [x] AGT-01 `packages/agents` package + engine interface: `runAgent({ agent, store, task, resume? })` →
      `AsyncIterable<AgentEvent>` (`text_delta`, `tool_call`, `tool_result`, `approval_request`, `memory_written`, `done`,
      `error`). `FakeEngine` (scripted, deterministic) and `ClaudeEngine` (Agent SDK `query()` on the owner's local Claude
      Code login, partial-message streaming, resume). Put shared event types in `packages/shared`.
- [x] AGT-02 Role catalog: the 8 roles in `AGENT_ROLES` → system prompt, allowed tools, default autonomy, XP rules.
- [x] AGT-03 Playbooks `packages/agents/playbooks/<role>.md`: concise expert playbooks distilled from the installed skills
      (ecommerce-ppc-strategy-planner, dropshipping-product-research, shopify-*, tiktok-shop-*, etsy-*,
      ecommerce-email-marketing-builder, ecommerce-landing-page, product-description-generator, competitor/pricing skills…).
- [x] AGT-04 Platform packs `packs/platform/<platform>.md`: shopify, tiktok_shop, etsy, amazon, woocommerce.
- [x] AGT-05 Niche packs `packs/niche/<niche>.md`: beauty, pet, tech, fitness, home, fashion, kids, outdoor + template
      (audience, triggers, compliance, seasonality, creative angles, price norms, suppliers) + a Market Analyst task that
      drafts a pack for a custom niche (saving it needs approval).
- [x] AGT-06 Squads: `createSquad(store)` makes one agent per role (persisted via core's DB once CORE-01 lands; in-memory
      until then); enable/disable; level/XP/status/currentTask; API for the UI.
- [x] AGT-07 Prompt assembly: role + playbook + platform pack + niche pack + store profile + top-K memories, token-budgeted.
      Tests assert the right layers are included per store.
- [x] AGT-08 Store memory + learning loop: post-run reflection → `store_memory` rows (text, evidence, confidence, tags);
      FTS5 retrieval (relevance × recency × confidence); outcome feedback adjusts confidence; promote cross-store
      learnings to niche packs via approval.
- [x] AGT-09 Tools: in-process MCP server over app data (analytics, products, orders, campaigns, competitors, research,
      memory read/write, create approval, create creative); per-role allowlists.
- [x] AGT-10 Approvals: side-effect tools and `canUseTool` create approval requests through core's approvals hook; run
      pauses, resumes on decision; autopilot rules auto-approve within caps and log.
- [x] AGT-11 Run manager: queue, global concurrency (default 3), per-store limits, cancel/resume, persisted transcripts,
      token/cost + Higgsfield-credit accounting with daily caps.
- [x] AGT-12 Agent API routes (`apps/server/src/routes/agents.ts`, mounted in app.ts): squads, agent detail, start run,
      stream run events (over `/api/live` or SSE), chat (resume), cancel, memory CRUD.
- [x] AGT-13 Gamification engine: XP events, level curve, ranks (Recruit → Operative → Specialist → Veteran → Elite →
      Legend), achievements catalog + unlock checks, daily missions per store, streaks, commander level; API.
- [x] AGT-14 External MCP wiring per store when connected: Shopify (official), Meta Ads (`mcp.facebook.com/ads`),
      Google Ads / GA4, Higgsfield (`mcp.higgsfield.ai/mcp`, OAuth). Off in demo mode.
- [x] AGT-15 Creative pipeline: Creative Studio + Copywriter → Higgsfield image/video/UGC with credit estimate +
      approval → saved to creatives library; ad copy variants.
- [x] AGT-16 Product Hunter pipeline: research → score (margin, trend, competition, shipping) → shortlist → "add to
      store" approval → Store Developer drafts the product.
- [x] AGT-17 Ad Strategist pipeline: daily campaign review → pause/scale/test recommendations as approval requests with evidence.
- [ ] AGT-18 Scheduled jobs on core's scheduler: daily briefing per store, weekly report, daily product scan.
- [ ] AGT-19 (later) Codex as an alternate engine for Store Developer code work.
- [ ] AGT-20 Evals: fixture checks that prompt assembly and FakeEngine flows produce the expected tools/approvals/memories.

## Blocked
- AGT-14 Google Ads / GA4 MCPs: the official servers (`googleads/google-ads-mcp`, `googleanalytics/google-analytics-mcp`) are local pipx Python processes that read a credentials JSON file (ADC) + `GOOGLE_PROJECT_ID`; wiring them means writing decrypted credentials to disk and requiring Python/pipx on the owner's machine. Needs: an owner decision, or core's Google connectors syncing data our tools read instead.
- AGT-14 Higgsfield MCP (`mcp.higgsfield.ai/mcp`) is OAuth-only and there is no `higgsfield` integration kind yet. Needs: core to add it (OAuth flow storing a token). Picked up with AGT-15.

## Done
- 2026-10-26 — AGT-17 Ad Strategist pipeline: `review_campaigns` (break-even/target ROAS + max CPA from 30-day margin, verdict scale/hold/cut/pause/learning per campaign, suggested budget), `propose_ad_change` (pause or new budget with evidence → `ads.pause_campaign` / `ads.set_budget` approval, `amountUsd` = budget added so autopilot rules apply, enforces `adSpendChangePerDay`); approved changes are applied to demo campaigns (connected stores get an "apply on the ad account" notification); measured wins: blended ROAS over the 3 days after an approved ad change beats the 7 days before → +50 XP once. Playbook updated. The daily review itself is scheduled in AGT-18.
- 2026-10-26 — AGT-16 Product Hunter pipeline: `record_product_find` tool puts web finds into core's research feed with the same AI score; the playbook asks for `store.add_products` approvals (payload documented in the tool); any approved `store.add_products` (research screen or agent) is executed by an approvals watcher — demo stores get draft products + a Store Developer run to draft each page, connected stores get an "add by hand" notification until core has Shopify productCreate.
- 2026-10-26 — AGT-15 Creative pipeline (demo-first): `creatives` library (migration 11) + `GET /api/creatives`, `DELETE /api/creatives/:id`; `create_creative` tool for Creative Studio + Copywriter — `copy` saves ad copy variants directly; image/video/ugc check the store's `higgsfieldCreditsPerDay` cap, request approval (`creative.generate`, credits in the reason), then save a demo SVG render in the store's colors. Real Higgsfield generation waits on the integration (Blocked).
- 2026-10-26 — AGT-14 External MCP per store: roles declare `mcp` servers (Ad Strategist, Creative Studio, Market Analyst → `meta_ads`); when a store has Meta Ads connected the engine attaches Meta's official hosted MCP (`https://mcp.facebook.com/ads`, `Authorization: Bearer` from core's encrypted credentials); demo stores get none. External read-style tools (get/list/search/read/fetch/describe/lookup/find) run freely, anything else becomes an approval request. Shopify has no official Admin MCP (verified: only the docs-only Dev MCP + community servers) — store reads stay on core's connector + our tools; Google Ads/GA4/Higgsfield under Blocked. Not smoke-tested against a real Meta account (no token).
- 2026-10-26 — Inbox: `list_competitors` tool (competitors, recent price changes, recent ads) over core's competitor tracking; Ad Strategist, Product Hunter, Creative Studio, Market Analyst and Copywriter have it.
- 2026-10-26 — AGT-13 Gamification: `xp_events` ledger (migration 8, idempotent by ref); agents earn XP for finished runs (+10), learnings (+5), approved requests (+25); level curve (level L costs 100·L), ranks Recruit 1 / Operative 5 / Specialist 10 / Veteran 15 / Elite 20 / Legend 30 on `Agent.rank` + `levelProgress`; 3 daily missions per store (beat the 7-day average on revenue and orders, clear requests or brief the squad) paying the commander; 10 achievements; commander level + profit streak; `GET /api/missions`, `/api/achievements`, `/api/commander`; live `xp` messages with `levelUp`. Showcase demo squads start with varied XP. "Measured win" XP lands with outcome tracking in AGT-17.
- 2026-10-26 — AGT-12 Agent API: `POST /api/agents/:id/runs {task, resumeRunId?}` (chat = resume), `GET /api/runs?stores=&agent=&limit=`, `GET /api/runs/:id` (live transcript while running), `POST /api/runs/:id/cancel`, store memory CRUD (`GET/POST /api/stores/:id/memory`, `PATCH/DELETE /api/memory/:id`, owner-written memories as agentId `owner`); events stream over `/api/live` (`run`, `run_event`). Contracts `StartRunInput`, `MemoryInput` in shared.
- 2026-10-26 — AGT-11 Run manager (`createRunManager`): `agent_runs` table is the queue (migration 7); global concurrency 3, 2 per store, 1 per agent; cancel (queued/running); persisted transcripts (text deltas merged) + tokens/cost; store's daily `agentCostPerDay` cap blocks new runs; prompt gets top-12 memories for the task; runs that used tools reflect in the same session → memories; follow-ups resume the previous run's session; restart marks in-flight runs interrupted; agent status `running` + task; server publishes `run`/`run_event` on the live bus and notifies done/error. Real smoke: tool call → answer → 3 memories, $0.29. Higgsfield-credit accounting lands with AGT-15.
- 2026-10-26 — AGT-10 Approvals: shared `requestApproval` used by the `request_approval` tool and the Claude engine's `canUseTool` (any non-pre-approved tool, e.g. future external-MCP writes, asks the owner); autopilot agents auto-approve when the store's `StoreCaps.autopilot[kind]` is enabled and `amountUsd` fits today's remaining cap for that kind (logged as `action.auto` + reason note); approved `save_niche_pack` executes; `research_feed` tool over core's feed. Shared: `ApprovalAction` (+`amountUsd`, `auto`).
- 2026-10-26 — AGT-05 Niche packs for beauty, pet, tech, fitness, home, fashion, kids, outdoor + `_template.md`; `draftNichePackTask(store)` has the Market Analyst research a custom niche and request `save_niche_pack`; on approval it is saved to `<data dir>/packs/niche/<slug>.md` and `assemblePrompt` uses it for stores without a built-in pack.
- 2026-10-26 — AGT-09 Store tools: engine-agnostic `APP_TOOLS` (store_summary, metrics_timeseries, list_products/orders/campaigns, search/write_memory, request_approval) + per-role `toolsFor`; Claude engine serves them as in-process MCP server `frontline`, fake engine runs them for real (`{ call }` script steps); tool events stream through a channel so approval requests show while the run waits. `toolEnv(db)` wires core's analytics + approvals hook. Competitors/research/create_creative tools wait on CORE-15/16 and AGT-15. Real smoke: Claude called store_summary and cited the numbers.
- 2026-10-26 — AGT-08 Store memory: `store_memory` + FTS5 (migration 4), write (merges duplicates), search (relevance × recency × confidence), CRUD, outcome confidence feedback, reflection prompt + `parseLearnings`, cross-store `promotionCandidates`. Reflection runs + promotion approvals hook into the run manager (AGT-11) / approvals (AGT-10).
- 2026-10-26 — AGT-07 `assemblePrompt`: role + KPI + squad rules → playbook → platform pack → niche pack → store profile → ranked memories (token-budgeted) → date; stable layers first for prompt caching. Claude engine uses it by default.
- 2026-10-26 — AGT-04 Platform packs `packs/platform/<platform>.md` for shopify, tiktok_shop, etsy, amazon, woocommerce, walmart (how selling works, fees as ranges, listing rules, account health, ads levers, notes per role). Fee/threshold numbers are approximate — verify against current platform docs before quoting.
- 2026-10-26 — AGT-03 Playbooks for all 8 roles (`packages/agents/playbooks/<role>.md`, ~950 words each: mission, operating loop with tools, frameworks + thresholds, approval wording, red lines, what to learn), distilled from the installed ecommerce skills + expert rules of thumb.
- 2026-10-26 — AGT-06 Squads on core's `agents` table: `createSquad`/`ensureSquads`/`listAgents`/`updateAgent`, default autonomy `ask`, status derived (offline / waiting_approval + request title / idle); `GET/PATCH /api/agents` mounted in app.ts; `Autonomy`/`AgentUpdate` in shared.
- 2026-10-26 — AGT-02 Role catalog `ROLES`: per-role prompt, KPI (feeds "measured win" XP in AGT-13), tool allowlist; `SQUAD_RULES`; Claude engine enables the role's WebSearch/WebFetch. Default autonomy lands with squads (AGT-06).
- 2026-10-26 — AGT-01 `@frontline/agents`: `runAgent` + `Engine`, `fakeEngine` (scripted), `claudeEngine` (Agent SDK `query()`, partial streaming, resume, isolated settings/tools); `AgentEvent`/`StoreMemory` in shared. `FRONTLINE_AGENT_ENGINE=claude` switches engines.
