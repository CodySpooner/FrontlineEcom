# Backlog: settings lane (Settings redesign)

Repo rules: `CLAUDE.md` (worker loop, hard rules). The owner's full spec, verbatim, is `docs/features/settings.md`. It
is the source of truth for *what*. This file is the *how* in this repo: the chosen design, the decisions already made,
lane ownership, the items and the completion checklist. The code survey behind the decisions is
`docs/features/settings-codemap.md`. A later verification against the code found some of its claims wrong or
incomplete, and decision 2 records what the code really does. Where the two disagree, decision 2 wins. Read all three
and open both boards before ST-01.

## What the owner asked for (2026-10-28)

The spec asked for three stages before any build: an inspection of today's configuration (Stage One, done as
`settings-codemap.md`), four design concepts on one artboard, and a stop for the owner's choice. The concepts were A
Structured Settings Workspace, B Searchable Control Center, C Scope-Aware Split View and D Guided Configuration Hub. The
owner picked A:

> lets go with design A please

The spec then says (§12): build in coherent increments, in this order: **Configuration audit → Approved interface →
Scope and persistence foundation → Functional settings sections → Integration behavior → Security and reliability →
Verification.**
- Keep a completion checklist and recoverable checkpoints (the Done, Blocked and Notes sections below).
- Make routine decisions within the approved scope yourself.
- For this unattended run: don't ask the owner and don't halt.
- Where the spec needs the owner (missing credentials, destructive actions, paid services, significant scope changes),
  write it under Blocked with exactly what the owner must do, skip that part, and take the next item (CLAUDE.md worker
  loop). Keep building the parts that don't depend on it, and never tick the blocked part.

These rules apply to every item (spec §2, §5, §8, §12). Repeat them to yourself before each one:
- **No decorative controls.** Every editable setting is in the registry (decision 5) and has a consumer that reads it.
  A test proves that the consumer's behaviour changes. A setting is not finished because its value survives a reload.
- **Scope is explicit.** Every row says whether it belongs to you, to the workspace or to one store. An inherited value
  says where it comes from.
- **Nothing reports success before the server confirms.** No "Saved" or toast appears until the write is committed.
  "Applied" appears only once the effect has happened.
- **The truth comes before polish.**
  - A connection test is a real read-only request, or the screen says "Test not available" and why.
  - A limit says what it controls and what it doesn't.
  - Anything unavailable says why, once, in plain words.
- **Secrets are write-only.** They are never returned to the browser, logged, exported, put in diagnostics or written
  to Change History.
- **Never spend money, publish, or change a live store or ad account to verify a control** (spec §11). Mocks prove code
  paths. They never prove a live connection.

## The design

The owner chose concept **A, Structured Settings Workspace**, on 2026-10-28. Concepts B, C and D are not part of the
build.

- **The boards:**
  - `docs/reference/settings-workspace.png` is board A1: Agents & Providers, with the Glow Haus store selected and 2
    unsaved changes.
  - `docs/reference/settings-integration.png` is board A2: the Shopify integration detail for Glow Haus.
  - The `.html` next to each PNG is the same board as self-contained static HTML. Open it for exact colours, type
    sizes, spacing and copy.
- **Every store name, value, status, time and count on the boards is a placeholder.** Glow Haus, "6 of 8", "Passed
  2:41 PM · 0.4 s", "4 min ago", "$8.00" and the rest never ship. Production screens show real data, or a truthful
  empty, setup or error state.
- **The board's app sidebar, title strip, "Ask AI" box, bell and profile chip are the app's own Shell and Hero.** Don't
  rebuild them from the board. The page uses `Hero` like the other pages. The "Demo data" pill is Hero's existing
  behaviour.
- **House primitives vs the board.** Where a `ui.tsx` primitive draws differently from the board, match the board
  through a new opt-in prop or variant. Never change a primitive's default look, because other pages use it.
- The boards were drawn at 1440 px wide. Where the decisions below differ from a board, follow the decisions.
- **A control is shown only once the item that makes it work has shipped** (decision 1). Until then it is absent, not
  disabled. The same goes for a sidebar section: it appears in the same commit as its content.

### Frame (both boards)

