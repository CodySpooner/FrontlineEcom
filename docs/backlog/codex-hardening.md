# Backlog — codex-hardening lane (Codex: second-opinion fixes, tests, first-real-store readiness)

Repo rules: `CLAUDE.md` (worker loop, hard rules). The owner picked this work on 2026-10-28 from a scouted list
("lets do 1, 3, 4, 5, 7"). Every finding below was checked against the code on 2026-10-28 (main at 3a10b8bd); line
numbers drift, so re-find each one before you fix it.

## Why a Codex worker

Three Claude workers wrote most of this code in about a day (ai-agents, knowledge-base, product-research), and Claude
reviews signed it off. You are the independent second look. Treat every earlier "safe" or "verified" claim as a claim
to check, not a fact.

## Lane

Finite: work the phases in order (A → E), then write the report (CH-24), create an empty `.agent/STOP` in this
worktree and stop. Don't add new items once CH-24 is done (this overrides CLAUDE.md's "Backlog empty?" rule).

Owns, per phase, only the files named in that phase plus their `*.test.ts(x)`, this file, and the items you tick in
`docs/backlog/agents.md` (AGT-245..249, the compareAt Inbox line, AGT-19). Everything else: append an Inbox line to the
owning lane's backlog (`- [ ] (from codex-hardening) …`) and keep going. Before each phase, re-read the CLAUDE.md
lanes table: if a lane that is running now (its worktree has no `.agent/STOP`) owns a file you need, file it to that
lane's Inbox instead of editing. Hands off: Settings (`apps/server/src/settings.ts`, `apps/web/src/pages/Settings*.tsx`,
`StoreForm.tsx`, `docs/features/settings*.md`; a Settings redesign is starting) and anything a Store Analytics lane
claims.

Ports for this worktree: `WEB_PORT=5303`, `API_PORT=8923`.

## How to change code here

- **Tighten only.** A fix may refuse more, record more or show more; it never removes a refusal, loosens a cap, or
  changes what the owner sees without filing it. Write the failing test first, then the smallest fix.
- **Design-level or product-visible?** File it (Inbox of the owning lane, plus a line under Notes here) with your
  proposed default, and move on.
- **Agent SDK:** don't change `query()` options or any other Claude Agent SDK call (the repo asks for the claude-api
  skill before touching it, which you don't have). Tests around it are fine.
- **No live spending:** never call live ad APIs, never spend CJ points, never connect a real store. At most one short
  real-engine run in the whole lane (CH-16). Tests use the fake engine (`FRONTLINE_AGENT_ENGINE=fake`).
- **Codex homes:** never run `codex login`, and never point the app at your own `~/.codex` (spawnCodex refuses it).

## Notes (owner questions; work goes on with the default)

- Q1 Should Codex runs count toward a store's daily AI budget? Today they report `costUsd: 0` (`codex.ts` ~262), and
  `runs.ts` ~285 cites decision 12 for team budgets. Default: no behaviour change; confirm it's intended and say so.
