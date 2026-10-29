<!-- The owner's Settings spec, pasted 2026-10-28, kept verbatim. Source of truth for WHAT to build.
     The chosen design and the decisions are in docs/backlog/settings.md; the code survey is docs/features/settings-codemap.md. -->

# FRONTLINE ECOM — SETTINGS PAGE REDESIGN & FULL-STACK IMPLEMENTATION

## 1. READ FIRST: REQUIRED WORKFLOW

I want to completely revamp the **Settings** page in my existing application.

The current page looks acceptable, but its organization needs improvement. Some controls feel cramped, related settings are scattered, and the experience does not yet feel like a complete settings system for a multi-store, AI-powered ecommerce application.

This is both a visual redesign and a functional upgrade.

**Treat this as the application-wide Settings area—not just settings for individual products.**

Follow the sequence below. Do not skip the design-approval stage.

### Stage One — Inspect the existing application

Review the current Settings page, application shell, design system, authentication, store management, agent configuration, integrations, Knowledge Base, Product Research, and background-task infrastructure.

Identify which settings already exist, where they are stored, what behavior they control, and which parts of the application consume them.

Preserve existing configuration and working functionality. Do not reset settings, replace integrations, or introduce a second source of truth without a migration plan.

### Stage Two — Present four design concepts

Create **four genuinely distinct, polished visual concepts** and place them together on one comparison artboard.

These must be actual visual designs—not four written descriptions or minor variations of the same layout.

### Stage Three — Stop for design approval

Let me select a direction or request a combination of concepts.

**Do not choose a concept for me, replace the production Settings page, or start the implementation worker before I approve the direction.**

### Stage Four — Create the implementation workspace

After approval, create a dedicated Orca workspace and launch a Claude development agent/worker named exactly:

**Settings**

Verify the available Orca installation and supported workspace controls first. Do not invent commands or claim that a workspace or worker was launched when it was not.

This is the development worker building the feature—not an ecommerce agent operating inside the application.

### Stage Five — Implement, test, and repair

Have the worker continue through implementation, integration, testing, and defect repair within its actual runtime, permissions, and execution limits.

Maintain a completion checklist and recoverable checkpoints. Do not stop after the interface looks finished while its controls remain disconnected from real application behavior.

“Work continually” means persistent, checkpointed development through the approved scope—not unlimited retries or a promise of background execution without a running worker.

---

## 2. OVERALL OBJECTIVE

Build a complete, organized Settings experience that becomes the central place for configuring Frontline Ecom.

It should help me understand:

- What I can configure.
- Whether a change affects me, the entire workspace, or one store.
- Which settings are inherited and which are overridden.
- What is connected, working, restricted, or unavailable.
- When a change takes effect and what it will affect.

The result should feel like a premium SaaS application: clean, distinctive, easy to navigate, and powerful without being overwhelming.

**More settings should mean more useful control—not more clutter.**

Every editable setting must have a defined purpose, persistent storage, appropriate permissions, validation, and a real consumer elsewhere in the application.

Do not create decorative switches that save a value but never change anything.

---

## 3. VISUAL DIRECTION AND FOUR DESIGN CONCEPTS

Preserve Frontline Ecom’s existing application shell, color palette, and visual identity.

Use clear typography, generous spacing, restrained brand accents, subtle borders, and well-organized groups. Remove cramped arrangements and unnecessary visual noise.

Avoid game-like elements, agent portraits, excessive glow, oversized decorative cards, and a dashboard filled with irrelevant metrics.

Explore four meaningfully different directions:

| Concept | Direction |
|---|---|
| **A — Structured Settings Workspace** | A grouped settings sidebar, spacious main content, and clear section-level save controls. Familiar, polished, and efficient. |
| **B — Searchable Control Center** | A useful settings overview with search, frequently used controls, connection health, and focused detail pages. |
| **C — Scope-Aware Split View** | A layout that makes personal, workspace, and store settings especially clear, with a contextual panel explaining inheritance and impact. |
| **D — Guided Configuration Hub** | A workflow-oriented experience organized around connecting stores, configuring agents, managing research, and controlling operations. |

All four concepts must support the same core requirements.

### Artboard requirements

Use consistent representative content across the concepts so I can compare the layouts fairly.

Show category navigation, settings search, scope selection, grouped controls, integration status, and save behavior. Include a representative AI Agent configuration screen and an integration detail state.

