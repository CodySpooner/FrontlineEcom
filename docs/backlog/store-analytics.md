# Backlog — store-analytics lane (Store Analytics redesign)

Repo rules: `CLAUDE.md` (worker loop, hard rules). The owner's full spec, verbatim, is
`docs/features/store-analytics.md`. It is the source of truth for *what*. This file is the *how* in this repo: the
chosen design, the decisions already made, lane ownership, the items and the completion checklist. The Stage One code
and data audit behind it is `docs/features/store-analytics-codemap.md` (SA-02 re-checks it; treat every claim there as
a claim until then). The approved design is `docs/reference/store-analytics-overview.png` and
`docs/reference/store-analytics-listings.png`, with the `.html` boards next to them for exact colours, sizes and copy.
Read all of them before SA-01.

## What the owner asked for (verbatim, 2026-10-28)

The spec asked for four concepts on one artboard (A Executive Analytics Workspace, B Commerce Intelligence Terminal,
C Store Operations Hub, D Insight-Led Analytics Studio), then a stop for the owner's choice. The owner picked:

> Go with A

The spec's rules this lane may never bend (quoted exactly):

- "Continuous work must operate within the actual runtime, permissions, and execution limits. Do not promise
  indefinite background execution or use uncontrolled retry loops." (§1)
- "Changing stores must not display stale results from the previous store while new results load." (§4)
- "Global filters must either apply to a section or visibly explain why they do not. No silently ignored filters." (§4)
- "The same order must not count twice because it appears in both a store integration and a channel integration." (§5)
- "Missing information must appear as unavailable, incomplete, estimated, or awaiting connection—not zero." (§5)
- "Never fabricate metrics, historical charts, connected accounts, or completed synchronizations." (§5)
- "Keep analytics read-only by default. Publishing, pricing, inventory, and content changes must use existing approved
  workflows." (§7)
- "Create or extend a shared metric-definition layer. Do not implement slightly different formulas separately in cards,
  charts, exports, and agent tools." (§9)
- "Changing a product’s current supplier cost must not silently rewrite every past order’s profitability." (§9)
- "Do not invent confidence scores or present correlations as verified causes." (§10)
- "Agents may recommend actions, but spending money, publishing changes, contacting customers, or modifying live
  listings must remain subject to permissions and approval." (§10)
- "Enforce authorization and store scope in every query, export, background job, cache key, and agent tool." (§13)
- "Keep credentials out of client responses, logs, reports, and agent prompts." (§13)
- "Create controlled fixtures for edge cases, but distinguish mocked tests from verified live integrations." (§15)
- "Do not spend advertising money, publish listings, or modify live customer orders merely to test analytics." (§15)
- "When a dependency is blocked, investigate supported alternatives and continue independent work. Do not fabricate
  data, bypass access restrictions, or quietly remove the requirement." (§16)
- "No essential action should be a dead button. No demonstration metric should appear as production evidence. No
  unavailable integration should be represented as complete." (§16)
- "Do not automatically merge, publish, or deploy beyond the authorization already granted." (§16)

