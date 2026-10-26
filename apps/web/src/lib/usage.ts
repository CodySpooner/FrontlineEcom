import type { AgentRun } from '@frontline/shared';

/** Share of a daily cap used so far, 0–1. A zero cap counts as full once anything is used. */
export const usedShare = (used: number, cap: number) => (cap > 0 ? Math.min(1, used / cap) : used > 0 ? 1 : 0);

/** What these runs cost since local midnight: the window an agent's own daily budget is checked against (same machine as the API).
 * ponytail: callers pass the 50 newest runs, so more than 50 today reads low; agents inbox asks for the exact figure on Agent. */
export function spentToday(runs: Pick<AgentRun, 'createdAt' | 'usage'>[], now = new Date()) {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return runs.reduce((sum, r) => (Date.parse(r.createdAt) >= midnight ? sum + r.usage.costUsd : sum), 0);
}

/** Where a run refused or stopped by a daily AI budget (the agents lane's fixed "Raise it in …" endings) gets lifted. */
export function budgetFix(message: string, agentId: string) {
  if (message.endsWith('Raise it in its settings.')) return { to: `/agents/${encodeURIComponent(agentId)}?tab=settings`, label: "Raise the agent's budget" };
  if (message.endsWith('Raise it in Settings.')) return { to: '/settings', label: "Raise the store's AI cap" };
}