- Q2 A Codex CLI version with new on-by-default features: warn (default) or switch in-app Codex off until re-qualified?
- Q3 Run `pnpm e2e` in GitHub Actions too? Default: not added (needs the owner's yes).

## Inbox
<!-- other lanes append requests here: - [ ] (from <lane>) <request> -->

## Items

### Phase A — the money path (owner's pick 1)
Files: `apps/server/src/routes/agents-actions.ts`, `agents-outcomes.ts`, the onDecision/onApproved block of
`apps/server/src/routes/agents.ts`, `apps/server/src/approvals.ts`, the budget sections of `packages/agents/src/runs.ts`,
the approval and cap-counter sections of `packages/agents/src/tools.ts`, `apps/server/src/product-research/caps.ts`,
`call()` in `apps/server/src/connectors/cj.ts`, `requestDraftProduct` in `apps/server/src/product-research/pipeline.ts`,
`apps/server/src/kb/autonomy.ts`.

- [x] CH-01 Map every path from an agent's request to a live write: requestApproval, propose_ad_change,
  propose_price_change, request_approval, the onApproved dispatch, applyAdChange, applyPriceChange, addProducts,
  publishDraft, requestDraftProduct, the KB `kb.research` budget reservations, run budget shares, autopilot caps.
  Write the map under Done (one line per path: guard → write → what's recorded). `pnpm check` baseline green.
- [ ] CH-02 A change that never happened gets scored: `applyAdChange`'s early return (bad payload / missing store,
  `agents-actions.ts` ~101) writes no `not-applied:` marker, so `checkAdOutcomes` (`agents-outcomes.ts` ~62-69) scores
  it and its "outcome" reaches store memory and KB evidence (KB-19). Mark it not-applied; test first. Check the
  price and product paths for the same gap.
- [ ] CH-03 Approved but never applied: the live write runs in `setImmediate` after the row says `approved`
  (`agents-actions.ts` ~16-35); a failure is only logged and nothing replays or flags it after a crash or quit. Smallest
  tightening fix if one exists (for example: on start, mark approved rows with no applied/not-applied record as not
  applied, with a visible note); otherwise file it with that proposal.
- [ ] CH-04 CJ daily cap race: `refusal()` runs before `await turn()` and `recordCall` only after the fetch
  (`cj.ts` ~82-84), so calls queued at the same moment all pass the cap (`caps.ts` ~41-48). Reserve before waiting;
  a test with concurrent calls proves the cap holds.
- [ ] CH-05 Sweep the rest of the map from CH-01 for the same classes: check-then-act races, caps counted after the
  spend, early returns that skip a record, amounts trusted from the agent. Fix each confirmed one (test first) or file
  it. Also settle Q1 above. The caps' "today" is machine-local midnight (`tools.ts` ~1661-1684), not the store's
  timezone: file only (Settings owns timezones).

### Phase B — the open agent fixes (owner's pick 3)
Files: `packages/agents/src/memory.ts`, `prompt.ts`, `runs.ts` (only the AGT-246 binding-cap flag), the
`request_approval` section of `tools.ts`, a test next to `claude-engine.ts`, `docs/backlog/agents.md`. These items come
from a review "traced against sdk.d.ts, not yet run": check each claim before fixing. Tick them in `agents.md` with a
dated Done line there too.

- [ ] CH-06 AGT-247: `parseLearnings` finds the array's own closing `]` (`memory.ts` ~167 uses `lastIndexOf(']')`, so
  "See step [2]." after the array drops every learning).
- [ ] CH-07 AGT-248: memory and niche-learning lines go through the existing `oneLine()` (`prompt.ts` ~27; raw
  `m.text` at ~75 and ~91), so a memory can't forge a line labelled as the owner's preference.
- [ ] CH-08 AGT-249: the prompt's memory room counts the memory header and the "Scheduled jobs" and "Waiting for the
  owner" sections (`prompt.ts` ~88-125).
- [ ] CH-09 AGT-246: a run stopped at the agent's own daily budget says so. Record which cap was binding when the run
  was seated (`runs.ts` ~202-209, ~411-413) and pass it on; don't re-derive it. AGT-244 just reworked this path: keep
  every runs test green.
- [ ] CH-10 `request_approval` with `store.add_products` refuses a product whose `compareAt` is at or below its price,
  as `record_find` and `propose_price_change` already do (agents.md Inbox line ~48; `tools.ts` ~503, ~1130, ~1214).
- [ ] CH-11 AGT-245 already shipped (`claude-engine.ts` ERRORS/ACCOUNT) but nothing tests it: add the test, tick it.

### Phase C — the app's own Codex runtime (owner's pick 4)
Files: `packages/agents/src/codex.ts`, `fake-codex.ts`, `codex.test.ts`, `packages/agents/src/fixtures/codex-*`,
`apps/server/src/routes/agents-codex.test.ts`, a new `apps/server/src/routes/agents-codex-surfaces.test.ts`, the
`CODEX_TESTED` line in `packages/shared/src/runtime-registry.ts` (additive), the AGT-19 line in `agents.md`. You are
the Codex CLI: read your own `exec --json` event shapes, `features list` and resume flags instead of guessing. Bugs
found in runs, teams or product-research code go to that lane's Inbox.

