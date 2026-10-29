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

- CH-23 follows the requested BH 10% correction and 30-per-side experiment minimum. Filed the matching UI minimum/help and historical-evidence review to KB Inbox. No historical rows are rewritten. Correction families are each store/settled performance window, and each store/exact experiment window among the eligible plans evaluated together; this is not cross-window or lifetime control. The existing Poisson/log approximation omits order-value variance, and dependent comparisons limit formal FDR guarantees.

- CH-22 contract follow-ups filed to Store Analytics: Google conversion metrics are not purchase-only and can be fractional; TikTok Branded Mission/Upgraded Smart+ coverage needs explicit dataset semantics. Meta v24.0 reaches its published Marketing API cutoff on November 10, 2026; a coordinated read/write upgrade is filed to core and Store Analytics. Browser fallback resolved the documentation-reader failures.

- 2026-10-28 Phase E ownership rechecked: Settings and Store Analytics are running. Acknowledged SA-01 claimed revenue helpers and syncTikTokShop; none are edited. CH-20 remains unchecked only for mobile acceptance, while CH-21/22 are active; clarified the phase window in Store Analytics Inbox. Forwarded the CH-18 Integrations overflow to its new Settings owner.

- CH-13 filed to AI Agents Inbox: a nonblocking status warning needs an additive shared field plus UI rendering outside Phase C. Q2 default remains warn; no misuse of the disabling reason field.

- CH-03 filed in `docs/backlog/agents.md` Inbox: durable action execution state with an "unknown after interruption" outcome and owner reconciliation, no automatic replay. An absent marker cannot prove no live write occurred; existing successful ad writes also lack receipts. Default is no recovery behaviour change until that design is implemented.
- CH-05 design/ownership filings: agents Inbox (agent/team share overbooking, concurrent theme copies, duplicate product batches and numeric validation), KB Inbox (approval→task reservation gap), Product Research Inbox (queued CJ calls crossing UTC midnight), core Inbox for Settings (store-zone cap resets). Proposed defaults are included in each filing; current policies remain.
- Q1 resolved from AI Agents decisions 9 and 12 (`docs/backlog/ai-agents.md`): Codex records tokens, has no measured USD charge and is intended to be bounded by Stop-after, not dollar caps; no cost behaviour change. Filed a contradictory shared admission/seating refusal to that lane because removing it would loosen a guard.

- Q1 Should Codex runs count toward a store's daily AI budget? Today they report `costUsd: 0` (`codex.ts` ~262), and
  `runs.ts` ~285 cites decision 12 for team budgets. Default: no behaviour change; confirm it's intended and say so.
