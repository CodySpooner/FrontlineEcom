# FRONTLINE ECOM — AI AGENTS PAGE REDESIGN & IMPLEMENTATION

> Owner's feature spec, verbatim (2026-10-28).
> Chosen design (owner, 2026-10-28, verbatim): **"yea lets go with A's Workspace design , with Bs Team View , and A's Deploy Design"**. See
> `docs/reference/ai-agents-workspace.png`, `docs/reference/ai-agents-team.png` and `docs/reference/ai-agents-deploy.png`
> (and the `.html` files next to them). Build lane, decisions and items: `docs/backlog/ai-agents.md`. Code survey:
> `docs/features/ai-agents-codemap.md`. Repo rules: `CLAUDE.md`.

## 1. READ FIRST: REQUIRED WORKFLOW

I want to completely revamp the **AI Agents** tab inside my existing application.

This is both a visual redesign and a functional upgrade. The finished page should become the central workspace where I manage my stores’ agents, communicate with them, monitor their work, and coordinate collaboration.

**Do not begin implementing the final redesign immediately. Follow this sequence:**

### Stage One — Inspect the existing application

Review the current AI Agents page, application shell, store management, agent integrations, conversation storage, Knowledge Base, and design system.

Understand what already works before proposing changes. Preserve existing functionality, user data, and architectural conventions. Do not assume integrations or capabilities exist without checking.

### Stage Two — Present four design concepts

Create **four genuinely distinct, high-quality design concepts** and place them together on a visual artboard so I can compare them.

These must be actual visual designs, not four written descriptions or four minor variations of the same layout.

### Stage Three — Stop for design approval

After presenting the artboard, stop and let me select a direction or request a combination of concepts.

**Do not choose a concept for me, replace the production page, or start the implementation worker before I approve the direction.**

### Stage Four — Create the implementation workspace

After I approve a design, use the existing Orca environment to create a dedicated workspace and launch a Claude development agent/worker named exactly:

**AI Agents**

This is the **development worker building the feature**, not an ecommerce agent being deployed inside the application.

First verify which Orca installation, version, and supported workspace controls are available. Do not invent commands or claim that a workspace or worker was launched when it was not.

### Stage Five — Implement, test, and repair

Have the worker proceed through implementation, verification, and repair without stopping after the interface looks finished.

It should maintain a completion checklist, fix issues it discovers, and continue through the approved scope while its actual runtime and permissions allow.

“Work continually” means persistent, checkpointed development—not an unlimited loop or a promise of background execution without a running worker. Preserve progress when interrupted and identify genuine blockers clearly.

---

## 2. OVERALL DESIGN DIRECTION

The existing page feels too game-like. I want to move away from that.

**Remove the agent portraits, character imagery, game-style cards, decorative ranks, skill meters, and unnecessary futuristic effects.**

Replace them with a clean, professional, distinctive workspace that feels appropriate for running real businesses.

Use the Claude application as a reference for the clarity of a conversation-focused interface: organized navigation, readable messages, a comfortable composer, and settings that do not overwhelm the conversation. Do not copy its branding or reproduce its interface exactly.

Maintain Frontline Ecom’s identity and the existing application shell. Favor restrained dark surfaces, clear typography, subtle borders, thoughtful spacing, and limited brand accents where they fit the established design system.

The page should feel sophisticated because of its layout and interactions—not because it has excessive glow, animation, or decorative elements.

**The primary interface should be conversations and work, not a gallery of agent cards.**

### Four directions to explore

| Concept | Design direction |
|---|---|
| **A — Organized Chat Workspace** | A clear store-and-agent navigation hierarchy, a large conversation area, and an optional contextual details panel. Familiar and highly organized. |
| **B — Agent Inbox** | An inbox-inspired workspace that makes active, waiting, and completed conversations easy to scan while keeping the selected conversation prominent. |
| **C — Focused Conversation Studio** | A quieter, more spacious layout with collapsible navigation, compact controls, and contextual panels that appear only when needed. |
| **D — Collaborative Agent Workspace** | A conversation-first layout with particularly strong handling of agent teams, task handoffs, shared outputs, and multiple active workers. |

