# FEATURE DEVELOPMENT PROMPT: ADVANCED AI KNOWLEDGE BASE & RESEARCH INTELLIGENCE SYSTEM

> Owner's feature spec, verbatim (2026-10-27); only the section headings were made Markdown headings.
> Chosen design (owner, 2026-10-27): **A "Atlas" is the main view, B "Intel Desk" is the Research Center**, see
> `docs/reference/kb-atlas.png` and `docs/reference/kb-research-center.png`. Build lane, decisions and items:
> `docs/backlog/knowledge-base.md`. Repo rules: `CLAUDE.md`.

## 1. PROJECT OBJECTIVE
I want to completely redesign and significantly expand the Knowledge Base feature inside my existing multi-business e-commerce AI application.
This should not be treated as a simple notes application, document library, or basic AI memory system.
I want to build a sophisticated AI-powered business intelligence, autonomous research, and knowledge management system that acts as the collective brain of all my AI agents.
The Knowledge Base should become one of the most important features in the entire application.
It needs to accomplish five fundamental things:

1. Store and organize everything useful my AI agents learn about business, marketing, advertising, analytics, product research, creative strategy, and e-commerce operations.
2. Allow specialized agents to independently research topics, evaluate information, and continuously expand their knowledge.
3. Separate universal business knowledge from specialized knowledge belonging to individual businesses and niches.
4. Automatically learn from real-world performance data, including successful and unsuccessful advertising campaigns, products, strategies, and experiments.
5. Allow every authorized agent throughout the application to retrieve and apply this intelligence when performing tasks.

I want this to feel like a sophisticated AI research operating system built directly into my existing application.
IMPORTANT: This is an enhancement to the existing application, not a request to rebuild it. Inspect the current architecture, navigation, design system, existing agents, integrations, and data structures before implementation. Preserve working features and build this system into the existing workflows.
## 2. COMPLETE VISUAL REDESIGN — INTERACTIVE KNOWLEDGE ARTBOARD
The first major task is redesigning the entire Knowledge Base interface.
I want to move away from a conventional dashboard or basic folder-based notes system.
Instead, the Knowledge Base should have a professional, artboard-inspired interface where information feels interconnected, organized, and visually sophisticated.
Think of a combination of:

* A professional SaaS intelligence dashboard.
* An interactive visual knowledge canvas.
* A structured research workspace.
* A connected knowledge graph.
* A modern AI-powered business research terminal.

The visual approach should be unique and premium, but still extremely practical.
Visual design direction
Keep the existing application's established color scheme and visual identity.
The design should emphasize:

* Dark charcoal and near-black surfaces.
* Clean white and muted gray typography.
* Restrained red accents that match the existing brand.
* Thin, sophisticated borders and subtle shadows.
* Excellent spacing, typography, and visual hierarchy.
* Smooth interactions and subtle animations.
* Professional panels, floating cards, and contextual controls.

Do not make this feature look like a video game. I want a serious, polished SaaS aesthetic.
Main artboard experience
Create a large, interactive canvas where knowledge is displayed as individual text-based cards.
Cards should be grouped into clearly identifiable subject areas while remaining visually connected to related information.
I want capabilities such as:

* Smooth zooming and panning.
* Dragging and positioning knowledge cards.
* Expanding cards to reveal deeper information.
* Collapsing entire knowledge categories.
* Selecting multiple cards.
* Connecting related pieces of knowledge with elegant, subtle lines.
* Following relationships between research findings.
* Quickly searching and filtering visible cards.
* Viewing a minimap of larger knowledge collections.
* Saving canvas positions and layouts.
* Switching between visual artboard and organized list views.

The artboard should be visually impressive without becoming chaotic or difficult to navigate.
Knowledge connections
One important design element is the ability to visually connect knowledge.
For example:
A card about a successful TikTok advertising hook might connect to:

* A research finding explaining why that hook works.
* A customer psychology principle.
* A particular winning advertisement.
* A high-performing creative format.
* An experiment validating the strategy.
* A related marketing principle.

These connections should appear as subtle, professional connecting lines.
Connections must represent meaningful relationships, rather than simply being decorative.
Support relationship types such as:

* Supports
* Contradicts
* Builds Upon
* Derived From
* Validated By
* Applied To
* Related To

