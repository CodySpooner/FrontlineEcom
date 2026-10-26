import { describe, expect, it } from 'vitest';
import { budgetFix, spentToday, usedShare } from './usage';

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

describe('spentToday', () => {
  it("sums what an agent's runs cost since local midnight, as the server's budget check does", () => {
    const now = new Date(2026, 9, 26, 15, 0);
    const run = (h: number, costUsd: number, day = 26) => ({ createdAt: new Date(2026, 9, day, h).toISOString(), usage: { inputTokens: 0, outputTokens: 0, costUsd } });
    expect(spentToday([run(9, 0.12), run(14, 0.3), run(23, 5, 25)], now)).toBeCloseTo(0.42);
    expect(spentToday([], now)).toBe(0);
  });
});

describe('budgetFix', () => {
  it("points a budget refusal at the setting that lifts it", () => {
    expect(budgetFix("Today's budget for this agent ($0.3) is used up. Raise it in its settings.", 'glow:copywriter')).toEqual({ to: '/agents/glow%3Acopywriter?tab=settings', label: "Raise the agent's budget" });
    expect(budgetFix("Stopped: today's AI budget for this store ($5) is used up. Raise it in Settings.", 'glow:copywriter')).toEqual({ to: '/settings', label: "Raise the store's AI cap" });
    expect(budgetFix('Run ended without a result', 'glow:copywriter')).toBeUndefined();
  });
});
