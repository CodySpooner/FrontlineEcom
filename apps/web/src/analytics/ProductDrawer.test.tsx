// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { changeOf, SA_METRICS, saDef, type SaListingRow, type SaMetricId, type SaMetricResult, type SaProductDetail, type SaValue, type SaVariantRow } from '@frontline/shared';
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
const channel = (c: string, status: string | null, error: string | null = null, publishedAt: string | null = null) => ({ channel: c, status, error, syncedAt: null, publishedAt, units: V(1), netSales: V(1), refunds: V(0) });
const metric = (id: SaMetricId, value: number | null, previous: number | null, more: Partial<SaValue> = {}): SaMetricResult => ({ id, def: saDef(id), value, status: 'ok', ...more, previous: previous == null ? null : V(previous), change: changeOf(value, previous, SA_METRICS[id].unit) });
const point = (day: string, value: number | null, more = {}) => ({ from: day, to: day, value, status: value == null ? ('unavailable' as const) : ('ok' as const), previous: null, ...more });
const detail = (r: SaListingRow, more: Partial<SaProductDetail> = {}): SaProductDetail => ({
  period: PERIOD, compare: null, row: r,
  metrics: [metric('units', 201, 178), metric('net_sales', 8442, 7484), metric('refunds', 126, 90), metric('refund_rate', 0.015, 0.012), metric('contribution_before_ads', 4390, 4000), metric('cost_coverage', 1, 1)],
  units: { grain: 'day', points: [point('2026-10-27', 4), point('2026-10-28', null), point('2026-10-29', 6, { partial: true })] },
  channels: [channel('site', 'active', null, '2026-03-04'), channel('tiktok_shop', 'failed', 'Image under 600 px'), channel('amazon', null)],
  costs: { unitCost: { value: 13.2, source: 'shopify', since: '2026-08-02' }, fees: { value: 52.1, status: 'estimated', note: 'Estimate for 41 orders' }, feeRule: { percent: 2.9, perOrder: 0.3 } },
  variants: { rows: [] },
  insights: [{ rule: 'stock_cover@1', kind: 'business', tone: 'warn', title: `${r.title}: ~5 days of stock`, detail: '38 left · 7.4 sold a day over the last 14 days', evidence: {}, target: { kind: 'product', id: r.id } }],
  rules: [{ id: 'stock_cover@1', name: 'Low stock cover', when: 'Stock lasts under 10 days', minSample: '5 units', datasets: ['orders', 'inventory'], metrics: [] }],
  links: [],
  scope: { applied: [], ignored: [{ key: 'collection', reason: 'The drawer shows the one product' }] },
  ...more,
});

