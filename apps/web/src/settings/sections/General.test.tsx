// @vitest-environment jsdom
import { afterAll, afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import type { ConfigView } from '@frontline/shared';
import { api } from '../../api/client';
import { Settings } from '../../pages/Settings';
import { renderApp, reply, stubApi } from '../../test-utils';

afterEach(cleanup);
afterAll(() => vi.unstubAllGlobals());

const view: ConfigView = { values: { baseCurrency: 'USD', timezone: 'Asia/Tokyo' }, origins: {}, versions: { app: 3, workspace: 7 } };
const server = () =>
  stubApi((url, init) => {
    if (url === '/api/config/currencies') return ['EUR', 'GBP', 'USD'];
    if (url === '/api/config/impact') return { impacts: [{ setting: 'baseCurrency', text: 'Re-ranks All-stores facts for 12 products' }] };
    if (url === '/api/config' && init?.method === 'PATCH') return { ...view, values: { baseCurrency: 'GBP', timezone: 'America/New_York' }, versions: { app: 4, workspace: 8 }, changes: [] };
    if (url === '/api/config') return view;
    if (url === '/api/analytics/summary') return {};
    if (url === '/api/health') return { ok: true, uptimeSec: 1, version: 'dev', connectors: [] };
  });
const sent = (fetch: ReturnType<typeof server>, path: string) => fetch.mock.calls.filter(([u, i]) => u === path && i?.method && i.method !== 'GET').map(([, i]) => JSON.parse(String(i!.body)));
const calls = (fetch: ReturnType<typeof server>, path: string) => fetch.mock.calls.filter(([u]) => u === path).length;
/** A converted-totals view on the same page: its query is refetched after a save. */
function Summary() {
  useQuery({ queryKey: ['summary', ['glow'], 30], queryFn: () => api('/api/analytics/summary') });
  return null;
}

test("the currency picker offers the server's codes and says it doesn't touch a store's selling currency", async () => {
  server();
  renderApp(<Settings />, '/settings/general');
  const picker = (await screen.findByLabelText('Display currency')) as HTMLSelectElement;
  await vi.waitFor(() => expect([...picker.options].map((o) => o.value)).toEqual(['EUR', 'GBP', 'USD']));
  expect(picker.value).toBe('USD');
  expect(document.getElementById('baseCurrency')!.textContent).toContain("Display currency for totals across stores. It doesn't change any store's selling currency.");
  expect((screen.getByLabelText('Workspace timezone') as HTMLSelectElement).value).toBe('Asia/Tokyo');
});

test('each setting saves in its own document over the version read, shows the impact first, and refreshes converted totals', async () => {
  const fetch = server();
  renderApp(
    <>
      <Settings />
      <Summary />
    </>,
    '/settings/general',
  );
  await vi.waitFor(() => expect((screen.getByLabelText('Display currency') as HTMLSelectElement).options).toHaveLength(3));
  fireEvent.change(screen.getByLabelText('Display currency'), { target: { value: 'GBP' } });
  fireEvent.change(screen.getByLabelText('Workspace timezone'), { target: { value: 'America/New_York' } });
  const documents = [
    { doc: 'app', version: 3, set: { baseCurrency: 'GBP' } },
    { doc: 'workspace', version: 7, set: { timezone: 'America/New_York' } },
  ];
  expect(await screen.findByText('Re-ranks All-stores facts for 12 products')).toBeTruthy();
  expect(sent(fetch, '/api/config/impact').at(-1)).toEqual({ documents });
  const before = calls(fetch, '/api/analytics/summary');
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await vi.waitFor(() => expect(sent(fetch, '/api/config')).toEqual([{ documents }]));
  await vi.waitFor(() => expect(calls(fetch, '/api/analytics/summary')).toBeGreaterThan(before));
});

test("a refused code shows the server's reason under its row", async () => {
  const fetch = server();
  fetch.mockImplementation(async (url: string, init?: RequestInit) =>
    url === '/api/config' && init?.method === 'PATCH'
      ? reply({ error: "CHF has no stored exchange rate, so totals couldn't be converted to it", field: 'baseCurrency' }, 400)
      : reply(url === '/api/config' ? view : url === '/api/config/currencies' ? ['CHF', 'USD'] : url === '/api/config/impact' ? { impacts: [] } : url === '/api/health' ? { connectors: [] } : []),
  );
  renderApp(<Settings />, '/settings/general');
  await vi.waitFor(() => expect((screen.getByLabelText('Display currency') as HTMLSelectElement).options).toHaveLength(2));
  fireEvent.change(screen.getByLabelText('Display currency'), { target: { value: 'CHF' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await vi.waitFor(() => expect(document.getElementById('baseCurrency')!.querySelector('[role=alert]')?.textContent).toBe("CHF has no stored exchange rate, so totals couldn't be converted to it"));
});

test('Account links its timezone line to this row', async () => {
  stubApi((url) => (url === '/api/settings' ? { profile: { name: 'Cody', plan: 'Pro Plan' }, notifications: {}, baseCurrency: 'USD', dataDir: 'C:/d', version: 1 } : url === '/api/health' ? { connectors: [] } : undefined));
  renderApp(<Settings />, '/settings/account');
  expect((await screen.findByRole('link', { name: 'workspace timezone' })).getAttribute('href')).toBe('/settings/general#timezone');
});
