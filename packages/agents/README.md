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
   login (`claudeAccount` / `GET /api/claude-account` says whether it's signed in, without spending usage) with model `FRONTLINE_AGENT_MODEL` (default `claude-opus-5-5`). Demo stores use `fake-engine.ts`, which costs
   nothing. `FRONTLINE_AGENT_ENGINE=claude|fake` forces one engine for every store, and tests always use fake.
4. **Tools** (`tools.ts`): each role has an allowlist (`roles.ts`). Read tools return CSV or JSON from the store's rows.
   Lists have row limits, and the date windows use the store's own dates. Once the store goes live or its currency
   changes during a run, every further tool call is refused (what the run read no longer holds). An Etsy product page
   draft keeps to plain-text structure and Etsy's title rule, since Etsy gets the text of the HTML.
5. **Asking** (`request_approval` and the purpose-built `propose_*` / `publish_page` / `create_creative` tools):
   every spend, publish or live-store change becomes an approval, and the run pauses until the owner decides.
   Autopilot only takes kinds the owner switched on, and only for amounts the tool computed itself. A model-written
   amount never counts, and the per-kind daily caps still apply. Requests the app can't carry out on the store's
   platform are refused before they're asked (`noStoreWrites`, using shared `PRODUCT_WRITE_PLATFORMS`,
   `PRICE_WRITE_PLATFORMS` and `PRODUCT_PAGE_PLATFORMS`).
6. **Carrying it out** (`apps/server/src/routes/agents-actions.ts`): `OUTLIVE_RUN` kinds are applied by the server
   when approved, even after the run ended. Writers are routed by platform (`onStore` in `routes/agents.ts`). A
   change approved on stale numbers (the price moved, or an ad change days late) is skipped and the owner is told, and
   so is one asked on demo data but approved after the store's first real sync. A theme copy whose request was never
   sent, or whose duplicate call failed after Shopify made it, is deleted. A store page whose push may have worked (a
   5xx, a dropped connection) tells the owner to check the store before publishing again, since that page is created, not
   updated. A price or budget the owner changed on the platform since the sync (core's `stillAsSynced` refuses it)
   reads "Not applied", not "do it by hand". Every failure notice links to where the owner acts, and a failed action or
   run finish goes to `api.log`.
7. **Learning** (`memory.ts`): a run that used tools reflects once (its JSON is found even after prose holding a `[`) and writes up to 5 memories (a store keeps its
   300 strongest agent facts and learnings; pins, preferences and the owner's notes always stay; a run on demo data that
   ends after the store went live learns nothing). Each run recalls the pins and the owner's notes and no's, plus the
   12 others that score best on relevance × recency × confidence; rewording a squad memory makes it the owner's. Outcome checks
   (`routes/agents-gamification.ts`, on dashboard reads and hourly) judge approved changes on real data later:
   - ads: 3 days after vs 7 before (blended ROAS; a raise on its extra spend's ROAS, a pause or cut on the ROAS of the spend it took away, vs break-even)
   - products: their first 14 days on sale (from when first seen active; else from the day added); 10+ units with no unit cost is unclear
   - prices and pages: 14 days before vs after, the before scaled by the rest of the store's sales (10+ units across both, else "can't be judged")
   - themes: conversion 14 days before vs after (30+ orders across both)

   Windows are counted in the store's own days (a live store dates its data in its zone), and a change is judged only once
   its last day there is over and every one of the store's integrations has synced since, none failing (each change is
   judged once). Prices and pages need sales before the change to compare with. Each judgement becomes a memory and moves the confidence of what that run learned. In the prompt every memory says
   who it's from (owner, owner's no, measured, squad); only the app sets the `outcome` and `denied` tags, and an agent
   can't rewrite an owner note. Learnings that 2+ live stores of
   a niche (a custom niche by its name) found on their own become a request to share them with the whole niche (hourly, `proposeNichePromotions`;
   the Market Analyst can also ask with `promote_niche_learning`).

