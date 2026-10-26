import { describe, expect, it } from 'vitest';
import { ago, money, pctChange, shortMoney, signedPct, day } from './format';

describe('format', () => {
  it('formats money with a real minus sign for losses', () => {
    expect(money(24532.4)).toBe('$24,532');
    expect(money(-1200.6)).toBe('−$1,201');
  });
  it('shortens axis money', () => {
    expect(shortMoney(850)).toBe('$850');
    expect(shortMoney(4500)).toBe('$4.5K');
    expect(shortMoney(3000)).toBe('$3K');
    expect(shortMoney(1_250_000)).toBe('$1.3M');
  });
  it('computes deltas vs the previous period', () => {
    expect(pctChange(120, 100)).toBeCloseTo(20);
    expect(pctChange(-50, -100)).toBeCloseTo(50); // loss halved = improvement
    expect(pctChange(10, 0)).toBe(0);
    expect(signedPct(18.44)).toBe('+18.4%');
    expect(signedPct(-8.1)).toBe('−8.1%');
  });
  it('prints relative times', () => {
    const now = Date.parse('2026-10-26T12:00:00Z');
    expect(ago('2026-10-26T11:59:40Z', now)).toBe('just now');
    expect(ago('2026-10-26T11:58:00Z', now)).toBe('2 min ago');
    expect(ago('2026-10-26T09:00:00Z', now)).toBe('3 h ago');
    expect(ago('2026-10-22T12:00:00Z', now)).toBe('4 d ago');
  });
  it('parses YYYY-MM-DD as a local date', () => {
    expect(day('2026-10-26').getDate()).toBe(26);
  });
});
