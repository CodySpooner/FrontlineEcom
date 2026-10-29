# Frontline Ecom — rules for every agent working here

Frontline Ecom is a Windows desktop command center for running several ecommerce stores, each with its own
squad of specialized AI agents that learn the store's niche. Dark grey + red, clean and SaaS-clear (no game mechanics).
Read `docs/DESIGN.md` (what we build) and `docs/BUILD_PLAN.md` (in what order) before your first task.

## Stack

pnpm workspace, TypeScript strict, Node 24.

| Path | What |
|------|------|
| `apps/web` | React 19 + Vite + Tailwind v4 — the UI |
| `apps/server` | Hono API + WebSocket + SQLite (`node:sqlite`), demo data, platform/ad connectors |
| `packages/shared` | Domain types + API contracts used by web, server and agents |
| `packages/agents` | Agent engine (Claude Agent SDK), roles, playbooks, niche packs, store memory, approvals, outcome checks |
| `apps/desktop` | Electron shell (later phase) |

Commands: `pnpm install`, `pnpm dev` (web + server), `pnpm check` (typecheck + tests).
Ports come from `WEB_PORT` / `API_PORT` (each worker worktree has its own pair, already in your env).

Reference material: `docs/reference/ui-reference.webp` (the look we're matching), `docs/reference/dashboard-mockup-v3.html`
(approved dashboard layout + interactions), `C:/dev/_reference/t3code` and `C:/dev/_reference/orca` (MIT source we
borrow agent-harness patterns from — see DESIGN.md "Reuse map"; keep their MIT notice in any file you port).
The references predate the owner's 2026-10-28 cleanup: their page-header art and skyline and the profile chip's
dropdown are superseded (the header is a plain title strip). Don't match or rebuild those.

## Lanes — one worker per lane, one Orca worktree each

| Lane | Owns |
|------|------|
| `ui` | `apps/web/**` (except `src/ecosystem/**`, `public/ecosystem/**`, `public/art/**`) |
| `core` | `apps/server/**` (except `src/routes/agents*`, `src/routes/ecosystem*`), `packages/shared/**`, `apps/desktop/**`, root config |
| `agents` | `packages/agents/**`, `apps/server/src/routes/agents*.ts` |
| `ecosystem` (Codex) | the AI Ecosystem page: `apps/web/src/ecosystem/**`, `apps/web/public/ecosystem/**`, `apps/server/src/routes/ecosystem*.ts` — touch points in `docs/backlog/ecosystem.md` |
| `image-generation` (Codex, finished) | agent portraits: `apps/web/public/art/agents/**`, `Art.tsx` — touch points in `docs/backlog/image-generation.md` |
| `knowledge-base` | the Knowledge Base & Research Intelligence feature (`docs/features/knowledge-base.md`): `apps/web/src/pages/Knowledge.tsx`, `apps/web/src/knowledge/**`, `apps/server/src/kb/**`, plus the KB touch points across packages listed in `docs/backlog/knowledge-base.md` (the other lanes are stopped) |
| `ai-agents` | the AI Agents page redesign (`docs/features/ai-agents.md`): the agents workspace in `apps/web` (`pages/Agents*.tsx`, `AgentDetail.tsx`, `Chat.tsx`, a new `apps/web/src/agents/**`), `apps/server/src/routes/agents*.ts`, the run, engine, role and mission code in `packages/agents`, plus the touch points listed in `docs/backlog/ai-agents.md` (the other lanes are stopped) |
| `product-research` | the Product Research page redesign (`docs/features/product-research.md`): `apps/web/src/pages/Research.tsx`, a new `apps/web/src/product-research/**`, `apps/server/src/research.ts`, a new `apps/server/src/product-research/**`, `apps/server/src/connectors/cj.ts`, plus the touch points listed in `docs/backlog/product-research.md`. It runs at the same time as `ai-agents`: edit that lane's files only at those touch points |
| `codex-hardening` (Codex) | second-opinion fixes and tests across lanes, one phase at a time: the files each phase names in `docs/backlog/codex-hardening.md`, plus new `e2e/**` and `playwright.config.ts` |
| `settings` | the Settings redesign (`docs/features/settings.md`): `apps/web/src/pages/Settings*.tsx`, a new `apps/web/src/settings/**`, `apps/web/src/pages/Integrations.tsx` (moved into `settings/integrations/`), `apps/server/src/settings.ts`, a new `apps/server/src/config/**`, a new `packages/shared/src/settings.ts`, plus the touch points listed in `docs/backlog/settings.md`. It runs at the same time as `codex-hardening` and `store-analytics`: edit their files only at the touch points in `docs/backlog/settings.md`, rebased first |
| `store-analytics` | the Store Analytics redesign (`docs/features/store-analytics.md`): `apps/web/src/pages/Analytics.tsx`, a new `apps/web/src/analytics/**`, a new `apps/server/src/store-analytics/**`, a new `packages/shared/src/store-analytics.ts`, a new `apps/server/src/connectors/ingest.ts` with the connector contract tests and fixtures, plus the touch points listed in `docs/backlog/store-analytics.md`. It runs at the same time as `codex-hardening` and `settings`: never edit the files codex-hardening's current phase owns, and edit Settings' files only at the touch points in `docs/backlog/store-analytics.md`, rebased first |

Edit outside your lane only for a tiny unblocking change (an added export, mounting a route). Otherwise append a
request to the other lane's backlog **Inbox** and stub the dependency behind a small interface so you can keep going.
`packages/shared` is additive-only: never rename or remove a field someone else uses (exception: when the owner
removes a feature, remove its fields together with every user in the same change).

## Worker loop — never stop

You run unattended. The owner is away and said not to ask questions: you have full authority inside your lane.
Never ask, never wait for a reply, never end with a question.

1. **Sync:** `git fetch origin && git rebase origin/main`; run `pnpm install` if `pnpm-lock.yaml` changed.
2. **Pick:** your backlog `docs/backlog/<lane>.md` — Inbox first, then the first unchecked item.
   Set the Orca card: `orca worktree set --worktree active --comment "<lane>: <item id> <title>" --json`.
3. **Build** the smallest complete slice. Any logic (math, parsing, state, money) gets a test.
4. **Verify:** `pnpm check` is green. UI work: also open it in Orca's built-in browser (see the orca-cli skill,
   `orca skills get orca-cli --reference references/browser.md`), screenshot, compare against `docs/reference/`.
