# Local browser checks

Run `pnpm e2e` with Microsoft Edge installed. No browser download is required. The global setup builds the web app, starts the real HTTP/WebSocket server on a free loopback port, and uses a fresh temporary data directory, fake agent engine and temporary Codex work directory. It closes that server after the run. Temporary data is left to the OS to clear, as in the unit-test setup.

The test server omits production scheduler/sync loops and rejects outbound fetches. Browser contexts block requests outside the test server. No real credentials, stores, ad APIs, CJ points or model turns are used. Test failures retain screenshots and traces in ignored `test-results/`.

These tests stay separate from `pnpm check` and GitHub Actions. The harness follows Playwright's [global setup](https://playwright.dev/docs/test-global-setup-teardown), [Edge channel](https://playwright.dev/docs/browsers#google-chrome--microsoft-edge) and [axe integration](https://playwright.dev/docs/accessibility-testing) documentation.
