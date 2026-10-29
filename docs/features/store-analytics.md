# FRONTLINE ECOM — STORE ANALYTICS PAGE REDESIGN & FULL-STACK IMPLEMENTATION

> Owner's feature spec, verbatim (2026-10-28).
> Chosen design (owner, 2026-10-28, verbatim): **"Go with A"** (concept A, Executive Analytics Workspace). See
> `docs/reference/store-analytics-overview.png` and `docs/reference/store-analytics-listings.png` (and the `.html` files next to
> them). Build lane, decisions and items: `docs/backlog/store-analytics.md`. Code and data audit:
> `docs/features/store-analytics-codemap.md`. Repo rules: `CLAUDE.md`.

## 1. READ FIRST: REQUIRED WORKFLOW

I want to completely revamp the **Store Analytics** page inside my existing application.

This should become a complete, store-specific analytics workspace—not just a redesigned revenue dashboard. It needs to combine business performance, product and listing intelligence, customer insights, profitability, operational health, and actionable recommendations.

The finished feature must have real data connections, reliable calculations, persistent configuration, and meaningful integration with the rest of Frontline Ecom.

**Follow the sequence below. Do not skip the design-approval stage.**

### Stage One — Inspect the existing application

Review the current Store Analytics page, application architecture, design system, store connections, available data, agent infrastructure, Knowledge Base, Product Research, and Settings.

Identify what already works, which data sources are connected, what permissions are available, and which metrics can actually be calculated.

Inspect existing metric definitions before introducing new ones. Preserve working integrations, historical data, and established business rules.

Complete an initial data-feasibility assessment before designing around metrics that may not be obtainable.

### Stage Two — Create four design concepts

Create **four genuinely distinct, high-quality visual concepts** and place them together on one comparison artboard.

These must be actual visual designs—not four written descriptions or small variations of the same dashboard.

Use the same representative store, reporting period, and sample content across the concepts so I can compare their layouts fairly. Clearly label demonstration data.

### Stage Three — Stop for my approval

Present the artboard and let me choose a direction or request a combination.

**Do not choose a concept for me, replace the production page, or launch the implementation worker before I approve the direction.**

### Stage Four — Create the implementation workspace

After approval, create a dedicated Orca workspace and launch a Claude development agent/worker named exactly:

**Store Analytics**

Verify the available Orca environment and supported workspace controls first. Do not invent commands or claim that a worker is running when it is not.

This is the development worker building the feature—not one of the analytics agents operating inside the application.

### Stage Five — Implement, verify, and repair

Have the worker continue through the approved scope, including frontend implementation, backend functionality, data integration, calculation validation, testing, and defect repair.

Maintain a completion checklist and recoverable checkpoints.

Do not stop because the page looks finished while its data, calculations, or workflows remain incomplete.

Continuous work must operate within the actual runtime, permissions, and execution limits. Do not promise indefinite background execution or use uncontrolled retry loops.

---

## 2. OVERALL PRODUCT VISION

Build a complete analytics workspace that helps me understand:

**How is this store performing, what is driving its results, which products need attention, where are we losing money or opportunities, and what should we do next?**

The experience should connect:

**Store Performance → Product and Listing Performance → Customer Behavior → Marketing Effectiveness → Profitability → Operational Issues → Recommended Actions**

I should be able to start with a high-level summary, investigate a change, inspect the underlying evidence, and hand off the next action to the appropriate agent or application workflow.

Do not limit the implementation to a few summary cards and charts. However, do not add information merely to make the page look complex.

**Every section should support a real business question or operational decision.**

---

## 3. VISUAL DIRECTION AND FOUR DESIGN CONCEPTS

Give this page a polished SaaS appearance that is clean, distinctive, and highly organized.

Preserve Frontline Ecom’s established visual identity and application shell. Use strong typography, deliberate spacing, restrained accents, readable charts, and clear information hierarchy.

Avoid game-like elements, decorative gauges, excessive glow, oversized empty cards, and cramped dashboards containing dozens of equally prominent metrics.

Explore these four directions:

