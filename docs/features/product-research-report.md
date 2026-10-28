# Product Research page: final report

Lane `product-research`, 2026-10-28.

- **Spec:** `docs/features/product-research.md`. The owner chose design concept A, the Product Discovery Workspace
  (`docs/reference/product-research-workspace.html`).
- **Backlog:** `docs/backlog/product-research.md` holds the decisions, every item's Done line and Notes, and the
  "Done when" map. Sources are in `docs/features/product-research-sources.md`.
- **Commits:** 35 on `main`, from 152f8e91 (lane setup) to 79b30c9d (PR-30), plus the PR-31 commit that adds this
  report.

## Status: not complete

Two lines of the completion checklist aren't met, and both wait on the owner:

- **Real ingestion: Blocked.** No source has returned live data. The dev database has no CJ key, no imported Google
  Trends file and no imported supplier feed, and `pr_calls` (every metered call) is 0. The CJ adapter, the Trends CSV
  import and the feed import are built and tested against recorded responses and fixture files only. Any one of these
  unblocks it:
  - the owner pastes a CJ API key in Integrations;
  - the owner uploads a Google Trends CSV;
  - the owner uploads a supplier feed.

  The exact steps are under **Blocked** in the backlog.
- **Demand evidence on real data: partial.** Every demand label's rule, and "catalog presence is never demand", are
  tested. In one test, 10,000 catalog products put 0 under "With demand evidence". None of it has run on a real
  observation set yet. It needs the owner's Trends CSV, or a connected non-demo store's orders.

Every other line is met. The PR-30 Notes in the backlog map each one to its tests or a recorded check.

- **Checks:** `pnpm check` passes (228 test files, 1,686 tests, run at PR-31) and so does `pnpm build`. The repo has
  no linter, so linting doesn't apply; it wasn't run and isn't claimed.
- **Live runs:** two kinds ran against real services (details under "Workflows run live"):
  - five pasted-link previews (PR-14);
  - one real Claude research run (PR-29), on a demo store.

  Everything else ran on the scripted agent engine, recorded responses and fixtures. Those are reported apart from the
  live runs.

## What was built

**Data:**
- A shared catalog: products, listings, variants and offers. Every offer row keeps its provenance (live, import,
  owner, supplier claim, fixture) and its check date.
- Evidence sets with their points and links, and per-store profiles, evaluations, stages and History.
- Tasks, append-only reports, economics, comparisons, briefs, outcomes, watches and alerts.
- The rank facts behind every sort and filter.
- The old Research data is carried over: saved lists become all-stores watches, and agent finds become listings with
  no numbers.

**Sources:**
- An adapter framework: capabilities, access state, connect steps, and rate and quota caps with backoff.
- A job runner. An auth failure is never retried; rate limits and timeouts back off up to a cap.
- The built sources: CJ, Google Trends CSV, the Trends API alpha (status only), the stores' own orders, TikTok
  Creative Center notes, supplier feeds, and pasted product links through the safe fetcher.

**Page (`/research`):**
- **Toolbar:** one store or All stores, search over titles, categories and supplier SKUs, ship-to, sort, and
  **Research a Product**.
- **Filters and views:** the store's research profile line, the filters and More filters, and the views All matches,
  With demand evidence, Newly discovered, Watchlist and Flagged.
- **Source strip:** each source's real state. **Source health** shows access, last sync, rate, quota, calls today and
  connect steps for each.
- **Cards:**
  - cost + ship to the ship-to (excl. duties) and fulfillment status with provenance;
  - the demand label with the set it came from, store fit and flags;
  - stage, watch, and the research state.

  Unknown is shown as unknown, never as zero. A fixture is labelled "Test fixture" and never counts as evidence.
- **Scale and access:** the grid is windowed for 10,000 matches. It has loading, empty, error, partial-outage and
  stale states, and it is keyboard-driven (/, Enter, Esc).

**Product panel:**
- **Overview:**
  - an assessment where each part stands on its own (demand, fulfillment, base economics, differentiation, risk) and
    evidence confidence;
  - the owner's notes and owner, links, outcomes, and the test brief.