Clicking a connection should allow me to understand why the information is linked.
Different viewing modes
Provide three major viewing modes:
Artboard View: The primary visual workspace with text cards, topic clusters, and connected knowledge.
Library View: A traditional, highly organized searchable interface for viewing knowledge by category, relevance, date, confidence, and business.
Relationship View: A deeper knowledge graph showing how strategies, research, business insights, and performance results relate to one another.
These views must share the same underlying knowledge records, not maintain disconnected copies.
## 3. TWO PRIMARY KNOWLEDGE SYSTEMS
The application needs two fundamentally different knowledge environments.
A. GENERAL KNOWLEDGE BASE
The General Knowledge Base is the universal intelligence library for the entire application.
It contains business knowledge that can reasonably be applied across different businesses, industries, stores, and niches.
Examples include:

* Fundamentals of successful advertising.
* Persuasive copywriting principles.
* Consumer psychology.
* Conversion rate optimization.
* Marketing funnel strategies.
* E-commerce financial metrics.
* Creative testing methodologies.
* Product research frameworks.
* Customer retention strategies.
* Pricing psychology.
* SEO fundamentals.
* Analytics methodologies.
* Store design best practices.

This knowledge should be accessible to every authorized agent working across any business.
General Knowledge categories
Create an expandable category system including:

1. Advertising
2. Marketing
3. Creative Strategy
4. Analytics & Data
5. Product Research
6. Conversion Optimization
7. Consumer Psychology
8. Branding
9. SEO
10. E-Commerce Operations
11. Financial & Profitability Analysis
12. Customer Retention
13. Competitor Research
14. Sales & Pricing
15. Business Strategy
16. Automation & AI Workflows

Allow users to create custom categories and subcategories.
Each category should have its own visual cluster within the artboard.
For example, opening Advertising might reveal:

* Creative testing strategies
* Audience targeting
* Advertising psychology
* Campaign optimization
* Scaling strategies
* Budget allocation
* Platform-specific advertising principles
* Attribution and measurement

I should be able to drill deeper into any of these subjects.
B. BUSINESS-SPECIFIC KNOWLEDGE BASES
Each individual business connected to my application needs its own independent Knowledge Base.
For example, if I operate multiple Shopify businesses across completely different niches, each store should have its own specialized intelligence environment.
The business Knowledge Base should contain everything the agents have discovered, analyzed, tested, and learned about that specific business and its market.
Examples of business-specific information

* Niche research and industry trends.
* Target customer demographics.
* Audience interests and behaviors.
* Customer pain points.
* Competitor intelligence.
* Product opportunities.
* Successful advertising angles.
* Historical campaign performance.
* Winning creative formats.
* Product positioning.
* Market seasonality.
* Customer purchase behavior.
* Pricing intelligence.
* Opportunities for expansion.
* Identified market gaps.
* Store-specific conversion issues.
* Lessons from previous experiments.

These findings should be categorized using the same main knowledge categories as the General Knowledge Base.
For example:
Business: Truck Accessories Store
Advertising:

* Top-performing truck accessory ad formats.
* Effective video hooks for truck enthusiasts.
* Platform-specific results for this niche.

Creative:

* Visual styles that resonate with the target audience.
* Effective product demonstration formats.
* Previously successful creative themes.

Product Research:

* Emerging product trends.
* Competitor product opportunities.
* Demand signals.
* Potential underserved customer needs.

Analytics:

* Store conversion patterns.
* Customer purchasing trends.
* Revenue and profitability insights.
* Campaign performance patterns.

Important knowledge separation rules
Business-specific intelligence must remain associated with the correct business.
Agents working on one business should not accidentally use irrelevant information from another business.
However, all business agents should be able to reference the General Knowledge Base.
I also want a feature called Promote to General Knowledge.
If an agent discovers an insight inside one business that appears broadly applicable to other businesses, it should be able to recommend promoting that insight to the General Knowledge Base.
Promotion should remove or generalize sensitive business-specific information and require appropriate approval.
The system must distinguish universal knowledge from niche-specific assumptions.
## 4. KNOWLEDGE CARD SYSTEM
Every important piece of knowledge should be represented by a structured, interactive knowledge card.
These are not just plain text sticky notes.
They should be rich, structured pieces of intelligence.
Knowledge card design
Each card should show a concise preview containing:

* Knowledge title.
* Short summary.
* Knowledge category.
* Associated business or General Knowledge.
* Tags.
* Researching agent.
* Confidence or evidence indicator.
* Date last verified.

