# Local browser checks

Run `pnpm e2e` with Microsoft Edge installed. No browser download is required. The global setup builds the web app, starts the real HTTP/WebSocket server on a free loopback port, and uses a fresh temporary data directory, fake agent engine and temporary Codex work directory. It closes that server after the run. Temporary data is left to the OS to clear, as in the unit-test setup.

The test server omits production scheduler/sync loops and rejects outbound fetches. Browser contexts block requests outside the test server. No real credentials, stores, ad APIs, CJ points or model turns are used. Test failures retain screenshots and traces in ignored `test-results/`.

These tests stay separate from `pnpm check` and GitHub Actions. The harness follows Playwright's [global setup](https://playwright.dev/docs/test-global-setup-teardown), [Edge channel](https://playwright.dev/docs/browsers#google-chrome--microsoft-edge) and [axe integration](https://playwright.dev/docs/accessibility-testing) documentation.

## Accessibility baseline

The 2026-10-28 baseline uses Edge, axe 4.14.0 and 1280x900 on all 16 routes, including labelled Product Research fixtures and one sample Knowledge Base card. `axe-baseline/*.json` records serious/critical rule IDs and exact node selectors; any difference fails the ordinary run. Full axe results are attached to each test. Known findings are filed in the UI, AI Agents and Knowledge Base backlogs. No critical violations were found. These snapshots cover existing findings, not the separate mobile overflow failures.

After reviewing a real fix or intentional fixture change, update only the affected baseline with `pnpm e2e --grep "accessibility <route>" --update-snapshots` and review the diff. Do not use snapshot updates to accept new violations without filing and review.

## Known route failures

On 2026-10-28, two complete runs each had 82 passes and three failures: Integrations at 390 px overflows by 3 px, and the legacy-agent and conversation routes at 390 px overflow by 46 px. These strict tests remain enabled; `pnpm e2e` currently exits 1 until the owning UI/AI Agents lanes fix them. The four fake-engine flow tests and all 16 accessibility baseline checks pass. To run only the user flows: `pnpm e2e --grep "flow:"`.
