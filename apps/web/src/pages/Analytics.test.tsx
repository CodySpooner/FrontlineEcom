// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { AnalyticsSummary, Product, Store } from '@frontline/shared';
import { renderApp, reply, stubApi } from '../test-utils';
import { FunnelPanel, TopProducts, TopTable, UnitCosts } from './Analytics';

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
    // Active products only (an archived one won't sell again), margin-first: a cost of 0 is a 100% margin, so every
    // missing cost comes before the 200-product page ends, however big the catalog.
    expect(fetch.mock.calls.some(([u]) => String(u).includes('status=active&sort=margin&dir=desc'))).toBe(true);
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

describe('Conversion funnel with steps the platform does not report', () => {
  it("leaves out Amazon's missing cart and checkout steps, and compares orders to sessions", async () => {
    stubApi(() => []);
    renderApp(<FunnelPanel s={{ funnel: { sessions: 1000, addToCarts: 0, checkouts: 0, orders: 50 } } as AnalyticsSummary} />);
    expect(await screen.findByText('Ordered')).toBeTruthy();
    expect(screen.queryByText('Added to cart')).toBeNull();
    expect(screen.queryByText('Reached checkout')).toBeNull();
    expect(screen.getByText('5.0% of previous')).toBeTruthy();
    expect(screen.getByText(/doesn't report are left out/)).toBeTruthy();
  });

  it('keeps a real zero: sessions but no carts and no orders', async () => {
    stubApi(() => []);
    renderApp(<FunnelPanel s={{ funnel: { sessions: 40, addToCarts: 0, checkouts: 0, orders: 0 } } as AnalyticsSummary} />);
    expect(await screen.findByText('Added to cart')).toBeTruthy();
    expect(screen.queryByText(/left out/)).toBeNull();
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

describe('top products stock', () => {
  it("reads each row's own stock, so a best seller deep in a big catalog still shows it", async () => {
    const fetch = stubApi((url) =>
      url.startsWith('/api/analytics/top-products') ? [{ storeId: 's', productId: 'p9', title: 'Kettlebell', units: 300, revenue: 9000, profit: 3000, inventory: 40, inventoryTracked: true, status: 'active' }] : [],
    );
    renderApp(<TopProducts ids={[]} range={30} />);
    expect(await screen.findByText('40 left · ~4 days')).toBeTruthy();
    expect(fetch.mock.calls.some(([u]) => String(u).startsWith('/api/products'))).toBe(false);
  });
});