| Concept | Design direction |
|---|---|
| **A — Executive Analytics Workspace** | A refined overview emphasizing business health, important changes, and direct drilldowns into supporting details. |
| **B — Commerce Intelligence Terminal** | A more analytical layout with powerful tables, product comparisons, compact charts, and contextual inspection panels. |
| **C — Store Operations Hub** | A workflow-oriented experience connecting performance with listing issues, inventory, fulfillment, and prioritized actions. |
| **D — Insight-Led Analytics Studio** | An evidence-focused layout combining performance trends, explanations, agent findings, and guided investigation. |

All four concepts must support the same core functionality.

### Artboard requirements

Show the store selector, date controls, primary performance area, listings workspace, product detail interaction, and an example insight.

Present each concept as a clearly labeled frame with a way to inspect it at a readable size.

Use consistent sample values and avoid layouts that depend on fabricated capabilities.

Briefly explain each concept’s strengths and tradeoffs.

Any preview code must remain isolated from the production redesign until approval.

---

## 4. STORE SELECTION AND REPORTING CONTEXT

Make the selected store unmistakable throughout the page.

Use the application’s actual store identities and permissions. Do not create a separate Analytics-only store registry.

Selecting a store must load its authorized data, connected channels, reporting preferences, saved views, and available capabilities.

Changing stores must not display stale results from the previous store while new results load. Prevent late responses from overwriting the currently selected store’s analytics.

### Global reporting controls

Provide practical date presets, custom ranges, comparison periods, and relevant filters for channels, products, collections, markets, and customer segments.

Support comparisons such as the previous equivalent period and the same period in the previous year where sufficient history exists.

Display the reporting timezone, currency, selected comparison, and data freshness.

Treat incomplete periods carefully. Comparing today so far with a full previous day must not appear equivalent without a visible qualification.

### Current state versus historical performance

Clearly distinguish:

**Current operational state:** What is published, available, connected, or in stock now.

**Historical performance:** What happened during the selected reporting period.

For example, the Listings section may show products that are active now alongside their sales during the selected period.

Label that behavior explicitly. Do not imply that a product was active throughout a historical period unless historical publication data supports that conclusion.

Global filters must either apply to a section or visibly explain why they do not. No silently ignored filters.

---

## 5. REAL DATA CONNECTIONS AND SOURCE COVERAGE

Build this page on genuine connected data.

Investigate the application’s existing commerce, marketplace, advertising, web analytics, fulfillment, supplier, and cost integrations.

Verify current provider documentation, account eligibility, permissions, available history, and rate limits during implementation. Do not assume every connected platform exposes every metric.

### Source capability assessment

For each source, record what is available, its reporting grain, update frequency, access restrictions, historical coverage, and known limitations.

Distinguish between:

**Live and verified**, **partially available**, **credentials or permissions required**, **authorized import**, and **unsupported**.

A connected store does not automatically mean traffic, advertising spend, product costs, or customer acquisition data is available.

### Source-of-truth rules

Define the authoritative source for each metric.

Use commerce data for recorded sales outcomes, supported advertising data for platform-reported advertising performance, and actual cost records or explicitly labeled assumptions for profitability.

Do not combine differently defined metrics simply because their labels look similar.

### Avoid duplicated orders

When marketplace orders also appear in the connected commerce platform, identify and reconcile them through reliable source identifiers and mappings.

The same order must not count twice because it appears in both a store integration and a channel integration.

Do not rely on customer names or approximate order amounts alone to deduplicate transactions.

### Honest coverage states

Missing information must appear as unavailable, incomplete, estimated, or awaiting connection—not zero.

Show the last successful update for important datasets. A recent order sync must not make an outdated advertising dataset look fresh.

Never fabricate metrics, historical charts, connected accounts, or completed synchronizations.

---

## 6. PAGE STRUCTURE AND OVERVIEW

Organize the feature into focused areas rather than one excessively long dashboard.

A useful starting structure is:

**Overview · Listings & Products · Sales · Traffic & Conversion · Customers · Marketing · Profitability · Operations · Insights & Reports**

Refine this structure based on the existing application and actual data coverage. Group secondary sections where necessary.

### Overview priorities

The initial view should communicate the store’s current performance, important changes, strongest and weakest contributors, and issues requiring attention.

