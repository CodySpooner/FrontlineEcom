import { expect, test } from 'vitest';
import { lightStrength } from './lighting';

test('ambient drift is gentle and freezes for reduced motion and low power', () => {
  for (let t = 0; t < 30000; t += 157) for (let i = 0; i < 10; i++) {
    expect(lightStrength(t, i, true)).toBe(1);
    expect(lightStrength(t, i, false)).toBeGreaterThanOrEqual(.88);
    expect(lightStrength(t, i, false)).toBeLessThanOrEqual(1.12);
  }
});
