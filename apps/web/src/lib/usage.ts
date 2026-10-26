/** Share of a daily cap used so far, 0–1. A zero cap counts as full once anything is used. */
export const usedShare = (used: number, cap: number) => (cap > 0 ? Math.min(1, used / cap) : used > 0 ? 1 : 0);

/** Where a run refused or stopped by a daily AI budget (the agents lane's fixed "Raise it in …" endings) gets lifted, or a signed-out login gets fixed. */
export function budgetFix(message: string, agentId: string) {
  if (message.endsWith('Raise it in its settings.')) return { to: `/agents/${encodeURIComponent(agentId)}?tab=settings`, label: "Raise the agent's budget" };
  if (message.endsWith('Raise it in Settings.')) return { to: '/settings', label: "Raise the store's AI cap" };
  // claude-engine.ts ACCOUNT's words; Integrations' Claude card checks the login again.
  if (message.startsWith("Claude isn't signed in")) return { to: '/integrations', label: 'Check your Claude login' };
}