- Q2 A Codex CLI version with new on-by-default features: warn (default) or switch in-app Codex off until re-qualified?
- Q3 Run `pnpm e2e` in GitHub Actions too? Default: not added (needs the owner's yes).

## Inbox
<!-- other lanes append requests here: - [ ] (from <lane>) <request> -->
- [x] (from store-analytics) store-analytics claims rebuildRevenue, setOrderItems, setStoreTimezone and forgetPlatform in connectors/common.ts and syncTikTokShop in connectors/tiktok.ts (your Lane keeps hands off what Store Analytics claims). Everything else in your Phase E files stays yours; we file changes to it in this Inbox.
- [x] (from settings, ST-02) Settings is now `/settings/<section>`, and the app-nav Integrations item points at
  `/settings/integrations` (`/integrations` redirects there with its query). The route smoke follows `NAV`, so it now
  visits `/settings/integrations`, and its axe snapshot is named `settings-integrations.json`: same single finding as
  `integrations.json` (the shared Hero's `.hover\:text-text`), so a rename. Please also add the shipped `SECTIONS`
  routes (`apps/web/src/settings/Layout.tsx`: `/settings/{account,notifications,general,stores,usage,data}`) to the route
  smoke only. Later Settings items add slugs; ST-37b will file `/settings/integrations/:id`.
- [x] (from settings, FYI) On a `core.autocrlf=true` checkout every axe snapshot compare fails: the index has LF, the
  worktree CRLF, the content is identical (seen on untouched `/orders` too). A `.gitattributes` line
  `e2e/axe-baseline/*.json text eol=lf` would fix it.
- [x] (from store-analytics) CH-19 Analytics axe filing fixed (commit "store-analytics: Inbox axe names"): the 12 Research links on Analytics and the shared Ask AI control (`Hero.tsx`, name now "Ask AI anything, Ctrl K": axe counts the visible Ctrl K hint) report no serious/critical violations, so `accessibility /analytics` and the 13 other pages whose baseline lists `.hover\:text-text` now fail only on their stale baselines (actual `[]`); please refresh those 14 files in `e2e/axe-baseline/`. Also: a fresh checkout with core.autocrlf writes the baselines CRLF and every scan mismatches on line endings alone; an `e2e/axe-baseline/*.json eol=lf` attribute would stop that.

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
- [x] CH-02 A change that never happened gets scored: `applyAdChange`'s early return (bad payload / missing store,
  `agents-actions.ts` ~101) writes no `not-applied:` marker, so `checkAdOutcomes` (`agents-outcomes.ts` ~62-69) scores
  it and its "outcome" reaches store memory and KB evidence (KB-19). Mark it not-applied; test first. Check the
  price and product paths for the same gap.
- [x] CH-03 Approved but never applied: the live write runs in `setImmediate` after the row says `approved`
  (`agents-actions.ts` ~16-35); a failure is only logged and nothing replays or flags it after a crash or quit. Smallest
  tightening fix if one exists (for example: on start, mark approved rows with no applied/not-applied record as not
  applied, with a visible note); otherwise file it with that proposal.
- [x] CH-04 CJ daily cap race: `refusal()` runs before `await turn()` and `recordCall` only after the fetch
  (`cj.ts` ~82-84), so calls queued at the same moment all pass the cap (`caps.ts` ~41-48). Reserve before waiting;
  a test with concurrent calls proves the cap holds.
- [x] CH-05 Sweep the rest of the map from CH-01 for the same classes: check-then-act races, caps counted after the
  spend, early returns that skip a record, amounts trusted from the agent. Fix each confirmed one (test first) or file
  it. Also settle Q1 above. The caps' "today" is machine-local midnight (`tools.ts` ~1661-1684), not the store's
  timezone: file only (Settings owns timezones).

### Phase B — the open agent fixes (owner's pick 3)
Files: `packages/agents/src/memory.ts`, `prompt.ts`, `runs.ts` (only the AGT-246 binding-cap flag), the
`request_approval` section of `tools.ts`, a test next to `claude-engine.ts`, `docs/backlog/agents.md`. These items come
from a review "traced against sdk.d.ts, not yet run": check each claim before fixing. Tick them in `agents.md` with a
dated Done line there too.

- [x] CH-06 AGT-247: `parseLearnings` finds the array's own closing `]` (`memory.ts` ~167 uses `lastIndexOf(']')`, so
  "See step [2]." after the array drops every learning).
- [x] CH-07 AGT-248: memory and niche-learning lines go through the existing `oneLine()` (`prompt.ts` ~27; raw
  `m.text` at ~75 and ~91), so a memory can't forge a line labelled as the owner's preference.
- [x] CH-08 AGT-249: the prompt's memory room counts the memory header and the "Scheduled jobs" and "Waiting for the
  owner" sections (`prompt.ts` ~88-125).
- [x] CH-09 AGT-246: a run stopped at the agent's own daily budget says so. Record which cap was binding when the run
  was seated (`runs.ts` ~202-209, ~411-413) and pass it on; don't re-derive it. AGT-244 just reworked this path: keep
  every runs test green.
- [x] CH-10 `request_approval` with `store.add_products` refuses a product whose `compareAt` is at or below its price,
  as `record_find` and `propose_price_change` already do (agents.md Inbox line ~48; `tools.ts` ~503, ~1130, ~1214).
- [x] CH-11 AGT-245 already shipped (`claude-engine.ts` ERRORS/ACCOUNT) but nothing tests it: add the test, tick it.