Clearly label demonstration data. Do not make prototype connection states look like verified live integrations.

Provide four labeled frames on one organized artboard, with a way to inspect each at a readable size. Briefly explain each concept’s strengths and tradeoffs.

Any preview code must remain isolated from the production redesign until approval.

---

## 4. INFORMATION ARCHITECTURE AND SETTING SCOPES

Organize navigation into understandable groups rather than presenting one enormous page of unrelated controls.

A suitable starting structure is:

**Personal:** Account, Appearance, Personal Notifications.

**Workspace:** General, Stores, Team & Access.

**AI & Connections:** Agents & Providers, Integrations, Knowledge, Product Research, Automation.

**Operations:** Usage & Limits, Data & Privacy, Audit History, Advanced.

Refine this after inspecting the application. Do not create empty sections merely to match this outline.

### Scope model

Make the scope of every setting explicit.

| Scope | Meaning |
|---|---|
| **Personal** | Preferences belonging to the signed-in user, such as appearance and personal notification choices. |
| **Workspace** | Shared defaults, connections, and policies affecting the organization or application workspace. |
| **Store** | Settings and permitted overrides belonging to one selected business. |
| **Agent or task** | Configuration owned by an individual agent or execution, usually managed through the existing agent workflow. |

Do not apply one universal inheritance hierarchy to every setting.

For overridable agent defaults, a supported hierarchy might be:

**Workspace default → Store override → Agent configuration → Run configuration**

However, workspace security policies and execution restrictions must remain enforced at every level. A store or agent cannot grant itself broader permissions by overriding a default.

### Effective-value visibility

Where inheritance exists, show both the effective value and its origin:

> Using workspace default.

> Customized for this store.

> Restricted by workspace policy.

Provide **Use workspace default** or **Remove override** actions where appropriate. Removing an override should restore inheritance—not copy the current default into a separate value that later becomes outdated.

Changing the selected store must never accidentally save one store’s settings into another.

---

## 5. CONSISTENT SETTINGS INTERACTIONS

### Search and navigation

Add settings search that finds relevant categories, labels, descriptions, and common synonyms.

Selecting a result should navigate directly to the appropriate control, preserve the correct scope, and briefly highlight it.

Search must respect permissions. It must not expose hidden administrative settings, secret values, or another store’s configuration.

Support useful deep links so other application modules can open the relevant settings section directly.

### Grouping and progressive disclosure

Group related controls into clearly titled sections with short explanations.

Keep common options visible. Place genuinely advanced settings behind an **Advanced** expansion rather than filling the default page with technical controls.

Disabled controls should explain why they are unavailable. Do not make users guess whether they lack permission, need a connection, or selected an unsupported model.

### Saving and unsaved changes

Use a predictable save pattern.

For multi-field operational settings, provide clear **Save Changes** and **Cancel** actions, with visible unsaved-change feedback.

Immediate preferences such as theme may apply automatically, but their behavior should be clearly differentiated from settings requiring an explicit save.

When navigating away with unsaved changes, offer **Save**, **Discard**, or **Stay**.

Do not show a success message until the backend confirms persistence. Where applying a configuration requires an asynchronous job, distinguish **Saved** from **Applied**.

### Resetting settings

Provide section-specific reset actions with a preview of what will change.

Do not place a casual “Reset Everything” button beside ordinary preferences.

Resetting a store override, restoring an application default, and deleting configuration are different actions and must be presented differently.

---

## 6. REQUIRED SETTINGS AREAS

### 6.1 Account and Appearance

Provide useful personal controls such as profile details, display name, timezone, language where supported, date/time formatting, theme, interface density, reduced motion, and applicable accessibility preferences.

Integrate authentication and session controls with the existing identity system. Only expose password changes, multifactor authentication, or session revocation where the authentication architecture actually supports them.

Personal timezone and currency-display preferences must not silently change store configuration, historical reporting definitions, or checkout behavior.

Keep appearance options focused. Do not add dozens of cosmetic controls that make the application harder to maintain without providing meaningful value.

### 6.2 Workspace and Stores

Provide workspace identity, default preferences, and an organized view of connected stores.

For each store, expose relevant settings such as display name, business timezone, primary market, reporting preferences, and links to its brand or business context.

Reuse existing store identities. Do not create a separate Settings-only store registry.

Clearly distinguish internal application preferences from changes that modify the live commerce platform.

For example, changing a display currency inside Frontline Ecom must not imply that the store’s selling currency was changed.