Use a restrained number of primary metrics, such as net sales, orders, average order value, conversion, advertising spend, and contribution after advertising—only where the required data exists.

Pair metrics with useful context: comparison value, change, definition, reporting period, and coverage.

Include a main performance trend, a concise product-performance summary, and a prioritized attention area.

Do not force every store into the same set of cards when its available data differs.

### Drilldown behavior

Clicking a metric or chart segment should open the relevant breakdown while preserving the store, period, filters, and metric definition.

A drilldown should explain the total shown above it—not display a different dataset with unrelated filters.

---

## 7. DEDICATED LISTINGS AND PRODUCT INTELLIGENCE WORKSPACE

This is a core requirement.

Create a complete section where I can see **all active listings for the selected store**, inspect their details, and understand their performance.

Do not limit the display to a small sample, the first API page, or a handful of top sellers.

### Product, variant, and listing structure

Keep these concepts distinct:

**Product:** The underlying item.

**Variant:** A specific configuration, such as size, color, material, or another option.

**Channel listing:** The publication of a product or variant on a particular sales channel.

A product can have several variants and multiple channel listings. Do not collapse them into an ambiguous record.

SKU values may be missing or reused, so do not treat SKU alone as a globally unique identifier.

### Listings table

Use a practical table with configurable columns, expandable variants, search, sorting, saved filters, and efficient pagination or virtualization.

Relevant fields include the image, title, product identifier, SKU, options, category, channel, listing status, price, discount, inventory availability, units sold, sales, refunds, and supported profitability measures.

Include last-synced time and relevant listing or synchronization issues.

Keep the default columns focused. Additional information should be available without making every row excessively wide.

### Status handling

Default to active listings, with access to draft, archived, unpublished, unavailable, and other supported states.

Keep publication status, inventory availability, and synchronization health separate.

An active listing can be out of stock. An available product can be unpublished. A sync failure does not necessarily mean the product is inactive.

Represent made-to-order, inventory-not-tracked, and supplier-managed products accurately instead of assigning misleading stock counts.

### Filters and bulk inspection

Support useful filters for channel, collection, category, publication status, stock condition, price, sales activity, return activity, and missing cost data.

Apply filtering and sorting to the full matching dataset—not only the loaded rows.

Let me select products for comparison, export the filtered results, or send a selected group to an agent for analysis.

### Product detail view

Opening a listing should reveal its variants, channel publications, performance history, inventory context, pricing, available cost information, refunds, related marketing activity, and relevant insights.

Show product-level traffic and conversion only where suitable event data exists. Do not calculate product conversion using unrelated store-wide sessions.

Provide links to the public listing and the authorized platform-management page where available.

Keep analytics read-only by default. Publishing, pricing, inventory, and content changes must use existing approved workflows.

### Listing health

Highlight actionable issues such as missing costs, broken synchronization, unavailable variants, incomplete content, unusual refund activity, or strong demand combined with limited stock.

Explain the rule and evidence behind each flag.

Do not invent an authoritative “SEO score” or product-quality rating without a transparent, implemented assessment method.

---

## 8. ANALYTICS MODULES BEYOND LISTINGS

### Sales and order performance

Analyze sales trends, order counts, units, discounts, refunds, average order value, sales mix, and relevant order statuses.

Provide breakdowns by product, variant, collection, channel, market, and period where supported.

Distinguish order placement, payment, fulfillment, cancellation, and refund events. They are not interchangeable reporting dates.

Allow inspection of the supporting records without exposing unnecessary customer information.

### Traffic and conversion

Where event data is available, show acquisition sources, landing pages, device categories, sessions, product engagement, cart activity, checkout activity, and completed purchases.

Define whether a funnel is session-based, user-based, or event-based.

Do not mix incompatible counts into a funnel that appears precise but cannot be interpreted.

Identify missing tracking and coverage gaps. A consent or integration limitation should not be disguised as a collapse in customer activity.

### Customers and retention

Provide new and returning customer analysis, repeat purchase behavior, purchase frequency, cohort retention, geography at an appropriate level, and useful customer segments.

Distinguish observed customer revenue from predicted lifetime value.

Account for incomplete history. A customer first appearing in a limited data import is not necessarily genuinely new to the business.