These are starting directions. Improve them where appropriate, but make the alternatives meaningfully different in structure and interaction—not just color.

All four must support the same core requirements.

### Artboard presentation requirements

Present the concepts as four clearly labeled, high-resolution frames on one organized artboard, with a way to inspect each at a readable size.

Use the same representative store, conversation, and task content across all four so I can compare the layouts fairly. Clearly mark any sample content as demonstration data.

Each concept should show the store navigation, agent-type grouping, named conversations, active status, chat area, model controls, deployment action, and collaboration entry point.

Include a short explanation of each concept’s strengths and tradeoffs. Show enough detail to evaluate the deployment and collaboration interactions, rather than hiding them behind unexplained buttons.

The artboard may be an isolated interactive preview or design artifact. Any code created for this stage must remain separate from the production redesign.

---

## 3. STORE-FIRST ORGANIZATION

The page must organize agents and conversations around individual stores.

The core hierarchy should be:

```text
Store
  → Agent Type
      → Named Conversations
```

For example:

```text
Truck Accessories Store
  → Product Researcher
      → New accessory opportunities
      → Competitor product analysis
  → Ad Strategist
      → Holiday campaign planning
      → Review recent creative performance
  → Creative Strategist
      → Product demonstration concepts
```

I should be able to see all stores I am authorized to access, select one, and immediately see that store’s active and previous conversations.

Use real connected stores rather than a separate hardcoded store list.

### Agent types and conversation names

Keep the **agent type** distinct from the **conversation title**.

“Ad Strategist” describes the specialization. “Holiday campaign planning” is a conversation that I can rename.

Allow multiple conversations under the same agent type, including multiple active conversations when execution limits allow. Renaming a conversation must not change its agent role, store, or identity.

Support searching, pinning, archiving, and reopening conversations. Clearly distinguish active work from completed, failed, waiting, and historical sessions.

### Store switching

Switching stores must update the visible conversations, available knowledge, tools, and business context.

It must not interrupt another store’s running work or accidentally change the store associated with an existing task.

**Every conversation and run must retain its own store scope. Never determine a running agent’s permissions from whichever store happens to be selected in the interface.**

---

## 4. DEPLOYING AND CONFIGURING AGENTS

Add a clear **Deploy Agent** or **New Agent Conversation** action.

The deployment flow should be straightforward, with advanced options available without making the default experience cumbersome.

### Required configuration

| Setting | Requirement |
|---|---|
| **Store** | Default to the selected store and clearly identify where the agent will operate. |
| **Agent type** | Select a specialization such as Product Researcher, Ad Strategist, Creative Strategist, Copywriter, Analytics Specialist, Store Developer, Marketing Strategist, or General Researcher. |
| **Agent runtime** | Choose Claude or Codex through the application’s actual supported integrations. |
| **Model** | Select from all models genuinely supported and accessible through that connection. |
| **Effort** | Offer the effort settings supported by the selected model and runtime. |
| **Conversation title** | Allow a custom name, with an editable suggested title when useful. |
| **Initial objective** | Describe what the agent should accomplish. |
| **Tools and knowledge** | Show the resources the agent can access, including relevant Knowledge Base scopes. |
| **Permissions and limits** | Configure allowed actions, approval requirements, and applicable execution budgets. |

Support reusable presets and custom agent roles without forcing every deployment through a lengthy setup process.

### Model and effort selection

I want access to the full supported selection—not an unnecessarily restricted list. This includes models such as Astra, Opus, Fable, and other available models **where the selected connection actually supports them**.

Do not hardcode assumed model names, identifiers, or effort values.

Use provider/runtime capability discovery where available. Where discovery is incomplete, maintain a versioned capability registry verified against current official documentation.

Separate the user-facing runtime choice from the underlying provider, authentication method, and model identifier.

When the runtime or model changes, update the available effort settings and other capabilities accordingly. Do not assume Claude and Codex expose identical controls or that similarly named effort settings are equivalent.

Validate the configuration in the backend before starting a run.

Unavailable options should have an understandable explanation. Never silently substitute a different model, effort level, or provider.

Persist the actual model and configuration used for each run so historical conversations remain accurate after settings change.

---

