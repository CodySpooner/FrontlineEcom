// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SaListingRow, SaValue } from '@frontline/shared';
import { Analytics } from '../pages/Analytics';
import { renderApp, stubApi } from '../test-utils';
import { ListingsTab } from './ListingsTab';
import { useAnalyticsState } from './state';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PERIOD = { preset: 'last30', from: '2026-09-30', to: '2026-10-29', days: 30, partial: false };
const CTX = { storeId: 'a', name: 'Glow Haus', niche: 'beauty', platform: 'shopify', currency: 'USD', demo: false, channels: [{ kind: 'tiktok_shop', name: 'TikTok Shop', status: 'connected' }], zone: null, zoneLabel: '', zoneAbbr: 'ET', historyStart: null, freshness: [] };
const V = (value: number | null, more: Partial<SaValue> = {}): SaValue => ({ value, status: 'ok', ...more });
const row = (i: number, more: Partial<SaListingRow> = {}): SaListingRow => ({
  id: `p${i}`, title: `Product ${String(i).padStart(2, '0')}`, image: null, status: 'active', category: null, sku: `SKU-${i}`, variants: 1, variantsOut: 0, price: 10, compareAt: null,
  stock: 100, stockState: 'in_stock', channels: [{ channel: 'site', status: 'active', error: null }], syncedAt: null,
  netSales: V(100), units: V(5), refunds: V(0), refundRate: V(0), contribution: V(40), ...more,
});
const ALL = Array.from({ length: 64 }, (_, i) => row(i + 1));

/** A listings API over `rows`, 25 a page. */
function render(rows: SaListingRow[], path = '/analytics?store=a&tab=listings', ui = <Analytics />) {
  const fetch = stubApi((url) => {
    if (url === '/api/stores') return [{ id: 'a', name: 'Glow Haus' }];
    if (url.startsWith('/api/analytics/context')) return CTX;
    if (url.startsWith('/api/analytics/listings')) {
      const page = Number(new URL(url, 'http://x').searchParams.get('page'));
      const counts = { active: rows.length, draft: 0, archived: 0, all: rows.length };
      return { period: PERIOD, status: 'active', sort: 'units:desc', page, pageSize: 25, total: rows.length, counts, variants: rows.length + 3, channelListings: rows.length + 1, rows: rows.slice((page - 1) * 25, page * 25), scope: { applied: [], ignored: [] } };
    }
    return [];
  });
  renderApp(ui, path);
  return fetch;
}
// The popovers are closed (jsdom has no showPopover): their items are found with hidden: true.
const item = (menu: string, role: 'menuitemradio' | 'menuitemcheckbox', name: string) => within(document.getElementById(`sa-listings-${menu}`)!).getByRole(role, { name, hidden: true });
const bodyRows = async () => (await screen.findAllByRole('row')).slice(1);
const cells = (tr: HTMLElement) => [...tr.querySelectorAll('td')].map((td) => td.textContent);

