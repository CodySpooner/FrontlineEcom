# Codex hardening report

Date: 2026-10-28. Lane: `codex-hardening`. Scope: CH-01–CH-24, under the tighten-only and per-phase ownership rules in [the backlog](../backlog/codex-hardening.md).

The finite lane is finished with four items explicitly blocked: CH-13, CH-16, CH-18 and CH-20. Their acceptance criteria were not weakened or marked complete. Fixes, tests and owner filings are on `main`; the lane stops after this report. This is a code and fixture audit, not live-store qualification.

## Verification

- Report pre-commit `pnpm check`: 246 files, 1,850 passed and 4 upstream TODOs. The ship loop also checks the rebased commit before pushing. The suite uses fake engines and temporary data. Four TODOs belong to the incoming Store Analytics fixture work.
- Phase D originally ran the complete browser suite twice: each run had 82 passes and three mobile overflow failures. The four real-UI flows (seeded approval, fake chat reply, KB card, Research product) and all 16 axe scans passed both times.
- After the Settings route changes and upstream accessibility fixes, the browser handoff covers 22 routes at four widths, 16 axe baselines and four flows plus the harness. At the browser handoff based on `1cbb1618`, `pnpm e2e` finishes **106 passed / 3 failed**: legacy agent and conversation +46 px, and newly covered `/settings/data` +239 px, all at 390x900. Console/page/API checks pass even on those routes. Integrations now passes all widths. This final expanded run is not two green runs.
- Initial axe baseline: 48 serious target observations across routes, including repeated shared controls; zero critical. After reviewing all baseline differences against upstream `ecd3a3bc`, 27 fixed targets are removed and none added: **21 serious remain** (17 KB category controls, four agent store switches), zero critical. All 16 normal baseline checks pass.
- Every shipped item ran `pnpm check` before commit and again after rebase. Concurrent workers changed the total test count. Early Research scale-test timeouts were filed; a later Store Analytics commit increased that test's timeout while retaining its assertions. Final checks use `VITEST_MAX_WORKERS=16`.
- No live ad/store requests, CJ points, Claude turns or Codex turns were used. Public documentation was read with web search and Orca's browser. New connector regressions are explicitly contract-shaped fakes, not claimed live recordings.

## Phase A — approval, application and budget paths

| Item | Finding and result | Commit |
|---|---|---|
| CH-01 | Mapped approval guards, remote writes, application records and budget reservations; details remain under Done in the backlog. | `ca67b25c` |
| CH-02 | Early ad/price/product exits and failed/empty product creates could leave an approved action eligible for outcome learning. Added truthful `not-applied` records; missing products create no price test, empty creates start no developer run. Eleven failing regressions first. | `24bc0d7d` |
| CH-03 | Approval dispatch is deferred and process-local, with no durable completion/recovery record. Filed execution/reconciliation design; no unsafe automatic replay. | `39adb8e9` |
| CH-04 | Concurrent CJ callers passed the cap before waiting and recorded usage only afterward. Reserve a call slot synchronously before queueing and update its result afterward; failed/interrupted calls retain the reservation. Four failing regressions first. | `89277a02` |
| CH-05 | FX awaits made duplicate ad/product approval checks stale. Recheck after the await; two concurrent-call regressions. Other policy/ownership findings were filed. | `868d9035` |

Left with owners:

- [Agents Inbox](../backlog/agents.md): durable action states and reconciliation after interruption; unspent agent/team budget reservations; concurrent theme-copy claims; duplicate product titles and numeric validation within batches. An absent application marker cannot prove the platform write did not happen.
- [Knowledge Base Inbox](../backlog/knowledge-base.md): keep an approved research budget reserved until its deferred task creation, with a durable approval/task link.
- [Product Research Inbox](../backlog/product-research.md): transfer a queued CJ reservation safely if dispatch crosses UTC midnight.
- [Settings Inbox](../backlog/settings.md), forwarded through [core](../backlog/core.md): daily caps should use the intended store timezone. No timezone policy changed here.
- [AI Agents Inbox](../backlog/ai-agents.md): resolve runtime-independent dollar-cap admission for Codex consistently with the existing product decisions; hardening did not remove a refusal.

## Phase B — agent regressions