## 5. CONVERSATION EXPERIENCE

The main workspace should feel like a polished chat application built for real agent work.

### Conversation header

Show the conversation title, agent type, selected store, runtime, model, effort, and current status in a compact layout.

Provide accessible controls for configuration, collaboration, conversation management, and stopping an active run.

Keep technical details available without turning the header into a dense dashboard.

### Messages and composer

Support readable streaming responses, Markdown, relevant attachments, source references, and generated outputs.

Keep the composer easy to reach. Preserve unsent drafts per conversation when switching between chats or stores.

Support retrying failed requests and continuing earlier conversations without losing context or creating duplicate messages.

When changing providers or runtimes, preserve supported conversation content through an explicit handoff or new session. Do not assume provider-specific session state can be transferred unchanged.

### Observable work

Show useful activity such as:

> Reviewing the selected store’s advertising knowledge.

> Comparing the connected campaign results.

> Waiting for approval before applying changes.

These must reflect actual execution events—not decorative status messages.

Use expandable activity details for tool calls, sources, outputs, and errors. Show concise explanations and progress summaries rather than claiming to display a model’s private reasoning.

### Execution controls

Stopping a run must stop or cancel the underlying work as supported, not merely stop the text animation.

Where interruption, message queuing, or pause/resume is supported, implement it accurately. Otherwise, clearly explain the limitation.

A conversation can be idle while an agent remains available. Do not label every open conversation as “running.”

---

## 6. MAKE AGENTS GENUINELY SPECIALIZED

I want capable agents, not identical chatbots with different labels.

Each agent type needs a defined responsibility, task workflow, tool access, relevant knowledge retrieval, expected outputs, and quality checks.

For example, a Product Researcher should investigate opportunities, supporting evidence, competitors, and uncertainties. An Ad Strategist should use the store’s audience, offer, historical results, and advertising knowledge. An Analytics Specialist should distinguish measured outcomes from hypotheses.

Build these specializations through maintained instructions, tools, context, and evaluation—not decorative profiles or unsupported claims of intelligence.

Before substantial work, the agent should establish the selected business, objective, available evidence, applicable permissions, and expected deliverable.

During work, it should use the required tools, identify missing information, and check whether its conclusions are supported.

Before completion, it should review its output against the request and clearly identify unresolved questions.

**Do not fabricate research, analytics, successful tool actions, or completed work to make an agent appear more capable.**

---

## 7. KNOWLEDGE BASE INTEGRATION

Integrate this page with the existing Knowledge Base and research system. Do not create a separate, disconnected memory feature.

Agents must be able to retrieve:

**General Knowledge:** Applicable business principles, advertising methods, creative frameworks, analytics practices, and other reusable knowledge.

**Store-Specific Knowledge:** The selected store’s niche research, audience information, products, brand guidance, campaign lessons, experiments, and relevant performance history.

### Retrieval requirements

Retrieve knowledge based on the task, agent specialization, selected store, relevance, evidence quality, and freshness.

Do not inject the entire Knowledge Base into every conversation.

Make useful references inspectable. A response should be able to link to the knowledge cards, sources, or performance records supporting a recommendation.

When evidence conflicts or is insufficient, preserve that uncertainty.

### Learning and saving findings

When an agent discovers useful information, provide a real path for saving it into the appropriate Knowledge Base.

Use the existing knowledge-ingestion process to preserve sources, business scope, classification, evidence, and version history. Check for duplicates before creating new records.

Distinguish research findings, hypotheses, observations, and validated results. An agent’s generated suggestion must not automatically become a verified business fact.

Capture useful findings at appropriate checkpoints so they are not lost simply because a long task is interrupted.

Allow manual **Save to Knowledge Base** actions and configured automatic capture, with visible confirmation that persistence succeeded.

### Isolation

Agents may use authorized General Knowledge and the selected store’s knowledge.

Do not retrieve another store’s private information by default. Any cross-store access must follow explicit existing permissions.

Knowledge access must be enforced in the backend, not just through interface filters.

---

## 8. AGENT COLLABORATION

Add a clear **Collaborate** or **Create Agent Team** action.

