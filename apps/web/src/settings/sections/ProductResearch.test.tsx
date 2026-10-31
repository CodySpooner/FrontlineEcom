// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { PrStoreProfile } from '@frontline/shared';
import { Settings } from '../../pages/Settings';
import { renderApp, reply, stubApi } from '../../test-utils';

afterEach(() => (cleanup(), vi.unstubAllGlobals()));

const store = (id: string, name: string) => ({ id, name, connected: false, platform: 'shopify', niche: 'pet', color: '#f00', currency: 'USD', timezone: 'UTC' });
const PROFILE: PrStoreProfile = {
  storeId: 'paws', audience: null, priceMin: 1500, priceMax: 4000, priceCurrency: 'USD', shipTo: 'US', shipToDefault: true, warehouses: ['US'], maxDeliveryDays: 12,
  avoidCategories: ['batteries'], avoidTerms: [], includeCategories: [], keywords: [], updatedAt: null, version: 3,
};

/** `put`: PUT /api/pr/profile's answer for the body sent. `profiles`: a store's own values over PROFILE. */
function render(
  path = '/settings/product-research?store=paws',
  { stores = [store('paws', 'Pawsome Gear'), store('glow', 'Glow Haus')], put = (b: object): unknown => ({ ...PROFILE, ...b, version: 4 }), profiles = {} as Record<string, Partial<PrStoreProfile>> } = {},
) {
  const sent: [string, unknown][] = [];
  stubApi((url, init) => {
    if (url === '/api/stores') return stores;
    if (url.startsWith('/api/pr/profile')) {
      const id = new URL(url, 'http://x').searchParams.get('store')!;
      if (init?.method !== 'PUT') return { ...PROFILE, storeId: id, ...profiles[id] };
      const b = JSON.parse(String(init.body)) as object;
      sent.push([url, b]);
      return put(b);
    }
    return undefined;
  });
  renderApp(<Settings />, path);
  return sent;
}
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
const row = (id: string) => document.getElementById(id) as HTMLElement;

it("sets a store's research profile as PUT /api/pr/profile takes it, over the version read; there's no lowest price", async () => {
  const sent = render();
  fireEvent.change(await screen.findByLabelText('Audience'), { target: { value: ' US dog owners ' } });
  fireEvent.change(screen.getByLabelText('Highest cost + shipping'), { target: { value: '39.99' } });
  expect((screen.getByLabelText('Ship to') as HTMLInputElement).placeholder).toBe('US (default)');
  fireEvent.change(screen.getByLabelText('Ship to'), { target: { value: 'gb' } });
  fireEvent.change(screen.getByLabelText('Preferred ships-from'), { target: { value: 'US, CN' } });
  fireEvent.change(screen.getByLabelText('Longest delivery'), { target: { value: '9' } });
  fireEvent.change(screen.getByLabelText('Include categories'), { target: { value: 'Dog Beds' } });
  fireEvent.change(screen.getByLabelText('Keywords'), { target: { value: 'lick mat, slow feeder' } });
  fireEvent.change(screen.getByLabelText('Avoided terms'), { target: { value: 'airtag, Airtag , lithium' } });
  expect((screen.getByLabelText('Refund on a return') as HTMLInputElement).placeholder).toBe('100'); // empty: the built-in full refund
  fireEvent.change(screen.getByLabelText('Discount'), { target: { value: '12.5' } });
  expect(screen.getByText('Fit is re-evaluated when you save. Saved reports are never rewritten.')).toBeTruthy();
  expect(screen.getByText(/Discovery searches change at the next daily plan \(00:00 UTC\) or Sync now/)).toBeTruthy();
  expect(screen.queryByText(/lowest|sells at, from/i)).toBeNull();
  expect(screen.getByText(/Pawsome Gear/, { selector: '[role="status"] *' })).toBeTruthy();
  save();
  await waitFor(() =>
    expect(sent).toEqual([
      ['/api/pr/profile?store=paws', {
        version: 3, audience: 'US dog owners', priceMax: 3999, shipTo: 'gb', warehouses: ['US', 'CN'], maxDeliveryDays: 9,
        includeCategories: ['Dog Beds'], keywords: ['lick mat', 'slow feeder'], avoidTerms: ['airtag', 'Airtag', 'lithium'], discountPct: 12.5,
      }],
    ]),
  );
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull());
});