5. **Record:** tick the item `[x]` and add a dated one-liner under **Done** in your backlog.
6. **Ship:** commit (`<lane>: <what>`), then `git fetch origin && git rebase origin/main && pnpm check && git push origin HEAD:main`.
   Push rejected → repeat. Never force-push. Never rewrite or reset `main`.
7. **Log:** append one line to your lane log in the project vault (below). Then back to 1.

Backlog empty? Re-read DESIGN.md and `docs/reference/`, find the biggest gap between the app and the vision,
append 3–5 concrete items to your backlog, keep going. Blocked? Write it under **Blocked** with what's needed, take
the next item.

## Project vault (Onyx / Obsidian)

`C:\Users\Xody2\OneDrive\Desktop\Vaults\Frontline Ecom Vault`
- Append one bullet per shipped item to `Build Log/<lane>.md` there: `- YYYY-MM-DD HH:MM — <item id> <what shipped> (<commit>)`.
  Append-only; one file per lane so three workers never overwrite each other.
- Don't edit `Claude Projects/Frontline Ecom.md` — the coordinator owns it.

## Hard rules

- **No secrets in git** (`.env`, tokens, `*.db`). Real credentials are entered in the Integrations screen and stored
  encrypted in the local data dir.
- **Demo mode first:** everything works with zero credentials on seeded fake stores. Real connectors switch on when
  credentials exist.
- **Approvals:** the app's agents never spend money, publish, or change a live store/ad account without an approval
  request, unless the owner turned on autopilot for that action with a cap.
- **Don't burn the owner's Claude usage:** the agent engine has a fake mode and tests use it. At most one short real-engine
  smoke run per task.
- **Lockfile conflict during rebase:** take origin's `pnpm-lock.yaml`, rerun `pnpm install`, `git add`, continue.
- **Keep it simple:** smallest code that works, no speculative abstractions, match the surrounding style.
- **No gamification, no header art** (owner decision, 2026-10-28: too gaming related for this app): no XP, levels,
  ranks, rank frames, LV badges, achievements, trophies, daily missions, profit streaks, commander level,
  XP/level-up/mission toasts or their sounds, and no page-header images (the header is a plain title strip). Never add
  them back or propose them as backlog items. Squad missions (multi-agent plans, `squad_missions`), outcome checks
  (measured results → store memory, `apps/server/src/routes/agents-outcomes.ts`) and store health badges are real
  features and stay.
- **Useful skills:** `ui-ux-pro-max`, `styleseed-design-review`, `dataviz` (ui); `claude-api` (agents — read it before
  touching the Agent SDK); the installed ecommerce skills (`shopify-*`, `tiktok-shop-*`, `etsy-*`,
  `dropshipping-product-research`, `ecommerce-*`) as source material for playbooks and niche packs;
  `superpowers:test-driven-development`, `superpowers:systematic-debugging` for everyone.
