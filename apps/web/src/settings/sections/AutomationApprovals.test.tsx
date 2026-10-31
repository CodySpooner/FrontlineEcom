// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { AutomationCancelled, AutomationRule, AutomationStatus, ConfigView, Store } from '@frontline/shared';
import { Automation } from '../../pages/Automation';
import { Settings } from '../../pages/Settings';
import { renderApp, stubApi } from '../../test-utils';

afterEach(() => (cleanup(), vi.unstubAllGlobals()));

const view = (paused: boolean): ConfigView => ({ values: { 'automation.paused': paused }, origins: {}, versions: { workspace: 7 } });
const RUNNING: AutomationStatus['running'] = [
  { runId: 'r1', ruleName: 'Daily brief', storeId: 'glow', storeName: 'Glow Haus', agentId: 'glow:market_analyst', status: 'running', startedAt: new Date().toISOString() },
  { runId: 'r2', ruleName: 'Low ROAS check', storeId: 'peak', storeName: 'Peak Fit', agentId: 'peak:ad_strategist', status: 'queued', startedAt: new Date().toISOString() },
];
const OUTCOMES: AutomationCancelled[] = [
  { runId: 'r1', ruleName: 'Daily brief', storeName: 'Glow Haus', status: 'cancelled', approvals: [{ id: 'a1', title: 'Set the serum to $24', status: 'pending' }], outcome: 'Stopped; its 1 request stays in Requests' },
  { runId: 'r2', ruleName: 'Low ROAS check', storeName: 'Peak Fit', status: 'done', approvals: [], outcome: 'Already finished' },
];
function server({ paused = false, running = RUNNING } = {}) {
  return stubApi((url, init) => {
    if (url === '/api/config/impact') return { impacts: [{ setting: 'automation.paused', text: 'Pauses 3 enabled rules across 2 stores and self-directed research in 1 store. 2 automation runs already going keep going.' }] };
    if (url === '/api/config' && init?.method === 'PATCH') return { ...view(true), versions: { workspace: 8 }, changes: [] };
    if (url === '/api/config') return view(paused);
    if (url === '/api/config/automation') return { paused, pausedAt: paused ? new Date(Date.now() - 2 * 3_600_000).toISOString() : null, running } satisfies AutomationStatus;
    if (url === '/api/config/automation/cancel-running') return { outcomes: OUTCOMES };
  });
}
const sent = (fetch: ReturnType<typeof server>, path: string) => fetch.mock.calls.filter(([u, i]) => u === path && i?.method === 'POST' || (u === path && i?.method === 'PATCH')).map(([, i]) => JSON.parse(String(i!.body)));