Store disconnection or archival should show affected integrations, scheduled jobs, agents, and data access before confirmation.

### 6.3 Team and Access

Where the application supports multiple users, provide membership, invitations, roles, and store-access controls.

Reuse the existing authorization model. Define permissions around capabilities rather than relying only on role names.

Users should only manage settings they are authorized to change. A read-only interface is not sufficient; the backend must reject unauthorized writes.

Prevent administrative lockouts, such as removing the last authorized workspace owner without a valid ownership-transfer flow.

Do not invent a complete team-management system solely to populate a settings screen. Where a required foundation is missing, identify it explicitly during the audit and include its implementation implications in the approved scope.

### 6.4 AI Agents and Provider Configuration

Create a coherent area for managing the application’s actual Claude, Codex, and other supported agent connections.

Provide appropriate defaults for runtime, model, supported effort settings, response preferences, task timeout, concurrency, retry behavior, and execution limits.

Use real runtime capabilities and account access. Do not hardcode assumed model names, identical effort levels across providers, or unsupported controls.

Changing the selected runtime or model must update dependent options and validate the configuration again.

Separate shared defaults from individual agent settings. Provide links into the existing **AI Agents** configuration rather than duplicating it.

By default, changed model or effort preferences should apply to new runs. Preserve the actual configuration used by historical and already-running tasks.

Do not silently switch providers or models when one fails. Any fallback policy must be explicit, permission-aware, and visible in execution history.

### 6.5 Integrations and Credentials

Create an organized integration directory grouped by purpose, such as stores, advertising, research, analytics, and agent runtimes.

For each genuine integration, show its connection scope, authorization status, permissions, last successful operation, and available configuration.

Provide connection, testing, reauthorization, disconnection, and credential replacement where supported.

A successful connection test must represent a real, appropriately limited request—not a simulated result or a request that changes live business data.

Stored credentials must be write-only from the interface’s perspective. Do not return saved secrets to the browser, expose them in logs, or include them in exports.

Use masked saved states with actions such as **Replace**, **Test Connection**, and **Revoke**.

Before disconnecting a shared integration, explain its dependencies and how affected tasks will behave.

### 6.6 Knowledge Base and Memory

Integrate settings for the existing Knowledge Base, including permitted knowledge scopes, automatic capture, review requirements, refresh policies, and applicable retention preferences.

Preserve the distinction between General Knowledge, store-specific knowledge, conversation memory, and execution history.

Allow configuration of trusted or preferred research sources, but do not let a trusted-source label bypass security controls.

Automatic knowledge saving must still preserve provenance, classification, evidence, and business scope. It must not convert an agent’s suggestion into a verified fact.

Promoting store knowledge into General Knowledge should follow explicit permission and review rules.

Link to the actual Knowledge Base for content management rather than recreating its editor inside Settings.

### 6.7 Product Research Defaults

Provide reusable defaults for the Product Research feature, such as target shipping destination, preferred suppliers, delivery thresholds, product categories, excluded categories, and research depth.

Allow configurable pricing and profitability assumptions where the feature supports them.

Clearly distinguish user-entered assumptions from verified supplier data. Missing costs must not silently become zero.

Store-specific preferences should influence the relevant discovery filters and future research tasks. They should not retroactively rewrite historical research conclusions.

Use the existing Product Research data model and agent configuration rather than creating parallel settings that its pipeline never reads.

### 6.8 Automation and Agent Action Policies

Provide controls for supported schedules, triggers, concurrency, research limits, and background execution.

Show the timezone, next scheduled execution, current enablement state, and affected store or workspace.

Editing a schedule must update or replace the real job without leaving duplicate schedules behind.

Provide understandable control over what agents may do independently and which actions require approval.

Read-only research, preparing drafts, modifying live stores, publishing content, launching advertisements, spending money, deleting data, and contacting customers must not be treated as equivalent permissions.

An “autonomous” setting must never bypass authorization or approval requirements.

Include a clear **Pause New Automation** control. Where supported, provide a separate action to cancel running jobs.

Explain that pausing new work and cancelling active work are different operations. Show actual cancellation outcomes rather than pretending already-completed external actions were reversed.

### 6.9 Notifications

Create a notification-preference system for meaningful events such as research completion, task failure, approval requests, integration issues, important watchlist changes, and configured usage thresholds.

Support only channels the application can actually deliver through.

