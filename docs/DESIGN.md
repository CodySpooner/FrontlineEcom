# Frontline Ecom — Design

Status: approved by the owner (Xody) on 2026-10-26 ("start building… you have full control").
Owner is a solo ecommerce/dropshipping operator running several stores, in different niches, on different platforms.

## 1. Vision

Open the app and you're in a **command center**: every store's revenue, profit, ad spend and ROAS at a glance (all
stores or any subset), a live feed of what's happening in the stores, and a **squad of AI agents per store** working
in the background — finding products, running ads, building the storefront, generating creatives with Higgsfield,
writing copy and flows, watching competitors, handling ops. Agents bring decisions to you as **requests** you approve
or deny. Every agent is an expert in its job *and* becomes an expert in its store's niche (beauty, pet, tech, …) by
learning from every run.

It should feel like a focused command center (dark grey + red, a character portrait per agent) and be as clear and
trustworthy as a SaaS dashboard: numbers are never hidden behind flair. No game mechanics: no levels, XP, ranks,
missions-as-challenges, achievements or streaks (owner, 2026-10-28).

## 2. Principles

1. **SaaS-clear.** Data surfaces (KPIs, tables, charts) are clean and exact. Personality lives in the agents' portraits
   and subtle motion, never in the way of a number.
2. **Demo first.** Seeded fake stores make every screen work with zero credentials. Real connectors replace demo data
   per store when credentials are added.
3. **Human in the loop for money and publishing.** Agents propose; the owner approves. Autopilot is opt-in per action
   type with hard caps (e.g. "pause ad sets with ROAS < 1 for 3 days, max $200/day affected").
4. **One squad per store.** Agents are role × store. Their memory and settings belong to that store.
5. **Expertise in layers.** Role playbook → platform pack → niche pack → store memory. Agents get smarter per store.
6. **Local and private.** Desktop app, local SQLite, credentials encrypted on disk. The only cloud calls are the
   platforms/ad networks/AI providers the owner connected.

## 3. Look and feel

Match `docs/reference/ui-reference.webp` (4 screens: Dashboard, AI Agents, Product Research, Creative Studio) and the
approved dashboard mockup `docs/reference/dashboard-mockup-v3.html`, except their page-header art and skyline and the
profile chip's dropdown, which the owner removed on 2026-10-28.

- Palette: near-black backgrounds (`#08080a`, panels `#131316`/`#1a1a1e`, lines `#24242a`), text `#f0f0f2`, muted
  `#8b8b94`, accent red `#ff2a3a` (deep `#c3121f`), positive green `#3ddc84`. Red glow on active/primary elements.
- Type: Chakra Petch (display, uppercase headings), Inter (body), Teko (logo). Bundled via fontsource (works offline).
- Layout: left sidebar (12 sections, active item = red pill), page header: title + subtitle on the plain dark
  background (no header image), top-right "Ask AI anything" search, notifications bell with count, profile chip.
- Logo: white italic "FRONTL1NE" where the I is a red bolt, red pulse line underneath with spaced "ECOM". Current
  `BrandLogo` is an approximation; replace with the owner's original art when it's added to `apps/web/public/brand/`.
- Agent portraits: dark armored / hooded / masked characters with glowing red eyes, one distinct look per role.
- Motion: subtle (glows, progress scans). Honors `prefers-reduced-motion`.

## 4. Screens (sidebar order)

1. **Dashboard / Command Center** — store filter (All or any subset) + range (7D/30D/90D/1Y); KPI cards with sparkline
   and delta vs previous period: Revenue, Profit (hero card), Ad Spend, ROAS, Orders (+ AOV); Revenue Overview area
   chart with hover tooltip; Live Store Activity feed; AI Agents strip (status + current task); **Agent Requests**
   board (approve/deny inline).
2. **AI Agents** — store tabs; the store's squad as cards (portrait, name, status, description,
   Configure / Chat); Deploy Agent. Agent detail: streaming chat with tool steps, run history, memory (what it has
   learned about this store), settings (enabled, autonomy, budget caps, schedule).
3. **Store Analytics** — per store: revenue/profit chart, funnel (sessions → add to cart → checkout → order), top
   products, channel split, ad campaigns table (spend, revenue, ROAS, CPA) colored by health.
