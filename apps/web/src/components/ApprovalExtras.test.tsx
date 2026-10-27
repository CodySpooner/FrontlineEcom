// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import type { ApprovalAction } from '@frontline/shared';
import { renderApp, stubApi } from '../test-utils';
import { ApprovalExtras } from './ApprovalExtras';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const action: ApprovalAction = { kind: 'store.set_price', payload: { productId: 'p1', title: 'Clay Mug', from: 20, to: 24 } };
const render = (cost: number) => {
  stubApi((url) =>
    url.startsWith('/api/products')
      ? { items: [{ id: 'p1', storeId: 'clay', title: 'Clay Mug', price: 20, cost, inventory: 5, status: 'active', margin: 0 }], total: 1 }
      : url.startsWith('/api/stores')
        ? [{ id: 'clay', name: 'Clay Co', currency: 'USD', feePercent: 9.5, feePerOrder: 0.25 }]
        : [],
  );
  renderApp(<ApprovalExtras action={action} storeId="clay" />);
};

describe('price request detail', () => {
  it('shows the margin before and after, net of cost and the fee estimate', async () => {
    render(8);
    // 20 → 49%, 24 → (24 − 8 − 2.28 − 0.25) / 24 = 56%.
    expect((await screen.findByText(/after the unit cost and fees/)).textContent).toBe('Margin 49% → 56% after the unit cost and fees');
  });

  it("stays quiet while the product has no cost (its margin isn't known)", async () => {
    render(0);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/Margin/)).toBeNull();
  });
});

describe('niche pack request detail', () => {
  it('shows the pack the owner is approving, formatted, behind Read the pack', async () => {
    stubApi(() => []);
    renderApp(<ApprovalExtras action={{ kind: 'save_niche_pack', payload: { slug: 'yoga-mats', markdown: '## Audience\n- Studio teachers' } }} storeId="zen" />);
    expect((await screen.findByText('Read the pack')).closest('details')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Audience' })).toBeTruthy();
    expect(screen.getByText('Studio teachers')).toBeTruthy();
  });
});
