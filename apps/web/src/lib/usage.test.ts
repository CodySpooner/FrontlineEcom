import { describe, expect, it } from 'vitest';
import { usedShare } from './usage';

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
