import { test, expect } from './fixtures';

test.use({ viewport: { width: 1440, height: 900 } });

test('flow: approve a seeded request', async ({ page, request }) => {
  const approvals = await (await request.get('/api/approvals?status=pending')).json();
  const approval = approvals.find((a: { action: { kind: string } }) => a.action.kind === 'ads.pause_campaign');
  expect(approval).toBeTruthy();
  await page.goto('/');
  const response = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/approvals/${approval.id}/approve` && r.request().method() === 'POST');
  await page.getByRole('button', { name: `Approve: ${approval.title}`, exact: true }).click();
  expect((await response).ok()).toBe(true);
  await expect(page.getByRole('button', { name: `Approve: ${approval.title}`, exact: true })).toHaveCount(0);
  expect(await (await request.get('/api/approvals?status=approved')).json()).toContainEqual(expect.objectContaining({ id: approval.id, status: 'approved' }));
});

test('flow: message an agent and see the fake reply', async ({ page }) => {
  const { conversation } = JSON.parse(process.env.FRONTLINE_E2E_IDS!);
  await page.goto(`/agents/c/${conversation}?store=glow`);
  const message = 'Suggest a second short headline for the browser check.';
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(message);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const turn = page.getByRole('article', { name: `Turn: ${message}`, exact: true });
  await expect(turn).toContainText('Copywriter for Glow Haus: on it');
  await expect(turn).toContainText('Demo engine: switch to Claude for a real answer.');
});

test('flow: open a Knowledge Base card', async ({ page }) => {
  await page.goto('/knowledge?ws=general');
  await page.getByRole('button', { name: /Browser evidence card/ }).click();
  await expect(page.getByRole('heading', { name: 'Browser evidence card', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit card', exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`card=${JSON.parse(process.env.FRONTLINE_E2E_IDS!).card}`));
});

test('flow: open a Research product', async ({ page }) => {
  await page.goto('/research');
  await page.getByRole('article', { name: 'silicone grooming brush', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Product details', exact: true });
  await expect(panel.getByRole('heading', { name: 'silicone grooming brush', exact: true })).toBeVisible();
  await expect(panel.getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(panel).toContainText('Test fixture');
});
