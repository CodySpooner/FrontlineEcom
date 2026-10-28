# Backlog — product-research lane (Product Research page redesign)

Repo rules: `CLAUDE.md` (worker loop, hard rules). The owner's full spec, verbatim, is
`docs/features/product-research.md`. It is the source of truth for *what*. This file is the *how* in this repo: the
chosen design, the decisions already made, lane ownership, the items and the completion checklist. The code survey
behind the decisions is `docs/features/product-research-codemap.md` (large: search it). Read all three and open the
approved board before PR-01.

## What the owner asked for (2026-10-28)

The spec asked for four design concepts on one artboard, then a stop for the owner's choice. The concepts were
A Product Discovery Workspace, B Research Terminal, C Opportunity Pipeline and D Store Intelligence Hub. The owner
picked A:

> i think i want to go with option a i think it looks the best

The spec then says (§16): build in tested increments, in this order: **Verified data foundation → Product discovery →
Product details → Store/agent submission → Research persistence → Comparison and economics → Watchlists and pipeline →
Knowledge feedback → Hardening.** Confirm a real source-to-database-to-interface path early. Keep a completion
checklist and recoverable checkpoints (the Done, Blocked and Notes sections below). Make routine decisions within the
approved scope yourself. For this unattended run: don't ask the owner and don't halt. Where the spec needs the owner
(credentials, approvals, paid services, destructive actions, significant scope changes), write it under Blocked with
exactly what the owner must do, skip that part, and take the next item (CLAUDE.md worker loop).

The honesty rules run through everything (spec §4, §7, §10, §17). Repeat them to yourself before each item:
- **Unknown is not zero.** A missing cost, price, shipping quote or signal is shown as Unknown and is never used as 0.
- **An estimate is not a measurement.** Every number says what it measures, where it came from and when.
- **A supplier claim is not independently verified evidence.** Supplier text and listing counts are labelled as such.
- **Google Trends is relative interest (0–100) for one request**, never search volume, units or revenue, and two
  separate exports are never compared with each other.
- **Catalog presence is not demand.** "Newly discovered" never means "trending".
- **No demonstration number appears as production evidence.** No dead buttons. No unavailable integration shown as
  connected.

## The design

The owner chose concept **A, Product Discovery Workspace**, on 2026-10-28: "i think i want to go with option a i think
it looks the best". Concepts B, C and D are not part of the build.

- `docs/reference/product-research-workspace.png` is the approved board, and `product-research-workspace.html` next to
  it is the same board as static HTML. Open the HTML for exact colours, type sizes, spacing and copy.
- `docs/reference/product-research-sources.png` / `.html` is the source-feasibility reference drawn with the concepts.
  Decision 4 below is the version of it that you build. Where the two differ, decision 4 wins.
- **Every product, price, date, store, agent name and signal on the board is a placeholder.** Never ship any of them.
  Production screens show real data or a truthful empty, setup or error state (spec §4, §17).
- **Board copy that is out of date.** The board says "Product Hunter". The app's name is now "Product Researcher"
  (ai-agents decision 2): read the name from `AGENT_ROLES`, never hardcode it. "Grooming Scout" on the board is an
  example of an owner-made custom role based on Product Researcher (decision 6).
- **The board's top bar, sidebar, "Ask AI" box and bell are the app's own Shell and Hero.** Don't rebuild them from the
  board. The page uses `Hero` like the other pages. The board's subtitle "Discover. Verify. Test." is Hero's subtitle.
- **House primitives vs the board.** Where a `ui.tsx` primitive draws differently from the board, match the board
  through a new opt-in prop or variant. Never change a primitive's default look, because other pages use it.
- The board was drawn at 1440 px wide. Where the rules below or the decisions differ from the board, follow them.
- **A control is shown only once the item that makes it work has shipped** (decision 1). Until then it is absent.

### Page frame (top to bottom, as on the board)

