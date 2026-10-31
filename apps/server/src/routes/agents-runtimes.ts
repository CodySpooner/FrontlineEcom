import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { claudeAccount, claudeRuntime, codexEngine, codexSetup, codexStatus, engineInfo } from '@frontline/agents';
import { codexRegistryModels, RUNTIME_REGISTRY } from '@frontline/shared';
import type { ClaudeAccount, RuntimeCapabilities } from '@frontline/shared';
import { dataDir } from '../db';

/** Real runs start in their own folder, so their Claude Code sessions stay out of the owner's projects (`claude --resume`). */
export const agentSessions = () => {
  const cwd = resolve(dataDir(), 'agent-sessions');
  mkdirSync(cwd, { recursive: true });
  return { cwd };
};

const DEMO_ONLY = 'Agents are set to the demo engine here (FRONTLINE_AGENT_ENGINE), so Claude is never used.';

// The Claude login and its models: the Integrations card, GET /api/runtimes and validateConfig.
// ponytail: one answer per process, kept 5 minutes (each check starts the CLI, no model turn).
let account: { at: number; answer: Promise<ClaudeAccount> } | undefined;

export function claudeLogin(refresh = false): Promise<ClaudeAccount> {
  if (engineInfo(true).provider !== 'claude') return Promise.resolve({ signedIn: false, forced: true, checkedAt: new Date().toISOString(), error: DEMO_ONLY });
  if (!account || refresh || Date.now() - account.at > 5 * 60_000) account = { at: Date.now(), answer: claudeAccount(agentSessions().cwd) };
  return account.answer;
}

/** What each runtime can run here (GET /api/runtimes), and what a config is checked against before anything is queued. */
export async function runtimes(refresh = false): Promise<RuntimeCapabilities[]> {
  const [login, codex] = await Promise.all([claudeLogin(refresh), codexLogin(refresh)]);
  return [claudeRuntime(login, login.error === DEMO_ONLY ? DEMO_ONLY : undefined), codex];
}

/** The app's own CODEX_HOME (decision 9): its Codex sign-in, apart from the owner's ~/.codex. */
export const codexHome = () => {
  const home = resolve(dataDir(), 'codex-home');
  mkdirSync(home, { recursive: true });
  return home;
};

// ponytail: like Claude's, one answer per process for 5 minutes (each check starts the CLI a few times, no model turn).
let codex: { at: number; answer: Promise<RuntimeCapabilities> } | undefined;

/** Codex's row: installed, signed in to the app's CODEX_HOME, its catalog. Never spawned while agents are forced to an engine (tests). */
export function codexLogin(refresh = false): Promise<RuntimeCapabilities> {
  if (process.env.FRONTLINE_AGENT_ENGINE || process.env.VITEST) {
    return Promise.resolve({ runtime: 'codex', connected: false, reason: DEMO_ONLY.replace('Claude', 'Codex'), models: codexRegistryModels(), source: 'registry', registryVersion: RUNTIME_REGISTRY.version, checkedAt: new Date().toISOString() });
  }
  if (!codex || refresh || Date.now() - codex.at > 5 * 60_000) codex = { at: Date.now(), answer: codexStatus(codexHome()) };
  return codex.answer;
}

/** "Set up Codex": `codex login` on the app's CODEX_HOME; the owner signs in in the browser it opens. The next check reads it. */
export function setUpCodex() {
  codexSetup(codexHome(), undefined, () => (codex = undefined));
}

let apiPort = Number(process.env.API_PORT) || 8787;
/** Told the port the API listens on (0 picks one), for the address Codex runs reach the app's tools at. */
export const listeningOn = (port: number) => (apiPort = port);

/** The engine Codex conversations run on: the app's CODEX_HOME, the MCP endpoint on this API, the CLI version from the status check. */
export const appCodexEngine = () => codexEngine({ home: codexHome(), mcpUrl: () => `http://127.0.0.1:${apiPort}/api/codex/mcp`, version: async () => (await codexLogin()).version });
