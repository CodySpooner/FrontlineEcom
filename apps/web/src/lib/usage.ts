import type { AgentRun } from '@frontline/shared';

/** Share of a daily cap used so far, 0–1. A zero cap counts as full once anything is used. */
export const usedShare = (used: number, cap: number) => (cap > 0 ? Math.min(1, used / cap) : used > 0 ? 1 : 0);

/** What these runs cost since local midnight: the window an agent's own daily budget is checked against (same machine as the API). */
export function spentToday(runs: Pick<AgentRun, 'createdAt' | 'usage'>[], now = new Date()) {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return runs.reduce((sum, r) => (Date.parse(r.createdAt) >= midnight ? sum + r.usage.costUsd : sum), 0);
}
