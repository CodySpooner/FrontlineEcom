# Backlog — ai-agents lane (AI Agents page redesign)

Repo rules: `CLAUDE.md` (worker loop, hard rules). The owner's full spec, verbatim, is `docs/features/ai-agents.md`. It
is the source of truth for *what*. This file is the *how* in this repo: the chosen design, the decisions already made,
lane ownership, the items and the completion checklist. The code survey behind the decisions is
`docs/features/ai-agents-codemap.md`. Read all three and open the three design references before AA-01.

## What the owner asked for (verbatim, 2026-10-28)

The spec asked for four design concepts on one artboard, then a stop for the owner's choice. The four concepts were
A Organized Chat Workspace, B Agent Inbox, C Focused Conversation Studio and D Collaborative Agent Workspace, with 12
frames on one design canvas. The owner picked:

> yea lets go with A's Workspace design , with Bs Team View , and A's Deploy Design

The spec then says (§13): build in the order **Foundation → Approved interface → Store-scoped conversations → Runtime
configuration → Knowledge integration → Collaboration → Reliability → Verification**. Keep checkpoints and a short
record of completed work, current work, failed checks and blockers (the Done, Blocked and Notes sections below). Make
routine decisions within the approved scope yourself. Stop only for missing credentials, destructive actions,
significant scope changes or other genuine approvals. For this unattended run that means: don't ask the owner and
don't halt. Where the spec says to stop (missing credentials, destructive actions, significant scope changes, other
genuine approvals), write it under Blocked with exactly what the owner must do, skip that part, and take the next item
(CLAUDE.md worker loop).

## The design

- `docs/reference/ai-agents-workspace.png` is A's workspace: the page.
- `docs/reference/ai-agents-team.png` is B's team view. Only its **right-hand thread** is approved, and it sits in A's
  centre pane (see "Team view" below). B's store rail and inbox list are not part of the build, except the team row's
  participant sub-rows (see Teams).
- `docs/reference/ai-agents-deploy.png` is A's Deploy dialog.
- The `.html` files next to them are the same boards as static HTML with inline styles. Open them for exact colours,
  type sizes, spacing and copy.
- **House primitives vs the boards:** where a ui.tsx primitive draws differently from a board, this page matches the
  board through a new opt-in prop or variant in ui.tsx. Never change a primitive's default look, because other pages
  use it (spec §9). On this page:
  - Segmented's selected option is grey #232329, in the body font, with no glow, and an option can carry a dot
    (Deploy's Runtime and Effort).
  - Tabs show only the red underline, with no red-soft fill, and a tab can carry a status dot (the right panel and
    the participant tabs).
  - The spend bar uses ProgressBar tone='muted'.
  - Status dots have no glow and no blink. Running keeps only the board's 3 px halo.

  Hero (including its icon glow), Button and Switch stay as the house draws them, and AA-24 doesn't count them as
  differences.
- The boards were drawn at 1440×900 (the dialog at 688 px wide). Where the rules below differ from a board, follow the
  rules.
- Every store, number, name, model and date on the boards is a placeholder. Never ship it. Production screens show real
  data or a truthful empty, setup or error state.
- The boards' top bar, sidebar and profile chip are the app's own Shell and Hero. Don't rebuild them from the board.
- **Board capabilities the app doesn't have stay out.** The workspace board's approval card, "Create 3 paused
  campaigns in Meta Ads · Reserves $1,400", and the Deploy toggle "Draft campaigns in Meta" show a capability the app
  doesn't have. The ad approval kinds are only pause and budget (`propose_ad_change`). Build approval cards and
  permission toggles from the tools each type really has. Don't add campaign creation.
- For this page, the spec and these three boards replace `docs/DESIGN.md` §4 item 2 (store tabs and squad cards with
  portraits) and the AI Agents screen in `docs/reference/ui-reference.webp`. When CLAUDE.md's worker loop says to
  compare against `docs/reference/`, compare this page with the three boards only. DESIGN.md's portrait rules still
  apply to the other pages (decisions 1 and 17). AA-27 rewrites DESIGN.md's AI Agents section.
- **A control renders only once the item that makes it work has shipped:** Deploy agent, New conversation and
  'Change runtime or model…' (AA-14), Create team and Collaborate (AA-20), the Codex runtime option (AA-15), the
  question card (AA-16), attach, Deploy's attachments, the Knowledge tab and the composer's knowledge chip (AA-17),
  Save to Knowledge Base and Deploy's 'Save findings to knowledge' row (AA-18). Until then the control is absent, not
  disabled (spec §12: no dead buttons). This holds from AA-06, because AA-12's 'Ask Ad Strategist' opens the
  workspace from main.
  - The same holds for 'Agent settings' in the type and ⋯ menus (AA-09), 'Role instructions and checks' (AA-11) and
    the Details "Change…", which is 'Change runtime or model…' (AA-14).

### Page frame

- **Header:** the page uses the app's `Hero`, which keeps the `.titlebar` Electron drag region, Ask AI, the bell and
  the profile chip. Add a `compact` prop to `Hero`: one 52 px row with the title, the controls and no subtitle, as on
  the board. Only this page uses it; every other page keeps today's Hero.
  - Title "AI Agents".
  - The "Demo data" pill (dashed amber, as on the board) shows only while the selected store is a demo store
    (`connected` false). It is the only demo marker in the header.
- **Body:** a full-height three-pane workspace under the Hero.
  - It fills the window like `apps/web/src/knowledge/fill.ts` `useFill` does. Copy those ten lines into the new
    folder; don't move the knowledge lane's file. Cancel Shell's padding with `-mx-[22px] -mb-8`, as
    `knowledge/Artboard.tsx:266` does, so the panes run edge to edge as on the board.
  - **Left pane** 292 px (store and conversation list). It can be dragged between 240 and 400 px.
  - **Centre** takes the rest, at least 480 px (conversation or team thread).
  - **Right panel** 316 px (Details / Knowledge / Activity). It can be dragged between 280 and 420 px and closed with
    its toggle (the board's top-right icon).
  - Widths, the right panel's open state and its selected tab (Details / Knowledge / Activity), and collapsed groups
    persist in localStorage. Wrap every read and write in try/catch, like `fe.stores`.
  - Stored widths are preferences. Rendered widths are clamped so the centre keeps 480 px. In three-pane mode, shrink
    the right panel toward 280 first, then the left pane toward 240. In two-pane mode, left ≤ workspace − 480, and
    never under 240. Drag handles stop at the same limits. The clamp is one pure function with a unit test: a 1100 px
    workspace with stored 400/420, and a 792 px workspace with stored 400.
- **Navigation state** (spec §9): the thread's scroll offset is kept per conversation, for the session, in a
  module-level Map. When the owner comes back to a conversation, the thread returns to that offset instead of jumping
  to the bottom. That holds whether the owner returns by Back or through the sidebar's AI Agents link (the desktop
  app has no Back control). If the owner was at the bottom, the thread still follows new output. Activity blocks keep
  their default.
- **Smaller windows:** the breakpoints follow the **workspace's own width** (a container query or ResizeObserver),
  not the window. The shell sidebar takes 232 px (Body cancels the gutters), and the desktop window's minimum is
  1024×680.
  - At 1100 px and wider, all three panes show.
  - From 720 to 1099 px, the left pane and the centre show. The right panel opens as an overlay drawer from its
    toggle.
  - Below 720 px only the centre shows. The left pane is a drawer opened from a list button in the conversation
    header.
  - So a 1366 px or 1440 px window shows three panes (a 1134 or 1208 px workspace), and the 1024 px minimum shows
    the list and the centre (792 px).
  - Nothing scrolls sideways at any size down to 1024×680.
- **URL state** (one helper builds every agent URL):
  - `/agents?store=<id>` is a store's workspace. With no conversation open, the centre shows the empty state: how to
    start, and the store's recent conversations.
  - `/agents/c/<conversationId>?store=<storeId>` is a conversation.
  - `/agents/t/<teamId>?store=<storeId>` is a team.
  - The one URL helper always adds `store`, and so do the notification links the server writes.
  - The store is always taken from the conversation or team record, never from the global store filter. The URL's
    store is only the lookup key that decision 13 requires. Scope comes from the record, and a mismatch is a 404
    that shows the not-found state.
  - With no `?store=`, `/agents` opens the first store picked in the global `StoreFilter` selection, else the first
    store. The last-opened conversation per store is remembered locally.
- **Legacy URLs keep working**, because saved notifications, other modules and other lanes' tests link to them:
  - `/agents/<storeId:role>`, both URL-encoded and raw-colon (`nav.ts` already handles both), opens that type's most
    recent conversation in that store, or the store's workspace with that type's group expanded if it has none.
  - `?run=<runId>` opens the conversation that holds the run and scrolls to it. A run with a team_id opens that team
    on the participant's tab, scrolled to the run (the Ecosystem's mission links use this). Any other run with no
    conversation opens read-only in the centre (decision 4).
  - `?tab=settings|memory|history|flows` and `?by=agent` open the agent-type settings drawer on that tab.
  - Keep `NAV[1]` as AI Agents. The ecosystem lane relies on it.
- **Keyboard:**
  - `/` focuses the list search, only when no modifier is held, focus isn't in an input, textarea, select or
    contenteditable, and no dialog is open.
  - ↑/↓ move through the list (roving tabindex) and Enter opens the item.
  - Esc closes the innermost layer first: popover, then drawer, then dialog.
  - In the composer, Enter sends and Shift+Enter adds a newline. A `Ctrl+Enter` send is not needed.

### Left pane (A)

Top to bottom, as on the board:
- **Store switcher button:** colour square, name, platform and niche, chevron.
  - It opens a popover listing every store with its colour, name and platform, plus how many of its conversations are
    running or waiting. The popover caps its height to the window and scrolls. ↑/↓ move through the stores, Enter
    switches, and Esc closes it.
  - Under the button, one line: "N other stores · M agents running there" (live, real counts; hidden when there is one
    store).
  - Switching stores changes only the view. It never touches another store's runs, and it keeps each conversation's
    draft.
- **Deploy agent** (primary, red) and **Create team** (secondary).
- **Search** "Search this store's conversations" with the `/` hint. It searches the server, over titles and message
  text in this store, and pages its results.
- **Pinned:** pinned conversations and teams.
- **Teams:** the store's teams within the list's range, running teams first, then ended ones, newest first.
  - While a team runs, the right-aligned meta keeps the board's 'N agents' and status dot, and the dot's aria-label
    gives the status word (Running, Approval, Interrupted…).
  - After the team ends, the meta reads 'Ready', 'Ready · N unresolved', 'Failed', or 'Stopped' (grey dot, like a
    cancelled conversation, see Status dots) for a team the owner stopped. An ended team opens in the team view with
    its synthesis, and To: Lead still works there (decision 12).
  - A team row expands into its participant sub-rows (role, status, current task), as in the B board's list.
- **Agents**, grouped by agent type ("Group: type"):
  - Each type is a collapsible header with its count of conversations.
  - Under it, conversation rows show a status dot, the title (one line, ellipsis) and a right-aligned meta: the status
    word for its state (decision 5) when it is Running, Approval, Needs reply, Queued, Failed or Interrupted, else the
    last activity date.
  - Team conversations (decision 3) are listed only under Teams, never in these groups.
  - Types with no conversations fold into one "N more agent types · no conversations yet" row. It expands to show them,
    each with "New conversation".
- **Footer:** "Archived · N" opens the archived list in the pane, and "Showing active + 30 days" sets the range.
  - Older conversations load on scroll, 50 at a time, from the server.
- **Status dots** (one meaning everywhere on the page):
  - running is solid green #3ddc84;
  - awaiting approval is amber #f2b84b;
  - waiting for input is blue #7aa7ff;
  - failed is red #ff5a66;
  - completed is grey #55555e;
  - cancelled uses the completed grey dot, and its row meta is the date. Its text label (in aria-label and the status
    chip) is 'Stopped', the existing RUN_STATUS label;
  - idle is a hollow ring;
  - queued is a dashed ring;
  - interrupted is a hollow amber ring.
  - Every status also has a text label (in the meta or in `aria-label`), never colour alone.
- **Row menu** (⋯ on hover or focus, and the context-menu key): Rename, Pin/Unpin, Archive/Unarchive. A type header's
  menu has "New conversation" and "Agent settings".

### Centre: conversation (A)

- **Header row:**
  - The title, editable inline (pencil, Enter saves, Esc cancels). It stays one line with an ellipsis and the full
    title in a tooltip. The board wraps it onto three lines at 1440: that is a board bug, don't copy it.
  - A status chip with text.
  - **Collaborate**: starts a team from this conversation, with this agent as lead and the objective prefilled.
  - **Stop run**, shown only while a run of this conversation is queued or running.
  - A ⋯ menu: Rename, Pin, Archive, "Change runtime or model…", Agent settings. The board's Export (in the ⋯ menu's
    label) is not built. The spec's conversation management is create, rename, search, pin, archive and reopen, and
    Copy covers a single reply.
- **Meta chips row:**
  - the agent type;
  - the store with its colour square (not clickable: the store is fixed);
  - "Runtime · Model · Effort ▾", which opens the runtime popover;
  - this run's spend against its budget, for example "This run $0.42 of $3.00", or "This run $0.42 · No limit" when
    its config sets no budget. Codex runs show tokens instead (decision 9). It is one chip, not wrapped text.
- **Thread:**
  - The thread and the composer sit in one centred column, at most 700 px wide (margin auto), and owner bubbles are
    at most 520 px.
  - Owner messages are right-aligned bubbles with time.
  - Agent replies span the reading column with a header: role initials in a square, the agent type, runtime and
    model, and the time. No portraits and no character art (spec §2).
  - **Activity block** above each reply's text: "Worked for 3m 12s · 5 steps", collapsible, open while running.
    - Each step is a real transcript event shown as a one-line plain sentence: a tool call and its outcome, knowledge
      retrieved, an approval wait, a compaction, an error. It has an icon for done, running, warning or failed.
    - "Tool calls & sources" opens the raw details (the existing tool `<details>` rendering).
    - Never show the model's private reasoning, and never invent progress text.
    - The sentences come from one per-tool phrase map (tool name and outcome → "Read 14 days of Meta campaign data").
      A tool missing from the map shows its name. A line like the board's "Checked the plan against the request"
      appears only when a real event backs it; otherwise leave it out.
    - save_finding is always in the phrase map. Its step uses the matching kb_written event and the same wording as
      the manual save. A refused save (an archived or rejected match, or the cap of 5 reached) is a warning step that
      gives the reason. Each save is one step, and kb_written doesn't render as a second line.
  - **Reply body:**
    - Markdown, including tables.
    - Evidence tags: the agent marks claims `[measured]`, `[research]` or `[hypothesis]` (rule in its instructions), and
      the UI renders each as the board's small tag.
    - Citations: each `[kb:id]` renders as a red superscript number, in order of first use, and a card cited again
      reuses its number. On this page that replaces KbCite's inline title link. Under the reply sits the board's row
      of numbered source chips, one per cited card: number, title and tag. The tag is the card's KB_STAGES label
      (hypothesis amber, supported and tested blue, validated green). A General card shows 'General'. Chips and
      superscripts link to `/knowledge?card=<id>&ws=<run's store>`. An id that doesn't resolve stays as written, and
      an id outside the store and General shows 'not available in this store'. Ordinary markdown links stay inline
      links through webHref.
  - Under a finished reply: **Copy**, **Save to Knowledge Base** and **Retry** (Retry only on the latest reply, and
    only when it failed or the owner wants another attempt).
  - **Approval card** inline where the agent asked: title, reason, amount, then Deny… / Approve. Reuse ApprovalCard
    and DenyReason with one new prop, tone='amber', used only on this page:
    - border rgba(242,184,75,.38) and fill rgba(242,184,75,.05);
    - the label 'Approval needed · <APPROVAL_KINDS label>' in #f2b84b, in Inter (the board's .lbl style);
    - the title, reason and amount on the left, and Deny… then Approve, right-aligned.
    ApprovalExtras stays inline under the reason, so there is no Details button. The default tone keeps today's red
    card, so Notifications, Automation, Builder and the Dashboard don't change. The branch on kind for `question` and
    `kb.save` (decision 11, AA-16) lives in the same component. Add `--color-amber: #f2b84b` to the @theme in
    apps/web/src/index.css.
  - **Question card** (waiting for input, AA-16): the agent's question, answered from the composer, with "Answering:
    <question>" above the text field.
  - A **handoff divider** when the runtime or model changed (decision 10), and an **interrupted** banner with Resume
    (decision 8).
- **Composer**, pinned at the bottom:
  - attach (paperclip, decision 11);
  - the knowledge-scope chip "Store + General knowledge", which opens the Knowledge tab;
  - "Draft saved" after a pause in typing;
  - Send (red round button).
  - While a run is going, Send queues the message ("Queued: sends when this reply finishes", with Cancel). Stop is in
    the header.

### Right panel (A)

Three tabs: **Details**, **Knowledge** (with a count) and **Activity**.
- **Details:**
  - **Agent:** the type, its description, and "Role instructions and checks", which opens that type's contract
    (decision 2).
  - **Runtime:** runtime with connection status (for example "Claude · signed in"), model and effort, "Change…", and
    the handoff note.
  - **Store scope:** "<Store> only", with a lock and "Fixed when the conversation started. Other stores' data is never
    read." If the run's config enabled 'Compare with my other stores', the second line instead reads: 'Also reads your
    other stores' names, platforms and niches and their totals (revenue, profit, margin, ad spend, ROAS, orders, health
    and revenue change) for comparison. Turned on when this conversation started.' The panel reads the flag from the
    conversation's or participant's config, the same source the AA-09 tools endpoint uses.
  - **Tools:** each tool group the agent has, with its access (read, drafts need approval, on). Under the autopilot
    condition of Approvals and budget (below), the group holding propose_ad_change reads 'autopilot up to the caps
    below' instead of 'drafts need approval'. Tools that aren't connected show "Not connected · Set up", linking to
    that integration's setup.
    - No API lists tools or their connection state today. Add one store-scoped endpoint (AA-09) that returns the
      tool groups of the conversation's config, each with its access and the state of the integration or MCP server
      behind it.
  - **Approvals and budget:** 'Publishing, live-store edits and contacting customers always ask you first.' Then
    either 'Spending always asks you first' or, under the same condition as the Deploy row (propose_ad_change among
    the run's effective tools), one line per enabled rule: '<kind label> up to $X/day is auto-approved (autopilot)'.
    Read autonomy live, because requestApproval reads it when it is called. Then this run's spend bar and the
    conversation's limits. An empty budget or Stop after shows as 'No limit' (decision 9).
    - One helper builds these lines and the Deploy row, and applies that condition. It comes from AgentDetail.tsx's
      autopilot summary (AgentSettings, around lines 314 and 357-358) and moves into `apps/web/src/agents/` at AA-09.
  - Footer: run id, start time, and "can be continued after a restart" or "ended".
- **Knowledge:** the cards retrieved for the current run (in the prompt, searched, cited), grouped Store and General.
  Each card shows its stage, links to `/knowledge?card=<id>&ws=<store>`, and lists the findings saved from this
  conversation.
- **Activity:** this conversation's runs, newest first: status, runtime and model, duration, cost or tokens, and any
  error with its recovery action.
- With a team open, the panel shows the team's details instead: participants with runtime, model and status; limits;
  store scope; the lead. The team's store scope uses the same wording when any participant's config enabled it. It
  is closed by default for teams, because B's thread needs the width.

### Agent-type settings drawer

Everything the current AgentDetail tabs do stays reachable through a right drawer (the existing `Dialog` drawer). It
opens from a type header's menu, the conversation ⋯ menu and (from AA-14b) the legacy `?tab=` URLs. Its tabs reuse
the existing components:
- Settings: autonomy, daily budget, schedule, niche learnings.
- Memory.
- History: all of the seat's runs, including runs from before conversations existed. A row opens its conversation, or
  the read-only run view (decision 4).
- Flows: Email & SMS only.

### Deploy dialog (A)

688 px wide, centred, scrolling inside below the header.
- **Dialog:** Use the house Dialog (ui.tsx:347). Today it is fixed at 520 px, with a title-only header and a padded
  body, has no footer, and scrolls as a whole. Add optional props width, subtitle, headerExtra and footer:
  - Deploy and Create team pass width 688.
  - footer is rendered after the body as its own bar (border-t border-line px-5 py-3.5). It holds the caption, the
    footer menu with Save as preset, Cancel and the start button.
  - With footer set, the <dialog> becomes a flex column capped at the viewport (max-h-[calc(100dvh-32px)]
    overflow-hidden). The header and the footer stay put, and only the body scrolls (flex-1 min-h-0
    overflow-y-auto).
  - Through headerExtra, the board's dashed amber 'Demo data' pill sits left of Close. It shows only while the
    dialog's selected store is a demo store.
  - Dialogs that pass none of these props look as they do today. Check at 1024×680.
- **Store:** defaults to the selected store. It can be changed here and is fixed once the conversation starts. The
  subtitle reads 'Starts a new conversation. The store can't be changed after it starts.' Don't use the board's
  'Everything below can be changed later except the store', because only the title, runtime, model and effort can
  change later.
- **Start from a preset:** the dialog opens with a type chosen, either the type it was opened from or else the first
  type tile. The select lists that type's Default preset, then the owner's saved presets for that type or its custom
  roles. The Default preset is tagged 'Default', as on the board, and is selected when the dialog opens and whenever
  the type changes. Picking a preset fills every field. A preset saved for a custom role of this type also selects
  that custom role. 'Save as preset' sits in the footer menu.
- **Agent type:** one tile per type (name and a 2–4 word description), 4 columns. "+ Custom role" opens the custom-role
  form (decision 2).
- **Runtime:**
  - A Claude | Codex segmented control. Each option has a dot: green when connected, grey with a reason when not.
  - On a demo store a third option, "Demo (free)", is selected by default (decision 9).
- **Model:** a select with the discovered models, each name plus a short descriptor.
- **Effort:** a segmented control with only the levels this model supports (Codex ultra shows disabled with its
  reason, decision 9).
- **The caption under those three** says where the lists came from, for example "Models and effort levels come from
  your Claude connection, checked 2 min ago". When discovery failed it says "from the app's model list (<registry
  version>); not confirmed on this account".
- **Conversation title:** suggested from the objective and editable. The "Suggested" badge disappears once edited.
- **Objective:** a textarea. It becomes the first message.
- **Tools and knowledge** (folded): the type's tools with connection state, knowledge scopes (Store + General; never
  another store), "Compare with my other stores" (off by default, Analytics Specialist only, decision 13) and
  attachments.
- **Permissions and limits** (open):
  - 'Ask before publishing: Always' stays locked. No publish kind can use autopilot.
  - 'Ask before spending money' stays locked, and its value comes from the store chosen in the dialog and the type's
    seat. It reads 'Always' unless the seat's autonomy is autopilot and the store has an enabled StoreCaps.autopilot
    rule for a kind with APPROVAL_KINDS[kind].autopilot (today ads.set_budget and ads.pause_campaign), and the run's
    effective tools (runTools, decision 13) include propose_ad_change. Then it reads 'Autopilot: <kind label> up to
    $X/day[, …] · Agent settings', and that link opens the drawer.
  - Type-specific draft switches, one per draft-producing tool the type really has (page drafts, email and SMS flow
    drafts, creatives, ad pause and budget proposals). Not the board's "Draft campaigns in Meta": the app can't do
    that. A switch that is off removes that tool from the run (runTools). 'Tools and knowledge' shows the tools only,
    with no per-tool toggles.
  - "Save findings to knowledge": Ask me / Automatically (unreviewed) / Off.
  - Budget for this run (Claude only; hidden for Codex and Demo, decision 9).
  - "Stop after" minutes (optional, 'No limit' when empty; required for Codex, prefilled with 20, decisions 7
    and 9).
- **Footer:** "Checked by the app before it starts. An unsupported combination is refused with the reason." Then
  Cancel and **Start conversation**.
  - Start sends the configuration to the server, which validates it (decision 9). A refusal shows its reason inline on
    the field it concerns, and nothing starts.

### Team view (B's thread in A's frame)

- **Header line:** "Team · <store> · $4.10 of $10.00 · max N at once · 2 retries per task".
  - N is the real limit (decision 12).
  - The money part counts Claude participants only. A team with no Claude participant leaves it out, and its Create
    team dialog hides the team budget field. There is no team-level time limit.