- [ ] CH-12 A failed or refused call to one of the app's own tools vanishes (`codex.ts` ~219
  `if (it.server === 'frontline') return [];`). Make it a visible tool error; fixes limitation 1 in
  `docs/features/ai-agents-report.md`.
- [ ] CH-13 `featuresChanged` (~80-83) only checks the known-off list, so a new on-by-default feature in an untested
  CLI version passes. Detect it and warn in the Codex status (Q2 default); test with a fixture.
- [ ] CH-14 Fake-Codex tests through the real MCP endpoint for the paths nothing tests: a team with a Codex member, a
  Product Research task on a Codex config (find out first whether it's meant to be refused, `tasks.test.ts` ~98), and
  a Store Developer theme loop (read_theme_files → draft_theme_change → a `store.publish_theme` approval, stubbed
  theme connector, no 2-minute wait).
- [ ] CH-15 Close AGT-19 under Blocked in `agents.md`: superseded by the shipped `codex.ts` runtime (theme work
  reaches Codex through the app's tools).
- [ ] CH-16 One short live turn on a demo store that calls an app tool and finishes, then one resume. Replace the
  guessed lines in `CODEX_TURN` (`fake-codex.ts` ~62-81) with what was recorded. Needs the app's own Codex home signed
  in (the owner did it for AA-25b). If it isn't signed in here, or your sandbox blocks the nested run, write the exact
  owner step under Blocked and go on.

### Phase D — automatic browser tests (owner's pick 5)
Files: new `e2e/**`, `playwright.config.ts`, root `package.json` (scripts + devDependencies only), `pnpm-lock.yaml`,
`.gitignore`. Read-only on `apps/**` and `packages/**`: app bugs found go to the owning lane's Inbox.

- [ ] CH-17 Harness: `@playwright/test` + `@axe-core/playwright` as devDependencies (owner approved), Playwright
  channel `msedge` (no browser download). Global setup builds the web app and starts the real server on a free port
  with a temp `FRONTLINE_DATA_DIR`, `FRONTLINE_AGENT_ENGINE=fake`, a temp `FRONTLINE_CODEX_WORK` and
  `FRONTLINE_WEB_DIR=apps/web/dist`. `pnpm e2e` runs it; it stays out of `pnpm check`. Nothing touches the network.
- [ ] CH-18 Route smoke: every `nav.ts` route plus `/agents/:id`, `/agents/c/:id`, `/agents/t/:id`, at 390, 1280,
  1440 and 1920 px: no console errors, no 4xx/5xx `/api` responses, no error fallback, no sideways scroll. Assert
  structure, not numbers (the demo emitter is random).
- [ ] CH-19 Axe scan per route: serious and critical findings fail, with today's issues in a baseline file (filed to
  the owning lanes, not fixed here).
- [ ] CH-20 Fake-engine flows end to end: approve a seeded approval, message an agent and see the fake reply, open a
  Knowledge Base card, open a Research product. Done = `pnpm e2e` green twice in a row.

### Phase E — ready for the first real store (owner's pick 7)
Files: `apps/server/src/connectors/meta.ts`, `google.ts`, `tiktok.ts`, `common.ts`, `cj.ts` (request/response shapes
only), `packages/agents/src/kb-perf.ts`, `apps/server/src/kb/performance.ts`, `apps/server/src/kb/experiments.ts`.
Not the Shopify/WooCommerce writers, not `connectors/ads.ts` (money path).

- [ ] CH-21 Ad-level reads (added by KB-20) must not stop spend syncing: in `meta.ts` the `/ads` edge and `level=ad`
  insights share the campaign insights' try, and the catch (~169-171) marks the whole integration as an error;
  `google.ts` ~118-125 and `tiktok.ts` ~111-114 await ad-level reads before writing anything. Campaign spend still
  syncs when an ad-level read fails, and the failure stays visible in the integration status. Recorded-response tests.
- [ ] CH-22 Contract check against each platform's current official API reference (web search): request paths,
  fields, pagination, rate limits, error mapping for Meta, Google Ads and TikTok (campaign and ad level), and CJ's
  shapes. A checklist per connector under Done; fix mismatches with recorded-response tests. Recorded fixtures stay
  authoritative over docs where they disagree; note it.
- [ ] CH-23 KB statistics: a simulation test feeds data with no real effect through `learn()` (`kb-perf.ts`) and the
  experiment reader (`experiments.ts` ~116-118) and counts false "measured" results. Record the rate before and after
  adding a Benjamini-Hochberg correction at 10% (or a same-direction-in-two-periods rule) and a sane `minSample`
  floor (today it can be 1, ~50). Keep KB-26's acceptance test passing with a realistic effect.

### Wrap-up
- [ ] CH-24 Report `docs/features/codex-hardening-report.md`: per phase what was found, fixed (commit), filed (where)
  and left; answers to Q1-Q3 as defaults taken; the owner's remaining steps. Then `.agent/STOP` and stop.

## Done

- 2026-10-28 CH-01 write-path audit: baseline `pnpm check` green (228 files / 1,688 tests); all existing other lane worktrees have `.agent/STOP`; Settings remains hands off.
  - `requestApproval`: current autonomy + store activation/currency guards → durable pending approval → decision event and owner notification; only trusted callers opt into autopilot, whose computed amount is counted synchronously before yielding.
  - `propose_ad_change`: scoped campaign, no duplicate pending request, active status, daily budget, ±/30% raise guard, three-day window, FX amount and added-spend cap → `ads.set_budget` / `ads.pause_campaign` approval → payload captures from/to, added USD and evidence. FX awaits leave earlier duplicate checks stale (CH-05).
  - `propose_price_change`: scoped product, platform, cost/fee floor, ±30%, compare-at, overlapping price/page tests and pending requests → `store.set_price` approval → from/to and evidence recorded.
  - `request_approval`: dedicated-action denylist, product title/price/cost/platform/duplicate guards → `store.add_products` approval; other unsupported actions stay manual. Agent-provided amount cannot opt into autopilot. Compare-at gap belongs to CH-10.
  - `onApproved`: DB-scoped decision event + in-process duplicate set + activation guard → deferred dispatcher → failures only logged, no durable dispatch completion/recovery (CH-03).
  - `applyAdChange`: payload/store, freshness, local drift and connector checks → live account then local campaign → failed/stale/no-op markers except earliest returns; approved rows without a marker reach outcome memory/KB (CH-02).
  - `applyPriceChange`: payload/store, freshness and local drift → platform setter or demo update → `price_tests`; failures have `not-applied`, earliest returns do not, and missing demo products can create a test (CH-02).
  - `addProducts`: store, valid positive price/title, existing product tests and in-flight title claims → remote drafts or demo products → `product_tests`, PR outcome links, developer run; missing/invalid/failed creates have no marker (CH-02).
  - `publish_page` / `publishDraft`: scoped validated draft + platform and overlap checks → approval, in-flight guard, platform push → published timestamp/local activation; failure notifies and retains approved draft. Theme draft copies precede approval; publish approval → platform publish → `theme-live` or `not-applied`.
  - `requestDraftProduct`: supported platform, existing store link, base economics price and pending title match → synchronous approval creation → PR product id in payload, later linked to created draft.
  - `kb.research`: controls, role, cooldown, task/approval duplicates and reserved daily budget → pending approval or task → `kb_tasks` reservation, bounded run budgets; approved-to-task deferred gap temporarily releases pending reservation (CH-05).
  - Run budgets: queue seats reserve store shares before the next seat, narrowed by agent/team/config/task budgets → engine budget plus spend-triggered cancellation → `agent_runs.cost_usd`/transcript; paused runs release shares and reporting can overshoot a cap. Codex reports zero measured USD; Claude-only team accounting is explicit decision 12 (Q1, CH-05).
  - Creative generation: used + pending credit cap → approval, recheck and synchronous charge before render → creative or failure with credits retained. CJ: refusal before queue, HTTP fetch, then `pr_calls` → simultaneous callers can overbook the daily cap (CH-04).

## Blocked