Use consistent identity rules and explain limitations around guest checkout or unidentified visitors.

### Marketing effectiveness

Where connected, show advertising spend, attributed results, campaign performance, and relevant channel comparisons.

Preserve each platform’s attribution model, window, reporting basis, and currency.

Do not add together every advertising platform’s attributed revenue and present the total as unique store revenue.

Separate platform-reported attribution from recorded store outcomes and any explicitly modeled attribution.

### Profitability and costs

Provide a transparent view of revenue, product costs, fulfillment and shipping costs, payment or marketplace fees, refunds, advertising spend, and other supported costs.

Distinguish gross profit, contribution before advertising, contribution after advertising, and net profit.

Do not call a partial calculation “net profit” when overhead or other material expenses are absent.

Show cost coverage and distinguish actual costs from assumptions.

### Inventory and fulfillment

Where supported, include stock availability, inventory movement, potential stockouts, slow-moving inventory, fulfillment time, delivery performance, and return patterns.

Treat inventory as a point-in-time measurement. Do not add daily stock snapshots together as though they were sales.

Forecasts and days-of-stock estimates should disclose their assumptions and history requirements.

Avoid presenting supplier inventory as guaranteed available stock when the source is stale or only periodically updated.

---

## 9. METRIC DEFINITIONS AND CALCULATION ACCURACY

Create or extend a shared metric-definition layer. Do not implement slightly different formulas separately in cards, charts, exports, and agent tools.

For every important metric, document its source, formula, grain, filters, currency, timezone, date basis, exclusions, and treatment of refunds or cancellations.

### Required calculation rules

| Area | Requirement |
|---|---|
| **Sales** | Clearly separate merchandise sales, discounts, merchandise refunds, shipping revenue, taxes, and other adjustments. Avoid subtracting refunds twice from already-net source values. |
| **Orders** | Count distinct eligible canonical orders, not order lines, fulfillment records, or duplicated channel copies. |
| **Average order value** | Use a defined revenue numerator and matching eligible order cohort. State whether subsequent refunds affect the measure. |
| **Conversion** | Use a documented numerator and denominator from compatible tracking data. Do not silently substitute orders for purchasing sessions. |
| **Margins and ratios** | Recalculate from aggregate numerators and denominators rather than averaging row-level percentages. |
| **Advertising return** | Keep attributed revenue and spend aligned to the same source, window, and reporting context. |
| **Profitability** | Use matched costs and explicit coverage. Missing cost values must not become zero. |
| **Comparisons** | Handle zero baselines, partial periods, and percentage-point versus percentage changes correctly. |

### Refund and cost timing

Define how later refunds affect reporting.

An event-date view and an original-order-cohort view can both be useful, but they answer different questions. Label them clearly and reconcile them.

Preserve applicable historical costs where possible. Changing a product’s current supplier cost must not silently rewrite every past order’s profitability.

Account for partial refunds, refunded shipping, returned inventory, and unrecovered fulfillment costs according to documented rules.

### Currency handling

Preserve original transaction currencies and distinguish them from the reporting currency.

Never add mixed-currency amounts directly.

Where conversion is used, preserve the rate source and conversion date policy. Historical results should not change unpredictably because today’s exchange rate changed.

### Reconciliation

Provide a way to compare dashboard totals with authoritative source reports under matching definitions and periods.

When totals differ, surface the reason—such as timing, exclusions, currency treatment, or incomplete synchronization—rather than hiding the discrepancy.

---

## 10. ACTIONABLE INSIGHTS AND AI AGENT INTEGRATION

Integrate the existing AI Agents and Knowledge Base systems.

Add an **Ask About This Store** or **Analyze This View** action that carries the selected store, period, filters, metric definitions, and relevant data references into an authorized analytics conversation.

The agent should use actual analytics tools and scoped records, not guess from a screenshot or rely only on generic business advice.

### Useful investigations

Support questions such as:

> Why did net sales decline compared with the previous period?

> Which active listings have strong demand but weak contribution?

> Which products are generating a disproportionate share of refunds?

> What should we investigate before increasing advertising spend?

### Evidence-based findings

Each insight should explain what changed, the supporting measurements, affected products or segments, important limitations, and a practical next step.