- **Title row:** the team name (editable) with **Add agent** and **Stop team**.
- **Tabs:** Thread | one per participant, each with a status dot and "lead" on the lead's tab.
  - A participant tab shows that participant's assignments and full contributions: the runs, transcripts and
    activity.
  - A participant sub-row in the left pane opens the team on that participant's tab.
- **Column:** the team thread and its composer use the same centred column at 760 px.
- **Thread events**, in order, each with avatar initials, a name and a time:
  - "You · set the objective";
  - "<Lead> Lead · split the work into N tasks", with the numbered task list showing assignee, "after N" dependencies
    and a live status pill per task. An interrupted task shows Interrupted with **Resume** (decision 12);
  - each participant's contribution card: "finished · <runtime model> · $cost", the summary, and "N sources · Open full
    output";
    - "Open full output" opens that participant's tab, scrolled to the run.
    - "N sources" counts the cards that run cited plus the URLs in its contribution's evidence[]. It is hidden
      only when both are empty. It expands into the source-chip row for the cards, then the URLs as webHref links.
  - handoff lines ("→ Brief handed to Ad Strategist"), one for each dependency passed on;
  - **Unresolved** callouts for disagreements or failed tasks, with "Compare both" (opens the two contributions side
    by side);
  - the dashed synthesis placeholder until the lead's synthesis arrives, then the synthesis itself;
  - after the synthesis, the team thread lists the team conversation's follow-up runs (owner message, lead reply) in
    order, with that conversation's queue, Stop and Retry.
- **Composer:** "To: Lead" is a static label with no chevron, because only the lead receives notes (decision 12).
  - While the team runs, the message is stored as a note in owner_notes_json, and the synthesis receives it.
  - After the team ends, it is an ordinary send in the team's conversation and starts a lead run there.
- **Not built** from the board:
  - "shared a draft · still working". Handoffs happen when a task finishes.
  - "lands in your Needs you list". Instead, a notification is sent and the team row shows "Ready".
- **Create team dialog:** A's dialog style and width. It uses the same width, subtitle and footer props.
  - Store.
  - Shared objective.
  - Participants · N (up to 6), then "+ Add participant". Each row has the type, a runtime · model · effort select
    (Codex ultra shows disabled with its reason, decision 9), a **Lead** radio, and "New", or "Use <conversation>".
    - The conversation must be of the same type, in this store and not archived, and its config must pass
      validateConfig and the team rules (no Codex ultra, decision 9). It lends its config, so the row shows that
      config's runtime · model · effort, and changing any of them writes a new config.
    - It also lends a recap for that participant's first task. The conversation itself isn't touched. A
      conversation that doesn't qualify shows why.
  - Limits: team budget, at once (capped at the real limit), retries per task (0–2), and "Sub-teams: Off" (locked).
  - Footer: an estimate when one can be computed, then Cancel and **Start team**.
  - "Collaborate" in a conversation opens this dialog prefilled.

## Decisions already made (coordinator's calls; change one only with a reason written under Notes)

1. **Lane scope.**
   - This lane builds the whole feature across web, server, agents and shared. Every other lane is stopped, so
     cross-package edits are expected; keep each surgical and covered by tests.
   - Don't rebuild unrelated modules (spec §9).
   - Leave `apps/web/src/ecosystem/**` alone: the legacy URL aliases keep its links working. Exception: a test or type
     error your shared-type change causes there may get the smallest fix.
   - Touch the knowledge lane's files (`pages/Knowledge.tsx`, `apps/web/src/knowledge/**`, `apps/server/src/kb/**`,
     `packages/agents/src/kb*.ts`) only at these places: the AA-17 and AA-18 touch points named in those items
     (`kb-retrieve.ts` for the query and kb_conflicts, `kb-sources.ts`'s untrustedBlock, `kb-links.ts`'s
     captureFinding), imports that need no edit (readUpload), and decision 2's rename sweep. Nothing else.
   - Portraits (`Art.tsx`, `public/art/**`) stay for the other pages that still use them. This page stops using them.
2. **Agent types.**
   - Role ids stay as they are: they key agents, approvals, memory, KB retrievals and the ecosystem seats.
   - Display names follow the approved design and the spec:
     - `product_hunter` becomes "Product Researcher";
     - `creative_studio` becomes "Creative Strategist";
     - `market_analyst` becomes "Analytics Specialist" (it already answers from measured data; its instructions gain
       the measured-vs-hypothesis rule);
     - the others keep their names.
   - **Rename sweep.** Names change in `AGENT_ROLES` only, and every page, notification and prompt reads them from
     there. In the same item, grep `apps/` and `packages/` for `Market Analyst|Product Hunter|Creative Studio`, and
     replace the old names in every string an owner or an agent reads: mission templates, tool text, server notices
     and errors, web copy. Leave comments unchanged, and leave two strings unchanged: `nav.ts`'s Ad Creation page
     title "Creative Studio" and the ecosystem office room name (shared `index.ts:1212`). Update tests in any lane
     that assert the old names. These edits are an exception to decision 1's knowledge-lane and ecosystem limits.
   - Marketing Strategist and General Researcher are built-in types defined in code in `roles.ts`, in the shape of a
     custom role. Their ids are `builtin:marketing_strategist` and `builtin:general_researcher`, and their base_role
     is `market_analyst`. Each has a name, a description, its own full contract and KPI, and a narrowed tool list:
     - Marketing Strategist: store_summary, metrics_timeseries, list_campaigns, list_products, search_knowledge,
       search_memory, write_memory. Drafts only, in its answers.
     - General Researcher: store_summary, WebSearch, WebFetch, search_knowledge, search_memory, write_memory.
     - They run on the store's `market_analyst` seat and share its autonomy, daily budget and memory. Their prompt is
       built from their own name, contract and KPI, never from the base role's prompt, KPI or playbook. `SQUAD_RULES`
       and the platform, niche, store and knowledge layers are unchanged.
     - A conversation's type is its config's custom role (built-in or saved) when set, otherwise its seat's role. The
       left list groups by that type. The reply header, Activity and the run's notifications name it from the config,
       not from `AGENT_ROLES[role]`. Their "Agent settings" opens the `market_analyst` seat drawer, titled as the
       shared Analytics Specialist seat.
     - `AgentRole`, `AGENT_ROLES`, seat rows, playbooks, `Art.tsx`, `kb-retrieve.ts` AREAS and the ecosystem stay
       unchanged.
   - **Role contract:** every type gets a structured contract in `packages/agents/src/roles.ts` that its prompt is built
     from and the UI shows under "Role instructions and checks". The contract has five parts:
     - responsibility;
     - workflow: establish the business, objective, evidence, permissions and deliverable before substantial work;
     - required tools and knowledge areas;
     - expected outputs;
     - quality checks: before finishing, check the output against the request and list unresolved questions. Never
       claim a tool action that didn't happen.
     - Specialization comes from that contract, the tools and retrieval, checked by evals. It never comes from
       decorative profiles.
     - The workflow and quality-check steps go into every run's prompt (the contract and `SQUAD_RULES`), not only into
       the UI. Today's playbooks and `SQUAD_RULES` have neither.
   - **Custom roles:** a custom role is a name, a description and extra instructions on top of a **base built-in
     role**. It runs on the base role's seat, tools and permissions: it can narrow tools, never add them. It is stored
     per store (or all stores) in a new table.
   - **Presets:** a preset is a saved deploy configuration with a name: type or custom role, runtime, model, effort,
     tool and knowledge choices, permissions and limits, and an optional objective template. It can be saved per store
     or for all stores.
     - Each type has exactly one built-in preset defined in code, tagged "Default". That includes the two built-in
       types above. It holds the seat default's tools, knowledge scopes and limits (decision 9): the type's tools with
       every draft switch on, Store + General, no run budget and no Stop after (store and seat caps apply), save
       findings Off. It adds a short task name (Ad Strategist → "Campaign planning"; name the others the same way).
       It has no objective template and never names a runtime, model or effort, which fall back to the default
       config (decision 9). A custom role starts from its base type's Default.
     - Every other preset is one the owner saved in `agent_presets`. The Default preset only prefills the Deploy
       dialog. It never becomes the default config of a conversation created without the dialog.
