# Settings — configuration audit (Stage One)

Audit of every piece of configuration Frontline Ecom has today, done 2026-10-28 against `origin/main` before the Settings
redesign. Paths are repo-relative; line numbers drift, so search for the named symbol. "Doesn't exist" is stated plainly.

## Ground truth that shapes the redesign

- **One owner, no accounts.** No users, auth, sessions, roles, memberships or invites. Protection is the localhost-only
  middleware (`apps/server/src/app.ts`: Host must be 127.0.0.1/localhost/[::1], same-origin, binds 127.0.0.1) plus
  per-store data scoping (`routes/agents-scope.ts` `wrongStore` → 404). "Team & Access" has no foundation.
- **Last write wins everywhere.** No version numbers, ETags or `updated_at` checks on any config write. Only state guards
  exist (approve only from `pending` → 409; conversation config change refused while running; `clientRequestId` idempotency).
- **No settings change history.** `action_log` records live-store/ad writes only (no FK, survives store delete).
- **Machine-local time** drives cron, the 8:00 digest, daily caps' midnight and autopilot "today". Store timezone only
  drives analytics, metric windows, connectors and prompts. There is no app/owner timezone setting.
- **Secrets are already write-only.** AES-256-GCM (`apps/server/src/secrets.ts`), row id as AAD, key in
  `<dataDir>/secret.key` (desktop: safeStorage `secret.key.enc`). The API returns `secretsSet` key names only.

## Inventory

### App settings — `settings` table, key `app` (`apps/server/src/settings.ts`)
- Fields: `profile {name, plan}`, `notifications {approvals, agentDone, errors, digest, researchAlerts}`, `baseCurrency`;
  `dataDir` read-only. Types `Settings`/`SettingsUpdate` (`packages/shared`).
