// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
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

  it('lets an approved product page whose push failed be tried again (an update, safe to repeat), or applied by hand', async () => {
    render('shopify', { ...draft, kind: 'product', productId: 'p1', status: 'approved' });
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByText(/couldn't be pushed to Clay Co\. Try again, or apply it by hand/)).toBeTruthy();
  });

  it("warns that an approved store page may be live already before it's published again (AGT-215)", async () => {
    render('shopify', { ...draft, status: 'approved' });
    expect(await screen.findByRole('button', { name: 'Publish again' })).toBeTruthy();
    expect(screen.getByText(/may be live anyway: check Clay Co's pages before you publish it again, or it goes up twice/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});

describe('Builder › a publish the store didn\'t take', () => {
  // The push failed: core notifies the owner and hands the draft back unchanged.
  const unchanged = (d: PageDraft) => {
    stubApi((url, init) => (init?.method === 'POST' ? d : url.startsWith('/api/stores') ? [store('shopify')] : url.startsWith('/api/page-drafts') ? [d] : []));
    renderApp(<Builder />, '/builder');
  };

  it('says so, and that a store page may be live anyway, instead of looking like nothing happened', async () => {
    unchanged(draft);
    fireEvent.click(await screen.findByRole('button', { name: 'Publish to Clay Co' }));
    expect(await screen.findByText(/didn't go through \(the bell says why\)\. If it timed out, the page may be live anyway: check Clay Co's pages/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Publish again' })).toBeTruthy();
  });

  it('just points to the bell for a product page, an update that is safe to repeat', async () => {
    unchanged({ ...draft, kind: 'product', productId: 'p1' });
    fireEvent.click(await screen.findByRole('button', { name: 'Publish to Clay Co' }));
    expect(await screen.findByText("It didn't go through: the bell says why.")).toBeTruthy();
    expect(screen.queryByText(/may be live anyway/)).toBeNull();
  });
});

describe('Builder › brief', () => {
  it("says up front where the Store Developer can't save a draft that could go live", async () => {
    render('amazon');
    expect(await screen.findByText("The app can't publish pages to Amazon stores yet: the Store Developer writes the page in chat for you to add by hand.")).toBeTruthy();
    cleanup();
    render('etsy');
    expect(await screen.findByText('On Etsy, only product pages publish from here: other pages come back in chat for you to add by hand.')).toBeTruthy();
    cleanup();
    render('shopify');
    await screen.findByRole('option', { name: 'Clay Co' });
    expect(screen.queryByText(/add by hand/)).toBeNull();
  });
});
