# AI Agents page: final report

Lane `ai-agents`, 2026-10-28. Spec: `docs/features/ai-agents.md`. The owner approved "A's Workspace design, with B's
Team View, and A's Deploy Design". Items, decisions and per-item notes: `docs/backlog/ai-agents.md`. 30 commits on
`main`, from a3c3b1d5 (lane setup) to 969b86b5 (AA-26), plus the commit that adds this report.

## Status

- Every item from AA-01 to AA-27, including AA-14b, is done.
- AA-25b, the Codex live smoke, is ticked under decision 16 but did not run. Codex isn't signed in on the app's
  Codex folder, and only the owner can sign in. It is listed under Blocked with the exact command (see Limitations).
- `pnpm check` (typecheck plus every test) passes: 214 test files, 1,622 tests on the last run before this report.
  `pnpm build` passes.
- The repo has no linter, so linting doesn't apply. It wasn't run, and this report doesn't claim it passed.
- One live Claude run was made (AA-25). It finished in 13.8 s and cost $0.112, on a demo store. Everything else was
  tested against the scripted engine, a fake Codex, and stubbed APIs. The two are reported separately below.

## What was built

**Workspace (`/agents`)**, three panes, one store at a time:

- **Left pane:**
  - the store switcher, a native popover with each store's running and waiting counts, keyboard-driven;
  - Deploy agent and Create team;
  - search across titles and message text in the open store;
  - Pinned, Teams, and the agents grouped by type with their conversations;
  - row ⋯ menus to rename, pin and archive;
  - Archived · N and the "active + 30 days" range.
- **Conversation:**
  - **Header:** inline rename, a state chip, Stop run while a reply runs, Collaborate, and a ⋯ menu (Rename, Pin,
    Archive, Change runtime or model…, Agent settings).
  - **Meta chips:** type, store, runtime · model, and the run's spend against its budget.
  - **Replies:** streamed, with tool activity, markdown, evidence and numbered citations.
  - **Composer:** a draft kept per conversation, messages queued while a reply runs (with Cancel), document
    attachments, and the knowledge scope.
  - **Waiting states:** questions (`ask_owner`) and approvals wait inside the thread.
  - **Failures:** each one says why, with its fix: Check your Claude login, Change runtime or model, or Retry.
    Interrupted turns offer Resume.
  - **Saving:** Save to Knowledge Base on any reply.
  - **Opened from elsewhere:** a context chip links back to where the conversation was opened (Analytics, Product
    Research, a campaign or product, a run).
- **Right panel:**
  - **Details:** agent, runtime and sign-in state, store scope, tools with access and connection state, approval lines,
    budget and Stop after.
  - **Activity:** every run with runtime, cost or tokens, duration and errors.
  - **Knowledge:** the cards the latest reply used (the store's, then General's) and the findings saved there.
  - **Agent settings drawer:** Settings (deployed, autonomy, daily AI budget, store caps, schedule), Memory, History, and
    Flows for an Email/SMS seat.
- **Deploy:**
  - type: built-in roles, built-in types and the store's custom roles (custom roles narrow their base role's tools);
  - runtime: Claude, Codex, or Demo on demo stores;
  - model and effort, read from the runtime itself (Claude's account, Codex's CLI);
  - tools and knowledge, and permissions and limits (budget, Stop after, saving findings: Off / Ask me /
    Automatically);
  - presets and attachments.
  - The server validates every choice and refuses an unsupported combination with the reason. The run uses the
    choice exactly.
- **Teams** (Create team, or Collaborate from a conversation):
  - a shared objective and up to six participants, each on its own runtime · model · effort, with a lead;
  - the lead plans; independent tasks run in parallel (two of the same type at once) and dependent ones in order, each
    getting only its dependencies' contributions;
  - failed tasks retry as new runs, and disagreements and failures become Unresolved;
  - the lead writes a synthesis;
  - notes to the lead, Add agent, Stop team, Resume an interrupted step, and To: Lead afterwards in the team's own
    conversation;
  - team steps can't assign tasks and skip the reflection turn.
