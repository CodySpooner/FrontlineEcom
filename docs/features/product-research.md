<!-- The owner's spec for the Product Research page, pasted 2026-10-28, kept verbatim. The owner chose design concept A (Product Discovery Workspace) on 2026-10-28. How it is built in this repo: docs/backlog/product-research.md. -->

# FRONTLINE ECOM — PRODUCT RESEARCH PAGE REDESIGN & FULL-STACK IMPLEMENTATION

## 1. READ FIRST: REQUIRED WORKFLOW

I want to completely revamp the **Product Research** page in my existing application.

This is not just a visual redesign. It needs to become a functioning product-discovery and research workspace that pulls real data, identifies relevant dropshipping opportunities, and connects directly with my stores, AI agents, and Knowledge Base.

**Follow this sequence. Do not skip the design-approval stage.**

### Stage One — Inspect the existing application

Review the current Product Research page, application architecture, store management, AI Agents system, Knowledge Base, integrations, database, and design system.

Identify what already works, what should be reused, and what is missing. Preserve existing functionality and user data.

Perform an initial source-feasibility review so the concepts reflect realistically obtainable data. Do not design around invented metrics or assumed integrations.

### Stage Two — Create four design concepts

Create **four genuinely distinct, polished design concepts** and place them together on one comparison artboard.

These must be actual visual concepts—not written descriptions or four slightly different versions of the same layout.

Use the same representative products and research scenario across all four concepts so I can compare them fairly. Clearly label any demonstration data.

### Stage Three — Stop for my approval

Present the artboard and let me choose a direction or request a combination.

**Do not choose for me, replace the production page, or launch the implementation worker before I approve the design.**

### Stage Four — Create the implementation workspace

After approval, create a dedicated Orca workspace and launch a Claude development agent/worker named exactly:

**Product Research**

Verify the available Orca installation and supported workspace controls first. Do not invent commands or claim that a worker is running when it is not.

This is the **development worker building the feature**, not one of the product-research agents operating inside the application.

### Stage Five — Implement, verify, and repair

Have the worker continue through the approved scope, including backend functionality, integrations, interface implementation, testing, and defect repair.

Maintain a completion checklist and recoverable checkpoints. Do not stop because the interface looks finished while the data pipeline or agent workflow remains incomplete.

Continuous work must operate within the actual runtime, permissions, and execution limits. Do not promise indefinite background execution or use uncontrolled retry loops.

---

## 2. PRODUCT VISION

Build a complete product-research workspace that helps me answer:

**What products are gaining attention, which ones fit my stores, can I actually source and fulfill them, and which ones deserve further research or testing?**

The primary workflow should be:

**Discover → Inspect → Assign to a Store → Research with an Agent → Compare → Shortlist → Test → Record Results**

Support two equally important entry points:

**Automatic discovery:** The application retrieves real product listings and available demand signals, organizes them, and surfaces relevant opportunities.

**Manual research:** I provide a product link, choose a store, select an existing Product Research agent or create a new one, and submit my own instructions.

Both paths should produce persistent, inspectable research—not information that disappears when a chat ends.

**Do not build a static product gallery with an AI chat window attached. Build an integrated research workflow.**

---

## 3. DESIGN DIRECTION AND FOUR CONCEPTS

Make the page clean, distinctive, professional, and highly organized.

Preserve Frontline Ecom’s established visual identity and application shell. Use strong typography, restrained accents, clear spacing, and practical information hierarchy.

Avoid game-like interfaces, character portraits, decorative score meters, excessive glow, and unnecessary dashboard clutter.

Product imagery should help identify products. Evidence, research status, and useful actions should drive the experience.

Explore these four directions:

| Concept | Direction |
|---|---|
| **A — Product Discovery Workspace** | An organized product grid with strong filters, a store selector, and an expandable research detail panel. |
| **B — Research Terminal** | A data-focused table with compact product previews, sortable metrics, comparison tools, and a persistent research panel. |
| **C — Opportunity Pipeline** | A workflow-centered layout organizing products from discovery through research, shortlisting, sampling, and testing. |
| **D — Store Intelligence Hub** | A store-first experience emphasizing niche relevance, agent recommendations, watchlists, and active research. |