Opening a card should display a detailed side panel or expanded view.
Expanded card information
Each complete knowledge record should support:
Title: A clear description of the knowledge.
Summary: The most important takeaway.
Detailed Explanation: The complete research findings and relevant context.
Business Relevance: Why this information matters.
Practical Application: How agents can apply it to actual business tasks.
Evidence: Supporting research, performance data, experiments, or other verifiable information.
Sources: Original URLs and source references.
Confidence: How well the claim is supported, not simply how confident an AI sounds.
Applicability: Which platforms, industries, audiences, or circumstances the insight applies to.
Limitations: Situations where the information may not work.
Related Knowledge: Other connected cards.
Research History: When the information was discovered and updated.
Created By: The agent or user responsible.
Last Verified: When the evidence was last checked.
Knowledge classifications
Create distinct knowledge types:

* Research Finding
* Business Principle
* Strategy
* Hypothesis
* Experiment
* Validated Insight
* Performance Lesson
* Competitor Intelligence
* Customer Insight
* Process / Playbook
* User-Provided Knowledge

An interesting but unproven idea should never automatically be treated as a validated fact.
Cards should visibly distinguish hypotheses, observed patterns, and verified outcomes.
## 5. AUTONOMOUS AI RESEARCH SYSTEM
This is one of the most important elements of the entire feature.
I want the agents to actively research and expand their knowledge rather than only storing information manually entered by me.
The Knowledge Base needs a fully integrated AI Research Engine.
How it should work
For example, I could tell an advertising research agent:
"Research successful TikTok advertising strategies for my truck accessories business."
The agent should then:

1. Identify the scope of the research request.
2. Understand the target business and niche.
3. Review existing knowledge before starting.
4. Develop a research plan.
5. Search the internet for relevant information.
6. Read and analyze accessible sources.
7. Identify useful strategies, evidence, and trends.
8. Compare findings across multiple sources.
9. Determine whether the information is genuinely relevant.
10. Check whether the knowledge already exists.
11. Extract and structure useful findings.
12. Save those findings into the appropriate Knowledge Base.
13. Connect the new findings with existing knowledge.
14. Produce a research summary explaining what was discovered.
15. Suggest practical ways to apply the knowledge to the business.

This must be an actual functioning research workflow backed by available tools and services, not an AI agent merely claiming it conducted research.
Independent research capabilities
Depending on available integrations and accessible sources, agents should be able to research:

* Search engine results.
* Public articles and industry publications.
* Advertising platform documentation.
* E-commerce case studies.
* Public competitor websites.
* Product reviews.
* Public customer discussions.
* Relevant research papers.
* Industry reports.
* Public advertising libraries.
* Accessible video transcripts.
* Publicly available marketing resources.

Agents should prioritize trustworthy, relevant sources over generic low-quality content.
They should avoid creating unsupported conclusions from one unreliable source.
Automatic knowledge extraction
When an agent encounters genuinely useful information, I do not want it to simply read that information and forget it after the task.
It needs to automatically capture useful findings in persistent storage.
Create an extraction process that identifies:

* Useful facts.
* Important strategies.
* Recurring patterns.
* Actionable recommendations.
* Business opportunities.
* Relevant performance benchmarks.
* Warnings and common mistakes.
* Insights that improve existing knowledge.

The system should automatically store meaningful, source-linked findings while classifying unverified findings appropriately.
This is crucial:
Research findings must persist beyond the agent's conversation or execution session.
Research quality control
Not everything on the internet is true or useful.
Create an evaluation process based on:

* Source reliability.
* Evidence quality.
* Relevance to the requested niche.
* Recency.
* Consistency with other sources.
* Practical usefulness.
* Whether findings are new.
* Potential contradictions.
* Applicability to the business.

Low-confidence findings may be stored as provisional research but must never silently become validated business principles.
If sources disagree, preserve those disagreements instead of forcing an artificial conclusion.
## 6. DIRECTED RESEARCH — GIVE AN AGENT A SOURCE
I also want a dedicated interface where I can personally direct agents toward specific research materials.
Call this feature Research From Source.
User experience
I should be able to:

1. Open the research interface.
2. Paste a URL or provide a supported document.
3. Select which agent should research it.
4. Choose whether the findings belong in General Knowledge or a specific business.
5. Optionally describe what I want the agent to investigate.
6. Start the research task.
7. Watch the agent's progress.
8. Review what it discovered.

