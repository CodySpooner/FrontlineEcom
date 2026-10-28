import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/setup.ts',
  workers: 1,
  retries: 0,
  use: { channel: 'msedge', headless: true, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