All four concepts must support the same core functionality. Their differences should involve layout, hierarchy, and interaction—not merely color.

The artboard should include four clearly labeled, readable frames, with a way to inspect each at full size. Show the product feed, filters, product details, manual submission flow, agent selection, and research progress.

Include a brief explanation of each concept’s strengths and tradeoffs.

Any preview code must remain isolated from the production page until approval.

---

## 4. REAL DATA SOURCING — A CORE REQUIREMENT

The page must populate from genuine sources.

Do not use hardcoded products, generated sales figures, fabricated trend charts, or simulated integrations in production.

### Separate three different questions

**Product discovery:** What products exist?

**Demand evidence:** What indicates that people are searching for, engaging with, advertising, or purchasing them?

**Fulfillment viability:** Is there a suitable supplier offering the correct product and variant for the intended destination?

Do not treat a supplier catalog listing as proof that a product is trending. Do not treat a viral video as proof that the product can be dropshipped profitably.

### Investigate these source families

These are starting points to evaluate—not a promise that every platform exposes unrestricted programmatic access.

| Source family | Investigation direction |
|---|---|
| **CJdropshipping** | Its official documentation describes product discovery, product details, variants, and inventory retrieval. Evaluate these capabilities as a supplier-data foundation, then separately verify available popularity signals and fulfillment information. [CJdropshipping Developers](https://developers.cjdropshipping.com/en/api/start/Products-Synchronization-Processing.html) |
| **AliExpress** | Its published dropshipping onboarding describes authorization and access requirements. Verify the current developer path, account eligibility, permitted endpoints, and accessible product information before committing to an integration. [Alibaba Developer](https://developer.alibaba.com/docs/doc.htm?articleId=120418\&docType=1\&treeId=762\&utm_source=chatgpt.com) |
| **TikTok product and advertising intelligence** | TikTok describes Top Products as highlighting trending products featured in TikTok ads. Investigate current availability and permitted access, and preserve the distinction between advertising signals and verified product sales. [TikTok For Business](https://ads.tiktok.com/business/creativecenter/quicktok/online/tiktok_creative_accelerator/pc/en?utm_source=chatgpt.com) |
| **Google Trends** | Google’s documentation describes search-interest data rather than absolute search counts. Evaluate it as supporting demand evidence, verify current access options, and do not reinterpret search interest as units sold. [Google for Developers](https://developers.google.com/search/blog/2025/07/trends-api) |
| **Supplier-provided feeds and other sourcing platforms** | Syncee documents supplier-file ingestion and support-assisted API/SOAP connections. Investigate authorized supplier feeds as another route, without assuming a platform’s ingestion features grant access to its entire marketplace. [Syncee Help Center](https://help.syncee.com/en/articles/8957806-how-to-import-products-by-using-the-syncee-datafeed-manager) |

Research additional dropshipping suppliers, regional fulfillment providers, and licensed product-intelligence services where useful.

Do not limit the architecture to CJdropshipping.

### Produce a source-feasibility matrix

For each serious candidate, record the obtainable fields, access method, authentication requirements, cost, quotas, geographic coverage, update frequency, usage restrictions, and implementation status.

Distinguish between:

**Verified live integration**, **credentials required**, **approval required**, **authorized import**, **manual research only**, and **unsupported**.

Prioritize a functioning supplier-data path and a functioning demand-signal path. Build additional connectors through the same architecture rather than separate one-off implementations.

---

## 5. HANDLE ROADBLOCKS WITHOUT ABANDONING THE FEATURE

I expect resourcefulness. One unavailable API must not bring the entire project to a stop.

When a source is blocked, investigate the actual cause and evaluate permitted alternatives: another official endpoint, an authorized export, a licensed feed, a different supplier, or another evidence source.

Continue implementing independent parts of the system while documenting the blocked dependency.

Use bounded retries, backoff, caching, and recoverable jobs. Do not repeatedly retry a permanently unauthorized request.

**Persistence does not mean bypassing authentication, paywalls, CAPTCHAs, access restrictions, or licensing requirements. It also does not mean fabricating data to make the page look complete.**

A manual import can be a useful fallback, but it must be labeled as an import—not presented as a live integration.

Where access requires credentials, payment, or approval, identify the exact requirement. Do not subscribe to services or spend money without authorization.

Do not declare the real-data requirement complete until an actual authorized source-to-interface workflow has been verified.

---

## 6. PRODUCT ELIGIBILITY AND DROPSHIPPING VIABILITY

Focus discovery on products suitable for my ecommerce businesses—not popular items from major consumer brands that I cannot realistically source or sell.

Default toward generic, unbranded, or appropriately available private-label opportunities.

Exclude or flag recognizable branded merchandise, suspected counterfeits, unauthorized logo products, restricted items, and products needing additional compliance review.

Do not assume that an unbranded listing is automatically free of intellectual-property or safety concerns.

### Verify the actual supplier offer

Evaluate the specific product, variant, supplier, destination, quantity, and shipping method.

Capture available evidence for product cost, stock, minimum order quantity, processing time, shipping estimate, fulfillment restrictions, returns, and relevant specifications.

An inexpensive headline price must not conceal an unavailable variant or substantial shipping cost.

Use clear statuses such as:

**Fulfillment verified for selected conditions**, **supplier found—verification pending**, **insufficient information**, or **not eligible**.

Include the verification date and conditions. Do not present one country’s shipping quote as globally applicable.

For generic accessories, distinguish compatibility references from actual branded merchandise. Verify fitment or compatibility where relevant rather than relying on the listing title.

---

## 7. LIVE DISCOVERY EXPERIENCE

The page should fill with genuine products through ingestion and refresh jobs—not expensive external calls triggered every time the interface renders.

Provide an overall discovery view and a store-specific view that applies the selected store’s niche, audience, price range, and sourcing preferences.

### Product cards and table rows

Show the product name and image, source, relevant category, supplier availability, available price information, trend evidence, store relevance, research status, and last-updated time.

Keep the initial view readable. Move detailed evidence and additional metrics into the product panel.

Every number must identify what it measures and where it came from.

**Unknown is not zero. An estimate is not a measurement. A supplier claim is not independently verified evidence.**

### Filters and sorting

Support search and useful filters for niche, category, supplier, destination country, warehouse location, cost, shipping estimate, evidence freshness, research status, and store fit.

Offer meaningful sorting, such as recently discovered, strongest available momentum, best store fit, and lowest verified landed cost.

Filtering and sorting must apply to the full matching dataset—not only the currently loaded page.

### Trend handling

Preserve the platform, region, observation period, underlying metric, and source for each trend signal.

Distinguish sustained interest, recent acceleration, seasonality, isolated spikes, and insufficient history where evidence supports those classifications.

Do not fabricate historical observations to draw a chart. Do not convert a category-level signal into an exact-product sales claim.

Keep catalog availability and trend qualification separate so the interface can honestly show “newly discovered” products without calling all of them “trending.”

---

## 8. MANUAL PRODUCT → STORE → AGENT WORKFLOW

Add a prominent **Research a Product** action.

The flow should be:

**Paste Product Link → Select Store → Select or Create Product Research Agent → Enter Instructions → Start Research**

### Product input

Accept a supported product URL and retrieve an inspectable preview where access is available.

Show the extracted product title, image, source, and relevant details. Let me correct the preview or add notes before submission.

Preserve the original source reference. Handle redirects, unavailable listings, unsupported pages, and ambiguous products clearly.

A blocked preview should not silently become a successful extraction. Allow me to provide additional product information while retaining its user-provided status.

### Store selection

Use the application’s actual store list.

Selecting a store should load its eligible Product Research agents and relevant business context.

Changing the store must clear any incompatible agent selection. Validate the store-agent relationship again in the backend.

### Existing agents

Show all eligible active Product Research agents for the selected store, with their names, runtime/model information, and actual availability.

Distinguish an enabled agent from an agent currently executing a task.

When an agent is busy, support a deliberate queue or supported separate run. Do not overwrite its current objective or silently inject the product into unrelated work.

### New agents

Provide **Create New Product Research Agent** directly in this flow.

Reuse the existing AI Agents deployment components, supported runtime/model/effort controls, permissions, and persistence.

Do not build a second agent registry.

### Custom instructions

Provide a substantial prompt field with optional starter templates.

For example:

> Evaluate this product for the selected store. Investigate demand, competitors, supplier options, delivery expectations, realistic unit economics, and potential advertising angles. Explain whether it deserves a test and what remains uncertain.

Preserve my exact submitted instructions alongside the product, store, agent, and task identifiers.

### Submission and tracking

Create a durable research task and show its real status.

Provide access to both the product’s research record and the corresponding conversation in **AI Agents**.

The task must remain associated with its original store even when I navigate elsewhere.

---

## 9. PRODUCT DETAILS AND RESEARCH DELIVERABLES

Each product needs a persistent detail page or panel that brings together its evidence, offers, research, and decisions.

Organize it around **Overview, Demand, Suppliers, Economics, Research, and History**, or an equally clear structure.

Agent research should address the product’s purpose, customer problem, store fit, supporting demand evidence, competitors, available supplier offers, practical risks, and recommended next steps.

Advertising angles and differentiation ideas should be labeled as proposals—not evidence of likely performance.

### Research conclusions

Use actionable recommendations such as:

**Research further**, **request a sample**, **shortlist for testing**, **monitor**, or **reject**.

Explain the reasoning, supporting evidence, unresolved questions, and conditions that would change the recommendation.

Avoid “guaranteed winner” language and unsupported sales projections.

Keep previous research runs and conclusions accessible. A new report should not erase the evidence behind an earlier decision.

---

## 10. HIGH-VALUE TOOLS TO INCLUDE

Build useful tools around the core workflow without turning the page into a collection of disconnected widgets.

### Product comparison

Allow side-by-side comparison of several products using consistent destination, currency, date, and cost assumptions.

Compare demand evidence, supplier options, shipping, store fit, risks, and estimated economics. Make missing fields visible.

### Supplier matching and comparison

Find potential alternative suppliers and compare their offers.

Distinguish an exact match from a similar-looking alternative. Check specifications, variants, dimensions, materials, and compatibility where available.

Do not declare two products identical solely because their images resemble each other.

### Unit-economics calculator

Provide editable assumptions for selling price, discounts, supplier cost, shipping, duties, transaction fees, expected returns, other variable costs, and advertising cost.

For a clearly defined scenario:

**Expected contribution before advertising = expected net revenue − non-advertising variable costs.**

**Expected contribution after advertising = expected contribution before advertising − advertising cost.**

**Break-even acquisition cost per order = expected contribution before advertising**, within the stated per-order model.

Calculate break-even ROAS only when the contribution is positive and the revenue definition is consistent.

Show conservative, base, and optimistic scenarios. Separate verified inputs from assumptions, avoid double-counting refunds, and identify omitted fixed costs.

Missing shipping or supplier costs must not silently become zero.

### Watchlists and alerts

Allow products, niches, and supplier offers to be watched for relevant changes such as availability, price, new evidence, or shipping conditions.

Use real scheduled jobs with explicit limits and notification preferences. Show the last successful check and explain degraded coverage.

### Explainable opportunity assessment

Evaluate store fit, demand evidence, fulfillment viability, economics, differentiation, and risk separately.

An optional combined score must expose its inputs and weighting. Keep evidence confidence separate from product attractiveness.

Do not present a heuristic score as a probability of commercial success.

### Research and testing pipeline

Support stages such as:

**Discovered → Researching → Shortlisted → Sample Review → Ready to Test → Testing → Scaled / Rejected**

Keep these business stages separate from execution states such as queued, running, failed, or cancelled.

Store notes, owners, decision reasons, and linked experiments.

### Existing-product and duplicate checks

Identify products already in the selected store and potential duplicates across supplier listings.

Allow users to confirm, merge, or separate uncertain matches without losing original sources.

### Test-brief and draft handoffs

Create a structured testing brief containing the target customer, offer hypothesis, creative concepts, measurement plan, budget assumptions, and decision criteria.

Where supported, prepare a draft product or handoff to the relevant application module.

Do not automatically publish products, order samples, launch advertisements, or spend money.

---

## 11. AI AGENTS AND KNOWLEDGE BASE INTEGRATION

Product Research must use the existing agent and knowledge infrastructure.

Before researching, an agent should retrieve relevant general knowledge, store-specific niche research, brand guidance, customer insights, previous product decisions, and available performance lessons.

Keep retrieval focused on the task. Do not load every knowledge record or access another store’s private information.

### Persistent learning

Save useful sourced findings through the existing Knowledge Base ingestion process.

Preserve evidence, limitations, business scope, classification, and revision history. Check for duplicates before adding records.

Separate general reusable findings from store-specific decisions.

A generated recommendation must not automatically become a validated fact.

### Collaboration and handoffs

Allow a Product Research agent to request help from existing specialized agents where supported—for example, an Ad Strategist for positioning or an Analytics Specialist for a test-measurement plan.

Use the application’s actual collaboration system. Do not simulate several agents through one response.

Preserve assignments, permissions, outputs, and the final consolidated result.

---

## 12. LEARN FROM ACTUAL PRODUCT OUTCOMES

Connect product decisions to subsequent outcomes where genuine store and advertising data is available.

Track whether a shortlisted product was sampled, listed, tested, rejected, or scaled, and link the relevant results.

Compare initial assumptions with observed outcomes: supplier quality, delivery experience, conversion, returns, customer feedback, and contribution after advertising.

Do not conclude that the product alone caused success or failure. Preserve context such as offer, audience, creative, spend, inventory, and measurement period.

Feed supported lessons into the selected store’s Knowledge Base.

The system should improve the evidence available for future decisions—not retroactively rewrite the original research to appear correct.

---

## 13. BACKEND AND DATA ARCHITECTURE

Inspect and reuse the application’s existing stack.

Maintain clear separation between the underlying product, individual source listings, variants, supplier offers, trend observations, store-specific evaluations, research tasks, agent runs, and testing outcomes.

A shared product record must not make private store notes or research visible across businesses.

### Source pipeline

Implement a recoverable pipeline:

**Retrieve → Validate → Normalize → Match/Deduplicate → Store Evidence → Evaluate Eligibility → Enrich → Rank → Display**

Store source identifiers, observation dates, retrieval timestamps, currencies, geographic scope, and transformation history.

Preserve source material only to the extent permitted. Retain traceable references even where full content cannot be stored.

### Connector design

Use consistent source adapters with declared capabilities. Not every connector will expose the same fields or support the same refresh frequency.

Support pagination, checkpoints, rate limits, bounded retries, partial failures, caching, and schema-change detection.

Keep a source-health view showing connection status, last successful sync, errors, and stale coverage.

### Persistence

Products, submissions, prompts, agent assignments, research outputs, watchlists, comparisons, decisions, and histories must survive navigation and supported restarts.

Use idempotent writes so retries do not create duplicate products, duplicate agent runs, or repeated downstream actions.

---

## 14. SECURITY AND OPERATIONAL CONTROLS

Enforce authentication and store-level permissions in the backend.

Keep provider credentials out of browser-visible state, prompts, and logs.

Validate product URLs and protect source fetching against internal-network access, unsafe redirects, oversized responses, malicious files, and unsafe rendered content.

Treat webpage text, supplier descriptions, and retrieved documents as untrusted research material—not instructions that can override agent behavior.

Apply budgets and concurrency limits to ingestion, enrichment, research, and monitoring.

Require appropriate approval for paid services, purchases, live-store changes, publication, and advertising actions.

Use isolated test environments and fixtures where possible. Do not make destructive production changes merely to prove the workflow.

---

## 15. USABILITY AND PERFORMANCE

Keep the page responsive with large catalogs and multiple active research tasks.

Use appropriate pagination or virtualization, server-side filtering, efficient image loading, and progressive detail loading.

Persist useful filters, table settings, selected views, and unsent research drafts.

Provide accessible keyboard navigation, readable contrast, visible focus states, and responsive panel behavior.

Design distinct states for first use, no matching products, disconnected sources, stale data, partial outages, unavailable metrics, and failed research.

**An empty result, an unavailable source, and a failed request are different conditions. Explain them differently.**

Keep advanced evidence and configuration available without overwhelming everyday product discovery.

---

## 16. IMPLEMENTATION PLAN AND TESTING

After design approval, build in tested increments:

**Verified data foundation → Product discovery → Product details → Store/agent submission → Research persistence → Comparison and economics → Watchlists and pipeline → Knowledge feedback → Hardening.**

Confirm an actual source-to-database-to-interface path early. Do not postpone real integration work until after the entire interface is built.

### Required verification

| Area | Acceptance requirement |
|---|---|
| **Real ingestion** | An authorized source returns genuine data that is persisted and displayed with accurate provenance. |
| **Demand evidence** | Trend labels and charts are supported by actual observations; catalog presence alone does not qualify. |
| **Source failures** | Authentication failures, rate limits, timeouts, and schema changes produce recoverable states without fabricated fallback data. |
| **Manual submission** | A product link, selected store, eligible agent, and custom prompt create the correct durable task. |
| **Busy agents** | Queued or parallel work behaves explicitly and does not overwrite an existing objective. |
| **Store isolation** | Unauthorized agent selection, product notes, research, and knowledge access are rejected in the backend. |
| **Research results** | The agent uses available tools and knowledge, saves its output, and links to the correct product and conversation. |
| **Deduplication** | Repeated URLs and listings are handled without incorrectly merging different variants or similar products. |
| **Economics** | Calculations handle missing costs, currencies, nonpositive contribution, and scenario changes correctly. |
| **Watchlists** | Actual scheduled checks persist their results, respect budgets, and avoid duplicate alerts. |
| **Persistence** | Navigation, reloads, and supported restarts preserve records and accurately restore task status. |
| **Usability** | Large datasets, long titles, missing images, smaller windows, and keyboard navigation remain usable. |

Run the relevant build, type checks, linting, unit tests, integration tests, and end-to-end smoke tests.

Mocks are appropriate for controlled tests, but they are not proof that a live integration works. Identify which paths were verified against real services.

After fixing a failure, rerun the relevant checks.

“Smoke-proof” means thoroughly tested against defined workflows—not a claim that the software can never fail.

---

## 17. DEFINITION OF DONE

Do not mark the feature complete merely because all screens exist.

Completion requires the approved design, a verified real-data discovery path, meaningful demand evidence, functioning product-to-agent submission, persistent research results, store isolation, working core tools, and passing relevant checks.

No essential action should be a dead button. No unavailable integration should appear connected. No demonstration metric should appear as production evidence.

Where external access blocks a requirement, report the implementation status and the exact unverified portion. Continue completing independent work, but do not quietly downgrade the requirement or claim full completion.

The final report should include what was implemented, which sources work, which workflows were tested live, test results, interface screenshots, and remaining limitations.

---

## FIRST ACTION

**Inspect the existing application and present four distinct Product Research design concepts on one comparison artboard. Then stop for my selection.**

After approval, create the Orca workspace, launch the Claude development worker named **Product Research**, and implement the selected direction through testing and repair.

**The finished feature should help me discover genuinely relevant products, verify sourcing conditions, send products to the correct store’s agents, inspect the evidence, compare opportunities, and move promising products into a controlled testing workflow—all within the existing application.**
