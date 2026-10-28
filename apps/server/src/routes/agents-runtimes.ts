import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { claudeAccount, claudeRuntime, engineInfo } from '@frontline/agents';
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
  if (engineInfo(true).provider !== 'claude') return Promise.resolve({ signedIn: false, checkedAt: new Date().toISOString(), error: DEMO_ONLY });
  if (!account || refresh || Date.now() - account.at > 5 * 60_000) account = { at: Date.now(), answer: claudeAccount(agentSessions().cwd) };
  return account.answer;
}

/** What each runtime can run here (GET /api/runtimes), and what a config is checked against before anything is queued. */
export async function runtimes(refresh = false): Promise<RuntimeCapabilities[]> {
  const login = await claudeLogin(refresh);
  return [claudeRuntime(login, login.error === DEMO_ONLY ? DEMO_ONLY : undefined)];
}