Distinguish observed contributors from proposed explanations.

A product accounting for most of a sales decline is an observed contribution. Claiming that its creative caused the decline requires additional evidence.

Do not invent confidence scores or present correlations as verified causes.

### Handoffs and learning

Allow findings to become an agent task, investigation, experiment, or Knowledge Base entry through existing workflows.

Save useful evidence-linked lessons with their store, period, filters, and limitations.

Do not automatically promote one store’s result into universal business knowledge.

Agents may recommend actions, but spending money, publishing changes, contacting customers, or modifying live listings must remain subject to permissions and approval.

---

## 11. ADDITIONAL TOOLS THAT IMPROVE DAILY WORKFLOW

### Saved views and comparisons

Allow personal or authorized shared views with saved filters, table columns, selected metrics, and layout preferences.

Support product and variant comparisons using consistent periods, currencies, and definitions.

Do not apply irrelevant filters silently when switching between views.

### Anomaly detection and watchlists

Monitor meaningful changes such as unusual sales movement, rising refunds, stock risk, synchronization failure, or configured profitability thresholds.

Use sensible minimum sample requirements and account for seasonality, promotions, incomplete periods, and data outages where possible.

An ingestion failure should generate a data-health warning—not an unsupported “sales collapsed” business alert.

Provide deduplication, cooldowns, and configurable notification preferences.

### Annotations and experiments

Let me annotate promotions, price changes, launches, stockouts, website changes, and campaign tests on relevant charts.

Keep annotations connected to the correct store and time range.

Annotations provide context; they do not automatically prove causation.

### Reports and exports

Provide exports of filtered tables and supported summary reports.

Include the selected store, period, filters, currency, metric definitions, and data freshness so the export is interpretable outside the application.

Where scheduling infrastructure exists, support approved recurring summaries with real persisted jobs and delivery settings.

Do not claim a report is scheduled unless an actual job exists.

### Goals and forecasts

Support optional targets and goal comparisons.

Keep targets separate from forecasts and forecasts separate from actual results.

Only offer forecasts when sufficient history and a defensible method exist. Display uncertainty and known limitations instead of drawing an unsupported upward line.

---

## 12. BACKEND ARCHITECTURE AND DATA PIPELINES

Reuse the existing application stack and infrastructure wherever practical.

Build a clear analytics layer rather than fetching unrelated provider responses directly into individual interface components.

### Data model

Maintain appropriate records for stores, channels, products, variants, listings, orders, order lines, adjustments, refunds, customers, inventory snapshots, fulfillment events, marketing performance, costs, and synchronization runs.

Preserve source identifiers and relationships.

Keep store-specific evaluations, notes, and agent findings isolated even when catalog products share common references.

### Processing pipeline

Implement a recoverable flow:

**Retrieve → Validate → Normalize → Deduplicate → Reconcile → Aggregate → Serve Analytics → Generate Supported Insights**

Support incremental synchronization, historical backfills, pagination, bounded retries, checkpoints, and rate limits.

Use webhooks where supported, but include reconciliation rather than assuming every event will arrive once and in order.

Handle late updates, deletions, refunds, schema changes, and interrupted jobs.

### Prevent aggregation errors

Protect against join multiplication between orders, line items, refunds, fulfillment records, and advertising data.

Do not allocate campaign spend to products without an explicit method. Keep unmatched or unallocated amounts visible.

Use efficient server-side filtering and aggregation. Introduce precomputed summaries or materialized views where justified by the actual workload.

### Reproducibility and persistence

Preserve metric-definition versions and sufficient context to reproduce reports and agent findings.

Persist views, alerts, annotations, research links, and report jobs.

Make reprocessing idempotent so retries do not create duplicate orders, refunds, insights, or notifications.

---

## 13. SECURITY, PRIVACY, AND ACTION CONTROLS

Enforce authorization and store scope in every query, export, background job, cache key, and agent tool.

Interface filters alone are not a security boundary.

Keep credentials out of client responses, logs, reports, and agent prompts.

Minimize exposure of personal customer information. Most analytics should work with aggregated or appropriately restricted records.

Treat product descriptions, customer-provided text, imported files, and external content as untrusted input.