1. **Toolbar row:**
   - a scope switch, "All stores" and then the selected store (the app's store list; with several stores the second
     segment is a store picker);
   - search "Search products, categories or supplier SKUs" (server-side, over titles, categories, supplier SKUs);
   - "Ship to <country>", the destination every cost, delivery time and fulfillment status on the page is for (store
     scope: the profile's ship-to; All stores: decision 5);
   - "Sort": Best fit for <store> (store scope only, decision 11), Recently discovered, Strongest momentum (growth ratio
     within one set, decision 9), Lowest verified cost + shipping (excl. duties) (decision 8);
   - the primary red **Research a Product** button.
2. **Store research profile line** (store scope only): "Ranked for <store> · <niche> · <audience> · sells at <price
   band> · prefers <warehouse / delivery rule> · avoids <list>", and "Edit research profile" (decision 5). Unknown parts
   say "audience not set" and so on. In "All stores" this line is absent and store fit is not shown.
3. **Filter chips:** Category, Source, Warehouse, "Cost + shipping, excl. duties ≤", "Delivery ≤", Evidence age,
   Stage (store scope), Research (the execution state, store scope), and "More filters" (niche, supplier, supplier
   cost, shipping cost, store fit, flags, destination-specific availability). Each chip shows its value; a chip whose
   filter keeps unknowns says so ("unknown included"), and the owner can switch that off. Right-aligned: "<N> match ·
   filtered and sorted on the server".
4. **View tabs with server counts:** All matches, With demand evidence, Newly discovered, Watchlist, Flagged.
   "With demand evidence" counts only products with a qualifying demand set (decision 9). "Newly discovered" is catalog
   recency only and never says "trending" (spec §7).
5. **Source strip:** one item per configured source with its real state and last successful sync ("CJdropshipping
   catalog · synced 18 min ago", "Google Trends · CSV imports, 14 products", "TikTok Creative Center · manual notes
   only", or "<source> · test fixtures (not connected)" for dev fixture rows), and a "Source health" link to the
   source-health view (PR-11).
6. **Body:** the product grid, and the detail panel on the right when a product is open.
   - The grid is 3 columns at 1440 with the panel open, and reflows by the grid's own width (more columns with the
     panel closed, fewer on small windows). Nothing scrolls sideways down to the desktop minimum of 1024×680.
   - The panel is about 380 px; below about 1100 px of page width it opens as an overlay drawer.

### Product card (as on the board)

- Top: the **pipeline stage** pill (Discovered, Researching, Shortlisted, Sample review, Ready to test, Testing,
  Scaled, Rejected; store scope only), the watch toggle (eye), and the product image (from the image proxy, decision
  12; lazy-loaded, fixed aspect, a neutral icon when missing). Fixture rows carry a "Test fixture" pill.
- Name (two lines, then ellipsis with the full title in `title`), then "<source> · <category>" (a pasted link shows
  "Your link · <host>", an agent find "Agent find · <host>").
- Rows, label left and value right:
  - "Cost + ship to <country>, excl. duties": decision 8's figure, from one verified offer row, or **Unknown**. Never
    0 when a part is missing.
  - Fulfillment: one of the four statuses (decision 8) as a pill, then its conditions and date on a muted line
    ("M / Grey · CJPacket Ordinary · qty 1 · 27 Oct").
  - Demand: the demand class (decision 9), then the query, region and period on a muted line ("Trends "dog paw
    cleaner" · US · Nov 2025–Oct 2026", "query-level" when it is), or "Not checked yet".
  - "Fit for <store>" (store scope only): Strong / Medium / Weak / Unknown and the main reason ("Weak, battery").
  - Flags: "No flags found (rule checks only)", "Not checked yet", or the first flag as a warning pill (decision 10).
- Footer (store scope only): the **execution state** of its latest research task (decision 6's list), and the updated
  time. Pipeline stage (top) and execution state (footer) are separate fields that never stand in for each other (spec
  §10). In All stores the footer shows "<n> stores evaluating" when n > 0 (decision 5).
- The selected card has the red border. Cards are keyboard-reachable (decision 14).

### Detail panel (as on the board)

- Header: image, name, "<source> · SKU <sku> · Open listing" (external link, `rel="noopener noreferrer"`), the Stage
  select, the latest report state, and close (Esc).
- Tabs: **Overview, Demand, Suppliers, Economics, Research <n>, History** (spec §9). In All stores scope the panel
  follows decision 5 (no Stage, Research or Economics; "Assign to a store…").
- **Overview:** "Assessment, each part on its own": Store fit, Demand evidence, Fulfillment, Economics (base),
  Differentiation, Risk, each with its value and reason, then the evidence-confidence line that states its rule
  (decision 11). Then a Demand summary, the supplier offer summary and the latest research card, as on the board. For an
  agent find, a collapsed "Agent's estimates (not evidence)" block (decision 2).
- **Demand:** every observation set with platform, query, scope, region, period, metric, source and import or retrieval
  date. The chart draws only stored points, one set per chart (decision 9). The caption says "Relative interest
  (0–100), not search volume or sales" for Trends. A query-scope set shows "Confirm it's about this product". Manual
  sources (TikTok Creative Center) show their notes and "Add a note".
- **Suppliers:** offers per variant, destination, quantity and shipping method, each with its status, provenance,
  conditions and check time; stock per warehouse; MOQ and processing time; duties as "Unknown, left out of the figures
  above" unless the owner entered them; alternative suppliers marked Exact match or Similar (PR-20's rule);
  "Compare suppliers".
- **Economics:** the calculator (decision 13) with the three scenarios.
- **Research:** every research task and report for this product in the selected store, newest first, each with its
  recommendation, agent, date, "Open report" and "Conversation in AI Agents". Earlier reports stay readable. A report's
  recommendation shows a "Move to <stage>" button (decision 5).
- **History:** stage changes with who and why, watch events, offer and evidence changes, flag dismissals, merges and
  separations.
- Actions under the panel: **Research with an agent** (opens the Research a Product dialog with this product filled
  in), **Compare** (adds it to the comparison tray), **Watch**, **Draft test brief** (PR-22: an owner form prefilled
  only from stored data).

### Research a Product dialog (as on the board)

- A stepper: 1 Product link, 2 Store, 3 Agent, 4 Instructions. The owner can move freely between steps, and each
  step shows done / current / to do.
- **Product link:** the URL field and "Fetch preview". The preview card shows the extracted title, image, host,
  "read from the public page <time>", the page price marked "(not verified)", the variants seen, what the page didn't
  show ("Shipping not shown on the page"), and "Correct details · Add notes". Corrections and notes are kept as
  owner-provided and shown as such (spec §8). Every other outcome of decision 12 (unavailable, ambiguous, redirected,
  blocked, failed) says what it is and offers to fill the details by hand. It never turns into a successful extraction.
  A link that matches an existing listing says so and uses it.
- **Store:** a select of the app's real stores, and one line on the context it brings ("Brings <store>'s niche,
  <price band> and <n> knowledge cards", n counted from the KB for that store plus General). Changing the store clears
  an agent picked for another store.
- **Product research agent:** a radio list of the store's eligible agent types (decision 6), each with its name, a
  state pill (Available, Busy, Not ready with the reason), runtime · model · effort, and for a busy one what it is doing
  and decision 6's honest queue line (not the board's "yours would queue 2nd"). A busy row offers Queue after current
  work or Run separately. Under the list, "+ Create new Product Research agent" opens Deploy in configure-only mode
  (T1). A Demo-runtime row warns that its report will be a scripted example.
- **Instructions:** template chips (Full evaluation, Supplier check only, Competitor scan, Ad angles (proposals)) that
  fill the textarea, and the textarea itself (at least 5 rows, resizable). The text sent is exactly what is in the
  box.
- Footer: "Creates a research task you can follow here and in AI Agents. Nothing is bought, listed or published.",
  the real budget line (the selected agent's run budget from its config and what is left of the store's agent budget,
  from the AI Agents budget data; "No budget set" when there is none), Cancel, and **Start research**.
- The draft (link, preview corrections, store, agent, instructions) survives closing the dialog and a reload, per
  browser (decision 14).

### After Start (the board's right-hand card)

- The product's card and panel show the task's real execution state (decision 6). The progress card lists the run's
  real activity lines (the AI Agents activity events), never a scripted list of steps or invented progress text. The
  board's "step 3 of 5" is replaced by the latest real activity line.
- Links: "Open conversation in AI Agents" (the conversation URL helper) and "Cancel run" (the conversation's real stop
  action), shown only when they work. Retry appears on Not started, Interrupted and Failed.

## Decisions already made (coordinator's calls; change one only with a reason written under Notes)

1. **Lane scope and the running ai-agents lane.**
   - This lane builds the whole feature across web, server, agents and shared. The `ui` and `core` lanes are stopped,
     so their files that this feature needs are yours to edit (surgically, with tests): `apps/server/src/research.ts`,
     `db.ts` (append-only), `app.ts`, `index.ts`, `stores.ts`, `packages/shared`.
   - **The `ai-agents` lane is still running** (AA-16 to AA-27) and pushes to main. Its files (`apps/web/src/agents/**`,
     `components/Chat.tsx`, `apps/server/src/routes/agents*.ts`, `packages/agents/src/**`) are edited only at the touch
     points in decision 15. For anything else, append a request to the **Inbox** of `docs/backlog/ai-agents.md` and work
     behind a small interface until it lands. Never reformat or reorganise its files. If `../ai-agents/.agent/STOP`
     exists, or AA-27 is ticked, while one of your requests is still open, make that edit yourself as a surgical touch
     point with a test, and record it under Notes.
   - Sync often: `git fetch origin && git rebase origin/main` before every item and before every push. Conflicts in
     shared tails (`MIGRATIONS`, `APPROVAL_KINDS`, `useLive`) are expected: keep both sides, then run the tests.
   - **Migrations:** take the next free number when you write one (51 at 887e273e). A migration may change only until
     its commit is pushed; after that it is never edited (`db.ts:8`), and any later table, column or index is a new
     appended migration with a Notes line. If a rebase shows another lane took your number, renumber yours (never
     theirs) before pushing and let the upgrade path run on your dev database. Reset this worktree's own dev database
     (`apps/server/.data`) only if unavoidable and only before any integration row exists there; otherwise export and
     restore the `integrations` rows (same `secret.key`). Never touch the owner's app data directory.
   - **Code layout:** new code lives in `apps/server/src/product-research/**` and `apps/web/src/product-research/**`.
     **Every new route is under `/api/pr/`**, never `/api/research/<segment>`: the legacy `GET /api/research/:id`
     handler captures those (Hono runs handlers in registration order). Shared types go in a new
     `packages/shared/src/research.ts`, re-exported from `index.ts`; every new shared name starts with `Pr` (PrListing,
     PrSourceStatus, PrTask, PrReport…), never an existing `Research*` name.
   - New web hooks go in `apps/web/src/product-research/api.ts`. The only `api/client.ts` edit is T8. The old research
     hooks there (`useResearch`, `useLists`, `useListActions`, `useAddToStore`, `useSupplierSearch`) stay; list them
     under Notes for removal after AA-21.
   - **A control appears only once the item that makes it work has shipped.** Until then it is absent, not disabled.
     The item that builds a feature adds its control and the control's test (spec §17: no dead buttons).

2. **Existing functionality and user data.** The current page (codemap §1) is replaced; nothing the owner made is lost.
   - Keep `seedResearch` at boot and keep `research_products` as it is: the agents' demo mode reads it
     (`demoSupplierProducts`, `research_feed`, the scripted product_hunter). The old sample rows (ids without the
     `find-` prefix) never enter `pr_*` tables, never appear in discovery and never count anywhere.
   - **The owner's lists** (`product_lists`, `product_list_items`, including "Saved") are copied once into `pr_watches`,
     keeping each list's name (`list_name`), in boot code guarded by `once(db, 'pr:legacy-import')`. A saved sample row
     becomes a `legacy_sample` listing shown only in the Watchlist tab as "Sample data · not evidence". An item the
     owner un-watches after the import stays un-watched.
   - **Agent finds** (`find-*` rows, and new ones mirrored by T6) become `agent_find` listings: title, category, image
     and url only. **Their numbers never become offers, signals, fit inputs, sorts or counts.** They are kept in
     `transform_json` and shown only in a collapsed panel block, "Agent's estimates (not evidence)". T6 skips finds from
     runs on the demo engine.
   - Watching or un-watching a listing that has a legacy `research_products` id also adds or removes it in the "Saved"
     product list (created if missing), in `research.ts`, so the agents' `research_feed` keeps seeing what the owner
     saved (`saved_by_owner`).
   - Behaviours carried over, with their tests: the save toggle (now Watch), add-to-store as a `store.add_products`
     approval with `byHand` platform gating and the pending-request dedupe message, custom niches (`other:<slug>`), and
     the run and conversation links.
   - The old "AI Research" button is retired from the page. The "Daily product scan" automation is untouched.
   - Legacy endpoints `/api/research*` keep answering: agent tools call them in process (`routes/agents.ts:232-237`).
   - Remove the `NAV[3]!` position lookup (`Research.tsx:33`) in favour of a lookup by path.
   - **CLAUDE.md's "Demo mode first" rule does not cover discovery data.** No products, offers or signals are seeded
     for demo stores; with no source connected the page shows its first-use state, and Research a Product still works.

3. **Data model** (spec §13). PR-02 creates these tables in one migration (CREATE TABLE, ADD COLUMN, CREATE INDEX
   only), labelled `/* NN (product-research: PR-02 ...) */`, with an upgrade test in the `db.test.ts` style
   (`user_version`, `PRAGMA foreign_key_check`). Prefix every table with `pr_`. The columns below are the minimum.
   - **Shared catalog** (store-neutral unless a row is private, see below):
     - `pr_products`: id, title, category, image_ref, merged_into, created_at, updated_at.
     - `pr_listings`: id, product_id, store_id NULL, source, source_ref, url, canonical_url, title, category, image_ref,
       origin (`ingest`, `import`, `owner_link`, `agent_find`, `legacy_sample`, `fixture`), currency, region,
       first_seen_at, last_seen_at, retrieved_at, raw_hash, transform_json, status (`active`, `gone`, `blocked`).
       UNIQUE(source, source_ref).
     - `pr_variants`: listing_id, source_ref, sku, gtin, mpn, attributes_json, weight_g, dimensions_json.
       UNIQUE(listing_id, source_ref).
     - `pr_offers`: an offer **observation** for one variant, destination, quantity and shipping method: store_id NULL,
       supplier, unit_cost_minor, shipping_cost_minor, currency, delivery_days_min/max, processing_days, moq,
       ships_from, stock_json (per warehouse), restrictions, returns_note, provenance (`live`, `import`, `owner`,
       `supplier_claim`, `fixture`), checked_at. A new check inserts a row; the latest per key is current.
     - `pr_signals` (store_id NULL, platform, query, region, period_start, period_end, granularity, metric, scope
       `product` / `query` / `category`, origin `live` / `import` / `manual` / `fixture`, file_ref, retrieved_at) and
       `pr_signal_points` (signal_id, at, value, below_one). Only stored points are ever charted.
     - `pr_signal_links`: which products a query-scope set is linked to, and whether the owner confirmed it.
     - `pr_matches`: listing pairs judged `exact`, `similar` or `separate`, with the matching and differing fields, who
       decided, why and when. Merging never drops a listing.
     - `pr_product_facts`: PRIMARY KEY(product_id, destination, currency): cost_ship_minor, cost_ship_offer_id,
       fulfillment_status, fulfillment_checked_at, demand_class, momentum, demand_set_id, first_seen_at, evidence_at.
       The Rank step recomputes it and a daily pass applies the 7-day decay of decision 8. Every sort and filter of
       PR-09 reads it or `pr_evaluations`, with an index per key.
     - `pr_sources`, `pr_jobs`, `pr_calls`: source health (status, last_success_at, last_error, error_kind, quota_json,
       cursor_json, schema_hash), recoverable jobs (kind, source, status, attempts, next_attempt_at, checkpoint, error,
       started_at, finished_at) and the call ledger (source, purpose, at, ok).
   - **Private rows in shared tables.** Rows from a pasted link (`owner_link`), an agent find, a manual note or an
     owner-entered offer carry the store's `store_id`. Every read includes a row with a store_id only for that store; in
     All stores scope it shows with the store's name. Owner corrections to a preview live only in
     `pr_tasks.preview_json` and `pr_evaluations`; the shared row keeps only what the fetcher or adapter read.
   - **Store-private tables** (store_id NOT NULL, ON DELETE CASCADE, every read filters by it):
     - `pr_store_profiles` (decision 5), with `keywords_json` for owner-saved discovery keywords.
     - `pr_evaluations`: PK(store_id, product_id): stage, owner (who handles it), fit, fit_reasons_json,
       flags_json, flag_dismissals_json, notes, selling_price_minor (owner-set), updated_at.
     - `pr_stage_history`: from, to, reason, by (`owner` or a task id), at.
     - `pr_tasks` (decision 6): product_id, listing_id, url (as pasted), preview_json, instructions (exactly as typed),
       template, mode (`new`, `queue`, `separate`), type, conversation_id, run_id, config_id, not_started_reason,
       client_request_id with UNIQUE(store_id, client_request_id), created_at.
     - `pr_reports` (decision 7), append-only, with run_id, runtime and engine.
     - `pr_economics` (per product: inputs with provenance for base, conservative and optimistic), `pr_comparisons`,
       `pr_briefs` (decision 13 and PR-22 fields), `pr_outcomes` (links to `product_tests`, store products,
       experiments and KB cards, plus the context of spec §12).
   - **Watchlists:** `pr_watches` (store_id NULL means the owner's all-stores list; list_name, target_kind, target_id,
     prefs_json, last_checked_at, last_success_at, last_error) with UNIQUE(store_id, target_kind, target_id) and a
     partial UNIQUE(target_kind, target_id) WHERE store_id IS NULL; `pr_alerts` with UNIQUE(watch_id, dedupe_key).
     A store read returns `store_id = ? OR store_id IS NULL`; NULL rows can be written only in All stores scope and may
     target only shared rows.
   - **Idempotency:** every create a retry could repeat carries a client_request_id or a natural unique key, and the
     API returns the existing row on a repeat.

4. **Sources** (spec §4, §5). Every source is an adapter in `apps/server/src/product-research/sources/` that declares
   which questions it answers (discovery, demand, fulfillment), its fields, refresh interval, rate and quota, and its
   status: **Verified live integration** (only after a real call with real credentials succeeded and was recorded),
   **Credentials required**, **Approval required**, **Authorized import**, **Manual research only**, **Unsupported**.
   Fixture rows never move a source to Verified. PR-01 re-checks every source against the official docs and writes
   `docs/features/product-research-sources.md`, the feasibility matrix (fields, access method, auth, cost, quotas,
   coverage, update frequency, restrictions, status, checked date). Build these, in this order:
   - **CJdropshipping** (supplier data, fulfillment): extend `connectors/cj.ts` beyond `listV2` page 1 with paged
     discovery and checkpoints, product detail and variants, stock per variant and warehouse, and freight quotes per
     variant, destination, quantity and method. Take endpoint names and fields from CJ's official API docs, never
     guess. It shares one rate lane with order sync and agent searches (priority: order sync > owner actions >
     ingestion). Classify errors (auth, rate limit, quota, timeout, server, schema) so an auth failure stops the source
     until the owner fixes it. An unparseable price is "price not shown", never 0 (fix `cj.ts:110` for the new paths).
   - **Google Trends CSV import** (demand, Authorized import): the owner uploads an export from trends.google.com. Parse
     its header rows, "<1" values and the term and region in the column header; store the query, region, period,
     granularity and file; label every use "Imported from Google Trends, <date>".
   - **Google Trends API (alpha)**: an adapter that reports Approval required and stays off until the owner has access.
   - **Your own stores' orders** (measured demand for products a store already sells), **only for stores with
     `demo = 0`** (the server column). A demo store's orders are generated and never count.
   - **TikTok Creative Center**: Manual research only. The owner records notes with a link and date; nothing is fetched.
   - **Supplier feed import** (fulfillment, Authorized import): a CSV the owner is entitled to export from a supplier or
     a feed tool, mapped to listings, variants and offers with origin `import`. `checked_at` is the date stated in the
     file; a file without one gives provenance `supplier_claim`.
   - **Pasted product links**: the public page, read through the safe fetcher (decision 12), origin `owner_link`.
   - Not built (matrix only, with the exact requirement): AliExpress APIs, Amazon Creators API, Keepa (paid), Meta Ad
     Library, Pinterest Trends, eBay, Etsy. Scrapers and unofficial endpoints (pytrends, SerpApi, Creative Center
     scrapers) are Unsupported.
   - **What discovery ingests:** per store, the CJ categories mapped from its niche (a code table from `NICHES` and
     custom niches to CJ category ids and keywords, built in PR-05), the profile's included categories and the owner's
     saved keywords. Never the whole catalog.
   - **Caps**, in one constants module with tests, lowered to CJ's documented limits as PR-01 records them: at most 5
     pages × 20 results per query per day; at most 500 CJ calls a day for ingestion and 100 for watch checks; 1 page per
     "Search CJ for '<q>'" click; at most 3 calls per alternative-supplier search; one ingestion job per source at a
     time. `pr_calls` records every CJ call (token, ingestion, search, order sync). Use "points" only if CJ's docs
     define them.
   - **Pipeline** (spec §13): Retrieve → Validate → Normalize → Match/Deduplicate → Store Evidence → Evaluate
     Eligibility → Enrich → Rank → Display, as recoverable `pr_jobs` with checkpoints, pagination, bounded retries with
     backoff (at most 3 for timeouts and server errors, honouring Retry-After on rate limits, none for auth, quota or
     schema errors), partial-failure handling and caching. Schema-change detection: required fields missing or the
     payload shape hash changed → the source goes to "Schema changed" and stops, keeping its last good data.
   - Jobs run on a timer in the `startCompetitorWatch` shape (re-entrancy guard, per-day markers), never on page render.
     **In the dev app the timer is off unless `PR_INGEST=1`.** Page search searches the local database; "Search CJ for
     '<q>'" is an explicit, bounded fetch.

5. **Store research profile and scope** (spec §2, §6, §7).
   - `pr_store_profiles` holds audience, price band (min, max, currency), ship-to country (the default destination),
     preferred warehouses, maximum delivery days, avoided categories and terms, included categories and saved keywords.
     Defaults: the store's niche and currency, ship-to from its currency's main country (USD → US, GBP → GB, CAD → CA,
     AUD → AU; otherwise the owner picks), the rest unknown. "Edit research profile" edits it in a right-hand `Dialog`.
   - **Store scope** filters to the profile's included categories (unknown category kept and labelled) and ranks by
     fit. Price band, warehouse and delivery preferences affect fit only. Avoided categories and terms flag, never hide.
   - **All stores scope** shows the shared catalog only: no stage, fit, research footer or store-private action on
     cards; a card shows "<n> stores evaluating" when n > 0. In the panel, Stage, Research, Economics, Compare, Watch
     (store) and Draft test brief are replaced by **Assign to a store…**, which picks a store, creates its evaluation at
     Discovered (recorded in History) and switches to that store's scope. The owner's all-stores watch is the only
     private write in this scope. Ship to defaults to US until the owner picks, stored in `fe.research.shipTo`.
   - **Stage changes:** the only automatic move is Discovered → Researching when a research task starts (by = the task
     id). Every other stage change is the owner's. A report's recommendation shows as a "Move to <stage>" button the
     owner clicks.

6. **Agents** (spec §8, §11). There is no second agent registry.
   - **What the dialog lists:** one row per eligible agent type in the selected store: the built-in `product_hunter`
     seat ("Product Researcher", read from `AGENT_ROLES`) when the seat is enabled, plus each non-archived custom role
     for this store or all stores whose base role is `product_hunter`. Runtime · model · effort come from that type's
     most recent config in the store, else `seatDefault`. A fresh store lists exactly one row. One server endpoint
     returns the rows with their state, so the dialog doesn't fetch per row.
   - **State:** Available; **Busy** when any of that type's conversations in the store is running (the row names what
     it is doing); **Not ready** with the reason (seat disabled, budget spent, runtime not connected). The queue line is
     honest: "<n> queued in this conversation", plus "then waits for a free store slot (2 per store)" when the store's
     slots are full. Never show a position the run manager can't guarantee.
   - **Start:** an Available row starts a new conversation for the task. On a Busy row the owner chooses **Queue after
     current work** (a message to the running conversation: a queued run, never mixed into its objective) or **Run
     separately** (a new conversation with that conversation's config, revalidated). The mode is stored on the task.
   - **Create new Product Research agent** opens the AI Agents `Deploy` dialog in configure-only mode (T1): store locked,
     only eligible types, no objective field. It returns `{type, title, config}` without creating anything; the dialog
     selects it as "New: <type> · <runtime · model>", and Start sends it with the task. Runtime, model, effort,
     permissions and presets come only from Deploy; this page never picks a model.
   - **Server, one request** (`POST /api/pr/tasks`, behind STARTS): check the store, the type's eligibility and the
     conversation's store (404 or 409 otherwise); insert the task; compose the message; start the run with the task's
     client_request_id (`openConversation` for new and separate, `runs.start` with conversationId for queue); write
     conversation_id and run_id before returning. A repeat returns the same task; a repeat whose run never started
     starts it with the same id; a refusal (409) keeps the task as "Not started: <reason>" with Retry.
   - **The message** has four parts, the last two fenced as untrusted data (decision 12): a header naming the research
     task id and product id; the owner's instructions verbatim; the product facts (listing, offers, signals with their
     provenance, preview fields with their origin); and "Earlier in <store>": the current stage, the last 3 stage changes
     with the owner's reasons, each earlier report's recommendation, date and open questions, and the owner's notes
     (about 2,000 characters, this store's rows only). The whole message stays under the conversation limit of 20,000
     characters. The task row keeps the instructions exactly as typed.
   - **Status** is derived from the run (`stateOf`), never copied: Not researched; Not started (reason) · Retry; Queued
     (behind <conversation>, or waiting for a store slot); Running; Waiting for you; Awaiting approval; Report ready;
     Finished without a report; Interrupted (app restarted) · Retry; Failed · Retry; Cancelled. Waiting for you comes
     with AA-16.
   - KB retrieval happens in the run as it does today (`runs.ts:313`, then AA-17). Don't build a retriever.

7. **Research reports** (spec §9). The agent tool `save_research_report` (T4) saves one structured report per run:
   - Fields: recommendation (zod enum: Research further, Request a sample, Shortlist for testing, Monitor, Reject),
     summary, purpose, customer_problem, store_fit (text plus Strong / Medium / Weak), demand evidence, competitors[]
     (name or URL, price if seen, source), supplier_offers[] (an offer id or URL, with its provenance), risks[],
     next_steps[], evidence[] (claim, kind `measured` / `research` / `supplier_claim` / `hypothesis`, source reference),
     open_questions[], would_change_if, proposals[] (ad angles and differentiation, stored and shown as "Proposal, not
     evidence"). An empty array needs an `unknown_reason`.
   - The server accepts it only when the task's run_id is the calling run (or a run in its retry chain) and the store
     matches; product, listing and conversation come from the task row, never from the tool input. A second call from
     the same run gets "Report already saved for this run". Evidence citing a demo or fixture row is refused.
   - Reports are append-only, never edited or deleted, and a new one never hides an older one. A run that ends without
     calling the tool shows "Finished without a report" with the conversation link. Never parse free text into a report.
   - **Demo engine:** each report stores the run's runtime. A report from the demo runtime renders "Demo engine ·
     scripted example, not research", shows no recommendation pill, and never feeds the assessment, evidence
     confidence, sorts, stage suggestions, comparison or the KB. The dialog warns before Start on a Demo-runtime agent.

8. **Fulfillment status** (spec §6), one pure function with a test per branch. For the selected destination and
   quantity (1 unless the owner sets another):
   - **Fulfillment verified for selected conditions:** an offer with provenance `live` or `import`, for that destination
     and variant, with stock above 0 in the warehouse the quote ships from, unit cost and shipping cost known, MOQ at or
     below the quantity, and checked within 7 days.
   - **Supplier found—verification pending:** a supplier offer exists but one of those conditions is missing, the check
     is older than 7 days ("re-check due"), or the provenance is `owner` or `supplier_claim` (these never verify).
   - **Insufficient information:** no supplier offer at all (a pasted link with no supplier match, an agent find).
   - **Not eligible:** the supplier offers no method to the destination, every variant is out of stock in every
     warehouse that ships there, MOQ is above the quantity, or a restriction blocks the destination.
   - Always shown with the conditions (variant, destination, quantity, method) and the check date. A quote for one
     country never stands for another.
   - **"Cost + ship to <country>, excl. duties"** is the minimum, over offers that pass the Verified rule, of unit cost
     plus shipping cost **from the same offer row**, converted to the store's currency (the page's currency in All
     stores) with `convertRate` and its date. The muted line names that row's variant, method, quantity and date. No
     such row: Unknown.

9. **Demand evidence** (spec §7), one pure function with these thresholds (change one only with a Notes line):
   - **Insufficient history:** fewer than 26 weekly, 90 daily or 24 monthly points, or more than half the points "<1".
   - **Seasonal (peak <month>):** at least 104 weekly or 24 monthly points, the same calendar month in the top 10% in
     each of the last two years, and peak at least 2× trough.
   - **Isolated spike:** the maximum at least 3× the median, with fewer than 3 points above 2× the median.
   - **Recent acceleration:** the mean of the last 13 weeks (90 days) at least 1.3× the mean of the 13 before, with the
     earlier mean at least 5.
   - **Sustained interest:** median at least 20 and coefficient of variation at most 0.5.
   - Otherwise **No clear pattern**. Precedence is the order above. With no set: **Not checked yet**.
   - **Qualifies for "With demand evidence":** a product-scope set, or an owner-confirmed query-scope set, from a real
     Trends import, or orders from a store with `demo = 0`, in any class except Insufficient history. Category-scope
     sets, manual notes, CJ listed counts and "trending" flags, agent finds and fixtures never qualify. CJ's counts are
     labelled "popularity among CJ sellers".
   - **Momentum** = the last-13 over prior-13 ratio inside one set, labelled "growth ratio, not interest level". Raw
     0–100 values never sort or compare across sets. Two products' charts never share an axis.
   - **Newly discovered** = first seen within 14 days. **Evidence age** = the newest retrieved or checked time.
   - Every label shows platform, query, region, period and metric; a query-level or category-level set is labelled so.

10. **Eligibility flags** (spec §6): rule-based checks in the Evaluate step, each a flag with its reason, never a
    silent exclusion: brand and trademark terms (a maintained list), "compatible with <brand>" as **Compatibility
    reference, fit unverified** (a warning, not a brand flag), restricted or compliance-review categories (batteries,
    liquids and aerosols, cosmetics claims, supplements, children's products, electrical plugs, weapons, medical
    claims), and the store's avoid list. With no hit the card says "No flags found (rule checks only)", never "safe".
    The owner can dismiss a flag with a reason, kept in History.

11. **Assessment** (spec §10), rule-based, no model call, each rule tested:
    - **Store fit:** Weak on an avoid-list hit, an undismissed restricted flag, or verified cost + shipping above the
      price band's maximum. Medium when the category is outside the niche or included categories, delivery exceeds the
      profile's limit, or no preferred warehouse ships it. Strong when every known input passes. Unknown, "missing
      <fields>", when the price band or category is unknown.
    - **Demand evidence:** Strong (two or more qualifying sets, or own orders), Moderate (one), None; with the class.
    - **Fulfillment:** decision 8. **Economics:** decision 13's base scenario, or "Not assessed: set a selling price".
    - **Risk:** "<n> flags" listed, plus the latest non-demo report's risks; never Low / Medium / High.
    - **Differentiation:** the latest non-demo report's proposals, labelled "Proposal, not evidence", else "Not
      assessed yet".
    - **Evidence confidence** counts four types this build can produce: a qualifying demand set, a verified offer,
      complete base economics, and a non-demo report with at least one `measured` evidence item. Low 0–1, Medium 2,
      High 3–4, with the rule shown.
    - **There is no combined score.** "Best fit" sorts by fit (Strong, Medium, Weak, Unknown), then demand class
      (Sustained, Recent acceleration, Seasonal in season, Isolated spike, No clear pattern, Insufficient history, Not
      checked yet), then verified cost + shipping, nulls last. The old "AI Score" is not shown.

12. **URLs, fetching, images and untrusted content** (spec §8, §14).
    - A pasted URL must be http or https, at most 2,048 characters, with no credentials in it. Keep it exactly as pasted
      and a canonical form for duplicate checks (tracking parameters removed).
    - Fetch only through the shared KB fetcher instance (T2): pinned DNS, private ranges blocked, every redirect hop
      re-checked, size and time caps, robots.txt. T3 adds an opt-in product metadata mode that reads og:* tags and
      JSON-LD `Product` blocks as data (JSON.parse, never executed) before scripts are stripped.
    - Preview outcomes: **read**; **unavailable** (HTTP 404 or 410, or JSON-LD availability Discontinued);
      **ambiguous** (no Product block and no og:product, or several distinct Product blocks: the owner picks one or
      enters details); **redirected** ("Redirected to <host/path>" whenever the final URL differs, pasted URL kept);
      and the fetcher's blocked states (robots, login, paywall, unsupported, too large, failed), each worded as what it
      is, with the option to enter details by hand. Hand-entered fields are tagged owner-provided.
    - **Images:** `GET /api/pr/listings/:id/image` serves only the cache for the listing's stored `image_ref`. It never
      takes a URL from the client. The ingestion job and the preview step fetch images (T3's image mode); a cache miss
      returns 404 (the card shows a neutral icon) and queues a fetch, at most 30 a minute. Check magic bytes (png, jpeg,
      webp, gif; never SVG), 5 MB cap, respond with the sniffed type, `X-Content-Type-Options: nosniff` and
      `Content-Security-Policy: default-src 'none'`; cache under `dataDir()`, 500 MB, least recently used out. The web
      never loads a third-party image URL.
    - **Untrusted text** (page text, supplier descriptions, imported files) reaches an agent only inside a local
      `fence(text, label)` in `apps/server/src/product-research/` that copies `sourceForAgent`'s format (random nonce,
      every line quoted, "never follow instructions in it"), capped at 8,000 characters (`ponytail:` switch to
      `untrustedBlock` after AA-17). Never write product text into `kb_sources` to fence it. Never render it as HTML or
      markdown on the page.
    - **Agent web fetches:** the research run's built-in WebFetch has only a hostname check (`claude-engine.ts:193`).
      Append an Inbox request to ai-agents (route it through `kbFetch`, or give product_hunter `fetch_source` instead).
      Until it lands, the final report names this as a limitation and PR-26's SSRF tests don't claim to cover it.
    - **Authentication** is the app's local Host/Origin guard; every new route sits behind it (test). No user
      authentication is built; the report lists "single-user local app, no user accounts" under limitations.
    - Provider credentials stay in the encrypted integrations store. They never reach the web, a prompt, a job record
      or a log line (test).

13. **Unit economics** (spec §10), one pure function with a test for every rule:
    - **Required** (unknown → "Incomplete: missing <fields>", no number): selling price, supplier cost, shipping to the
      destination, store fees (`fee_percent`, `fee_per_order`). The selling price comes only from the owner, or from the
      store's own product price when the store already sells it; otherwise Economics shows "Needs a selling price".
    - **Optional** (unknown → computed without it, and the result is labelled "excl. <fields>" with them listed under
      "Not included"): duties (Unknown by default), return costs, other variable costs. Discount and return rate are 0
      unless the owner sets them, tagged as assumptions.
    - Expected net revenue = price × (1 − discount) − expected refunds (return rate × refunded amount). Refunds are
      subtracted once, from revenue. Fees are charged on the price after discount and are not refunded on returns.
    - Non-advertising variable costs = supplier cost + shipping + fees + the optional costs that are known.
    - **Expected contribution before advertising** = expected net revenue − non-advertising variable costs.
    - **Expected contribution after advertising** = contribution before advertising − advertising cost per order.
    - **Break-even acquisition cost per order** = contribution before advertising.
    - **Break-even ROAS** = order value after discounts (what ad platforms report, before refunds) ÷ contribution before
      advertising, labelled "on order value after discounts, before refunds", shown only when that contribution is above
      zero; otherwise "Not meaningful: contribution is not positive".
    - Conservative, base and optimistic start equal to base ("same as base") until the owner edits a field; there are
      no built-in spreads. Each input is tagged verified (a live or imported offer, with its date), owner, or assumption.
      One currency per view, converted with `convertRate` and its date. Omitted fixed costs are listed under the result.

14. **Interface behaviour** (spec §15).
    - Filtering, sorting and counts run in SQL on the full matching set, using `pr_product_facts` and `pr_evaluations`
      (the `catalog.ts` pattern), with cursor paging, 48 cards a page, more on scroll. Past a few hundred cards the grid
      keeps only rows near the viewport in the DOM. Every nullable sort key sorts **nulls last**.
    - URL state: `/research?store=&view=&q=&sort=&product=&tab=`. Filters, sort, view, panel tab, ship-to and the dialog
      draft persist per browser under `fe.research.*` (storage wrapped in try/catch). Import the ai-agents `useStored`
      hook; don't copy or move it.
    - Keyboard: `/` focuses search, arrow keys move through the grid, Enter opens a product, Esc closes the innermost
      layer and focus returns to the card. Visible focus everywhere.
    - **Distinct states**, each with its own wording: first use (no source connected yet: what to connect, and that
      Research a Product works now), no matching products (with the filters to clear), source disconnected, stale data
      (last success and why), partial outage (which source), metric unavailable (Unknown with the reason), research
      failed (the error and Retry).
    - Large catalogs, long titles, missing images and windows down to 1024×680 stay usable, with no sideways scroll.
    - **Dev data for screenshots:** a dev-only loader (`pnpm --filter server pr:fixtures`) writes the recorded fixtures,
      and a 10,000-row generator for scale checks, into this worktree's `apps/server/.data` only. It refuses when
      `FRONTLINE_DATA_DIR` points anywhere else or the server is packaged. Its rows have origin `fixture`, show a "Test
      fixture" pill on the card and panel, make the source strip read "<source> · test fixtures (not connected)", and
      never verify a source. A test proves no production path writes `fixture`. Screenshots taken with it are captioned
      "fixture data"; the board comparison is about layout and styling only.
    - **Click-throughs, screenshots and cdp-drive** run against a dev server started with `FRONTLINE_AGENT_ENGINE=fake`,
      so no real model turn happens by accident (recorded in Notes).

15. **Touch points in other lanes' files** (each surgical, with a test, and noted in the ai-agents Inbox when it is
    that lane's file):
    - **T1** `apps/web/src/agents/Deploy.tsx`: optional props `lockStore`, `types` (the type ids to offer) and
      `onSubmit({type, title, config})`. With `onSubmit`, Deploy validates, calls it instead of creating a conversation,
      hides the objective field and the Agent settings link, and doesn't navigate. Without the new props it behaves
      exactly as today (test).
    - **T2** `apps/server/src/routes/agents.ts:441`: export the shared `kbFetch` instance (or move it to its own module
      and import it back), so previews share the per-host gap and robots cache.
    - **T3** `apps/server/src/kb/fetcher.ts` (knowledge lane, finished): the opt-in product metadata mode and an image
      mode (magic-byte check, 5 MB), both off by default, with tests.
    - **T4** `packages/agents/src/tools.ts`, `roles.ts`, and the tool env wiring in `apps/server/src/routes/agents.ts`:
      the `save_research_report` tool. `runTools` grants it to every run whose role is `product_hunter`, whatever
      `config.tools` lists (existing configs and narrowed custom roles stored their tool list before the tool existed);
      test with an old config and a narrowed custom role. Two contract lines: "When the task names a research task id,
      finish by calling save_research_report once", and in checks: "No guaranteed-winner language and no sales or
      revenue projections; a recommendation is not a validated fact" (a roles test asserts both). Never set
      `agent_runs.mode` for product research (`research:` means a KB task).
    - **T5** `packages/agents/src/fake-engine.ts`: a `product_hunter` branch that, when the task names a research task
      id, calls `save_research_report` with a fixed scripted report. It runs in tests and for demo-runtime agents, whose
      reports decision 7 labels.
    - **T6** `apps/server/src/routes/agents.ts` `recordFind`: one call that mirrors a find into `pr_listings` (origin
      `agent_find`, store_id set, no numbers), skipped for demo-engine runs.
    - **T7** `apps/server/src/app.ts`: mount the new routes, `app.use('/api/pr/*', guard)` next to the existing guard
      mounts, a separate `PR_STARTS = /^\/api\/pr\/tasks$/` checked as `STARTS.test(p) || PR_STARTS.test(p)` (so AA-19's
      edit to `STARTS` never conflicts), and the Trends and supplier-feed upload routes in `LARGE`. Tests: the 11th start
      in a minute gets 429, a 1.1 MB body on a normal route gets 413, an upload up to the large limit is accepted.
    - **T8** `apps/web/src/api/client.ts` `useLive`: one branch that invalidates the research query keys on the new
      `research_task` live message. If AA-21 has rewritten `useLive`, follow its new pattern.
    - **T9** the `store.add_products` payload (`research.ts`, `agents-actions.ts`): an additive `prProductId`, so outcomes
      link back (spec §12).
    - Inbox requests (not edits) to ai-agents: a `product` ConversationContext kind (so the conversation shows "Opened
      from <product>"); agent WebFetch through `kbFetch` (decision 12); include `/api/pr/*` in AA-23's sweep.

16. **Live checks you may run.** Automated tests use fixtures, the scripted engine and fakes, never a live service.
    These live checks are allowed, each recorded under Notes with its time, calls and cost, and reported separately:
    - **At the start of every item**, check this worktree's dev database for `integrations.id = 'cj:global'`, an
      imported Trends set and an imported supplier feed. The first time one appears, run its live check before the next
      item and fix what it finds.
    - CJdropshipping with the owner's key: at most 200 calls in total, counted by `pr_calls` (which refuses the 201st).
    - The owner's Google Trends CSV and supplier feed, imported for real.
    - Up to five public product-page previews through the safe fetcher, on pages whose robots.txt allows it, as soon as
      PR-14 ships.
    - One real-engine research run: on a demo store, through Deploy's configure-only mode with runtime Claude, the model
      Deploy marks default (or the cheapest listed Claude model if that default is Fable), its default effort, and a run
      budget of $0.50, on a dev server started without `FRONTLINE_AGENT_ENGINE`. Notes and the report say the store's
      data was demo data.
    Nothing else live. Never sign in anywhere, create accounts, accept terms or spend money.

17. **Never, in code or in testing:** publish products, order samples, launch or change ads, spend money, subscribe to
    a service, edit a live store, contact a supplier or customer, bypass a login, paywall, CAPTCHA, robots rule or access
    limit, scrape, or delete the owner's data. Every action with consequences goes through an existing approval.

## Not in this build

- Connectors for AliExpress, Amazon, Keepa, Meta Ad Library, Pinterest, eBay and Etsy (matrix only, decision 4).
- A combined opportunity score (decision 11).
- Automatic ordering, sampling, publishing or ad creation of any kind.
- Image-similarity matching (images alone never make two products identical).
- User accounts or authentication beyond the local guard (decision 12).
- Cross-store sharing of private notes or research.
- Concepts B, C and D.

## Lane

- **Owns:**
  - `apps/web/src/pages/Research.tsx` and `Research.test.tsx` (replaced), a new `apps/web/src/product-research/**`;
  - `apps/server/src/research.ts` and its test, a new `apps/server/src/product-research/**`,
    `apps/server/src/connectors/cj.ts` and its test;
  - appended migrations in `db.ts`, the `/api/pr/*` mounts, guard and `PR_STARTS` in `app.ts` (T7), job start-up in
    `index.ts`;
  - the new `packages/shared/src/research.ts` and additive edits to `packages/shared/src/index.ts`;
  - the touch points in decision 15;
  - `docs/features/product-research*.md`, `docs/reference/product-research-*`, the Research section of `docs/DESIGN.md`
    (at the end), and this file.
- Ports: WEB_PORT 5243, API_PORT 8857 (already in your env).
- Commits: `product-research: PR-xx <what>`. Vault log: `Build Log/product-research.md`.
- **Merging and releases:** the owner has authorised workers to push to main after `pnpm check` (the CLAUDE.md worker
  loop). Never tag or cut a release, bump the app version, publish the desktop build or deploy: only the owner
  releases.
- Before your first push, commit the lane set-up files exactly as they are (spec, backlog, code map, boards, CLAUDE.md
  row, watchdog entry) if the coordinator hasn't already pushed them.
- **Ticking an item that is only partly possible** (waiting on the owner or on ai-agents): tick it as
  `(partial: <part> under Blocked)` and add that Blocked entry. Never tick the missing part.
- **At the start of every item:** `git fetch origin && git rebase origin/main`, then decision 16's check for the owner's
  inputs.

## Done when

This is the completion checklist. For each line, PR-31's report names the test file(s) or the recorded check (a
screenshot path or a Notes entry) that proves it. PR-30 treats a line with neither as not done.

- Every item is ticked (fully or partially, per the rule above), and every missing part sits under Blocked with the
  exact step the owner must take. `pnpm check` and `pnpm build` are green. The repo has no linter, so the report says
  linting doesn't apply rather than claiming it passed.
- Spec §16, line by line:
  - **Real ingestion:** an authorised source returned genuine data that was stored and displayed with accurate
    provenance (source, retrieved and observed times, currency, region). Live, not only fixtures: CJ with the owner's
    key, or a real Trends CSV and a real supplier feed the owner provided. If neither exists yet, this line is Blocked,
    not done.
  - **Demand evidence:** every demand label and chart traces to stored observations; catalog presence alone never puts
    a product under "With demand evidence" (tests). Shown working on a real observation set (the owner's Trends CSV or
    a non-demo store's orders); with fixtures only, this line is partial.
  - **Source failures:** auth failure, rate limit, timeout and schema change each end in a recoverable, explained state
    with no fabricated fallback data, and an auth failure is not retried (adapter tests with fakes).
  - **Manual submission:** a product link, a store, an eligible agent and a custom prompt create exactly one durable
    task holding all four, linked to the conversation and run (API test, repeated with the same client_request_id), in
    all three modes (new, queue, separate) and with a Deploy configure-only config.
  - **Busy agents:** Queue after current work queues a run behind the running one without touching it; Run separately
    starts a second conversation with the same config (scripted-engine tests).
  - **Store isolation:** another store's agent, task, report, notes, evaluation, watch, comparison, private listing and
    knowledge are refused in the backend (one table-driven sweep over every `/api/pr/*` route and the new tool).
  - **Research results:** the agent run (scripted) reads store-scoped knowledge, saves a report through
    `save_research_report`, and the report links to the right product, store, task and conversation.
  - **Deduplication:** the same URL pasted twice (with different tracking parameters) gives one listing; two variants
    of one listing stay separate; a similar-looking product from another supplier becomes a "Similar" candidate, not a
    merge.
  - **Economics:** missing required and optional inputs, mixed currencies, zero and negative contribution, and scenario
    changes are handled as decision 13 says (unit tests).
  - **Watchlists:** scheduled checks persist their results, respect their budgets and never send the same alert twice
    (tests with fake timers).
  - **Persistence:** reload, navigation and a server restart keep products, tasks, prompts, reports, watches,
    comparisons, stages and history, and tasks show their true state after a restart (Interrupted · Retry).
  - **Usability:** 10,000 products, 500 tasks, long titles, missing images, 1024×680 and keyboard-only use (jsdom tests
    with stubbed pages, plus browser screenshots).
- **Spec §17:** a click-through of the page, the panel, the dialog, the source-health view, compare and the test brief
  (on a dev server with `FRONTLINE_AGENT_ENGINE=fake`) finds no control that does nothing; every integration that isn't
  verified shows its true state; no demonstration or fixture number appears as evidence. Exceptions go in the report's
  limitations.
- The live checks of decision 16 that the owner's inputs allowed, reported separately from mocked tests.
- The page is checked in Orca's browser at 1280×800 and with headless Chrome over CDP at 1024×680, 1366×728,
  1440×900 and 1920×1080, compared with `docs/reference/product-research-workspace.png` (layout and styling only), with
  no console errors. Screenshots stay in `.agent/`.
- `styleseed-design-review` was run on the page and its findings are fixed or answered in Notes.
- **Final report:** `docs/features/product-research-report.md`. It opens with "Status: complete" only if every line
  above is met; otherwise "Status: not complete", followed by each Blocked or partial line and what it needs. Then:
  what was built, which sources work and how (live, import, manual, fixtures only), which workflows ran live, test
  results, screenshots in `docs/reference/product-research-final/` (captioned "fixture data" where they are), and the
  limitations, at least: single-user local app with no user accounts (the local guard only), agent WebFetch not routed
  through the safe fetcher (unless the Inbox request landed), and every source not verified live.
- Then create an empty `.agent/STOP` in this worktree and stop.

This lane is finite. When PR-01 to PR-31 are done, don't add new items (this overrides CLAUDE.md's "Backlog empty?"
rule). Put follow-up ideas under **Notes** for the owner. Ignore a watchdog nudge if `.agent/STOP` exists. **After
STOP**, the owner may delete `.agent/STOP` and ask for "run PR-29, then update the report": do only that, then recreate
STOP.

## Inbox
<!-- other lanes append requests here: - [ ] (from <lane>) <request> -->

## Items

### Verified data foundation
- [x] PR-01 **Audit, baseline and sources.**
  - `pnpm install`, then `pnpm check`: record the baseline (files, tests, time) under Done.
  - Before screenshots of `/research` in `.agent/before/`. Copy `cdp-shot.mjs` and `cdp-drive.mjs` from
    `../ai-agents/.agent/` and `ship.sh` from `../knowledge-base/.agent/` into `.agent/` (never commit them).
  - Confirm each decision against the code at HEAD using the code map. Record anything that is wrong under Notes, with
    the change you make to the decision.
  - Re-check every source in decision 4 against the official docs (dated) and write
    `docs/features/product-research-sources.md`, the feasibility matrix. Record the exact CJ endpoints for detail,
    variants, stock and freight, CJ's documented rate and quota limits (lower decision 4's caps to them), and the
    Trends CSV layout, with links. Also evaluate at least two more supplier or regional-fulfillment platforms and two
    licensed product-intelligence services (official docs only), each with fields, access, cost and status.
  - Check CJ's official API-key page and make the Blocked entry and `INTEGRATION_KINDS.cj`'s help text
    (`packages/shared/src/index.ts`) give the same path, naming both fields (account email and API key).
  - Finish the Blocked entries below with what you found (the Trends API form URL, or "no public application open as of
    <date>").
- [x] PR-02 **Data model** (decision 3): the migration with its upgrade test (`user_version`,
  `PRAGMA foreign_key_check`), the shared `Pr*` types in `packages/shared/src/research.ts`, the store-scoping helper
  every route uses (store rows, NULL-store rows, private rows), and the `/api/pr/*` mount with its guard (T7, mount
  part). Write the migration for everything decision 3 lists; later items add their own appended migrations.
- [x] PR-03 **Existing data** (decision 2): the one-time import of lists, saved items and agent finds (`once`), legacy
  ids kept; `seedResearch` and `research_products` untouched; T6; the Watch ↔ "Saved" mirror; `/api/research*` still
  answering. Tests: an upgraded database keeps every list item; a re-run of boot doesn't re-add an un-watched item; a
  sample row never appears in discovery, counts or sorts; a demo-engine find is not mirrored.
- [x] PR-04 **Source framework and pipeline** (decision 4): adapter interface and registry, `pr_sources` health,
  `pr_jobs` with checkpoints, `pr_calls`, the caps module, the pipeline stages, error classes, bounded retries with
  backoff, schema-change detection, the job timer (off in dev unless `PR_INGEST=1`). Tests with fake adapters for every
  failure class, for resuming from a checkpoint and for every cap.
- [x] PR-05 **CJdropshipping adapter** (decision 4): the niche → CJ category map, paged discovery, detail and variants,
  stock, freight, the shared rate lane with priorities, every call in `pr_calls`, token handling, error classification,
  "price not shown". Recorded-response fixtures and tests. The live check runs as soon as the owner's key appears
  (decision 16).
- [x] PR-06 **Google Trends CSV import and demand classes** (decisions 4 and 9): the upload route (in `LARGE`, T7),
  parser, storage with provenance, linking an import to products (query match, confirmed by the owner), the classifier
  and momentum, `pr_product_facts` demand columns, the Trends API adapter reporting Approval required. Tests on
  real-format fixtures, including "<1" values, daily, weekly and monthly exports, and a mislabelled file; a test per
  class threshold.
- [x] PR-07 **Other sources** (decision 4): own-store orders as measured demand (`demo = 0` stores only, test that a demo
  store's orders never count), TikTok Creative Center manual notes, supplier feed CSV import (`checked_at` from the
  file, else `supplier_claim`). Tests.

### Product discovery
- [x] PR-08 **Store research profile, store fit and eligibility** (decisions 5, 10, 11): profile API and "Edit research
  profile", fit and flags computed in the Evaluate step and stored per store, fulfillment status and the cost + shipping
  figure in `pr_product_facts` (decision 8) with the daily decay pass, with a test per rule and branch.
- [x] PR-09 **Discovery API:** server-side search, filters (spec §7's, as the design's chips list them), sorts (nulls
  last), cursor paging, tab counts, facet values and "unknown included" handling, store scope (included categories) vs
  All stores, private rows. SQL only over `pr_product_facts` and `pr_evaluations`; an index for every filter and sort
  the page uses; a test with 10,000 products. Also PR-03's test: a sample row never appears in discovery, counts or
  sorts. "With demand evidence" in a store's scope also counts that store's own qualifying sets (its orders, PR-07),
  which stay out of the shared facts.
- [x] PR-10 **Page frame, product grid, image proxy and dev fixtures** (The design: page frame and product card;
  decisions 12, 14): replace the page, keep `/research` and its nav entry (looked up by path), toolbar, profile line,
  filter chips, tabs, source strip, grid and cards, URL and storage state, the distinct states, the image proxy, and
  the dev-only fixture loader with its "Test fixture" labelling. Real data only: with no source connected, the
  first-use state. Say under Done whether the source-to-interface path ran on live data or on fixtures. The profile
  line's "Edit research profile" dialog edits `GET`/`PUT /api/pr/profile?store=` (PR-08).
- [x] PR-11 **Source health view:** every source's status from decision 4, last successful sync, errors, quota and the
  call ledger, stale coverage, what the owner must do to connect it, and "Sync now" where it works. Opened from the
  source strip.

### Product details
- [x] PR-12 **Detail panel** (The design: detail panel): header, Stage select, Overview with the assessment, Demand with
  the chart from stored points, "Import a Trends CSV" on Demand (`POST /api/pr/imports/trends` with `productId`), and
  the query-level sets suggested for the product with Confirm / Not this product (`POST /api/pr/signals/:id/links`), Suppliers with offers and statuses, History, the agent-find estimates block, and the
  All stores panel with "Assign to a store…". Progressive loading per tab.
- [x] PR-13 **Owner edits:** stage changes with reason (history), notes, flag dismissal with reason, Watch toggle (with
  the "Saved" mirror), confirming a query-scope demand set, manual Creative Center notes, owner-provided fields tagged
  as such.

### Store/agent submission
- [x] PR-14 **Product link preview** (decision 12): validation, the shared fetcher (T2) with product metadata and image
  modes (T3), every outcome, owner corrections and notes, duplicate check against existing listings by canonical URL,
  the `fence()` helper. Tests with a fake transport: private address, redirect to a private address, too large,
  robots-blocked, login page, 404, JSON-LD product, og-only page, several Product blocks, redirect to another path,
  tracking parameters. Then run decision 16's preview live checks.
- [x] PR-15 **Research task API** (decision 6): eligible agents endpoint with state and the queue line; `POST
  /api/pr/tasks` in all three modes and with a Deploy config, idempotent on client_request_id; the store, type and
  conversation checks; the four-part message under 20,000 characters; `PR_STARTS` (T7); the `research_task` live
  message (T8); status from the run; Retry; list and detail routes. Also the discovery API's Research filter and the
  card footer's execution state (`GET /api/pr/products`, PR-09, has neither until tasks exist). API tests: the repeat, a repeat whose run never
  started, another store's conversation, an ineligible type, a busy agent both ways, an app restart mid-run.
- [x] PR-16 **Research a Product dialog** (decision 6, The design: dialog): stepper, stores, eligible agents with state,
  Queue after current work or Run separately, Create new through Deploy configure-only (T1), templates, the real budget
  line, the Demo-runtime warning, draft persistence, Start. The toolbar button and "Research with an agent" appear with
  this item.

### Research persistence
- [x] PR-17 **Reports** (decision 7): `save_research_report` with the role grant and contract lines (T4) and the
  scripted branch (T5), `pr_reports`, the Research tab with every report, the demo-engine label, "Finished without a
  report", the after-Start progress card with real activity lines, "Open conversation in AI Agents", "Cancel run" and
  Retry. Tests: an old config and a narrowed custom role still get the tool; a second call from the same run is
  refused; a call from another run or store is refused. An end-to-end scripted test: paste, preview, store, agent,
  prompt, start, report, reload.

### Comparison and economics
- [x] PR-18 **Unit economics** (decision 13): the pure function with tests, the Economics tab with three scenarios,
  provenance per input, saved assumptions per store and product.
- [x] PR-19 **Comparison:** add up to 4 products, one destination, currency, date and assumptions for all, side-by-side
  demand, offers, shipping, fit, risks and economics, missing fields shown as missing. Saved comparisons.
- [x] PR-20 **Supplier matching and existing-product checks:** alternative suppliers for a product (CJ search by
  attributes, at most 3 calls a search), **Exact match only on the same SKU, GTIN or MPN, or the owner's confirmation;
  everything else is Similar** with the matching and differing fields; confirm, merge or separate with sources kept;
  and the "Already in your store" check against the store's products with a confirm step for uncertain matches (the
  confirmed link is `POST /api/pr/products/:id/store-products`, PR-07, which also starts the store's order set).

### Watchlists and pipeline
- [x] PR-21 **Watchlists and alerts:** watch products, niches and offers (store or all-stores, decision 3), preferences
  (price change over a set %, default 10; stock out; new evidence; shipping change), scheduled checks within the
  watch-check cap, results stored, one alert per change (dedupe key), notifications with a deep link, an owner toggle
  for research alerts in Settings (additive shared field, honoured by `notify()`; test that alerts are stored but not
  notified when off), last successful check and degraded coverage shown.
- [x] PR-22 **Pipeline and test brief:** stages from spec §10 kept apart from execution states, owners, notes, decision
  reasons, linked experiments; the test brief as an owner-editable form (target customer, offer hypothesis, creative
  concepts, measurement plan, budget assumptions, decision criteria), prefilled only from stored data (the latest
  non-demo report's proposals labelled "Proposal", the base economics scenario, the profile's audience); empty fields
  stay empty; "Draft with an agent" starts a normal research task with a "Test brief" template. "Prepare draft
  product" through the existing `store.add_products` approval (T9). Nothing is published or bought.

### Knowledge feedback
- [ ] PR-23 **Knowledge Base:** prove the research run's retrieval is store plus General only and focused (test). Once
  AA-18 has shipped, findings are saved through `captureFinding` (deduped, unreviewed) and the owner can save a stage
  decision as a store-scoped card; until then this part sits under Blocked "waits for ai-agents AA-18". General
  findings and store decisions stay separate. Demo-engine reports never feed the KB.
- [ ] PR-24 **Collaboration:** "Ask a specialist" (Ad Strategist for positioning, Analytics Specialist for a measurement
  plan) through the AI Agents team engine once AA-19 and AA-20 have shipped, with assignments, outputs and the
  consolidated result linked to the product. Until then the control is absent and this sits under Blocked.
- [ ] PR-25 **Outcomes** (spec §12): link sampled, listed, testing, scaled and rejected products to `product_tests`, orders
  (`productSales`), experiments and KB lessons; compare assumptions with observed results, with their context (offer,
  audience, creative, spend, inventory, period); never edit the original research.

### Hardening
- [ ] PR-26 **Security pass** (decisions 12, 15, 17): SSRF and redirect tests, the image proxy (no client URL, magic
  bytes, headers), credential-leak tests (web responses, prompts, job rows, logs), the guard on every `/api/pr/*` route,
  the isolation sweep over every route and the tool, rate limits and budgets for ingestion, enrichment, research and
  monitoring, untrusted text never rendered as HTML, a test that no production path writes origin `fixture`.
- [ ] PR-27 **Scale, states and accessibility** (decision 14): 10,000 products and 500 tasks in jsdom with stubbed
  pages, every distinct state, keyboard paths, focus, contrast, small windows.
- [ ] PR-28 **Design pass:** compare with the board at the four sizes, run `styleseed-design-review`, fix or answer each
  finding under Notes.
- [ ] PR-29 **Live verification** (decision 16): collect and re-run the live checks done so far (CJ, the owner's Trends
  CSV and supplier feed, the link previews) and do the one real research run, each recorded under Notes with time,
  calls and cost, reported separately from mocked tests. Whatever the owner hasn't provided stays under Blocked.
- [ ] PR-30 **Acceptance:** walk "Done when" and fix what it finds. Fetch origin and check the ai-agents Done list for
  AA-17 to AA-20 and your Inbox requests: build what has shipped since (PR-23, PR-24, `untrustedBlock`), and apply
  decision 1's fallback to any request still open after ai-agents stopped.
- [ ] PR-31 **Final report and STOP:** write `docs/features/product-research-report.md` with screenshots in
  `docs/reference/product-research-final/`, update `docs/DESIGN.md`'s Research section to the new page, then create
  `.agent/STOP`.

## Done
- 2026-10-28 PR-01 audit and sources. Baseline at bb50708f: `pnpm install` + `pnpm check` 1m33s, 191 test files,
  1,459 tests, all green (tests 42 s). Before screenshots of /research at 1280×800, 1440×900 and 1024×680 in
  `.agent/before/`; `cdp-shot.mjs`, `cdp-drive.mjs` and `ship.sh` copied into `.agent/`. Decisions checked against
  HEAD (Notes). `docs/features/product-research-sources.md`: CJ's endpoints, limits, points, error codes and key path;
  Google Trends CSV and API; the other decision-4 sources; 5 more suppliers and 4 licensed intelligence services.
  `INTEGRATION_KINDS.cj` help gives CJ's documented key path; its email field is optional.
- 2026-10-28 PR-02 data model: migration 51 with every decision-3 table (shared catalog, evidence, sources, jobs,
  calls; per-store profiles, evaluations, history, tasks, reports, economics, comparisons, briefs, outcomes, watches,
  alerts), its upgrade test from a version-50 database (lists kept, keys, `foreign_key_check`, store delete), the
  shared `Pr*` types, `scopeOf`/`storeOf`/`visible` store scoping and the `/api/pr/*` guard (413 test).
- 2026-10-28 PR-03 existing data: `importLegacy` (once) turns every list item into an all-stores watch in its named
  list, every agent find into a shared `agent_find` listing with no offers, signals or facts, and only a saved sample
  row into a `legacy_sample` listing; legacy ids kept, `seedResearch` and `research_products` untouched. T6 mirrors a
  real-engine find (`mirrorFind`); Watch ↔ "Saved" mirror (`setWatch`/`mirrorSaved`); `/api/research*` still answers.
- 2026-10-28 PR-04 source framework: the adapter interface (capabilities, access, connect text, rate and quota) and
  registry, `pr_sources` health, `pr_jobs` committed page by page with checkpoints, the `pr_calls` ledger, the caps
  module, error classes with bounded retries (30 s, 2 min, 8 min, then failed), schema-change detection, daily
  planning and the hourly timer (off in the dev app unless `PR_INGEST=1`). 8 tests with fake adapters.
- 2026-10-28 PR-05 CJ adapter: one priority rate lane for every CJ call (order sync > owner and agent searches >
  ingestion and watches), CJ's documented success rule, error classes from CJ's code table, 20 s timeouts, one token
  renewal on 1600001, every call (token included) in `pr_calls`, points left in `quota_json`. Paged `listV2`
  discovery from each store's niche queries (deduped across stores), detail and variants, stock per warehouse and
  freight quotes into `live` offer rows; "price not shown" is unknown, never 0; no stock or no method is recorded as
  such. 10 tests on doc-shaped fixtures (`sources/fixtures/cj-doc-examples.json`). **Not live-checked**: no CJ key yet
  (Blocked); the source stays Credentials required until a real call succeeds.
- 2026-10-28 PR-06 Google Trends: a tolerant CSV parser (header row found, not assumed; `<term>: (<region>)`; "<1";
  daily, weekly, monthly; refuses mislabelled, map, hourly and edited files with the reason), migration 52 (`pr_files`
  keeps each upload as sent; `demand_peak_month`), `POST /api/pr/imports/trends` (in `LARGE`; one set per term; the
  same file twice is one import), query-match link suggestions the owner confirms (`POST /api/pr/signals/:id/links`),
  decision 9's classifier and momentum in one pure function, the demand part of Rank into `pr_product_facts`, and the
  Trends CSV (Authorized import) and Trends API (Approval required) sources. 15 tests; 4 mutation checks.
- 2026-10-28 PR-07 other sources: a store's own paid orders as weekly units for the research product it is linked to
  (`POST /api/pr/products/:id/store-products`; `demo = 0` stores only, refreshed daily, private to the store), TikTok
  Creative Center notes with link and date (`POST /api/pr/products/:id/notes`, Manual research only, never evidence),
  and the supplier feed import (`POST /api/pr/imports/feed`, in `LARGE`: listing per product, variant per SKU, offer
  per row, `checked_at` from the file else `supplier_claim`, refused whole on a bad cell). 6 tests; 2 mutation checks.
- 2026-10-28 PR-08 store profile, fit and eligibility: `GET`/`PUT /api/pr/profile?store=` (decision 5's defaults,
  validated, partial saves; a save re-evaluates the store, re-ranking first when the ship-to moved), decision 10's
  flags (brand, compatibility reference, restricted and review categories, avoid lists), decision 11's store fit per
  store in `pr_evaluations`, decision 8's fulfillment status and cost + ship per facts key in Rank, and the daily
  decay pass. Rank and Evaluate run after ingestion, enrichment and feed imports. 21 tests; 9 mutation checks. Server
  only, on fixtures: the dialog lands with PR-10's profile line.
- 2026-10-28 PR-09 discovery API: `GET /api/pr/products` (search over titles, categories and supplier SKUs; the
  chips' and More filters' filters with "unknown included" unless `strict` names them; the four sorts, nulls last;
  offset cursor, 48 a page; one-pass tab counts; category, source, warehouse and supplier facets; store scope with
  included categories, private rows and the store's own orders as demand evidence; All stores with its ship-tos).
  Migration 53 (what discovery reads, kept by Rank and Evaluate, with an index each). 10,000 products: first page
  with counts and facets in 159 ms (All stores) and 88 ms (store, Best fit) on this machine. Includes PR-03's test (a
  sample row never appears in discovery, counts, facets or sorts). 6 tests; 8 mutation checks. Server only, fixtures.
- 2026-10-28 PR-10 page frame and grid: `/research` is the discovery workspace (Hero, scope switch, server-side
  search, Ship to, the four sorts, the profile line with "Edit research profile" on `PUT /api/pr/profile`, the chips
  with "unknown included", More filters, view tabs with server counts, the source strip from `GET /api/pr/sources`,
  cards per the board, 48 a page with Show more, URL and `fe.research.*` state, `/`, arrows, Enter and Esc), the
  first-use, no-match and source-error states, the image proxy (`GET /api/pr/listings/:id/image`, cache only, T3's
  image mode, T2's shared fetcher) and the dev fixture loader (`pnpm --filter @frontline/server pr:fixtures [n]`).
  **Ran on fixtures only, not live data**: the dev DB has no `cj:global`, Trends import or feed. Screenshots (fixture
  data, layout and styling only) at 1440×900 and 1024×680, store and All stores scopes, no console errors and no
  sideways scroll. 15 tests (10 page, 5 server); 2 mutation checks on the page plus the server ones.
- 2026-10-28 PR-11 source health: "Source health" in the strip opens a right-hand view with every source's access
  status, state, last successful sync and attempt, last error and its kind, why it is stopped and what clears it,
  rate and quota (CJ's reported points), today's calls against the daily caps, products with real data and fixture
  rows, stale coverage (newest offer check over 7 days), what the owner does to connect it, recent jobs and the call
  ledger (`GET /api/pr/source-health`). "Sync now" (`POST /api/pr/sources/:id/sync`) shows only for a scheduled source
  that is set up. Checked in the dev app on fixtures: no source is set up there, so Sync now was absent, as intended;
  the sync path itself is tested with a fake source only. 3 tests.
- 2026-10-28 PR-12 detail panel: a right-hand panel beside the grid (an overlay drawer below 1100 px) with the header
  (image, SKU, "Open listing" with `noopener noreferrer`, stage and fixture pills), Overview (decision 11's parts each
  with value and reason, the confidence line naming its rule, the cost and conditions, the agent-find estimates
  collapsed as "not evidence"), Demand (one chart per set from stored points, its values table, the Trends caption,
  suggested query-level sets with Confirm / Not this product, notes, "Import a Trends CSV"), Suppliers (each current
  offer with its own status; unknowns say Unknown, duties too) and History. Tabs load when opened and live in `tab=`
  and `fe.research.tab`; Esc closes and refocuses the card. All stores lists the stores evaluating it and assigns it to
  a store, then switches to that store with the panel still open. `GET /api/pr/products/:id`, `/demand`, `/offers`,
  `/history`, `POST /:id/assign`. Checked in the dev app on fixtures (store scope, All stores, 900 px drawer); Confirm,
  the import and Assign are tested against stubs and the server tests only. 6 tests.
- 2026-10-28 PR-13 owner edits: the panel's Stage select asks why and keeps the move in History
  (`POST /api/pr/products/:id/stage`, reason required), the store's notes (`PUT …/store-notes`, owner-provided), a
  flag dismissed with a reason (`POST …/flags/:flag/dismiss`; fit, open flags and the Flagged view re-evaluate for that
  store only), Watch on the card's eye and under the panel (`PUT …/watch`; a store's list, or in All stores the owner's
  all-stores list; a legacy research row is watched through its listing so "Saved" mirrors it), the Creative Center
  note form on Demand, and owner-entered offers labelled "Owner-provided". Confirming a query-level set shipped with
  PR-12. Checked in the dev app on fixtures with the forms opened, not submitted; the writes are tested on the server
  and against stubs. 5 tests.
- 2026-10-28 PR-14 product link preview: `POST /api/pr/preview?store=` checks the link (http(s), 2,048 characters, no
  credentials), keys it by a canonical URL (no fragment or tracking parameters) and reuses a listing the store already
  has without fetching. Otherwise it reads the page once through the shared `kbFetch` in the fetcher's new product mode
  (T3: meta tags and JSON-LD parsed as data, the HTTP status on a non-2xx answer). Outcomes: read, existing,
  redirected, unavailable (404/410, Discontinued), ambiguous (several Product blocks with candidates, or none), robots,
  login, paywall, unsupported, too large, failed (403/429 worded as "refuses to be read by tools"). A read page becomes
  the store's private `owner_link` listing (page price kept as the page's, never an offer), its image cached through
  the fetcher. `ownerDetails` / `previewFields` check owner corrections and tag each field page or owner; `fence()`.
  Tests: 8 with a fake web through the real fetcher. Live: 5 public previews, see Notes (2 read, 3 refused with 429).
- 2026-10-28 PR-15 research task API: `GET /api/pr/agents?store=` lists the Product Researcher seat and each custom
  role built on it, with its runtime and model (latest config, else the seat default), state (available, busy with the
  running conversation, its queued turns and whether the store's 2 slots are full, or not ready with the owner's next
  step). `POST /api/pr/tasks?store=` checks the store, product, type (404 unknown, 409 not a product_hunter type) and
  the conversation (404 another store's, 409 another type's), inserts the task, composes the four-part message (header,
  the instructions verbatim up to 6,000 characters, two `fence()`d blocks: product facts and "Earlier in <store>"), and
  starts it new (a product-context conversation), queued in the conversation, or separate (a new conversation on that
  conversation's config); a Deploy config goes through `openConversation`'s own check (400 on its field). Idempotent on
  `client_request_id`; a refusal stays on the task as Not started and a repeat starts it with the same task. Status comes
  from the run (`stateOf`) plus the report; Retry for Not started, Interrupted and Failed; list and detail routes;
  `PR_STARTS` (T7) in `kbGuard`; the `research_task` live message (T8) on each run change, and `useLive` refetches
  `['pr']`. Discovery: the `research=` filter (the same status rule in SQL, `none` for no task) and `PrCard.research`
  for the footer; the web adds the Research chip and the footer state. Tests: 6 API (the repeat, a run that never
  started, another store's conversation, ineligible types, busy both ways, a restart mid-run, the filter agreeing with
  the task for every status), 2 web.
- 2026-10-28 PR-16 Research a Product dialog: the toolbar's red **Research a Product**, the panel's **Research with an
  agent** (store scope, the product filled in) and the first-use line "Research a Product works now". The dialog has
  the four-step stepper (done / current / to do, each a link to its section); the link and Fetch preview with the
  preview card (title, image, host, "read from the public page <time>", page price "(not verified)", variants, what
  the page didn't show, Correct details · Add notes), every other outcome said as it is with "Enter the details by
  hand" (an ambiguous page lists its candidates as prefills); the store select with "Brings <store>'s niche, price band
  and <n> knowledge cards" (the KB's count for the store plus General); the agent rows with their state pill, runtime ·
  model · effort, the busy row's work and queue line, Queue after current work / Run separately, the reason a row isn't
  ready, "+ Create new Product Research agent" through Deploy configure-only (T1) shown as "New: <type>", and the
  Demo-runtime warning; the four template chips and a 5-row resizable box sent exactly as typed; the footer line, the
  real budget (the config's run budget, what is left of the store's agent budget today, "No budget set for this run"),
  Cancel and Start research. The draft is kept per browser (`fe.research.draft`) and reset after a start; Start opens
  the product in the task's store. Server additions: a link the page wouldn't give becomes the store's private
  `owner_link` listing named by the owner (marked owner-entered); a new task runs on the config its row shows (the
  type's latest in the store); a repeat whose run never started takes the repeat's fields; a 409 says "Not started:
  <reason>"; `PrAgentRow.budgetUsd`. PR-15 follow-ups: decision 5's automatic Discovered → Researching when a task
  starts (by the task), T7's 429 test. Tests: 3 new API tests and 2 extended, 3 dialog, 1 Deploy (T1), page checks. Checked in the dev app on
  the fake engine (see Notes).
- 2026-10-28 PR-17 Reports: `save_research_report` (T4) with every decision 7 field, an empty list's
  `unknown_reasons`, granted to every Product Researcher run whatever its config lists (configs and narrowed custom
  roles saved before the tool), and the two contract lines. The server half (`reports.ts`) takes product and listing
  from the task row, accepts only the task's run in the task's store, once ("Report already saved for this run"), and
  refuses evidence or offers citing a fixture or demo row, or a reference that isn't a fact. The task's facts now carry
  `[listing:…]`, `[offer:…]` and `[set:…]` references to cite. The scripted engine (T5) saves a fixed report marked
  demo; demo reports show "Demo engine · scripted example, not research" with no recommendation and never feed the
  assessment, the confidence count or the next task's history. The panel's Research tab: the latest task with its
  run's real activity lines, the queue or failure detail, "Open conversation in AI Agents", "Cancel run" (the
  conversation's stop) and Retry; earlier tasks with "Finished without a report"; every report, newest open. Overview's
  Differentiation and Risk read the latest real report ("Proposal, not evidence"); evidence confidence counts a real
  report with measured evidence. Start opens the product on its Research tab. Tests: 4 API (one end to end: link,
  existing listing, store, agent, instructions, start, report, restart), 1 roles (T4), 1 page; existing tests updated.
- 2026-10-28 PR-18 Unit economics: `unitEconomics()` in shared, one pure function for decision 13 (required unknown
  → no figures; optional unknown → left out and listed; refunds once from revenue; fees on the discounted price, not
  refunded; contribution before and after advertising; break-even cost per order; break-even ROAS only above zero),
  with a test per rule. The server derives the base inputs with their provenance (the store's own price when it sells
  the product, the cheapest Verified offer's cost and shipping to the store's ship-to with its supplier and date, the
  store's fee settings, no discount, no returns, full refund) and keeps the owner's figures per store and product in
  `pr_economics` (`GET`/`PUT /api/pr/products/:id/economics`). The panel's Economics tab: Conservative, Base and
  Optimistic side by side ("same as base" until the owner changes one), "Needs a selling price" or "Incomplete:
  missing …", the ROAS basis, Not included (unknown optional costs and fixed costs), and an editor per scenario where
  every input shows Verified, Yours, Assumption or Unknown with its source; Save and Discard. Overview's Economics
  (base) reads "$x per order before ads, excl. …", and complete base economics count toward evidence confidence.
  Tests: 6 shared, 3 API, 2 page.
- 2026-10-28 PR-19 Comparison: Compare in a product's panel (store scope) adds it to the store's comparison tray (up
  to 4, kept per store in `fe.research.compare`); the tray bar names them and opens the comparison. The comparison
  puts the products side by side on the store's ship-to, currency and today's date (and the stored exchange rate's
  date): stage, store fit, demand evidence, cost + ship, supplier with its check date, shipping (method, delivery,
  origin), risks (flags and report risks), evidence confidence, and the base economics, every gap as "Missing: <why>".
  Shared cost assumptions (discount, store fees, returns, refund, cost per return, ad cost) apply to every product;
  where those are left to each product and differ, it says "Not like for like yet". Saved comparisons per store
  (`pr_comparisons`, `GET`/`POST /api/pr/comparisons`, `PUT`/`DELETE …/:id`) with Open and Delete; each product's own
  figures are read again when one is opened, and a comparison saved for another ship-to or currency says so. Also
  decision 5's report button: a real report's recommendation shows "Move to <stage>" (the owner's move, with the
  report as the reason; never from a demo report). Tests: 2 API, 1 page, plus the Move to test.
- 2026-10-28 PR-20 Supplier matching and existing-product checks: the rule (`judge`) gives Exact only on a shared
  GTIN, MPN or SKU and Similar otherwise, with the matching and differing fields (title words, category, variants,
  supplier, codes). The Suppliers tab's Other suppliers lists the candidates with their cost + ship and status: Merge
  into this product (exact only), Same product (the owner's Exact), Not the same (kept under "Not the same product"
  with Undo), and Separate on a listing a merge brought in. A merge moves the other product's listings here and keeps
  every one (`merged_from`, migration 54); Separate moves them back; both go to History. Search CJdropshipping makes
  at most 3 catalog calls and stores the results as listings. Overview's "Already in <store>" shows the linked store
  product, or possible ones by title with Same product (the PR-07 link) and Not this one. API: `GET …/matches`,
  `POST …/matches/search`, `POST …/matches/:listing`, `same: false` on `POST …/store-products`. Tests: 4 API, 1 page.
- 2026-10-28 PR-21 Watchlists and alerts: products (the panel's Watch), offers (Suppliers tab: Watch this offer, one
  per listing, variant, supplier and destination) and niches (a product category, from the Watchlist view) on a
  store's list or the owner's all-stores list. The hourly jobs tick checks each watch every 12 hours (at most 50 a
  tick): a CJ listing is re-checked live with purpose `watch` within its 100-call daily cap; otherwise the check uses
  stored data and says so. The result is kept on the watch (`state_json`, migration 55) and compared with the next:
  cost + ship moved by the watch's % (default 10), out of stock, shipping change (delivery or methods), new evidence
  (a demand set or a real report), new products in a niche. Each change is one `pr_alerts` row (dedupe key: the
  observation) and one `research_alert` notification linking to the product, unless Settings > Research alerts is off
  (`Settings.notifications.researchAlerts`, additive). The Watchlist view lists the watches with the last successful
  check, partial coverage, the last error, the newest alerts, Alert on preferences, Check now and Stop watching. API:
  `GET/POST /api/pr/watches`, `PUT/DELETE /api/pr/watches/:id`, `POST /api/pr/watches/:id/check`. Tests: 3 API
  (fake timers), 1 page.
- 2026-10-28 PR-22 Pipeline and test brief: Overview's Owner and links (who handles it in the store, kept in History;
  the store products it became and linked Knowledge Base experiments, with Link and Unlink in History). Draft test
  brief opens the owner form (target customer, offer hypothesis, creative concepts, measurement plan, budget
  assumptions, decision criteria), prefilled only from stored data with each source labelled (Research profile; a
  model report's proposals as "Proposal: report of <date>"; Base economics); a field with nothing stored is empty.
  Draft with an agent opens Research a Product with the new "Test brief" template. Prepare draft product makes a
  `store.add_products` approval request at the base selling price (T9: `prProductId`, so the draft links back as a
  `store_product` outcome); one request per product, none once it is in the store. API: `PUT …/owner`,
  `GET/POST …/links`, `DELETE …/links/:ref`, `GET/PUT …/brief`, `POST …/draft-product`. Tests: 3 API, 1 page.

## Blocked
<!-- Keep these until the owner's input arrives, then move them to Done. Each says exactly what the owner does. -->
- **Start the dev app (owner, needed for the next entries):** in PowerShell,
  `cd C:/Users/Xody2/orca/workspaces/FrontlineEcom/product-research; pnpm dev`, then open
  http://localhost:5243/integrations. Leave it running while you enter things; the worker notices them at its next
  item.
- **CJdropshipping API key (owner, free):** in CJ (cjdropshipping.com, signed in), open **Apps** in the left
  navigation → Install App → under Others, install **API** (installing it doesn't create a key) → **My CJ →
  Authorization → API** (https://www.cjdropshipping.com/my.html#/authorize/API) → **Add API**, Type **API Key**,
  Confirm → copy the key from the **API Key & MCP Token** column. In the dev app, Integrations → CJ Dropshipping: paste
  it in **API key**; **Account email** is optional (CJ's API needs only the key). Checked against CJ's API-key page on
  2026-10-28; the app's help text says the same. If API access was suspended after 30 days without orders, reactivate
  it at https://www.cjdropshipping.com/my.html#/authorize/APIStores. Needed for the live CJ check and PR-29.
- **One Google Trends export (owner):** on trends.google.com, search the product term for the store's country over
  the past 12 months (or 5 years for seasonality), then use the download (CSV) button on the "Interest over time"
  chart. Upload it on the Research page once PR-12 ships (the import API is in since PR-06). It needs at least one product to link to (from the CJ key or a pasted link). Needed for PR-29.
- **Supplier feed (owner, optional):** a CSV you're entitled to export from a supplier or feed tool. Header row with
  these column names (any case, any order): **title, sku, currency** (required), and any of product_ref (groups
  variants into one product; default the sku), variant, unit_cost, shipping_cost (plain amounts like 3.42), destination
  and ships_from (two-letter country codes), delivery_days_min, delivery_days_max, processing_days, stock, moq (whole
  numbers), gtin, mpn, category, image_url, url, checked_at (the date the supplier's figures are from; rows without it
  are kept as supplier claims). One file, at most 20,000 rows and 10 MB. The import API is in (PR-07); the upload
  control comes with the page (PR-10).
- **Google Trends API (owner, optional):** applications are open as of 2026-10-28 ("We're now accepting
  applications for alpha testers", https://developers.google.com/search/apis/trends#apply). Fill in the form that page
  embeds: https://docs.google.com/forms/d/e/1FAIpQLSfiP3XUUWGr4CkYk1oJHpthCAcAw2kL0UaE6p7tq3ZoxFiLtA/viewform. Google
  takes "a very limited number of testers"; auth, cost and quotas aren't published. Until access is granted the
  adapter stays at Approval required.

## Notes
- **PR-22 as built.** Stages and execution states were already apart (the stage is the header's select and History;
  a task's queued/running/failed state is the Research tab's and the card footer's); this adds the owner fields around
  them. The owner is free text (there is no team or user model). Linked experiments are the store's `kb_experiments`
  rows (read-only use of the KB lane's table), stored as `pr_outcomes` kind `experiment`. One brief per store and
  product (`pr_briefs`, updated in place). Once saved, the brief is the owner's and no longer shows prefill labels.
  The draft product needs a base selling price; supplier cost goes along when known. Approving it runs the existing
  `addProducts` (demo store: a local draft; Shopify or WooCommerce: a draft on the platform) and nothing else is
  published. Touch points: T9 in `routes/agents-actions.ts` (noted in the ai-agents Inbox). Dev-app check 13:20
  local on Pawsome Gear, read-only (nothing saved or requested): the demo product has no audience, model report or
  complete economics, so every brief field is empty and unlabelled, as it should be; Owner and links says nothing is
  linked. Screenshots `.agent/shots/pr22-*.png`.
- **PR-21 as built.** A scope changes only its own list: a store adds, edits and removes its watches; the all-stores
  list (store_id NULL) shows in every store but is changed in All stores, where only shared rows can be watched. The
  first check records a starting point and never alerts. A check that falls back to stored data (CJ not connected, or
  the watch cap reached) still counts as a successful check, with its coverage shown; a failed live call keeps the
  error and the earlier success, and the next scheduled check tries again (no retry loop). The all-stores list checks
  ship-to US (the page's default); per-store lists use the store's ship-to. Alert titles are stored without the
  target's name; the notification adds it. Overlapping live calls: a product watched by several stores is re-checked
  once per watch; fine at the watch cap, dedupe the listing per pass if it shows. Nudged outside the lane, as the item
  asks: `Settings.tsx` gets the Research alerts toggle and `Notifications.tsx` the `research_alert` kind (icon, label).
  **Live CJ re-checks are mocked-tested only** (CJ key Blocked). Dev-app check 12:53 local on Pawsome Gear: a niche
  watch (Pet Supplies > Grooming) and an offer watch (the fixture brush's CJ offer to US) checked with 0 CJ calls; the
  offer watch shows "Partial coverage: CJdropshipping isn't connected"; no alerts (nothing changed); both removed after,
  leaving the dev DB without watches. Screenshots `.agent/shots/pr21-*.png`.
- **PR-20 as built.** A candidate shares a code or at least 2 title words (a LIKE prefilter on the product's words,
  capped at 300 rows; the top 12 shown, exact first). The owner's verdicts are on listing pairs in `pr_matches`, which
  has no store: whether two listings are the same product is a catalog fact, so it holds for every store; the History
  row goes to the store the owner acted in. A merge sets `merged_into` and moves the listings; the merged product's
  own store rows (stage, notes, tasks, reports, watches, economics, comparisons) stay on it, hidden, and come back on
  Separate. A product that has merged listings of its own can't be merged until those are separated (no chains).
  Store products carry no SKU or GTIN, so every "Already in your store" match is by title and needs the owner's
  confirmation; "Not this one" is a `pr_outcomes` row of kind `not_store_product`. **CJ search is mocked-tested only**:
  the CJ key is Blocked, so no live call was made; without the key the search makes no call and says so. Dev-app check
  12:45 local on Pawsome Gear, read-only: "collapsible travel bowl" shows "Already in Pawsome Gear: Possibly" with the
  demo store's "Collapsible Travel Water Bowl"; the demo catalog has no supplier lookalikes, so Other suppliers says
  none match. Screenshots `.agent/shots/pr20-*.png`.
- **PR-19 as built.** "One destination, currency and date for all": the store's ship-to and currency (economics and
  offers are per store, so a comparison is too), and today's figures; the saved row keeps the ship-to and currency it
  was saved with. Price, supplier cost, shipping, duties and other costs stay each product's own; the shared figures
  are only the store-level ones. The card's `conditions` now also carries the offer's supplier, delivery maximum and
  origin (additive). The comparison reuses the panel's detail and economics queries (`useQueries`), so no second
  compute path. Decision 5's "Move to <stage>" on a report was missing from PR-17 and is built here: Research further
  → Researching, Request a sample → Sample review, Shortlist → Shortlisted, Reject → Rejected; Monitor suggests no
  stage. Dev-app check 12:28 local on Pawsome Gear: two fixture products added from their panels, compared (every
  offer figure Missing: fixture provenance), shared figures typed, saved as "Dev check", listed, then deleted from the
  dialog; the dev DB holds no comparison. Screenshot `.agent/shots/pr19-compare.png`.
- **PR-18 as built.** A store's fees are "not set" when both are 0 (the stores table defaults them to 0, so 0 and 0
  can't be told from "never entered"): Economics asks for them rather than computing with no fees. The owner can type
  them per product, or set them in Settings. The store's own price comes from a store product linked to the research
  product (`pr_outcomes` kind `store_product`). Offers in another currency use the stored rate and its date
  (`storedRate`, never a fetch), the same as discovery's Rank step. `PUT` replaces the owner's figures: base over the
  derived inputs, each other scenario over base. The panel's tab row now has `shrink-0`: as a scroll container in the
  panel's flex column, it collapsed to 0 px under tall content (first seen with Economics). Dev-app check 12:15 local,
  demo store, nothing saved: the SparkFun product's offers are fixtures, so supplier cost and shipping stay Unknown
  and every scenario reads Incomplete. Typing $24.99, $3.42, $4.10, 2.9 % and $0.30 gave $16.45 before ads and a
  1.52× break-even ROAS, which match working it by hand. Screenshots `.agent/shots/pr18-*.png`.
- **PR-17 as built.** Report fields are snake_case as decision 7 names them (`customer_problem`, `open_questions`…).
  A report is a demo when the scripted engine saved it (`engine = 'scripted'`, set by the fake engine's tool context)
  or its run's runtime is Demo: a run forced onto the fake engine under a Claude config is still labelled. The task
  takes its run at the run's first event (`watchTasks`, matched by the client request id they share), because the
  scripted engine reports before `start()` returns; AI Agents' own Retry or Resume of that run moves the task to the
  new run (`retry:<old>:<new>`), which is decision 7's "retry chain". A free-text source naming a fixture is refused
  too. The panel's tab row now wraps like the board's (an optional `className` on `Tabs`, default unchanged): five
  tabs don't fit the 346 px panel. `apps/web/src/agents/activity.ts` (ai-agents' file, that lane has stopped): one
  phrase for the tool and a refused save shown as a warning, as decision 1's fallback; the page test covers the phrase.
  `packages/agents/src/evals.test.ts` (same fallback): its two tool checks count the tool as a Product Researcher's,
  like `save_finding` is a config's, because T4 grants it outside the role's list.
  **Unintended live request:** 2026-10-28 ~11:57 local, the first run of `reports.test.ts` called the preview route
  with a link whose listing had no canonical URL, so it fell through to the shared safe fetcher: one DNS lookup and
  one GET of `https://cjdropshipping.com/robots.txt`, which refused the page, so no product page was read. No CJ API
  call, no cost. The test now calls `preview()` with a getter that throws, so it can't reach the network again.
  Dev-app check, 12:01 local, fake engine, demo store: Research with an agent on the SparkFun product → Supplier check
  only → Start opened its Research tab with "Report ready", the run's two real activity lines and the demo-labelled
  report (screenshots `.agent/shots/pr17-*.png`). The task stays in this worktree's dev database.
- **PR-16 as built.** T1 (`Deploy.tsx`, ai-agents' file): `lockStore`, `types` and `onSubmit({type, config})`. The
  title is left out of what it returns, with the objective, attachments and the Agent settings link, because the task
  names its conversation "Research: <product>"; "+ Custom role" is hidden when `types` is set (custom roles are made
  in AI Agents; one built on the Product Researcher then lists here). A read page's listing is private to the store it
  was previewed for, so changing the dialog's store drops that preview (the link stays; Fetch preview reads it for the
  new store). Dev-app check, 2026-10-28 15:44 UTC, fake engine, no page fetched (the SparkFun link pawsome already
  had answered "existing"): the dialog opened, Start made a task in pawsome, the product moved to Researching by the
  task and its card's Research state reads "Finished without a report" (no report tool until PR-17). That task stays
  in this worktree's dev database. Screenshot `.agent/shots/pr16-dialog.png`.
- **PR-15 as built.** The busy test stages the conversation's running turn as a row the run manager isn't running, so
  the queued and separate turns go ahead in the test; the queue line is then read from staged queued runs. The restart
  test marks the run running and builds a second run manager on the same database, which is the real restart path.
  A config refused by Deploy's check keeps the task as Not started (400 with the field); the dialog's repeat with a
  fixed config starts it under the same task. `queue` and Retry send the turn into the existing conversation, so the
  conversation's config and session carry on. No real engine was used (the fake engine only).
- **PR-14 live check (decision 16), 2026-10-28 15:12 UTC**, dev server with the fake agent engine, store pawsome, 5
  previews through `kbFetch` (each is robots.txt, the page, its redirects and at most one image; requests weren't
  counted one by one, about 15 to 20 in all). Cost $0, no sign-in, nothing bypassed:
  - allbirds.com product page, and the same site over http with a utm parameter: robots allowed, the page answered
    HTTP 429 both times. brooklinen.com product page: HTTP 429. Shopify storefronts refuse this honest bot
    user-agent; the preview now words 403/429 as "refuses to be read by tools: enter the details by hand", and never
    retries or poses as a browser.
  - adafruit.com/product/3405: read (title, $19.95 page price, SKU 3405, shipping not shown). Its JSON-LD image URL
    has a double slash and the CDN answered 404, so no image was cached (neutral icon); the page's data, not a bug.
  - sparkfun.com/products/15096: redirected to its new path, read (title, $10.50, SKU DEV-15096), image cached.
  - The two read pages are `owner_link` listings private to pawsome in this worktree's dev database (real public
    data, not fixtures). The mocked tests above are separate evidence: they cover every outcome; the live run only
    shows read, redirected and refused on real sites.
- **PR-14 as built.** The preview needs a store (`?store=`): a read page becomes that store's private listing so its
  image can be served through the listing image route, and the dialog (PR-16) previews for the store it targets. The
  canonical URL keeps the scheme and `www.` as they are. The ai-agents Inbox request in decision 12 (agent WebFetch
  through `kbFetch`) was already done by AA-23. Owner corrections are checked and tagged here and stored with the
  task (`pr_tasks.preview_json`, PR-15), never on the shared listing.
- **PR-13 as built.** Every owner stage move needs a reason (500 characters), not only Rejected: decision 5 keeps
  "who and why" for each change. "In a store's pipeline" (`n stores evaluating`, the panel's store list, Assign's 409)
  now counts only `kind = 'stage'` History rows, so a watch, a note or a flag dismissal doesn't put a product there.
  Watches and dismissals in a store write History; an all-stores watch has no History row (History rows belong to a
  store). Notes are one text per store and product (`pr_evaluations.notes`); the spec's "owners" column
  (`pr_evaluations.owner`) has no control yet: the app has one owner. A dismissed flag can't be restored from the
  panel yet; add "Restore" if the owner asks.
- **PR-12 as built.** The Stage select arrives with PR-13 (a stage change needs its reason form); until then the header
  shows the stage as a pill. Economics and differentiation read "Not assessed yet" and have no tab until PR-18 and
  PR-17 (decision 1). An offer's status on Suppliers is decision 8 run on that row alone, for its own destination and
  quantity. "Assign to a store…" puts the product in the store's pipeline at Discovered with a History row ("Assigned
  from All stores"); a store that already has it gets 409. `AreaChart` takes an opt-in `format` for non-money values
  (Trends interest); without it nothing changes for the dashboard and analytics charts.
- **PR-11 as built.** Sync now queues today's planned queries (one job per store plan) and runs them in the background
  one at a time, then enriches; it refuses while a job is queued or running, clears a schema stop (the owner asking is
  the "asks for a sync again" of decision 4), and still refuses an auth stop until new credentials and a quota stop
  until 00:00 UTC. Store orders have no Sync now: they refresh daily from the synced orders. First use now lists the
  sources that bring supplier products (not demand-only, not manual notes): CJ and the supplier feed.
- **PR-10, decisions 1, 5, 12 and 14 as built.**
  - Decision 1 change: `api/client.ts` also exports its `api` and `json` helpers (two `export` keywords), so the new
    hooks in `product-research/api.ts` reuse its error handling instead of copying it. Nothing else there changed.
  - `ui.tsx` `Tabs` takes an opt-in `count` per tab (the board's muted number); without it nothing changes.
  - The grid keeps every loaded card in the DOM with `content-visibility: auto` instead of windowing (ponytail: no
    virtualizer dependency; nodes stay, layout and paint are skipped off screen; window it if a 10k-card scroll lags).
    Chips are native selects sized with `field-sizing: content`; one value per chip (the API takes lists).
  - Store scope's Ship to edits the profile's ship-to (a save re-ranks); All stores' is `fe.research.shipTo`.
  - Selecting a card (click, Enter) sets `product=` and the red border; the panel itself is PR-12. The watch eye, the
    Research chip and the footer's execution state, "Source health", and Research a Product are absent until PR-13,
    PR-15, PR-11 and PR-16 (decision 1). First use lists each discovery source's own `connect` text from the server;
    it says "Research a Product works now" once PR-16 ships. Add to store returns with PR-22.
  - The image route keeps a route's own CSP: `app.ts` appends `frame-ancestors 'none'` to it instead of replacing it.
    Images cache under `<dataDir>/pr-images`, keyed by the image_ref's SHA-256; a miss queues at most 500 refs and
    fetches one every 2 s (30 a minute).
  - Fixture rows are plain product names; the "Test fixture" pill and the strip label them. Re-running the loader
    updates the same rows.
- **PR-09, decisions 5, 9, 11 and 14 as built.**
  - `GET /api/pr/products?store=&shipTo=&q=&view=&sort=&cursor=&limit=` plus repeated list filters (`category`,
    `source`, `warehouse`, `supplier`, `stage`, `fit`, `availability`) and single ones (`costMax`, `deliveryMax`,
    `unitMax`, `shipMax` in minor units; `evidenceDays`; `niche`; `flags=any|none`). `strict=cost,delivery,…` drops a
    filter's unknowns; without it they're kept, which is what the chip's "unknown included" shows. Stage, fit and Best
    fit need a store (400 otherwise). Store scope always uses the profile's ship-to.
  - Migration 53 keeps what the filters need in the two tables decision 14 names: `pr_product_facts` gets the
    qualifying set count, the cost row's unit and shipping cost (converted), the fastest shippable delivery and the
    rule-flag count; `pr_evaluations` gets `in_scope` (NULL when the category is unknown, kept) and `open_flags`.
    Source, warehouse and supplier filters are `EXISTS` over the scope's listings and offers.
  - Best fit: fit, then demand class with "Seasonal in season" meaning the peak month is this month or next
    (a seasonal set out of season ranks with No clear pattern), then verified cost + shipping, nulls last, then id.
  - The cursor is an offset (ponytail: a card can repeat or be skipped while ingestion inserts; keyset if it shows).
    Facets list the scope's values without the other filters applied. The niche filter matches a word start after a
    space in SQL, a little looser than Evaluate's.
  - A card shows the fulfillment status from the facts and the conditions (variant, method, quantity, date) of the
    row Rank's rule picks, recomputed for the page's cards only. A store scope with no evaluations yet (a new store)
    runs Evaluate over the store's products on first open (ponytail: synchronous; it re-ranks every product, so a
    new store over a large catalog waits on that once).
- **PR-08, decisions 5, 8, 10 and 11 as built.**
  - Evaluate writes one `pr_evaluations` row per product a store may see, at Discovered, with its fit, reasons and
    flags (stage, owner, notes and dismissals stay as they are). So "<n> stores evaluating" (All stores) counts stores
    with a `pr_stage_history` row for the product (Assign to a store…, a stage change, a task start), not evaluation
    rows. A store with no evaluations yet (new, nothing saved) gets them on its first profile save or the next Rank of
    each product; PR-09 runs `evaluateStore` when a store scope has none.
  - Fit precedence: Weak, then Medium, then Unknown, then Strong (a known problem says more than a missing input).
    With no offer yet, nothing known fails, so fit can be Strong. Delivery uses the fastest shippable row's upper
    bound; "no preferred warehouse" means no shippable row ships from one.
  - The niche test matches a word's start in the category path against a word list per niche (`NICHE_WORDS`), or
    the owner's words for a custom niche, or an included category. A keyword heuristic, like the discovery queries:
    switch to CJ category ids after the live check.
  - Flags are word matches on the title and category, whole words only. Words that are also ordinary product words
    (apple, galaxy, switch, gun, capsule, medical) are listed only in phrases (`iphone`, `stun gun`, `medical
    device`). Restricted and avoid flags make fit Weak; brand, compatibility and review flags are warnings.
  - Fulfillment is for quantity 1 (the only quantity CJ is quoted at). The current rows are, per listing, variant,
    supplier and destination, those of the newest check. A product with offers but none for the destination is
    Pending ("No quote for <country> yet"), not Insufficient. A store with no ship-to gets no status. Cost + ship uses
    the stored ECB rates (`storedRate`, never a fetch inside Rank; the FX loop refreshes them daily), so its date is
    the `fx` setting's date. Facts keys are each store's (ship-to, currency) plus All stores' default (US, base
    currency), plus each store's ship-to in the base currency (PR-09), so All stores can ship to US or any store's
    ship-to.
  - The decay pass runs in the jobs tick, once a UTC day, so it's off in the dev app unless `PR_INGEST=1` (like
    every timer here). Flag dismissal with a reason (History) is PR-13; Evaluate already honours
    `flag_dismissals_json`.
- **PR-07, decision 4 as built.** The link between a research product and a store product is a `pr_outcomes` row
  (kind `store_product`): PR-20's "Already in your store" check and T9's `prProductId` write the same row. Own orders
  are weekly paid units (Sunday weeks, like Trends) from the first week with a sale to the last complete week, at most
  104 weeks, classified with decision 9's rules. They are private to the store, so Rank keeps them out of the shared
  facts and PR-09 adds them for that store's scope. A note needs a product (notes come from the detail panel). Feed
  money uses the currency's ISO minor units from the runtime (`Intl`), so yen has no cents; a well-formed but unknown
  three-letter code passes (ICU accepts it). A feed is shared (store NULL), like the CJ catalog.
- **PR-06, decision 9 as built.** A 0 counts as "<1" for Insufficient history (Google shows low-volume terms as 0).
  A year's "top 10%" only takes points above that year's median, so a flat baseline's ties never make a month
  seasonal. Momentum is null for an Insufficient history set and when the window before averages 0; it is rounded to
  two places. A product's demand set is its newest product-level or confirmed set with enough history, else its newest
  set. Rank writes one facts row per (store ship-to, store currency), `''` for a store with no ship-to yet. A Trends
  upload is capped at 2 MB (exports are a few KB). The Trends upload UI lands with the detail panel (PR-12).
- **PR-05, decision 4 as built.** The niche map (`product-research/profile.ts`) is CJ search keywords per niche, not
  CJ category ids: the ids need a live `/product/getCategory` call, so switch after the live check. Enrichment quotes
  the cheapest variant in stock, quantity 1, from at most two warehouse countries (the destination's own, then China),
  for up to 20 new shared listings per store a day, re-checked after 7 days; it shares the ingestion cap. CJ's
  `logisticAging` is stored as days, an assumption the live check must confirm (sources doc). The fixtures are shaped
  like CJ's documented examples with made-up values, labelled as such: the live check replaces them with recorded
  responses. The old `searchCj` keeps reading a price range's first number (agent and owner searches only; not stored).
- **PR-04, decision 4 as built.** A rate-limit wait counts toward the 3 retries, so a source that keeps refusing
  ends as a failed job, never a loop. A schema change is a required field missing or fields that were always sent
  disappearing (a key fingerprint per source); new fields are fine. Two more error classes: `request` (our bug) and
  `not_found` (an item removed): neither is retried, neither stops the source. A cap refusal leaves the job queued
  until 00:05 UTC the next day ("waiting"), not failed.
- **PR-03, decision 2 as built.** Legacy finds are imported as **shared** listings (store NULL): they were never
  per store, and T6 refreshes the shared one when it exists, else makes a private listing for the run's store. A
  "demo-engine find" is a run whose `agent_runs.runtime` is not `claude` or `codex` (the fake engine records none).
  The test that a sample row never appears in discovery, counts or sorts needs the discovery API, so it lands with
  PR-09; PR-03 tests that only a saved sample enters the catalog.
- **PR-02, decision 3 as built.** `pr_listings` is unique on (source, source_ref, store) so two stores can each paste
  the same link privately; `pr_watches` is unique on (store, list name, target), so one product can sit in two named
  lists; both use `ifnull(store_id, '')` so the all-stores rows are unique too. Added `pr_stage_history.kind` (stage
  or a flag dismissal), `pr_signals.product_id`, `note` and `url` (a manual note is a signal), and a unique
  `pr_reports.run_id` (one report per run). `conversation_id` and `run_id` have no foreign keys: those tables belong
  to the ai-agents lane and a deleted run must not delete research.
- **PR-01, decisions against HEAD (2026-10-28).** The code map holds, with these changes:
  - Decision 4, CJ: the old success check `!body.result` is wrong for CJ's documented responses (some have no
    `result`); PR-05 uses CJ's rule (HTTP 200 and code 200, 0 or none). The caps stay as written: they come to under a
    fifth of CJ's free 50,000 points a day (sources doc). CJ defines points, so `pr_sources.quota_json` keeps the last
    `pointsInfo.remaining`.
  - Decision 4, CJ key: CJ's API needs only the key (getAccessToken takes `apiKey` alone), so the help text names
    both fields and the email is now optional.
  - Decision 4, Trends CSV: Google doesn't document the file layout or "<1"; PR-06's parser finds the header row
    instead of assuming one, and is checked on the owner's first export.
  - Decision 4, not built: eBay's and Etsy's terms restrict feeding their data to AI they haven't licensed; Amazon's
    license allows only use that sends traffic to Amazon. Recorded in the matrix, no change to the build.
  - "The dev app" in decisions 4 and 16 means a server started without `FRONTLINE_WEB_DIR` (the desktop app always
    sets it).
  - Code map line numbers moved with the ai-agents lane: `kbFetch` is now `routes/agents.ts:444`. AA-16 (execution
    states) has shipped, so "Waiting for you" is available to decision 6.
  - Two functions are called `stateOf`: decision 6's run status is `packages/agents/src/conversations.ts:239`, not the
    settings map in `connectors/common.ts:361`.