I should be able to bring multiple specialized agents together around one objective without losing the simplicity of ordinary one-to-one conversations.

For example:

> Ask a Product Researcher to investigate an opportunity, an Ad Strategist to develop angles, a Creative Strategist to propose concepts, and an Analytics Specialist to define how the test should be evaluated.

### Team setup

Let me select the store, shared objective, participating agents, each agent’s runtime/model/effort, and a lead agent responsible for consolidating the result.

Support both existing compatible agents and newly configured participants.

### Actual coordination

Collaboration must involve real task delegation and handoffs—not one model pretending that several agents participated.

The lead should divide the work, identify dependencies, assign responsibilities, pass relevant findings between participants, and produce a consolidated result.

Run independent subtasks in parallel where appropriate. Run dependent tasks in the correct order.

Use a shared task record and relevant context rather than repeatedly sending every participant the entire conversation history.

### Collaboration interface

Show participants, assignments, actual status, outputs, handoffs, unresolved disagreements, and the lead’s final synthesis.

Clearly identify which agent produced each contribution.

Let me inspect an individual contribution without drowning the main conversation in internal chatter.

Multiple agents agreeing does not constitute independent validation. Preserve supporting evidence and uncertainty.

### Controls and limits

Support cancellation, partial failure recovery, bounded retries, concurrency limits, and task budgets.

Prevent recursive delegation, duplicate work, uncontrolled spawning, and endless agent-to-agent conversations.

Collaboration must not expand an agent’s permissions or grant another participant access to unauthorized store data.

---

## 9. INTEGRATION WITH THE REST OF THE APP

This feature should feel native to Frontline Ecom.

Reuse the existing navigation, design tokens, store identities, authentication, integrations, notifications, and task infrastructure.

Allow relevant modules to open an agent conversation with context. For example, an advertising-performance view could open an Ad Strategist conversation containing a reference to the selected campaign, rather than requiring me to explain it again.

Generated deliverables should connect to the relevant application workflow where supported. Research should link to its sources, campaign recommendations to the campaign context, and creative outputs to their saved assets.

Preserve navigation state when moving between a conversation and its supporting material.

**Do not rebuild unrelated modules as part of this task. Extend existing interfaces where necessary and document missing dependencies.**

An unavailable integration should show a truthful connection or setup state—not fabricated data or a button that silently does nothing.

---

## 10. PERSISTENCE, EXECUTION, AND SECURITY

Build real functionality behind the interface.

Keep these concepts separate in the data model:

| Concept | Purpose |
|---|---|
| **Agent role/template** | Defines specialization, instructions, and default capabilities. |
| **Configured agent** | Defines the chosen runtime, model, tools, and permissions. |
| **Conversation** | Stores the user-visible thread and its immutable store association. |
| **Run** | Represents one actual execution with its own configuration, status, and outputs. |
| **Team session** | Coordinates participants and related runs around a shared objective. |

Persist messages, configurations, task states, tool events, attachments, knowledge references, and collaboration records using the application’s existing architecture where practical.

Use explicit execution states such as queued, running, waiting for input, awaiting approval, completed, failed, cancelled, and interrupted.

### Reliability

Implement durable execution identifiers, reconnect handling, bounded retries, and idempotency for actions that could otherwise be duplicated.

Switching pages or refreshing must not lose saved conversations or incorrectly relaunch work.

Clearly distinguish interface disconnection from worker termination. Do not claim a task continues after the application closes unless an actual surviving execution service supports it.

Handle context limits with supported summarization or compaction while preserving important instructions, source references, and task state.

### Security and approvals

Keep credentials out of client-visible state, conversations, and logs.

Enforce store permissions on every relevant read, tool call, and write.

Treat retrieved webpages, documents, and knowledge content as untrusted input—not instructions that override agent permissions.

Launching advertisements, spending money, publishing changes, editing live stores, deleting data, or contacting customers must follow the application’s approval rules.

Development should use isolated environments and non-production fixtures where appropriate. Do not bypass safeguards merely to keep the worker running.

---

## 11. USABILITY AND FINISH

The approved design must remain usable with many stores, long histories, and several simultaneous runs.