Let users control relevant categories, store scope, delivery channels, quiet hours, and digest frequency where implemented.

Respect user timezones and prevent duplicate alerts.

Test notifications should clearly identify the destination and send only through an authorized channel.

Notification links must open the relevant task or setting without exposing information outside the recipient’s permissions.

### 6.10 Usage, Limits, and Costs

Show genuine usage information from supported providers and application execution records.

Distinguish measured usage, estimated cost, provider-reported charges, and unavailable information.

Provide useful limits such as task duration, concurrent runs, request volume, and configured daily or monthly budgets where the system can enforce them.

Explain exactly what a limit controls. A local estimated budget is not automatically a provider-enforced spending cap.

Account for concurrent tasks and in-flight requests when implementing budget checks. Do not promise that already-incurred external costs can be cancelled.

Only include subscription or billing management if the application has an actual billing system. Do not build a fake payment page or store payment-card information to fill out this section.

### 6.11 Data, Privacy, and Audit History

Provide controls for appropriate retention, export, archival, and deletion workflows.

Separate conversation history, knowledge records, research outputs, operational logs, and audit history because their lifecycle requirements may differ.

Exports must respect permissions and scope. Exclude credentials and clearly identify sensitive business information included in an export.

Show an inspectable history of important settings changes: who made the change, what scope it affected, when it happened, and whether it was applied.

Never record plaintext secrets in audit entries.

Do not claim backups or recovery are available unless actual backup and restoration workflows exist and have been tested.

### 6.12 Advanced and Diagnostics

Reserve advanced controls for real capabilities such as supported webhooks, developer credentials, diagnostic exports, connection health, and environment information.

Do not expose arbitrary internal feature flags or unsafe debugging controls to ordinary users.

Diagnostic exports should remove credentials, private content, and unnecessary personal information.

Unavailable capabilities should have truthful explanations, not editable placeholders or a wall of “coming soon” cards.

---

## 7. USEFUL ADDITIONS THAT IMPROVE THE EXPERIENCE

### Setup and connection checklist

Provide a practical checklist for configuration that is genuinely incomplete: selecting a store, connecting an agent runtime, configuring required permissions, or verifying a research source.

Mark an item complete only when its actual requirements are satisfied.

### Frequently used settings

Allow users to pin a small number of relevant settings or categories for quick access.

Keep this personal rather than changing the navigation for everyone.

### Configuration presets

Support reusable presets where they provide value—for example, store research defaults or agent execution preferences.

Presets must be scoped, permission-aware, versioned where appropriate, and free of embedded credentials.

Applying a preset should show a preview of changes and affected settings before saving.

### Impact previews

For significant changes, explain the real consequences:

> Applies to future Product Research runs for this store.

> Disables three scheduled jobs.

> Removes this connection from two authorized agents.

Only show dependency counts that come from actual data.

### Safe configuration export and import

Where useful, support validated configuration export/import for non-secret preferences.

Use a versioned format, validate supported fields, preview differences, and reject unauthorized policy changes.

Do not import secrets or silently overwrite security settings.

---

## 8. SETTINGS MUST CONTROL REAL APPLICATION BEHAVIOR

Build and verify the complete path:

**Control → Validation → Persistence → Effective Configuration → Application Behavior → Observable Result**

For example:

Changing a store’s default research destination should affect its next eligible product-research task.

Changing an agent model default should affect new deployments or runs according to the defined inheritance rules.

Disabling automatic knowledge capture should affect future capture operations while preserving existing knowledge.

Pausing a schedule should prevent new scheduled work without falsely showing that an active external request was cancelled.

Revoking a tool permission should prevent subsequent unauthorized tool actions, including actions attempted by already-running agents. Distinguish this from external operations that were already completed or cannot be interrupted.

**A setting is not finished simply because its value survives a page refresh.**

---

## 9. BACKEND ARCHITECTURE AND RELIABILITY

Reuse existing configuration owners and storage wherever practical.

Define a settings schema or registry that identifies each setting’s type, valid scopes, default, validation rules, permissions, inheritance behavior, and downstream consumer.

Do not turn Settings into an unrelated collection of loosely validated JSON fields.

### Persistence and change handling

Validate on the server as well as in the interface.

Use appropriate transactions for related local changes. Where applying a setting requires external work, track that operation separately and support retries without duplicating side effects.

Use configuration versions or equivalent concurrency controls to prevent one browser tab or administrator from silently overwriting another’s changes.

