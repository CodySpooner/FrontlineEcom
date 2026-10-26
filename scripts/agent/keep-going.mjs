// Stop hook for the unattended Frontline workers (wired up only in each worker worktree's
// .claude/settings.local.json). It refuses to let the agent end its turn and points it back at
// the worker loop in CLAUDE.md, so the worker keeps building until a human stops it.
//   usage: node scripts/agent/keep-going.mjs <lane> <main-repo-path>
// Kill switches: <worktree>/.agent/STOP stops this worker; <main-repo>/.agent/STOP stops all of them.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [lane, mainRepo] = process.argv.slice(2);
const worktree = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const stopped = [worktree, mainRepo].some((dir) => dir && existsSync(join(dir, '.agent', 'STOP')));

if (lane && !stopped) {
  process.stdout.write(
    JSON.stringify({
      decision: 'block',
      reason:
        `You are the unattended "${lane}" worker and the owner is away: do not stop, do not wait for a reply. ` +
        `Continue the Worker loop in CLAUDE.md: sync with origin/main, take the next item from docs/backlog/${lane}.md, ` +
        `build it, verify with pnpm check, push. If your backlog is empty, add new items from the gap between the app ` +
        `and docs/DESIGN.md, then keep going.`,
    }),
  );
}
