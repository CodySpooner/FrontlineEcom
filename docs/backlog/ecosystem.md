# Backlog — ecosystem lane (AI Ecosystem pixel-art office)

Spec: `docs/features/ai-ecosystem.md` (the owner's prompt, verbatim — it wins over this file where they differ).
Visual target: `docs/reference/ai-ecosystem-reference.webp`. Repo rules: `CLAUDE.md` (worker loop, hard rules).

## Lane

Owns: `apps/web/src/ecosystem/**`, `apps/web/public/ecosystem/**`, `apps/server/src/routes/ecosystem*.ts` (+ tests),
this file. Allowed touch points outside it, kept tiny: one `/ecosystem` entry in `apps/web/src/nav.ts` + its `PAGES`
element in `apps/web/src/App.tsx`, one `.route()` mount in `apps/server/src/app.ts`, additive types at the end of
`packages/shared/src/index.ts` under a `// AI Ecosystem` header, appended migrations in `apps/server/src/db.ts`
(rebase first, take the next number), and the `pixi.js` (+ React binding if useful) dependency in `apps/web`.
Anything else in another lane → append to that lane's backlog **Inbox** (`- [ ] (from ecosystem) …`) and keep going.

## How it maps onto this app (read before ECO-02)

- **No second agent system.** An office worker is an existing agent (`Agent`, id `<storeId>:<role>`, from
  `GET /api/agents`). "Deploying" = seating an existing agent at a desk; the office only stores the seat:
  desk, display name override, appearance, archived flag. Archiving frees the desk; the agent and its runs stay.
- **Role → home department:** product_hunter → Product Research, market_analyst → Analytics, ad_strategist →
  Advertising, creative_studio → Creative Studio, store_developer → Store Development, copywriter → Copywriting,
  operations → Operations, email_sms → Email & SMS. Executive HQ and Integrations & Automation have no matching role:
  the wizard lets the owner seat any agent in any department with a free desk.
- **Real state comes from what already exists:** agent `status`, runs (`AgentRun`), `/api/live` messages (`run`,
  `run_event` with tool events, `approval`, `xp`), flows in `packages/agents/src/flows.ts` for multi-agent work and
  handoffs. Build the typed `AgentOfficeEvent` adapter on top of these in `apps/web/src/ecosystem/`. Only if a needed
  fact truly isn't exposed, ask the agents lane via its Inbox.
- **Assign Task / Chat / Cancel / Configure** call the existing agent endpoints (see `apps/server/src/routes/agents*.ts`,
  `apps/web/src/pages/AgentDetail.tsx`). Don't add a parallel task system.
- **Levels and XP:** reuse the existing XP / `RANKS` (`packages/shared`). Office achievements can be computed from
  real seats, runs and flows.
- **Demo Mode** (spec §15) is a separate event provider in `apps/web/src/ecosystem/`, behind a clearly labeled toggle,
  never mixed into the real provider. The seeded demo stores already run on the free fake engine, so real tasks on
  demo stores are real-path tests that cost nothing. Never connect a real store or use a real Claude run for testing.
- **Art:** you may generate images (sprites, tiles, props, portraits) with your image-generation tool. Keep one
  consistent pixel-art style, cut sheets onto a fixed grid, pack atlases, and save under `apps/web/public/ecosystem/`
  (the app must work offline: no CDNs). Procedural pixel art drawn in code is fine where generation falls short.
  Render with nearest-neighbour scaling (no blur). Keep total art size reasonable (a few MB).
- **Ports for this worktree:** `WEB_PORT=5203`, `API_PORT=8817`. Verify screens in a browser against the reference.

## Inbox
<!-- other lanes append requests here: - [ ] (from <lane>) <request> -->
- [ ] (from agents) Your ECO-14 request is built (AGT-98, AGT-99):
  - **Squad missions** (`SquadMission`, `SquadMissionStep` and `NewSquadMission` in `packages/shared`): `GET /api/squad-missions?stores=a,b` (newest first), `GET /api/squad-missions/:id`, `POST /api/squad-missions` (`{ storeId, title, steps: [{ id, role, task, dependsOn? }] }` → 201; the first steps start at once), and `GET /api/squad-missions/templates` ("Launch a new product": the six roles of spec §7).
  - Each step is an ordinary run. A step starts when all its `dependsOn` are done, as the **child run** (`parentRunId`) of the first one, with their final answers in its brief. Handoffs are real parent/child runs, so `/api/live` `run` events show them.
  - Mission `status`: `running` | `done` | `blocked`. Step `status`: `waiting` | `blocked` or its run's status. A step also has `runId`, `deliverable` (the first line of its answer) and `note` (why it couldn't start yet). The mission panel's pending, completed and blocked tasks map straight onto these.
  - Missions end with a notification ("Mission done: …" or "Mission stuck: …", linking to `/ecosystem`).
  - **Model and provider:** every `Agent` has `engine: { provider: 'claude', model } | { provider: 'demo' }`, the same choice the run engine makes. There's no second config to link.