- **Demand:** stored sets with their points, and the owner's Trends import and links.
- **Suppliers:** every offer with its own status, matches (Exact or Similar, with the owner's override), and watch
  this offer.
- **Economics:** base, conservative and optimistic scenarios. Each input shows its provenance, and the owner can
  override it.
- **Research:** this product's tasks, the activity of each run, reports, and Ask a specialist.
- **History:** every stage change with who made it and why.

**Research a Product:**
- **The dialog:** product link (with preview), store, an eligible agent (the Product Researcher or a custom role on
  it, or a new one through Deploy's configure-only mode), and instructions with templates.
- **The task:** Start creates one durable task, tied to an AI Agents conversation and run. It runs new, queued
  behind a busy agent, or separately on the same config. A repeat of the same request returns the same task.
- **The report:** the run saves it through the `save_research_report` tool, scoped to its own task and store.
  Reports are append-only.
- **Knowledge:** a real report's sourced claims become proposed Knowledge Base cards for the owner to review.

**Owner decisions:**
- Stages need a reason and are kept in History.
- Compare puts up to 4 products side by side on one ship-to and currency, and the comparison can be saved.
- The test brief can prepare draft products. That goes through the existing approval: approving makes a draft in the
  store, and nothing is published.
- Outcomes link a store product back to its research.

**Watchlists:**
- Products, offers and niches can be watched.
- Scheduled checks store their results, stay within a daily cap, and alert once per change.

**Security:**
- Every `/api/pr/*` route is store-scoped and sits behind the local Host/Origin guard.
- Untrusted text reaches an agent fenced as data (the shared `untrustedBlock`), and the page never renders it as HTML.
- Link previews go through the safe fetcher, with its SSRF, redirect, size and robots rules.
- Credentials stay in the encrypted integrations store.

## Sources and how each works

| Source | In the app | Verified live? |
|---|---|---|
| CJdropshipping API | Built: discovery and fulfillment, rate lane, quotas, error classes | No. Waits for the owner's free API key. Tested on recorded responses |
| Google Trends CSV export | Built: the owner uploads the file and links a query to a product | No. Waits for an export. Tested on fixture files |
| Google Trends API (alpha) | Status only: "Approval required" | No. Google hasn't granted access |
| The stores' own orders | Built: weekly units for a linked research product | No. Every store here is a demo store, and demo orders never count |
| TikTok Creative Center | Manual notes with link and date, never demand evidence | Not applicable: manual by design |
| Supplier feed CSV | Built: listings, variants and offers from the owner's file | No. Waits for a file. Tested on fixtures |
| Pasted product links | Built: through the safe fetcher | Yes, five checks at PR-14 (below) |

Not built, for the reasons in the sources doc:
- AliExpress, Amazon, Keepa, Meta Ad Library, Pinterest, eBay, Etsy and the TikTok research APIs: approval,
  payment, or terms that bar AI use.
- Scrapers such as pytrends and SerpApi: unsupported, never built.

## Workflows run live

- **Link previews (PR-14), 2026-10-28 15:12 UTC:** five previews through the safe fetcher, at $0. Nothing was signed
  in to or bypassed.
  - adafruit.com/product/3405 was read: title, $19.95 page price, SKU. Its CDN answered 404 for the image, so the
    card shows the neutral icon.
  - sparkfun.com/products/15096 was read after a redirect: title, $10.50, SKU, and the image was cached.
  - allbirds.com (twice) and brooklinen.com answered HTTP 429. The preview says the page "refuses to be read by
    tools: enter the details by hand", and never retries or poses as a browser.
- **One real research run (PR-29), 2026-10-28 17:58:07–17:59:35 UTC:**
  - **Setup:** product "silicone grooming brush" on the demo store Pawsome Gear; claude-opus-5-5, medium effort.
    It cost $0.4669 (175,153 input and 9,082 output tokens) over 9 tool calls, one of them a web search.
  - **The refused save:** the first `save_research_report` call was refused (a 63-character competitor price). The
    agent shortened it and the second call saved.
  - **The report:** it recommends Reject. It calls the store's data "simulated" and the attached data "fixture data,
    not evidence". It also saved 3 store memories and 2 proposed Knowledge Base cards.
  - **What it found:** the tool's 60-character limit wasn't stated in the tool's description, and the Research tab
    numbered a long run's last 6 steps from 1. Both are fixed and tested.

## Test results

- **`pnpm check`:** typecheck and every test, 228 test files and 1,686 tests, all passing. **`pnpm build`:** passes.
  **Linting:** the repo has no linter, so it doesn't apply.
- **Where the evidence is:** each "Done when" line names its test files in the backlog's PR-30 Notes. The server
  tests are in `apps/server/src/product-research/`, the page tests in `apps/web/src/pages/Research.test.tsx`, and the
  economics function's tests in `packages/shared/src/economics.test.ts`.
- **Click-through (spec §17):** 19 surfaces on the fake engine, including All stores. It found no control that does
  nothing and no console errors. The script's self-test catches a planted dead button.
  - Every disabled control waits for input in its own form: a save with nothing to save, Fetch preview with no link,
    Start research before its steps, Assign before a store is picked, and an agent marked "Not ready" with its
    reason.
- **Browser checks:**
  - **Viewports:** 1024×680, 1280×800, 1366×728, 1440×900 and 1920×1080, compared with the approved board (PR-28)
    with no console errors.
  - **Design review:** `styleseed-design-review` findings are fixed or answered in the PR-28 Notes.

## Screenshots

These are in `docs/reference/product-research-final/`, taken at 1440×900 on the fake-engine dev server. Every
product and offer in them is **fixture data** (the "Test fixture" label), except as noted.

| File | What it shows |
|---|---|
| `01-workspace.png` | The workspace for Pawsome Gear: toolbar, profile line, filters, views, source strip, cards. Fixture data |
| `02-panel-overview.png` | The panel's Overview, with each part of the assessment on its own. Fixture data |
| `03-panel-research-real-report.png` | The Research tab with the PR-29 run. The report is a real model run; the product and the store's data are fixture and demo data |
| `04-panel-suppliers.png` | Suppliers, every offer with its own status. Fixture data |
| `05-panel-economics.png` | Economics, incomplete because the selling price and the store's fees are unknown, not zero. Fixture data |
| `06-panel-history.png` | History: the stage change the research task made, with its reason. Fixture data |
| `07-research-dialog.png` | Research a Product. The agent shows "Not ready" because the dev server runs the demo engine |
| `08-source-health.png` | Source health: every source's true state, with none connected |
| `09-comparison.png` | Compare: two products, with the real report's risks. Fixture data |
| `10-all-stores.png` | All stores, including two pasted-link products (PR-14, live pages) |
| `11-workspace-1024x680.png` | The workspace at 1024×680. Fixture data |
| `12-all-stores-panel.png` | The panel in All stores. Fixture data |

## Limitations

- **Single-user local app.** There are no user accounts. The only protection is the local Host/Origin guard.
- **No source is verified live except pasted links.** CJ, Trends, the supplier feed and store orders are tested on
  recorded responses and fixtures only (see Status).
- **The one real run was on a demo store.** Its report correctly treats the store's data as simulated, so it shows the
  agent and tools working, not a real product decision.
- **Many shop pages refuse previews.** Shopify storefronts (allbirds.com, brooklinen.com) refuse tool reads with HTTP
  429 or 403, so the owner enters those details by hand.
- **Currency conversion uses stored daily rates.** When there is no rate for a currency, its costs stay unknown and
  are never shown as the unconverted amount.
- **Agent web fetches.** This limitation from the backlog is resolved: the ai-agents lane routed agent WebFetch
  through the same safe fetcher (AA-23). PR-26's SSRF tests cover the fetcher.

## What the owner does next

The Blocked section of the backlog gives each of these step by step:
- paste the free CJ API key in Integrations;
- upload one Google Trends CSV;
- optionally, upload a supplier feed and apply for the Trends API alpha.

Then delete `.agent/STOP` and ask for "run PR-29, then update the report". That reruns the live checks on real data
and turns the two lines above to done or partial with evidence.
