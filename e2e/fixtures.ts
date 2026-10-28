import { test as base, expect } from '@playwright/test';

export const test = base.extend({
  baseURL: async ({}, use) => { await use(process.env.FRONTLINE_E2E_URL); },
  context: async ({ context, baseURL }, use) => {
    await context.route('**/*', (route) => new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort());
    await context.addInitScript(() => localStorage.setItem('frontline:onboarded', '1'));
    await use(context);
  },
});
export { expect };
