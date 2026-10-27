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

  it('says a request for the product is already waiting when core hands back the pending one', async () => {
    stubApi((url) => (url.startsWith('/api/stores') ? [store('shop1', 'Peak Fit', 'shopify')] : url.includes('add-to-store') ? { id: 'a0', createdAt: '2026-10-20T08:00:00Z' } : []));
    renderApp(<ProductDetails p={product} />);
    await screen.findByRole('option', { name: 'Peak Fit' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Store' }), { target: { value: 'shop1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request to add' }));
    await screen.findByText(/Peak Fit already has a request waiting for this product/);
    expect(screen.queryByText(/Sent to/)).toBeNull();
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

describe('research results', () => {
  it('heads the grid with its count (an h2 over the h3 product cards), singular for one', async () => {
    stubApi((url) => (url.startsWith('/api/research?') ? { items: [product], total: 1, offset: 0, limit: 30 } : []));
    renderApp(<Research />);
    expect(await screen.findByRole('heading', { level: 2, name: '1 product, best first' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: product.title })).toBeTruthy();
  });
});

describe('a custom-niche store', () => {
  it("can narrow research to its own niche's finds, and AI Research briefs it in plain words", async () => {
    const yoga = { ...store('zen', 'Zen Studio', 'shopify'), niche: 'other', nicheDetail: 'Yoga mats' } as Store;
    const fetch = stubApi((url, init) => {
      if (init?.method === 'POST') return { id: 'r1', agentId: 'zen:product_hunter', status: 'queued', transcript: [] };
      if (url.startsWith('/api/stores')) return [yoga];
      if (url.startsWith('/api/research?')) return { items: [], total: 0, offset: 0, limit: 30 };
      return [];
    });
    renderApp(<Research />);
    await screen.findByRole('option', { name: 'Yoga mats' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Niche' }), { target: { value: 'other:yoga-mats' } });
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('niche=other%3Ayoga-mats'), undefined));
    fireEvent.click(screen.getByRole('button', { name: 'AI Research' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/agents/zen%3Aproduct_hunter/runs', expect.objectContaining({ method: 'POST' })));
    const post = fetch.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(String(post[1]!.body)).task).toContain('Find 5 new winning Yoga mats products');
  });
});

describe('the sample research catalog', () => {
  it('is labelled once a real store is connected, so its made-up numbers are not read as finds', async () => {
    stubApi((url) => (url.startsWith('/api/stores') ? [store('shop1', 'Peak Fit', 'shopify')] : []));
    renderApp(<ProductDetails p={product} />);
    expect(await screen.findByText(/made-up demand and competition/)).toBeTruthy();
    cleanup();
    renderApp(<ProductDetails p={{ ...product, id: 'find-1' }} />);
    await screen.findByRole('option', { name: 'Peak Fit' });
    expect(screen.queryByText(/made-up demand and competition/)).toBeNull();
  });

  it('is not labelled in demo mode, where every store and number is sample', async () => {
    stubApi((url) => (url.startsWith('/api/stores') ? [{ ...store('shop1', 'Peak Fit', 'shopify'), connected: false }] : []));
    renderApp(<ProductDetails p={product} />);
    await screen.findByRole('option', { name: 'Peak Fit' });
    expect(screen.queryByText(/made-up demand and competition/)).toBeNull();
  });
});
