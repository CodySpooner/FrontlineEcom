# Local browser checks

Run `pnpm e2e` with Microsoft Edge installed. No browser download is required. The global setup builds the web app, starts the real HTTP/WebSocket server on a free loopback port, and uses a fresh temporary data directory, fake agent engine and temporary Codex work directory. It closes that server after the run. Temporary data is left to the OS to clear, as in the unit-test setup.

The test server omits production scheduler/sync loops and rejects outbound fetches. Browser contexts block requests outside the test server. No real credentials, stores, ad APIs, CJ points or model turns are used. Test failures retain screenshots and traces in ignored `test-results/`.

These tests stay separate from `pnpm check` and GitHub Actions. The harness follows Playwright's [global setup](https://playwright.dev/docs/test-global-setup-teardown), [Edge channel](https://playwright.dev/docs/browsers#google-chrome--microsoft-edge) and [axe integration](https://playwright.dev/docs/accessibility-testing) documentation.

## Accessibility baseline

The 2026-10-28 baseline uses Edge, axe 4.14.0 and 1280x900 on all 16 routes, including labelled Product Research fixtures and one sample Knowledge Base card. `axe-baseline/*.json` records serious/critical rule IDs and exact node selectors; any difference fails the ordinary run. Full axe results are attached to each test. Known findings are filed in the UI, AI Agents and Knowledge Base backlogs. No critical violations were found. These snapshots cover existing findings, not the separate mobile overflow failures.

After reviewing a real fix or intentional fixture change, update only the affected baseline with `pnpm e2e --grep "accessibility <route>" --update-snapshots` and review the diff. Do not use snapshot updates to accept new violations without filing and review.

## Known route failures

On 2026-10-28, the expanded suite has 106 passes and three failures: legacy-agent and conversation routes overflow by 46 px at 390 px, and `/settings/data` overflows by 239 px with the test data-folder path. The Settings move resolved the earlier 3 px Integrations overflow. These strict tests remain enabled and `pnpm e2e` exits 1 until the Settings/AI Agents owners fix the remaining layouts. All console/page/API checks, four fake-engine flows and 16 normal accessibility baseline checks pass.

Smoke covers the 16 navigation/agent routes plus six shipped Settings sections, each at four widths. Axe remains on the original 16-route set. After the upstream shared-header and Analytics link fixes, the reviewed baseline has 21 serious targets (17 KB category controls and four agent store switches), zero critical. `axe-baseline/.gitattributes` keeps JSON LF on Windows checkouts. To run only user flows: `pnpm e2e --grep "flow:"`.

Before the Settings handoff, two complete runs each had 82 passes and the old three mobile failures; CH-20's requirement for two completely green runs remains unmet.