| Item | Fix or verification | Commit |
|---|---|---|
| CH-06 / AGT-247 | Find the reflection array boundary despite trailing citations, quoted brackets and nested tags. | `514d6e00` |
| CH-07 / AGT-248 | Normalize memory and niche-learning text/evidence with the existing `oneLine` helper so line breaks cannot forge an owner-preference line. | `c1c7f19a` |
| CH-08 / AGT-249 | Include the memory header, scheduled jobs and waiting requests in prompt room accounting. The regression previously exceeded its estimate by 643 tokens. | `eb1c8591` |
| CH-09 / AGT-246 | Capture which agent daily cap bound the seated run, preserving the correct stop explanation even if the cap changes during the run. | `3a3eeec5` |
| CH-10 | Refuse nonnumeric/nonfinite `compareAt` and values at or below the proposed product price. Omitted or higher finite values still pass. | `cc80fbac` |
| CH-11 / AGT-245 | The Claude account-error mappings already existed. Added tests for immediate errors, classification, nested-frame isolation and preservation of usage/session information. No SDK options or calls changed. | `b80a8b3f` |

The corresponding AGT items and the compare-at filing are closed in [agents.md](../backlog/agents.md). Broader budget and payload designs remain in the Phase A owner filings.

## Phase C — the app's Codex runtime

| Item | Result | Commit |
|---|---|---|
| CH-12 | Failed/refused frontline MCP calls now produce a visible tool error; successful calls remain owned by the MCP endpoint. Two regressions. | `f9afa300` |
| CH-13 | **Blocked.** Unknown enabled features need a nonblocking warning field and UI rendering. Existing `reason` disables a runtime, so using it would violate the warn default. Filed to AI Agents. | `24a20d12` |
| CH-14 | Fake Codex over the real MCP endpoint covers team participation/synthesis, Product Research with a valid Stop-after, and theme read/copy/publish approval followed by owner denial. | `b3743e63` |
| CH-15 | Closed AGT-19 as superseded by the shipped Codex adapter and theme coverage. | `a2aabe3e` |
| CH-16 | **Blocked.** This worktree has no signed-in app Codex home. Installed CLI 0.163.0 feature flags and resume arguments were inspected; no turn/resume recording was fabricated and the tested-version claim was not raised. | `24e18b5d` |

Owner step for CH-16: run this worktree with `WEB_PORT=5303`, `API_PORT=8923` and no forced `FRONTLINE_AGENT_ENGINE`. In **AI Agents → Deploy an agent → Codex → Set up Codex**, complete sign-in for the app home at `C:/Users/Xody2/orca/workspaces/FrontlineEcom/codex-hardening/.data/codex-home`. Then capture the already-requested short demo-store `store_summary` turn and one follow-up on that session. Sanitize the recording before replacing completed-turn/resume fixtures; preserve honest source labels for rare events. Do not use the personal Codex home or `codex login`.

## Phase D — browser and accessibility checks

| Item | Result | Commit |
|---|---|---|
| CH-17 | Edge Playwright harness, real local HTTP/WebSocket server, temporary seeded data, fake engines, external requests blocked, teardown; `pnpm e2e` stays separate from `pnpm check` and CI. | `5dc77297` |
| CH-18 | Route smoke at 390/1280/1440/1920 px checks headings, navigation, console/page/API errors and strict document overflow. **Blocked on app layout failures**, not test scaffolding. | `652410fa` |
| CH-19 | Sixteen axe scans with reviewed selector baselines; differences fail. Filed findings to UI, AI Agents and KB, then forwarded Analytics/Integrations to their new owners. | `cf130088` |
| CH-20 | Four fake-engine flows pass. **Blocked** because the whole browser suite did not pass twice. No skips, expected failures or relaxed overflow thresholds were introduced. | `ac3a0992` |
| Inbox handoff | Six new Settings section smoke routes; Integrations baseline follows its new URL; LF attributes confined to `e2e/axe-baseline`; reviewed baseline reductions after upstream fixes. | `08ee7acb` |

