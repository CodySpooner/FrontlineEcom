# Backlog — knowledge-base lane (Knowledge Base & Research Intelligence)

Repo rules: `CLAUDE.md` (worker loop, hard rules). Owner's full spec, verbatim: `docs/features/knowledge-base.md`, which
is the source of truth for *what*. This file is the *how* in this repo: the chosen design, the decisions already made,
lane ownership and the items. Code survey of everything this feature touches: `docs/features/knowledge-base-codemap.md`.
Read all three before KB-01. Three independent reviewers checked this file against the spec, the code and the mockups
before the lane started. Their findings are already worked in.

## What the owner asked for (verbatim, 2026-10-27)

> make me 3 different designs show them to me and ill decide the direction we go then after i finalize a design
> concept i want you to open a orca workspace called "Knowledge Base" and work on this task

Three directions were shown on a design canvas: A "Atlas" (the canvas is the page), B "Intel Desk" (research
operations first) and C "Proving Ground" (evidence board). The owner picked:

> Yep let's go with "a" as the main view and "b" as the research center and let's just keep it at 1 Claude worker,
> make a new workspace and Call it "Knowledge Base" and so we can stay organized and when working on the knowledge
> base tool we can use this workspace if we have to come back to it

## The design

- `docs/reference/kb-atlas.png` is A, the main view. `docs/reference/kb-research-center.png` is B, the Research
  Center.
- `kb-atlas.html` and `kb-research-center.html` next to them are the same mockups as static HTML with inline styles.
  Open them for colours, type and spacing.
- Their fixed pixel sizes were drawn for 1440 px. Where the rules below differ, follow the rules.
- Every number, card, store count and name in them is a placeholder. Never ship mock data.
- C is not part of the build.

### Page frame (all views)

- **Header:** the page keeps the app's `Hero` with its generated Knowledge Base header art. The owner asked on
  2026-10-27 for header art on every section, so it is not swapped for the mockup's slim bar. Pass props or children
  to `Hero`; don't change `Hero.tsx`.
- **Toolbar row** under the Hero, `flex-wrap`, containing:
  - the workspace switcher (General, or one store with its niche and card count);
  - "Include General knowledge" (store workspaces only);
  - search, `flex-1 min-w-[180px] max-w-[320px]`. Its placeholder is "Search knowledge…", so it reads differently from
    the Hero's own Ask AI field;
  - "From source" and "New research".
- **One page-level view switcher**, Artboard · Library · Relationships · Research Center, bound to `?view=`. Use the
  house `Tabs` or `Segmented`, not the mockup's aria-pressed buttons.
  - In the artboard view it floats top-centre on the canvas.
  - In every other view it sits at the right end of the toolbar or chips row, as in B.
- **URL state:**
  - `?view=artboard|library|relationships|research`, default artboard.
  - `?ws=general|<storeId>` (plus `all`, only in the research view). It defaults to the single store picked in the
    global `StoreFilter` selection, else General.
  - `?card=<id>` loads that card and switches `ws` to the card's workspace. So a `[kb:id]` link from any transcript
    opens correctly.
  - A legacy URL with `tab` or `doc` and no `view` opens the Library on that section (`?doc=` alone means a playbook).
- **Keyboard guards:**
  - `/` focuses search only when no modifier is held, the target isn't an input, textarea, select or contenteditable,
    and no dialog is open. Call `preventDefault`.
  - Esc closes the innermost layer first (popover, then the details panel). It is ignored when
    `e.defaultPrevented` is set or a dialog is open, and it returns focus to the card.
  - Never take Ctrl/Cmd+K: AskPalette owns it.

### Main view: Atlas (A)

- **Canvas size:**
  - The canvas wrapper is `-mx-[22px] -mb-8`, so it bleeds past Shell's side padding and `pb-8`.
  - Its height is `calc(100dvh - <measured top>)`. Measure with ResizeObserver or getBoundingClientRect; never
    hard-code it, because the Hero's height varies.
  - The page doesn't scroll in the artboard view.
  - It must work at 1280×800, 1366×728 (laptop) and 1440×900 (the desktop default).
- **Canvas:**
  - A dot grid.
  - Cards are grouped into frames, one per deepest category that holds cards, with the path written "A › B › C". The
    frame header shows the path, card count, "Research more" and collapse. A frame of General cards carries a
    "General" pill.