Handle cache invalidation so agents, workers, and other modules do not continue using stale configuration indefinitely.

Preserve effective configuration snapshots where needed for reproducibility.

### Safe migrations

Preserve existing settings during the redesign.

Populate defaults only where values are genuinely absent. Do not overwrite user choices whenever a page loads or a schema changes.

Document migrations, compatibility behavior, and recovery procedures.

### Failure states

Handle validation failures, expired connections, unavailable services, permission changes, and partial application failures clearly.

Show which values were saved, which operations failed, and whether retrying is safe.

Never hide a backend error behind a success toast.

---

## 10. DESTRUCTIVE ACTIONS AND SECURITY

Separate destructive actions into a clearly labeled area with sufficient explanation.

Disconnection, archival, reset, and deletion should each describe their scope and consequences.

Require stronger confirmation where appropriate, particularly for workspace-wide changes, irreversible deletion, permission revocation, and removal of shared connections.

Prefer reversible operations where the application’s data model supports them.

Do not promise rollback of external changes that cannot actually be reversed.

Enforce permissions consistently across interface requests, background jobs, agent tools, exports, and configuration imports.

No settings combination should allow an agent to bypass store isolation, access another user’s credentials, or treat untrusted source content as authorization.

---

## 11. TESTING AND ACCEPTANCE REQUIREMENTS

I want this thoroughly verified. “Smoke-proof” means tested against clear workflows and repaired failures—not an unsupported claim that software can never have bugs.

Run applicable build checks, type checks, linting, unit tests, integration tests, and end-to-end smoke tests using the project’s established tools.

| Area | Required verification |
|---|---|
| **Persistence** | Changes survive navigation, reloads, and supported restarts. |
| **Scopes** | Personal, workspace, and store settings affect only their intended targets. |
| **Inheritance** | Defaults, overrides, and override removal resolve correctly. |
| **Permissions** | Unauthorized reads and writes are rejected by the backend, not merely hidden. |
| **Save behavior** | Validation, cancellation, unsaved-change warnings, and success/error states work correctly. |
| **Concurrency** | Conflicting edits do not silently overwrite newer configuration. |
| **Agent behavior** | Supported model and execution defaults are used by actual subsequent runs. |
| **Integrations** | Tests, reauthorization, revocation, and disconnection reflect actual outcomes. |
| **Knowledge and research** | Relevant settings alter the real retrieval, capture, filtering, and research workflows. |
| **Automation** | Schedule changes, timezone handling, pausing, and cancellation behave correctly without duplicate jobs. |
| **Secrets and exports** | Saved credentials are not returned, logged, or included in exports or diagnostics. |
| **Usability** | Search, keyboard navigation, responsive layouts, long labels, and error states remain usable. |

Test configuration changes against isolated environments or safe fixtures where possible. Do not spend money, publish content, or modify live stores merely to verify a control.

Mocks are appropriate for automated tests, but they are not proof that a live integration works.

Identify which workflows were verified against actual connected services. After fixing a failure, rerun the relevant checks.

---

## 12. IMPLEMENTATION AND DEFINITION OF DONE

After approval, have the **Settings** development worker proceed in coherent increments:

**Configuration audit → Approved interface → Scope and persistence foundation → Functional settings sections → Integration behavior → Security and reliability → Verification.**

Make routine implementation decisions within the approved scope without repeatedly asking for permission. Stop for genuine blockers, missing credentials, destructive actions, paid services, or significant scope changes requiring approval.

Continue independent work when one integration is blocked, but do not represent the blocked portion as complete.

The feature is complete when the approved design is implemented, exposed controls have real behavior, settings persist correctly, scope and permission rules are enforced, and relevant tests pass.

Do not declare completion with dead buttons, simulated connection tests, unverified backup claims, or controls that no application module reads.

Provide a final report covering implemented functionality, configuration migrations, tested workflows, screenshots, verification results, and remaining limitations.

Do not automatically merge, publish, or deploy beyond the authorization already granted.

---

## FIRST ACTION

**Inspect the existing application, then create four distinct Settings design concepts on one comparison artboard. Stop for my selection.**

After approval, create the Orca workspace, launch the Claude development worker named **Settings**, and implement the selected direction through integration, testing, and repair.

**The finished Settings experience should make Frontline Ecom easier to control—not simply offer more switches. Every section should be organized, every change should have a clear scope, and every exposed control should work throughout the application as intended.**