function render(path: string, more: Partial<SaProductDetail> = {}, on?: (url: string, init?: RequestInit) => unknown) {
  const fetch = stubApi((url, init) => {
    const r = on?.(url, init);
    if (r !== undefined) return r;
    if (url === '/api/stores') return [{ id: 'a', name: 'Glow Haus' }];
    if (url.startsWith('/api/analytics/context')) return CTX;
    if (url.startsWith('/api/analytics/products/')) return detail(ROWS.find((r) => url.startsWith(`/api/analytics/products/${r.id}?`))!, more);
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

describe('Performance tab (SA-89)', () => {
  const open = async (more: Partial<SaProductDetail> = {}) => {
    render('/analytics?store=a&tab=listings&product=p1', more);
    const d = await screen.findByRole('dialog', { name: 'Product 1' });
    return within(await within(d).findByRole('tabpanel', { name: 'Performance' }));
  };
  const text = (els: Iterable<Element>) => [...els].map((e) => e.textContent);

  it('the mini metrics, units a day with its summary and table, the Rule card, the channel table and the price line', async () => {
    const t = await open();
    expect(screen.getByRole('tab', { name: 'Performance' }).getAttribute('aria-selected')).toBe('true');
    expect(text(t.getByText('Net sales', { selector: 'dt' }).closest('dl')!.children)).toEqual(['Net sales$8,442▲ 12.8%', 'Units201▲ 12.9%', 'Contribution before ads$4,39052% of net sales', 'Refunds$1263 units · 1.5%']);
    expect(t.getByRole('img').getAttribute('aria-label')).toBe('Units sold per day, Oct 27 – Oct 29: 10 in all. Most on Oct 29, 6. 1 day not reported.');
    expect(t.getByRole('img').querySelectorAll('rect').length).toBe(2); // no bar for the day not reported
    expect(t.getByText(/Product views:/).textContent).toBe('Product views: not tracked');
    fireEvent.click(t.getByRole('button', { name: 'Table' }));
    expect(text(t.getByRole('table', { name: 'Units sold per day' }).querySelectorAll('tbody tr'))).toEqual(['Oct 274', 'Oct 28Not reported', 'Oct 29 · so far6']);
    expect(t.getByText('Low stock cover').parentElement!.textContent).toBe('RuleLow stock cover');
    expect(t.getByText(/7.4 sold a day/).textContent).toBe('38 left · 7.4 sold a day over the last 14 days. Flags when stock lasts under 10 days.');
    const rows = t.getByRole('table', { name: 'Channels' }).querySelectorAll('tbody tr');
    expect([...rows].map((tr) => text(tr.querySelectorAll('td')))).toEqual([
      ['SHShopify site', 'Active · since Mar 4', '1', '$1', '$0'],
      ['TKTikTok Shop', 'Failed', '1', '$1', '$0'],
      ['AZAmazon', 'Not listed', '1', '$1', '$0'],
    ]);
    expect(rows[1]!.querySelectorAll('td')[1]!.getAttribute('title')).toBe('Image under 600 px');
    expect(t.getByText(/^Price/).textContent).toBe('Price $10.00 · unit cost $13.20 (Shopify, since Aug 2) · fees 2.9% + $0.30 (estimate)');
  });

  it("missing values say why; recorded fees, no unit cost, no flag, a demo store's channels", async () => {
    const none = (note: string): Partial<SaValue> => ({ status: 'unavailable', reason: 'unsupported', note });
    const gone: SaValue = { value: null, status: 'unavailable', reason: 'unsupported', note: "Demo data isn't split by channel" };
    const t = await open({
      metrics: [metric('units', 3, null), metric('net_sales', 0, null), metric('refunds', 0, null), metric('refund_rate', null, null, none('No units')), metric('contribution_before_ads', null, null, none('No unit cost')), metric('cost_coverage', 0, null)],
      channels: [{ ...channel('site', 'active'), units: gone, netSales: gone, refunds: gone }],
      channelsNote: "Demo data isn't split by channel",
      costs: { unitCost: null, fees: { value: 8.17, status: 'ok' }, feeRule: { percent: 2.9, perOrder: 0.3 } },
      insights: [],
      rules: [],
    });
    expect(text(t.getByText('Net sales', { selector: 'dt' }).closest('dl')!.children)).toEqual(['Net sales$0', 'Units3', 'Contribution before adsNot supportedNo unit cost', 'Refunds$0']);
    expect(t.queryByText('Rule')).toBeNull();
    expect(t.getByText("Demo data isn't split by channel.")).toBeTruthy();
    expect(text(t.getByRole('table', { name: 'Channels' }).querySelectorAll('tbody td')).slice(2)).toEqual(['–', '–', '–']);
    expect(t.getByText(/^Price/).textContent).toBe('Price $10.00 · no unit cost · fees $8 (recorded)');
  });
});

describe('Variants and Channels tabs (SA-90)', () => {
  const variant = (id: string, more: Partial<SaVariantRow>): SaVariantRow => ({ id, title: null, sku: null, price: null, stock: null, stockState: 'not_tracked', units: V(2), netSales: V(84), refunds: V(0), contribution: V(30), ...more });
  const open = async (more: Partial<SaProductDetail>) => {
    render('/analytics?store=a&tab=listings&product=p1', more);
    const d = await screen.findByRole('dialog', { name: 'Product 1' });
    await within(d).findByRole('tabpanel', { name: 'Performance' });
    return d;
  };
  const cells = (t: HTMLElement) => [...t.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));

  it('Variants: each variant with its SKU, price, stock state and sales; the tab counts them', async () => {
    const d = await open({
      variants: {
        rows: [variant('v1', { title: 'Rose / 15 ml', sku: 'LIP-R15', price: 42, stock: 38, stockState: 'low', coverDays: 5.1 }), variant('v2', { title: 'Plum', price: 42, stock: 0, stockState: 'out', units: { value: null, status: 'unavailable' } })],
        note: 'Variant sales not recorded yet',
      },
    });
    expect(within(d).getByRole('tab', { name: /^Variants/ }).textContent).toBe('Variants 2');
    fireEvent.click(within(d).getByRole('tab', { name: /^Variants/ }));
    const t = within(within(d).getByRole('tabpanel', { name: 'Variants' }));
    expect(cells(t.getByRole('table', { name: 'Variants' }))).toEqual([
      ['Rose / 15 ml · LIP-R15', '$42.00', '38 · ~5 d', '2', '$84', '$0'],
      ['Plum', '$42.00', '0 · out', '–', '$84', '$0'],
    ]);
    expect(t.getByText('0 · out').className).toContain('text-red');
    expect(t.getByText('Variant sales not recorded yet.')).toBeTruthy();
  });

  it('Channels: status, its error, since only from a publish date, sync time and period sales', async () => {
    const synced = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const d = await open({
      channels: [
        { ...channel('site', 'active', null, '2026-03-04'), syncedAt: synced },
        { ...channel('tiktok_shop', 'failed', 'Image under 600 px'), syncedAt: synced },
        channel('amazon', null, null, '2026-05-01'),
      ],
      channelsNote: "Demo data isn't split by channel",
    });
    expect(within(d).getByRole('tab', { name: /^Channels/ }).textContent).toBe('Channels 3');
    fireEvent.click(within(d).getByRole('tab', { name: /^Channels/ }));
    const t = within(within(d).getByRole('tabpanel', { name: 'Channels' }));
    expect(cells(t.getByRole('table', { name: 'Channel listings' }))).toEqual([
      ['SHShopify site', 'Active · since Mar 4', '2 h ago', '1', '$1', '$0'],
      ['TKTikTok Shop', 'FailedImage under 600 px', '2 h ago', '1', '$1', '$0'],
      ['AZAmazon', 'Not listed', '–', '1', '$1', '$0'],
    ]);
    expect(t.getByText('Image under 600 px').className).toContain('text-red');
    expect(t.getByText("Demo data isn't split by channel.")).toBeTruthy();
  });
});

describe('Product links (SA-91)', () => {
  const channels = async () => {
    const d = await screen.findByRole('dialog', { name: 'Product 1' });
    fireEvent.click(await within(d).findByRole('tab', { name: /^Channels/ }));
    return within(within(d).getByRole('tabpanel', { name: 'Channels' }));
  };
  const linkCall = (fetch: ReturnType<typeof render>) => fetch.mock.calls.find(([u]) => u === '/api/analytics/product-links')?.[1];

  it("the channel products rolled into it and how each link was made; the owner's unlinks and the views reload", async () => {
    const fetch = render('/analytics?store=a&tab=listings&product=p1', {
      links: [
        { channel: 'tiktok_shop', channelProductId: 'tt-9001', title: 'Silk Sleep Scrunchie Set', method: 'owner', createdAt: '2026-10-01T12:00:00.000Z' },
        { channel: 'tiktok_shop', channelProductId: 'tt-9003', title: null, method: 'platform_id', createdAt: '2026-09-01T12:00:00.000Z' },
      ],
    });
    const t = await channels();
    expect(t.getByText('Silk Sleep Scrunchie Set').parentElement!.textContent).toBe('TKSilk Sleep Scrunchie Set· TikTok Shop product tt-9001, linked by you on Oct 1Unlink');
    expect(t.getByText('tt-9003').parentElement!.textContent).toBe("TKtt-9003· TikTok Shop product tt-9003, linked by TikTok Shop's own product id");
    expect(t.queryByRole('searchbox')).toBeNull(); // a store product: nothing to link
    const loads = () => fetch.mock.calls.filter(([u]) => String(u).startsWith('/api/analytics/products/p1?')).length;
    const before = loads();
    fireEvent.click(t.getByRole('button', { name: 'Unlink' }));
    await waitFor(() => expect(loads()).toBeGreaterThan(before));
    expect([linkCall(fetch)!.method, JSON.parse(String(linkCall(fetch)!.body))]).toEqual(['DELETE', { store: 'a', channelProductId: 'tt-9001' }]);
  });

  it('a product listed on another channel only finds a store product and links to it; a refusal shows', async () => {
    const fetch = render('/analytics?store=a&tab=listings&product=p1', { row: row(1, { channels: [{ channel: 'tiktok_shop', status: 'active', error: null }] }) }, (url) =>
      url === '/api/analytics/product-links' ? new Response(JSON.stringify({ error: 'Other products are linked to that one' }), { status: 400 }) : undefined,
    );
    const t = await channels();
    expect(t.getByText(/^Listed on TikTok Shop only/)).toBeTruthy();
    fireEvent.change(t.getByRole('searchbox', { name: 'Find the store product' }), { target: { value: 'Product' } });
    const link = await t.findByRole('button', { name: 'Link' });
    expect(link.parentElement!.textContent).toBe('Product 2p2Link'); // never itself
    expect(fetch.mock.calls.some(([u]) => String(u).startsWith('/api/analytics/listings?') && String(u).includes('q=Product') && String(u).includes('status=all'))).toBe(true);
    fireEvent.click(link);
    expect(await t.findByText('Other products are linked to that one')).toBeTruthy();
    expect([linkCall(fetch)!.method, JSON.parse(String(linkCall(fetch)!.body))]).toEqual(['PUT', { store: 'a', channelProductId: 'p1', productId: 'p2' }]);
  });
});