Provide efficient search, sensible pagination or virtualization, keyboard navigation, visible focus states, accessible contrast, and responsive panel behavior.

Persist useful interface preferences such as panel sizes and collapsed groups.

Include thoughtful empty, loading, disconnected, permission-denied, failed, and interrupted states.

A new user should immediately understand how to select a store and start a conversation. An experienced user should be able to move quickly between active agents without repeatedly opening configuration dialogs.

**Keep advanced controls discoverable, but keep the everyday interface calm.**

---

## 12. TESTING AND DEFINITION OF DONE

I want this thoroughly tested and reliable. “Smoke-proof” should mean clear verification and repaired failures—not an unsupported promise that software can never have bugs.

Run the applicable build, type checks, linting, unit tests, integration tests, and end-to-end smoke tests. Use the project’s existing test tools where possible.

At minimum, verify these workflows:

| Area | Required verification |
|---|---|
| **Store isolation** | Switching stores shows the correct conversations. Unauthorized conversation, tool, and knowledge access is rejected in the backend. |
| **Conversation management** | Create, rename, search, pin, archive, and reopen conversations without losing messages or changing agent roles. |
| **Deployment** | Role, runtime, model, and effort selections are validated and used by the actual execution. Unsupported combinations are rejected clearly. |
| **Chat execution** | Streaming, failures, retries, cancellation, and supported interruption work without duplicate messages or actions. |
| **Persistence** | Reloads, navigation, and supported restarts preserve conversation history and accurately restore execution status. |
| **Knowledge access** | Agents retrieve authorized general/store knowledge, expose supporting references, and persist useful findings correctly. |
| **Collaboration** | Real participants execute assigned work, exchange relevant outputs, respect dependencies, and produce a consolidated result. |
| **Failure recovery** | Disconnected providers, expired credentials, rate limits, timeouts, unavailable models, and worker interruptions produce recoverable states. |
| **Permissions** | Consequential actions require the correct approval, and collaboration cannot bypass restrictions. |
| **Interface quality** | Long titles, large histories, multiple running agents, smaller windows, and keyboard-only interaction remain usable. |

Use controlled test data rather than spending advertising money or modifying live stores just to prove a workflow.

Mocks are acceptable for automated tests, but a mocked test is not evidence that a live integration works. Identify which workflows were tested against actual connected services.

After fixing a defect, rerun the relevant checks. Do not repeatedly run unrelated tests without a reason.

### Completion criteria

The implementation is complete only when the approved design is implemented, core workflows function end to end, persistence and isolation are verified, and the relevant checks pass.

No essential controls should be dead buttons, no production screens should depend on unlabeled fake data, and no critical integration should be represented as complete when it remains blocked.

Where access or credentials prevent verification, state exactly what is implemented, what remains unverified, and what is needed.

---

## 13. IMPLEMENTATION WORKER HANDOFF

After design approval, provide the Claude worker named **AI Agents** with the selected concept, this specification, relevant repository guidance, architectural findings, and a testable completion checklist.

Have it work through the feature in coherent increments:

**Foundation → Approved interface → Store-scoped conversations → Runtime configuration → Knowledge integration → Collaboration → Reliability → Verification.**

Preserve checkpoints and keep a concise record of completed work, current work, failed checks, and blockers.

The worker should make routine implementation decisions within the approved scope rather than repeatedly asking for permission. It must still stop for missing credentials, destructive actions, significant scope changes, or other genuine approval requirements.

Do not automatically merge, publish, or deploy beyond the authorization already granted.

### Final implementation report

When the work is finished, provide the implemented features, relevant changed areas, verification results, screenshots of the finished interface, and any remaining limitations.

Report actual outcomes—not simply “everything works.”

---

## FIRST ACTION

**Inspect the existing application, then produce the four visual design concepts on one comparison artboard.**

The first deliverable is the design review—not the completed implementation.

After I choose the direction, create the Orca workspace, launch the Claude worker named **AI Agents**, and proceed through implementation and verification.

**The end result should be a clean, distinctive, store-aware agent workspace where I can organize conversations, deploy specialized Claude or Codex agents, choose supported models and effort settings, coordinate real collaboration, and use the application’s shared knowledge seamlessly.**
