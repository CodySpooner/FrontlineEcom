// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { AutomationCancelled, AutomationStatus, ConfigView } from '@frontline/shared';
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