The spec's build order (§16) is: source and metric audit → approved interface → verified ingestion → store overview →
complete listings workspace → detailed analytics modules → agent integration → reports and alerts → hardening and
reconciliation. The Items below follow it, with the metric layer and the data plumbing first (the codemap's "Fix before
building UI on top").

## The design

Both boards were drawn at 1440×900 with demo data. **Every store, product, number, date and name on them is
illustrative. Never ship one.** Production screens show real data, demo data under the Demo data pill, or a truthful
empty, setup or error state. The boards' sidebar, top bar, Ask AI box, bell and profile chip are the app's own Shell
and `Hero` (compact): don't rebuild them from the board.

Board tokens (from `apps/web/src/index.css`): panel `#131316`, line `#24242a`, text `#f0f0f2`, muted `#8b8b94`, red
`#ff2a3a`, good `#3ddc84`, warn `#f2b43c`, info `#7fb2ff`. Panels are 12 px radius with a 1 px line border.

### Overview board (`store-analytics-overview.png`)

- **Header strip:** title "Store Analytics" and an amber "Demo data" pill, shown only while the selected store is a
  demo store. It is the page's only demo marker in the header.
- **Context bar** (`.ctxbar`, one row, wraps on narrow widths):
  - Store picker: a 28 px initials mark ("GH", `#33161c` fill, `#ffb3ba` text), the store name ("Glow Haus") over
    "<niche> · <channels joined with +>" ("Beauty · Shopify site + TikTok Shop"), a chevron.
  - Period control: "Last 30 days" plus muted "Sep 28 – Oct 27 · full days".
  - Compare control: "vs previous period" plus muted "Aug 29 – Sep 27".
  - Filters control (red border while any filter applies, `.ctl.on`).
  - Right-aligned: "ET · USD" (zone abbreviation and currency), then the freshness chip "● Synced 6 min ago ⓘ".
- **Tabs** (red underline only, `Tabs variant="underline"` with `count`): Overview · Listings & Products 64 · Sales ·
  Traffic & Conversion · Customers · Marketing · Profitability · Operations 4 · Insights & Reports. At the right end of
  the tab row, a small red primary button "✦ Ask about this view".
- **KPI strip:** six tiles in one bordered grid split by 1 px lines. Each tile: label with an info icon, value (21 px,
  tabular), a change line (signed arrow and percent or points, then muted "vs <previous>"), and a muted definition or
  coverage line. Board tiles:
  - Net sales $48,920 · ▲ 12.4% · vs $43,525 · "Excl. tax, after refunds" (the selected tile: `#18181c` fill and a
    2 px red bottom inset);
  - Orders 1,086 · ▲ 8.1% · "Paid, deduped across channels";
  - Avg. order value $45.05 · ▲ 4.0% · "Net sales ÷ orders";
  - Site conversion 1.79% · ▲ 0.02 pts · "Shopify site sessions only";
  - Ad spend $9,840 · ▲ 21.0% in a neutral colour · "Meta + TikTok Ads";
  - Contribution after ads $11,460 · ▼ 3.2% in red · "Unit costs on 92% of units" in the warning colour.
- **Second row** (2fr / 1fr):
  - **Net sales panel:** title "Net sales", sub "Daily · today (partial) not included · Eastern Time", a quiet
    Segmented "Net sales / Orders / Contribution". Legend: the period as a solid line, the comparison as a dashed line,
    and right-aligned channel swatches "Site $38,410 · 842 orders" and "TikTok Shop $10,510 · 244". The SVG chart has
    a soft red area, a 2 px red line, a 1.5 px dashed grey previous-period line, gridlines at $0 / $1K / $2K, weekly
    date ticks, dashed annotation verticals topped by numbered circles (1, 2) and a red "!" circle, and a hover tooltip
    "Tue Oct 14 · $2,446 / Previous: $1,401 (Sep 13)". Under the chart, the annotation list: "1 Oct 10 · Price $32 →
    $34 on Vitamin C Glow Serum · your note", "2 Oct 14 · TikTok creator video went live · your note", "! Oct 21 ·
    Meta Ads data missing for 6 h, backfilled Oct 22 · data health, not a sales change".
  - **What moved net sales:** sub "+$5,395 vs previous period", ghost button "Breakdown →". Rows: thumbnail, title, a
    muted note, a diverging bar around a centre line (green right, red left, scaled to the largest change) and the
    signed amount. Board rows: Vitamin C Glow Serum "TikTok Shop +$2,210 · site +$730" +$2,940; Overnight Lip Mask
    "3 variants" +$1,180; Hydra Barrier Night Cream "38 left in stock" +$960; "59 other products combined" +$1,265;
    SPF 50 Daily Fluid "refunds up" −$310; Jade Facial Roller "Rose Quartz out of stock since Oct 19" −$640. Footer:
    an "Observed" tag and "Each product's share of the change, not its cause."
- **Third row** (1.1fr / 1.2fr / 1fr):
  - **Needs attention:** a count pill and a "How flags work" link. Rows with a tone dot, a title, a muted evidence line
    and a chevron: "Hydra Barrier Night Cream: ~5 days of stock" / "38 left · 7.4 sold a day over the last 14 days";
    "SPF 50 Daily Fluid: 9.1% of units refunded" / "12 of 132 units · store average 2.4%"; "5 products have no unit
    cost" / "8% of units sold · left out of contribution"; "1 TikTok Shop listing failed to sync" / "Silk Sleep
    Scrunchie Set · image under 600 px".
  - **Top products** "by net sales", link "All 64 active listings": Product · Units · Net sales · Change, four rows.
  - **Finding card** (`.ins`): bot icon and "Market Analyst · finding" (ships as the role's app name, decision 43), an
    Observed tag, a headline, a body, evidence chips ("Ad spend, daily", "Contribution v1"), a limitation line ("ROAS is
    TikTok's own 7-day-click attribution, not matched to store orders."), then "Investigate" and ghost "Send to Ad
    Strategist". Tags: Observed `.tag.obs` (blue), Hypothesis `.tag.hyp` (amber), Data health `.tag.dh` (red),
    Rule `.tag.rule` (grey).

### Listings board (`store-analytics-listings.png`)

- Same header, context bar and tabs, with Listings & Products selected. The freshness chip reads "Catalog synced 2 h
  ago": the chip shows the dataset the active tab reads.
- **Toolbar:** quiet Segmented "Active 64 / Draft 7 / Archived 23 / All 94"; a 240 px search "Search title, SKU,
  product ID"; filter chips "Channel All", "Stock Any", "Sales Any", "Collection Any", "+ More"; right-aligned
  "Columns" and "Export" buttons.
- **Current-vs-period note:** "Listings that are active now, with their sales from Sep 28 – Oct 27. Status and stock
  are current; sales, refunds and contribution are for the period."
- **Table** (default columns): checkbox · Product (thumbnail, title, then "SKU · 1 variant", "3 variants", "2 variants
  · 1 out of stock" or "TikTok Shop only · 1 variant") · Channels (SH badge green-outlined, TK badge blue-grey) ·
  Status (dot + text) · Price · Stock ("412"; amber "38 · ~5 d"; amber "57 · 1 out"; amber "22 · low"; muted "Not
  tracked"; red "0 · out") · Units ↓ (the default sort) · Net sales (muted "No sales" for a zero) · Refunds ("$220
  2.0%", red "$348 9.1%", "–") · Contribution (amber pill "No unit cost", "–") · Synced ("6 min", red warning icon + "Failed").
  The drawer's row is highlighted. Overnight Lip Mask is expanded to three indented variant rows ("Berry ·
  GH-OLM-BER"…) with no checkbox.
- **Footer:** "1–25 of 64 active listings · 187 variants · 112 channel listings", Previous (disabled) and Next.
- **Product drawer:** 560 px from the right over a scrim.
  - Header: large thumbnail, "Hydra Barrier Night Cream · 50 ml", sub "GH-HBN-50 · Skincare › Moisturizers · Shopify
    product 8820417", pills "Active on site", "Active on TikTok Shop", amber "38 in stock · ~5 days", "Synced 6 min
    ago", a close button.
  - Tabs: Performance · Variants 1 · Channels 2 · Costs · Refunds · Insights 1.
  - Performance: four mini metrics (Net sales $8,442 ▲ 12.8%; Units 201 ▲ 12.8%; Contribution before ads $4,390 "52%
    of net sales"; Refunds $126 "3 units · 1.5%"); a units-per-day bar chart (0 / 5 / 10 ticks) with legend "Units
    sold per day" and right-aligned "Product views: not tracked ⓘ"; a Rule card "Strong demand, limited stock" ("38 in
    stock (Shopify, tracked) ÷ 7.4 sold a day over the last 14 days = about 5 days of cover. Flags when cover drops
    under 10 days.", limitation "Supplier lead time isn't set, so there's no reorder date."); a channel table Channel ·
    Publication · Units · Net sales · Refunds ("SH Shopify site · Active · since Mar 4 · 152 · $6,384 · $84", "TK
    TikTok Shop · Active · since Jun 18 · 49 · $2,058 · $42"); and the line "Price $42.00 · unit cost $13.20 (Shopify,
    since Aug 2) · fees 2.9% + $0.30 (estimate)".
  - Footer: red primary "✦ Ask about this product", "Send to Operations", ghost "↗ Shopify admin", right-aligned ghost
    "↗ Store page".

### Rules for matching the boards

- **House primitives:** where a `components/ui.tsx` primitive draws differently from a board, match the board through a
  new opt-in prop. Never change a primitive's default look. Already available: `Tabs variant="underline"` with
  `count`, `Segmented quiet`, `Dialog side="right"` with `width` and `footer`, `Hero compact`, `Tooltip`,
  `EmptyState` / `LoadingState` / `ErrorState`. Missing: a leading-media slot on `Dialog` (SA-88 adds `lead`).
- **Controls render only once the item that makes them work has shipped** (decision 33). Until then they are absent,
  not disabled. A KPI tile's Breakdown link, a module tab, Ask about this view, Send to <role> and Export each appear
  with their item.
- **Board copy the app can't back stays out or changes:** "Market Analyst" becomes the role's app name (decision 43);
  AOV's line follows decision 11; "Product views: not tracked" stays unless SA-04's docs check finds a source; "since
  <date>" shows only when the platform gave a publish date; the per-channel note and the drawer's channel table need
  SA-91's product links.
- For this page, the spec and these two boards replace `docs/DESIGN.md` §4 item 3 (SA-158 rewrites it). When the worker
  loop says to compare against `docs/reference/`, compare Overview and Listings with these two boards. The other tabs
  have no board: build them from the same primitives (panel, KPI tile, table, tag, pill, chip) and compare them with
  the Overview's density.

## Decisions already made (coordinator's calls; change one only with a reason written under Notes)

1. **One home per layer.** Server: `apps/server/src/store-analytics/` for every analytics module, route, dedupe and
   source-coverage file, with one router `storeAnalyticsRoutes(db)` mounted once in `app.ts`. Connector helpers:
   `apps/server/src/connectors/ingest.ts`. Web: `apps/web/src/analytics/`. Shared: `packages/shared/src/store-analytics.ts`
   (types prefixed `Sa`, constants `SA_`), re-exported from `packages/shared/src/index.ts`. Reason: a server folder
   named `analytics/` next to `analytics.ts` makes `./analytics` imports ambiguous, and one claimed path set is what
   codex-hardening keeps hands off.
2. **One store at a time.** The page takes a single `?store=` id, then the last store used on this page, then the first
   store in the global `StoreFilter` selection, then the first store. Picking a store here doesn't change the app-wide
   `fe.stores` selection. The multi-store chips and the By Store table leave this page; all-store totals stay on
   Dashboard. Reason: the board has one store picker and §4 wants the selected store unmistakable.
3. **Scope and errors.** Every `/api/analytics/*` route added here calls `readScope(db, query)` first: a missing store
   is 400, an unknown store or another store's record or id is 404, there is no "all stores" and no `stores=` list, and
   every SQL statement filters on `store_id`. `pickStores` is not used by new routes. Reason: §13, and `pickStores`
   silently drops unknown ids and treats an empty value as all stores.
4. **One status vocabulary.** A dataset's status is `SaDatasetStatus`: `verified | available | partial |
   needs_credentials | needs_permission | import | failed | not_tracked | unsupported | demo`, plus a separate `stale`
   flag. A metric value is `SaValue { value: number | null; status: 'ok' | 'partial' | 'estimated' | 'demo' |
   'unavailable'; reason?: SaReason; note?; fix?: { label; href }; coverage? }`, where `SaReason` is one of
   `not_tracked | needs_credentials | needs_permission | needs_ingestion | insufficient_history | unsupported | failed
   | stale`. A filter's reach is `SaFilterScope { applied: SaFilterKey[]; ignored: { key; reason; metric? }[] }`. One
   `<Unavailable>` and one `<FilterScope>` component render them. A missing value is `null` with a reason, never 0.
5. **One metric registry.** `SA_METRICS` in the shared file holds every metric's id, version, label, tile line,
   formula, grain, filters it accepts, currency, timezone, date basis, exclusions, refund and cancellation treatment,
   datasets and direction. An `id@version`'s formula is frozen (any change is a new version). The registry generates
   `docs/features/store-analytics-metrics.md`. Computation lives only in `apps/server/src/store-analytics/`; routes,
   exports, reports, alerts, the digest and the agent tools all call it. Agents reach it through a `ToolEnv.analytics`
   reader (decision 39), because `packages/agents` can't import `apps/server`.
6. **Periods.** The default is the last 30 full days ending yesterday (the board's "full days"). Presets: `today`,
   `yesterday`, `last7`, `last30`, `last90`, `last365`, `mtd`, `last_month`, `ytd`, `custom` (at most 730 days, not
   after the store's today). Only `today`, `mtd` and `ytd` include today, always with a "today so far" qualifier.
   Compare: `previous` (the same number of days just before), `year` (the same dates a year earlier, Feb 29 → Feb 28)
   or `none`. A comparison that starts before the store's history start is unavailable ("History starts <date>"),
   never zero-filled. Days are in the store's zone (`stores.timezone`); a demo store uses the machine zone, labelled
   "This computer's time (demo data)", because `storeZone()` dates demo days that way. With today in the period, the
   comparison's matching day is cut at the same local clock time: order-grain metrics filter by `created_at`, day-grain
   metrics (ad spend, sessions) scale by `dayFraction` and are marked estimated. The pure date math is in the shared
   file; a thin server wrapper adds the store zone, history start and partial-day cut-off.
7. **Changes and ratios.** A zero baseline with a non-zero current is "new" (no percent), 0 vs 0 is no change, a
   negative baseline uses its absolute value, ratio metrics change in percentage points, and either side unavailable
   makes the change unavailable. Ratios and margins are computed from summed numerators and denominators, never as an
   average of row or daily ratios. Money is summed unrounded and rounded to cents at output.
8. **Net sales v1** = gross merchandise − discounts − merchandise refunds, excluding tax and shipping. Refunds are
   dated by refund day by default (Shopify's own reports do this, and it keeps past periods stable). An "original order
   day" view is a toggle (`refunds=order_day`), labelled wherever it applies, and the difference between the two views
   is shown as a reconcile line.
9. **Money columns hold as-placed amounts; refunds live only in the refunds ledger.** `orders.gross_sales`,
   `discounts` and `shipping` are the original amounts (Shopify's original `*Set` fields, not the `current*` ones).
   Refunds go into a new `refunds` table dated by refund day. `orders.total` keeps today's current (net) total for
   `rebuildRevenue` and the legacy surfaces, and `rebuildRevenue` never reads `refunds`. Reason: Shopify, WooCommerce
   and Etsy totals are already net of refunds; reusing `amazon_refunds` or storing current amounts would subtract
   refunds twice (§9). `checkOrderIdentity` (gross − discounts + shipping + tax − refunds = the platform's current total,
   ± 0.01) guards every connector fixture.
10. **Orders v1:** distinct canonical paid orders, counted on their placement day. Test orders, unpaid or voided orders
    and duplicate channel copies are out. An order cancelled after payment counts on its placement day; its money back
    is a refund dated on the refund (cancel) day, and it also shows in the cancelled events. Later refunds never remove
    an order, so past periods don't change. (Owner question Q5.)
11. **AOV v1** = order value (gross − discounts, excluding tax and shipping) of orders placed in the period ÷ those
    orders, unaffected by later refunds; tile line "Order value ÷ orders, before refunds". Reason: refund-day net sales
    and placement-day orders are different cohorts. (Owner question Q2.)
12. **Line source.** Line metrics (units, product sales, product refunds, product cost) read `order_lines`. Orders
    with no `order_lines` (synced before SA-30 or before the re-pull finishes, and demo stores) fall back to
    `order_items`, marked estimated, with their share as coverage. Variant-level values come only from `order_lines`;
    otherwise "Variant sales not recorded yet", never 0.
13. **Cross-channel dedupe** uses source ids and channel mappings only, never names, emails, amounts or times. A
    store-platform order (Shopify, WooCommerce) whose channel is a marketplace that has its own synced integration for
    the store doesn't count inside the days that integration covers, matched by id or not (an unmatched copy inside a
    synced window really is a double count); an id match only labels the pair. Outside those days the copy counts.
    Amazon as a channel (daily totals only) uses the same rule against its `channel_daily` days. Orders from an
    unmapped app are never auto-marked; a data-health warning says they may duplicate. (Owner questions Q1, Q8.)
14. **Conversion.** `site_conversion` v1 = Σ purchasing sessions ÷ Σ sessions over the days where both are reported,
    with coverage. GA4 stores show it unavailable ("GA4 sends event counts, not purchasing sessions") and TikTok Shop
    visitors and Amazon sessions are other channels' traffic. Orders are never divided by sessions and labelled
    conversion. A comparison is unavailable when its two sides would use different metrics. A separate
    `orders_per_session` metric exists only if the owner asks (Q18).
15. **Costs never rewrite history.** A line's known cost is locked: the Shopify order upsert keeps a stored `cogs`,
    `setOrderItems` keeps a known line cost, and `order_lines` keeps its first recorded cost. `setProductCost` never
    rewrites a known past cost. Owner and platform costs are effective-dated in `unit_costs`. A product's first owner
    cost may fill uncosted past lines, flagged `owner_backfill` (Q4). Uncosted lines are left out of contribution and
    shown as coverage. Reason: §9 is explicit.
16. **Contribution, not profit.** `contribution_before_ads` = net sales of costed lines − their product cost − fees.
    `contribution_after_ads` = before − ad spend, at store level only: ad spend is never allocated to products and
    shows as a visible "not allocated" row. Product cost of refunded units counts unless the refund line is
    `restocked`. No `net_profit` metric exists; Profitability shows net profit as unavailable ("needs overhead and
    other expenses the app doesn't track"). No contribution at all (no costs) is unavailable, never 0.
17. **Fees.** Recorded fees (`order_fees`) always win. Amazon-store fees come from the finance events the app already
    reads (no extra calls). Every other fee is a labelled estimate: the store's `fee_percent` × the amount charged
    (gross − discounts + shipping + tax) + `fee_per_order` × orders, not reversed on refunds (processors keep their
    fee), and Amazon as a channel takes `AMAZON_REFERRAL` (15% of its sales) from `analytics.ts`, exported once and
    imported by the fee code. The fee base is stated in the registry.
18. **TikTok Shop's platform discount is not a seller discount.** TikTok funds it, so `discounts` takes
    `seller_discount` only and the definition text says so.
19. **FX by day.** ECB reference rates are stored per day (`fx_rates`). A past day converts at that day's rate (the
    last published one within 7 days for weekends), never today's; a day with no rate is left out and listed. Woo's
    locked per-order `fx_rate` stays. Multi-store totals, Amazon-as-a-channel sales and ad spend use the day rate.
20. **Customers are store-scoped hashed refs.** `orders.customer_ref` = `'c_' + sha256(storeId|kind|platformId)` cut to
    24 hex characters, with `customer_state` identified / guest / unavailable. Nothing personal is stored: no names,
    emails, phones, addresses, buyer messages or refund reasons. The one address-derived field is `orders.country`, an
    ISO-2 code. Data model mapping (§12): customers are these refs on orders; fulfillment events are `fulfilled_at` and
    `delivered_at`; adjustments are refund `other` and the order money parts. Reason: every count the modules need
    works on a hash, and a separate customers table would invite personal data.
21. **Catalog.** `product_variants` sits beside `products`; `products` keeps its first-variant summary columns for its
    existing readers. `channel_listings` holds current state only: no publication history is recorded, so "since
    <date>" appears only from a platform publish date, and nothing claims a product was listed across a past period.
22. **Cross-channel product links** come only from a documented platform id or an explicit owner mapping, never from
    SKU or title. Linked channel products roll into the store product; unlinked ones stay their own rows ("TikTok
    Shop only").
23. **Freshness per dataset.** `source_datasets` (via `noteRead`) records each dataset's last try and last success; the
    sync-run log in `sync.ts` wraps every syncer. A metric's freshness is the oldest of its registry datasets, so a
    fresh order sync never makes ad spend look fresh. One function returns source errors scrubbed of credentials and cut
    to 300 characters; every surface (context, sources, reader, exports, reports, digest) calls it.
24. **"Verified" is earned.** A dataset shows Live verified only after an explicit recorded comparison
    (`PUT /api/analytics/sources/verified`), and the mark is tied to the account it was made on. A sync alone gives
    "available (not verified live)".
25. **No webhooks.** The app runs on localhost with no public endpoint, so platforms can't reach it. Reconciliation is
    the cursor overlap, the attribution and settle re-pulls and the daily catalog passes. The sources doc and the Data
    sources panel say syncs run only while the app is open.
26. **Bounded failure backoff.** After 3 failed runs in a row an integration waits 30 minutes, after 6 it waits 6 hours.
    "Sync now" and a credentials change always run at once, and one success resets the count. (Q9.)
27. **Inventory is point in time.** Daily snapshots per variant, for real stores only, start the day SA-50 ships;
    readers take one value per date and never sum across dates. Demo stores get no snapshots and say "stock history
    not recorded for demo stores". Stock cover = tracked stock ÷ units sold per day over the last 14 full days, whatever
    period is selected (stock is current state). Untracked, sells-when-out, made-to-order, FBA-managed and
    supplier-managed stock never gets a count or a cover estimate.
28. **One rule engine.** `store-analytics/insights.ts` `RULES` (id@version, thresholds as named constants, minimum
    samples) feeds Needs attention, the drawer's Insights tab, Operations flags, alerts and the agent tools. Rule
    insights only ever carry the Observed label; a business rule whose inputs come from a stale or failed source is
    replaced by a data-health insight. No scores, ratings or confidence values anywhere.
29. **Agent findings** get their own table. The server recomputes every evidence value from the scope; a limitation is
    required; causal wording under Observed is refused ("save it as a hypothesis"); confidence scores are refused.
    Saving needs no approval because it writes only an app record.
30. **Demo.** Demo stores reach v1 through the pure `demoDay` function, extended with a deterministic breakdown, and
    through demo catalog rows seeded under the demo flag (variants, channel listings, one product link). No fake
    ledger, snapshot or customer rows. Every demo value has status `demo`; the Demo data pill shows; exports, reports,
    KB cards and agent tool output say demo. Legacy demo revenue doesn't change, so Dashboard doesn't move.
31. **Legacy endpoints stay.** `/api/analytics/summary`, `/campaigns` and `/top-products` stay for Dashboard,
    `ecosystem/useOffice.ts`, the automations and their tests. Only root data fixes reach them: duplicate copies
    leave `rebuildRevenue` and `platformSplit`, and multi-store totals convert per day. Dashboard and the automation
    metric triggers keep the legacy totals; the agent tools and the digest switch to v1 (Q6).
32. **Stale-store protection:** every analytics hook lives in `apps/web/src/analytics/api.ts`, keyed
    `['sa', store, endpoint, params]`, passes react-query's `signal` to the existing `api()`, runs only with a store
    (`enabled: Boolean(store)`), and keeps placeholder data only while the store is the same. `api()` itself doesn't
    change (react-query swallows the cancellation of a query whose key moved on; no analytics code aborts by hand).
33. **No dead controls.** A tab renders only when its content exists; a KPI tile's Breakdown link renders only once
    its target tab is registered; buttons that need a later item are absent until it ships.
34. **New charts** (`TrendChart`, `BarChart`) live in `apps/web/src/analytics/`; `components/AreaChart.tsx` stays as it
    is for Dashboard and Product Research. Every chart has a text summary label and a Table toggle.
35. **Exports:** one engine (`store-analytics/exports.ts`), same-origin GET CSV, RFC 4180 quoting, UTF-8 with BOM, a
    `'` prefix on text cells starting with `= + - @`, tab or CR, a header block (store, period, zone, comparison,
    filters applied and not applied with reasons, currency and FX policy, each definition id@version and formula, each
    source's freshness, a demo line, generated at, rows n of m), capped at 50,000 rows with a stated cap.
36. **Alerts and scheduled reports** reuse `automation_rules` (`trigger_json` / `action_json`, no migration), the
    scheduler's cooldown and daily cap, the run log and the `done_once` ledger for dedupe. Delivery is in-app only (a
    notification, or a digest line): the app has no email sending. No new `NotificationKind`, because `settings.ts`
    `PREF` is exhaustive and Settings is hands-off. The UI says jobs run only while the app is open.
37. **Saved views** belong to the owner (the app has no accounts; see `docs/features/settings-codemap.md`). The store's
    default view is its reporting preference (period, comparison, refund view, filters, columns), applied when the
    store is picked.
38. **Performance:** aggregation runs at query time over indexed tables. `EXPLAIN QUERY PLAN` with no SCAN of orders,
    order lines, refunds, fees or campaign days is the strict gate; real timings are recorded, and a call fails only
    over 2 s. A store-scoped cache (LRU of 200, keyed store id + definitions version + query + data watermark) is added
    only if the measured p95 on the scale fixture is over 150 ms. Listings stay server-paged (25 a page).
39. **Agent tools** read through `ToolEnv.analytics` (`AnalyticsReader`, implemented in
    `store-analytics/reader.ts`, wired in the `toolEnv` object of `routes/agents.ts`). It holds no SQL of its own.
    `packages/agents/src/ads.ts` `economics` / `thresholds` / `uncostedShare` / `adWindow` stay as they are, because
    codex-owned `agents-outcomes.ts` scores outcomes with them.
40. **Migrations.** "Migration 56" in this file means this lane's first migration: 56 is the next free number on main
    today, but the Settings lane also adds migrations, so use whatever number is next when SA-07 is written.
    Migration 56 holds every data table and column this lane needs. Later migrations add only the late
    app-record tables (findings, views, annotations, goals, watchlist, reports), any index the plans test proves
    missing, and the single re-pull (plus a TikTok-only cursor reset if SA-54 ships after it). Each is labelled
    `/* NN (store-analytics: SA-xx) */`; a shipped migration is never edited; on a rebase conflict keep both and
    renumber ours to the end.
41. **Phase E gate and claimed functions** (see Lane). store-analytics claims `rebuildRevenue`, `setOrderItems`,
    `setStoreTimezone` and `forgetPlatform` in `connectors/common.ts` and `syncTikTokShop` in `connectors/tiktok.ts`;
    codex-hardening leaves them alone and is never asked to edit them. Other code in Phase E files is codex's while
    Phase E runs.
42. **Live checks are Blocked until the owner connects a source.** The owner uses the store's existing integration (no
    reconnect, no new scopes beyond the optional ones listed); the worker sends only GET or GraphQL query requests and
    never approves, publishes, edits, refunds or spends.
43. **Names.** The finding card names the agent by the app's role name: `AGENT_ROLES.market_analyst` is "Analytics
    Specialist". The board's "Market Analyst" is placeholder text.
44. **Read-only analytics.** Analytics routes are GET, apart from CRUD on its own app records (views, annotations,
    goals, watchlist, findings, alerts, reports, product links, the verified mark). Any live-store change an agent
    proposes goes through its existing approval tools.
45. **Annotations** come from one API that merges the owner's notes, read-only markers derived from real records
    (`price_tests` rows, approved app changes) and data-health markers from the sync-run log. The list header says
    "Context only, not a cause".
46. **Forecasts** only where defensible: a weekday average over the last 8 full weeks with an 80% range from those
    weeks' residuals, a horizon of at most 14 days, for net sales, orders and units only, and only with 56 complete
    days, no data-health gap and at least 1 order a day; otherwise unavailable with the reason. Targets, forecasts and
    actuals are drawn and labelled apart. (Q24.)

## Lane

**Finite.** Work the phases in the order below (Foundation → Verified ingestion → Interface → Overview → Listings &
Products → Modules → Agent integration → Reports and alerts → Hardening and acceptance), then write the report
(SA-158), create an empty `.agent/STOP` in this worktree and stop. Never add an item after SA-158; this overrides
CLAUDE.md's "Backlog empty?" rule. A gap found on the way goes under Notes (as a limitation) or into the owning lane's
Inbox. A defect in this lane's own code is fixed inside the item that finds it.

- **Worker:** one Claude worker in the Orca workspace "Store Analytics", worktree
  `C:/Users/Xody2/orca/workspaces/FrontlineEcom/store-analytics`. Lane log: `Build Log/store-analytics.md` in the
  project vault. Ports for this worktree: `WEB_PORT=5313`, `API_PORT=8933`.
- **Owner questions:** CLAUDE.md says never ask and never wait. Every open question is under Notes with the default
  used meanwhile; build on the default.
- **Owns** (plus each file's `*.test.ts(x)`):
  - new `apps/server/src/store-analytics/**` (routes, metrics, period, dedupe, sources, insights, exports, reader,
    fixture);
  - new `apps/server/src/connectors/ingest.ts`, `apps/server/src/connectors/*.contract.test.ts` and
    `apps/server/src/connectors/fixtures/**`;
  - new `apps/web/src/analytics/**`, and `apps/web/src/pages/Analytics.tsx` with its test;
  - new `packages/shared/src/store-analytics.ts`, plus its one re-export line in `packages/shared/src/index.ts`;
  - `docs/features/store-analytics-codemap.md`, the new `docs/features/store-analytics-metrics.md`,
    `docs/features/store-analytics-sources.md`, `docs/features/store-analytics-report.md` and
    `docs/features/store-analytics-screens/**`, and this file. The spec `docs/features/store-analytics.md` is the
    owner's text: never edit it.
- **Touch points** (edit only what the item names; their owning lanes are stopped, but the Settings lane shares some of
  these files, see Hands off):
  - `apps/server/src/db.ts`: append migrations only.
  - `apps/server/src/app.ts`: mount `storeAnalyticsRoutes(db)` and the existing `guard` on `/api/analytics/*`, once.
  - `apps/server/src/analytics.ts`: export `AMAZON_REFERRAL`; leave duplicate copies out of `platformSplit`; per-day
    FX for multi-store totals.
  - `apps/server/src/fx.ts`: store daily rates. `apps/server/src/sync.ts`: the sync-run wrapper and the backoff.
  - `apps/server/src/connectors/shopify.ts`, `woocommerce.ts`, `etsy.ts`, `amazon.ts`: the ingestion items.
  - `apps/server/src/catalog.ts` `setProductCost`; `apps/server/src/demo.ts` (`demoDay` breakdown, demo catalog rows).
  - `apps/server/src/digest.ts` and `apps/server/src/automations.ts`: the v1 digest, alert and report rule kinds.
  - `packages/agents/src/tools.ts`: the `ToolEnv` interface and the read tools the agent items name. Never its
    approval or cap-counter sections (codex-hardening Phase A).
  - `packages/agents/src/roles.ts` and `configs.ts` (tool lists) and `packages/agents/src/conversations.ts` (the
    analytics context preface). `apps/server/src/routes/agents.ts`: the `toolEnv` object only.
  - `packages/shared/src/index.ts`: additive only (the re-export line, the `analytics` conversation context).
    `apps/web/src/agents/Conversation.tsx`: `ContextChip` only (SA-126).
  - `apps/web/src/components/ui.tsx`: new opt-in props only. `apps/web/src/pages/Dashboard.tsx`: one label (SA-143).
  - `CLAUDE.md`: this lane's row in the lanes table (SA-01). `docs/DESIGN.md`: §4 item 3 only (SA-158).
- **Claimed functions** (decision 41): `rebuildRevenue`, `setOrderItems`, `setStoreTimezone` and `forgetPlatform` in
  `apps/server/src/connectors/common.ts`, and `syncTikTokShop` in `apps/server/src/connectors/tiktok.ts`. Edit them
  only outside the Phase E window.
- **Hands off:**
  - codex-hardening (running now) owns each of its phases' files while that phase runs; read its backlog at the
    start of each of our phases. Never edit `e2e/**`, `playwright.config.ts` or the root `package.json`.
  - Settings (running now: Claude worker "Settings", lane `settings`, ports 5253/8867, backlog
    `docs/backlog/settings.md`) owns `apps/web/src/pages/Settings*.tsx`, `apps/web/src/settings/**`,
    `apps/server/src/settings.ts`, `apps/server/src/config/**`, `packages/shared/src/settings.ts` and
    `docs/features/settings*.md`. Where it meets this lane:
    - store fields (`stores.ts`, `StoreForm.tsx`): Settings owns editing them, including timezone, currency and fees.
      This lane only reads them; a store-field need goes to the Settings Inbox.
    - `connectors/*.ts`: Settings adds a read-only test-connection client per kind and change rows when a sync
      overwrites currency or timezone. Rebase before every connector item and keep both changes.
    - `pages/Analytics.tsx`: Settings may add links to `/settings`; keep them when the page is replaced.
    - `pages/Integrations.tsx` moves into `apps/web/src/settings/integrations/`: link to the integrations route,
      never import the page file.
    - `apps/server/src/dates.ts`: `localDate`, `midnight` and `utcOffset` move into `packages/shared`, and `dates.ts`
      re-exports them so callers don't change. Import from wherever they live when the item is built.
    - Settings adds a workspace timezone for cron, the digest and daily caps. The store timezone keeps its analytics
      role (reporting days, metric windows); SA-142 and SA-143 schedule by the workspace timezone once it exists.
    - Migrations: both lanes add them. Take the next free number when writing one and rebase right before.
  - `apps/server/src/integrations.ts` is not edited (the verified mark compares accounts on read instead).
  - A request to another lane is one line appended to that lane's backlog Inbox:
    `- [ ] (from store-analytics) <request>`.
- **Phase E window.** codex-hardening's Phase E is running while CH-20 is ticked on origin/main, CH-22 is not, and
  `C:/Users/Xody2/orca/workspaces/FrontlineEcom/codex-hardening/.agent/STOP` doesn't exist. Check with
  `git fetch origin` and `git show origin/main:docs/backlog/codex-hardening.md` at the start of every gated item.
  - A claimed function, inside the window: move the item to Blocked ("waits for CH-22") and send no request.
    Outside the window: edit it here.
  - Unclaimed Phase E code (`meta.ts`, `syncGa4` in `google.ts`, the TikTok Ads part of `tiktok.ts`, `adRate` and
    `backfillRate` in `common.ts`), inside the window: append the exact change to codex-hardening's Inbox and move
    the item to Blocked. Once the window closes, check whether codex made the change; if not, make it here.
  - Before the window opens: edit unclaimed Phase E code here only in a small commit that names the item, and add a
    line to codex-hardening's Inbox saying what changed, so CH-21 and CH-22 start from it.
  - Re-check every Blocked item at the start of each phase and before SA-157.
- **Live checks** (SA-35, SA-40, SA-43, SA-46, SA-49, SA-56, SA-59) move to Blocked until the owner connects that
  source; nothing is connected today. The owner uses the store's existing integration (no reconnect). The worker
  sends only GET or GraphQL query requests to the platform. A source connected after SA-158 means restarting the
  lane on its live check.
- **Verify UI** in Orca's built-in browser (`orca skills get orca-cli --reference references/browser.md`) at
  `http://localhost:5313/analytics`, at 1440×900 (the board size), 1280 and 390 wide. Screenshot it and compare
  Overview and Listings with `docs/reference/store-analytics-overview.png` and `store-analytics-listings.png`. Keep
  the final screenshots in `docs/features/store-analytics-screens/`.
- **Tests:** any logic (math, parsing, state, money) gets a test, written first. Connector tests use recorded or
  doc-example responses only; nothing in `pnpm check` touches the network. Agent tests use the fake engine
  (`FRONTLINE_AGENT_ENGINE=fake`); at most one short real-engine run in the whole lane (SA-156).

### Rules (the spec's non-negotiables)

1. Never fabricate a metric, chart point, account, connection or completed sync. A dataset is "verified" only with a
   recorded live comparison (SA-15).
2. Missing data is `null` with a reason (unavailable, not tracked, needs credentials, needs permission, estimated,
   partial), never 0. A zero is shown only when the source reported the period and it was zero.
3. Demo data is labelled everywhere it appears: the page pill, every value's status, exports, reports, KB cards and
   agent tool output.
4. Analytics is read-only. Its only writes are its own app records (decision 44). Prices, stock, listings, ads and
   orders change only through the existing approval workflows.
5. Never spend ad money, publish a listing, refund, cancel or edit an order, or message a customer to test anything.
6. Credentials never appear in client responses, logs, sync errors, exports, reports, KB cards or agent prompts.
   Every source error goes through the one scrub function (SA-10).
7. Every query, export, cache key, job and agent tool is scoped to one store id through `readScope` (SA-13).
8. One definition per metric (`SA_METRICS`). Cards, charts, drilldowns, exports, reports, alerts and agent tools all
   call `store-analytics/`.
9. No automatic merge, publish or deploy beyond what CLAUDE.md already allows (workers push to main).
10. No promise of background work while the app is closed: syncs, alerts and scheduled reports say "Runs while
    Frontline Ecom is open". Retries are bounded (decision 26); no unbounded loops.
11. No scores, ratings or confidence numbers. Correlation is never presented as cause; a hypothesis is labelled.

## Done when

The spec's definition of done (§16), as checks:

- [ ] Overview and Listings & Products match the two approved boards in Orca's browser at 1440×900 (SA-155), and
  the other tabs use the same primitives.
- [ ] Core data paths work: each source's orders, refunds, lines, catalog and traffic land in the ledger and reach the
  screen (SA-26 to SA-60), and each source's live check is ticked or under Blocked waiting for the owner.
- [ ] Calculations reconcile under the documented definitions: the oracle fixture matches to the cent (SA-09, SA-24),
  and `store-analytics-metrics.md` matches `SA_METRICS` (SA-05).
- [ ] Every active listing is reachable across pages, with its variants and per-channel states (SA-82, SA-94).
- [ ] Store isolation holds on every route, export, cache key, job and agent tool (SA-13, SA-144).
- [ ] `pnpm check` is green, plus the scale run (SA-25) and the e2e spec where it exists (SA-154).
- [ ] No dead button, no demo value shown as real (SA-149), and no unavailable integration shown as complete (SA-64).
- [ ] The report (SA-158) lists what was built, which sources work, which workflows were tested live, the calculation
  and reconciliation results, screenshots and the remaining limitations.

The acceptance table (§15):

- [ ] **Store selection:** the right store's data loads, a late response for the previous store never replaces it,
  and another store's ids get 404 (SA-61, SA-144, SA-148).
- [ ] **Live data:** one real source-to-database-to-screen path checked, with true freshness (SA-35, or the first
  live check that can run). Until then the report says no live path has been verified.
- [ ] **Listings completeness:** every eligible listing reachable across pages, with variants and channel states
  (SA-94).
- [ ] **Metric consistency:** cards, charts, drilldowns, exports and agent tools match for the same scope
  (`consistency.test.ts`, SA-152).
- [ ] **Transaction handling:** partial refunds, cancellations, late updates, duplicate channel orders and test
  orders follow decisions 8 to 13 (the SA-09 oracle).
- [ ] **Cost and currency:** missing costs, cost history, mixed currencies and unallocated spend never create a
  misleading profit (SA-19, SA-26, SA-53, SA-110).
- [ ] **Filters and comparisons:** periods, timezones, scope notes, zero baselines and partial periods behave as
  decisions 6 and 7 say (SA-06, SA-68).
- [ ] **Data failures:** disconnections, rate limits, stale sources and interrupted jobs give recoverable states and
  no fallback values (SA-10 to SA-12, SA-149).
- [ ] **AI insights:** agents use scoped evidence, link the records and keep uncertainty (SA-117 to SA-124).
- [ ] **Persistence:** saved views, annotations, jobs and findings survive navigation and a server restart (SA-153).
- [ ] **Permissions and exports:** no credential or other store's record leaks through downloads, caches or agent
  tools (SA-145, SA-146).
- [ ] **Scale and usability:** a large catalog and two years of history stay fast; 390 px widths and keyboard use
  work (SA-25, SA-150).

## Inbox

- [x] (from settings, ST-06) The settings registry (`SETTINGS` in `packages/shared/src/settings.ts`) names consumers in your files: `apps/server/src/analytics.ts#loadRows` (`store.feePercent`, `store.feePerOrder`) and `apps/server/src/connectors/common.ts#setStoreTimezone` (`store.timezone`). `packages/shared/src/settings.test.ts` fails if a named symbol leaves its file: when you rename or move one, update that entry's `consumers` (and `proof`) in the same commit, a permitted tiny edit for any lane. Nothing else changes for you.

- [x] (from codex-hardening, CH-22) Contract follow-ups for ingestion semantics: Google metrics.conversions/conversions_value include configured primary conversion actions, not necessarily purchases, and conversions may be fractional (current reader rounds into purchases). Verify purchase-only attribution or label/store conversions honestly before using them as purchase sample counts; official reference https://developers.google.com/google-ads/api/fields/v26/metrics. TikTok Branded Mission is advertiser-only (campaign/ad breakdowns omit it), and ad_id is creative-level for Upgraded Smart+ while ad_id_v2 is asset-group level; qualify coverage before declaring store totals complete (https://business-api.tiktok.com/gateway/docs/index?doc_id=1751443956638721). Default: preserve existing fixtures/version and expose unsupported/unavailable datasets. Meta Marketing API v24.0 cutoff is November 10, 2026 per https://developers.facebook.com/docs/marketing-api/marketing-api-changelog/ (browser-rendered October 28); coordinate read/write version qualification with core before that date. CH-21 campaign-first commits and visible ad-error status must survive your ingestion changes.

- [x] (from codex-hardening) Phase E is active now despite CH-20 remaining unticked: its four flows pass, but three mobile layout failures prevent the green-twice acceptance. Please use CH-21/22 progress plus .agent/STOP for this window, not CH-20 alone. Your SA-01 claimed functions are acknowledged and untouched; ad sync portions of meta/google/tiktok are being hardened in CH-21, contracts in CH-22. Also inherit the CH-19 Analytics axe filing from UI Inbox: 12 Research links have visible labels missing from their accessible names (plus the shared Ask AI control). Repro pnpm e2e --grep "accessibility: analytics"; baseline e2e/axe-baseline/analytics.json records these current issues.
<!-- other lanes append requests here: - [ ] (from <lane>) <request> -->

- [x] (from settings, ST-07) `PATCH /api/settings` and `PUT /api/caps/:storeId` now require the `version` the caller
  read (`Settings.version`, `StoreCaps.version`; 0 before the first save): 428 without it, 409 `{code: 'stale'|'exists',
  current}` when it's old. `PUT /api/caps` saves only the keys sent, as store overrides. `version` is required in
  `SettingsUpdate` and `StoreCapsUpdate`, so `useUpdateSettings` and `useSaveCaps` callers fail typecheck without it.
  New: `GET /api/config?store=` and `PATCH /api/config` (behind the guard). In-process `updateSettings`/`updateCaps`
  take the version as an optional argument, so direct callers keep working; `getCaps` now returns the effective caps
  (store override, else workspace default) plus `version`.

- [ ] (from settings, ST-08a) `PATCH /api/stores/:id` now requires the `version` the caller read (`Store.version`,
  on every store response): 428 without it, 409 `{code: 'stale', current}` when it's old; `POST /api/stores` is exempt.
  A store 400 now carries `field` (the body key). `useStoreActions().save` with an `id` requires `version` in its input
  type. In `connectors/common.ts`, `setStoreCurrency` takes an optional actor (default `system`) and, like
  `takeCurrency` (`sync:<kind>`) and `takeTimezone`, bumps the store's version and writes a `settings_changes` row
  when the value moves; status, cursor and `connected` writes don't. `setStoreTimezone` is unchanged.
- [ ] (from settings, ST-08c) `PATCH /api/automations/:id` and `PUT /api/integrations` now require the `version` the
  caller read (`AutomationRule.version`, `Integration.version`; a new connection sends 0): 428 without it, 409
  `{code: 'stale'|'exists', current}` when it's old. `POST /api/automations` is exempt. Their 400s carry `field`, and
  a store 400's `field` is now the registry id (`store.currency`), not the body key the ST-08a line said. In-process
  `saveIntegration` is unchanged (no version). `enableDefaultJobs`, `createDefaultJobs`' task rewrite and the job-gates
  pass bump the rule's version and write `system` change rows. New `apps/server/src/config/sweep.test.ts` fails on any
  write to `stores`, `automation_rules`, `store_caps`, `kb_controls`, `pr_store_profiles` or `integrations` that
  neither moves `version` nor is listed in it: a bookkeeping column (status, cursor, timestamps, sync or test results)
  goes in its BOOKKEEPING list, an owner field goes through the owner helper. Either is a tiny edit any lane may make.

## Items

Format: each item names its spec sections, then what to build, then an Acceptance line. "After SA-NN" means that
item must be ticked first. Line numbers in this file drift; re-find each symbol before editing it.

### Phase 1 — Foundation (source and metric audit, the metric layer, the schema)

The metric layer comes before the connectors on purpose: it reads only migration-56 columns and the fixture, so each
connector item afterwards proves its path from source to metric.

- [x] SA-01 **Lane setup: claims, CLAUDE.md row and touch points** (spec §1 Stage Four, §16):
  - The `store-analytics` row in the CLAUDE.md lanes table was added by the lane setup commit. Check it matches the
    Owns list in Lane; fix the row if it doesn't.
  - Append to `docs/backlog/codex-hardening.md` Inbox: `- [ ] (from store-analytics) store-analytics claims
    rebuildRevenue, setOrderItems, setStoreTimezone and forgetPlatform in connectors/common.ts and syncTikTokShop in
    connectors/tiktok.ts (your Lane keeps hands off what Store Analytics claims). Everything else in your Phase E
    files stays yours; we file changes to it in this Inbox.`
  - Run `pnpm check` on a clean tree and record the test count under Done.
  - Acceptance: the row and the Inbox line are on origin/main; baseline green.

- [x] SA-02 **Stage One re-audit, metric inventory and baseline** (spec §1 Stage One, §5, §9):
  - Re-check every claim in `docs/features/store-analytics-codemap.md` against main. Correct the wrong ones in place
    and add a dated "re-checked at <commit>" line.
  - Add a metric inventory table to the codemap: every place that computes a store metric today, its formula, and
    the v1 metric that replaces it or "stays legacy" (decision 31). Rows: `analytics.ts` `summarize`,
    `platformSplit`, `campaignStats`, `topProducts`; `Dashboard.tsx`; `digest.ts` `sendDigest`; the
    `automations.ts` metric triggers; the agent tools `store_summary`, `compare_stores`, `metrics_timeseries`,
    `list_products`, `list_campaigns`, `review_campaigns`; `packages/agents/src/ads.ts` `economics`;
    `ecosystem/useOffice.ts`. `routes/agents-outcomes.ts` and `kb/performance.ts` are listed as read-only rows
    (codex-owned, unchanged).
  - Acceptance: codemap updated; no code change.

- [x] SA-03 **Shared contracts** (spec §4, §5):
  - `packages/shared/src/store-analytics.ts` with `SaDatasetStatus`, `SaReason`, `SaValue`, `SaCoverage`,
    `SaFilterKey`, `SaFilterScope` exactly as decision 4, re-exported from `packages/shared/src/index.ts`.
  - `apps/web/src/analytics/Unavailable.tsx`: renders a value's reason text, note and fix link; never a number.
    `apps/web/src/analytics/FilterScope.tsx`: lists the filters a panel ignores, with reasons; renders nothing when
    none are ignored.
  - Acceptance: tests: a `null` value renders its reason for each `SaReason` and no "0" or "$0"; `FilterScope` with
    an empty `ignored` renders nothing.

- [x] SA-04 **Source capability record and sources doc** (spec §5 Source capability assessment):
  - `SA_SOURCES` in the shared file: for each source kind the app syncs (every key of `SYNCERS` in `sync.ts`, plus
    `demo`) and each dataset (orders, order lines, refunds, fees, catalog, variants, channel listings, inventory,
    collections, traffic, purchasing sessions, traffic breakdowns, customers, ad spend, attribution): `supported`,
    `import` or `unsupported`; the API field or report it comes from; the scopes it needs; history depth; rate limit;
    and the reason when unsupported.
  - Docs check with web search against each platform's official reference (cite URL and date): product views per
    product (Shopify, TikTok Shop, Amazon, Etsy) and ad-to-product links (Meta, Google Ads, TikTok Ads). A field is
    `supported` only if a documented read exists under the scopes the app's integration already has (or the optional
    ones listed in SA-35); otherwise `unsupported`, shown as "Not tracked".
  - Write `docs/features/store-analytics-sources.md` from it, including "syncs run only while the app is open; there
    are no webhooks" (decision 25).
  - Acceptance: a test fails when a `SYNCERS` key has no `SA_SOURCES` row; the doc lists every `unsupported` dataset
    with its reason.

- [x] SA-05 **Metric definition registry v1** (spec §9):
  - `SA_METRICS` (decision 5) for: `net_sales`, `gross_sales`, `discounts`, `refunds`, `orders`, `aov`, `units`,
    `cancelled_orders`, `refund_rate`, `sessions`, `site_conversion`, `ad_spend`, `platform_roas`,
    `contribution_before_ads`, `contribution_after_ads`, `cost_coverage`, `fees`, `stock_cover`. Later items add
    their metrics here, never in their own files.
  - `renderMetricsDoc(SA_METRICS)` writes `docs/features/store-analytics-metrics.md`. A test in
    `packages/shared/src/store-analytics.test.ts` compares the committed doc with it and, when they differ, fails
    with the regenerate command
    (`UPDATE_METRICS_DOC=1 pnpm exec vitest run packages/shared/src/store-analytics.test.ts`).
  - Frozen formulas: the test keeps a hash per `id@version`; changing a formula without a new version fails.
  - Acceptance: both tests; the doc is committed.

- [x] SA-06 **Period, comparison and value helpers** (spec §4, §9):
  - Shared, pure: `SA_PRESETS`, `resolvePeriod`, `comparePeriod`, `validateCustom` (at most 730 days, not after the
    store's today, start not after end), `changeOf`, `ratio`, `combineStatus`, per decisions 6 and 7.
  - `apps/server/src/store-analytics/period.ts`: wraps them with the store zone (`stores.timezone`; a demo store uses
    the machine zone and its label), the history start (the first order's `local_date` or the first `daily_metrics`
    date) and the partial-day cut (`dayFraction` from `apps/server/src/dates.ts`).
  - Acceptance: tests: year compare from Feb 29; DST start and end days in America/New_York; zero baseline "new";
    0 vs 0; negative baseline; ratio changes in points; a comparison before history is unavailable; `mtd` on the 1st;
    731-day custom refused; today's comparison day cut at the same local time.

- [x] SA-07 **Ledger and catalog schema (migration 56)** (spec §12 Data model):
  - One migration `/* 56 (store-analytics: SA-07 ledger, catalog, sources) */`. All new columns are nullable with no
    DEFAULT (null means unknown). Every store-scoped table has `store_id ... REFERENCES stores(id) ON DELETE CASCADE`.
  - `orders` gains `source_kind`, `source_id`, `channel`, `channel_order_id`, `duplicate_of`, `customer_ref`,
    `customer_state`, `country` (ISO-2), `currency`, `gross_sales`, `discounts`, `shipping`, `paid_at`,
    `cancelled_at`, `fulfilled_at`, `delivered_at`, `source_updated_at`, `breakdown_at`; partial indexes on
    `(store_id, channel, channel_order_id) WHERE channel_order_id IS NOT NULL` and
    `(store_id, customer_ref) WHERE customer_ref IS NOT NULL`.
  - `products` gains `category`, `handle`, `synced_at`. `daily_metrics` gains `purchase_sessions`.
  - New tables:
    - `refunds` (one row per refund line: `id`, `refund_id`, `order_id`, `product_id`, `variant_id`, `refunded_at`,
      `local_date`, `merchandise`, `shipping`, `tax`, `other`, `quantity`, `restocked`, `source`), with no FK to
      orders (a refund can arrive before its order), indexed by day, order and product;
    - `order_fees` (`order_id`, `kind`, `amount`, `currency`, `local_date`, `source`);
    - `order_lines` (`order_id`, `line_id`, `product_id`, `variant_id`, `sku`, `quantity`, `gross`, `discount`,
      `cost`, `cost_source`, `owner_backfill`), indexed by product and variant;
    - `product_variants` (`product_id`, `id`, `title`, `sku`, `price`, `compare_at`, `inventory`,
      `inventory_tracked`, `inventory_policy`, `status`, `synced_at`);
    - `channel_listings` (PK `store_id, channel, id`; `product_id`, `variant_id`, `status`, `error`,
      `published_at`, `synced_at`);
    - `product_links` (`store_id`, `channel`, `channel_product_id`, `product_id`, `method` `platform_id | owner`,
      `created_at`);
    - `product_collections` (`store_id`, `collection_id`, `product_id`, `title`, `source`, `synced_at`);
    - `unit_costs` (`product_id`, `variant_id`, `cost`, `currency`, `source`, `effective_from`, `recorded_at`);
    - `inventory_snapshots` (PK `store_id, variant_id, date`; `quantity`, `tracked`);
    - `sync_runs` (`id`, `integration_id`, `store_id`, `kind`, `started_at`, `finished_at`, `status`, `error`);
    - `source_datasets` (PK `integration_id, dataset`; `store_id`, `status`, `last_try_at`, `last_success_at`,
      `error`, `covered_from`, `covered_to`, `verified_at`, `verified_account`, `verified_note`);
    - `fx_rates` (PK `date, currency`; `rate`);
    - `traffic_breakdown_daily` (PK `store_id, date, dimension, value`; `sessions`, `purchase_sessions`, `source`).
  - No `cancelled` column (`cancelled_at` covers it) and no publication history table (decision 21).
  - Acceptance: a test applies migrations to an empty database and to a database at 55 with rows; the whole suite
    stays green.

- [x] SA-08 **Claimed common.ts functions (Phase E gate)** (spec §5 Avoid duplicated orders, §9):
  - Check the Phase E window first; inside it, move this item to Blocked ("waits for CH-22") and go on.
  - `rebuildRevenue`: add `AND duplicate_of IS NULL` to the paid-orders branch and `AND o.duplicate_of IS NULL` to
    the `amazon_refunds` branch.
  - `setOrderItems`: on reinsert, a line whose stored cost is known (> 0) keeps it (decision 15). The `orders.cogs`
    rule (fill only where 0) stays.
  - `setStoreTimezone`: also re-date `refunds.local_date` and `order_fees.local_date` (real stores). Inventory
    snapshots keep their dates (they are the day they were taken, and re-dating could collide two on one day).
  - `forgetPlatform`: also delete that platform's rows from `refunds`, `order_fees`, `order_lines`,
    `product_variants`, `channel_listings`, `product_links`, `product_collections`, `unit_costs`,
    `inventory_snapshots` and `source_datasets`, by the same id prefix it already uses.
  - Acceptance: tests first: a duplicate copy is out of `daily_metrics.revenue`; a known line cost survives a re-sync
    after the product's cost changed; a zone change re-dates refunds; forgetting one platform leaves the other
    platform's rows. The existing `common` tests stay green.

- [x] SA-09 **Ledger fixture, oracle and legacy pins** (spec §15):
  - `apps/server/src/store-analytics/fixture.ts` `seedLedgerStore(db)`: one non-demo store (Shopify with a TikTok Shop
    channel and Meta ads) with hand-built cases: a partial refund; a full refund on a later day; a cancel after
    payment; a test order; an unpaid order; TikTok copies (id-matched inside the covered days, unmatched inside, and
    one outside); an uncosted line; a cost change mid-period; a EUR order; a DST day; an order at 23:59 local; a
    refund that arrives before its order; a zero-sales day; a restocked refund.
  - `oracle.test.ts`: the expected v1 values for three periods, worked out by hand in the test file (never by the
    code under test), with one comment per number saying how it was reached.
  - Legacy pins: the current output of `summarize`, `platformSplit` and `topProducts` for the demo stores and the
    fixture store, so a root fix shows up as an explicit pin change.
  - Acceptance: the fixture seeds; the oracle file exists with every metric from SA-16 to SA-21 marked `todo` until
    its item ships; pins committed.

- [x] SA-10 **Sync-run log** (spec §12 Processing pipeline, §13):
  - `apps/server/src/store-analytics/sources.ts` `scrubError(text, secrets)`: removes every credential value and
    token-shaped string, cuts to 300 characters. It is the only way a source error leaves the server (decision 23).
  - In `sync.ts`, wrap each syncer run in a `sync_runs` row (running → done or failed with the scrubbed error). A run
    still `running` at server start is marked `interrupted`. Prune runs older than 90 days at start.
  - Acceptance: tests: success, failure, an interrupted run, and an error that contains the integration's token comes
    out without it.

- [x] SA-11 **Bounded backoff** (spec §1, §5; decision 26):
  - In `startSyncLoop`, count consecutive failed runs per integration from `sync_runs`: 3 → wait 30 minutes, 6 →
    wait 6 hours. The existing manual sync path and a credentials change run at once; one success resets the count.
  - Acceptance: tests with a fake clock for each case; no loop retries faster than the wait.

- [x] SA-12 **Per-dataset read outcomes** (spec §5 Honest coverage states):
  - `apps/server/src/connectors/ingest.ts` `noteRead(db, integration, dataset, outcome)` writes `source_datasets`
    (last try, last success, status, scrubbed error, covered range).
  - Call it in `shopify.ts` (orders, products, the funnel read, whose `() => null` stays but now records the failure),
    and in `amazon.ts` for `listingsOf`, `fbaStock`, `trafficOf`, `ordersOf` and `refundsOf` (each
    `.catch(() => undefined)` keeps swallowing but records `failed`), `woocommerce.ts` and `etsy.ts`. TikTok Shop and
    the ad networks get theirs in their gated items (SA-54, SA-58).
  - Acceptance: recorded-response tests: a failed Amazon traffic read marks traffic `failed` while orders stay
    `available`; a Shopify funnel error marks traffic `failed` with a scrubbed message.

- [x] SA-13 **Router, scope, guard and route sweeps** (spec §13, §9):
  - `apps/server/src/store-analytics/routes.ts` `storeAnalyticsRoutes(db)`, mounted once in `app.ts`, with
    `.use('/api/analytics/*', guard)` (the existing `kbGuard()` instance). The legacy routes keep their paths.
  - `readScope(db, query)` per decision 3. `GET /api/analytics/definitions` returns `SA_METRICS` and `SA_SOURCES`.
    Any `metrics=` id not in the registry is 400.
  - `scope.test.ts`: one row per new route (missing store 400, unknown store 404, another store's record id 404), and
    a check that every `/api/analytics/` route in `app.routes` has a row, so a new route without one fails. Later
    items add their rows.
  - Acceptance: both tests; the legacy routes' tests unchanged.

- [x] SA-14 **Coverage and context endpoints** (spec §4, §5):
  - `datasetFreshness(db, storeId)` in `sources.ts`: per dataset the status, last success, `stale` (no success for
    3× its sync interval), and the scrubbed error.
  - `GET /api/analytics/context?store=`: name, niche, channels (from the store's integrations), zone label and
    abbreviation, currency, `demo`, history start, freshness.
  - `GET /api/analytics/sources?store=`: each source × dataset with status, freshness, the backoff wait, and a fix link
    to the Integrations screen.
  - Acceptance: tests: a store with no integrations returns `needs_credentials` rows, not empty; demo stores return
    `demo`; scope rows added.

- [x] SA-15 **Live-verified mark** (decision 24):
  - `PUT /api/analytics/sources/verified` `{ store, integration, dataset, note }` records `verified_at`, the
    account it was made on (the integration's shop domain or account id from its settings) and the note.
  - A mark shows only while the integration's current account matches; otherwise the dataset reads
    "available (not verified live)".
  - Acceptance: tests: the mark appears; it disappears when the account changes; another store's integration is 404.

- [x] SA-16 **Sales metrics v1** (spec §9; decisions 8 to 12):
  - `apps/server/src/store-analytics/sales.ts`: `net_sales`, `gross_sales`, `discounts`, `refunds` (refund day, or
    original order day with `refunds=order_day`), `orders`, `aov`, `units`, `cancelled_orders`, `refund_rate`.
    Canonical orders only: paid, not test, `duplicate_of IS NULL`.
  - Orders with no `breakdown_at` (synced before SA-27, or before the SA-60 re-pull reaches them) count as
    `total − tax`, status `estimated`, with their share as coverage ("x% of orders synced before money parts were
    recorded").
  - Line metrics follow decision 12.
  - Acceptance: the oracle matches for every sales metric; a store with only pre-breakdown orders returns
    `estimated`, never `ok`.

- [x] SA-17 **Demo through v1** (decision 30):
  - Extend `demoDay` in `demo.ts` with a deterministic breakdown per store and date (gross, discounts, refunds,
    shipping, tax, units per product, purchasing sessions) whose net matches today's demo revenue, so Dashboard
    doesn't move.
  - The v1 functions read the demo path for demo stores; every value has status `demo`.
  - Acceptance: tests: two calls give identical numbers; the legacy pins (SA-09) are unchanged; every value is `demo`.

- [x] SA-18 **Demo catalog seeding** (decision 30):
  - In `seedCatalog` / `seedDemoStore`: variants, channel listings (site and TikTok Shop for the board's niche
    stores), one product link and two collections for each demo store, under the demo flag, idempotent. No ledger,
    snapshot or customer rows.
  - Acceptance: tests: seeding twice gives the same rows; a real store gets none.

- [x] SA-19 **Contribution, coverage and fees** (spec §8 Profitability, §9; decisions 15 to 17):
  - `apps/server/src/store-analytics/costs.ts`: a line's cost (its recorded `order_lines.cost`, else the `unit_costs`
    row effective at order time, else none), `cost_coverage` (share of units with a cost), `fees` and
    `contribution_before_ads`.
  - Export `AMAZON_REFERRAL` from `analytics.ts` (no value change) and import it here.
  - Acceptance: the oracle matches; uncosted lines are left out and counted in coverage; a restocked refund line adds
    no product cost; no costs at all gives `unavailable`, not 0.

- [x] SA-20 **Ad spend and ROAS** (spec §8 Marketing):
  - `ad_spend` from `campaign_daily` joined to the store's campaigns (`campaigns_by_store`), converted at the day
    rate once SA-53 ships (until then, spend in a currency other than the store's is `estimated`).
  - `platform_roas` = the networks' own attributed revenue ÷ spend, labelled "<network>'s own attribution" with its
    window once SA-58 records it, else "attribution setting not recorded".
  - `contribution_after_ads` = before − ad spend, store level only.
  - Acceptance: oracle; no ad integration gives `needs_credentials`, not $0.

- [x] SA-21 **Site conversion v1** (decision 14):
  - Σ `purchase_sessions` ÷ Σ `sessions` over the days where both are reported, with coverage. The demo path reads
    `demoDay`. A GA4 store gets `unavailable` with the decision's text. Until SA-33 ships, Shopify stores get
    `unavailable`, reason `needs_ingestion`.
  - Acceptance: oracle; days missing either side are left out and counted in coverage.

- [x] SA-22 **computeMetricSet and /metrics** (spec §9):
  - `computeMetricSet(db, scope, ids, period, compare, filters)` returns an `SaValue` per id with its change and one
    `SaFilterScope`. `GET /api/analytics/metrics?store&metrics&period&compare&filters`.
  - Acceptance: tests; scope row added; an unknown id is 400.

- [x] SA-23 **/series** (spec §6):
  - `GET /api/analytics/series`: daily points (weekly over 120 days) for one metric, the comparison aligned by day
    offset, today flagged partial, days with no report as `null`.
  - Acceptance: tests: the series sums to the `/metrics` total for additive metrics; a DST day is one point.

- [x] SA-24 **Reconcile v1** (spec §9 Reconciliation):
  - `apps/server/src/store-analytics/reconcile.ts` `checkOrderIdentity(order)` (decision 9) and
    `GET /api/analytics/reconcile`: v1 net sales against legacy revenue, line by line: tax, shipping, refunds by
    refund day vs order day, duplicate copies removed, test and unpaid orders, pre-breakdown estimates, each with a
    count. Orders failing the identity are listed by id.
  - Acceptance: the fixture reconciles to ±0.01 with every line explained.

- [x] SA-25 **Scale fixture and plans** (decision 38):
  - `seedScaleStore` in `fixture.ts` (about 250,000 orders over two years, 20,000 products, 60,000 variants, refunds
    and fees in proportion).
  - `scale.test.ts`: `EXPLAIN QUERY PLAN` for every v1 query on the ledger fixture fails on a `SCAN` of `orders`,
    `order_lines`, `refunds`, `order_fees` or `campaign_daily` (always runs). With `SA_SCALE=1` it seeds the scale
    store, times each query and fails over 2 s; record the p95s under Done. Later items add their queries.
  - Acceptance: both modes pass; a missing index found here gets its own labelled migration.

### Phase 2 — Verified ingestion

Every connector item: field names are checked against the platform's current official reference (web search; cite
URL and date in the contract test), the doc's example response goes in `connectors/fixtures/<kind>-doc-examples.json`,
`<kind>.contract.test.ts` runs the sync on it, and `checkOrderIdentity` (SA-24) passes on every order in it. Reads stay
reads: no new write scope, no write call.

- [x] SA-26 **Cost lock and unit cost history** (spec §9 Refund and cost timing; decision 15):
  - `shopify.ts` order upsert: `cogs = iif(cogs > 0, cogs, excluded.cogs)` instead of `cogs = excluded.cogs`.
  - `catalog.ts` `setProductCost`: fills only past lines whose cost is 0, flags those `order_lines` rows
    `owner_backfill` (Q4), and never rewrites a known past cost (the "old cost" rewrite goes). Its Shopify refusal
    stays. Update its existing tests to the new rule.
  - `recordUnitCost(db, store, product, variant, cost, source, effectiveFrom)` in `connectors/ingest.ts`, called by
    `setProductCost` (source `owner`) and by the Shopify product sync when `unitCost` changes (source `shopify`).
  - Acceptance: tests: changing a cost leaves past contribution unchanged; a first cost fills uncosted lines and flags
    them; a re-sync after Shopify's unit cost changed keeps the order's stored `cogs`.

- [x] SA-27 **Shopify orders** (spec §5, §9; decision 9). This item owns `ORDERS_Q`; later Shopify items reuse the
  fields it adds:
  - Add the documented order fields for the original subtotal, discounts, shipping and tax, the current total,
    currency, processed and cancelled times, the sales channel and its order id, the customer id, the shipping
    country code, fulfillment and delivery times, and `updatedAt`; plus the line fields SA-30 needs (variant id, SKU,
    discount allocations), fetched now so the page size is set once.
  - The customer and country fields are optional probes (SA-32): the cost budget counts them, and when the probe
    says they're denied the query leaves them out. The page size doesn't change.
  - Set the page size from a static cost calculation. A test in `shopify.contract.test.ts` computes each Shopify
    query's requested cost from its connections' `first:` values and fails over 1000. Update the cost comment at
    `ORDERS_Q`.
  - Write `source_kind 'shopify'`, `source_id`, `channel`, `channel_order_id`, the money parts, the dates,
    `source_updated_at` and `breakdown_at`; `noteRead` orders.
  - Acceptance: contract test; identity holds on every fixture order; orders synced before this item still read.

- [x] SA-28 **Shopify refunds ledger** (spec §9; decision 9):
  - A separate `REFUNDS_Q` (`first:` on every connection) runs only for orders whose financial status is refunded,
    partly refunded or voided, or that were cancelled, and whose `updatedAt` moved since the last read.
  - Write one `refunds` row per refund line (merchandise, quantity, restocked, variant) plus shipping, tax and other
    adjustment rows, dated in the store zone; idempotent by Shopify's ids. `rebuildRevenue` is not changed and never
    reads `refunds`. `noteRead` refunds.
  - Acceptance: contract test: a partial refund, a full refund and a restock each give the right rows; re-running is a
    no-op; identity holds.

- [x] SA-29 **Shopify variants** (spec §7 Product, variant and listing structure):
  - Read every variant (`PRODUCTS_Q` keeps `variants(first:1)` for the summary columns; a paged variants read, like
    `VARIANT_IDS_Q`, fills the rest) into `product_variants`: SKU, price, compare-at, inventory, tracked, inventory
    policy, status. A changed `unitCost` calls `recordUnitCost`.
  - Acceptance: contract test: a 3-variant product gives three rows and one `products` row as today.

- [x] SA-30 **Order lines by variant** (spec §7, §9; decision 12):
  - From `LINE_ITEM`, write `order_lines` per line: variant, SKU, quantity, gross, discount, and the cost at first
    record (quantity × the variant's unit cost then), never overwritten later. `setOrderItems` keeps feeding
    `order_items`.
  - Acceptance: contract test; the line sums equal the order's gross and discounts.

- [x] SA-31 **Publications** (spec §7 Status handling; decision 21):
  - The documented per-channel publication state of each product into `channel_listings` (current state; the
    platform's publish date if it gives one). Needs the optional `read_publications` scope; without it the dataset is
    `needs_permission` and the Channels column says so.
  - Acceptance: contract test; a denied read records `needs_permission` and nothing else changes.

- [x] SA-32 **Customer refs and country** (spec §8 Customers; decision 20):
  - A per-field probe once a day per integration (`done_once` ref `sa-probe:<integration>:<field>:<date>`): a
    one-order query asking only for that field. Denied → the dataset is `needs_permission` and `ORDERS_Q` leaves the
    field out.
  - The customer id becomes `customer_ref` (decision 20), `customer_state`; the shipping country becomes `country`.
    Names, emails, phones and addresses are never read into a variable that is stored or logged.
  - Acceptance: tests: a denied probe never fails the order sync; the same customer on two orders gives one ref; the
    same id on another store gives a different ref; no PII column exists (a schema test).

- [x] SA-33 **Purchasing sessions** (decision 14):
  - A separate ShopifyQL read with its own `noteRead` and its own `done_once` ref
    (`shopify-purchase-sessions:${storeId}:${host}`), next to the funnel read. Writes `daily_metrics.purchase_sessions`.
    If the documented ShopifyQL dataset has no purchasing-session count, the dataset is `unsupported` in `SA_SOURCES`
    and conversion stays unavailable.
  - Acceptance: contract test; a failure here leaves the funnel's sessions untouched.

- [x] SA-34 **Shopify traffic breakdowns** (spec §8 Traffic and conversion):
  - ShopifyQL sessions (and purchasing sessions where SA-33 found them) by referrer source, device type and country
    into `traffic_breakdown_daily`, documented fields only. Same scope as the funnel.
  - Acceptance: contract test; breakdown totals are checked against the day's sessions and a gap is shown, not hidden.

- [ ] SA-35 **Live check: Shopify** (spec §15 Live data). Moves to Blocked until the owner connects a Shopify store
  (none is connected today); when one exists, do it straight away:
  - Use the store that also sells on TikTok Shop if there is one. Ask nothing of the owner beyond the optional scopes
    `read_publications` and Level 2 customer data, which the store's existing custom app may already have.
  - Compare the last 30 full days' net sales, orders, refunds and units with Shopify's own reports, and five orders
    field by field. Write each difference and its reason under Done; record the mark with SA-15's route.
  - Acceptance: the comparison is under Done, the dataset shows Live verified, and only GET or query requests were
    sent.

- [ ] SA-36 **WooCommerce orders: ids, money parts and dates** (spec §5, §9):
  - From `ORDER_FIELDS`, write the source ids, `currency`, `paid_at` (`date_paid_gmt`), the money parts and
    `breakdown_at`; `lockedRate` stays the order's FX. Add any missing documented field to `ORDER_FIELDS`.
  - Acceptance: contract test; identity holds.

- [ ] SA-37 **WooCommerce lines, customers and country** (spec §8; decision 20):
  - `line_items` into `order_lines` (variation id, SKU, quantity, totals; cost from `cost_of_goods_sold` when the
    store reports it); the customer id into `customer_ref` (0 = guest); the billing or shipping country code only.
  - Acceptance: contract test; a guest order is `guest`, not a customer.

- [ ] SA-38 **WooCommerce refunds** (spec §9):
  - `refundsDown` reads `_fields: 'line_items'` today; add the refund's id, date and amount fields and write
    `refunds` rows (lines plus the remainder as `other`).
  - Acceptance: contract test: a partial refund with no line items gives one `other` row; identity holds.

- [ ] SA-39 **WooCommerce variants and listings** (spec §7):
  - `variationStock` and `PRODUCT_FIELDS` into `product_variants`; the site listing state into `channel_listings`
    (channel `site`).
  - Acceptance: contract test.

- [ ] SA-40 **Live check: WooCommerce** (spec §15). Moves to Blocked until the owner connects a WooCommerce store.
  Same steps as SA-35 against WooCommerce's own reports; GET only.
  - Acceptance: comparison under Done; mark recorded.

- [ ] SA-41 **Etsy receipts** (spec §5, §9):
  - From `Receipt` (it carries `refunds`): the money parts from the receipt's documented subtotal, discount,
    shipping and tax fields, the refunds into `refunds` (dated by the refund), transactions into `order_lines`, the
    buyer id into `customer_ref`, the country code. Grand total minus refunds stays `orders.total`.
  - Acceptance: contract test; identity holds.

- [ ] SA-42 **Etsy variants and listings** (spec §7):
  - Listing inventory (products and offerings) into `product_variants`; listing state into `channel_listings`. At
    most 50 inventory reads per sync (Q10), resumed next sync; coverage shows the rest as pending.
  - Acceptance: contract test; the cap holds and the pending count is right.

- [ ] SA-43 **Live check: Etsy** (spec §15). Moves to Blocked until the owner connects Etsy. Same steps as SA-35; GET
  only.
  - Acceptance: comparison under Done; mark recorded.

- [ ] SA-44 **Amazon lines, refunds and fees** (spec §8 Profitability; decision 17):
  - `ordersOf` lines into `order_lines`; the refund events `refundsOf` already reads into `refunds` (`amazon_refunds`
    stays for `rebuildRevenue`); the `ShipmentEventList` from the same `financialEvents` pages (no extra calls) into
    `order_fees` per order and fee type. Settled fees replace estimates for those orders; `SETTLE_DAYS` keeps
    re-reading the last 14 days.
  - Acceptance: contract test: an order with recorded fees uses them; one without uses the estimate, labelled.

- [ ] SA-45 **Amazon listings** (spec §7):
  - `listingsOf` into `channel_listings` and `product_variants` (SKU, status, issues as the error); `fbaStock` as
    stock that Amazon manages: a quantity shown as "FBA", never a cover estimate (decision 27).
  - Acceptance: contract test.

- [ ] SA-46 **Live check: Amazon** (spec §15). Moves to Blocked until the owner connects Amazon. Same steps as SA-35
  against Seller Central's reports; GET only.
  - Acceptance: comparison under Done; mark recorded.

- [ ] SA-47 **Collections, categories and handles** (spec §7 Filters):
  - Shopify collections (paged, documented fields) into `product_collections`, plus `products.handle` and
    `products.category`; WooCommerce categories; Etsy shop sections. Amazon and TikTok Shop collections are
    `unsupported` with reasons.
  - `GET /api/analytics/collections?store=` (scope row added). Collection filter semantics, stated in the registry: a
    product is in if it is in any selected collection; order metrics count only the matching lines; store-level
    metrics (sessions, conversion, ad spend) ignore it and say so through `SaFilterScope`.
  - Acceptance: contract tests; a filter test on the fixture.

- [ ] SA-48 **GA4 contract** (spec §5, §8):
  - A contract test only: run the existing `syncGa4` (in `google.ts`, not edited here) on a GA4 Data API doc-example
    response and assert what it writes. Record in `SA_SOURCES` that GA4 gives sessions and event counts but not
    purchasing sessions (decision 14).
  - Acceptance: the test passes on main as is.

- [ ] SA-49 **Live check: GA4** (spec §15). Moves to Blocked until the owner connects GA4. Compare 30 days of
  sessions with GA4's own report; GET only.
  - Acceptance: comparison under Done; mark recorded.

- [ ] SA-50 **Inventory snapshots** (spec §8 Inventory; decision 27):
  - After the first successful catalog sync of each store-local day, write one `inventory_snapshots` row per tracked
    variant (real stores only). `stockAt(db, store, variant, date)` returns that day's value or `null`, never a sum
    over dates.
  - Acceptance: tests: two syncs on one day give one snapshot; a demo store gets none; an untracked variant gets none.

- [ ] SA-51 **Dedupe** (spec §5 Avoid duplicated orders; decision 13):
  - `apps/server/src/store-analytics/dedupe.ts` `markChannelCopies(db, store)`: for store-platform orders whose
    channel is a marketplace that has its own synced integration for the store, set `duplicate_of` inside the days
    that integration covers, matched by `channel_order_id` when possible (the match only labels the pair). Never by
    name, email, amount or time. Amazon as a channel uses its `channel_daily` days. Runs after each orders sync, in
    the sync-run wrapper.
  - `platformSplit` in `analytics.ts` leaves `duplicate_of` rows out. (`rebuildRevenue` got its filter in SA-08; if
    SA-08 is Blocked, legacy revenue double counts until it ships: say so under Notes.)
  - Acceptance: the oracle's duplicate cases; a store with no marketplace integration marks nothing.

- [ ] SA-52 **Dedupe counts** (spec §5):
  - `dedupeSummary(db, store, period)`: pairs matched by id, copies left out without a match, copies counted outside
    covered days, and orders from unmapped apps (the warning). The Data sources panel (SA-64) and reconcile (SA-24)
    show it, worded per Q1's default (the codemap's "244 matched, 0 counted twice" pattern).
  - Acceptance: tests on the fixture.

- [ ] SA-53 **FX by day** (decision 19):
  - `refreshFx` stores each ECB day into `fx_rates`; a first run loads the history ECB publishes. `rateOn(date,
    currency)` returns that day's rate or the last within 7 days, else `null` (the day is left out and listed).
  - Multi-store totals in `analytics.ts`, Amazon-as-a-channel sales and ad spend convert per day. Woo's locked
    `fx_rate` stays.
  - Acceptance: tests: a weekend uses Friday; a 10-day gap gives `null`; the legacy pins change only where a
    non-store currency is involved (pin updated with a reason).

- [ ] SA-54 **TikTok Shop orders** (spec §5, §9; decision 18). Gated: `syncTikTokShop` is a claimed function, so check
  the Phase E window first:
  - The documented payment fields: subtotal, `seller_discount` only as `discounts`, shipping, tax, currency; source and
    channel ids; returns read under `RETURNS_KEY` into `refunds`; the buyer id into `customer_ref`; `noteRead` for
    orders and returns.
  - If this ships after SA-60, add a migration that resets only the TikTok Shop order cursor so its history is
    re-read once.
  - Acceptance: contract test; identity holds; the platform discount is not in `discounts`.

- [ ] SA-55 **TikTok Shop SKUs, listings and category** (spec §7). Gated like SA-54:
  - SKUs into `product_variants`; listing status and audit failures (the error text) into `channel_listings`;
    category into `products.category`; the platform's product id into `product_links` (method `platform_id`) when the
    documented field links it to the store product.
  - Acceptance: contract test: a failed listing shows its reason.

- [ ] SA-56 **Live check: TikTok Shop and dedupe** (spec §15). Moves to Blocked until the owner connects TikTok Shop on
  a store that also has its site connected. Compare 30 days with Seller Center, and check that no TikTok order counts
  twice; GET only.
  - Acceptance: comparison and the dedupe counts under Done; mark recorded.

- [ ] SA-57 **GA4 traffic breakdowns** (spec §8 Traffic). Gated: `syncGa4` is unclaimed Phase E code (Lane):
  - Sessions by default channel group, device category and country into `traffic_breakdown_daily`.
  - Acceptance: contract test.

- [ ] SA-58 **Ad networks: currency, attribution setting and day rates** (spec §8 Marketing, §9 Currency). Gated:
  `meta.ts`, `google.ts`, the TikTok Ads part of `tiktok.ts`, and `adRate` / `backfillRate` in `common.ts` are
  unclaimed Phase E code:
  - Record each ad account's currency and attribution setting (documented fields) in its integration's
    `source_datasets` note; `noteRead` spend reads.
  - Spend converts at each day's rate: `backfillRate` stops keeping today's rate for later syncs (its ponytail note).
  - Acceptance: recorded-response tests per network.

- [ ] SA-59 **Live check: ad networks** (spec §15). Moves to Blocked until the owner connects an ad account. Compare 7
  days of spend per network with the network's own report; GET only, and never a write call to an ad API.
  - Acceptance: comparison under Done; marks recorded.

- [ ] SA-60 **Backfill rules and the one re-pull** (spec §12 Reproducibility). After SA-08; waits under Blocked while
  SA-08 is Blocked:
  - One migration resets `integrations.cursor` for every real Shopify, WooCommerce, Etsy and Amazon integration so the
    next syncs re-read history within each platform's limits (Shopify: `BACKFILL_DAYS`), filling money parts, lines,
    refunds and customers. Bounded by the existing page and rate limits; no new loop.
  - The Data sources panel shows "Re-reading history: <n>% done" from `breakdown_at` coverage.
  - Acceptance: a test on a copy of the fixture with the new columns cleared: after the re-pull, values match the
    oracle and the estimate share is 0.

### Phase 3 — Interface (the approved shell)

- [ ] SA-61 **URL state and hooks** (spec §4; decision 32):
  - `apps/web/src/analytics/state.ts`: `store`, `tab`, `period`, `compare`, `refunds`, filters, sort, page and
    `product` in the URL (`useSearchParams`). The store fallback chain is decision 2's; the last store used on this
    page is kept with `useStored` (`agents/layout.ts`) under `fe.analytics.store`. `fe.stores` is never written.
  - `apps/web/src/analytics/api.ts`: every analytics hook, per decision 32, using the existing `api<T>()`. Zero stores
    shows an `EmptyState` with a link to add a store, and sends no request.
  - Acceptance: tests: switching store A → B with A's response arriving late shows B's loading state, then B, never A;
    no request without a store; reload keeps the state.

- [ ] SA-62 **Tabbed shell** (spec §6; decision 33):
  - `git mv apps/web/src/pages/Analytics.tsx apps/web/src/analytics/legacy.tsx` (and its test to `legacy.test.tsx`).
    The new `pages/Analytics.tsx` renders the header strip (title, Demo data pill), a context bar slot and
    `Tabs variant="underline"` from a tab list in which a tab exists only once its item ships. Overview shows the
    legacy view until SA-79.
  - Append to codex-hardening's Inbox: the `/analytics` page now lives in `apps/web/src/analytics/` and its tabs grow
    item by item; the route stays `/analytics`.
  - Acceptance: the old page's tests pass from `legacy.test.tsx`; a test that only registered tabs render.

- [ ] SA-63 **Context bar** (spec §4; the boards):
  - `analytics/ContextBar.tsx`: store picker (initials mark, name, "<niche> · <channels joined with +>"), period and
    compare controls (they open in SA-65), Filters (SA-68), "<zone abbreviation> · <currency>", and the freshness chip
    for the active tab's datasets (oldest wins) with a tooltip listing each.
  - Acceptance: test: a store with a stale dataset shows the stale time, not the freshest; browser check at 1440 and
    390.

- [ ] SA-64 **Data sources panel** (spec §5 Honest coverage states):
  - The chip's ⓘ opens a right `Dialog`: each source × dataset with status, last success, the scrubbed error, the
    backoff wait, the dedupe summary (SA-52), "Live verified" or "available (not verified live)", "Syncs run only
    while Frontline Ecom is open", and a link to Integrations to fix.
  - Acceptance: tests: `needs_credentials`, `failed` and `demo` each render their text; nothing reads "connected" for
    a source with no integration.

- [ ] SA-65 **Period and compare pickers** (spec §4 Global reporting controls; decision 6):
  - Presets and a custom range with native `<input type="date">`; the 730-day limit; "today so far" on presets that
    include today; compare previous, year or none, with the comparison's dates shown.
  - Acceptance: tests: an invalid custom range can't be applied and says why; keyboard only works.

- [ ] SA-66 **Listings API core** (spec §7 Listings table):
  - `GET /api/analytics/listings?store&status&q&sort&page`: server-paged at 25; counts for active, draft, archived and
    all; each row's current state and its period sales (net sales, units, refunds, contribution) from the v1
    functions; search on title, SKU and product id. Adds the Product row to Filters.
  - Acceptance: tests: page 3 of the fixture is right; counts match; scope row; scale plan added.

- [ ] SA-67 **Listings API demo path** (decision 30):
  - Demo stores return their seeded catalog (SA-18) with demo sales from `demoDay`, status `demo`.
  - Acceptance: test.

- [ ] SA-68 **Filters, chips and scope notes** (spec §4; decision 4):
  - A Filters popover (Channel, Product, Collection; the Market and Segment rows arrive in SA-107), applied filters as
    removable chips, `.ctl.on` while any apply, and a `FilterScope` note on every panel that ignores one.
  - Acceptance: tests: each panel either applies a filter or names it in its note; clearing all removes the chips.

### Phase 4 — Overview

- [ ] SA-69 **Overview API** (spec §6 Overview priorities):
  - `GET /api/analytics/overview`: the six KPI values with changes, the channel split, the annotation and attention
    counts, in one call through `computeMetricSet`.
  - `consistency.test.ts`: for the fixture and a demo store, each Overview KPI equals `/metrics` for the same scope.
    Later surfaces add a row.
  - Acceptance: both tests; scope row.

- [ ] SA-70 **KPI tiles** (the Overview board):
  - `analytics/KpiStrip.tsx`: the six tiles, styled as the board; the definition or coverage line from the registry
    (AOV per decision 11); an unavailable value shows `<Unavailable>` (Q16); ad spend's change in a neutral colour;
    contribution's coverage line in the warning colour under 95%. A click selects the chart metric. A "Breakdown →"
    link per tile appears once its tab exists: net sales, orders and AOV → Sales; conversion → Traffic & Conversion;
    ad spend → Marketing; contribution → Profitability.
  - Acceptance: tests: no tile ever shows 0 for an unavailable value; the link is absent before its tab exists.

- [ ] SA-71 **Trend chart** (spec §6; decision 34):
  - `analytics/TrendChart.tsx` (SVG, using `niceTicks` from `lib/chart.ts`): the period line and area, the dashed
    comparison, weekly ticks, the hover tooltip with both dates, today left out unless the period includes it
    (then marked partial), the Net sales / Orders / Contribution segment (contribution is after ads when the store
    has ad data, else before ads, labelled; Q15), the channel legend, a text summary label and a Table toggle. A day
    click opens Sales on that day once SA-98 ships.
  - Acceptance: tests: the table has the same numbers as the series; null days are gaps, not zeros.

- [ ] SA-72 **Data-health and derived annotation markers** (decision 45):
  - `apps/server/src/store-analytics/annotations.ts` and `GET /api/analytics/annotations`: data-health markers from
    `sync_runs` gaps over 3 hours (the "!" marker) and derived markers from `price_tests` rows and approved app
    changes for this store (numbered). The list under the chart says "Context only, not a cause".
  - Acceptance: tests: a failed 6-hour window gives one marker; another store's price test never shows.

- [ ] SA-73 **What moved** (spec §6, §10):
  - `apps/server/src/store-analytics/contributions.ts`: each product's change in net sales between period and
    comparison; the top four up and the top two down, the rest as "<n> other products combined"; each row's channel
    split, variant count or stock note when known. The rows sum to the total change exactly. The panel shows the
    Observed tag and "Each product's share of the change, not its cause."
  - Acceptance: tests: the sum identity; a product with no comparison sales is "new".

- [ ] SA-74 **Insight engine: core rules** (decision 28):
  - `apps/server/src/store-analytics/insights.ts` `RULES`: low stock cover (cover under `COVER_DAYS = 10`, sales over
    `COVER_WINDOW = 14` full days), refund rate (product rate over twice the store average with at least 30 units),
    products with no unit cost, failed listing syncs, and stale or failed sources (data health). Each rule has
    `id@version`, named thresholds, a minimum sample, its datasets and its evidence values.
  - Acceptance: tests per rule, including the minimum sample and a stale source turning a business rule into a
    data-health insight.

- [ ] SA-75 **Insight engine: remaining rules** (decision 28):
  - A product's sales down against the comparison (minimum sample), ad spend up while contribution after ads is down
    (the board's finding), conversion down (only when `site_conversion` is available), late fulfillment (over 48 h,
    the same value as `LATE_HOURS` in `apps/web/src/lib/orders.ts`), a variant out of stock, and orders from unmapped
    apps that may duplicate.
  - Acceptance: tests per rule.

- [ ] SA-76 **Needs attention and How flags work** (the Overview board):
  - The panel with its count pill and rows linking to the record (product drawer, Data sources, Listings with a
    filter). "How flags work" opens one dialog listing every rule with its threshold, minimum sample and datasets,
    read from `RULES`.
  - Acceptance: tests; every row's link opens a real target.

- [ ] SA-77 **FindingCard (Rule mode)** (spec §10 Evidence-based findings):
  - `analytics/FindingCard.tsx`: shows the top rule insight: "Rule · <rule name>", the Observed tag, headline, body,
    evidence chips (each opens its metric definition), the limitation, and Investigate (opens the related tab or
    drawer). With no insight it shows the Rule card fallback (Q14). Agent mode and the Send to buttons come in SA-127.
  - Acceptance: tests: no confidence or score field exists in its props.

- [ ] SA-78 **Top products** (the Overview board):
  - Four rows by net sales (units, net sales, change) from the listings API; the "All <n> active listings" link
    appears once SA-82 ships.
  - Acceptance: test; the numbers match the listings rows (consistency row).

- [ ] SA-79 **Overview assembly** (spec §6; the Overview board):
  - The Overview tab replaces the legacy view with the board's grid. The legacy Unit costs panel stays below the grid
    until SA-92.
  - `Overview.test.tsx`: one endpoint returning 502 shows that panel's `ErrorState` with a retry while the others
    render.
  - Browser pass at 1440×900 against `store-analytics-overview.png`; differences fixed or listed under Notes.
  - Acceptance: tests; screenshots compared; `SA_SCALE=1` timing for the overview call recorded.

### Phase 5 — Listings & Products

- [ ] SA-80 **Listings API: extra filters and stock states** (spec §7 Filters and bulk inspection):
  - Filters: channel, stock state, sales (any, with sales, no sales), collection, missing unit cost, failed sync.
  - Stock states: in stock, low (cover under `COVER_DAYS`, the same constant as SA-74), out, `variantsOut` ("<n>
    out"), not tracked, FBA, supplier-managed.
  - Acceptance: tests for each filter and state.

- [ ] SA-81 **Supplier-managed stock** (decision 27):
  - A product with untracked inventory whose recent orders name a supplier (`orders.supplier`, for example
    `'CJ Dropshipping'`) is "Supplier-managed": no count, no cover.
  - Acceptance: test.

- [ ] SA-82 **Listings table** (spec §7 Listings table; the Listings board):
  - `analytics/ListingsTab.tsx`: the status Segmented with counts, search, filter chips, the `Table` with the board's
    default columns and cells, default sort Units ↓, the footer ("1–25 of <n> active listings · <v> variants · <c>
    channel listings") with Previous and Next, a row click or Enter opening the drawer, and the current-vs-period note.
  - Acceptance: tests: every active listing reachable by paging the fixture; keyboard row navigation.

- [ ] SA-83 **Variant rows** (spec §7 Product, variant and listing structure):
  - A product row expands to indented variant rows with no checkbox; variant sales come from `order_lines`, else
    "Variant sales not recorded yet".
  - Acceptance: test.

- [ ] SA-84 **Columns** (spec §7):
  - A Columns menu to show, hide and order the optional columns (SKU, collection, compare-at price, cost coverage,
    conversion where available), kept in the URL.
  - Acceptance: test.

- [ ] SA-85 **CSV export engine and Listings export** (spec §11 Reports and exports; decision 35):
  - `apps/server/src/store-analytics/exports.ts` and `GET /api/analytics/export/listings?…` with decision 35's
    header block, quoting and cap. A selection bar appears when rows are checked: Export selected, Compare (SA-86).
  - Acceptance: tests: a title starting with `=` is prefixed; a demo store's file has the demo line; another store's
    product ids in the selection give 404; scope row.

- [ ] SA-86 **Compare** (spec §11 Saved views and comparisons):
  - `GET /api/analytics/compare?store&products=` (2 to 4 products, the same metrics side by side); one compare route
    for every surface. Opened from the selection bar.
  - Acceptance: tests; scope row.

- [ ] SA-87 **Product detail endpoint** (spec §7 Product detail view):
  - `GET /api/analytics/products/:id?store&period&compare`: header facts, pills, mini metrics, units per day, channel
    rows, price, cost and fee line, variants, refunds and insights.
  - Acceptance: tests; scope row; consistency row (drawer net sales = listings row).

- [ ] SA-88 **Drawer frame** (the Listings board):
  - `Dialog side="right" width={560}` with a new opt-in `lead` prop in `ui.tsx` for the header thumbnail (the default
    look doesn't change). Tabs Performance, Variants, Channels, Costs, Refunds, Insights; `product=` in the URL;
    focus returns to the row on close (`useFocusBack`).
  - Acceptance: tests: Esc closes and focus returns; the existing `Dialog` tests unchanged.

- [ ] SA-89 **Performance tab** (the Listings board):
  - Four mini metrics, `analytics/BarChart.tsx` for units per day (text summary and Table toggle), "Product views: not
    tracked" unless SA-04 found a source, the Rule card from `RULES`, the channel table, and the price, unit cost and
    fees line (each labelled with its source and "estimate" where it is one).
  - Acceptance: tests.

- [ ] SA-90 **Variants and Channels tabs** (spec §7):
  - Variants: each variant's SKU, price, stock state and sales. Channels: each channel listing's status, error, sync
    time and period sales; "since <date>" only from a platform publish date.
  - Acceptance: tests.

- [ ] SA-91 **Cross-channel product links** (decision 22):
  - `PUT` and `DELETE /api/analytics/product-links` for the owner's mapping (a channel product to a store product);
    platform-id links from SA-55. Linked rows roll up into the store product with the per-channel split; the drawer
    shows how each link was made.
  - Acceptance: tests: unlinking restores the "TikTok Shop only" row; scope row.

- [ ] SA-92 **Costs and Refunds tabs** (spec §7, §9):
  - Costs: the unit cost history from `unit_costs` and the cost edit through the existing `useSetCost`, showing
    `setProductCost`'s refusal text for Shopify products. Refunds: the product's refund lines in the period.
  - Remove the legacy Unit costs panel, `analytics/legacy.tsx` and `legacy.test.tsx` once nothing uses them.
  - Acceptance: tests: an edited cost doesn't change a past period's contribution.

- [ ] SA-93 **Insights tab and platform links** (spec §7 Listing health):
  - Insights: the product's rule insights. `apps/web/src/analytics/links.ts`: the platform admin and store-page URLs
    for Shopify, WooCommerce, Etsy and Amazon, built only from a stored id or handle; a link with no id isn't shown.
  - Acceptance: tests per platform.

- [ ] SA-94 **Listings states and browser pass** (spec §7, §14):
  - Loading, empty store, no results for a filter, an error with retry; all statuses reachable; 390 px layout.
  - Browser pass at 1440×900 against `store-analytics-listings.png`; differences fixed or under Notes.
  - Acceptance: tests; screenshots; `SA_SCALE=1` timing for the listings call recorded.

### Phase 6 — Modules (spec §8)

Each module is a server report in `store-analytics/` built on the v1 functions, a scope row, a consistency row, and
then its tab. A tab appears only with its item.

- [ ] SA-95 **Sales report** (spec §8 Sales and order performance):
  - `GET /api/analytics/sales`: the net sales bridge (gross → discounts → refunds → net, with tax and shipping shown
    apart), orders, AOV, units and cancelled orders by day, week or month.
  - Acceptance: the oracle; consistency row.

- [ ] SA-96 **Sales breakdowns** (spec §8):
  - By channel, product, collection and country (where recorded; else `needs_permission` or `not_tracked`).
  - Acceptance: each breakdown sums to the total, with an "Unknown" row when it doesn't.

- [ ] SA-97 **Order records** (spec §6 Drilldown behavior):
  - `GET /api/analytics/orders`: paged orders behind any number (id, date, channel, money parts, status, refunds, a
    duplicate label), no personal data.
  - Acceptance: tests; scope row; the rows behind a day sum to that day's value.

- [ ] SA-98 **Sales tab** (spec §8):
  - The bridge, the series, the breakdowns, the order records drilldown, and the `refunds=` view control with its
    label on every affected value. The trend chart's day click now opens it.
  - Acceptance: tests; browser pass.

- [ ] SA-99 **Reconciliation panel** (spec §9 Reconciliation):
  - On the Sales tab: SA-24's lines and the dedupe counts, each linking to its orders.
  - Acceptance: test.

- [ ] SA-100 **Traffic source** (spec §8 Traffic and conversion):
  - `apps/server/src/store-analytics/traffic.ts`: sessions, add to carts, checkouts and purchasing sessions from
    `daily_metrics`, breakdowns from `traffic_breakdown_daily`, and TikTok Shop visitors and Amazon sessions as other
    channels' traffic, never added to site sessions.
  - Acceptance: tests.

- [ ] SA-101 **Traffic report** (spec §8):
  - `GET /api/analytics/traffic`: the funnel where each step is reported, conversion v1, and the breakdowns.
  - Acceptance: tests; consistency row (conversion = the KPI).

- [ ] SA-102 **Traffic & Conversion tab** (spec §8):
  - Acceptance: tests; browser pass; a GA4 store shows conversion unavailable with the reason.

- [ ] SA-103 **Customers no-data state** (spec §8 Customers and retention):
  - With no customer refs, the tab shows why (needs permission, guest checkouts only, not synced yet) and the fix.
  - Acceptance: test.

- [ ] SA-104 **Customers identity report** (spec §8; decision 20):
  - `GET /api/analytics/customers`: customers, new vs returning (a ref's first order in the store's synced history),
    repeat rate, orders per customer; guests counted apart; "first order" is limited by history start and says so.
  - Acceptance: tests on the fixture.

- [ ] SA-105 **Cohorts and geography** (spec §8):
  - Monthly first-order cohorts with repeat rates; sales by country. Groups under 10 customers merge into "Other" and
    cohort cells under 5 are hidden (Q22).
  - Acceptance: tests for both thresholds.

- [ ] SA-106 **Customers tab** (spec §8).
  - Acceptance: tests; browser pass.

- [ ] SA-107 **Market and segment filters** (spec §4):
  - The Market (country) and Segment (new or returning) rows in Filters, with scope notes where they don't apply.
  - Acceptance: tests.

- [ ] SA-108 **Marketing report** (spec §8 Marketing effectiveness):
  - `GET /api/analytics/marketing`: spend, platform-reported conversions and value per network and campaign, each
    with its attribution label; `platform_roas`; store-level net sales ÷ ad spend as its own labelled metric
    (`mer`, added to the registry); contribution after ads. No ad spend is allocated to products.
  - Acceptance: tests; consistency row.

- [ ] SA-109 **Marketing tab** (spec §8).
  - Acceptance: tests; browser pass.

- [ ] SA-110 **Profitability report** (spec §8 Profitability and costs; decision 16):
  - `GET /api/analytics/profitability`: starts at gross sales; discounts, refunds, product cost of costed lines
    (with a restocked-refund line), fees (recorded and estimated apart), contribution before ads, ad spend as "not
    allocated", contribution after ads, net profit unavailable with its reason, and cost coverage. By product
    (before ads only).
  - Acceptance: the oracle; no profit line shows with zero cost coverage.

- [ ] SA-111 **Profitability tab** (spec §8).
  - Acceptance: tests; browser pass.

- [ ] SA-112 **Operations: stock cover** (spec §8 Inventory and fulfillment; decision 27):
  - Products and variants by days of cover, with low and out states and the "stock is current" note.
  - Acceptance: tests.

- [ ] SA-113 **Operations: fulfillment** (spec §8):
  - Time from paid to fulfilled and delivered where recorded; late orders (over 48 h); per channel.
  - Acceptance: tests.

- [ ] SA-114 **Operations: refunds and returns** (spec §8):
  - Refund rate by product and channel, restocked share. Refund reasons are not stored (decision 20).
  - Acceptance: tests.

- [ ] SA-115 **Operations: sync health and attentionCount** (spec §5, §8):
  - Failed listing syncs, stale sources and backoff waits; `attentionCount` (open Operations insights) drives the
    tab's count.
  - Acceptance: tests.

- [ ] SA-116 **Operations tab** (spec §8).
  - Acceptance: tests; browser pass.

### Phase 7 — Agent integration (spec §10)

- [ ] SA-117 **Reader** (decision 39):
  - `apps/server/src/store-analytics/reader.ts` implements `AnalyticsReader` (metrics, series, breakdown, insights,
    products, freshness, definitions) on the v1 functions, scoped to the run's store. Add `analytics?:
    AnalyticsReader` to `ToolEnv` in `packages/agents/src/tools.ts` and wire it in `toolEnv` in
    `apps/server/src/routes/agents.ts`. Tool output for a demo store starts with a `DEMO DATA` line; every output
    names the definitions (`id@version`) and freshness.
  - Acceptance: tests with the fake engine; another store's id is refused.

- [ ] SA-118 **metrics_timeseries on v1** (spec §10):
  - It reads the reader; unavailable values come out as "unavailable: <reason>", never 0.
  - Acceptance: consistency row (the tool's net sales = the KPI).

- [ ] SA-119 **list_products on v1** (spec §10):
  - Period sales, stock state and cover, cost coverage, per channel.
  - Acceptance: consistency row.

- [ ] SA-120 **store_summary and compare_stores on v1** (spec §10):
  - Both read the reader; `compare_stores` converts per day (SA-53) and keeps its Analytics Specialist-only rule.
  - Acceptance: consistency rows.

- [ ] SA-121 **list_campaigns and review_campaigns** (spec §10; decision 39):
  - Spend and the store's net sales and contribution context come from the reader; `ads.ts` `economics` and
    `thresholds` stay as they are.
  - Acceptance: tests; `agents-outcomes.ts` tests unchanged.

- [ ] SA-122 **analytics_breakdown and analytics_insights tools** (spec §10 Useful investigations):
  - Two read tools on the reader (a metric by dimension; the rule insights with evidence), added to the
    `market_analyst`, `ad_strategist` and `operations` tool lists in `roles.ts` (and any tool-name list
    `configs.ts` checks).
  - Acceptance: fake-engine tests.

- [ ] SA-123 **Findings table and validator** (decision 29):
  - Migration `/* NN (store-analytics: SA-123 findings) */`: `analytics_findings` (store, scope, label observed |
    hypothesis | data_health, headline, body, evidence, limitation, role, run and conversation ids, `insight_key`,
    status, created_at) with a unique index on `(store_id, insight_key)`.
  - `validateFinding`: recomputes every evidence value from its scope and refuses a mismatch; requires a limitation;
    refuses causal words under Observed ("save it as a hypothesis"); refuses any confidence or score field.
  - Acceptance: tests for each refusal.

- [ ] SA-124 **save_analytics_finding tool and routes** (spec §10 Evidence-based findings):
  - The tool (through the validator) and `GET /api/analytics/findings`, `PATCH` (dismiss or keep). Saving needs no
    approval (an app record only).
  - Acceptance: fake-engine test; scope rows.

- [ ] SA-125 **Ask: server context** (spec §10):
  - Add `{ kind: 'analytics'; … }` to `ConversationContext` in `packages/shared/src/index.ts` (additive), carrying
    the tab, period, comparison, filters and the selected metric or product ids.
  - `openedFrom` and `conversationPreface` in `conversations.ts` handle it: the preface adds those plus the
    definitions (`id@version`), with values read again on the server for the conversation's store (never taken from
    the client); product titles and other platform text go through `untrustedBlock` (`kb-sources.ts`).
  - Acceptance: tests: the preface has no credential and wraps platform text.

- [ ] SA-126 **Ask: button, chip and selection send** (the boards):
  - "✦ Ask about this view" on the tab row and "Ask about this product" in the drawer, through
    `useStartConversation`; checked rows go with it. `ContextChip` in `apps/web/src/agents/Conversation.tsx` shows
    "Store Analytics · <tab> · <period>" for the new kind and links back to that exact view.
  - Acceptance: tests; browser pass.

- [ ] SA-127 **FindingCard agent handoffs** (spec §10 Handoffs and learning):
  - Agent mode for saved findings ("<role name> · finding", decision 43); Investigate opens Ask with the finding;
    "Send to <role>" opens a conversation with the role that owns the area (Ad Strategist for ads, Operations for
    stock and fulfillment) carrying the analytics context. Nothing is applied from here.
  - Acceptance: tests.

- [ ] SA-128 **Save to KB** (spec §10):
  - A finding becomes a KB card through `createCard` under `ensureCategoryPath` "Store Analytics / <store>", with
    `addEvidence` links to its records; demo findings say demo.
  - Acceptance: tests.

- [ ] SA-129 **Drawer agent and research handoffs** (spec §7, §10):
  - "Send to Operations" from the drawer; when the product came from Product Research (`pr_outcomes`
    `store_product`, linked by `linkStoreProduct`), a link back to its research record.
  - Acceptance: tests.

- [ ] SA-130 **Insights & Reports tab** (spec §10, §11):
  - Rule insights and saved findings, filterable by label, each with its evidence and status. The reports section
    joins in SA-141.
  - Acceptance: tests; browser pass.

### Phase 8 — Reports and alerts (spec §11)

- [ ] SA-131 **Views API** (decision 37):
  - Migration: `analytics_views` (store, name, state JSON, is_default) with
    `CREATE UNIQUE INDEX ... ON analytics_views (store_id, lower(name))`; CRUD routes.
  - Acceptance: tests; scope rows.

- [ ] SA-132 **Views UI** (decision 37):
  - Save, open, rename, delete and set default; the store's default view applies when the store is picked.
  - Acceptance: tests.

- [ ] SA-133 **Owner annotations** (decision 45):
  - Migration: `analytics_annotations`; create, edit and delete routes; they join SA-72's list as "your note".
  - Acceptance: tests; scope rows.

- [ ] SA-134 **Goals** (spec §11 Goals and forecasts):
  - Migration: `analytics_goals` (metric, period, target); drawn as a target line and a progress value, apart from
    actuals.
  - Acceptance: tests.

- [ ] SA-135 **Forecast** (decision 46):
  - `forecast.ts` per decision 46, drawn dashed with its range and labelled "Forecast".
  - Acceptance: tests: under 56 clean days or a data-health gap gives unavailable with the reason.

- [ ] SA-136 **Watchlist** (spec §11 Anomaly detection and watchlists):
  - Migration: `analytics_watchlist` (products or metrics); shown on Insights & Reports with each item's current
    insights.
  - Acceptance: tests.

- [ ] SA-137 **Alert rules** (decision 36):
  - New trigger kinds in `automation_rules` (`parseRule` accepts them): a metric crossing a threshold, and a rule
    insight firing. Delivery is an existing `notify` kind (Q26); no new `NotificationKind`.
  - Acceptance: tests.

- [ ] SA-138 **Alert evaluation** (decision 36):
  - The scheduler (`startScheduler`) evaluates them through `computeMetricSet` and `RULES`, with the rule's cooldown
    and daily cap, deduped with `once()`. The UI says "Runs while Frontline Ecom is open; a run missed by more than a
    day is skipped."
  - Acceptance: tests: one firing per cooldown; another store's data never triggers.

- [ ] SA-139 **Alerts UI** (spec §11):
  - Create, pause and delete alerts from a metric or insight; the run log.
  - Acceptance: tests.

- [ ] SA-140 **Export buttons** (decision 35):
  - Export on each module's main table through the engine (one route per surface under `/api/analytics/export/`).
  - Acceptance: tests; consistency rows (each export's totals = the screen).

- [ ] SA-141 **Report snapshots** (spec §11 Reports and exports):
  - Migration: `analytics_reports`: a frozen snapshot of a view (values, definitions version, freshness, demo flag).
    Viewing an old report shows its values, not today's.
  - Acceptance: tests.

- [ ] SA-142 **Scheduled reports** (decision 36):
  - An `automation_rules` action that creates a snapshot and a notification; the same "Runs while Frontline Ecom is
    open…" copy.
  - Acceptance: tests.

- [ ] SA-143 **Digest on v1 and the Dashboard label** (decision 31):
  - `sendDigest` reads the reader's v1 values (demo marked). Dashboard keeps the legacy totals and its revenue label
    becomes "Revenue incl. tax"; the report lists this as a limitation.
  - Acceptance: tests; the Dashboard test updated for the label only.

### Phase 9 — Hardening and acceptance (spec §13 to §15)

- [ ] SA-144 **Isolation sweep completion** (spec §13):
  - `scope.test.ts` covers every analytics route, export, job and agent tool; if decision 38's cache was added,
    its keys include the store id and a test proves it.
  - Acceptance: the `app.routes` check passes with no missing rows.

- [ ] SA-145 **Credentials and customer data** (spec §13):
  - A test seeds an integration whose token appears in a sync error, a ShopifyQL error and a product title, then reads
    every route, export, report, the digest and every agent tool's output and fails on the token or any PII field.
  - Acceptance: test.

- [ ] SA-146 **Untrusted text and export safety** (spec §13):
  - Platform text is escaped in the UI, wrapped for agents, and formula-safe in exports.
  - Acceptance: tests with hostile titles.

- [ ] SA-147 **Read-only boundary** (decision 44):
  - A test lists every non-GET analytics route and fails if one writes outside the lane's app-record tables.
  - Acceptance: test.

- [ ] SA-148 **Progressive loading and no resync on visit** (spec §14):
  - Panels load independently; opening the page never starts a sync; a store switch never shows the previous store.
  - Acceptance: tests; browser check with a throttled network.

- [ ] SA-149 **Explicit states** (spec §5, §16):
  - A sweep over every panel for loading, empty, error, unavailable and demo states; no dead control; no demo value
    without its label.
  - Acceptance: tests; browser pass.

- [ ] SA-150 **Accessibility** (spec §14):
  - Keyboard paths through tabs, table, drawer and dialogs (`roving` where used); labels on charts; contrast of the
    board colours; 390 px width with no sideways scroll.
  - Acceptance: tests; browser pass.

- [ ] SA-151 **Navigation round trips** (spec §6 Drilldown behavior):
  - Every drilldown and back keeps the store, period, filters and scroll; a shared URL opens the same view.
  - Acceptance: tests.

- [ ] SA-152 **Consistency coverage** (spec §15 Metric consistency):
  - `consistency.test.ts` has a row for every surface: KPIs, chart, breakdowns, drawer, exports, reports, digest and
    agent tools.
  - Acceptance: test.

- [ ] SA-153 **Persistence and restart** (spec §15 Persistence):
  - Views, annotations, goals, watchlist, findings, alerts and reports survive a server restart on the same data
    dir; an interrupted sync is marked `interrupted` and resumes.
  - Acceptance: tests.

- [ ] SA-154 **e2e (conditional)** (spec §15):
  - If codex-hardening's Phase D harness exists on main and codex is past Phase D (CH-20 ticked) or stopped, add
    `e2e/store-analytics.spec.ts` (store switch, tabs, drawer, export) with no harness edits. Otherwise append the
    request to codex-hardening's Inbox and say so under Done.
  - Acceptance: `pnpm e2e` green twice, or the request filed.

- [ ] SA-155 **Design pass** (the boards):
  - Overview and Listings side by side with the boards at 1440×900, then 1280 and 390; the other tabs for density.
    Fix the differences; list any deliberate one under Notes.
  - Acceptance: screenshots in `docs/features/store-analytics-screens/`.

- [ ] SA-156 **Real-engine smoke** (CLAUDE.md hard rules):
  - One short real-engine run: Ask about this view on a demo store, check the answer cites v1 values and says demo.
  - Acceptance: one line under Done.

- [ ] SA-157 **Acceptance pass** (spec §15, §16):
  - Re-check every Blocked item. Walk "Done when" and tick each line with its evidence, or say why not.
  - Acceptance: every line ticked or explained.

### Phase 10 — Final report

- [ ] SA-158 **Report, DESIGN.md and STOP** (spec §16):
  - Write `docs/features/store-analytics-report.md`: what was built (by phase, with commits), which sources work, which
    workflows were tested live (or none), the calculation and reconciliation results, screenshots, the owner
    questions with the defaults taken, the remaining limitations and the owner's next steps.
  - Rewrite `docs/DESIGN.md` §4 item 3 to point at the spec and the two boards.
  - List the real integrations connected now; a source connected later needs the lane restarted on its live check.
  - Then create an empty `.agent/STOP` in this worktree and stop.
  - Acceptance: the report is on origin/main and `.agent/STOP` exists.

## Done
<!-- dated one-liners, newest last: - YYYY-MM-DD SA-NN <what shipped> (<commit>) -->
- 2026-10-28 SA-01 claims filed to codex-hardening's Inbox; CLAUDE.md row matches the Owns list (code paths plus "the touch points"); baseline `pnpm check` green at 4d4ec6b3: 234 test files, 1730 tests (typecheck + vitest 69 s).
- 2026-10-28 SA-02 codemap re-checked at 89aae4a7 (corrections: api() already takes a signal, FX is partly per day already, demo days are machine-local) and a metric inventory table of 18 rows added; no code change.
- 2026-10-28 SA-03 shared `SaDatasetStatus`, `SaReason` (+ `SA_REASONS` text), `SaValue`, `SaCoverage`, `SaFilterKey`, `SaFilterScope` in `packages/shared/src/store-analytics.ts`; `analytics/Unavailable.tsx` and `FilterScope.tsx` with tests (11).
- 2026-10-28 SA-04 `SA_SOURCES` (10 syncers + demo × 17 datasets, support / reads / field / scopes / history / rate limit / reason) and the generated `docs/features/store-analytics-sources.md`. Docs check 2026-10-28: product views per product — Amazon documented (salesAndTrafficByAsin.pageViews, not read), Shopify / Etsy / TikTok Shop not confirmed in the official references (unsupported); ad-to-product — Meta (product_id breakdown) and Google Ads (shopping_performance_view) documented, not read (decision 16), TikTok Ads not confirmed. `SYNCERS` exported from `sync.ts` for the coverage test.
- 2026-10-28 SA-05 `SA_METRICS` v1 (18 metrics: formula, unit, additivity, grain, filters, currency, zone, date basis, exclusions, refund treatment, datasets, direction), `saDef`, `renderMetricsDoc` → `docs/features/store-analytics-metrics.md`; `store-analytics.test.ts` checks the doc and a frozen hash per id@version.
- 2026-10-28 SA-06 shared `SA_PRESETS`, `SA_COMPARES`, `resolvePeriod`, `comparePeriod`, `validateCustom`, `changeOf`, `ratio`, `combineStatus`; `store-analytics/period.ts` `storePeriod` (store zone + ET-style abbreviation, demo label, history start, same-clock cut and day fraction) with tests incl. Feb 29, NY DST start/end, mtd on the 1st, 731 days.
- 2026-10-28 SA-07 migration 56 (the next free number): order source ids, channel ids, duplicate_of, customer ref and state, country, currency, as-placed money parts, event times, breakdown_at (all nullable, no defaults) with the channel-id and customer partial indexes; products category/handle/synced_at; daily_metrics.purchase_sessions; 13 new tables (refunds, order_fees, order_lines, product_variants, channel_listings, product_links, product_collections, unit_costs, inventory_snapshots, sync_runs, source_datasets, fx_rates, traffic_breakdown_daily). `schema.test.ts`: empty DB, an upgrade of a DB at 55 with rows, cascade on store delete.
- 2026-10-28 SA-08 outside the Phase E window (CH-20 open on main): `rebuildRevenue` leaves `duplicate_of` copies and their refund lines out; `setOrderItems` keeps a known line cost on re-sync; `setStoreTimezone` re-dates `refunds` by refund time and `order_fees` by their order's day (snapshots keep theirs); `forgetPlatform` also clears that platform's ledger, catalog, link and `source_datasets` rows. Tests in `store-analytics/claimed.test.ts`; connector tests unchanged (161 green).
- 2026-10-28 SA-09 `store-analytics/fixture.ts` `seedLedgerStore`: a New York Shopify store with TikTok Shop (synced Oct 24 – Nov 8) and Meta, 16 orders and 5 refund lines covering every listed case; `oracle.test.ts` holds the hand-worked P1/P2/P3 values with a comment per number, metrics `todo` until SA-16..SA-21; `pins.test.ts` snapshots `summarize`/`platformSplit`/`topProducts` for the three demo stores and the fixture.
- 2026-10-28 Inbox (from codex-hardening) Phase E read as CH-21/22 + its STOP from now on (SA-08's claimed-function edits landed before CH-21). CH-19 axe filing: Analytics' 12 Research links keep their visible "Research this" with the campaign as sr-only text, the shared Ask AI control's name now includes its visible Ctrl K hint; axe on /analytics and /orders reports no serious/critical issues; baseline refresh filed to codex-hardening (it owns `e2e/**`).
- 2026-10-28 Inbox (from codex-hardening, CH-22) `SA_SOURCES` now says Google's attribution covers primary conversion actions (not only purchases, fractional counts, never used as purchase counts), TikTok's campaign-level spend leaves out Branded Mission, and Meta's v24.0 retires 2026-11-10 (bump filed to core's Inbox; `meta.ts` is Phase E). Ad connectors untouched; SA-20/SA-58 read these rows.
- 2026-10-28 SA-10 `store-analytics/sources.ts`: `scrubError` (credential values plain and URL-encoded, token-shaped runs, 300 chars), `startRun`/`endRun`/`recoverRuns`; `sync.ts` logs every syncer run in `sync_runs` (running → done/failed, a thrown syncer is now caught and recorded), marks leftover `running` rows `interrupted` and prunes runs over 90 days at loop start, and its log line carries the scrubbed error. Tests in `sync-runs.test.ts`.
- 2026-10-28 SA-11 `backoffOf` in `store-analytics/sources.ts` counts consecutive failed `sync_runs` (interrupted runs count as neither): 3 → 30 min, 6 → 6 h from the last failure's end; `startSyncLoop` skips stale-only retries while backed off, but "Sync now" and a credentials change (both bump `updated_at`) run at once, and the wait survives a restart. Fake-clock tests for each; sync.test's recovery case now waits the 30 minutes.
- 2026-10-28 SA-12 `connectors/ingest.ts`: `noteRead` (try, success, widened covered days, scrubbed error), `noted` (wraps a read, rethrows) and `noteFailed` (the outer catch's still-unread datasets). Shopify notes catalog, orders (backfill/cursor day → today) and the funnel as traffic (its `() => null` keeps swallowing but records why); Amazon notes catalog (partial past the search cap), inventory, traffic (a pending report isn't noted), orders and refunds, each still swallowed; Woo notes orders, refunds and catalog; Etsy orders and catalog. Tests in `connectors/ingest.test.ts`.
- 2026-10-28 SA-13 `store-analytics/routes.ts`: `readScope` (no store 400, unknown 404, a `stores=` list 400, unknown `metrics=` id 400) and `storeAnalyticsRoutes` with `GET /api/analytics/definitions` (`SA_METRICS`, narrowed by `metrics=`, and `SA_SOURCES`), mounted once in `app.ts` behind the existing `guard` on `/api/analytics/*`. `scope.test.ts`: a row per route, and a sweep that fails on any unlisted `/api/analytics/` route; legacy routes' tests unchanged.
- 2026-10-28 SA-14 `datasetFreshness` and `sourceRows` in `sources.ts` (per source × dataset: status with a reason where the status alone doesn't say, last success/try, `stale` at 3× the source's sync interval, scrubbed error, covered days; rows add the backoff wait and an Integrations fix link). A demo store reads `demo`; an unconnected platform reads `needs_credentials`, never an empty list. `GET /api/analytics/context` (name, niche, channels, zone label/abbr, currency, demo, history start, freshness) and `GET /api/analytics/sources`; shared `SaFreshness`/`SaSourceRow`/`SaContext`; scope rows added.
- 2026-10-28 SA-15 `PUT /api/analytics/sources/verified` `{ store, integration, dataset, note }` (`markVerified`): the store's own integration only (404 otherwise), a dataset it reads that has synced, a 1–500 character note; records `verified_at`, the account fingerprint (`accountOf`: shop domain, site URL, seller/marketplace, ad account, property…) and the note. `datasetFreshness` shows `verified` (with the mark) only while the latest read worked and the account still matches, else `available`, labelled "Available (not verified live)" by the new shared `SA_DATASET_STATUSES`. Scope row added.
- 2026-10-28 SA-16 `store-analytics/sales.ts` `salesMetrics(db, store, from, to, basis)`: the nine sales metrics over canonical orders (`CANONICAL`: paid, not test, `duplicate_of IS NULL`), refunds by refund day or `order_day`, EUR and other currencies at the locked or ECB day rate (`store-analytics/fx.ts` `rateOn`/`convertOn`, a day with no rate left out and listed). Orders without `breakdown_at` count as total − tax (less legacy refund lines), `estimated` with their share; discounts, refunds, cancellations and refund rate are `partial`, or unavailable when no order has money parts; units fall back to `order_items` (estimated); a never-read store is unavailable with the orders dataset's reason. The oracle matches all three periods to the cent.
- 2026-10-28 SA-17 `demoDay` gains `parts` (gross, discounts, refunds, shipping, tax, units, refunded units, purchasing sessions, cancellations) drawn after every existing draw, net to the day's revenue to the cent; `demoParts` scales them to a so-far day (`demoSoFar` uses it). `salesMetrics` reads demo stores through `demoSales` over their `daily_metrics` days: net sales and orders are Dashboard's, every value `demo`, before the history `insufficient_history`. Legacy pins unchanged. Units per product stay with `demoTopProducts`' fixed weights until the listings demo path (SA-67). Inbox: ST-06 settings consumers noted.
- 2026-10-28 SA-18 `seedDemoCatalog` (called by `seedDemoStore` and every `seedDemo` top-up, demo stores only, `INSERT OR IGNORE`): variants (product 3 in three, product 2 in two with one out of stock, stock adding up to the product's), a listing per product on the store's own channel (site, or TikTok Shop for Peak Fit), TikTok Shop listings for four products in the board's niche (beauty: Glow Haus), one owner-mapped product on a second channel with its `product_links` row, and two collections (Best sellers, Under $30). No ledger, snapshot or customer rows. Tests: two seeds give the same rows; a real store gets none.
- 2026-10-28 SA-19 `store-analytics/costs.ts` `costMetrics`: a line's cost is its recorded one, else the `unit_costs` row (variant, then product) effective on its order's day, else none (`LINE_COST`); uncosted lines leave contribution and count in `cost_coverage`; costed refunds come off costed sales by refund day (or order day), a restocked one gives its units' cost back; fees: recorded `order_fees` on their own day win, else Amazon as a channel 15% of its sales (`AMAZON_REFERRAL` now exported from `analytics.ts`, no value change), else the store's % of the amount charged + per-order fee, labelled `estimated`. No costed line or refund gives `unavailable` (`not_tracked`), not 0 or −fees. Demo path from `demoParts` and demo cogs. Currency conversion now shared (`storeConverter` in `fx.ts`). The oracle matches all three periods.
- 2026-10-28 SA-20 `store-analytics/ads.ts` `adMetrics`: `ad_spend` from `campaign_daily` of the store's campaigns (already in the store's currency; the account currency isn't recorded until SA-58, said in a ponytail note), `needs_credentials` with a Connect fix when no ad network is connected, `needs_ingestion` while none has synced, `partial` while some haven't; `platform_roas` per network (`networks`), the store figure only when one network spent (labelled "<network>'s own attribution · attribution setting not recorded"), never combined; `contribution_after_ads` = before − spend at store level. Demo: Dashboard's spend, `demo`. The oracle matches.
- 2026-10-28 SA-21 `store-analytics/traffic.ts` `trafficMetrics`: `sessions` over the days reported (sessions > 0, or inside a traffic read's covered days, a real 0), partial with day coverage otherwise, unavailable with the traffic dataset's reason when none; `site_conversion` = Σ purchasing sessions ÷ Σ sessions over days with both, coverage in days; GA4 (when connected it owns the sessions) and every platform without purchasing sessions get `unsupported` with the registry's reason; a Shopify store with none read gets `needs_ingestion` (until SA-33). Demo: daily_metrics sessions and `demoParts` purchasing sessions, `demo`. The oracle now has no todos left.
- 2026-10-28 SA-22 `store-analytics/metric-set.ts` `computeMetricSet(db, scope, ids, storePeriod, filters, basis)`: each id's `SaValue` with `def`, the comparison's value and `changeOf` (shared `SaMetricResult`, `SaMetricSet`, `SaFilters`), computing only the groups asked for. With today in the period the comparison's last day is cut at the same clock time (a `Slice` through sales, costs, ads and traffic: order-grain rows by `created_at`/`refunded_at`, day-grain ones scaled and `estimated`, demo via `demoSoFar`). Filters: `channel` is applied to the order metrics (`sliceSql`); store-level metrics, demo data and the filters not applied yet (product, collection, market, segment) are named in one `SaFilterScope`; contribution after ads is unavailable with any filter. `GET /api/analytics/metrics?store&metrics&period&compare&from&to&filters&refunds` (scope row added); an unknown id, bad `filters` JSON or refund basis is 400. `stock_cover` stays unavailable until SA-50.
- 2026-10-28 SA-23 `computeSeries` and `GET /api/analytics/series?store&metric&period&compare&from&to&filters&refunds` (scope row added; a missing or unknown `metric` is 400): one point per store day (weeks past 120 days), each the metric's own computation, the comparison point at the same day offset (its last day cut like the set's), today's point `partial`, unreported days `null`; `total` and `scope` from `computeMetricSet` (shared `SaSeries`, `SaSeriesPoint`). Tests: additive series sum to the total (sales, refunds, orders, units, ad spend, fees, both contributions); the 25-hour Nov 1 is one point; 365 days is 53 weekly points.
- 2026-10-28 SA-24 `store-analytics/reconcile.ts`: `checkOrderIdentity` (gross − discounts + shipping + tax − refunds = current total ± 0.01) and `reconcile` / `GET /api/analytics/reconcile?store&period&…&refunds` (scope row added; shared `SaReconcile`, `SaReconcileLine`): from Dashboard's stored revenue to v1 net sales through tax, shipping, refunds netted in current totals, legacy refund lines, paid-then-refunded orders, Amazon's daily totals vs its orders, pre-breakdown estimates, no-rate days, v1's dated refunds, stale stored totals and identity failures (listed by id), each with a count; duplicates, test/unpaid orders and refunds waiting for their order shown as info. The fixture closes to 0.00 on P1 and P3. Also: the fee estimate's amount charged now takes `orders.tax` in the store's currency (a legacy column, like `total`).
- 2026-10-28 SA-25 `seedScaleStore` in `fixture.ts` (255,035 orders over 730 days incl. channel copies, 20,000 products, 60,000 variants, unit costs, 5% refunded, 30% with fees, Meta days, traffic; deterministic, seeds in 3.5 s) and `scale.test.ts`: every distinct query the v1 entry points run (metric sets over last30/last365/today/year compare, with and without a channel filter and order-day refunds, two series, reconcile both bases, sources, store context) is recorded through a db proxy and its `EXPLAIN QUERY PLAN` fails on a `SCAN` of orders, order_lines, refunds, order_fees or campaign_daily (aliases resolved; the gate is proved on a scanning query). `SA_SCALE=1`: 966 queries, p50 0.8 ms, **p95 34.6 ms**, max 415.5 ms (the cost lines over 365 days), none over 2 s. p95 under 150 ms: no cache (decision 38); no missing index, no migration.
- 2026-10-28 SA-26 Cost lock: the Shopify order upsert keeps a stored `cogs` (`iif(cogs > 0, cogs, excluded.cogs)`); `setProductCost` fills only lines with no cost (order lines with none in force on their day get `cost_source 'owner_backfill'`, legacy items at 0 add to their order's cogs) and never rewrites a known past cost (the old-cost rewrite is gone; the Shopify refusal stays; the catalog test now expects 15 after a change, not 16). `recordUnitCost` in `connectors/ingest.ts` (append-only, same cost twice adds nothing, store currency), called by `setProductCost` (source `owner`, from the store's today; 0 isn't recorded) and the Shopify product sync (source `shopify`). Tests: `cost-lock.test.ts` (a first cost fills and flags; a change leaves past contribution unchanged), a Shopify re-sync with a new unit cost keeps the order's cogs.
- 2026-10-28 SA-27 Shopify orders: `ordersQuery` (owns ORDERS_Q) adds processedAt, currencyCode, sourceName/sourceIdentifier, app, totalTaxSet, shippingLines' discountedPriceSet, fulfillment createdAt/deliveredAt, and per line id, SKU, variant id, originalTotalSet, discountAllocations (SA-30's fields); customer and country are SA-32's probes, budgeted but left out until probed. Page size from the static cost: 10 orders × 5 lines = 893 (was 12 × 10), ORDER_ITEMS_Q 75 lines = 904; `shopify.contract.test.ts` prices every read (`SHOPIFY_READS`) and fails over 1000. Writes source_kind/source_id, `shopifyChannel` (marketplace apps → tiktok_shop/amazon/etsy/walmart/ebay with `channel_order_id` = sourceIdentifier, web/draft/mobile → site, pos, else other), as-placed `orderParts` (lines' original totals and allocations, shipping after its discounts, the tax share taken out where prices include tax), `tax` as placed (`totalTaxSet`: the legacy daily tax of a partly refunded order now includes the refunded tax), paid/cancelled/fulfilled/delivered times, source_updated_at, breakdown_at (only when every line has its original total, else it stays an estimate). Order-level subtotal/discount/shipping totals aren't read: the reference doesn't say whether they hold shipping discounts; the lines and shipping lines are exact. Fixture `connectors/fixtures/shopify-doc-examples.json` (reference pages and date cited; the reference's own orders example only asks ids); identity holds on every order; pre-SA-27 rows read as estimates and a re-sync fills them. Also: SA-26's backfill flag now uses `order_lines.owner_backfill = 1` (`cost_source 'owner'`), and the ST-07 inbox item is acknowledged (no caller in this lane).
- 2026-10-28 SA-28 Shopify refunds ledger: `REFUNDS_Q` (`first:` everywhere: 5 refunds × 10 lines, 2 shipping lines, 3 adjustments = 563) runs only for orders that are partly refunded, refunded, voided or cancelled and whose `updatedAt` differs from the stored `source_updated_at`. One `refunds` row per refund line (merchandise = subtotal, tax, quantity, restocked, product, variant), shipping line and order adjustment (`other` = money back, the discrepancy's sign flipped), on the refund's day in the store zone, ids `<refund>:line|ship|adj:<id>`, upserted (idempotent). Where prices include tax the refunded amounts give their tax up (assumed like the order's prices). `rebuildRevenue` untouched; `noteRead` refunds; the registry marks Shopify refunds read. Contract fixtures: a partial refund, a full refund with shipping and restock, an amount refunded with no item; identity holds on every order; a re-sync of unchanged orders asks nothing and a changed one rewrites the same rows. The older Shopify test fake answers the refunds read.
- 2026-10-28 SA-29 Shopify variants: a paged `VARIANTS_Q` (`productVariants`, 200 a page = 803 points, incremental by `updated_at` like products; `PRODUCTS_Q` keeps `variants(first: 1)` for the summary columns) fills `product_variants` (title, SKU, price, compare-at, inventory, tracked = tracked and not CONTINUE, policy, the product's status, synced_at); each variant's changed `unitCost` calls `recordUnitCost` (variant-level). A failed variants read is noted (`noted`) and never stops the sync; `noteRead` variants; registry marks Shopify variants read (sources doc regenerated). Contract test: a 3-variant product gives three variant rows and one products row as today; a re-sync records no new cost. Found by it: `switchToReal` (common.ts, Phase E over: CH-22 ticked, codex STOP) now also clears the demo catalog SA-18 seeds (variants, listings, links, collections), with a test.
- 2026-10-28 SA-30 Shopify order lines: each line item (custom items too) becomes an `order_lines` row (line id, product, variant, SKU, quantity as placed, gross = original total, discount = its allocations, both giving up the tax share where prices include tax) with the cost first recorded = quantity × the variant's unit cost then (`cost_source 'platform'`; none = NULL, never 0), kept on every later sync (`coalesce(cost, excluded.cost)`). `orderParts` now sums the rounded lines, so the lines always add up to the order's gross and discounts. `setOrderItems` still feeds `order_items`. `noteRead` order_lines; registry marks them read (sources doc regenerated). Contract tests: rows by variant, line sums = order gross and discounts on every fixture order, a later unit cost leaves the first cost.
- 2026-10-28 SA-31 Shopify publications: `PUBLICATIONS_Q` (its own read, since read_publications is optional; 25 products × 10 publications = 828 points, incremental like products) writes each product's state per sales channel into `channel_listings` (current state only: active, scheduled when the publish date is ahead, unpublished; `published_at` only from Shopify's publish date, never the epoch it gives unpublished ones). `publicationChannel` maps the publication's catalog title to the orders' channel kinds (marketplaces, site, pos) or a title key (google_youtube). A denied read records `needs_permission` (new `ReadOutcome`; `sourceRows` gives it the reason) and never stops the sync. Registry marks Shopify channel listings read (sources doc regenerated). Contract tests: four channels' states; a denied read changes nothing else.
- 2026-10-28 SA-32 Customer refs and country: `probeField` in `connectors/ingest.ts` runs a one-order query asking only for the field, once a day per integration (`done_once` ref `sa-probe:<integration>:<field>:<date>`, a denial kept as `…:denied`; any failure counts as denied until tomorrow). `ordersQuery` asks for `customer { id }` / `shippingAddress { countryCodeV2 }` only when allowed. `customerRef` = 'c_' + sha256(store|kind|id) cut to 24 hex (decision 20) → `customer_ref`, `customer_state` identified / guest / unavailable, `country` ISO-2; a known ref or state stays through a later denied day. Nothing else of the customer is asked. `customers` dataset: available, partial (one field denied) or needs_permission; registry marks it read (sources doc regenerated). Tests: a denied probe never fails the order sync; one ref per customer within a store, another on a different store; probed once a day; no personal-data column on orders, order lines, refunds or fees (schema test). Older Shopify tests now find the orders page by its sort key (the probe is an orders query too).
- 2026-10-28 SA-33 Purchasing sessions: the documented ShopifyQL sessions dataset has `sessions_that_completed_checkout` ("visits that ended with a completed purchase", schema read 2026-10-28), so it's read as its own ShopifyQL query next to the funnel (no GA4 only), with its own `noteRead` (`purchase_sessions`) and `done_once` ref `shopify-purchase-sessions:<store>:<host>` (730 days until a read works, then 3). Writes `daily_metrics.purchase_sessions`; `purchaseDays` drops a day without the value (never 0). Registry marks it read (sources doc regenerated). Contract tests: values land next to the funnel's; a failure leaves the funnel's sessions untouched and purchase sessions null; a missing day is skipped.
- 2026-10-28 SA-34 Shopify traffic breakdowns: one ShopifyQL read per documented dimension (`referrer_source`, `session_device_type`, `session_country_code` as source / device / country) using the documented `GROUP BY day, <field>, human_or_bot_session` form over the funnel's days, with purchasing sessions too since SA-33 found them; bot rows dropped like the funnel. Into `traffic_breakdown_daily` (source 'shopify', the window's rows replaced). Each day is checked against its sessions: what the values don't cover is an `unknown` row (a day with sessions and no split is all unknown), so a gap shows instead of vanishing. `traffic_breakdowns` dataset: available, partial (some dimensions) or failed; registry marks it read (sources doc regenerated). Contract tests: each dimension's day sums to the day's sessions; bots dropped; a failed read leaves the funnel and earlier rows unchanged.

## Blocked

## Notes

### Owner questions (work goes on with the default; SA-158 lists the ones still open)

- Q1 How should the dedupe line read? Default: the codemap's pattern, "<n> TikTok Shop orders matched, 0 counted
  twice", plus "<m> copies left out without a match" when m > 0.
- Q2 AOV: order value of the orders placed ÷ those orders, before refunds (decision 11), or net sales ÷ orders as the
  board's line says? Default: before refunds, line "Order value ÷ orders, before refunds".
- Q3 Lines with no unit cost: leave them out of contribution and show coverage (default), or estimate them from a
  store margin?
- Q4 A product's first owner-entered cost: fill its uncosted past lines, flagged `owner_backfill`? Default: yes.
- Q5 An order cancelled after payment: counts as an order on its placement day, with its refund on the cancel day?
  Default: yes (decision 10).
- Q6 Dashboard and the automation metric triggers stay on the legacy totals (with the "Revenue incl. tax" label), while
  agents and the digest move to v1? Default: yes; moving Dashboard is a later owner call.
- Q7 Optional Shopify scopes `read_publications` and Level 2 customer data on the existing custom app? Default: used
  when present; without them those datasets show `needs_permission`.
- Q8 A setting to map an unknown sales-channel app to a marketplace for dedupe? Default: no; such orders get a
  data-health warning only.
- Q9 Backoff: 3 failures → 30 minutes, 6 → 6 hours? Default: yes.
- Q10 Etsy: at most 50 listing-inventory reads per sync? Default: yes.
- Q11 One store at a time on this page, with all-store totals left to Dashboard? Default: yes (decision 2).
- Q12 Should picking a store here also change the app-wide store filter (`fe.stores`)? Default: no.
- Q13 Keep the board's "active listings" wording in the footer and the Top products link? Default: yes.
- Q14 The finding card when there is no insight and no saved finding: the Rule card fallback ("No flags right now",
  with How flags work)? Default: yes.
- Q15 The chart's Contribution segment: after ads when the store has ad data, else before ads, labelled? Default: yes.
- Q16 A KPI with no source (for example conversion on a GA4 store): keep the tile and show "Not tracked" with the
  reason? Default: yes, so the strip doesn't jump between stores.
- Q17 The finding card's agent name: the app's role name, "Analytics Specialist", instead of the board's "Market
  Analyst"? Default: yes (decision 43).
- Q18 A separate "orders per session" metric next to site conversion? Default: no.
- Q19 A place to enter overhead so net profit can show? Default: no; net profit stays unavailable.
- Q20 Demo customer ids so the Customers tab has demo data? Default: no; demo stores show the no-data state.
- Q21 Read actual payment fees beyond Amazon (Shopify Payments, WooCommerce gateways)? Default: no; labelled
  estimates from the store's fee settings.
- Q22 Privacy thresholds: groups under 10 customers merge into "Other", cohort cells under 5 hidden? Default: yes.
- Q23 Stock cover from the last 14 full days, flagged under 10 days? Default: yes.
- Q24 Forecast: weekday average over 8 weeks, needs 56 clean days, 14 days ahead at most? Default: yes.
- Q25 Add `e2e/store-analytics.spec.ts` only when codex's harness exists and codex is past Phase D? Default: yes,
  otherwise file the request (SA-154).
- Q26 Which notification preference do analytics alerts follow? Default: the existing `info` kind (no new kind, since
  Settings is hands off).
- Q27 Email delivery for alerts and reports? Default: no; in-app only (the app has no email sending).
- Q28 One real-engine smoke run for the whole lane (SA-156)? Default: yes, once.
- Q29 Which store gets the first live check? Default: the one with a Shopify site and TikTok Shop, as on the board.

### Limitations known now

- Until SA-08 ships (it may wait for codex's Phase E), `rebuildRevenue` counts channel copies twice in the legacy
  totals; v1 metrics are correct from SA-51 on.
- History before migration 56 has no money parts, lines by variant, refunds by day or customers until the SA-60
  re-pull; those orders are `estimated` meanwhile, with their share shown.
- Inventory history starts the day SA-50 ships; past stock can't be rebuilt.
- No live check can run until the owner connects a source. Every "verified" mark waits for that.
- Syncs, alerts and scheduled reports run only while the app is open.

### Critic findings rejected or partly taken (with reasons)

- F12 (change `api()` to abort stale requests): rejected. react-query already ignores the result of a query whose key
  moved on, and passing its `signal` to the existing `api()` cancels the fetch; changing `api()` would touch every
  page. F74 reached the same conclusion. Decision 32.
- F46 (put the metric layer after the connectors): partly taken. The metric layer stays in Foundation, before the
  connectors, because it reads only migration-56 columns and the fixture, and lets each connector item prove its
  source-to-metric path (spec §16: "Verify a real source-to-screen workflow early"). The rest of F46's order is
  taken: the Listings API core moved into Interface (SA-66), and the gated items check the gate first.
- F76.4 (export `zoneNotice` from `integrations.ts`): rejected. Following F66, `integrations.ts` isn't edited; the
  zone note uses `adZone` from `common.ts` instead.
- F76 (mark collections `not_tracked`): rejected in favour of F1's ingestion item (SA-47), since Shopify, WooCommerce
  and Etsy all document a collection or category read.
- F30 vs F64 (scale sizes): F64's sizes, inside F30's single fixture file (SA-25).
- F41 (add a publication history log): rejected. No publication history is recorded; the "listed across a past
  period" claim is dropped and "since <date>" shows only from a platform date (decision 21).
- F14 vs F53 (status vocabulary): F53's shape is taken (decision 4).
- F11 vs F54 (period presets): the interface's preset ids, with F54's 730-day maximum (decision 6).
- `Store.demo` in the shared `Store` type: not added (the shared package is additive-only and no other surface needs
  it); the context endpoint carries `demo`.
- The "nightly re-date" fallback loop for a Blocked SA-08: dropped. It would be a second writer for the same rows;
  the item waits under Blocked instead.
