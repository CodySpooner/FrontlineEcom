import { settingsUrl, type StoreCaps } from '@frontline/shared';

/** Share of a daily cap used so far, 0–1. A zero cap counts as full once anything is used. */
export const usedShare = (used: number, cap: number) => (cap > 0 ? Math.min(1, used / cap) : used > 0 ? 1 : 0);

const FROM = { store: 'Set for this store', workspace: 'Workspace default', default: 'Built-in default' } as const;
type CapKey = keyof NonNullable<StoreCaps['origins']>;
/** Where a store's cap comes from, said as its readers show it, with the link to where it's edited (decision 10). */
export function capFrom(caps: StoreCaps, key: CapKey) {
  const o = caps.origins?.[key];
  if (o !== 'store' && o !== 'workspace' && o !== 'default') return undefined;
  return { text: FROM[o], to: settingsUrl(key === 'agentCostPerDay' ? 'agents' : 'usage', { store: caps.storeId, setting: `caps.${key}` }) };
}

/** Where a run refused or stopped by a daily AI budget (the agents lane's fixed "Raise it in …" endings) gets lifted, or a signed-out login gets fixed. */
export function budgetFix(message: string, agentId: string) {
  if (message.endsWith('Raise it in its settings.')) return { to: `/agents/${encodeURIComponent(agentId)}?tab=settings`, label: "Raise the agent's budget" };
  if (message.endsWith('Raise it in Settings.')) return { to: settingsUrl('agents', { store: agentId.split(':')[0], setting: 'caps.agentCostPerDay' }), label: "Raise the store's AI cap" };
  // claude-engine.ts ACCOUNT's words; Agents & Providers' Claude row checks the login again.
  if (message.startsWith("Claude isn't signed in")) return { to: settingsUrl('agents'), label: 'Check your Claude login' };
  // agents' runs.start: the owner switched the agent off (its Deployed switch is on the settings tab).
  if (message.startsWith('This agent is offline')) return { to: `/agents/${encodeURIComponent(agentId)}?tab=settings`, label: 'Redeploy it' };
}