### Phase C — the app's own Codex runtime (owner's pick 4)
Files: `packages/agents/src/codex.ts`, `fake-codex.ts`, `codex.test.ts`, `packages/agents/src/fixtures/codex-*`,
`apps/server/src/routes/agents-codex.test.ts`, a new `apps/server/src/routes/agents-codex-surfaces.test.ts`, the
`CODEX_TESTED` line in `packages/shared/src/runtime-registry.ts` (additive), the AGT-19 line in `agents.md`. You are
the Codex CLI: read your own `exec --json` event shapes, `features list` and resume flags instead of guessing. Bugs
found in runs, teams or product-research code go to that lane's Inbox.

- [x] CH-12 A failed or refused call to one of the app's own tools vanishes (`codex.ts` ~219
  `if (it.server === 'frontline') return [];`). Make it a visible tool error; fixes limitation 1 in
  `docs/features/ai-agents-report.md`.
- [ ] CH-13 `featuresChanged` (~80-83) only checks the known-off list, so a new on-by-default feature in an untested
  CLI version passes. Detect it and warn in the Codex status (Q2 default); test with a fixture.
- [x] CH-14 Fake-Codex tests through the real MCP endpoint for the paths nothing tests: a team with a Codex member, a
  Product Research task on a Codex config (find out first whether it's meant to be refused, `tasks.test.ts` ~98), and
  a Store Developer theme loop (read_theme_files → draft_theme_change → a `store.publish_theme` approval, stubbed
  theme connector, no 2-minute wait).
- [x] CH-15 Close AGT-19 under Blocked in `agents.md`: superseded by the shipped `codex.ts` runtime (theme work
  reaches Codex through the app's tools).
- [ ] CH-16 One short live turn on a demo store that calls an app tool and finishes, then one resume. Replace the
  guessed lines in `CODEX_TURN` (`fake-codex.ts` ~62-81) with what was recorded. Needs the app's own Codex home signed
  in (the owner did it for AA-25b). If it isn't signed in here, or your sandbox blocks the nested run, write the exact
  owner step under Blocked and go on.

### Phase D — automatic browser tests (owner's pick 5)
Files: new `e2e/**`, `playwright.config.ts`, root `package.json` (scripts + devDependencies only), `pnpm-lock.yaml`,
`.gitignore`. Read-only on `apps/**` and `packages/**`: app bugs found go to the owning lane's Inbox.

- [x] CH-17 Harness: `@playwright/test` + `@axe-core/playwright` as devDependencies (owner approved), Playwright
  channel `msedge` (no browser download). Global setup builds the web app and starts the real server on a free port
  with a temp `FRONTLINE_DATA_DIR`, `FRONTLINE_AGENT_ENGINE=fake`, a temp `FRONTLINE_CODEX_WORK` and
  `FRONTLINE_WEB_DIR=apps/web/dist`. `pnpm e2e` runs it; it stays out of `pnpm check`. Nothing touches the network.
- [ ] CH-18 Route smoke: every `nav.ts` route plus `/agents/:id`, `/agents/c/:id`, `/agents/t/:id`, at 390, 1280,
  1440 and 1920 px: no console errors, no 4xx/5xx `/api` responses, no error fallback, no sideways scroll. Assert
  structure, not numbers (the demo emitter is random).
- [x] CH-19 Axe scan per route: serious and critical findings fail, with today's issues in a baseline file (filed to
  the owning lanes, not fixed here).
- [ ] CH-20 Fake-engine flows end to end: approve a seeded approval, message an agent and see the fake reply, open a
  Knowledge Base card, open a Research product. Done = `pnpm e2e` green twice in a row.

### Phase E — ready for the first real store (owner's pick 7)
Files: `apps/server/src/connectors/meta.ts`, `google.ts`, `tiktok.ts`, `common.ts`, `cj.ts` (request/response shapes
only), `packages/agents/src/kb-perf.ts`, `apps/server/src/kb/performance.ts`, `apps/server/src/kb/experiments.ts`.
Not the Shopify/WooCommerce writers, not `connectors/ads.ts` (money path).

- [x] CH-21 Ad-level reads (added by KB-20) must not stop spend syncing: in `meta.ts` the `/ads` edge and `level=ad`
  insights share the campaign insights' try, and the catch (~169-171) marks the whole integration as an error;
  `google.ts` ~118-125 and `tiktok.ts` ~111-114 await ad-level reads before writing anything. Campaign spend still
  syncs when an ad-level read fails, and the failure stays visible in the integration status. Recorded-response tests.
- [x] CH-22 Contract check against each platform's current official API reference (web search): request paths,
  fields, pagination, rate limits, error mapping for Meta, Google Ads and TikTok (campaign and ad level), and CJ's
  shapes. A checklist per connector under Done; fix mismatches with recorded-response tests. Recorded fixtures stay
  authoritative over docs where they disagree; note it.
- [x] CH-23 KB statistics: a simulation test feeds data with no real effect through `learn()` (`kb-perf.ts`) and the
  experiment reader (`experiments.ts` ~116-118) and counts false "measured" results. Record the rate before and after
  adding a Benjamini-Hochberg correction at 10% (or a same-direction-in-two-periods rule) and a sane `minSample`
  floor (today it can be 1, ~50). Keep KB-26's acceptance test passing with a realistic effect.

### Wrap-up
- [x] CH-24 Report `docs/features/codex-hardening-report.md`: per phase what was found, fixed (commit), filed (where)
  and left; answers to Q1-Q3 as defaults taken; the owner's remaining steps. Then `.agent/STOP` and stop.

## Done

- 2026-10-28 CH-24: published docs/features/codex-hardening-report.md with phase findings, shipped commits, owner filings, Q1-Q3 defaults and remaining steps. Verified all local links and 26 referenced commits. pnpm check green (246 files / 1,850 passed, 4 upstream todo). CH-13/16/18/20 remain explicitly blocked; latest expanded browser run is 106/109 with three documented mobile overflows, all flows/axe comparisons passing. After ship/vault logging, this finite lane creates .agent/STOP; no new items.

- 2026-10-28 CH-18/19 Inbox follow-up: added six shipped Settings section routes to smoke only (22 routes x 4 widths), renamed the Integrations baseline for /settings/integrations, and scoped LF attributes inside e2e/axe-baseline. Reviewed the upstream ecd3a3bc fix and all baseline differences: 27 fixed targets removed, no new target accepted; 21 serious remain (KB 17, four agent store switches), zero critical. All 16 normal axe checks and four flows pass. Complete pnpm e2e: 106 passed / 3 failed; Integrations now passes all widths, while the newly covered /settings/data has +239 px mobile overflow alongside the two known +46 px agent pages. Filed the new Settings finding; kept strict assertions. pnpm check green (243 files / 1,816 passed, 4 upstream todo).

- 2026-10-28 CH-23: five failing regressions first (two null simulations, two invalid minima and one legacy-plan evaluation). Fixed-seed 42 independent Poisson(100) purchases with equal spend/$1 orders: false measured performance readings fall from 22/400 (5.5%) to 0/400; experiments from 7/200 (3.5%) to 0/200. BH at 10% is computed before recording the batch, with the existing 95% gate retained and invalid p-values failing closed. Experiments enforce 30 per side at parse and evaluation, including old plans. Normal-tail quantiles and BH's largest passing rank are tested. KB-26's unchanged realistic-effect acceptance passes; one older aggregation fixture now supplies the required 30 purchases without changing its ROAS. Method reference: [R stats p.adjust](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/p.adjust.html); normal-tail approximation A&S 26.2.17 (two-sided error below 1.5e-7). This one deterministic null batch is a regression measurement, not a universal false-discovery guarantee. pnpm check green (243 files / 1,816 passed, 4 upstream todo).

- 2026-10-28 CH-22 contract audit (no live calls; existing fixtures retained). Seven failing CJ/TikTok regressions first, then 74 focused connector tests and pnpm check pass (240 files / 1,786 tests). New regressions are contract-shaped fakes, not live captures. Official references checked today:
  - Meta checklist: GET account currency/timezone, campaigns, ads and campaign/ad insights; selected ids/status/budget/creative/action fields, daily time ranges and paging.next match the [official account SDK](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adaccount.py), [insights fields](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adsinsights.py) and [response/paging implementation](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/api.py). Graph errors stop reads; code 190/401 remains auth-specific, other errors remain visible. The browser rendered the [Insights reference](https://developers.facebook.com/documentation/ads-commerce/marketing-api/insights), [rate limits](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/) and [Marketing changelog](https://developers.facebook.com/docs/marketing-api/marketing-api-changelog/). Insights hourly limits are 600/190,000 + 400 per active ad - 0.001 per user error, depending on access; management is 300/100,000 + 40 per active ad. CPU/wall-time and business-use-case headers also apply; rate errors remain visible without immediate retries. The changelog lists v24.0 through November 10, 2026. Filed a coordinated version upgrade because the same constant also drives writes; retained tested v24.0 for this audit.
  - Google checklist: v26 POST googleAds:search, OAuth bearer/developer token/optional manager header, campaign/ad_group_ad fields, cost micros, conversions/value, nextPageToken and unchanged paged query match [REST search](https://developers.google.com/google-ads/api/rest/common/search), [headers](https://developers.google.com/google-ads/api/rest/auth) and [v26 ad fields](https://developers.google.com/google-ads/api/fields/v26/ad_group_ad). No pageSize (fixed 10,000); [quotas](https://developers.google.com/google-ads/api/docs/best-practices/quotas) vary by access tier and return RESOURCE_EXHAUSTED/429. Existing nested error mapping surfaces failures without retry loops. Filed conversion-versus-purchase semantics; changing the metric model belongs to Store Analytics.
  - TikTok checklist: v1.3 GET campaign/get, ad/get and report/integrated/get, Access-Token, advertiser id, BASIC campaign/ad levels, JSON dimensions/metrics, page/page_size and page_info remain consistent with the [official campaign SDK](https://github.com/tiktok/tiktok-business-api-sdk/blob/main/python_sdk/docs/CampaignCreationApi.md), [ad SDK](https://github.com/tiktok/tiktok-business-api-sdk/blob/main/python_sdk/docs/AdApi.md) and [report SDK](https://github.com/tiktok/tiktok-business-api-sdk/blob/main/python_sdk/docs/ReportingApi.md). HTTP-200 nonzero code failures remain visible. [Rate limits](https://business-api.tiktok.com/gateway/docs/index?doc_id=1740029171730433) are endpoint/app-tier dependent; no universal unlimited assumption or immediate retry. The current portal also advertises v2.0 reporting; no speculative migration away from the tested v1.3 contract. Browser-rendered [report reference](https://business-api.tiktok.com/portal/docs/run-a-synchronous-report/v1.3) and [ad reference](https://business-api.tiktok.com/portal/docs/get-ads/v1.3) confirm 1,000-row pages, 30-day daily-report chunks and attribute metrics. Fixed the [default deleted-entity exclusion](https://business-api.tiktok.com/gateway/docs/index?doc_id=1751443956638721) with campaign_status/ad_status STATUS_ALL filters; two regressions require historical spend at both levels. Filed Branded Mission advertiser-only coverage and Upgraded Smart+ ad_id/ad_id_v2 semantics for dataset design. Basic rate tier is 10 QPS/600 QPM; endpoint/app limits and suspension rules apply.
  - CJ checklist: api2.0/v1, CJ-Access-Token, JSON body, auth/product/stock/freight paths, listV2 page/size/content[].productList/totalRecords match [interface definition](https://developers.cjdropshipping.com/en/api/api2/standard/definition.html) and [product reference](https://developers.cjdropshipping.com/en/api/api2/api/product.html). [Error codes](https://developers.cjdropshipping.com/en/api/api2/standard/ps-code.html), [frequency limits](https://developers.cjdropshipping.com/en/api/start/limit.html) and [points rules](https://developers.cjdropshipping.com/en/api/api2/standard/points.html) confirm auth suspension, quota/rate distinction and pointsInfo. Fixed explicit result:false/malformed/missing-data success accounting and capped-size pagination. Compatibility with existing code 0/no-code envelopes remains; current docs show code 200. Cap reservations, pacing and secret redaction stay intact.

- 2026-10-28 CH-21: six failing regressions first. Meta, Google Ads and TikTok now commit campaign spend before optional ad reads/writes; an ad failure remains an integration error and retains the old cursor for complete retry. Existing 40 connector cases plus all six regressions pass. New responses are contract-shaped fakes, not live captures. pnpm check green (235 files / 1,747 tests, 4 workers). Settings and Store Analytics handoff filings included; their claimed functions untouched.

- 2026-10-28 CH-20 flow coverage shipped, acceptance blocked: real-UI seeded approval, fake agent reply, KB card and labelled Research fixture all pass. Two consecutive complete browser runs each have 82 passes / the same 3 CH-18 mobile overflow failures; all 16 accessibility scans pass both times. pnpm check green (234 files / 1,730 tests, 4 workers). Full-green criterion awaits the filed UI fixes.

- 2026-10-28 CH-19: axe scans all 16 routes at 1280x900, with labelled PR fixtures and a sample KB card. Reviewed selector-level baseline in e2e/axe-baseline: 48 serious label-content-name-mismatch targets across routes (shared controls repeat), zero critical, Ecosystem empty. Filed UI/Analytics/shared header, agent store switches and KB categories to their owners. Normal verification passes all 16 scans; any baseline difference fails. pnpm check green (234 files / 1,730 tests, 4 workers).

- 2026-10-28 CH-18 coverage shipped, acceptance blocked: 13 nav routes plus legacy agent/conversation/team at 390/1280/1440/1920 px. Real API seeds the sessions. 61/64 route cases and the harness pass; three 390px overflow failures are filed under Blocked and kept failing. Focused rerun confirms console/page/API checks pass on those three too. pnpm check green (234 files / 1,730 tests, 4 workers).

- 2026-10-28 CH-17: added Playwright/axe dev dependencies and pnpm e2e, Edge channel without downloads, built UI plus real HTTP/WebSocket server on port 0, temporary data/Codex work, fake engines, disabled server fetches and browser external requests, and teardown. One harness test passes; pnpm check green (234 files / 1,730 tests, 4 workers). Orca dashboard screenshot compared with reference: existing dark/red layout and plain header render correctly; no app UI changes. No CI wiring.

- 2026-10-28 CH-15: closed AGT-19 as superseded by codex.ts and the CH-14 MCP theme coverage. Documentation only; pnpm check green (234 files / 1,730 tests, 4 workers).

- 2026-10-28 CH-14: fake Codex over the real MCP endpoint now covers a team participant and synthesis handoff, a Product Research task (valid Stop-after is accepted; the earlier refusal lacked it), and theme read -> copy -> publish approval -> owner denial without waiting two minutes. Three focused tests and pnpm check green (234 files / 1,730 tests, 4 workers). No production changes or live calls.

- 2026-10-28 CH-12: two failing regressions proved CLI-side refusals and failed MCP results disappeared. Failed frontline calls now emit tool errors; successful calls remain endpoint-owned. Checked the 0.163.0 exec_events.rs contract and installed resume help. pnpm check green (233 files / 1,727 tests, 4 workers).

- 2026-10-28 CH-11 / AGT-245: confirmed all four account mappings already shipped; new adjacent tests cover immediate errors, isAccountError classification, nested-frame isolation, and result usage/session preservation. No SDK calls/options changed; 27 focused tests and pnpm check green (233 files / 1,725 tests, 4 workers).

- 2026-10-28 CH-10: generic product approvals refuse nonnumeric/nonfinite compareAt and values at/below price, allowing omitted or higher finite values. Five failing regressions first, then 16 focused tests. pnpm check green (232 files / 1,721 tests) with VITEST_MAX_WORKERS=4; unrestricted suite twice timed out in the unchanged Research scale test (filed to Product Research; isolated tests pass).

- 2026-10-28 CH-09 / AGT-246: capture the binding agent daily cap when seating a run and carry it into SDK budget-stop wording; a narrower research task clears that binding. Two failing regressions include a cap changed mid-run. All runs tests and pnpm check green (232 files / 1,714 tests).

- 2026-10-28 CH-08 / AGT-249: memory room now counts its header plus scheduled jobs and waiting requests. Busy-prompt regression was 643 estimated tokens over budget before; both cases fit after. Memory floor and owner priority preserved; pnpm check green (232 files / 1,712 tests).

- 2026-10-28 CH-07 / AGT-248: memory and niche-learning text/evidence use existing oneLine(), preventing forged owner lines via CR/LF or Unicode line separators. Regression failed first; pnpm check green (232 files / 1,710 tests).

- 2026-10-28 CH-06 / AGT-247: reflection parsing finds the array boundary despite trailing citations, quoted brackets and nested tags; prose [2] is skipped. Three failing regressions first, then 17 focused tests and pnpm check green (232 files / 1,709 tests).

- 2026-10-28 CH-05: two failing concurrent-call regressions proved duplicate ad/product approvals across FX awaits; ad pending/recent checks and generic product checks now run after that await. 61 focused tests and `pnpm check` green (231 files / 1,705 tests). Audited synchronous autopilot approval counters, pending ad reservations, pre-render credit charging and synchronous PR draft requests; filed remaining reservation/ownership/design cases listed in Notes. Q1 confirmed against decisions 9/12; no dollar-cost policy changed.

- 2026-10-28 CH-04: CJ reserves one `pr_calls` row synchronously before waiting, then updates its result; failed/interrupted calls keep the reservation. Four failing regressions proved concurrent ingestion/watch/dev-total overbooking and absent in-flight accounting; 31 focused tests and `pnpm check` green (230 files / 1,703 tests). No live requests.

- 2026-10-28 CH-03: traced approval commit → process event → deferred dispatch → log-only catch; filed durable execution/reconciliation design in agents Inbox. Automatic replay or labelling every unmarked historical approval not-applied would misrepresent possibly completed writes, so no speculative recovery was added.

- 2026-10-28 CH-02: ad/price/product early exits and empty/failed product creation now record `not-applied`; missing products start no price test, and empty creates start no developer run. Eleven failing regressions first, then 82 focused tests and `pnpm check` green (229 files / 1,699 tests).

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

- 2026-10-28 CH-20: all four requested flows pass. Original two complete runs were 82 passed / 3 failed. The expanded Settings handoff run is 106 passed / 3 failed (two agent pages and /settings/data at 390px). Whole-suite green twice remains blocked on Settings/AI Agents layout fixes; no exclusions, expected failures or threshold changes were added.

- 2026-10-28 CH-18 current state after Settings handoff: 85/88 route/width cases pass. At 390x900, legacy agent and conversation still overflow +46 px, and newly covered /settings/data overflows +239 px because of the long data-directory path. Filed to AI Agents and Settings. Integrations' prior +3 px overflow is resolved by ST-02 and passes all four widths. Console/page/API checks pass in every route case; strict overflow assertions still block CH-20.

- 2026-10-28 CH-16: no FRONTLINE_DATA_DIR override is set and this worktree has no .data/codex-home directory or auth.json. No live model turn, resume, login or personal-home access was attempted. Owner step: run this worktree app with WEB_PORT=5303 and API_PORT=8923 and no forced FRONTLINE_AGENT_ENGINE; in AI Agents -> Deploy an agent choose Codex -> Set up Codex and complete the browser sign-in (app home: C:/Users/Xody2/orca/workspaces/FrontlineEcom/codex-hardening/.data/codex-home). Then authorize/capture one demo-store turn asking only for store_summary and one short follow-up on that session. Replace the source-labelled CODEX_TURN lines with the captured, sanitized completed turn and resume; retain separate source-shaped coverage for rare events. Existing fixtures remain honestly labelled recorded/source. Installed CLI is 0.163.0; its isolated features list matches the recorded fixture and exec resume flags match the adapter.

- 2026-10-28 CH-13: unknown-on detection/status warning deferred to AI Agents. RuntimeCapabilities has no warning field; reason disables the runtime in configs.ts and UI. Implement the proposed field/rendering plus baseline feature fixture there; keep Codex available for unknown-on warnings and retain known-off refusal. No partial detector or silent status field shipped.
