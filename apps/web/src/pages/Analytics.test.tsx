// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { Product } from '@frontline/shared';
import { renderApp, reply, stubApi } from '../test-utils';
import { UnitCosts } from './Analytics';

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