- **Card** (232×132):
  - the type label: grey, and green only for Validated Insight;
  - a workspace dot and name (a store colour or "General");
  - title, short summary, and one line of tags;
  - the author agent's initials and role;
  - a 4-step confidence meter: grey fill, all green at Validated. It carries an sr-only "Confidence: <stage>", not just
    a `title`;
  - when it was last verified, replaced by "needs refresh" when stale;
  - a **dashed border whenever the stage is Hypothesis, whatever the type**;
  - a darker fill for General cards (#111114 against #17171b);
  - when selected, a red border and glow.
- **Connections:**
  - Lines are drawn per relationship type. "Contradicts" is red and dashed with a ≠ marker. AI-suggested, unconfirmed
    links are dotted.
  - Each line has endpoint dots, a wide transparent hit stroke, and a relationship-name pill `<button>` at its
    midpoint. The pill shows for the selected card's lines, and for all lines at zoom ≥ ~60%.
  - Clicking a line or pill opens a popover explaining why the cards are linked, with accept or reject for suggested
    links.
- **Outline** (left):
  - It spans from top 16 to bottom (16 + minimap + 12), so it never covers the minimap. Don't copy the mockup's fixed
    660 px.
  - The tree (nested, with counts) scrolls inside it. The filter box and the line legend stay pinned.
  - It has "+ New category", and "General knowledge N" with a note that it is shown inside this store where it
    applies.
  - Clicking a row (or Enter) pans to that frame, expands it and focuses its first card. The current row gets
    `aria-current`.
- **Minimap and zoom** (bottom-left): −, %, +, Fit.
  - Fit, zoom-to-card and opening the details panel all use the area the Outline and the details panel don't cover.
  - When the details panel opens, the selected card is panned into view.
- **"Researching" dock** (bottom):
  - It sits between the Outline's right edge and the details panel's left edge (or right:16 when the panel is closed),
    max-width 560.
  - It shows live tasks with stage and progress, and "+N queued". Tasks truncate, and below ~520 px only the first one
    shows.
  - Clicking it opens the Research Center.
- **Details panel** (right, 340 px):
  - A **non-modal** `<aside>` inside the canvas area, so you can keep selecting and panning. Not `Dialog`, which is
    modal.
  - It shows:
    - type, title and path, and the 4-step ladder (Hypothesis → Supported → Tested → Validated);
    - the explanation;
    - evidence rows tagged MEASURED / RESEARCH / OBSERVED / CONFLICT;
    - Applies to, Limits, How agents use it;
    - connected cards, each with "Why linked" (the same popover), and "Link to…";
    - sources with provenance, and how often agents used it;
    - actions: Use in a task, Research deeper, Promote to General (store cards only), and the manual controls in
      spec §14.
- **Keyboard:**
  - The canvas is one tab stop.
  - With the background focused, arrows pan, +/− zoom and 0 fits.
  - With a card focused:
    - arrows move to the nearest card in that direction and pan it into view;
    - Enter opens details;
    - Space / Shift+Space toggle multi-select;
    - Alt+Arrow nudges the selected card (the keyboard alternative to dragging).
  - Focused and selected cards are never culled.

### Research Center: Intel Desk (B), `?view=research`

- **Workspace chips** (All workspaces, General, each store) replace the toolbar's switcher and toggle in this view.
- **Six stat tiles:** cards, validated, hypotheses, researching now, needs refresh, conflicts.
  - Each shows its real sub-line ("+N this week", "N ready to test", "waiting for your call").
  - Each links to the matching Library filter or the artboard (e.g. `?view=library&stage=validated`).
  - Conflicts gets a red border when above 0.
- **Knowledge map:** each category gets a bar stacked by evidence level. Rows link to their frame. Below them,
  "+ Custom category".
- **Latest discoveries** ("this week", "View all"):
  - Now validated, with evidence chips (Measured · N tests / N sources / N connections) and "Open on artboard"
    (`?card=`).
  - Conflict, with Compare evidence / Plan a test / Keep both.
  - Promote to General?, with Approve / Review the edit / Keep in store.
  - Refreshed.
  - A small artboard preview with "Open artboard".
- **Research Center column:**
  - "Open" link, and Active / Queue / Done / Sources tabs.
  - Task cards: the real pipeline stages as a segmented bar, sources read/blocked, findings, matches to existing
    cards, spend against budget, and Stop / Open task.
  - "Agents recommend", with Approve.
  - Knowledge gaps: linked rows with a reason ("0 measured", "only hypotheses", "6 of 9 stale").
  - The self-directed research budget line, with Controls.
- **"Research from source" bar** along the bottom.
- **Layout:** at 1440 px and wider, the three columns `280px minmax(0,1fr) 360px` and 6 tiles in a row. Below
  1440 px:
  - two columns (map and discoveries), with the Research Center column full-width under them;
  - tiles 3×2.

### Library and Relationships

- **Library** (`?view=library`): the same cards as a dense, sortable list.
  - The spec §13 filters: workspace, category, agent, source, created, last verified, confidence stage, type,
    performance metric, tags, validation status.
  - Saved filters, and bulk actions.
  - It also hosts the existing UI-16 sections (Playbooks, Platform packs, Niche packs, Store memory) and a Campaigns
    section (KB-21).
  - The UI-16 code moves in with **one change**: its two `setParams` calls (`Knowledge.tsx:40`, `:70`) merge into the
    current params and keep `view=library`. As written they replace the whole query and would throw the owner back to
    the artboard. A test clicks Playbooks and then a doc, and the page stays in the Library.
- **Relationships** (`?view=relationships`):
  - The selected card in the middle and its neighbours, grouped by relationship type.
  - Filters by type, click to explain, and arrow keys between neighbours.
  - Lay it out in plain code, e.g. rings by hop distance. Don't add a graph library.

## Decisions already made (coordinator's calls; change one only with a reason written under Notes)

1. **Keep what exists.** Four kinds of memory stay separate, as the spec asks:
   - The markdown layers are the agents' *procedures*: playbooks and platform/niche packs.
   - `store_memory` is the squad's *working memory*: facts, preferences, outcome notes. Don't migrate or rename it:
     its invariants, FTS triggers, raw-SQL users and tests are in the code map.
   - `niche_learnings` stays as it is.
   - Ad and store metrics are *performance history*.
   - The new cards are the *knowledge base*.
   Never tell the owner the model "retrained itself". Agents get better because they retrieve better knowledge.
2. **Where the code lives:**
   - **Domain layer in `packages/agents/src/kb*.ts`,** exported from `index.ts` the way `memory.ts` is. It holds
     workspace scoping, card, evidence and link writes with the ladder and provenance rules, dedupe, retrieval and
     usage logging. It has to be here: both the server routes and the agent tools and prompt use it, and
     `packages/agents` can't import `apps/server`.
   - **`apps/server/src/kb/**`** holds the HTTP routes, the safe fetcher (decision 9) and the research runner
     (decision 7).
   - **Agent tools** reach server-only code (the fetcher, starting research) through new optional `ToolEnv` hooks,
     like `trackCompetitor` (`tools.ts:24-66`, `routes/agents.ts:180`).
3. **Storage** uses the existing SQLite database:
   - New tables are appended to `MIGRATIONS` (next is #44, each labelled `/* NN (kb: KB-xx) */`).
   - An FTS5 index on cards follows the `store_memory_fts` pattern.
   - Everything lives in the DB, including the extracted text of uploaded documents and fetched pages, so the
     existing backups cover it. Don't keep KB files in the data dir.
   - Spec §16 lists the models. The minimum is:
     - a category tree: `parent_id`, any depth, per workspace. Spec §17 uses three-level paths such as
       "Advertising › Creative Strategy › Video Hooks";
     - cards (with tags and a lifecycle status, decision 10), card revisions, sources, evidence and links;
     - layouts and saved views;
     - research tasks, task steps and log, and research findings;
     - retrieval events, performance observations and experiments;
     - research controls.
     Promotions and permissions reuse `approvals`.
   - SQLite treats NULLs in a UNIQUE key as distinct. Per-workspace unique indexes therefore use
     `coalesce(store_id,'')` (and `coalesce(parent_id,'')`), following `niche_learnings_text` (`db.ts:325`). A test
     inserts the same General category and card twice.
4. **Workspaces and isolation:**
   - The workspace is `store_id`: NULL means General, and store rows use `ON DELETE CASCADE`.
   - Every KB read and write goes through the one scoping helper, and every by-id route checks the row's workspace.
     This is unlike `/api/memory/:id`, which doesn't. A wrong-workspace id gets a 404.
   - A store workspace sees its own cards, plus General when asked. It never sees another store's.
   - **Agent retrieval always includes General,** ranked below the store's own cards.
   - Only owner-facing search and the Research Center may use "All workspaces".
   - Tests prove all of this for every route, every tool and retrieval.
5. **Routes:**
   - Use fresh prefixes, `/api/kb/...` and `/api/kb/research/...`. `/api/knowledge/:kind/:key` and `/api/research/:id`
     would shadow them.
   - Keep the existing `/api/knowledge` endpoints working.
6. **No fake knowledge:**
   - Seed only the 16 General categories. No demo cards, no simulated research, no canned findings.
   - **Never add research output to the fake engine's `echoScript`.**
   - Empty states offer the real next step, such as "Research the basics for Pet".
   - Visual checks may use a dev-only fixture DB or a test. Never ship one in the seed or a production view.
7. **Demo stores:**
   - Their ad numbers are random noise (`demoDay` ignores campaign status), so the KB never learns from demo or sample
     data.
   - **Owner-started research** runs on the real Claude engine even when the paying store is a demo store. It is web
     research and isn't based on the store's fake data. If the real engine isn't available, the task fails and says
     so.
   - Scheduled or autonomous research never runs on the fake engine and never pretends to.
   - Tests always use the fake engine.
   - **When a demo store goes live** (extend `startFresh`):
     - purge only what came from demo data: performance observations and lessons, evidence from the store's metrics,
       and agent cards from non-research runs;
     - keep owner cards and cards whose evidence is a read web source;
     - cancel the workspace's open research tasks;
     - count what was purged in the existing go-live notification.
8. **Research runs on the existing agent machinery:**
   - The research runner is a KB task-row state machine, built like `advanceMissions(db, start)`. It takes `start` (or
     a RunManager) and an `engineAvailable()` predicate as parameters:
     - production passes `runManager(db)` and a Claude check;
     - tests pass `createRunManager({ engine: fakeEngine(script) })` with a scripted research engine.
   - The agent stages (planning, discovering, retrieving, analyzing, evaluating, extracting, reporting) are ordinary
     runs started through `start`, which brings queueing, slots, budgets, cancel and streaming.
   - **Deterministic stages run as code, not agent runs:** deduping, storing and linking (suggestions).
   - Put the task id in each run's task text, because `start()` de-duplicates identical text.
   - Structured results go into KB tables, not transcripts, which are clipped to 4000 characters.
   - **Run mode:**
     - A nullable `agent_runs.mode` column (kb migration), set through a new `start()` option and copied by the
       restart retry (`runs.ts:348-351`). `execute()` fills `RunInput.mode` from it.
     - `mode = 'research'` routes owner-started runs to the Claude engine in `defaultEngine`, and skips `reflect()`.
     - It overrides `maxTurns` and sets `budgetUsd` = min(the store share, what the task has left).
     - It uses research-specific STOPPED messages; today's hard-code "40-turn limit" (`claude-engine.ts:13-14`).
     - The runner adopts a restarted phase through the `retry:<old>:<new>` link (copy `missions.ts` `stepRun`) instead
       of starting the phase again.
   - **Research tools:**
     - A `researchTools(role)` set, used by `claude-engine.ts`, `fake-engine.ts` and `canUseTool` when the mode is
       research: the KB research tools plus WebSearch.
     - It excludes built-in WebFetch (every fetch goes through the app's `fetch_source`, so it is recorded and
       guarded), `write_memory` and `assign_task`.
     - In normal mode the KB research tools are filtered out.
     - Keep `toolsFor(role)` unchanged for `evals.test.ts`. List the research tools on one role (market_analyst) only so
       the "used by some role" check passes.
     - Put no research-tool names in SQUAD_RULES.
   - **General-destination runs get a store-neutral system prompt** (`RunInput.systemPrompt`): the role, SQUAD_RULES
     and General-only KB retrieval. No store memories, profile, niche pack, or waiting/scheduled lines. A test checks
     that a General task's prompt holds none of the paying store's memories or cards.
   - General research is paid by a store the owner picks (default: the first store).
9. **No new agent role.** "Agent type" in the spec maps onto the existing 8 roles:
   - **General:** Market Analyst, saving to General.
   - **Specialized:** the role picked, e.g. Ad Strategist for advertising.
   - **Business/Niche:** the store's own squad member, with the store's niche in context.
   - Role → category boosts decide which knowledge each role gets first. Research mode gives every role WebSearch, so
     roles without web tools can research too.
10. **Safe fetching** gets one server module that every fetch goes through, including robots.txt and each redirect
    hop:
    - It uses `node:http`/`https` `request` with a `lookup` option that returns the already-vetted address. That
      closes the DNS-rebinding gap noted at `competitors.ts:106`, and the hostname still goes out for SNI and the Host
      header. Reuse `publicFetch`'s LOCAL BlockList, not `isPrivateHost` alone, which misses CGNAT.
    - Manual redirects, max 5.
    - Timeout, a byte cap while streaming, and a content-type allowlist.
    - An honest User-Agent. robots.txt is obeyed.
    - A per-host throttle.
    - HTML becomes readable text. PDF, text, markdown and CSV documents become text; pick one small, maintained PDF
      dependency and record it in Notes.
    - Paywall and login pages are detected.
    - Each source gets a status: `read | blocked_robots | blocked_domain | paywalled | login | unsupported | too_large
      | failed`.
    - A source that wasn't read is never summarized as if it was.
    - Fetched text reaches agents only as sanitized, untrusted data, following `csv()` and `SQUAD_RULES`.
    - The workspace's trusted and blocked domain lists (KB-22) are enforced here.
11. **Card rules:**
    - **Lifecycle status:** `proposed | active | archived | rejected | merged`.
      - Research and agent writes start as `proposed`, unless the workspace turned review off (KB-22).
      - Proposed cards show on the artboard marked "Unreviewed" and are **excluded from agent retrieval** until
        accepted.
    - **Stage** (the ladder) and **type** are separate fields, linked by these rules:
      - Agents may create stage Hypothesis or Research-Supported only.
      - Research-Supported needs **2+ independent read sources, or 1 source rated reliable** (decision 10, KB-11). One
        weak source stays a Hypothesis.
      - Experimentally Tested needs measured evidence.
      - Validated needs measured evidence from 2+ independent tests, or the owner.
      - Contradicting evidence moves a card down or flags a conflict.
      - Agents may not set the type Validated Insight or User-Provided.
      - The type Validated Insight requires stage Validated. Dropping below Validated changes the type back to its
        previous type (or Research Finding).
      - The card's look follows the stage, not the type.
    - Every move and edit is a revision with its reason.
    - Agent writes never overwrite or undo the owner's edits or reverts, mirroring the `memory.ts` provenance rules.
    - Every automated decision can be reversed:
      - restore a revision;
      - detach merged evidence as its own card;
      - unarchive, unreject and unblock.
12. **Retrieval:**
    - It combines:
      - FTS5 bm25;
      - metadata filters (workspace, category subtree, type, stage, status, freshness, blocked, tags);
      - boosts for stage, recency, role→category, relationship proximity, usage and citation counts, and source
        reliability.
    - Agents get it two ways:
      - a compact "Relevant knowledge" section in `assemblePrompt`, after the fixed layers so prompt caching survives.
        Re-check the 8000-token budget and the 1500-token memory floor in `prompt.test.ts`;
      - a `search_knowledge` tool that returns ids, available in normal mode to every role.
    - Agents cite `[kb:<id>]`, and transcripts render that as a link to the card.
    - Every retrieval and citation is logged and counted ("used 14 times").
    - Hypotheses arrive labelled as unproven. Blocked, proposed and archived cards never arrive.
    - **Embeddings are optional:** the app has no embedding provider today.
      - Build keyword + metadata + relationship retrieval first.
      - Add a semantic layer only behind a provider the owner configures.
      - Without one, the UI says "keyword search" and nothing claims semantic search.
13. **Performance learning** is honest about the data that exists:
    - Ads are campaign-level only: spend, revenue, purchases, clicks and impressions per day. ROAS, CTR, CPC, CPM, CPA
      and CVR can be derived from those. Creatives aren't linked to campaigns.
    - So creative-level lessons such as "problem-first hooks" need ad-level sync and creative↔ad links first (KB-20).
      Until then, the UI states what isn't enabled.
    - The guards are deterministic, tested code:
      - minimum spend, impressions, purchases and days;
      - a settled attribution window (the 28–30 day re-pull);
      - comparison with the store's own baseline;
      - seasonality via `par()`;
      - currency-safe ratios;
      - confounds noted.
    - Weak patterns stay Hypotheses. Only the explanation text comes from an agent.
14. **Gamification and notifications:**
    - KB writes emit their own event, not `memory_written`, so they award no memory XP.
    - `runHooks.onRun` skips the per-run XP award and the "<Role> finished" notification for research-mode runs.
    - The runner sends one notification per task (done, failed or cancelled) and awards XP at most once per task.
    - Every new tool is in a role's allowlist, and every new approval kind has a label, as `evals.test.ts` requires.
15. **UI building blocks:**
    - Reuse `components/ui.tsx`: Panel, Card, Button, Tabs, Segmented, Badge, Dialog for true modals (From source, New
      research, confirms), ConfirmDelete and the Loading/Error/EmptyState trio.
    - Reuse the react-query hooks in `api/client.ts` and the single `useLive` socket. Add a branch for KB and research
      messages; don't open a second socket.
    - Copy, don't import, the 3-line `zoomAt` math and the input conventions from `src/ecosystem/camera.ts` and
      `renderer.ts`. That code belongs to another lane, and importing it pulls in pixi.
    - Keep the page lazy-loaded.

## Lane

- **Owns:**
  - `apps/web/src/pages/Knowledge.tsx` and a new `apps/web/src/knowledge/**`, plus the KB entries in `api/client.ts`.
    `nav.ts`: title and subtitle only; don't reorder NAV.
  - `packages/agents/src/kb*.ts` plus the run-mode, tool and prompt changes (decisions 8, 12, 14).
  - `apps/server/src/kb/**`, appended migrations, route mounting in `app.ts`, and the `startFresh` and `runHooks`
    changes.
  - Additive types in `packages/shared`.
  - "Research this" entry points on the Dashboard, Analytics and Chat (KB-15).
  - This file.
- The other lanes are stopped (each has `.agent/STOP`), so cross-package edits are expected here.
  - Keep each one surgical and covered by the existing tests.
  - Leave `apps/web/src/ecosystem/**`, `apps/web/public/**`, `Hero.tsx` and `Art.tsx` alone.
- Commits: `kb: KB-xx <what>`. Vault log: `Build Log/knowledge-base.md`.

## Done when

- Every item is ticked and `pnpm check` is green.
- The owner's §17 workflow runs end to end as an automated test (fake engine), asserting the exact three-level
  category paths.
- **One** short real-engine smoke run: a directed research task on one public URL, saved to a store workspace,
  followed by a later agent task that retrieves and cites it.
- Each line of the spec §19 testing checklist has a test or a recorded check.
- The Artboard, Library, Relationships and Research Center views are checked in Orca's browser at 1280×800, 1366×728,
  1440×900 and 1920×1080 against the two references, with screenshots in `.agent/` and no console errors.
- Then create an empty `.agent/STOP` in this worktree and stop.

This lane is finite. When KB-01..KB-26 are done, don't add new items (this overrides CLAUDE.md's "Backlog empty?"
rule). Put follow-up ideas under **Notes** for the owner, and ignore a watchdog nudge if `.agent/STOP` exists.

## Inbox
<!-- other lanes append requests here: - [ ] (from <lane>) <request> -->

## Items

### Phase 1: audit
- [x] KB-01 **Audit and baseline.**
  - Read the spec, this file and the code map. Confirm the decisions against the code.
  - Screenshot today's `/knowledge` (all 4 tabs) at 1280 and 1920 as "before".
  - Write a short Notes entry: where each new piece will live, and any decision you changed and why.

### Phase 3 foundations (before the UI, so the UI is built on real data)
- [x] KB-02 **Data model:**
  - Shared types:
    - the 11 card types and the 4 stages;
    - the lifecycle statuses;
    - the 7 relationship types (Supports, Contradicts, Builds Upon, Derived From, Validated By, Applied To, Related
      To);
    - workspace, category tree and tags;
    - evidence kinds (measured / research / observed / conflict);
    - source status and source reliability.
  - Migrations for the decision-3 tables, plus FTS, the `agent_runs.mode` column and the coalesce unique indexes.
  - Seed the 16 General categories once.
  - The scoping helper, with isolation tests.
  - The `startFresh` changes (decision 7).
- [x] KB-03 **Cards and categories API** (`/api/kb/...`):
  - list (the §13 filters, paging, sort, `ws=all` for the owner only), get, create (owner = User-Provided);
  - edit (writes a revision), pin, archive and unarchive, reject and unreject, block and unblock from agents (all
    roles or chosen roles), merge (keeps both histories), mark for research, accept proposed;
  - category CRUD at any depth, per workspace;
  - hand-written validators in the house style;
  - a 404 on another workspace's id.
  - Tests.
- [x] KB-04 **Evidence, relationships and the ladder:**
  - add evidence (with source, metric, window, sample size);
  - owner "Link to…" (type plus explanation, confirmed);
  - suggested links with accept or reject;
  - a deterministic suggester (FTS, category, shared sources) that runs on **every** card create, by hand, by
    research or by performance, and saves suggested links and possible contradictions;
  - the ladder and type rules (decision 11), each a revision;
  - a contradiction creates a conflict record;
  - restore a revision, and detach merged evidence.
  - Tests for every rule.

### Phase 2: visual redesign (design A + the page frame)
- [x] KB-05 **Page frame,** per "Page frame (all views)":
  - the views, `?ws=` and `?card=`;
  - the Hero and the toolbar row;
  - the page-level view switcher;
  - the keyboard guards;
  - loading, error and empty states.
  - In `Knowledge.test.tsx`, only the start URL of the two tests that open bare `/knowledge` (`:98`, `:136`) changes,
    to `/knowledge?tab=playbook`, and Notes records why. Every other assertion stays as it is.
  - New tests: the legacy `tab`/`doc` URLs, `/` while typing in a textarea, and Esc with AskPalette open.
- [x] KB-06 **Artboard I:**
  - canvas sizing per the design;
  - camera: pan, wheel zoom about the cursor, Fit that accounts for the panels;
  - frames per category path, with auto-layout, collapse and expand;
  - the card component exactly per the design rules;
  - dragging a card persists its position per workspace;
  - selection: click, shift-click, box-select;
  - minimap and zoom toolbar;
  - the canvas keyboard model;
  - cards and edges outside the viewport aren't rendered (except focused or selected ones), so 1000 cards stay smooth.
  - Tests for the camera math, the layout, the keyboard navigation and culling.
- [x] KB-07 **Artboard II:**
  - lines per type with pills, hit strokes and the explanation popover;
  - the legend;
  - highlighting the selection's lines;
  - the Outline per the design ("+ New category", pan-to-frame);
  - saved views (filters + viewport + layout) per workspace;
  - the live "Researching" dock with the placement rules.
- [x] KB-08 **Details panel** (a non-modal aside):
  - every card field from spec §4;
  - the ladder, the evidence list with tags, connected cards with "Why linked" and "Link to…";
  - sources with provenance (open, fetched date, status, reliability), usage count;
  - revision history with Restore;
  - inline edit, and every manual control from spec §14, including the reversals;
  - an open/close transition that respects `prefers-reduced-motion`.
- [x] KB-09 **Library view,** per the design: the §13 filters, saved filters, bulk actions (archive, block, mark for
  research, move category, accept proposed), and the UI-16 sections with the `setParams` fix and its test.
- [x] KB-10 **Relationships view,** per the design.

### Phase 4: research
- [x] KB-11 **Safe fetcher** (decision 10) and source storage:
  - content hash for dedupe, title, published date, fetched date, status;
  - reliability, rated by deterministic rules (domain class: platform docs, research or academic, established
    publication, vendor blog, forum, unknown) and adjustable by the owner;
  - the readable text kept in the DB, plus an excerpt.
  - Tests: private IPs, a redirect to a private host, DNS rebinding, oversize, wrong type, a robots.txt disallow, a
    blocked domain, a paywall or login page, and injection text that stays inert.
- [x] KB-12 **Research runner** (decision 8):
  - stages: created → planning → discovering → retrieving → analyzing → evaluating → extracting → deduping → storing
    → linking → reporting → done / failed / cancelled;
  - each stage checkpoints into KB tables;
  - the evaluating stage persists a per-finding assessment against the spec §5 criteria (source reliability, evidence
    quality, relevance, recency, agreement across sources, usefulness, novelty, contradictions, applicability), and
    the ladder rules use it;
  - cancel;
  - automatic retry with an attempt count and backoff;
  - owner **Retry** (a new attempt from the last good stage) and **Refine** (edit the brief or scope, then re-run,
    linked to the original);
  - after a restart, resume from the last finished stage;
  - a per-task budget, plus the store's daily cap;
  - the reporting stage stores conclusions, unresolved questions, errors and limitations, conflicts found, and cards
    created versus updated;
  - live progress messages and the execution log.
  - Fake-engine tests for every transition, cancel, restart, budget stop, Retry and Refine, and "every source failed"
    (which reports failure and makes no cards).
- [x] KB-13 **KB agent tools:**
  - research mode: `fetch_source` (through a ToolEnv hook to KB-11), `propose_card`, `add_evidence` and
    `suggest_link`;
  - normal mode, every role: `search_knowledge`, and `recommend_research`, which adds to the "Agents recommend" queue
    for owner approval and gives agents a way to suggest research mid-task;
  - dedupe on write: an exact match, or high FTS/Jaccard similarity, merges into the existing card as new evidence
    instead of making a duplicate;
  - `propose_card` rejects the forbidden types and stages;
  - the provenance invariants;
  - `evals.test.ts` green.
- [x] KB-14 **Research from source,** the API plus the B-style bar and a full dialog:
  - URLs, pasted text, or an uploaded document (with a size cap);
  - agent type (decision 9), destination workspace and category, what to look for, and budget;
  - live per-source status;
  - a findings review (accept or reject the proposed cards);
  - the final report.
- [x] KB-15 **New research and launch points:**
  - a free-text request with workspace, agent, depth (quick / standard / deep, mapped to source counts and budget)
    and budget, using the same runner;
  - a plan preview before it spends;
  - "Research this" launch points on a knowledge card, a frame, the Dashboard store card, Analytics insights and
    campaign rows, and in Chat, each opening this dialog prefilled.
- [x] KB-16 **Research Center view** (design B), every widget on real data, with the links and responsive rules from
  the design:
  - the task drawer shows objective, workspace, category, agent, status and stage, sources read and blocked (with
    reasons), the execution log, conclusions, unresolved questions, errors and limitations, conflicts found, and the
    cards created and updated (linked);
  - Stop / Retry / Refine.

### Phase 5: agents share the knowledge
- [x] KB-17 **Retrieval in real tasks** (decision 12):
  - the prompt section and the tool;
  - role boosts;
  - retrieval and citation event logging;
  - `[kb:id]` links in transcripts and chat;
  - usage counts.
  - Tests:
    - a later task retrieves knowledge saved by an earlier one;
    - a store's agent gets General cards below its own;
    - it never gets another store's cards;
    - blocked, proposed and archived cards never appear;
    - hypotheses arrive labelled.
- [x] KB-18 **Promote to General:**
  - requested by the owner or an agent;
  - an agent drafts the generalized card with store specifics stripped, shown as a diff;
  - approve / edit / reject through `approvals` (outlives the run: `OUTLIVE_RUN` + `onApproved`);
  - the General card links back to its source with Derived From;
  - cross-store suggestions come only from live stores (follow `promotionCandidates`).
  - Tests.

### Phase 6: learning from performance
- [x] KB-19 **Performance pipeline:**
  - connected data → validation (skip demo and sample data; the guards in decision 13) → analysis (per campaign and
    store funnel against the baseline, with uncertainty) → pattern → insight → evidence assessment → storage (a
    Performance Lesson card, or evidence on an existing card that moves its ladder up or down, then the suggester from
    KB-04) → retrieval;
  - the existing approved-change outcome checks feed in as measured evidence;
  - store-side analyzers too (spec §9: conversion, AOV, product sales and returns where the data exists), through one
    reusable observation → insight path, not separate memories per agent;
  - when nothing is connected, an integration-ready state that names what isn't enabled.
  - Tests on every guard and on the math.
- [x] KB-20 **Ad-level and creative data:**
  - extend the Meta / TikTok / Google syncs to ad level, in new tables (never double-count `rebuildAdSpend`);
  - descriptive attributes on creatives (format, hook, angle, length, offer);
  - link a creative to its ad when it's launched through the app.
  - Tests against recorded API fixtures. With no connected account, nothing is claimed.
- [x] KB-21 **Experiments and the Campaigns library:**
  - "Plan a test" from a hypothesis: metric, variants, window, minimum sample, linked campaigns and creatives;
  - automatic evaluation once the data settles, with the result written as evidence;
  - a searchable Campaigns section in the Library. Per campaign: workspace, platform, products, creatives, copy and
    hooks, audiences, metrics, date range, result (worked / failed / inconclusive), related cards, insights and
    recommendations for future tests. Fields the data doesn't link yet show "not linked" instead of being dropped.
    Each lesson links to its evidence and its measurement window.

### Phase 7: autonomous research and maintenance
- [ ] KB-22 **Autonomous research control,** enforced on the server:
  - on/off per workspace and per role;
  - the categories each role is responsible for;
  - schedules (an `automation_rules` research action);
  - triggers (gap, stale card, contradiction, performance anomaly);
  - budget per task and per day, and depth;
  - approval required;
  - the workspace's trusted and blocked domains (enforced by the KB-11 fetcher);
  - "provisional findings need review" (decision 11);
  - the "Agents recommend" queue with cost estimates (approve or dismiss).
  - **Loop guards:**
    - autonomous tasks never trigger autonomous tasks;
    - a cooldown per card and trigger;
    - an open or recent task on the same workspace and topic is reused rather than duplicated;
    - conflicts that a research task itself created don't re-trigger research.
  - Tests for each control and guard.
- [ ] KB-23 **Maintenance job:**
  - duplicate detection and merge suggestions;
  - contradiction detection into conflicts;
  - freshness per category, feeding "needs refresh" and refresh tasks;
  - gap detection, feeding Knowledge gaps;
  - a version-history UI with Restore;
  - traceability from card to source and evidence;
  - a data-retention setting (trim old logs and fetched text, keep the metadata).
  - Tests.
- [ ] KB-24 **Search and ask:**
  - ranked results with highlights in the toolbar search, using the §13 filters and an owner-only "All workspaces"
    scope;
  - "Ask the knowledge base": a natural-language answer from an agent run over the owner's allowed scope. It groups
    conclusions as Measured or Research, cites both cards and sources, and says plainly when the KB doesn't know;
  - an entry in AskPalette;
  - the optional semantic layer behind a configured provider (decision 12).

### Phase 8: hardening and acceptance
- [ ] KB-25 **Security and ops pass:**
  - isolation tests on every KB route and tool;
  - body-size and rate limits on the KB and research routes;
  - an untrusted-content review;
  - logging, with no secrets;
  - KB data confirmed in backup and restore;
  - indexes on the `node:sqlite` hot paths, so the API never stalls.
- [ ] KB-26 **Acceptance** ("Done when" above). Fix what it finds, then STOP.

## Done
- 2026-10-27 KB-01 audit: decisions checked against the code, baseline 992 tests green, before shots in `.agent/before/`.
- 2026-10-27 KB-02 data model: shared KB types, migrations 44 (kb_* tables, FTS on `seq`, coalesce keys, 16 General categories) and 45 (`agent_runs.mode`), `kbScope`/`kbRow`, go-live purge in `startFresh`.
- 2026-10-27 KB-03 `/api/kb/cards` (§13 filters, paging, sort, `ws=all` reads) and `/api/kb/categories` (any depth, per workspace): create, edit, the §14 controls and merge, each a revision; 404 on another workspace's id.
- 2026-10-27 KB-04 evidence, links (owner-confirmed, suggested accept/reject), the deterministic suggester on every create (word overlap, category, shared sources, possible contradictions → conflict), the decision-11 ladder as revisions (owner stage kept via migration 46 `stage_by_owner`), restore revision, detach merged evidence.
- 2026-10-27 KB-05 page frame: toolbar (workspace with niche + card count, Include General, search, research actions shown off until research lands), one `?view=` switcher, `?ws=`/`?card=`/legacy `tab`/`doc` URLs, `/` and Esc guards, loading/error/empty states; `GET /api/kb/workspaces`.
- 2026-10-27 KB-06 artboard: full-bleed canvas sized to the window, camera (pan, wheel zoom about the cursor, Fit clear of the panels), category frames (auto-layout, collapse), the design's card, drag and Alt+Arrow saved per workspace (`/api/kb/positions`), click/Shift/box selection, minimap and zoom bar, the canvas keyboard model, culling.
- 2026-10-27 KB-07 artboard II: link lines by type with pills (kept off cards, stacked per card pair), hit strokes and the "why linked" popover with accept/reject, the legend, the selection's lines highlighted, the Outline (subtree counts, filter, "+ New category", General knowledge, row → frame + first card), saved views per workspace (`/api/kb/views`), the Researching dock (`/api/kb/research/tasks`).
- 2026-10-27 KB-08 details panel: a non-modal aside with every §4 field, the ladder, tagged evidence, connected cards with "Why linked" and "Link to…", sources with provenance, usage, history with Restore, inline edit and create, pin / mark for research / block / archive / reject / merge with their reversals (accept, unarchive, unreject, unblock, detach), a slide that respects reduced motion.
- 2026-10-27 KB-09 Library view: the cards as a sortable table (title, stage, updated, verified, used) that pages on, every §13 filter in the URL, saved filter views, bulk accept / mark for research / block / move / archive sent per workspace, the details panel beside it; the UI-16 sections move in as tabs after Cards.
- 2026-10-27 KB-10 Relationships view: a picker of connected cards (most connected first), then the card in the middle with its neighbours on a ring grouped by relationship and their own neighbours on a second ring; filters by type and AI suggestion, a line explains itself (accept/reject a suggestion there), arrow keys walk the neighbours, Enter recentres, the centre opens its details.
- 2026-10-27 KB-11 Safe fetcher and source storage: `apps/server/src/kb/fetcher.ts` reads public pages and documents (HTML, PDF, markdown, text, CSV) with each hop's host checked and the connection pinned to the checked address, robots.txt obeyed, a per-site gap, size, time and type caps, paywall/login detection and blocked domains; `kb-sources.ts` stores them with a content hash, excerpt and a domain-class rating the owner can change (PATCH /api/kb/sources/:id), and hands agents only fenced, quoted text.
- 2026-10-27 KB-12 Research runner: `packages/agents/src/kb-research.ts` walks a research task through the ten stages, checkpointing each in `kb_task_steps`. Planning, discovering, analyzing, evaluating, extracting and reporting are research-mode runs of the task's agent: web search only, no app or store tools, 30 turns, at most what the task has left, on Claude even for a demo store. Each answers with one JSON object, which is checked. Retrieving (through the KB-11 fetcher), deduping, storing and linking are code. A failure is retried after 30 s, then 60 s, then fails the task; a stage its agent can't take waits an hour. Cancel, Retry (from the stage that failed) and Refine (a new linked task) are in; a restart resumes from the last finished stage. Each finding's assessment holds a weak or contested card at Hypothesis. The report lists conclusions, open questions, limitations, applications, cards created and updated, unread sources, conflicts and errors. Tasks stream as `kb_task` messages and notify the owner when they end.
- 2026-10-27 KB-13 KB agent tools: every role has `search_knowledge` and `recommend_research`. Search returns accepted cards of the agent's store and General, never another store's, unreviewed, archived or blocked ones, with hypotheses labelled. A recommendation is a `kb.research` approval; once the owner approves, the app starts the research, paid by that store. Research runs, whatever the role, get web search plus four tools. `fetch_source` reads through the KB-11 reader and keeps the page as a task source. `propose_card` files a proposed card that the ladder stages: forbidden types and stages are refused, and only read sources count. A card that already says it gains the evidence instead, and an archived or rejected one is left alone. `add_evidence` adds evidence for or against (against opens a conflict). `suggest_link` never suggests a pair the owner rejected. The task report now counts cards the tools made or updated.
- 2026-10-27 KB-14 Research from source: the "From source" toolbar button opens a full form, and the bar sits along the bottom of the Research Center. The owner pastes links or text, or attaches or drops a document (a PDF, text, markdown, .vtt/.srt transcript, CSV or HTML, up to 10 MB). They pick an agent and file to its store or General, optionally to one of its categories, with what to look for and a budget. The dialog then follows the task: each source as it's read, links still waiting, findings, Stop or Retry, and, at the end, the report with the new cards to accept or reject and the cards it added evidence to. The "Research done/failed" notification opens the task (`?task=`).
- 2026-10-27 KB-15 New research: the owner writes a request and picks the agent, where the findings go, a depth (Quick reads up to 3 sources, Standard 5, Deep 8, each with a suggested budget) and the budget. "Review the plan" then shows what will happen: the agent plans from what the knowledge base already holds, searches and reads up to N public sources, files proposed cards there for review, and writes a report, spending at most $X. Nothing is spent until Start research. "Research this" opens it prefilled from a card's details, an artboard frame (filed to that category), a campaign row in Analytics, and a finished Chat answer.
- 2026-10-27 KB-16 Research Center: workspace chips (All workspaces, General, each store), six tiles linking to their Library filter or the widget below, the knowledge map (each root category's cards stacked by stage, linking to its frame on the artboard, plus "+ Custom category"), latest discoveries (cards that earned Validated this week and conflicts waiting for a call, with Compare evidence and Keep both) and a preview of the newest one's frame, and the research column: Active / Queue / Done / Sources, running tasks with their stage bar, reads, blocks, findings, matches and spend (Stop, Open task), agents' research recommendations to approve, and knowledge gaps. A task opens as a drawer: where it files, the execution log, the report, and Stop / Retry / Refine. Three columns at 1440 px, two below, one on a phone. No view scrolls sideways at 390 px anymore.
- 2026-10-27 KB-17 Retrieval in real tasks: every agent task now starts with a "Relevant knowledge" section, the store's accepted cards that match the task and then General's, hypotheses labelled unproven, never another store's, unreviewed, archived or blocked ones. It fits in what the store's memory leaves of the prompt. search_knowledge ranks the same way (any of the words, then stage, recency, the role's areas, use, reliable sources and confirmed links). Each time a card goes into a prompt, a search or a citation, it's logged and counted once per run, and a `[kb:id]` in an answer shows in Chat as a link to the card, named by its title.
- 2026-10-27 KB-17 follow-up: "Use in a task" on a card is switched on. It opens Ask AI with "Use [kb:id] to " for the owner to finish, offered only to the card's own store (a General card's to every store in view). A card named that way reaches the agent first, whether or not it shares a word with the task, and the owner's message in Chat shows the card's title as a link.
- 2026-10-27 KB-18 Promote to General: "Promote to General" on a store card asks the agent that wrote it (else the Market Analyst) to rewrite it for any store, and any agent can propose one itself. The draft comes back on the card, word by word against the original, and in the Research Center's discoveries. The owner approves it, edits it first, or keeps it in the store. Approved, it's a General card in the same category, starting as a Hypothesis, Derived From the store card. A card found on its own in two or more live stores is offered once, drafted from the strongest of them. In demo mode the draft only takes the store's name out.
- 2026-10-27 KB-19 Performance pipeline: every hour, each real store's settled 28-day periods are read against a baseline: each campaign against the store's other campaigns on its network (ROAS, click-through rate), the store against its own 12 weeks before (conversion rate, order value, refund rate), and each product against its 4 weeks before, adjusted for the store's trend (unit sales). A difference outside the noise becomes a Performance Lesson with a 95% range, or evidence on the lesson it made before. It counts as measured when nothing else differed; otherwise it's a Hypothesis that names what did. A measured reading the other way moves the lesson down and opens a conflict. Approved changes' outcomes are now evidence on the store cards their run cited. The Research Center says what each store learns from and what isn't enabled. Demo stores learn nothing from demo numbers.
- 2026-10-27 KB-20 Ad-level and creative data: Meta, Google and TikTok Ads now also sync each ad's days, with its ad set or ad group and its text, alongside the campaign totals; the store's ad spend still comes from the campaigns only. An ad whose text holds a library creative's primary text is linked to that creative. Agents describe a creative's format, hook, angle, length and offer, and the Creative Studio preview shows them. Performance learning now reads each ad against the other ads in its ad set (measured), and each creative trait against the store's other library ads with a different one (always a Hypothesis). The Research Center says when ad results and creative traits are on.
- 2026-10-27 KB-21 Experiments and the Campaigns library: a card's panel has a Tests section. "Plan a test" picks a metric (ROAS, click-through or conversion rate), an A and a B side made of the store's campaigns and library creatives, a window and a minimum sample on each side. Once the window's attribution has settled (30 days) and the store's ad accounts have synced past it, the app reads the two sides and writes the result on the card as evidence: worked (measured, so it climbs the ladder), failed (a conflict) or inconclusive. Demo stores can't be tested. The Library has a searchable Campaigns tab: each campaign's platform, dates, spend, ROAS, CTR and latest result, and opened, its creatives, copy and hooks, ad sets, metrics, the cards learned from it with their measurement window, and its Hypotheses as recommended tests. Products and audiences say "not linked". The Research Center's conflicts have "Plan a test".

## Blocked

## Notes
- 2026-10-27 KB-01 audit (at 9a641929). Decisions 1-15 hold against the code: the next migration is #44 (`db.ts:522`
  is #43); `start(agentId, task, resumeRunId?, parentRunId?, retryOf?)` and its identical-task dedupe (`runs.ts:65`,
  `:87`); the hard-coded "40-turn limit" and `maxTurns: 40` (`claude-engine.ts:13`, `:121`); `defaultEngine` picks by
  `store.connected` and VITEST forces fake (`engine.ts:34-40`). Baseline `pnpm check`: 149 files, 992 tests, green. No
  decision changed.
  - Where things go: shared types in a `// ---- knowledge-base lane` section at the end of `packages/shared/src/index.ts`;
    migrations #44+ in `db.ts`; `packages/agents/src/kb.ts` (scoping helper, categories, cards, revisions, ladder),
    `kb-links.ts` (evidence, links, suggester), `kb-retrieval.ts` (search, prompt section, usage log), KB tools in
    `kb-tools.ts` spread into `APP_TOOLS`; `apps/server/src/kb/` for routes, the safe fetcher, the research runner, the
    performance pipeline and maintenance; `pages/Knowledge.tsx` stays the page frame and the views live in
    `apps/web/src/knowledge/`.
  - Screenshots: Orca's built-in browser tiles any viewport wider than 800 px (its pane is ~800 px), so wide shots are
    taken with headless Chrome over CDP (`.agent/cdp-shot.mjs`: exact viewport, prints console errors per shot). Orca
    is still used at its native width. Before shots: `.agent/before/` (4 tabs at 1280x800 and 1920x1080).
- 2026-10-27 KB-05: the two `Knowledge.test.tsx` tests that opened bare `/knowledge` (Edit focus-back, Restore original)
  now start at `/knowledge?tab=playbook`, because bare `/knowledge` is the artboard now and those tests are about the
  playbook editor. The UI-16 `setParams` merge (KB-09's "one change") landed in KB-05 with its test ("stays in the
  Library while moving between its sections and docs"): the legacy URLs made it reachable already. The artboard shows
  a plain clickable list of titles until KB-06 replaces it; "From source" and "New research" are disabled with a
  title until KB-14/KB-15.
- 2026-10-27 KB-06: dragged positions are relative to the card's frame, and rows are packed by the frames' grid sizes,
  so dragging a card out wide pushes later frames along instead of re-wrapping the board under the pointer. The board
  opens fitted, or at 75% from the top-left when fitting would go below that (readability). "Needs refresh" is 90
  days since last verified (or created) until KB-23's per-category freshness. Frame "Research more" comes with the
  research launch points (KB-15). Shift-drag box-selects; a plain drag on the background pans. `.agent/cdp-drive.mjs`
  drives real pointer, wheel and key input in headless Chrome for checks jsdom can't do.
- 2026-10-27 KB-07: line colours follow `kb-atlas.html`: one grey for the supporting kinds, red dashed for Contradicts
  (≠ marker when its pill is hidden), dotted for suggested; the pill names the exact type. Pills are off the tab order
  like the frame buttons; keyboard access to a card's links is the details panel's connected cards (KB-08). The dock
  shows the stage name; the "reading 6 of 9" progress comes with the runner (KB-12), which should also invalidate
  `['kb', 'tasks']` on stage changes (run messages already do). The dock keeps right:16 until the details panel (KB-08)
  moves it. The Outline has no tree folding (the filter box covers long trees); on short windows the whole Outline
  scrolls with the tree kept at three rows. Saved views: the select is a picker (picking the same view again brings
  it back), and delete acts on the view last picked or saved.
- 2026-10-27 KB-08: "Use in a task", "Research deeper" and "Promote to General" show disabled with a reason until
  KB-17, KB-15 and KB-18 (approving promotions comes with KB-18). Blocking is all agents (`blockedRoles: ['*']`);
  per-role blocking can come with KB-22's controls. Cards merged into a card are listed under "Merged in" with Detach,
  read from `mergedInto`: a real-browser drive showed an evidence-less merge had no way back when Detach sat only on
  evidence rows. A new card sends only the fields typed, because a stage set by hand stops the ladder moving it. History
  shows the latest five. Fit and pan-into-view leave room for the open panel and for the dock while it shows.
- 2026-10-27 KB-09: Cards is the Library's first tab; a legacy `?doc=` link (no `?tab=`) still opens Playbooks. Saved
  filters are `kb_views` rows whose state has `filters` (KbCardQuery names); the artboard lists only the views without
  them and the Library only the views with them. Bulk is `POST /api/kb/cards/bulk {ws, ids, patch}`, all or nothing,
  limited to status, blockedRoles, researchMarked and category; the client sends one call per workspace. Accept touches
  only unreviewed cards, Archive only live ones, and a merged card is left out of every bulk action. The source filter
  reads `GET /api/kb/sources` (empty until KB-11). Agent, source, metric, tags and the two date ranges sit behind
  "More filters", shown on their own when one is set. No bulk unarchive: the details panel has it per card.
- 2026-10-27 KB-10: `rings()` in layout.ts lays out unit rings (tested); the view maps them to px per ring, shrinking to
  fit. A neighbour shows once, under its first relationship in type order; ring 2 holds up to three of each
  neighbour's own neighbours. In this view the details panel opens from the centre card instead of on its own, because
  with it open a two-ring map didn't fit at 1366 wide; closing it keeps the map centred. Past about 20 neighbours ring 1
  will crowd: cap it with "+N more" if real workspaces get there. Each node's relationship and "why" are its
  accessible description and show as a caption on focus or hover.
- 2026-10-27 KB-11: PDF text comes from **unpdf 1.8.1** (MIT, no dependencies, pdf.js's serverless build), pinned
  exact; 1.9.x was under two weeks old. It's imported only when a PDF arrives, so it doesn't slow startup. The fetcher
  reuses competitors.ts's `LOCAL` list (now exported; it's core's file, a one-word change). Its DNS answer is checked
  once per host per fetch, and `pinned()` hands that address to node's `lookup`, so TLS still checks the name. Fetches
  are refused when any answer is local, IP literals included. Nothing is wired to a route yet. KB-13's `fetch_source`
  should build **one** `createFetcher()` per server, because the robots.txt cache (a day) and the per-site gap (1 s)
  live in it, and should pass the workspace's blocked domains; KB-22 adds trusted domains. The Accept header lists
  markdown, so sites that serve it (help.shopify.com does) send markdown, and its first `#` heading becomes the
  title. Paywall and login detection are markers, not a model: `isAccessibleForFree: false`, a paywall class or id,
  "subscribe to continue reading", and a password box on a page with under 1,000 characters of text. Reliability
  rules are a host list per class plus `.edu`/`.ac.xx`, a `blog.` host or `/blog` path (vendor), and
  `community.`/`forum.` (forum). Extend the lists when real sources show up as unknown. A source that wasn't read keeps
  no text, and `sourceForAgent()` says it wasn't read. Read text goes out between nonce markers with every line
  quoted, Unicode line breaks included. Also fixed: enum checks in the KB routes used `in`, which let `toString`
  through as a card type or stage; they're `Object.hasOwn` now.
- 2026-10-27 KB-12: a stage's run carries `mode = 'research:<task id>'` on `agent_runs`. `execute()` builds the run's
  input inside `start()`, before the runner could note the run id, so the run names its own task. A restart's retry
  copies the mode, and `stepRun` follows the retry link, so the task adopts it. **Change to decision 8:** retrieving,
  and a source task's discovering, are code rather than agent runs. That's cheaper, and every page goes through the
  guarded fetcher (research mode has no WebFetch, only WebSearch, until KB-13's `fetch_source`). Stage outputs are
  one JSON object in the final answer, checked with zod per stage (a finding citing a source number that wasn't read
  is rejected), and kept in `kb_task_steps.output_json`. KB-13's `propose_card` / `add_evidence` can replace
  extracting's JSON. Research runs on Claude even on a demo store, because the demo engine can't read the web. The
  owner starts these tasks; **KB-22's autonomous research must not start one on a demo store unasked.** Retrieving
  passes `blocked: []` for now; KB-13 or KB-22 should pass the workspace's blocked list. Pages are read one at a time
  (a ponytail ceiling: one slow site holds up the pass). Backoff waits ride agentRoutes' existing 60 s poll, so a 30 s
  retry can start up to a minute late. A stage earns no XP and sends no notification; the task notifies once when it
  ends. Ladder: `earnedStage` keeps a card at Hypothesis while the finding that created it (`kb_findings` status
  `stored`) was rated evidence 2 or less, or listed contradictions. A finding merged into an owner's card doesn't
  demote that card. Dedupe matches the same title in any state (the unique index), else 60%+ word overlap of title
  and summary with a live card (`sameCard` in kb-links.ts). Matching an archived or rejected card discards the
  finding. The API: `createResearchTask`, `advanceResearch`, `getResearchTask` (detail with steps, log, sources,
  findings, report), `cancelResearch`, `retryResearch`, `refineResearch`, plus server `advanceKbResearch(db)`.
  Routes for them come with KB-14 to KB-16; the Researching dock's list route still uses routes.ts's `toTask`.
  Real-engine smoke (the planning stage only; it ran twice, once more than the rule allows, to read its log):
  Claude answered in a fenced JSON block that parsed, but wrote a 600+ character scope, and the stage was refused.
  Text that runs long and lists that run over are now trimmed, not refused (tested); only empty or mistyped answers
  fail. Discovering through reporting haven't met a real model yet. KB-14's first real task will show whether the
  prompts need tuning.
- 2026-10-27 KB-13: the tools live in `APP_TOOLS` in tools.ts, beside the others. A separate kb-tools.ts would import
  tools.ts while tools.ts imports it. `runTools(role, mode)` picks a run's tools: research mode gets `RESEARCH_TOOLS`
  whatever the role; otherwise the role's own list without the research-only ones. Both engines use it.
  `toolsFor` is unchanged for evals: the research tools are listed on market_analyst only, and BASE gives every role
  search_knowledge and recommend_research. A research tool finds its task through `ctx.runId` and `agent_runs.mode`.
  `search_knowledge` is a keyword match (every word), newest first, over active cards; KB-17 ranks, boosts and logs
  use. `recommend_research` goes through the approvals system: kind `kb.research`, in `OUTLIVE_RUN`, so the request
  outlives the run and the agent doesn't wait for it. The pending ones are the Research Center's "Agents recommend"
  queue: KB-16 shows them, KB-22 adds cost estimates and dismiss. It isn't sent twice: not while the same objective
  waits for the store, nor while a task of it is queued, running or done (a failed one may be asked again). On
  approval, agentRoutes' `onApproved` starts it. The findings go to that store or to General, never elsewhere, and
  the budget is clamped to $0.25–5. `fetch_source` passes no blocked domains yet (KB-22). The report's
  created/updated lists now come from the cards and evidence carrying the task id, so cards made by tools count.
  Provenance: an agent never edits a card's fields. It can only add evidence or suggest links, and the ladder keeps
  a stage the owner set. Found while testing: a General task's workspace is `null`, so `?? ctx.store.id` would have
  searched the paying store's cards. The code tests `task ?` instead.
- 2026-10-27 KB-14: `POST /api/kb/research/tasks` (`KbSourceResearchInput`) takes an agent rather than a role.
  The agent's store pays, and findings go to that store or to General, never another store: decision 9, enforced on
  both sides. An upload is read when the task is made, by `readUpload` in fetcher.ts, the fetcher's own document reader
  on the file's extension. So a scan or an .exe is refused at once, with the reason, and nothing is saved. A readable
  one is kept as a `document` source, linked to the task, and listed in `brief.documentIds`; retrieving reads it with
  the rest, and a refined task links it again. JSON with base64 rather than multipart, so the client's `api()` helper
  and the route stay as they are. The task dialog polls every 2 s while the task is going: `kb_task` only streams when
  a stage ends, and reading 8 links is one stage. The web now handles `kb_task` by refreshing every `['kb']` query.
  Stop and Retry are in the dialog; Refine and the full drawer (log, steps, categories) are KB-16. A paste counts as
  text when there's more than links in it; the form shows "Reads 2 links · the pasted text · notes.pdf" before it
  starts. Checked in the dev app at 1440 and 390 with a seeded finished task (no task run: the dev server is on real
  Claude). Found there, for KB-16: at 390 px the view switcher (Artboard … Research Center) is wider than the screen
  in every view, so the page scrolls sideways.
- 2026-10-27 KB-15: New research uses the same `POST /api/kb/research/tasks`. With an `objective` and no sources it makes
  a topic task; with sources, the objective just names a source task. Depth is `KB_RESEARCH_DEPTHS` in shared:
  sources plus a suggested budget. It's kept in `brief.depth`, and the runner's discovering prompt and retrieving
  both cap at that number. No depth reads 8, as before, so agents' recommendations are unchanged. The plan preview is
  the app's plan, built from the form: no agent run before the owner says go. The agent's own plan (scope, questions,
  searches) is the planning stage, the first thing that spends, and it is in the task's steps (KB-16's drawer).
  Launch points use one URL, `researchHref(ws, ask, cat?)` → `/knowledge?view=research&ws=…&ask=…[&cat=…]`. On the
  Knowledge page a card or frame just sets `ask`/`cat` and stays in its view; closing the form drops them. The
  request is cut to 500 characters, the server's limit. Not done, because the hosts don't exist yet: the Dashboard has
  no store card and Analytics has no insights panel. Add `researchHref` links when they do.
- 2026-10-27 KB-16: one call feeds the page, `GET /api/kb/overview?ws=` (`kb/overview.ts`), over visible cards. Rules,
  until KB-23 replaces them: needs refresh = 90 days since verified (or made), as on the artboard; the Hypotheses tile's
  "ready to test" counts Research-Supported cards (backed by research, not yet tested); a gap is a root category of one
  workspace with only hypotheses, else half or more stale, else no measured evidence, weakest first, 5 at most. A
  "Now validated" discovery is an app revision "Moved up to Validated" in the last 7 days on a card still Validated; open
  conflicts show whatever their age. All workspaces adds up same-named roots on the map and links to the workspace
  holding most of them. New routes: `PATCH /api/kb/conflicts/:id?ws= {status:'kept_both'}`, `POST
  /api/kb/research/tasks/:id/refine {objective?, budgetUsd?}` (finished tasks only; `refineResearch` from KB-12), and
  `GET /api/kb/sources?ws=all`. The artboard takes `?frame=<categoryId>` (opens that category's frames like its
  Outline row, then drops the param). The card panel's "Research deeper" is switched on (it was still "isn't switched
  on yet"); KB-15's separate "Research this" in Manage is gone. Left for their items: the "Promote to General?" (KB-18)
  and "Refreshed" (KB-23) discoveries, "Plan a test" on a conflict (KB-21), the self-directed research budget line with
  Controls (KB-22), and per-card evidence chips (Measured · N tests / N sources / N connections). A discovery shows the
  stage's reason instead. Found: this Tailwind sorts arbitrary `min-[…px]:` variants before named `sm:`/`lg:` ones, so
  a mixed set loses to the named one. The Research Center uses only `min-[…px]`. Also found: the closed details
  panel waited off the artboard's right edge and widened the page by 340 px at every size. The artboard wrapper is now
  `overflow-x-clip`, and the view switcher sits in its own scroller (the KB-14 note).
- 2026-10-27 KB-17: `packages/agents/src/kb-retrieve.ts`. `retrieveKnowledge(db, {ws, role, query, limit})` is an FTS5
  OR-query of the task's words (3+ letters, a stop list, 24 at most, each quoted so nothing reads as syntax), ranked by
  `-bm25(title 4, summary 2, body 1, tags 2)` × stage (1 / 1.15 / 1.3 / 1.5) × 1.1 if touched in 30 days × 1.3 in the
  role's areas × (1 + 0.03 per use, a citation counting 2, capped at 10) × 1.1 with research evidence from a read
  reliable source (the ladder's rule). Cards confirmed as linked to the 3 best come along at half that score; then the
  store's own first. Role areas are a ponytail regex over category names until KB-22 lets the owner set them. The prompt
  gets 8 cards for the run's task (none for research stages, which have their own prompt), placed after memory and
  before jobs. It fits what memory left, so the 1500-token floor stays memory's (a test checks both). `kb_retrievals`
  logs 'prompt' only for cards that fit, 'search' for each search_knowledge result, and 'cited' for each `[kb:id]` in
  the finished answer that's a card the store may see. `used_count`/`cited_count` rise once per run per card. Left out:
  type, stage, category and tag filters on search_knowledge, and the embeddings layer (decision 12, optional). In Chat,
  a citation stays as written until its card loads. The client retries a 404 for ~7 s, so an unknown id never shows a
  placeholder. Mutation sweep: 37 of 37 meaningful killed. Two equivalents were left: the join of transcript text (the
  transcript already merges deltas), and a matched card keeping its own score over half a linked card's. Seen once:
  the ui lane's `UpdatePrompt.test.tsx` "re-shows itself above a dialog" failed under full-suite load and passed alone
  3/3 and on the rerun.
- 2026-10-27 KB-17 follow-up: KB-17 had left the panel's "Use in a task" disabled ("Agents don't read the knowledge base
  yet"). It now dispatches `frontline:ask` with `{q, storeId?}` (AskPalette's new `AskStart`). The palette was the
  lightest way to pick a question and an agent, and it still asks only Market Analysts. `retrieveKnowledge` puts cards
  named `[kb:id]` in the query first, with the same workspace, status and role checks, and strips the ids before the
  keyword query, so they don't use up its 24 words. search_knowledge with an id finds that card the same way.
- 2026-10-27 KB-18: approvals kind `kb.promote` (in `OUTLIVE_RUN`), payload `KbPromotion {cardId, title, summary, body?}`
  (shared). Tool `propose_general` is in every role's base set (normal runs, not research). It takes only the store's
  own accepted cards, one waiting promotion per card, and none already promoted. "Promoted" means a confirmed Derived
  From link from a General card. `promoteToGeneral` (`kb-promote.ts`, run by agentRoutes' onApproved) only promotes
  the asking store's card. The General card has the same category path, stage Hypothesis (one store's evidence isn't
  evidence for the others), origin `promotion`, and the drafting agent as author. A General card with the same title
  gets the link instead of a twin. The link is stored in the store's workspace, since General never sees store cards.
  Routes: `POST /api/kb/cards/:id/promote?ws=<store>` (202 {runId, agentId}; 400/404/409) starts the drafting run
  with `promotionTask` (the card named as `[kb:id]`, so retrieval gives it to the agent first), and `PATCH
  /api/kb/promotions/:approvalId?ws=` {title, summary, body} edits a waiting draft within the card limits. Cross-store
  suggestions: `proposeKbPromotions` (`apps/server/src/kb/promote.ts`) looks at live stores only (connected and gone
  live, as proposeNichePromotions does). Cards match on ≥50% of the words of title + summary, each card is offered
  once (`done_once kb-promote:<id>`), and the strongest card's agent drafts it. It runs hourly from
  `startKbPromotionLoop`, mounted in `apps/server/src/index.ts` (core's file, one line beside the other loops). The
  overview's discoveries add `{kind: 'promotion'}` for waiting promotions, for their store and All workspaces. A
  live `approval` message for any `kb.*` kind now refreshes the KB queries too (client.ts): a waiting one at once,
  a decided one after the card is filed. The approvals inbox (Chat's approval card) shows only the title and the
  agent's why; the diff lives on the card. Left out: carrying a store card's evidence over to General. Mutation
  sweeps: server 38 of 38 meaningful killed (3 equivalent bits of code removed rather than tested), web 11 of 11.
- 2026-10-27 KB-19: one path, `learn(db, Reading)` in `packages/agents/src/kb-perf.ts`. A reading is recorded once in
  kb_observations (unique `ref` = what over which days). `lift()` gives the ratio, its 95% range and z, with each side as
  noisy as a count (Poisson, log scale). ROAS counts its purchases. An average counts orders / (sd/mean)², so its noise
  comes from the spread of order totals. Under |z| 1.96 the reading stays an observation. Otherwise it's evidence on the
  lesson for the same subject, metric and direction (found through its observations, or by title), else a new card:
  type performance_lesson, origin `performance`, author `app`, stage set by the ladder. Kind `measured` if the reading
  has no confounds, else `observed` (a Hypothesis at most). A measured reading the other way is also `conflict` evidence
  on the opposite lesson. A lesson the owner archived or rejected takes nothing more and isn't made again. The
  analyzers are in `apps/server/src/kb/performance.ts`:
  - periods are fixed 28 days from 2024-01-01, so periods never overlap and two of them are two independent tests
    (Validated);
  - the last 3 periods are read once per store (`done_once kb-perf:<store>:<from>`), only after every integration
    synced 30+ days after the period ended (the 28/30-day attribution re-pull) and only for `stores.demo = 0`;
  - campaigns: 7+ days and 5%+ of the period's ad spend (share, so currency-safe), 10+ purchases for ROAS, 1,000+
    impressions and 10+ clicks for CTR, on each side. The baseline is the same network's other campaigns, else the
    rest of the store's (a confound: networks count purchases their own way). Confounds: any campaign compared ran
    under 21 of 28 days, or was changed by an approved ads.* request in the period;
  - the store: CVR from `storeFunnel` (the theme check's query, now exported), AOV and refund rate from orders, 30+
    orders and 10+ refunds a side, always confounded (season, promotions);
  - products: units vs the 4 weeks before × `restTrend` (par's season adjustment, now exported), 10+ units a side; a
    product new in those weeks is left out (`newSince`); a price test or page publish in them is a confound.
  Outcomes: `recordOutcome` takes the checker's run id and calls `learnFromOutcome`. Cards cited (kb_retrievals
  `cited`) in that run, the store's own, get `measured` (worked) or `conflict` (did not help) evidence with metric
  `outcome` and testRef = the outcome ref. Unclear outcomes, demo stores and General cards get none.
  `KbOverview.performance` (`KbPerformance`): per store in the workspace, what it learns from (data present), what
  isn't (and why), and its lessons. Ad-level and creative data is always listed as not enabled, until KB-20.
  Left out: an agent's explanation of a lesson (decision 13 allows only the explanation text from an agent; it would
  spend the owner's usage on every lesson, so it waits for KB-21's test planning). Also left out: email, landing-page
  and segment learning (no data synced for them). Mutation sweeps: server 36 of 36 meaningful killed after 13 new
  tests (createCard already runs the suggester, so the extra call was removed), web 5 of 5. Found while checking 390
  px, not from this change: the Knowledge view switcher (Artboard … Research Center) and the Research Center column
  tabs stick out about 45 px past the viewport, so the page scrolls sideways.
- 2026-10-27 KB-20: migration 47 adds `ads` (network, id, campaign_id, group_id = ad set / ad group, name, status,
  copy, creative_id → creatives ON DELETE SET NULL; cascades from campaigns) and `ad_daily` (the campaign_daily
  columns per ad), plus creatives.format / hook / angle / length_s / offer. `saveAds` in connectors/common.ts writes
  both inside each sync's transaction, after `rebuildAdSpend`, which still sums campaign_daily only. An ad known only
  from its results gets an 'archived' row by its reported name; an unknown campaign gets one too (a campaign made
  between two queries must not fail the sync's foreign keys). What each network is asked:
  - Meta: `/ads` (adset_id, effective_status, creative{body}) and insights at `level=ad` in the same chunks and
    attribution window as the campaign pull;
  - Google: `FROM ad_group_ad` with ad_group.id; text = responsive search ad descriptions (Performance Max has asset
    groups, not ads, so its ads aren't seen);
  - TikTok: AUCTION_AD reports with campaign_id, adgroup_id and ad_name as attribute metrics, and `/ad/get/`
    (ad_text).
  "Launched through the app" has no launch flow to hook into (the app's only ad actions are budgets and pauses), so
  the link is made at sync time instead: an unlinked ad whose text contains a library creative's primary text
  (case and spacing aside, 20+ characters, the longest wins) is linked to it. An ad reworded when it was set up stays
  unlinked. When the app gets an ad-launch action, it should write `ads.creative_id` directly.
  Performance (`adReadings`): ads that ran 7+ days on 5%+ of their campaign's spend. Each ad is read against the other
  ads in its ad set (same people, budget and days: measured unless notes); with none there, against the rest of its
  campaign with the confound "they run in different ad sets, so to different people". Two ads with no known ad set
  aren't taken to share one. An approved ads.* change to the campaign in the period is a confound. Each trait value
  (format, hook, angle, offer, lowercased) of library-linked ads is read against the network's library ads with a
  different value, always confounded ("they differ in more than their hook: …"). Length isn't compared yet (needs
  buckets). `ratios()` now holds the ROAS/CTR reading code that campaign, ad and trait readings share. Mutation sweep:
  46 of 46 killed after 5 new tests. Not checked against live accounts: field names follow each API's docs, and the
  fixtures are written from them.
- 2026-10-27 KB-21: tests reuse migration 44's `kb_experiments` (plan_json = {variants, from, to, minSample},
  result_json = {text}); no new migration. `apps/server/src/kb/experiments.ts`: `parseExperiment` (each refusal is a
  sentence the form shows), `planExperiment`, `evaluateExperiments` (in the KB performance loop, hourly) and
  `listCampaigns`. A side's numbers: its campaigns' campaign_daily, plus its creatives' ads' ad_daily outside those
  campaigns (never counted twice). Reading: `lift()` from KB-19 on the metric's rate (ROAS k = purchases, CTR k =
  clicks, CVR k = purchases); |z| ≥ 1.96 is worked or failed, else inconclusive; a side under the minimum sample is
  inconclusive and says so. Evidence: worked → measured with testRef `exp:<id>` (one test = Tested, two = Validated),
  failed → conflict (opens a conflict), inconclusive → observed. Evaluated only once the window's end + 30 days has
  passed (`due`) and `synced(db, store, due)`; demo stores never. Routes: `GET|POST /api/kb/cards/:id/experiments`
  (409 for a card that isn't active or unreviewed, 400 for a General card without `storeId`), `DELETE
  /api/kb/experiments/:id` (planned only), `GET /api/kb/campaigns?ws=` (General → []). Campaign cards: lessons through
  kb_observations subjects `campaign:<network>:<id>` and its ads' `ad:` subjects (latest window per card), plus the
  live cards of tests on it. "Not linked": products (no campaign↔product link is synced), audiences (ad set count only,
  targeting isn't synced), creatives/copy when no ad is linked to a library creative. Left out: an agent proposing a
  test plan (planning is the owner's form; an agent tool can come with KB-22's autonomy controls). Mutation sweep: 41
  of 41 killed after 7 new tests. The worktree's dev DB had run an earlier draft of migration 47 without
  `ads.group_id` (never shipped); the column was added by hand there.