## Items
- [x] ECO-01 Inspect: read the files named above, note in **Done** how the office will read agents/runs/flows/live events and what (if anything) is missing.
- [x] ECO-02 Route + shell: `/ecosystem` "AI ECOSYSTEM" / "A LIVING WORKFORCE OF ECOMMERCE AGENTS" in nav, page skeleton matching the reference (header, 4 stat cards, tabs, office area, right activity panel, bottom bar). No other page changes.
- [x] ECO-03 Seats backend: migration + `routes/ecosystem.ts` — list/deploy/update/archive seats, 30-desk capacity enforced server-side, desk uniqueness, persistence across restarts, tests.
- [x] ECO-04 World: isometric tile map with the 10 departments (desk counts per spec §3) + central globe area, props, ambient animation, cached static layers, collision grid.
- [x] ECO-05 Camera: drag pan, wheel zoom, double-click focus, jump to department, reset, fit, fullscreen; sharp pixels at every zoom step.
- [ ] ECO-06 Characters: sprite sheets with the 10 animations (spec §4), per-agent appearance variation, isometric walk directions, animation state machine.
- [ ] ECO-07 Movement: A* on the grid with occupancy, walk to desk / meeting table / another desk; tests for the pathfinder.
- [ ] ECO-08 Real state → behavior: `AgentOfficeEvent` adapter over existing live messages + REST snapshot; state table from spec §5; idempotent on reconnect, ignores stale/out-of-order events; tests.
- [ ] ECO-09 Agent panel: click a character → profile, live activity, performance (runs, cost/tokens where present), actions (chat, assign task, output, history, configure, pause/cancel, focus) using existing endpoints.
- [ ] ECO-10 Assign Task: compact command panel → real run on that agent; loading / success / failure / awaiting-approval states shown in the panel and on the character.
- [ ] ECO-11 Deploy wizard: "+ Deploy Agent" picks an existing agent, department, free desk, name override, appearance; entry walk-in animation; counter `n / 30`; capacity block; archive keeps history.
- [ ] ECO-12 Live activity feed + stat cards from real data (deployed n/30, active tasks, success rate, active teams); click an event → focus agent / open task.
- [ ] ECO-13 Handoffs: when real flow steps hand work between agents, the sender walks to the receiver, speech bubble summarizes the real event; communication history.
- [ ] ECO-14 Meetings: multi-agent flows gather participants at the table, objective above it, then they return to work; mission panel (spec §7).
- [ ] ECO-15 Other tabs: Department View, Agent List, Task Board, Performance — built from the same data, compact.
- [ ] ECO-16 Bottom bar + display toggles (names, bubbles, department labels, workload, connections, status icons), Office Settings.
- [ ] ECO-17 Demo Mode provider: clearly labeled, separate from the real provider, exercises every visual (spec §15).
- [ ] ECO-18 Customization: outfits/colors/accessories per seat, data-driven desk/decor themes so cosmetics can be added without rewriting the map.
- [ ] ECO-19 Gamification: levels from existing XP/ranks, office achievements from real data, trophy area.
- [ ] ECO-20 Performance: 30 characters at ~60 FPS (measure and note it), atlases/batching, no React rerender per frame, reduced-motion, low-power fallback.
- [ ] ECO-21 Acceptance pass: walk every line of spec §17 in the browser, fix gaps, record the result here.

## Blocked

## Done

- 2026-10-26 ECO-05: Smooth camera with pointer drag/capture, anchored wheel zoom, +/- and arrow keys, double-click focus, department jumps, fit/reset and fullscreen. Nearest-neighbor map sampling retained. Orca department focus and fullscreen entry/exit verified; .agent/eco-05.png inspected. Camera anchor/limits tests; pnpm check 110 files / 599 tests pass. Worker focus will use the same focus method as workers arrive.

- 2026-10-26 ECO-04: PixiJS office with original cached pixel map art, ten distinct departments, thirty selectable desks, plants/studio/crates/rack props, holographic globe, blinking monitors and collision tiles. Accessible desk directory; narrow screens give the scene full width. Browser selection and .agent/eco-04.png compared against reference; 109 files / 597 tests pass. Detailed zoom and workers follow in ECO-05/06.

- 2026-10-26 ECO-03: Added migration 35, shared ten-department/30-desk catalog and validated list/deploy/update/archive API with a unique active-desk index. Tests fill capacity, reject conflicts/invalid inputs, reopen a file database and preserve agent/run history on archive. Browser GET /api/ecosystem/seats verified; pnpm check 108 files / 593 tests pass.

- 2026-10-26 ECO-02: Added /ecosystem with scoped charcoal/red styling, four truthful placeholder cards, accessible tabs, collapsible activity and status bar; existing nav indices preserved. Orca screenshot .agent/eco-02.png compared with reference; tab interaction verified. pnpm check: 107 files / 588 tests pass (six workers to avoid resource-contention timeouts).

- 2026-10-26 ECO-01: Read the spec, reference, design and app. Reuse GET /api/agents, /api/runs (parentRunId links actual delegated tasks), /api/runs/:id transcripts, /api/approvals and /api/live run/run_event/approval/xp messages; task/chat/cancel/configure use existing agent endpoints and detail links. flows.ts is email/SMS drafts, not orchestration: existing assign_task supports up to three children, no chained dependencies. Asked agents lane for richer missions; office can visualize real parent/child groups meanwhile. Model configuration is not exposed. Baseline pnpm check: 106 files / 585 tests pass. Keep NAV[1] as AI Agents (AgentDetail reads it positionally).

## When you're done
Once every item above is ticked and the spec §17 acceptance pass holds, write the result under **Done**, push, then
create an empty `.agent/STOP` file in your worktree (not in git) and stop.
