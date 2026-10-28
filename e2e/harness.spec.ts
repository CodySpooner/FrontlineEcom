import { test, expect } from './fixtures';

test('the isolated real server serves the built app and fake agents', async ({ page, request }) => {
  const agents = await request.get('/api/agents');
  expect(agents.ok()).toBe(true);
  expect((await agents.json()).every((agent: { engine: { provider: string } }) => agent.engine.provider === 'demo')).toBe(true);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Command Center', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
});