describe('Listings table (SA-82)', () => {
  it('every active listing is reachable by paging, and the footer counts them', async () => {
    render(ALL);
    const seen: string[] = [];
    for (let page = 1; ; page++) {
      await screen.findByText(`${(page - 1) * 25 + 1}–${Math.min(page * 25, 64)} of 64 active listings · 67 variants · 65 channel listings`);
      seen.push(...(await bodyRows()).map((tr) => tr.querySelector('b')!.textContent!));
      const next = screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement;
      if (next.disabled) break;
      fireEvent.click(next);
    }
    expect(seen).toEqual(ALL.map((r) => r.title));
    expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/Listings that are active now, with their sales from Sep 30 – Oct 29/)).toBeTruthy();
    expect((await bodyRows())[0]!.getAttribute('tabindex')).toBeNull(); // no drawer yet (SA-88): rows do nothing
  });

  it("each stock state, no sales, the refund rate, no unit cost and a failed sync read as the board's cells", async () => {
    render([
      row(1, { title: 'Hydra', stock: 38, stockState: 'low', coverDays: 5.1 }),
      row(2, { title: 'Clay', stock: 0, stockState: 'out', units: V(0), netSales: V(0), refunds: V(0), refundRate: V(null), contribution: V(null, { status: 'unavailable', reason: 'not_tracked' }) }),
      row(3, { title: 'Jade', sku: null, variants: 2, variantsOut: 1, stock: 57 }),
      row(4, { title: 'Scrunchie', stock: null, stockState: 'not_tracked', channels: [{ channel: 'tiktok_shop', status: 'failed', error: 'image under 600 px' }] }),
      row(5, { title: 'Amazon', stock: 120, stockState: 'fba' }),
      row(6, { title: 'Dropship', stock: null, stockState: 'supplier', status: 'draft' }),
      row(7, { title: 'Retinol', price: 39, refunds: V(78), refundRate: V(0.021), contribution: V(null, { status: 'unavailable', reason: 'not_tracked', note: 'None of the units sold have a unit cost' }), syncedAt: new Date(Date.now() - 6 * 60_000).toISOString() }),
    ]);
    const rows = await bodyRows();
    expect(rows.map(cells)).toEqual([
      ['HydraSKU-1 · 1 variant', 'SH', 'Active', '$10.00', '38 · ~5 d', '5', '$100', '$00.0%', '$40', '–'],
      ['ClaySKU-2 · 1 variant', 'SH', 'Active', '$10.00', '0 · out', '0', 'No sales', '–', '–', '–'],
      ['Jade2 variants · 1 out of stock', 'SH', 'Active', '$10.00', '57 · 1 out', '5', '$100', '$00.0%', '$40', '–'],
      ['ScrunchieSKU-4 · 1 variant', 'TK', 'Active', '$10.00', 'Not tracked', '5', '$100', '$00.0%', '$40', 'Failed'],
      ['AmazonSKU-5 · 1 variant', 'SH', 'Active', '$10.00', '120 · FBA', '5', '$100', '$00.0%', '$40', '–'],
      ['DropshipSKU-6 · 1 variant', 'SH', 'Draft', '$10.00', 'Supplier-managed', '5', '$100', '$00.0%', '$40', '–'],
      ['RetinolSKU-7 · 1 variant', 'SH', 'Active', '$39.00', '100', '5', '$100', '$782.1%', 'No unit cost', '6 min'],
    ]);
    const td = (r: number, c: number) => rows[r]!.querySelectorAll('td')[c]!;
    expect([td(0, 4).className, td(1, 4).className, td(2, 4).className]).toEqual(['text-right text-amber', 'text-right text-red', 'text-right text-amber']);
    expect(td(3, 9).querySelector('span')!.title).toBe('TikTok Shop: image under 600 px');
    expect(td(3, 1).querySelector('span span')!.getAttribute('title')).toBe('TikTok Shop · failed');
    expect(td(4, 4).title).toBe('Amazon manages this stock (FBA): no cover estimate');
  });

  it('↑/↓ move between rows, Enter or a click opens the row', async () => {
    const open = vi.fn();
    function Tab() {
      const s = useAnalyticsState();
      return s.store ? <ListingsTab s={{ ...s, store: s.store }} onOpen={open} /> : null;
    }
    render(ALL.slice(0, 3), '/analytics?store=a', <Tab />);
    const rows = await bodyRows();
    expect(rows.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
    rows[0]!.focus();
    fireEvent.keyDown(rows[0]!, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[2]);
    fireEvent.keyDown(rows[2]!, { key: 'ArrowDown' }); // the last row stays
    fireEvent.keyDown(rows[2]!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(rows[1]!, { key: 'Enter' });
    fireEvent.click(rows[2]!);
    expect(open.mock.calls).toEqual([['p2'], ['p3']]);
  });

  it('status, search, filters and the sort go to the API over the whole set, each back to page 1', async () => {
    const fetch = render(ALL, '/analytics?store=a&tab=listings&page=2');
    const last = () => decodeURIComponent(String(fetch.mock.calls.map((c) => c[0]).filter((u) => String(u).startsWith('/api/analytics/listings')).at(-1)));
    const where = () => screen.getByTestId('where').textContent!;
    await screen.findByText(/^26–50 of 64/);
    expect(last()).toContain('compare=none');
    expect(last()).toContain('page=2');

    fireEvent.click(item('stock', 'menuitemradio', 'Low cover'));
    await waitFor(() => expect(last()).toContain('stock=low'));
    expect(last()).toContain('page=1');
    expect(where()).not.toContain('page=');
    expect(screen.getByRole('button', { name: /Stock\s*Low cover/ })).toBeTruthy();

    fireEvent.click(item('more', 'menuitemcheckbox', 'Missing unit cost'));
    await waitFor(() => expect(last()).toContain('cost=missing'));
    fireEvent.click(item('channel', 'menuitemcheckbox', 'TikTok Shop'));
    await waitFor(() => expect(last()).toContain('filters={"channel":["tiktok_shop"]}'));
    fireEvent.click(item('sales', 'menuitemradio', 'No sales'));
    await waitFor(() => expect(last()).toContain('sales=none'));

    const th = within(screen.getByRole('table', { name: 'Listings' })).getByRole('button', { name: 'Net sales' }).closest('th')!;
    fireEvent.click(within(th).getByRole('button'));
    await waitFor(() => expect(last()).toContain('sort=net_sales:desc'));
    expect(th.getAttribute('aria-sort')).toBe('descending');
    fireEvent.click(within(th).getByRole('button'));
    await waitFor(() => expect(last()).toContain('sort=net_sales:asc'));

    fireEvent.click(screen.getByRole('radio', { name: /^Draft/ }));
    await waitFor(() => expect(last()).toContain('status=draft'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search listings' }), { target: { value: 'serum' } });
    await waitFor(() => expect(last()).toContain('q=serum'));
    expect(last()).toMatch(/stock=low.*sales=none.*cost=missing/);
  });
});
