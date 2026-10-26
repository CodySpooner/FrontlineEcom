// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { AnalyticsSummary, Product, Store } from '@frontline/shared';
import { renderApp, reply, stubApi } from '../test-utils';
import { FunnelPanel, TopTable, UnitCosts } from './Analytics';

const product = (id: string, cost: number): Product => ({ id, storeId: 'etsy-shop', title: `Mug ${id}`, price: 24, cost, inventory: 10, status: 'active', margin: 0 });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Unit costs', () => {
  it('lists only products without a cost and saves the one the owner enters', async () => {
    const fetch = stubApi((url, init) => {
      if (init?.method === 'PATCH') return product('m1', 7.5);
      if (url.startsWith('/api/products')) return { items: [product('m1', 0), product('m2', 6)], total: 2 };
    });
    renderApp(<UnitCosts ids={[]} multi={false} />);

    fireEvent.change(await screen.findByLabelText('Unit cost of Mug m1'), { target: { value: '7.50' } });
    expect(screen.queryByLabelText('Unit cost of Mug m2')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save cost' }));

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/products/etsy-shop/m1', expect.objectContaining({ method: 'PATCH', body: '{"cost":7.5}' })));
  });

  it("shows the API's reason when the store keeps costs itself", async () => {
    stubApi((url, init) => {
      if (init?.method === 'PATCH') return reply({ error: 'Shopify keeps unit costs' }, 400);
      if (url.startsWith('/api/products')) return { items: [product('m1', 0)], total: 1 };
    });
    renderApp(<UnitCosts ids={[]} multi={false} />);

    fireEvent.change(await screen.findByLabelText('Unit cost of Mug m1'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save cost' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Shopify keeps unit costs');
  });
});

describe('Conversion funnel with no sessions', () => {
  const s = { funnel: { sessions: 0, addToCarts: 0, checkouts: 0, orders: 12 } } as AnalyticsSummary;
  const store = (platform: Store['platform'], connected: boolean): Store => ({ id: 's1', name: 'Shop', platform, niche: 'pet', currency: 'USD', timezone: 'UTC', color: '#f00', connected });

  it("points a connected Shopify store at Shopify's own reports as well as GA4", async () => {
    stubApi((url) => (url.startsWith('/api/stores') ? [store('shopify', true)] : []));
    renderApp(<FunnelPanel s={s} />);
    expect(await screen.findByText(/read_reports/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Connect GA4' })).toBeTruthy();
  });

  it('only mentions GA4 when no connected Shopify store is in view', async () => {
    stubApi((url) => (url.startsWith('/api/stores') ? [store('shopify', false)] : []));
    renderApp(<FunnelPanel s={s} />);
    expect(await screen.findByRole('link', { name: 'Connect GA4' })).toBeTruthy();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/read_reports/)).toBeNull();
  });
});

describe('product photos', () => {
  const imgs = () => [...document.querySelectorAll('img')].map((i) => i.getAttribute('src'));

  it("shows a store's product photos once any listed product has one, a blank tile for the rest", async () => {
    stubApi((url) => (url.startsWith('/api/products') ? { items: [{ ...product('a', 0), image: 'https://cdn.example/a.jpg' }, product('b', 0)], total: 2 } : []));
    renderApp(<UnitCosts ids={[]} multi={false} />);
    await screen.findByText('Mug b');
    expect(imgs()).toEqual(['https://cdn.example/a.jpg']);
    expect(document.querySelectorAll('[data-thumb]')).toHaveLength(2);
  });

  it('leaves the column out when no product has a photo (demo stores)', () => {
    renderApp(<TopTable rows={[{ storeId: 's', productId: 'p', title: 'Collar', units: 3, revenue: 60, profit: 30 }]} stock={() => undefined} />);
    expect(screen.getByText('Collar')).toBeTruthy();
    expect(document.querySelectorAll('[data-thumb]')).toHaveLength(0);
  });
});