Agent selection
Allow me to choose from:
General Research Agent: Investigates broadly useful business knowledge.
Specialized Research Agent: Investigates a particular field, such as advertising, marketing, creative strategy, analytics, or product research.
Business/Niche Research Agent: Investigates sources specifically in the context of one selected business and its niche.
The source should not determine the knowledge destination on its own. Respect my selected workspace and permissions.
Example
I provide a link to an article explaining a successful advertising strategy.
The agent should:

* Access and read the available content.
* Extract the important information.
* Identify useful strategies.
* Determine whether the conclusions are supported.
* Compare with existing knowledge where appropriate.
* Create organized knowledge cards.
* Connect the findings to related information.
* Save the source for traceability.
* Explain how the findings might improve my businesses.

I should also be able to provide multiple URLs in one research task.
Support source ingestion for accessible webpages, documents, PDFs, and transcripts where technically and legally available.
Respect source access restrictions, licensing, robots policies, and paywalls. Never pretend to have processed content that was inaccessible.
Research task interface
Create a professional task detail screen showing:

* Agent assigned.
* Source being researched.
* Current processing stage.
* Sources successfully accessed.
* Sources that could not be accessed.
* Findings extracted.
* Existing knowledge updated.
* New knowledge created.
* Conflicts discovered.
* Final research report.

Allow me to stop, retry, or refine research tasks.
## 7. CONTINUOUS & PROACTIVE AGENT LEARNING
I don't want agent learning to occur only when I manually give an instruction.
I want the system to support ongoing, autonomous knowledge discovery using explicit user-approved schedules, triggers, and limits.
Autonomous research behavior
Agents should be able to:

* Identify important gaps in their knowledge.
* Recommend research topics.
* Revisit outdated knowledge.
* Investigate emerging niche trends.
* Monitor approved research sources.
* Research opportunities discovered through analytics.
* Follow up on previously inconclusive research.
* Investigate unsuccessful strategies.
* Expand upon useful discoveries.

Example
If an advertising agent notices that a certain style of creative is repeatedly outperforming alternatives, it could initiate or suggest additional research into why that style performs well.
If a product research agent notices a potentially emerging category, it could investigate demand signals, competitors, pricing, and audience interest.
If existing research becomes outdated, it should flag the information for refreshing.
Autonomous research controls
Provide a control center where I can configure:

* Which agents may research autonomously.
* Which businesses they may investigate.
* Categories they are responsible for.
* Research schedules.
* Trigger conditions.
* Trusted or preferred sources.
* Maximum task budgets.
* Research depth.
* Whether approval is required before starting.
* Whether provisional findings require review.

Allow research agents to operate in parallel when appropriate.
Avoid endless research loops, duplicate work, unnecessary API spending, and unbounded background activity.
Agents should maintain visible task histories and clearly report their work.
## 8. AUTOMATIC LEARNING FROM REAL BUSINESS PERFORMANCE
This is another essential system.
The Knowledge Base cannot rely exclusively on research from the internet.
It also needs to learn from what actually happens inside my businesses.
This includes advertising campaigns, product performance, store analytics, creative testing, conversion behavior, and other relevant operational data.
Advertising performance intelligence
When connected advertising data is available, analyze campaign and creative performance.
Relevant measurements include:

* Advertising spend.
* Revenue attribution.
* Return on Ad Spend (ROAS).
* Click-through rate.
* Cost per click.
* Cost per thousand impressions.
* Cost per acquisition.
* Conversion rate.
* Profitability.
* Creative engagement.
* Performance trends over time.

The system should look for recurring patterns associated with success and failure.
Example: Successful creative
Suppose an advertisement using a particular opening hook performs significantly better than other creatives.
The system should:

1. Identify the performance difference.
2. Evaluate whether there is sufficient evidence.
3. Examine relevant creative characteristics.
4. Compare the advertisement against similar creatives.
5. Analyze possible reasons for its performance.
6. Generate a performance insight.
7. Save the insight to that business's Knowledge Base.
8. Connect it to the relevant advertising and creative strategy cards.
9. Make the learning available to advertising agents for future campaigns.

Example: Underperforming creative
If an advertisement performs poorly, the system should investigate possible explanations.
Perhaps:

* The hook was weak.
* The creative did not demonstrate the product effectively.
* The message did not match the audience.
* The landing page did not convert.
* The campaign targeted an unsuitable audience.
* The offer was not competitive.

These should initially be hypotheses unless there is evidence supporting a specific explanation.
Record the observations and make them available for future testing.
IMPORTANT: Avoid false lessons
Do not automatically conclude that an advertisement succeeded because of one specific creative element.
Consider:

* Sample size.
* Spend level.
* Measurement window.
* Attribution limitations.
* Audience differences.
* Campaign objectives.
* Placement.
* Seasonality.
* Statistical uncertainty.
* Changes occurring at the same time.

A promising pattern should be saved as a hypothesis or observed correlation until stronger evidence validates it.
Campaign intelligence library
Create a searchable history of relevant campaigns and creative experiments.
Each campaign record should connect to:

* Associated business.
* Advertising platform.
* Products promoted.
* Creative assets.
* Ad copy and hooks.
* Target audiences.
* Performance metrics.
* Date range.
* Results.
* Related knowledge cards.
* Insights discovered.
* Recommendations for future testing.

Make it possible to inspect not only what worked, but the evidence behind why agents believe it worked.
## 9. AUTOMATIC BUSINESS LEARNING BEYOND ADVERTISING
Apply the same intelligence-building approach throughout other parts of the application.
Product Research
Learn from:

* Product sales patterns.
* Product conversion rates.
* Customer demand.
* Market trends.
* Competitor products.
* Product testing results.
* Returns and customer complaints.

Creative Strategy
Learn from:

* Successful visuals.
* Effective creative structures.
* Audience engagement.
* Video hooks.
* Product demonstrations.
* Creative testing outcomes.

Marketing
Learn from:

* Successful promotions.
* Customer acquisition strategies.
* Email campaign results.
* Retention performance.
* Landing page effectiveness.
* Customer segmentation.

Analytics
Learn from:

* Revenue patterns.
* Customer behavior.
* Conversion changes.
* Seasonal demand.
* Acquisition performance.
* Profitability trends.
* Operational inefficiencies.

Each analytical discovery should be evaluated for usefulness, saved appropriately, and connected to the underlying supporting data.
Create a reusable system rather than implementing separate, incompatible memory features for every agent.
## 10. SHARED INTELLIGENCE BETWEEN AI AGENTS
One of my biggest priorities is ensuring that knowledge is not trapped inside the agent that discovered it.
Every authorized agent must be capable of benefiting from knowledge discovered by other agents.
Example workflow

1. The Research Agent discovers a promising advertising strategy.
2. The finding is evaluated and saved in the Knowledge Base.
3. The Advertising Agent retrieves that information while planning a campaign.
4. The Creative Agent uses the same insight when preparing an advertisement.
5. The Analytics Agent evaluates the resulting performance.
6. New performance findings are saved back into the Knowledge Base.
7. Future agents use the updated information.

This creates a feedback loop:
Research → Knowledge → Execution → Measurement → Learning → Improved Execution
This feedback loop should be central to the system's architecture.
Intelligent knowledge retrieval
Before executing relevant tasks, agents should be able to retrieve appropriate knowledge.
For example, when I ask an Advertising Agent to create a campaign, it should search:

1. Relevant knowledge belonging to the selected business.
2. Relevant general advertising knowledge.
3. Historical campaign and performance lessons.
4. Related creative research.
5. Previous experiments and applicable recommendations.

It should use this retrieved context when performing the task.
Knowledge relevance
Agents should not load the entire Knowledge Base into every conversation.
Build intelligent retrieval using semantic search, structured filters, and relevance ranking.
Prioritize information based on:

* Task relevance.
* Business context.
* Category.
* Evidence strength.
* Freshness.
* Historical usefulness.
* Source quality.

Agents should identify the knowledge they used, especially for consequential business recommendations.
Agent memory vs. knowledge
Distinguish:
Conversation Memory: Temporary or persistent context about an agent's interactions and ongoing tasks.
Knowledge Base: Structured, reusable, sourced intelligence that other agents may retrieve.
Business Performance History: Measured events, experiments, and operational results.
Agent Procedures: Workflows, methodologies, and instructions agents should follow.
These systems should integrate but should not be treated as identical.
The intended improvement in agent knowledge should come from reliable persistent retrieval and updated procedures. Do not claim the underlying AI model has retrained itself when it has not.
## 11. ADVANCED KNOWLEDGE GRAPH & CONNECTION ENGINE
Build a relationship engine behind the visual artboard.
Knowledge cards should be connected intelligently based on meaning, evidence, and actual business relationships.
Example
A research finding about short-form video hooks could connect to:

