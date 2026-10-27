// Watchdog for the unattended Frontline workers. Every few minutes it checks each worker worktree in Orca:
// an agent that has sat idle (usage limit, crash, error) gets a nudge to continue the worker loop, and a worktree
// with no live agent of its lane's kind gets a fresh one. For Claude lanes the Stop hook (keep-going.mjs) handles the
// normal case; Codex has no Stop hook, so its lane relies on this (short idle threshold). Run it in an Orca terminal in the main repo:
//   node scripts/agent/watchdog.mjs            (loop forever)
//   node scripts/agent/watchdog.mjs --once --dry   (one pass, print what it would do)
// Stops when C:/dev/FrontlineEcom/.agent/STOP exists; skips a worker whose <worktree>/.agent/STOP exists.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const MAIN = 'C:/dev/FrontlineEcom';
const WORKSPACES = 'C:/Users/Xody2/orca/workspaces/FrontlineEcom';
const LANES = { ui: 'claude', core: 'claude', agents: 'claude', ecosystem: 'codex', 'image-generation': 'codex' };
const EVERY_MS = 2 * 60_000;
const IDLE_MS = { claude: 10 * 60_000, codex: 2 * 60_000 };
const once = process.argv.includes('--once');
const dry = process.argv.includes('--dry');

const orca = (...args) => JSON.parse(execFileSync('orca', [...args, '--json'], { encoding: 'utf8' })).result;
const log = (msg) => console.log(`${new Date().toLocaleString()}  ${msg}`);
const stopped = (dir) => existsSync(join(dir, '.agent', 'STOP'));
const act = (what, ...args) => (dry ? log(`[dry] ${what}`) : (log(what), orca(...args)));

const nudge = (lane) =>
  `Watchdog: you went idle. Keep going: continue the Worker loop in CLAUDE.md with the next item in docs/backlog/${lane}.md. Do not stop and do not ask questions.`;
const brief = (lane) =>
  `You are the Frontline Ecom "${lane}" worker, restarted by the watchdog. One of the agents building this app in Orca (lanes: ${Object.keys(LANES).join(', ')}). The owner is away: do not ask questions, keep working nonstop. Read CLAUDE.md and docs/backlog/${lane}.md, check git log for what you already shipped, then continue the Worker loop.`;

function check() {
  const worktrees = orca('worktree', 'ps').worktrees;
  for (const [lane, kind] of Object.entries(LANES)) {
    const path = `${WORKSPACES}/${lane}`;
    if (stopped(path)) continue;
    const wt = worktrees.find((w) => w.path === path);
    if (!wt) {
      log(`${lane}: worktree not found in Orca, skipping`);
      continue;
    }
    const terminal = orca('terminal', 'list', '--worktree', `id:${wt.worktreeId}`).terminals?.find((t) => t.agentIdentity === kind);
    const agent = wt.agents?.find((a) => a.agentType === kind);
    if (!terminal) {
      act(`${lane}: no ${kind} terminal, launching a new worker`, 'agent', 'launch', '--agent', kind, '--surface', 'terminal', '--worktree', `id:${wt.worktreeId}`, '--prompt', brief(lane));
    } else if (agent && agent.state !== 'working' && Date.now() - (agent.stateStartedAt ?? 0) > IDLE_MS[kind]) {
      act(`${lane}: idle (${agent.state}) for ${Math.round((Date.now() - agent.stateStartedAt) / 60_000)} min, nudging`, 'terminal', 'send', '--terminal', terminal.handle, '--text', nudge(lane), '--enter');
    } else {
      log(`${lane}: ${agent?.state ?? 'unknown'}`);
    }
  }
}

do {
  if (stopped(MAIN)) {
    log('STOP file found, watchdog exiting');
    break;
  }
  try {
    check();
  } catch (err) {
    log(`check failed: ${err.message}`); // keep watching; Orca may be restarting
  }
  if (!once) await new Promise((r) => setTimeout(r, EVERY_MS));
} while (!once);
