// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SaListingRow, SaProductDetail, SaValue } from '@frontline/shared';
import { Analytics } from '../pages/Analytics';
import { renderApp, stubApi } from '../test-utils';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PERIOD = { preset: 'last30', from: '2026-09-30', to: '2026-10-29', days: 30, partial: false } as const;
const CTX = { storeId: 'a', name: 'Glow Haus', niche: 'beauty', platform: 'shopify', currency: 'USD', demo: false, channels: [{ kind: 'tiktok_shop', name: 'TikTok Shop', status: 'connected' }], zone: null, zoneLabel: '', zoneAbbr: 'ET', historyStart: null, freshness: [] };
const V = (value: number | null): SaValue => ({ value, status: 'ok' });
const row = (i: number, more: Partial<SaListingRow> = {}): SaListingRow => ({
  id: `p${i}`, title: `Product ${i}`, image: null, status: 'active', category: 'Skincare', sku: `SKU-${i}`, variants: 1, variantsOut: 0, price: 10, compareAt: null,
  stock: 38, stockState: 'low', coverDays: 5.1, channels: [], syncedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
  netSales: V(100), units: V(5), refunds: V(0), refundRate: V(0), contribution: V(40), collections: [], costCoverage: V(1), ...more,
});
const ROWS = [row(1), row(2)];
const channel = (c: string, status: string | null, error: string | null = null) => ({ channel: c, status, error, syncedAt: null, publishedAt: null, units: V(1), netSales: V(1), refunds: V(0) });
const detail = (r: SaListingRow): SaProductDetail => ({
  period: PERIOD, compare: null, row: r, metrics: [], units: { grain: 'day', points: [] },
  channels: [channel('site', 'active'), channel('tiktok_shop', 'failed', 'Image under 600 px'), channel('amazon', null)],
  costs: { unitCost: null, fees: V(1), feeRule: { percent: 2.9, perOrder: 0.3 } }, variants: { rows: [] }, insights: [],
  scope: { applied: [], ignored: [{ key: 'collection', reason: 'The drawer shows the one product' }] },
});

function render(path: string) {
  const fetch = stubApi((url) => {
    if (url === '/api/stores') return [{ id: 'a', name: 'Glow Haus' }];
    if (url.startsWith('/api/analytics/context')) return CTX;
    if (url.startsWith('/api/analytics/products/')) return detail(ROWS.find((r) => url.startsWith(`/api/analytics/products/${r.id}?`))!);
    if (url.startsWith('/api/analytics/listings'))
      return { period: PERIOD, status: 'active', sort: 'units:desc', page: 1, pageSize: 25, total: 2, counts: { active: 2, draft: 0, archived: 0, all: 2 }, variants: 2, channelListings: 0, rows: ROWS, scope: { applied: [], ignored: [] } };
    return [];
  });
  renderApp(<Analytics />, path);
  return fetch;
}
const where = () => screen.getByTestId('where').textContent!;

describe('Product drawer (SA-88)', () => {
  it('a Listings row opens it with its header facts and pills; Esc closes it and focus returns to the row', async () => {
    const fetch = render('/analytics?store=a&tab=listings&filters=%7B%22collection%22%3A%5B%22c1%22%5D%7D');
    const rows = (await screen.findAllByRole('row')).slice(1);
    rows[1]!.focus();
    fireEvent.keyDown(rows[1]!, { key: 'Enter' });
    expect(where()).toContain('product=p2');
    const d = await screen.findByRole('dialog', { name: 'Product 2' });
    expect(within(d).getByText('SKU-2 · Skincare · Shopify product p2')).toBeTruthy();
    const pills = [...d.querySelector('header')!.querySelectorAll('span.rounded-full')].map((x) => [x.textContent, x.getAttribute('title')]);
    expect(pills).toEqual([['Active on site', null], ['Failed on TikTok Shop', 'Image under 600 px'], ['38 in stock · ~5 days', null], ['Synced 6 min ago', null]]);
    expect(within(d).getByText(/Not applied here/).textContent).toContain('Collection (The drawer shows the one product)');
    expect(fetch.mock.calls.map((c) => decodeURIComponent(String(c[0]))).find((u) => u.startsWith('/api/analytics/products/p2?'))).toContain('filters={"collection":["c1"]}');
    expect([rows[0]!.getAttribute('aria-current'), rows[1]!.getAttribute('aria-current')]).toEqual([null, 'true']);

    within(d).getByRole('button', { name: 'Close' }).focus(); // as showModal does (jsdom's stub doesn't)
    fireEvent(d, new Event('cancel', { cancelable: true })); // what Esc sends a modal dialog
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(where()).not.toContain('product=');
    expect(document.activeElement).toBe(rows[1]);
  });

  it('a link with product= opens it; a click on another row opens that one', async () => {
    render('/analytics?store=a&tab=listings&product=p1');
    expect(await screen.findByRole('dialog', { name: 'Product 1' })).toBeTruthy();
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    fireEvent.click((await screen.findAllByRole('row'))[2]!);
    expect(await screen.findByRole('dialog', { name: 'Product 2' })).toBeTruthy();
  });
});
