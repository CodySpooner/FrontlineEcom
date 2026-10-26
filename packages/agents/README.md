# @frontline/agents

The agent engine: one squad of 8 specialists per store (`AGENT_ROLES` in `@frontline/shared`), each one run as a
Claude Agent SDK session with the store's data behind in-process tools. The server side lives in
`apps/server/src/routes/agents*.ts`: routes, the run manager instance, the platform writers each approval calls, and the
outcome checks.

## A run, end to end

1. **Start** (`runs.ts` `createRunManager().start`): refused if the agent is offline, or if the store's AI budget for
   today (or the agent's own, `dailyBudgetUsd`) is spent. Queued runs share the machine: 3 at once, 2 per store, one per agent. A run waiting on the owner holds no slot.
2. **Prompt** (`prompt.ts` `assemblePrompt`): role prompt and playbook (`playbooks/<role>.md`), then the platform pack
   (`packs/platform/`), the niche pack (`packs/niche/`, or a drafted pack for a custom niche), owner-approved niche
   learnings, the store profile (on a live store, also what the app can change there), the top store memories for
   the task, the store's scheduled jobs (so a run doesn't hand off what one does anyway), open requests, and the date in the zone the store's data is dated in. The stable layers come first, so
   the prefix caches. The owner can edit any shipped layer in the Knowledge Base; edits live in
   `<FRONTLINE_DATA_DIR>/knowledge/`.
3. **Engine** (`engine.ts` `defaultEngine`): connected stores use `claude-engine.ts`, on the owner's local Claude Code
   login with model `FRONTLINE_AGENT_MODEL` (default `claude-opus-5-5`). Demo stores use `fake-engine.ts`, which costs
   nothing. `FRONTLINE_AGENT_ENGINE=claude|fake` forces one engine for every store, and tests always use fake.
4. **Tools** (`tools.ts`): each role has an allowlist (`roles.ts`). Read tools return CSV or JSON from the store's rows.
   Lists have row limits, and the date windows use the store's own dates.
5. **Asking** (`request_approval` and the purpose-built `propose_*` / `publish_page` / `create_creative` tools):
   every spend, publish or live-store change becomes an approval, and the run pauses until the owner decides.
   Autopilot only takes kinds the owner switched on, and only for amounts the tool computed itself. A model-written
   amount never counts, and the per-kind daily caps still apply. Requests the app can't carry out on the store's
   platform are refused before they're asked (`noStoreWrites`, using shared `PRODUCT_WRITE_PLATFORMS`,
   `PRICE_WRITE_PLATFORMS` and `PRODUCT_PAGE_PLATFORMS`).
6. **Carrying it out** (`apps/server/src/routes/agents-actions.ts`): `OUTLIVE_RUN` kinds are applied by the server
   when approved, even after the run ended. Writers are routed by platform (`onStore` in `routes/agents.ts`). A
   change approved on stale numbers (the price moved, or an ad change days late) is skipped and the owner is told.
7. **Learning** (`memory.ts`): a run that used tools reflects once and writes up to 5 memories (a store keeps its
   300 strongest agent facts and learnings; pins, preferences and the owner's notes always stay). Outcome checks
   (`routes/agents-gamification.ts`, on dashboard reads and hourly) judge approved changes on real data later:
   - ads: 3 days
   - products: 14 days
   - prices and pages: 14 days before vs after
   - themes: 14 days before vs after

   Each judgement becomes a memory and moves the confidence of what that run learned. Learnings that 2+ live stores of
   a niche (a custom niche by its name) found on their own become a request to share them with the whole niche (hourly, `proposeNichePromotions`;
   the Market Analyst can also ask with `promote_niche_learning`).

## Money guards

- **Store AI budget per day** (`agentCostPerDay`): each starting run gets at most `cap / perStore`, minus what working
  runs already hold. Spend is saved as the run goes (`onSpend`, an estimate from token usage), so cancelled or crashed
  runs still count. A run stops as soon as the store's saved spend today passes the cap. An agent's own
  `dailyBudgetUsd` caps its runs inside that (one run per agent, so no shares).
- **Higgsfield credits** (`higgsfieldCreditsPerDay`): pending requests count as asked, credits are charged before the
  render, and they stay charged if it fails or the creative is deleted (`creative_credits`).
- **Ad spend** (`adSpendChangePerDay`): only increases count toward it. Pauses and cuts count toward the autopilot
  caps for those kinds.

## Demo, then live

Demo stores run every role on the fake engine, with templated work drawn from the store's own rows, so each screen
has something to show. A store's first real sync (core's `switchToReal`) wipes its simulated rows. The agents then
`startFresh` once:
- they drop the facts and learnings they drew from demo data;
- pending requests expire, without counting as the owner's "no";
- demo-order issues close;
- product-page drafts go.

The default jobs (`jobs.ts`) switch on at the same time (the daily campaign review once an ad account syncs campaigns;
the weekly page refresh only on platforms where the app publishes product pages),
since they would otherwise spend Claude usage on simulated numbers. Outcome checks and the squad log only count what happened after go-live.
A job whose task text the owner never edited moves to the current text at startup. When you change a task, add the
old text's hash to `FORMER_TASKS`.

## Adding things

- **A tool:** `defineTool` in `tools.ts`, then add it to the roles that need it in `roles.ts`, and name it in their
  playbooks. The evals test fails when a playbook, job or prompt names a tool its role doesn't have.
- **A platform writer:** core adds the connector function and the shared platform list. Here, add a key to the
  `onStore` call for that action. The request gates already read the shared lists.
- **A role:** core adds it to `AGENT_ROLES`. Here, add `roles.ts`, `playbooks/<role>.md`, demo work in
  `fake-engine.ts`, and its jobs, if any, in `jobs.ts`.
