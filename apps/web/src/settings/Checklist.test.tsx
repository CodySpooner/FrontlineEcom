// @vitest-environment jsdom
import { afterAll, afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import type { SetupItem } from '@frontline/shared';
import { Settings } from '../pages/Settings';
import { renderApp, stubApi } from '../test-utils';

afterEach(cleanup);
afterAll(() => vi.unstubAllGlobals());

const ITEMS: SetupItem[] = [
  { id: 'store', title: 'Add your store', done: true, link: '/settings/stores', detail: "Demo stores don't count." },
  { id: 'claude', title: 'Sign in to Claude', done: false, link: '/settings/agents', detail: 'Not signed in.' },
  { id: 'research', title: 'Verify a research source', done: false, link: '/settings/integrations', detail: 'CJ key saved, no successful sync yet.' },
  { id: 'backup', title: 'Back up your data', done: true, link: '/settings/data', detail: 'No backup yet.' },
];
const server = (items: SetupItem[]) =>
  stubApi((url) => {
    if (url === '/api/config/checklist') return items;
    if (url === '/api/config') return { values: { baseCurrency: 'USD', timezone: 'UTC' }, origins: {}, versions: { app: 1, workspace: 1 } };
    if (url === '/api/health') return { connectors: [] };
  });
const nav = () => screen.getByRole('navigation', { name: 'Settings' });

test('while a step is open, General shows every step with why the open ones are open, and the sidebar has a dot', async () => {
  server(ITEMS);
  renderApp(<Settings />, '/settings/general');
  const card = (await screen.findByRole('heading', { name: 'Finish setting up' })).closest('section')!;
  expect(within(card).getByText('2 of 4 steps left. Each one ticks itself off once it\'s really done.')).toBeTruthy();
  expect(within(card).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
    ['Add your store', '/settings/stores'],
    ['Sign in to ClaudeNot signed in.', '/settings/agents'],
    ['Verify a research sourceCJ key saved, no successful sync yet.', '/settings/integrations'],
    ['Back up your data', '/settings/data'],
  ]);
  expect(within(card).getAllByLabelText('To do')).toHaveLength(2);
  expect(within(nav()).getByRole('link', { name: 'General2 setup steps left' })).toBeTruthy();
  fireEvent.click(within(card).getByRole('link', { name: /Back up your data/ }));
  expect(screen.getByTestId('where').textContent).toBe('/settings/data');
});

test('with every step done there is no card and no dot', async () => {
  const fetch = server(ITEMS.map((i) => ({ ...i, done: true })));
  renderApp(<Settings />, '/settings/general');
  await screen.findByLabelText('Display currency');
  await vi.waitFor(() => expect(fetch.mock.calls.some(([u]) => u === '/api/config/checklist')).toBe(true));
  expect(screen.queryByRole('heading', { name: 'Finish setting up' })).toBeNull();
  expect(within(nav()).getByRole('link', { name: 'General' })).toBeTruthy();
});
