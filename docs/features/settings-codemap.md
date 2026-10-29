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

## Corrections (verified 2026-10-28)

Rechecked at 65531883 against decision 2 of `docs/backlog/settings.md` (the full list, with line refs, lives there; the
code between cc80fbac and 65531883 changed only Codex tests and one `codex.ts` line). Where this map says otherwise above,
these win:

- **Guards.** The Origin check runs only when the header is present. `wrongStore` acts only on `?store=` requests and only
  on the by-id routes of six tables; new by-id routes check the store themselves. `kbGuard` caps writes on its prefixes.
- **`settings` table.** No `updated_at`. Besides `app` it holds `fx`, `digest_sent`, `competitor_watch`, `shop:<id>`,
  `restore_closed`, `ad_timezones`, `catalog_pass`, Amazon/TikTok read state, `pr:cj:categories` and cursors; deleting an
  integration or store leaves its per-id rows. No server cache: every `getSettings` caller reads the row per call.
  `baseCurrency` is only regex-checked (`XYZ` passes and zeroes every rate). The Profile panel saves name and
  `baseCurrency` together.
- **Time.** Daily caps, cron, the digest and `maxRunsPerDay` use machine-local midnight. Store timezone is ignored on demo
  stores (`storeZone()` → undefined when `demo=1`). Only Shopify and WooCommerce set the store timezone on sync
  (`takeTimezone`); Shopify, Woo, Etsy, TikTok Shop and Amazon overwrite the currency (`takeCurrency`/`setStoreCurrency`).
- **Store currency change** zeroes `campaigns.daily_budget` and denies pending money requests **only on a real store**;
  on any store it nulls `orders.fx_rate` and resets the ad and Amazon cursors.
- **Caps are not all re-read live.** A Claude run's SDK `maxBudgetUsd` is fixed at start (at most cap ÷ per-store
  runs). The credits tool is `create_creative` (not `generate_creative`); its cap was read before the approval wait
  (CH-05 added a recheck; ST-24a confirms it). The ad cap is checked only in `propose_ad_change`, in USD, skipped with no
  FX rate. `start()` refuses **any** run (Codex and demo too) once the store's AI cap is used up; a $0 cap refuses all.
  After a store's first caps save, `DEFAULT_CAPS` changes no longer reach it, and no route deletes a `store_caps` row.
- **Runs do retry.** Transient errors twice (5 s, 20 s) unless a changing tool ran; an interrupted run under 6 h once at
  startup; turned-down mission steps. "2 per store" is also hardcoded in PR `tasks.ts`, `ResearchDialog.tsx` and
  `packages/agents/README.md`; teams have their own `STORE_LIMIT = 2`.
- **Agent defaults.** `seatDefault` gives runtime `demo` on a demo store. Config-less runs (automations, mission steps, KB
  stages/ask, niche drafts) use `FRONTLINE_AGENT_MODEL` or `claude-opus-5-5`. `defaultEngine`: a codex config runs on
  Codex; Claude when the store is connected, the mode is `research`, or the config says claude; demo otherwise.