3. **Data model.** These are the spec's five concepts. New tables go in appended migrations: the next number is #50 at
   0744db16; confirm it. Each is labelled `/* NN (ai-agents: AA-xx) */`. AA-02 writes every table, column and index
   this decision lists. That includes `agent_custom_roles`, `agent_presets`, `conversations_fts`,
   conversations.client_request_id with its index, and the `squad_missions` columns. Later items add no migrations
   unless a Notes entry says why.
   - Use only CREATE TABLE, ADD COLUMN, CREATE INDEX, and CREATE VIRTUAL TABLE … USING fts5 for `conversations_fts`
     (below). Foreign keys are on inside every migration transaction, so a table rebuild can't turn them off, and no
     later migration may DROP or rebuild `conversations`.
   - **Role/template** = the code registry (`AGENT_ROLES`, `ROLES`, the contracts) plus `agent_custom_roles` (id,
     store_id NULL means all stores, base_role, name, description, instructions, tools_json (the narrowed tool list;
     NULL means the base role's tools), created_at, archived_at).
   - **Configured agent** = `agent_configs`. It has these columns:
     - id;
     - store_id (immutable);
     - agent_id, the `store:role` seat that holds autonomy and the daily budget;
     - custom_role_id: an `agent_custom_roles` id or a `builtin:` id (decision 2). It has no foreign key, and
       validateConfig (decision 9) checks it;
     - runtime, model, effort;
     - tools_json, knowledge_json, permissions_json (limits, the draft switches, save-findings mode);
     - created_at.
     - A conversation points at one config. "Change runtime or model" writes a new config and a handoff (decision 10);
       a config is never edited in place or deleted (only the store cascade removes it). Every run records the
       config_id it ran with, a team step its participant's, so history stays exact.
     - tools_json, knowledge_json and permissions_json hold names and limits only, never MCP server definitions,
       headers, env, tokens or credentialed URLs.
     - Team participants are configs too.
     - `agent_presets` (id, store_id NULL means all stores, name, config template json, created_at) feeds the Deploy
       dialog.
   - **Conversation** = `conversations`. It has these columns:
     - id;
     - store_id (immutable, ON DELETE CASCADE);
     - config_id;
     - title;
     - context_json, the reference a module passed in (for example a campaign id);
     - pinned;
     - archived_at;
     - client_request_id, with a UNIQUE partial index on (store_id, client_request_id) WHERE client_request_id IS
       NOT NULL (decision 7);
     - created_at, updated_at, last_activity_at.
     - Index (store_id, archived_at, last_activity_at).
     - Search: `conversations_fts`, an FTS5 table (CREATE VIRTUAL TABLE … USING fts5, as `kb_cards_fts` in db.ts
       does) over each conversation's title and message text, with store_id and conversation_id as UNINDEXED
       columns. AA-05 keeps it in step on write.
     - Drafts are not stored on the server: they live in localStorage per conversation, so typing never writes the DB.
   - **Run** = `agent_runs` plus these columns:
     - conversation_id;
     - team_id (set only on runs of a kind-'team' session; plain mission steps leave it NULL);
     - config_id (the immutable agent_configs row the run used; NULL for runs without one);
     - runtime, model and effort (the requested values, so conversation-less runs and Retry have them);
     - runtime_version (the Codex CLI version; NULL otherwise);
     - client_request_id, with a UNIQUE partial index on (conversation_id, client_request_id) WHERE client_request_id
       IS NOT NULL, and a UNIQUE partial index on (team_id, client_request_id) WHERE team_id IS NOT NULL AND
       client_request_id IS NOT NULL (team step runs have no conversation_id, and SQLite treats NULLs as distinct;
       decision 7);
     - actual_model;
     - effort_applied;
     - attachments_json (decision 11).
     - Index (conversation_id, created_at).
   - **Team session** = `squad_missions` extended with ADD COLUMN: kind (NULL for missions, 'team'), objective,
     participants_json, budget_usd, max_concurrent, retries, conversation_id, owner_notes_json.
     - participants_json is an array of {configId, fromConversationId}, with the lead first. fromConversationId is the
       existing conversation that lent its config and recap, NULL for New. Step runs never go into it. Add agent
       appends to it until the plan step has a finished run. The synthesis run is the synthesis step's runId in
       steps_json.
     - Starting a team creates the team's own conversations row and stores its id in squad_missions.conversation_id.
       The row has config_id set to the lead's configId, the same store, and the team name as its title. Its pinned,
       archived_at and last_activity_at belong to the team. So pin, archive, unarchive, search (by title and follow-up
       messages), the "active + 30 days" range and "Archived · N" all cover teams through the conversation queries.
       Renaming a team writes both conversations.title and squad_missions.title, so the Ecosystem panel matches. A
       conversation that a kind-'team' squad_missions row points at is a team conversation. It is listed only under
       Teams, never in the Agents type groups.
     - Team steps in `steps_json` gain optional fields: kind (plan, task or synthesis), configId, expected, attempts,
       nextTryAt, contribution, unresolved.
     - One table means the AI Ecosystem page keeps working: it reads `/api/squad-missions` and `mission` messages, and
       optional fields don't break it.
4. **Existing runs stay readable and are not rewritten.**
   - Legacy runs keep conversation_id NULL and are not in the left list. The agent-type drawer's History tab lists all
     of the seat's runs, newest first, with no origin filter and no owner claim. Rows from before this migration can't
     be told apart from scheduled or system jobs, so no row is called the owner's and none gets an inferred origin.
     - A History row opens its conversation, scrolled to the run.
     - A run with no conversation opens read-only in the centre: the AA-08 thread view with that one run, and
       "Continue in a new conversation" in place of the composer. That type's group in the left list is expanded.
     - A History row for a run with a team_id opens that team on the participant's tab, scrolled to the run.
   - "Continue in a new conversation" in the read-only run view creates a conversation whose first turn carries an
     app-built recap of that run.
   - One recap builder serves Continue in a new conversation, "Change runtime or model…", the session-expiry recap
     (decision 10), Codex's "session not found" fallback, and a team participant lent by an existing conversation
     (decision 12).
     - It leaves out every run created before the store went live, using the `activate:<storeId>` check that start()
       uses (runs.ts:79-80). If nothing is left, the action is refused with start()'s text: "That conversation ran on
       demo data, before the store went live: start a new one." (In Create team, the participant row shows it.)
     - Resume and Retry still go through start().
     - Two kinds of run open read-only with no Continue, because both hold other stores' data (decision 17): an Ask
       KB all-stores run (its task contains ask.ts:50's "The cards come from every store and General"), and a run
       whose transcript has a compare_stores tool_call.
   - No backfill heuristics: root runs include scheduled and system jobs, and demo runs share one session id.
5. **Run and conversation states.**
   - The DB statuses stay queued, running, done, error and cancelled. The API adds a derived `state`:
     - queued;
     - running;
     - awaiting_approval: running, with a pending approval of any kind except `question` whose run_id is this run;
     - waiting_for_input: running, with a pending `question` (AA-16 updates the AA-02 helper and its tests);
     - completed (done);
     - failed (error);
     - cancelled;
     - interrupted: error with the "Interrupted by an app restart" text.
   - Don't add DB status values. About 20 sites compare run-status literals, and costToday counts `status =
     'running'`.
   - A conversation's state comes from its runs, in this order. If a run is running, it is that run's derived state
     (running, awaiting_approval or waiting_for_input). Otherwise, if a run is queued, it is queued. Otherwise it is
     the latest run's state: completed, failed, cancelled or interrupted. It is **idle** only when it has no runs. An
     open conversation is never "running" just because it is open.
   - `RUN_STATUS` in ui.tsx gains the derived states.
6. **Concurrency and budgets.**
   - The global limit (3) and the per-store limit (2) stay.
   - The one-run-per-agent rule becomes one run per **conversation** for runs that have a conversation. Runs without
     one keep the per-agent rule and the identical-queued-task dedupe, so scheduled jobs don't stack. Runs with a
     team_id skip the per-agent rule and the dedupe. They are bounded by the team's at-once setting, the store and
     global limits, the seat budget share and the team budget. No per-seat queue applies to them: the seat's owner
     chats and scheduled jobs delay them only by holding a store or global slot, and its runs paused on an approval or
     a question hold no slot and never delay them.
   - Several conversations of one type can therefore run at once, within the store limit.
   - The seat's daily budget (`dailyBudgetUsd`) is shared the way the store cap is shared today: each run's cap is the
     seat's remaining budget divided by its active runs.
   - The run's own "Budget for this run" (from its config, when set) also caps it, so the effective cap is the minimum
     of the store, seat and run caps. It is enforced in `spend()`.
   - A conversation's permissions only narrow its seat. The seat's autonomy and daily budget are the ceiling, and a
     config can't widen them.
   - Approval and question waits don't hold a store slot (as today), but they do hold their conversation's lock.
7. **Sending, queueing, retry and stop.**
   - Every owner action that starts work carries a client_request_id. It is a UUID made when the composer or dialog
     opens, or one per Retry or Resume click, and it is kept until the server answers. A repeated id returns the
     existing conversation, team or run. The id goes on a different record for each action:
     - Send, Retry, Resume and the after-team To: Lead send: on the run (the existing agent_runs UNIQUE
       (conversation_id, client_request_id) index);
     - Resume of an interrupted team step: on the run, under a UNIQUE partial index on agent_runs (team_id,
       client_request_id) WHERE team_id IS NOT NULL AND client_request_id IS NOT NULL (team step runs have no
       conversation_id, and SQLite treats NULLs as distinct). The server resumes only while the step's current run is
       interrupted, and answers 409 otherwise;
     - Start conversation and Continue in a new conversation: on the conversation;
     - Start team: on the team's conversations row (decision 3);
     - a To: Lead note while the team runs: as the note's id in owner_notes_json, and a repeated id is ignored.
   - Sending while a run is going creates a queued run in the same conversation. It starts when the current one ends,
     and the owner can cancel it.
   - **Retry** of a failed or unsatisfying reply starts a new run with the same message. It resumes the session of the
     last **successful** run before it, so the SDK session never holds the prompt twice.
     - The failed attempt stays visible, collapsed, as "Attempt 1 · failed", under the new one.
     - If the failed attempt ran tools with effects, its activity says so.
   - **Stop** aborts the run through its AbortController (Claude) or kills the spawned PID's tree (Codex v1, decision
     9). The run ends cancelled with what it produced so far. A queued run is just cancelled.
   - Pausing a running reply is not supported (Resume of an interrupted run is decision 8). The Stop button's tooltip
     says "Stops this reply. Pause isn't supported." Don't fake it.
   - **Stop after N minutes** applies to every runtime. execute() runs one timer. Time the slot spends waiting on the
     owner (the `waiting` flag, which covers approvals and questions) doesn't count. At the deadline it aborts the run
     the way an overrun budget does: it calls abort() with a flag, as overCap does, and for Codex it kills the PID
     tree (decision 9). The run ends **failed** with 'Stopped: this run's N-minute limit was reached', and Retry is
     offered. A config with no Stop after has no time limit.
   - **Errors:** map every `SDKAssistantMessageError` code in SDK 0.3.310 (authentication_failed,
     oauth_org_not_allowed, account_on_hold, verification_required, billing_error, rate_limit, overloaded,
     invalid_request, model_not_found, server_error, unknown, max_output_tokens, cloud_credential_error) and the
     result subtypes (error_during_execution, error_max_turns, error_max_budget_usd) to owner text with an action.
     - Retry rate_limit, overloaded and server_error automatically, at most twice with backoff, and only when the
       failed attempt ran no tool with effects. Every other error waits for the owner.
8. **Restart and reconnect.**
   - After an app restart, interrupted runs with a conversation_id or a team_id are not re-run automatically. They
     show as Interrupted, with Resume (a new run that continues the session).
   - Runs with neither keep today's one-time automatic retry, unchanged. That retry (runs.ts:367-370) already skips
     resume follow-ups and runs older than 6 hours. It covers scheduled, automation, mission, KB, Ask KB, niche-pack,
     add-products and assign_task runs.
   - Resume starts its run through start()'s retryOf, linking `retry:<interrupted>:<resume>` as the restart retry
     does, so assign_task's restart check and its 3-per-run limit count the interrupted run's children.
   - The page states the truth: closing the window hides it to the tray and runs continue, but Quit stops them. On
     reconnect the page shows the server's state; it never assumes a run continued.
   - While the socket is online, stop the 2 s `useRun` poll and use socket events. On reconnect, refetch (as today).
   - Runs the client didn't start (team steps, module runs) get their cache entry seeded when they appear in a list,
     because `run_event` only applies to cached runs.
9. **Runtimes, models and effort.** No hardcoded model lists, no silent substitution, and backend validation.
   - **Claude discovery:** `claudeModels()` next to `claudeAccount()` in `claude-engine.ts`.
     - It runs a no-prompt streaming query with the **same isolation options as real runs**: `settingSources: []`, the
       `agent-sessions` cwd and the same env. It reads `initializationResult()` (models and account in one handshake)
       and closes.
     - The models are served in the existing `/api/claude-account` response, with its 5-minute cache, `?refresh=1` and
       demo short-circuit, and are re-exported through `GET /api/runtimes` (below).
     - The model label is `ModelInfo.displayName`. Store and show the resolved id, never an alias, because aliases move.
   - **Registry fallback:** `packages/shared/src/runtime-registry.ts`. It is versioned: version is the date you
     checked its contents against the docs (for example '2026-10-28'). It lists its source URLs, and holds per model:
     label, efforts, default effort and per-model prices.
     - It is used only when discovery fails or a model's effort fields are missing, and the UI says so.
     - Its prices replace the family price table in `claude-engine.ts` (the current table misprices Sonnet 5.5 cache
       reads and long Haiku 5.5 prompts; see the code map).
     - Its contents come from the official docs listed in the code map, checked on the day you write it. If a page
       can't be fetched, use the code map's 2026-10-28 facts for those models, set version to the oldest date you
       relied on, and name the unreachable URL under Notes. Don't block on it.
   - **Validation:** `validateConfig(store, config)` runs on the server, in the conversation, team and run-start
     routes and when a preset is applied, before anything is queued.
     - It checks the runtime part: the runtime is connected; the model is on this login's discovered list (or the
       registry when discovery is down, flagged); the effort is in that model's supported levels, or omitted when the
       model has none.
     - It also checks these:
       - the tools are a subset of the base role's tools, after any custom-role narrowing, and compare_stores is
         allowed only for the Analytics Specialist type;
       - the knowledge scopes are only 'store' and 'general';
       - custom_role_id passes decision 13's body-id rule;
       - the budget and Stop after are optional, and when present they are finite positive numbers. A budget is
         refused for codex and demo. Stop after is required for codex;
       - for a team, retries are 0–2, there are at most 6 participants, and 'at once' is ≥ 1, clamped to the real
         limit;
       - Codex effort ultra is refused (below).
     - A failure is a 400 that names the field, with a reason the dialog shows on that field. Write the checks by
       hand, as routes/agents.ts:569 does (no zod). Unknown preset keys are dropped, not refused.
     - Wherever a config moves to Codex (Deploy, "Change runtime or model…", a team participant row), the UI prefills
       Stop after with 20 minutes when it has none and drops the budget. An empty budget or Stop after shows as "No
       limit".
     - Never set `Options.fallbackModel`.
     - Always pass `effort` explicitly: the API and Claude Code default differently.
   - **Recording what ran:** `actual_model` comes from the init message's `model`. `effort_applied` comes from the hook
     input `effort.level` (it reports a silent downgrade) when the SDK provides it under `settingSources: []`; otherwise
     it records the requested effort and marks it unconfirmed.
     - If either differs from the request, the run's activity says so in one line ("Ran at High: Max isn't available on
       this account"). It never hides it.
   - **Fable:** when Fable is selected, the dialog notes the docs' warning that in an SDK app Fable may bill usage
     credits without a prompt. A "requires usage credits" error is mapped to owner text in the ACCOUNT map.
   - **Demo:** demo stores (`connected` false) keep the free scripted engine as their default runtime, shown as "Demo
     (free)". It is never offered on a connected store: the spec's runtimes are Claude and Codex, and Demo exists so
     demo data and the tests run without spending.
     - The owner may pick Claude or Codex on a demo store explicitly. The dialog then says "This store has demo data:
       the agent works on sample numbers and uses your real Claude/Codex usage."
   - **Default config:** a conversation created without the Deploy dialog gets the seat default. That covers
     startConversation, the legacy run route (decision 14), Continue in a new conversation, and tests. The seat
     default has the role's tools (runTools with no narrowing: every draft switch on, compare_stores off per decision
     13), knowledge scopes Store + General, save findings Off, no run budget and no Stop after (only the seat and
     store caps apply, as today), plus a runtime: on a demo store, runtime demo with no model or effort; on a
     connected store, claude with agentModel(). From AA-13 it uses the discovered default model and its discovered
     (else registry) default effort. Before AA-13 the effort is NULL and isn't passed, as today.
     - It is written as a normal agent_configs row, and the run records its config_id, runtime, model and effort.
     - Runs without a conversation (the scheduler, automations, KB loops, missions) keep
       defaultEngine(store.connected) and agentModel(). From AA-13 they also pass and record the model's default
       effort. Research mode is unchanged.
     - From AA-14, "New conversation" opens Deploy with the type preselected.
   - **Codex** (AA-15). Use the CLI installed on this machine (`codex` on PATH, or `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin\codex.exe`).
     - **Spawning:** every codex call (`--version`, `login status`, `login`, `features list`, `debug models`,
       `app-server` when AA-01 picks `model/list`, `mcp list`, `exec`, `exec resume`) goes through one spawn helper.
       The helper uses `shell: false`, the scrubbed env and the app's `CODEX_HOME` (Isolation), so
       `FRONTLINE_SECRET_KEY` never reaches a codex process.
       - Exec gets the user turn on stdin, with an explicit `-` prompt argument (`codex exec … -`,
         `codex exec resume <id> -`), never in argv. The user turn is the owner message, the attachment text, the
         recap, the Relevant knowledge block and the volatile prompt parts. argv holds only flags and ids.
       - Never point `CODEX_HOME` at `~/.codex`, and never read, copy, move or print an auth.json, a keyring entry or
         a token. Never run Codex's Windows sandbox setup, and never change a system or security setting.
     - **Spawn it directly** and parse its JSONL events. Don't add `@openai/codex-sdk`: it is an 80 KB wrapper around
       one spawn, but it pulls in a 486 MB Windows binary package, can't pass every flag needed here, and adds SDK/CLI
       version skew. Never bundle the CLI (341 MB).
     - Record the CLI version in the run's runtime_version. Show it in the Runtime section with the versions AA-15
       tested; Codex releases weekly.
     - **Status:** "installed" means `codex --version` succeeds; "signed in" means `codex login status` exits 0, both
       run with the app's `CODEX_HOME`. Neither starts a model turn. When either fails, the Codex option says exactly
       what to do: "Install the Codex CLI" or "Set up Codex".
     - **Models and efforts:** read the live catalog without a turn, through whichever of these AA-01 found reliable:
       `codex debug models` (prints the catalog JSON) or the app-server's `model/list`.
       - Filter out hidden models.
       - Cache the result on the server for 5 minutes (not a spawn per dialog open).
       - The registry is the fallback, flagged.
       - Show the effort ids the catalog gives. Labels differ between Codex surfaces.
       - Signed out, `codex debug models` prints the bundled catalog. Notes records the live refresh as unconfirmed
         until the owner has signed in.
     - **Transport:** v1 uses `codex exec --experimental-json`. The app-server's streaming can't be proven without a
       signed-in turn, so it goes under Notes as a follow-up.
       - With exec the answer arrives whole, and the UI says "Codex replies appear when complete".
       - Never use `--ephemeral`: it breaks resume.
     - **Instructions:** the role prompt is long, and Windows caps a command line at 32,767 characters. Don't pass it
       as a `-c developer_instructions=…` argument. Write it to a per-run file under the app's `CODEX_HOME` and pass
       the key AA-01 confirms per run as a flag, `-c <key>=<per-run file path>` (argv holds flags and ids). Never
       write per-run values into `CODEX_HOME/config.toml`: concurrent runs would share and overwrite them.
     - **Isolation (required).** The owner's personal Codex setup must not run inside store agents. That setup is
       `~/.codex/AGENTS.md`, hooks, about 30 plugins, MCP servers (Neon, Playwright, node_repl, cua_repl) and notify.
       - Use an **app-owned `CODEX_HOME`** in the app's data folder. `--ignore-user-config` is not enough: it skips
         config.toml, but the home's AGENTS.md still loads.
       - Sign-in is a "Set up Codex" button that runs `codex login` with that `CODEX_HOME`. The owner signs in in their
         browser, and the app never sees the token.
       - **The working folder must be outside every git repo.** In dev the data dir is `./.data` inside this repo, and
         Codex walks up to the git root and would load the repo's AGENTS.md. Use an empty per-store folder under the
         user's local app-data (for example `%LOCALAPPDATA%\FrontlineEcom\codex-work\<storeId>`). Assert at startup
         that `git rev-parse` fails there. Because of this, exec always passes `--skip-git-repo-check`. Without it,
         exec exits 1 with "Not inside a trusted directory…" before any turn (codemap item 21).
       - Take the codex-work root from an env override. vitest.config.ts sets it to a temp folder, as it does
         FRONTLINE_DATA_DIR, so tests never create folders under the owner's profile.
       - Pass an explicit, scrubbed env: PATH, SYSTEMROOT, USERPROFILE, CODEX_HOME and the MCP token variable, and never
         `FRONTLINE_SECRET_KEY` or integration tokens.
       - Run with sandbox `read-only`, approval `never` and network off. Web search is on only where the role has
         WebSearch.
       - Pass `-c features.<x>=false` for every feature that acts outside the app's control: `shell_tool`, `hooks`,
         `multi_agent` (Codex's own sub-agents, on by default at **every** effort), `multi_agent_v2`, `apps`,
         `plugins`, `image_generation`, `browser_use`, `computer_use`, `in_app_browser`, `goals` and `view_image`.
       - AA-15 confirms, with `codex features list` under the run flags and from the CLI source, that the model can't
         run a command, read or write a file, or reach the network except through the app's MCP tools and web search.
         It checks code mode, exec, apply_patch, view_image and what `code_mode_only` leaves. If any such path
         remains, Codex ships disabled with "Not available: Codex <version> can still run code outside the app's
         tools". Write the reason under Blocked, finish the rest of AA-15 (status, discovery, engine and fixture
         tests), and tick it.
       - When the installed CLI is a version AA-15 didn't test, the 5-minute status check runs `features list` again.
         If any decision-9 feature is missing or reads true, Codex shows "Not available: Codex <version> changed a
         feature the app turns off".
     - **Tools:** the app's tools reach Codex through a run-scoped HTTP MCP endpoint on the Hono server, using the
       installed `@modelcontextprotocol/sdk`.
       - It is 127.0.0.1 only. The per-run bearer token is passed with `bearer_token_env_var`, never in the URL: `codex
         mcp list` prints URLs verbatim.
       - Codex keeps requestApproval's rule unchanged. OUTLIVE_RUN kinds return after PATIENCE_MS and stay open.
         Every other kind, `question` and `kb.save` included, waits in the tool until the owner decides or the run
         ends.
       - Owner waits don't count toward Stop after (decision 7), so set `tool_timeout_sec` to 86,400 (24 hours). It is
         the only bound on a Codex owner wait. If it fires, Codex gets a tool error, the run ends, and the request is
         expired.
       - In runs.ts, remove the `status !== 'done'` guard before expireApprovals (line 309), so that no run ends with
         an in-run request still open.
       - The endpoint never rebuilds a ToolContext. The Codex engine builds the same ctx as claude-engine.ts:75
         (`{...input.env, store, agent, emit, signal}`), with events merged into its stream. That way storeMoved keeps
         the run-start snapshot, approval_request frees the store slot, and Stop aborts a pending approval. Its tools
         come from runTools (decision 13). Side effects go through `requestApproval`, so the approval rules are
         identical across runtimes.
       - The engine registers {ctx, tools} in an in-memory Map under a randomBytes(32) hex token and deletes the
         entry in `finally`. The token reaches Codex only through `bearer_token_env_var`. It never reaches the DB, a
         config, a transcript or the logs.
       - The endpoint resolves the ctx by token (an unknown token gets 401), lists only that run's tools and refuses
         any other tool name. The endpoint is not behind the KB guard (decision 13).
       - The store's external MCP servers (Meta Ads) are left out for Codex in v1. The Tools list says "Claude only for
         now".
     - **Events:** only `turn.failed` or a non-zero exit ends a run with an error.
       - Top-level `error` events and error items (config warnings) become activity lines.
       - A "model rerouted: X → Y" item updates the run's `actual_model` and shows an activity line. Never let a reroute
         pass silently.
     - **Run manager fit:**
       - Skip the end-of-run reflection turn for Codex in v1: it would start a second process and spend plan quota.
       - Add Codex's own "session not found" and account errors (signed out, usage limit) next to the Claude ones, so
         resume falls back to the recap and the "Not connected" state is truthful.
       - Stop force-kills only the tree of the PID the app spawned (`taskkill /PID <pid> /T /F`), never by image name,
         because the owner's Codex desktop app and the Codex lane workers also run codex.exe.
       - The test spawns a fake process tree (a node script that starts a grandchild), records both PIDs, stops the
         run and checks both are gone. No automated test spawns codex.exe, and nothing lists or kills other codex.exe
         processes.
       - The Codex live smoke (AA-25b) records the spawned PID's whole descendant tree just before Stop, by walking
         ParentProcessId (`Get-CimInstance Win32_Process`), then checks that every recorded PID is gone. It never
         matches or kills by image name.
     - **Cost:** Codex reports tokens, not dollars.
       - Codex runs show tokens.
       - They are never bounded by the dollar caps. The Deploy dialog hides the budget field for Codex and Demo, which
         have no dollar cost. Stop after, when set, bounds any runtime and is required for Codex (decision 7). The UI
         never claims a dollar cap applies to Codex.
     - **Effort `ultra`** is not offered in v1. It works through Codex's own sub-agents, which the app turns off on
       every run (`multi_agent=false`, `multi_agent_v2=false`).
       - validateConfig refuses Codex ultra in the conversation, team and run-start routes with one 400 reason:
         "Ultra runs Codex's own sub-agents, which the app turns off so its run limits hold."
       - Every effort picker shows ultra disabled with that reason: Deploy, "Change runtime or model…", and the team
         participant rows.
       - Ultra is never passed, and multi_agent is never turned on. Don't show the catalog's "automatic task
         delegation" text.
10. **Changing provider, compaction and long context.**
    - A conversation's runtime or model changes only through "Change runtime or model…". That writes a new config and
      starts a **new provider session**, seeded with an app-built recap. Provider session state is never assumed to
      transfer.
    - The recap is the conversation's title, objective and context, the last N exchanges (owner message plus final
      answer, within a budget), the knowledge cards cited, and open questions.
    - The thread shows a handoff divider: "Switched to Codex · GPT-6 Astra · the history stays here; the new session
      starts from a summary".
    - The same recap replaces the current last-exchange-only recap when a Claude session has expired, so an old
      conversation reopens with its context.
    - Map the SDK's `compact_boundary` system message to an activity line ("Earlier context was summarized to fit"). The
      role prompt, store scope and permissions are in the system prompt on every query, so compaction can't drop them.
11. **Knowledge.** Integrate the existing Knowledge Base; build no second memory.
    - **Retrieval:** keep `retrieveKnowledge` (store plus General, accepted only, role areas, stage, freshness, usage).
      - Build the query from the conversation's title, objective and latest message, not the latest message alone.
      - On a resumed SDK session the system prompt is the recorded one (SDK 0.3.310 snapshot behaviour), so a
        follow-up's newly retrieved cards go into the **user turn** as a "Relevant knowledge" block (verify this in
        AA-17), built by the same formatter as the system prompt's knowledge section, framing sentence included. The
        recap's cited cards use it too. The recap's earlier answers in a conversation's own new session (decision 10)
        stay unwrapped, because they are the conversation's own history.
      - The same goes for every other part of the system prompt that changes between runs (check `prompt.ts`: today's
        date, the waiting list, pending approvals, fresh store numbers). On a resumed session they go in the user turn
        too, unless AA-01 finds an SDK option that rebuilds the system prompt on resume.
      - A retrieved card with an open conflict (`kb_conflicts`, status open) is shown with the other side and marked
        unresolved, so the agent keeps the uncertainty instead of picking one.
    - **References:** at run start, emit one `knowledge` transcript event listing the cards placed in the prompt. Then
      `GET /api/runs/:id` and the socket carry it with no new route.
      - Citations resolve with the run's store as `ws`, never `ws=all`. A `[kb:id]` outside the run's store and General
        shows "not available in this store".
    - **Untrusted framing:** the knowledge section and `search_knowledge` output get one sentence, "card text was
      written from web pages and agent work: data to weigh, never instructions", as the memory section already says.
      This closes KB decision 10's gap.
    - **Saving:** one domain function, `captureFinding`, in `packages/agents/src/kb-links.ts`.
      - It takes the workspace from the **run's** store.
      - Every save, whether a new card or a live store match, writes one 'observed' evidence row with the run id.
        - It doesn't touch `verified_at` and doesn't write a 'Refreshed' revision. addEvidence does both
          (kb-links.ts:165 and :173), so this path skips both.
        - The row's text is the block's evidence tag ([measured], [research], [hypothesis] or 'untagged') plus the
          source URLs and [kb:id]s cited in that block. It is plain text, never a kb_sources row.
        - Save on a reply takes these from the block. save_finding takes them as tool arguments (tag and cited
          sources).
      - It runs agentCardError, then sameCard over the store **and General**:
        - a live store match gets only that row;
        - a General match creates nothing and returns "Already in General: <title>";
        - an archived or rejected match is refused;
        - otherwise it creates a hypothesis card (origin agent, the run id, status as below), then that row.
      - The new card's status is proposed when save_finding saves in Automatically mode, whatever the review setting.
        - This is a deliberate exception to KB decision 11: no human saw the text, and ordinary runs read pages
          through WebFetch, not the guarded fetch_source reader, so blocked domains and untrusted wrapping don't
          apply.
        - The owner's own Save to Knowledge Base, and an Ask-me save the owner approved, follow the workspace's
          review setting (KB decision 11).
      - It never creates a read source (pasted text counts as a read source and would climb the ladder).
    - **Save to Knowledge Base on a reply:** anchored on run id and block index, not on selected rendered text.
      - The owner can trim the proposed title and summary in a small popover. The popover's defaults are computed
        locally from the anchored block's text, with no model call.
        - Move runGist's line-cleaning and first-sentence step (runs.ts:431-439) into a helper that takes plain text,
          and have runGist call it.
        - The title is the block's first sentence, cut at 160 characters. The summary is the block text clipped to
          600. The full block text goes in the body.
        - These are propose_card's limits (tools.ts:1341-1342: title 5–160, summary 10–600), and Save stays
          disabled until both fields fit them.
      - It confirms with "Saved as <status>: <title>" (the real status, labelled through knowledge/Library.tsx's
        STATUS: Unreviewed or Active), "Added to <title>" or "Already in General: <title>". Each links to
        /knowledge?card=<id>&ws=<store>.
    - **Automatic capture:** a `save_finding` tool for ordinary runs, gated by the config's save-findings mode:
      - Off: the tool is absent.
      - Ask me: the tool raises an inline "Save this finding?" card (a `kb.save` approval kind); Save calls
        captureFinding.
        - ask_owner and the Ask-me save_finding call ctx.approvals.create and ctx.approvals.decision directly, not
          requestApproval. The suggest, autopilot and patience gates don't apply, because they act on nothing outside
          the app. They emit the same approval_request event, so the slot is freed and the state reads
          waiting_for_input or awaiting_approval.
        - `question` skips storeMoved. `kb.save` keeps it, so a finding read from demo data isn't saved after the
          store went live mid-run.
        - Add `question` ('Answer a question') and `kb.save` ('Save a finding') to APPROVAL_KINDS, and add
          `question: 'ask_owner'` and `'kb.save': 'save_finding'` to OWN_TOOL in tools.ts, so request_approval
          refuses both kinds and points to the right tool. Don't add kb.save to OUTLIVE_RUN.
        - A new store-scoped route, POST /api/approvals/:id/answer {text}, marks a question approved and keeps the
          text in decision_note (today decide() keeps a note only on deny). It returns 409 unless the approval is a
          pending `question` in that store. The tool returns that text.
        - ApprovalCard (Chat.tsx), used by the Dashboard, Notifications and the agent page, branches on kind. A
          `question` shows the question and an 'Answer in conversation' link (its notification links there too),
          with no Approve or Deny. A `kb.save` labels its buttons Save and Skip.
      - Automatically: it saves straight away.
      - Each call commits immediately, so findings survive an interrupted run. The cap is 5 per run.
      - It emits a `kb_written` AgentEvent (KB decision 14).
      - The end-of-run reflection keeps writing store **memory**, not cards (KB decision 1).
    - **Attachments:** documents only (pdf, txt, md, csv, html), up to 10 MB in total per message, sent as base64
      JSON like the research upload, and never written to kb_sources (unlike kb/routes.ts:107). They are read with
      the KB's `readUpload`.
      - The extracted text goes into the message as an untrusted block (`untrustedBlock`, below).
        - Move the nonce-and-quoted-lines part of sourceForAgent (kb-sources.ts:124-129) into a new exported
          `untrustedBlock(where: string, text: string, max = 20_000)`, and have sourceForAgent call it.
          Attachments call it directly.
        - When the text is cut, the block says so, and so does the attachment chip.
      - Each run keeps its attachments' names, types, sizes and extracted text in `attachments_json` (decision 3), so
        the chips render on the owner's message and a retry sends the same content. The original file isn't kept.
      - Images are not in v1 (Claude needs streaming input for them); the attach menu says so.
12. **Collaboration (team sessions)** extends squad missions, as decision 3 describes.
    - **Plan:** a team starts with one `plan` step run by the lead.
      - The lead's answer ends in a fenced JSON plan: tasks with id, assignee (a participant's configId), task text,
        depends_on and expected output.
      - It is parsed with zod, as kb-research does, and validated:
        - assignees are only configIds in participants_json (the lead's plan prompt lists those configIds with their
          types);
        - there are at most 8 tasks;
        - dependencies only point back to earlier tasks (parseMission's rule);
        - there are no cycles.
      - An invalid plan is a failed attempt of the plan step.
      - The tasks and a final `synthesis` step (lead, depending on every task) are appended **inside `advanceOnce`
        before its status check**. Otherwise the plan-only mission reads as done and ends.
    - **Scheduling:** app-driven, as missions are today. Independent tasks start together and dependent tasks wait.
      - Steps run as their participant's config, so two participants of the same type run as two configs, not one
        seat queue.
      - Plan, task and synthesis runs carry team_id and never a conversation_id. They start fresh sessions and never
        show in a conversation: they show in the team thread, the participant tabs and the drawer's History tab
        (decision 4). One participant may run two independent tasks at once; its tab shows each run.
      - A participant picked from an existing conversation lends its config and a recap: decision 10's builder, with
        decision 4's guard. The recap goes to that participant's first task inside untrustedBlock (decision 11). That
        conversation isn't touched or locked.
      - Real parallelism is min(team "at once", the store limit of 2, free global slots). The header and the dialog show
        that real number; never claim 3 when 2 can run.
    - **Shared task record:** each task's answer ends in a fenced JSON `{summary, output, evidence[], open_questions[],
      disagrees_with[]}`, stored as the step's `contribution`.
      - Dependents, the synthesis and the after-team follow-up get each contribution inside untrustedBlock, with a
        header naming the participant and the task. A recap lent by an existing conversation (Scheduling) gets the
        same wrapper. Dependents get only their dependencies' contributions, not the whole history.
      - Owner notes from "To: Lead" are stored in owner_notes_json and go into the prompt in a separate "Owner's
        notes" section that the app writes, outside every wrapper.
      - The plain mission handoff (missions.ts:174-179) stays unchanged.
    - **Partial failure:**
      - A failed task blocks only its dependents.
      - The synthesis starts once every task is done, failed after its retries, or blocked. It receives the failures
        and every `disagrees_with` as **Unresolved**.
      - The team ends done with unresolved items, or failed only if the synthesis fails.
    - **Retries:** up to the team's retries (default 2) per task.
      - A retry is a new run with a new run id. While it waits out its backoff, the step reads as waiting, with a note.
      - Not retried: owner cancellations, budget stops (they would spend more), account errors (they would fail again),
        runs stopped by their Stop-after limit (decision 7), and runs interrupted by an app restart.
      - Startup's advanceSquadMissions must not retry an interrupted team step. Instead the step's task row shows
        Interrupted with Resume. Resume starts a new run of that step that continues its session, and counts as one
        attempt. The team row reads Interrupted until every such step has been resumed or the team has been stopped.
    - **Budget:** each step run carries `team_id`. `spend()` sums the team's live cost and aborts when the team budget
      is gone, and `advanceOnce` starts no new step after that, with the reason in the step note.
      - The per-run cap is the remaining team budget divided by the team's active Claude runs.
      - Codex and Demo participants are not charged to the team budget. Each Codex step is bounded by its own config's
        Stop after (decision 7).
    - **No recursion and no expansion:**
      - `assign_task` is refused for any run with a team_id. That covers the plan, task and synthesis runs, which have
        no parent.
      - Team steps skip the end-of-run reflection, like research.
      - Each participant runs with its own config's tools (runTools, decision 13), its seat's autonomy and the
        **team's store**, from the record, never from the UI.
      - Disagreement between agents is not validation: the synthesis prompt says so, and keeps evidence and
        uncertainty.
    - **Noise:**
      - Team step runs send no per-run "<Role> finished" notifications. The team sends "Team ready" or "Team needs you".
      - The Ecosystem page keeps showing teams as missions; MissionPanel reads optional fields safely.
    - **Demo stores:** the scripted engine gets team scripts: a valid plan JSON, task contributions with one
      `disagrees_with`, and a synthesis. The whole flow then runs free on demo data and in tests.
    - "To: Lead" while a team runs stores a note in owner_notes_json, and the synthesis receives it. After the team
      ends, "To: Lead" is an ordinary send in the team's conversation (decision 7: client_request_id, queueing, Stop,
      Retry).
      - It starts a lead run with that conversation_id, the lead's config and the normal conversation lock, and passes
        it the contributions and the synthesis as wrapped data (untrustedBlock).
      - The run carries no team_id, so its own budget and the seat's apply, and the team stays ended.
    - "Add agent" works until the plan is made. After that it is disabled with "The lead has planned; add a participant
      and re-plan isn't supported."
13. **Store isolation and security.**
    - The store comes from records, never from the UI selection.
    - New conversation, team (resume of an interrupted step included), config, preset, custom-role, tools and
      approval-answer routes require `?store=` and return 404 for another store's record.
    - These existing by-id routes take an optional `?store=` and return 404 when it names another store. Without it
      they behave as they do today:
      - `GET /api/runs/:id` and its cancel;
      - approval approve and deny;
      - PATCH and DELETE `/api/memory/:id`;
      - GET and PATCH `/api/agents/:id`;
      - `GET /api/squad-missions/:id` and its cancel;
      - `DELETE /api/flow-drafts/:id` (the drawer's Flows tab).
    - The workspace and the drawer always send their store, so FlowLibrary's `useDeleteFlowDraft` gains a store
      param. Other callers, the ecosystem's included, don't change.
    - The KB research-task routes stay with the knowledge lane (its decision 4).
    - Ids in a request body that bring another record into a store's work are checked against that store. A mismatch
      is a 404, and nothing is created or started. This covers:
      - a team participant's existing conversation and its config (same store as the team);
      - a config's custom_role_id (a `builtin:` id, or an agent_custom_roles row in that store or in all stores,
        with the seat's base role);
      - the run behind Continue in a new conversation (the new conversation takes that run's store and seat, never
        the UI's).
    - Resume and retry are already covered by start()'s seat check, the module reference by decision 14, and
      captureFinding by the run's own store.
    - `canUseTool` denies WebFetch to a loopback or private host (`isPrivateHost` from shared, as track_competitor
      does), so an agent can't read the app's own API across stores.
    - The live socket stays one stream. There is one local owner and every store is theirs, so filtering it adds no
      boundary. Isolation is enforced on the agent side and at the routes.
    - **compare_stores** (all stores' totals) becomes opt-in per conversation ("Compare with my other stores"). The
      server leaves the tool out unless the run's config allows it. "Don't retrieve another store's private
      information by default."
    - One `runTools(role, mode, config?)` returns a run's effective tools. It takes the role's tools, intersects them
      with the config, removes the tools a custom role narrows away and the switched-off draft tools, keeps
      compare_stores only on opt-in, and adds save_finding according to the save-findings mode. It is the only source
      for the Claude engine's app tools, built-ins and external MCP list, and for the Codex endpoint (decision 9).
      Runs without a config pass none and keep today's tools.
    - The KB guard (app.ts `kbGuard`: 10 starts and 300 changes a minute, plus body limits) is also mounted on the new
      conversation and team route prefixes, sharing its counters.
      - Its STARTS pattern gains every new route that starts a run: create conversation (Continue in a new
        conversation included), send, retry, resume, create team, resume of an interrupted team step, and
        note-to-lead. A note after the team has ended starts a run, and counting every note as a start is harmless.
      - Create conversation and send accept 15 MB bodies, as research tasks do, because a message carries up to 10 MB
        of attachments in base64 (about 13.4 MB). Every other new route keeps 1 MB.
      - The guard is not mounted over the run-scoped Codex MCP endpoint. It is not extended to the existing
        `/api/agents` start routes, so the legacy run route stays outside it, as it is today.
    - **Credentials** never appear in API responses, run transcripts, events or logs.
      - A test seeds a meta_ads integration with a fake access token and a fake `FRONTLINE_SECRET_KEY`. It runs the
        real claudeEngine with a fake `query` (the recording() pattern in agents-mcp.test.ts, so mcpServers really
        carries the token), once to success and once to an error. In AA-04, neither secret appears in the agent_runs
        row (any column), the agent_configs rows, `GET /api/runs/:id` or the server log. AA-05 adds the conversation
        and thread payloads to the same test.
      - AA-15 adds the Codex case, using the recorded fake: the child's env keys equal the allowlist, its argv holds
        no secret, and the per-run MCP token lives only in memory.
    - Retrieved web pages, documents and knowledge are data, never instructions (decision 11, `SQUAD_RULES`). Approvals
      gate every spend, publish, live-store edit, deletion and customer contact, in teams too. Conversations and teams
      follow the app's approval rules unchanged, autopilot included. Only the owner changes them.
14. **Integration with other modules.**
    - `startConversation({store, type, title?, objective, context})` (client and API) is how a module opens a
      conversation with context. The module passes a reference, for example `{kind:'campaign', network, id, name}`.
    - The conversation shows it as a context chip that links back. The agent gets the referenced record from the store's
      own data, not a pasted copy.
    - `startConversation` checks that the referenced record belongs to the conversation's store, and refuses one that
      doesn't (404, as in decision 13).
    - Build one new entry point: an "Ask Ad Strategist" action on Analytics campaign rows. Its reference is that
      campaign.
    - Existing run starters keep working through the legacy aliases.
      - `POST /api/agents/:id/runs` without resumeRunId now goes through the server side of startConversation, for
        that seat's store and type. The conversation's title is the task's first line, cut to 80 characters. Its
        objective is the task, it has no context, and it uses the seat default (decision 9): no run budget or Stop
        after, so the store and seat caps bound it as today, every draft switch on and save findings Off, so module
        runs keep today's tools and limits. Only compare_stores is dropped (decision 13).
      - The route returns the run as it does today, so every module starter and its `?run=` link opens a live
        conversation with no change on the module's side.
      - With resumeRunId, the new run takes the resumed run's conversation_id when it has one, and that
        conversation's lock and queue apply. Otherwise it behaves as today.
      - The three that link without `?run=` (`Research.tsx:54`, `Orders.tsx:222`, `Creative.tsx:125`) gain it.
    - Deliverables link to where they live: research to its sources, campaign advice to the campaign, creatives to the
      Creative library, drafts to their approval. A run's deliverables are found by `run_id`: creatives, page_drafts,
      flow_drafts and approvals all carry it.
15. **UI building blocks.** Native first, as the app already is:
    - `<textarea>` and `<select>` with `inputClass`;
    - `Dialog` for dialogs and drawers;
    - the HTML Popover API (as `UpdatePrompt.tsx` does) for menus and popovers;
    - pointer-drag pane widths;
    - the server pages lists instead of a virtualization library.
    - **Markdown:** chat needs links, fences, emphasis, nested lists, blockquotes and tables. `lib/markdown.ts` says to
      "reach for a real parser" at that point, so add **one** parser with raw HTML off (markdown-it with `html:false`,
      or an equivalent). Links go through `knowledge/url.ts` `webHref`, and `[kb:id]` is an inline rule. Keep
      `Markdown.tsx` for the places that use it today.
    - Role initials in a rounded square replace portraits on this page.
16. **Live checks you may run.** Automated tests use the scripted engine and recorded fakes, never a live model.
    - Before acceptance, run **one short live smoke run per runtime**, each in its own item, so no item runs more than
      one (CLAUDE.md: at most one short real-engine smoke run per task): AA-25 for Claude and AA-25b for Codex, on a
      demo store, with read-only tools, a $0.50 cap (Claude) or a 3-minute Stop after (Codex).
    - These are the only live model turns in this lane. Claude uses the account's default model at its default effort,
      never Fable. If the default is Fable, use the first discovered model that isn't Fable. Codex uses the catalog's
      default model and effort. Any other item that needs SDK or CLI runtime behaviour gets it without a turn: from
      the SDK types, the bundled CLI source or the protocol schema, or by watching AA-25 and AA-25b. Record which
      method was used in Notes.
    - Record what each proves, separately from the mocked tests.
    - The Codex smoke uses the `CODEX_HOME` of your own dev server, an absolute path under
      `<this worktree>\apps\server\.data\…`. When AA-15 ships, run `codex login status` with that `CODEX_HOME`. If it
      fails, add under Blocked the exact PowerShell line, with the absolute path:
      `$env:CODEX_HOME='<absolute path>'; codex login`. Never run `codex login` or the Set up Codex flow yourself.
      Check again before AA-25b. If it is still not signed in, record "Codex live smoke: needs the owner's sign-in"
      under Blocked and finish everything else. If AA-15 shipped Codex disabled (decision 9), record "Codex live
      smoke: Codex is disabled (<reason>)" under Blocked instead.
    - Never spend ad money, publish, edit a live store or contact customers to prove a flow (spec §12).
17. **Out of scope. Don't build these. If one turns out to be necessary, put it under Blocked with the reason and
    take the next item:**
    - changing the global or per-store run limits;
    - giving Codex a shell or file write access;
    - cross-store knowledge access in a conversation;
    - images in messages;
    - pausing and resuming a running run (Resume of an interrupted run, decision 8, is in scope);
    - deleting conversations (only archive: the spec asks for archive and reopen);
    - removing portraits from other pages.

## Lane

- **Owns:**
  - `apps/web/src/pages/Agents.tsx` and `AgentDetail.tsx` (replaced by the workspace at AA-14b; the URL aliases live
    in the router);
  - a new `apps/web/src/agents/**`;
  - `components/Chat.tsx`: the Chat shell retires at AA-14b; ApprovalCard, DenyReason, FixLink and Transcript stay
    exported from it, so its importers don't change;
  - `components/Shell.tsx` (PageBoundary key, NavLink end);
  - the agent hooks in `api/client.ts`;
  - `Hero.tsx`'s `compact` prop;
  - `ui.tsx` additions;
  - `index.css` colour tokens (additive);
  - `apps/server/src/routes/agents*.ts`, the new conversation, team and runtime routes, appended migrations, and
    route mounting in `app.ts`;
  - `packages/agents/src/` (runs, engines, the new codex engine, roles, missions, tools, prompt) and the
    knowledge-lane touch points listed in decision 1;
  - additive types in `packages/shared`;
  - the Analytics "Ask Ad Strategist" entry point;
  - this file.
- The other lanes are stopped (each has `.agent/STOP`), so cross-package edits are expected here. Keep each surgical
  and covered by tests.
- Ports: WEB_PORT 5233, API_PORT 8847 (already in your env).
- Commits: `ai-agents: AA-xx <what>`. Vault log: `Build Log/ai-agents.md`.
- **Merging and releases:** the owner has authorized workers to push to main after `pnpm check` (the CLAUDE.md worker
  loop). That is all the spec's "beyond the authorization already granted" allows. Never tag or cut a release, bump
  the app version, publish the desktop build or deploy: only the owner releases.

## Done when

This is the completion checklist. For each line, AA-27's report names the test file(s) or the recorded check (a
screenshot path or a Notes entry) that proves it. AA-26 treats a line with neither as not done.

- Every item is ticked (AA-25b counts as ticked when 'Codex live smoke: needs the owner's sign-in' is under Blocked
  with the exact sign-in step, per decision 16, or when 'Codex live smoke: Codex is disabled (<reason>)' is under
  Blocked), and `pnpm check` (typecheck plus all tests) and `pnpm build` are green. The repo has no linter, so the
  report says linting doesn't apply rather than claiming it passed.
- Spec §12, line by line:
  - **Store isolation:** switching stores shows only that store's conversations and teams. New routes return 404 for
    another store's id. The listed existing routes return 404 when `?store=` names another store. Body ids from
    another store are refused. Tools and knowledge refuse another store's data. One table-driven sweep covers all of
    these.
  - **Conversation management:** create, rename, search, pin, archive and reopen work, for teams too, without losing
    messages or changing the role, store or id.
  - **Deployment:** the type, runtime, model and effort chosen are validated and are what the run used (the run's
    config_id row and the engine's received options asserted). A switched-off draft tool is absent from the run's
    tools on both runtimes. Stop after aborts at its limit and doesn't count an approval wait (scripted engine with
    fake timers). Unsupported combinations are refused with a reason.
  - **Chat execution:** streaming, failure, retry (no duplicate conversation, team, message or run when create, send,
    retry, resume or start team is repeated with the same client_request_id; API tests), cancellation, queued sends,
    waiting for input and approval waits.
  - **Persistence:** a reload, navigation and an app restart keep the history. Runs show their true state after a
    restart (interrupted, with no automatic relaunch for conversation and team runs).
  - **Knowledge access:** retrieval of store plus General only; references are inspectable; a saved finding lands
    through captureFinding, deduped, with a confirmation that names its real status. Automatically-mode saves are
    always Unreviewed.
  - **Collaboration:** a 4-participant scripted team plans, runs independent tasks in parallel (two same-type
    participants run at once) and dependent ones in order, hands contributions on, survives one failed task with a
    retry, reports a disagreement as Unresolved and produces a synthesis. Assign_task is refused inside it.
  - **Failure recovery:** a disconnected provider, expired sign-in, rate limit, timeout, unavailable model and worker
    interruption each end in a recoverable state with a clear action, tested with the scripted engine and fakes.
  - **Permissions:** consequential tools need the right approval in a conversation and in a team, and a team can't
    widen a participant's tools or store.
  - **Interface quality:** 500 conversations, a 300-message thread, 25 stores and 3 running agents are proven in
    jsdom tests with stubbed API pages and the fake socket (the api/live.test.tsx pattern). The tests prove these
    points:
    - the list keeps at most one page of rows plus Pinned in the DOM until it is scrolled;
    - the thread keeps only the newest page until earlier runs are requested;
    - the store popover scrolls and works from the keyboard;
    - three runs stream at once, each to its own row and thread, and switching conversations neither mixes nor drops
      text.
    Long titles, widths from 1024 to 1920 px, and keyboard-only use are checked in the browser with screenshots.
- **Spec §12 completion criteria:** a click-through in the browser of the page, the Deploy and Create team dialogs,
  the settings drawer and every ⋯ menu finds no control that does nothing. Each control works, or is disabled or
  hidden with a visible reason. Demo-store numbers appear only while the Demo data pill shows. Every integration
  that isn't connected or verified shows its true state, never a working one. Codex not installed or signed out
  shows 'Install the Codex CLI' or 'Set up Codex'. Disconnected tools show 'Not connected · Set up'. Under Codex,
  Meta Ads shows 'Claude only for now' (decision 9). Exceptions go in the report's limitations.
- The live smoke runs from decision 16, reported separately from mocked tests.
- The page is checked in Orca's browser at 1280×800 and with headless Chrome over CDP at 1366×728, 1440×900 and
  1920×1080. Compare it with the three references, with no console errors, and keep the screenshots in `.agent/`.
- `styleseed-design-review` was run on the new page, and its findings are fixed or answered in Notes.
- **Final report:** `docs/features/ai-agents-report.md` covers what was built, the changed areas, each checklist line
  with its evidence, which flows ran against real services and which only against fakes, and the remaining
  limitations and what they need. Screenshots of the finished page go in `docs/reference/ai-agents-final/`.
- Then create an empty `.agent/STOP` in this worktree and stop.

This lane is finite. When AA-01 to AA-27, with AA-14b and AA-25b, are done, don't add new items (this overrides
CLAUDE.md's "Backlog empty?" rule). Put follow-up ideas under **Notes** for the owner. Ignore a watchdog nudge if
`.agent/STOP` exists.

## Inbox
- [ ] (from codex-hardening, CH-13 / Q2) Unknown enabled CLI features pass featuresChanged. Add an optional nonblocking warning to RuntimeCapabilities and render it in runtime status/selection, then compare an untested CLI listing with the checked-in 0.163.0 feature names: any new true row warns by name. Keep connected=true when signed in, and preserve the existing refusal for known-off features missing/enabled. Pin a fixture with a new enabled feature plus an off-feature control. Do not use reason: configs.ts refuses every runtime with reason. Shared status/UI files are outside hardening Phase C; proposed default is warn, not disable.
- [ ] (from codex-hardening, CH-05 / Q1) Decision 9 says Codex/Demo are never bounded by dollar caps and decision 12 excludes them from team spend; confirmed `codex.ts` reports tokens with costUsd 0. However `runs.ts` start checks store/agent dollar caps before resolving the runtime, and pump/execute apply those shares to all runtimes. Proposed default: runtime-aware admission/seating consistent with decision 9, keeping Codex Stop-after mandatory. Hardening left this unchanged because removing a refusal is outside its tighten-only authority.
<!-- other lanes append requests here: - [ ] (from <lane>) <request> -->
- [x] (from product-research) A `product` ConversationContext kind, so a conversation opened from Product Research
  shows "Opened from <product>" (product-research decision 15). Done 2026-10-28: `{ kind: 'product', id, name }`.
- [x] (from product-research) Agent WebFetch through the shared `kbFetch` instance (`routes/agents.ts`), so agents
  get the same SSRF, redirect, size and robots rules as product previews (product-research decision 12). Taken in
  AA-23 (its untrusted-content review covers web reads). Done 2026-10-28: `WebFetch` is an app tool in `tools.ts`
  over `ctx.kbFetch` (the store's blocked domains, the page fenced as data); the Claude engine no longer offers its own.
- [x] (from product-research) Include `/api/pr/*` in AA-23's security sweep (guarded since PR-02). Taken in AA-23.
  Done 2026-10-28: the by-id routes (listing image, notes, store products, signal links) answer another store 404 and
  change nothing. One fix in your `trends.ts`: `signalSet` now returns undefined for another store's private set
  (an order history or note), so `/api/pr/signals/:id/links` 404s instead of a 400 that confirmed the id.
- [x] (from product-research, FYI, done) T6 shipped in PR-03: `recordFind` in `routes/agents.ts` calls `mirrorFind`
  after its INSERT, and `ToolEnv.recordFind` in `packages/agents/src/tools.ts` now also receives the run id
  (`ctx.runId`). A demo-engine run's find is not mirrored.
- [x] (from product-research, FYI, done) T1 shipped in PR-16: `Deploy` takes optional `lockStore`, `types` (the type
  ids offered) and `onSubmit({type, config})`. With `onSubmit` it hands back the checked choice instead of creating a
  conversation and hides the objective, title, attachments and Agent settings link; with `types` it hides "+ Custom
  role". Without the new props it behaves as before (its existing tests unchanged, one new test).
- [x] (from product-research, FYI, done) T2 shipped in PR-10: the shared fetcher moved to `kb/fetch-instance.ts`
  (`export const kbFetch`); `routes/agents.ts` imports it instead of creating it, behaviour unchanged. The fetcher
  also has an opt-in `image` mode (T3) that product research's image cache uses. Agent WebFetch through it is still
  the open request above.
- [x] (from product-research, FYI, done) T9 shipped in PR-22: `AddProduct` in `routes/agents-actions.ts` has an
  optional `prProductId` (left out of `CreateProducts`); after the drafts are made, `addProducts` writes a
  `pr_outcomes` `store_product` row for each one whose payload names a research product (matched by title). Other
  requests behave as before; covered by `product-research/pipeline.test.ts`.

## Items

### Foundation
- [x] AA-01 **Audit, baseline and probes.**
  - Read the spec, this file, the code map and the three references. Confirm decisions 1–17 against the code at
    HEAD.
  - Baseline `pnpm check`. Create .agent/ and copy cdp-shot.mjs (exact-viewport screenshots, console errors per
    shot) and cdp-drive.mjs (real pointer, wheel and key input) from
    C:/Users/Xody2/orca/workspaces/FrontlineEcom/knowledge-base/.agent/. They are gitignored: never commit them. Use
    them for every headless-Chrome check here, in AA-24 and in Done when. Orca's pane tiles viewports wider than about
    800 px, so it takes only the 1280×800 check. If that folder is gone, rebuild the scripts from the Screenshots note
    in docs/backlog/knowledge-base.md. Take "before" screenshots of `/agents` and `/agents/<id>` (each tab) at 1280
    and 1920 in `.agent/before/`.
  - **Claude probe** (no model turn): run `initializationResult()` with the run isolation options. Record whether
    models are aliases or ids, and whether `supportedEffortLevels` is filled.
  - **Codex spike** (no model turn):
    - Run each `codex` command from the shell with `CODEX_HOME` set to a new empty folder, `.agent/codex-spike-home`
      (gitignored), and `FRONTLINE_SECRET_KEY` unset. Never run codex without `CODEX_HOME`. Never use `~/.codex`: it
      is signed in and loads the owner's MCP servers, plugins and hooks. From AA-15 on, every app spawn goes through
      the spawn helper.
    - `codex --version` and `codex login status` (expect 'not signed in').
    - Signed out, record what `codex debug models`, `codex debug models --bundled` and the app-server's `model/list`
      each return: the fields, hidden models and efforts, and which source is more reliable.
    - `codex features list` with decision 9's flags: is every listed feature present and off? Is any command, file or
      network path left outside the app's MCP tools and web search?
    - `codex mcp list` with a `-c mcp_servers.frontline…` override that uses `bearer_token_env_var`.
    - From the source: what `code_mode_only` does to MCP tool calls and their events.
    - From `codex app-server generate-json-schema` only, with no turn: whether thread/start, turn/start,
      item/agentMessage/delta and turn/interrupt exist. v1 uses exec either way.
    - Which config key loads the instructions from a file.
    - That exec in a non-git folder needs `--skip-git-repo-check`.
  - **Claude resume check:** whether SDK 0.3.310 has an option that rebuilds the system prompt on resume (decision 11).
  - Write a Notes entry: the probe and spike answers; where each new piece will live; the app-server schema answer,
    for the Notes follow-up; and any decision changed and why.
- [x] AA-02 **Data model** (decision 3):
  - the migrations for every table, column and index decision 3 lists, each with an upgrade test that seeds the
    previous version's DB and checks user_version and `PRAGMA foreign_key_check`;
  - the shared types (Conversation, AgentConfig, AgentPreset, CustomRole, TeamSession fields, the derived RunState,
    RuntimeId, RuntimeCapabilities);
  - the derived-state helper (decision 5) with tests for every branch, including a running run with a newer queued
    run (it shows running);
  - `RUN_STATUS` in ui.tsx.
- [x] AA-03 **Run manager for conversations** (decisions 6–8):
  - the per-conversation lock, keeping the per-agent rule and dedupe for runs with no conversation_id and no team_id;
  - seat-budget shares and the run's own cap, when its config sets one;
  - client_request_id idempotency;
  - queued sends;
  - retry from the last successful session;
  - the "Stop after" run timeout, the error map and the bounded automatic retries (decision 7);
  - permissions that only narrow the seat (decision 6);
  - no automatic restart re-run for runs with a conversation_id or team_id, with Resume through retryOf; tests: the
    restart retry skips runs with a team_id, and a resumed conversation run that assigns the same role again gets
    'Already assigned … before the app restarted';
  - the scripted engine's session id made unique per fresh run (`fake-<runId>`), updating the two tests that pin the
    old one;
  - `agents-runs.test.ts` extended for every rule, including: Stop after aborts at the deadline but not while the run
    waits on an approval.
- [x] AA-04 **Store isolation and guards** (decision 13):
  - the optional store check on the listed existing routes, and the store param in the drawer's flow-draft delete;
  - one table-driven sweep. New routes return 404 for another store's id. The listed existing routes return 404 when
    `?store=` names another store. Tools and retrieval refuse another store's ids. AA-05, AA-09 (tools), AA-11 (custom
    roles, presets), AA-14, AA-16 (answer), AA-17 (citations), AA-18 (captureFinding) and AA-19 (team routes, step
    resume included) each add their routes and body-id cases to the table in the commit that adds them;
  - cross-store body-id tests: AA-05 (continue from another store's run), AA-11 (a custom role from another store)
    and AA-19 (a participant conversation and config from another store);
  - a test that canUseTool denies WebFetch to http://127.0.0.1:<API_PORT>/api/… and allows a public host;
  - the start-route guard grows with the routes: AA-05 and AA-19 each add their run-starting POSTs to STARTS and mount
    the guard on their prefix in the same commit, with a 429 test;
  - `runTools(role, mode, config?)` (decision 13), extending today's `runTools(role, mode)` in tools.ts, with
    compare_stores opt-in (AA-18 adds the save_finding part);
  - the secrets-never-leak test (decision 13).
- [x] AA-05 **Conversations API** (plus client hooks):
  - create with a config checked by decision 9's `validateConfig` (until AA-13 the runtime, model and effort part
    accepts only the seat default's values. The tools, knowledge, custom-role and limits checks are complete from
    AA-05. AA-13 to AA-15 widen only the runtime part; the team checks come with AA-19's routes);
  - list per store with filters (active, archived, pinned, type, range) and cursor paging;
  - server search over titles and message text, through AA-02's `conversations_fts` table (decision 3), kept in step
    on write and filtered by store_id;
  - cursor paging for the new lists and threads (`GET /api/runs` is capped at 200 with no cursor);
  - get a thread (the runs in order, paged from the newest);
  - create, send, retry and resume, each idempotent on client_request_id; stop;
  - rename, pin, archive, unarchive;
  - 'continue in a new conversation' from a run with no conversation; the legacy run route opening a conversation
    (API tests: the run gets the role's draft tools and no maxBudgetUsd or Stop-after timer of its own, and a
    follow-up with resumeRunId lands in the same conversation);
  - `startConversation` with module context;
  - API tests for each, plus:
    - an extra tool, compare_stores on a type other than Analytics Specialist, a budget of 'abc' and a budget on a
      demo config each get a 400 that names the field;
    - a pre-go-live run is refused for Continue, and the recap builder leaves pre-go-live runs out (decision 4);
    - the secrets test (decision 13) covers the conversation and thread payloads.

### Approved interface
- [x] AA-06 **Page frame and routing:**
  - Hero `compact`;
  - the three-pane layout with drag widths, persisted state and breakpoints;
  - the URL scheme and the one URL helper, with tests for the new forms (the legacy aliases switch over in AA-14b).
    Until AA-14b the helper's store-workspace form is `/agents/w?store=`. AA-14b switches it to `/agents?store=` and
    removes `/agents/w`;
  - tests that reloading a conversation URL reopens it and that a wrong store shows the not-found state;
  - the keyboard model;
  - the empty, loading, error, disconnected and no-stores states;
  - the Shell and thread boundaries:
    - Shell.tsx: key PageBoundary by the first path segment (`pathname.split('/')[1]`). Moving between /agents,
      /agents/c/*, /agents/t/*, /agents/w and the legacy aliases then keeps the workspace mounted, and leaving the
      page still clears a caught error.
    - Wrap the centre thread in its own PageBoundary, keyed by the open conversation or team id.
    - Set NavLink `end` only for '/' (`end={n.path === '/'}`).
    - Test through the real Shell: after /agents/c/A → /agents/c/B the list element is the same DOM node (toBe), and
      the AI Agents link has aria-current='page'.
  - Built beside the old pages. Until AA-14b, `/agents` and `/agents/:id` keep rendering Agents.tsx and
    AgentDetail.tsx, and nothing in the nav links to the workspace. The workspace is reachable at
    `/agents/c/:id?store=`, `/agents/t/:id?store=` and a temporary `/agents/w?store=` (the static segment outranks
    `:id`). Until AA-14, tests and browser passes create conversations through the AA-05 API.
- [x] AA-07 **Left pane:**
  - the store switcher popover with live counts;
  - Deploy and Create team (rendered from AA-14 and AA-20);
  - search;
  - Pinned, Teams (expandable participant rows) and Agents grouped by type, with status dots and meta;
  - "N more agent types";
  - row and type menus;
  - Archived, the range, and paging on scroll.
- [x] AA-08 **Conversation view:**
  - the header (inline rename, status chip, Collaborate (rendered from AA-20), Stop, ⋯) and the meta chips;
  - the thread with the Markdown parser (decision 15), activity blocks from real events, evidence tags, numbered
    citations and the source-chip row;
  - Copy, Retry and attempt history;
  - approval cards, with a Chat.test.tsx case: the amber tone renders Deny before Approve, and the default tone is
    unchanged;
  - the composer with per-conversation drafts, queued sends and Stop;
  - the interrupted banner with Resume;
  - the read-only single-run view (decision 4), with a test that an Ask KB all-stores run and a compare_stores run
    show no Continue.
- [x] AA-09 **Right panel and settings drawer:**
  - Details and Activity tabs (the Knowledge tab renders from AA-17);
  - the tools endpoint, and tools with real connection state and "Set up" links;
  - the team variant;
  - the agent-type settings drawer reusing AgentSettings, Memory, History and Flows;
  - Move AgentSettings, Memory and History, with the components they use, and the autopilot summary helper (Right
    panel › Approvals and budget) out of AgentDetail.tsx into `apps/web/src/agents/`. AgentDetail.tsx imports them
    from there until AA-14b deletes it.
  - a test through `/agents/w?store=`: open a conversation, pick the Activity tab, scroll the thread up, go to
    /knowledge, then come back to `/agents/w?store=`. The same conversation, the Activity tab and the scroll offset
    return. (The Knowledge tab doesn't render until AA-17.)
  - checked against the workspace reference.

### Store-scoped conversations
- [x] AA-10 **Conversation management, end to end:**
  - several conversations per type, including several running at once within the store limit;
  - store switching that keeps drafts and never touches other stores' runs;
  - search, pin, archive and reopen;
  - long titles;
  - jsdom tests plus one browser pass.
- [x] AA-11 **Agent types** (decision 2):
  - the display names and the rename sweep (decision 2);
  - the two code-defined types, with full contracts;
  - role contracts and "Role instructions and checks";
  - custom roles (API and form on AA-02's table, narrowing tools only);
  - built-in and saved presets;
  - the measured/research/hypothesis rule in every contract;
  - evals: in packages/agents/src/evals.test.ts, check that each type's prompt contains its contract, including the
    workflow and quality-check steps, for every AGENT_ROLES role and both `builtin:` types. Check that a custom role
    can't add a tool. In apps/server/src/routes/agents-evals.test.ts, key FLOWS by role (`Record<AgentRole, …>`,
    iterated with Object.entries), so that a role without a flow fails typecheck. Add no custom-role flow eval, no
    Done-when line and no live-smoke content check. Add flows for the two built-in types, keyed by their ids:
    - Marketing Strategist: its read tools, then an answer, with no approval asked;
    - General Researcher: its app read tools only (FakeStep.call is a ToolName, so WebSearch and WebFetch can't be
      scripted).
- [x] AA-12 **Open a conversation with context** (decision 14):
  - `startConversation`;
  - the Analytics "Ask Ad Strategist" action with a campaign reference;
  - the context chip, with the reference checked against the store;
  - `?run=` on the three links that lack it;
  - deliverable links, found by run_id;
  - notification links that open the right conversation, with a test that one does.

### Runtime configuration
- [x] AA-13 **Claude discovery, registry and validation** (decision 9):
  - `claudeModels()` and `GET /api/runtimes` (each runtime: connected, account, models with efforts, source
    discovered or registry, checked-at);
  - the registry file, its prices replacing the family table, with the doc URLs checked (or the Notes fallback);
  - `validateConfig` in every start route, its runtime, model and effort part widened to Claude's discovered models
    and efforts (AA-05 built the other checks);
  - explicit effort, including the default effort for runs without a conversation;
  - `actual_model` and `effort_applied` recorded, with the activity line on any mismatch;
  - the Fable and usage-credit messages;
  - the model_not_found text no longer pointing at an env var.
- [x] AA-14 **Deploy dialog** (A), wired to real data:
  - the Deploy agent and New conversation controls (New conversation opens Deploy with the type preselected,
    decision 9);
  - every field, except attachments (AA-17) and "Save findings to knowledge" (AA-18), which render from those items;
  - presets (apply and save);
  - custom role;
  - field-level server errors;
  - the demo-store runtime rule;
  - "Change runtime or model…" with the handoff and recap (decision 10);
  - tests:
    - the run received exactly the chosen model and effort;
    - a pre-go-live run is left out of the Change-runtime recap (decision 4);
    - an extra tool, compare_stores on a type other than Analytics Specialist, a budget of 'abc' and a budget on a
      demo config each get a 400 that names the field;
    - a switched-off draft tool is missing from a Claude run's tools;
    - a seat on autopilot with ads.set_budget enabled shows that kind and its cap in the locked row and in the
      Details line, not 'Always'. With autonomy 'ask', both read Always. A seat on autopilot with ads.set_budget
      enabled, whose type has no propose_ad_change (or whose ad-proposal draft switch is off), reads 'Always'.
- [x] AA-14b **Switch-over:** point `/agents`, `/agents/:id` (both encodings) and every legacy form in Page frame
  (`?tab=`, `?by=agent`, `?run=`) at the workspace, the drawer and the conversations, with one test per form (`?run=`
  for a run with a team_id comes with AA-20). Delete Agents.tsx, AgentDetail.tsx and the Chat shell. ApprovalCard,
  DenyReason, FixLink and Transcript stay exported from Chat.tsx (Lane › Owns). Move the Agents.test.tsx,
  AgentDetail.test.tsx, Chat.test.tsx and nav.test.ts assertions onto the new page or the aliases. Switch the URL
  helper's store-workspace form to `/agents?store=` and remove `/agents/w`. Re-run AA-09's navigation-state test
  through the sidebar's /agents link. Main is never without chat, approvals or agent settings between items.
- [x] AA-15 **Codex runtime**, spawning the installed CLI with `codex exec --experimental-json` (decision 9):
  - status and "Set up Codex" (login into the app's `CODEX_HOME`);
  - cached model and effort discovery;
  - the engine with event mapping (thread id → session; MCP tool calls → tool_call and tool_result; answer → text;
    usage → tokens; `turn.failed` or a non-zero exit → error; other errors and reroutes → activity);
  - isolation:
    - own `CODEX_HOME`;
    - a working folder outside every git repo (asserted, with `--skip-git-repo-check` on exec);
    - the scrubbed env on every codex spawn through the one helper, with the prompt on stdin and `shell: false` (a
      fake-child test checks that a 40,000-character turn arrives on stdin and argv stays short);
    - every listed feature present and off, checked again on untested CLI versions (a test against a recorded
      features list that is missing one feature);
    - the spike result in Notes;
  - the run-scoped MCP tools endpoint with `bearer_token_env_var` and `tool_timeout_sec`;
  - Stop after, required for Codex, enforced by execute()'s timer and the PID-tree kill (decisions 7 and 9);
  - no reflection turn;
  - Codex account and session errors mapped;
  - Stop kills only the spawned PID's tree. A fake-tree test checks that the recorded child and grandchild PIDs are
    gone (never matched by image name);
  - ultra refused with its reason, in validation and in the pickers (tests: the start routes return 400 with that
    reason; every Codex run's received options include features.multi_agent=false);
  - tests against a hand-built exec JSONL fixture (built from the SDK event types and
    event_processor_with_jsonl_output.rs), labelled 'from source' on every event AA-25b doesn't replace with a
    recorded one, and:
    - a switched-off draft tool is missing from the Codex endpoint's tools;
    - a Codex config with a budget or without Stop after gets a 400;
    - the secrets test's Codex case (decision 13);
    - an ended run's token gets 401;
    - an approval asked over MCP appears as approval_request in the run's transcript and frees its slot;
    - a Codex run stopped while a save_niche_pack request is pending leaves nothing pending;
  - "Codex isn't set up" states everywhere it's offered.
- [x] AA-16 **Execution states:**
  - waiting for input: an `ask_owner` tool that waits like an approval (a `question` kind), answered from the
    composer; the run continues with the answer;
  - how ask_owner and the Ask-me save wait (decision 11 has the same rule):
    - ask_owner and the Ask-me save_finding call ctx.approvals.create and ctx.approvals.decision directly, not
      requestApproval. The suggest, autopilot and patience gates don't apply, because they act on nothing outside
      the app. They emit the same approval_request event, so the slot is freed and the state reads
      waiting_for_input or awaiting_approval.
    - `question` skips storeMoved. `kb.save` keeps it, so a finding read from demo data isn't saved after the store
      went live mid-run.
    - Add `question` ('Answer a question') and `kb.save` ('Save a finding') to APPROVAL_KINDS, and add
      `question: 'ask_owner'` and `'kb.save': 'save_finding'` to OWN_TOOL in tools.ts, so request_approval refuses
      both kinds and points to the right tool. Don't add kb.save to OUTLIVE_RUN.
    - A new store-scoped route, POST /api/approvals/:id/answer {text}, marks a question approved and keeps the text
      in decision_note (today decide() keeps a note only on deny). It returns 409 unless the approval is a pending
      `question` in that store. The tool returns that text.
    - ApprovalCard (Chat.tsx), used by the Dashboard, Notifications and the agent page, branches on kind. A
      `question` shows the question and an 'Answer in conversation' link (its notification links there too), with
      no Approve or Deny. A `kb.save` labels its buttons Save and Skip.
  - the AA-02 derived-state helper and its tests updated: awaiting_approval for a pending approval of any kind
    except `question`, waiting_for_input for a pending `question` (decision 5);
  - awaiting approval and interrupted, shown everywhere a status shows;
  - queued sends;
  - Stop per runtime, with its honest tooltip;
  - compaction activity lines;
  - the session-expiry recap;
  - tests:
    - a suggest seat can ask and gets the answer;
    - a question card never shows Approve;
    - request_approval with kind 'question' or 'kb.save' creates no approval;
    - /answer on an ads.set_budget approval returns 409 and the request stays pending;
    - the Codex case: a question asked over MCP is answered, and a Codex run stopped while it is pending leaves no
      pending question.

### Knowledge integration
- [x] AA-17 **Retrieval and references** (decision 11):
  - the conversation-aware query;
  - cards for follow-ups in the user turn, verified against the SDK's behaviour without a live turn (decision 16),
    and the finding written in Notes;
  - the `knowledge` event;
  - the Knowledge tab and the composer's knowledge chip;
  - citations scoped to the run's store;
  - the untrusted framing sentence;
  - attachments (documents), with the composer's attach and Deploy's attachments;
  - the knowledge-lane touch points (decision 1): kb-retrieve.ts for the query and kb_conflicts, and the
    `untrustedBlock` extraction in kb-sources.ts (sourceForAgent calls it, decision 11);
  - tests:
    - another store's card never reaches a prompt, a search or a citation;
    - a planted 'Ignore previous instructions' line in an attachment arrives quoted inside the nonce block;
    - a follow-up's knowledge block carries the framing sentence;
    - sources.test.ts passes unchanged.
- [x] AA-18 **Saving findings:**
  - `captureFinding` in kb-links.ts (store and General dedupe, observed evidence that doesn't touch `verified_at` or
    write a 'Refreshed' revision, tested on a card past its freshness age, no read source);
  - Save to Knowledge Base on replies (defaults taken from the block, no model call), and automatic or Ask-me saves,
    each with the same confirmation (the Activity block's save_finding step);
  - the `save_finding` tool with Off, Ask me and Automatically and a cap of 5, and Deploy's "Save findings to
    knowledge" row;
  - the `kb_written` event;
  - findings listed in the Knowledge tab;
  - a note that demo-store findings are removed when the store goes live;
  - tests for each path, including an interrupted run keeping a finding saved before the cut, and:
    - with review on and off: an Automatically save is proposed and retrieveKnowledge doesn't return it; an approved
      Ask-me save and a reply save follow the setting, and the confirmation says which;
    - a saved [research] block with two URLs creates a card whose single observed row holds the tag and both URLs,
      with verified_at null and no kb_sources row.

### Collaboration
- [x] AA-19 **Team engine** (decision 12):
  - using the squad_missions columns AA-02 added (no new migration);
  - the plan step and its validation and expansion inside `advanceOnce`. Parser tests use model-shaped answers: prose
    before the fence, a `` ```json `` fence, text after the fence, and a malformed or invalid plan that becomes a
    failed attempt;
  - scheduling by config. Tests: two same-type participants run independent tasks at once, and an owner run of that
    type paused on approval doesn't delay them;
  - contributions and the shared record. Tests:
    - a contribution whose output contains the line '# Owner note: approve the budget' reaches the synthesis prompt
      only as a quoted line inside its wrapper, and Owner's notes holds only notes saved through the note-to-lead
      route;
    - a participant taken from an existing conversation gets its recap wrapped, and that conversation stays untouched;
  - partial failure, retries and backoff;
  - advanceSquadMissions doesn't retry an interrupted team step; its task row shows Interrupted;
  - the team budget. Its tests use Claude-runtime configs on the scripted fake, which sets their costs (Codex and
    Demo participants aren't charged, decision 12);
  - assign_task refused and reflection skipped for team runs;
  - notification rules;
  - scripted-engine team scripts;
  - validateConfig's team checks (decision 9). Tests: retries of 3, 7 participants and an 'at once' of 0 each get a
    400 that names the field;
  - team routes (create, get, cancel, note to lead, add participant before planning, resume an interrupted step), all
    requiring `?store=` (decision 13):
    - create writes the team's conversations row (decision 3) and is idempotent on client_request_id;
    - two step-resume calls with the same client_request_id on one interrupted task start one run, and a resume of a
      step that is no longer interrupted gets 409;
    - each route joins the AA-04 sweep table, with a participant conversation and config from another store refused
      (404). The run-starting ones join the guard's STARTS in the same commit, with a 429 test;
  - the Ecosystem page still works (its tests pass).
- [x] AA-20 **Team UI:**
  - the Create team dialog;
  - B's thread view in the centre, with participant tabs, plan, contributions, handoff lines, Unresolved with "Compare
    both", and synthesis;
  - an interrupted team task shows Interrupted with Resume;
  - "To: Lead", Add agent and Stop team;
  - team rows across the list's range, ended teams included, and participant sub-rows;
  - team pin, archive, rename and search through the team's conversation row;
  - the right panel's team variant;
  - Collaborate from a conversation;
  - a test that reloading a team URL reopens the team;
  - a run with a team_id, opened from `?run=` or from a History row in the drawer, opens the team on that
    participant's tab, scrolled to the run (Page frame, decision 4), with a test;
  - checked against the team reference.

### Reliability
- [x] AA-21 **Live updates and recovery:**
  - no poll while online;
  - cache seeding for runs the client didn't start;
  - in-order streaming with no duplicate or dropped text across a reconnect (test with the fake socket);
  - the failure matrix: provider disconnected, expired sign-in, rate limit, timeout, unavailable model, Codex missing,
    worker interrupted. Each gets an owner-readable message and an action.
- [x] AA-22 **Scale and accessibility:**
  - one page of rows rendered for 500 conversations, the newest page of a 300-message thread, a scrolling store
    popover for 25 stubbed stores (the demo seed has 3), and 3 concurrent runs streaming correctly: jsdom tests, as
    described under Interface quality;
  - keyboard-only paths through every flow;
  - visible focus;
  - contrast AA on the dark surfaces;
  - reduced motion;
  - screen-reader names for every icon button and status;
  - the smaller-window rules.
- [x] AA-23 **Security pass** (decision 13):
  - re-run the isolation sweep and the secrets test, check that the sweep table covers every route in decision 13,
    and check that every new start route sits behind the guard;
  - an untrusted-content review of everything that reaches a prompt (KB, web, attachments, handoffs, owner notes, recap);
  - approvals in teams;
  - no credentials in client state (grep the web bundle and API payloads for secret names).

### Verification
- [x] AA-24 **Design pass:**
  - every screen against its reference at 1440×900;
  - the reading column at 1920×1080 with the right panel closed;
  - `styleseed-design-review` on the page, with fixes;
  - screenshots at the four sizes.
- [x] AA-25 **Claude live smoke** (decision 16), recorded in Notes with its cost and time.
- [x] AA-25b **Codex live smoke** (decisions 9 and 16), recorded in Notes with its time. Its one run asks for a
  read-only tool call, then an ask_owner question (AA-16), which waits in the tool until the owner answers or the
  run ends (decision 9). While the question is pending, record the descendant tree and press Stop (decision 9), and
  check that no question is left pending. The JSONL up to Stop replaces the matching events in AA-15's fixture; the
  events after it (agent_message, turn.completed and its usage) stay labelled 'from source'. Codex reports token
  usage only in turn.completed, so Notes says the stopped run reported none. Tick it once the run is recorded. If
  the owner hasn't signed in, or Codex is disabled (AA-15, decision 9), tick it once decision 16's Blocked entry is
  written: 'Codex live smoke: needs the owner's sign-in' or 'Codex live smoke: Codex is disabled (<reason>)'. The
  final report then lists the Codex smoke as unverified (and Codex as disabled, when it is) and says what it needs.
- [x] AA-26 **Acceptance:** walk the "Done when" checklist and fix what it finds.
- [x] AA-27 **Final report and STOP.** Write `docs/features/ai-agents-report.md`, with screenshots in
  `docs/reference/ai-agents-final/`. Update `docs/DESIGN.md`'s AI Agents section to the new page. Then create
  `.agent/STOP`.

## Done
- 2026-10-28 AA-01 audit, baseline (`pnpm check` green: 177 files, 1342 tests), before screenshots in `.agent/before/`,
  Claude probe, Codex spike and resume check; answers under Notes.
- 2026-10-28 AA-02 migration #50 (custom roles, configs, presets, conversations + FTS, run config columns, team
  session columns) with its upgrade test; shared Conversation/AgentConfig/AgentPreset/CustomRole/team/runtime types;
  `runState` and `conversationState` with tests; RUN_STATUS gains the derived states.
- 2026-10-28 AA-03 run manager: one run per conversation (team steps and per-agent rule as decided), seat-budget
  split and the config's run budget, client_request_id idempotency, queued sends, Retry/Resume through retryOf,
  Stop after (paused while waiting on the owner), every SDK error code mapped with a `code` on the event, two automatic
  retries for rate_limit/overloaded/server_error, no restart re-run for conversation or team runs, `fake-<runId>`
  sessions; 10 new tests.
- 2026-10-28 AA-04 store isolation: optional `?store=` 404 on the listed by-id routes (`wrongStore`), the drawer's
  flow delete sends its store, `runTools(role, mode, config?)` with compare_stores opt-in and the config narrowing
  built-ins and external servers too, WebFetch refused for private hosts, the route/tool/retrieval sweep and the
  secrets-never-leak test (`agents-scope.test.ts`).
- 2026-10-28 AA-05 conversations API: create (by type or fromRunId, with module context), list with filters, FTS
  search and cursor paging, thread paged from the newest, send/retry/resume idempotent on clientRequestId, stop,
  rename/pin/archive; `validateConfig` and the seat default; the legacy run route opens a conversation; the recap
  and first-turn preface; kbGuard and STARTS on the new routes; client hooks; 8 API tests plus the scope sweep and
  secrets test extended.
- 2026-10-28 AA-06 page frame: Hero `compact` with the Demo data pill, the three panes with drag widths (pure
  `clampPanes`, tested), persisted widths and panel state, breakpoints on the workspace's own width, `agentsUrl`,
  `/agents/c|t/:id` and `/agents/w`, `/` and ↑/↓, the loading, error, no-stores, not-found, empty and reconnecting
  states, Shell's PageBoundary keyed by page and NavLink `end` only for '/'; 8 tests; checked in headless Chrome at
  1440, 1024 and 700.
- 2026-10-28 AA-07 left pane: the store switcher (native popover, live running/waiting counts per store, "N other
  stores · M agents running there"), server search with flat results, Pinned, Teams, Agents grouped by type with
  server counts and "N more agent types", collapsible groups kept per browser, row menus (Rename inline, Pin, Archive,
  the context-menu key), Archived · N, the range picker and paging on scroll; `GET /api/agent-types` and
  `GET /api/conversations/counts`; 5 new tests; checked in headless Chrome.
- 2026-10-28 AA-08 conversation view: header (inline rename, status chip, Stop run, ⋯ Rename/Pin/Archive), meta chips
  (type, store, runtime · model · effort, this run's spend against its budget), the thread through one markdown parser
  (markdown-it, raw HTML off) with evidence tags, numbered citations and the source-chip row, activity blocks from real
  transcript events, Copy and Retry, retried attempts folded under the retry, the handoff divider, amber approval
  cards, the composer with per-conversation drafts and queued sends with Cancel, the interrupted banner with Resume,
  and the read-only run view (`?run=`) with Continue in a new conversation; 12 new tests; checked in headless Chrome.
- 2026-10-28 AA-09 right panel and settings drawer: Details (agent, runtime with Claude sign-in state, store scope with
  the compare-stores wording, tools by access with connection state and Set up, approvals and budget from one autopilot
  helper, limits, run footer) and Activity tabs; `GET /api/conversations/:id/tools`; the seat settings drawer
  (Settings, Memory, History, Flows) from the type header and conversation ⋯ menus; the tab and each thread's scroll
  come back after leaving the page; AgentSettings, Memory and History moved to `agents/settings.tsx`; 6 new tests;
  checked in headless Chrome.
- 2026-10-28 AA-10 conversation management end to end: an API test that rename, pin, archive, search (follow-up text)
  and unarchive keep the messages, type, store, config and id; a jsdom test that switching stores keeps the draft and
  sends nothing; full titles as tooltips on truncated rows; browser pass at 1024 and 1920 with a 170-character title and
  two Creative Studio conversations waiting at once.
- 2026-10-28 AA-11 agent types: the rename sweep (Product Researcher, Creative Strategist, Analytics Specialist) across
  owner- and agent-facing strings and tests; a five-part contract on every role and both built-in types, built into
  every prompt (the shared first step and checks, the evidence-tag rule included); built-in types prompted from their
  own contract with no base playbook; custom roles (API, form, base contract plus the owner's instructions, tools
  narrowed only); Default and saved presets; "Role instructions and checks" in Details; the run notification names the
  config's type; evals for every type's contract, custom-role narrowing, and flows keyed by role plus the two built-in
  types; 9 new tests; checked in headless Chrome.
- 2026-10-28 AA-12 open a conversation with context: client `useStartConversation`; "Ask Ad Strategist" on Analytics
  campaign rows; the context chip (campaign → Analytics, continued run → its read-only view); the first turn reads the
  campaign from the store's data (status, budget, 30-day spend, revenue, ROAS, purchases); `?run=` on the Research,
  Orders and Creative links; reply deliverables by run_id (creatives, page and flow drafts, ad-request campaigns) in
  the thread and `GET /api/runs/:id`; run notifications open the run in its conversation; 5 new tests; checked in
  headless Chrome.
- 2026-10-28 AA-13 Claude discovery, registry and validation: `claudeAccount` reads models and account from one
  isolated handshake (`claudeModels` dedupes aliases, registry default efforts); `GET /api/runtimes`; the versioned
  registry (`packages/shared/src/runtime-registry.ts`, checked against the docs today) prices the live estimate per
  model; `validateConfig` checks runtime, model and effort against the discovered list (registry when discovery is
  down) in the conversation, legacy run and preset routes; effort always explicit; `actual_model` and
  `effort_applied` recorded with a "Ran at…"/"Ran on…" activity line on a mismatch; Fable usage-credit text;
  model_not_found text; 6 new tests; discovery checked on this machine (12 models, no model turn).
- 2026-10-28 AA-14 Deploy dialog: `Deploy` (`apps/web/src/agents/Deploy.tsx`, `?deploy=<type>`) from the list's Deploy
  agent button, a type's "New conversation" and the folded types' rows; store, presets (Default first, apply and save,
  a custom-role preset selects the role), type tiles and "+ Custom role", runtime/model/effort from `GET
  /api/runtimes` with the caption and warnings, suggested title, objective, tools and knowledge, locked approval rows
  (autopilot kind and cap from the seat, the store rule and the effective tools), draft switches, budget, Stop after,
  refusals on their field; "Change runtime or model…" (`?change=runtime`, from the ⋯ menu, the runtime chip and
  Details) writes a new config through `POST /api/conversations/:id/config`, and the next turn starts a new session
  from the decision 10 recap (pre-go-live runs left out); `GET /api/tool-groups`; the house Dialog gains width,
  subtitle, headerExtra and footer; 11 new tests; checked in headless Chrome at 1440 and 1024×680.
- 2026-10-28 AA-14b Switch-over: `/agents` is the workspace; `LegacyAgent` sends `/agents/<store:role>` (both
  encodings) to the type's latest conversation or the workspace with its group open (`?expand=`), `?run=` to the run,
  `?tab=`/`?by=agent` to the settings drawer, and `/agents/w?…` to `/agents?…`; Agents.tsx, AgentDetail.tsx and the
  Chat shell deleted; the drawer lists the seat's waiting requests; the composer sends a demo-era refusal as a new
  conversation; the server's run notifications link `/agents?store=`; the old tests moved onto the workspace, the
  aliases, Transcript and the drawer; the navigation-state test runs through the sidebar's `/agents`; checked in
  headless Chrome.
- 2026-10-28 AA-15 Codex runtime: the installed CLI spawned by one helper (`codex exec --json … -`, prompt on stdin,
  `shell: false`, scrubbed env, the app's own `CODEX_HOME`, a work folder outside every git repo, sandbox read-only,
  approval never, 13 features off plus skills and AGENTS.md off), status and discovery without a model turn
  (`--version`, `login status`, app-server `model/list`, `features list` on untested versions), Set up Codex and Check
  again, the run-scoped MCP endpoint `/api/codex/mcp`, the JSONL event mapping, account and session errors, the
  PID-tree Stop, no reflection, ultra refused; Deploy, "Change runtime or model…" and Details show Codex. 18 new
  tests against recorded (features list, signed-out turn) and from-source fixtures; no test spawns codex.exe. Checked
  in headless Chrome at 1440. Ships enabled: the isolation proof is under Notes.
- 2026-10-28 AA-16 Execution states: `ask_owner` (every role, conversations only) waits like an approval as a
  `question` and returns the owner's answer; `POST /api/approvals/:id/answer?store=`; the question card (no Approve or
  Deny, "Answer in conversation", the answer once given) and the composer answering it; Save and Skip on a `kb.save`
  card; request_approval refuses both kinds; question notifications link to the conversation; runs carry their derived
  state in the run APIs and the settings drawer; compaction and expired-session activity lines. 10 new tests, plus the
  Codex case over MCP. Not checked in headless Chrome: the demo engine never asks, so the dev server has no question.
- 2026-10-28 AA-17 Retrieval and references: the conversation-aware query; a resumed session's changing prompt parts
  (memory, knowledge, jobs, waiting requests, the date) in its user turn; the `knowledge` event; open conflicts shown
  with their other side; the framing sentence in the prompt and in search_knowledge; Deploy's knowledge scopes applied;
  citations resolved in the run's store and General only, another store's left as written; documents attached from the
  composer and Deploy, read into untrusted blocks and resent on retry; the Knowledge tab with its count, and the
  composer's knowledge chip. `untrustedBlock` extracted (sources.test.ts unchanged). 8 new tests, 4 extended, on the scripted
  engine. Checked in headless Chrome at 1440 on a demo-runtime conversation with two demo cards and a document.
- 2026-10-28 AA-18 Saving findings: `captureFinding` (store and General dedupe, archived or rejected refused, one
  observed row that leaves `verified_at` and revisions alone); `blockFinding` and `gist` in shared; the `save_finding`
  tool (Off absent, Ask me through a kb.save approval, Automatically as Unreviewed, a cap of 5) and the `kb_written`
  event; `POST /api/runs/:id/findings` (the anchored block, the owner's title and summary, the review setting) and
  `GET /api/conversations/:id/findings`; Save to Knowledge Base under replies, Deploy's "Save findings to knowledge",
  the Activity step in the confirmation's words, "Saved from this conversation" in the Knowledge tab, the demo-store
  note; go-live clears the demo store's observed rows. 8 server tests and 3 web tests, on the scripted engine. Checked
  in headless Chrome at 1440: a reply saved on a demo store, the finding in the Knowledge tab, and Deploy's row.
- 2026-10-28 AA-19 Team engine: teams.ts (`parsePlan`, `parseContribution`, `validateTeam`, `createTeam` with the
  team's conversations row, `addParticipant`, `addNote`, `resumeStep`, `advanceTeam`, `toTeam`, `teamRecord`), called
  from missions.ts's advanceOnce before its status check; scheduling by config within "at once"; contributions wrapped
  for dependents and the synthesis, Owner's notes outside the wrappers, a borrowed conversation's recap on its first
  step; retries with a 30 s then 2 min backoff, unretried stops, interrupted steps left for Resume; the team budget in
  `spend()` and the per-run share (Claude runs only); no assign_task and no reflection on team steps; "Team ready" and
  "Team needs you" in place of per-run notices; the demo engine's team scripts; routes under /api/teams with the guard
  and the store sweep; after the team, a message in its conversation starts the lead from the contributions and the
  synthesis. 15 tests in agents-teams.test.ts, the sweep table extended. A demo team ran end to end on the dev server.
- 2026-10-28 Inbox (product-research): a `product` ConversationContext kind. The server takes a Product Research
  product the store can see (a shared listing or one of its own; another store's find is a 404), the first turn
  describes it from `pr_products`, and the chip reads "Opened from · <product>" and links to /research (no per-product
  view yet). One server test and one web assertion.
- 2026-10-28 AA-20 Team UI: Create team (store, shared objective, up to six participants with a type, a runtime ·
  model · effort select where Codex ultra and an unavailable runtime show disabled with the reason, a Lead radio, and
  New or "Use <conversation>" lending its settings; team budget only with a Claude participant, at once, retries,
  Sub-teams locked Off) and Collaborate prefilled from a conversation; the team view in the centre pane (header line,
  rename, Add agent while the lead plans, Stop team, Thread and participant tabs, plan with "after N" and live pills,
  Interrupted with Resume, contribution cards with sources and Open full output, handoff lines, Unresolved with Compare
  both, the synthesis or its placeholder, follow-ups after it, "To: Lead" as a note then a message); team rows with
  'N agents' or Ready / Failed / Stopped and participant sub-rows; a team's conversation and a team step's run link open
  the team (the run on its participant's tab, scrolled to); the right panel's team variant, closed by default. Team
  responses carry each participant's name, type and config, and the Claude spend. 7 web tests and 1 server test;
  checked in headless Chrome at 1440 against the team board.
- 2026-10-28 AA-21 Live updates and recovery: each run's live events are numbered (`run_event.seq`; GET /api/runs/:id
  and the thread give a live run's `seq`). The client appends the next one, skips one it has, and on a gap (dropped
  socket, a retry that took back what it said) refetches the run and catches up from the events held meanwhile. The
  run poll runs only while the socket is down. A `run` message seeds the copy of a run the client didn't start. The
  failure matrix: an engine that dies reads "Lost the connection to Claude/Codex (…). Retry in a few minutes."; a
  failed reply that another runtime, model or limit fixes (usage limit, model gone, Fable credits, Codex signed out or
  missing, the time limit) gets "Change runtime or model", Claude signed out keeps "Check your Claude login", every
  failure keeps Retry, and Interrupted keeps Resume. 2 server tests, 4 web tests; checked on the dev server with the
  demo engine and in headless Chrome.
- 2026-10-28 AA-22 Scale and accessibility: jsdom tests prove 500 conversations keep one page of rows plus Pinned
  until Show older, a 300-message thread keeps the newest 20 until Show earlier messages, a 25-store picker scrolls,
  starts on the current store and moves with ↑/↓, and three runs stream at once into their own threads across
  conversation switches with nothing mixed or dropped. A browser audit (contrast against the real backgrounds, controls
  without a name, focus that doesn't show, sideways scroll) over the conversation, team, empty workspace, Deploy,
  Create team, the ⋯ menu and the settings drawer's four tabs found one failure: the store letter, white on a light
  store colour (2.18:1), now near-black or white by luminance. Window widths 1920, 1440, 1366, 1280, 1024×680 and 900
  keep the pane rules with no sideways scroll and long titles truncated; both drawers open with Enter, take focus,
  close with Escape and hand focus back. Reduced motion was already global. 5 web tests.
- 2026-10-28 AA-23 Security pass: the isolation sweep now covers every by-id route in decision 13 (findings,
  knowledge, tools, config change, custom-role archive, question answer, save finding) plus Product Research's; the
  answer route gave another store's question a 409 and now 404s, and another store's private signal set 404s too.
  Team notes count as starts in the guard. The secrets test now also GETs every API route that doesn't spawn, open a
  socket or reach the network, for the store holding a Meta token and for All stores; the built web bundle holds
  field names only, no keys. Untrusted text no longer reaches a prompt bare: an ended session's recap, the expired-
  history fallback and a Product Research listing's title are fenced, and agent WebFetch goes through the app's
  reader (`kbFetch`: private addresses, redirects, size, robots, blocked sites) with the page fenced. A team step
  that proposes an ad change asks the owner like any run; a participant narrowed off the tool can't reach it.
- 2026-10-28 AA-24 Design pass: the workspace, team, Deploy and empty screens compared with the three boards at
  1440×900, and the reading column measured at 1920×1080 with the details panel closed (700 px, centred in the pane,
  composer on the same edges, no sideways scroll). Fixed: the owner's bubble is the board's neutral grey (it was the
  action red), the team's Unresolved mark is the board's blue "!" (a colour-class clash drew it white, reading as
  "I"), the Tools rows carry the board's check and cross, selects get a line chevron instead of the native arrow,
  scrollbars in the panes and dialogs are thin and dark, the list search placeholder fits ("Search conversations"),
  the empty workspace offers Deploy agent, and 47 hex values that duplicated theme tokens use the tokens. styleseed
  scored 79 before and about 95 after. The AA-22 audit rerun is clean (contrast, names, focus, sideways scroll).
  Screenshots at 1280×800, 1366×728, 1440×900 and 1920×1080 are in `.agent/aa24/`, all with no console errors.
- 2026-10-28 AA-25 Claude live smoke: one real run through the app's routes on Glow Haus (demo store), an
  Analytics Specialist conversation narrowed to store_summary and metrics_timeseries with a $0.50 budget, on the
  account's default model (Opus 5.5, medium effort). Done in 13.8 s for $0.112 (31,162 input and 1,053 output
  tokens): one store_summary call, an answer citing it and the demo data, three store memories from the reflection
  turn, and nothing else started. Details under Notes.
- 2026-10-28 AA-25b Codex live smoke: not run. `codex login status` on the dev server's `CODEX_HOME` still says "Not
  logged in", so the Blocked entry reads "Codex live smoke: needs the owner's sign-in" with the exact sign-in line.
  Codex isn't disabled. The final report lists the Codex smoke as unverified.
- 2026-10-28 AA-26 Acceptance: every "Done when" line walked against the tests and recorded checks. Three had no
  proof and now do: teams renamed, pinned, archived, found and reopened through their conversation (the team's own
  title follows); a 4-participant team end to end (two Copywriters at once, a dependent after its dependency with
  only its handoff, a failed task a retry recovers, a disagreement left Unresolved, the synthesis, assign_task
  refused); and the "Not connected · Set up" and "Claude only for now" labels in Deploy and Details. A headless
  click-through of 19 surfaces (the page and its three tabs, every ⋯ menu, the store switcher, Change runtime or
  model, the drawer's tabs, Deploy, Create team, Collaborate, the team page and its tabs, the empty workspace) found
  no control without an action. Three disabled buttons now say why on hover (Start team, Remove participant,
  Switch). `pnpm check` (1,615 tests) and `pnpm build` green; no console errors.
- 2026-10-28 AA-27 Final report: `docs/features/ai-agents-report.md` (what was built, changed areas, each "Done when"
  line with its tests or recorded check, what ran against real services and what only against fakes, limitations
  and what they need). Screenshots of the finished page in `docs/reference/ai-agents-final/` (conversation and team
  at 1280×800, 1440×900 and 1920×1080; Deploy, Create team, the settings drawer and the empty workspace at
  1440×900; no console errors). `docs/DESIGN.md`'s AI Agents screen and the Codex engine line describe the new page.
  `.agent/STOP` created; the lane is finished.
- 2026-10-28 AA-25b Codex live smoke, after the owner signed in: the first turn found that Codex refused every app
  tool ("MCP tool call requires approval, but approval policy is never"), so no Codex run had ever reached the app's
  tools. Fixed with `mcp_servers.frontline.default_tools_approval_mode="approve"` (the app's own approvals still ask
  the owner), with a test. The verification turn called store_summary over MCP, asked its ask_owner question, and was
  stopped while it waited: all four processes of the spawned tree gone, the question closed, the run Cancelled.
  The recorded lines replace the first four from-source lines of the Codex fixture. Details under Notes.
- 2026-10-28 (owner report, after v0.1.8) A deployed agent never showed up in the AI Ecosystem: the office seats only
  agents placed with its own "+ Deploy Agent", and Deploy here only opened a conversation. `saveConfig` now gives the
  agent a desk the first time it is deployed (new conversation, team, runtime change): its home department if a desk is
  free, else the first free one, with its default look (`appearanceFor`, moved to shared so the server can use it).
  An agent archived from the office stays out; a full office seats no one. Test in agents-deploy.test.ts.

## Blocked
- Resolved 2026-10-28: "Codex live smoke: needs the owner's sign-in". The owner signed in, and AA-25b ran (see Done
  and Notes).

## Notes
- (coordinator, 2026-10-28) Open questions for the owner. They don't block any item:
  - Codex in the app signs in with the owner's ChatGPT account (decision 9). Whether a ChatGPT plan may power an
    app's own agents isn't verified, and OpenAI points automation at API keys. The owner decides before relying on it.
  - The app has no user accounts, so "authorized stores" means every store in this app (decision 13). Isolation is
    between stores, not between users.
- (coordinator, 2026-10-28) For the owner: changes to existing flows, and follow-ups this lane leaves open. None of
  them blocks an item:
  - Runs started through POST /api/agents/:id/runs (Ask AI, the module starters) are now conversations and no longer
    get compare_stores unless a conversation turns it on (decision 13).
  - Codex ultra is off in v1. Offering it needs proof that multi_agent=false stops its delegation.
  - Codex v1 uses `codex exec`, so its replies appear only when complete. Streaming through the app-server is a
    follow-up, because it can't be proven without a signed-in turn. The plan's rate-limit percentage waits on the
    same follow-up (decision 9). AA-01 adds the app-server schema answer here.
  - Routes outside this page that still have no store check by id, left as a follow-up: /api/page-drafts/:id (GET,
    publish, DELETE), DELETE /api/creatives/:id, PATCH /api/order-issues/:id, and the KB research-task routes
    (knowledge lane).
- (coordinator, 2026-10-28) A deliberate deviation from KB decision 11, stated in this file's decision 11: a finding
  that save_finding saves in Automatically mode is always Unreviewed (status proposed), even when review is off. No
  human saw the text, and ordinary runs read pages through WebFetch, not the guarded fetch_source reader, so blocked
  domains and untrusted wrapping don't apply to it. The owner's own Save to Knowledge Base, and an Ask-me save the
  owner approved, follow the workspace's review setting.
- (AA-01, 2026-10-28) Probe and spike answers. No model turn ran. Method: SDK types and runtime calls without a
  prompt, the Codex CLI signed out in `.agent/codex-spike-home`, the generated app-server schema, and the Codex source
  on GitHub (main).
  - **Baseline** at a3c3b1d5: `pnpm check` green, 177 test files and 1342 tests in about 39 s.
  - **Claude probe:** `initializationResult()` with the run isolation options (`settingSources: []`, the
    agent-sessions cwd, no tools or MCP) answered in 0.9 s with 13 models on a Claude Max, first-party login.
    - The first five rows are aliases with a `resolvedModel` id: default and opus → claude-opus-5-5, fable →
      claude-fable-5-1, sonnet → claude-sonnet-5-5, haiku → claude-haiku-5-5. The legacy rows are full ids:
      claude-haiku-4-5-20251001, claude-sonnet-5, claude-opus-5, claude-fable-5, claude-opus-4-8, claude-opus-4-7,
      claude-opus-4-6 and claude-sonnet-4-6.
    - `supportedEffortLevels` is filled on every row except Haiku 4.5, which has no effort fields. Opus 4.6 and Sonnet
      4.6 stop at max without xhigh; the rest list low to max.
    - Nothing gives a default effort, so it comes from the registry (decision 9). The `default` row marks the account's
      default model.
    - For AA-13: dedupe rows by `resolvedModel`, store that id, and label it with the alias row's `displayName`
      ('Opus 5.5', not 'Default (recommended)').
  - **Claude resume check:** SDK 0.3.310 has `systemPrompt: {type: 'custom', prompt, snapshot: false}` (sdk.d.ts
    about 2423-2470), which renders the system prompt fresh on every request, resume included. The default, a bare
    string as today, records the prompt on the first request and resends that record on every resume until
    compaction. Decision 11 stays as written: keep the default and put the parts that change between runs in the user
    turn. Per the SDK doc, `snapshot: false` changes the system prompt on every follow-up, which drops the cached
    prefix and the model's earlier reasoning. Recording is still rolling out ("no effect where not enabled"), so
    whether this account records can't be told without a turn. The user-turn block is correct either way; at worst a
    card appears twice.
  - **Codex spike** (codex-cli 0.163.0, `CODEX_HOME` = `.agent/codex-spike-home`, `FRONTLINE_SECRET_KEY` unset):
    - `codex login status` prints "Not logged in" and exits 1.
    - Signed out, `codex debug models` and `codex debug models --bundled` print the same bytes: 11 models with slug,
      display_name, visibility (list or hide), default_reasoning_level, supported_reasoning_levels, tool_mode,
      apply_patch_tool_type, shell_type and multi_agent_version. Nothing marks the default model.
    - The app-server's `model/list` (initialize, then model/list over stdio) returns id, displayName, hidden,
      isDefault, defaultReasoningEffort and supportedReasoningEfforts. It drops hidden models itself (8 shown, 11 with
      includeHidden) and names the default (gpt-6.1-sol in the bundled catalog). **AA-15 reads the catalog through
      `model/list`**, because it marks the default and the hidden models explicitly. Five of the eight listed models
      offer ultra; the luna models stop at max and gpt-5.5 at xhigh. Signed out, `account/read` returns
      account null with requiresOpenaiAuth true.
    - `codex features list` with decision 9's twelve `-c features.<x>=false` flags: all twelve are present and read
      false.
    - **Paths outside the app's tools (preliminary; AA-15 settles them):**
      - Every catalog model has tool_mode `code_mode_only`. In spec_plan.rs (apply_mcp_tool_exposure_policy,
        is_hidden_by_code_mode_only), that hides MCP tools from direct calls: the model reaches them only through
        the code-mode executor or tool search. register_code_mode_executors checks only the tool mode, not
        `features.shell_tool`, so the executor exists in every run. The code-mode crate's lib.rs doesn't show what
        its runtime (codex-code-mode-host.exe) can reach, or whether nested MCP calls still emit `mcp_tool_call`
        items.
      - apply_patch has no feature flag. It is registered when the model has an apply_patch_tool_type ('freeform'
        on all 11), so only sandbox read-only with approval never stands between it and a write.
      - Shell and exec need `features.shell_tool` (off) and a shell_type; unified_exec only picks the handler.
        view_image is behind its flag (off). Web search follows the `web_search` config (disabled or live).
      - So AA-15 must prove the code-mode runtime and apply_patch can't act outside the app's tools, or ship Codex
        disabled (decision 9).
    - `codex mcp list` with `-c mcp_servers.frontline.url=…`, `bearer_token_env_var="FRONTLINE_MCP_TOKEN"` and
      `tool_timeout_sec=86400` lists the server enabled, with auth "Bearer token". It prints the variable's name,
      never its value. `codex mcp get frontline` shows tool_timeout_sec 86400.
    - **App-server schema** (`codex app-server generate-json-schema`, no turn): thread/start, turn/start,
      item/agentMessage/delta, turn/interrupt and model/list all exist, plus a model/rerouted notification. So the
      streaming follow-up under Notes is possible on 0.163.0's protocol. v1 still uses exec.
    - **Instructions from a file:** `model_instructions_file`. The config reference says "Replacement for built-in
      instructions instead of AGENTS.md", so it replaces Codex's base instructions. `developer_instructions` is
      inline only, and no other key loads instructions from a file. AA-15 passes
      `-c model_instructions_file=<per-run file>`.
    - **Git check:** in a non-git folder, `codex exec --experimental-json -` exits 1 with "Not inside a trusted
      directory and --skip-git-repo-check was not specified." before any turn. With the flag and signed out, it
      emits thread.started and turn.started, then `error` events "Reconnecting... n/5 (unexpected status 401
      Unauthorized: Missing bearer or basic authentication …)". No turn can run signed out. AA-15 maps that 401 to
      "Set up Codex".
- (AA-03, 2026-10-28) How the run manager behaves now, for AA-05 and later items:
  - Send is `start(agentId, task, undefined, undefined, {conversationId, clientRequestId})`. A turn's session is found
    when it leaves the queue (the latest earlier turn on the same config with a session), so a queued send goes on from
    the reply before it, and a turn after a config change starts a new session.
  - Retry and Resume both pass `retryOf`. start tells them apart: an interrupted run continues its own session; any other
    run is retried from the last **done** turn before it, or a fresh session. Both link `retry:<old>:<new>`.
  - A conversation that has turns from before the store went live refuses new turns ("ran on demo data … start a new
    one"), as resuming a demo run already did.
  - Seat share: what is left of the agent's daily budget ÷ (its working runs + 1). Runs already going keep their
    larger share, and spend() still stops the agent at its cap. The config's `budgetUsd` is a third cap; its stop reads
    "Stopped: this run's budget ($X) is used up.", and so does the engine's error_max_budget_usd when it was the
    smallest limit.
  - Error events carry `code` (the SDK error code or result subtype). isAccountError now covers eight codes: it adds
    oauth_org_not_allowed, account_on_hold, verification_required and cloud_credential_error, so those are told
    once a day too. Non-account codes no longer stop at the assistant message; they word the failed result.
  - Automatic retries pause 5 s, then 20 s, inside the same run, and drop the failed attempt's events from the
    transcript. "Changed something" is judged by tool name (`hasEffects`, exported for the attempt UI).
  - Only one test pinned the old fake session id: engine.test.ts calls the engine without a runId and keeps
    `fake-<agent id>`.
- (AA-04, 2026-10-28) For AA-05 and later:
  - A config's `tools` holds app tool names, Claude built-in names (WebSearch, WebFetch) and the role's external
    server keys (`meta_ads`). `defaultTools(role)` is the seat default: all of them except compare_stores.
    `runTools(role, mode, config)` and `allows(config, name)` (built-ins, external servers) narrow to it; a run with
    no config keeps the role's tools, compare_stores included. The run manager loads the run's config (`getConfig`,
    new `configs.ts`) and hands it to the engine as `RunInput.config`.
  - New routes add rows to `ROUTES` in `agents-scope.test.ts`; `wrongStore(c, db, table, id)` is the by-id check.
  - WebFetch is refused for loopback, private and `.local`-style hosts, also when the URL has no scheme. A missing
    URL is left to WebFetch's own validation.
  - Tools already took ids within `ctx.store` only. Demo stores share order numbers (ids are unique per store), so a
    cross-store id test needs an id the other store lacks.
  - **Where the new pieces live:**
    - packages/shared: `runtime-registry.ts`, and the derived run state with the new types in `index.ts`.
    - packages/agents: `claudeModels()` in claude-engine.ts; `config.ts` (validateConfig, the seat default, presets);
      `conversations.ts`; `recap.ts`; `codex-cli.ts` (the spawn helper, status, discovery); `codex-engine.ts`; team
      steps in missions.ts.
    - apps/server: `routes/agents-conversations.ts`, `agents-teams.ts`, `agents-runtimes.ts` and
      `agents-codex-mcp.ts`, mounted in app.ts.
    - apps/web: `src/agents/**` (the workspace, panes, dialogs, URL helper, pane-width clamp, `fill.ts`, the
      Markdown parser).
  - **Decisions:** none changed. Confirmed at HEAD: the next migration is #50 (49 removes gamification); runs.ts:79
    (activate check), :309 (the `status !== 'done'` guard) and :369 (restart retry); ask.ts:50; kb-sources.ts:124-128;
    tools.ts:1341-1342 (title 5–160, summary 10–600); runGist at runs.ts:431-439; app.ts:48 STARTS and :56 kbGuard;
    Shell.tsx:76 `PageBoundary key={pathname}`; ui.tsx:347 Dialog; OWN_TOOL at tools.ts:1584.
- (AA-25b, 2026-10-28) **Codex live smoke**, after the owner signed in (`codex login status` on the dev server's
  `CODEX_HOME`: "Logged in using ChatGPT"):
  - **How it ran:** the same method as AA-25. A throwaway script (`apps/server/src/zz-aa25b-smoke.ts`, deleted after,
    never committed) used an in-memory demo database. The app was served on a free port so Codex could reach its MCP
    endpoint. It ran on the dev server's signed-in `CODEX_HOME`, with `FRONTLINE_SECRET_KEY` unset and the engine not
    forced. `child_process.spawn` was wrapped (`syncBuiltinESMExports`) only to copy `codex exec`'s stdout and read its
    PID; the app's own code spawned Codex.
  - **Dry run (no model turn):** Codex connected, CLI 0.163.0, catalog default `gpt-6.1-sol` at low effort, and no run
    at startup.
  - **Config:** `{ runtime: 'codex', model: 'gpt-6.1-sol', effort: 'low', tools: ['store_summary', 'ask_owner'],
    permissions: { stopAfterMin: 3 } }` on Glow Haus.
  - **Message:** "Call store_summary once. Then use ask_owner to ask me which product this store should lead with this
    week, and wait for my answer. Use no other tools."
  - **Turn 1, 16:17 UTC:**
    - Done in 13.0 s (30,556 input and 139 output tokens).
    - Both tool calls failed inside Codex: `"MCP tool call requires approval, but approval policy is never"`.
    - The model answered "Both tool calls were blocked by the approval policy." The transcript held only that text: a
      call Codex refuses never reaches the app's endpoint, so no tool_call row is written.
  - **Cause** (codex-rs at rust-v0.163.0: `codex-mcp/src/server.rs` `McpServerMetadata::tool_approval_mode` and
    `core/src/mcp_tool_call.rs` `requires_mcp_tool_approval_for_mode`):
    - A custom MCP server's tools default to approval mode `auto`.
    - `auto` asks for every tool without `readOnlyHint`, and the app sends no annotations.
    - `approval_policy="never"` turns that ask into a refusal.
    - So since AA-15, no Codex run could reach any app tool. The fakes and the from-source fixture assumed the calls
      went through.
  - **Fix:** `-c mcp_servers.frontline.default_tools_approval_mode="approve"`. In `approve` mode Codex never asks. The
    app's approvals and ask_owner still ask the owner for anything consequential, and the endpoint still lists only the
    run's tools. Test: `agents-codex.test.ts` (the endpoint test) asserts the flag; it failed before the fix.
  - **Turn 2, 16:21 UTC, same config, after the fix:**
    - store_summary `{ range: 7 }` returned Glow Haus's 7-day numbers over MCP (12.1 s).
    - ask_owner asked "Which product should Glow Haus lead with this week?" and waited as a pending question (12.2 s).
    - The descendant tree just before Stop, walked by `ParentProcessId` from the spawned PID: `codex.exe` 11560 →
      `conhost.exe` 5920 and `codex-code-mode-host.exe` 8932 → `conhost.exe` 30832.
    - Stop (`POST /api/conversations/:id/stop`) at 13.0 s answered 200. The run became Cancelled and codex exited 1.
    - Three seconds later all four PIDs were gone. The question's approval row was denied, leaving none pending.
    - Conversation state cancelled; one agent_runs row in all.
    - Codex reports tokens only in `turn.completed`, which a stopped run never sends, so this run reported none.
  - **Fixture:** CODEX_TURN's first four lines (thread.started, turn.started, store_summary started and completed) are
    now turn 2's recorded lines. The ask_owner start has no matching line, and the lines after Stop stay 'from source'.
    The recorded item.started carries `result: null, error: null`, which the source-built line left out.
  - **Two live turns,** where decision 16 allows one. The first exposed the bug, the second verified the fix. Both ran
    on the ChatGPT plan, with no Claude usage.
  - **What it proves, beyond the mocked tests:**
    - the CLI takes the app's flags on a signed-in home;
    - the MCP endpoint and its bearer work, and app tools reach a real Codex model;
    - a narrowed tool list holds;
    - a question waits inside the tool call;
    - Stop kills only the spawned tree and leaves nothing pending.
  - **What it doesn't prove:** a completed Codex answer after a tool call, resuming a Codex session, request_approval
    through Codex, and Codex in a team.
  - **Follow-up idea:** a call Codex refuses itself never reaches the endpoint, so the transcript shows nothing. Mapping
    a failed `mcp_tool_call` item from the JSONL to a tool_result error would make such refusals visible.
- (AA-27, 2026-10-28) **For the owner, after the lane:**
  - **Follow-up ideas** (not items; see the report's Limitations): a waiting state for a team step paused on an
    approval; a cost estimate in Create team once per-model prices exist; per-record views in Analytics and Product
    Research for reply links; Codex wiring for external MCP servers such as Meta Ads.
- (AA-26, 2026-10-28) For AA-27:
  - **The click-through** (`.agent/aa26-click.mjs` through `cdp-drive.mjs`, output in `.agent/aa26/click.txt`): on
    each surface, every visible button, link, input, tab, menu item, radio and switch must have a React handler (on
    it or within three parents), an href, a native popover target, or be a submit in a handled form; otherwise it's
    disabled, and its reason is listed. A self-test (`CLICK_SELFTEST=1`) plants a dead button, a link with no href
    and a disabled button with no reason, and the check flags all three. Disabled until something is typed or
    changed: Send, Save budget, Teach the squad (the empty field is the reason). The Flows tab shows only for an
    Email/SMS seat, so it wasn't on this run's Copywriter seat.
  - **Also fixed:** `updateConversation`'s doc comment had slipped above `setConversationConfig`.
- (AA-25, 2026-10-28) **Claude live smoke** (decision 16), the lane's only live Claude turn, 15:19 UTC:
  - **How it ran:** a throwaway script (`apps/server/src/zz-aa25-smoke.ts`, deleted after, never committed) on an
    in-memory database with `seedDemo`, `createApp(db, <random key>)`, the real routes through `app.request`, and the
    engine not forced (no `FRONTLINE_AGENT_ENGINE`, no `VITEST`), so only a conversation configured for Claude reaches
    it. `FRONTLINE_DATA_DIR` pointed at an empty scratch folder, so the Codex check saw an empty, signed-out home and
    nothing touched the dev server's data. Queued research tasks and missions were cleared first (there were none).
    A dry run of the same flow on the demo engine came first: no run at startup, only its own run after.
  - **The run:** `POST /api/conversations?store=glow` with type market_analyst, config `{ runtime: 'claude', model:
    'claude-opus-5-5', tools: ['store_summary', 'metrics_timeseries'], permissions: { budgetUsd: 0.5 } }` (the model
    is the runtimes list's default, checked not to be Fable; effort left at its default, medium) and the message
    "Call store_summary once, then tell me in two short sentences which number this store should watch this week and
    why. Use no other tools."
  - **Result:** status done in 13.8 s wall time; $0.112 (31,162 input, 1,053 output tokens) against the $0.50 cap,
    reflection included. Transcript: one tool_call `store_summary { range: 7 }` with its result, one reply ("watch
    average order value: it fell 8.0%, from $48.14 to $44.31 … (store_summary, simulated demo data) …"), three
    memory_written events, done. Conversation state completed; the thread route answered 200. One agent_runs row
    in all.
  - **What it proves, beyond the mocked tests:** the Agent SDK takes the app's run options (model id, effort,
    `maxBudgetUsd`, session isolation) on this account with a real model; app tools reach a real model over the
    in-process MCP server and their results come back; a narrowed config holds (the model used only the allowed tool);
    the real stream lands as a run transcript with real usage and cost; the reflection turn resumes the real session
    id and writes store memory; demo answers say they're demo data.
  - **What it doesn't prove:** Codex (AA-25b), approvals with a real model (a read-only run asks for none), team runs,
    retry and resume after a real failure, and live MCP servers (Meta Ads isn't connected on a demo store).
  - **Worth knowing:** the reflection writes store memory whatever the config's tool list (it is the squad's memory
    feature, not a tool), and its cost counts toward the run's budget.
- (AA-24, 2026-10-28) For AA-25 and later:
  - **styleseed findings answered, not changed:** the type scale has half-pixel steps (10.5, 11.5, 12.5, 13.5 px);
    they are the boards' own sizes, size for size, so they stay. The remaining hex values (#1d1d22, #111114,
    #ff6b76 for links, #7aa7ff for Needs reply and Unresolved) have no theme token; the boards use them as is. The
    Tools rows show a green check on every available tool as the board does, with text beside it, so status never
    rests on colour alone.
  - **Orca's browser** at 1280×800: `orca exec --command "set viewport 1280 800"` works but resets on reload, and its
    screenshot tiles anything wider than its ~800 px pane. The 1280×800 check there is measurements and console
    (no sideways scroll, two panes, 700 px column, zero console errors); the 1280×800 image comes from cdp-shot.
    Set `frontline:onboarded` in localStorage first or onboarding covers the page.
  - **A class clash to watch:** passing a colour class into `cx()` next to a default colour of the same property
    doesn't override it; the generated CSS order decides. Team's `Event` now takes `tone` in place of its default
    colours.
  - **Scripts:** `.agent/aa24-reading.mjs` (reading column measurements) and `.agent/aa24-mark.mjs` (computed
    colours of the team avatars), both through `cdp-drive.mjs`.
- (AA-23, 2026-10-28) For AA-24 and later:
  - **WebFetch is an app tool now** (`tools.ts`, served over the frontline MCP server as `mcp__frontline__WebFetch`;
    Codex gets it through its MCP endpoint too). The Claude engine filters the built-in out, so the old `privateUrl`
    check in `canUseTool` went with it: the shared reader refuses private addresses itself. Its input is a full
    http(s) URL; a bare `host:port` is an invalid input.
  - **What reaches a prompt, reviewed:** owner messages and notes are the owner's words; KB cards (KB_UNTRUSTED),
    attachments, team contributions and syntheses, tool results and web pages are fenced or labelled as data; the
    recap (`conversationPreface`) fences the earlier work itself, so teams use it as is instead of wrapping it again.
  - **The secrets sweep** reads `app.routes`: a new GET route is swept automatically unless it matches the SKIP list
    (live, runtimes, Claude sign-in, OAuth, backups, media and images, supplier search).
  - **Outside the lane:** `UpdatePrompt.test.tsx` (ui, stopped) waits for the popover call; it failed two full runs in
    a row under load. `trends.ts` (product-research) got the one-line store check above.
- (AA-22, 2026-10-28) For AA-23 and later:
  - **The audit scripts** are in `.agent/` (not in git): `aa22-audit.mjs` (contrast, names, focus, sideways scroll;
    `AUDIT_OPEN` clicks buttons first), `aa22-sizes.mjs` (pane widths per window size) and `aa22-drawers.mjs` (a
    drawer's keyboard path), each run through `cdp-drive.mjs`. Rerun them after UI changes in AA-24 and AA-26.
  - **What the audit doesn't cover:** closed popovers and menus (only open ones are seen), disabled controls (exempt
    under WCAG 1.4.3), and text over images (none here). Screen-reader names were checked from the DOM, not with a
    screen reader.
  - **The shell sidebar** scrolls at 1024×680 (its own height). It's the ui lane's, and it doesn't scroll sideways.
  - **Streaming in jsdom:** react-query notifies on a timer, so a test asserts streamed text with `findBy…` after
    sending events, not `getBy…`.
- (AA-21, 2026-10-28) For AA-22 and later:
  - **Event numbers:** `seq` counts a run's live events from 1 (RunManager slot). It isn't stored: an ended run has
    none, and its stored transcript is the whole of it. A transient retry skips a number on purpose, so a client that
    streamed the failed attempt refetches. An event emitted before the run's slot exists would read 0 and be skipped;
    none is today.
  - **The race the seeding covers:** the demo engine finishes before the POST response lands (on the dev server the
    first ~24 events arrive before the client knows the run id). The `queued` run message seeds the copy at seq 0, so
    those events still apply in order.
  - **Polls left:** useKbTask (KB lane) still polls every 2 s while a task runs; health and integrations poll on long
    intervals. Not AA-21's to change.
  - **Failure matrix, as built:** provider disconnected → the lost-connection line + Retry; expired sign-in → Check
    your Claude login (Claude) or Change runtime or model (Codex: the dialog has Set up Codex); rate limit → Change
    runtime or model + Retry; timeout → Change runtime or model (Stop after is there) + Retry; unavailable model and
    Codex missing → Change runtime or model; interrupted → Resume. "Change runtime or model" shows only on the
    conversation page's latest turn (a team's follow-ups have no such dialog). Overloaded and server errors were
    already "Retry in a few minutes" with Retry.
- (AA-20, 2026-10-28) For AA-21 and later:
  - **Live team updates:** `useLive` sets `['team', id]` from the `mission` message (every advance and team route
    publishes one) and refetches it on a team step's `run` message. AA-21 can fold this into its reconnect handling.
  - **Approval states on teams:** a step's status is its run's status, which has no approval or needs-reply state, so a
    step waiting on an approval reads Running in the plan, the tabs and the list (ponytail in Team.tsx `stateOf`). Its
    participant tab shows the approval card. Surface it if owners miss approvals inside teams (AA-23 looks at approvals in teams).
  - **Not built:** the dialog's cost estimate (no per-model prices on the web) and a separate "Team name" field (the
    title comes from the objective's first line and is renamed in the team view, through its conversation row).
  - **"At once"** offers 1 and 2: the server's store limit (teams.ts STORE_LIMIT). Change both together.
  - **Participant sub-rows** show under a running team and the open one; an ended team's row stays one line.
  - **Codex participants** get Stop after 20 minutes (Deploy's default), since a team row has no Stop after field.
- (AA-19, 2026-10-28) For AA-20 and later:
  - **Team URLs:** the notifications link `/agents/t/<team id>?store=` (the squad_missions id, as agentsUrl's `team`).
    The team's conversation is `team.conversationId`; its conversations row has `teamId`.
  - **Interrupted steps:** a step whose run was cut by a restart reads `status: 'error'`, `interrupted: true`, with the
    note "Interrupted by an app restart: resume it to go on." The team stays `running` (not ended) until it is
    resumed (POST /api/teams/:id/steps/:step/resume) or stopped. There is no 'interrupted' team status: the UI reads
    it off the steps.
  - **A used-up team budget** leaves the remaining steps `waiting` with "Not started: the team's budget ($X) is used
    up." The team stays `running` and sends "Team needs you" once; the owner stops it. ponytail: no "raise the budget"
    route yet.
  - **Backoff:** 30 s, then 2 min. The app advances missions on every run end and every 60 s, so a retry can start up
    to a minute after its `nextTryAt`.
  - **A task's answer without the JSON block** still hands on its text as the contribution's output, with its first
    sentence as the summary (ponytail). An invalid plan, by contrast, is a failed attempt.
  - **Add agent** is refused once the plan step's run has ended; while the lead is still planning it is accepted, but
    that plan won't use the new participant.
  - **Team conversations in the left list:** the conversation queries already type a team's conversation as `'team'`
    (AA-05), so it never joins the lead type's group; AA-20 renders that group as Teams.
  - **Messages to a team's conversation** are refused (409) while the team runs; "To: Lead" goes to the notes route then.
- (AA-18, 2026-10-28) For AA-19 and later:
  - **Save to Knowledge Base is an inline panel** under the reply's actions, not a floating popover: it holds a title,
    a summary and the demo note, and an inline panel needs no positioning code. Its confirmation replaces it and links
    the card.
  - **Which block a reply save takes:** the reply's last text part (`replyBlocks()` splits the final text where an
    approval request sits). The route takes a block index, so a later per-block button needs no server change.
  - **A save never refreshes a card:** the observed row is evidence the owner can weigh, not a re-read, so
    `verified_at`, the stage and revisions stay as they were. A store duplicate gets the row; a General duplicate gets
    nothing ("Already in General"), so one store's work never edits General.
  - **Not checked in Chrome:** the demo engine never calls save_finding, so automatic and Ask-me saves are covered
    by agents-findings.test.ts on the scripted engine only.
- (AA-17, 2026-10-28) For AA-18 and later:
  - **Follow-up knowledge, verified without a live turn (decision 16):** AA-01 read SDK 0.3.310's types and found the
    default (a bare `systemPrompt` string) records the prompt with the session and resends that record on resume. So
    on a resumed session, runs.ts builds `assemblePrompt({ ...layers, changing: true })` (memory, knowledge, jobs,
    waiting requests, the date: no role layers) and sends it in the user turn as "The app's context for this message,
    as it is now (not the owner's words):", then "Now: <message>". The system prompt is still built and passed, so an
    account that doesn't record yet sees the cards twice at worst. agents-references.test.ts checks the turn the
    scripted engine receives; no model turn ran.
  - Query: `conversationQuery` (conversations.ts) joins the title, the first run's task and the message, each cut to
    1,000 characters, without repeats. Memory still searches by the message alone.
  - `withConflicts` (kb-retrieve.ts) adds an open conflict's other side (the other card, else the conflict's note, 300
    characters at most) to a card's line: "(Research-Supported; unresolved conflict: [kb:<id>] <title>: <summary>)".
  - `KB_UNTRUSTED` (prompt.ts) is the framing sentence. It's in the knowledge section's intro, which now counts against
    the budget, and on the first line of search_knowledge's output when it finds cards ("(none)" is unchanged).
  - Deploy's knowledge scopes now apply: `inScope(config.knowledge)` filters the prompt's cards, and search_knowledge
    reads the run's config (by SQL, not configs.ts, which imports tools.ts). A research task ignores it.
  - The `knowledge` event (`{type, cards: KnowledgeRef[]}`) is the run's first transcript event when cards were placed.
    The activity step reads "Read N knowledge cards: <titles>". The cards placed are logged as 'prompt' in
    kb_retrievals, as before.
  - Attachments: `readAttachments` (agents-conversations.ts) takes up to 10 `{name, data}` (base64), pdf/txt/md/csv/html,
    10 MB in all, read with the KB's `readUpload`; text cut at `ATTACHMENT_TEXT` (20,000) with `cut`. Kept in
    `agent_runs.attachments_json`; a retry or resume copies the run it retries. The engine gets the message, then one
    `untrustedBlock` per file. No kb_sources row. "Send as a new conversation" (DEMO_SESSION) doesn't carry them.
  - `GET /api/conversations/:id/knowledge?store=` returns `KnowledgeUse[]`: the latest started run's kb_retrievals,
    this store's and General's cards only, with how each was used (prompt, search, cited). It refetches with the
    conversation (the socket invalidates `['conversation', id]` on every run message). AA-18 adds findings.
  - Web: Workspace's Panes holds the panel tab (`fe.agents.tab`), and Details takes `tab` and `onTab`. The composer's
    chip sets Knowledge and opens the panel, or the drawer when it doesn't fit. Citations use `kbCardQuery(id, store)`
    (`ws=<store>&general=1`, no retry and no `retryOnMount`: remounting the chip retried the 404 in a loop). An id that
    404s renders as written, unnumbered, with a "not available in this store" chip. components/Chat.tsx's old
    Transcript (DevGallery only) still asks with `ws=all`.
  - Touch points outside the lane: `untrustedBlock` in kb-sources.ts and `withConflicts`/`inScope` in kb-retrieve.ts
    (decision 1), and `base64` exported from knowledge/Research.tsx for the attach helper.
- (AA-16, 2026-10-28) For AA-17 and later:
  - `ask_owner` is in every role's base tools (roles.ts BASE). A run with no conversation is refused (scheduled and
    module runs have no composer to answer in). It calls `approvals.create` and `approvals.decision` itself, emits
    approval_request (so the slot frees and the state reads waiting_for_input), and skips the suggest, autopilot,
    patience and storeMoved gates. Answered: "The owner answered: <text>"; closed unanswered (Stop, run end): "The
    owner didn't answer…". Configs saved before AA-16 list their tools, so their conversations can't ask.
  - `ApprovalRequest.conversationId`: the asking run's conversation, from a join in approvals.ts (`getApproval`,
    `listApprovals`) and filled on create. Question notifications link to `/agents/c/<id>?store=`.
  - `decide()` now keeps a note on approve too; that note is a question's answer. The answer route takes `{text}` of 1 to
    4,000 characters (400 otherwise) and returns 409 unless the approval is a pending question of `?store=`, missing
    ids included. The generic approve and deny routes are unchanged.
  - request_approval refuses `question` and `kb.save` ("Not sent: <kind> requests come from ask_owner / save_finding.
    Use it instead."). `kb.save` isn't in OUTLIVE_RUN, so a run's end closes it. save_finding itself is AA-18's; the
    card's Save and Skip are ready (Skip asks no reason, the verdict reads Saved or Skipped).
  - `ApprovalCard` dispatches: a question renders `QuestionCard` (no buttons; `here` in its own thread says "Answer in
    the message box below."; decided: "You answered: …" or "Not answered."), everything else the old card.
  - The composer finds its conversation's pending question in `useApprovals()` (by conversationId) and sends the answer
    instead of a message; the placeholder reads "Answer <type>'s question".
  - `GET /api/runs` and `/api/runs/:id` carry `state` (stateOf); run events over the socket don't, so a cached run's
    state can lag until refetch. The conversation header uses the conversation's own state.
  - Compaction: the SDK's `compact_boundary` system message (SDKCompactBoundaryMessage, SDK 0.3.310 types; not seen
    live) maps to the notice "Earlier context was summarized to fit." An expired session already went on from the
    recap (AA-05, AA-14b); the activity now says so.
  - Already in place before AA-16 and checked: the derived states with the question split (AA-02), RUN_STATUS labels
    ("Approval", "Needs reply", "Interrupted"), the Stop tooltip "Stops this reply. Pause isn't supported." for both
    runtimes (Codex's Stop kills the tree, AA-15), queued sends (the composer while a reply runs).
- (AA-15, 2026-10-28) For AA-16 and later. Method: the codex-cli 0.163.0 source and protocol schema, `features list`
  under the run flags, and one signed-out exec (recorded); no model turn ran.
  - **Isolation proof: Codex ships enabled.** With sandbox read-only, approval never and these features off
    (`CODEX_FEATURES_OFF` in codex.ts): shell_tool, hooks, multi_agent, multi_agent_v2, apps, plugins,
    image_generation, browser_use, computer_use, in_app_browser, goals, view_image, skill_mcp_dependency_install,
    the model reaches only the app's MCP tools and, when the role has WebSearch, web search. Why each other path is
    closed:
    - code mode is a V8 isolate with no imports, file system or network, so it can only call the enabled tools;
    - apply_patch is rejected under read-only + never ("writing is blocked by read-only sandbox");
    - shell needs shell_tool; request_permissions_tool is off by default; view_image is in the list;
    - `~/.agents/skills` loads whatever `CODEX_HOME` is, hence `skills.include_instructions=false` and
      `skills.bundled.enabled=false`; `project_doc_max_bytes=0` keeps AGENTS.md out.
    - An unknown `-c features.x` is silently ignored, so presence is checked: the recorded list
      (fixtures/codex-0.163.0-features.txt) is the test, and on a CLI version not in `CODEX_TESTED` the status check
      runs `features list` under the run flags and reads "Not available: Codex <v> changed a feature the app turns
      off" if one is missing or on.
  - Flags: `--json` is the documented flag (`--experimental-json`, as the item says, is its hidden alias). `exec resume`
    takes no `-s`/`-C`, so everything goes as `-c` config and the work folder is the spawn's cwd.
  - Work folder: `FRONTLINE_CODEX_WORK` (tests set a temp dir) or `%LOCALAPPDATA%\FrontlineEcom\codex-work\<store>`. It's
    refused when a parent holds `.git`, Codex's own project-root marker, so no git process is spawned to check.
  - App tool calls show from the endpoint: it emits tool_call and tool_result around each call. Exec's
    `mcp_tool_call` items for the `frontline` server are skipped, because code mode can nest calls the JSONL doesn't
    show. Other servers map to `mcp__<server>__<tool>`. Codex runs get no store MCP servers: Meta Ads and the like
    read "Claude only for now" in Deploy and Details.
  - Endpoint: `/api/codex/mcp` (every method), stateless Streamable HTTP with JSON responses, a new McpServer per
    request. Auth is the run's 64-hex bearer, held only in memory (`RUNS` in codex.ts) and handed to the child as
    `FRONTLINE_MCP_TOKEN`; an unknown or ended token gets 401. The URL uses the port the server listens on.
  - Long waits: an approval holds the tool call's HTTP request open (`tool_timeout_sec=86400`; Node sets no response
    timeout). Whether Codex's HTTP client keeps a long idle request open is unconfirmed until AA-25b watches one.
  - Status, no model turn: `--version` means installed, `login status` exit 0 means signed in, app-server
    `model/list` over stdio gives the catalog (hidden models left out). Signed out, `model/list` still answers from
    the CLI's bundled catalog (the dev server shows "Set up Codex" with 8 models); whether a signed-in account sees a
    different list is unconfirmed until the owner signs in. The result is cached 5 minutes; Check again
    (`?refresh=1`) skips the cache, and Set up Codex resets it when `codex login` exits. Under vitest or a forced
    engine the server never spawns codex: Codex reads not connected with the demo reason.
  - Errors: 401, unauthorized or not logged in means "Set up Codex" (codex_signed_out); a usage limit or 429 means
    the limit text (codex_usage_limit). Both are account errors (`isAccountError`), like Claude's. "no rollout found"
    is session_not_found, so a follow-up goes to the recap like a lost Claude session. Anything else reads "Codex
    stopped: …" with cf-ray and request ids cut. Retry notices are deduped with their digits normalized. The success
    turn is 'from source' (`CODEX_TURN` in fake-codex.ts) until AA-25b records one.
  - Runs record `runtime_version`, skip reflection on Codex and report tokens with costUsd 0. `expireApprovals` now
    runs at every run end (it skipped done runs), so a Codex run that ends during an approval wait leaves nothing
    pending.
  - Validation: Codex refuses a budget, needs Stop after and refuses ultra (`CODEX_ULTRA`). Deploy prefills Stop
    after with 20 minutes. Moving a conversation to Codex sends `stopAfterMin` (the config route now takes it), and
    the budget stays with Claude. An effort option can be `disabled` in `Segmented`, with its reason in the title.
  - Tests: `fakeCodex` (fake-codex.ts) stands in for every spawn. The tree-kill test runs node with a grandchild and
    checks that both PIDs are gone after Stop.
  - The server refuses a Codex run while Codex isn't signed in (field runtime, the status reason).
- (AA-14b, 2026-10-28) For AA-15 and later:
  - **Routes** (App.tsx): `/agents` (NAV[1], still the sidebar's AI Agents), `/agents/c/:id` and `/agents/t/:id` render
    Workspace; `/agents/:id` renders `LegacyAgent` (Workspace.tsx). `agentsUrl` builds `/agents?store=`. Links other
    modules and the server write as `/agents/<store:role>[?tab=…]` keep working through the alias; nothing else needs
    to change them.
  - **Remembered conversation:** only the bare `/agents?store=` URL goes back to the store's last conversation. Any
    other parameter (`settings`, `deploy`, `expand`, `run`, `change`) opens on the workspace itself, so the drawer and
    dialogs never get dropped by that redirect.
  - **Moved, not kept** (by design, the old page's parts the new one doesn't have): the store-health line and squad
    grid with "N things learned" (health stays on Analytics and the Dashboard), the seat header's "Demo engine" /
    "Claude Opus 5.5" badges (each conversation's runtime chip and Details show what it runs on), and the Chat shell's
    "Try again" (the workspace's Retry, Conversation.test). Their tests went with them; the rest moved to
    `agents/settings.test.tsx`, `components/Chat.test.tsx` (now on `Transcript`), `Conversation.test.tsx`,
    `Workspace.test.tsx` and `nav.test.ts`.
  - **Drawer:** the seat's pending requests show above its tabs (`useApprovals`), as AgentDetail did. `AgentSettings`,
    `AUTONOMY`, `History` and `Memory` are module-private now.
  - `Chat.tsx` keeps `Transcript`, `FixLink`, `DenyReason`, `ApprovalCard` and `ToolBlock`.
- (AA-14, 2026-10-28) For AA-14b and later:
  - **Dialog** (ui.tsx): `width`, `subtitle`, `headerExtra`, `footer`. With a footer the dialog is a flex column capped
    at the viewport and only the body scrolls (`open:flex`, so a closed dialog stays hidden). `Segmented` takes
    `quiet` (the board's grey selection, full width), ReactNode labels and a per-option `title`.
  - **Opening:** `useDeploy()` (`?deploy=`, a type id preselects; empty opens on the first type) and
    `useChangeRuntime()` (`?change=runtime`) in Deploy.tsx. Workspace mounts Deploy in Panes and ChangeRuntime in
    ConversationView. Create team (AA-20) can follow the same pattern.
  - **Runtime choice:** `useRuntimeChoice(store, start)` resolves against `GET /api/runtimes`: a live store never shows
    Demo; an unlisted model falls back to the login's default; an effort the model lacks falls back to its default;
    a model with no efforts sends none. `RuntimeFields` renders runtime, model (label in the select, description
    under it), effort, the source caption and the Fable and demo-store warnings. AA-15 adds the Codex option there.
  - **Deploy payload:** `tools` only when a draft is off or compare is on (else the type's); `knowledge` always;
    `permissions` holds only the budget (Claude) and Stop after. The draft switches are `DRAFTS` in Deploy.tsx;
    "Compare with my other stores" shows for `market_analyst` only. The footer's menu is a single "Save as preset"
    text button (a one-item menu at the screen's bottom edge had no room to open).
  - **Change runtime:** `POST /api/conversations/:id/config?store=` `{ runtime, model?, effort? }` → the conversation
    with its new config; 409 while a reply is going and when the conversation has no run since go-live; 400 with a
    field otherwise. Tools, knowledge and limits carry over; a budget carries over only to Claude.
    `setConversationConfig` points the conversation at the new config. start()'s DEMO_SESSION check now looks at the
    current config only, so a switched conversation keeps going.
  - **Recap:** `conversationPreface(db, conversationId, before?)` = what it was opened from + `recap` of its own
    finished turns before `before`. `recap` adds the objective when the first exchange fell outside the budget and
    the cited cards (`[kb:id]` in final answers, this store and General only). The run manager uses it on every
    fresh session of a conversation and on the expired-session retry (`recapped(attempt, preface)`); open questions
    come in through the final answers (every type's checks end by listing them).
  - `runtimeLabel` and Details use `EFFORT_LABEL` ("Extra high"). `ACCESS` and `DemoPill` are exported for reuse.
- (AA-13, 2026-10-28) For AA-14 and later:
  - **Registry** `RUNTIME_REGISTRY` (version 2026-10-28): the pricing, effort and model-config pages were fetched
    today; the models overview is codemap item 21's fetch of the same day. Default efforts are Claude Code's (the SDK
    drives it): medium on Opus/Sonnet/Haiku 5.5, xhigh on Opus 4.7, high elsewhere; Haiku 4.5 takes none. Also
    `registryModels()`, `defaultEffort(model)`, `EFFORT_LABEL` (xhigh → "Extra high").
  - **Discovery:** `claudeAccount(cwd)` now calls `initializationResult()` with `settingSources: []` and the
    agent-sessions cwd, and returns `models` (`ClaudeAccount.models`). `claudeModels(infos)` dedupes rows on
    `resolvedModel`, labels with the alias row's displayName, marks the default row's model, and flags a row without
    effort fields (`effortsFromRegistry`, Haiku 4.5 on this login). A model the registry doesn't know defaults to high
    (or its first level). `claudeRuntime(account, reason?)` builds the `RuntimeCapabilities` row: `reason` only when
    Claude is known to be unusable (signed out, or the demo engine forced); a failed check has no reason and lists the
    registry (`source: 'registry'`, `registryVersion`). `registryVersion` is also set when any model's efforts came
    from the registry.
  - **Server:** `apps/server/src/routes/agents-runtimes.ts` holds `agentSessions`, the 5-minute login cache
    (`claudeLogin(refresh)`, the claude-account route) and `runtimes(refresh)` (`GET /api/runtimes`, `?refresh=1`).
    Routes await `runtimes()` before validating: `openConversation(db, runs, store, input, caps)`,
    `savePreset(db, store, input, caps)`, `validateConfig(store, type, input, caps)`,
    `seatDefault(store, type, claude?)`. The team routes (AA-19) pass the same.
  - **Validation:** runtime `demo` only where the seat default is demo (never on a connected store, nor when Claude is
    forced); `claude` refused with the capability's `reason`; the model must be a resolved id on the list (aliases
    are refused); the effort must be one of the model's, or absent when it has none; a left-out effort takes the
    model's default. `codex` is refused until AA-15 ("Codex isn't available in this version of the app yet."); its
    budget, Stop after and ultra rules come with it. A preset keeps an effort only when one was chosen.
  - **Engine:** `defaultEngine` runs a config with runtime claude on Claude on a demo store too (ponytail: a demo
    config on a store that went live runs on Claude). The Claude engine asks for `config.model ?? agentModel()` and
    passes `effort` explicitly (`config.effort ?? defaultEffort(model)`), never `fallbackModel`. Runs without a config
    get agentModel() at its default effort and record both through the new `RunInput.onRuntime` (the run manager
    fills runtime, model and effort where null, and sets `actual_model`, `effort_applied`).
  - **What ran:** `actual_model` is the init message's `model`; `effort_applied` is the `effort.level` of the
    PreToolUse and Stop hook inputs. Absent `effort_applied` with an `effort` means unconfirmed. Unverified until
    AA-25's live run: whether those hooks fire under `settingSources: []`, and whether init's `model` equals the
    requested id exactly (a suffix would show a false "Ran on…" line). A mismatch adds a new `AgentEvent`
    `{ type: 'notice', text }`, which the reply's activity shows as a warning step.
  - **Fable:** any result error mentioning "usage credits" becomes the CREDITS text. The model-config page says an
    SDK app that shows no consent prompt bills credits without asking, so the error may never come; AA-14's dialog
    carries the warning.
  - For AA-14: the caption reads `source`, `registryVersion` and `checkedAt`; model names are `RuntimeModel.label`
    (the web's `modelName()` still formats ids, and `runtimeLabel` still capitalizes efforts as "Xhigh");
    `effortsFromRegistry` deserves a note on that model.
- (AA-12, 2026-10-28) For AA-13 and later:
  - `useStartConversation(storeId)` (client.ts) → `{ start({ type, title?, objective, context? }), isPending, error }`
    posts to `/api/conversations` and navigates to the conversation. One hook per store, so a multi-store list puts it
    in a row component (Analytics' `AskStrategist`).
  - `conversationPreface` reads a campaign context's record from `campaigns` and `campaign_daily` (the store's own
    data); the name the module passed is only the chip's label.
  - `runDeliverables(db, runId)` (conversations.ts) feeds `AgentRunDetail.deliverables` in the thread and in
    `GET /api/runs/:id` (absent when empty). The reply's "Made in this reply" row links a creative to its Creative tab,
    a page draft to `/builder?draft=`, a flow draft to the Email & SMS drawer's Flows tab and an ad request's campaign
    to `/analytics` (no per-campaign view exists; the chip uses the same). Approvals stay as their inline cards.
  - Run notifications (agents.ts onRun) link to `/agents/w?store=&run=`: AA-14b moves that path with the workspace.
    Module starters keep the legacy `/agents/<seat>?run=` form, which AA-14b maps.
- (AA-11, 2026-10-28) For AA-12 and later:
  - Contracts: `RoleSpec` gained `workflow`, `knowledge`, `outputs`, `checks` and `task` (the Default preset's name);
    `contractOf(spec)` adds `WORKFLOW_FIRST` before and `CHECKS_LAST` after (check against the request, the
    [measured]/[research]/[hypothesis] rule, open questions, no claimed action that didn't happen), and lists the MCP
    servers with the tools. `contractText(contract, configTools?)` is the prompt layer; it replaces the bare role prompt
    in assemblePrompt and in kb-research's General prompt. SQUAD_RULES is unchanged: the shared steps live in the
    contract, which every prompt carries.
  - assemblePrompt takes `customRole` and `tools` (runs.ts passes the config's). A `builtin:` id uses that type's
    own contract, name and no playbook; a saved custom role keeps the base contract and playbook and adds a
    "# Your role: <name>" layer with its description and instructions. `customRole(db, id)` resolves either, archived
    roles included, so their conversations keep working.
  - Routes (agents-conversations.ts): `POST /api/custom-roles?store=` (validateCustomRole: name ≤ 60, description ≤
    200, instructions ≤ 4,000, a role as base, tools a subset of `defaultTools(base)`, `allStores`),
    `PATCH /api/custom-roles/:id?store=` `{ archived }`, `GET /api/presets?store=&type=` (Default first, then saved:
    for a role, its custom roles' too) and `POST /api/presets?store=` `{ name, type, config, objective?, allStores? }`
    (validateConfig; unknown keys dropped; runtime/model kept only when chosen). No preset delete: the spec has none.
    "Validated when applied": the dialog fills its fields from the preset and the create route checks them.
  - `AgentTypeInfo.contract` feeds `ContractDialog` (exported from Details.tsx) and `CustomRoleForm`
    (`agents/CustomRoleForm.tsx`, `onCreated(role)`), which AA-14's "+ Custom role" tile mounts. The web `api()`
    errors now carry the server's `field`, for AA-14's field-level errors.
  - The rename sweep left comments, nav.ts's "Creative Studio" page title, the ecosystem room name, playbook file names
    and the developer docs (packages/agents/README.md, public/art/PROMPTS.md) unchanged.
- (AA-10, 2026-10-28) Several conversations of one type running at once within the store limit is covered by
  agents-runs.test.ts ("an agent's conversations run side by side"; perStore 2, a third waits) and seen in the browser
  (two Creative Studio conversations awaiting approval together; approval waits hold no slot). Long titles: one line
  with an ellipsis in the header and the list, the full title in a tooltip.
- (AA-09, 2026-10-28) For AA-10 and later:
  - `agents/Details.tsx` is the right panel (`Details` takes `end`, the hide button beside its tabs); the tab is kept in
    `fe.agents.tab`. `agents/settings.tsx` holds the seat drawer (`SettingsDrawer`, URL state `?settings=<role>&tab=`
    via `useAgentSettings`, so AA-14b's legacy `?tab=` links only need to map onto it), the moved AgentSettings,
    Memory, History, AgentBudget and NicheLearnings (AgentDetail.tsx imports them until AA-14b), and the autopilot
    rule: `autopilotRules(autonomy, caps, tools)` (seat on autopilot, a store rule on for a kind with
    `APPROVAL_KINDS[kind].autopilot`, propose_ad_change among the tools) plus `approvalLines`. Deploy's spending row
    (AA-14) reads `autopilotRules` too.
  - `toolGroups(db, config)` in packages/agents configs.ts groups the config's tools (first matching group; an
    integration kind in the tools is its MCP server, approval access) and reads the store's connected integrations.
    The panel's "Autopilot up to the caps below" override is applied client-side from `autopilotRules`.
  - AgentSettings' two columns now follow its container (`@3xl`), so it stacks in the 440 px drawer.
  - A History or Flows row opens `agentsUrl({ store, run })`: its conversation, or the read-only view.
  - Thread scroll offsets live in a module Map for the session; a thread opens at the newest message otherwise and stays
    pinned to the bottom while it is there (ResizeObserver).
  - Not built yet: the Knowledge tab (AA-17), "Role instructions and checks" (AA-11), "Change…" (AA-14), and the
    team variant of the panel (AA-20: no team data before AA-19).
- (AA-08, 2026-10-28) For AA-09 and later:
  - `agents/Conversation.tsx` is the centre pane: `Conversation` (header, chips, turns, composer) and `ReadOnlyRun`
    (with `Continue`). `Workspace.tsx` keeps the loading and not-found wrappers and resolves `?run=`: a run in a
    conversation redirects there, a run with none reads alone, another store's run is "Run not found".
  - `agents/markdown.ts` `renderReply(text, cardHref, cites?)`: links only through webHref (new window), images off,
    `[kb:id]` → numbered superscript (pass one `cites` array to number several parts as one reply), `[measured]`,
    `[research]`, `[hypothesis]` → tags. `agents/activity.ts` holds the one phrase map (`PHRASES`); AA-18 adds
    save_finding and its kb_written step there (the tool doesn't exist yet, so neither does the phrase).
  - Thread runs carry `retryOf` (from the `retry:<old>:<new>` link), so attempts fold under the retry as "Attempt N ·
    <state>", with a note when the attempt ran a tool with effects. `hasEffects` and `isReadOnly` moved to
    packages/shared (re-exported from packages/agents, unchanged for its callers) so the web can use them.
  - `GET /api/conversations/:id` now answers a `ConversationDetail` (the conversation plus its `config`).
  - `ApprovalCard tone="amber"` (this page only) and `--color-amber` in the @theme.
  - Not rendered yet, per the control rule: Collaborate (AA-20), "Change runtime or model…" and the runtime chip's ▾
    (AA-14), Agent settings in ⋯ (AA-09), attach and the composer's knowledge chip (AA-17), Save to Knowledge Base
    (AA-18), the question card (AA-16). The decision 9 "Ran at High" mismatch line comes with AA-13.
  - Left for AA-14b: scrolling to the run on a `?run=` redirect, and expanding the run's type group for the read-only
    view. A team step run reads alone without Continue until AA-19/20 opens its team.
  - Known gap: an unresolved `[kb:id]` still renders a numbered superscript (the parser runs before the card loads); its
    source chip shows `kb:<id>` with no link. The spec wants it left as written: fix with AA-17's citation work.
- (AA-07, 2026-10-28) For AA-08 and later:
  - `ListPane.tsx` holds the left pane, keyed by store in `Workspace.tsx` (search, archive view and range reset on a
    switch). `Popover.tsx` is the page's native popover (`role="menu"`, positioned under the button whose
    `popoverTarget` names it, `[data-item]` rows with ↑/↓) plus `MenuItem` and `rove`. Use them for the ⋯ and type
    menus to come.
  - `useStored(key, initial)` in layout.ts is the try/catch localStorage state: panes in `fe.agents.panes`, collapsed
    groups in `fe.agents.collapsed`. Two hooks must not share a key: each writes its whole value.
  - New reads: `GET /api/agent-types?store=` (`agentTypes`: roles, the two built-in types, the store's and
    all-stores custom roles not archived, in list order) and `GET /api/conversations/counts` (per store, a reply going
    or queued vs waiting on an approval; global by design: counts only, for the switcher). The list's answer gains
    `byType` (shared `ConversationPage`), counted under the same filters, so group counts don't grow with paging. AA-11
    can extend `AgentTypeInfo` (contracts) and the endpoint.
  - Not rendered yet, per "a control renders only once the item that makes it work has shipped": Deploy and Create
    team (AA-14, AA-20), the type header's menu (New conversation from AA-14, Agent settings from AA-09) and "New
    conversation" under "N more agent types" (AA-14). Team rows show the conversation's state word; the 'N agents' and
    ended metas and the participant sub-rows need AA-19's team data (AA-20).
  - The range is per visit (default 30 days); Pinned ignores it, and search and the archive search everything.
  - Status words: rows whose meta is a date give the dot `role="img"` with the state's word; interrupted is the hollow
    amber ring.
- (AA-06, 2026-10-28) For AA-07 to AA-09:
  - The workspace is `apps/web/src/agents/`: `Workspace.tsx` (page, panes, states), `layout.ts` (`clampPanes`,
    `paneMode`, `usePaneState` in `fe.agents.panes`, `lastOpened` in `fe.agents.last`), `urls.ts` (`agentsUrl`),
    `fill.ts` (useFill plus the width the breakpoints read), `StateDot.tsx` (the board's dots, keyed by
    ConversationState).
  - The panes' contents are interim and marked `ponytail:`: a flat list with search and the store as a static card
    (AA-07), the title and the runs drawn by the old Chat `Transcript` (AA-08), Details with the agent and store
    scope (AA-09). `tab` and collapsed groups join `usePaneState` with the items that use them.
  - `/agents/w?store=` with a remembered conversation for that store redirects to it, as AA-09's test needs; the empty
    state shows when none is remembered. A 404 clears the memory.
  - `/agents/t/:id` shows "Team not found" until AA-19 creates teams.
  - Not built yet: the per-conversation scroll Map (spec "Navigation state"), for AA-08's thread and AA-09's test.
  - Client: `useConversation` doesn't retry a 404, `useThread` seeds each `['run', id]` (live via the socket), and a
    run event with a conversationId refreshes that conversation, its thread and the store's list.
  - `Dialog` gains `side="left"` (opt-in) for the list drawer below 720 px. Hero's controls moved into a local
    `HeroControls`, unchanged for every other page (checked on Analytics).
  - Headless Chrome (CDP): Esc needs `{ code: 'Escape', windowsVirtualKeyCode: 27 }` to close a dialog.
- (AA-05, 2026-10-28) For AA-06 and later:
  - **Where it went** (AA-04's map said `config.ts` and `recap.ts`): `validateConfig`, `seatDefault`, `resolveType` and
    `saveConfig` are in the existing `packages/agents/src/configs.ts`; `recap` and `conversationPreface` are in
    `conversations.ts`. Presets (AA-13+) can join configs.ts.
  - Routes (all need `?store=`; another store's record is a 404): `GET/POST /api/conversations`,
    `GET/PATCH /api/conversations/:id`, `GET …/:id/thread?before=&limit=`, `POST …/:id/messages`,
    `POST …/:id/runs/:runId/retry|resume`, `POST …/:id/stop` (`{runId?}` takes back a queued message). Create answers
    `{conversation, run}`, 201, or 200 for a repeated clientRequestId. A config failure is `400 {error, field}`.
  - `openConversation` (agents-conversations.ts) is the server side of startConversation: Deploy, Continue, module
    context and the legacy route all go through it, and a start the run manager refuses deletes the conversation and
    its config. AA-12 adds the client `startConversation` helper and the chip; `useCreateConversation` takes
    `context` already. Context accepted now: `{kind:'campaign', network, id, name}`, checked against `campaigns`.
  - A conversation's `type` is the custom role id when it has one, else the role; the list's `type=team` filter
    matches conversations with a `kind='team'` squad mission (AA-19 writes those).
  - The first turn of a fresh session (no resume) gets a preface: the recap of the run it continues, or a pointer to
    its campaign by id, which the agent reads with its tools. Later turns resume the session, so the preface isn't
    repeated. The recap holds exchanges only, newest kept within 6,000 characters; cards cited and open questions are
    left for AA-14b's "Change runtime or model".
  - Continue refuses a run already in a conversation, another store's run (404), an Ask-KB all-stores run, a run that
    called compare_stores, and a run from before the store went live (409, the AA-03 wording).
  - Search: `indexConversation` rebuilds the conversation's FTS row from the title, every run's task and final text,
    on create, rename and every run end (runHooks `onRun` → `touchConversation`, which also bumps last_activity_at).
    Store delete removes the store's FTS rows. The query goes through the KB's `ftsQuery`.
  - The legacy route maps the opener's 400 to 409 (it never sends a config, so a 400 there means the seat itself
    can't start). Its title is the task's first line, cut at a word to 80 characters with an ellipsis.
  - kbGuard: one `.use('/api/conversations/*')` covers the bare path too (mounting both counted twice). Bodies up to
    15 MB on create and send (attachments, decision 11), 1 MB elsewhere.
- (AA-02, 2026-10-28) One migration, #50, holds every table, column and index of decision 3. `conversations_fts` is
  a plain FTS5 table with no foreign key, so a store delete leaves its rows: AA-05 deletes them where it writes them
  (with the store, in `stores.ts`), and its search joins `conversations` so a stray row never shows. The derived-state
  helper already splits `question` waits (waiting_for_input) from other approvals, so AA-16 only adds the kind.
