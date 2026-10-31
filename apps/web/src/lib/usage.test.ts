import { describe, expect, it } from 'vitest';
import type { StoreCaps } from '@frontline/shared';
import { budgetFix, capFrom, usedShare } from './usage';

describe('usedShare', () => {
  it('is used over cap, capped at 1', () => {
    expect(usedShare(1.25, 5)).toBe(0.25);
    expect(usedShare(240, 200)).toBe(1);
  });
  it('treats a zero cap as full once anything is used', () => {
    expect(usedShare(0, 0)).toBe(0);
    expect(usedShare(0.01, 0)).toBe(1);
  });
});

describe('budgetFix', () => {
  it("points a budget refusal at the setting that lifts it", () => {
    expect(budgetFix("Today's budget for this agent ($0.3) is used up. Raise it in its settings.", 'glow:copywriter')).toEqual({ to: '/agents/glow%3Acopywriter?tab=settings', label: "Raise the agent's budget" });
    expect(budgetFix("Stopped: today's AI budget for this store ($5) is used up. Raise it in Settings.", 'glow:copywriter')).toEqual({ to: '/settings/agents?store=glow#caps.agentCostPerDay', label: "Raise the store's AI cap" });
    expect(budgetFix("Claude isn't signed in on this computer. Open a terminal, run `claude`, sign in with /login, then run the agent again.", 'glow:copywriter')).toEqual({
      to: '/settings/agents',
      label: 'Check your Claude login',
    });
    // Ask AI, AI Research and the briefs can reach an agent the owner switched off.
    expect(budgetFix('This agent is offline. Redeploy it first.', 'glow:market_analyst')).toEqual({ to: '/agents/glow%3Amarket_analyst?tab=settings', label: 'Redeploy it' });
    expect(budgetFix('Run ended without a result', 'glow:copywriter')).toBeUndefined();
  });
});

describe('capFrom', () => {
  it("says where each cap comes from and links to where it's edited", () => {
    const caps = { storeId: 'glow', adSpendChangePerDay: 100, higgsfieldCreditsPerDay: 200, agentCostPerDay: 8, autopilot: {}, origins: { agentCostPerDay: 'store', higgsfieldCreditsPerDay: 'workspace', adSpendChangePerDay: 'default' } } as StoreCaps;
    expect(capFrom(caps, 'agentCostPerDay')).toEqual({ text: 'Set for this store', to: '/settings/agents?store=glow#caps.agentCostPerDay' });
    expect(capFrom(caps, 'higgsfieldCreditsPerDay')).toEqual({ text: 'Workspace default', to: '/settings/usage?store=glow#caps.higgsfieldCreditsPerDay' });
    expect(capFrom(caps, 'adSpendChangePerDay')?.text).toBe('Built-in default');
    expect(capFrom({ ...caps, origins: undefined }, 'agentCostPerDay')).toBeUndefined(); // nothing said rather than a guess
  });
});
