import { test, expect } from './fixtures';
import { routes, widths } from './routes';

for (const width of widths) {
  for (const route of routes) {
    test(`${route.name} at ${width}px`, async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('response', (response) => {
        if (new URL(response.url()).pathname.startsWith('/api/') && response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
      });
      await page.setViewportSize({ width, height: 900 });
      const response = await page.goto(route.url());
      expect(response?.ok()).toBe(true);
      await expect(page.getByRole('heading', { level: 1, name: new RegExp(`^${route.title}$`, 'i') })).toBeVisible();
      await page.waitForLoadState('networkidle');
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'This page hit a snag' })).toHaveCount(0);
      expect.soft(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 'horizontal overflow').toBeLessThanOrEqual(1);
      expect.soft(errors, 'console/page/API errors').toEqual([]);
    });
  }
}