- **Integrations.** Every save resets status to connected; a non-secret change resets the cursor (re-backfill up to 2
  years); a shop-key change runs `forgetPlatform` (deletes that platform's orders, products, refunds). The first
  successful sync takes a demo store live irreversibly (`switchToReal`, `startFresh`). Disconnect keeps a `shop:<id>` row,
  leaves the store live and its jobs on, revokes nothing at the provider. OAuth `finishOAuth` saves through
  `saveIntegration` directly. Token refresh rotates secrets through `updateSecrets` (Etsy/TikTok refresh tokens are
  single-use). Higgsfield has no syncer and shows Connected forever.
- **Notifications.** Toasts fire when the window is not both visible and focused (not only "hidden"), only for
  `type:'notification'`. `errors` also hides backup failures, "stopped syncing" and failed approved live writes;
  `agentDone` also covers KB research, missions and teams. Approval notifications link to `/` (a question links to its
  conversation). The digest runs on a 10-minute check at the first tick ≥ 8:00 machine time and catches up the same day.
  The only dedupe is the per-day account-error `once()`.
- **Knowledge.** Only `blockedDomains` is enforced at fetch time; `trustedDomains` is a prompt hint. A store doesn't
  inherit General's lists. A deleted or moved top-level category stays in `freshDays`/`roles` and makes every later
  `PUT /api/kb/controls` return 400.
- **Product Research.** `priceMin` is stored but `fitFor` reads only `priceMax`. `price_currency` is saved but
  `profile.ts` reads `store.currency`. `taskMessage` doesn't include the research profile. All-stores ship-to is per
  device (`fe.research.shipTo`).
- **Retention and backups.** `trimOldTranscripts` cuts tool outputs of runs older than 90 days. Never pruned: `pr_calls`,
  `automation_runs`, `kb_retrievals`, notifications, `agent-sessions/`, `codex-home/`. Daily, manual and undo backups
  are all named `frontline-<ISO>.db` and count toward `KEEP=7`; only the pre-migration copy has `-before-update`. Backups
  copy the DB only (not the key, `knowledge/`, `packs/niche/`, `creatives/`, `pr-images/`).
- **Appearance.** `color-scheme: dark` is forced; `prefers-reduced-motion` and `forced-colors` are honoured.

## Registry plan

One row per setting in decision 3. Consumers are `path#symbol`, each confirmed by grep at 65531883; "(built by ST-xx)"
marks a consumer that item creates. `inherits` is given only for multi-scope entries.

| Setting | Owner (storage / validator) | Consumers | inherits | Wired by |
|---|---|---|---|---|
| `profile.name` | `settings.ts#updateSettings` (`app`) | `apps/web/src/components/Hero.tsx#profile` | – | ST-12 |
| `appearance.motion` | `config/` (`personal`) | `apps/web/src/index.css#data-motion`, `apps/web/src/ecosystem/renderer.ts#prefers-reduced-motion` (built by ST-13) | – | ST-13 |
| `pinned` | `config/` (`personal`) | `apps/web/src/settings/Sidebar.tsx` (built by ST-34) | – | ST-34 |
| `notifications.{approvals, agentDone, errors, digest, researchAlerts}` | `settings.ts#updateSettings` (`app`) | `apps/server/src/settings.ts#notify`, `apps/server/src/digest.ts#getSettings` | – | ST-14b |
| `notifications.toasts.<category>`, `.quietHours`, `.stores` | `settings.ts` (`app`) | `apps/server/src/settings.ts#notify` → `apps/desktop/src/main.ts#toastNotifications` (built by ST-14a) | – | ST-14a |
| `notifications.digestHour` | `settings.ts` (`app`) | `apps/server/src/digest.ts#HOUR` | – | ST-15 |
| `notifications.usageAlerts`, `.usageAlertPct` | `settings.ts` (`app`) | usage-alert check (built by ST-15) | – | ST-15 |
| `baseCurrency` | `settings.ts#updateSettings` (`app`) | `apps/server/src/fx.ts#fxFor`, `fx.ts#startFxLoop`, `product-research/discovery.ts#getSettings`, `product-research/facts.ts#getSettings`, `routes/agents.ts#portfolio` | – | ST-16 |
| `timezone` | `config/` (`workspace`, boot fill) | `cron.ts`, `digest.ts`, `automations.ts`, `runs.ts#costToday`, `tools.ts` today counters (built by ST-11) | – | ST-11 |
| `agentDefaults.{runtime, model, effort, stopAfterMin, knowledge}` | `config/` (`workspace` / `store_caps`) | `packages/agents/src/configs.ts#seatDefault`, `claude-engine.ts#agentModel`, `runs.ts#inScope` | workspace | ST-20 |
| `runs.{retries, concurrency, perStore}` | `config/` (`workspace`) | `packages/agents/src/runs.ts#perStore`, `teams.ts#STORE_LIMIT`, `product-research/tasks.ts#2 per store` | – | ST-22 |
| `caps.{agentCostPerDay, adSpendChangePerDay, higgsfieldCreditsPerDay}` | `settings.ts#updateCaps` (`workspace` / `store_caps`) | `settings.ts#getCaps` → `routes/agents.ts#toolEnv`, `runs.ts#budgetFor`, `product-research/tasks.ts#seatProblem` | workspace | ST-07, ST-23, ST-24b |
| `autopilot.<kind>` | `settings.ts#updateCaps` (`store_caps`) | `packages/agents/src/tools.ts#requestApproval` | – | ST-30 |
| `knowledge.autoSave` | `config/` (`workspace` / `store_caps`) | `packages/agents/src/tools.ts#save_finding`, `product-research/reports.ts#captureFindings` | workspace | ST-26 |
| `automation.paused` | `config/` (`workspace`) | `automations.ts#startScheduler`, `kb/promote.ts`, the call-site table (built by ST-29) | – | ST-29 |
| Store fields | `stores.ts#parseStoreInput` (`stores`) | existing consumers | – | ST-18 |
| KB research controls | `kb/autonomy.ts#parseControls` (`kb_controls`) | existing consumers | none | ST-25 |
| Research profile + assumptions | `product-research/profile.ts#saveProfile` (`pr_store_profiles`) | `product-research/evaluate.ts#fitFor`, `discovery.ts`, `tasks.ts#taskMessage`, `economics.ts` | – | ST-27, ST-28 |
| Start with Windows | Electron login item (device) | `apps/desktop/src/main.ts#setLoginItemSettings` | – | ST-33b |
| Locked policies | registry only | `packages/agents/src/tools.ts#requestApproval`, `routes/agents-scope.ts#wrongStore` | – | ST-06 |

**Knowledge capture callers** (decision 13):

| Caller | Class |
|---|---|
| `packages/agents/src/tools.ts` `save_finding` (~1345, `captureFinding`, `unreviewed` in Automatically mode) | follows `knowledge.autoSave` |
| `apps/server/src/product-research/reports.ts` `captureFindings` (every non-demo report) | follows `knowledge.autoSave` |
| `apps/server/src/routes/agents-conversations.ts` ~219 (the owner's "save to knowledge") | owner-initiated, never gated |
| `apps/server/src/kb/routes.ts` ~475 `createCard` | owner-initiated, never gated |
| `packages/agents/src/kb-perf.ts` ~101, `product-research/outcomes.ts` ~107, `product-research/pipeline.ts` ~179 (measured results) | ungated, named in the help text |
| `packages/agents/src/kb-research.ts` ~405, `tools.ts` ~1490 (Knowledge research results) | ungated, named in the help text |
| `packages/agents/src/kb-promote.ts` ~36 (promotions; always a `kb.promote` approval) | ungated, named in the help text |

**Tests that call owner helpers or config write routes directly** (ST-07 and ST-08a–c update them in the same commit):

- `updateCaps`: `routes/agents-{ads,approvals,creatives,runs}.test.ts`; `PUT /api/caps/`: `settings.test.ts`,
  `routes/agents-missions.test.ts`.
- `updateSettings`: `digest.test.ts`, `fx.test.ts`, `product-research/alerts.test.ts`; `PATCH /api/settings`:
  `settings.test.ts`, `competitors.test.ts`, `routes/agents-scope.test.ts`, web `pages/Settings.test.tsx`.
- `updateStore`: `connectors/common.test.ts`; `/api/stores/:id`: `stores.test.ts`, `connectors/shopify.test.ts`,
  `routes/agents-{activate,api,scope}.test.ts`, web `agents/settings.test.tsx`, `components/StoreForm.test.tsx`,
  `pages/Knowledge.test.tsx`.
- `PUT /api/kb/controls`: `kb/{autonomy,maintenance,plans,security}.test.ts`, web `knowledge/Controls.test.tsx`.
- `PUT /api/pr/profile`: `product-research/{discovery,evaluate,pipeline,security}.test.ts`, web `pages/Research.test.tsx`,
  `product-research/ResearchDialog.test.tsx`.
- `/api/automations/:id`: `automations.test.ts`, `routes/agents-{activate,jobs}.test.ts`, web `knowledge/Controls.test.tsx`,
  `pages/Automation.test.tsx`.
- `saveIntegration`: `competitors.test.ts`, `integrations.test.ts`, `sync.test.ts`,
  `connectors/{ads,amazon,cj,cj-caps,etsy,google,meta,shopify,tiktok,woocommerce}.test.ts`,
  `product-research/{alerts,matching,security}.test.ts`, `product-research/sources/cj.test.ts`,
  `routes/agents-{codex,mcp,scope}.test.ts`; `PUT /api/integrations`: `integrations.test.ts`, `connectors/shopify.test.ts`,
  `product-research/security.test.ts`, `routes/agents-scope.test.ts`, web `pages/Integrations.test.tsx`.

In-process helpers keep an optional version (decision 6), so the direct `saveIntegration`/`updateCaps`/`updateSettings`
callers need no change; only the HTTP-route tests send `version`.