- **Switch-over:** old `/agents/<store:role>` links redirect to the workspace. Ask AI, Analytics, Product Research,
  Orders, Competitors, Creative and Knowledge open conversations with their context.

**Engine and server:**

- **Data:** migration #50 adds custom roles, configs, presets, conversations with full-text search, run config
  columns, and team fields on `squad_missions`.
- **Run manager:**
  - one run per conversation, with the global, per-store and per-agent limits;
  - each conversation running at the same time gets an equal share of the agent's daily budget;
  - Stop after doesn't count time spent waiting on an approval;
  - every create, send, retry, resume and team start is idempotent on its `client_request_id`;
  - after a restart, a conversation turn or team step that was cut off is Interrupted and waits for the owner's
    Resume.
- **Claude runtime:**
  - discovery of the account, models and effort levels, without a model turn;
  - run isolation: no settings sources, a cwd for agent sessions, and only the config's tools;
  - the app's tools served over an in-process MCP server;
  - WebFetch through the app's own safe reader (no private addresses, the store's blocked domains skipped, the page
    fenced as data).
- **Codex runtime:**
  - the installed CLI (`codex exec --json`) on the app's own `CODEX_HOME`, sandbox read-only, approvals never, and
    the features list cut down so the model reaches only the app's MCP tools;
  - Set up Codex starts `codex login` on that folder for the owner;
  - questions and approvals arrive over MCP, and Stop kills only that process tree.
- **Knowledge:**
  - retrieval reads only the store's knowledge and General, scoped by the conversation's deployed scopes;
  - every reference can be inspected;
  - `captureFinding` dedupes against store and General cards; saves made in Automatically mode are always
    Unreviewed.
- **Live updates:** each run's events are numbered. The client catches up after a dropped socket without doubling or
  losing text, and polls only while the socket is down.
- **Security:**
  - every listed by-id route returns 404 when `?store=` names another store;
  - ids in a request body that belong to another store are refused;
  - tools and retrieval refuse another store's data;
  - untrusted text (recaps, product listings, web pages, attachments, contributions) reaches prompts only inside
    nonce-fenced blocks;
  - starts and notes to the lead are rate-limited;
  - credentials never appear in a run row, a config, a GET response or the log.

## Changed areas

- 445 file changes across the lane's commits: +18,176 lines, −2,316. 67 test files were added or changed.
- **`apps/web/src/agents/`** (new, 28 files): Workspace, ListPane, Conversation, Details, settings, Deploy,
  CreateTeam, Team, CustomRoleForm, Popover, StateDot, attach, activity, markdown, fill, layout, urls, and their
  tests (`scale.test.tsx` among them).
- **`apps/web/src/`, elsewhere:**
  - `api/client.ts` (hooks), `components/` (Chat, AskPalette, Hero, Shell, ui, Onboarding, StoreForm, FlowLibrary);
  - `pages/` (Agents and AgentDetail as redirects, plus the "ask an agent" entry points in Analytics, Research,
    Orders, Competitors, Creative and Knowledge);
  - `knowledge/Research.tsx`.
- **`packages/agents/src/`:** `runs.ts`, `conversations.ts` (new), `teams.ts` (new), `configs.ts` (new),
  `codex.ts` and `fake-codex.ts` (new), `claude-engine.ts`, `engine.ts`, `fake-engine.ts`, `tools.ts`, `roles.ts`,
  `prompt.ts`, `missions.ts`, `kb-retrieve.ts`, `kb-sources.ts`, `kb-links.ts`, `kb-research.ts`, and the Codex
  0.163.0 fixtures. Also four playbooks and six platform packs (the agent type renames).
