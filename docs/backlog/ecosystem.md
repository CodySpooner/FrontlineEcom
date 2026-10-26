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
- [ ] (from agents, small) `/api/ecosystem/stats` `completedMissions` reads each step's stored `runId`, but a step whose run an app restart interrupted is finished by a retry run (the stored run stays `error`, "Interrupted by an app restart"), so that mission never counts and "First Completed Mission" can stay locked. The mission's own `status` already follows retries: `listMissions(db, undefined, 10_000).filter((m) => m.status === 'done').length` (from `@frontline/agents`) counts it right; a cancelled mission (AGT-133) is `cancelled`, not `done`.
- [ ] (from agents, AGT-133) Missions can be called off: `POST /api/squad-missions/:id/cancel` → the `SquadMission` (404 unknown, 409 already ended). Steps not done turn `cancelled` (their runs are stopped), the mission's `status` is the new `'cancelled'`, and `/api/live` sends `{ type: 'mission', mission }`. A "Cancel mission" button in the mission panel while it's `running` covers a step stuck waiting on a paused agent, which has no run to cancel.
- [x] (from core, FYI) Migration 39 is core's too (`amazon_refunds.product_id`). The next free one is 40.
- [x] (from core, FYI) Migration 38 is core's (`amazon_refunds`: Amazon refunds now come off revenue). The next free one is 39.
- [x] (from core, FYI) Migration 37 is core's (`orders.tracking_url`; 36 is agents' squad missions). The next free one is 38.
<!-- other lanes append requests here: - [ ] (from <lane>) <request> -->
- [ ] (from core, FYI) Core took migration 42 (`orders.fx_rate`, the rate a Woo order in another currency was first converted at); the next free number is 43.
- [ ] (from core, FYI) Core took migration 41 (index `amazon_refunds_by_order` on `(store_id, order_id)`); the next free number is 42. `rebuildRevenue` drove its refund join from `amazon_refunds` filtered by store only, so each rebuilt day scanned every refund line of the store: ~7 s for 730 days on a 100k-order store, with the server blocked (node:sqlite is synchronous). It now uses `FROM orders o CROSS JOIN amazon_refunds r` (the day's orders as the outer loop) and the new index: ~0.1 s. Your per-product refund joins may want the same shape when they filter orders by day.
- [ ] (from core, FYI) Core took migration 40 (`amazon_refunds.tax`: the tax a refund line gives back, 0 for Amazon's); the next free number is 41. `amount` stays net of tax, so per-product and profit readers need no change; store revenue in `rebuildRevenue` now drops by amount + tax.
- [x] (from agents) `Agent.costTodayUsd` is on every agent read: what its runs spent since local midnight, exactly the sum its `dailyBudgetUsd` is checked against. ECO-09's latest-50-run usage can show today's spend from it (an agent with 50+ runs today read low).
- [x] (from agents) Your ECO-14 request is built (AGT-98, AGT-99):
  - **Squad missions** (`SquadMission`, `SquadMissionStep` and `NewSquadMission` in `packages/shared`): `GET /api/squad-missions?stores=a,b` (newest first), `GET /api/squad-missions/:id`, `POST /api/squad-missions` (`{ storeId, title, steps: [{ id, role, task, dependsOn? }] }` → 201; the first steps start at once), and `GET /api/squad-missions/templates` ("Launch a new product": the six roles of spec §7; also "Rescue a slipping product" and "Answer a competitor's price cut", for Create Team).
  - Each step is an ordinary run. A step starts when all its `dependsOn` are done, as the **child run** (`parentRunId`) of the first one, with their final answers in its brief. Handoffs are real parent/child runs, so `/api/live` `run` events show them.
  - Mission `status`: `running` | `done` | `blocked`. Step `status`: `waiting` | `blocked` or its run's status. A step also has `runId`, `deliverable` (the first line of its answer) and `note` (why it couldn't start yet). The mission panel's pending, completed and blocked tasks map straight onto these.
  - Missions end with a notification ("Mission done: …" or "Mission stuck: …", linking to `/ecosystem`). A step its agent turns down sends "Mission waiting: …" once (AGT-104).
  - **Live:** `/api/live` sends `{ type: 'mission', mission }` whenever a mission is created, starts a step, gets a step's deliverable or ends. That's your "Team workflow advanced" feed event (AGT-100).
  - **Model and provider:** every `Agent` has `engine: { provider: 'claude', model } | { provider: 'demo' }`, the same choice the run engine makes. There's no second config to link.

## Items
- [x] ECO-01 Inspect: read the files named above, note in **Done** how the office will read agents/runs/flows/live events and what (if anything) is missing.
- [x] ECO-02 Route + shell: `/ecosystem` "AI ECOSYSTEM" / "A LIVING WORKFORCE OF ECOMMERCE AGENTS" in nav, page skeleton matching the reference (header, 4 stat cards, tabs, office area, right activity panel, bottom bar). No other page changes.
- [x] ECO-03 Seats backend: migration + `routes/ecosystem.ts` — list/deploy/update/archive seats, 30-desk capacity enforced server-side, desk uniqueness, persistence across restarts, tests.
- [x] ECO-04 World: isometric tile map with the 10 departments (desk counts per spec §3) + central globe area, props, ambient animation, cached static layers, collision grid.
- [x] ECO-05 Camera: drag pan, wheel zoom, double-click focus, jump to department, reset, fit, fullscreen; sharp pixels at every zoom step.
- [x] ECO-06 Characters: sprite sheets with the 10 animations (spec §4), per-agent appearance variation, isometric walk directions, animation state machine.
- [x] ECO-07 Movement: A* on the grid with occupancy, walk to desk / meeting table / another desk; tests for the pathfinder.
- [x] ECO-08 Real state → behavior: `AgentOfficeEvent` adapter over existing live messages + REST snapshot; state table from spec §5; idempotent on reconnect, ignores stale/out-of-order events; tests.
- [x] ECO-09 Agent panel: click a character → profile, live activity, performance (runs, cost/tokens where present), actions (chat, assign task, output, history, configure, pause/cancel, focus) using existing endpoints.
- [x] ECO-10 Assign Task: compact command panel → real run on that agent; loading / success / failure / awaiting-approval states shown in the panel and on the character.
- [x] ECO-11 Deploy wizard: "+ Deploy Agent" picks an existing agent, department, free desk, name override, appearance; entry walk-in animation; counter `n / 30`; capacity block; archive keeps history.
- [x] ECO-12 Live activity feed + stat cards from real data (deployed n/30, active tasks, success rate, active teams); click an event → focus agent / open task.
- [x] ECO-13 Handoffs: when real flow steps hand work between agents, the sender walks to the receiver, speech bubble summarizes the real event; communication history.
- [x] ECO-14 Meetings: multi-agent flows gather participants at the table, objective above it, then they return to work; mission panel (spec §7).
- [x] ECO-15 Other tabs: Department View, Agent List, Task Board, Performance — built from the same data, compact.
- [x] ECO-16 Bottom bar + display toggles (names, bubbles, department labels, workload, connections, status icons), Office Settings.
- [x] ECO-17 Demo Mode provider: clearly labeled, separate from the real provider, exercises every visual (spec §15).
- [x] ECO-18 Customization: outfits/colors/accessories per seat, data-driven desk/decor themes so cosmetics can be added without rewriting the map.
- [x] ECO-19 Gamification: levels from existing XP/ranks, office achievements from real data, trophy area.
- [x] ECO-20 Performance: 30 characters at ~60 FPS (measure and note it), atlases/batching, no React rerender per frame, reduced-motion, low-power fallback.
- [x] ECO-21 Acceptance pass: walk every line of spec §17 in the browser, fix gaps, record the result here.
- [ ] ECO-22 Worker redesign (owner, 2026-10-26: "they look to plain i want to see some cooler designs for our workers but have them randomized and just i want you to make these look super cool and unique"). Today every worker is the same 32×40 chibi from `paintPerson` in `characters.ts` with 5 traits (6 colors, 6 hair, 4 skin, 3 outfits, 3 accessories), so they all share one silhouette. Make each worker a striking, distinct character: different archetypes and silhouettes (e.g. tactical operators with visors, hooded netrunners with glowing goggles, androids with face plates, robot/mech heads, execs in long coats, punks, helmeted specialists…), emissive/glowing accents, gear (cyber arms, backpacks, shoulder armor, capes, cables, holo-badges), palettes that pop on the dark floor and still fit the red/black office. Randomized per worker but stable across restarts (derive from the agent id; a reroll is saved in the seat's appearance). Keep all 10 animations × 4 directions, readable at fit zoom; more pixel detail is fine (bigger cell if needed, each atlas texture ≤ 4096 px). Image generation is allowed if it beats procedural parts; procedural parts are fine where they randomize better. `OfficeAppearance` changes stay additive: seats saved with the old shape must still load and render. Update server `validLook`, the Deploy wizard and seat editor (add a "Randomize look" button), portraits, demo seats and tests. Screenshot before/after in `.agent/`.
- [ ] ECO-23 Logo hologram hub (owner: "the red globe hologram in the middle look cool but is their a way you can make it where instead of a globe we can make our logo in to a glowing hologram"). Replace the globe (`globe` container in `renderer.ts`, hub props in `worldArt.ts`) with the owner's logo, `docs/reference/frontline-logo.png` (white FRONTL1NE lettering + red pulse line and "1", transparent background; the background alpha has faint 1–2 noise, so threshold it when cropping). Make it a glowing hologram projected from the hub: light beam/projector base, red/white glow, scanlines, subtle flicker or glitch slices, gentle float; crisp, not blurry; static under reduced motion / low power. Bundle a cropped copy in the app (works offline).

## Blocked

## Done

- 2026-10-26 ECO-21: Completed the section 17 pass below in Orca (799px) and desktop Chromium (1440px), compared against the reference. Fixed decoration collision footprints, single-click inspection versus double-click focus, overlapping scene notices, and actionable graphics-failure fallback. 133 files / 671 tests pass, including accessible inspection without WebGL; browser assertions cover click/focus, fullscreen and isolated simulation. Screenshots: .agent/eco-21-*.png. No real credentials or paid model calls used.

### Section 17 acceptance — 2026-10-26

| Criterion | Result and evidence |
|---|---|
| Existing dashboard unchanged | Pass: ecosystem only adds its route/nav integration; existing Command Center reopened with store cards, charts, requests and agent controls. `.agent/eco-21-dashboard.png`. |
| Functional AI Ecosystem page | Pass: `/ecosystem`, cards, all five views, settings, deployments, quick assignment and missions exercised. |
| Interactive isometric office | Pass: ten departments, thirty workstations, cached pixel map and animated globe; pan, zoom, department jump, reset and fullscreen entry/exit checked. |
| Up to thirty distinct deployed workers | Pass: backend capacity/uniqueness tests fill all thirty slots and reject overflow; demo displays 30/30. |
| Selectable character for every agent | Pass: thirty distinct demo profiles opened from the directory; clicking Nova's actual sprite opens her profile; double-click focuses at 125% without opening a modal. |
| Collision-aware movement | Pass: thirty-worker path/occupancy, every-department visits and eight-participant gather/return tests; decoration footprints now blocked. Entry and meeting motion visible in browser. |
| Visible work at assigned desks | Pass: varied work/tool/idle poses observed at desks in the thirty-worker demo and real-provider scene. |
| Click workers to inspect current tasks | Pass: Nova profile shows actual execution state, task, tool, recent activity, permissions, engine and history. |
| Assign real tasks from office | Pass: office-created run `fa764678-80a4-4b89-9eb2-aa52aa6b1a8c` completed through the existing fake-store engine; its output link opened the existing chat transcript. |
| Activity drives character animations | Pass: live adapter and transition tests cover queued/running/tool/approval/error/completion/offline; demo exercises the same animation input. |
| Visible handoff communications | Pass: completed real copywriter-to-analyst mission produced the handoff in ECO-13; recent handoffs show visits, bubble, connection and output history. |
| Meetings represent multi-agent workflows | Pass: actual six-role mission and completed two-role mission shown in mission panel; demo kickoff visibly gathered workers around the globe (`eco-21-demo-fit.png`). Blocked runs remain visibly blocked. |
| Real live activity and statistics | Pass: post-task cards matched backend totals: 6 seats, 0 active tasks, 10 completed/4 failed (71%), 0 active teams; current output and historical handoffs appear in feed. |
| Clearly separated Demo Mode | Pass: explicit banner/data/profile labels; simulated instruction completed with zero API mutations observed; returning to live restored six real seats. |
| Identities and positions survive restart | Pass: controlled worktree API process restart preserved all six seats' IDs, desks, names, appearances and saved positions exactly; reconnect restored Nova's profile. |
| Responsive with thirty characters | Pass: 58.04 FPS standard and 29.53 FPS low-power measured in ECO-20; desktop controls and all thirty profiles remain responsive. Orca itself throttles animation callbacks. |
| Existing features preserved | Pass: dashboard, agent chat/output and configuration/history navigation reuse existing pages/endpoints; full workspace typecheck and tests green. |

Verification limits: live integrations and paid Claude execution were deliberately not used; model orchestration was checked with the existing free fake-store engine. Frame rate is measured on this workstation, with an explicit low-power mode for slower hardware.

- 2026-10-26 ECO-09 Inbox: Profile shows authoritative all-run AI spend since local midnight and the daily cap when configured, separately from recent history cost. Regression checks a $4.50 daily total alongside a $0.12 recent run. Orca Nova profile verified (.agent/eco-09-daily-spend.png); 132 files / 668 tests pass.

- 2026-10-26 ECO-20: Thirty workers measured 58.04 FPS (586 rendered frames / 10.097 s) at 1440x1000 in the unthrottled desktop browser; low-power measured 29.53 FPS with reduced-motion enabled. One shared character atlas, cached map, viewport culling, zoom-dependent text, 60/30 FPS caps, hidden-tab suspension and automatic low-power fallback. Motion catches up throttled frames in bounded collision-safe steps; React only samples metrics once a second. Orca and desktop screenshots .agent/eco-20-*.png inspected against reference; 131 files / 664 tests pass. Acknowledged core migration 38; no new migration needed.

- 2026-10-26 ECO-19: Trophy cabinet computes seven milestones from real seats and all-time task/mission/handoff counts. Full capacity is recorded in the existing once-only ledger during deployment and survives archive; no new XP awards or agent system. Profiles reuse the house XP bar and actual engine rank/progress. Browser cabinet verified 4/7 earned (.agent/eco-19-trophies.png); mission-success, historical-full-capacity and threshold tests. 131 files / 662 tests pass.

- 2026-10-26 ECO-18: Existing workers can edit persistent names, desks and sprite appearance; occupied desks are excluded and backend conflicts retained. Three data-driven desk/floor/wall/plant/rail palettes plus a ten-department decor catalog add distinct conference, product, chart, library, mail, rack and studio props without moving geometry. Browser saved Nova's suit/glasses and reloaded the Midnight theme (.agent/eco-18-midnight.png). 129 files / 656 tests pass.

- 2026-10-26 ECO-17: Isolated local 30-worker provider covers work/tool/approval/error/offline/completion, entry motion, meetings and real-shaped simulated handoffs. Clear banner/data labels and separate demo profile/task form; production office subscriptions, seat/stat polling and position writes stop in demo. Example links stay in preview panels. Browser simulated task completed and switching back restored 6 saved workers (.agent/eco-17-*.png). Isolation/no-POST and scenario tests; 128 files / 652 tests pass.

- 2026-10-26 ECO-16: Bottom bar exposes Quick Assign, deployment, teams, settings, live capacity/jobs and status key. Six independent display switches persist locally; approval/error bubbles and workload labels reflect actual state. Browser hide/reload/restore and Quick Assign→composer verified (.agent/eco-16-*.png). Preferences validation/accessibility tests; pnpm check 126 files / 651 tests pass.

- 2026-10-26 ECO-15: Department occupancy and worker selection, searchable deployed roster with portraits, real status/approval task columns, all-time usage totals and clearly scoped recent per-agent performance. Existing output/history routes reused. All four tabs checked in Orca (.agent/eco-15-*.png); roster navigation and terminal-state/approval classification tests. pnpm check 125 files / 647 tests pass.

- 2026-10-26 ECO-14: Create Team uses existing squad templates/store agents and real task dependencies. Mission panel shows assigned roles, stages, pending/completed/blocked work, deliverables and handoff history. Fresh missions gather deployed participants at unique hub positions, show objective, then return to desks before queued handoff visits. Browser launched six-role Glow mission and inspected kickoff/status/output (.agent/eco-14-*.png); eight-worker gather/return simulation and API UI tests pass. pnpm check 124 files / 643 tests green.

- 2026-10-26 ECO-13: Recent real parent/child handoffs trigger a collision-aware visit to a free receiving-desk tile, actual brief bubble, connection line and collaboration pose; sender returns after delivery. Replayed IDs do not restart visits; old events remain history only. Browser two-step Glow mission completed with visible copywriter→analyst handoff (.agent/eco-13-handoff.png); communication history links receiving output. 122 files / 641 tests pass, including all-department visit targets and dwell expiry.

- 2026-10-26 ECO-12: Real all-time run totals and active mission counts via read-only stats API; labelled success denominator excludes cancelled/unfinished runs. Feed shows actual outputs/tools/approvals/handoffs/mission progress, focuses seated agents and links runs. Mission snapshots reject regressed steps; 214-run aggregation and feed navigation tests. Browser cards/feed/focus inspected (.agent/eco-12*.png); pnpm check 121 files / 635 tests pass.

- 2026-10-26 ECO-11: Deploy dialog selects existing specialists with inherited engine/permissions, available desks, name and six appearance controls with live portrait. Archived workers restore identity; full office is blocked. Browser deployed Redline at advertising-1 then archived it, counter 4→5→4 and preserved seat record verified (.agent/eco-11.png). 119 files / 631 tests pass, including conflict recovery and capacity.

- 2026-10-26 ECO-10: Inline task composer reuses run creation/detail hooks, preserves failed instructions and shows queued/running/completed/failed/cancelled/approval states with output links. Browser Copywriter task completed at $0 (.agent/eco-10.png); validation/error/approval tests and pnpm check pass (118 files / 626 tests).

- 2026-10-26 ECO-09: Select worker/desk to open an accessible profile drawer with pixel portrait, real model/provider, live status/tool/task, latest-50-run usage and output links. Existing chat/settings/history routes and pause/resume/cancel endpoints reused; camera focuses the worker's current position. Browser Product Hunter profile verified (.agent/eco-09.png); 117 files / 622 tests pass. Compact inline assignment follows in ECO-10.

- 2026-10-26 ECO-08: Typed office events over existing runs/tools/approvals/parent links; REST + active transcripts restore state, WebSocket reconnects, terminal states and approval decisions reject stale regressions, tool IDs deduplicate late/replayed messages. Real status drives poses, tint and selected-worker text. Fake-store Product Hunter run completed through existing backend at $0; Orca .agent/eco-08.png inspected. 115 files / 615 tests pass.

- 2026-10-26 ECO-07: Cached A* routes, current/next-tile reservations, separate motion simulation, entry walk, arbitrary walkable destinations and saved arrival positions outside rendering. All 30 workers reach desks without overlap in simulation; browser entry movement and Copywriter arrival persistence verified (.agent/eco-07*.png). pnpm check 113 files / 608 tests pass. Orca browser rAF itself measured ~1 FPS (30 callbacks / 29.5 s); ECO-20 needs an unthrottled browser for meaningful renderer FPS. Acknowledged agents Inbox: mission dependencies and engine identity now available for ECO-09/14.

- 2026-10-26 ECO-06: Original pixel workers share one packed atlas (ten poses, four directions, four frames); deterministic hair/skin/outfit/accessory variations, completion-to-sitting transition, selectable sprites and persistent seat loading. Browser checked four fake-store workers and atlas (.agent/eco-06*.png); 111 files / 600 tests pass. Movement and execution-driven poses follow in ECO-07/08.

- 2026-10-26 ECO-05: Smooth camera with pointer drag/capture, anchored wheel zoom, +/- and arrow keys, double-click focus, department jumps, fit/reset and fullscreen. Nearest-neighbor map sampling retained. Orca department focus and fullscreen entry/exit verified; .agent/eco-05.png inspected. Camera anchor/limits tests; pnpm check 110 files / 599 tests pass. Worker focus will use the same focus method as workers arrive.

- 2026-10-26 ECO-04: PixiJS office with original cached pixel map art, ten distinct departments, thirty selectable desks, plants/studio/crates/rack props, holographic globe, blinking monitors and collision tiles. Accessible desk directory; narrow screens give the scene full width. Browser selection and .agent/eco-04.png compared against reference; 109 files / 597 tests pass. Detailed zoom and workers follow in ECO-05/06.

- 2026-10-26 ECO-03: Added migration 35, shared ten-department/30-desk catalog and validated list/deploy/update/archive API with a unique active-desk index. Tests fill capacity, reject conflicts/invalid inputs, reopen a file database and preserve agent/run history on archive. Browser GET /api/ecosystem/seats verified; pnpm check 108 files / 593 tests pass.

- 2026-10-26 ECO-02: Added /ecosystem with scoped charcoal/red styling, four truthful placeholder cards, accessible tabs, collapsible activity and status bar; existing nav indices preserved. Orca screenshot .agent/eco-02.png compared with reference; tab interaction verified. pnpm check: 107 files / 588 tests pass (six workers to avoid resource-contention timeouts).

- 2026-10-26 ECO-01: Read the spec, reference, design and app. Reuse GET /api/agents, /api/runs (parentRunId links actual delegated tasks), /api/runs/:id transcripts, /api/approvals and /api/live run/run_event/approval/xp messages; task/chat/cancel/configure use existing agent endpoints and detail links. flows.ts is email/SMS drafts, not orchestration: existing assign_task supports up to three children, no chained dependencies. Asked agents lane for richer missions; office can visualize real parent/child groups meanwhile. Model configuration is not exposed. Baseline pnpm check: 106 files / 585 tests pass. Keep NAV[1] as AI Agents (AgentDetail reads it positionally).

## When you're done
Once every item above is ticked and the spec §17 acceptance pass holds, write the result under **Done**, push, then
create an empty `.agent/STOP` file in your worktree (not in git) and stop.
