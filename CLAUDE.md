# Frontline Ecom — rules for every agent working here

Frontline Ecom is a Windows desktop command center for running several ecommerce stores, each with its own
squad of specialized AI agents that learn the store's niche. Dark grey + red, gamified but SaaS-clear.
Read `docs/DESIGN.md` (what we build) and `docs/BUILD_PLAN.md` (in what order) before your first task.

## Stack

pnpm workspace, TypeScript strict, Node 24.

| Path | What |
|------|------|
| `apps/web` | React 19 + Vite + Tailwind v4 — the UI |
| `apps/server` | Hono API + WebSocket + SQLite (`node:sqlite`), demo data, platform/ad connectors |
| `packages/shared` | Domain types + API contracts used by web, server and agents |
| `packages/agents` | Agent engine (Claude Agent SDK), roles, playbooks, niche packs, store memory, approvals, XP |
| `apps/desktop` | Electron shell (later phase) |

Commands: `pnpm install`, `pnpm dev` (web + server), `pnpm check` (typecheck + tests).
Ports come from `WEB_PORT` / `API_PORT` (each worker worktree has its own pair, already in your env).

Reference material: `docs/reference/ui-reference.webp` (the look we're matching), `docs/reference/dashboard-mockup-v3.html`
(approved dashboard layout + interactions), `C:/dev/_reference/t3code` and `C:/dev/_reference/orca` (MIT source we
borrow agent-harness patterns from — see DESIGN.md "Reuse map"; keep their MIT notice in any file you port).

## Lanes — three workers, one Orca worktree each

| Lane | Owns |
|------|------|
| `ui` | `apps/web/**` |
| `core` | `apps/server/**` (except `src/routes/agents*`), `packages/shared/**`, `apps/desktop/**`, root config |
| `agents` | `packages/agents/**`, `apps/server/src/routes/agents*.ts` |

Edit outside your lane only for a tiny unblocking change (an added export, mounting a route). Otherwise append a
request to the other lane's backlog **Inbox** and stub the dependency behind a small interface so you can keep going.
`packages/shared` is additive-only: never rename or remove a field someone else uses.

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
- **Useful skills:** `ui-ux-pro-max`, `styleseed-design-review`, `dataviz` (ui); `claude-api` (agents — read it before
  touching the Agent SDK); the installed ecommerce skills (`shopify-*`, `tiktok-shop-*`, `etsy-*`,
  `dropshipping-product-research`, `ecommerce-*`) as source material for playbooks and niche packs;
  `superpowers:test-driven-development`, `superpowers:systematic-debugging` for everyone.
