# Frontline Ecom

A desktop command center for running multiple ecommerce stores with squads of AI agents — one squad per store, each
agent specialized in its job (ads, product research, store dev, creatives, analysis, copy, email/SMS, operations) and
trained on the store's platform and niche. Dark grey + red, gamified.

```
pnpm install
pnpm dev      # web on http://localhost:5173, API on :8787
pnpm check    # typecheck + tests
```

- What we're building: [docs/DESIGN.md](docs/DESIGN.md)
- Build order: [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md)
- Per-lane backlogs: [docs/backlog/](docs/backlog/)
- Rules for the AI workers: [CLAUDE.md](CLAUDE.md)

## The three Orca workers

Three Claude Code agents build this in parallel, each in its own Orca worktree
(`C:\Users\Xody2\orca\workspaces\FrontlineEcom\ui`, `\core`, `\agents`). A Stop hook (`scripts/agent/keep-going.mjs`,
enabled only in those worktrees' `.claude/settings.local.json`) keeps each one working, and `scripts/agent/watchdog.mjs`
(running in the "Watchdog" terminal of the main FrontlineEcom workspace in Orca) nudges any that go idle and relaunches
any that exit.

**To stop them:** create an empty file `C:\dev\FrontlineEcom\.agent\STOP` (stops all workers and the watchdog), or
`<worktree>\.agent\STOP` for one worker. Then press Esc in the worker's Orca terminal (or close it).
Delete the file to let them run again.