1. **App shell, unchanged:** the 216 px app sidebar and the plain title strip ("Settings", Ask AI, bell, profile chip).
2. **Settings sidebar, 248 px:**
   - Search at the top, with the "/" key hint. It ships with ST-34; before that the box is absent.
   - Four groups, each section listed once its item has shipped (the `SECTIONS` list, ST-02):
     - **Personal:** Account, Appearance, Notifications.
     - **Workspace:** General, Stores (with the store count).
     - **AI & Connections:** Agents & Providers, Integrations (with the issue count), Knowledge, Product Research,
       Automation & Approvals.
     - **Operations:** Usage & Limits, Data & Backups, Change History, Advanced.
   - A "Pinned" group sits above Personal once the owner has pinned something (ST-34).
   - The active item is drawn as on the board.
   - A badge appears only when real data backs it.
   - Below 900 px (the shell's own breakpoint, `min-[900px]` in `Shell.tsx`) the sidebar becomes a section select
     above the content. No Settings page scrolls sideways at 390 px.
3. **Main column, at most 860 px wide:**
   - The page title and a one-line description.
   - On pages with store overrides, a segmented switch on the right labelled "Editing": "Workspace defaults |
     <store> ▾". With several stores, the second segment is a store picker.
4. **Section cards:** a title, a one-line help text, then rows. Each row has a label with a help or origin line on the
   left and its control on the right. The origin lines:
   - "Using workspace default";
   - "Customized for this store · workspace default $5.00", with a **Use workspace default** action (board A1 also
     draws this as "Changed for Glow Haus · workspace uses Medium"). When the override holds the same value as the
     workspace default, it reads "Customized for this store · same as workspace default $5.00";
   - a lock with "Restricted by workspace policy · …".
5. **An "Advanced · …" expander row** at the end of a section, for the genuinely technical settings.
6. **A sticky save bar** at the bottom of the main column:
   - a dot, then "N unsaved changes · <scope> · <impact>";
   - the impact text comes from real counts (ST-10), for example "applies to new runs, 2 running runs keep their
     settings";
   - **Cancel** and a red primary **Save changes**.

### Agents & Providers (board A1)

- **Runtimes card.** One row each for Claude ("Signed in" + Check again), Codex ("Not set up" + Set up Codex) and the
  Demo engine (used while a store is on demo data). Status comes from the real checks. The board's "Example states" pill
  is board-only.
- **Defaults for new runs.** Rows for Runtime, Model ("list from your Claude login"), Effort (a segmented control with
  that model's real levels), Stop a run after, Knowledge, and If the runtime fails.
  - **Board differences:**
    - The board draws "If the runtime fails" as a select. Build it as a read-only statement, "Stop and notify me ·
      Frontline never switches provider or model on its own" (decision 9). There is only one behaviour, so a select
      would be decorative.
    - "Stop a run after" has the help text "New conversations only" (decision 9).
    - On a demo store the Runtime row is disabled with "Runs on the demo engine while <store> is on demo data"
      (decision 4).
    - The board's "Advanced · retries, runs at once, response length" becomes "Advanced · retries, runs at once".
      Response length has no option that both runtimes honour.
- **"<store> limits" card** (store scope):
  - "AI usage per day", with its origin line and Use workspace default.
  - "Spending, publishing, live-store edits", locked, with an "Approval rules" link.
  - "Per-agent budgets": "N of M <store> agents have their own daily budget · Open in AI Agents".
  - The card's help text: "Enforced before each step. An estimate from usage, not a cap set at the provider."
- **In "Workspace defaults" scope the card becomes "Workspace limits"** and edits the workspace value of
  `caps.agentCostPerDay`, with the impact "Applies to N stores that use the workspace default; M stores have their own
  value" (both counts from `store_caps`).

### Integration detail (board A2)

- **Header:**
  - a breadcrumb: Integrations › <group> › <integration · store>;
  - an initial tile, the name and a one-line description;
  - pills: status (including "Needs reconnecting" for auth errors), scope ("Store scope · <store> only" or
    "Workspace"), and "Last successful sync <ago>".
- **Connection card:**
  - Non-secret identity fields are shown read-only. **Change connection…** (ST-39) opens the connect form prefilled and
    previews the effects before saving.
  - Each secret shows as dots, with "Saved <date> · write-only, can be replaced but not viewed" and **Replace**.
  - **Test connection** says what the test reads and that it changes nothing, then shows the last result with Test
    again.
- **"What it can do"** lists each ability as read, needs your approval, or not available (including "Not available:
  the token lacks <scope>" where the test reads the token's scopes).
- **"Used by"** shows counts from live data, per category (ST-37b).
- **Disconnect** is a separate red-bordered card, with the impact sentence and **Disconnect…**.
- **Board copy that is example only:**
  - "Example state · Glow Haus runs on demo data today".
  - "Daily catalog pass 3:00 AM store time". The catalog pass runs on machine time, so show its real schedule.
  - The whole Disconnect sentence. The real sentence is built from real counts and the real behaviour (decision 11):
    disconnecting doesn't pause automations today.

### Every other section

No board exists for the other twelve sections. Build them from the same kit (frame, cards, rows, origin lines, Advanced
expander, save bar), follow the decisions, and keep each page short. Common options stay visible; technical ones go
under Advanced.

## Decisions already made (coordinator's calls; change one only with a reason written under Notes)

1. **Lane scope and layout.**
   - **Other lanes.**
     - Every lane is stopped except **`codex-hardening`** (Codex, finite; worktree
       `C:/Users/Xody2/orca/workspaces/FrontlineEcom/codex-hardening`, no `.agent/STOP`). It works
       `docs/backlog/codex-hardening.md` phase by phase, pushes to main and keeps hands off Settings files. At 5dc77297,
       Phases A and B were done, Phase C was done except CH-13 and CH-16 (under its Blocked), and Phase D had begun
       (CH-17); still to come are CH-18–20, Phase E (CH-21–23) and CH-24. Keep every tightening it made in the Phase A
       and B files. Its phase files:
       - Phase A (money path): `routes/agents-actions.ts`, `agents-outcomes.ts`, the onDecision/onApproved block of
         `routes/agents.ts`, `approvals.ts`, the budget sections of `runs.ts`, the approval and cap-counter sections of
         `tools.ts` (`create_creative`, `propose_ad_change`, `requestApproval`), `product-research/caps.ts`, `call()` in
         `connectors/cj.ts`, `requestDraftProduct` in `product-research/pipeline.ts`, `kb/autonomy.ts`;
       - Phase B: `memory.ts`, `prompt.ts`, `runs.ts` (the AGT-246 flag), the `request_approval` section of `tools.ts`,
         a test next to `claude-engine.ts`;
       - Phase C: `codex.ts`, `fake-codex.ts`, their tests and fixtures, `routes/agents-codex.test.ts`, a new
         `routes/agents-codex-surfaces.test.ts`, the `CODEX_TESTED` line of `runtime-registry.ts`;
       - Phase D: new `e2e/**`, `playwright.config.ts`, root `package.json` scripts, `pnpm-lock.yaml`, `.gitignore`. It
         adds `pnpm e2e`: a route smoke over every `nav.ts` route plus an axe baseline;
       - Phase E: `connectors/{meta,google,tiktok,common,cj}.ts`, `kb-perf.ts`, `kb/performance.ts`,
         `kb/experiments.ts`.
     - **A Store Analytics lane is being prepared** (its row is in the coordinator's CLAUDE.md; no worktree yet). Once it
       runs it owns `pages/Analytics.tsx`, `apps/web/src/analytics/**`, `apps/server/src/analytics.ts`, a new
       `apps/server/src/analytics/**`, analytics ingestion in `connectors/**` (not `cj.ts`) and the analytics read tools
       in `packages/agents`.
   - **Editing other lanes' files.**
     - This lane's CLAUDE.md row owns only settings-specific files (Lane, below). Shared files (`runs.ts`, `tools.ts`,
       `claude-engine.ts`, `codex.ts`, `prompt.ts`, `memory.ts`, `connectors/*.ts` and the rest of the Lane's touch
       points) are **touch points**: edit only the functions an item names, surgically.
     - **At the start of every item**, re-read the CLAUDE.md lanes table and check each worktree's `.agent/STOP`.
     - **Right before an edit to a running lane's file**, `git fetch origin && git rebase origin/main`. Keep every
       codex-hardening tightening (reservations, not-applied markers, refusals). A Settings change that would loosen
       one goes under Notes instead.
     - If you need a running lane's file beyond a named touch point, file it to that lane's Inbox
       (`- [ ] (from settings) …`) and stub behind a small interface.
     - This lane's Inbox accepts only Settings-scoped requests. Return anything else to the filer's backlog (an Inbox
       line there).
     - Keep each edit surgical, match the surrounding style, and cover it with a test. Never reformat or reorganise
       files you only touch.
   - **Code layout:**
     - New web code lives in `apps/web/src/settings/**`: section pages in `settings/sections/`, integration screens in
       `settings/integrations/`, hooks in `settings/api.ts`.
     - New server code lives in `apps/server/src/config/**`.
     - Shared types, `settingsUrl` and the registry go in a new `packages/shared/src/settings.ts`, re-exported from
       `index.ts`. `packages/shared` stays additive-only.
     - New shared names must not collide with existing ones (grep first): `SettingDef`, `ConfigScope`,
       `SettingOrigin`, `EffectiveConfig`, `ConfigChange`.
   - **Routes:**
     - Every new route is under `/api/config/`, except where it extends an owner's route
       (`/api/integrations/:id/test|impact|usage`, `POST /api/integrations/preview`, `/api/stores/:id/impact`,
       `/api/notifications/test`).
     - **Store rule:** store-scoped by-id routes take the store in the path or in `?store=`
       (`/api/integrations/:id/test|impact|usage`, `/api/config/changes/:id/retry` for a store row); without it they
       return 400, and for a record from another store 404. `/api/stores/:id/impact` carries it in the path. Records
       with no store (global integrations cj and higgsfield, workspace change rows) take no store. Every item that adds
       such a route follows this rule; ST-42 sweeps it.
     - Mount `/api/config` behind the KB-25 write guard (`kbGuard` in `app.ts`: 300 writes a minute, 1 MB body).
   - **Migrations:**
     - Take the next free number when you write one (56 at 5dc77297; store-analytics also appends).
     - Migrations are append-only. A migration may change only until its commit is pushed; after that it is never
       edited. Any later column or table is a new appended migration.
     - Conflicts in the `MIGRATIONS` tail are expected. Keep origin's entries first, append yours after them, and
       renumber only your own unpushed migrations (never another lane's or a pushed one): the `/* N (settings: …) */`
       comment, any `slice(0, N−1)` / `user_version` N−1 seed in your tests, and any Notes or Done text that names the
       number. Then rerun `pnpm check` before pushing. After a renumber, discard any temp data dir that ran your
       migration under the old number and start a fresh one. Never open dir (b) (decision 18) with an unpushed
       migration.
     - Each migration gets an upgrade test in the `db.test.ts` style (`user_version`, `PRAGMA foreign_key_check`).
       Upgrade tests assert `user_version` equals `MIGRATIONS.length`, never a literal.
   - **Data you may touch:** only the data dirs of decision 18. Never touch the owner's installed app data
     (`<userData>/data`) or its key (`<userData>/secret.key.enc`).
   - **Never run `pnpm desktop`, `pnpm package`, `pnpm release`, `electron` or `electron-builder`** from apps/desktop,
     with or without `FRONTLINE_DEV_URL`. A non-packaged run uses the installed app's userData (`%APPDATA%\Frontline
     Ecom`, from `productName`), so it would open and migrate the owner's real database, use the owner's key, and write the owner's
     `window.json` and `api-port`. `pnpm dev` is safe: apps/desktop has no `dev` script. Desktop changes are proven only
     by tests of electron-free modules (as `bounds.ts`, `key.ts` and `port.ts` are), `pnpm typecheck` and
     `pnpm --filter @frontline/desktop build` (esbuild only). The report lists them as "not run in Electron; the owner
     verifies them in the next installed build".
   - **A control appears only once the item that makes it work has shipped.** The same rule applies to a sidebar
     section: it appears once it has content.

2. **What the code really does** (verified at 8ff35f9d; the additions marked † rechecked at cc80fbac on 2026-10-28;
   this corrects the code map). Each item cites the parts it relies on.
   - **Guards.**
     - The localhost Host check and the Origin check apply to everything. The Origin check runs only when the header
       is present.
     - Every response carries `frame-ancestors 'none'` and `X-Frame-Options: DENY`.
     - `kbGuard` caps writes on its prefixes.
     - `/api/codex/mcp` takes a bearer token scoped to one run.
     - `wrongStore` (`routes/agents-scope.ts`) only acts when a request has `?store=`, and only on the by-id routes of
       six tables. New by-id routes must check the store themselves.
   - **Settings row.**
     - The `settings` table has no `updated_at`.
     - Besides `app`, it holds internal state: `fx`, `digest_sent`, `competitor_watch`, `shop:<id>`, `restore_closed`,
       `ad_timezones`, `catalog_pass`, Amazon and TikTok read state, `pr:cj:categories` and connector cursors.
     - Deleting an integration or a store leaves its per-id rows behind.
     - Every `getSettings` caller reads the row on each call. No server cache exists.
     - † The Profile panel (`Preferences` in `pages/Settings.tsx`) saves the name and `baseCurrency` together.
   - **Defaults and validation in `settings.ts`.**
     - The default profile is `{name: 'Cody', plan: 'Pro Plan'}`, each 1–40 characters. `plan` has no editor and is
       shown only as the Profile subtitle and on the Hero chip.
     - `baseCurrency` is only regex-checked. `XYZ` is accepted, `fxFor` then gives every store a rate of 0, and totals
       come back empty. The same happens for a real code that has no stored rate.
     - `baseCurrency` is read live by `fx.ts` (`fxFor`, `startFxLoop`), the digest and the agents' `portfolio` tool.
     - On a change, the web invalidates only summary, campaigns and top products. Product Research All-stores facts
       are not recomputed.
   - **Time.** Cron, the digest, `maxRunsPerDay` and every "today" counter use machine-local midnight: `costToday`,
     `creditsToday`, `budgetAddedToday`, `autopilotUsedToday`. Store timezone:
     - It is ignored on demo stores: `storeZone()` returns undefined when `demo=1`, and `prompt.ts`/`tools.ts`
       `today()` use the machine zone unless the store is connected.
     - It drives analytics days, metric windows, outcome-check day stamps, and price and product tests.
     - Ad and GA4 syncs use the zone each account reports (`ad_timezones`).
     - Shopify, Woo, Etsy and TikTok Shop "today", the competitor watch and the catalog pass are machine-local.
     - Only Shopify and WooCommerce set the store timezone on sync (`takeTimezone`). Zones the machine doesn't know are
       ignored.
   - **Store currency.**
     - The store's own platform overwrites the currency on every sync: Shopify, Woo, Etsy and TikTok Shop through
       `takeCurrency`, Amazon through `setStoreCurrency` (`connectors/common.ts` ~62). Once the own platform has
       synced, a second platform's mismatched currency makes that sync throw.
     - `setStoreCurrency` nulls `orders.fx_rate` and resets the cursors of meta_ads, google_ads, tiktok_ads and amazon.
     - Only on a real store does it also zero `campaigns.daily_budget` and deny pending `ads.set_budget`,
       `store.set_price` and `store.add_products` requests.
   - **Store form.**
     - Platform is editable on a connected store, with no guard in the UI or in `parseStoreInput`. A change reroutes
       approved writes (`onStore`) and changes which connector owns currency and timezone.
     - `nicheDetail` can't be cleared: the server rejects `''` and the form omits a blank.
     - Fees are read at query time, so a change rewrites all past profit, ROAS break-evens, price floors, outcome
       scoring and Product Research economics.
     - Store fields are snapshotted per run.
     - Creating a store seeds demo history, a squad and default jobs, and makes no `store_caps` row. Its id is a slug
       and is never reused.
   - **Store delete.** Most store tables cascade. These survive: `action_log` (no FK), `niche_learnings` (SET NULL),
     `done_once` refs, per-integration settings rows, and the Codex work folder (`FRONTLINE_CODEX_WORK`, default
     `%LOCALAPPDATA%/FrontlineEcom/codex-work/<storeId>`).
   - **Caps.**
     - `updateCaps` merges into defaults and writes all three numbers. `CapsForm`/`useSaveCaps` always PUT the full
       draft. After a store's first save, changing `DEFAULT_CAPS` no longer reaches that store, and no route deletes a
       `store_caps` row. A stored value equal to the default can't be told apart from one the owner chose.
     - The server accepts any autopilot kind matching `[a-z0-9_.]`, so stale kinds persist. The UI shows an untouched
       kind as `{enabled:false, maxUsdPerDay:50}`.
     - **AI cap.**
       - `spend()` re-reads it mid-run and aborts.
       - A Claude run's SDK `maxBudgetUsd` is fixed at start, at `min(cap/perStore, cap − today − held, seat, team,
         config)`. So one run gets at most half the cap, and raising the cap mid-run doesn't lift a running run's
         stop.
       - † `start()` (`runs.ts` ~108) refuses **any** run, whatever its runtime, when `min(cap/perStore, cap − today)
         < $0.01`. `pump` and `budgetFor` seat store shares for all runtimes.
     - **Credits cap.**
       - The tool is `create_creative` (kind `creative.generate`). Its check is today + pending + new > cap.
       - After the approval wait, the check reuses the cap it read before the wait, so a lowered cap is ignored.
         († codex-hardening CH-05 added a recheck before the charge: confirm in ST-24a whether it re-reads the cap.)
       - Costs per kind are hardcoded (image 2, video 20, ugc 40) and charged at approval.
     - **Ad cap.**
       - It is checked only in `propose_ad_change`, in USD through `inUsd`. With no FX rate the check is skipped.
       - It is never checked at approval or apply, and only raises count.
       - The day's total = every pending `ads.set_budget` request of any age, plus approvals since local midnight.
       - The UI wrongly says "add or move".
   - **Usage.**
     - `costToday` counts runs by `coalesce(ended_at, running, created_at)` ≥ local midnight.
     - Claude cost = max(SDK total, list-price estimate). It is an API-equivalent figure, notional on a subscription
       login.
     - † Codex and demo runs add $0 to it, but once Claude spending has used up the cap, `start()` refuses them too. A
       cap of $0 refuses every run, demo included. (The ai-agents Inbox line CH-05/Q1 about runtime-aware admission
       belongs to ai-agents; this lane doesn't change the admission rule.)
     - The credits meter excludes pending renders, which the cap counts.
     - No per-day history endpoint exists. All-time cost and tokens are in `GET /api/ecosystem/stats`.
   - **Agent runtime.**
     - `seatDefault`'s model is the Claude login's discovered default (fallback `agentModel()`), and its effort is that
       model's default. † On a demo store `seatDefault` gives runtime `demo` (`configs.ts`:
       `onClaude = engineInfo(store.connected)`). `validateConfig` still accepts claude or codex on a demo store.
     - Runs without a config (automations, mission steps, KB promotion, KB research stages and ask, niche drafts) run
       on `input.config?.model ?? agentModel()`. That is `FRONTLINE_AGENT_MODEL` or claude-opus-5-5, at the registry
       default effort.
     - † `defaultEngine` (`engine.ts`): a run on a `codex` config runs on Codex; otherwise it runs on Claude when the
       store is connected, the mode is `research` (KB research stages) or the config runtime is `claude`, and on the
       demo engine in every other case. So a config-less run on a demo store runs on the demo engine, except KB
       research stages.
     - `FRONTLINE_AGENT_ENGINE` forces one engine everywhere, marks both runtimes unavailable and makes Codex setup
       return 409.
     - The conversation config route takes only `{runtime, model?, effort?, stopAfterMin?}`. It returns 409 while
       running, queued, awaiting approval or waiting for input.
     - `agent_runs` has `model`, `effort`, `actual_model` and `effort_applied` columns.
     - Runs retry by themselves:
       - transient errors twice, at 5 s and 20 s, unless a changing tool already ran;
       - an interrupted run under 6 h old with no conversation or team, once at startup;
       - mission steps that were turned down.
     - Concurrency is 3 in total and 2 per store (`runs.ts`). Teams have their own `STORE_LIMIT = 2`. † Teams persist
       `max_concurrent`, clamped once in `validateTeam`. "2 per store" is hardcoded in `product-research/tasks.ts`
       ~181, `ResearchDialog.tsx` ~320 and `packages/agents/README.md`.
     - † Run start call sites besides owner conversations: delegation from a running run (`tools.ts` ~972
       `ctx.startRun`), developer runs after an approval (`agents-actions.ts` `startRun`, `routes/agents.ts`
       `addProducts`), go-live drafting (`routes/agents.ts` ~533), PR tasks, missions, teams.
     - Presets have no edit or delete route.
     - `PATCH /api/agents/:id` with `enabled=false` cancels that agent's queued and running runs.
     - Owner-edited playbooks and packs are files in `<dataDir>/knowledge/` and `<dataDir>/packs/niche/`.
     - † `lib/usage.ts` maps a refusal to a link by matching runs.ts's text "Raise it in Settings."
   - **Automation.**
     - Defaults: approval ask, 3 runs a day (1–100), cooldown 24 h (0–720).
     - Cooldown applies to metric rules only.
     - `approval` applies to `agent_task` rules only. `kb_research` rules go through KB controls (`scheduledResearch` →
       `begin`), which need KB autonomous on, the role ticked and budget room.
     - `nextRunAt` looks only 8 days ahead.
     - Deleting a rule leaves its pending approval open, and approving it then does nothing.
     - `createDefaultJobs` adds 8 jobs per store and rewrites unedited task text. `enableDefaultJobs` turns them on at
       go-live. Other in-process writers of rule fields: the job-gates pass (`routes/agents.ts` ~545,
       `UPDATE automation_rules SET enabled = 0`) and the task rewrite in `jobs.ts` ~121.
     - Any PATCH sets `rule-edited:<id>`, and after that the system never toggles that rule again.
   - **Knowledge capture** (†).
     - `captureFinding` (`kb-links.ts`) has three callers: the agent's `save_finding` tool (`tools.ts` ~1345; its
       Automatically mode passes `unreviewed`, so the card is `proposed`), the owner's own save from a conversation
       (`routes/agents-conversations.ts` ~219), and PR model reports (`product-research/reports.ts` `captureFindings`,
       every non-demo report, unreviewed).
     - Other `createCard` callers file cards on their own: `kb-perf.ts` learnings, PR `outcomes.ts` and `pipeline.ts`
       measured results, `kb-research.ts` results, `kb-promote.ts`, the research stage in `tools.ts` ~1490, and
       `kb/routes.ts` (the owner).
   - **Notifications.**
     - `errors` also hides backup failures, "X stopped syncing" and failed approved live writes.
     - `agentDone` also covers KB research done, mission done and team ready.
     - `approvalsHook.create` calls `notify(kind 'approval', link '/')` for every approval request. Turning approvals
       off drops those bell rows and their Windows toasts, which are the only OS-level signal.
     - A notification dropped by `notify()` is never stored.
     - Recovery messages are `info` and always show.
     - The only dedupe is the per-day account-error `once()`.
     - The bell shows 40 rows. `GET /api/notifications` defaults to 50 (max 200).
     - † Server links: backups (`backups.ts` ~72, ~77) link to `/settings`, sync notices (`sync.ts` ~26) to
       `/integrations`, approvals and the digest to `/`.
     - **Digest:** a 10-minute check sends it at the first tick at or after 8:00 machine time and catches up the same
       day. `digest_sent` is written before sending.
     - **Toasts:**
       - They fire when the window is not both visible and focused, and only for `type:'notification'` messages.
       - A click opens `n.link`.
       - The Windows app id is set only in the installed app, so a non-packaged desktop run shows no toast, and the
         browser dev app has no toast listener.
   - **Integrations.**
     - No test-connection route exists.
     - Higgsfield has no syncer, so it shows "Connected" forever.
     - OAuth kinds (google_ads, etsy, tiktok_shop) do a real token exchange at Connect. Pending sign-ins live in memory
       for 15 minutes. Etsy and TikTok Shop use the paste redirect `https://localhost/frontline-oauth`. † `finishOAuth`
       saves through `saveIntegration` directly (`oauth.ts` ~134), so no PUT carries a confirm flag.
     - † Token refresh rotates stored secrets through `updateSecrets` (`etsy.ts` ~57, `tiktok.ts` ~233, `cj.ts` ~118,
       `shopify.ts` ~191). Etsy and TikTok refresh tokens are single-use, so a client that drops a new token breaks the
       integration.
     - † Some real read-only calls are POSTs: Google Ads `googleAds:search` and GA4 `runReport` (`google.ts`), and
       every token endpoint (Amazon LWA, Google, Etsy, TikTok Shop, CJ, the Shopify grant).
     - **Re-saving an integration has side effects:**
       - any change to a non-secret field resets the cursor, and the next sync re-backfills up to 2 years;
       - a shop-key change runs `forgetPlatform`, which deletes that platform's orders, products and refunds;
       - an ad account that another store already uses is refused;
       - every save resets the status to connected.
     - A single saved secret can't be cleared, and values are capped at 8192 characters.
     - **The first successful sync of any connector takes a demo store live, irreversibly.** `switchToReal` wipes the
       demo rows. Then `startFresh` purges demo-derived memory, KB cards, learnings, flows, creatives and missions,
       denies pending approvals, enables the default jobs on Claude, and may start niche-pack drafting. The sync paths
       also call `takeCurrency` and `takeTimezone`.
     - **Disconnect:**
       - it deletes the row and keeps a `shop:<id>` row for reconnect detection;
       - the store stays live and its jobs stay on;
       - nothing is revoked at the provider;
       - a running run keeps the Meta Ads MCP token it started with.
     - CJ calls go through the Product Research caps.
   - **Secrets and key.**
     - Desktop: the key is `<userData>/secret.key.enc`, outside the data dir (`<userData>/data`), and is passed to the
       API as `FRONTLINE_SECRET_KEY`. Dev: `<dataDir>/secret.key`. † The server can't tell desktop safe storage from a
       hand-set environment variable.
     - The "Your Data" copy and the `Settings.dataDir` doc comment are wrong on desktop.
     - If the key can't decrypt, every integration shows LOCKED, but only after a sync calls `getCredentials`.
     - A restore on another machine leaves every credential locked.
   - **Backups.**
     - A check runs at start and then hourly; it backs up when the newest snapshot of any kind is ≥24 h old. Manual,
       undo and before-update copies count toward `KEEP=7`.
     - † `backupNow` (`backups.ts` ~39) names daily, manual ("Back up now") and undo-before-restore snapshots all
       `frontline-<ISO>.db`. Only `openDb`'s pre-migration copy has the `-before-update` suffix. A backup's kind can't
       be read from its name today.
     - Backups copy the DB only. Not included: the key, `knowledge/`, `packs/niche/`, `creatives/`, `pr-images/`,
       `codex-home/`, `agent-sessions/` and the Codex work dirs.
     - A restore rolls back every DB-stored setting, including integration rows whose tokens may have rotated since.
       It closes the pending approvals of real stores and restarts by exiting with code 75. The desktop app respawns
       the API; under `pnpm dev` it stays down.
   - **Retention.**
     - KB retention also empties KB research run transcripts.
     - `trimOldTranscripts` cuts the tool outputs of runs older than 90 days to 200 characters.
     - Logs are `api.log` + `api.log.1`. Events are kept 7 days.
     - `pr-images` is capped at 500 MB.
     - Never pruned: `pr_calls`, `automation_runs`, `kb_retrievals`, notifications, `agent-sessions/`, `codex-home/`.
   - **KB controls.**
     - Only `blockedDomains` is enforced at fetch time, in every agent WebFetch for that store. `trustedDomains` is
       only a hint in the prompt.
     - General accepts only review, trusted and blocked domains, freshDays and retentionDays.
     - A store doesn't inherit General's lists.
     - The KB "per day" budget is a rolling 24 h that includes pending approvals.
     - Self-directed research needs the Claude engine.
     - The background passes run hourly, with no pass at startup.
     - **Bug:** a deleted or moved top-level category stays in `freshDays`/`roles`, and every later
       `PUT /api/kb/controls` returns 400.
   - **Product Research.**
     - `priceMin` is stored but `fitFor` reads only `priceMax`.
     - Profile categories and keywords reach CJ only at the daily UTC plan or Sync now.
     - A store currency change silently reinterprets minor-unit price bands and economics overrides, and may flip the
       default ship-to. † `pr_store_profiles.price_currency` is stored on save, but `profile.ts` ~80 reads
       `store.currency`: an existing bug.
     - All-stores ship-to is per device (`fe.research.shipTo`).
     - `taskMessage` (`product-research/tasks.ts`) doesn't include the research profile (checked at 3a10b8bd).
   - **Per device.**
     - `<userData>/window.json`.
     - `<userData>/api-port`: a stable port keeps a stable origin. A new port loses all localStorage.
     - Start with Windows: the installed app only, `--hidden`.
     - Close-to-tray is hardcoded: closing the window hides it and never unloads the page.
     - The desktop "Open folder" uses IPC `data:open` (`<userData>/data`); the browser uses
       `POST /api/settings/open-data-folder`.
     - Appearance follows the OS: `color-scheme: dark` is forced, and `prefers-reduced-motion` and `forced-colors` are
       honoured.
     - The Ecosystem keeps its own per-device theme and low-power display options.
   - **Web and desktop shell** (†).
     - `main.tsx` uses `<BrowserRouter>`. Every web test renders through `renderApp` (`test-utils.tsx`), which wraps a
       `<MemoryRouter>`. `useBlocker` needs a data router.
     - In Electron, a `beforeunload` handler that sets `returnValue` cancels the unload silently, with no dialog,
       unless main handles `will-prevent-unload`. `main.ts` doesn't. With such a handler, tray Quit, the updater's
       quit-and-install and Ctrl+R would do nothing.
   - **Environment:**
     - `FRONTLINE_DATA_DIR` (default `./.data`), `API_PORT` (8787), `WEB_PORT`;
     - `FRONTLINE_WEB_DIR`, which also flags the installed app;
     - `FRONTLINE_VERSION`, `FRONTLINE_SECRET_KEY`, `FRONTLINE_DEV_URL`, `PR_INGEST`, `FRONTLINE_CODEX_WORK`;
     - `FRONTLINE_AGENT_ENGINE`, `FRONTLINE_AGENT_MODEL`, `VITEST`.

3. **Scopes and where each setting lives.** The scopes are Personal (the owner's preferences), Workspace (shared
   defaults, connections and policies) and Store (overrides on one store). Agent and task configuration stays owned by
   AI Agents; Settings links to it. The table lists every setting this build exposes. The registry (decision 5) holds
   one entry per row or field, except integration fields and secrets.

   | Setting | Scopes | Stored in | Default | Read by |
   |---|---|---|---|---|
   | `profile.name` | personal | `settings` row `app` (existing) | existing | Hero profile chip, Account |
   | `appearance.motion` (`system` \| `reduce`) | personal | `settings` row `personal` (new) | `system` | `<html data-motion>` → `index.css`, `ecosystem/renderer.ts` |
   | `pinned` (≤6 ids) | personal | `personal` | none | settings sidebar |
   | `notifications.{approvals, agentDone, errors, digest, researchAlerts}` | personal | `app` (existing) | existing | `notify()`, `digest.ts` |
   | `notifications.toasts.<category>`, `.quietHours`, `.stores` | personal | `app` | on, none, all | `notify()` → `toast` flag → desktop `toastNotifications` |
   | `notifications.digestHour` (0–23) | personal | `app` | 8 | `digest.ts` |
   | `notifications.usageAlerts`, `.usageAlertPct` (50–100) | personal | `app` | on, 80 | the usage-alert check (ST-15) |
   | `baseCurrency` | workspace | `app` (existing) | `USD` | `fx.ts`, `digest.ts`, PR `discovery.ts`/`facts.ts`, `portfolio` tool |
   | `timezone` | workspace | `settings` row `workspace` (new) | the machine's zone, filled once | decision 8 |
   | `agentDefaults.{runtime, model, effort, stopAfterMin, knowledge}` | workspace, store | `workspace` / `store_caps` | unset = runtime default | `seatDefault`, runs without a config, `runs.ts` retrieval; a demo store always resolves runtime to demo |
   | `runs.{retries, concurrency, perStore}` | workspace | `workspace` | 2, 3, 2 | `runs.ts`, `teams.ts`, PR `tasks.ts` copy |
   | `caps.{agentCostPerDay, adSpendChangePerDay, higgsfieldCreditsPerDay}` | workspace, store | `workspace` / `store_caps` | 5, 100, 200 | `getCaps` → `toolEnv.caps`, `runs.ts`, PR `seatProblem`, web readers |
   | `autopilot.<kind>` (eligible kinds only) | store | `store_caps` (existing) | off | `tools.ts` `requestApproval` |
   | `knowledge.autoSave` | workspace, store | `workspace` / `store_caps` | on | `tools.ts` `save_finding` (Automatically mode), PR `reports.ts` `captureFindings`; never the owner's own saves |
   | `automation.paused` | workspace | `workspace` | off | decision 14 |
   | Store fields: name, color, niche, nicheDetail, platform, currency, timezone, fees | store | `stores` (existing) | none | existing consumers |
   | KB research controls | General or one store, kept separate | `kb_controls` (existing) | existing | existing consumers |
   | Research profile + default assumptions | store | `pr_store_profiles` (existing + ST-28) | existing / not set | `evaluate.ts`, discovery, `tasks.ts`, `economics.ts` |
   | Start with Windows | this device | Electron login item | off | `apps/desktop/src/main.ts` |
   | Locked policies | workspace, locked | the registry only | none | `requestApproval`, store scoping |

   - **Integration fields and secrets are not registry entries.** The `INTEGRATION_KINDS` field definitions own them,
     and `saveIntegration` validates them. They are left out of export, search and the registry coverage tests.
   - **Inheritance per entry** (decision 5 `inherits`): entries scoped workspace + store inherit the workspace value
     (`inherits: 'workspace'`). KB control entries have scopes workspace (shown as General) and store with
     `inherits: 'none'`. Single-scope entries need no field.
   - `store_caps` becomes the store's **override document**: caps, autopilot rules, agent-default overrides and the
     autoSave override. Keep the table name; it already cascades on store delete.
   - The `app` row keeps its existing keys, so every current reader keeps working.

4. **Inheritance and policies.**
   - **Resolution order.** For entries with `inherits: 'workspace'`, the effective value is the store override, else the
     workspace value, else the registry default. Entries with `inherits: 'none'` never fall back to the workspace value.
     Agent settings (enabled, autonomy, the seat's daily budget) and run settings (conversation config) stay with AI
     Agents and sit on top. An explicit run config wins over defaults. Caps are limits: the store cap is the outer
     bound, and agent, team and run budgets only narrow inside it.
   - **Store rows hold only overrides.** "Use workspace default" deletes the override key (`unset`) and never copies a
     value. A test proves that after an unset, changing the workspace default changes the store's effective value.
   - **Locked policies** are registry entries with `locked: true`, rendered with a lock as "Restricted by workspace
     policy":
     - spending money, publishing, and live-store or ad-account edits always go through an approval;
     - the only exception is CLAUDE.md's: autopilot for `ads.set_budget` and `ads.pause_campaign` within a store's
       daily cap, which the owner sets per store;
     - store isolation;
     - secrets are write-only.

     No scope, import or API call can change a locked policy. The server refuses with 400 and names the policy.
   - **KB General and store controls are two separate documents, not inheritance.** Lists are never merged. The
     Knowledge page's switch reads "General knowledge | <store>", never "Workspace defaults". Automatic saving
     (`knowledge.autoSave`) is not a KB control: it inherits, see ST-26.
   - **How each scope shows:**
     - Workspace-only cards ignore the switch and say "Applies to all stores".
     - Store-only cards, in workspace scope, say "Pick a store to edit its <thing>".
     - Cards with workspace defaults and store overrides edit the workspace value in workspace scope (for example
       "Workspace limits", decision 10).
     - Personal pages have no switch.
   - **Demo stores:** the runtime override is disabled with "Runs on the demo engine while <store> is on demo data", and
     the workspace runtime default never applies to a demo store: its runtime resolves to demo, with the origin "Demo
     store · runs on the demo engine" (decision 9).
   - **Changing the selected store never carries a draft along.** Drafts are keyed by section and scope, and switching
     with a dirty draft asks Save / Discard / Stay.

5. **The registry.**
   - **Where it lives:** `SETTINGS` in `packages/shared/src/settings.ts`.
   - **Fields of each entry:**
     - `id`, `section`, `label`, `help`, `synonyms`, `scopes`;
     - `inherits` (`'workspace'` \| `'none'`), required on every entry with more than one scope;
     - `type`, with `default`, or `fill` for a boot-filled default;
     - validation (`min`/`max`/`enum`/`pattern`/`maxLength`);
     - `owner` (where the value is stored, or the owner route that validates it);
     - `applies` (`now` \| `new runs` \| `next tick` \| `next hourly pass` \| `next sync` \| `next daily plan` \|
       `job`), which drives the copy; `job` means the Saved → Applying → Applied path of ST-09;
     - flags: `locked`, `export`, `device`, `safeguard` (decision 15);
     - `consumers`, as a list of `path#symbol`;
     - `proof`, on every editable entry: `'path#test name'`, the test that shows the consumer's behaviour changing.
   - **Permissions in a single-owner app.** There are no users or roles (decision 17). Here "permissions" means three
     things: which scopes may write an entry, the locked policies, and the localhost guard. The backend enforces all
     three; hiding something in the UI is never the only check.
   - **Who validates.** The registry drives validation for the documents `/api/config` writes. Owners that already
     validate keep their checks, and the registry points at them: `parseStoreInput`, `parseControls`, the PR profile
     parser, `saveIntegration`, `parseRule`.
   - **Tests that guard "no decorative switches"** (all created in ST-06):
     1. Every entry's `consumers` exist (the file is present and the symbol appears in it), and every `proof` test
        exists (the file is present and contains that test name).
     2. A jsdom walk over all sections: every control on a settings page carries `data-setting="<registry id>"`, and
        every editable entry that has UI renders somewhere. Secret inputs carry `data-secret="<kind>.<field>"`, checked
        against the connector's field list. Action buttons (Test, Replace, Disconnect, Back up now…) carry
        `data-action="<name>"`, each with a named test. The walk ignores controls inside a `data-legacy` element
        (ST-02). The item that replaces a panel deletes its wrapper: ST-12 account, ST-14b notifications, ST-16 the
        currency field, ST-18 stores, ST-24b the cap rows of CapsForm, ST-30 the rest of CapsForm, ST-31 data, ST-37a
        the integrations page. The allowlist holds ids of editable entries that have no row outside `data-legacy` yet.
        ST-06 seeds it with the entries it registers. An item that adds an entry before its row exists adds the id
        (ST-11 timezone; ST-14a `notifications.toasts.*`, `.quietHours`, `.stores`; ST-20 `agentDefaults.*`), and the
        item that renders the row removes it (ST-16, ST-14b, ST-21). ST-48 requires an empty allowlist and no
        `data-legacy` left in `apps/web/src` (a file test).

6. **Saving, versions and conflicts.**
   - **Versions.**
     - `version INTEGER NOT NULL DEFAULT 1` is added to `settings`, `store_caps`, `stores`, `kb_controls`,
       `pr_store_profiles`, `automation_rules` and `integrations`.
     - It moves only when a field the owner can edit changes, in the same statement (`… WHERE version = ?`). Status,
       error, cursors, `synced_at`, last-fired, test results, token rotation through `updateSecrets` and similar
       bookkeeping never move it, so a background sync never makes the owner's open form stale. Token rotation also
       writes no owner change row.
   - **The write protocol.**
     - Every config write sends the version it read (`version` in the JSON body).
     - A save that touches two documents sends both and runs in one transaction.
     - A stale version returns 409 `{error, code: 'stale', current}` and nothing is written.
     - The version is enforced at the HTTP write routes only: a body without `version` returns 428.
       `POST /api/stores` and `POST /api/automations` (server-made ids) are exempt.
     - **A document with no row reads as version 0.** Every GET, and the versions from `effective()`, report 0 for an
       absent document: a store with no `store_caps` row, the `app` row on a fresh database, an unsaved KB controls
       scope or PR profile, an unconnected integration kind. Web callers send that 0. A write with version 0 creates
       the row, or returns 409 `{code: 'exists', current}` if it exists. A version above 0 for a row that doesn't exist
       returns 409 `{code: 'stale', current: null}`: a row deleted elsewhere (an integration disconnected while
       ConnectForm was open) is never silently recreated.
     - In-process helpers (`updateCaps`, `updateSettings`, `saveIntegration`, …) take an
       optional version, so their direct callers (about 25 test files, `oauth.ts`) keep working.
     - The old write routes (`PATCH /api/settings`, `PUT /api/caps/:storeId`) keep answering under the same rule.
     - Every web caller sends the version (ST-07, ST-08a–c).
     - **Field-level errors:** a 400 body is `{error, field}`, where `field` is the registry id (or the owner parser's
       field name where no registry entry exists, such as an integration field).
   - **The page.**
     - Explicit-save sections hold a draft with **Save changes** / **Cancel** and never autosave.
     - Immediate preferences (motion, pins) apply on change, are marked "Applies right away" and show their own inline
       state.
     - After a failed save, the draft stays and the server's error is shown under the row its `field` names.
   - **Saved vs Applied.**
     - Change rows (decision 15) carry `saved | applying | applied | failed`.
     - A setting whose effect is a background job shows "Saved · applying…", then "Applied" or "Couldn't apply:
       <reason> · Retry". These are the base currency re-rank (ST-16) and the store currency or niche re-evaluation
       (ST-28).
     - Every other setting applies when it is committed, and its copy says when that takes effect: new runs, the next
       scheduler tick or the next hourly pass.
   - **Caches.** The server has none to invalidate: settings, caps and KB controls are read per call. The web
     invalidates every query a setting feeds. Runs snapshot their config at start, and the copy says so ("Runs already
     going keep the settings they started with").

7. **Migrations and compatibility.**
   - **The ST-05 migration (next free number, n) is DDL only:** ADD COLUMN, CREATE TABLE, CREATE INDEX.
   - **Value fills run in boot code** (`config/boot.ts`, called from `index.ts`). Each is idempotent, fill-if-absent,
     and guarded by `once()`:
     - the `workspace` row gets `timezone` = the machine's zone at that first boot and the cap defaults = today's
       `DEFAULT_CAPS`;
     - the `personal` row starts empty.
   - **`store_caps` keeps every existing value as an override.** Nothing is removed: a stored value equal to the
     default may be one the owner chose, and the migration can't tell. Stores with no row inherit. A store whose
     override equals the workspace default shows "Customized for this store · same as workspace default $5.00" with
     **Use workspace default**, so the owner unpins each one. Unknown autopilot kinds stay in the row, ignored and not
     shown.
   - **Never** overwrite a value the owner set, rewrite on page load, or reset on a schema change.
   - **Upgrade test:** seed `MIGRATIONS.slice(0, n−1)` at `user_version` n−1 with a saved `app` row, one full and one
     partial `store_caps` row, a store and a rule. After upgrade and boot:
     - every `store_caps` row is unchanged (every key present before is still present, with its value);
     - every effective value is identical;
     - `user_version` equals `MIGRATIONS.length` and `PRAGMA foreign_key_check` is clean;
     - a second boot changes nothing.
   - **Recovery:** `openDb` already writes a before-update copy (`VACUUM INTO`). The final report documents restoring
     it, and every migration's behaviour.

8. **Time.**
   - **The workspace timezone** (General) drives:
     - cron schedules;
     - the digest hour and quiet hours;
     - automation `maxRunsPerDay`;
     - every "today" counter: `costToday`, `creditsToday`, `budgetAddedToday`, `autopilotUsedToday`, and the start
       refusal.

     It is filled once with the machine's zone, so nothing moves at upgrade. After that, changing the machine's zone
     (travel) no longer shifts schedules. When the `workspace` row or its timezone is absent (a fresh DB, a test, an
     older backup restored before boot), the code reads the machine zone, never UTC.
   - **Store-specific daily caps reset at workspace-zone midnight too.** This answers codex-hardening's CH-05 filing in
     `docs/backlog/core.md` (which proposed each store's zone). Reasons: one clock for every cap, no shift at upgrade,
     and demo stores ignore their store zone anyway. ST-11 ticks that line.
   - **One implementation.**
     - Move `localDate`, `midnight` and `utcOffset` from `apps/server/src/dates.ts` into `packages/shared`.
       `dates.ts` re-exports them, so its callers don't change.
     - Add `startOfDay(zone, now)` and zone-aware cron matching.
   - **The other clocks keep their roles:**
     - the store timezone: store reporting days, metric windows, outcome checks; on a demo store it applies once the
       store goes live, and the copy says so;
     - ad and GA4 days: each account's own zone;
     - CJ caps and the PR daily plan: UTC;
     - the KB daily budget: a rolling 24 h.

     Connectors' "today", the competitor watch and the catalog pass stay machine-local (Notes).
   - **Display.** Times on screen use this computer's clock. Schedule rows name their zone ("8:00
     America/New_York").

9. **Agent defaults and run limits.**
   - **The defaults.** Workspace defaults, with store overrides: runtime (`claude` \| `codex`), model, effort, stop a run
     after (minutes) and knowledge (store + General \| store only). Unset means "Runtime default", which is exactly
     today's behaviour, so nothing changes until the owner sets one.
   - **What the defaults apply to:**
     - (a) `seatDefault`: the Deploy prefill, and any conversation created without an explicit config (server side
       too). **On a demo store `seatDefault` keeps runtime `demo` whatever the defaults are**; the model and effort
       defaults apply only when the owner picks the default runtime in Deploy, otherwise that runtime's own defaults;
     - (b) runs without a config: automations, mission steps, KB stages and ask, niche drafts. They take the model and
       effort defaults only when the default runtime is Claude, and the run records the effective model and effort in
       `agent_runs.model` and `agent_runs.effort`. The page says: "Scheduled and background work runs on Claude on live
       stores and on the demo engine on demo stores (Knowledge research always runs on Claude); never on Codex. It takes
       the default model and effort when the default runtime is Claude";
     - (c) retrieval scope: `inScope(config?.knowledge ?? defaults.knowledge)` in `runs.ts`.

     "Stop a run after" applies to new conversations only (its help text says so). Existing conversations keep their
     config rows (immutable), and running runs keep theirs.
   - **Options come from `GET /api/runtimes`** (live discovery, with the registry as fallback), never from a hardcoded
     list. Changing the runtime resets model and effort to that runtime's defaults and re-validates through the same
     rules as `validateConfig`. Codex requires stop-after. Effort shows the chosen model's levels.
   - **If a default model disappears from the login**, new runs that rely on it fail with "<model> isn't available on
     your Claude login. Change the default in Settings → Agents & Providers", and an error notification goes out,
     linking to `settingsUrl('agents', {setting: 'agentDefaults.model'})`. Deploy shows the same error on its model
     field. Nothing switches model or provider silently.
   - **Environment overrides win** and show as locked rows: `FRONTLINE_AGENT_ENGINE` ("Set by the environment") and
     `FRONTLINE_AGENT_MODEL` (runs without a config).
   - **Run limits** (the Advanced row, workspace scope only):
     - Retries for transient errors: 0–2, default 2, read when a failure happens.
     - Runs at once: 1–5, default 3. Per store: 1–3, never above the total, default 2. Both are read at each pump.
       `teams.ts`'s `STORE_LIMIT` and `budgetFor`'s per-store share read the same per-store value, and the team
       scheduler clamps a team's `max_concurrent` to it at each step pump.
     - Lowering a limit never stops a running run.

10. **Caps, usage and cost honesty.**
    - **Inheritance.** The three caps get workspace defaults with store overrides. `getCaps` returns the effective
      value, so every reader follows: `toolEnv.caps`, `runs.ts`, PR `seatProblem`, the web. `GET /api/caps` adds the
      origins.
    - **Where the workspace defaults are edited:** AI usage per day on Agents & Providers ("Workspace limits" in
      workspace scope, ST-23); ad budget changes and credits per day on Usage & Limits (ST-24b). Each impact reads
      "Applies to N stores that use the workspace default; M stores have their own value", counted from `store_caps`.
    - **The copy says exactly what each cap controls:**
      - **AI usage per day** is a local estimate at list prices. It is enforced before each step and per run (one run
        gets at most cap ÷ runs per store). It is not your Claude bill and not a cap at the provider. "Codex and demo
        runs add nothing to it, but once it's used up no new run starts on this store, Codex and demo included."
      - **Ad budget changes per day** is checked when an agent proposes a raise, converted to USD. With no exchange
        rate the check is skipped and you decide. Your own approvals aren't limited. Cuts and pauses don't count.
      - **Credits per day** are charged when you approve, and pending renders count.
    - **Fixes, with tests:**
      - re-read the credits cap after the approval wait;
      - the meter includes pending renders, labelled as such;
      - the ad-cap help says "raise".
    - **Limits Frontline sets** are shown read-only, with each value imported from its constant (export it if needed,
      never retype it):
      - ad raises: ≤30% per step, a 3-day settle, the TikTok floor;
      - price changes: ±30%;
      - Claude: 40 steps per run (30 in research), and tool-approval input of at most 2,000 characters;
      - credits per kind;
      - the guard's limits: 300 writes and 10 run starts per minute;
      - the CJ call caps.
    - **No billing page.** Provider-reported charges show as "Not available: Frontline can't read your Claude or Codex
      bill."

11. **Integrations and credentials.**
    - **Where they live.**
      - Integrations live at `/settings/integrations`, with detail at `/settings/integrations/:id`. `/integrations`
        redirects there and keeps its query, so links stored in old notifications keep working.
      - The app-nav "Integrations" item stays and points there. It is the active item on those routes, and "Settings"
        is active on every other `/settings/*` route.
      - The connect flows (ConnectForm, OAuth start and finish, the paste redirect) are moved, not rewritten.
    - **The directory** is grouped by purpose: Stores (platform), Advertising, Analytics, Research & suppliers,
      Creative, and Agent runtimes (Claude and Codex rows linking to Agents & Providers).
    - **Status shows the truth.**
      - "Connected" appears only after a successful sync or test.
      - A credential saved but never verified shows "Saved · not verified". That is Higgsfield until a test exists.
      - A key that can't decrypt shows "Locked: the encryption key changed. Re-enter the credentials", found on read
        by a decrypt check that returns nothing.
      - An auth-class error (from a sync or a test) shows "Needs reconnecting", with Reconnect (OAuth kinds) or Replace
        once ST-39 ships.
    - **Test connection.**
      - It is one real read-only request per kind, made through the connector's own client, with the smallest page.
        Examples: Shopify `shop { name plan { displayName } }` (plus `currentAppInstallation { accessScopes { handle }
        }`), Meta `act_<id>?fields=name,currency,account_status`, Etsy `getShop`.
      - **Each kind has an allowlist of endpoints** (path, method and, for GraphQL, an operation that is a `query`).
        Read-only POSTs (Google Ads `googleAds:search`, GA4 `runReport`, token endpoints) are allowed only through the
        allowlist. The fake-transport test fails on any request outside it and on any known write endpoint.
      - A token refresh during a test runs through the connector's own function and persists through `updateSecrets`
        (single-use refresh tokens must never be dropped). It never bumps `integrations.version`.
      - The test path never calls a sync function, `switchToReal`, `takeCurrency` or `takeTimezone`: a test on a demo
        store leaves `demo=1` and every store field unchanged.
      - It makes no writes, times out at 15 s, and is rate-limited: once per integration per 30 s, and 10 a minute
        overall (429 with the wait).
      - The result is stored: time, ok, ms, error class, and a message with any secret redacted.
      - A kind with no safe read-only request shows "Test not available: <reason>".
      - CJ's test goes through the PR caps ledger (`pr_calls`).
      - Claude and Codex use their existing checks.
      - Mocks run only in automated tests and are never shown as a result.
    - **Secrets stay write-only.**
      - The saved state is masked, with its date.
      - **Replace** works per field, and **Remove** works for optional secret fields.
      - Change rows say "replaced" or "removed", never the value.
    - **Destructive saves show a preview first** (Change connection…, a new connection):
      - a non-secret change: the cursor resets and up to 2 years re-sync;
      - a shop-key change: `forgetPlatform` deletes N orders, N products and N refunds;
      - an ad account another store already uses: refused (existing).

      A new connection on a **demo** store warns that the first successful sync takes the store live. That is
      irreversible, so the warning shows real counts of what is wiped and which jobs turn on. The server requires
      `confirmGoLive: true` at the `PUT /api/integrations` route and at `POST /api/integrations/oauth/start` (400
      before any redirect). The pending OAuth sign-in keeps the confirm in its in-memory state, and finish refuses a
      demo-store sign-in without it. `saveIntegration` itself stays unchanged.
    - **Reconnect** re-runs the existing OAuth flow for the same row (google_ads, etsy, tiktok_shop): same id, cursor
      and non-secret settings kept, only the token fields replaced.
    - **Disconnect.**
      - The impact comes from real data and the real behaviour:
        - synced data stays;
        - the store stays live, and its scheduled jobs keep running on the data already synced (with a link to
          pause them);
        - pending approvals that need this writer will fail when approved;
        - running runs holding the Meta Ads MCP token are stopped.
      - A global integration (CJ, Higgsfield) affects every store. Its impact lists the affected stores, PR sources,
        watches and pending approvals from real counts, and disconnecting it requires typing the integration's name.
      - Then: "Frontline can't revoke the token at <provider>", followed by where to revoke it, from the provider's
        official docs.

12. **Notifications.**
    - **Channels:** the bell and Windows toasts only. There is no email, SMS, push or webhook. The copy says toasts
      appear "when Frontline isn't the focused window".
    - **Categories, with exact help text:**
      - approvals;
      - agent done (also KB research, missions, teams);
      - errors (also backup failures, "stopped syncing", failed approved live writes);
      - research alerts;
      - the morning digest;
      - usage alerts (new).

      Each says: "Off: not kept; turning it back on doesn't bring them back." `info` notifications (recoveries,
      go-live) always show.
    - **Controls:**
      - **Windows toast** on or off per category;
      - **Quiet hours** in the workspace zone. During them toasts are not sent (they are dropped, not held); the bell
        still gets everything;
      - **Stores to notify me about.** An unticked store drops its notifications, like a category, with the same note;
      - **Digest time:** an hour in the workspace zone. The copy says "around 8:00", because the check runs every 10
        minutes.
    - **`notify()`** sets `toast` on each notification (additive `toast?: boolean` on `AppNotification`). Desktop
      `main.ts` skips the toast when `toast === false`.
    - **Dedupe:** `notify()` doesn't insert an identical unread notification (kind, title, body, store, link) created
      in the last 10 minutes. Kind `approval` is excluded: each row is a distinct request.
    - **Test notification:** `POST /api/notifications/test` takes `{category}` and sends one `info` notification
      through `notify()`, applying that category's toast switch and quiet hours (only the category-off drop is
      skipped). It reports
      what the server decided: "Bell: added", and either "Windows toast: requested", "Windows toast: not sent (quiet
      hours until 07:00)" or "Windows toast: not sent (toasts off for <category>)". The page adds "Windows toasts only
      appear in the installed desktop app" when `window.desktop` is absent. The copy says "not sent", never "held".
    - **Usage alerts:** when a store's AI usage today, or its credits, cross N% (default 80) of the effective cap. Once
      per store, cap and day (`once()`, workspace zone). Checked when a run ends and when credits are charged. Links to
      `settingsUrl('usage', {store})`.
    - **Links:** every server-side notification link is built with the shared `settingsUrl` and opens the relevant
      setting (backups → `data`, sync failures → the integration detail, usage alerts → `usage`, a missing default model
      → `agents`).

13. **Knowledge and Product Research.**
    - **Knowledge controls.**
      - Settings → Knowledge owns the KB research-control editor (`kb_controls`, both scopes) and its Schedules
        shortcut.
      - The Knowledge page's Research Center keeps its one-line status. Its "Controls" button becomes a link to
        `settingsUrl('knowledge', { store: <id> })`; no store means General.
      - The General scope shows only the fields General uses.
    - **KB fixes:**
      - Stale category ids: `parseControls` drops ids that are no longer top-level categories instead of failing, and
        deleting or moving a category removes its id.
      - Trusted domains say "Preferred in research prompts. Never overrides blocked domains, review or approvals."
      - The KB daily budget reads "in any 24 hours, pending approvals included".
      - Self-directed research is disabled, with the reason, when the engine isn't Claude.
      - The copy notes the hourly timing.
      - Lowering retention shows counts of what the next pass trims, research transcripts included, and needs a
        confirm.
    - **New knowledge settings:**
      - `knowledge.autoSave` (workspace + store) is read live at each automatic save, in the callers, never inside
        `captureFinding`:
        - `tools.ts` `save_finding`: with it off, mode `auto` becomes `ask` and goes through the existing `kb.save`
          approval branch, with its 5-per-run count;
        - PR `reports.ts` `captureFindings`: with it off, a report files no card; its claims stay in the report;
        - saves the owner starts (a conversation's "save to knowledge") never ask;
        - paths left ungated (measured results from `outcomes.ts`, `pipeline.ts` and `kb-perf.ts`, Knowledge research
          results, promotions) are named in the help text, for example "Measured results and Knowledge research still
          file their cards".

        Existing cards are untouched. An auto-saved card stays `proposed`, with its run, agent and sources (spec §6.6).
      - The knowledge-scope default (decision 9) has one editor, on Agents & Providers. The Knowledge page links to it.
      - Promotion to General is always a `kb.promote` approval. It is shown, not editable.
    - **Research profile.**
      - Settings → Product Research owns the store research profile editor, moved from `ProfileDialog`.
      - The Research page's "Edit research profile" links there.
      - Its toolbar ship-to quick switch stays: same route, sends the version.
      - All-stores ship-to stays per device, and the page says so.
    - **PR fixes and additions:**
      - `priceMin` gets a real consumer, or stops being offered (ST-27).
      - `taskMessage` gets a fenced "Store research profile" block, read when the task is created. The next task then
        uses the new destination, and earlier tasks keep theirs.
      - Store default assumptions (discount %, return rate %, refund %) are read by `economics.ts` as "Your
        assumption · <store> default".
      - Per-product overrides win. Saved comparisons keep their `assumptions_json`. Missing costs stay Unknown.
      - The price band is read in its stored `price_currency`, converted or flagged when that differs from the store
        currency (fixes the existing bug in decision 2).
    - **Not offered, because nothing reads them:** research depth, and supplier preference beyond the existing
      preferred ships-from (`warehouses`). That field's copy says it only adds a fit reason.
    - **Async effects.** Store currency or niche changes and base-currency changes run a re-evaluation or re-rank job
      (Saved → Applied). The currency job starts from `setStoreCurrency`, so sync-driven changes re-evaluate too. Their
      impact text names the possible default ship-to flip.

14. **Automation and approvals.**
    - **Who edits rules.**
      - The Automation page keeps owning rules: create, edit, delete, enable. Its editor and list name the workspace
        zone ("in <zone>", with a link to General).
      - The agent drawer's schedule toggles and the KB Schedules shortcut write the same rows (with the version).
      - Settings → Automation & Approvals holds the pause, the cancel action, the schedules overview, the autopilot
        rules (moved out of the caps form) and the approval map.
    - **Pause new automation** (`automation.paused`, read at each tick).
      - It stops new work the app starts by itself: schedule and metric rules, KB self-directed and scheduled research,
        KB promotion runs, the restart re-run of interrupted runs, and go-live niche-pack drafting, plus every other
        automatic start the call-site table classifies as automatic (ST-29).
      - It doesn't stop owner-started conversations, teams, missions already under way, syncs, backups, or PR
        ingestion (which uses no AI).
      - Slots missed during a pause are skipped, not caught up on resume.
      - The Automation page shows a banner while paused.
    - **Cancel running automation runs** is a separate action, with its own confirm.
      - It cancels the runs that automations started (`automation_runs.run_id`) through the run manager.
      - It shows each run's real outcome: "Stopped before it changed anything", "Stopped; its N requests stay in
        Requests", or "Already finished".
      - Nothing already applied is described as reversed.
    - **The approval map** is one table with one row per spec §6.8 category, each mapped to the real tools and approval
      kinds. Every `APPROVAL_KINDS` key appears in exactly one row:
      - read-only research: `kb.research` (self-directed KB research, under KB controls);
      - drafts: page drafts (`draft_page`) and flow drafts (`draft_flow`) stay in the app and need no approval. A theme
        draft (`draft_theme_change`) is different: it is an unpublished copy of your live theme with the agent's
        files, made in your Shopify store before you are asked (never at Suggest autonomy). The live theme is not
        touched, the copy takes one of Shopify's 20 theme slots, and saying no deletes it. Making it live asks you
        (`store.publish_theme`);
      - live store edits: `store.set_price`, `store.add_products`;
      - publishing: `store.publish_page`, `store.publish_theme`;
      - launching ads: "Meta Ads tools: each write asks you (`tool_use`); budget, bid and status changes go through
        propose_ad_change";
      - spending money: `ads.set_budget`, `ads.pause_campaign` (autopilot within the store's daily cap),
        `creative.generate` (credits);
      - deleting data: check the tool registry; if no agent tool deletes data, "Not available: no tool does this";
      - contacting customers: "Not available: no tool does this";
      - app-internal: `kb.save`, `kb.promote`, `niche.promote_learning`, `save_niche_pack`, `question`.

      Each row says who decides and where to change it. Autonomy, automation approval, KB approval and review, and
      Deploy's save-findings setting are explained, each with a link to where it is edited.
    - **Schedules overview:** each rule with its store, whether it is enabled, the cron in words, the zone, the next
      run and a link to its editor. An enabled rule with no `nextRunAt` shows "More than 8 days away · <cron in
      words>". `kb_research` rules say "KB controls decide approval", and the Automation editor hides the approval field
      for them.

15. **Data, backups, history, export and diagnostics.**
    - **Data & Backups shows exactly what exists:**
      - the data location and where it comes from (`FRONTLINE_DATA_DIR` or `./.data`; desktop `<userData>/data`);
      - the key location for this build (from a non-secret `FRONTLINE_KEY_SOURCE` hint the desktop passes), and the
        logs;
      - what a backup contains and leaves out, and the true schedule;
      - the backup kinds, recorded in the file name from ST-31 on (daily, manual, before restore, before update); older
        snapshots without a recorded kind say so;
      - **Back up now**;
      - **Restore**, with its full consequences (decision 2), including "Change History returns to the backup's state
        too". In a dev build, "Restart the dev server" replaces the wait for reload.
    - **Retention** is a read-only table of the real policy for each data class: conversation history and run
      transcripts, knowledge, research outputs, operational logs, audit history (kept until a restore rolls it back),
      notifications, backups. KB retention links to Knowledge. No new retention controls.
    - **Change History** uses the `settings_changes` table in `frontline.db`, which is never pruned and holds no
      secrets. Columns:
      - `id`, `at`, `request_id`;
      - `actor`: `owner` \| `import` \| `migration` \| `sync:<kind>` \| `system`;
      - `scope`, `store_id` and `store_name` (no FK, so rows survive a store delete);
      - `setting`, `before_json`, `after_json`;
      - `state`, `detail`.
    - **Export and import cover settings only**: registry entries with `export: true`, as versioned JSON
      (`{format: 'frontline-settings', version: 1, …}`).
      - Import validates and previews each change.
      - It never imports locked policies or secrets.
      - Every imported row for an entry flagged `safeguard` starts unticked and is labelled "Safeguard · tick to
        apply", whatever the direction of the change. Safeguard entries: `caps.*`; `autopilot.*`;
        `knowledge.autoSave`; `automation.paused`; `runs.{retries, concurrency, perStore}`; KB `autonomous`,
        `approval`, `review`, `roles`, `triggers`, `taskBudgetUsd`, `dailyBudgetUsd`, `trustedDomains`,
        `blockedDomains`, `retentionDays`; `notifications.approvals`, `notifications.errors`, their
        `notifications.toasts.*`, and `notifications.stores`; `timezone`. A ticked `retentionDays` decrease shows the
        same trim counts and asks for the same confirmation as the Knowledge editor.
      - The export dialog names the business information it contains: store names, fees, research profiles.
    - **Diagnostics export.**
      - Contents: app, build, OS and runtime versions; a health summary; effective non-sensitive workspace settings;
        counts; the last 200 log lines.
      - Redacted: every stored secret value and the loaded master key (base64 and hex), by exact match; token and key
        patterns, emails, the home folder, the profile name, store names, shop domains and ad account ids.

16. **Who owns each knob (the code map's duplicates, resolved).**

    | Knob | Edited in (owner) | Shown or linked from |
    |---|---|---|
    | Store name, color, niche, platform, currency, timezone, fees | Settings → Stores | Onboarding (first store, same form rows); "Add a store" links elsewhere point to it |
    | AI usage per day | Settings → Agents & Providers ("<store> limits"; "Workspace limits" in workspace scope) | Usage & Limits meter; agent drawer "Store caps" (effective value, origin, deep link) |
    | Ad budget changes and credits per day | Settings → Usage & Limits (store overrides and workspace defaults) | agent drawer, Creative page (effective value + deep link) |
    | Autopilot rules | Settings → Automation & Approvals | Deploy and Details `autopilotRules` lines (read-only) |
    | Agent on/off, autonomy, own daily budget | AI Agents settings drawer | Settings counts + "Open in AI Agents"; the Ecosystem on/off stays (same row) |
    | Per-conversation budget, stop-after, save findings | Deploy and Change runtime | Settings holds the defaults only; Deploy shows "Automatic saving is off for <store> (Settings): saves will ask you" + link |
    | Team budget and retries | Create team | Create team shows "at most N at once per store · Settings" |
    | Runtime, model, effort and knowledge defaults | Settings → Agents & Providers (the only editor) | Deploy prefill and knowledge field show "From <store> settings" or "Workspace default" + link; the Knowledge page links to the knowledge-scope row |
    | Claude and Codex status and setup | Settings → Agents & Providers | Shell, Deploy (inline setup, same hook), Details, Create team, Creative, PR dialog: read-only |
    | KB research controls and budgets | Settings → Knowledge | Research Center status line + link |
    | Automation rules | Automation page (shows the workspace zone) | Settings overview, KB Schedules shortcut, agent drawer toggles (same rows) |
    | Pause new automation | Settings → Automation & Approvals | Automation page banner |
    | Research profile | Settings → Product Research | Research page profile line + toolbar ship-to switch |
    | Notifications | Settings → Notifications | the bell's "Notification settings" link (ST-14b) |
    | Memory | AI Agents drawer and Knowledge (content, not settings) | not in Settings |

17. **Recorded limitations (not items; they go in the final report).** Each with its reason:
    - **Team & Access (spec §6.3) is not built.** Frontline has one owner on one computer: no user accounts, sign-in,
      roles, sessions or invites. The only protection is the localhost guard. The spec says not to invent a team
      system to fill a screen.
    - **Account** is the single owner's profile and preferences.
    - **Not offered:** password, multifactor or session controls (no authentication exists); a billing page (no billing
      system exists). The "Pro Plan" label leaves the UI because nothing enforces a plan. The field stays in shared.
    - **Language** is English only. **Date and time format** follows this computer (44 call sites format dates). The
      **theme** is dark only. **Interface density** is not offered. Account and Appearance each say this in one line.
    - **Personal timezone (§6.1):** there is none; times on screen use this computer's clock and schedules use the
      workspace timezone.
    - **Workspace identity (§6.2):** no workspace name exists, and none is added because nothing would read it.
    - **Response preferences (§6.4):** no response length or style option is honoured by both runtimes.
    - **Research depth and supplier preference (§6.7):** nothing reads them (beyond preferred ships-from).
    - **Monthly budgets (§6.10):** only daily caps are enforced; no monthly counter exists.
    - **Retention controls beyond KB, archival, business-data export, and deletion beyond store delete (§6.11):** no
      archive exists in the data model; retention is shown read-only.
    - **Digest frequency (§6.9):** daily only; the hour is configurable.
    - **Developer credentials and webhooks (§6.12):** Frontline has no developer API and sends or receives no webhooks.

18. **Live checks and the owner's inputs.**
    - **Three data dirs, never mixed:**
      - **(a) Click-through dir:** a fresh temp `FRONTLINE_DATA_DIR` under `.agent/` with demo stores only. Used for
        every click-through, the danger zones and the backup → change → restore → undo cycle. Served with
        `FRONTLINE_AGENT_ENGINE=fake`, plus one ST-48 click-through on its own fresh demo-only temp dir, without
        `FRONTLINE_AGENT_ENGINE` and with `automation.paused` on, to exercise the runtime rows. Claude shows the
        machine's real login state; Check again starts the CLI handshake only, with no model turn. Codex shows the
        status of that dir's empty codex-home (expected: Set up Codex). Check that the Set up Codex button is present,
        but don't click it: it starts `codex login`, which opens a browser sign-in and has no cancel. Its click is
        covered by mocked tests (mock `codexSetup`). Start no conversation, Deploy, team or mission on this server, and
        never take an OAuth Connect through to a provider sign-in (fake transport in tests instead).
      - **(b) Owner-credential dir:** `C:/Users/Xody2/orca/workspaces/FrontlineEcom/settings/.agent/owner-data`
        (absolute; git-ignored through `.agent/`). Only the owner's Blocked step creates it. The worker never serves it,
        moves it or deletes it, and opens it only through ST-47's script: a gitignored `.agent/live-test.mts` run with
        `node --import tsx`, with `FRONTLINE_DATA_DIR` set to dir (b) and `FRONTLINE_SECRET_KEY` unset (`loadKey`
        prefers it). The script calls `initLog(dir)`, `openDb(join(dir, 'frontline.db'))` and `loadKey(dir)`, then
        ST-38a's `testIntegration(db, key, id)` once per integrations row the owner entered, prints the stored result and
        exits. No loop starts and no setting changes. Its only writes are pending migrations, the test results and any
        rotated token. Run it only when nothing listens on 5259 or 8879 (the owner's app is closed), so two processes
        never open that database. To see whether the credential has arrived, read it with
        `new DatabaseSync('<dir b>/frontline.db', { readOnly: true })` → `SELECT kind, store_id FROM integrations`.
      - **(c) Claude-run dir:** its own fresh demo-only temp dir, with `automation.paused` on, for the single real
        Claude run: a conversation set to Claude on a demo store, its model taken from the changed default (the Deploy
        prefill path), a research-free prompt and a small run budget.
    - **Hard rules in every dev app:** never approve a request, enable autopilot, or save, sync, disconnect, restore or
      delete in a dir that holds the owner's credential (Test only). No server or dev app is ever started by the worker
      on dir (b): booting one syncs every integration at once (`sync.ts` `tick()` runs at start), and a first Shopify
      sync takes its store live. Record each pause and unpause in dirs (a) and (c) under Notes.
    - **Servers:** the worker starts and stops its own servers on 5253/8867, after checking the ports are free.
      - Every server it starts sets `FRONTLINE_DATA_DIR` to the absolute path of dir (a) or dir (c), never the default
        `./.data`; sets `FRONTLINE_AGENT_ENGINE=fake`, except in dir (c) and the ST-48 runtime pass; and sets
        `FRONTLINE_CODEX_WORK` to a temp folder outside the repo (the default `%LOCALAPPDATA%/FrontlineEcom/codex-work`
        is the installed app's), as `e2e/setup.ts` does.
      - "The dev server", every screenshot and every restart after exit code 75 mean dir (a), restarted with the same
        env. Restore exits the API with code 75; restart it yourself.
      - 5259/8879 belong to the owner's dev app on dir (b). Never bind them, start, stop or drive a server on them, or
        kill what holds them.
    - **Allowed live checks:**
      - real read-only connection tests, for credentials the owner entered in dir (b), through ST-47's script;
      - one backup → change → restore → undo cycle, in dir (a);
      - at most one short real Claude run, in dir (c): a changed default model visible in `agent_runs.actual_model`.
    - **Never:** the owner's installed app or its data; signing out of, stubbing or changing the owner's Claude or Codex
      login (`~/.claude`, `~/.codex`, their env vars; every worker on this machine shares the Claude login), or running
      `claude logout`, `/logout`, `codex logout` or `codex login`; spending money; publishing; changing a live store or
      ad account.
    - **Recording:** each live check goes under Notes with its time, what ran and the result. Report live checks
      separately from mocked tests. The GitHub repo is public. In Notes, the report and commit messages, record a live
      check only as kind, dir, time, ok/failed, ms and error class. Never record a shop domain, a shop or store name, a
      plan, an account or app id, an email, granted scope values tied to a real account, or any response or error text.
      Every committed image comes from dir (a) with demo data. Never screenshot dir (b).

## Not in this build

- Team & Access, password, multifactor, sessions and billing (decision 17).
- Email, SMS, push notifications and webhooks.
- Store archive. The data model has none, and every list, loop and connector would need a filter. Delete keeps its
  impact preview and typed confirmation.
- Light theme, interface density, language choice and date/time format.
- Response length or style defaults, and any fallback to another provider or model.
- Business-data export, backing up files outside the database, and a configurable backup schedule.
- Changing the hardcoded ad and price step limits, sync cadence, or KB and PR caps. They are shown only.
- Moving per-device state server-side: onboarding flag, filters, drafts.
- Concepts B, C and D.

## Lane

- **Owns** (the CLAUDE.md `settings` row):
  - `apps/web/src/pages/Settings.tsx` (it becomes the router entry) and `Settings.test.tsx` (replaced);
  - a new `apps/web/src/settings/**`;
  - `pages/Integrations.tsx` and its test, moved into `settings/integrations/`;
  - `apps/server/src/settings.ts` and a new `apps/server/src/config/**`;
  - the new `packages/shared/src/settings.ts`;
  - docs: `docs/features/settings*.md`, `docs/reference/settings-*`, the Settings item of `docs/DESIGN.md` (at the
    end), and this file.
- **Touch points** (edit only the functions an item names; fetch and rebase right before each edit; decision 1):
  - web: `App.tsx`, `nav.ts`, `main.tsx` and `test-utils.tsx` (ST-04's data router), `components/Shell.tsx`,
    `Hero.tsx` (profile chip), `StoreForm.tsx`, `components/Notifications.tsx` (the settings link), `lib/usage.ts`,
    `index.css` (the motion attribute), opt-in `ui.tsx` additions, `agents/settings.tsx`, `agents/Deploy.tsx`,
    `agents/Details.tsx`, `agents/Workspace.tsx`, CreateTeam, `knowledge/Controls.tsx`, `knowledge/ResearchCenter.tsx`,
    `product-research/ProfileDialog.tsx`, `product-research/ResearchDialog.tsx`, `pages/Research.tsx`,
    `pages/Automation.tsx`, `pages/Creative.tsx`, `pages/Analytics.tsx` (links only; Store Analytics' file once it
    runs), `ecosystem/renderer.ts` (motion only), `pages/DevGallery.tsx` (kit entries), and every link to `/settings`
    or `/integrations`;
  - web API hooks: `api/client.ts`: `api()` (ST-04: alongside `field`, attach `status`, `code` and `current` from the
    error body; rebase first), plus `useUpdateSettings`, `useSaveCaps` (ST-07), `useStoreActions` (ST-08a, ST-19),
    `useSaveKbControls` (ST-08b), `useAutomationActions.save` and `.toggle` (ST-08c), and `useIntegrationActions.save`
    and `.remove` (ST-08c, ST-40, which sends the version on DELETE); `product-research/api.ts`: `useSaveProfile`
    (ST-08b);
  - server: appended migrations in `db.ts`; in `app.ts`, mounts, the guard prefix, and the PATCH/DELETE
    `/api/stores/:id`, PUT `/api/integrations` and DELETE `/api/integrations/:id` handlers (ST-08a, ST-08c, ST-19,
    ST-39, ST-40); in `index.ts`, boot fills and the promotion-loop start callback; `kb/promote.ts` (the pause check);
    `stores.ts`, `integrations.ts`, `oauth.ts`, `sync.ts`, `connectors/*.ts` (the test client, change rows for
    sync-overwritten settings; Phase E files of codex-hardening), `automations.ts`, `cron.ts`, `dates.ts`, `digest.ts`,
    `fx.ts`, `backups.ts`, `approvals.ts` (notify link only), `kb/autonomy.ts`, `kb/routes.ts`,
    `product-research/{profile,evaluate,economics,tasks,facts,reports,routes}.ts`, `routes/agents*.ts` (usage,
    `toolEnv`, run hooks);
  - agents: `packages/agents/src/{configs,runs,teams,claude-engine,tools,creatives,squads,kb-links,jobs,engine}.ts` and
    `README.md` (the per-store copy);
  - shared: additive edits to `index.ts`;
  - desktop: `apps/desktop/src/main.ts` and `preload.ts` (the toast flag, login-item IPC, the key-source hint), plus new
    electron-free modules next to them, each with its own `*.test.ts` (ST-14a, ST-31, ST-33b; decision 1);
  - e2e: `e2e/**` for settings routes only, and only once codex-hardening's Phase D is done or it has `.agent/STOP`
    (ST-45).
- **CLAUDE.md row** (the coordinator adds it; text for the fallback below):
  `| settings | the Settings redesign (docs/features/settings.md): apps/web/src/pages/Settings*.tsx, a new
  apps/web/src/settings/**, apps/web/src/pages/Integrations.tsx (moved into settings/integrations/),
  apps/server/src/settings.ts, a new apps/server/src/config/**, a new packages/shared/src/settings.ts, plus the touch
  points listed in docs/backlog/settings.md. It runs at the same time as codex-hardening and store-analytics: edit their
  files only at the touch points in docs/backlog/settings.md, rebased first |` (with backticks around the paths, as in
  the other rows).
- Orca workspace "Settings": one finite Claude worker named **Settings**. Worktree
  `C:/Users/Xody2/orca/workspaces/FrontlineEcom/settings`, branch `CodySpooner/settings`.
- Ports: WEB_PORT 5253, API_PORT 8867 (already in your env). Start and stop your own servers (decision 18).
- Commits: `settings: ST-xx <what>`; split items keep their letter (`settings: ST-08a …`). Ship with
  `git fetch origin && git rebase origin/main && pnpm check && git push origin HEAD:main`. If the push is rejected,
  repeat. Never force-push, and never rewrite or reset `main`. Vault log: `Build Log/settings.md`. If `pnpm check`
  times out only in the Research scale test, rerun it with `$env:VITEST_MAX_WORKERS=4` and say so in the Done line.
  Never edit another lane's test to make it pass.
- **Desktop:** never run `pnpm desktop`, `pnpm package`, `pnpm release`, `electron` or `electron-builder` (decision 1).
- **Merging and releases:** the owner has authorised workers to push to main after `pnpm check` (the CLAUDE.md worker
  loop). That is all the spec's "beyond the authorization already granted" allows. Never tag or cut a release, bump the
  app version, publish the desktop build or deploy. Only the owner releases.
- **Lane set-up files.** The coordinator commits and pushes them before launching you: `docs/features/settings.md`,
  `docs/features/settings-codemap.md`, this file, `docs/reference/settings-workspace.{html,png}`,
  `docs/reference/settings-integration.{html,png}`, the CLAUDE.md `settings` row and the watchdog's `settings` lane
  entry. ST-01's first check is that they are present. If one is missing, copy it from the same path under
  `C:/dev/FrontlineEcom` (for CLAUDE.md and `scripts/agent/watchdog.mjs`, add only the settings row or entry) and commit
  it as `settings: ST-01 lane set-up files`. For the CLAUDE.md row, if it is missing from both, insert the fallback
  text above. Any other file missing from both goes under Blocked.
- **Ticking an item that is only partly possible** (waiting on the owner): tick it as `(partial: <part> under Blocked)`
  and add that Blocked entry. Never tick the missing part.
- **At the start of every item:** `git fetch origin && git rebase origin/main`, re-read the CLAUDE.md lanes table and
  the worktrees' STOP files (decision 1), then look under Blocked for owner inputs that have arrived.
- **Tools:** in `.agent/` (gitignored, never committed), use `cdp-shot.mjs` (exact-viewport screenshots plus console
  errors) and `cdp-drive.mjs` (real pointer and key input), copied in ST-01. Orca's browser pane takes only the
  1280×800 check; the other sizes go through headless Chrome over CDP.

## Done when

This is the completion checklist. For each line, ST-49's report names the test file(s) or the recorded check (a
screenshot path or a Notes entry) that proves it. ST-48 treats a line with neither as not done.

- **Items and build.**
  - Every item is ticked, fully or partially per the rule above, and every missing part sits under Blocked with the
    exact step the owner must take.
  - `pnpm check` and `pnpm build` are green. If `pnpm e2e` exists on main, it is green on `/settings/*` and
    `/integrations`, with no new axe baseline entries for them. A failure on another lane's route is filed to that
    lane's Inbox and listed in the report; it does not block this lane.
  - The repo has no linter, so the report says linting doesn't apply rather than claiming it passed.
- **Spec §11, line by line:**
  - **Persistence:** every registry entry's value survives navigation, reload and an API restart on a file database
    (one round-trip test over the whole registry). An apply job left `applying` resumes after a restart.
  - **Scopes:** a personal, a workspace and a store write each change only their own target (ST-07). Writing store A
    never changes store B, and switching stores never carries a draft along (ST-04, jsdom).
  - **Inheritance:** the default → workspace → store table resolves correctly for `inherits: 'workspace'` entries, and
    `inherits: 'none'` entries never fall back. "Use workspace default" deletes the override, so a later workspace
    change reaches the store. Locked policies resolve as locked at every scope.
  - **Permissions:** the backend rejects every route on a non-local Host or a foreign Origin, writes to scopes an entry
    doesn't allow, locked-policy changes through any route or import, and reads of secrets. Hiding in the UI is never
    the only check (ST-42 sweep).
  - **Save behavior:** validation errors stay next to their field. Cancel restores. Leaving with unsaved changes offers
    Save / Discard / Stay. "Saved" appears only after the server confirms, and "Applied" only after the job finishes.
    No error is ever hidden behind a success state.
  - **Concurrency:** two clients editing the same document → the second gets 409 and overwrites nothing. That holds
    for every owner in decision 6.
  - **Agent behavior:** the scripted engine received the default model and effort, and the config row (conversations)
    or `agent_runs.model`/`effort` (config-less runs) recorded them:
    - for a new conversation;
    - for a store override;
    - for an automation run without a config;
    - and a running run kept its own. A demo store's new conversation stayed on the demo engine.
  - **Integrations:** test, Replace, Remove, Reconnect and Disconnect each report the real outcome (fake-transport
    tests per kind). Each kind's test requests stay inside its allowlist. A kind without one shows "Test not available".
  - **Knowledge and research:** a blocked domain stops the next fetch; automatic saving off turns the next agent save
    into an approval and stops PR report capture, while the owner's own save still saves; a ship-to change reaches the
    next research task and leaves earlier ones alone; the research profile changes fit and discovery.
  - **Automation:** schedule edits update the same rule (no duplicates); the workspace timezone moves schedules, DST
    included; pause starts nothing new and doesn't show running work as cancelled; cancel reports each run's real
    outcome.
  - **Secrets and exports:** planted secrets appear in no response, WebSocket message, log line, change row, export or
    diagnostics file (ST-41 sweep).
  - **Usability:** search by synonyms, keyboard-only use, 1024–1920 px widths plus 390×844 with no sideways scroll,
    60-character labels and store names, 25
    stores, 200 history rows, and an error state for every section (jsdom plus browser screenshots).
- **Spec §8:** each end-to-end path in ST-44 passes through the HTTP API with the scripted engine. Each goes control →
  validation → persistence → effective configuration → behaviour → observable result.
- **Spec §12 completion criteria:**
  - The registry consumer and proof test and the `data-setting` coverage test are green, with an empty allowlist and
    no `data-legacy` left.
  - A click-through of every section, the integration detail, every dialog and the danger zones finds no control that
    does nothing (decision 18 dir (a)). Each control works, or is absent, or is disabled with a visible reason.
  - No connection test is simulated outside automated tests.
  - No backup claim goes beyond what the ST-47 restore cycle proved.
- The live checks of decision 18 that the owner's inputs allowed, reported separately from mocked tests.
- The pages are checked in Orca's browser at 1280×800, and with headless Chrome over CDP at 390×844, 1024×680,
  1366×728, 1440×900 and 1920×1080, against both boards (layout and styling only), with no console errors. Screenshots stay in
  `.agent/`.
- `styleseed-design-review` was run on Settings, and its findings are fixed or answered under Notes.
- **Final report:** `docs/features/settings-report.md`.
  - It opens with "Status: complete" only if every line above is met. Otherwise it opens with "Status: not complete",
    followed by each Blocked or partial line and what it needs.
  - Then:
    - what was built, section by section;
    - every migration and the recovery procedure (decision 7);
    - each workflow and whether it was tested live or only with fakes;
    - test results;
    - screenshots in `docs/reference/settings-final/`, all taken in dir (a), captioned "demo data";
    - the remaining limitations: every entry of decision 17 and of Not in this build, every integration kind not
      verified live, "Test not available" kinds with their reasons, the desktop changes as "not run in Electron; the
      owner verifies them in the next installed build" (the toast flag, the login item, the key-source hint), and
      "desktop restart after restore: not verified (no Electron runs)".
- Then create an empty `.agent/STOP` in this worktree and stop.

This lane is finite. When ST-01 to ST-49 are done, don't add new items: this overrides CLAUDE.md's "Backlog empty?"
rule. Put follow-up ideas under **Notes** for the owner. Ignore a watchdog nudge if `.agent/STOP` exists. **After
STOP**, the owner may delete `.agent/STOP` and ask for "run ST-47, then update the report". Do only that, then recreate
STOP.

## Inbox

- [ ] (from codex-hardening, CH-18 retest) ST-02 resolves the old Integrations +3 px finding: /settings/integrations passes all four widths. The requested six section routes are now covered; /settings/data at 390x900 exposes +239 px document overflow (scrollWidth 629, clientWidth 390) from the long data-directory path in Your Data. Repro: pnpm e2e --grep "/settings/data at 390px"; screenshot/trace in test-results/routes--settings-data-at-390px. Keep the path readable with wrapping or a bounded local scroller and shrinkable content; do not hide document overflow. All console/page/API checks pass. Other section/width cases pass. The baseline rename and LF attributes are shipped with this handoff; original Integrations overflow filing can be closed.

- [ ] (from codex-hardening, CH-18) Forwarding UI Inbox finding to the new Integrations owner: /integrations at 390x900 has 3 px document overflow (scrollWidth 393, clientWidth 390). Repro: pnpm e2e --grep "integrations at 390px". Wrap/shrink content without hiding document overflow; keep the strict route test. This is one of three failures blocking CH-18/20 acceptance; the agent pages are filed to AI Agents.
<!-- other lanes append requests here: - [ ] (from <lane>) <request>. Settings-scoped requests only (decision 1). -->
- [x] (done in ST-11) (from codex-hardening, CH-05; copied from `docs/backlog/core.md`'s
  Inbox "for Settings/timezones")
  `budgetAddedToday` and `autopilotUsedToday` use the machine's midnight; proposed default: each store's zone.
  **Answer (decision 8):** daily caps reset at workspace-zone midnight; the store zone stays for reporting days, metric
  windows and outcome checks. Do it as part of ST-11, not before: ST-11 ticks this line and the core.md line (with a
  pointer to decision 8) in the same commit.

## Items

### Configuration audit

- [x] ST-01 **Audit, baseline and corrections** (decisions 1, 2, 3).
  - **First:** check the lane set-up files are present (Lane). Copy any missing one as described there, or put it under
    Blocked.
  - Run `pnpm install`, then `pnpm check`. Record the baseline under Done: files, tests and time.
  - Create `.agent/`.
    - Copy `cdp-shot.mjs`, `cdp-drive.mjs` and `ship.sh` from `../product-research/.agent/`. Never commit them.
    - Take "before" screenshots of `/settings` and `/integrations` at 1280 and 1920 in `.agent/before/`, on a server
      you start on dir (a) (decision 18).
  - Confirm decisions 1 to 18 against the code at HEAD. Use the code map and decision 2. Record anything wrong under
    Notes, with the change you make to the decision.
  - Append a section to `docs/features/settings-codemap.md`: "Corrections (verified 2026-10-28)", from decision 2. The
    map then stops misleading later readers.
  - Append a "Registry plan" section to the code map.
    - One row per setting in decision 3: its owner, its consumers as `path#symbol` (each confirmed by grep at HEAD),
      its `inherits`, and the item that wires it.
    - A row without a consumer you can name is dropped, or that item builds the consumer.
    - Every `createCard` and `captureFinding` caller, classified: follows `knowledge.autoSave` (agent automatic saves,
      PR report capture), owner-initiated (never gated), or left ungated and named in the help text (decision 13).
    - The test files that call `updateCaps`, `updateSettings`, `saveIntegration` and the other owner helpers directly,
      so each route change in ST-07 and ST-08a–c updates them in the same commit.
  - **Done when:** the set-up files are present, the baseline is under Done, both codemap sections are committed, and
    Notes lists every changed decision (or says "none changed").

### Approved interface

- [x] ST-02 **Settings frame, routes and deep links** (The design: frame; decisions 1, 11, 12, 16).
  - Files: `pages/Settings.tsx`, `settings/Layout.tsx`, `settings/Sidebar.tsx`, `packages/shared/src/settings.ts`
    (`settingsUrl` and the section slugs), `App.tsx`, `nav.ts`, `components/Shell.tsx`, `apps/server/src/backups.ts`,
    `apps/server/src/sync.ts`.
  - **Routes:**
    - `/settings/:section`. `/settings/stores/:id` ships with ST-18 and `/settings/integrations/:id` with ST-37b.
    - `/settings` → `/settings/general`. A slug that isn't in `SECTIONS` yet redirects to `/settings/general`.
    - `/integrations` → `/settings/integrations`, with the query kept.
    - **`SECTIONS`** (exported from `settings/Layout.tsx`) lists only slugs with content. This item lists `account`,
      `general`, `notifications`, `stores`, `usage`, `data` and `integrations`. Each later item adds its slug and
      sidebar entry in the same commit as its content: `appearance` (ST-13), `agents` (ST-21), `knowledge` (ST-25),
      `product-research` (ST-27), `automation` (ST-29), `history` (ST-32), `advanced` (ST-33a).
    - One Settings element stays mounted across `/settings/*`.
    - In the app nav, the Integrations item is active on its routes and the Settings item on the rest.
  - **Sidebar:** 248 px, with the groups of the listed sections. Badges come from real data only: the store count, and
    the count of integrations with status error. The main column is at most 860 px wide. Below 900 px the sidebar is a
    section select above the content, and no page scrolls sideways at 390 px.
  - **`settingsUrl(section, { id?, store?, setting? })`** in `packages/shared` is the only link builder, for the web and
    for the server's `notify()` links. It produces `/settings/<section>[/<id>][?store=<id>][#<setting>]` (the path
    segment before the query and hash). Each link points where its
    content lives now, and the item that moves the content updates the link. Replace every link to `/settings` and
    `/integrations` with it:
    - `agents/settings.tsx` "Edit caps" → `usage?store=<id>#caps.agentCostPerDay` (ST-23 moves it to `agents`);
    - the "Add a store" link in `agents/Workspace.tsx`, `StoreFilter`, `Analytics.tsx` ~106, `Dashboard` (two links),
      `pages/Integrations.tsx` ~65 → the section their text names (stores for "Add a store");
    - the Hero chip → `account`;
    - `agents/Deploy.tsx` ~422, `agents/Details.tsx` ~194, `components/DemoJobsNote.tsx` ~15, `Onboarding.tsx` ~120 and
      ~124, `Shell.tsx` ~125, `Creative.tsx` ~138 and ~146, `Analytics.tsx` ~182 → `integrations`;
    - `lib/usage.ts`: "Raise the store's AI cap" → `usage` (ST-23 moves it to `agents`), "Check your Claude login" →
      `integrations` (ST-21 moves it to `agents`). Keep the matched suffix "Raise it in Settings.";
    - server: `backups.ts` ~72 and ~77 → `data`; `sync.ts` ~26 → `integrations` (ST-37b moves it to the detail).
  - **Moving today's content.** Today's panels move unchanged into their sections, so nothing is lost while later items
    rebuild them. Wrap each moved panel in `<div data-legacy="ST-xx">`, naming the item that replaces it (decision 5
    test 2):
    - Stores → stores;
    - Caps & Autopilot → usage;
    - Profile: the display name → account, and the base-currency field → general. Each saves only its own field;
    - Notifications → notifications;
    - Your Data and Backups → data;
    - the Integrations page → integrations.
  - **e2e:** while codex-hardening runs, `e2e/**` is its. If its CH-18 is still unticked, file an Inbox line there
    asking it to add the shipped `SECTIONS` routes only to the route smoke (ST-37b files `/settings/integrations/:id`
    the same way, once the route exists). If Phase D is already done or it has `.agent/STOP`, ST-45 adds the settings
    routes itself. If `pnpm e2e` exists on main, run it before pushing.
  - **Consumer:** the router, every deep link and every server notification link.
  - **Done when:**
    - `Settings.test.tsx` is rewritten and green. It proves:
      - `/settings` lands on General showing the base currency;
      - a slug with no content is absent from the sidebar and redirects to General;
      - each listed slug renders its section;
      - `/integrations?x=1` lands on `/settings/integrations?x=1`;
      - a deep link opens the right section with its store selected;
      - every replaced web link builds the expected URL, and `settingsUrl('integrations', { id: 'x', setting: 'y' })`
        → `/settings/integrations/x#y`;
      - the nav active state;
      - the Settings element is the same DOM node across two sections;
      - Account saves only the name and General only the base currency.
    - Server tests: the backup notifications link to `data` and the sync notices to `integrations`.
    - `.agent/st02-1280.png` shows the frame with the board's proportions, and a CDP shot of `/settings/general` at
      390×844 has `scrollWidth <= clientWidth`.

- [x] ST-03 **Row kit and save bar** (The design: frame items 3–6; decision 6).
  - **Files:**
    - `settings/kit.tsx`, with:
      - `SettingsSection`: title, help and an optional Advanced expander;
      - `SettingRow`: label plus help or origin on the left, control on the right, and the field error under it;
      - `OriginLine`: workspace default, customized (and "same as workspace default") with its action, policy lock,
        environment, demo store;
      - `ScopeSwitch`: the "Editing" label, "Workspace defaults | <store ▾>", plus a store-only variant and a
        "General knowledge | <store>" variant;
      - `SaveBar`: count, scope, impact slot, Cancel, Save changes, and the saving, saved, applying, applied and error
        states;
      - `ImmediateRow`, for preferences that apply right away;
      - `DangerZone`.
    - `settings/useDraft.ts`: one draft per section and scope, with dirty fields and reset.
    - Entries in `pages/DevGallery.tsx`.
  - Match the board's HTML for row height, type sizes, colours and the save bar. Use only opt-in `ui.tsx` variants.
  - **Consumer:** every section from ST-12 on.
  - **Done when:** `settings/kit.test.tsx` is green. It proves:
    - each origin line's text and action;
    - the save bar shows the count and scope, and never shows "Saved" before the mutation resolves;
    - a failed save keeps the draft, and a server error naming a `field` renders under that row;
    - Cancel restores the draft;
    - the Advanced expander and the scope switch work from the keyboard, and the store popover scrolls with 25 stores.

    A DevGallery screenshot is compared with board A1.

- [x] ST-04 **Leaving with unsaved changes, and conflicts** (spec §5; decisions 2, 6).
  - **The Save / Discard / Stay prompt** appears for:
    - any in-app navigation: settings sidebar, app nav, links, back;
    - a store switch inside a section;
    - reload or tab close in a browser (`beforeunload`). Register it only when `window.desktop` is absent: in Electron
      it would cancel quit, quit-and-install and reload silently (decision 2), and closing the window only hides it.
  - **The router.** `useBlocker` needs a data router. Mount `main.tsx`'s router as `createBrowserRouter` with a single
    `*` route rendering the existing `<App/>`, so `App.tsx`'s `<Routes>` stay unchanged. In the same commit, change
    `renderApp` in `test-utils.tsx` to `createMemoryRouter` + `RouterProvider` with the same splat route, and run the
    whole web suite.
  - **The 409 conflict dialog** lists the fields that changed elsewhere, theirs next to mine. It offers **Reload**
    (drop mine) or **Keep mine** (re-apply on top of the new version and save). It reads `err.status === 409`,
    `err.code` and `err.current` from `api()`. On a 409 where none of the draft's fields differ between `current` and
    the version it read, re-apply on the new version without the dialog.
  - **Consumer:** every explicit-save section.
  - **Done when:** tests are green for:
    - the guard on each kind of navigation;
    - Save waits for the server before it navigates;
    - Discard drops the draft;
    - with a dirty draft on store A, switching to B and Discard → B's form shows B's values and no request is sent;
      Save → the request body carries storeId A;
    - the desktop branch: with `window.desktop` present and a dirty draft, no `beforeunload` handler blocks quit;
    - the conflict dialog, both ways, against a fake 409;
    - the whole web suite under the new router.

### Scope and persistence foundation

- [x] ST-05 **Data model and boot fills** (decisions 6, 7, 15).
  - **The ST-05 migration** (next free number, n), `/* n (settings: ST-05 versions on config rows; settings change
    history) */`:
    - `version` on the seven owner tables;
    - `updated_at` where it is missing;
    - `settings_changes`, with indexes `(at)` and `(store_id, at)`.
  - **`config/boot.ts`, called from `index.ts`:** fill the `workspace` and `personal` rows. Every step is
    fill-if-absent and guarded by `once()`. `store_caps` is left exactly as it is.
  - **Consumer:** ST-07 reads the rows. Change History (ST-09, ST-32) reads the change rows.
  - **Done when:** the upgrade test in decision 7 is green in `db.test.ts`. On a version n−1 database with saved
    settings and caps, the `store_caps` rows are unchanged after boot and the effective values before and after are equal.

- [x] ST-06 **Settings registry and coverage tests** (decisions 3, 5).
  - **Files:**
    - `packages/shared/src/settings.ts` (types and `SETTINGS`), re-exported from `index.ts`;
    - `validateSetting(def, value)`, shared by the server and the web;
    - the coverage test (decision 5 test 2), with its allowlist and the `data-legacy` skip.
  - **Which entries to add now.** Add the entries whose consumers already exist (decision 3). Each later item adds its
    own entries in the same commit as their consumer, and updates the allowlist as decision 5 test 2 says.
  - **Failure message of the consumer test:** it names the entry id and the missing `path#symbol`, and says to update
    `consumers` (and `proof`) in `packages/shared/src/settings.ts`: a permitted tiny unblocking edit for any lane, not an
    additive-only violation.
  - In this item's commit, append one Inbox line to `docs/backlog/store-analytics.md` (if it exists; otherwise under
    Notes for the coordinator) naming the registry consumers in its files (`tools.ts` `portfolio`/`compare_stores`,
    `analytics.ts`).
  - **Consumer:** `/api/config` validation (ST-07), search (ST-34), export (ST-36), the coverage tests.
  - **Done when:** `settings.test.ts` and the coverage test are green. They prove:
    - consumers exist (file present, symbol found), and every editable entry's `proof` test exists;
    - every entry has scopes, a default or `fill`, validation, an owner and `applies`;
    - every entry with more than one scope declares `inherits`;
    - ids are unique;
    - no entry is a secret, and integration fields aren't entries;
    - locked entries have no writable scope;
    - every rendered control outside `data-legacy` carries `data-setting`, `data-secret` (checked against the
      connector's fields) or `data-action` (with a named test), and every editable entry not on the allowlist renders.

- [x] ST-07 **Effective configuration and the config API** (decisions 4, 6, 10).
  - **Server files:**
    - `config/effective.ts`: `effective(db, { storeId? })` → values, origins (store \| workspace \| default \| env \|
      locked \| demo) and versions. It falls back to the workspace value only when the entry's `inherits` is
      `'workspace'`.
    - `config/write.ts`. Each save runs in one transaction and, for every document in it:
      - checks the version;
      - validates against the registry;
      - checks the scope: the store exists, the key is allowed in this scope, and locked keys are refused;
      - applies `set` and `unset`, where `unset` deletes the override key;
      - writes the change rows.

      A 400 body is `{error, field}` with the registry id.
    - `config/routes.ts`: `GET /api/config?store=` and `PATCH /api/config`
      `{ documents: [{ doc, storeId?, version, set, unset }] }`, behind `kbGuard`.
  - **Old routes go through the new writer.**
    - `updateSettings` and `updateCaps` call it, with an optional version. `PATCH /api/settings` and
      `PUT /api/caps/:storeId` keep answering, but now require the version (428 without it).
    - `PUT /api/caps/:storeId` `set`s only the keys present in its body. `CapsForm`/`useSaveCaps` send only the dirty
      fields, so a save never copies an inherited value into the store's row.
    - `getCaps` returns effective caps.
    - `useUpdateSettings` and `useSaveCaps` send the version. `version` is a required field of their input types, so
      a caller that omits it fails typecheck in any lane rather than getting 428 at runtime.
    - Update the direct-caller test files listed in ST-01's registry plan in the same commit.
    - In this item's commit, append one Inbox line to `docs/backlog/store-analytics.md` (if it exists; otherwise under
      Notes for the coordinator) and to `docs/backlog/codex-hardening.md` (while its Phase E is unfinished) naming the
      routes and hooks that now require `version`. ST-08a and ST-08c do the same for theirs.
  - **The documents** are `app`, `personal`, `workspace` and `store_caps:<id>`. `app` holds personal keys
    (`profile.name`, `notifications.*`) and a workspace key (`baseCurrency`) under one version.
  - **Consumer:** every caps reader (`toolEnv.caps`, `runs.ts`, PR `seatProblem`) through `getCaps`.
  - **Done when:** `config/config.test.ts` is green. It proves:
    - the inheritance table resolves, and an `inherits: 'none'` entry never falls back;
    - unset restores inheritance;
    - a `personal`-row write, a `workspace`-row write (timezone or a cap default) and a store write each leave the
      other documents' rows and versions unchanged, and an `app` write changes only the `app` row; writing store A
      leaves store B untouched;
    - saving only `agentCostPerDay` through `PUT /api/caps` leaves the other two keys absent from `store_caps`, and a
      later workspace-default change reaches them;
    - saving only an autopilot rule through `PUT /api/caps` leaves the three numeric caps inheriting (origin
      workspace);
    - a stale version gets 409 with the current document, and nothing is written;
    - a missing version gets 428;
    - a first store-override write with version 0 creates the `store_caps` row, and `PATCH /api/settings` on a fresh
      database with version 0 succeeds;
    - unknown, locked and out-of-scope keys get 400 with a reason and the `field`;
    - a save of two documents where the second is stale writes neither;
    - values survive closing and reopening the file database;
    - change rows hold before and after.

    On the dev server (dir (a)), `GET /api/config?store=<id>` shows the origins.

- [x] ST-08a **Versions and change rows: stores** (decision 6).
  - **Route:** `PATCH /api/stores/:id` requires the version (409 stale, 428 missing) and the GET responses include it.
    `POST /api/stores` is exempt.
  - **`parseStoreInput`** returns `field` wherever it already knows it.
  - **Web callers send the version:** `StoreForm` (Settings and Onboarding). `version` is required in the
    `useStoreActions` update input type (save with an id). Inbox lines as in ST-07.
  - **In-process writers** bump the version and write change rows with actor `sync:<kind>` or `system`: `takeCurrency`,
    `takeTimezone`, `setStoreCurrency` (`connectors/common.ts` ~62, the Amazon path; a codex-hardening Phase E file:
    rebase first). Status, cursor and timestamp writes do neither.
  - Each changed owner field writes a change row.
  - **Done when:** tests are green for:
    - a stale write and a missing version on the PATCH, and a create without a version;
    - a 400 from `parseStoreInput` carries its `field`;
    - a Shopify sync that changes the currency writes a change row with actor `sync:shopify` and bumps the version;
    - a sync's status write doesn't change the version.

- [x] ST-08b **Versions and change rows: KB controls and research profiles** (decision 6).
  - **Routes:** `PUT /api/kb/controls` and `PUT /api/pr/profile` require the version (409 stale, 428 missing; the first
    save sends version 0, decision 6) and their GET responses include it (0 when there is no row).
  - **Parsers:** `parseControls` (`kb/autonomy.ts`, a codex-hardening Phase A file: Phase A is already on main; rebase
    first, touch `parseControls` and `saveControls`) and the PR profile parser return `field`.
  - **`saveControls`** deletes and re-inserts the row today, which would reset `version` to its DEFAULT 1 on every save.
    It becomes `UPDATE kb_controls SET settings_json=?, updated_at=?, version=version+1 WHERE coalesce(store_id,'')=? AND
    version=?`, and INSERTs (at version 1) only when no row exists and the PUT sent 0. ST-25's category cleanup writes
    through this same function.
  - **Web callers send the version:** `knowledge/Controls.tsx`, `ProfileDialog` and the Research toolbar ship-to
    switch.
  - Each changed owner field writes a change row. ST-25's category-delete cleanup of `kb_controls` will bump the version
    too (it lands there).
  - **Done when:** tests are green for a stale write, a missing version and a `field` on each route, and the change
    rows. The KB stale test saves twice with the same version read once and expects 409 on the second save.

- [x] ST-08c **Versions and change rows: automation rules and integrations; the writer sweep** (decision 6).
  - **Routes:** `PATCH /api/automations/:id` and `PUT /api/integrations` require the version (409 stale, 428 missing).
    `POST /api/automations` is exempt; a new connection sends version 0 (decision 6). Secret fields write change rows
    saying "replaced" or "removed".
  - **Parsers:** `parseRule` and `saveIntegration` return `field`.
  - **Web callers send the version:** `pages/Automation.tsx`, the schedule toggles in `agents/settings.tsx`,
    `ConnectForm`. `version` is required in the update input types of `useAutomationActions.save`/`.toggle` and
    `useIntegrationActions.save`. Inbox lines as in ST-07.
  - **In-process writers** bump the version and write change rows with actor `system`: `createDefaultJobs`,
    `enableDefaultJobs`, the job-gates pass (`routes/agents.ts` ~545), the task rewrite (`jobs.ts` ~121). Token rotation
    through `updateSecrets` and status writes do neither.
  - **The sweep test** matches `UPDATE <t> SET`, `INSERT [OR REPLACE] INTO <t>` (including `ON CONFLICT … DO UPDATE
    SET`) and `DELETE FROM <t>` for `stores`, `automation_rules`, `store_caps`, `kb_controls`, `pr_store_profiles` and
    `integrations`, everywhere outside `config/write.ts`. Each match must either bump `version` or appear in the test's
    allowlist, split into bookkeeping, create and row-delete. For `settings`, it asserts that no file other than
    `config/write.ts` and `config/boot.ts` writes the keys `app`, `workspace` or `personal`; other keys are bookkeeping
    and out of scope.
    - Its failure message names the file, line, table and column, and says: "If this column is bookkeeping (status,
      cursor, timestamps, sync or test results), add it to BOOKKEEPING in <test file>. Never bump version for
      bookkeeping. If the owner edits it, write through the owner helper so version moves. Either edit is a tiny
      unblocking change any lane may make."
  - Update the direct-caller test files listed in ST-01's registry plan in the same commit.
  - **Consumer:** Change History (ST-32) and the conflict dialog (ST-04).
  - **Done when:** tests are green for:
    - a stale write and a missing version on each route, and `POST /api/automations` exempt;
    - version 0 on an existing integration row → 409 `exists`; no version → 428; a version above 0 for a
      disconnected row → 409 `stale` and no row is recreated;
    - a token refresh doesn't change the version;
    - the sweep test;
    - the Automation page toggle still works (`pages/Automation.test.tsx`).

- [x] ST-09 **Change history API, Saved and Applied** (decisions 6, 15).
  - **Server files:**
    - `config/changes.ts`: `GET /api/config/changes?store=&setting=&scope=&cursor=`, newest first, paged.
    - `config/apply.ts`: a small in-process runner for apply jobs.
      - Jobs are keyed by change row and idempotent.
      - At boot it resumes rows left `applying`.
      - `POST /api/config/changes/:id/retry` retries a `failed` row; it follows decision 1's store rule.
    - The runner publishes a `config_change` message on the existing WebSocket.
  - **Web:** the save bar follows Saved → Applying → Applied or Couldn't apply.
  - **Consumer:** ST-16 and ST-28's jobs, and ST-32's page.
  - **Done when:** tests are green for:
    - rows never carry a secret value;
    - a job left `applying` across a restart finishes;
    - retrying a failed job twice has the effect of one;
    - the save bar's states (jsdom, fake socket).

- [x] ST-10 **Impact previews** (spec §7; decision 6).
  - **Server:** `POST /api/config/impact` takes the same body as the PATCH and returns sentences built only from real
    queries. Write the impact functions in `config/impact.ts`, one per setting.
  - **Ships now:** the cap impacts (ST-20 adds the agent-default impact).
    - Caps lowered: "N running runs on <store> stop at their next step if they go over".
    - Workspace defaults: "Applies to N stores that use the workspace default; M stores have their own value".
  - **Later items** add their own impact functions, each with a test.
  - **Consumer:** the save bar's impact slot and every confirm dialog.
  - **Done when:** tests are green: each count equals its fixture, and no sentence shows a count without a query. On the
    dev server (dir (a)), `POST /api/config/impact` for a lowered `caps.agentCostPerDay` returns counts from real runs
    and `store_caps`.

- [x] ST-11 **Workspace timezone** (decision 8).
  - **Shared helpers:** move `localDate`, `midnight` and `utcOffset` into `packages/shared` (`dates.ts` re-exports
    them) and add `startOfDay(zone, now)`. A missing `workspace` row or timezone reads the machine zone, never UTC.
  - **Cron:** `cronMatches`, `nextCronTime` and `cronDueBetween` in `cron.ts` take a zone.
  - **Callers that switch to the workspace zone** (rebase first: the `tools.ts` cap counters and `runs.ts` budget
    sections are codex-hardening Phase A files; keep its reservations):
    - `automations.ts`: tick and the `maxRunsPerDay` midnight;
    - `digest.ts`: the hour check;
    - `squads.ts` `costToday`, `creatives.ts` `creditsToday`;
    - `tools.ts` `budgetAddedToday` and `autopilotUsedToday`;
    - the start refusal in `runs.ts`;
    - `nextRunAt`, which also names the zone.
  - **Inbox:** tick this backlog's CH-05 Inbox line and the matching line in `docs/backlog/core.md` (with a pointer to
    decision 8) in this item's commit.
  - **Consumer:** this item. The UI is ST-16.
  - **Done when:** tests are green:
    - with the zone equal to the machine zone, every existing cron, automation, digest and usage test passes
      unchanged;
    - with no `workspace` row, the machine zone is used;
    - with another zone, a 9:00 rule fires at 9:00 in that zone;
    - on a spring-forward and a fall-back day, a 2:30 rule fires once;
    - every counter resets at the zone's midnight;
    - a rule fired at 9:00 in zone A, the zone switches to B, and the rule runs at most once that day, with
      `maxRunsPerDay` counting across the switch.

### Functional settings sections

- [x] ST-12 **Account** (decision 17).
  - **Files:** `settings/sections/Account.tsx`, `components/Hero.tsx`.
  - **Rows and lines:**
    - Display name, 1–40 characters, explicit save.
    - The computer's timezone, read-only: "Times on screen use this computer's timezone (<zone>). Schedules use the
      workspace timezone." (ST-16 adds the link to General's row.)
    - "Frontline has one owner on this computer: there's no sign-in, team or billing."
    - "English only."
  - Remove the "Pro Plan" label from the Hero chip and from Settings. The field stays in shared.
  - **Consumer:** the Hero chip.
  - **Done when:** tests are green:
    - a rename persists across a refetch and shows on the chip;
    - the server refuses 41 characters;
    - no rendered page contains "Pro Plan".

- [x] ST-13 **Appearance** (decision 3). Adds the `appearance` slug.
  - **Motion:** a "Follow Windows | Always reduce" row that applies right away.
    - It sets `<html data-motion="reduce">`.
    - `index.css` applies its `prefers-reduced-motion` rules under that attribute too.
    - `ecosystem/renderer.ts` treats the attribute like the media query and listens for changes to it.
  - **Read-only lines:**
    - "Dark theme only."
    - "Windows contrast themes are followed."
    - "Office theme and low-power mode are on the AI Ecosystem page (this device)", with a link.
  - **Consumer:** `index.css`, the Ecosystem renderer.
  - **Done when:** tests are green:
    - the attribute is set only after the server confirms;
    - `index.css` has the attribute selector for every reduced-motion rule (a file test);
    - the renderer reduces motion when the attribute is set.

    A screenshot is taken.

- [x] ST-14a **Notifications: server and desktop** (decision 12).
  - **Files:**
    - `settings.ts` `notify()` and `PREF`: categories, stores, the `toast` flag, quiet hours (workspace zone), dedupe
      (kind `approval` excluded);
    - shared `AppNotification.toast`;
    - a new `apps/desktop/src/toast.ts` exporting `shouldToast(n, focused)`, plus `toast.test.ts`; `main.ts` imports
      it (main.ts can't load under vitest; decision 1);
    - `POST /api/notifications/test` `{category}`, reporting what the server decided (decision 12).
  - **Consumer:** `notify()` and the desktop toast.
  - **Done when:** tests are green:
    - a category turned off → nothing is stored;
    - an unticked store → nothing is stored;
    - toasts off, or quiet hours (across midnight, in the workspace zone) → stored with `toast: false`;
    - the dedupe catches a repeat within 10 minutes but not after;
    - two same-titled approval requests within 10 minutes both get a bell row;
    - the test endpoint returns "Bell: added" with "Windows toast: requested" or the right "not sent (…)" reason;
    - `shouldToast` respects the flag.

- [x] ST-14b **Notifications section** (decision 12).
  - **Files:** `settings/sections/Notifications.tsx` (replaces the moved panel), `components/Notifications.tsx`.
  - **The section:** the honest help text for each category, the store list, the toast toggle per category, quiet hours
    and **Send test**. The test result shows the server's report, plus "Windows toasts only appear in the installed
    desktop app" when `window.desktop` is absent.
  - **The bell** gets its "Notification settings" link (`settingsUrl('notifications')`).
  - **Done when:** jsdom tests are green for each row's help text, the test result wording in both builds and the bell
    link. On the dev server, **Send test** lands in the bell.

- [ ] ST-15 **Notifications: digest time and usage alerts** (decision 12).
  - **Digest:** the hour is a setting (replacing the hardcoded `HOUR` in `digest.ts`), and the copy says "around".
  - **Usage alerts:** a toggle and a percentage. They are checked in the run-end hook (`routes/agents.ts` `runHooks`)
    and where credits are charged. `once()` is keyed per store, cap and workspace-zone day. The notification links to
    `settingsUrl('usage', {store})`.
  - **Rows:** the digest-hour, usage-alert toggle and percentage rows go in the Notifications section in this commit
    (jsdom test).
  - **Consumer:** `digest.ts` and the new check.
  - **Done when:** tests with fake timers are green:
    - with the hour set to 9, the digest goes at 9:00 in the zone;
    - turning it on after that hour still sends the same day;
    - an alert fires once at 80%, not again that day, and again the next day, with the expected link;
    - with alerts off, none fires.

- [ ] ST-16 **General: display currency and workspace timezone** (decisions 8, 13; spec §6.1, §6.2).
  - **Currency picker** (replaces the moved field).
    - It offers the codes present in the stored `fx` row's rates plus every store's currency, and the server validates
      against the same set: anything else gets 400 naming the code.
    - Its help: "Display currency for totals across stores. It doesn't change any store's selling currency."
    - Impact: "Re-ranks All-stores facts for N products."
    - An apply job (ST-09) re-ranks the PR All-stores facts (`facts.ts`).
    - The web invalidates every query that shows converted totals: summary, campaigns, top products, PR discovery and
      the agents' usage views. Grep the `fxFor` callers to find them all.
  - **Workspace timezone select.** It offers `Intl.supportedValuesOf('timeZone')`. Its impact lists each enabled
    schedule's next run before → after, from real rules, and "Today's usage counters restart at <time>: AI usage today
    becomes $X of $Y on <store>", computed with `costToday` in both zones.
  - **Account:** add the link from the timezone line to this row.
  - **Consumer:** `fx.ts`, `digest.ts`, PR facts, and everything in decision 8.
  - **Done when:** tests are green:
    - `XYZ`, and a real code with no stored rate, get 400;
    - after the job, All-stores discovery returns facts in the new currency (fixture products);
    - the timezone impact lists the real rules and the counter restart;
    - changing the base currency or the zone leaves the `stores` rows, orders and `store_caps` untouched;
    - change rows are written.

- [ ] ST-17 **Setup checklist** (spec §7).
  - **Server:** `GET /api/config/checklist` computes each item from real state:
    - a store exists;
    - Claude is signed in (the cached account check);
    - each live store's platform integration has a successful sync or test;
    - a research source is verified: a successful CJ sync in `pr_sources`, not just a saved key;
    - the newest backup is under 48 h old.

    Each item carries a deep link. The Claude item links to `settingsUrl('integrations')`; ST-21 moves it to
    `agents`. ST-38b adds the token-scope item.
  - **Web:** a card at the top of General, shown only while an item is open, and a dot on General in the sidebar.
  - **Consumer:** the card and the sidebar dot.
  - **Done when:** tests are green: each item stays open until its real condition holds and closes when it does. A saved
    but unsynced CJ key stays open.

- [ ] ST-18 **Stores: list, add and store settings** (decision 2: store form; decision 16).
  - **The list** at `/settings/stores`: name, colour, platform, Live or Demo data, selling currency and fees.
  - **The store page** at `/settings/stores/:id` has these rows:
    - name, colour and niche;
    - sub-niche, which can be cleared (the server accepts `null`);
    - **platform:** locked on a connected store, with the server returning 400;
    - **selling currency:** read-only on a connected store, with "Set by <platform> on every sync". On a demo store it
      is editable, and its impact lists `setStoreCurrency`'s effects;
    - **business timezone:** read-only while Shopify or WooCommerce is connected (the server refuses). On a demo
      store: "Takes effect once the store goes live";
    - **fees**, with the impact "Recomputes profit for all N orders, past ones included".
  - **Links** from the store page:
    - its Knowledge workspace and niche pack;
    - its research ship-to (its "primary market"): the Research page's profile until ST-27 moves the link to
      `settingsUrl('product-research', { store })`;
    - its integrations.
  - **Add store** reuses the rows in a dialog. Its impact: "Adds demo history, a squad of N agents and N scheduled jobs
    (off until the store goes live)", from `createDefaultJobs`.
  - **Consumer:** the existing store consumers. Onboarding keeps using `StoreForm`.
  - **Done when:** tests are green:
    - a platform change on a connected store gets 400;
    - the sub-niche clears;
    - a currency or timezone change is refused per platform;
    - the fee impact count is right;
    - the version is sent.

- [ ] ST-19 **Store deletion** (spec §6.2, §10).
  - **Impact:** `GET /api/stores/:id/impact` returns real counts:
    - agents, running and queued runs, scheduled jobs;
    - integrations, pending approvals;
    - KB cards, memory, research rows and orders.

    It also lists what survives: the action log, niche learnings (unlinked), change history, and the Codex work folder
    path, which stays on disk.
  - **Confirm:** the danger zone requires typing the store's name. `DELETE` checks the name server-side
    (`?confirm=<name>`).
  - **Cleanup on delete:** the settings rows keyed by the store's integration ids, and that store's connector
    read-state entries.
  - **Consumer:** the delete flow.
  - **Done when:** tests are green:
    - the impact counts are right;
    - a mismatched name gets 400;
    - the leftover rows are gone;
    - other stores' rows are untouched.

- [ ] ST-20 **Agent defaults reach real runs** (decision 9; spec §8 "agent model default"). Server wiring, before any UI
  (ST-21).
  - **Registry entries** for `agentDefaults.*`, set through `/api/config`; the server validates against live
    capabilities, with the registry as fallback.
  - **`seatDefault`** takes the effective defaults. A conversation created without a config uses them. On a demo store
    it keeps runtime `demo` whatever the defaults are; the model and effort defaults prefill only when the owner picks
    the default runtime, otherwise that runtime's own defaults. `stopAfterMin` applies to new conversations only.
  - **The agent-default impact** (`config/impact.ts`, same commit as the registry entries, so the route accepts the
    body): "Applies to new runs on <store>; N running runs keep their settings". N counts running runs plus queued runs
    that have a `config_id`. Queued runs without a config read the defaults when they start, so they are reported as
    "N queued runs will use the new default".
  - **Runs without a config** get the model and effort from the defaults when the default runtime is Claude (`runs.ts`
    → engine input), and write the effective model and effort into `agent_runs.model` and `agent_runs.effort` when they
    start.
  - **Retrieval** uses `config?.knowledge ?? defaults.knowledge`.
  - **An unavailable default** fails the run with decision 9's message and an error notification linking to
    `settingsUrl('agents', {setting: 'agentDefaults.model'})`. No other model is tried.
  - Touch points: `configs.ts`, `runs.ts` (engine input only; rebase first, keep codex-hardening's budget changes),
    `claude-engine.ts`.
  - **Consumer:** `configs.ts`, `runs.ts`, `claude-engine.ts`.
  - **Done when:** scripted-engine tests are green:
    - workspace model X → the new conversation's config row has X, and the engine received X;
    - store override Y wins for that store only;
    - an automation run received X, and its `agent_runs.model`/`effort` recorded it;
    - workspace default runtime claude → a demo store's conversation created without a config has config runtime
      `demo` and runs on the demo engine;
    - on a demo store, a conversation created with `{runtime: 'claude'}` (the Deploy prefill path) gets the default
      model X, and the engine receives X;
    - the agent-default impact counts equal their fixture (running runs plus queued runs with a `config_id`, and queued
      runs without a config as "N queued runs will use the new default"), through `POST /api/config/impact` with an
      `agentDefaults` body;
    - "store only" leaves General out of retrieval, both for a run without a config and for a new conversation;
    - a run already going is unchanged;
    - unset → the old behaviour (the login's default, or `agentModel()`);
    - an unavailable model → the error and the notification link, with no other model tried.

- [ ] ST-21 **Agents & Providers: runtimes and defaults** (board A1; decision 9). Adds the `agents` slug.
  - **Runtimes card:**
    - Claude: status from `/api/claude-account`, with Check again (`?refresh=1`).
    - Codex: status, with Set up Codex through the existing `useSetUpCodex`.
    - Demo engine: one line.
    - A forced engine shows as locked.
  - **Defaults for new runs**, with the scope switch:
    - runtime (disabled on a demo store, with its reason);
    - model, with options from `/api/runtimes` for the chosen runtime;
    - effort, with that model's levels;
    - stop after, required for Codex, with "New conversations only";
    - knowledge (the only editor of this default);
    - "If the runtime fails", a read-only statement;
    - decision 9's line about scheduled and background work.

    Each row has its origin line and Use workspace default.
  - **Elsewhere:** Deploy's prefill and model field show their origin ("From <store> settings" or "Workspace default")
    with a link; `lib/usage.ts` "Check your Claude login" → `agents`; `Shell.tsx` ~125 → `settingsUrl('agents')` when
    Claude is the problem (`integrations` when a sync is failing); `Creative.tsx` ~146 (the Claude chip) → `agents`;
    ST-17's Claude checklist item → `agents`.
  - **Consumer:** ST-20's wiring.
  - **Done when:** tests are green:
    - changing the runtime resets model and effort;
    - the server refuses a model or effort that isn't offered, naming it;
    - the store-override origin shows;
    - a demo store's runtime row is disabled with its reason;
    - Deploy shows the origin and link.

    A screenshot is compared with A1. On the dev server (dir (a), `FRONTLINE_AGENT_ENGINE=fake`, with at least one run
    going on the store), changing the model default shows the board's sentence in the save bar, with the count from
    real runs.

- [ ] ST-22 **Run limits** (decision 9).
  - **The Advanced expander:** "retries, runs at once". It holds retries, runs at once in total, and runs at once per
    store.
  - **Wiring:**
    - `runs.ts` reads retries at the failure, and the total and per-store limits at each pump;
    - `budgetFor` uses the per-store value;
    - `teams.ts` `STORE_LIMIT` reads the same value, and the team scheduler clamps `max_concurrent` to it at each step
      pump, not only in `validateTeam`;
    - the refusal message names the limits and keeps the suffix `lib/usage.ts` matches (or update `lib/usage.ts` and its
      test in the same commit);
    - the effective per-store value replaces the hardcoded "2 per store" in `product-research/tasks.ts` ~181,
      `ResearchDialog.tsx` ~320 and `packages/agents/README.md`;
    - CreateTeam shows "at most N at once per store · Settings", with a link.
  - **Consumer:** `runs.ts`, `teams.ts`.
  - **Done when:** tests are green:
    - retries 0 → no retry on `rate_limit`;
    - per store 1 → a second run queues;
    - a total of 1 → a second store's run queues;
    - an existing team above a lowered per-store value runs at most that many at the next pump;
    - lowering the limit while 2 runs are going → both continue and the next one waits;
    - the PR strings and CreateTeam show the effective value (jsdom).

- [ ] ST-23 **Store and workspace limits cards, cap origins** (board A1; decisions 4, 10).
  - **The "<store> limits" card** (store scope):
    - AI usage per day, with its origin and override, and decision 10's help text.
    - The locked policy row: "always asks you first, except ad changes you put on autopilot", without a link (ST-30
      adds the "Approval rules" link once the `automation` section exists).
    - "N of M <store> agents have their own daily budget · Open in AI Agents", counted from `agents.settings_json`.
  - **"Workspace limits"** in workspace scope: edits the workspace value of `caps.agentCostPerDay`, with the impact
    "Applies to N stores that use the workspace default; M stores have their own value" (from `store_caps`).
  - **Impact:** "Raising it applies to runs that start after. Lowering it stops a running run at its next step once
    today's usage is over the new cap."
  - **Moves:** the AI row leaves the moved `CapsForm`; the "Edit caps" deep link and `lib/usage.ts`'s "Raise the
    store's AI cap" point to `agents`. If runs.ts's refusal text changes, keep the matched suffix or update
    `lib/usage.ts` and its test in the same commit.
  - **Readers show the effective value and its origin, with a deep link:**
    - the agent drawer's "Store caps" panel;
    - the credits line on the Creative page;
    - the budget line in the PR ResearchDialog.
  - **Consumer:** the readers above, through `getCaps`.
  - **Done when:** tests are green for:
    - the count, the origin texts, the deep links and the impact sentence;
    - a jsdom test that edits the workspace default, with impact counts matching a fixture;
    - a Codex run and a demo run are refused when the cap is used up (keeps the help text tied to the code).

- [ ] ST-24a **Usage: fixes and meters** (decision 10; spec §6.10).
  - **Fixes** (`tools.ts` `create_creative` is in codex-hardening's cap-counter section: rebase first and keep its
    recheck and synchronous charge):
    - re-read the credits cap after the approval wait. If CH-05's recheck already re-reads it, keep it and add only the
      test;
    - the meter includes pending renders;
    - the ad-cap help says "raise".
  - **Per-store meters** for today in the workspace zone, labelled exactly. The credits meter reads "including N pending
    renders".
  - **Consumer:** `tools.ts`, the `/api/usage` readers.
  - **Done when:** tests are green:
    - a credits cap lowered while a render waits → the render is refused after approval;
    - the meter equals today plus pending;
    - every meter label is right.

- [ ] ST-24b **Usage & Limits: editors, stacking and constants** (decision 10; spec §6.10).
  - **The section:**
    - Editors for ad budget changes and credits per day: store overrides with their origins, and in workspace scope the
      workspace defaults with "Applies to N stores that use the workspace default; M stores have their own value". They
      replace those rows of the moved `CapsForm`; its autopilot rows stay until ST-30.
    - "How AI limits stack": a table of the store cap, agent, team, run and KB budgets, each with its clock and where it
      is edited.
    - "Limits Frontline sets": read-only, each value imported from its constant.
    - "Not available: provider-reported charges".
    - All-time cost and tokens, from `/api/ecosystem/stats`.
  - **Done when:** tests are green:
    - a jsdom test edits each workspace default, and the impact counts match a fixture;
    - the store overrides and origins render;
    - no limit value is retyped (a test compares the shown values with the constants).

- [ ] ST-25 **Knowledge: research controls** (decision 13; spec §6.6). Adds the `knowledge` slug.
  - **The section** `settings/sections/Knowledge.tsx` has the "General knowledge | <store>" switch.
    - Move `ControlsForm`'s fields into rows. General shows only its own fields.
    - Move the Schedules shortcut too, labelled "KB controls decide approval".
  - **Lowering retention:** an impact count of what the next pass trims (page text, task logs, step outputs, research
    run transcripts), then a confirm.
  - **Copy:**
    - the trusted-domains line;
    - the "in any 24 hours" budget label;
    - the Claude dependency (disabled with its reason on the demo or a forced engine);
    - "Changes take effect at the next hourly pass".
  - **Elsewhere:**
    - The Research Center's status line stays, and its Controls button links to Settings.
    - Fix stale category ids in `kb/autonomy.ts` `parseControls` (rebase first), and in the category delete and move
      routes. The cleanup bumps the `kb_controls` version.
  - **Consumer:** the existing KB consumers.
  - **Done when:** tests are green:
    - deleting a category, then a PUT → 200, with the id gone and the version bumped;
    - General refuses store-only fields;
    - the retention impact counts are right;
    - the Research Center link works.

- [ ] ST-26 **Knowledge: automatic saving** (decision 13; spec §6.6, §8 "automatic knowledge capture").
  - **Automatic saving:** add `knowledge.autoSave` (workspace + store, `inherits: 'workspace'`), read live in the
    callers of ST-01's classification: `tools.ts` `save_finding` (with it off, mode `auto` becomes `ask` through the
    existing `kb.save` branch and its 5-per-run count) and PR `reports.ts` `captureFindings` (with it off, no card).
    `captureFinding` is unchanged, and owner-initiated saves never ask. The help text names the paths left ungated.
  - **Where it renders:** the Automatic saving card sits on Settings → Knowledge (registry `section: 'knowledge'`) and
    is the only card there that inherits. Under the "General knowledge" side of the switch it edits the workspace value
    and is titled "Automatic saving · default for all stores", so it never reads as a General-knowledge setting. In
    store scope it shows its origin line and Use workspace default (decision 4).
  - **Deploy:** next to the save-findings "Automatically" option, "Automatic saving is off for <store> (Settings): saves
    will ask you", with its origin and a link. Its knowledge field shows its origin.
  - **The Knowledge page** links to the knowledge-scope row on Agents & Providers (its only editor).
  - **Consumer:** `tools.ts#save_finding`, `reports.ts#captureFindings`.
  - **Done when:** tests are green:
    - a conversation set to save automatically → a card is saved, with status `proposed`, its run and agent recorded,
      and its sources kept;
    - with the setting off, the next save in that same conversation → a `kb.save` approval, and the existing cards are
      unchanged;
    - with it off, a PR report files no card;
    - with it off, the owner's block save from a conversation still saves directly;
    - the store override applies;
    - in General scope the card writes the workspace row, and in store scope it writes the `store_caps` override
      (jsdom);
    - Deploy's note and origin (jsdom).

- [ ] ST-27 **Product Research: store research profile** (decision 13; spec §6.7, §8 "research destination"). Adds the
  `product-research` slug.
  - **The section** `settings/sections/ProductResearch.tsx`, with a store-only switch.
    - Its rows are the profile fields moved from `ProfileDialog`: audience, price band, ship-to, preferred
      ships-from, max delivery days, include and avoid categories, avoid terms, keywords.
  - **Copy:**
    - "Fit is re-evaluated when you save";
    - "Discovery searches change at the next daily plan (00:00 UTC) or Sync now";
    - "Saved reports are never rewritten".
  - **The Research page:** "Edit research profile" links to Settings, and the toolbar ship-to switch sends the version.
    ST-18's store-page ship-to link moves to `settingsUrl('product-research', { store })`.
  - **`priceMin`.** Give it a real consumer in `evaluate.ts` `fitFor`, following the fit rules in
    `docs/features/product-research.md`. If no rule fits, stop offering it. Record which under Notes.
  - **The task message:** `tasks.ts` `taskMessage` gets a fenced "Store research profile" block, read when the task is
    created.
  - **Consumer:** `fitFor`, discovery, `taskMessage`.
  - **Done when:** tests are green:
    - a ship-to change → the next task's message has the new ship-to, and an earlier task's message is unchanged;
    - a profile save re-evaluates fit;
    - a categories or keywords change reaches the next discovery plan's CJ query (fake transport), and earlier plans
      are unchanged;
    - a stale version gets 409.

- [ ] ST-28 **Product Research: assumptions, copy from a store, re-evaluation** (decision 13; spec §7 presets).
  - **Default assumptions.** An appended migration adds nullable default discount %, return rate % and refund % to
    `pr_store_profiles`. `economics.ts` uses them as "Your assumption · <store> default" when the product has no
    override.
  - **"Copy from another store…"** shows a diff preview per field, then saves with the version in one transaction.
  - **Re-evaluation.** An apply job re-evaluates the store's products. It starts from `setStoreCurrency` (confirm every
    currency change, the PATCH included, goes through it; `connectors/common.ts` is a codex-hardening Phase E file:
    rebase first) and from the niche change in `updateStore`. Its impact names any default ship-to flip.
  - **Price band currency.** Read the band in its stored `price_currency`, converting or flagging it when that differs
    from the store currency (`profile.ts`), instead of only warning.
  - **Consumer:** `economics.ts`, PR evaluation.
  - **Done when:** tests are green:
    - provenance reads "Your assumption", while null keeps today's assumptions;
    - a per-product override wins;
    - a saved comparison keeps its assumptions;
    - a missing cost stays Unknown;
    - the copy preview equals what gets saved;
    - a sync-driven currency change runs the job;
    - a band saved in EUR on a store now in USD is converted or flagged, never read as USD.

- [ ] ST-29 **Automation: pause and cancel** (decision 14; spec §6.8, §8 "pausing a schedule"). Adds the `automation`
  slug.
  - **Pause:** `automation.paused` with `pausedAt`.
    - **Call-site table:** classify every `runs.start`/`startRun` call site as owner-started or automatic, with a
      decision per site, including delegation from a running run (`tools.ts` ~972 `ctx.startRun`), the developer runs
      started after an approval (`agents-actions.ts` `startRun`, `routes/agents.ts` `addProducts`) and mission-step
      retries. The automatic ones check `automation.paused`.
    - Impact: "Pauses N enabled rules across M stores and self-directed research in K stores. R automation runs
      already going keep going."
    - The Automation page shows a banner, and the sidebar shows a "Paused" badge.
  - **Cancel:** `POST /api/config/automation/cancel-running` returns each run's outcome.
  - **Consumer:** `automations.ts` tick, `kb/autonomy.ts`, `kb/promote.ts`, the restart re-run in `runs.ts`, go-live
    drafting in `routes/agents.ts`, and the table's other automatic sites (rebase first; these are codex-hardening
    files).
  - **Done when:** tests with fake timers are green:
    - a test greps the call sites and compares them with the table;
    - while paused, a due slot doesn't fire;
    - on resume, the missed slot is skipped (no burst);
    - the KB pass starts nothing;
    - the restart re-run is skipped;
    - an owner's conversation still starts;
    - a cancelled run shows status cancelled, and its outcome lists its approvals;
    - a run that already finished is reported as finished.

- [ ] ST-30 **Automation & Approvals: schedules, autopilot and the approval map** (decision 14).
  - **Schedules overview:** each rule with its zone and next run (workspace zone), and a link to its editor. An enabled
    rule with no `nextRunAt` shows "More than 8 days away · <cron in words>".
  - **Autopilot rules,** moved here from the remaining `CapsForm`, which goes away: per store, eligible kinds only.
    Stale kinds stay hidden.
  - **The approval map:** decision 14's table, whose source is a shared constant. Add the "Approval rules" link to it
    on ST-23's "<store> limits" locked row.
  - **The Automation editor** hides the approval field for `kb_research` rules, and its editor and list show "in
    <zone>" with a link to General.
  - **The KB Schedules shortcut** refuses a rule identical to one that exists.
  - **Consumer:** `requestApproval`, the Automation page.
  - **Done when:** tests are green:
    - every `APPROVAL_KINDS` key appears in exactly one row, and every named tool exists in the tool registry;
    - with autopilot, KB autonomous and an "auto" automation all on, `store.set_price`, `store.add_products`,
      `store.publish_page`, `store.publish_theme` and a `tool_use` write still create approvals;
    - a monthly rule shows "More than 8 days away";
    - editing a schedule keeps the same rule id;
    - adding an existing schedule again is refused;
    - the Automation editor shows the zone (jsdom).

- [ ] ST-31 **Data & Backups** (decision 15; spec §6.11).
  - **Storage panel:**
    - the data location and its source;
    - the key location, from a new `keyLocation` in `/api/health`: desktop safe storage, data dir or environment. The
      desktop's `main.ts` passes a non-secret hint (`FRONTLINE_KEY_SOURCE=safe-storage`) next to the key (a one-line
      addition proven by typecheck, or an electron-free env builder with its own test; decision 1);
    - the logs;
    - Open folder: desktop IPC, or the route in a browser.
  - **Copy fixes:** the "Your Data" text, and the `Settings.dataDir` doc comment in shared.
  - **Backup kinds:** `backupNow` takes a `kind`: `-daily` for the daily check, `-manual` for `POST /api/backups`,
    `-before-restore` in `stageRestore` (`-before-update` stays). The existing `^frontline-[\w-]+\.db$` regex already
    matches them. Older files without a suffix are labelled "Snapshot (kind not recorded)".
  - **Backups:** the list with each backup's kind, **Back up now**, and the restore dialog with every consequence,
    including "Change History returns to the backup's state too". A dev build shows "Restart the dev server" after a
    restore. The desktop text names what `main.ts` does (exit code 75 → the server restarts and the window reloads);
    the report lists it as "desktop restart after restore: not verified (no Electron runs)".
  - **Retention:** the read-only table, with Change History's line.
  - **Consumer:** the backups routes.
  - **Done when:** tests are green:
    - the copy is right for each build kind;
    - `keyLocation` is right for each of the three sources;
    - each new kind round-trips through `listBackups`, and an unsuffixed file gets the "not recorded" label;
    - the restore dialog lists the consequences;
    - the dev notice shows when the version is `dev`.

    ST-47 runs the real cycle.

- [ ] ST-32 **Change History page** (decision 15; spec §6.11). Adds the `history` slug.
  - **The page** at `/settings/history`.
    - Filters: scope, store (deleted stores included, by `store_name`), and a search over settings.
    - Each row shows:
      - when, and who: You, Import, Migration, <Platform> sync, or System;
      - the scope and the setting's registry label (an unknown id is shown raw);
      - before → after, formatted by type, with secrets as "Replaced";
      - the state, with Retry for a failed apply.
  - **Link:** live store and ad actions are in Requests (`action_log`).
  - **Consumer:** ST-09's API.
  - **Done when:** tests are green: 200 rows page correctly, a deleted store's rows still show its name, and Retry
    appears only on failed applies.

- [ ] ST-33a **Advanced: environment and diagnostics** (decisions 2, 15; spec §6.12). Adds the `advanced` slug.
  - **Environment card:**
    - version and build;
    - the data dir and its source, the API port, the key location, the logs, the Codex work dir;
    - the environment variables from a fixed list of names (`FRONTLINE_DATA_DIR`, `API_PORT`,
      `FRONTLINE_AGENT_ENGINE`, `FRONTLINE_AGENT_MODEL`, `FRONTLINE_CODEX_WORK`, `FRONTLINE_KEY_SOURCE`,
      `FRONTLINE_WEB_DIR`, `PR_INGEST`, `FRONTLINE_VERSION`). The card's route never iterates `process.env`.
      `FRONTLINE_SECRET_KEY` shows only through ST-31's `keyLocation`, never as a value row, and its value is never read
      into a response.
  - **Also on the page:**
    - a connection-health summary, with links;
    - the API guard limits;
    - "Close to tray: always on.";
    - one line: "Frontline doesn't send or receive webhooks."
  - **Diagnostics export:** `GET /api/config/diagnostics`, downloaded as JSON.
  - **Done when:** tests are green: planted values never appear in the diagnostics file or the Environment card's
    response: a secret, an email, the home dir, the profile name, store names, a shop domain, an ad account id, a
    known `FRONTLINE_SECRET_KEY` (`vi.stubEnv`), the dev `<dataDir>/secret.key` bytes (base64 and hex), and an
    unrelated planted shell variable (`OPENAI_API_KEY=planted-…`).

- [ ] ST-33b **Advanced: Start with Windows** (decision 2).
  - New desktop IPC `login:get` and `login:set` (`main.ts`, `preload.ts`). Installed app only; otherwise the row is
    disabled with the reason.
  - The get/set logic lives in an electron-free module that takes a stubbed `{isPackaged, getLoginItemSettings,
    setLoginItemSettings}`, with its own test (decision 1). `login:set` returns an error unless `app.isPackaged`.
  - **Consumer:** `main.ts` login item.
  - **Done when:** tests are green: the IPC is used only when `window.desktop` exists, and the disabled reason shows
    otherwise; with a stubbed `app` that isn't packaged, `setLoginItemSettings` is never called.

- [ ] ST-34 **Search, pinned settings and highlight** (spec §5, §7).
  - **Search** in the sidebar:
    - "/" focuses it; arrows, Enter and Esc work.
    - It searches registry labels, help text, synonyms and section names, on the client.
    - Each result shows its section and scope.
    - Selecting a result opens `settingsUrl` with the current store, scrolls to the row and highlights it for 2 s. With
      reduced motion there is no animation.
    - It indexes static text only, never values, secrets or another store's data.
  - **Pinned:** a pin on rows and sections, at most 6, personal, shown in a "Pinned" group at the top of the sidebar.
  - **Consumer:** the sidebar.
  - **Done when:** tests are green:
    - "budget" finds AI usage per day;
    - the whole flow works from the keyboard;
    - the highlight appears;
    - pins survive a reload;
    - a 7th pin is refused by the server.

- [ ] ST-35 **Section reset** (spec §5).
  - **"Reset this section…"** sits in each section's Advanced expander. It previews current → default for each changed
    setting, then asks to confirm.
  - **In store scope** the action is "Use workspace defaults for this section", which removes the overrides. It is
    offered only for entries with `inherits: 'workspace'` (on Knowledge, only Automatic saving; never the KB controls).
  - Both use their own dialog and wording, never the delete style. They apply only to registry settings with defaults.
  - **Consumer:** `/api/config` (`unset` and defaults).
  - **Done when:** tests are green: the preview equals what changes, a store reset removes overrides only, the store
    action is absent where no entry inherits, and change rows are written.

- [ ] ST-36 **Configuration export and import** (decision 15; spec §7).
  - **Routes:**
    - `GET /api/config/export` (everything, or `?store=`);
    - `POST /api/config/import/preview` → the diff;
    - `POST /api/config/import`, with the rows the owner selected and their versions.
  - **UI:** a card on Data & Backups that names the business information an export contains.
  - **Consumer:** the config writer.
  - **Done when:** tests are green:
    - planted secrets are not in the export;
    - an export → import round trip changes nothing;
    - locked, unknown and secret fields are rejected with reasons;
    - `settings.test.ts` asserts the exact safeguard id list of decision 15 carries the flag;
    - an import that unpauses automation, turns KB `autonomous` on and `approval` off, removes a blocked domain,
      lowers `retentionDays`, turns approvals notifications off and raises concurrency shows each of those rows
      unticked, while a non-safeguard row in the same import (`notifications.digestHour`) starts ticked;
    - a stale version gets 409;
    - a store is matched by id, or skipped with a reason.

### Integration behavior

- [ ] ST-37a **Integrations directory** (decision 11).
  - **The directory** (replaces the moved page):
    - grouped by purpose, with status pills from real data;
    - "Saved · not verified" for credentials never verified;
    - the Locked state, from a decrypt check on read;
    - "Needs reconnecting" for auth-class sync errors (its Reconnect or Replace buttons ship in ST-39), classified by a
      new `classifyError(kind, message)` in `config/` (`auth` \| `rate_limit` \| `timeout` \| `other`);
    - the issue badge.
  - **Done when:** tests are green:
    - Locked shows when the key changes;
    - an auth-class error shows "Needs reconnecting";
    - Higgsfield is never "Connected" without a check;
    - each group lists its kinds.

- [ ] ST-37b **Integration detail** (board A2; decision 11).
  - **Route** `/settings/integrations/:id`. `sync.ts` `notifyChange` takes the integration id from its caller (the `id`
    already in scope) and links to `settingsUrl('integrations', { id })`. If codex-hardening's CH-18 is still
    unticked, file the e2e Inbox line for this route (ST-02).
  - **The detail page:**
    - the breadcrumb and the pills;
    - the Connection card: non-secret fields read-only, and masked secrets with their saved date;
    - "What it can do", from a new shared `INTEGRATION_ABILITIES` built from the real writers (`onStore` and the ads
      writers);
    - "Used by", from `GET /api/integrations/:id/usage` (decision 1's store rule). Each category has a data source, and a category with no source
      is not shown:
      1. seats on that store whose type's tool list contains a tool that calls this integration's reader or writer,
         from a shared tool → integration-kind map tested against the tool registry;
      2. enabled automation rules on that store with metric triggers (ad-spend metrics for ad kinds);
      3. pending approvals whose kind routes to this writer (`onStore` / the ads writers);
      4. running runs given the Meta Ads MCP token (meta_ads only);
      5. synced row counts (orders, products, campaigns).
  - **Consumer:** the detail page.
  - **Done when:** tests are green:
    - every ability marked as needing approval maps to an existing writer and approval kind;
    - the tool → kind map covers every tool that calls a connector;
    - each usage count matches its fixture;
    - the sync notice links to the detail.

    A screenshot is compared with A2.

- [ ] ST-38a **Test connection: framework** (decision 11; spec §6.5).
  - **Server:**
    - `config/connection-test.ts` and `POST /api/integrations/:id/test` (decision 1's store rule). The module exports
      the test as a plain `testIntegration(db, key, id)` that the route wraps, with no import-time side effects, so
      ST-47's script can call it;
    - an appended migration: `tested_at`, `test_ok`, `test_ms`, `test_error_class`, `test_error` and
      `test_scopes_json` on `integrations` (bookkeeping: no version bump);
    - the test-result write and every bookkeeping write leave `integrations.updated_at` unchanged (it triggers a sync,
      `sync.ts` ~104);
    - the rate limit, kept in the route;
    - the per-kind endpoint allowlist and the fake-transport harness that fails on anything outside it or on a known
      write endpoint;
    - token refresh through the connector's own function, persisted through `updateSecrets`;
    - error classes from ST-37a's `classifyError` (auth errors mark "Needs reconnecting").
  - **UI:** Test connection with its last result, or the "not available" reason.
  - **Done when:** tests are green:
    - success, auth failure, timeout and the provider's rate limit on a fake kind;
    - our own 429 works;
    - a rotated token is persisted and the version is unchanged;
    - after `POST /api/integrations/:id/test`, `updated_at` is unchanged;
    - a test on a demo store calls no sync function, `switchToReal`, `takeCurrency` or `takeTimezone`, and leaves
      `demo=1` and the store fields unchanged;
    - the stored error never contains a secret.

- [ ] ST-38b **Test connection: store kinds** (Shopify, WooCommerce, Etsy, TikTok Shop, Amazon).
  - For each kind, confirm the request against the connector code and the provider's official docs, and record the
    request and the date checked under Notes. Shopify: `shop { name plan { displayName } }` and
    `currentAppInstallation { accessScopes { handle } }`, both read-only queries.
  - **Scopes:** the scopes read by the test are stored with the result. "What it can do" marks a write "Not available:
    the token lacks <scope>" (for example `write_products`), and ST-17's checklist gets "The platform token has the
    scopes approved writes need".
  - Kinds with no safe read-only request get "Test not available: <reason>".
  - **Done when:** fake-transport tests are green for each kind (success, auth failure, inside the allowlist), the
    scope-aware abilities and the checklist item.

- [ ] ST-38c **Test connection: ad and analytics kinds** (Meta Ads, Google Ads, TikTok Ads, GA4).
  - Same per-kind rule and Notes entries. Google Ads `googleAds:search` and GA4 `runReport` are read-only POSTs in the
    allowlist. The connectors are codex-hardening Phase E files: rebase first, add the test client beside their reads,
    and change no sync code.
  - **Done when:** fake-transport tests are green for each kind.

- [ ] ST-38d **Test connection: CJ, Higgsfield and the runtimes.**
  - CJ's test goes through the PR caps ledger (`pr_calls`; `call()` in `cj.ts` is a codex-hardening file: keep its
    reservation). Higgsfield gets a real read-only request, or "Test not available: <reason>". Claude and Codex use their
    existing checks.
  - Same Notes entries.
  - **Done when:** tests are green: the CJ test is logged in `pr_calls` and respects its caps; Higgsfield shows a real
    result or the reason.

- [ ] ST-39 **Replace, remove, reconnect, change connection and save warnings** (decision 11).
  - **Secrets:** Replace one secret at a time, and an explicit `remove: [field]` for optional fields.
  - **Reconnect** re-runs OAuth for the same row; it also appears on "Needs reconnecting".
  - **Change connection…** on the Connection card opens the moved ConnectForm prefilled and runs the preview before
    saving. ConnectForm's secret inputs carry `data-secret`, checked against the kind's fields (the section walk never
    opens this dialog).
  - **Save preview:** `POST /api/integrations/preview` reports the cursor reset, the counts `forgetPlatform` would
    delete, and an ad-account conflict.
  - **Go-live warning** on a demo store: real counts of what is wiped and which jobs turn on. `confirmGoLive: true` is
    required at the `PUT /api/integrations` route and at OAuth start; the pending sign-in keeps it, and finish refuses
    without it. `saveIntegration` is unchanged.
  - **Consumer:** `saveIntegration`, `oauth.ts`.
  - **Done when:** tests are green:
    - Replace keeps the other secrets;
    - Remove clears only the named optional field;
    - the preview counts are right, and Change connection shows them before saving;
    - saving to a demo store without the confirm → 400;
    - an OAuth start on a demo store without the confirm → 400 before any redirect; with it, the row is saved;
    - Reconnect on an existing google_ads, etsy or tiktok_shop row (fake transport): `finishOAuth` updates that row
      (same id, no second row), keeps the cursor and non-secret settings, replaces only the token fields and writes a
      "replaced" change row;
    - an exchange failure leaves the old secrets in place and shows the provider's error;
    - change rows say "replaced" or "removed";
    - ConnectForm renders `data-secret="<kind>.<field>"` on exactly the secret fields of each kind (jsdom).

- [ ] ST-40 **Disconnect** (decision 11; spec §6.5, §10).
  - **Impact:** `GET /api/integrations/:id/impact` (decision 1's store rule), from real data and decision 11's true
    sentences. For global kinds
    (CJ, Higgsfield) it lists the affected stores, PR sources, watches and pending approvals (draft-product approvals,
    the creative tool) from real counts.
  - **The delete:** `DELETE` with the version. A global disconnect requires typing the integration's name.
  - **Running runs:** stop the runs that received the Meta Ads MCP token. Track their ids where `toolEnv` resolves the
    external MCP server.
  - **Where to revoke:** text per kind, from official docs. A change row is written.
  - **Consumer:** `deleteIntegration`, the run manager.
  - **Done when:** tests are green:
    - the impact counts are right, for Meta and for CJ;
    - a CJ disconnect without the typed name → 400;
    - the Meta run is stopped and other runs are untouched;
    - synced rows stay;
    - the store stays live;
    - the `shop:<id>` row stays for reconnect detection;
    - after a Meta disconnect (fake transport), approving a pending `ads.set_budget` applies nothing, records it as not
      applied, and shows the failure. If the code does otherwise, the impact sentence says what really happens.

### Security and reliability

- [ ] ST-41 **Secrets sweep** (spec §6.5, §10).
  - Plant a distinctive secret for every integration kind, a known `FRONTLINE_SECRET_KEY` (`vi.stubEnv`) and the dev
    `<dataDir>/secret.key` bytes (base64 and hex).
  - Check every response, WebSocket message, log line and stored row for them, in one table-driven test:
    - `GET` config, integrations, detail, usage, impact, health, changes, checklist, export, diagnostics and the
      Environment card's route (ST-33a);
    - `POST /api/integrations/:id/test`, `POST /api/integrations/preview`, the import preview and import routes, OAuth
      start and finish, `GET /api/notifications` (sync error bodies);
    - the `settings_changes` rows;
    - the WebSocket messages sent during save, replace, test, failure and disconnect;
    - `api.log` after each of those.
  - Fix any leak in the same item.
  - **Done when:** the sweep is green and its file is named in Done.

- [ ] ST-42 **Policy, scope and guard sweep** (decisions 4, 5; spec §10).
  - **The rule:** decision 1's store rule. Fix any route that fails it in this item.
  - One table-driven test over every new and changed route:
    - a non-local Host gets 403, and a foreign Origin gets 403;
    - the rule above;
    - a locked policy can't be changed through the config API, an import or a store override (400);
    - autopilot, KB autonomous and an automation set to "auto" never let a `store.*` or publish action through without
      an approval;
    - a trusted domain can't fetch a blocked one;
    - no agent tool can write a setting (the tool list has no config writer).
  - **Agent cases:** for each knowledge-scope value, with store B's overrides set, a store-A run's retrieval, prompt and
    caps contain nothing from store B. An import of a store-A export into store B is skipped.
  - **Done when:** the sweep is green.

- [ ] ST-43 **Concurrency, atomicity and restart sweep** (spec §9).
  - The test covers:
    - two clients per owner document → 409, with nothing overwritten;
    - a fault injected into the second document of a two-document save → nothing written;
    - an apply job killed mid-way → it resumes after a restart;
    - every registry entry round-trips through boot on a file database;
    - each section refetches what it saved (query invalidation).
  - **Done when:** the sweep is green.

### Verification

- [ ] ST-44 **End-to-end paths** (spec §8). Each path runs through the HTTP API on a file database with the scripted
  engine. Each test goes control → validation → persistence → effective configuration → behaviour → observable result:
  - research destination → the next PR task;
  - model default → the next conversation and the next automation run;
  - automatic capture off → an approval instead of a card;
  - pause → no scheduled run, with an active run still shown as running;
  - autopilot rule off → a running agent's next ad change asks;
  - Meta Ads disconnected → its running run stops;
  - workspace timezone → the next run moves;
  - cap lowered → a running run stops at its next step.

  **Done when:** all eight are green in one test file.

- [ ] ST-45 **Usability and scale** (spec §11 usability).
  - **jsdom:**
    - 25 stores in the scope switch, 200 history rows, 11 integrations;
    - 60-character store names and labels;
    - a fake 500 error state on every section;
    - a keyboard-only path: sidebar → section → row → save → conflict.
  - **Screenshots** with CDP at 390×844, 1024×680, 1366×728, 1440×900 and 1920×1080, plus the Orca browser at
    1280×800, with no console errors (dir (a)). At 390×844 no page scrolls sideways.
  - **e2e:** if codex-hardening's Phase D is done or it has `.agent/STOP`, add the settings routes to the route smoke
    (`e2e/**`, settings routes only). Never add axe baseline entries for settings routes: fix the findings instead.
  - **Done when:** the tests are green, the screenshots are in `.agent/st45/`, and if `pnpm e2e` exists on main it is
    green on `/settings/*` and `/integrations` (a failure on another lane's route is filed to that lane's Inbox and
    listed in the report, not fixed here).

- [ ] ST-46 **Design pass.** Compare every section and the detail page with both boards at the six sizes of ST-45. Run
  `styleseed-design-review`, and fix or answer each finding under Notes.

- [ ] ST-47 **Live checks** (decision 18).
  - In dir (a): back up, change a setting, restore (restart the API yourself), see it rolled back, then restore the
    before-restore backup.
  - In dir (c), with `automation.paused` on: one real Claude run in a conversation set to Claude on a demo store, with a
    changed default model, then check `agent_runs.actual_model`.
  - In dir (b), with no server and no setting changes: run `.agent/live-test.mts` (decision 18 (b)) for each
    integration the owner entered. Test only (decision 18's hard rules).
  - Record each under Notes with its time and result, in decision 18's public-safe form, including each pause and
    unpause. Whatever the owner hasn't provided stays under Blocked.

- [ ] ST-48 **Acceptance.**
  - Walk "Done when" line by line, and fix what it finds. The coverage allowlist is empty and no `data-legacy` is
    left.
  - Do the full click-through in dir (a) with `FRONTLINE_AGENT_ENGINE=fake`, plus the runtime-rows click-through
    without the override, logins untouched and Set up Codex not clicked (decision 18 (a)).
  - If `pnpm e2e` exists on main, it is green on `/settings/*` and `/integrations` (Done when).
  - Rerun the checks after every fix.

- [ ] ST-49 **Final report and STOP.**
  - Write `docs/features/settings-report.md`, with screenshots in `docs/reference/settings-final/`.
  - Update the Settings item in `docs/DESIGN.md` and the nav subtitle.
  - Then create `.agent/STOP`.

## Done
- 2026-10-28 ST-01 set-up files present; baseline `pnpm check` green at 65531883: 234 test files, 1730 tests, 86 s (typecheck + vitest). `.agent/` tools copied, before shots in `.agent/before/` (dir (a), demo only). Code map: Corrections and Registry plan appended. No decision changed.
- 2026-10-28 ST-02 `/settings/<section>` frame (Hero, 248 px sidebar, 860 px column, section select below 900 px), `settingsUrl` in shared, `/integrations` → `/settings/integrations` (query kept), Integrations page moved to `settings/integrations/`, today's panels moved into account/general/notifications/stores/usage/data behind `data-legacy`, every web and server link rebuilt with `settingsUrl`. `pnpm check` green (234 files, 1748 tests; first run timed out only in the Research scale test, rerun with `VITEST_MAX_WORKERS=4`). `pnpm e2e --grep settings|integrations`: route smoke 8/8 green at 390–1920 px; both axe compares fail only on CRLF line endings (Notes). Shots: `.agent/st02-1280.png`, 390×844 overflow 0.
- 2026-10-28 ST-03 `settings/kit.tsx` (SettingsSection with Advanced expander, SettingRow, OriginLine, ScopeSwitch with a keyboard store listbox, SaveBar with saving/saved/applying/applied/error, ImmediateRow, DangerZone), `settings/useDraft.ts` (one draft per section and scope), opt-in `flatButtonClass` in `ui.tsx`, DevGallery entries; `kit.test.tsx` 18 green. DevGallery shot `.agent/st03-kit-1440x2400.png` matches board A1's rows, origin lines, save bar and danger card.
- 2026-10-28 ST-04 data routers (`main.tsx` `createBrowserRouter`, `renderApp` `createMemoryRouter`, one splat route each; whole web suite green unchanged, 100 files / 538 tests), `api()` errors carry `status`, `code`, `current`, and `settings/form.tsx` `useSettingsForm`: draft + versioned save, Save / Discard / Stay on links, back and store switches (`useBlocker`), `beforeunload` only without `window.desktop`, the 409 dialog (Reload / Keep mine, silent re-apply once when none of my fields changed). `form.test.tsx` 12 green. Route and flow e2e 66 passed; the 2 failures are CH-18's known +46 px at 390 on legacy agent and conversation, same on main's router.
- 2026-10-28 ST-05 migration 57 (DDL only: `version` on the seven owner tables, `updated_at` on `settings`, `store_caps`, `stores`, `automation_rules`, `settings_changes` with `(at)` and `(store_id, at)` indexes), `config/boot.ts` `bootConfig` from `index.ts` (fill-if-absent under `once()` in one transaction; each filled key is a `migration` change row). `db.test.ts`: the decision 7 upgrade test (`store_caps` rows and every effective value unchanged, `user_version` current, FK check clean, a second boot changes nothing) and fill-never-overwrites, green. Dir (a) upgraded 56→57 with its before-update copy; workspace = machine zone + today's cap defaults.
- 2026-10-28 ST-06 `SETTINGS` registry + `validateSetting` in `packages/shared/src/settings.ts`: 44 entries (profile name, 5 notification flags, base currency, 3 caps, 2 autopilot kinds, 8 store fields, 12 KB controls, 7 research-profile fields, 3 locked policies), each with owner, consumers and a proof test. `settings.test.ts` (149: every consumer symbol and proof test found, entry shape, inherits, no secrets, locked, enums match the app's lists, validator cases) and `settings/coverage.test.tsx` (the jsdom walk over all 7 sections, allowlist of 41 ids; a removed `data-legacy` wrapper fails it). New proofs: `notifications.approvals`/`agentDone` (server) and the Hero chip name (web). Store-analytics Inbox line filed.
- 2026-10-28 ST-07 `config/effective.ts` (store → workspace → default, `inherits: 'none'` never falls back, locked policies shown as `locked`, versions per document, 0 without a row), `config/write.ts` (one transaction for every document; version check in the UPDATE; registry, scope and locked checks with `{error, field}`; `unset`; change rows with before/after, scope and store), `GET`/`PATCH /api/config` behind the guard. `updateSettings`/`updateCaps` go through the writer (trusted: their own validation and messages stay) and set only the keys sent; `PATCH /api/settings` and `PUT /api/caps/:id` answer 428 without a version, 409 `stale`/`exists` with the current document; `getCaps` reads the effective caps; boot fills the cap defaults from the registry (`DEFAULT_CAPS` removed). Web: `version` required in `SettingsUpdate`/`StoreCapsUpdate`, the legacy forms send it, `CapsForm` sends only changed keys. `config/config.test.ts` (8 tests) covers every Done-when line; caller tests updated (`settings.test.ts`, `agents-missions.test.ts`, `db.test.ts`'s pre-upgrade baseline, web `Settings.test.tsx`). Dir (a): `GET /api/config?store=pawsome` shows `caps.*` as `workspace`, notifications `default`, policies `locked`; a `PUT /api/caps/pawsome` without a version got 428, with version 0 it created the row and `caps.agentCostPerDay` reads `store`.
- 2026-10-28 ST-08a stores carry `version` (GET, list, create); `PATCH /api/stores/:id` answers 428 without it and 409 `stale` with the current store; `updateStore` checks it, bumps once per save and writes an `owner` change row per moved field (`store.<key>`); `parseStoreInput` 400s carry `field`. `setStoreCurrency` takes the actor (`takeCurrency` passes `sync:<kind>`, Amazon's direct call logs `system`, the owner's save passes null and logs it with the rest), `takeTimezone` logs `sync:<kind>`; status, cursor and `connected` writes move nothing. Web: `useStoreActions().save` requires `version` with an `id`, `StoreForm` sends it. `config/stores.test.ts` (3 tests: stale/428/create, `field`, a fake Shopify sync's two `sync:shopify` rows and a no-change resync), `stores.test.ts` sends the version it reads, `StoreForm.test.tsx` pins edit vs create.
- 2026-10-28 ST-08b `PUT /api/kb/controls` and `PUT /api/pr/profile` require the version (428 without, 409 `exists`/`stale` with the current controls or profile); their GETs carry it (0 without a row). `saveControls` updates in place with `version = version + 1 … AND version = ?` and inserts only when no row exists (no more delete-and-insert); `saveProfile`'s upsert bumps it. Both write `owner` change rows (`kb.<control>` with scope store or workspace for General, `pr.<field>`); `parseControls` and `saveProfile` 400s carry `field`. Shared `versionOf`/`NO_VERSION` in `config/write.ts`, used by every versioned route. Web: `useSaveKbControls` and `useSaveProfile` require `version`; `Controls.tsx`, `ProfileDialog` and the Research ship-to switch send it. `config/owners.test.ts` (2 tests: the KB double save on one read → 409, stale, 428, `field`, change rows; the same for the profile); caller tests send the version they read (`kb/{autonomy,maintenance}`, `product-research/{discovery,evaluate,pipeline}`, web `Controls`, `Research`).
- 2026-10-28 ST-08c automation rules and integrations carry `version`. `PATCH /api/automations/:id` and `PUT /api/integrations` answer 428 without it and 409 `stale`/`exists` with the current rule or connection; `POST /api/automations` is exempt, a new connection sends 0, and a version above 0 for a disconnected row is 409 `stale` with `current: null` and recreates nothing. `parseRule` and `putIntegration` (new; `saveIntegration` is its in-process string wrapper) return `field`. Change rows: `automation.<field>` (detail: the rule's name), `<kind>.<field>` for connections, a secret's saying only `replaced` or `removed` (also on disconnect). `enableDefaultJobs`, the task rewrite and the job-gates pass bump the version and log `system`; `updateSecrets`, status, cursor and timestamp writes move nothing. `config/sweep.test.ts` checks every write to the six owner tables and the `app`/`workspace`/`personal` settings keys. Web: `useAutomationActions().save`/`.toggle` and `useIntegrationActions().save` require `version`. 400 `field`s for stores, KB controls and research profiles corrected to registry ids (`store.currency`, `kb.<key>`, `pr.<key>`). Tests: `config/records.test.ts` 3, `config/sweep.test.ts` 2 (a mutation that drops the job-gates bump fails it), Automation page toggle sends the version.
- 2026-10-28 ST-09 `config/changes.ts`: `GET /api/config/changes?store=&setting=&scope=&request=&cursor=`, newest first (within one save, last write first), 50 a page, `next` as the cursor; shared `ConfigChange`, `ChangeState`, `ConfigChangesPage`. `config/apply.ts`: `JOBS` (setting id → job, empty until ST-16 and ST-28), `logChanges` writes a job's row `applying` and runs it once the write commits, one run per row at a time; `applied`, or `failed` with the reason in `detail`; `resumeJobs` at boot (`index.ts`); `POST /api/config/changes/:id/retry` (store rule: a store row needs `?store=`, 400 without, 404 for another store; 202 started, 200 already applying or applied, 409 a row with no job). Each state change publishes `config_change` on the live socket. `PATCH /api/config` returns the rows it wrote (`changes`); the guard now covers `/api/config/*`. Web: `useLive` moves a save's rows, `useSaveChanges` (in `client.ts`) follows them, `useSettingsForm` drives the bar to Saved · applying…, Saved · applied, or Saved · couldn't apply with the reason and Retry (`SaveBar` `failed` state, `onRetry`). Tests: `config/changes.test.ts` 4 (no secret value in any row; restart resumes and runs once, which a mutation dropping the per-row guard fails; two retries run once; store rule), `settings/apply.test.tsx` 2 (jsdom, fake socket).
- 2026-10-28 ST-10 `POST /api/config/impact` (same body as the PATCH, version not required, writes nothing; 404 for an unknown store) returns `{impacts: ConfigImpact[]}` from `config/impact.ts`, one function list per setting (`IMPACTS`). Ships the cap impacts: a lowered `caps.agentCostPerDay` (set, or unset back to a lower workspace value) names the running runs on each store it reaches ("1 running run on Glow Haus stops at its next step if it goes over"; none, no sentence), and a workspace write of any cap counts the stores that take the default and those with their own value. The PATCH and the preview share one body check. `config/impact.test.ts` green: every count equals the fixture's own query, raised caps and finished runs earn nothing, and nothing is written. Dir (a) dev server, demo engine: with one Creative Studio run waiting on its approval, a workspace `caps.agentCostPerDay` 5 → 1 preview said 1 running run on Glow Haus and 2 stores on the default, 1 with its own; the database read the same (1 running on glow; 3 stores, Pawsome's own cap 3). The run was then cancelled.
- 2026-10-28 ST-11 the workspace timezone drives every schedule and "today": `machineZone`, `utcOffset`, `localDate`, `midnight` and a new `startOfDay(zone, now)` live in `packages/shared/src/dates.ts` (the server's `dates.ts` re-exports them), and `workspaceZone(db)` reads `workspace.timezone`, the machine zone when the row or the key is absent. `cronMatches`, `nextCronTime` and `cronDueBetween` take a zone. The scheduler tick, the `maxRunsPerDay` midnight, the digest's 8:00, `costToday` (and so the run start refusal), `creditsToday`, `budgetAddedToday` and `autopilotUsedToday` use it, and `nextRunAt` comes with `nextRunZone`. Codex-hardening's reservations are unchanged: only the midnight moved. `config/timezone.test.ts` green on a New York machine against Tokyo, Berlin, Kolkata and Chicago workspaces: the machine zone with no row or key; 9:00 Tokyo fires then, not at 9:00 New York; a 2:30 rule runs once on both Berlin DST nights; every counter starts at Tokyo's midnight (New York's counts more); the digest goes out at 8:00 Tokyo; a 9:00 rule moved Tokyo → Kolkata runs once that day, and `maxRunsPerDay` 1 skips the next time after the switch; an hourly rule runs all 25 hours of Chicago's fall-back day. 11 mutations (each zone use, the slot guard, the hourly exemption, the DST checks) each fail a test. The existing cron, automation, digest and usage tests pass unchanged. CH-05's Inbox lines here and in `core.md` are ticked.
- 2026-10-29 ST-12 Settings → Account (`settings/sections/Account.tsx`), the first section on `useSettingsForm`: Display name (explicit save through `PATCH /api/settings` with the version read; a 409's `current` is mapped to the form's fields for the conflict dialog), the computer's timezone line, the one-owner line and English only. The chip says Owner: no "Pro Plan" anywhere in the UI (the field stays in shared and the server default). A refused name is `{error: 'Your display name must be 1–40 characters.', field: 'profile.name'}` and shows under the row. The legacy panel, its wrapper, its two `pages/Settings.test.tsx` tests and `profile.name`'s allowlist entry are gone; the coverage walk skips `<dialog>` (the form's own prompts). `sections/Account.test.tsx` and `settings.test.ts` green: a rename persists across a fresh load and shows on the chip; 41 characters is refused and changes nothing, 40 saves; no settings section renders "Pro Plan" and no web source reads the plan (fails with the plan back on the chip). Dir (a) dev server, headless Chrome: renamed to Sam Rivera (chip and server v3), a blank name refused under the row with the server unchanged, renamed back to Cody (v4), no console errors.
- 2026-10-29 ST-13 Settings → Appearance (`settings/sections/Appearance.tsx`, the `appearance` slug): Motion, "Follow Windows | Always reduce", applies right away through `PATCH /api/config` (`personal` row, registry entry `appearance.motion`, `system` by default), and the read-only Dark theme only, contrast and AI Ecosystem lines (with the link). `settings/motion.ts`: the Shell's `useMotion()` keeps `<html data-motion="reduce">` on the saved value, so it follows only what the server confirmed (also at start); `index.css` repeats its reduced-motion rule under the attribute; `ecosystem/renderer.ts` reads `reducedMotion(matchMedia(…))`, a getter it already reads every frame. New web hooks `useConfig` / `useSaveConfig` (GET / PATCH `/api/config`). `sections/Appearance.test.tsx` green: with the server's answer held, the attribute stays off until it answers; a 409 leaves it and shows why; Follow Windows clears it; a reload sets it from the server; every reduced-motion rule in `index.css` has its attribute copy (file test); the renderer's getter follows the attribute and the media query. 5 mutations (set early, no Shell hook, CSS copy, renderer, getter) each fail. Dir (a) dev server, headless Chrome: Always reduce saved (personal v4), `<html data-motion="reduce">`, a Segmented option's computed transition 0.15s → 0s, Follow Windows back (v5, 0.15s); `fast` refused 400 with `field: appearance.motion`; 390 px no overflow, no console errors.
- 2026-10-29 ST-14a `notify()` (settings.ts): categories (`CATEGORY`, `{category}` for one its kind doesn't name: the digest), muted stores (info always shows), dedupe of an identical unread notification within 10 minutes (never approvals), and `toast` on every notification: false when the category's Windows toast is off or in quiet hours (whole hours, across midnight, the workspace zone; `toastBlock`). Registry: `notifications.toasts.<category>` (5), `notifications.quietHours` `{from, to}`, `notifications.mutedStores` (allowlisted for ST-14b). Shared `NOTIFICATION_CATEGORIES`, `AppNotification.toast`. Desktop `toast.ts` `shouldToast(n, focused)`, used by `main.ts`. `POST /api/notifications/test {category}` (guarded) sends one info notification through the toast rules and answers `{bell: 'Bell: added', toast: 'Windows toast: requested' | 'Windows toast: not sent (…)'}`. `config/notifications.test.ts` and `desktop/toast.test.ts` green (category off, muted store, toast off, quiet hours at 23:30 and 06:59 Tokyo on a New York machine, dedupe at 9 and 11 minutes and after a read, two same approvals, the digest's own switch, every test reply, a 400 naming `category`); 11 mutations each fail. Dir (a): Send test for errors → Bell: added, Windows toast: requested, the row in `GET /api/notifications`; with that toast off → not sent (toasts off for Errors), restored after; another origin → 403.
- 2026-10-29 ST-14b Settings → Notifications (`settings/sections/Notifications.tsx`, replacing the legacy panel): per category a Bell and a Windows toast switch, with help text that names what each kind's `notify()` callers send and what Off does; quiet hours (two whole-hour selects); the stores to notify about (ticks over `notifications.mutedStores`); one explicit save through `PATCH /api/config`. **Send a test** (`data-action="notifications.test"`) shows the server's report, plus "Windows toasts only appear in the installed desktop app" without `window.desktop`. The bell has a "Notification settings" link that also closes the drawer when already on that page. Seven ids leave the coverage allowlist. `Notifications.test.tsx` green (each row's help, a save sending only the 4 changed settings over the version read, the test wording in both builds, the bell link); 7 mutations each fail. Dir (a) through the real UI: quiet hours on → saved `{from: 22, to: 7}` v9; Send test → "Bell: added · Windows toast: not sent (quiet hours until 07:00)" with the browser note; quiet hours off → null v10; the test notification in the bell; its link lands on /settings/notifications with the drawer shut; no console errors, no overflow at 1440 and 390.

## Blocked
<!-- Keep these until the owner's input arrives, then move them to Done. Each says exactly what the owner does. -->
- **A real connection for the live test (owner, optional):**
  - Only after ST-01 is under Done. In a new PowerShell window, run
    `cd C:\Users\Xody2\orca\workspaces\FrontlineEcom\settings`, then
    `$env:FRONTLINE_AGENT_ENGINE='fake'; $env:FRONTLINE_DATA_DIR='C:\Users\Xody2\orca\workspaces\FrontlineEcom\settings\.agent\owner-data'; $env:WEB_PORT='5259'; $env:API_PORT='8879'; pnpm dev`.
    Then open http://localhost:5259/settings/integrations (before ST-02 ships, /integrations). You must set both
    ports in your own shell, because they exist only in the worker's environment (5253/8867 are the worker's demo
    dirs). If the terminal says a port is in use or shows EADDRINUSE, stop there and don't try another address. The
    fake engine keeps scheduled jobs off your Claude usage.
  - Enter one credential:
    - **recommended:** CJ Dropshipping's API key (Integrations → CJ Dropshipping). Frontline only reads with it (order
      status and the catalog) and it takes no store live;
    - or a **Shopify development store** app released with read scopes only (read_products, read_inventory,
      read_orders, read_all_orders; no write_* scopes): enter its shop domain, client ID and client secret. It takes
      that dev store live in this test database only.
    - Use a credential your installed Frontline app doesn't also hold. Never a production shop or ad account.
  - When you're done, press Ctrl+C (answer Y if asked to terminate the batch job) and close the window. The worker
    checks for the credential at its next item with a read-only query.
  - **What the worker will do with it:** run the read-only connection test once per integration from a script; no
    server is started on that database, so nothing syncs. **What it won't:** approve any request, enable autopilot,
    save or sync the integration again, disconnect it, or restore or delete that database.
  - Needed for ST-47's live test-connection check. Without it, that line stays here, and every kind is reported as
    tested with fakes only.

## Notes
- **ST-02:** Settings uses the compact Hero (the board's 52 px title strip). At 390 px the compact strip clips the title
  ("SETTI…") beside the Ask/bell/profile controls, the same as AI Agents' compact strip today; ST-46 looks at it. The
  section title is the h2 under the Hero's h1. The Hero names the lit app-nav item: "Integrations" on
  `/settings/integrations`, "Settings" elsewhere (the e2e route smoke expects that h1).
- **e2e (2026-10-28):** `pnpm e2e` exists. On this worktree (`core.autocrlf=true`) every axe snapshot compare fails on
  line endings alone (untouched `/orders` too); filed to codex-hardening's Inbox with the `.gitattributes` fix. The
  renamed `settings-integrations` snapshot has the same single shared-Hero finding as `integrations.json`; the rename and
  the new section routes are filed to codex-hardening (CH-18 is unticked), not committed here.
  `e2e/setup.ts` makes its data dir under `os.tmpdir()`: run it with `TEMP`/`TMP` set to `.agent/tmp` so that dir is
  under `.agent/` (decision 18).
- **ST-05 document shape:** the `workspace` and `personal` rows of `settings` hold flat registry ids
  (`{"timezone": …, "caps.agentCostPerDay": 5}`); `app` and `store_caps` keep their existing shapes, so ST-07's writer
  maps `caps.<key>` to the `store_caps` key. Boot fills don't move `version` (not an owner edit).
- **ST-06 registry, left for the item that renders the row** (consumer or proof missing today): `store.color` (web-only
  consumer, no proof) → ST-18; Start with Windows (no desktop test) → ST-33b; `pr.priceMin` (no consumer),
  `pr.avoidCategories` and `pr.avoidTerms` (no stored-value proof) → ST-27. `pr.priceCurrency` is read-only, not an entry.
- **ST-06 findings for later items:** `updateCaps` accepts any autopilot kind matching `[a-z0-9_.]` though only the two
  `APPROVAL_KINDS` with `autopilot: true` can fire (ST-30); the digest flag is checked only by `startDigestLoop`, not
  `notify()` (the digest is kind `info`); `baseCurrency` accepts lower case and upper-cases it, store `currency` refuses
  lower case; a manual currency change on a connected store is reset by the next sync's `takeCurrency` (ST-18 shows it
  read-only); a fee of 0 reads as "not set" in product-research economics.
- **ST-04 for every later section:** build an explicit-save section on `useSettingsForm` (`settings/form.tsx`) and
  render its `dialogs`. React Router allows one `useBlocker` at a time, so one form per section; a section with two
  documents saves them in one `PATCH /api/config` (decision 6), not two forms.
- **ST-01 decision check (65531883):** no decision changed. Code between cc80fbac and HEAD touched only Codex tests and one `codex.ts` line. One precision for decision 2/12: `approvals.ts` links an approval to `/`, except a `question`, which links to its conversation; ST-02/ST-14 keep that. `pnpm e2e` exists on main (codex-hardening CH-17/18), so ST-02 runs it before pushing.
- **Seen in passing, not this lane's to fix:** the `startScheduler` docstring says catch-up goes 24 h back, but the
  code uses 31 days.
- **Left machine-local on purpose (decision 8):** connectors' "today" (Shopify, Woo, Etsy, TikTok Shop), the
  competitor watch and the catalog pass.
- **Ideas for later (the owner's call, not items):**
  - store archive;
  - backing up `knowledge/` and `packs/niche/` alongside the database;
  - a business-data export;
  - keeping onboarding and filters server-side, so a port change can't reset them.
- **ST-07:** the `app` row keeps personal keys (`profile.*`, `notifications.*`) and the workspace key `baseCurrency`
  under one version, so a stale name save also refuses a currency save made from the same read; change rows take each
  entry's own scope. A version-0 write against a row that exists answers 409 `exists` (a fresh read is needed), a
  positive version against a missing row 409 `stale` with `current: null` (never recreated silently). No registry entry
  lives in the `personal` row yet; the tests write it with a synthetic id. `updateCaps` stays trusted, so the
  any-autopilot-kind finding above still holds until ST-30.
- **ST-08a:** a store 400's `field` is the registry id (`store.currency`), as decision 6 says (ST-08c corrected the
  body key ST-08a first sent); the change row's `setting` is the same id. `createStore` now returns the saved row (with its
  version). Finding for ST-18: `StoreForm` drops a blank niche detail and `parseStoreInput` refuses an empty one, so a
  saved niche detail can't be cleared today.
- **ST-08b:** the KB route parses first and then checks the version; the profile route checks the version first,
  because `saveProfile` validates and writes in one call. Both bump the version on every accepted save, even one that
  changes nothing (no change row then). In-process `saveControls` callers (ST-25's category cleanup) pass no version.
  Caller tests that pinned a 400 body exactly now match `{ error }` (the body also has `field`).
- **ST-08c:**
  - `field` follows decision 6: a registry id where an entry exists (`store.*`, `kb.*`, `pr.*`); for automation rules
    and connections, which have no entries, the body key (`approval`, `trigger`) or the integration field (`apiKey`). An
    ad account another store holds names its account field. Shopify's "client ID and secret, or a token" has none.
  - A connection's version moves only when a setting or a secret changes: a re-save that changes nothing keeps it, so a
    form left open stays valid. `putIntegration` checks the body before the version, so a bad body still gets its 400.
  - The sweep has a fourth list the item didn't name, `VIA_STORE_CHANGED`: the store writers (`updateStore`,
    `setStoreCurrency`, `setStoreTimezone`) set their column and `storeChanged` moves the version in the same
    transaction, once per save, not in the same statement. Bumping in each statement would move it two or three times
    for one save. `encrypted_credentials` is bookkeeping (token rotation); the owner's own secret edits go through
    `putIntegration`'s upsert, which bumps. The sweep reads string literals that start with the statement; SQL built
    another way isn't seen (a `ponytail:` note in the test says so).
  - `deleteIntegration` takes the key (optional) to write the `removed` rows; ST-40 adds the version on DELETE.
- **ST-09:**
  - Which settings have a job is `JOBS` in `config/apply.ts`, not the registry's `applies: 'job'` (that drives the copy).
    Until ST-16 and ST-28 add their jobs, `baseCurrency`, `store.currency` and `store.niche` rows are `saved`: an
    `applying` row with no job would only ever fail. ST-16/ST-28 add their entry there; a test that every `applies: 'job'`
    entry has one belongs with the second of them.
  - Only `PATCH /api/config` returns its rows so far. ST-28 adds `changes` to `PATCH /api/stores/:id` for currency and
    niche, so the store form's bar follows its job.
  - The bar polls a save's rows every 2 s while one applies, even with the socket up: a socket message can beat the save's
    own answer. Jobs are rare (a currency or niche change).
  - A failed row's `detail` holds the reason (job rows have no other detail); Retry clears it.
- **ST-10:** the running-runs sentence is only for `caps.agentCostPerDay`, the one cap a running run re-reads at each
  step (`runs.ts`, `spend`). The ad-spend and Higgsfield caps are checked at the next tool call, which refuses the call
  but doesn't stop the run, so they get the stores sentence only. A run paused on an approval is `running` and counts.
  The web call (the save bar's impact slot) comes with the limits cards that save caps (ST-23, then ST-24b).
- **ST-11:** a zone switch west brings a day's times round again. A schedule rule with fixed hours runs at most as many
  times a zone day as it has times (`0 9 * * *`: once), counting every run log since the zone's midnight (skipped and
  failed too). Hourly rules (`*` hours) aren't held to that, so the 25 real hours of a fall-back day all run, as
  `cron.ts` already had them. A switch east starts a new zone day sooner, so that day's time runs.
  `workspaceZone(db)` lives in `packages/agents/src/squads.ts` (the agents can't import the server), and the server
  imports it from `@frontline/agents`. The zoned cron clock caches the zone's offset per UTC quarter hour: a full
  8-day `nextRunAt` scan measured 5.7 ms per rule against 4.0 ms on the machine clock.
- **ST-12:** a section that saves through an old route maps that route's 409 `current` into its form's fields in its
  `save` (Account: `Settings` → `{version, 'profile.name'}`); the conflict dialog compares field by field. `versioned`
  in `settings.ts` answers a write's `{error, field}` with a 400 as it is. Only the name's refusal has a `field` so far:
  `updateCaps` still refuses with the bare key (`agentCostPerDay must be …`), for ST-24b to give `field:
  'caps.agentCostPerDay'` when its rows render. The coverage walk skips `<dialog>` content: every explicit-save section
  renders the form's leave and conflict dialogs, closed, in the page.
- **ST-13:** `index.css`'s reduced-motion rule is global (`*, ::before, ::after` with `!important`), so its attribute
  copy also stills the Tailwind `motion-reduce:` transitions in the Knowledge Base and `ecosystem.css`'s minimap
  transition; they need no copy of their own. The renderer listens by reading: it already reads `reduced.matches` on
  every frame (camera blend, workers, still parts), so the getter picks up a change on the next frame. The live check
  covered the CSS; the renderer's frame loop was not run headless (WebGL), only its getter in jsdom. Immediate rows
  save with `useSaveConfig` and show the server's state; the option clicked shows while saving.
- **ST-14a:** decisions 3, 5 and 15 name `notifications.stores`; it is `notifications.mutedStores`, the stores
  unticked (default `[]`), so a store added later is notified about by default. Holding the ticked list instead would
  silently drop a new store's approvals until the owner ticked it. Quiet hours are whole hours (`{from, to}`, 0–23, to
  exclusive; equal hours mean none), like the digest hour. `getSettings` doesn't fill the three new keys (the ST-05
  upgrade test pins its shape); `notify` reads them optionally and the UI reads defaults from `GET /api/config`. The
  test notification skips the category-off and muted-store drops and the dedupe (two tests in a row both land), never
  the toast rules. `toast` isn't stored: it travels on the live message the desktop app reads.
