import { describe, expect, it } from 'vitest';
import { ago, cents, day, money, noBaseline, shortMoney, signedPct } from './format';

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
  it('formats other currencies', () => {
    expect(money(24532.4, 'EUR')).toBe('€24,532');
    expect(money(-5, 'GBP')).toBe('−£5');
    expect(cents(41.5, 'CAD')).toBe('CA$41.50');
    expect(shortMoney(4500, 'EUR')).toBe('€4.5K');
  });
  it('signs deltas', () => {
    expect(signedPct(18.44)).toBe('+18.4%');
    expect(signedPct(-8.1)).toBe('−8.1%');
    expect(signedPct(-0.04)).toBe('+0.0%');
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

describe('noBaseline', () => {
  it('flags a change measured against an empty previous period', () => {
    expect(noBaseline(0, 974)).toBe(true);
    expect(noBaseline(0, 0)).toBe(false);
    expect(noBaseline(500, 974)).toBe(false);
  });
});
