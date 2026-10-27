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

describe("a rival's ads", () => {
  it("say only demo competitors have recorded ads and link to Meta's Ad Library, without claiming 0 active ads", async () => {
    stubApi((url) =>
      url === '/api/stores'
        ? [{ id: 'eu', name: 'Euro Shop', platform: 'shopify', niche: 'home', color: '#ff2a3a', currency: 'EUR', timezone: 'UTC' }]
        : url === '/api/competitors'
          ? [{ id: 'c1', storeId: 'eu', name: 'Wag & Wander', url: 'https://wagwander.com', createdAt: '2026-10-26T08:00:00Z', productsTracked: 12, activeAds: 0 }]
          : url.startsWith('/api/competitors/c1/snapshots')
            ? []
            : undefined,
    );
    renderApp(<Competitors />, '/competitors');
    expect(await screen.findByText(/Ads are recorded for demo competitors only/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Meta's Ad Library/ }).getAttribute('href')).toContain('q=Wag+%26+Wander');
    expect(screen.getByText('12 products tracked')).toBeTruthy();
  });
});
