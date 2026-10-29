import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './fixtures';
import { routes } from './routes';

for (const route of routes) {
  test(`accessibility ${route.name}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(route.url());
    await expect(page.getByRole('heading', { level: 1, name: new RegExp(`^${route.title}$`, 'i') })).toBeVisible();
    await page.waitForLoadState('networkidle');
    const result = await new AxeBuilder({ page }).analyze();
    await info.attach('axe', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
    const violations = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => ({
      id: v.id, impact: v.impact, targets: v.nodes.map((n) => n.target).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    })).sort((a, b) => a.id.localeCompare(b.id));
    const name = route.name.replace(/\W+/g, '-').replace(/^-|-$/g, '') || 'dashboard';
    expect(JSON.stringify(violations, null, 2)).toMatchSnapshot(`${name}.json`);
  });
}
