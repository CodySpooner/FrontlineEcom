// @vitest-environment jsdom
import { afterAll, afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { ConfigView, Store } from '@frontline/shared';
import { NotificationBell } from '../../components/Notifications';
import { Settings } from '../../pages/Settings';
import { renderApp, stubApi } from '../../test-utils';

afterEach(() => {
  cleanup();
  delete window.desktop;
});
afterAll(() => vi.unstubAllGlobals());

const CATS = ['approvals', 'agentDone', 'errors', 'researchAlerts', 'digest'];
const view: ConfigView = {
  values: { ...Object.fromEntries(CATS.flatMap((c) => [[`notifications.${c}`, true], [`notifications.toasts.${c}`, true]])), 'notifications.quietHours': null, 'notifications.mutedStores': [] },
  origins: {},
  versions: { app: 3 },
};
const stores = [{ id: 'glow', name: 'Glow Haus' }, { id: 'peak', name: 'Peak Fit' }] as Store[];
const server = (toast = 'Windows toast: requested') =>
  stubApi((url, init) => {
    if (url === '/api/config' && init?.method === 'PATCH') return { ...view, versions: { app: 4 }, changes: [] };
    if (url === '/api/config') return view;
    if (url === '/api/stores') return stores;
    if (url === '/api/notifications/test') return { bell: 'Bell: added', toast };
    if (url === '/api/health') return { ok: true, uptimeSec: 1, version: 'dev', connectors: [] };
  });
const sent = (fetch: ReturnType<typeof server>, path: string) => fetch.mock.calls.filter(([u, i]) => u === path && i?.method && i.method !== 'GET').map(([, i]) => JSON.parse(String(i!.body)));
const row = (id: string) => document.getElementById(id)!.textContent;

test('each row says what it covers and what Off does', async () => {
  server();
  renderApp(<Settings />, '/settings/notifications');
  await screen.findByRole('switch', { name: 'Approvals' });
  const off = "Off: not kept; turning it back on doesn't bring them back.";
  expect(row('notifications.approvals')).toContain('An agent needs your yes or no.');
  expect(row('notifications.agentDone')).toContain("An agent's task, Knowledge research, a mission or a team finished.");
  expect(row('notifications.errors')).toContain("a store stopped syncing; the daily backup failed; or an approved live change didn't go through.");
  expect(row('notifications.researchAlerts')).toContain('the Watchlist shows them either way.');
  expect(row('notifications.digest')).toContain('once a day from 8:00 in the workspace timezone.');
  for (const c of CATS) expect(row(`notifications.${c}`)).toContain(off);
  expect(row('notifications.mutedStores')).toContain(off);
  expect(row('notifications.quietHours')).toContain("They're not sent, not held; the bell still gets everything.");
  expect(screen.getByText(/Info \(a store going live, a connection back, a change not applied\) always shows\./)).toBeTruthy();
});

test('a save sends only what changed, over the version read', async () => {
  const fetch = server();
  renderApp(<Settings />, '/settings/notifications');
  fireEvent.click(await screen.findByRole('switch', { name: 'Errors' }));
  fireEvent.click(screen.getByRole('switch', { name: 'Agent finished: Windows toast' }));
  fireEvent.click(screen.getByRole('switch', { name: 'Quiet hours' }));
  fireEvent.change(screen.getByLabelText('Quiet from'), { target: { value: '23' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Peak Fit' }));
  expect(screen.getByText('4 unsaved changes')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await vi.waitFor(() =>
    expect(sent(fetch, '/api/config')).toEqual([
      { documents: [{ doc: 'app', version: 3, set: { 'notifications.errors': false, 'notifications.toasts.agentDone': false, 'notifications.quietHours': { from: 23, to: 7 }, 'notifications.mutedStores': ['peak'] } }] },
    ]),
  );
});

test('Send test shows what the server decided, and says where toasts appear', async () => {
  const fetch = server('Windows toast: not sent (quiet hours until 07:00)');
  renderApp(<Settings />, '/settings/notifications');
  fireEvent.change(await screen.findByLabelText('Test category'), { target: { value: 'errors' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send test' }));
  const status = await screen.findByText(/^Bell: added/);
  expect(status.textContent).toBe('Bell: added · Windows toast: not sent (quiet hours until 07:00)Windows toasts only appear in the installed desktop app.');
  expect(sent(fetch, '/api/notifications/test')).toEqual([{ category: 'errors' }]);
  cleanup();

  // The desktop app: no note.
  window.desktop = {} as typeof window.desktop;
  server();
  renderApp(<Settings />, '/settings/notifications');
  fireEvent.click(await screen.findByRole('button', { name: 'Send test' }));
  expect((await screen.findByText(/^Bell: added/)).textContent).toBe('Bell: added · Windows toast: requested');
});

test('the bell links to Notification settings', async () => {
  server();
  renderApp(<NotificationBell />);
  fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
  fireEvent.click(await screen.findByRole('link', { name: 'Notification settings' }));
  expect(screen.getByTestId('where').textContent).toBe('/settings/notifications');
  // Already there: the drawer still closes.
  fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
  fireEvent.click(await screen.findByRole('link', { name: 'Notification settings' }));
  expect(screen.queryByRole('link', { name: 'Notification settings' })).toBeNull();
});
