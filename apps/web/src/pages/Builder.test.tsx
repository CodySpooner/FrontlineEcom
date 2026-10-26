// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import type { PageDraft, Store } from '@frontline/shared';
import { renderApp, stubApi } from '../test-utils';
import { Builder } from './Builder';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const store = (platform: Store['platform']): Store => ({ id: 's1', name: 'Clay Co', platform, niche: 'home', currency: 'USD', timezone: 'UTC', color: '#f00', connected: true });
const draft: PageDraft = { id: 'd1', storeId: 's1', agentId: 's1:store_developer', kind: 'page', title: 'FAQ', html: '<h1>FAQ</h1>', notes: '', status: 'draft', createdAt: '2026-10-26T08:00:00Z' };
const render = (platform: Store['platform'], d: PageDraft = draft) => {
  stubApi((url) => (url.startsWith('/api/stores') ? [store(platform)] : url.startsWith('/api/page-drafts') ? [d] : []));
  renderApp(<Builder />, '/builder');
};

describe('Builder › publishing a draft', () => {
  it('offers to publish to a connected Shopify store', async () => {
    render('shopify');
    expect(await screen.findByRole('button', { name: 'Publish to Clay Co' })).toBeTruthy();
  });

  it('offers it on the platforms agents can publish that kind of page to (pages: Shopify and Woo; product pages: + Etsy)', async () => {
    render('woocommerce');
    expect(await screen.findByRole('button', { name: 'Publish to Clay Co' })).toBeTruthy();
    cleanup();
    render('etsy', { ...draft, kind: 'product', productId: 'p1' });
    expect(await screen.findByRole('button', { name: 'Publish to Clay Co' })).toBeTruthy();
  });

  it("says to copy it over by hand when the app can't publish that page there", async () => {
    render('etsy');
    expect(await screen.findByText(/can't publish this kind of page to Etsy yet/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Publish to Clay Co' })).toBeNull();
  });
});