it("a value that isn't one is refused on its row before anything is sent; the server's refusal lands on its row", async () => {
  const sent = render('/settings/product-research?store=paws', { put: () => reply({ error: 'shipTo must be a two-letter country code, or null for the default', field: 'pr.shipTo' }, 400) });
  fireEvent.change(await screen.findByLabelText('Highest cost + shipping'), { target: { value: 'forty' } });
  save();
  expect((await within(row('pr.priceMax')).findByRole('alert')).textContent).toBe('Enter an amount in USD, like 15 or 39.99.');
  fireEvent.change(screen.getByLabelText('Highest cost + shipping'), { target: { value: '' } }); // back to not set
  fireEvent.change(screen.getByLabelText('Return rate'), { target: { value: '150' } });
  save();
  expect((await within(row('pr.returnRatePct')).findByRole('alert')).textContent).toBe('Enter a percentage from 0 to 100.');
  expect(sent).toEqual([]);
  fireEvent.change(screen.getByLabelText('Return rate'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Ship to'), { target: { value: 'USA' } });
  save();
  expect((await within(row('pr.shipTo')).findByRole('alert')).textContent).toBe('shipTo must be a two-letter country code, or null for the default');
  expect(sent).toEqual([['/api/pr/profile?store=paws', { version: 3, priceMax: null, shipTo: 'USA' }]]);
});

it("Copy from another store previews each field that differs and saves exactly those over the version read; a band in another currency isn't copied", async () => {
  const glow = { audience: 'Women 25-40', priceMax: 3000, priceCurrency: 'EUR', warehouses: ['US', 'GB'], discountPct: 10 };
  const sent = render('/settings/product-research?store=paws', { profiles: { glow } });
  fireEvent.click(await screen.findByRole('button', { name: 'Copy from another store…' }));
  const dialog = await screen.findByRole('dialog');
  const table = await within(dialog).findByRole('table', { name: 'Changes to copy' });
  const preview = [...table.querySelectorAll('tbody tr')].map((tr) => [tr.getAttribute('data-key'), ...[...tr.querySelectorAll('td')].map((td) => td.textContent)]);
  expect(preview).toEqual([
    ['audience', 'Audience', 'Not set', 'Women 25-40'],
    ['warehouses', 'Preferred ships-from', 'US', 'US, GB'],
    ['discountPct', 'Discount', 'Built-in', '10%'],
  ]);
  expect(within(dialog).getByText("Glow Haus's highest cost is in EUR, so it isn't copied.")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Copy 3 settings' }));
  await waitFor(() => expect(sent).toEqual([['/api/pr/profile?store=paws', { version: 3, audience: 'Women 25-40', warehouses: ['US', 'GB'], discountPct: 10 }]]));
  expect(Object.keys(sent[0]![1] as object).filter((k) => k !== 'version')).toEqual(preview.map(([k]) => k));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('a band saved in another currency says how it is read: converted, or left out until it is entered again', async () => {
  render('/settings/product-research?store=paws', { profiles: { paws: { priceMax: null, priceSaved: { min: null, max: 4000, currency: 'EUR', converted: false } } } });
  await screen.findByLabelText('Highest cost + shipping');
  expect(within(row('pr.priceMax')).getByText(/Saved as/).textContent).toBe('Saved as €40.00: no EUR to USD rate yet, so fit leaves it out. Enter it in USD.');
  cleanup();
  render('/settings/product-research?store=paws', { profiles: { paws: { priceMax: 4400, priceSaved: { min: null, max: 4000, currency: 'EUR', converted: true } } } });
  await screen.findByLabelText('Highest cost + shipping');
  expect(within(row('pr.priceMax')).getByText(/Saved as/).textContent).toBe('Saved as €40.00: converted to USD at the stored rate.');
  expect((screen.getByLabelText('Highest cost + shipping') as HTMLInputElement).value).toBe('44');
});

it('store only: with no store picked it edits the first store, the switch has no workspace side, and with no store it says to add one', async () => {
  render('/settings/product-research');
  await screen.findByLabelText('Audience');
  const scope = document.querySelector('[data-action="settings.scope"]') as HTMLElement;
  expect(scope.textContent).toContain('Pawsome Gear');
  expect(scope.textContent).not.toMatch(/Workspace|General/);
  cleanup();
  render('/settings/product-research', { stores: [] });
  expect((await screen.findByRole('link', { name: 'add a store' })).getAttribute('href')).toBe('/settings/stores');
  expect(screen.queryByLabelText('Audience')).toBeNull();
});
