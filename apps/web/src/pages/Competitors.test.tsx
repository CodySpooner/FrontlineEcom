// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { renderApp, stubApi } from '../test-utils';
import { Competitors } from './Competitors';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('price moves', () => {
  it("shows a rival's prices in the watching store's currency", async () => {
    stubApi((url) =>
      url === '/api/stores'
        ? [{ id: 'eu', name: 'Euro Shop', platform: 'shopify', niche: 'home', color: '#ff2a3a', currency: 'EUR', timezone: 'UTC' }]
        : url.startsWith('/api/competitors/price-changes')
          ? [{ competitorId: 'c1', storeId: 'eu', product: 'Lamp', from: 40, to: 32, changePct: -20, at: '2026-10-26T08:00:00Z' }]
          : undefined,
    );
    renderApp(<Competitors />, '/competitors');
    expect(await screen.findByText('€32.00')).toBeTruthy();
    expect(screen.getByText('€40.00')).toBeTruthy();
  });

  it("uses the rival shop's own currency when its source gave one", async () => {
    stubApi((url) =>
      url === '/api/stores'
        ? [{ id: 'eu', name: 'Euro Shop', platform: 'shopify', niche: 'home', color: '#ff2a3a', currency: 'EUR', timezone: 'UTC' }]
        : url.startsWith('/api/competitors/price-changes')
          ? [{ competitorId: 'c1', storeId: 'eu', product: 'Lamp', from: 40, to: 32, changePct: -20, at: '2026-10-26T08:00:00Z', currency: 'GBP' }]
          : undefined,
    );
    renderApp(<Competitors />, '/competitors');
    expect(await screen.findByText('£32.00')).toBeTruthy();
  });
});
