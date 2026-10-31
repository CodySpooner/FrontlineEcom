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
  netSales: V(100), units: V(5), refunds: V(0), refundRate: V(0), contribution: V(40), collections: [], costCoverage: V(1), ...more,
});
const ALL = Array.from({ length: 64 }, (_, i) => row(i + 1));

/** A listings API over `rows`, 25 a page; `variants` answers a row's variants (SA-83); compare answers their rows (SA-86). */
function render(rows: SaListingRow[], path = '/analytics?store=a&tab=listings', ui = <Analytics />, variants: () => unknown = () => ({ rows: [] })) {
  const fetch = stubApi((url) => {
    if (url === '/api/stores') return [{ id: 'a', name: 'Glow Haus' }];
    if (url.startsWith('/api/analytics/context')) return CTX;
    if (url.startsWith('/api/analytics/listings/')) return variants();
    if (url.startsWith('/api/analytics/compare')) {
      const ids = new URL(url, 'http://x').searchParams.get('products')!.split(',');
      return { period: PERIOD, definitions: ['units@1', 'net_sales@1'], rows: ids.map((id) => rows.find((r) => r.id === id)), scope: { applied: ['product'], ignored: [] } };
    }
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
/** The tab as SA-88 will mount it, rows opening through `onOpen`. */
function Tab({ onOpen }: { onOpen: (id: string) => void }) {
  const s = useAnalyticsState();
  return s.store ? <ListingsTab s={{ ...s, store: s.store }} onOpen={onOpen} /> : null;
}
const bodyRows = async () => (await screen.findAllByRole('row')).slice(1);
/** A row's cells after the checkbox column (SA-85). */
const cells = (tr: HTMLElement) => [...tr.querySelectorAll('td')].slice(1).map((td) => td.textContent);

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
    expect((await bodyRows())[0]!.getAttribute('tabindex')).toBe('0'); // the page opens a row in its drawer (SA-88)
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
    const td = (r: number, c: number) => rows[r]!.querySelectorAll('td')[c + 1]!; // after the checkbox
    expect([td(0, 4).className, td(1, 4).className, td(2, 4).className]).toEqual(['text-right text-amber', 'text-right text-red', 'text-right text-amber']);
    expect(td(3, 9).querySelector('span')!.title).toBe('TikTok Shop: image under 600 px');
    expect(td(3, 1).querySelector('span span')!.getAttribute('title')).toBe('TikTok Shop · failed');
    expect(td(4, 4).title).toBe('Amazon manages this stock (FBA): no cover estimate');
  });

  it('↑/↓ move between rows, Enter or a click opens the row', async () => {
    const open = vi.fn();
    render(ALL.slice(0, 3), '/analytics?store=a', <Tab onOpen={open} />);
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

  it('a product with variants expands to indented variant rows with their own sales, or the note when none are recorded (SA-83)', async () => {
    const open = vi.fn();
    const variant = (id: string, title: string, sku: string, stock: number, more: object) => ({ id, title, sku, price: 18, stock, stockState: 'in_stock', units: V(41), netSales: V(738), refunds: V(18), contribution: V(395), ...more });
    const fetch = render([row(1), row(3, { title: 'Overnight Lip Mask', sku: null, variants: 3, variantsOut: 1 })], '/analytics?store=a', <Tab onOpen={open} />, () => ({
      rows: [variant('v1', 'Berry', 'GH-OLM-BER', 312, { units: V(131), netSales: V(2358) }), variant('v3', 'Mint', 'GH-OLM-MNT', 22, { stockState: 'low', coverDays: 4 })],
    }));
    const rows = await bodyRows();
    expect(within(rows[0]!).queryByRole('button')).toBeNull(); // one variant: nothing to expand
    const show = within(rows[1]!).getByRole('button', { name: 'Show the variants of Overnight Lip Mask' });
    fireEvent.click(show);
    expect(show.getAttribute('aria-expanded')).toBe('true');
    expect(open).not.toHaveBeenCalled(); // expanding doesn't open the product
    await screen.findByText('Berry');
    const all = await bodyRows();
    expect(all.slice(2).map(cells)).toEqual([
      ['Berry · GH-OLM-BER', '', '', '$18.00', '312', '131', '$2,358', '$18', '$395', ''],
      ['Mint · GH-OLM-MNT', '', '', '$18.00', '22 · ~4 d', '41', '$738', '$18', '$395', ''],
    ]);
    expect(all.slice(2).map((r) => [r.getAttribute('tabindex'), r.querySelectorAll('input, button').length])).toEqual([[null, 0], [null, 0]]); // no checkbox, not a row stop
    expect(decodeURIComponent(String(fetch.mock.calls.map((c) => c[0]).find((u) => String(u).startsWith('/api/analytics/listings/p3/variants?'))))).toContain('compare=none');
    fireEvent.click(screen.getByRole('button', { name: 'Hide the variants of Overnight Lip Mask' }));
    expect(screen.queryByText('Berry')).toBeNull();

    cleanup();
    const none = { value: null, status: 'unavailable', reason: 'not_tracked', note: 'Variant sales not recorded yet' };
    render([row(3, { title: 'Overnight Lip Mask', variants: 3 })], undefined, undefined, () => ({ rows: [variant('v1', 'Berry', 'GH-OLM-BER', 312, { units: none, netSales: none, refunds: none, contribution: none })], note: 'Variant sales not recorded yet' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Show the variants of Overnight Lip Mask' }));
    expect(await screen.findByText('Variant sales not recorded yet')).toBeTruthy();
    expect(cells((await bodyRows())[1]!)).toEqual(['Berry · GH-OLM-BER', '', '', '$18.00', '312', '–', '–', '–', '–', '']); // never zeros
  });

  it('Columns shows, hides and orders the optional columns, kept in the URL; the page stays (SA-84)', async () => {
    const rows = ALL.map((r, i) => (i === 25 ? { ...r, sku: 'GH-1', compareAt: 59.99, collections: ['Face care', 'Best sellers'], costCoverage: V(0.75) } : i === 26 ? { ...r, title: 'Combo', variants: 2 } : r));
    const variant = { id: 'v1', title: 'Red', sku: 'X', price: 1, stock: 1, stockState: 'in_stock', units: V(1), netSales: V(1), refunds: V(0), contribution: V(1) };
    render(rows, '/analytics?store=a&tab=listings&page=2&cols=bogus,sku', undefined, () => ({ rows: [variant] }));
    const heads = () => screen.getAllByRole('columnheader').map((th) => th.textContent);
    const DEFAULT = ['', 'Product', 'Channels', 'Status', 'Price', 'Stock', 'Units ↓', 'Net sales', 'Refunds', 'Contribution'];
    const menu = (role: 'menuitem' | 'menuitemcheckbox', name: string) => within(document.getElementById('sa-listings-columns')!).getByRole(role, { name, hidden: true }) as HTMLButtonElement;
    await screen.findByText(/^26–50 of 64/);
    expect(heads()).toEqual([...DEFAULT, 'SKU', 'Synced']); // an unknown id is dropped

    for (const name of ['Compare-at price', 'Cost coverage', 'Collection']) fireEvent.click(menu('menuitemcheckbox', name));
    await waitFor(() => expect(heads()).toEqual([...DEFAULT, 'SKU', 'Compare-at price', 'Cost coverage', 'Collection', 'Synced']));
    expect(cells((await bodyRows())[0]!).slice(9)).toEqual(['GH-1', '$59.99', '75.0%', 'Face care, Best sellers', '–']);
    fireEvent.click(menu('menuitem', 'Move Collection up'));
    fireEvent.click(menu('menuitemcheckbox', 'SKU'));
    await waitFor(() => expect(heads()).toEqual([...DEFAULT, 'Compare-at price', 'Collection', 'Cost coverage', 'Synced']));
    expect([menu('menuitem', 'Move Compare-at price up').disabled, menu('menuitem', 'Move Cost coverage down').disabled]).toEqual([true, true]);
    const where = decodeURIComponent(screen.getByTestId('where').textContent!);
    expect(where).toContain('cols=compare_at,collection,cost_coverage');
    expect(where).toContain('page=2'); // a column isn't a filter

    fireEvent.click(screen.getByRole('button', { name: 'Show the variants of Combo' }));
    await screen.findByText('Red');
    expect(cells((await bodyRows())[2]!)).toHaveLength(13); // after the checkbox cell, the variant row lines up under the optional columns
  });
});

describe('Listings export (SA-85)', () => {
  it("Export downloads the table's query; checked rows, kept across pages, export on their own until the matching set changes", async () => {
    const open = vi.fn();
    const fetch = render(ALL, '/analytics?store=a&stock=low', <Tab onOpen={open} />);
    await screen.findByText(/^1–25 of 64/);
    const href = (name: string) => new URL(screen.getByRole('link', { name }).getAttribute('href')!, 'http://x');
    const asked = new URL(fetch.mock.calls.map((c) => String(c[0])).find((u) => u.startsWith('/api/analytics/listings?'))!, 'http://x').searchParams;
    asked.delete('page');
    expect([href('Export').pathname, href('Export').searchParams.toString(), href('Export').searchParams.get('stock')]).toEqual(['/api/analytics/export/listings', asked.toString(), 'low']);
    const picked = () => [...new Set(href('Export selected').searchParams.get('products')!.split(','))].sort();
    const bar = () => screen.queryByRole('toolbar', { name: 'Selected listings' });
    const page = () => screen.getByRole('checkbox', { name: 'Select the listings on this page' }) as HTMLInputElement;
    expect(bar()).toBeNull();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Product 02' }));
    expect(open).not.toHaveBeenCalled(); // a checkbox doesn't open its row
    expect([bar()!.textContent, picked()]).toEqual([expect.stringContaining('1 selected'), ['p2']]);
    expect(href('Export selected').searchParams.get('stock')).toBe('low');
    fireEvent.click(page());
    expect([page().checked, picked().length]).toEqual([true, 25]);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText(/^26–50 of 64/);
    expect(page().checked).toBe(false);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Product 30' }));
    expect(picked()).toHaveLength(26);
    expect(picked()).toContain('p30');
    fireEvent.click(page());
    fireEvent.click(page()); // every row of this page off again: page 1's stay
    expect(picked()).toEqual(ALL.slice(0, 25).map((r) => r.id).sort());
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(bar()).toBeNull();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Product 30' }));
    fireEvent.click(item('stock', 'menuitemradio', 'Out of stock'));
    await screen.findByText(/^1–25 of 64/);
    expect(bar()).toBeNull(); // another matching set: the checks are dropped
  });
});

describe('Compare (SA-86)', () => {
  it('2 to 4 checked listings open side by side, in the order checked', async () => {
    const rows = ALL.map((r, i) => (i === 2 ? { ...r, netSales: V(250), refundRate: V(null, { status: 'unavailable', note: 'Refunds not synced' }) } : r));
    const fetch = render(rows);
    await screen.findByText(/^1–25 of 64/);
    const compare = () => screen.getByRole('button', { name: 'Compare' }) as HTMLButtonElement;
    const check = (n: string) => fireEvent.click(screen.getByRole('checkbox', { name: `Select Product ${n}` }));
    check('03');
    expect(compare().disabled).toBe(true);
    check('01');
    fireEvent.click(compare());
    const dialog = await screen.findByRole('dialog', { name: 'Compare products' });
    const table = await within(dialog).findByRole('table', { name: 'Compared products' });
    expect(fetch.mock.calls.map((c) => String(c[0])).find((u) => u.startsWith('/api/analytics/compare?'))).toContain('products=p3%2Cp1');
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['', 'Product 03Active', 'Product 01Active']);
    const line = (name: string) => [...within(table).getByRole('rowheader', { name }).parentElement!.querySelectorAll('td')].map((td) => td.textContent);
    expect([line('Price'), line('Stock'), line('Net sales'), line('Refund rate')]).toEqual([['$10.00', '$10.00'], ['100', '100'], ['$250', '$100'], ['–', '0.0%']]);
    expect(within(table).getByRole('rowheader', { name: 'Refund rate' }).parentElement!.querySelector('td span')!.getAttribute('title')).toBe('Refunds not synced');
    expect(within(dialog).getByText('Definitions: units@1, net_sales@1')).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    for (const n of ['02', '04']) check(n);
    expect(compare().disabled).toBe(false); // 4
    check('05');
    expect([compare().disabled, compare().title]).toEqual([true, 'Check 2 to 4 listings to compare them']);
  });
});
