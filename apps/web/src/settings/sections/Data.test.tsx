// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Backup, Health } from '@frontline/shared';
import { Settings } from '../../pages/Settings';
import { renderApp, reply, stubApi } from '../../test-utils';

afterEach(() => (cleanup(), vi.unstubAllGlobals()));

const DIR = 'C:\\Users\\cody\\AppData\\Roaming\\Frontline Ecom\\data';
const BACKUPS: Backup[] = [
  { name: 'frontline-2026-10-31T03-00-00-daily.db', size: 2e6, createdAt: '2026-10-31T03:00:00Z', kind: 'daily' },
  { name: 'frontline-2026-10-30T12-00-00-manual.db', size: 2e6, createdAt: '2026-10-30T12:00:00Z', kind: 'manual' },
  { name: 'frontline-2026-10-29T12-00-00-before-restore.db', size: 2e6, createdAt: '2026-10-29T12:00:00Z', kind: 'before-restore' },
  { name: 'frontline-2026-10-28T12-00-00-before-update.db', size: 2e6, createdAt: '2026-10-28T12:00:00Z', kind: 'before-update' },
  { name: 'frontline-2026-10-27T03-00-00.db', size: 2e6, createdAt: '2026-10-27T03:00:00Z', kind: null },
];
function server(health: Partial<Health> = {}, { down = false } = {}) {
  let restored = false;
  return stubApi((url, init) => {
    if (url === '/api/settings') return { profile: { name: 'Cody', plan: 'Pro' }, notifications: {}, baseCurrency: 'USD', dataDir: DIR };
    if (url === '/api/health') return restored && down ? reply({ error: 'down' }, 503) : { ok: true, uptimeSec: 1, connectors: [], version: '0.3.1', keyLocation: 'safe-storage', dataDirSource: 'desktop', ...health };
    if (url === '/api/backups' && init?.method === 'POST') return reply({ name: 'frontline-2026-10-31T09-00-00-manual.db', size: 2e6, createdAt: '2026-10-31T09:00:00Z', kind: 'manual' }, 201);
    if (url === '/api/backups') return BACKUPS;
    if (url.endsWith('/restore')) return ((restored = true), reply({ restarting: true }, 202));
  });
}
const row = (label: string) => screen.getByText(label).closest('[class*="border-t"]')!.textContent;

test.each([
  ['the desktop app', {}, 'Version 0.3.1', "The desktop app's folder for your Windows account.", "Kept by the desktop app in Windows' safe storage for your account, outside the data folder."],
  ['a dev build', { version: 'dev', keyLocation: 'data-dir', dataDirSource: 'default' }, 'Development build', 'The default: .data in the folder the server started in', `In the data folder: ${DIR}\\secret.key.`],
  ['a server with its own folder and key', { keyLocation: 'environment', dataDirSource: 'env' }, 'Version 0.3.1', 'Set by FRONTLINE_DATA_DIR where the server starts.', 'Read from FRONTLINE_SECRET_KEY, set where the server starts.'],
] as const)('the copy is right for %s: where the data, the key and the logs are', async (_, health, build, data, key) => {
  server(health);
  renderApp(<Settings />, '/settings/data');
  expect(await screen.findByText(build)).toBeTruthy();
  await waitFor(() => expect(row('Data folder')).toContain(data));
  expect(row('Credentials key')).toContain(key);
  expect(row('Logs')).toContain(`${DIR}\\logs: api.log`);
});

test("Copy path copies the data folder, and Open folder goes through the desktop app when it's there, showing Windows' error", async () => {
  const fetch = server();
  const writeText = vi.fn(async () => {});
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  const openDataFolder = vi.fn(async () => 'The system cannot find the path specified.');
  vi.stubGlobal('desktop', { openDataFolder });
  renderApp(<Settings />, '/settings/data');
  fireEvent.click(await screen.findByRole('button', { name: 'Copy path' }));
  expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
  expect(writeText).toHaveBeenCalledWith(DIR);
  fireEvent.click(screen.getByRole('button', { name: 'Open folder' }));
  expect((await screen.findByRole('alert')).textContent).toContain('cannot find the path');
  expect(openDataFolder).toHaveBeenCalledOnce();
  expect(fetch.mock.calls.some(([url]) => String(url).includes('open-data-folder'))).toBe(false);
});

test('each backup says what made it; one from before kinds were recorded says so, and Back up now makes a manual one', async () => {
  const fetch = server();
  renderApp(<Settings />, '/settings/data');
  const list = await screen.findByRole('list', { name: 'Backups' });
  expect(within(list).getAllByText(/^(Daily|Manual|Before restore|Before update|Snapshot \(kind not recorded\))$/).map((b) => b.textContent)).toEqual([
    'Daily', 'Manual', 'Before restore', 'Before update', 'Snapshot (kind not recorded)',
  ]);
  fireEvent.click(screen.getByRole('button', { name: 'Back up now' }));
  await waitFor(() => expect(fetch.mock.calls.filter(([u, i]) => u === '/api/backups' && i?.method === 'POST')).toHaveLength(1));
});

test('Restore lists everything it does first, then says to restart the dev server in a dev build', async () => {
  const fetch = server({ version: 'dev', keyLocation: 'data-dir', dataDirSource: 'default' }, { down: true });
  renderApp(<Settings />, '/settings/data');
  await screen.findByText('Development build');
  fireEvent.click((await screen.findAllByRole('button', { name: /^Restore the backup from / }))[0]!);
  const dialog = await screen.findByRole('dialog');
  const said = within(within(dialog).getByRole('list', { name: 'What a restore does' })).getAllByRole('listitem').map((l) => l.textContent);
  expect(said).toEqual([
    'Your current data is backed up first, as a Before restore backup, so you can go back.',
    "Every setting stored in the database returns to the backup's state, including integrations whose tokens may have changed since.",
    "Change History returns to the backup's state too.",
    'Requests waiting on a connected store or ad account are closed: they may have been carried out since the backup.',
    "On another computer, every credential stays locked: the key isn't in a backup.",
    'Files outside the database (knowledge files, creatives, product images, sessions) stay as they are now.',
    'The server stops; in this development build you restart it yourself.',
  ]);
  expect(fetch.mock.calls.some(([u]) => String(u).endsWith('/restore'))).toBe(false);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Restore' }));
  expect((await within(dialog).findByRole('status')).textContent).toMatch(/^Restart the dev server: .+ Start pnpm dev again/);
  expect(fetch.mock.calls.filter(([u, i]) => String(u) === '/api/backups/frontline-2026-10-31T03-00-00-daily.db/restore' && i?.method === 'POST')).toHaveLength(1);
});

test('a desktop restore says the app restarts the server and reloads the window', async () => {
  server({}, { down: true });
  renderApp(<Settings />, '/settings/data');
  await screen.findByText('Version 0.3.1');
  fireEvent.click((await screen.findAllByRole('button', { name: /^Restore the backup from / }))[0]!);
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('The server restarts and the window reloads.')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Restore' }));
  expect((await within(dialog).findByRole('status')).textContent).toBe('Restoring. The server stops with exit code 75, the desktop app starts it again on the backup, and the window reloads.');
});
