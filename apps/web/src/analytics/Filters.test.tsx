// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SaListingRow } from '@frontline/shared';
import { Analytics } from '../pages/Analytics';
import { renderApp, stubApi } from '../test-utils';
import { FilterScope } from './FilterScope';
import { channelsOf } from './Filters';

const where = () => decodeURIComponent(screen.getByTestId('where').textContent!);
// The popover is closed (jsdom has no showPopover): its contents are found with hidden: true.
const hidden = { hidden: true };
const row = (id: string, title: string) => ({ id, title }) as SaListingRow;
let calls: string[];

beforeEach(() => {
  localStorage.clear();
  calls = [];
  stubApi((url) => {
    calls.push(url);
    if (url === '/api/stores') return [{ id: 'a', name: 'Glow Haus' }];
    if (url.startsWith('/api/analytics/context'))
      return { storeId: 'a', name: 'Glow Haus', niche: 'beauty', platform: 'shopify', currency: 'USD', demo: false, channels: [{ kind: 'shopify', name: 'Shopify', status: 'connected' }, { kind: 'tiktok_shop', name: 'TikTok Shop', status: 'connected' }, { kind: 'meta_ads', name: 'Meta Ads', status: 'connected' }], zone: null, zoneLabel: '', zoneAbbr: 'ET', historyStart: null, freshness: [] };
    if (url.startsWith('/api/analytics/collections')) return [{ id: 'c-best', title: 'Best sellers', source: 'shopify', products: 2 }];
    if (url.startsWith('/api/analytics/listings')) {
      const q = new URLSearchParams(url.split('?')[1]);
      if (q.get('q') === 'serum') return { rows: [row('8001', 'Vitamin C Glow Serum')] };
      if (q.get('filters')?.includes('8001')) return { rows: [row('8001', 'Vitamin C Glow Serum')] };
      return { rows: [] };
    }
    if (url.startsWith('/api/analytics/summary') || url.startsWith('/api/analytics/overview')) return new Response('{}', { status: 500 });
    return [];
  });
});
afterEach(cleanup);

describe('Filters (SA-68)', () => {
  it("names the store's sales channels: its site, then the others it sells on (not ad networks)", () => {
    expect(channelsOf({ platform: 'shopify', channels: [{ kind: 'shopify', name: 'Shopify', status: 'connected' }, { kind: 'tiktok_shop', name: 'TikTok Shop', status: 'connected' }, { kind: 'meta_ads', name: 'Meta Ads', status: 'connected' }] })).toEqual([
      { id: 'site', label: 'Shopify site' },
      { id: 'tiktok_shop', label: 'TikTok Shop' },
    ]);
    expect(channelsOf({ platform: 'etsy', channels: [] })).toEqual([{ id: 'etsy', label: 'Etsy' }]);
  });

  it('picks a channel, a product (searched through listings) and a collection; each is a chip; the button is on while any apply', async () => {
    renderApp(<Analytics />, '/analytics?store=a');
    const button = await screen.findByRole('button', { name: 'Filters' });
    expect(button.className).not.toContain('border-red/50');
    const menu = within(document.getElementById('sa-filters')!);
    fireEvent.click(await menu.findByRole('menuitemcheckbox', { name: 'TikTok Shop', ...hidden }));
    await waitFor(() => expect(where()).toContain('filters={"channel":["tiktok_shop"]}'));
    expect(calls.some((u) => u.startsWith('/api/analytics/listings'))).toBe(false); // nothing searched until typed
    fireEvent.change(menu.getByRole('textbox', { name: 'Search products', ...hidden }), { target: { value: 'serum' } });
    fireEvent.click(await menu.findByRole('menuitemcheckbox', { name: 'Vitamin C Glow Serum', ...hidden }));
    fireEvent.click(menu.getByRole('menuitemcheckbox', { name: 'Best sellers', ...hidden }));
    await waitFor(() => expect(where()).toContain('filters={"channel":["tiktok_shop"],"product":["8001"],"collection":["c-best"]}'));
    expect(menu.getByRole('menuitemcheckbox', { name: 'TikTok Shop', ...hidden }).getAttribute('aria-checked')).toBe('true');
    const chips = within(screen.getByRole('group', { name: 'Applied filters' }));
    expect(await chips.findByText('Product: Vitamin C Glow Serum')).toBeTruthy();
    expect(chips.getByText('Channel: TikTok Shop')).toBeTruthy();
    expect(chips.getByText('Collection: Best sellers')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Filters' }).className).toContain('border-red/50');

    // each panel applies a filter or names it: the current Overview names every one
    const note = await screen.findByText(/^Not applied here:/);
    for (const f of ['Channel', 'Product', 'Collection']) expect(within(note).getByText(f)).toBeTruthy();

    fireEvent.click(chips.getByRole('button', { name: 'Remove Channel: TikTok Shop' }));
    await waitFor(() => expect(where()).toContain('filters={"product":["8001"],"collection":["c-best"]}'));
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    await waitFor(() => expect(where()).not.toContain('filters='));
    expect(screen.queryByRole('group', { name: 'Applied filters' })).toBeNull();
    expect(screen.queryByText(/^Not applied here:/)).toBeNull();
  });

  it('a filter left out of several metrics for one reason is one line naming them', () => {
    render(
      <FilterScope
        scope={{
          applied: [],
          ignored: [
            { key: 'product', reason: "Demo data isn't split by product", metric: 'net_sales' },
            { key: 'product', reason: "Demo data isn't split by product", metric: 'orders' },
            { key: 'product', reason: 'Store level: not split by product', metric: 'site_conversion' },
          ],
        }}
      />,
    );
    expect(screen.getByText(/^Not applied here:/).textContent).toBe("Not applied here: Product (Demo data isn't split by product: Net sales, Orders); Product (Store level: not split by product: Site conversion)");
    cleanup();
    render(<FilterScope scope={{ applied: [], ignored: [{ key: 'channel', reason: 'Store level', metric: 'net_sales' }] }} />);
    expect(screen.getByText(/^Not applied here:/).textContent).toBe('Not applied here: Channel (Store level)'); // one metric: the panel says which
  });

  it('a filter changes the page back to 1; a store without collections says so', async () => {
    stubApi((url) => {
      if (url === '/api/stores') return [{ id: 'a', name: 'Glow Haus' }];
      if (url.startsWith('/api/analytics/context')) return { storeId: 'a', name: 'Glow Haus', niche: 'beauty', platform: 'shopify', currency: 'USD', demo: false, channels: [], zone: null, zoneLabel: '', zoneAbbr: 'ET', historyStart: null, freshness: [] };
      if (url.startsWith('/api/analytics/collections')) return [];
      if (url.startsWith('/api/analytics/summary') || url.startsWith('/api/analytics/overview')) return new Response('{}', { status: 500 });
      return [];
    });
    renderApp(<Analytics />, '/analytics?store=a&page=3');
    await screen.findByRole('button', { name: 'Filters' });
    const menu = within(document.getElementById('sa-filters')!);
    expect(await menu.findByText('No collections synced for this store.')).toBeTruthy();
    fireEvent.click(await menu.findByRole('menuitemcheckbox', { name: 'Shopify site', ...hidden }));
    await waitFor(() => expect(where()).toContain('filters={"channel":["site"]}'));
    expect(where()).not.toContain('page=');
  });
});
