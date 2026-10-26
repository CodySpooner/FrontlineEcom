# Backlog — agents lane (`packages/agents/**`, `apps/server/src/routes/agents*.ts`)

Read the `claude-api` skill before writing engine code (Agent SDK: `query()`, streaming, `resume`, `canUseTool`,
`mcpServers`). Study `C:/dev/_reference/t3code/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts` and
`packages/contracts/src/orchestrationV2.ts` for a battle-tested way to drive it (MIT — keep the notice on ported code).
Tests always use the FakeEngine; at most one short real-engine smoke run per task.

## Inbox
<!-- other lanes append requests here: - [ ] (from <lane>) <request> -->
- [ ] (from core) Approvals hook is live for AGT-10: `import { approvalsHook } from '../approvals'` in `apps/server/src/routes/agents.ts` → `approvalsHook(db)` implements `ApprovalsHook` from shared (`create(input)` stores + broadcasts; `await decision(id)` resolves on approve/deny). Live bus: `subscribe`/`publish` from `apps/server/src/live.ts` (add new `LiveMessage` types in shared, e.g. agent status/run events).
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
- [ ] AGT-04 Platform packs `packs/platform/<platform>.md`: shopify, tiktok_shop, etsy, amazon, woocommerce.
- [ ] AGT-05 Niche packs `packs/niche/<niche>.md`: beauty, pet, tech, fitness, home, fashion, kids, outdoor + template
      (audience, triggers, compliance, seasonality, creative angles, price norms, suppliers) + a Market Analyst task that
      drafts a pack for a custom niche (saving it needs approval).
- [x] AGT-06 Squads: `createSquad(store)` makes one agent per role (persisted via core's DB once CORE-01 lands; in-memory
      until then); enable/disable; level/XP/status/currentTask; API for the UI.
- [ ] AGT-07 Prompt assembly: role + playbook + platform pack + niche pack + store profile + top-K memories, token-budgeted.
      Tests assert the right layers are included per store.
- [ ] AGT-08 Store memory + learning loop: post-run reflection → `store_memory` rows (text, evidence, confidence, tags);
      FTS5 retrieval (relevance × recency × confidence); outcome feedback adjusts confidence; promote cross-store
      learnings to niche packs via approval.
- [ ] AGT-09 Tools: in-process MCP server over app data (analytics, products, orders, campaigns, competitors, research,
      memory read/write, create approval, create creative); per-role allowlists.
- [ ] AGT-10 Approvals: side-effect tools and `canUseTool` create approval requests through core's approvals hook; run
      pauses, resumes on decision; autopilot rules auto-approve within caps and log.
- [ ] AGT-11 Run manager: queue, global concurrency (default 3), per-store limits, cancel/resume, persisted transcripts,
      token/cost + Higgsfield-credit accounting with daily caps.
- [ ] AGT-12 Agent API routes (`apps/server/src/routes/agents.ts`, mounted in app.ts): squads, agent detail, start run,
      stream run events (over `/api/live` or SSE), chat (resume), cancel, memory CRUD.
- [ ] AGT-13 Gamification engine: XP events, level curve, ranks (Recruit → Operative → Specialist → Veteran → Elite →
      Legend), achievements catalog + unlock checks, daily missions per store, streaks, commander level; API.
- [ ] AGT-14 External MCP wiring per store when connected: Shopify (official), Meta Ads (`mcp.facebook.com/ads`),
      Google Ads / GA4, Higgsfield (`mcp.higgsfield.ai/mcp`, OAuth). Off in demo mode.
- [ ] AGT-15 Creative pipeline: Creative Studio + Copywriter → Higgsfield image/video/UGC with credit estimate +
      approval → saved to creatives library; ad copy variants.
- [ ] AGT-16 Product Hunter pipeline: research → score (margin, trend, competition, shipping) → shortlist → "add to
      store" approval → Store Developer drafts the product.
- [ ] AGT-17 Ad Strategist pipeline: daily campaign review → pause/scale/test recommendations as approval requests with evidence.
- [ ] AGT-18 Scheduled jobs on core's scheduler: daily briefing per store, weekly report, daily product scan.
- [ ] AGT-19 (later) Codex as an alternate engine for Store Developer code work.
- [ ] AGT-20 Evals: fixture checks that prompt assembly and FakeEngine flows produce the expected tools/approvals/memories.

## Blocked

## Done
- 2026-10-26 — AGT-03 Playbooks for all 8 roles (`packages/agents/playbooks/<role>.md`, ~950 words each: mission, operating loop with tools, frameworks + thresholds, approval wording, red lines, what to learn), distilled from the installed ecommerce skills + expert rules of thumb.
- 2026-10-26 — AGT-06 Squads on core's `agents` table: `createSquad`/`ensureSquads`/`listAgents`/`updateAgent`, default autonomy `ask`, status derived (offline / waiting_approval + request title / idle); `GET/PATCH /api/agents` mounted in app.ts; `Autonomy`/`AgentUpdate` in shared.
- 2026-10-26 — AGT-02 Role catalog `ROLES`: per-role prompt, KPI (feeds "measured win" XP in AGT-13), tool allowlist; `SQUAD_RULES`; Claude engine enables the role's WebSearch/WebFetch. Default autonomy lands with squads (AGT-06).
- 2026-10-26 — AGT-01 `@frontline/agents`: `runAgent` + `Engine`, `fakeEngine` (scripted), `claudeEngine` (Agent SDK `query()`, partial streaming, resume, isolated settings/tools); `AgentEvent`/`StoreMemory` in shared. `FRONTLINE_AGENT_ENGINE=claude` switches engines.
