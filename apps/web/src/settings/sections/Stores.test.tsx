// @vitest-environment jsdom
import { afterAll, afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import type { Integration, Store } from '@frontline/shared';
import { StoreFilter } from '../../components/StoreFilter';
import { Settings } from '../../pages/Settings';
import { renderApp, reply, stubApi } from '../../test-utils';

afterEach(cleanup);
afterAll(() => vi.unstubAllGlobals());

const peak: Store = { id: 'peak', name: 'Peak Fit', platform: 'shopify', niche: 'fitness', nicheDetail: 'home gym gear', color: '#3366ff', currency: 'USD', timezone: 'America/Chicago', connected: false, feePercent: 2.9, feePerOrder: 0.3, version: 4 };
const glow: Store = { id: 'glow', name: 'Glow Haus', platform: 'shopify', niche: 'beauty', color: '#ff2a3a', currency: 'EUR', timezone: 'Europe/Berlin', connected: true, version: 9 };
const shopify = { id: 'shopify:glow', kind: 'shopify', storeId: 'glow', status: 'connected', settings: {}, secretsSet: [], updatedAt: '' } as unknown as Integration;
const server = (extra: (url: string, init?: RequestInit) => unknown = () => undefined) =>
  stubApi((url, init) => {
    const r = extra(url, init);
    if (r !== undefined) return r;
    if (url === '/api/stores') return [peak, glow];
    if (url === '/api/integrations') return [shopify];
    if (url.endsWith('/impact')) return { removes: [], keeps: [] };
    if (url === '/api/config/store-impact') return { impacts: [{ setting: 'store.feePercent', text: 'Recomputes profit for all 412 orders, past ones included' }] };
    if (url === '/api/health') return { ok: true, uptimeSec: 1, version: 'dev', connectors: [] };
  });
const sent = (fetch: ReturnType<typeof server>, path: string, method: string) => fetch.mock.calls.filter(([u, i]) => u === path && i?.method === method).map(([, i]) => JSON.parse(String(i!.body)));

test("the list shows each store's color, platform, data, currency and fees, and opens its page", async () => {
  server();
  renderApp(
    <>
      <Settings />
      <StoreFilter />
    </>,
    '/settings/stores',
  );
  const list = (await screen.findByRole('heading', { name: 'Your stores' })).closest('section')!;
  const rows = await within(list).findAllByRole('link');
  expect(rows.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
    ['Peak FitDemo dataShopify · Sells in USD · Fees 2.9% + 0.30 per order', '/settings/stores/peak'],
    ['Glow HausLiveShopify · Sells in EUR · No fee estimate', '/settings/stores/glow'],
  ]);
  expect((rows[0]!.querySelector('[data-color]') as HTMLElement).style.background).toBe('rgb(51, 102, 255)');
  // The store filter's chip carries the same color.
  expect((screen.getByRole('button', { name: 'Peak Fit' }).querySelector('i') as HTMLElement).style.background).toBe('rgb(51, 102, 255)');
  fireEvent.click(rows[1]!);
  expect(screen.getByTestId('where').textContent).toBe('/settings/stores/glow');
  expect(await screen.findByLabelText('Name')).toBeTruthy();
});

test("Add store says what adding does, then opens the new store's page", async () => {
  const made = { ...peak, id: 'volt-lab', name: 'Volt Lab', version: 1 };
  const fetch = server((url, init) =>
    url === '/api/config/store-impact' ? { impacts: [{ setting: 'store', text: 'Adds demo history, a squad of 8 agents and 8 scheduled jobs (off until the store goes live)' }] } : url === '/api/stores' && init?.method === 'POST' ? made : undefined,
  );
  renderApp(<Settings />, '/settings/stores');
  fireEvent.click(await screen.findByRole('button', { name: 'Add store' }));
  expect(await screen.findByText('Adds demo history, a squad of 8 agents and 8 scheduled jobs (off until the store goes live)')).toBeTruthy();
  expect(sent(fetch, '/api/config/store-impact', 'POST')).toEqual([{ set: {} }]);
  fireEvent.change(screen.getByLabelText('Store name'), { target: { value: 'Volt Lab' } });
  fireEvent.submit(screen.getByLabelText('Store name').closest('form')!);
  await vi.waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/settings/stores/volt-lab'));
  expect(sent(fetch, '/api/stores', 'POST')).toMatchObject([{ name: 'Volt Lab' }]);
});