Protect exports against unsafe content and ensure generated download links follow the application’s access rules.

Separate read-only analytics from operational writes. Any live-store action must use an authorized, auditable workflow.

---

## 14. PERFORMANCE AND USER EXPERIENCE

The page must remain responsive with large product catalogs, substantial order history, and multiple connected sources.

Use server-side pagination, efficient queries, appropriate caching, progressive loading, and cancellation of obsolete interface requests.

Do not make every page visit trigger a full external resynchronization.

Charts should have readable labels, meaningful units, useful tooltips, and accessible alternatives. Do not rely only on color to communicate performance.

Preserve filter state and navigation context when moving between the overview, a product detail, a source record, and an agent conversation.

Design explicit states for no activity, no matching results, partial history, stale data, unsupported metrics, permission restrictions, and failed synchronization.

A slow provider should not prevent unrelated sections from loading.

---

## 15. TESTING AND ACCEPTANCE REQUIREMENTS

“Smoke-proof” means thoroughly verified against defined workflows and edge cases—not a claim that software can never fail.

Run applicable build checks, type checks, linting, unit tests, integration tests, end-to-end tests, and data-reconciliation checks.

| Area | Required verification |
|---|---|
| **Store selection** | The correct store’s data loads, stale responses cannot replace it, and unauthorized cross-store access is rejected. |
| **Live data** | A genuine source-to-database-to-interface path is verified and carries accurate freshness information. |
| **Listings completeness** | All eligible listings can be reached across pagination, including variants and channel-specific states. |
| **Metric consistency** | Cards, charts, drilldowns, exports, and agent tools use matching definitions. |
| **Transaction handling** | Partial refunds, cancellations, late updates, duplicate channel orders, and test orders follow documented rules. |
| **Cost and currency handling** | Missing costs, historical costs, mixed currencies, and unallocated spend cannot create misleading profits. |
| **Filters and comparisons** | Periods, timezones, scope, zero baselines, and partial-period comparisons behave correctly. |
| **Data failures** | Disconnections, rate limits, stale sources, and interrupted jobs produce recoverable states without fabricated fallback values. |
| **AI insights** | Agents use scoped evidence, link supporting records, and preserve uncertainty. |
| **Persistence** | Saved views, annotations, jobs, and findings survive navigation and supported restarts. |
| **Permissions and exports** | Restricted records and credentials cannot leak through downloads, caches, or agent tools. |
| **Scale and usability** | Large catalogs, long histories, smaller screens, and keyboard navigation remain usable. |

Create controlled fixtures for edge cases, but distinguish mocked tests from verified live integrations.

Do not spend advertising money, publish listings, or modify live customer orders merely to test analytics.

After fixing a defect, rerun the relevant checks.

---

## 16. IMPLEMENTATION PLAN AND DEFINITION OF DONE

After design approval, have the **Store Analytics** worker proceed through coherent increments:

**Source and metric audit → Approved interface → Verified ingestion → Store overview → Complete listings workspace → Detailed analytics modules → Agent integration → Reports and alerts → Hardening and reconciliation**

Verify a real source-to-screen workflow early. Do not postpone data integration until after every interface screen has been built.

When a dependency is blocked, investigate supported alternatives and continue independent work. Do not fabricate data, bypass access restrictions, or quietly remove the requirement.

The feature is complete when the approved design is implemented, core data paths work, calculations reconcile under documented definitions, all active listings are accessible, store isolation is enforced, and relevant tests pass.

No essential action should be a dead button. No demonstration metric should appear as production evidence. No unavailable integration should be represented as complete.

The final implementation report should identify what was built, which sources work, which workflows were tested live, calculation and reconciliation results, screenshots, and remaining limitations.

Do not automatically merge, publish, or deploy beyond the authorization already granted.

---

## FIRST ACTION

**Inspect the existing application and available data, then create four distinct Store Analytics design concepts on one comparison artboard. Stop for my selection.**

After approval, create the Orca workspace, launch the Claude development worker named **Store Analytics**, and implement the selected direction through integration, testing, and repair.

**The finished page should let me select a store, understand its performance, inspect every active listing, investigate the causes of important changes, and move from reliable evidence to useful action—all within Frontline Ecom.**