The Store Analytics worker fixed the shared Ask AI accessible name and Analytics Research-link names in `ecd3a3bc`. ST-02 also resolves the old Integrations overflow. AI Agents still owns the two +46 px conversation/legacy layout failures and its four accessible store names. Settings owns the newly found +239 px Data & Backups overflow; Knowledge Base owns its 17 category-name findings. See [the local browser README](../../e2e/README.md) and [the backlog's Blocked section](../backlog/codex-hardening.md) for current reproductions. Baselines are not a declaration that remaining serious findings are acceptable indefinitely.

## Phase E — connectors and statistical evidence

| Item | Result | Commit |
|---|---|---|
| CH-21 | Meta, Google Ads and TikTok commit campaign spend before optional ad-level reads/writes. Ad failure remains visible as an integration error, and the old cursor is retained for a complete retry. Six failing regressions first. | `b1f8d260` |
| CH-22 | Checked official paths, fields, pagination, quotas and errors for all four connectors. TikTok requests all statuses so deleted campaigns/ads retain historical spend. CJ refuses explicit failure/malformed/missing-data envelopes and calculates pagination using the actual capped page size. Seven failing regressions and three compatibility controls. | `5e1c81a3` |
| CH-23 | BH at 10% per store/window comparison family, retaining the existing 95% gate; experiment minimum 30 per side at both parse and evaluation, including legacy plans. Null simulations, quantile checks and the existing KB-26 acceptance pass. | `1cbb1618` |

The [CH-22 checklist under Done](../backlog/codex-hardening.md) links each official source and records compatibility choices. Existing CJ zero/no-code responses remain supported although current docs show code 200. No speculative platform-version migration or quota retry loop was introduced.

The official [Meta Marketing changelog](https://developers.facebook.com/docs/marketing-api/marketing-api-changelog/) lists the pinned v24.0 through **November 10, 2026** (read October 28). A coordinated upgrade is filed to core and Store Analytics: the same version constant controls reads and live ad writes. Qualify those fixtures before the cutoff. Google conversion metrics may include non-purchase actions and fractional attribution; TikTok Branded Mission and Upgraded Smart+ need explicit coverage/identity semantics. Those findings are filed to [Store Analytics](../backlog/store-analytics.md), which has recorded them in its source registry (`f3d3441e`); this does not complete live qualification.

### CH-23 before/after

Seed 42 generates 200 independent pairs of Poisson(100) purchase counts, with equal spend and $1 order values, so the true ROAS is identical. The performance test goes through the production reader into `learn`; the experiment test evaluates 200 actual stored plans.

| False "measured" result | Before | After |
|---|---:|---:|
| Performance ROAS readings | 22/400 (5.5%) | 0/400 (0%) |
| Experiment results | 7/200 (3.5%) | 0/200 (0%) |

These are false-positive proportions in one fixed null batch, not estimates or guarantees of FDR across all stores. BH families cover each store/settled performance window and each store/exact experiment window evaluated together. They do not provide lifetime or cross-window correction. The existing Poisson/log model omits order-value variance, and comparisons share data. The displayed 95% ranges remain unadjusted; the verdict additionally passes BH. [R's method reference](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/p.adjust.html) distinguishes FDR from the proportion of all tests that reject and describes dependence limitations.

No historical evidence was rewritten. [KB Inbox](../backlog/knowledge-base.md) holds the form minimum/help update and owner-reviewed treatment of older evidence. The existing workflow with a realistic effect remains unchanged and passes; an older aggregation fixture was raised from 20 to 30 purchases to meet the new minimum without changing its ROAS.

## Q1–Q3 defaults taken

- **Q1 — Codex dollar budgets:** existing AI Agents decisions 9 and 12 intend token/Stop-after limits with no measured USD charge (`costUsd: 0`). Kept that accounting. Filed the contradictory shared dollar-cap admission/seating refusal; removing it exceeded tighten-only authority.
- **Q2 — new enabled Codex features:** warn, keep the signed-in runtime available, retain known-off refusals. The necessary additive warning field/UI is blocked with AI Agents (CH-13); no silent partial detector shipped.
- **Q3 — browser checks in GitHub Actions:** not added. Local `pnpm e2e` is available; CI remains an owner choice.

## Remaining owner work

1. Coordinate the Meta v24 upgrade before November 10, and qualify the filed Google/TikTok metric and coverage semantics before relying on real-store totals.
2. Complete the app Codex sign-in/recording step and the nonblocking runtime warning field/UI (CH-16, CH-13).
3. Fix the remaining mobile layouts and serious accessibility names in the owner lanes; review baseline reductions and run `pnpm e2e` green twice to close CH-18/20.
4. Resolve durable approval reconciliation and budget reservation filings before trusting interruption recovery or concurrent cap enforcement end to end. Never blindly replay an approval with an unknown remote outcome.
5. Align the KB experiment form with the server floor and review the stated statistical/historical-evidence limits. Finish the queued-CJ midnight and store-timezone cap filings.

The lane adds no further backlog items after CH-24 and creates an empty `.agent/STOP` in this worktree.
