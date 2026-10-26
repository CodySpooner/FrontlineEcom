import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/*/src/**/*.test.{ts,tsx}', 'packages/*/src/**/*.test.{ts,tsx}'],
    // Never the owner's Claude usage from tests, even for stores a test marks connected.
    env: { FRONTLINE_AGENT_ENGINE: 'fake' },
  },
});