* TikTok advertising strategies.
* Customer attention psychology.
* Creative testing methodologies.
* Relevant winning advertisements.
* Video production guidelines.
* Product demonstration research.

Automatic relationship discovery
When a new card is created, the system should:

1. Identify semantically related knowledge.
2. Detect strong potential connections.
3. Detect possible contradictions.
4. Link supporting evidence.
5. Suggest relevant card relationships.
6. Save confirmed or sufficiently supported relationships.

Do not automatically clutter the interface with dozens of weak connections.
Use a clear distinction between verified relationships and AI-suggested associations.
Contextual exploration
I want to be able to click one knowledge card and visually explore everything connected to it.
For example, clicking a successful advertising strategy could show an expanded network of relevant research, experiments, creative examples, and actual results.
This should create a genuinely useful discovery experience.
## 12. RESEARCH CONTROL CENTER
Create a centralized research management area inside the Knowledge Base.
This should function as the operational center for all research activities.
Main sections
Research Queue: Upcoming and scheduled tasks.
Active Research: Agents currently investigating topics.
Completed Research: Finished investigations and their results.
Knowledge Discoveries: Recently created insights.
Research Recommendations: Topics agents recommend investigating.
Knowledge Gaps: Important areas where available evidence is weak or missing.
Source Library: Previously researched sources and their associated findings.
Task detail interface
Each research task should display:

* Task objective.
* Assigned agent.
* Business context.
* Research category.
* Sources accessed.
* Current progress.
* Knowledge cards created.
* Existing cards updated.
* Research conclusions.
* Unresolved questions.
* Errors or limitations.

Make this fully integrated with the application's existing AI agent task management system.
I should be able to launch research directly from a knowledge card, business dashboard, analytics insight, or agent conversation.
## 13. KNOWLEDGE SEARCH & DISCOVERY
Because this system may eventually contain thousands of knowledge records, search needs to be extremely powerful.
Global search
Allow searching across all knowledge I am authorized to access.
Support filters for:

* Business.
* General Knowledge.
* Category.
* Subcategory.
* Agent.
* Source.
* Creation date.
* Last verification date.
* Confidence.
* Knowledge type.
* Performance metrics.
* Tags.
* Validation status.

AI-powered knowledge search
In addition to conventional search, add a natural-language research assistant.
For example, I should be able to ask:
"What have we learned about the best creative strategies for my truck accessories business?"
The system should retrieve relevant knowledge, summarize its findings, show supporting sources, and link to the actual cards.
Another example:
"What marketing strategies have worked across multiple businesses?"
The system should compare accessible business knowledge and performance evidence, while respecting privacy and cross-business permissions.
It should distinguish conclusions supported by measured performance from general research recommendations.
## 14. KNOWLEDGE QUALITY, MAINTENANCE & VERSIONING
A large Knowledge Base is only valuable if its information stays accurate and useful.
Create a maintenance system that handles:
Duplicate detection
Identify repeated research findings and consolidate them without losing their original sources.
Contradictory information
Detect conflicting claims and show the evidence behind each.
Knowledge freshness
Flag findings that may be outdated, especially platform-specific advertising tactics and rapidly changing market information.
Knowledge updates
Allow agents to append new evidence, revise conclusions, or challenge older information.
Version history
Maintain a history of changes to important knowledge cards.
Traceability
Every research-derived insight should retain its source references and extraction history.
Every performance-derived insight should retain links to the measurements and time periods that support it.
Confidence progression
Support the progression:
Hypothesis → Research-Supported → Experimentally Tested → Validated
Allow evidence to weaken a previously held conclusion as well.
Manual controls
Give me the ability to:

* Edit knowledge.
* Create knowledge manually.
* Pin important findings.
* Merge duplicate cards.
* Archive outdated knowledge.
* Reject incorrect findings.
* Approve knowledge promotions.
* Mark a finding for additional research.
* Prevent selected knowledge from being used by agents.

Automated decisions must remain inspectable and reversible.
## 15. INTEGRATION WITH THE REST OF THE APPLICATION
This feature must feel like a core part of the existing application, not a separate product.
Integrate with existing or supported systems such as:
Agent Management
Agents should have access to relevant knowledge based on their specializations, selected business, and permissions.
Shopify / Store Analytics
Store-specific insights should be able to reference genuine sales, conversion, customer, and product performance data.
Advertising Integrations
When Meta Ads, TikTok Ads, Google Ads, or other supported platforms are connected, their relevant performance data should feed the intelligence system.
Creative Generation
Creative agents should be able to retrieve historical findings, relevant advertising strategies, and previous creative performance.
Product Research
Product research agents should use existing market intelligence and contribute new discoveries.
Application Navigation
Provide clear access to:

