// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { ResearchProduct, Store } from '@frontline/shared';
import { renderApp, stubApi } from '../test-utils';
import { ProductDetails, Research } from './Research';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const store = (id: string, name: string, platform: Store['platform']): Store => ({ id, name, platform, niche: 'beauty', currency: 'USD', timezone: 'UTC', color: '#f00', connected: true });
const product: ResearchProduct = {
  id: 'r1', title: 'Ice Facial Roller', category: 'Beauty', niche: 'beauty', source: 'tiktok', cost: 2.6, price: 11.3, compareAt: 34.99, margin: 77, trend: 141, competition: 33, shippingDays: 7, score: 88,
  scoreParts: { margin: 90, trend: 80, competition: 70, shipping: 60 },
};

describe('ProductDetails › Add to a store', () => {
  it("doesn't offer a request the app can't carry out on a connected non-Shopify store", async () => {
    const fetch = stubApi((url) => (url.startsWith('/api/stores') ? [store('shop1', 'Peak Fit', 'shopify'), store('etsy1', 'Clay Co', 'etsy'), store('woo1', 'Mug Lab', 'woocommerce')] : url.includes('add-to-store') ? { id: 'a1' } : []));
    renderApp(<ProductDetails p={product} />);
    await screen.findByRole('option', { name: 'Clay Co' });
    const pick = screen.getByRole('combobox', { name: 'Store' });

    fireEvent.change(pick, { target: { value: 'etsy1' } });
    expect(screen.getByText(/can't add products to Etsy stores yet/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Request to add' })).toBeNull();

    fireEvent.change(pick, { target: { value: 'woo1' } });
    expect(screen.getByRole('button', { name: 'Request to add' })).toBeTruthy();

    fireEvent.change(pick, { target: { value: 'shop1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request to add' }));
    await screen.findByText(/Sent to Peak Fit's Product Hunter/);
    const [, init] = fetch.mock.calls.find(([u]) => String(u).includes('add-to-store'))!;
    expect(JSON.parse(String(init?.body))).toEqual({ storeId: 'shop1' });
  });
});

describe('AI Research', () => {
  it("asks the Product Hunter of the store the owner picks, not silently the first one", async () => {
    const fetch = stubApi((url, init) => {
      if (init?.method === 'POST') return { id: 'r1', agentId: 'glow:product_hunter', status: 'queued', transcript: [] };
      if (url.startsWith('/api/stores')) return [store('paws', 'Pawsome Gear', 'shopify'), store('glow', 'Glow Haus', 'shopify')];
      if (url.startsWith('/api/research?')) return { items: [], total: 0, offset: 0, limit: 30 };
      return [];
    });
    renderApp(<Research />);
    await screen.findByRole('option', { name: 'Glow Haus' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Store for AI Research' }), { target: { value: 'glow' } });
    fireEvent.click(screen.getByRole('button', { name: 'AI Research' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/agents/glow%3Aproduct_hunter/runs', expect.objectContaining({ method: 'POST' })));
  });
});