test('the store page saves only what changed over the version read, a blank sub-niche as null, after showing the impact', async () => {
  const fetch = server((url, init) => (url === '/api/stores/peak' && init?.method === 'PATCH' ? { ...peak, nicheDetail: undefined, feePercent: 3, version: 5 } : undefined));
  renderApp(<Settings />, '/settings/stores/peak');
  fireEvent.change(await screen.findByLabelText('Sub-niche'), { target: { value: '  ' } });
  fireEvent.change(screen.getByLabelText('Fees, % of revenue'), { target: { value: '3' } });
  expect(await screen.findByText('Recomputes profit for all 412 orders, past ones included')).toBeTruthy();
  expect(sent(fetch, '/api/config/store-impact', 'POST').at(-1)).toEqual({ storeId: 'peak', set: { nicheDetail: null, feePercent: 3 } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await vi.waitFor(() => expect(sent(fetch, '/api/stores/peak', 'PATCH')).toEqual([{ nicheDetail: null, feePercent: 3, version: 4 }]));
});

test('a live store keeps its platform, and what its sync sets is read-only, naming the connection; a demo store says when its timezone applies', async () => {
  server();
  renderApp(<Settings />, '/settings/stores/glow');
  expect(((await screen.findByLabelText('Platform')) as HTMLSelectElement).disabled).toBe(true);
  expect(document.getElementById('store.platform')!.textContent).toContain('Glow Haus is live: to sell elsewhere, add that platform as a store of its own.');
  expect((screen.getByLabelText('Selling currency') as HTMLInputElement).readOnly).toBe(true);
  expect(document.getElementById('store.currency')!.textContent).toContain('Set by Shopify on every sync.');
  expect((screen.getByLabelText('Business timezone') as HTMLSelectElement).disabled).toBe(true);
  expect(document.getElementById('store.timezone')!.textContent).toContain('Set by Shopify on every sync.');
  cleanup();

  server();
  renderApp(<Settings />, '/settings/stores/peak');
  expect(((await screen.findByLabelText('Platform')) as HTMLSelectElement).disabled).toBe(false);
  expect((screen.getByLabelText('Selling currency') as HTMLInputElement).readOnly).toBe(false);
  expect((screen.getByLabelText('Business timezone') as HTMLSelectElement).disabled).toBe(false);
  expect(document.getElementById('store.timezone')!.textContent).toContain('Takes effect once the store goes live.');
});

test("a refused field shows the server's reason under its row", async () => {
  server((url, init) => (url === '/api/stores/peak' && init?.method === 'PATCH' ? reply({ error: 'Set by Etsy on every sync.', field: 'store.currency' }, 400) : undefined));
  renderApp(<Settings />, '/settings/stores/peak');
  fireEvent.change(await screen.findByLabelText('Selling currency'), { target: { value: 'gbp' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await vi.waitFor(() => expect(document.getElementById('store.currency')!.querySelector('[role=alert]')?.textContent).toBe('Set by Etsy on every sync.'));
});

test("the store page links to the store's knowledge, niche pack, research profile and integrations", async () => {
  server();
  renderApp(<Settings />, '/settings/stores/peak');
  const links = (await screen.findByRole('heading', { name: 'Elsewhere for this store' })).closest('section')!;
  expect(within(links).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
    ['Knowledge workspace', '/knowledge?ws=peak'],
    ['Niche pack', '/knowledge?view=library&tab=niche&doc=fitness'],
    ['Research profile and ship-to', '/research?store=peak'],
    ['Integrations', '/settings/integrations?store=peak'],
  ]);
});

test("Delete stays off until the store's name is typed, says what goes and what stays, and sends the name", async () => {
  const impact = {
    removes: [{ count: 8, text: '8 agents' }, { count: 0, text: '0 queued runs' }, { count: 412, text: '412 orders' }],
    keeps: [{ count: 3, text: '3 action log entries' }, { count: 0, text: '0 change history entries' }],
    codexFolder: 'C:/codex-work/peak',
  };
  let gone = false; // after the DELETE the list no longer has it, so the store page unmounts
  const fetch = server((url, init) => {
    if (url === '/api/stores/peak/impact') return impact;
    if (url.startsWith('/api/stores/peak?') && init?.method === 'DELETE') return (gone = true), new Response(null, { status: 204 });
    if (url === '/api/stores' && gone) return [glow];
  });
  // Another refetch after the delete is slower than the store list, as in the app.
  const answer = fetch.getMockImplementation()!;
  fetch.mockImplementation(async (url: string, init?: RequestInit) => (gone && url === '/api/integrations' && (await new Promise((r) => setTimeout(r, 200))), answer(url, init)));
  renderApp(<Settings />, '/settings/stores/peak');
  const zone = (await screen.findByRole('heading', { name: 'Delete this store' })).closest('section')!;
  expect(await within(zone).findByText('Removes: 8 agents, 412 orders.')).toBeTruthy();
  expect(within(zone).getByText('Stays: 3 action log entries.')).toBeTruthy();
  expect(within(zone).getByText('Its Codex work folder stays on disk: C:/codex-work/peak')).toBeTruthy();
  const button = within(zone).getByRole('button', { name: 'Delete store' }) as HTMLButtonElement;
  fireEvent.change(within(zone).getByLabelText('Type Peak Fit to confirm'), { target: { value: 'peak fit' } });
  expect(button.disabled).toBe(true);
  fireEvent.change(within(zone).getByLabelText('Type Peak Fit to confirm'), { target: { value: 'Peak Fit' } });
  fireEvent.click(button);
  await vi.waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/settings/stores'));
  expect(fetch.mock.calls.filter(([, i]) => i?.method === 'DELETE').map(([u]) => u)).toEqual(['/api/stores/peak?confirm=Peak%20Fit']);
});
