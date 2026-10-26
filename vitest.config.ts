import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/*/src/**/*.test.{ts,tsx}', 'packages/*/src/**/*.test.{ts,tsx}'],
    // Never the owner's Claude usage from tests, even for stores a test marks connected. Never a real data folder either
    // (its Knowledge Base edits would change what prompts say). ponytail: the temp folder is left to the OS to clear.
    env: { FRONTLINE_AGENT_ENGINE: 'fake', FRONTLINE_DATA_DIR: mkdtempSync(join(tmpdir(), 'frontline-test-')) },
  },
});
