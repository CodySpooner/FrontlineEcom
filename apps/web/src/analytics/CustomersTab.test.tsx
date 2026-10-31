// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Analytics } from '../pages/Analytics';
import { renderApp, stubApi } from '../test-utils';
import { NoCustomers } from './CustomersTab';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Customers no-data state (SA-103)', () => {
  it('says why there is no customer to follow and links the fix', () => {
    renderApp(<NoCustomers why={{ reason: 'needs_permission', note: "Shopify hasn't allowed reading the orders' customer (protected customer data)", fix: { label: 'Allow customer data for Shopify', href: '/settings/integrations?store=a' } }} />);
    const box = screen.getByRole('region', { name: 'No customer data' });
    expect(box.textContent).toBe("No customer data for this periodNeeds permissionShopify hasn't allowed reading the orders' customer (protected customer data)Allow customer data for Shopify");
    expect(screen.getByRole('link', { name: 'Allow customer data for Shopify' }).getAttribute('href')).toBe('/settings/integrations?store=a');
  });

  it('guest checkouts only: the reason with no link', () => {
    renderApp(<NoCustomers why={{ reason: 'not_tracked', note: 'Every order in this period was a guest checkout, so there is no customer to follow.' }} />);
    expect(screen.getByText('Not tracked')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

const PERIOD = { preset: 'custom', from: '2026-08-01', to: '2026-10-31', days: 92, partial: false };
const CTX = { storeId: 'a', name: 'Glow Haus', niche: 'beauty', platform: 'shopify', currency: 'USD', demo: false, channels: [], zone: null, zoneLabel: '', zoneAbbr: 'ET', historyStart: null, freshness: [] };
const part = { status: 'partial', coverage: { share: 22 / 23, of: 'orders' }, note: '1 order synced before customer ids' };
const REPORT = {
  period: PERIOD, since: '2026-08-05', scope: { applied: [], ignored: [{ key: 'channel', reason: 'Customers are counted store-wide' }] },
  customers: { value: 17, ...part }, new: { value: 17, ...part }, returning: { value: 0, ...part },
  repeat_rate: { value: 5 / 17, ...part }, orders_per_customer: { value: 22 / 17, ...part },
  orders: { identified: 22, guest: 1, unknown: 1 },
  cohorts: [
    { month: '2026-08', customers: 6, months: [5, null], repeat: 5 },
    { month: '2026-09', customers: null, months: [null], repeat: null },
    { month: '2026-10', customers: 7, months: [], repeat: null },
  ],
  countries: { rows: [
    { id: 'US', label: 'US', customers: 10, net_sales: 170 },
    { id: null, label: 'Other (3 countries)', customers: 7, net_sales: 70, kind: 'other' },
    { id: null, label: 'Unknown', customers: 0, net_sales: 10, kind: 'unknown' },
  ] },
};

function render(report: object) {
  stubApi((url) => {
    if (url === '/api/stores') return [{ id: 'a', name: 'Glow Haus' }];
    if (url.startsWith('/api/analytics/context')) return CTX;
    if (url.startsWith('/api/analytics/customers')) return report;
    return [];
  });
  renderApp(<Analytics />, `/analytics?store=a&tab=customers&filters=${encodeURIComponent('{"channel":["site"]}')}`);
}
const rows = (t: HTMLElement) => within(t).getAllByRole('row').map((r) => r.textContent);

describe('Customers tab (SA-106)', () => {
  it('the tiles with their coverage, guests apart, cohorts with hidden cells, countries grouped; store-wide said', async () => {
    render(REPORT);
    const tiles = await screen.findByRole('region', { name: 'Customers' });
    expect([...tiles.querySelectorAll('.card')].map((t) => t.textContent)).toEqual([
      'Customers171 order synced before customer ids',
      'New171 order synced before customer ids',
      'Returning01 order synced before customer ids',
      'Repeat rate29%1 order synced before customer ids',
      'Orders per customer1.291 order synced before customer ids',
    ]);
    expect(within(tiles).getByText('New means no earlier order since Aug 5, the first synced order.')).toBeTruthy();
    expect(screen.getByText(/^22 orders with a customer/).textContent).toBe('22 orders with a customer · 1 guest checkout, counted apart · 1 order synced before customer ids');
    expect(rows(screen.getByRole('table', { name: 'First-order cohorts' }))).toEqual([
      'First orderCustomers+1 mo+2 mo2+ orders',
      'Aug 2026683%<583%',
      'Sep 2026<5<5<5',
      'Oct 20267<5',
    ]);
    expect(rows(screen.getByRole('table', { name: 'Customers by country' }))).toEqual([
      'CountryCustomersNet salesShare',
      'United States10$17068%',
      'Other (3 countries)7$7028%',
      'Unknown0$104%',
    ]);
    expect(screen.getByText(/Customers are counted store-wide/)).toBeTruthy();
  });

  it('with no customer to follow: why and the fix, the order counts, and no empty tables', async () => {
    const none = { value: null, status: 'unavailable', reason: 'needs_permission', note: "Shopify hasn't allowed reading the orders' customer (protected customer data)", fix: { label: 'Allow customer data for Shopify', href: '/settings/integrations?store=a' } };
    render({ ...REPORT, customers: none, new: none, returning: none, repeat_rate: none, orders_per_customer: none, missing: { reason: none.reason, note: none.note, fix: none.fix }, cohorts: [], countries: { rows: [] }, orders: { identified: 0, guest: 0, unknown: 9 } });
    expect(await screen.findByRole('region', { name: 'No customer data' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Allow customer data for Shopify' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Customers' })).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText('First-order cohorts')).toBeNull();
    expect(screen.queryByText('By country')).toBeNull();
    expect(screen.getByText(/^0 orders with a customer/).textContent).toBe('0 orders with a customer · 0 guest checkouts, counted apart · 9 orders synced before customer ids');
  });
});