4. **Product Research** — tabs Trending / High Margin / Low Competition / TikTok Viral / Shopify Winners / My Lists;
   AI Research button (runs that store's Product Hunter); product cards with image, AI Score badge, sell price vs
   compare-at, margin %, View Details; saved lists; "Add to store" → approval request.
5. **Ad Creation / Creative Studio** — tabs Generate Ads / UGC Avatars / Video to Video / Image Studio / Ad Variations /
   Ad Copy; Create Your Ad prompt + Enhance with AI + aspect ratio; **Generate with Higgsfield AI** (shows credit cost);
   integration badges (Higgsfield, Claude, Codex); preview player; Generated Ads gallery; Edit / Variations / Captions /
   Export / Save to Library.
6. **Store Builder** — Store Developer agent's workspace: pages/sections it's building, change list, previews, approve
   to publish.
7. **Orders & Fulfillment** — orders table, fulfillment status, supplier, tracking, issue queue (Operations agent).
8. **Competitor Intel** — tracked competitors per store, their ads (ad library snapshots), price changes, Market
   Analyst briefs.
9. **Automation** — rules: trigger (schedule or metric threshold) → action (agent task) → approval policy / cap; run log.
10. **Integrations** — connect platforms (Shopify, TikTok Shop, Etsy, Amazon, WooCommerce), ad networks (Meta, Google,
    TikTok), analytics (GA4), AI (Claude, Codex, Higgsfield), suppliers (CJ, DSers). Status per store.
11. **Knowledge Base** — role playbooks, platform packs, niche packs, and each store's memory; view/edit/pin/delete.
12. **Settings** — profile, stores (add: name, platform, niche, sub-niche, currency, color), budget caps, notifications,
    data folder.

Global: store switcher, Ask AI command palette (Ctrl+K) that routes questions to the selected store's Market Analyst,
notification center, first-run onboarding ("explore demo" or "add your first store → pick niche → meet your squad").

## 5. Architecture

```
apps/desktop (Electron)  ── starts ──>  apps/server (Node: Hono HTTP + WS, SQLite)
   └─ loads ─> apps/web (React)  ── /api, /api/live ──┘        │
                                                               ├─ connectors/ (Shopify, Meta, Google, TikTok, Etsy, Amazon, CJ/DSers)
                                                               ├─ demo/ (seeded generator)
                                                               └─ routes/agents.ts ──> packages/agents
                                                                                         ├─ engine (Claude Agent SDK | fake)
                                                                                         ├─ roles + playbooks + platform/niche packs
                                                                                         ├─ store memory (learn loop)
                                                                                         ├─ tools (in-process MCP over app data)
                                                                                         ├─ approvals + run manager
                                                                                         └─ outcome checks (→ store memory) + squad missions
```

- The web app talks only to the local API (`/api/*` HTTP, `/api/live` WebSocket). It also runs in a normal browser for
  development (`pnpm dev`), which is how workers verify UI.
- SQLite via `node:sqlite` (no native build). Data dir `FRONTLINE_DATA_DIR` (default `./.data`). If Electron's Node
  can't load `node:sqlite`, the core lane switches to `better-sqlite3` with prebuilds.
- Contracts (types for every API response) live in `packages/shared`.

## 6. Data model (first cut — core lane owns the schema)

- `stores` (id, name, platform, niche, niche_detail, currency, timezone, color, connected, created_at)
- `daily_metrics` (store_id, date, revenue, ad_spend, cogs, orders, sessions, add_to_carts, checkouts)
- `products` (store_id, id, title, image, price, compare_at, cost, inventory, status)
- `orders` (store_id, id, created_at, total, status, fulfillment_status, supplier, tracking)
- `events` (store_id, type, amount, at) — live feed
- `ad_accounts` (id, network, store_id) and `campaigns` (network, id, store_id, name, status, daily_budget) +
  `campaign_daily` (spend, revenue, purchases, clicks, impressions)
- `integrations` (id, kind, store_id nullable, status, encrypted_credentials)
- `agents` (id, store_id, role, enabled, autonomy, settings_json)
- `agent_runs` (id, agent_id, task, status, started_at, ended_at, tokens, cost, transcript_json)
- `approvals` (id, store_id, agent_id, run_id, title, reason, action_json, status, created_at, decided_at)
- `store_memory` (id, store_id, agent_id, kind fact|learning|preference, text, evidence, confidence, tags, created_at,
  last_used_at) + FTS5 index
- `squad_missions` (multi-agent plans over agent runs)
- `competitors`, `competitor_snapshots`, `research_products`, `product_lists`, `automation_rules`, `automation_runs`,
  `creatives`

Profit = revenue − cogs − ad spend. ROAS = revenue ÷ ad spend. AOV = revenue ÷ orders. Deltas compare the selected
range against the immediately preceding range of the same length.

## 7. Agent system

**Squads.** Creating a store creates its squad: one agent per role (8 roles in `packages/shared` `AGENT_ROLES`). Roles
can be toggled per store. Each agent has status, current task, autonomy (`suggest` → `ask` → `autopilot with cap`),
budget caps, schedule.

**Engine.** `runAgent(agent, task)` streams normalized events (`text_delta`, `tool_call`, `tool_result`,
`approval_request`, `memory_written`, `done`, `error`). Engines:
- `ClaudeEngine` — Claude Agent SDK `query()` using the owner's local Claude Code login (no API key needed), streaming
  partial messages, `resume` for chat continuity, `canUseTool` → approvals, per-run `mcpServers`.
- `FakeEngine` — deterministic scripted runs for tests and demo mode.
- (Later) Codex as an alternate engine for Store Developer code work.

**Expertise layers (prompt assembly).**
1. Role prompt + **playbook** (`packages/agents/playbooks/<role>.md`) — distilled from the installed ecommerce skills
   and proven frameworks (e.g. PPC structure, product validation criteria, CRO checklists, email flow library).
2. **Platform pack** — shopify, tiktok_shop, etsy, amazon, woocommerce: rules, fees, policies, what works.
3. **Niche pack** — beauty, pet, tech, fitness, home, fashion, kids, outdoor (+ generated packs for custom niches):
   audience, buying triggers, compliance (cosmetic claims, FDA/FTC, pet safety, electronics certs), seasonality,
   creative angles, price norms, supplier notes.
4. **Store profile + store memory** — top-K relevant memories (FTS5 relevance × recency × confidence).
5. **Live data via tools** — the agent reads the store's real numbers through tools rather than pasted context.

**Learning loop.** After each run a short reflection extracts learnings (`text`, `evidence`, `confidence`, `tags`) into
`store_memory`. Outcomes later confirm or contradict them (e.g. the ad the agent recommended hit 3.1 ROAS → confidence
up). Learnings that hold across stores of the same niche can be promoted into the niche pack (approval required), so a
new beauty store starts smarter.

**Tools.** An in-process MCP server exposes app data and actions: analytics summary/timeseries, products, orders,
campaigns, competitors, research feed, memory read/write, create approval request, create creative. Each role gets an
allowlist. External MCP servers are attached per store when connected: Shopify (official), Meta Ads (official hosted
`mcp.facebook.com/ads`), Google Ads / GA4 (official), Higgsfield (`mcp.higgsfield.ai/mcp`, OAuth, spends credits).

**Approvals.** Any side-effect action (spend, budget change, publish, store edit, generation that spends credits above a
threshold) becomes an `approval_request`: the run pauses, the request shows on the Dashboard and in notifications;
approve/deny resumes the run. Autopilot rules auto-approve within caps and log it.

**Run manager.** Queue with global concurrency (default 3) and per-store limits; cancel/resume; persisted transcripts;
token/cost and Higgsfield-credit accounting per store with daily caps.

## 8. Store health

- **Store health** = margin-based bar; status badge Winning / Steady / Bleeding (`storeHealth()` in shared).

No gamification (owner, 2026-10-28): no XP, levels, ranks, achievements, daily missions, streaks, commander level, or
XP/level-up toasts and sounds.

## 9. Integrations (verified 2026-10-26)

| Integration | How | Notes |
|---|---|---|
| Shopify | Admin GraphQL API (custom-app token first, OAuth later); official MCP for agents | primary platform |
| TikTok Shop, Etsy, Amazon SP-API, WooCommerce | REST APIs, read-only analytics first | per-platform connectors |
| Meta Ads | Marketing API insights; official hosted MCP for agents | `pipeboard-co/meta-ads-mcp` is BSL — don't bundle |
| Google Ads, GA4 | official APIs / MCPs (`googleads/google-ads-mcp`, `googleanalytics/google-analytics-mcp`) | |
| TikTok Ads | Marketing API | |
| Higgsfield | MCP `mcp.higgsfield.ai/mcp` (OAuth) | spends the owner's plan credits → approvals + caps |
| Claude | Claude Agent SDK via local Claude Code login | default engine |
| Codex | Codex CLI/SDK (later, optional engine) | not used by the build workers |
| CJ Dropshipping, DSers | their APIs / MCPs | CJ's api-mcp has no license: plug in, don't copy code |

Other useful sources: `kLOsk/adloop` (draft → preview → confirm ad flow pattern), `Shopify/Shopify-AI-Toolkit`,
`Shopify/theme-tools`, `shadcn-ui/ui` (component patterns), `pixel-agents` (agent-office UI ideas; its art has separate
terms — don't copy art).

## 10. Reuse map (MIT sources in `C:/dev/_reference`)

- **T3 Code** (`pingdotgg/t3code`): `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts` (how they drive
  `query()`, `setMcpServers`, resume, streaming), `packages/contracts/src/orchestrationV2.ts` (normalized event model incl.
  `approval_request`), `ProviderTextDeltaCoalescer.ts`, `ClaudeTurnTokenUsage.ts`, orchestrator MCP for agent→agent
  delegation (`packages/contracts/src/orchestratorMcp.ts`). Port ideas and small pieces, not Effect-TS.
- **Orca** (`stablyai/orca`): orchestration model — runs, tasks, dispatch, ask/reply, **decision gates**
  (`src/cli/specs/orchestration.ts`, `src/main/runtime/orchestration/db/`) → our approvals; agent status via hooks.
- Skip: PTY/hook plumbing, git/worktree/diff code, Effect.

## 11. Security

- Credentials encrypted at rest (Electron `safeStorage` in the desktop app; AES-GCM with a local key file in dev),
  never returned by the API, never logged, never committed.
- The API binds to localhost only.
- Spend/publish actions always go through approvals or capped autopilot; every executed action is logged.

## 12. Non-goals (for now)

Multi-user/teams, cloud sync, mobile app, building our own ad network integrations beyond read + simple actions,
selling the app (if that changes, revisit BSL/unlicensed integrations).