- Routes: `GET`/`PATCH /api/settings` (deep merge, unknown keys rejected), `POST /api/settings/open-data-folder`.
- Consumers: `baseCurrency` → `fx.ts` multi-store totals, Product Research `discovery.ts`/`facts.ts`. `notifications.*` →
  `notify()` drops disabled kinds (`info` can't be disabled); `digest` → `digest.ts`. `profile.name/plan` → labels only
  (Hero chip, Settings); nothing enforces a plan. Desktop toasts mirror the bell (no own toggle).
- Same table also holds internal state (not settings): `fx`, `digest_sent`, `competitor_watch`, `shop:<id>`,
  `restore_closed`, connector cursors.

### Stores — `stores` table (`apps/server/src/stores.ts`, `db.ts`)
- Config columns: name, platform, niche, niche_detail, currency, timezone, color, fee_percent, fee_per_order;
  `connected`/`demo` not writable. Routes `GET/POST/PATCH/DELETE /api/stores[/:id]`.
- Side effects: timezone change re-dates a real store's orders + rebuilds revenue; currency change clears fx, resets
  cursors, zeroes campaign budgets, expires pending money requests. **Platform sync overwrites owner-edited currency and
  timezone** (`connectors/common.ts` `takeCurrency`/`takeTimezone`).
- Delete cancels runs then cascades every store-scoped table, removes media, burns the id. **Archive doesn't exist.**
- Unit costs: `PATCH /api/products/:storeId/:id` (refused for connected Shopify). Edited in Analytics, not Settings.
- Web: `components/StoreForm.tsx` (Settings + Onboarding).

### Caps & autopilot — `store_caps` (`settings.ts`)
- `adSpendChangePerDay` 100, `higgsfieldCreditsPerDay` 200, `agentCostPerDay` 5, `autopilot {kind: {enabled, maxUsdPerDay}}`.
  Defaults are in code; **there is no stored workspace default** — every store falls back to the constant.
- `GET /api/caps?stores=`, `PUT /api/caps/:storeId` (partial merge). Autopilot kinds can't be removed, only disabled.
- Enforced live (re-read each spend): run start + mid-run abort (`packages/agents/src/runs.ts`), Higgsfield credits
  (`tools.ts generate_creative`), ad budget increases, autopilot in `requestApproval` (only `ads.set_budget` /
  `ads.pause_campaign` are eligible, and only when the agent's autonomy is `autopilot`).

### Integrations & credentials — `integrations` table (`apps/server/src/integrations.ts`, `sync.ts`, `oauth.ts`)
- Kinds: per store shopify, tiktok_shop, etsy, amazon, woocommerce, meta_ads, google_ads, tiktok_ads, ga4; global cj,
  higgsfield. Claude/Codex are runtimes, not integrations.
- Routes: `GET/PUT /api/integrations`, `DELETE /:id`, `POST /:id/sync`, OAuth start/finish/callback (Google, Etsy, TikTok Shop).
- **No "test connection" exists.** Saving marks `connected` without a request; the first sync is the de-facto test.
- **Disconnect** deletes the row only: synced data stays, no revocation at the provider.
- Status: `status`/`error`/`synced_at` (last success); last attempt is in memory only. `GET /api/health` lists connectors.
- Product Research sources (`pr_sources`) do track last success/attempt/error kind/quota.
- Web: `pages/Integrations.tsx` (ConnectForm drawer, password fields "Saved. Leave blank to keep it.", Sync now,
  ClaudeCard). Codex setup lives only in `agents/Deploy.tsx`.

### Agent runtime & config (`packages/agents`, `apps/server/src/routes/agents*.ts`)
- Per seat (`agents` table): `enabled`, `autonomy` suggest|ask|autopilot (default ask), `settings_json.dailyBudgetUsd`.
  `PATCH /api/agents/:id`. Web: `agents/settings.tsx` drawer.
- Per conversation (`agent_configs`, immutable rows): runtime claude|codex|demo, model, effort, tools, knowledge,
  `permissions {budgetUsd (Claude only), stopAfterMin (required for Codex), saveFindings off|ask|auto}`. Validated against
  live runtime capability (`configs.ts validateConfig`); defaults from `seatDefault`. Change via
  `POST /api/conversations/:id/config` (409 while running). Web: `agents/Deploy.tsx`, `ChangeRuntime`, `CreateTeam.tsx`.
- Runs snapshot runtime/model/effort/config_id and record actual_model/effort_applied/runtime_version. Caps, agent
  budget and autonomy are read live.
- Runtimes: `GET /api/runtimes`, `GET /api/claude-account` (5-min cache, `?refresh=1`), `POST /api/runtimes/codex/setup`.
  Models discovered from the SDK handshake / Codex `model/list`, fallback `RUNTIME_REGISTRY` (`packages/shared/src/runtime-registry.ts`).
- **Hardcoded:** 3 runs total / 2 per store (`runs.ts`), team concurrency ≤2, retries 0–2 (teams only), no automatic
  run retry. Env overrides: `FRONTLINE_AGENT_ENGINE`, `FRONTLINE_AGENT_MODEL`.
- **No workspace or store defaults for runtime/model/effort** — only per-seat code defaults. A connected store runs on
  Claude, a demo store on the demo engine (`engine.ts`). Codex reports $0 cost (tokens only); bounded by `stopAfterMin`.
- Presets: `agent_presets` (`GET/POST /api/presets`); custom roles `agent_custom_roles`.

### Automation — `automation_rules`, `automation_runs` (`apps/server/src/automations.ts`, `cron.ts`)
- Trigger schedule (cron) or metric; action agent_task or kb_research; approval auto|ask; max runs/day; cooldown.
- Scheduler ticks 60 s (metrics every 15 min), catches up missed slots once (≤31 days), disabled rules skip missed slots.
- `nextRunAt` computed on read. **No global pause. No automation-level cancel** (runs cancel via `POST /api/runs/:id/cancel`).
- Rules are edited in three places: Automation page, agent drawer Schedule toggles, KB Controls Schedules.

### Knowledge Base — `kb_controls` per workspace (`apps/server/src/kb/autonomy.ts`, `packages/agents/src/kb.ts`)
- autonomous, roles×categories, triggers, task/day budget, depth, approval, review, trusted/blocked domains, freshDays,
  retentionDays. `GET/PUT /api/kb/controls?ws=`. All consumed (review → findings start Unreviewed, domains → research
  fetch, freshDays → staleness, retention → `kb/maintenance.ts`). Promotion thresholds hardcoded.
- Web: `knowledge/Controls.tsx` (native checkboxes, own button styles).

### Product Research — `pr_store_profiles` (`apps/server/src/product-research/*`)
- audience, price band, ship_to, warehouses, max_delivery_days, include/avoid categories, avoid terms, keywords.
  `GET/PUT /api/pr/profile?store=`; saving re-evaluates the store's products. Per-product economics overrides
  (`pr_economics`); defaults discount 0, returns 0, fees from the store. Watches with alert prefs. Source caps hardcoded.
- **No research-depth or supplier-preference setting.** Ship-to edited in two places (toolbar + ProfileDialog).

### Notifications & digest
- Delivery that exists: in-app bell (`notifications` table, WebSocket push) and desktop OS toasts when the window is
  hidden. **No email, SMS, push, webhooks, quiet hours, digest time setting** (fixed 8:00 machine time).

### Usage & cost
- `GET /api/usage?stores=` → today's AI cost (`agent_runs.cost_usd` since local midnight), credits (counted locally),
  ad budget added. Claude cost = SDK `total_cost_usd` or registry estimate; Codex $0. No provider-reported billing.

### Data, backups, logs
- Backups: daily, keep 7, `<dataDir>/backups`, restore with undo backup + restart (`backups.ts`). DB only, not the key.
  Real and tested by existing code paths; not configurable.
- **No export of any kind. No settings audit log.** Logs `<dataDir>/logs/api.log` (5 MB rotate, redaction by convention).
- Retention: events 7 days, KB opt-in, backups 7; notifications, runs, action_log, approvals never pruned.

### Advanced / diagnostics
- `GET /api/health` (version, uptime, connectors). Updater: hourly, not configurable. Tray "Start with Windows".
  No webhooks, no developer settings beyond env vars.

### Per-device state (localStorage, never reaches `/api/settings`)
`fe.stores`, `frontline:onboarded`, `fe.agents.*`, `fe.research.*`, `frontline.ecosystem.theme|display`. No theme,
density or reduced-motion setting exists (app is dark-only; reduced motion is CSS `prefers-reduced-motion`).

## Duplicates and inconsistencies to resolve
- Five AI budget knobs in four places: store `agentCostPerDay`, agent `dailyBudgetUsd`, run `budgetUsd`, team budget,
  KB task/day budgets.
- Five "auto-approve" concepts: store autopilot rules, agent autonomy, automation `approval`, KB approval, Deploy
  `saveFindings`.
- Runtime status shown in four places; Codex setup only in Deploy.
- Agent on/off in two places (drawer, Ecosystem); memory edited in two; caps editable in Settings, mirrored read-only in
  the agent drawer with an "Edit caps" link that lands at the top of `/settings` (no deep links exist; Settings has no
  section ids).
- "Approvals" notification toggle barely changes anything (badge comes from `/api/approvals`).

## New foundations the approved scope implies (not present today)
1. Settings registry/schema (type, scopes, default, validation, consumer) + a settings change log.
2. Workspace defaults with store overrides that inherit (caps, agent runtime/model/effort/stop-after) — store rows hold
   only overrides; removing one restores inheritance.
3. Optimistic concurrency (version per settings document/row) on every config write.
4. Real read-only "test connection" per integration kind.
5. Global "pause new automation" and owner/app timezone for schedules and the digest.
6. Deep links into Settings sections (`/settings/<section>?store=`), settings search.
7. Non-secret config export/import (versioned), diagnostics export with redaction.
8. Notification quiet hours / digest time (only in-app + desktop channels exist).
Team & Access, MFA, password, billing: no foundation; out of scope unless the owner asks.