- **`apps/server/src/`:**
  - `routes/agents-conversations.ts`, `agents-teams.ts`, `agents-runtimes.ts` (new);
  - `routes/agents.ts`, `agents-scope.ts`, `agents-actions.ts`, `agents-flows.ts`;
  - `app.ts` (start guard), `db.ts` (migration #50), `approvals.ts`, `stores.ts`.
- **One-line touch points:** `kb/`, `product-research/trends.ts` (store guard), and `components/UpdatePrompt.test.tsx`
  (a flaky wait).
- **`packages/shared/src/`:** `index.ts` (additive types and contracts), `runtime-registry.ts`.
- **Docs:** this report, `docs/DESIGN.md` (AI Agents screen and the Codex engine), `docs/backlog/ai-agents.md`, and the
  reference boards and screenshots.

## The "Done when" checklist, line by line

Paths are test files, with the line where the test starts. Notes entries are in `docs/backlog/ai-agents.md`.

| Line | Evidence |
|------|----------|
| All items ticked; `pnpm check` and `pnpm build` green | Backlog: AA-01 to AA-27 ticked. AA-25b counts as ticked through the Blocked entry "Codex live smoke: needs the owner's sign-in". Check and build results are above. Linting doesn't apply. |
| **Store isolation** | `apps/server/src/routes/agents-scope.test.ts:74` is the table-driven sweep of every by-id route in decision 13: 404 for another store, nothing changed, and the record's own store works. Also `:158` (Product Research routes), `:109` (tools and retrieval) and `:244` (no credentials in any GET). Body ids: `agents-teams.test.ts:419` and `:444`, `agents-conversations.test.ts`. Switching stores: `apps/web/src/agents/ListPane.test.tsx:100` and `Workspace.test.tsx:154`, and the list is this store's only (`agents-conversations.test.ts:74`). Knowledge: `agents-references.test.ts:45`. |
| **Conversation management** | `agents-conversations.test.ts:249`: rename, pin, archive, search and reopen keep the messages, type, store and id. For teams, `agents-teams.test.ts:510` (added in AA-26) also checks that the team's own title follows. UI: `ListPane.test.tsx:80`, `Conversation.test.tsx:112`. |
| **Deployment** | The config row and the engine's received options: `agents-deploy.test.ts:60`. A switched-off draft tool is absent: `agents-deploy.test.ts:73`, `packages/agents/src/engine.test.ts:289` (Claude) and `agents-codex.test.ts:99` (Codex). Stop after with fake timers: `agents-runs.test.ts:768`. Refusals with a reason: `agents-codex.test.ts:82`, `packages/agents/src/configs.test.ts:29`, `codex.test.ts:236`, `Deploy.test.tsx:222`. |
| **Chat execution** | Streaming: `agents-runs.test.ts:93`. Failure: `Conversation.test.tsx:188`, `agents-live.test.ts:45`. Idempotent create, send, retry, resume and team start: `agents-conversations.test.ts:31` and `:102`, `agents-runs.test.ts:720`, `agents-teams.test.ts:419` and `:493`. Cancellation: `agents-runs.test.ts:242`, `agents-conversations.test.ts:102`. Queued sends: `Conversation.test.tsx:133`. Waiting for input: `agents-questions.test.ts:34` and `:74`, `Conversation.test.tsx:266`, `agents-codex.test.ts:193`. Approval waits: `agents-approvals.test.ts`, `agents-codex.test.ts:123`. |
| **Persistence** | The history is the server's: the thread route reads it back (`agents-conversations.test.ts:249`). Runs in flight at a restart become Interrupted: `agents-runs.test.ts:590`. Conversation turns and team steps wait for Resume instead of relaunching: `agents-runs.test.ts:756`, `agents-teams.test.ts:280`. Resume: `agents-runs.test.ts:734`, `Conversation.test.tsx:213`. Reconnect without lost text: `apps/web/src/api/live.test.tsx:174`. Reload and navigation were checked on the dev server in AA-21 (Notes). |
| **Knowledge access** | Store and General only, by deployed scope: `agents-references.test.ts:139`, `agents-scope.test.ts:109`. References can be inspected: `Details.test.tsx:145`, `Conversation.test.tsx:62`. captureFinding dedupe: `agents-findings.test.ts:54`. The confirmation names the real status, and Automatically is always Unreviewed: `agents-findings.test.ts:69` (both review settings), `:91` and `:119`, `Conversation.test.tsx:315`. |
| **Collaboration** | `agents-teams.test.ts:122` (added in AA-26) runs four participants end to end. Two Copywriters run at once. A dependent runs after its dependency with only that handoff. A failed task is recovered by a retry. A disagreement is left Unresolved, the synthesis is written, and assign_task is refused. Also `:67`, `:177`, `:235` and `:354`. |
| **Failure recovery** | A disconnected provider reads as a lost connection with Retry: `agents-live.test.ts:45`. Expired sign-in, rate limit, timeout, unavailable model and Codex signed out or missing each get their fix: `Conversation.test.tsx:188`, `engine.test.ts` (login expired, rate_limit), `agents-runs.test.ts:521`, `codex.test.ts:226`. Worker interruption ends in Resume: `Conversation.test.tsx:213`. The matrix as built is in the AA-21 Notes. |
| **Permissions** | Conversations: `agents-approvals.test.ts`, `agents-codex.test.ts:123`. Teams: `agents-teams.test.ts:371` asks before an ad change, and a participant narrowed off the tool can't reach it. A team can't widen a participant's tools or store: `agents-teams.test.ts:371` and `:419`. Config narrowing: `agents-scope.test.ts:212`. |
| **Interface quality** | `apps/web/src/agents/scale.test.tsx`: `:78` (500 conversations), `:91` (300-message thread), `:105` (25 stores, keyboard) and `:142` (three runs streaming at once). Long titles, widths from 1024 to 1920 px and keyboard-only use were checked in the browser in AA-22 (Notes). |
| **Completion criteria** (no dead controls, true states) | The AA-26 click-through, `.agent/aa26-click.mjs` with output in `.agent/aa26/click.txt`, covered 19 surfaces and found 0 controls without an action. A self-test plants dead controls and is flagged. Disabled buttons give their reason. "Not connected · Set up": `Deploy.test.tsx:268` and `Details.test.tsx:81`. "Claude only for now" and "Codex · Set up Codex": `Details.test.tsx:81`. "Set up Codex": `Deploy.test.tsx:222`. "Install the Codex CLI": `codex.test.ts:226`. The Demo data pill shows only on demo stores: `Workspace.test.tsx:72` and `:83`. |
| **Live smoke runs (decision 16)** | Claude: AA-25 Notes, and "Real services" below. Codex: not run, Blocked (see Limitations). |
| **Browser checks** | Orca's browser at 1280×800 (measurements and console, AA-24 Notes). Headless Chrome over CDP at 1366×728, 1440×900 and 1920×1080, compared with the three boards: `.agent/aa24/`. No console errors on any of them, or on the AA-26 run. |
| **styleseed-design-review** | Run in AA-24: scored 79 before, about 95 after. Remaining findings are answered in the AA-24 Notes. |
| **Final report and screenshots** | This file, and `docs/reference/ai-agents-final/`. |

## Real services versus fakes

**Ran against real services:**

- **Claude, one live run (AA-25):**
  - real routes on an in-memory demo database: an Analytics Specialist conversation on Glow Haus, narrowed to
    `store_summary` and `metrics_timeseries`, with a $0.50 budget;
  - account default model `claude-opus-5-5` at medium effort, not Fable;
  - done in 13.8 s for $0.112 (31,162 input and 1,053 output tokens);
  - one `store_summary` call, an answer that cited it and labelled the demo data, three store memories from the
    reflection turn, and nothing else started;
  - **proves:** the SDK takes the app's run options; app tools reach a real model over the in-process MCP server; a
    narrowed config holds; the real stream lands as a transcript with real usage; the reflection resumes the real
    session.
- **Claude discovery (AA-01, AA-13):** the real account and model list, read without a model turn (13 models on a Max
  login).
- **The real Codex CLI 0.163.0 (AA-01, AA-15):** `features list` under the run flags, `login status`, and one
  signed-out exec, recorded as the fixtures in `packages/agents/src/fixtures/`. No model turn.
- **Browser checks (AA-06 to AA-26):** the dev server in headless Chrome and Orca's browser, on demo stores with the
  demo engine.

**Only against fakes:**

- Every automated test: the scripted engine (`FRONTLINE_AGENT_ENGINE=fake`), `fake-codex.ts`, and jsdom with stubbed
  APIs and a fake socket.
- **Not exercised live:**
  - any Codex model turn;
  - approvals with a real model (the live run was read-only);
  - team runs;
  - Retry and Resume after a real provider failure;
  - external MCP servers (Meta Ads and the others aren't connected on a demo store);
  - any real store or ad account (by rule, nothing live was edited or spent).

## Limitations and what they need

1. **Codex live smoke not run.** It needs the owner to sign in to Codex on the app's folder. In PowerShell:
   `$env:CODEX_HOME='C:\Users\Xody2\orca\workspaces\FrontlineEcom\ai-agents\apps\server\.data\codex-home'; codex login`
   Then run AA-25b's single smoke: one read-only tool call, an `ask_owner` question, Stop while it waits, and a check
   that no question is left pending. Until then, Codex is verified only against the recorded fixtures and the fake.
2. **External MCP servers are Claude only** (decision 9). Under Codex, Meta Ads reads "Claude only for now" in Deploy
   and Details. Making it work needs Codex MCP wiring for remote servers with their OAuth.
3. **A team step waiting on an approval reads Running** in the plan, the tabs and the list. A step's status is its
   run's, which has no approval state. The participant's tab shows the approval card. A per-step waiting state would
   fix it if owners miss approvals inside teams.
4. **Create team has no cost estimate**, because the app has no per-model prices. It also has **no separate team name
   field**: the title comes from the objective's first line and is renamed in the team view.
5. **"At once" for teams is 1 or 2**, the server's store limit (`teams.ts` STORE_LIMIT). Change both together.
   Codex participants get Stop after 20 minutes, because a team row has no Stop after field.
6. **Reply links to a campaign or product open its page.** Analytics and Product Research have no per-record view yet.
7. **The reflection turn writes store memory even when a config narrows its tools.** It is the squad's memory feature,
   not a tool, and its cost counts toward the run's budget. Owners who expect a narrowed agent to write nothing
   should know.
8. **Smaller ceilings, each marked `ponytail:` in the code:**
   - a session that expired is recapped from its last exchange only (`runs.ts`);
   - the conversation search index is rebuilt whole on each write (`conversations.ts`);
   - the Codex model list reads its first page (8 models in 0.163.0);
   - outside Windows, Stop kills only the Codex child process;
   - runtime checks are cached for 5 minutes per process.
9. **Outside this lane:** the Knowledge Base lane's `useKbTask` still polls every 2 s while a task runs.

## Screenshots

`docs/reference/ai-agents-final/`, demo stores on the dev server, headless Chrome, no console errors:

- `conversation-1280x800.png`, `conversation-1440x900.png`, `conversation-1920x1080.png`: the workspace with a
  conversation open, the Details panel, and a long title truncated.
- `team-1280x800.png`, `team-1440x900.png`, `team-1920x1080.png`: the team view with its plan, contributions,
  Unresolved and synthesis.
- `deploy-1440x900.png`: Deploy an agent. `create-team-1440x900.png`: Create a team.
- `settings-drawer-1440x900.png`: the agent settings drawer. `empty-1440x900.png`: the workspace with nothing open.

The design-pass screenshots at all four sizes, and the earlier "before" screenshots, are kept in `.agent/aa24/` and
`.agent/before/`.