* General Knowledge.
* Business Knowledge.
* Research Center.
* Source Research.
* Knowledge Search.
* Knowledge Relationships.

Preserve the application's existing structure and patterns wherever possible.
Do not assume an integration is available when it is not connected.
## 16. BACKEND ARCHITECTURE & PERSISTENT STORAGE
This needs a real, scalable backend implementation.
Do not construct an impressive interface with a fake or temporary knowledge system behind it.
First inspect the application's existing technology stack and database.
Reuse existing infrastructure where practical.
Core data models
Implement suitable persistent models for:

* Knowledge workspaces.
* Business-specific knowledge.
* Knowledge categories.
* Knowledge cards.
* Sources.
* Evidence records.
* Card relationships.
* Research agents.
* Research tasks.
* Research task executions.
* Research findings.
* Campaign performance observations.
* Experiments.
* Knowledge revisions.
* Agent knowledge retrieval events.
* User approvals and permissions.

Intelligent retrieval
Use an appropriate combination of:

* Structured database queries.
* Full-text search.
* Vector embeddings.
* Semantic similarity.
* Metadata filtering.
* Relationship-based retrieval.

Use the existing database and search technologies where possible rather than unnecessarily adding new infrastructure.
Ensure business isolation and permission checks are enforced in the backend, not just the interface.
Research orchestration
Create an actual research pipeline:
Task Creation → Research Planning → Source Discovery → Source Retrieval → Content Analysis → Evidence Evaluation → Knowledge Extraction → Deduplication → Storage → Relationship Generation → Final Report
Support recoverable task states, execution logs, retries, and cancellation.
Use persistent queues or the application's existing background-job system where appropriate.
Performance analysis pipeline
Connected Data → Data Validation → Performance Analysis → Pattern Detection → Insight Generation → Evidence Assessment → Knowledge Storage → Agent Retrieval
Do not fabricate Shopify metrics, campaign results, sources, or research history.
If a connection is unavailable, provide a real integration-ready state and clearly identify what is not yet enabled.
Security and operational requirements
Include:

* API authentication and permission enforcement.
* Business-level knowledge isolation.
* Safe URL fetching and protection against malicious source instructions.
* Appropriate rate limiting.
* Source and tool access controls.
* Research budgets.
* Logging.
* Data retention controls.
* Cancellation and error recovery.
* Human approval for consequential external actions.

Webpage content must always be treated as untrusted research material, not as instructions that can override an agent's system behavior.
## 17. EXAMPLE COMPLETE END-TO-END WORKFLOW
I want you to implement and test a realistic workflow similar to this:
Step 1 — Research request
I select one of my businesses and tell its Advertising Research Agent:
"Research advertising strategies that are working for this niche."
Step 2 — Research execution
The agent builds a research plan and searches accessible online resources.
It discovers useful articles, relevant case studies, publicly available advertising examples, and platform-specific information.
Step 3 — Knowledge extraction
The agent identifies meaningful findings, evaluates evidence, and checks existing knowledge.
Step 4 — Knowledge organization
It creates knowledge cards under the relevant business:
Advertising → Creative Strategy → Video Hooks
Advertising → Targeting → Audience Research
Marketing → Consumer Psychology → Purchase Motivations
Step 5 — Knowledge relationships
The system automatically identifies and proposes appropriate relationships between those findings.
The visual artboard updates with the new cards and connections.
Step 6 — Agent knowledge retrieval
Later, I tell my Creative Agent to develop advertising concepts.
The agent retrieves relevant business knowledge and applicable General Knowledge before generating its recommendations.
Step 7 — Real-world execution
An advertising workflow uses the resulting creative, with campaign launch and other consequential external actions remaining subject to the application's permissions and approval rules.
Step 8 — Performance analysis
Once enough connected performance data exists, the Analytics Agent evaluates results.
Step 9 — Knowledge feedback
The system creates performance-based knowledge that reflects what happened, how strong the evidence is, and what should be tested next.
Step 10 — Continuous improvement
Future agents retrieve these updated findings and make better-informed recommendations.
This is the exact type of integrated learning system I want the Knowledge Base to become.
## 18. INTERFACE QUALITY & USER EXPERIENCE
The Knowledge Base will be a complex feature, but it cannot feel overwhelming.
Maintain a strong balance between visual sophistication and practical usability.
Required interface features