test('pausing saves automation.paused in the workspace document over the version read, after saying what it stops', async () => {
  const fetch = server();
  renderApp(<Settings />, '/settings/automation');
  const toggle = await screen.findByRole('switch', { name: 'Pause new automation' });
  expect(document.getElementById('automation.paused')!.textContent).toContain('Slots missed while paused are skipped, not caught up.');
  fireEvent.click(toggle);
  expect(await screen.findByText(/^Pauses 3 enabled rules across 2 stores/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(sent(fetch, '/api/config')).toEqual([{ documents: [{ doc: 'workspace', version: 7, set: { 'automation.paused': true } }] }]));
  expect(sent(fetch, '/api/config/impact').at(-1)).toEqual({ documents: [{ doc: 'workspace', version: 7, set: { 'automation.paused': true } }] });
});

test('Cancel running asks first, then lists what happened to each run and its requests', async () => {
  const fetch = server();
  renderApp(<Settings />, '/settings/automation');
  expect(await screen.findByText('Daily brief')).toBeTruthy();
  expect(screen.getByText(/^Peak Fit · waiting to start · started/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel running…' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/nothing it already changed is undone/)).toBeTruthy();
  expect(sent(fetch, '/api/config/automation/cancel-running')).toEqual([]);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel 2 runs' }));
  expect(await within(dialog).findByText('Stopped; its 1 request stays in Requests')).toBeTruthy();
  expect(within(dialog).getByText('Already finished')).toBeTruthy();
  expect(within(dialog).getByText('Set the serum to $24: waiting in Requests')).toBeTruthy();
  expect(sent(fetch, '/api/config/automation/cancel-running')).toEqual([{ runIds: ['r1', 'r2'] }]);
});

test('with nothing going there is nothing to cancel; while paused, the Automation page says so and links to resume', async () => {
  server({ paused: true, running: [] });
  renderApp(<Settings />, '/settings/automation');
  expect(await screen.findByText('None going now.')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Cancel running…' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('Paused 2 h ago.', { exact: false })).toBeTruthy();
  cleanup();
  server({ paused: true, running: [] });
  renderApp(<Automation />, '/automation');
  const banner = await screen.findByText('New automation is paused.');
  expect(within(banner.parentElement!).getByRole('link', { name: 'Resume in Settings' }).getAttribute('href')).toBe('/settings/automation#automation.paused');
});

const glow = { id: 'glow', name: 'Glow Haus', platform: 'shopify', niche: 'beauty', color: '#ff2a3a', currency: 'USD', timezone: 'UTC', connected: false } as Store;
const peak = { ...glow, id: 'peak', name: 'Peak Fit' } as Store;
const RULE = { storeId: 'glow', enabled: true, approval: 'ask', maxRunsPerDay: 3, cooldownHours: 24, createdAt: '2026-10-01T00:00:00Z', version: 2 } as const;
const RULES: AutomationRule[] = [
  { ...RULE, id: 'daily', name: 'Daily brief', trigger: { type: 'schedule', cron: '0 9 * * *' }, action: { type: 'agent_task', agentId: 'glow:market_analyst', task: 'Brief' }, nextRunAt: '2026-10-27T00:00:00Z' },
  { ...RULE, id: 'monthly', name: 'Month close', trigger: { type: 'schedule', cron: '0 9 15 * *' }, action: { type: 'agent_task', agentId: 'glow:market_analyst', task: 'Close' } },
  { ...RULE, id: 'kb', name: 'Serum pricing', approval: 'auto', trigger: { type: 'schedule', cron: '0 9 * * 1' }, action: { type: 'kb_research', agentId: 'glow:market_analyst', task: 'Serum pricing' }, nextRunAt: '2026-11-02T00:00:00Z' },
  { ...RULE, id: 'off', name: 'Old check', enabled: false, storeId: 'peak', trigger: { type: 'schedule', cron: '0 8 * * *' }, action: { type: 'agent_task', agentId: 'peak:market_analyst', task: 'Check' } },
];
/** A store in scope: its autopilot rule for budgets is saved, the one for pausing never was. */
function scoped(stores = [glow, peak]) {
  return stubApi((url, init) => {
    if (url === '/api/stores') return stores;
    if (url === '/api/automations') return RULES;
    if (url === '/api/config?store=glow' && !init?.method) return { values: { 'automation.paused': false, timezone: 'Asia/Tokyo', 'autopilot.ads.set_budget': { enabled: true, maxUsdPerDay: 40 }, 'autopilot.ads.pause_campaign': null }, origins: {}, versions: { workspace: 7, 'store_caps:glow': 3 } };
    if (url === '/api/config' && init?.method === 'PATCH') return { values: {}, origins: {}, versions: { workspace: 7, 'store_caps:glow': 4 }, changes: [] };
    if (url === '/api/config') return { values: { 'automation.paused': false, timezone: 'Asia/Tokyo' }, origins: {}, versions: { workspace: 7 } };
    if (url === '/api/config/automation') return { paused: false, pausedAt: null, running: [] };
  });
}

test("a store's autopilot rules: only the kinds autopilot may take, saved in its store_caps document over the version read", async () => {
  const fetch = scoped();
  renderApp(<Settings />, '/settings/automation?store=glow');
  const budgets = await screen.findByRole('switch', { name: 'Change ad budgets' });
  expect(screen.getAllByRole('switch').map((s) => s.getAttribute('aria-label'))).toEqual(['Pause new automation', 'Change ad budgets', 'Pause campaigns']);
  expect((budgets as HTMLInputElement).checked).toBe(true);
  expect((screen.getByLabelText('Change ad budgets: most per day in dollars') as HTMLInputElement).value).toBe('40');
  expect((screen.getByLabelText('Pause campaigns: most per day in dollars') as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('switch', { name: 'Pause campaigns' }));
  fireEvent.change(screen.getByLabelText('Pause campaigns: most per day in dollars'), { target: { value: '25' } });
  // Off with the amount cleared keeps no stray number: it saves as 0.
  fireEvent.change(screen.getByLabelText('Change ad budgets: most per day in dollars'), { target: { value: '' } });
  fireEvent.click(budgets);
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() =>
    expect(sent(fetch, '/api/config')).toEqual([
      { documents: [{ doc: 'store_caps', storeId: 'glow', version: 3, set: { 'autopilot.ads.pause_campaign': { enabled: true, maxUsdPerDay: 25 }, 'autopilot.ads.set_budget': { enabled: false, maxUsdPerDay: 0 } } }] },
    ]),
  );
});

test('in the workspace scope autopilot links to each store, and without stores says it comes with one', async () => {
  scoped();
  renderApp(<Settings />, '/settings/automation');
  expect((await screen.findByRole('link', { name: 'Peak Fit' })).getAttribute('href')).toBe('/settings/automation?store=peak');
  expect(screen.queryByRole('switch', { name: 'Change ad budgets' })).toBeNull();
  cleanup();
  scoped([]);
  renderApp(<Settings />, '/settings/automation');
  expect(await screen.findByText('Autopilot is set per store: add a store first, then set its rules here.')).toBeTruthy();
});

test('the schedules list every rule in the workspace zone with its next run and editor link; a monthly one says it is more than 8 days away', async () => {
  scoped();
  renderApp(<Settings />, '/settings/automation');
  const list = await screen.findByRole('list', { name: 'Schedules' });
  const row = (name: string) => within(list).getByText(name).closest('li')!;
  await waitFor(() => expect(row('Month close').textContent).toContain('More than 8 days away · Monthly on the 15th at 9:00 AM'));
  expect(row('Month close').textContent).toContain('in Asia/Tokyo');
  expect(row('Daily brief').textContent).toMatch(/Next .+ · Ask me first/);
  expect(row('Serum pricing').textContent).toContain('KB controls decide approval');
  expect(row('Old check').textContent).toContain('Peak Fit · Off');
  expect(within(row('Daily brief')).getByRole('link', { name: 'Edit' }).getAttribute('href')).toBe('/automation?rule=daily');
  // The approval map: the locked policy, its rows, and the actions no tool takes.
  expect(screen.getByText('Spending, publishing and live-store edits')).toBeTruthy();
  expect(screen.getAllByText('Not available: no tool does this.')).toHaveLength(2);
  expect(screen.getByText(/^Requests: Change prices, Add products/)).toBeTruthy();
});

test("the Automation editor names the workspace zone, and a research rule's approval is left to its Knowledge controls", async () => {
  scoped();
  renderApp(<Automation />, '/automation?rule=daily');
  expect(((await screen.findByRole('textbox', { name: 'Name' })) as HTMLInputElement).value).toBe('Daily brief');
  const zone = await screen.findAllByRole('link', { name: 'Asia/Tokyo' });
  expect(zone.map((z) => z.getAttribute('href'))).toContain('/settings/general#timezone');
  expect(screen.getByRole('radio', { name: 'Ask me first' })).toBeTruthy();
  cleanup();
  scoped();
  renderApp(<Automation />, '/automation?rule=kb');
  expect(((await screen.findByRole('textbox', { name: 'Name' })) as HTMLInputElement).value).toBe('Serum pricing');
  expect(screen.queryByRole('radio', { name: 'Ask me first' })).toBeNull();
  expect(screen.getByRole('link', { name: 'Knowledge controls' }).getAttribute('href')).toBe('/settings/knowledge?store=glow');
});
