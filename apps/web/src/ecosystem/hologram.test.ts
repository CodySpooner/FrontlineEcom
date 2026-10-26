import { expect, test } from 'vitest';
import { hologramPose } from './hologram';

test('logo projection floats and flickers gently, and reduced motion is entirely static', () => {
  const still = hologramPose(0, true);
  let glitched = false;
  for (let elapsed = 0; elapsed < 30_000; elapsed += 30) {
    const pose = hologramPose(elapsed, false);
    expect(Math.abs(pose.lift)).toBeLessThanOrEqual(3);
    expect(pose.opacity).toBeGreaterThan(.9);
    expect(pose.opacity).toBeLessThan(1);
    expect([0, 3]).toContain(pose.glitch);
    glitched ||= pose.glitch !== 0;
    expect(hologramPose(elapsed, true)).toEqual(still);
  }
  expect(glitched).toBe(true);
  expect(hologramPose(1500, false)).not.toEqual(hologramPose(0, false));
});