* Responsive layouts.
* Fluid canvas performance.
* Organized navigation.
* Quick workspace switching.
* Clear research progress indicators.
* Detailed but readable knowledge cards.
* Excellent typography.
* Contextual side panels.
* Smooth opening and closing transitions.
* Keyboard shortcuts.
* Saved filters and views.
* Helpful loading and empty states.
* Clear source provenance.
* Easy movement between an insight and its supporting evidence.

The initial page should immediately communicate:

1. What my agents know.
2. Which business that knowledge belongs to.
3. How that knowledge is organized.
4. What my agents are currently researching.
5. What new intelligence has recently been discovered.
6. How different findings are interconnected.

Prioritize usability over decorative complexity.
## 19. IMPLEMENTATION INSTRUCTIONS
I want this developed as a real feature inside the existing application.
Do not stop after designing a beautiful interface or creating static example knowledge cards.
Development process
Phase 1 — Existing Application Audit
Inspect the current application structure, technology stack, agent architecture, navigation, integrations, and existing knowledge features.
Determine what should be reused and what must be added.
Phase 2 — Visual Redesign
Build the new professional artboard-style Knowledge Base with workspace switching, knowledge cards, category organization, interactive relationships, and alternative views.
Phase 3 — Knowledge Infrastructure
Implement persistent storage, categories, evidence records, source references, semantic retrieval, version history, and business isolation.
Phase 4 — Research Agent Integration
Build actual research tasks, source ingestion, automatic extraction, evaluation, deduplication, and persistent knowledge storage.
Phase 5 — Agent Knowledge Sharing
Integrate retrieval with existing agents so relevant intelligence can be used during real tasks.
Phase 6 — Performance-Based Learning
Connect available analytics and advertising data to an evidence-based learning pipeline.
Phase 7 — Autonomous Research & Maintenance
Implement approved schedules, knowledge-gap detection, refresh tasks, recommended research, and appropriate execution limits.
Phase 8 — Testing & Refinement
Verify the full system and refine its performance, appearance, interaction quality, and reliability.
Testing requirements
At minimum, validate that:

* A general research task creates properly sourced General Knowledge cards.
* A niche-specific task saves findings to the correct business.
* Directed research processes an accessible URL and extracts useful information.
* A failed source retrieval reports the failure rather than fabricating findings.
* Duplicate research does not produce unnecessary duplicate cards.
* Knowledge persists across restarts.
* Agents retrieve relevant saved knowledge in later tasks.
* Knowledge from one business is not accidentally leaked into another.
* Conflicting evidence is handled appropriately.
* Artboard relationships persist and remain interactive.
* Source references remain accessible.
* Performance insights are based on actual connected data.
* Research tasks can be stopped and recovered.
* Automated research respects configured limits and permissions.

Development expectations

* Reuse the existing application architecture.
* Write maintainable, modular code.
* Preserve current working features.
* Build reusable components.
* Avoid hardcoded demonstration data in production views.
* Do not simulate successful research or completed integrations.
* Clearly distinguish implemented features from unavailable external capabilities.
* Validate each major workflow rather than assuming it works.

## 20. FINAL VISION
I want the Knowledge Base to become the intelligence foundation of my entire AI-powered e-commerce operating system.
It should not just answer, "What information do we have?"
It should also answer:

* What have our agents learned?
* Where did that knowledge come from?
* How reliable is it?
* What has worked for our businesses?
* What has failed?
* What are we still uncertain about?
* What should we research next?
* How does one discovery connect to another?
* Which business can benefit from this information?
* How can agents use this knowledge to make better decisions?

Over time, as my agents conduct research and my businesses generate real performance data, the system should become increasingly informed about each niche and each business.
The ultimate objective is to create a connected intelligence ecosystem where research leads to practical execution, real outcomes generate new knowledge, and that knowledge continuously improves future AI-assisted decisions.
This is not simply a Knowledge Base redesign. It is the foundation for an evolving, evidence-driven business intelligence system shared across my entire AI agent ecosystem.
Start by inspecting the existing application and implementing the visual redesign, but design the underlying architecture so all of these systems can function together.
Do not replace the core concept with a basic document manager, simple RAG chatbot, or collection of AI-generated notes.
Build it as a cohesive, production-oriented feature that integrates seamlessly with the rest of the application.