**Squad missions** (`missions.ts`, `/api/squad-missions`) chain runs across the squad. A mission is a plan of steps, and
each step may wait only on steps listed before it. A step becomes an ordinary run once every step it waits on is done.
It starts as the child run of the first of those steps, and their final answers go into its brief (over 2,000 characters,
the first 500 and the last 1,500: the result, and what the step was asked to end with for the next ones). Only the plan, the
run ids and the one-line deliverables are stored; every status is read off the runs. After an app restart a step follows
the run that retried it. A failed or cancelled step blocks the steps after it. A step its agent turns down (offline, or
today's budget is spent) waits with a note, and the owner is told once. It starts when that agent is changed, another
run ends, or within a minute of the cap being raised or the day turning over. The owner also hears when a mission is done or stuck.
The owner can call a mission off (`POST /api/squad-missions/:id/cancel`): steps not done are cancelled and it ends as
`cancelled`, without a "stuck" note. `MISSION_TEMPLATES` holds "Launch a new
product", "Rescue a slipping product" and "Answer a competitor's price cut". Their briefs are checked by the evals test,
like the scheduled jobs.

## Money guards

- **Store AI budget per day** (`agentCostPerDay`): each starting run gets at most `cap / perStore`, minus what working
  runs already hold. Spend is saved as the run goes (`onSpend`, an estimate from token usage), so cancelled or crashed
  runs still count. A run stops as soon as the store's saved spend today passes the cap. An agent's own
  `dailyBudgetUsd` caps its runs inside that (one run per agent, so no shares). Both are read again at each spend, so a
  cap the owner lowers mid-run holds. "Today" holds every run not over before midnight, so one queued or begun
  yesterday that spends today counts today.
- **Higgsfield credits** (`higgsfieldCreditsPerDay`): pending requests count as asked, credits are charged before the
  render, and they stay charged if it fails or the creative is deleted (`creative_credits`).
- **Ad spend** (`adSpendChangePerDay`): only increases count toward it, on the day they're approved (a waiting one
  counts whenever it was asked). Pauses and cuts count toward the autopilot caps for those kinds. A pause of a
  campaign with no campaign budget (ad set or lifetime budgets) has no amount, so the owner decides it.
- **Budget steps** (`propose_ad_change`): a raise is at most 30% of the current daily budget, and a campaign gets one
  applied budget change per 3 days (the window it's judged on). Cuts can go further; pauses always go.
- **Autopilot** is read from the agent at each request, so taking an agent off it mid-run takes effect at once.

## Restarts and repeats

- A run's transcript is saved as it spends and when it starts waiting on the owner, so a crash keeps what it did.
- Runs cut off by a restart in the last 6 hours run again, once, linked `retry:<old>:<new>` before they start. Missions
  follow the link, and `assign_task` reads the earlier attempt's assignments, so it doesn't hand out the same work twice.
- A task started again while its last copy still waits in the queue (a scheduled job behind a run waiting on the
  owner) returns that queued run instead of stacking another.
- A chat reply keeps its Claude session even when it's cancelled or hits a limit (`onSession` from the SDK's `init`),
  so the next message goes on from it.

## Demo, then live

Demo stores run every role on the fake engine, with templated work drawn from the store's own rows, so each screen
has something to show. A store's first real sync (core's `switchToReal`) wipes its simulated rows. The agents then
`startFresh` once:
- they drop the facts and learnings they drew from demo data, and what they shared with the niche;
- pending requests expire, without counting as the owner's "no";
- demo-order issues close;
- product-page and flow drafts go;
- demo renders and agent copy leave the creatives library (paid Higgsfield renders stay);
- running missions are cancelled;
- a run still going from before does nothing more: every tool call it makes says stop, and it learns nothing;
- a chat from before can't be continued: the owner starts a new one.

A live store's tools also leave demo stand-ins out: `research_feed` skips the sample catalog, `search_suppliers` gives
no demo listings without CJ, `create_creative` makes no placeholder render without Higgsfield, `compare_stores` leaves
demo stores out.

The default jobs (`jobs.ts`) switch on at the same time (the daily campaign review once an ad account has a running campaign;
the weekly page refresh only on platforms where the app publishes product pages, the monthly flow check only on
Shopify and WooCommerce, where the store owns its buyers, also for jobs added to a live store
later), since they would otherwise spend Claude usage on simulated numbers. A job switched on waits for its next slot:
it doesn't run for the ones it was off for. A job the owner edited in Automation keeps the on/off they gave it. Outcome checks and the squad log only count what happened after go-live.
A job whose task text the owner never edited moves to the current text at startup. When you change a task, add the
old text's hash to `FORMER_TASKS` (agents-jobs.test pins each task's hash and fails until you do).

## Adding things

- **A tool:** `defineTool` in `tools.ts`, then add it to the roles that need it in `roles.ts`, and name it in their
  playbooks. The evals test fails when a playbook, job or prompt names a tool its role doesn't have.
- **A platform writer:** core adds the connector function and the shared platform list. Here, add a key to the
  `onStore` call for that action. The request gates already read the shared lists.
- **A role:** core adds it to `AGENT_ROLES`. Here, add `roles.ts`, `playbooks/<role>.md`, demo work in
  `fake-engine.ts`, and its jobs, if any, in `jobs.ts`.
